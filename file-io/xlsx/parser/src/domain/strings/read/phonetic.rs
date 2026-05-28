use super::scanner::find_bytes;

/// Extract raw phonetic XML (`<rPh>...</rPh>` and `<phoneticPr .../>`) from an `<si>` element.
/// Returns `None` if no phonetic data is present.
pub(super) fn extract_phonetic_xml(si_bytes: &[u8]) -> Option<Vec<u8>> {
    // Look for <rPh or <phoneticPr within the <si> element
    let rph_pos = find_bytes(si_bytes, b"<rPh", 0);
    let pp_pos = find_bytes(si_bytes, b"<phoneticPr", 0);

    // If neither exists, no phonetic data
    if rph_pos.is_none() && pp_pos.is_none() {
        return None;
    }

    let mut result = Vec::new();

    // Extract all <rPh>...</rPh> elements
    let mut pos = 0;
    while let Some(start) = find_bytes(si_bytes, b"<rPh", pos) {
        // Ensure it's <rPh> or <rPh  not <rPhxxx
        let after = start + 4;
        if after < si_bytes.len() && (si_bytes[after] == b' ' || si_bytes[after] == b'>') {
            if let Some(end_tag) = find_bytes(si_bytes, b"</rPh>", start) {
                let end = end_tag + b"</rPh>".len();
                result.extend_from_slice(&si_bytes[start..end]);
                pos = end;
                continue;
            }
        }
        pos = after;
    }

    // Extract <phoneticPr .../> element
    if let Some(start) = pp_pos {
        // Find the closing > (it's self-closing)
        if let Some(gt) = si_bytes[start..].iter().position(|&b| b == b'>') {
            let end = start + gt + 1;
            result.extend_from_slice(&si_bytes[start..end]);
        }
    }

    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}
