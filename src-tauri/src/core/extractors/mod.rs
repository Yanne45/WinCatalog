// ============================================================================
// WinCatalog — core/extractors/mod.rs
// Metadata extractors: EXIF, ID3, FLAC, FFprobe video, PDF
//
// Each extractor reads a file and writes to the corresponding meta_* table.
// Called by the job runner for 'extract_meta' jobs.
// ============================================================================

pub mod plugins;

use std::path::Path;
use std::process::Command;

use id3::TagLike;
use rusqlite::params;
use thiserror::Error;

use crate::db::{Database, DbError, DbResult};

#[derive(Error, Debug)]
pub enum ExtractError {
    #[error("DB error: {0}")]
    Db(#[from] DbError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Unsupported: {0}")]
    Unsupported(String),
}

pub type ExtractResult<T> = Result<T, ExtractError>;

// ============================================================================
// Image metadata (EXIF via kamadak-exif)
// ============================================================================

pub fn extract_image_meta(db: &Database, entry_id: i64, path: &Path) -> ExtractResult<()> {
    let file = std::fs::File::open(path)?;
    let mut reader = std::io::BufReader::new(&file);

    let exif = exif::Reader::new()
        .read_from_container(&mut reader)
        .map_err(|e| ExtractError::Parse(format!("EXIF: {}", e)))?;

    let get_str = |tag: exif::Tag| -> Option<String> {
        exif.get_field(tag, exif::In::PRIMARY)
            .map(|f| f.display_value().with_unit(&exif).to_string())
    };
    let get_u32 = |tag: exif::Tag| -> Option<u32> {
        exif.get_field(tag, exif::In::PRIMARY)
            .and_then(|f| match f.value {
                exif::Value::Long(ref v) if !v.is_empty() => Some(v[0]),
                exif::Value::Short(ref v) if !v.is_empty() => Some(v[0] as u32),
                _ => None,
            })
    };
    let get_rational = |tag: exif::Tag| -> Option<f64> {
        exif.get_field(tag, exif::In::PRIMARY)
            .and_then(|f| match f.value {
                exif::Value::Rational(ref v) if !v.is_empty() => Some(v[0].num as f64 / v[0].denom.max(1) as f64),
                _ => None,
            })
    };

    let width = get_u32(exif::Tag::PixelXDimension).or(get_u32(exif::Tag::ImageWidth));
    let height = get_u32(exif::Tag::PixelYDimension).or(get_u32(exif::Tag::ImageLength));
    let orientation = get_u32(exif::Tag::Orientation);
    let camera_make = get_str(exif::Tag::Make);
    let camera_model = get_str(exif::Tag::Model);
    let iso = get_u32(exif::Tag::PhotographicSensitivity);
    let focal_length = get_rational(exif::Tag::FocalLength);
    let aperture = get_rational(exif::Tag::FNumber);
    let shutter_speed = get_str(exif::Tag::ExposureTime);
    let color_space = get_str(exif::Tag::ColorSpace);

    // GPS
    let (gps_lat, gps_lon) = extract_gps(&exif);

    // Date taken
    let taken_at = exif.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
        .and_then(|f| parse_exif_datetime(&f.display_value().to_string()));

    db.write(move |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO meta_image (entry_id, width, height, orientation, color_space,
             camera_make, camera_model, iso, focal_length, aperture, shutter_speed,
             gps_lat, gps_lon, taken_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![entry_id, width, height, orientation, color_space,
                    camera_make, camera_model, iso, focal_length, aperture, shutter_speed,
                    gps_lat, gps_lon, taken_at],
        )?;
        Ok(())
    })?;
    Ok(())
}

fn extract_gps(exif: &exif::Exif) -> (Option<f64>, Option<f64>) {
    let to_decimal = |tag: exif::Tag, ref_tag: exif::Tag| -> Option<f64> {
        let field = exif.get_field(tag, exif::In::PRIMARY)?;
        let ref_field = exif.get_field(ref_tag, exif::In::PRIMARY)?;
        if let exif::Value::Rational(ref v) = field.value {
            if v.len() >= 3 {
                let d = v[0].num as f64 / v[0].denom.max(1) as f64;
                let m = v[1].num as f64 / v[1].denom.max(1) as f64;
                let s = v[2].num as f64 / v[2].denom.max(1) as f64;
                let mut dec = d + m / 60.0 + s / 3600.0;
                let r = ref_field.display_value().to_string();
                if r.contains('S') || r.contains('W') { dec = -dec; }
                return Some(dec);
            }
        }
        None
    };
    (
        to_decimal(exif::Tag::GPSLatitude, exif::Tag::GPSLatitudeRef),
        to_decimal(exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef),
    )
}

fn parse_exif_datetime(s: &str) -> Option<i64> {
    // Format: "2024:03:15 14:30:00" or similar
    let clean = s.trim().replace('"', "");
    let parts: Vec<&str> = clean.splitn(2, ' ').collect();
    if parts.len() < 2 { return None; }
    let date_parts: Vec<u32> = parts[0].split(':').filter_map(|p| p.parse().ok()).collect();
    let time_parts: Vec<u32> = parts[1].split(':').filter_map(|p| p.parse().ok()).collect();
    if date_parts.len() < 3 || time_parts.len() < 3 { return None; }
    // Rough unix timestamp (ignoring timezone)
    // Use a simplified calculation
    let y = date_parts[0] as i64;
    let m = date_parts[1] as i64;
    let d = date_parts[2] as i64;
    let h = time_parts[0] as i64;
    let min = time_parts[1] as i64;
    let sec = time_parts[2] as i64;
    // Days from epoch (approximate, good enough for sorting)
    let days = (y - 1970) * 365 + (y - 1969) / 4 + month_days(m) + d - 1;
    Some(days * 86400 + h * 3600 + min * 60 + sec)
}

fn month_days(m: i64) -> i64 {
    const CUMUL: [i64; 13] = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    CUMUL.get(m as usize).copied().unwrap_or(0)
}

// ============================================================================
// Audio metadata (ID3 / FLAC)
// ============================================================================

pub fn extract_audio_meta(db: &Database, entry_id: i64, path: &Path, ext: &str) -> ExtractResult<()> {
    let meta = match ext {
        "mp3" => extract_id3(path)?,
        "flac" => extract_flac(path)?,
        _ => extract_audio_ffprobe(path)?,
    };

    db.write(move |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO meta_audio (entry_id, duration_ms, artist, album, title,
             track_number, genre, year, bitrate, sample_rate, channels)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![entry_id, meta.duration_ms, meta.artist, meta.album, meta.title,
                    meta.track_number, meta.genre, meta.year, meta.bitrate,
                    meta.sample_rate, meta.channels],
        )?;
        Ok(())
    })?;
    Ok(())
}

struct AudioMeta {
    duration_ms: Option<i64>,
    artist: Option<String>,
    album: Option<String>,
    title: Option<String>,
    track_number: Option<i32>,
    genre: Option<String>,
    year: Option<i32>,
    bitrate: Option<i32>,
    sample_rate: Option<i32>,
    channels: Option<i32>,
}

fn extract_id3(path: &Path) -> ExtractResult<AudioMeta> {
    let tag = id3::Tag::read_from_path(path)
        .map_err(|e| ExtractError::Parse(format!("ID3: {}", e)))?;
    Ok(AudioMeta {
        duration_ms: tag.duration().map(|d| d as i64 * 1000),
        artist: tag.artist().map(|s| s.to_string()),
        album: tag.album().map(|s| s.to_string()),
        title: tag.title().map(|s| s.to_string()),
        track_number: tag.track().map(|t| t as i32),
        genre: tag.genre().map(|s| s.to_string()),
        year: tag.year(),
        bitrate: None, sample_rate: None, channels: None,
    })
}

fn extract_flac(path: &Path) -> ExtractResult<AudioMeta> {
    let tag = metaflac::Tag::read_from_path(path)
        .map_err(|e| ExtractError::Parse(format!("FLAC: {}", e)))?;
    let vc = tag.vorbis_comments();
    let get = |key: &str| -> Option<String> {
        vc.and_then(|c| c.get(key).and_then(|v| v.first().cloned()))
    };
    let si = tag.get_streaminfo();
    Ok(AudioMeta {
        duration_ms: si.map(|s| (s.total_samples as i64 * 1000) / s.sample_rate.max(1) as i64),
        artist: get("ARTIST"),
        album: get("ALBUM"),
        title: get("TITLE"),
        track_number: get("TRACKNUMBER").and_then(|s| s.parse().ok()),
        genre: get("GENRE"),
        year: get("DATE").and_then(|s| s[..4].parse().ok()),
        bitrate: si.map(|s| s.bits_per_sample as i32),
        sample_rate: si.map(|s| s.sample_rate as i32),
        channels: si.map(|s| s.num_channels as i32),
    })
}

fn extract_audio_ffprobe(path: &Path) -> ExtractResult<AudioMeta> {
    let info = run_ffprobe(path)?;
    Ok(AudioMeta {
        duration_ms: info.duration_ms,
        artist: info.tags.get("artist").cloned(),
        album: info.tags.get("album").cloned(),
        title: info.tags.get("title").cloned(),
        track_number: info.tags.get("track").and_then(|s| s.split('/').next()?.parse().ok()),
        genre: info.tags.get("genre").cloned(),
        year: info.tags.get("date").and_then(|s| s[..4].parse().ok()),
        bitrate: info.bitrate,
        sample_rate: info.sample_rate,
        channels: info.channels,
    })
}

// ============================================================================
// Video metadata (FFprobe)
// ============================================================================

pub fn extract_video_meta(db: &Database, entry_id: i64, path: &Path) -> ExtractResult<()> {
    let info = run_ffprobe(path)?;

    db.write(move |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO meta_video (entry_id, duration_ms, width, height, fps,
             video_codec, audio_codec, bitrate, container)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![entry_id, info.duration_ms, info.width, info.height, info.fps,
                    info.video_codec, info.audio_codec, info.bitrate, info.container],
        )?;
        Ok(())
    })?;
    Ok(())
}

// ============================================================================
// Document metadata (PDF page count, title, author)
// ============================================================================

pub fn extract_document_meta(db: &Database, entry_id: i64, path: &Path, ext: &str) -> ExtractResult<()> {
    let (page_count, title, author) = match ext {
        "pdf" => extract_pdf_meta(path)?,
        _ => (None, None, None),
    };

    let ext = ext.to_string();
    db.write(move |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO meta_document (entry_id, format, page_count, title, author)
             VALUES (?1,?2,?3,?4,?5)",
            params![entry_id, ext, page_count, title, author],
        )?;
        Ok(())
    })?;
    Ok(())
}

fn extract_pdf_meta(path: &Path) -> ExtractResult<(Option<i32>, Option<String>, Option<String>)> {
    // Use pdfinfo (from poppler-utils) for page count + metadata
    let output = Command::new("pdfinfo")
        .arg(path.to_string_lossy().as_ref())
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout);
            let mut pages = None;
            let mut title = None;
            let mut author = None;
            for line in text.lines() {
                if let Some(v) = line.strip_prefix("Pages:") {
                    pages = v.trim().parse().ok();
                } else if let Some(v) = line.strip_prefix("Title:") {
                    let t = v.trim().to_string();
                    if !t.is_empty() { title = Some(t); }
                } else if let Some(v) = line.strip_prefix("Author:") {
                    let a = v.trim().to_string();
                    if !a.is_empty() { author = Some(a); }
                }
            }
            Ok((pages, title, author))
        }
        _ => Ok((None, None, None)),
    }
}

// ============================================================================
// Batch extractor: run for a volume + kind
// ============================================================================

pub fn run_extract_meta(
    db: &Database,
    volume_id: i64,
    kind: &str,
    cancel: &std::sync::atomic::AtomicBool,
) -> ExtractResult<(u64, u64)> {
    let meta_table = format!("meta_{}", kind);

    let entries: Vec<(i64, String, Option<String>)> = db.read(|conn| {
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT e.id, e.path, e.ext FROM entries e
             WHERE e.volume_id=?1 AND e.status='present' AND e.kind=?2
               AND NOT EXISTS (SELECT 1 FROM {} m WHERE m.entry_id=e.id)
             LIMIT 5000", meta_table
        ))?;
        let rows = stmt.query_map(params![volume_id, kind], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .filter_map(|r| r.ok()).collect();
        Ok(rows)
    })?;

    let mut extracted = 0u64;
    let mut errors = 0u64;

    for (entry_id, path_str, ext) in &entries {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) { break; }

        let path = Path::new(path_str);
        if !path.exists() { continue; }

        let ext_str = ext.as_deref().unwrap_or("");
        let result = match kind {
            "image" => extract_image_meta(db, *entry_id, path),
            "audio" => extract_audio_meta(db, *entry_id, path, ext_str),
            "video" => extract_video_meta(db, *entry_id, path),
            "document" => extract_document_meta(db, *entry_id, path, ext_str),
            _ => { errors += 1; continue; }
        };

        match result {
            Ok(()) => extracted += 1,
            Err(e) => { errors += 1; log::debug!("Extract meta error for {}: {}", path_str, e); }
        }
    }

    log::info!("extract_meta kind={}: {} extracted, {} errors", kind, extracted, errors);
    Ok((extracted, errors))
}

// ============================================================================
// FFprobe helper
// ============================================================================

struct FfprobeInfo {
    duration_ms: Option<i64>,
    width: Option<i32>,
    height: Option<i32>,
    fps: Option<f64>,
    video_codec: Option<String>,
    audio_codec: Option<String>,
    bitrate: Option<i32>,
    sample_rate: Option<i32>,
    channels: Option<i32>,
    container: Option<String>,
    tags: std::collections::HashMap<String, String>,
}

fn run_ffprobe(path: &Path) -> ExtractResult<FfprobeInfo> {
    let output = Command::new("ffprobe")
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams",
               &path.to_string_lossy()])
        .output()
        .map_err(|e| ExtractError::Parse(format!("ffprobe: {}", e)))?;

    if !output.status.success() {
        return Err(ExtractError::Parse("ffprobe failed".into()));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| ExtractError::Parse(format!("ffprobe JSON: {}", e)))?;

    let format = json.get("format");
    let streams = json.get("streams").and_then(|s| s.as_array());

    let mut info = FfprobeInfo {
        duration_ms: format.and_then(|f| f.get("duration")).and_then(|d| d.as_str())
            .and_then(|s| s.parse::<f64>().ok()).map(|d| (d * 1000.0) as i64),
        width: None, height: None, fps: None,
        video_codec: None, audio_codec: None,
        bitrate: format.and_then(|f| f.get("bit_rate")).and_then(|b| b.as_str())
            .and_then(|s| s.parse::<i64>().ok()).map(|b| (b / 1000) as i32),
        sample_rate: None, channels: None,
        container: format.and_then(|f| f.get("format_name")).and_then(|n| n.as_str()).map(|s| s.to_string()),
        tags: std::collections::HashMap::new(),
    };

    if let Some(streams) = streams {
        for stream in streams {
            let codec_type = stream.get("codec_type").and_then(|t| t.as_str()).unwrap_or("");
            match codec_type {
                "video" => {
                    info.video_codec = stream.get("codec_name").and_then(|c| c.as_str()).map(|s| s.to_string());
                    info.width = stream.get("width").and_then(|w| w.as_i64()).map(|w| w as i32);
                    info.height = stream.get("height").and_then(|h| h.as_i64()).map(|h| h as i32);
                    if let Some(fps_str) = stream.get("r_frame_rate").and_then(|f| f.as_str()) {
                        let parts: Vec<f64> = fps_str.split('/').filter_map(|p| p.parse().ok()).collect();
                        if parts.len() == 2 && parts[1] > 0.0 { info.fps = Some(parts[0] / parts[1]); }
                    }
                }
                "audio" => {
                    info.audio_codec = stream.get("codec_name").and_then(|c| c.as_str()).map(|s| s.to_string());
                    info.sample_rate = stream.get("sample_rate").and_then(|r| r.as_str()).and_then(|s| s.parse().ok());
                    info.channels = stream.get("channels").and_then(|c| c.as_i64()).map(|c| c as i32);
                }
                _ => {}
            }
        }
    }

    // Tags from format
    if let Some(tags) = format.and_then(|f| f.get("tags")).and_then(|t| t.as_object()) {
        for (k, v) in tags {
            if let Some(s) = v.as_str() { info.tags.insert(k.to_lowercase(), s.to_string()); }
        }
    }

    Ok(info)
}
