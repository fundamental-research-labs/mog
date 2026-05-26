//! Domain coordinator: parse conditional formats from worksheet XML.

use crate::domain::cond_format::parse_conditional_formatting_element;
use crate::infra::scanner::{self, find_gt_simd, find_tag_simd};
use crate::output::results::CfSummary;

/// Parse conditional formats from worksheet XML.
///
/// Finds all `<conditionalFormatting>` elements and returns a pair:
/// - `Vec<CfSummary>`: lightweight summaries (sqref, pivot flag, rules count) for JSON/WASM
/// - `Vec<ConditionalFormatting>`: full parsed rules for domain conversion
///
/// # Arguments
/// * `xml` - The worksheet XML bytes
pub fn parse_conditional_formats(
    xml: &[u8],
) -> (
    Vec<CfSummary>,
    Vec<ooxml_types::cond_format::ConditionalFormatting>,
) {
    let mut summaries = Vec::new();
    let mut full = Vec::new();
    let mut pos = 0;

    while let Some(cf_start) = find_tag_simd(xml, b"conditionalFormatting", pos) {
        // Skip namespace-prefixed variants (e.g. <x14:conditionalFormatting>).
        // find_tag_simd returns the position of '<', so tag name starts at cf_start+1.
        let after_lt = cf_start + 1;
        let is_unprefixed = after_lt + b"conditionalFormatting".len() <= xml.len()
            && xml[after_lt..].starts_with(b"conditionalFormatting");

        let cf_end =
            scanner::find_closing_tag(xml, b"conditionalFormatting", cf_start).unwrap_or(xml.len());

        if !is_unprefixed {
            pos = find_gt_simd(xml, cf_end)
                .map(|gt| gt + 1)
                .unwrap_or(cf_end + 1);
            continue;
        }

        let cf_xml = &xml[cf_start..cf_end + 25]; // Include closing tag

        let cf = parse_conditional_formatting_element(cf_xml);
        summaries.push(CfSummary {
            sqref: cf.sqref.clone(),
            pivot: cf.pivot,
            rules_count: cf.rules.len(),
        });
        full.push(cf);

        pos = cf_end + 1;
    }

    (summaries, full)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_conditional_formats() {
        let xml = br#"<worksheet><conditionalFormatting sqref="A1:B2"><cfRule type="cellIs"/></conditionalFormatting></worksheet>"#;
        let (summaries, full) = parse_conditional_formats(xml);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].sqref, "A1:B2");
        assert_eq!(summaries[0].rules_count, 1);
        assert_eq!(full.len(), 1);
        assert_eq!(full[0].sqref, "A1:B2");
        assert_eq!(full[0].rules.len(), 1);
    }
}
