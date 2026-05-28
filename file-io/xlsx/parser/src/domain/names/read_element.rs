//! Parser for a single `<definedName>` element.

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::{parse_bool_attr, parse_string_attr, parse_u32_attr};

use super::types::DefinedName;
use super::xml_decode::decode_xml_entities;

impl DefinedName {
    /// Parse a single `<definedName>` element.
    ///
    /// # Arguments
    /// * `xml` - Byte slice containing the `<definedName>...</definedName>` element
    ///
    /// # Returns
    /// A parsed `DefinedName` or `None` if parsing fails.
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let tag_start = find_tag_simd(xml, b"definedName", 0)?;
        let tag_end = find_gt_simd(xml, tag_start)?;
        let close_start = find_closing_tag(xml, b"definedName", tag_end)?;

        let content_start = tag_end + 1;
        let content = if content_start < close_start {
            decode_xml_entities(&xml[content_start..close_start])
        } else {
            String::new()
        };

        let tag_bytes = &xml[tag_start..=tag_end];

        let name = parse_string_attr(tag_bytes, b"name=\"")?;
        let comment = parse_optional_string_attr(tag_bytes, b"comment=\"");
        let custom_menu = parse_optional_string_attr(tag_bytes, b"customMenu=\"");
        let description = parse_optional_string_attr(tag_bytes, b"description=\"");
        let help = parse_optional_string_attr(tag_bytes, b"help=\"");
        let status_bar = parse_optional_string_attr(tag_bytes, b"statusBar=\"");

        let local_sheet_id = parse_u32_attr(tag_bytes, b"localSheetId=\"");
        let hidden = parse_bool_attr(tag_bytes, b"hidden=\"");
        let function = parse_bool_attr(tag_bytes, b"function=\"");
        let vb_procedure = parse_bool_attr(tag_bytes, b"vbProcedure=\"");
        let xlm = parse_bool_attr(tag_bytes, b"xlm=\"");
        let function_group_id = parse_u32_attr(tag_bytes, b"functionGroupId=\"");
        let shortcut_key = parse_optional_string_attr(tag_bytes, b"shortcutKey=\"");
        let publish_to_server = parse_bool_attr(tag_bytes, b"publishToServer=\"");
        let workbook_parameter = parse_bool_attr(tag_bytes, b"workbookParameter=\"");

        let xml_space_preserve = find_attr_simd(tag_bytes, b"xml:space=\"", 0)
            .and_then(|pos| {
                let value_start = pos + b"xml:space=\"".len();
                extract_quoted_value(tag_bytes, value_start)
            })
            .map(|(s, e)| &tag_bytes[s..e] == b"preserve")
            .unwrap_or(false);

        Some(DefinedName {
            name,
            refers_to: content,
            comment,
            custom_menu,
            description,
            help,
            status_bar,
            local_sheet_id,
            hidden,
            function,
            vb_procedure,
            xlm,
            function_group_id,
            shortcut_key,
            publish_to_server,
            workbook_parameter,
            xml_space_preserve,
        })
    }
}

/// Parse an optional string attribute from XML bytes.
fn parse_optional_string_attr(xml: &[u8], attr: &[u8]) -> Option<String> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;
    let value = decode_xml_entities(&xml[start..end]);
    if value.is_empty() { None } else { Some(value) }
}
