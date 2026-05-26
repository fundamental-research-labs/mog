//! Page setup types and parsing for print settings.
//!
//! This module contains types for page setup, margins, and related enums:
//! - `PaperSize` - Standard paper size enumeration (from ooxml-types)
//! - `Orientation` - Page orientation (from ooxml-types)
//! - `PageOrder` - Print order (from ooxml-types)
//! - `CellComments` - How to print cell comments (from ooxml-types)
//! - `PrintErrors` - How to print cell errors (from ooxml-types)
//! - `PageSetup` - Page setup settings
//! - `PageMargins` - Page margin settings
//!
//! Enum types are re-exported from [`ooxml_types::print`]. Parsing helpers
//! (`orientation_from_bytes`, etc.) adapt them for the byte-oriented XML
//! scanner used in xlsx-parser.

use crate::infra::scanner::{find_attr_simd, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_opt, parse_f64_attr, parse_string_attr, parse_u32_attr};

// Re-export types from ooxml-types
pub use ooxml_types::print::{
    CellComments, Orientation, PageMargins, PageOrder, PaperSize, PrintErrors, UniversalMeasure,
};

// ============================================================================
// Byte-level parsing helpers for enums
// ============================================================================

/// Parse [`Orientation`] from raw XML attribute bytes.
pub(crate) fn orientation_from_bytes(bytes: &[u8]) -> Orientation {
    match bytes {
        b"default" => Orientation::Default,
        b"portrait" => Orientation::Portrait,
        b"landscape" => Orientation::Landscape,
        _ => Orientation::Default,
    }
}

/// Parse [`PageOrder`] from raw XML attribute bytes.
pub(crate) fn page_order_from_bytes(bytes: &[u8]) -> PageOrder {
    match bytes {
        b"downThenOver" => PageOrder::DownThenOver,
        b"overThenDown" => PageOrder::OverThenDown,
        _ => PageOrder::DownThenOver,
    }
}

/// Parse [`CellComments`] from raw XML attribute bytes.
pub(crate) fn cell_comments_from_bytes(bytes: &[u8]) -> CellComments {
    match bytes {
        b"none" => CellComments::None,
        b"atEnd" => CellComments::AtEnd,
        b"asDisplayed" => CellComments::AsDisplayed,
        _ => CellComments::None,
    }
}

/// Parse [`PrintErrors`] from raw XML attribute bytes.
pub(crate) fn print_errors_from_bytes(bytes: &[u8]) -> PrintErrors {
    match bytes {
        b"displayed" => PrintErrors::Displayed,
        b"blank" => PrintErrors::Blank,
        b"dash" => PrintErrors::Dash,
        b"NA" => PrintErrors::NA,
        _ => PrintErrors::Displayed,
    }
}

// ============================================================================
// Page Setup Struct
// ============================================================================

/// Page setup settings (CT_PageSetup)
///
/// Controls paper size, orientation, scaling, and other print layout settings.
#[derive(Debug, Clone, Default)]
pub struct PageSetup {
    /// Paper size ID (None = attribute absent in original XML)
    pub paper_size: Option<PaperSize>,
    /// Custom paper width as a universal measure (e.g., `"210mm"`, `"8.5in"`)
    pub paper_width: Option<UniversalMeasure>,
    /// Custom paper height as a universal measure (e.g., `"297mm"`, `"11in"`)
    pub paper_height: Option<UniversalMeasure>,
    /// Page orientation
    pub orientation: Orientation,
    /// Scale percentage (None = attribute absent, Some(10..=400))
    pub scale: Option<u16>,
    /// Fit to width in pages (None = attribute absent, Some(0) = auto/unlimited)
    pub fit_to_width: Option<u16>,
    /// Fit to height in pages (None = attribute absent, Some(0) = auto/unlimited)
    pub fit_to_height: Option<u16>,
    /// First page number (None = attribute absent, Some(0) = auto)
    pub first_page_number: Option<u32>,
    /// Use first page number setting
    pub use_first_page_number: bool,
    /// Page order for printing (None = attribute was absent in original XML)
    pub page_order: Option<PageOrder>,
    /// Print in black and white
    pub black_and_white: bool,
    /// Print in draft quality
    pub draft: bool,
    /// How to print cell comments
    pub cell_comments: CellComments,
    /// How to print cell errors
    pub errors: PrintErrors,
    /// Horizontal DPI
    pub horizontal_dpi: Option<u32>,
    /// Vertical DPI
    pub vertical_dpi: Option<u32>,
    /// Number of copies to print (None = attribute absent, Some(n) = explicit)
    pub copies: Option<u32>,
    /// Whether to use printer defaults for unspecified settings.
    /// None means the attribute was absent in the original XML.
    pub use_printer_defaults: Option<bool>,
    /// Relationship ID pointing to the printer settings binary part
    pub r_id: Option<String>,
}

impl PageSetup {
    /// Parse page setup from worksheet XML.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the worksheet XML
    ///
    /// # Returns
    /// Parsed PageSetup struct, or None if no pageSetup element found
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let tag_start = find_tag_simd(xml, b"pageSetup", 0)?;
        let tag_end = find_gt_simd(xml, tag_start)?;
        let element = &xml[tag_start..tag_end + 1];

        let mut setup = PageSetup::default();

        // Parse paperSize
        if let Some(value) = parse_u32_attr(element, b"paperSize=\"") {
            setup.paper_size = Some(PaperSize::from_u32(value));
        }

        // Parse paperWidth (ST_PositiveUniversalMeasure, e.g., "210mm", "8.5in")
        if let Some(value) = parse_string_attr(element, b"paperWidth=\"") {
            setup.paper_width = UniversalMeasure::from_ooxml(&value);
        }

        // Parse paperHeight
        if let Some(value) = parse_string_attr(element, b"paperHeight=\"") {
            setup.paper_height = UniversalMeasure::from_ooxml(&value);
        }

        // Parse orientation
        if let Some(value) = parse_bytes_attr(element, b"orientation=\"") {
            setup.orientation = orientation_from_bytes(value);
        }

        // Parse scale
        if let Some(value) = parse_u32_attr(element, b"scale=\"") {
            setup.scale = Some(value.min(400).max(10) as u16);
        }

        // Parse fitToWidth
        if let Some(value) = parse_u32_attr(element, b"fitToWidth=\"") {
            setup.fit_to_width = Some(value as u16);
        }

        // Parse fitToHeight
        if let Some(value) = parse_u32_attr(element, b"fitToHeight=\"") {
            setup.fit_to_height = Some(value as u16);
        }

        // Parse firstPageNumber
        if let Some(value) = parse_u32_attr(element, b"firstPageNumber=\"") {
            setup.first_page_number = Some(value);
        }

        // Parse useFirstPageNumber
        if let Some(value) = parse_bool_attr_opt(element, b"useFirstPageNumber=\"") {
            setup.use_first_page_number = value;
        }

        // Parse pageOrder
        if let Some(value) = parse_bytes_attr(element, b"pageOrder=\"") {
            setup.page_order = Some(page_order_from_bytes(value));
        }

        // Parse blackAndWhite
        if let Some(value) = parse_bool_attr_opt(element, b"blackAndWhite=\"") {
            setup.black_and_white = value;
        }

        // Parse draft
        if let Some(value) = parse_bool_attr_opt(element, b"draft=\"") {
            setup.draft = value;
        }

        // Parse cellComments
        if let Some(value) = parse_bytes_attr(element, b"cellComments=\"") {
            setup.cell_comments = cell_comments_from_bytes(value);
        }

        // Parse errors
        if let Some(value) = parse_bytes_attr(element, b"errors=\"") {
            setup.errors = print_errors_from_bytes(value);
        }

        // Parse horizontalDpi
        if let Some(value) = parse_u32_attr(element, b"horizontalDpi=\"") {
            setup.horizontal_dpi = Some(value);
        }

        // Parse verticalDpi
        if let Some(value) = parse_u32_attr(element, b"verticalDpi=\"") {
            setup.vertical_dpi = Some(value);
        }

        // Parse copies
        if let Some(value) = parse_u32_attr(element, b"copies=\"") {
            setup.copies = Some(value.max(1));
        }

        // Parse usePrinterDefaults
        if let Some(value) = parse_bool_attr_opt(element, b"usePrinterDefaults=\"") {
            setup.use_printer_defaults = Some(value);
        }

        // Parse r:id (relationship ID for printer settings)
        if let Some(value) = parse_string_attr(element, b"r:id=\"") {
            setup.r_id = Some(value);
        }

        Some(setup)
    }
}

// ============================================================================
// Page Margins Struct
// ============================================================================

/// Parse page margins from worksheet XML.
///
/// # Arguments
/// * `xml` - Raw bytes of the worksheet XML
///
/// # Returns
/// Parsed PageMargins struct, or None if no pageMargins element found
pub fn parse_page_margins(xml: &[u8]) -> Option<PageMargins> {
    let tag_start = find_tag_simd(xml, b"pageMargins", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)?;
    let element = &xml[tag_start..tag_end + 1];

    let mut margins = PageMargins::default();

    // Parse left
    if let Some(value) = parse_f64_attr(element, b"left=\"") {
        margins.left = value;
    }

    // Parse right
    if let Some(value) = parse_f64_attr(element, b"right=\"") {
        margins.right = value;
    }

    // Parse top
    if let Some(value) = parse_f64_attr(element, b"top=\"") {
        margins.top = value;
    }

    // Parse bottom
    if let Some(value) = parse_f64_attr(element, b"bottom=\"") {
        margins.bottom = value;
    }

    // Parse header
    if let Some(value) = parse_f64_attr(element, b"header=\"") {
        margins.header = value;
    }

    // Parse footer
    if let Some(value) = parse_f64_attr(element, b"footer=\"") {
        margins.footer = value;
    }

    Some(margins)
}

// ============================================================================
// Helper Functions (used by PageSetup parsing)
// ============================================================================

/// Parse raw bytes from an attribute (no decoding)
pub(crate) fn parse_bytes_attr<'a>(xml: &'a [u8], attr: &[u8]) -> Option<&'a [u8]> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();

    if value_start >= xml.len() {
        return None;
    }

    // Find closing quote
    let mut pos = value_start;
    while pos < xml.len() && xml[pos] != b'"' {
        pos += 1;
    }

    Some(&xml[value_start..pos])
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // PaperSize tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_paper_size_from_u32() {
        assert_eq!(PaperSize::from_u32(1), PaperSize::Letter);
        assert_eq!(PaperSize::from_u32(9), PaperSize::A4);
        assert_eq!(PaperSize::from_u32(5), PaperSize::Legal);
        assert_eq!(PaperSize::from_u32(999), PaperSize::Other(999));
        assert_eq!(PaperSize::from_u32(0), PaperSize::Other(0));
    }

    #[test]
    fn test_paper_size_as_str() {
        assert_eq!(PaperSize::Letter.as_str(), "Letter");
        assert_eq!(PaperSize::A4.as_str(), "A4");
        assert_eq!(PaperSize::Legal.as_str(), "Legal");
        assert_eq!(PaperSize::Other(0).as_str(), "Other");
    }

    #[test]
    fn test_paper_size_roundtrip() {
        for id in 1..=41 {
            let paper = PaperSize::from_u32(id);
            assert_eq!(paper.as_u32(), id);
        }
    }

    // -------------------------------------------------------------------------
    // Orientation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_orientation_from_bytes() {
        assert_eq!(orientation_from_bytes(b"portrait"), Orientation::Portrait);
        assert_eq!(orientation_from_bytes(b"landscape"), Orientation::Landscape);
        assert_eq!(orientation_from_bytes(b"default"), Orientation::Default);
        assert_eq!(orientation_from_bytes(b"unknown"), Orientation::Default);
    }

    #[test]
    fn test_orientation_as_str() {
        assert_eq!(Orientation::Portrait.to_ooxml(), "portrait");
        assert_eq!(Orientation::Landscape.to_ooxml(), "landscape");
        assert_eq!(Orientation::Default.to_ooxml(), "default");
    }

    // -------------------------------------------------------------------------
    // PageOrder tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_page_order_from_bytes() {
        assert_eq!(
            page_order_from_bytes(b"downThenOver"),
            PageOrder::DownThenOver
        );
        assert_eq!(
            page_order_from_bytes(b"overThenDown"),
            PageOrder::OverThenDown
        );
        assert_eq!(page_order_from_bytes(b"unknown"), PageOrder::DownThenOver);
    }

    // -------------------------------------------------------------------------
    // CellComments tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_cell_comments_from_bytes() {
        assert_eq!(cell_comments_from_bytes(b"none"), CellComments::None);
        assert_eq!(cell_comments_from_bytes(b"atEnd"), CellComments::AtEnd);
        assert_eq!(
            cell_comments_from_bytes(b"asDisplayed"),
            CellComments::AsDisplayed
        );
    }

    // -------------------------------------------------------------------------
    // PrintErrors tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_print_errors_from_bytes() {
        assert_eq!(
            print_errors_from_bytes(b"displayed"),
            PrintErrors::Displayed
        );
        assert_eq!(print_errors_from_bytes(b"blank"), PrintErrors::Blank);
        assert_eq!(print_errors_from_bytes(b"dash"), PrintErrors::Dash);
        assert_eq!(print_errors_from_bytes(b"NA"), PrintErrors::NA);
    }

    // -------------------------------------------------------------------------
    // PageSetup parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_page_setup_basic() {
        let xml =
            br#"<worksheet><pageSetup paperSize="9" orientation="landscape" scale="75"/></worksheet>"#;
        let setup = PageSetup::parse(xml).unwrap();
        assert_eq!(setup.paper_size, Some(PaperSize::A4));
        assert_eq!(setup.orientation, Orientation::Landscape);
        assert_eq!(setup.scale, Some(75));
    }

    #[test]
    fn test_parse_page_setup_fit_to_page() {
        let xml = br#"<worksheet><pageSetup fitToWidth="1" fitToHeight="2"/></worksheet>"#;
        let setup = PageSetup::parse(xml).unwrap();
        assert_eq!(setup.fit_to_width, Some(1));
        assert_eq!(setup.fit_to_height, Some(2));
    }

    #[test]
    fn test_parse_page_setup_dpi() {
        let xml = br#"<worksheet><pageSetup horizontalDpi="300" verticalDpi="600"/></worksheet>"#;
        let setup = PageSetup::parse(xml).unwrap();
        assert_eq!(setup.horizontal_dpi, Some(300));
        assert_eq!(setup.vertical_dpi, Some(600));
    }

    #[test]
    fn test_parse_page_setup_dpi_zero() {
        let xml =
            br#"<worksheet><pageSetup horizontalDpi="0" orientation="portrait"/></worksheet>"#;
        let setup = PageSetup::parse(xml).unwrap();
        assert_eq!(
            setup.horizontal_dpi,
            Some(0),
            "horizontalDpi=0 should parse as Some(0)"
        );
        assert_eq!(setup.orientation, Orientation::Portrait);
    }

    #[test]
    fn test_parse_page_setup_flags() {
        let xml = br#"<worksheet><pageSetup blackAndWhite="1" draft="1" pageOrder="overThenDown"/></worksheet>"#;
        let setup = PageSetup::parse(xml).unwrap();
        assert!(setup.black_and_white);
        assert!(setup.draft);
        assert_eq!(setup.page_order, Some(PageOrder::OverThenDown));
    }

    #[test]
    fn test_parse_page_setup_not_found() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        assert!(PageSetup::parse(xml).is_none());
    }

    // -------------------------------------------------------------------------
    // PageMargins parsing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_page_margins_basic() {
        let xml = br#"<worksheet><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>"#;
        let margins = parse_page_margins(xml).unwrap();
        assert!((margins.left - 0.7).abs() < f64::EPSILON);
        assert!((margins.right - 0.7).abs() < f64::EPSILON);
        assert!((margins.top - 0.75).abs() < f64::EPSILON);
        assert!((margins.bottom - 0.75).abs() < f64::EPSILON);
        assert!((margins.header - 0.3).abs() < f64::EPSILON);
        assert!((margins.footer - 0.3).abs() < f64::EPSILON);
    }

    #[test]
    fn test_page_margins_excel_default() {
        let margins = PageMargins::excel_default();
        assert!((margins.left - 0.7).abs() < f64::EPSILON);
        assert!((margins.header - 0.3).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_page_margins_not_found() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        assert!(parse_page_margins(xml).is_none());
    }

    #[test]
    fn test_edge_case_self_closing_page_setup() {
        let xml = br#"<worksheet><pageSetup paperSize="9"/></worksheet>"#;
        let setup = PageSetup::parse(xml).unwrap();
        assert_eq!(setup.paper_size, Some(PaperSize::A4));
    }

    #[test]
    fn test_malformed_xml_partial_attributes() {
        // Should gracefully handle missing attributes
        let xml = br#"<worksheet><pageSetup/></worksheet>"#;
        let setup = PageSetup::parse(xml).unwrap();
        // Should have None values when attributes are absent
        assert_eq!(setup.paper_size, None);
        assert_eq!(setup.scale, None);
    }
}
