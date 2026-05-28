use crate::infra::xml::parse_string_attr;
use crate::output::results::SmartArtPartsOutput;
use crate::roundtrip::namespaces::NamespaceMap;
use crate::roundtrip::unknown_elements::{
    PreservedElements, PreservedPosition, PreservedXml, extract_element_bounds,
};

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
    // We need the *stylesheet-level* <extLst>, which is the last one in the file.
    // Earlier <extLst> elements live inside <xf> entries and are parsed separately.
    use crate::infra::scanner::find_tag_simd;
    let end_tag = b"</extLst>";

    // Find the last </extLst> by scanning forward and keeping the last match
    let mut last_end = None;
    let mut search_pos = 0;
    while search_pos < xml.len() {
        match xml[search_pos..]
            .windows(end_tag.len())
            .position(|w| w == end_tag)
        {
            Some(p) => {
                last_end = Some(search_pos + p + end_tag.len());
                search_pos = search_pos + p + end_tag.len();
            }
            None => break,
        }
    }
    let end_pos = last_end?;

    // Now find the matching opening <extLst> by searching backwards from end_pos
    // for the last <extLst that starts before end_pos
    let mut last_start = None;
    let mut pos = 0;
    while let Some(s) = find_tag_simd(xml, b"extLst", pos) {
        if s >= end_pos {
            break;
        }
        last_start = Some(s);
        pos = s + 1;
    }
    let start = last_start?;

    Some(xml[start..end_pos].to_vec())
}

/// Extract the raw `<extLst>...</extLst>` element from the worksheet
/// post-sheetData region for verbatim round-trip passthrough.
///
/// This captures extension elements like `<x14:dataValidations>`,
/// `<x14:conditionalFormattings>`, etc. that live inside `<extLst>`.
/// Only captures the non-empty `<extLst>...</extLst>` (empty `<extLst/>`
/// is handled separately by `has_empty_ext_lst`).
pub(super) fn extract_worksheet_ext_lst_xml(post_sd: &[u8]) -> Option<String> {
    use crate::infra::scanner::find_tag_simd;

    // Find <extLst in the post-sheetData region (NOT <extLst/> which is empty)
    let tag_pos = find_tag_simd(post_sd, b"extLst", 0)?;

    // Check if it's self-closing (empty <extLst/>)
    let gt_pos = memchr::memchr(b'>', &post_sd[tag_pos..])?;
    if post_sd[tag_pos + gt_pos - 1] == b'/' {
        return None; // Self-closing — handled by has_empty_ext_lst
    }

    // Find the matching </extLst>
    let close_tag = b"</extLst>";
    let close_pos = memchr::memmem::find(&post_sd[tag_pos..], close_tag)?;
    let end = tag_pos + close_pos + close_tag.len();

    std::str::from_utf8(&post_sd[tag_pos..end])
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

/// Known child element tags for workbook.xml that we already parse.
/// Elements NOT in this list will be captured as preserved XML.
pub(super) const WORKBOOK_KNOWN_CHILDREN: &[&[u8]] = &[
    b"fileVersion",
    b"fileSharing",
    b"workbookPr",
    b"bookViews",
    b"sheets",
    b"definedNames",
    b"externalReferences",
    // Handled by the typed pivot package sidecar. Treating this as unknown
    // replays a raw <pivotCaches> block in addition to the typed one.
    b"pivotCaches",
    b"calcPr",
    b"workbookProtection",
    // fileRecoveryPr: not parsed/written — let preserved elements handle it
    b"webPublishing",
];

/// Check if a tag name (possibly namespaced) matches any known child.
pub(super) fn is_known_workbook_child(tag_name: &[u8]) -> bool {
    // Extract local name (after colon if present)
    let local = if let Some(colon_pos) = memchr::memchr(b':', tag_name) {
        &tag_name[colon_pos + 1..]
    } else {
        tag_name
    };
    WORKBOOK_KNOWN_CHILDREN.contains(&local)
}

/// Capture preserved (unknown) child elements from workbook.xml.
///
/// Scans the XML for direct children of `<workbook>` that are not in
/// `WORKBOOK_KNOWN_CHILDREN`. Captures them as `PreservedXml` entries with
/// position hints relative to known siblings.
pub(super) fn capture_workbook_preserved_elements(xml: &[u8]) -> PreservedElements {
    let mut preserved = PreservedElements::new();

    // Find the end of the <workbook ...> start tag
    let root_tag = match extract_root_start_tag(xml) {
        Some(tag) => tag,
        None => return preserved,
    };
    let content_start = (root_tag.as_ptr() as usize - xml.as_ptr() as usize) + root_tag.len();

    // Find </workbook> closing tag
    let content_end = memchr::memmem::find(xml, b"</workbook>").unwrap_or(xml.len());

    let content = &xml[content_start..content_end];
    let mut pos = 0;
    let mut last_known_tag: Option<String> = None;

    while pos < content.len() {
        // Find next '<'
        let lt_pos = match memchr::memchr(b'<', &content[pos..]) {
            Some(p) => pos + p,
            None => break,
        };

        // Skip closing tags, comments, processing instructions
        if lt_pos + 1 >= content.len() {
            break;
        }
        let next_byte = content[lt_pos + 1];
        if next_byte == b'/' || next_byte == b'!' || next_byte == b'?' {
            // Skip past this tag
            if let Some(gt) = memchr::memchr(b'>', &content[lt_pos..]) {
                pos = lt_pos + gt + 1;
            } else {
                break;
            }
            continue;
        }

        // Extract tag name
        let tag_start = lt_pos + 1;
        let mut tag_end = tag_start;
        while tag_end < content.len() {
            let b = content[tag_end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                break;
            }
            tag_end += 1;
        }
        let tag_name = &content[tag_start..tag_end];

        if is_known_workbook_child(tag_name) {
            // Track known elements for position hints
            last_known_tag = Some(
                std::str::from_utf8(tag_name)
                    .expect("workbook XML tag names were validated as UTF-8")
                    .to_owned(),
            );

            // Skip past this element
            let abs_start = content_start + lt_pos;
            if let Some((_, end)) = extract_element_bounds(xml, abs_start) {
                pos = end - content_start;
            } else {
                // Self-closing or can't find end — skip past the `>`
                if let Some(gt) = memchr::memchr(b'>', &content[lt_pos..]) {
                    pos = lt_pos + gt + 1;
                } else {
                    break;
                }
            }
        } else {
            // Unknown element — capture it
            let abs_start = content_start + lt_pos;
            if let Some((_, end)) = extract_element_bounds(xml, abs_start) {
                if let Ok(raw_xml) = std::str::from_utf8(&xml[abs_start..end]) {
                    let position = match &last_known_tag {
                        Some(tag) => PreservedPosition::AfterElement(tag.clone()),
                        None => PreservedPosition::First,
                    };
                    preserved.add(PreservedXml::new("workbook", raw_xml.to_string(), position));
                }
                pos = end - content_start;
            } else {
                // Can't parse — skip
                if let Some(gt) = memchr::memchr(b'>', &content[lt_pos..]) {
                    pos = lt_pos + gt + 1;
                } else {
                    break;
                }
            }
        }
    }

    preserved
}

/// Known child element tags for worksheet XML that we already parse (in pre_sd region).
/// These appear between <worksheet> and <sheetData>.
pub(super) const SHEET_KNOWN_PRE_SD: &[&[u8]] = &[
    b"dimension",
    b"sheetViews",
    b"sheetFormatPr",
    b"cols",
    b"sheetData",
];

/// Known child element tags for worksheet XML that we already parse (in post_sd region).
/// These appear after </sheetData>.
pub(super) const SHEET_KNOWN_POST_SD: &[&[u8]] = &[
    b"mergeCells",
    b"conditionalFormatting",
    b"dataValidations",
    b"hyperlinks",
    b"autoFilter",
    b"sortState",
    // sheetProtection — intentionally NOT listed so it's captured by PreservedElements
    // and written back via the Tier 2 preservation system.
    b"printOptions",
    b"pageMargins",
    b"pageSetup",
    b"headerFooter",
    b"rowBreaks",
    b"colBreaks",
    b"drawing",
    b"legacyDrawing",
    b"legacyDrawingHF", // Written explicitly by SheetWriter from RoundTripContext
    // tableParts — intentionally NOT listed so it's captured by PreservedElements
    // and written back via the Tier 2 preservation system.
    b"picture",
    b"oleObjects",
    b"controls",
    // b"extLst" — intentionally NOT listed so it's captured by PreservedElements
    // and written back via the Tier 2 preservation system at Position::Last.
    // For L2 (Yrs path), ext_lst_xml on SheetRoundTripContext handles it.
    // phoneticPr, ignoredErrors, sheetCalcPr, protectedRanges, scenarios,
    // customSheetViews: not parsed/written — let preserved elements handle them
];

/// Check if a tag name matches any in a known-children list.
pub(super) fn is_known_child(tag_name: &[u8], known_list: &[&[u8]]) -> bool {
    let local = if let Some(colon_pos) = memchr::memchr(b':', tag_name) {
        &tag_name[colon_pos + 1..]
    } else {
        tag_name
    };
    known_list.contains(&local)
}

/// Capture preserved elements from a region of worksheet XML.
///
/// Scans the given XML slice for child elements not in `known_children`.
/// Returns them as `PreservedXml` entries under the given `parent_path`.
pub(super) fn capture_preserved_in_region(
    xml: &[u8],
    region_start_in_xml: usize,
    region: &[u8],
    parent_path: &str,
    known_children: &[&[u8]],
) -> Vec<PreservedXml> {
    capture_preserved_in_region_with_anchor(
        xml,
        region_start_in_xml,
        region,
        parent_path,
        known_children,
        None,
    )
}

/// Like `capture_preserved_in_region` but accepts an initial anchor tag so that
/// unknown elements appearing before any known sibling get
/// `AfterElement(anchor)` instead of `First`.  This is critical for the
/// post-sheetData region where unknown elements should stay after sheetData,
/// not jump to the top of the worksheet.
pub(super) fn capture_preserved_in_region_with_anchor(
    xml: &[u8],
    region_start_in_xml: usize,
    region: &[u8],
    parent_path: &str,
    known_children: &[&[u8]],
    initial_anchor: Option<&str>,
) -> Vec<PreservedXml> {
    let mut result = Vec::new();
    let mut pos = 0;
    let mut last_known_tag: Option<String> = initial_anchor.map(|s| s.to_string());

    while pos < region.len() {
        let lt_pos = match memchr::memchr(b'<', &region[pos..]) {
            Some(p) => pos + p,
            None => break,
        };

        if lt_pos + 1 >= region.len() {
            break;
        }
        let next_byte = region[lt_pos + 1];
        if next_byte == b'/' || next_byte == b'!' || next_byte == b'?' {
            if let Some(gt) = memchr::memchr(b'>', &region[lt_pos..]) {
                pos = lt_pos + gt + 1;
            } else {
                break;
            }
            continue;
        }

        // Extract tag name
        let tag_start = lt_pos + 1;
        let mut tag_end = tag_start;
        while tag_end < region.len() {
            let b = region[tag_end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                break;
            }
            tag_end += 1;
        }
        let tag_name = &region[tag_start..tag_end];

        if is_known_child(tag_name, known_children) {
            last_known_tag = Some(
                std::str::from_utf8(tag_name)
                    .expect("worksheet XML tag names were validated as UTF-8")
                    .to_owned(),
            );
            let abs_start = region_start_in_xml + lt_pos;
            if let Some((_, end)) = extract_element_bounds(xml, abs_start) {
                pos = end - region_start_in_xml;
            } else if let Some(gt) = memchr::memchr(b'>', &region[lt_pos..]) {
                pos = lt_pos + gt + 1;
            } else {
                break;
            }
        } else {
            let abs_start = region_start_in_xml + lt_pos;
            if let Some((_, end)) = extract_element_bounds(xml, abs_start) {
                if let Ok(raw_xml) = std::str::from_utf8(&xml[abs_start..end]) {
                    let position = match &last_known_tag {
                        Some(tag) => PreservedPosition::AfterElement(tag.clone()),
                        None => PreservedPosition::First,
                    };
                    result.push(PreservedXml::new(
                        parent_path,
                        raw_xml.to_string(),
                        position,
                    ));
                }
                pos = end - region_start_in_xml;
            } else if let Some(gt) = memchr::memchr(b'>', &region[lt_pos..]) {
                pos = lt_pos + gt + 1;
            } else {
                break;
            }
        }
    }

    result
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

/// Capture preserved elements from a worksheet's pre-sheetData and post-sheetData regions.
pub(super) fn capture_sheet_preserved_elements(
    worksheet_xml: &[u8],
    pre_sd: &[u8],
    post_sd: &[u8],
) -> PreservedElements {
    let mut preserved = PreservedElements::new();

    // Calculate the offset of pre_sd within worksheet_xml
    // pre_sd starts after the root tag; find where the root tag content begins
    if let Some(root_tag) = extract_root_start_tag(worksheet_xml) {
        let content_start =
            (root_tag.as_ptr() as usize - worksheet_xml.as_ptr() as usize) + root_tag.len();
        let pre_sd_content_end = pre_sd.len(); // pre_sd goes from start of xml up to <sheetData

        // The region we want to scan is from root tag end to <sheetData
        if content_start < pre_sd_content_end {
            let pre_region = &worksheet_xml[content_start..pre_sd_content_end];
            let elements = capture_preserved_in_region(
                worksheet_xml,
                content_start,
                pre_region,
                "worksheet",
                SHEET_KNOWN_PRE_SD,
            );
            for elem in elements {
                preserved.add(elem);
            }
        }
    }

    // Post-sheetData region
    let post_sd_offset = post_sd.as_ptr() as usize - worksheet_xml.as_ptr() as usize;
    // Find </worksheet> to bound the region
    let post_end = memchr::memmem::find(post_sd, b"</worksheet>").unwrap_or(post_sd.len());
    let post_region = &post_sd[..post_end];

    let elements = capture_preserved_in_region_with_anchor(
        worksheet_xml,
        post_sd_offset,
        post_region,
        "worksheet",
        SHEET_KNOWN_POST_SD,
        Some("sheetData"),
    );
    for elem in elements {
        preserved.add(elem);
    }

    preserved
}
