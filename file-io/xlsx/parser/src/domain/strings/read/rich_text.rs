use super::StringRef;
use super::decode::decode_xml_entities_full;
use super::scanner::{extract_attr_in_region, find_bytes, find_t_content, needs_xml_text_decode};
use crate::zip::constants::MAX_RICH_TEXT_RUNS_PER_STRING;
use domain_types::RichTextRun as DtRichTextRun;
use memchr::memmem;
use ooxml_types::styles::UnderlineStyle;

/// Extract and concatenate all <t> elements from rich text
fn extract_rich_text_content(xml: &[u8], si_start: usize, si_end: usize, dst: &mut Vec<u8>) {
    let mut pos = si_start;
    while let Some((content_start, content_end)) = find_t_content(xml, pos, si_end) {
        let content = &xml[content_start..content_end];
        decode_xml_entities_full(content, dst);
        pos = content_end + 4; // Skip past </t>
    }
}

/// Check whether a shared string entry at `index` is rich text (has `<r>` runs).
pub fn is_rich_text_entry(refs: &[StringRef], xml: &[u8], index: usize) -> bool {
    if let Some(r) = refs.get(index) {
        r.needs_decode && r.len > 0 && r.as_slice(xml).starts_with(b"<si")
    } else {
        false
    }
}

/// Parse rich text runs from a shared string entry.
/// Returns `None` for plain text entries, `Some(runs)` for rich text.
pub fn parse_rich_text_runs(
    refs: &[StringRef],
    xml: &[u8],
    index: usize,
) -> Option<Vec<DtRichTextRun>> {
    let r = refs.get(index)?;
    if !r.needs_decode || r.len == 0 {
        return None;
    }
    let slice = r.as_slice(xml);
    if !slice.starts_with(b"<si") {
        return None;
    }

    let si_start = r.start;
    let si_end = r.start + r.len;
    let mut runs = Vec::new();
    let mut pos = si_start;

    while pos < si_end {
        // Find next <r> or <r > element
        let r_start = match find_bytes(xml, b"<r", pos) {
            Some(p) if p < si_end => p,
            _ => break,
        };
        // Ensure this is <r> or <r > not <rPr> etc.
        let after_r = r_start + 2;
        if after_r >= xml.len() {
            break;
        }
        if xml[after_r] != b'>' && xml[after_r] != b' ' {
            pos = after_r;
            continue;
        }

        // Find </r>
        let r_end = match find_bytes(xml, b"</r>", r_start) {
            Some(p) if p < si_end => p,
            _ => break,
        };

        let mut run = DtRichTextRun::default();

        // Parse <rPr> if present
        if let Some(rpr_start) = find_bytes(xml, b"<rPr", r_start) {
            if rpr_start < r_end {
                if let Some(rpr_end) = find_bytes(xml, b"</rPr>", rpr_start) {
                    if rpr_end < r_end {
                        parse_rpr_into_run(xml, rpr_start, rpr_end, &mut run);
                    }
                }
            }
        }

        // Parse <t> content
        if let Some((t_start, t_end)) = find_t_content(xml, r_start, r_end) {
            let content = &xml[t_start..t_end];
            let mut buf = Vec::new();
            if needs_xml_text_decode(content) {
                decode_xml_entities_full(content, &mut buf);
                run.text = std::str::from_utf8(&buf)
                    .expect("decoded rich-text shared string is valid UTF-8")
                    .to_owned();
            } else {
                run.text = std::str::from_utf8(content)
                    .expect("rich-text shared string XML was validated as UTF-8")
                    .to_owned();
            }
            // Check xml:space="preserve"
            if let Some(t_tag_start) = find_bytes(xml, b"<t", r_start) {
                if t_tag_start < t_start {
                    let t_tag = &xml[t_tag_start..t_start];
                    if memmem::find(t_tag, b"preserve").is_some() {
                        run.preserve_space = true;
                    }
                }
            }
        }

        runs.push(run);
        if runs.len() > MAX_RICH_TEXT_RUNS_PER_STRING {
            return None;
        }
        pos = r_end + 4; // Skip past </r>
    }

    if runs.is_empty() { None } else { Some(runs) }
}

/// Parse `<rPr>` element attributes into a `DtRichTextRun`.
fn parse_rpr_into_run(xml: &[u8], rpr_start: usize, rpr_end: usize, run: &mut DtRichTextRun) {
    let region = &xml[rpr_start..rpr_end];

    // Boolean flags (empty elements like <b/> or <b val="1"/>)
    if let Some(value) = parse_bool_property(region, b"b") {
        run.bold = value;
    }
    if let Some(value) = parse_bool_property(region, b"i") {
        run.italic = value;
    }
    if let Some(style) = parse_underline_property(region) {
        run.underline_style = Some(style);
        run.underline = style != UnderlineStyle::None;
    }
    if let Some(value) = parse_bool_property(region, b"strike") {
        run.strikethrough = value;
    }
    run.outline = parse_bool_property(region, b"outline");
    run.shadow = parse_bool_property(region, b"shadow");
    run.condense = parse_bool_property(region, b"condense");
    run.extend = parse_bool_property(region, b"extend");

    // <sz val="10.5"/>
    if let Some(p) = memmem::find(region, b"<sz") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<f64>() {
                    run.font_size = Some(v);
                }
            }
        }
    }

    // <color rgb="FF000000"/> or <color indexed="81"/> or <color theme="1" tint="-0.5"/>
    if let Some(p) = memmem::find(region, b"<color") {
        if let Some(val) = extract_attr_in_region(region, p, b"rgb") {
            if let Ok(s) = std::str::from_utf8(val) {
                run.color = Some(s.to_string());
            }
        }
        if let Some(val) = extract_attr_in_region(region, p, b"indexed") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<u32>() {
                    run.color_indexed = Some(v);
                }
            }
        }
        if let Some(val) = extract_attr_in_region(region, p, b"theme") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<u32>() {
                    run.color_theme = Some(v);
                }
            }
        }
        if let Some(val) = extract_attr_in_region(region, p, b"tint") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<f64>() {
                    run.color_tint = Some(v);
                }
            }
        }
    }

    // <rFont val="Arial"/>
    if let Some(p) = memmem::find(region, b"<rFont") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                run.font_name = Some(s.to_string());
            }
        }
    }

    // <family val="2"/>
    if let Some(p) = memmem::find(region, b"<family") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<u32>() {
                    run.family = Some(v);
                }
            }
        }
    }

    // <charset val="128"/>
    if let Some(p) = memmem::find(region, b"<charset") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<u32>() {
                    run.charset = Some(v);
                }
            }
        }
    }

    // <scheme val="minor"/>
    if let Some(p) = memmem::find(region, b"<scheme") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                run.scheme = Some(s.to_string());
            }
        }
    }

    // <vertAlign val="superscript"/> or <vertAlign val="subscript"/>
    if let Some(p) = memmem::find(region, b"<vertAlign") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                run.vert_align = Some(s.to_string());
            }
        }
    }
}

fn find_property_tag(region: &[u8], tag: &[u8]) -> Option<usize> {
    let mut pos = 0;
    while let Some(rel) = memmem::find(&region[pos..], b"<") {
        let p = pos + rel;
        let name_start = p + 1;
        let name_end = name_start + tag.len();
        if name_end <= region.len()
            && &region[name_start..name_end] == tag
            && name_end < region.len()
            && matches!(region[name_end], b'/' | b'>' | b' ' | b'\t' | b'\n' | b'\r')
        {
            return Some(p);
        }
        pos = name_start;
    }
    None
}

fn parse_bool_property(region: &[u8], tag: &[u8]) -> Option<bool> {
    let p = find_property_tag(region, tag)?;
    Some(
        extract_attr_in_region(region, p, b"val")
            .map(|val| !is_false_token(val))
            .unwrap_or(true),
    )
}

fn is_false_token(value: &[u8]) -> bool {
    value == b"0" || value.eq_ignore_ascii_case(b"false")
}

fn parse_underline_property(region: &[u8]) -> Option<UnderlineStyle> {
    let p = find_property_tag(region, b"u")?;
    let Some(val) = extract_attr_in_region(region, p, b"val") else {
        return Some(UnderlineStyle::Single);
    };
    if is_false_token(val) {
        return Some(UnderlineStyle::None);
    }
    let token = std::str::from_utf8(val).ok()?;
    UnderlineStyle::from_ooxml_token(token)
}

/// Get a string by index from the shared string table
///
/// # Arguments
/// * `refs` - The vector of StringRef returned by parse_shared_strings_fast
/// * `xml` - The original XML buffer
/// * `index` - The string index to retrieve
/// * `buffer` - A reusable buffer for decoded strings
///
/// # Returns
/// A slice containing the decoded string
pub fn get_string<'a>(
    refs: &[StringRef],
    xml: &'a [u8],
    index: usize,
    buffer: &'a mut Vec<u8>,
) -> &'a [u8] {
    buffer.clear();

    if index >= refs.len() {
        return &[];
    }

    let string_ref = &refs[index];

    if string_ref.len == 0 {
        return &[];
    }

    // Check if this is a rich text reference (needs_decode + points to <si>)
    let slice = string_ref.as_slice(xml);
    if string_ref.needs_decode && slice.starts_with(b"<si") {
        // Rich text: extract and concatenate all <t> elements
        extract_rich_text_content(
            xml,
            string_ref.start,
            string_ref.start + string_ref.len,
            buffer,
        );
        return buffer;
    }

    if string_ref.needs_decode {
        // Simple string with entities
        decode_xml_entities_full(slice, buffer);
        buffer
    } else {
        // Zero-copy case: no decoding needed
        slice
    }
}
