//! Parsing helpers for `docProps/core.xml`, `docProps/app.xml`, and `docProps/custom.xml`.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices XML
//! tag / attribute content at byte offsets produced by ASCII-only XML
//! syntax (`<`, `>`, `/`, `"`, `=`, `:`, whitespace). Char-boundary
//! by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use ooxml_types::doc_props::{
    CoreProperties as DocPropsCore, CustomProperties as DocPropsCustom, CustomProperty,
    CustomPropertyValue, ExtendedProperties as DocPropsApp, HeadingPair,
};

use crate::pipeline::full_parse::extract_attr_value;

// =============================================================================
// docProps parsing helpers
// =============================================================================

/// Extract text content between `<tag...>` and `</tag>` from XML bytes.
/// The open_tag is a prefix (e.g. `<dc:creator`) so it matches tags with attributes.
///
/// Returns `Some("")` when the tag is present but has empty content (e.g. `<dc:title></dc:title>`),
/// and `None` when the tag is absent entirely. This preserves round-trip fidelity for
/// fields that exist in the original XML but carry no value.
fn extract_xml_text(xml: &[u8], open_tag: &str, close_tag: &str) -> Option<String> {
    let xml_str = std::str::from_utf8(xml).ok()?;
    let start = xml_str.find(open_tag)?;
    let after_tag = &xml_str[start..];
    let gt_offset = after_tag.find('>')?;
    // Check for self-closing tag like <Manager/>
    if gt_offset > 0 && after_tag.as_bytes()[gt_offset - 1] == b'/' {
        return Some(String::new());
    }
    let content_start = start + gt_offset + 1;
    let content_end = xml_str[content_start..].find(close_tag)? + content_start;
    let text = &xml_str[content_start..content_end];
    if text.is_empty() {
        Some(String::new())
    } else {
        Some(crate::infra::xml::decode_xml_entities(text.as_bytes()))
    }
}

/// Parse a boolean text value ("true"/"1" → true, anything else → false).
fn parse_bool_text(xml: &[u8], open_tag: &str, close_tag: &str) -> Option<bool> {
    extract_xml_text(xml, open_tag, close_tag).map(|s| s == "true" || s == "1")
}

/// Parse `docProps/core.xml` into a `DocPropsCore`.
pub(crate) fn parse_doc_props_core(xml: &[u8]) -> DocPropsCore {
    DocPropsCore {
        creator: extract_xml_text(xml, "<dc:creator", "</dc:creator>"),
        last_modified_by: extract_xml_text(xml, "<cp:lastModifiedBy", "</cp:lastModifiedBy>"),
        created: extract_xml_text(xml, "<dcterms:created", "</dcterms:created>"),
        modified: extract_xml_text(xml, "<dcterms:modified", "</dcterms:modified>"),
        title: extract_xml_text(xml, "<dc:title", "</dc:title>"),
        subject: extract_xml_text(xml, "<dc:subject", "</dc:subject>"),
        description: extract_xml_text(xml, "<dc:description", "</dc:description>"),
        keywords: extract_xml_text(xml, "<cp:keywords", "</cp:keywords>"),
        category: extract_xml_text(xml, "<cp:category", "</cp:category>"),
        last_printed: extract_xml_text(xml, "<cp:lastPrinted", "</cp:lastPrinted>"),
        identifier: extract_xml_text(xml, "<dc:identifier", "</dc:identifier>"),
        language: extract_xml_text(xml, "<dc:language", "</dc:language>"),
        content_status: extract_xml_text(xml, "<cp:contentStatus", "</cp:contentStatus>"),
        content_type: extract_xml_text(xml, "<cp:contentType", "</cp:contentType>"),
        revision: extract_xml_text(xml, "<cp:revision", "</cp:revision>"),
        version: extract_xml_text(xml, "<cp:version", "</cp:version>"),
    }
}

/// Parse `docProps/app.xml` into a `DocPropsApp`.
pub(crate) fn parse_doc_props_app(xml: &[u8]) -> DocPropsApp {
    let total_time = extract_xml_text(xml, "<TotalTime", "</TotalTime>");
    let application = extract_xml_text(xml, "<Application", "</Application>");
    let app_version = extract_xml_text(xml, "<AppVersion", "</AppVersion>");
    let doc_security =
        extract_xml_text(xml, "<DocSecurity", "</DocSecurity>").and_then(|s| s.parse::<u32>().ok());
    let company = extract_xml_text(xml, "<Company", "</Company>");
    let manager = extract_xml_text(xml, "<Manager", "</Manager>");
    let template = extract_xml_text(xml, "<Template", "</Template>");
    let hyperlink_base = extract_xml_text(xml, "<HyperlinkBase", "</HyperlinkBase>");
    let scale_crop = parse_bool_text(xml, "<ScaleCrop", "</ScaleCrop>");
    let links_up_to_date = parse_bool_text(xml, "<LinksUpToDate", "</LinksUpToDate>");
    let shared_doc = parse_bool_text(xml, "<SharedDoc", "</SharedDoc>");
    let hyperlinks_changed = parse_bool_text(xml, "<HyperlinksChanged", "</HyperlinksChanged>");

    // Parse HeadingPairs → alternating name/count pairs
    let heading_pairs = parse_heading_pairs(xml);

    // Parse TitlesOfParts → extract <vt:lpstr>...</vt:lpstr> entries
    let mut titles_of_parts = Vec::new();
    if let Ok(xml_str) = std::str::from_utf8(xml) {
        if let Some(titles_start) = xml_str.find("<TitlesOfParts>") {
            if let Some(titles_end) = xml_str[titles_start..].find("</TitlesOfParts>") {
                let section = &xml_str[titles_start..titles_start + titles_end];
                let mut pos = 0;
                while let Some(start) = section[pos..].find("<vt:lpstr>") {
                    let text_start = pos + start + "<vt:lpstr>".len();
                    if let Some(end) = section[text_start..].find("</vt:lpstr>") {
                        let name = &section[text_start..text_start + end];
                        titles_of_parts.push(crate::infra::xml::decode_xml_entities_string(name));
                        pos = text_start + end;
                    } else {
                        break;
                    }
                }
            }
        }
    }

    DocPropsApp {
        total_time,
        application,
        app_version,
        doc_security,
        company,
        manager,
        template,
        hyperlink_base,
        scale_crop,
        links_up_to_date,
        shared_doc,
        hyperlinks_changed,
        heading_pairs,
        titles_of_parts,
    }
}

/// Parse `<HeadingPairs>` into a `Vec<HeadingPair>`.
///
/// The XML structure is a vector of alternating variant pairs:
/// ```xml
/// <HeadingPairs>
///   <vt:vector size="4" baseType="variant">
///     <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
///     <vt:variant><vt:i4>5</vt:i4></vt:variant>
///     ...
///   </vt:vector>
/// </HeadingPairs>
/// ```
fn parse_heading_pairs(xml: &[u8]) -> Vec<HeadingPair> {
    let xml_str = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let section_start = match xml_str.find("<HeadingPairs>") {
        Some(s) => s,
        None => return Vec::new(),
    };
    let section_end = match xml_str[section_start..].find("</HeadingPairs>") {
        Some(e) => section_start + e,
        None => return Vec::new(),
    };
    let section = &xml_str[section_start..section_end];

    // Extract all <vt:variant>...</vt:variant> blocks
    let mut variants = Vec::new();
    let mut pos = 0;
    while let Some(start) = section[pos..].find("<vt:variant>") {
        let abs_start = pos + start + "<vt:variant>".len();
        if let Some(end) = section[abs_start..].find("</vt:variant>") {
            variants.push(&section[abs_start..abs_start + end]);
            pos = abs_start + end + "</vt:variant>".len();
        } else {
            break;
        }
    }

    // Process alternating name/count pairs
    let mut pairs = Vec::new();
    let mut i = 0;
    while i + 1 < variants.len() {
        let name_block = variants[i];
        let count_block = variants[i + 1];

        // Extract name from <vt:lpstr>...</vt:lpstr>
        let name = extract_variant_lpstr(name_block);
        // Extract count from <vt:i4>...</vt:i4>
        let count = extract_variant_i4(count_block);

        if let (Some(name), Some(count)) = (name, count) {
            pairs.push(HeadingPair { name, count });
        }
        i += 2;
    }

    pairs
}

fn extract_variant_lpstr(block: &str) -> Option<String> {
    let start = block.find("<vt:lpstr>")?;
    let text_start = start + "<vt:lpstr>".len();
    let end = block[text_start..].find("</vt:lpstr>")?;
    let text = &block[text_start..text_start + end];
    if text.is_empty() {
        None
    } else {
        Some(crate::infra::xml::decode_xml_entities_string(text))
    }
}

fn extract_variant_i4(block: &str) -> Option<u32> {
    let start = block.find("<vt:i4>")?;
    let text_start = start + "<vt:i4>".len();
    let end = block[text_start..].find("</vt:i4>")?;
    block[text_start..text_start + end].parse::<u32>().ok()
}

/// Parse `docProps/custom.xml` into a `DocPropsCustom`.
pub(crate) fn parse_doc_props_custom(xml: &[u8]) -> DocPropsCustom {
    let xml_str = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return DocPropsCustom::default(),
    };

    let mut properties = Vec::new();
    let mut pos = 0;

    while let Some(prop_start) = xml_str[pos..].find("<property ") {
        let abs_start = pos + prop_start;

        // Find end of opening tag or self-closing
        let tag_region = &xml_str[abs_start..];

        // Find closing </property>
        let prop_end = match tag_region.find("</property>") {
            Some(e) => e,
            None => break,
        };
        let prop_xml = &tag_region[..prop_end + "</property>".len()];

        // Extract attributes from the <property ...> opening tag
        let open_end = match prop_xml.find('>') {
            Some(e) => e,
            None => {
                pos = abs_start + 1;
                continue;
            }
        };
        let open_tag = &prop_xml[..open_end];

        let fmtid = extract_attr_value(open_tag, "fmtid").unwrap_or_default();
        let pid = extract_attr_value(open_tag, "pid")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        let name = extract_attr_value(open_tag, "name")
            .map(|s| crate::infra::xml::decode_xml_entities_string(&s))
            .unwrap_or_default();

        // Extract value element — look for vt: prefixed elements
        let body = &prop_xml[open_end + 1..prop_end];
        let value = parse_custom_property_value(body);

        if let Some(value) = value {
            properties.push(CustomProperty {
                fmtid,
                pid,
                name,
                value,
            });
        }

        pos = abs_start + prop_end + "</property>".len();
    }

    DocPropsCustom { properties }
}

/// Parse the value child element of a custom property.
/// The `body` is the inner content between `<property ...>` and `</property>`.
fn parse_custom_property_value(body: &str) -> Option<CustomPropertyValue> {
    let body = body.trim();

    // Try each vt: type
    if let Some(val) = extract_vt_text(body, "vt:lpwstr") {
        return Some(CustomPropertyValue::Lpwstr(
            crate::infra::xml::decode_xml_entities_string(&val),
        ));
    }
    if let Some(val) = extract_vt_text(body, "vt:i4") {
        if let Ok(n) = val.parse::<i32>() {
            return Some(CustomPropertyValue::I4(n));
        }
    }
    if let Some(val) = extract_vt_text(body, "vt:r8") {
        if let Ok(n) = val.parse::<f64>() {
            return Some(CustomPropertyValue::R8(n));
        }
    }
    if let Some(val) = extract_vt_text(body, "vt:bool") {
        let b = val == "true" || val == "1";
        return Some(CustomPropertyValue::Bool(b));
    }
    if let Some(val) = extract_vt_text(body, "vt:filetime") {
        return Some(CustomPropertyValue::Filetime(val));
    }

    None
}

/// Extract text content from a `<tag>text</tag>` element.
///
/// Returns `Some("")` when the tag is present but has empty content, and `None` when
/// the tag is absent. This preserves round-trip fidelity for custom property values
/// that exist in the original XML but carry an empty string.
fn extract_vt_text(body: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = body.find(&open)?;
    let after_open = &body[start..];
    let content_start = after_open.find('>')? + 1;
    let content = &after_open[content_start..];
    let end = content.find(&close)?;
    let text = &content[..end];
    Some(text.to_string())
}
