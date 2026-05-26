//! Header and footer types and parsing for print settings.
//!
//! This module contains types for headers and footers:
//! - `HeaderFooterSection` - Parsed section (left/center/right) of a header/footer (from ooxml-types)
//! - `HeaderFooter` - Complete header/footer settings with XML parsing
//!
//! # Header/Footer Format Codes
//! Excel supports special format codes in headers and footers:
//! - `&L` - Left section
//! - `&C` - Center section
//! - `&R` - Right section
//! - `&P` - Current page number
//! - `&N` - Total number of pages
//! - `&D` - Current date
//! - `&T` - Current time
//! - `&F` - File name
//! - `&A` - Sheet name (tab name)
//! - `&Z` - File path
//! - `&G` - Picture/graphic placeholder
//! - `&B` - Bold toggle
//! - `&I` - Italic toggle
//! - `&U` - Underline toggle
//! - `&S` - Strikethrough toggle
//! - `&E` - Double underline toggle
//! - `&X` - Superscript toggle
//! - `&Y` - Subscript toggle
//! - `&"fontname"` - Font name
//! - `&nn` - Font size (two digits)
//! - `&K` followed by hex color - Font color

use crate::domain::print::helpers::parse_element_content;
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::parse_bool_attr_opt;
use xml_derive::XmlRead;

// Re-export HeaderFooterSection from ooxml-types
pub use ooxml_types::print::HeaderFooterSection;

// ============================================================================
// Header/Footer Struct
// ============================================================================

/// Header and footer settings (CT_HeaderFooter)
#[derive(Debug, Clone, XmlRead)]
#[xml(tag = "headerFooter")]
pub struct HeaderFooter {
    /// Use different headers/footers for odd and even pages
    #[xml(attr = "differentOddEven", bool)]
    pub different_odd_even: bool,
    /// Use different header/footer for the first page
    #[xml(attr = "differentFirst", bool)]
    pub different_first: bool,
    /// Scale headers/footers with document scaling (None = not specified, uses ECMA-376 default of true)
    #[xml(attr = "scaleWithDoc", bool)]
    pub scale_with_doc: Option<bool>,
    /// Align headers/footers with page margins (None = not specified, uses ECMA-376 default of true)
    #[xml(attr = "alignWithMargins", bool)]
    pub align_with_margins: Option<bool>,
    /// Odd page header (also used for all pages if even/first not specified)
    #[xml(child = "oddHeader", text)]
    pub odd_header: Option<String>,
    /// Odd page footer
    #[xml(child = "oddFooter", text)]
    pub odd_footer: Option<String>,
    /// Even page header (for different even/odd headers)
    #[xml(child = "evenHeader", text)]
    pub even_header: Option<String>,
    /// Even page footer
    #[xml(child = "evenFooter", text)]
    pub even_footer: Option<String>,
    /// First page header (for different first page)
    #[xml(child = "firstHeader", text)]
    pub first_header: Option<String>,
    /// First page footer
    #[xml(child = "firstFooter", text)]
    pub first_footer: Option<String>,
}

impl Default for HeaderFooter {
    fn default() -> Self {
        Self {
            odd_header: None,
            odd_footer: None,
            even_header: None,
            even_footer: None,
            first_header: None,
            first_footer: None,
            different_odd_even: false,
            different_first: false,
            scale_with_doc: None,
            align_with_margins: None,
        }
    }
}

impl HeaderFooter {
    /// Parse header/footer from worksheet XML.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the worksheet XML
    ///
    /// # Returns
    /// Parsed HeaderFooter struct, or None if no headerFooter element found
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let tag_start = find_tag_simd(xml, b"headerFooter", 0)?;
        let opening_tag_end = find_gt_simd(xml, tag_start)?;
        let is_self_closing = xml[tag_start..opening_tag_end]
            .iter()
            .rev()
            .find(|&&b| !b.is_ascii_whitespace())
            .copied()
            == Some(b'/');
        let close_end = if is_self_closing {
            opening_tag_end + 1
        } else {
            let tag_end = find_closing_tag(xml, b"headerFooter", tag_start)?;
            memchr::memchr(b'>', &xml[tag_end..])
                .map(|p| tag_end + p + 1)
                .unwrap_or(tag_end)
        };
        let section = &xml[tag_start..close_end];
        let start_tag_end = find_gt_simd(section, 0).unwrap_or(0);
        let start_tag = &section[..start_tag_end.min(section.len())];

        Some(Self {
            different_odd_even: parse_bool_attr_opt(start_tag, b"differentOddEven=\"")
                .unwrap_or(false),
            different_first: parse_bool_attr_opt(start_tag, b"differentFirst=\"").unwrap_or(false),
            scale_with_doc: parse_bool_attr_opt(start_tag, b"scaleWithDoc=\""),
            align_with_margins: parse_bool_attr_opt(start_tag, b"alignWithMargins=\""),
            odd_header: parse_element_content(section, b"oddHeader"),
            odd_footer: parse_element_content(section, b"oddFooter"),
            even_header: parse_element_content(section, b"evenHeader"),
            even_footer: parse_element_content(section, b"evenFooter"),
            first_header: parse_element_content(section, b"firstHeader"),
            first_footer: parse_element_content(section, b"firstFooter"),
        })
    }

    /// Get the parsed odd header sections
    pub fn odd_header_sections(&self) -> HeaderFooterSection {
        self.odd_header
            .as_ref()
            .map(|s| HeaderFooterSection::parse(s))
            .unwrap_or_default()
    }

    /// Get the parsed odd footer sections
    pub fn odd_footer_sections(&self) -> HeaderFooterSection {
        self.odd_footer
            .as_ref()
            .map(|s| HeaderFooterSection::parse(s))
            .unwrap_or_default()
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // HeaderFooterSection parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_header_footer_section_left_only() {
        let section = HeaderFooterSection::parse("&LLeft Content");
        assert_eq!(section.left, "Left Content");
        assert!(section.center.is_empty());
        assert!(section.right.is_empty());
    }

    #[test]
    fn test_header_footer_section_center_only() {
        let section = HeaderFooterSection::parse("&CCenter Content");
        assert!(section.left.is_empty());
        assert_eq!(section.center, "Center Content");
        assert!(section.right.is_empty());
    }

    #[test]
    fn test_header_footer_section_right_only() {
        let section = HeaderFooterSection::parse("&RRight Content");
        assert!(section.left.is_empty());
        assert!(section.center.is_empty());
        assert_eq!(section.right, "Right Content");
    }

    #[test]
    fn test_header_footer_section_all_three() {
        let section = HeaderFooterSection::parse("&LLeft&CCenter&RRight");
        assert_eq!(section.left, "Left");
        assert_eq!(section.center, "Center");
        assert_eq!(section.right, "Right");
    }

    #[test]
    fn test_header_footer_section_with_format_codes() {
        let section = HeaderFooterSection::parse("&LPage &P of &N&C&D&R&F");
        assert_eq!(section.left, "Page &P of &N");
        assert_eq!(section.center, "&D");
        assert_eq!(section.right, "&F");
    }

    #[test]
    fn test_header_footer_section_default_to_center() {
        let section = HeaderFooterSection::parse("Just Text");
        assert!(section.left.is_empty());
        assert_eq!(section.center, "Just Text");
        assert!(section.right.is_empty());
    }

    #[test]
    fn test_header_footer_section_is_empty() {
        let empty = HeaderFooterSection::default();
        assert!(empty.is_empty());

        let non_empty = HeaderFooterSection::parse("&CContent");
        assert!(!non_empty.is_empty());
    }

    // -------------------------------------------------------------------------
    // HeaderFooter parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_header_footer_basic() {
        let xml = br#"<worksheet><headerFooter><oddHeader>&amp;CHeader Text</oddHeader><oddFooter>&amp;LPage &amp;P</oddFooter></headerFooter></worksheet>"#;
        let hf = HeaderFooter::parse(xml).unwrap();
        assert_eq!(hf.odd_header, Some("&CHeader Text".to_string()));
        assert_eq!(hf.odd_footer, Some("&LPage &P".to_string()));
    }

    #[test]
    fn test_parse_header_footer_preserves_ooxml_escapes() {
        let xml = br#"<worksheet><headerFooter><oddFooter>&amp;L_x000D_&amp;CPage</oddFooter></headerFooter></worksheet>"#;
        let hf = HeaderFooter::parse(xml).unwrap();
        assert_eq!(hf.odd_footer, Some("&L_x000D_&CPage".to_string()));
    }

    #[test]
    fn test_parse_header_footer_with_attributes() {
        let xml = br#"<worksheet><headerFooter differentOddEven="1" differentFirst="1" scaleWithDoc="0"><oddHeader>Header</oddHeader></headerFooter></worksheet>"#;
        let hf = HeaderFooter::parse(xml).unwrap();
        assert!(hf.different_odd_even);
        assert!(hf.different_first);
        assert_eq!(hf.scale_with_doc, Some(false));
    }

    #[test]
    fn test_parse_self_closing_header_footer_with_attributes() {
        let xml =
            br#"<worksheet><headerFooter alignWithMargins="0" scaleWithDoc="0"/></worksheet>"#;
        let hf = HeaderFooter::parse(xml).unwrap();
        assert_eq!(hf.align_with_margins, Some(false));
        assert_eq!(hf.scale_with_doc, Some(false));
        assert_eq!(hf.odd_header, None);
        assert_eq!(hf.odd_footer, None);
    }

    #[test]
    fn test_parse_header_footer_even_first() {
        let xml = br#"<worksheet><headerFooter><oddHeader>Odd Header</oddHeader><evenHeader>Even Header</evenHeader><firstHeader>First Header</firstHeader></headerFooter></worksheet>"#;
        let hf = HeaderFooter::parse(xml).unwrap();
        assert_eq!(hf.odd_header, Some("Odd Header".to_string()));
        assert_eq!(hf.even_header, Some("Even Header".to_string()));
        assert_eq!(hf.first_header, Some("First Header".to_string()));
    }

    #[test]
    fn test_header_footer_sections_method() {
        let xml = br#"<worksheet><headerFooter><oddHeader>&amp;LLeft&amp;CCenter&amp;RRight</oddHeader></headerFooter></worksheet>"#;
        let hf = HeaderFooter::parse(xml).unwrap();
        let sections = hf.odd_header_sections();
        assert_eq!(sections.left, "Left");
        assert_eq!(sections.center, "Center");
        assert_eq!(sections.right, "Right");
    }

    #[test]
    fn test_edge_case_empty_header_footer() {
        let xml = br#"<worksheet><headerFooter><oddHeader></oddHeader></headerFooter></worksheet>"#;
        let hf = HeaderFooter::parse(xml).unwrap();
        assert_eq!(hf.odd_header, Some(String::new()));
    }
}
