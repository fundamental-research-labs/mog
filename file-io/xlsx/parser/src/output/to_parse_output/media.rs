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
            .unwrap_or_else(|| image_mime_type_for_path(&normalized));
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

fn image_mime_type_for_path(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "tif" | "tiff" => "image/tiff",
        "svg" | "svgz" => "image/svg+xml",
        "emf" => "image/x-emf",
        "wmf" => "image/x-wmf",
        _ => "application/octet-stream",
    }
}
