// ============================================================================
// WinCatalog — core/ai/mod.rs
// AI dispatch: classify, summarize, OCR, embeddings via cloud API
//
// All AI goes through a generic HTTP client calling a configurable endpoint.
// The caller provides the API key and provider via settings.
// ============================================================================

use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::{Database, DbError};

#[derive(Error, Debug)]
pub enum AiError {
    #[error("DB error: {0}")]
    Db(#[from] DbError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("API error: {0}")]
    Api(String),
    #[error("Not configured: {0}")]
    NotConfigured(String),
    #[error("Parse error: {0}")]
    Parse(String),
}

pub type AiResult<T> = Result<T, AiError>;

// ============================================================================
// Config (loaded from settings)
// ============================================================================

#[derive(Debug, Clone)]
pub struct AiConfig {
    pub provider: String, // "anthropic", "openai", "mistral"
    pub api_key: String,
    pub model: String, // "claude-sonnet-4-5-20250514", "gpt-4o-mini", "mistral-small-latest"
    pub auto_classify: bool,
    pub auto_ocr_pdf: bool,
}

impl AiConfig {
    pub fn load(db: &Database) -> AiResult<Self> {
        let get = |key: &str| -> Option<String> {
            db.read(|conn| {
                conn.prepare_cached("SELECT value FROM settings WHERE key=?1")?
                    .query_row(params![key], |r| r.get(0))
                    .optional()
                    .map_err(crate::db::DbError::Sqlite)
            })
            .ok()
            .flatten()
        };

        let api_key =
            get("ai.api_key").ok_or_else(|| AiError::NotConfigured("ai.api_key".into()))?;
        if api_key.is_empty() {
            return Err(AiError::NotConfigured("API key is empty".into()));
        }

        let provider = get("ai.provider").unwrap_or_else(|| "anthropic".into());
        let default_model = match provider.as_str() {
            "mistral" => "mistral-small-latest",
            "openai" => "gpt-4o-mini",
            _ => "claude-sonnet-4-5-20250514",
        };

        Ok(Self {
            model: get("ai.model").unwrap_or_else(|| default_model.into()),
            provider,
            api_key,
            auto_classify: get("ai.auto_classify").map(|v| v == "1").unwrap_or(true),
            auto_ocr_pdf: get("ai.auto_ocr_pdf").map(|v| v == "1").unwrap_or(true),
        })
    }
}

use rusqlite::OptionalExtension;

// ============================================================================
// Text extraction (local, no AI)
// ============================================================================

/// Extract text from a document file and store in entry_text.
/// Supports PDF (pdftotext), DOCX (simple ZIP text extraction).
pub fn extract_text(
    db: &Database,
    entry_id: i64,
    path: &Path,
    ext: &str,
) -> AiResult<Option<String>> {
    let text = match ext {
        "pdf" => extract_pdf_text(path)?,
        "txt" | "md" | "csv" | "json" | "xml" | "html" | "log" => {
            std::fs::read_to_string(path).ok()
        }
        _ => None,
    };

    if let Some(ref t) = text {
        let char_count = t.len() as i64;
        let source = "native";
        let now = ts();
        let t_owned = t.clone();
        db.write(move |conn| {
            conn.execute(
                "INSERT OR REPLACE INTO entry_text (entry_id, text, char_count, source, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![entry_id, t_owned, char_count, source, now],
            )?;
            Ok(())
        })?;
    }

    Ok(text)
}

fn extract_pdf_text(path: &Path) -> AiResult<Option<String>> {
    let output = std::process::Command::new("pdftotext")
        .args(["-enc", "UTF-8", &path.to_string_lossy(), "-"])
        .output();
    match output {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            if text.trim().is_empty() {
                Ok(None)
            } else {
                Ok(Some(text))
            }
        }
        _ => Ok(None),
    }
}

// ============================================================================
// Classify document (AI)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifyResult {
    pub doc_type: String,
    pub labels: Vec<String>,
    pub confidence: f64,
}

/// Classify a document by its text content. Stores results in ai_annotations.
pub fn classify_document(
    db: &Database,
    config: &AiConfig,
    entry_id: i64,
    text: &str,
) -> AiResult<ClassifyResult> {
    // Truncate text to first ~2000 chars for classification (char-boundary safe)
    let truncated = if text.len() > 2000 {
        let end = text.floor_char_boundary(2000);
        &text[..end]
    } else {
        text
    };

    let prompt = format!(
        "Classify this document. Respond ONLY with JSON: {{\"doc_type\": \"...\", \"labels\": [...], \"confidence\": 0.0-1.0}}\n\
        Valid doc_types: invoice, receipt, bank_statement, tax, contract, insurance, identity, medical, legal, report, manual, course_notes, resume_cv, letter, presentation, other\n\
        Labels are free-form descriptive tags (max 5).\n\nDocument text:\n{}",
        truncated
    );

    let response = call_ai_api(config, &prompt)?;
    let result: ClassifyResult = serde_json::from_str(&response)
        .map_err(|e| AiError::Parse(format!("Classify JSON: {}", e)))?;

    // Store in ai_annotations
    let now = ts();
    let model = config.model.clone();
    let doc_type = result.doc_type.clone();
    let labels = result.labels.clone();
    let conf = result.confidence;

    db.write(move |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO ai_annotations (entry_id, kind, value, confidence, source, model, created_at)
             VALUES (?1, 'doc_type', ?2, ?3, 'auto', ?4, ?5)",
            params![entry_id, doc_type, conf, model, now],
        )?;
        for label in &labels {
            conn.execute(
                "INSERT OR IGNORE INTO ai_annotations (entry_id, kind, value, confidence, source, model, created_at)
                 VALUES (?1, 'label', ?2, ?3, 'auto', ?4, ?5)",
                params![entry_id, label, conf, model, now],
            )?;
        }
        Ok(())
    })?;

    Ok(result)
}

// ============================================================================
// Summarize document (AI, on-demand)
// ============================================================================

pub fn summarize_document(
    db: &Database,
    config: &AiConfig,
    entry_id: i64,
    text: &str,
) -> AiResult<String> {
    // Use first ~4000 chars + last ~1000 chars for summary (char-boundary safe)
    let input = if text.len() > 5000 {
        let head_end = text.floor_char_boundary(4000);
        let tail_start = text.ceil_char_boundary(text.len().saturating_sub(1000));
        format!(
            "{}...\n\n[...]\n\n{}",
            &text[..head_end],
            &text[tail_start..]
        )
    } else {
        text.to_string()
    };

    let prompt = format!(
        "Résume ce document en 3-5 phrases en français. Sois concis et factuel.\n\nDocument:\n{}",
        input
    );

    let summary = call_ai_api(config, &prompt)?;
    let now = ts();
    let model = config.model.clone();
    let s = summary.clone();

    db.write(move |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO ai_annotations (entry_id, kind, value, confidence, source, model, created_at)
             VALUES (?1, 'summary', ?2, 1.0, 'auto', ?3, ?4)",
            params![entry_id, s, model, now],
        )?;
        Ok(())
    })?;

    Ok(summary)
}

// ============================================================================
// OCR (AI, for scanned PDFs and images)
// ============================================================================

pub fn ocr_document(
    db: &Database,
    config: &AiConfig,
    entry_id: i64,
    path: &Path,
) -> AiResult<String> {
    // Read image/PDF first page as base64
    // For MVP: use pdftotext first; if empty, it's a scanned PDF → send to AI
    let prompt = format!(
        "OCR: extract all text from this document image. Return only the extracted text, no commentary.\nFile: {}",
        path.display()
    );

    let text = call_ai_api(config, &prompt)?;
    let now = ts();
    let t = text.clone();

    db.write(move |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO entry_text (entry_id, text, char_count, source, updated_at)
             VALUES (?1, ?2, ?3, 'ocr', ?4)",
            params![entry_id, t, t.len() as i64, now],
        )?;
        Ok(())
    })?;

    Ok(text)
}

// ============================================================================
// Analyze image (AI, on-demand)
// ============================================================================

pub fn analyze_image(
    db: &Database,
    config: &AiConfig,
    entry_id: i64,
    _path: &Path,
) -> AiResult<Vec<String>> {
    let prompt = "Describe this image with 3-8 short labels in French (e.g. 'plage', 'montagne', 'personnes'). Respond ONLY with JSON array of strings.";

    let response = call_ai_api(config, prompt)?;
    let labels: Vec<String> = serde_json::from_str(&response)
        .map_err(|e| AiError::Parse(format!("Labels JSON: {}", e)))?;

    let now = ts();
    let model = config.model.clone();
    let labels_copy = labels.clone();

    db.write(move |conn| {
        for label in &labels_copy {
            conn.execute(
                "INSERT OR IGNORE INTO ai_annotations (entry_id, kind, value, confidence, source, model, created_at)
                 VALUES (?1, 'label', ?2, 0.8, 'auto', ?3, ?4)",
                params![entry_id, label, model, now],
            )?;
        }
        Ok(())
    })?;

    Ok(labels)
}

// ============================================================================
// Retry helper
// ============================================================================

/// Retry `f` up to 3 times with exponential backoff (1s, 2s) on transient errors.
/// Transient = network error, or HTTP 429 / 5xx.
fn with_retry<F>(mut f: F) -> AiResult<String>
where
    F: FnMut() -> AiResult<String>,
{
    let mut last_err: Option<AiError> = None;
    for attempt in 0u32..3 {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) => {
                let retryable = is_retryable(&e);
                last_err = Some(e);
                if retryable && attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_secs(1 << attempt));
                } else {
                    break;
                }
            }
        }
    }
    Err(last_err.unwrap())
}

fn is_retryable(err: &AiError) -> bool {
    match err {
        AiError::Api(msg) => {
            msg.contains("429")
                || msg.contains("500")
                || msg.contains("502")
                || msg.contains("503")
                || msg.contains("504")
        }
        _ => false,
    }
}

// ============================================================================
// Generic AI API call
// ============================================================================

/// Dispatch to the right provider with retry on transient errors.
fn call_ai_api(config: &AiConfig, prompt: &str) -> AiResult<String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| AiError::Api(format!("HTTP client: {}", e)))?;

    match config.provider.as_str() {
        "anthropic" => with_retry(|| call_anthropic(&client, config, prompt)),
        "openai" => with_retry(|| call_openai(&client, config, prompt)),
        "mistral" => with_retry(|| call_mistral(&client, config, prompt)),
        other => Err(AiError::Api(format!("Unknown AI provider: {}", other))),
    }
}

// ============================================================================
// Provider implementations
// ============================================================================

fn call_anthropic(
    client: &reqwest::blocking::Client,
    config: &AiConfig,
    prompt: &str,
) -> AiResult<String> {
    let body = serde_json::json!({
        "model": config.model,
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &config.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| AiError::Api(format!("Anthropic request: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().unwrap_or_default();
        return Err(AiError::Api(format!("Anthropic {} : {}", status, text)));
    }

    let json: serde_json::Value = resp
        .json()
        .map_err(|e| AiError::Parse(format!("Anthropic response: {}", e)))?;

    json.get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|block| block.get("text"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AiError::Parse("No text in Anthropic response".into()))
}

/// OpenAI-compatible endpoint (also used by Mistral via `base_url`).
fn call_openai_compat(
    client: &reqwest::blocking::Client,
    config: &AiConfig,
    prompt: &str,
    base_url: &str,
    provider_label: &str,
) -> AiResult<String> {
    let body = serde_json::json!({
        "model": config.model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1024,
    });

    let resp = client
        .post(base_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| AiError::Api(format!("{} request: {}", provider_label, e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().unwrap_or_default();
        return Err(AiError::Api(format!("{} {} : {}", provider_label, status, text)));
    }

    let json: serde_json::Value = resp
        .json()
        .map_err(|e| AiError::Parse(format!("{} response: {}", provider_label, e)))?;

    json.get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AiError::Parse(format!("No content in {} response", provider_label)))
}

fn call_openai(
    client: &reqwest::blocking::Client,
    config: &AiConfig,
    prompt: &str,
) -> AiResult<String> {
    call_openai_compat(
        client,
        config,
        prompt,
        "https://api.openai.com/v1/chat/completions",
        "OpenAI",
    )
}

fn call_mistral(
    client: &reqwest::blocking::Client,
    config: &AiConfig,
    prompt: &str,
) -> AiResult<String> {
    call_openai_compat(
        client,
        config,
        prompt,
        "https://api.mistral.ai/v1/chat/completions",
        "Mistral",
    )
}

fn ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
