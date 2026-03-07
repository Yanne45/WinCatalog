// ============================================================================
// WinCatalog — core/thumbs/office.rs
// Extract embedded thumbnails from Office Open XML files (DOCX, PPTX, XLSX)
//
// These files are ZIP archives containing an optional thumbnail at:
//   - docProps/thumbnail.jpeg
//   - docProps/thumbnail.png
//   - docProps/thumbnail.wmf (Windows Metafile — we skip these)
//   - _rels/.rels may reference a thumbnail
//
// Extraction is instant (targeted decompression, no LibreOffice needed).
// ============================================================================

use std::io::Read;
use std::path::Path;

use super::ThumbError;

/// Known thumbnail paths inside Office Open XML ZIP archives.
const THUMBNAIL_PATHS: &[&str] = &[
    "docProps/thumbnail.jpeg",
    "docProps/thumbnail.jpg",
    "docProps/thumbnail.png",
    "docProps/thumbnail.emf",     // We'll try to decode, skip if not image
    "_rels/thumbnail.jpeg",
    "_rels/thumbnail.jpg",
    "_rels/thumbnail.png",
];

/// Extract the embedded thumbnail from an Office Open XML file.
/// Returns the raw image bytes (JPEG or PNG).
pub fn extract_office_thumbnail(source: &Path) -> Result<Vec<u8>, ThumbError> {
    let file = std::fs::File::open(source)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| ThumbError::NoCoverArt)?;

    // Strategy 1: try known paths
    for path in THUMBNAIL_PATHS {
        if let Ok(mut entry) = archive.by_name(path) {
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf)?;

            if !buf.is_empty() && is_image_data(&buf) {
                log::debug!(
                    "Office thumbnail found at '{}' ({} bytes)",
                    path,
                    buf.len()
                );
                return Ok(buf);
            }
        }
    }

    // Strategy 2: scan all entries for image files in docProps/
    for i in 0..archive.len() {
        let name = match archive.by_index(i) {
            Ok(entry) => entry.name().to_string(),
            Err(_) => continue,
        };
        if name.starts_with("docProps/")
            && (name.ends_with(".jpeg")
                || name.ends_with(".jpg")
                || name.ends_with(".png"))
        {
            let mut entry = archive.by_index(i)
                .map_err(|_| ThumbError::NoCoverArt)?;
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf)?;

            if !buf.is_empty() && is_image_data(&buf) {
                log::debug!(
                    "Office thumbnail found at '{}' ({} bytes)",
                    name,
                    buf.len()
                );
                return Ok(buf);
            }
        }
    }

    Err(ThumbError::NoCoverArt)
}

/// Quick check if data looks like a JPEG or PNG image.
fn is_image_data(data: &[u8]) -> bool {
    if data.len() < 4 {
        return false;
    }

    // JPEG: starts with FF D8 FF
    if data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
        return true;
    }

    // PNG: starts with 89 50 4E 47
    if data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
        return true;
    }

    // WebP: starts with RIFF....WEBP
    if data.len() >= 12
        && &data[0..4] == b"RIFF"
        && &data[8..12] == b"WEBP"
    {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_image_jpeg() {
        assert!(is_image_data(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00]));
    }

    #[test]
    fn test_is_image_png() {
        assert!(is_image_data(&[0x89, 0x50, 0x4E, 0x47, 0x0D]));
    }

    #[test]
    fn test_is_not_image() {
        assert!(!is_image_data(&[0x00, 0x00, 0x00, 0x00]));
        assert!(!is_image_data(&[0x50, 0x4B, 0x03, 0x04])); // ZIP header
    }
}
