//! Legacy `<dataValidations>` container parsing.

use crate::domain::validation::read_support::find_non_namespaced_tag;
use crate::domain::validation::types::{DataValidation, DataValidations};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_opt, parse_u32_attr};

impl DataValidations {
    /// Parse data validations from worksheet XML.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the worksheet XML
    ///
    /// # Returns
    /// Parsed DataValidations struct, or None if no validations found
    pub fn parse(xml: &[u8]) -> Option<Self> {
        // Find <dataValidations> section (non-namespaced only;
        // x14:dataValidations inside extLst has a different schema).
        let dv_start = find_non_namespaced_tag(xml, b"dataValidations", 0)?;
        let open_end = find_gt_simd(xml, dv_start).unwrap_or(xml.len().saturating_sub(1));
        let dv_end = if open_end > dv_start && xml.get(open_end.saturating_sub(1)) == Some(&b'/') {
            open_end + 1
        } else {
            find_closing_tag(xml, b"dataValidations", dv_start).unwrap_or(xml.len())
        };

        let section = &xml[dv_start..dv_end];
        let mut validations = DataValidations::default();

        parse_container_attrs(&mut validations, section);

        let mut pos = 0;
        while let Some(dv_pos) = find_tag_simd(section, b"dataValidation", pos) {
            // Avoid matching dataValidations again.
            if dv_pos + 14 < section.len() && section[dv_pos + 15] == b's' {
                pos = dv_pos + 1;
                continue;
            }

            let element_end = find_validation_element_end(section, dv_pos);

            if let Some(dv) = DataValidation::parse(&section[dv_pos..element_end]) {
                validations.validations.push(dv);
            }

            pos = element_end;
        }

        if validations.validations.is_empty()
            && !validations.disable_prompts
            && validations.x_window.is_none()
            && validations.y_window.is_none()
            && validations.count.is_none()
        {
            None
        } else {
            Some(validations)
        }
    }
}

/// Parse container attributes from <dataValidations> element.
pub(crate) fn parse_container_attrs(container: &mut DataValidations, xml: &[u8]) {
    let tag_end = find_gt_simd(xml, 0).unwrap_or(xml.len());
    let tag = &xml[..tag_end];

    if let Some(value) = parse_bool_attr_opt(tag, b"disablePrompts=\"") {
        container.disable_prompts = value;
    }

    if let Some(value) = parse_u32_attr(tag, b"xWindow=\"") {
        container.x_window = Some(value);
    }

    if let Some(value) = parse_u32_attr(tag, b"yWindow=\"") {
        container.y_window = Some(value);
    }

    if let Some(value) = parse_u32_attr(tag, b"count=\"") {
        container.count = Some(value);
    }
}

/// Find the end of a dataValidation element, handling self-closing and body forms.
pub(crate) fn find_validation_element_end(xml: &[u8], start: usize) -> usize {
    let mut pos = start;
    let mut in_quotes = false;

    while pos < xml.len() {
        let b = xml[pos];

        if b == b'"' {
            in_quotes = !in_quotes;
        } else if !in_quotes {
            if b == b'/' && pos + 1 < xml.len() && xml[pos + 1] == b'>' {
                return pos + 2;
            } else if b == b'>' {
                break;
            }
        }
        pos += 1;
    }

    find_closing_tag(xml, b"dataValidation", pos)
        .and_then(|close_start| find_gt_simd(xml, close_start).map(|gt| gt + 1))
        .unwrap_or(xml.len())
}
