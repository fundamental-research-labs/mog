//! Parser for the workbook `<definedNames>` section.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

use super::types::{DefinedName, DefinedNames};

impl DefinedNames {
    /// Parse the `<definedNames>` section from workbook.xml.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the workbook.xml file
    ///
    /// # Returns
    /// Parsed collection of defined names
    pub fn parse(xml: &[u8]) -> Self {
        let mut names = DefinedNames::new();

        let section_start = match find_tag_simd(xml, b"definedNames", 0) {
            Some(pos) => pos,
            None => return names,
        };

        let section_end =
            find_closing_tag(xml, b"definedNames", section_start).unwrap_or(xml.len());

        let mut pos = section_start;

        while pos < section_end {
            let name_start = match find_tag_simd(xml, b"definedName", pos) {
                Some(p) if p < section_end => p,
                _ => break,
            };

            let after_tag = name_start + 12;
            if after_tag < xml.len() && xml[after_tag] == b's' {
                pos = name_start + 13;
                continue;
            }

            let name_end = match find_closing_tag(xml, b"definedName", name_start) {
                Some(close_pos) => find_gt_simd(xml, close_pos)
                    .map(|p| p + 1)
                    .unwrap_or(xml.len()),
                None => find_gt_simd(xml, name_start)
                    .map(|p| p + 1)
                    .unwrap_or(xml.len()),
            };

            let element_bytes = &xml[name_start..name_end.min(xml.len())];
            if let Some(defined_name) = DefinedName::parse(element_bytes) {
                names.push(defined_name);
            }

            pos = name_end;
        }

        names
    }
}
