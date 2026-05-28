//! Parsing helpers for `xl/metadata.xml`.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices XML
//! tag / attribute content at byte offsets produced by ASCII-only XML
//! syntax (`<`, `>`, `/`, `"`, `=`, `:`). Char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::output::results::{
    CellMetadataBlock, CellMetadataRecord, FutureMetadataBlock, FutureMetadataGroup,
    MetadataOutput, MetadataTypeOutput, ValueMetadataBlock,
};

use crate::pipeline::full_parse::extract_attr_value;

// =============================================================================
// xl/metadata.xml parsing
// =============================================================================

/// Parse `xl/metadata.xml` into a `MetadataOutput`.
///
/// This parses the OOXML metadata part (ECMA-376 Part 1, Section 18.9), which
/// contains metadata types, future metadata extension blocks (stored as raw XML
/// for faithful round-trip), and cell metadata records referenced by cells via
/// the `cm` attribute.
pub(crate) fn parse_metadata(xml: &[u8]) -> MetadataOutput {
    let xml_str = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return MetadataOutput::default(),
    };

    let metadata_types = parse_metadata_types(xml_str);
    let future_metadata = parse_future_metadata(xml_str);
    let cell_metadata = parse_cell_metadata(xml_str);
    let value_metadata = parse_value_metadata(xml_str);

    MetadataOutput {
        metadata_types,
        future_metadata,
        cell_metadata,
        value_metadata,
    }
}

/// Parse `<metadataTypes>` section.
fn parse_metadata_types(xml: &str) -> Vec<MetadataTypeOutput> {
    let mut result = Vec::new();

    // Find the <metadataTypes ...> section
    let section_start = match xml.find("<metadataTypes") {
        Some(pos) => pos,
        None => return result,
    };
    let section_end = match xml[section_start..].find("</metadataTypes>") {
        Some(pos) => section_start + pos,
        None => {
            // Could be self-closing with no children; unlikely but handle it
            return result;
        }
    };
    let section = &xml[section_start..section_end];

    // Find each <metadataType ...> element (self-closing)
    let mut pos = 0;
    while let Some(start) = section[pos..].find("<metadataType ") {
        let abs_start = pos + start;
        // Find the end of this element (either /> or >)
        let tag_end = match section[abs_start..].find("/>") {
            Some(e) => abs_start + e + 2,
            None => match section[abs_start..].find('>') {
                Some(e) => abs_start + e + 1,
                None => break,
            },
        };
        let tag = &section[abs_start..tag_end];

        let mut mt = MetadataTypeOutput::default();
        if let Some(v) = extract_attr_value(tag, "name") {
            mt.name = v;
        }
        if let Some(v) = extract_attr_value(tag, "minSupportedVersion") {
            mt.min_supported_version = v.parse().unwrap_or(0);
        }
        mt.copy = attr_bool(tag, "copy");
        mt.paste_all = attr_bool(tag, "pasteAll");
        mt.paste_values = attr_bool(tag, "pasteValues");
        mt.merge = attr_bool(tag, "merge");
        mt.split_first = attr_bool(tag, "splitFirst");
        mt.row_col_shift = attr_bool(tag, "rowColShift");
        mt.clear_formats = attr_bool(tag, "clearFormats");
        mt.clear_comments = attr_bool(tag, "clearComments");
        mt.assign = attr_bool(tag, "assign");
        mt.coerce = attr_bool(tag, "coerce");
        mt.cell_meta = attr_bool(tag, "cellMeta");
        mt.ghost_row = attr_bool(tag, "ghostRow");
        mt.ghost_col = attr_bool(tag, "ghostCol");
        mt.edit = attr_bool(tag, "edit");
        mt.delete = attr_bool(tag, "delete");
        mt.paste_formulas = attr_bool(tag, "pasteFormulas");
        mt.paste_formats = attr_bool(tag, "pasteFormats");
        mt.paste_comments = attr_bool(tag, "pasteComments");
        mt.paste_data_validation = attr_bool(tag, "pasteDataValidation");
        mt.paste_borders = attr_bool(tag, "pasteBorders");
        mt.paste_col_widths = attr_bool(tag, "pasteColWidths");
        mt.paste_number_formats = attr_bool(tag, "pasteNumberFormats");
        mt.split_all = attr_bool(tag, "splitAll");
        mt.clear_all = attr_bool(tag, "clearAll");
        mt.clear_contents = attr_bool(tag, "clearContents");
        mt.adjust = attr_bool(tag, "adjust");

        result.push(mt);
        pos = tag_end;
    }

    result
}

fn attr_bool(tag: &str, name: &str) -> bool {
    matches!(extract_attr_value(tag, name).as_deref(), Some("1" | "true"))
}

/// Parse `<futureMetadata>` sections.
///
/// There can be multiple `<futureMetadata name="...">` elements, one per metadata type.
/// Each contains `<bk>` blocks whose inner XML is preserved as raw strings for
/// faithful round-trip of unknown extension elements (e.g., XLDAPR dynamic array properties).
fn parse_future_metadata(xml: &str) -> Vec<FutureMetadataGroup> {
    let mut result = Vec::new();

    let mut search_pos = 0;
    while let Some(start) = xml[search_pos..].find("<futureMetadata ") {
        let abs_start = search_pos + start;
        let section_end = match xml[abs_start..].find("</futureMetadata>") {
            Some(pos) => abs_start + pos + "</futureMetadata>".len(),
            None => break,
        };
        let section = &xml[abs_start..section_end];

        // Extract name attribute from the opening tag
        let tag_end = match section.find('>') {
            Some(e) => e,
            None => {
                search_pos = section_end;
                continue;
            }
        };
        let open_tag = &section[..tag_end + 1];
        let name = extract_attr_value(open_tag, "name").unwrap_or_default();

        // Parse <bk> blocks within this futureMetadata
        let mut blocks = Vec::new();
        let mut bk_pos = 0;
        while let Some(bk_start) = section[bk_pos..].find("<bk>") {
            let bk_abs = bk_pos + bk_start;
            let bk_content_start = bk_abs + "<bk>".len();
            if let Some(bk_end) = section[bk_content_start..].find("</bk>") {
                let raw_xml = section[bk_content_start..bk_content_start + bk_end].to_string();
                blocks.push(FutureMetadataBlock { raw_xml });
                bk_pos = bk_content_start + bk_end + "</bk>".len();
            } else {
                break;
            }
        }

        result.push(FutureMetadataGroup { name, blocks });
        search_pos = section_end;
    }

    result
}

/// Parse `<cellMetadata>` section.
fn parse_cell_metadata(xml: &str) -> Vec<CellMetadataBlock> {
    parse_metadata_block_list(xml, "cellMetadata")
        .into_iter()
        .map(|records| CellMetadataBlock { records })
        .collect()
}

fn parse_value_metadata(xml: &str) -> Vec<ValueMetadataBlock> {
    parse_metadata_block_list(xml, "valueMetadata")
        .into_iter()
        .map(|records| ValueMetadataBlock { records })
        .collect()
}

fn parse_metadata_block_list(xml: &str, element_name: &str) -> Vec<Vec<CellMetadataRecord>> {
    let mut result = Vec::new();

    let section_start = match xml.find(&format!("<{element_name}")) {
        Some(pos) => pos,
        None => return result,
    };
    let close = format!("</{element_name}>");
    let section_end = match xml[section_start..].find(&close) {
        Some(pos) => section_start + pos,
        None => return result,
    };
    let section = &xml[section_start..section_end];

    // Parse <bk> blocks
    let mut bk_pos = 0;
    while let Some(bk_start) = section[bk_pos..].find("<bk>") {
        let bk_abs = bk_pos + bk_start;
        let bk_content_start = bk_abs + "<bk>".len();
        let bk_end = match section[bk_content_start..].find("</bk>") {
            Some(e) => bk_content_start + e,
            None => break,
        };
        let bk_content = &section[bk_content_start..bk_end];

        // Parse <rc> records within this block
        let mut records = Vec::new();
        let mut rc_pos = 0;
        while let Some(rc_start) = bk_content[rc_pos..].find("<rc ") {
            let rc_abs = rc_pos + rc_start;
            let rc_tag_end = match bk_content[rc_abs..].find("/>") {
                Some(e) => rc_abs + e + 2,
                None => match bk_content[rc_abs..].find('>') {
                    Some(e) => rc_abs + e + 1,
                    None => break,
                },
            };
            let rc_tag = &bk_content[rc_abs..rc_tag_end];

            let t = extract_attr_value(rc_tag, "t")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);
            let v = extract_attr_value(rc_tag, "v")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);

            records.push(CellMetadataRecord { t, v });
            rc_pos = rc_tag_end;
        }

        result.push(records);
        bk_pos = bk_end + "</bk>".len();
    }

    result
}
