// ============================================================================
// WinCatalog — core/scanner/kind.rs
// File kind detection from extension / MIME type
// ============================================================================
//
// Maps files to one of: dir, image, video, audio, document, text,
// archive, font, ebook, other
//
// Two-pass: extension first (fast), then MIME prefix fallback.

/// Detect the file kind from extension and/or MIME type.
pub fn detect_kind(ext: Option<&str>, mime: Option<&str>) -> String {
    // 1. Extension-based (most reliable for common types)
    if let Some(ext) = ext {
        if let Some(kind) = kind_from_ext(ext) {
            return kind.to_string();
        }
    }

    // 2. MIME-based fallback
    if let Some(mime) = mime {
        if let Some(kind) = kind_from_mime(mime) {
            return kind.to_string();
        }
    }

    "other".to_string()
}

fn kind_from_ext(ext: &str) -> Option<&'static str> {
    match ext {
        // Images
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "svg" | "ico"
        | "tiff" | "tif" | "heic" | "heif" | "avif" | "raw" | "cr2"
        | "nef" | "arw" | "dng" | "psd" | "ai" | "xcf" => Some("image"),

        // Video
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" | "m4v"
        | "mpg" | "mpeg" | "3gp" | "ogv" | "ts" | "vob" => Some("video"),

        // Audio
        "mp3" | "flac" | "wav" | "aac" | "ogg" | "wma" | "m4a" | "opus"
        | "aiff" | "ape" | "alac" | "mid" | "midi" => Some("audio"),

        // Documents
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx"
        | "odt" | "ods" | "odp" | "rtf" | "pages" | "numbers"
        | "keynote" | "csv" | "tsv" => Some("document"),

        // Text
        "txt" | "md" | "markdown" | "rst" | "log" | "ini" | "cfg"
        | "conf" | "yaml" | "yml" | "toml" | "json" | "xml" | "html"
        | "htm" | "css" | "js" | "ts" | "jsx" | "tsx" | "py" | "rs"
        | "go" | "java" | "c" | "cpp" | "h" | "hpp" | "cs" | "rb"
        | "php" | "sh" | "bash" | "zsh" | "fish" | "ps1" | "bat"
        | "cmd" | "sql" | "r" | "swift" | "kt" | "scala" | "lua"
        | "pl" | "ex" | "exs" | "hs" | "ml" | "vim" | "tex"
        | "bib" | "srt" | "sub" | "ass" | "nfo" => Some("text"),

        // Archives
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "zst"
        | "lz4" | "lzma" | "cab" | "iso" | "dmg" | "img" => Some("archive"),

        // Fonts
        "ttf" | "otf" | "woff" | "woff2" | "eot" => Some("font"),

        // Ebooks
        "epub" | "mobi" | "azw" | "azw3" | "fb2" | "djvu"
        | "cbz" | "cbr" => Some("ebook"),

        _ => None,
    }
}

fn kind_from_mime(mime: &str) -> Option<&'static str> {
    if mime.starts_with("image/") {
        Some("image")
    } else if mime.starts_with("video/") {
        Some("video")
    } else if mime.starts_with("audio/") {
        Some("audio")
    } else if mime.starts_with("text/") {
        Some("text")
    } else if mime == "application/pdf"
        || mime == "application/msword"
        || mime.contains("spreadsheet")
        || mime.contains("presentation")
        || mime.contains("document")
    {
        Some("document")
    } else if mime.contains("zip")
        || mime.contains("compressed")
        || mime.contains("archive")
        || mime == "application/x-tar"
        || mime == "application/gzip"
        || mime == "application/x-7z-compressed"
        || mime == "application/x-rar-compressed"
    {
        Some("archive")
    } else if mime.contains("font") {
        Some("font")
    } else if mime == "application/epub+zip" || mime.contains("ebook") {
        Some("ebook")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_extensions() {
        assert_eq!(detect_kind(Some("jpg"), None), "image");
        assert_eq!(detect_kind(Some("png"), None), "image");
        assert_eq!(detect_kind(Some("heic"), None), "image");
        assert_eq!(detect_kind(Some("cr2"), None), "image");
    }

    #[test]
    fn test_video_extensions() {
        assert_eq!(detect_kind(Some("mp4"), None), "video");
        assert_eq!(detect_kind(Some("mkv"), None), "video");
    }

    #[test]
    fn test_document_extensions() {
        assert_eq!(detect_kind(Some("pdf"), None), "document");
        assert_eq!(detect_kind(Some("docx"), None), "document");
        assert_eq!(detect_kind(Some("xlsx"), None), "document");
    }

    #[test]
    fn test_text_extensions() {
        assert_eq!(detect_kind(Some("rs"), None), "text");
        assert_eq!(detect_kind(Some("py"), None), "text");
        assert_eq!(detect_kind(Some("md"), None), "text");
    }

    #[test]
    fn test_mime_fallback() {
        assert_eq!(detect_kind(None, Some("image/jpeg")), "image");
        assert_eq!(detect_kind(None, Some("video/mp4")), "video");
        assert_eq!(detect_kind(None, Some("application/pdf")), "document");
    }

    #[test]
    fn test_unknown() {
        assert_eq!(detect_kind(Some("xyz"), None), "other");
        assert_eq!(detect_kind(None, None), "other");
    }
}
