use domain_types::domain::floating_object::FloatingObjectCommon;

use crate::domain::drawings::write::{DrawingLocking, DrawingObject, ImageProps};

use super::anchors::EMUS_PER_PIXEL;

/// Convert an API-created Picture into a `DrawingObject::Picture`.
///
/// This handles pictures created via the API (no OOXML props). It processes
/// data-URL images from `PictureData.src` and produces minimal valid OOXML.
pub(super) fn convert_image(
    common: &FloatingObjectCommon,
    picture_src: &str,
    image_blobs: &mut Vec<(String, Vec<u8>)>,
    image_rels: &mut Vec<(String, String)>,
) -> Option<DrawingObject> {
    let (ext, decoded) = parse_data_url(picture_src)?;
    let image_idx = image_blobs.len() + 1;
    let image_path = format!("../media/image{}.{}", image_idx, ext);
    let r_id = next_available_image_r_id(image_rels);
    image_rels.push((r_id.clone(), image_path.clone()));
    image_blobs.push((image_path, decoded));

    let name = if common.name.is_empty() {
        "Image".to_string()
    } else {
        common.name.clone()
    };

    let rotation = if common.rotation != 0.0 {
        Some((common.rotation * 60_000.0) as i32)
    } else {
        None
    };

    let image_props = ImageProps {
        name,
        r_id,
        rotation,
        offset_x: 0,
        offset_y: 0,
        extent_cx: common.width as i64 * EMUS_PER_PIXEL,
        extent_cy: common.height as i64 * EMUS_PER_PIXEL,
        flip_h: common.flip_h,
        flip_v: common.flip_v,
        locks: DrawingLocking {
            no_change_aspect: true,
            no_move: common.locked,
            ..Default::default()
        },
        has_pic_locks: true,
        ..Default::default()
    };

    Some(DrawingObject::Picture(image_props))
}

pub(super) fn next_available_image_r_id(image_rels: &[(String, String)]) -> String {
    let mut candidate = 1;
    loop {
        let r_id = format!("rId{candidate}");
        if !image_rels.iter().any(|(existing, _)| existing == &r_id) {
            return r_id;
        }
        candidate += 1;
    }
}

pub(super) fn push_image_blob_if_data_url(
    image_blobs: &mut Vec<(String, Vec<u8>)>,
    image_path: &str,
    picture_src: &str,
) {
    let Some((_, decoded)) = parse_data_url(picture_src) else {
        return;
    };
    if image_blobs.iter().any(|(path, _)| path == image_path) {
        return;
    }
    image_blobs.push((image_path.to_string(), decoded));
}

/// Parse a `data:` URL into (file_extension, decoded_bytes).
///
/// Supports the format `data:<mime>;base64,<data>`.
/// Returns `None` if the URL is not a valid data-URL or decoding fails.
pub(super) fn parse_data_url(url: &str) -> Option<(String, Vec<u8>)> {
    let rest = url.strip_prefix("data:")?;
    let (mime_and_params, data) = rest.split_once(',')?;
    let mime = mime_and_params.strip_suffix(";base64")?;
    let ext = mime_to_extension(mime);
    let decoded = base64_decode(data).ok()?;
    if decoded.is_empty() {
        return None;
    }
    Some((ext.to_string(), decoded))
}

fn mime_to_extension(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpeg",
        "image/jfif" => "jfif",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/emf" | "image/x-emf" => "emf",
        "image/wmf" | "image/x-wmf" => "wmf",
        _ => "png",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_data_url_preserves_jfif_extension() {
        let (extension, bytes) = parse_data_url("data:image/jfif;base64,AQID").unwrap();

        assert_eq!(extension, "jfif");
        assert_eq!(bytes, vec![1, 2, 3]);
    }
}

/// Minimal base64 decoder (avoids external dependency).
/// Handles standard base64 alphabet (A-Z, a-z, 0-9, +, /) with = padding.
pub(super) fn base64_decode(input: &str) -> Result<Vec<u8>, ()> {
    let clean: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    if clean.is_empty() {
        return Ok(Vec::new());
    }

    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;

    for ch in clean.chars() {
        let val = match ch {
            'A'..='Z' => ch as u32 - b'A' as u32,
            'a'..='z' => ch as u32 - b'a' as u32 + 26,
            '0'..='9' => ch as u32 - b'0' as u32 + 52,
            '+' => 62,
            '/' => 63,
            '=' => break,
            _ => return Err(()),
        };
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }

    Ok(out)
}
