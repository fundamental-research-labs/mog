use crate::infra::xml::parse_string_attr;
use crate::infra::xml_fragment::extract_element_bounds;
use crate::infra::xml_namespaces::NamespaceMap;
use crate::output::results::SmartArtPartsOutput;

// =============================================================================
// SmartArt Conversion Helper
// =============================================================================

/// Convert parser-internal `SmartArtParts` to the WASM-serializable `SmartArtPartsOutput`.
pub(super) fn convert_smartart_parts(
    parts: Vec<crate::domain::drawings::SmartArtParts>,
) -> Vec<SmartArtPartsOutput> {
    parts
        .into_iter()
        .map(|p| SmartArtPartsOutput {
            anchor_index: p.anchor_index,
            data_xml: p.data_xml,
            layout_xml: p.layout_xml,
            colors_xml: p.colors_xml,
            style_xml: p.style_xml,
            drawing_xml: p.drawing_xml,
        })
        .collect()
}

// =============================================================================
// Shared XML helper (used by doc_props and metadata sub-modules)
// =============================================================================

/// Extract an attribute value from an XML opening tag string.
/// E.g., `extract_attr_value(r#"<property fmtid="abc" pid="2""#, "pid")` returns `Some("2")`.
pub(crate) fn extract_attr_value(tag: &str, attr_name: &str) -> Option<String> {
    // Match both attr="value" and attr='value'
    let patterns = [format!("{}=\"", attr_name), format!("{}='", attr_name)];
    for pat in &patterns {
        if let Some(start) = tag.find(pat.as_str()) {
            let val_start = start + pat.len();
            let delim = pat.as_bytes()[pat.len() - 1] as char;
            if let Some(val_end) = tag[val_start..].find(delim) {
                return Some(tag[val_start..val_start + val_end].to_string());
            }
        }
    }
    None
}

// =============================================================================
// Extension Namespace Capture Helpers (Tier 2)
// =============================================================================

/// Extract the root element's start tag bytes from an XML document.
///
/// Finds the first `<tag ...>` after the XML declaration (skipping `<?xml ...?>`),
/// and returns the byte slice from `<` to `>` inclusive.
pub(super) fn extract_root_start_tag(xml: &[u8]) -> Option<&[u8]> {
    let mut pos = 0;

    // Skip XML declaration `<?xml ...?>`
    if xml.len() > 4 && &xml[0..2] == b"<?" {
        if let Some(end) = memchr::memmem::find(xml, b"?>") {
            pos = end + 2;
        }
    }

    // Skip whitespace
    while pos < xml.len() && xml[pos].is_ascii_whitespace() {
        pos += 1;
    }

    // Find the opening `<`
    if pos >= xml.len() || xml[pos] != b'<' {
        return None;
    }

    let start = pos;

    // Find the closing `>` of the start tag (handling attributes)
    // We need to be careful about `>` inside attribute values
    let mut in_quote = false;
    let mut quote_char = b'"';
    pos += 1;
    while pos < xml.len() {
        let b = xml[pos];
        if in_quote {
            if b == quote_char {
                in_quote = false;
            }
        } else if b == b'"' || b == b'\'' {
            in_quote = true;
            quote_char = b;
        } else if b == b'>' {
            return Some(&xml[start..=pos]);
        }
        pos += 1;
    }

    None
}

/// Capture namespace declarations from an XML root element.
///
/// Extracts the start tag of the root element and calls
/// `NamespaceMap::capture_from_element()` on it.
pub(super) fn capture_namespaces_from_xml(xml: &[u8]) -> NamespaceMap {
    let mut ns = NamespaceMap::new();
    if let Some(root_tag) = extract_root_start_tag(xml) {
        ns.capture_from_element(root_tag);
    }
    ns
}

/// Capture the `<extLst>...</extLst>` block from XML as raw bytes for round-trip fidelity.
pub(super) fn capture_ext_lst_raw(xml: &[u8]) -> Option<Vec<u8>> {
    use crate::infra::scanner::{find_gt_simd, find_lt_simd, find_tag_simd};

    let root_start = find_tag_simd(xml, b"styleSheet", 0)?;
    let (_, root_end) = extract_element_bounds(xml, root_start)?;
    let root_open_end = find_gt_simd(xml, root_start)? + 1;
    let root_content = &xml[root_open_end..root_end];

    let mut pos = 0;
    while let Some(start) = find_lt_simd(root_content, pos) {
        let name_start = start + 1;
        if name_start >= root_content.len() {
            return None;
        }

        if matches!(root_content[name_start], b'/' | b'!' | b'?') {
            pos = find_gt_simd(root_content, name_start).map_or(root_content.len(), |p| p + 1);
            continue;
        }

        let mut name_end = name_start;
        while name_end < root_content.len()
            && !matches!(
                root_content[name_end],
                b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/'
            )
        {
            name_end += 1;
        }

        let name = &root_content[name_start..name_end];
        let local_name = name
            .iter()
            .position(|&b| b == b':')
            .map(|i| &name[i + 1..])
            .unwrap_or(name);

        let (_, end) = extract_element_bounds(root_content, start)?;
        if local_name == b"extLst" {
            return Some(root_content[start..end].to_vec());
        }
        pos = end;
    }

    None
}

/// Extract the raw `<extLst>...</extLst>` element from the worksheet
/// post-sheetData region for verbatim round-trip passthrough.
///
/// This captures extension elements like `<x14:dataValidations>`,
/// `<x14:conditionalFormattings>`, etc. that live inside `<extLst>`.
/// Captures both non-empty `<extLst>...</extLst>` and self-closing
/// `<extLst/>` root worksheet children.
pub(super) fn extract_worksheet_ext_lst_xml(post_sd: &[u8]) -> Option<String> {
    use crate::infra::scanner::find_tag_simd;

    // Find <extLst in the post-sheetData region.
    let tag_pos = find_tag_simd(post_sd, b"extLst", 0)?;

    if let Some((_, end)) = extract_element_bounds(post_sd, tag_pos) {
        return std::str::from_utf8(&post_sd[tag_pos..end])
            .ok()
            .map(|s| s.to_string());
    }

    let gt_pos = memchr::memchr(b'>', &post_sd[tag_pos..])?;
    std::str::from_utf8(&post_sd[tag_pos..tag_pos + gt_pos + 1])
        .ok()
        .map(|s| s.to_string())
}

pub(super) fn extract_raw_element_xml(xml: &[u8], tag: &[u8]) -> Option<String> {
    let start = crate::infra::scanner::find_tag_simd(xml, tag, 0)?;
    let (_, end) = extract_element_bounds(xml, start)?;
    std::str::from_utf8(&xml[start..end])
        .ok()
        .map(str::to_string)
}

pub(super) fn extract_worksheet_controls_xml(xml: &[u8]) -> Option<String> {
    let controls_start = crate::infra::scanner::find_tag_simd(xml, b"controls", 0)?;

    if let Some(ac_start) = find_enclosing_alternate_content_start(xml, controls_start)
        && let Some(ac_end) = find_matching_alternate_content_end(xml, ac_start)
    {
        return std::str::from_utf8(&xml[ac_start..ac_end])
            .ok()
            .map(str::to_string);
    }

    let (_, end) = extract_element_bounds(xml, controls_start)?;
    std::str::from_utf8(&xml[controls_start..end])
        .ok()
        .map(str::to_string)
}

pub(super) fn extract_explicit_blank_cells(xml: &[u8]) -> Vec<(u32, u32)> {
    let mut cells = Vec::new();
    let mut pos = 0usize;

    while let Some(rel) = memchr::memmem::find(&xml[pos..], b"<c") {
        let start = pos + rel;
        let Some(&next) = xml.get(start + 2) else {
            break;
        };
        if !matches!(next, b' ' | b'>' | b'/') {
            pos = start + 2;
            continue;
        }

        let Some(gt_rel) = memchr::memchr(b'>', &xml[start..]) else {
            break;
        };
        let tag_end = start + gt_rel + 1;
        let tag = &xml[start..tag_end];
        pos = tag_end;

        if has_attr(tag, b"s")
            || has_attr(tag, b"t")
            || has_attr(tag, b"cm")
            || has_attr(tag, b"vm")
            || has_attr(tag, b"ph")
        {
            continue;
        }

        let is_empty = tag
            .iter()
            .rev()
            .find(|&&b| !b.is_ascii_whitespace() && b != b'>')
            == Some(&b'/')
            || xml[tag_end..]
                .iter()
                .copied()
                .skip_while(u8::is_ascii_whitespace)
                .take(b"</c>".len())
                .eq(b"</c>".iter().copied());
        if !is_empty {
            continue;
        }

        if let Some(cell_ref) = attr_value(tag, b"r")
            && let Ok(cell_ref) = std::str::from_utf8(cell_ref)
            && let Some((row, col)) = crate::infra::a1::parse_a1_cell(cell_ref)
        {
            cells.push((row, col));
        }
    }

    cells.sort_unstable();
    cells.dedup();
    cells
}

#[cfg(test)]
mod tests {
    use super::capture_ext_lst_raw;

    #[test]
    fn stylesheet_ext_capture_ignores_nested_extensions() {
        let xml = br#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <cellXfs count="1"><xf><extLst><ext uri="xf"/></extLst></xf></cellXfs>
            <cellStyles count="1"><cellStyle name="Normal" xfId="0"><extLst><ext uri="style"/></extLst></cellStyle></cellStyles>
            <dxfs count="1"><dxf><extLst><ext uri="dxf"/></extLst></dxf></dxfs>
        </styleSheet>"#;

        assert_eq!(capture_ext_lst_raw(xml), None);
    }

    #[test]
    fn stylesheet_ext_capture_returns_direct_root_child_only() {
        let xml =
            br#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <cellXfs count="1"><xf><extLst><ext uri="xf"/></extLst></xf></cellXfs>
            <x:extLst xmlns:x="urn:test"><x:ext uri="root"/></x:extLst>
        </styleSheet>"#;

        assert_eq!(
            capture_ext_lst_raw(xml).as_deref(),
            Some(br#"<x:extLst xmlns:x="urn:test"><x:ext uri="root"/></x:extLst>"#.as_slice())
        );
    }
}

pub(super) fn has_attr(tag: &[u8], name: &[u8]) -> bool {
    attr_value(tag, name).is_some()
}

pub(super) fn attr_value<'a>(tag: &'a [u8], name: &[u8]) -> Option<&'a [u8]> {
    let mut pos = 1usize;
    while pos < tag.len() {
        while pos < tag.len() && tag[pos].is_ascii_whitespace() {
            pos += 1;
        }
        let name_start = pos;
        while pos < tag.len()
            && !tag[pos].is_ascii_whitespace()
            && !matches!(tag[pos], b'=' | b'/' | b'>')
        {
            pos += 1;
        }
        if pos == name_start {
            pos += 1;
            continue;
        }
        let candidate = &tag[name_start..pos];
        while pos < tag.len() && tag[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if tag.get(pos) != Some(&b'=') {
            continue;
        }
        pos += 1;
        while pos < tag.len() && tag[pos].is_ascii_whitespace() {
            pos += 1;
        }
        let quote = *tag.get(pos)?;
        if quote != b'"' && quote != b'\'' {
            continue;
        }
        pos += 1;
        let value_start = pos;
        while pos < tag.len() && tag[pos] != quote {
            pos += 1;
        }
        let value = &tag[value_start..pos];
        pos += 1;
        if candidate == name {
            return Some(value);
        }
    }
    None
}

pub(super) fn find_enclosing_alternate_content_start(xml: &[u8], before: usize) -> Option<usize> {
    let mut pos = 0;
    let mut last = None;
    while let Some(rel) = memchr::memmem::find(&xml[pos..before], b"<mc:AlternateContent") {
        last = Some(pos + rel);
        pos += rel + 1;
    }
    last
}

pub(super) fn find_matching_alternate_content_end(xml: &[u8], start: usize) -> Option<usize> {
    let mut pos = start;
    let mut depth = 0usize;
    loop {
        let next_open = memchr::memmem::find(&xml[pos..], b"<mc:AlternateContent").map(|p| pos + p);
        let next_close =
            memchr::memmem::find(&xml[pos..], b"</mc:AlternateContent>").map(|p| pos + p);
        match (next_open, next_close) {
            (Some(open), Some(close)) if open < close => {
                depth += 1;
                pos = open + b"<mc:AlternateContent".len();
            }
            (_, Some(close)) => {
                if depth == 0 {
                    return None;
                }
                depth -= 1;
                let end = close + b"</mc:AlternateContent>".len();
                if depth == 0 {
                    return Some(end);
                }
                pos = end;
            }
            _ => return None,
        }
    }
}

/// Find the post-sheetData region in worksheet XML.
///
/// Returns a subslice of `xml` beginning immediately after the end of the
/// `<sheetData>` element:
/// - After `</sheetData>` for normal sheets with rows
/// - After `<sheetData/>` for empty sheets (self-closing form)
///
/// Falls back to an empty slice at end-of-file so that callers never receive
/// the full document as the "post" region, which would cause the root
/// `<worksheet>` opening tag to be mistakenly captured as a preserved child.
pub(super) fn find_post_sheet_data_region(xml: &[u8]) -> &[u8] {
    // Normal case: explicit </sheetData> closing tag
    if let Some(p) = memchr::memmem::find(xml, b"</sheetData>") {
        return &xml[p + b"</sheetData>".len()..];
    }
    // Self-closing <sheetData/> — find it and skip past the `>`
    if let Some(p) = memchr::memmem::find(xml, b"<sheetData") {
        if let Some(gt_offset) = memchr::memchr(b'>', &xml[p..]) {
            return &xml[p + gt_offset + 1..];
        }
    }
    // Fallback: no sheetData found — return empty slice at end of file
    &xml[xml.len()..]
}

pub(super) fn parse_external_reference_rids(workbook_xml: &[u8]) -> Vec<String> {
    let Some(start) = memchr::memmem::find(workbook_xml, b"<externalReferences") else {
        return Vec::new();
    };
    let end = memchr::memmem::find(&workbook_xml[start..], b"</externalReferences>")
        .map(|offset| start + offset)
        .unwrap_or(workbook_xml.len());
    let region = &workbook_xml[start..end];
    let mut rids = Vec::new();
    let mut pos = 0;
    while let Some(rel_start) = memchr::memmem::find(&region[pos..], b"<externalReference") {
        let abs_start = pos + rel_start;
        let Some(gt) = memchr::memchr(b'>', &region[abs_start..]) else {
            break;
        };
        let element = &region[abs_start..abs_start + gt + 1];
        if let Some(rid) = parse_string_attr(element, b"r:id=\"") {
            rids.push(rid);
        }
        pos = abs_start + gt + 1;
    }
    rids
}

pub(super) fn external_link_zip_path(part_name: &str) -> String {
    let trimmed = part_name.trim_start_matches('/');
    if trimmed.starts_with("xl/") {
        trimmed.to_string()
    } else {
        format!("xl/{}", trimmed)
    }
}

pub(super) fn external_link_rels_path(zip_path: &str) -> String {
    let file_name = zip_path.rsplit('/').next().unwrap_or(zip_path);
    format!("xl/externalLinks/_rels/{}.rels", file_name)
}
