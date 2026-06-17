//! Unit tests for print settings writer.

use super::*;
use crate::domain::print::{
    CellComments, Orientation, PageMargins, PageOrder, PaperSize, PrintErrors,
};
use crate::write::xml_writer::XmlWriter;
use ooxml_types::print::hf_codes;

// -------------------------------------------------------------------------
// Header/Footer Format Code Tests
// -------------------------------------------------------------------------

#[test]
fn test_hf_codes_constants() {
    assert_eq!(hf_codes::PAGE_NUMBER, "&P");
    assert_eq!(hf_codes::TOTAL_PAGES, "&N");
    assert_eq!(hf_codes::DATE, "&D");
    assert_eq!(hf_codes::TIME, "&T");
    assert_eq!(hf_codes::FILE_PATH, "&Z");
    assert_eq!(hf_codes::FILE_NAME, "&F");
    assert_eq!(hf_codes::SHEET_NAME, "&A");
    assert_eq!(hf_codes::LEFT_SECTION, "&L");
    assert_eq!(hf_codes::CENTER_SECTION, "&C");
    assert_eq!(hf_codes::RIGHT_SECTION, "&R");
}

#[test]
fn test_hf_codes_font() {
    assert_eq!(hf_codes::font("Arial", "Bold"), "&\"Arial,Bold\"");
    assert_eq!(
        hf_codes::font("Times New Roman", "Italic"),
        "&\"Times New Roman,Italic\""
    );
}

#[test]
fn test_hf_codes_font_size() {
    assert_eq!(hf_codes::font_size(12), "&12");
    assert_eq!(hf_codes::font_size(24), "&24");
}

#[test]
fn test_hf_codes_font_color() {
    assert_eq!(hf_codes::font_color("FF0000"), "&KFF0000");
    assert_eq!(hf_codes::font_color("0000FF"), "&K0000FF");
}

// -------------------------------------------------------------------------
// PaperSize Tests
// -------------------------------------------------------------------------

#[test]
fn test_paper_size_as_u32() {
    assert_eq!(PaperSize::Letter.as_u32(), 1);
    assert_eq!(PaperSize::A4.as_u32(), 9);
    assert_eq!(PaperSize::Legal.as_u32(), 5);
    assert_eq!(PaperSize::A3.as_u32(), 8);
}

#[test]
fn test_paper_size_default() {
    let size: PaperSize = Default::default();
    assert_eq!(size, PaperSize::Letter);
}

// -------------------------------------------------------------------------
// Orientation Tests
// -------------------------------------------------------------------------

#[test]
fn test_orientation_to_ooxml() {
    assert_eq!(Orientation::Portrait.to_ooxml(), "portrait");
    assert_eq!(Orientation::Landscape.to_ooxml(), "landscape");
    assert_eq!(Orientation::Default.to_ooxml(), "default");
}

#[test]
fn test_orientation_default() {
    let orientation: Orientation = Default::default();
    assert_eq!(orientation, Orientation::Default);
}

// -------------------------------------------------------------------------
// CellComments Tests
// -------------------------------------------------------------------------

#[test]
fn test_cell_comments_to_ooxml() {
    assert_eq!(CellComments::None.to_ooxml(), "none");
    assert_eq!(CellComments::AtEnd.to_ooxml(), "atEnd");
    assert_eq!(CellComments::AsDisplayed.to_ooxml(), "asDisplayed");
}

// -------------------------------------------------------------------------
// PrintErrors Tests
// -------------------------------------------------------------------------

#[test]
fn test_print_errors_to_ooxml() {
    assert_eq!(PrintErrors::Displayed.to_ooxml(), "displayed");
    assert_eq!(PrintErrors::Blank.to_ooxml(), "blank");
    assert_eq!(PrintErrors::Dash.to_ooxml(), "dash");
    assert_eq!(PrintErrors::NA.to_ooxml(), "NA");
}

// -------------------------------------------------------------------------
// PageOrder Tests
// -------------------------------------------------------------------------

#[test]
fn test_page_order_to_ooxml() {
    assert_eq!(PageOrder::DownThenOver.to_ooxml(), "downThenOver");
    assert_eq!(PageOrder::OverThenDown.to_ooxml(), "overThenDown");
}

// -------------------------------------------------------------------------
// PageMargins Tests
// -------------------------------------------------------------------------

#[test]
fn test_page_margins_default() {
    let margins = PageMargins::default();
    assert!((margins.left - 0.7).abs() < f64::EPSILON);
    assert!((margins.right - 0.7).abs() < f64::EPSILON);
    assert!((margins.top - 0.75).abs() < f64::EPSILON);
    assert!((margins.bottom - 0.75).abs() < f64::EPSILON);
    assert!((margins.header - 0.3).abs() < f64::EPSILON);
    assert!((margins.footer - 0.3).abs() < f64::EPSILON);
}

#[test]
fn test_page_margins_uniform() {
    let margins = PageMargins::uniform(1.0);
    assert!((margins.left - 1.0).abs() < f64::EPSILON);
    assert!((margins.right - 1.0).abs() < f64::EPSILON);
    assert!((margins.top - 1.0).abs() < f64::EPSILON);
    assert!((margins.bottom - 1.0).abs() < f64::EPSILON);
    assert!((margins.header - 1.0).abs() < f64::EPSILON);
    assert!((margins.footer - 1.0).abs() < f64::EPSILON);
}

#[test]
fn test_page_margins_narrow() {
    let margins = PageMargins::narrow();
    assert!((margins.left - 0.25).abs() < f64::EPSILON);
    assert!((margins.right - 0.25).abs() < f64::EPSILON);
}

#[test]
fn test_page_margins_wide() {
    let margins = PageMargins::wide();
    assert!((margins.left - 1.0).abs() < f64::EPSILON);
    assert!((margins.right - 1.0).abs() < f64::EPSILON);
}

#[test]
fn test_page_margins_xml() {
    let mut writer = PrintWriter::new();
    writer.set_margins(PageMargins::default());

    let xml = String::from_utf8(writer.margins_xml().unwrap()).unwrap();

    assert!(xml.contains("<pageMargins"));
    assert!(xml.contains("left=\"0.7\""));
    assert!(xml.contains("right=\"0.7\""));
    assert!(xml.contains("top=\"0.75\""));
    assert!(xml.contains("bottom=\"0.75\""));
    assert!(xml.contains("header=\"0.3\""));
    assert!(xml.contains("footer=\"0.3\""));
    assert!(xml.contains("/>"));
}

// -------------------------------------------------------------------------
// PageSetup Tests
// -------------------------------------------------------------------------

#[test]
fn test_page_setup_basic() {
    let mut writer = PrintWriter::new();
    writer
        .paper_size(PaperSize::A4)
        .orientation(Orientation::Landscape);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(xml.contains("<pageSetup"));
    assert!(xml.contains("paperSize=\"9\""));
    assert!(xml.contains("orientation=\"landscape\""));
    assert!(xml.contains("/>"));
}

#[test]
fn test_page_setup_scale() {
    let mut writer = PrintWriter::new();
    writer.scale(75);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(xml.contains("scale=\"75\""));
}

#[test]
fn test_page_setup_scale_clamping() {
    let mut writer = PrintWriter::new();
    writer.scale(5); // Below minimum
    assert_eq!(writer.page_setup.as_ref().unwrap().scale, Some(10));

    writer.scale(500); // Above maximum
    assert_eq!(writer.page_setup.as_ref().unwrap().scale, Some(400));
}

#[test]
fn test_page_setup_fit_to_page() {
    let mut writer = PrintWriter::new();
    writer.fit_to_page(1, 2);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(xml.contains("fitToWidth=\"1\""));
    assert!(xml.contains("fitToHeight=\"2\""));
    assert!(!xml.contains("scale=")); // Scale should be cleared
}

#[test]
fn test_page_setup_dpi() {
    let mut writer = PrintWriter::new();
    writer.dpi(300, 600);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(xml.contains("horizontalDpi=\"300\""));
    assert!(xml.contains("verticalDpi=\"600\""));
}

#[test]
fn test_page_setup_dpi_zero() {
    let mut writer = PrintWriter::new();
    writer.dpi(0, 0);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(
        xml.contains("horizontalDpi=\"0\""),
        "horizontalDpi=0 should be preserved, got: {}",
        xml
    );
    assert!(
        xml.contains("verticalDpi=\"0\""),
        "verticalDpi=0 should be preserved, got: {}",
        xml
    );
}

#[test]
fn test_page_setup_flags() {
    let mut writer = PrintWriter::new();
    writer.black_and_white(true).draft(true);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(xml.contains("blackAndWhite=\"1\""));
    assert!(xml.contains("draft=\"1\""));
}

#[test]
fn test_page_setup_cell_comments() {
    let mut writer = PrintWriter::new();
    writer.cell_comments(CellComments::AtEnd);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(xml.contains("cellComments=\"atEnd\""));
}

#[test]
fn test_page_setup_print_errors() {
    let mut writer = PrintWriter::new();
    writer.print_errors(PrintErrors::NA);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(xml.contains("errors=\"NA\""));
}

#[test]
fn test_page_setup_page_order() {
    let mut writer = PrintWriter::new();
    writer.page_order(PageOrder::OverThenDown);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(xml.contains("pageOrder=\"overThenDown\""));
}

#[test]
fn test_page_setup_first_page_number() {
    let mut writer = PrintWriter::new();
    writer.first_page_number(5);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(xml.contains("firstPageNumber=\"5\""));
    assert!(xml.contains("useFirstPageNumber=\"1\""));
}

#[test]
fn test_page_setup_copies() {
    let mut writer = PrintWriter::new();
    writer.copies(3);

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    assert!(xml.contains("copies=\"3\""));
}

#[test]
fn test_page_setup_default_values() {
    let mut writer = PrintWriter::new();
    writer.paper_size(PaperSize::Letter);
    writer.orientation(Orientation::Default); // Default, should be omitted

    let xml = String::from_utf8(writer.page_setup_xml().unwrap()).unwrap();

    // paperSize is always emitted for round-trip fidelity
    assert!(xml.contains("paperSize=\"1\""));
    // orientation=default is still omitted
    assert!(!xml.contains("orientation="));
}

// -------------------------------------------------------------------------
// HeaderFooter Tests
// -------------------------------------------------------------------------

#[test]
fn test_header_footer_simple_header() {
    let mut hf = HeaderFooter::new();
    hf.header("My Header");

    assert_eq!(hf.odd_header, Some("&CMy Header".to_string()));
}

#[test]
fn test_header_footer_simple_footer() {
    let mut hf = HeaderFooter::new();
    hf.footer("My Footer");

    assert_eq!(hf.odd_footer, Some("&CMy Footer".to_string()));
}

#[test]
fn test_header_footer_lcr() {
    let mut hf = HeaderFooter::new();
    hf.header_lcr("Left", "Center", "Right");

    assert_eq!(hf.odd_header, Some("&LLeft&CCenter&RRight".to_string()));
}

#[test]
fn test_header_footer_lcr_partial() {
    let mut hf = HeaderFooter::new();
    hf.header_lcr("", "Center Only", "");

    assert_eq!(hf.odd_header, Some("&CCenter Only".to_string()));
}

#[test]
fn test_header_footer_has_content() {
    let mut hf = HeaderFooter::new();
    assert!(!hf.has_content());

    hf.header("Test");
    assert!(hf.has_content());
}

#[test]
fn test_header_footer_xml() {
    let mut writer = PrintWriter::new();
    writer.header("Page &P of &N").footer("&D");

    let xml = String::from_utf8(writer.header_footer_xml().unwrap()).unwrap();

    assert!(xml.contains("<headerFooter>"));
    assert!(xml.contains("<oddHeader>&amp;CPage &amp;P of &amp;N</oddHeader>"));
    assert!(xml.contains("<oddFooter>&amp;C&amp;D</oddFooter>"));
    assert!(xml.contains("</headerFooter>"));
}

#[test]
fn test_header_footer_preserves_literal_control_characters() {
    let mut hf = HeaderFooter::new();
    hf.odd_footer = Some("&L\r\n&C\tPage &P".to_string());

    let mut writer = PrintWriter::new();
    writer.set_header_footer(hf);

    let xml = String::from_utf8(writer.header_footer_xml().unwrap()).unwrap();

    assert!(xml.contains("<oddFooter>&amp;L\r\n&amp;C\tPage &amp;P</oddFooter>"));
    assert!(!xml.contains("_x000D_"));
    assert!(!xml.contains("_x000A_"));
    assert!(!xml.contains("_x0009_"));
}

#[test]
fn test_header_footer_preserves_ooxml_escape_tokens() {
    let mut hf = HeaderFooter::new();
    hf.odd_footer = Some("&L_x000D_&CPage &P".to_string());

    let mut writer = PrintWriter::new();
    writer.set_header_footer(hf);

    let xml = String::from_utf8(writer.header_footer_xml().unwrap()).unwrap();

    assert!(xml.contains("<oddFooter>&amp;L_x000D_&amp;CPage &amp;P</oddFooter>"));
}

#[test]
fn test_header_footer_xml_with_lcr() {
    let mut writer = PrintWriter::new();
    writer.header_lcr("&F", "&A", "Page &P");

    let xml = String::from_utf8(writer.header_footer_xml().unwrap()).unwrap();

    assert!(xml.contains("&amp;L&amp;F"));
    assert!(xml.contains("&amp;C&amp;A"));
    assert!(xml.contains("&amp;RPage &amp;P"));
}

#[test]
fn test_header_footer_different_odd_even() {
    let mut hf = HeaderFooter::new();
    hf.different_odd_even = true;
    hf.odd_header = Some("&COdd".to_string());
    hf.even_header = Some("&CEven".to_string());

    let mut writer = PrintWriter::new();
    writer.set_header_footer(hf);

    let xml = String::from_utf8(writer.header_footer_xml().unwrap()).unwrap();

    assert!(xml.contains("differentOddEven=\"1\""));
    assert!(xml.contains("<oddHeader>"));
    assert!(xml.contains("<evenHeader>"));
}

#[test]
fn test_header_footer_different_first() {
    let mut hf = HeaderFooter::new();
    hf.different_first = true;
    hf.odd_header = Some("&CRegular".to_string());
    hf.first_header = Some("&CFirst Page".to_string());

    let mut writer = PrintWriter::new();
    writer.set_header_footer(hf);

    let xml = String::from_utf8(writer.header_footer_xml().unwrap()).unwrap();

    assert!(xml.contains("differentFirst=\"1\""));
    assert!(xml.contains("<oddHeader>"));
    assert!(xml.contains("<firstHeader>"));
}

#[test]
fn test_header_footer_scale_with_doc() {
    let mut hf = HeaderFooter::new();
    hf.scale_with_doc = Some(false);
    hf.header("Test");

    let mut writer = PrintWriter::new();
    writer.set_header_footer(hf);

    let xml = String::from_utf8(writer.header_footer_xml().unwrap()).unwrap();

    assert!(xml.contains("scaleWithDoc=\"0\""));
}

#[test]
fn test_header_footer_align_with_margins() {
    let mut hf = HeaderFooter::new();
    hf.align_with_margins = Some(false);
    hf.header("Test");

    let mut writer = PrintWriter::new();
    writer.set_header_footer(hf);

    let xml = String::from_utf8(writer.header_footer_xml().unwrap()).unwrap();

    assert!(xml.contains("alignWithMargins=\"0\""));
}

// -------------------------------------------------------------------------
// PrintOptions Tests
// -------------------------------------------------------------------------

#[test]
fn test_print_options_horizontal_centered() {
    let mut writer = PrintWriter::new();
    writer.center_horizontally();

    let mut xml_writer = XmlWriter::new();
    writer.write_to(&mut xml_writer);
    let xml = String::from_utf8(xml_writer.finish()).unwrap();

    assert!(xml.contains("<printOptions"));
    assert!(xml.contains("horizontalCentered=\"1\""));
}

#[test]
fn test_print_options_vertical_centered() {
    let mut writer = PrintWriter::new();
    writer.center_vertically();

    let mut xml_writer = XmlWriter::new();
    writer.write_to(&mut xml_writer);
    let xml = String::from_utf8(xml_writer.finish()).unwrap();

    assert!(xml.contains("verticalCentered=\"1\""));
}

#[test]
fn test_print_options_gridlines() {
    let mut writer = PrintWriter::new();
    writer.print_gridlines(true);

    let mut xml_writer = XmlWriter::new();
    writer.write_to(&mut xml_writer);
    let xml = String::from_utf8(xml_writer.finish()).unwrap();

    assert!(xml.contains("gridLines=\"1\""));
    // gridLinesSet defaults to true; true is omitted from XML output
    assert!(!xml.contains("gridLinesSet="));
}

#[test]
fn test_print_options_headings() {
    let mut writer = PrintWriter::new();
    writer.print_headings(true);

    let mut xml_writer = XmlWriter::new();
    writer.write_to(&mut xml_writer);
    let xml = String::from_utf8(xml_writer.finish()).unwrap();

    assert!(xml.contains("headings=\"1\""));
}

// -------------------------------------------------------------------------
// Page Break Tests
// -------------------------------------------------------------------------

#[test]
fn test_row_breaks() {
    let mut writer = PrintWriter::new();
    writer.add_row_break(10).add_row_break(25).add_row_break(50);

    let mut xml_writer = XmlWriter::new();
    writer.write_to(&mut xml_writer);
    let xml = String::from_utf8(xml_writer.finish()).unwrap();

    assert!(xml.contains("<rowBreaks count=\"3\" manualBreakCount=\"3\">"));
    assert!(xml.contains("id=\"10\""));
    assert!(xml.contains("id=\"25\""));
    assert!(xml.contains("id=\"50\""));
    assert!(xml.contains("max=\"16383\""));
    assert!(xml.contains("man=\"1\""));
    assert!(xml.contains("</rowBreaks>"));
}

#[test]
fn test_col_breaks() {
    let mut writer = PrintWriter::new();
    writer.add_col_break(5).add_col_break(10);

    let mut xml_writer = XmlWriter::new();
    writer.write_to(&mut xml_writer);
    let xml = String::from_utf8(xml_writer.finish()).unwrap();

    assert!(xml.contains("<colBreaks count=\"2\" manualBreakCount=\"2\">"));
    assert!(xml.contains("id=\"5\""));
    assert!(xml.contains("id=\"10\""));
    assert!(xml.contains("max=\"1048575\""));
    assert!(xml.contains("man=\"1\""));
    assert!(xml.contains("</colBreaks>"));
}

#[test]
fn test_row_breaks_sorted() {
    let mut writer = PrintWriter::new();
    writer.add_row_break(50).add_row_break(10).add_row_break(25);

    let mut xml_writer = XmlWriter::new();
    writer.write_to(&mut xml_writer);
    let xml = String::from_utf8(xml_writer.finish()).unwrap();

    // Breaks should be sorted
    let idx_10 = xml.find("id=\"10\"").unwrap();
    let idx_25 = xml.find("id=\"25\"").unwrap();
    let idx_50 = xml.find("id=\"50\"").unwrap();

    assert!(idx_10 < idx_25);
    assert!(idx_25 < idx_50);
}

#[test]
fn test_row_breaks_no_duplicates() {
    let mut writer = PrintWriter::new();
    writer
        .add_row_break(10)
        .add_row_break(10) // Duplicate
        .add_row_break(20);

    assert_eq!(writer.row_breaks.len(), 2);
}

#[test]
fn test_clear_breaks() {
    let mut writer = PrintWriter::new();
    writer.add_row_break(10).add_col_break(5);

    writer.clear_row_breaks().clear_col_breaks();

    assert!(writer.row_breaks.is_empty());
    assert!(writer.col_breaks.is_empty());
}

// -------------------------------------------------------------------------
// PrintWriter Utility Tests
// -------------------------------------------------------------------------

#[test]
fn test_print_writer_is_empty() {
    let writer = PrintWriter::new();
    assert!(writer.is_empty());

    let mut writer = PrintWriter::new();
    writer.paper_size(PaperSize::A4);
    assert!(!writer.is_empty());
}

#[test]
fn test_empty_writer_produces_no_output() {
    let writer = PrintWriter::new();
    let mut xml_writer = XmlWriter::new();
    writer.write_to(&mut xml_writer);

    assert!(xml_writer.finish().is_empty());
}

// -------------------------------------------------------------------------
// Complete XML Output Tests
// -------------------------------------------------------------------------

#[test]
fn test_complete_print_settings() {
    let mut writer = PrintWriter::new();

    // Page setup
    writer
        .paper_size(PaperSize::A4)
        .orientation(Orientation::Landscape)
        .scale(75)
        .dpi(300, 300);

    // Margins
    writer.set_margins(PageMargins::default());

    // Print options
    writer
        .center_horizontally()
        .print_gridlines(true)
        .print_headings(true);

    // Header/Footer
    writer.header_lcr("&F", "&A", "Page &P of &N").footer("&D");

    // Page breaks
    writer.add_row_break(25).add_row_break(50).add_col_break(5);

    let mut xml_writer = XmlWriter::new();
    writer.write_to(&mut xml_writer);
    let xml = String::from_utf8(xml_writer.finish()).unwrap();

    // Verify order: printOptions, pageMargins, pageSetup, headerFooter, rowBreaks, colBreaks
    let idx_print_options = xml.find("<printOptions").unwrap();
    let idx_page_margins = xml.find("<pageMargins").unwrap();
    let idx_page_setup = xml.find("<pageSetup").unwrap();
    let idx_header_footer = xml.find("<headerFooter").unwrap();
    let idx_row_breaks = xml.find("<rowBreaks").unwrap();
    let idx_col_breaks = xml.find("<colBreaks").unwrap();

    assert!(idx_print_options < idx_page_margins);
    assert!(idx_page_margins < idx_page_setup);
    assert!(idx_page_setup < idx_header_footer);
    assert!(idx_header_footer < idx_row_breaks);
    assert!(idx_row_breaks < idx_col_breaks);
}

#[test]
fn test_xml_special_characters_in_header() {
    let mut writer = PrintWriter::new();
    writer.header("Test < > &");

    let xml = String::from_utf8(writer.header_footer_xml().unwrap()).unwrap();

    // Special characters in element text should be escaped (< > &)
    // Note: quotes don't need escaping in element text content
    assert!(xml.contains("&lt;"));
    assert!(xml.contains("&gt;"));
    assert!(xml.contains("&amp;"));
}

// -------------------------------------------------------------------------
// Format F64 Tests
// -------------------------------------------------------------------------

#[test]
fn test_format_f64_integer() {
    assert_eq!(format_f64(1.0), "1");
    assert_eq!(format_f64(-10.0), "-10");
    assert_eq!(format_f64(0.0), "0");
}

#[test]
fn test_format_f64_decimal() {
    assert_eq!(format_f64(0.7), "0.7");
    assert_eq!(format_f64(0.75), "0.75");
    assert_eq!(format_f64(0.3), "0.3");
    assert_eq!(format_f64(12.34), "12.34");
}

#[test]
fn test_format_f64_trailing_zeros() {
    // Should trim trailing zeros
    assert_eq!(format_f64(1.50), "1.5");
    assert_eq!(format_f64(2.100), "2.1");
}

// -------------------------------------------------------------------------
// Integration Test
// -------------------------------------------------------------------------

#[test]
fn test_realistic_worksheet_print_settings() {
    let mut writer = PrintWriter::new();

    // Typical invoice/report settings
    writer
        .paper_size(PaperSize::Letter)
        .orientation(Orientation::Portrait)
        .fit_to_page(1, 0) // Fit to 1 page wide, auto height
        .set_margins(PageMargins {
            left: 0.5,
            right: 0.5,
            top: 1.0,
            bottom: 0.75,
            header: 0.5,
            footer: 0.3,
        })
        .center_horizontally()
        .header_lcr(
            &format!("{}{}", hf_codes::font("Arial", "Bold"), "Company Name"),
            hf_codes::SHEET_NAME,
            hf_codes::DATE,
        )
        .footer_lcr(
            "",
            &format!(
                "Page {} of {}",
                hf_codes::PAGE_NUMBER,
                hf_codes::TOTAL_PAGES
            ),
            "",
        )
        .print_gridlines(true);

    let mut xml_writer = XmlWriter::new();
    writer.write_to(&mut xml_writer);
    let xml = String::from_utf8(xml_writer.finish()).unwrap();

    // Verify key elements are present
    assert!(xml.contains("<printOptions"));
    assert!(xml.contains("<pageMargins"));
    assert!(xml.contains("<pageSetup"));
    assert!(xml.contains("<headerFooter"));
    assert!(xml.contains("fitToWidth=\"1\""));
    assert!(xml.contains("fitToHeight=\"0\""));
    assert!(xml.contains("horizontalCentered=\"1\""));
    assert!(xml.contains("gridLines=\"1\""));
}
