use super::*;
use base64::Engine as _;

pub(super) fn build_media_data_url_map(result: &FullParseResult) -> HashMap<String, String> {
    let mut data_urls = HashMap::new();

    for part in &result.imported_media_parts {
        let normalized = part.path.replace('\\', "/");
        let mime = part
            .content_type
            .as_deref()
            .filter(|content_type| content_type.starts_with("image/"))
            .or_else(|| image_mime_type_for_bytes(&part.bytes))
            .unwrap_or("application/octet-stream");
        let encoded = base64::engine::general_purpose::STANDARD.encode(&part.bytes);
        let data_url = format!("data:{mime};base64,{encoded}");

        data_urls.insert(normalized.clone(), data_url.clone());
        if let Some(file_name) = normalized.strip_prefix("xl/media/") {
            data_urls.insert(format!("../media/{file_name}"), data_url.clone());
            data_urls.insert(format!("media/{file_name}"), data_url.clone());
            data_urls.insert(file_name.to_string(), data_url);
        }
    }

    data_urls
}

pub(super) fn build_binary_part_map(result: &FullParseResult) -> HashMap<String, Vec<u8>> {
    let mut parts = HashMap::new();

    for part in &result.imported_media_parts {
        parts.insert(part.path.replace('\\', "/"), part.bytes.clone());
    }
    for part in &result.imported_ole_parts {
        parts.insert(part.path.replace('\\', "/"), part.bytes.clone());
    }

    parts
}

fn image_mime_type_for_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        Some("image/tiff")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_mime_type_for_bytes_recognizes_jpeg_jfif_payload() {
        assert_eq!(
            image_mime_type_for_bytes(b"\xff\xd8\xff\xe0"),
            Some("image/jpeg")
        );
    }
}
