//! Print options and page break types for print settings.
//!
//! This module contains types for print options and page breaks:
//! - `PrintOptions` - Print options (gridlines, headings, centering)
//! - `PageBreak` - A single page break
//! - `PageBreaks` - Container for page breaks (row or column)

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::parse_u32_attr;
use xml_derive::XmlRead;

// ============================================================================
// Print Options Struct
// ============================================================================

/// Print options (CT_PrintOptions)
#[derive(Debug, Clone, XmlRead)]
#[xml(tag = "printOptions")]
pub struct PrintOptions {
    /// Print gridlines
    #[xml(attr = "gridLines", bool)]
    pub grid_lines: bool,
    /// Print row and column headings (1, 2, 3... and A, B, C...)
    #[xml(attr = "headings", bool)]
    pub headings: bool,
    /// Center content horizontally on page
    #[xml(attr = "horizontalCentered", bool)]
    pub horizontal_centered: bool,
    /// Center content vertically on page
    #[xml(attr = "verticalCentered", bool)]
    pub vertical_centered: bool,
    /// Set gridlines to print (separate from grid_lines_set).
    /// ECMA-376 default is `true` — gridlines ARE set for printing by default.
    #[xml(attr = "gridLinesSet", bool)]
    pub grid_lines_set: bool,
}

impl Default for PrintOptions {
    fn default() -> Self {
        Self {
            grid_lines: false,
            headings: false,
            horizontal_centered: false,
            vertical_centered: false,
            grid_lines_set: true, // ECMA-376 default
        }
    }
}

impl PrintOptions {
    /// Parse print options from worksheet XML.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the worksheet XML
    ///
    /// # Returns
    /// Parsed PrintOptions struct, or None if no printOptions element found
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let tag_start = find_tag_simd(xml, b"printOptions", 0)?;
        let tag_end = find_gt_simd(xml, tag_start)?;
        let element = &xml[tag_start..tag_end + 1];
        Self::xml_parse(element)
    }
}

// ============================================================================
// Page Break Struct
// ============================================================================

/// A single page break (CT_Break)
#[derive(Debug, Clone, Default, XmlRead)]
#[xml(tag = "brk")]
pub struct PageBreak {
    /// Row or column index where break occurs (0-based)
    #[xml(attr = "id", num)]
    pub id: u32,
    /// Minimum row/column for the break
    #[xml(attr = "min", num)]
    pub min: u32,
    /// Maximum row/column for the break
    #[xml(attr = "max", num)]
    pub max: u32,
    /// Whether this is a manual break (user-inserted)
    #[xml(attr = "man", bool)]
    pub manual: bool,
    /// Whether this is a page-to-page break
    #[xml(attr = "pt", bool)]
    pub pt: bool,
}

// ============================================================================
// Page Breaks Container
// ============================================================================

/// Container for page breaks (CT_PageBreak)
#[derive(Debug, Clone, Default)]
pub struct PageBreaks {
    /// Number of breaks (as declared in XML)
    pub count: Option<u32>,
    /// Number of manual breaks
    pub manual_break_count: Option<u32>,
    /// List of page breaks
    pub breaks: Vec<PageBreak>,
}

impl PageBreaks {
    /// Parse row breaks from worksheet XML.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the worksheet XML
    ///
    /// # Returns
    /// Parsed PageBreaks for rows, or None if no rowBreaks element found
    pub fn parse_row_breaks(xml: &[u8]) -> Option<Self> {
        Self::parse_breaks(xml, b"rowBreaks")
    }

    /// Parse column breaks from worksheet XML.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the worksheet XML
    ///
    /// # Returns
    /// Parsed PageBreaks for columns, or None if no colBreaks element found
    pub fn parse_col_breaks(xml: &[u8]) -> Option<Self> {
        Self::parse_breaks(xml, b"colBreaks")
    }

    /// Internal helper to parse breaks by tag name
    fn parse_breaks(xml: &[u8], tag_name: &[u8]) -> Option<Self> {
        let tag_start = find_tag_simd(xml, tag_name, 0)?;
        let tag_end = find_closing_tag(xml, tag_name, tag_start).unwrap_or(xml.len());
        let section = &xml[tag_start..tag_end];

        let mut breaks = PageBreaks::default();

        // Parse attributes from opening tag
        let open_tag_end = find_gt_simd(section, 0).unwrap_or(section.len());
        let open_tag = &section[..open_tag_end];

        // Parse count
        if let Some(value) = parse_u32_attr(open_tag, b"count=\"") {
            breaks.count = Some(value);
        }

        // Parse manualBreakCount
        if let Some(value) = parse_u32_attr(open_tag, b"manualBreakCount=\"") {
            breaks.manual_break_count = Some(value);
        }

        // Parse individual <brk> elements
        let mut pos = open_tag_end;
        while let Some(brk_start) = find_tag_simd(section, b"brk", pos) {
            let brk_end = find_gt_simd(section, brk_start)
                .map(|p| p + 1)
                .unwrap_or(section.len());

            let brk_element = &section[brk_start..brk_end];
            if let Some(brk) = PageBreak::xml_parse(brk_element) {
                breaks.breaks.push(brk);
            }

            pos = brk_end;
        }

        if breaks.breaks.is_empty() && breaks.count.is_none() {
            None
        } else {
            Some(breaks)
        }
    }

    /// Get only manual breaks
    pub fn manual_breaks(&self) -> impl Iterator<Item = &PageBreak> {
        self.breaks.iter().filter(|b| b.manual)
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // PrintOptions parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_print_options_basic() {
        let xml = br#"<worksheet><printOptions gridLines="1" headings="1"/></worksheet>"#;
        let opts = PrintOptions::parse(xml).unwrap();
        assert!(opts.grid_lines);
        assert!(opts.headings);
    }

    #[test]
    fn test_parse_print_options_centered() {
        let xml = br#"<worksheet><printOptions horizontalCentered="1" verticalCentered="1"/></worksheet>"#;
        let opts = PrintOptions::parse(xml).unwrap();
        assert!(opts.horizontal_centered);
        assert!(opts.vertical_centered);
    }

    #[test]
    fn test_parse_print_options_not_found() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        assert!(PrintOptions::parse(xml).is_none());
    }

    // -------------------------------------------------------------------------
    // PageBreak parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_page_break() {
        let xml = br#"<brk id="10" min="0" max="16383" man="1"/>"#;
        let brk = PageBreak::xml_parse(xml).unwrap();
        assert_eq!(brk.id, 10);
        assert_eq!(brk.min, 0);
        assert_eq!(brk.max, 16383);
        assert!(brk.manual);
    }

    // -------------------------------------------------------------------------
    // PageBreaks parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_row_breaks() {
        let xml = br#"<worksheet><rowBreaks count="2" manualBreakCount="2"><brk id="5" man="1"/><brk id="10" man="1"/></rowBreaks></worksheet>"#;
        let breaks = PageBreaks::parse_row_breaks(xml).unwrap();
        assert_eq!(breaks.count, Some(2));
        assert_eq!(breaks.manual_break_count, Some(2));
        assert_eq!(breaks.breaks.len(), 2);
        assert_eq!(breaks.breaks[0].id, 5);
        assert_eq!(breaks.breaks[1].id, 10);
    }

    #[test]
    fn test_parse_col_breaks() {
        let xml =
            br#"<worksheet><colBreaks count="1"><brk id="3" man="1"/></colBreaks></worksheet>"#;
        let breaks = PageBreaks::parse_col_breaks(xml).unwrap();
        assert_eq!(breaks.count, Some(1));
        assert_eq!(breaks.breaks.len(), 1);
        assert_eq!(breaks.breaks[0].id, 3);
    }

    #[test]
    fn test_manual_breaks_iterator() {
        let xml = br#"<worksheet><rowBreaks><brk id="5" man="1"/><brk id="7" man="0"/><brk id="10" man="1"/></rowBreaks></worksheet>"#;
        let breaks = PageBreaks::parse_row_breaks(xml).unwrap();
        let manual: Vec<_> = breaks.manual_breaks().collect();
        assert_eq!(manual.len(), 2);
        assert_eq!(manual[0].id, 5);
        assert_eq!(manual[1].id, 10);
    }

    #[test]
    fn test_parse_breaks_not_found() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        assert!(PageBreaks::parse_row_breaks(xml).is_none());
        assert!(PageBreaks::parse_col_breaks(xml).is_none());
    }
}
