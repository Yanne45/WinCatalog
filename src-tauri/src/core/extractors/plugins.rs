// ============================================================================
// WinCatalog — core/extractors/plugins.rs
// Modular extractor plugin system
//
// Trait-based: each extractor implements `ExtractorPlugin`.
// A global registry dispatches to the right plugin by kind + ext.
// New formats can be added by implementing the trait and registering.
// ============================================================================

use std::path::Path;
use std::sync::Arc;

use crate::db::Database;

// ============================================================================
// Plugin trait
// ============================================================================

/// Trait that all metadata extractors must implement.
pub trait ExtractorPlugin: Send + Sync {
    /// Unique name for this extractor (e.g. "exif", "id3", "ffprobe").
    fn name(&self) -> &str;

    /// File kinds this extractor handles (e.g. ["image"], ["audio"], ["video"]).
    fn supported_kinds(&self) -> &[&str];

    /// File extensions this extractor handles (e.g. ["jpg", "jpeg", "png"]).
    /// Empty = all extensions for the given kind.
    fn supported_extensions(&self) -> &[&str];

    /// Priority: lower = runs first. Default extractors use 100.
    /// Custom plugins can use 200+ to override or supplement.
    fn priority(&self) -> u32 { 100 }

    /// Extract metadata from the file and write to the DB.
    /// Returns Ok(true) if extraction succeeded, Ok(false) if skipped.
    fn extract(&self, db: &Database, entry_id: i64, path: &Path, ext: &str) -> Result<bool, String>;
}

// ============================================================================
// Registry
// ============================================================================

/// Registry of extractor plugins, sorted by priority.
pub struct ExtractorRegistry {
    plugins: Vec<Arc<dyn ExtractorPlugin>>,
}

impl ExtractorRegistry {
    pub fn new() -> Self {
        Self { plugins: Vec::new() }
    }

    /// Create a registry with all built-in extractors pre-registered.
    pub fn with_defaults() -> Self {
        let mut reg = Self::new();
        reg.register(Arc::new(BuiltinImageExtractor));
        reg.register(Arc::new(BuiltinAudioExtractor));
        reg.register(Arc::new(BuiltinVideoExtractor));
        reg.register(Arc::new(BuiltinDocumentExtractor));
        reg
    }

    /// Register a new plugin. Maintains priority ordering.
    pub fn register(&mut self, plugin: Arc<dyn ExtractorPlugin>) {
        self.plugins.push(plugin);
        self.plugins.sort_by_key(|p| p.priority());
    }

    /// Find all plugins that can handle the given kind + extension.
    pub fn find_plugins(&self, kind: &str, ext: &str) -> Vec<Arc<dyn ExtractorPlugin>> {
        self.plugins.iter()
            .filter(|p| {
                let kind_match = p.supported_kinds().is_empty() || p.supported_kinds().contains(&kind);
                let ext_match = p.supported_extensions().is_empty() || p.supported_extensions().contains(&ext);
                kind_match && ext_match
            })
            .cloned()
            .collect()
    }

    /// Run all matching extractors for a file. Stops at the first success.
    pub fn extract(&self, db: &Database, entry_id: i64, path: &Path, kind: &str, ext: &str) -> Result<bool, String> {
        let plugins = self.find_plugins(kind, ext);
        for plugin in &plugins {
            match plugin.extract(db, entry_id, path, ext) {
                Ok(true) => {
                    log::debug!("Extractor '{}' succeeded for entry {}", plugin.name(), entry_id);
                    return Ok(true);
                }
                Ok(false) => continue, // skipped, try next
                Err(e) => {
                    log::debug!("Extractor '{}' failed for entry {}: {}", plugin.name(), entry_id, e);
                    continue; // try next plugin
                }
            }
        }
        Ok(false) // no plugin could extract
    }

    /// List registered plugins.
    pub fn list_plugins(&self) -> Vec<PluginInfo> {
        self.plugins.iter().map(|p| PluginInfo {
            name: p.name().to_string(),
            kinds: p.supported_kinds().iter().map(|s| s.to_string()).collect(),
            extensions: p.supported_extensions().iter().map(|s| s.to_string()).collect(),
            priority: p.priority(),
        }).collect()
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PluginInfo {
    pub name: String,
    pub kinds: Vec<String>,
    pub extensions: Vec<String>,
    pub priority: u32,
}

// ============================================================================
// Built-in extractors (delegate to existing extractors/mod.rs functions)
// ============================================================================

struct BuiltinImageExtractor;
impl ExtractorPlugin for BuiltinImageExtractor {
    fn name(&self) -> &str { "builtin_image_exif" }
    fn supported_kinds(&self) -> &[&str] { &["image"] }
    fn supported_extensions(&self) -> &[&str] { &["jpg", "jpeg", "tiff", "tif", "png", "webp", "heic", "heif"] }
    fn extract(&self, db: &Database, entry_id: i64, path: &Path, _ext: &str) -> Result<bool, String> {
        super::extract_image_meta(db, entry_id, path).map(|_| true).map_err(|e| e.to_string())
    }
}

struct BuiltinAudioExtractor;
impl ExtractorPlugin for BuiltinAudioExtractor {
    fn name(&self) -> &str { "builtin_audio" }
    fn supported_kinds(&self) -> &[&str] { &["audio"] }
    fn supported_extensions(&self) -> &[&str] { &["mp3", "flac", "ogg", "m4a", "aac", "wma", "wav", "opus"] }
    fn extract(&self, db: &Database, entry_id: i64, path: &Path, ext: &str) -> Result<bool, String> {
        super::extract_audio_meta(db, entry_id, path, ext).map(|_| true).map_err(|e| e.to_string())
    }
}

struct BuiltinVideoExtractor;
impl ExtractorPlugin for BuiltinVideoExtractor {
    fn name(&self) -> &str { "builtin_video_ffprobe" }
    fn supported_kinds(&self) -> &[&str] { &["video"] }
    fn supported_extensions(&self) -> &[&str] { &[] } // all video extensions
    fn extract(&self, db: &Database, entry_id: i64, path: &Path, _ext: &str) -> Result<bool, String> {
        super::extract_video_meta(db, entry_id, path).map(|_| true).map_err(|e| e.to_string())
    }
}

struct BuiltinDocumentExtractor;
impl ExtractorPlugin for BuiltinDocumentExtractor {
    fn name(&self) -> &str { "builtin_document" }
    fn supported_kinds(&self) -> &[&str] { &["document"] }
    fn supported_extensions(&self) -> &[&str] { &["pdf", "docx", "pptx", "xlsx"] }
    fn extract(&self, db: &Database, entry_id: i64, path: &Path, ext: &str) -> Result<bool, String> {
        super::extract_document_meta(db, entry_id, path, ext).map(|_| true).map_err(|e| e.to_string())
    }
}
