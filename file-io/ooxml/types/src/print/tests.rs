use super::*;

// -----------------------------------------------------------------------
// PaperSize
// -----------------------------------------------------------------------

#[test]
fn paper_size_default_is_letter() {
    assert_eq!(PaperSize::default(), PaperSize::Letter);
}

#[test]
fn paper_size_from_u32_known() {
    assert_eq!(PaperSize::from_u32(0), PaperSize::Other(0));
    assert_eq!(PaperSize::from_u32(1), PaperSize::Letter);
    assert_eq!(PaperSize::from_u32(5), PaperSize::Legal);
    assert_eq!(PaperSize::from_u32(9), PaperSize::A4);
    assert_eq!(PaperSize::from_u32(11), PaperSize::A5);
    assert_eq!(PaperSize::from_u32(41), PaperSize::GermanLegalFanfold);
}

#[test]
fn paper_size_from_u32_unknown_preserves_id() {
    assert_eq!(PaperSize::from_u32(42), PaperSize::Other(42));
    assert_eq!(PaperSize::from_u32(999), PaperSize::Other(999));
}

#[test]
fn paper_size_as_u32_roundtrip() {
    for id in 0..=41u32 {
        let paper = PaperSize::from_u32(id);
        assert_eq!(paper.as_u32(), id, "roundtrip failed for id {}", id);
    }
    // Other variant also round-trips
    assert_eq!(PaperSize::Other(42).as_u32(), 42);
}

#[test]
fn paper_size_as_str() {
    assert_eq!(PaperSize::Letter.as_str(), "Letter");
    assert_eq!(PaperSize::A4.as_str(), "A4");
    assert_eq!(PaperSize::Legal.as_str(), "Legal");
    assert_eq!(PaperSize::Other(0).as_str(), "Other");
    assert_eq!(PaperSize::Envelope10.as_str(), "Envelope #10");
    assert_eq!(PaperSize::B4.as_str(), "B4 (JIS)");
}

#[test]
fn paper_size_serde_bytes_exact() {
    assert_eq!(serde_json::to_string(&PaperSize::A4).unwrap(), "\"A4\"");
    assert_eq!(
        serde_json::to_string(&PaperSize::Other(42)).unwrap(),
        "{\"Other\":42}"
    );
}

// -----------------------------------------------------------------------
// Orientation
// -----------------------------------------------------------------------

#[test]
fn orientation_default_is_default() {
    assert_eq!(Orientation::default(), Orientation::Default);
}

#[test]
fn orientation_from_ooxml() {
    assert_eq!(Orientation::from_ooxml("default"), Orientation::Default);
    assert_eq!(Orientation::from_ooxml("portrait"), Orientation::Portrait);
    assert_eq!(Orientation::from_ooxml("landscape"), Orientation::Landscape);
    assert_eq!(Orientation::from_ooxml("unknown"), Orientation::Default);
    assert_eq!(Orientation::from_ooxml(""), Orientation::Default);
}

#[test]
fn orientation_to_ooxml() {
    assert_eq!(Orientation::Default.to_ooxml(), "default");
    assert_eq!(Orientation::Portrait.to_ooxml(), "portrait");
    assert_eq!(Orientation::Landscape.to_ooxml(), "landscape");
}

#[test]
fn orientation_roundtrip() {
    for v in [
        Orientation::Default,
        Orientation::Portrait,
        Orientation::Landscape,
    ] {
        assert_eq!(Orientation::from_ooxml(v.to_ooxml()), v);
    }
}

#[test]
fn small_enums_serde_bytes_exact() {
    assert_eq!(
        serde_json::to_string(&Orientation::Landscape).unwrap(),
        "\"Landscape\""
    );
    assert_eq!(
        serde_json::to_string(&PageOrder::OverThenDown).unwrap(),
        "\"OverThenDown\""
    );
    assert_eq!(
        serde_json::to_string(&CellComments::AsDisplayed).unwrap(),
        "\"AsDisplayed\""
    );
    assert_eq!(serde_json::to_string(&PrintErrors::NA).unwrap(), "\"NA\"");
}

// -----------------------------------------------------------------------
// PageOrder
// -----------------------------------------------------------------------

#[test]
fn page_order_default_is_down_then_over() {
    assert_eq!(PageOrder::default(), PageOrder::DownThenOver);
}

#[test]
fn page_order_from_ooxml() {
    assert_eq!(
        PageOrder::from_ooxml("downThenOver"),
        PageOrder::DownThenOver
    );
    assert_eq!(
        PageOrder::from_ooxml("overThenDown"),
        PageOrder::OverThenDown
    );
    assert_eq!(PageOrder::from_ooxml("unknown"), PageOrder::DownThenOver);
}

#[test]
fn page_order_to_ooxml() {
    assert_eq!(PageOrder::DownThenOver.to_ooxml(), "downThenOver");
    assert_eq!(PageOrder::OverThenDown.to_ooxml(), "overThenDown");
}

#[test]
fn page_order_roundtrip() {
    for v in [PageOrder::DownThenOver, PageOrder::OverThenDown] {
        assert_eq!(PageOrder::from_ooxml(v.to_ooxml()), v);
    }
}

// -----------------------------------------------------------------------
// CellComments
// -----------------------------------------------------------------------

#[test]
fn cell_comments_default_is_none() {
    assert_eq!(CellComments::default(), CellComments::None);
}

#[test]
fn cell_comments_from_ooxml() {
    assert_eq!(CellComments::from_ooxml("none"), CellComments::None);
    assert_eq!(CellComments::from_ooxml("atEnd"), CellComments::AtEnd);
    assert_eq!(
        CellComments::from_ooxml("asDisplayed"),
        CellComments::AsDisplayed
    );
    assert_eq!(CellComments::from_ooxml("bogus"), CellComments::None);
}

#[test]
fn cell_comments_to_ooxml() {
    assert_eq!(CellComments::None.to_ooxml(), "none");
    assert_eq!(CellComments::AtEnd.to_ooxml(), "atEnd");
    assert_eq!(CellComments::AsDisplayed.to_ooxml(), "asDisplayed");
}

#[test]
fn cell_comments_roundtrip() {
    for v in [
        CellComments::None,
        CellComments::AtEnd,
        CellComments::AsDisplayed,
    ] {
        assert_eq!(CellComments::from_ooxml(v.to_ooxml()), v);
    }
}

// -----------------------------------------------------------------------
// PrintErrors
// -----------------------------------------------------------------------

#[test]
fn print_errors_default_is_displayed() {
    assert_eq!(PrintErrors::default(), PrintErrors::Displayed);
}

#[test]
fn print_errors_from_ooxml() {
    assert_eq!(PrintErrors::from_ooxml("displayed"), PrintErrors::Displayed);
    assert_eq!(PrintErrors::from_ooxml("blank"), PrintErrors::Blank);
    assert_eq!(PrintErrors::from_ooxml("dash"), PrintErrors::Dash);
    assert_eq!(PrintErrors::from_ooxml("NA"), PrintErrors::NA);
    assert_eq!(PrintErrors::from_ooxml("other"), PrintErrors::Displayed);
}

#[test]
fn print_errors_to_ooxml() {
    assert_eq!(PrintErrors::Displayed.to_ooxml(), "displayed");
    assert_eq!(PrintErrors::Blank.to_ooxml(), "blank");
    assert_eq!(PrintErrors::Dash.to_ooxml(), "dash");
    assert_eq!(PrintErrors::NA.to_ooxml(), "NA");
}

#[test]
fn print_errors_roundtrip() {
    for v in [
        PrintErrors::Displayed,
        PrintErrors::Blank,
        PrintErrors::Dash,
        PrintErrors::NA,
    ] {
        assert_eq!(PrintErrors::from_ooxml(v.to_ooxml()), v);
    }
}

// -----------------------------------------------------------------------
// PageMargins
// -----------------------------------------------------------------------

#[test]
fn page_margins_default_matches_excel() {
    let m = PageMargins::default();
    assert!((m.left - 0.7).abs() < f64::EPSILON);
    assert!((m.right - 0.7).abs() < f64::EPSILON);
    assert!((m.top - 0.75).abs() < f64::EPSILON);
    assert!((m.bottom - 0.75).abs() < f64::EPSILON);
    assert!((m.header - 0.3).abs() < f64::EPSILON);
    assert!((m.footer - 0.3).abs() < f64::EPSILON);
}

#[test]
fn page_margins_excel_default_equals_default() {
    let a = PageMargins::default();
    let b = PageMargins::excel_default();
    assert_eq!(a, b);
}

#[test]
fn page_margins_new() {
    let m = PageMargins::new(1.0, 1.0, 1.5, 1.5, 0.5, 0.5);
    assert!((m.left - 1.0).abs() < f64::EPSILON);
    assert!((m.right - 1.0).abs() < f64::EPSILON);
    assert!((m.top - 1.5).abs() < f64::EPSILON);
    assert!((m.bottom - 1.5).abs() < f64::EPSILON);
    assert!((m.header - 0.5).abs() < f64::EPSILON);
    assert!((m.footer - 0.5).abs() < f64::EPSILON);
}

#[test]
fn page_margins_uniform() {
    let m = PageMargins::uniform(0.5);
    assert!((m.left - 0.5).abs() < f64::EPSILON);
    assert!((m.right - 0.5).abs() < f64::EPSILON);
    assert!((m.top - 0.5).abs() < f64::EPSILON);
    assert!((m.bottom - 0.5).abs() < f64::EPSILON);
    assert!((m.header - 0.5).abs() < f64::EPSILON);
    assert!((m.footer - 0.5).abs() < f64::EPSILON);
}

#[test]
fn page_margins_narrow() {
    let m = PageMargins::narrow();
    assert!((m.left - 0.25).abs() < f64::EPSILON);
    assert!((m.right - 0.25).abs() < f64::EPSILON);
    assert!((m.top - 0.75).abs() < f64::EPSILON);
    assert!((m.bottom - 0.75).abs() < f64::EPSILON);
    assert!((m.header - 0.3).abs() < f64::EPSILON);
    assert!((m.footer - 0.3).abs() < f64::EPSILON);
}

#[test]
fn page_margins_wide() {
    let m = PageMargins::wide();
    assert!((m.left - 1.0).abs() < f64::EPSILON);
    assert!((m.right - 1.0).abs() < f64::EPSILON);
    assert!((m.top - 1.0).abs() < f64::EPSILON);
    assert!((m.bottom - 1.0).abs() < f64::EPSILON);
    assert!((m.header - 0.5).abs() < f64::EPSILON);
    assert!((m.footer - 0.5).abs() < f64::EPSILON);
}

#[test]
fn page_margins_serde_bytes_exact() {
    let m = PageMargins::new(0.7, 0.7, 0.75, 0.75, 0.3, 0.3);
    assert_eq!(
        serde_json::to_string(&m).unwrap(),
        "{\"left\":0.7,\"right\":0.7,\"top\":0.75,\"bottom\":0.75,\"header\":0.3,\"footer\":0.3}"
    );
}

// -----------------------------------------------------------------------
// PageSetup
// -----------------------------------------------------------------------

#[test]
fn page_setup_default() {
    let ps = PageSetup::default();
    assert_eq!(ps.paper_size, PaperSize::Letter);
    assert_eq!(ps.orientation, Orientation::Default);
    assert_eq!(ps.scale, None);
    assert_eq!(ps.fit_to_width, None);
    assert_eq!(ps.fit_to_height, None);
    assert_eq!(ps.first_page_number, None);
    assert!(!ps.use_first_page_number);
    assert_eq!(ps.page_order, PageOrder::DownThenOver);
    assert!(!ps.black_and_white);
    assert!(!ps.draft);
    assert_eq!(ps.cell_comments, CellComments::None);
    assert_eq!(ps.print_errors, PrintErrors::Displayed);
    assert_eq!(ps.horizontal_dpi, None);
    assert_eq!(ps.vertical_dpi, None);
    assert_eq!(ps.copies, None);
    assert_eq!(ps.paper_width, None);
    assert_eq!(ps.paper_height, None);
    assert!(ps.use_printer_defaults);
    assert_eq!(ps.r_id, None);
}

#[test]
fn page_setup_serde_bytes_exact() {
    let ps = PageSetup {
        paper_size: PaperSize::A4,
        paper_width: Some(UniversalMeasure::millimeters(210.0)),
        paper_height: Some(UniversalMeasure::millimeters(297.0)),
        orientation: Orientation::Landscape,
        scale: Some(95),
        fit_to_width: Some(1),
        fit_to_height: Some(2),
        first_page_number: Some(3),
        use_first_page_number: true,
        page_order: PageOrder::OverThenDown,
        black_and_white: true,
        draft: true,
        cell_comments: CellComments::AtEnd,
        print_errors: PrintErrors::Dash,
        horizontal_dpi: Some(600),
        vertical_dpi: Some(601),
        copies: Some(2),
        use_printer_defaults: false,
        r_id: Some("rId1".to_string()),
    };
    assert_eq!(
        serde_json::to_string(&ps).unwrap(),
        "{\"paper_size\":\"A4\",\"paper_width\":{\"raw\":\"210mm\"},\"paper_height\":{\"raw\":\"297mm\"},\"orientation\":\"Landscape\",\"scale\":95,\"fit_to_width\":1,\"fit_to_height\":2,\"first_page_number\":3,\"use_first_page_number\":true,\"page_order\":\"OverThenDown\",\"black_and_white\":true,\"draft\":true,\"cell_comments\":\"AtEnd\",\"print_errors\":\"Dash\",\"horizontal_dpi\":600,\"vertical_dpi\":601,\"copies\":2,\"use_printer_defaults\":false,\"r_id\":\"rId1\"}"
    );
}

// -----------------------------------------------------------------------
// UniversalMeasure
// -----------------------------------------------------------------------

#[test]
fn universal_measure_parse_inches() {
    let m = UniversalMeasure::from_ooxml("8.5in").unwrap();
    assert_eq!(m.to_ooxml(), "8.5in");
    assert!((m.to_inches() - 8.5).abs() < f64::EPSILON);
    assert_eq!(m.unit(), MeasureUnit::Inches);
    assert!((m.value() - 8.5).abs() < f64::EPSILON);
}

#[test]
fn universal_measure_parse_mm() {
    let m = UniversalMeasure::from_ooxml("210mm").unwrap();
    assert_eq!(m.to_ooxml(), "210mm");
    assert!((m.to_inches() - 210.0 / 25.4).abs() < 0.001);
    assert!((m.to_mm() - 210.0).abs() < 0.001);
    assert_eq!(m.unit(), MeasureUnit::Millimeters);
}

#[test]
fn universal_measure_parse_cm() {
    let m = UniversalMeasure::from_ooxml("21cm").unwrap();
    assert!((m.to_inches() - 21.0 / 2.54).abs() < 0.001);
    assert_eq!(m.unit(), MeasureUnit::Centimeters);
}

#[test]
fn universal_measure_parse_pt() {
    let m = UniversalMeasure::from_ooxml("72pt").unwrap();
    assert!((m.to_inches() - 1.0).abs() < f64::EPSILON);
    assert_eq!(m.unit(), MeasureUnit::Points);
}

#[test]
fn universal_measure_parse_emu() {
    let m = UniversalMeasure::from_ooxml("914400emu").unwrap();
    assert!((m.to_inches() - 1.0).abs() < 0.001);
    assert_eq!(m.unit(), MeasureUnit::Emu);
}

#[test]
fn universal_measure_constructors() {
    assert_eq!(UniversalMeasure::inches(8.5).to_ooxml(), "8.5in");
    assert_eq!(UniversalMeasure::millimeters(210.0).to_ooxml(), "210mm");
    assert_eq!(UniversalMeasure::centimeters(21.0).to_ooxml(), "21cm");
    assert_eq!(UniversalMeasure::points(72.0).to_ooxml(), "72pt");
    assert_eq!(UniversalMeasure::picas(12.0).to_ooxml(), "12pc");
}

#[test]
fn universal_measure_invalid() {
    assert!(UniversalMeasure::from_ooxml("").is_none());
    assert!(UniversalMeasure::from_ooxml("hello").is_none());
    assert!(UniversalMeasure::from_ooxml("123").is_none());
    assert!(UniversalMeasure::from_ooxml("12px").is_none());
    assert!(UniversalMeasure::from_ooxml("12MM").is_none());
    assert!(UniversalMeasure::from_ooxml("12mmin").is_none());
    assert!(UniversalMeasure::from_ooxml("12inch").is_none());
}

#[test]
fn universal_measure_serde_roundtrip() {
    let m = UniversalMeasure::from_ooxml("210mm").unwrap();
    let json = serde_json::to_string(&m).unwrap();
    let m2: UniversalMeasure = serde_json::from_str(&json).unwrap();
    assert_eq!(m, m2);
}

#[test]
fn universal_measure_whitespace_trimmed() {
    let m = UniversalMeasure::from_ooxml("  8.5in  ").unwrap();
    assert_eq!(m.to_ooxml(), "8.5in");
}

#[test]
fn universal_measure_picas_aliases() {
    let pc = UniversalMeasure::from_ooxml("12pc").unwrap();
    let pi = UniversalMeasure::from_ooxml("12pi").unwrap();
    assert_eq!(pc.unit(), MeasureUnit::Picas);
    assert_eq!(pi.unit(), MeasureUnit::Picas);
    assert_eq!(UniversalMeasure::picas(12.0).to_ooxml(), "12pc");
}

#[test]
fn universal_measure_scientific_and_negative_values() {
    let scientific = UniversalMeasure::from_ooxml("1e2mm").unwrap();
    assert_eq!(scientific.unit(), MeasureUnit::Millimeters);
    assert!((scientific.value() - 100.0).abs() < f64::EPSILON);

    let negative = UniversalMeasure::from_ooxml("-1in").unwrap();
    assert_eq!(negative.unit(), MeasureUnit::Inches);
    assert!((negative.value() + 1.0).abs() < f64::EPSILON);
}

#[test]
fn universal_measure_serde_bytes_exact() {
    let m = UniversalMeasure::from_ooxml("210mm").unwrap();
    assert_eq!(serde_json::to_string(&m).unwrap(), "{\"raw\":\"210mm\"}");
}

// -----------------------------------------------------------------------
// PrintOptions
// -----------------------------------------------------------------------

#[test]
fn print_options_default() {
    let po = PrintOptions::default();
    assert!(!po.grid_lines);
    assert!(!po.headings);
    assert!(!po.horizontal_centered);
    assert!(!po.vertical_centered);
    assert!(po.grid_lines_set);
}

#[test]
fn print_options_serde_bytes_exact() {
    let po = PrintOptions {
        grid_lines: true,
        headings: true,
        horizontal_centered: true,
        vertical_centered: false,
        grid_lines_set: true,
    };
    assert_eq!(
        serde_json::to_string(&po).unwrap(),
        "{\"grid_lines\":true,\"headings\":true,\"horizontal_centered\":true,\"vertical_centered\":false,\"grid_lines_set\":true}"
    );
}

// -----------------------------------------------------------------------
// HeaderFooterSection
// -----------------------------------------------------------------------

#[test]
fn hf_section_left_only() {
    let section = HeaderFooterSection::parse("&LLeft Content");
    assert_eq!(section.left, "Left Content");
    assert!(section.center.is_empty());
    assert!(section.right.is_empty());
}

#[test]
fn hf_section_center_only() {
    let section = HeaderFooterSection::parse("&CCenter Content");
    assert!(section.left.is_empty());
    assert_eq!(section.center, "Center Content");
    assert!(section.right.is_empty());
}

#[test]
fn hf_section_right_only() {
    let section = HeaderFooterSection::parse("&RRight Content");
    assert!(section.left.is_empty());
    assert!(section.center.is_empty());
    assert_eq!(section.right, "Right Content");
}

#[test]
fn hf_section_all_three() {
    let section = HeaderFooterSection::parse("&LLeft&CCenter&RRight");
    assert_eq!(section.left, "Left");
    assert_eq!(section.center, "Center");
    assert_eq!(section.right, "Right");
}

#[test]
fn hf_section_with_format_codes() {
    let section = HeaderFooterSection::parse("&LPage &P of &N&C&D&R&F");
    assert_eq!(section.left, "Page &P of &N");
    assert_eq!(section.center, "&D");
    assert_eq!(section.right, "&F");
}

#[test]
fn hf_section_default_to_center() {
    let section = HeaderFooterSection::parse("Just Text");
    assert!(section.left.is_empty());
    assert_eq!(section.center, "Just Text");
    assert!(section.right.is_empty());
}

#[test]
fn hf_section_case_insensitive() {
    let section = HeaderFooterSection::parse("&lleft&ccenter&rright");
    assert_eq!(section.left, "left");
    assert_eq!(section.center, "center");
    assert_eq!(section.right, "right");
}

#[test]
fn hf_section_trailing_ampersand() {
    let section = HeaderFooterSection::parse("&LText&");
    assert_eq!(section.left, "Text&");
}

#[test]
fn hf_section_is_empty() {
    let empty = HeaderFooterSection::default();
    assert!(empty.is_empty());

    let non_empty = HeaderFooterSection::parse("&CContent");
    assert!(!non_empty.is_empty());
}

#[test]
fn hf_section_empty_string() {
    let section = HeaderFooterSection::parse("");
    assert!(section.is_empty());
}

#[test]
fn hf_section_marker_edge_cases() {
    let repeated = HeaderFooterSection::parse("&Lone&Ccenter&Ltwo&Rright&Lthree");
    assert_eq!(repeated.left, "onetwothree");
    assert_eq!(repeated.center, "center");
    assert_eq!(repeated.right, "right");

    let adjacent = HeaderFooterSection::parse("&L&C&R");
    assert!(adjacent.is_empty());

    let before_marker = HeaderFooterSection::parse("&P&N&Ccenter");
    assert_eq!(before_marker.center, "&P&Ncenter");

    let escaped_marker = HeaderFooterSection::parse("&&L");
    assert_eq!(escaped_marker.center, "&&L");
}

#[test]
fn hf_section_serde_bytes_exact() {
    let section = HeaderFooterSection {
        left: "L".to_string(),
        center: "C".to_string(),
        right: "R".to_string(),
    };
    assert_eq!(
        serde_json::to_string(&section).unwrap(),
        "{\"left\":\"L\",\"center\":\"C\",\"right\":\"R\"}"
    );
}

// -----------------------------------------------------------------------
// HeaderFooter
// -----------------------------------------------------------------------

#[test]
fn header_footer_default() {
    let hf = HeaderFooter::default();
    assert!(hf.odd_header.is_none());
    assert!(hf.odd_footer.is_none());
    assert!(hf.even_header.is_none());
    assert!(hf.even_footer.is_none());
    assert!(hf.first_header.is_none());
    assert!(hf.first_footer.is_none());
    assert!(!hf.different_odd_even);
    assert!(!hf.different_first);
    assert_eq!(hf.scale_with_doc, None);
    assert_eq!(hf.align_with_margins, None);
}

#[test]
fn header_footer_odd_header_sections() {
    let hf = HeaderFooter {
        odd_header: Some("&LLeft&CCenter&RRight".to_string()),
        ..Default::default()
    };
    let sections = hf.odd_header_sections();
    assert_eq!(sections.left, "Left");
    assert_eq!(sections.center, "Center");
    assert_eq!(sections.right, "Right");
}

#[test]
fn header_footer_odd_footer_sections() {
    let hf = HeaderFooter {
        odd_footer: Some("&CPage &P".to_string()),
        ..Default::default()
    };
    let sections = hf.odd_footer_sections();
    assert!(sections.left.is_empty());
    assert_eq!(sections.center, "Page &P");
    assert!(sections.right.is_empty());
}

#[test]
fn header_footer_sections_none() {
    let hf = HeaderFooter::default();
    let sections = hf.odd_header_sections();
    assert!(sections.is_empty());
}

#[test]
fn header_footer_serde_bytes_exact() {
    let hf = HeaderFooter {
        odd_header: Some("&LLeft".to_string()),
        odd_footer: None,
        even_header: Some("&CEven".to_string()),
        even_footer: None,
        first_header: Some("&RFirst".to_string()),
        first_footer: Some("&CFirst footer".to_string()),
        different_odd_even: true,
        different_first: true,
        scale_with_doc: Some(false),
        align_with_margins: None,
    };
    assert_eq!(
        serde_json::to_string(&hf).unwrap(),
        "{\"odd_header\":\"&LLeft\",\"odd_footer\":null,\"even_header\":\"&CEven\",\"even_footer\":null,\"first_header\":\"&RFirst\",\"first_footer\":\"&CFirst footer\",\"different_odd_even\":true,\"different_first\":true,\"scale_with_doc\":false,\"align_with_margins\":null}"
    );
}

// -----------------------------------------------------------------------
// PageBreak / PageBreaks
// -----------------------------------------------------------------------

#[test]
fn page_break_default() {
    let brk = PageBreak::default();
    assert_eq!(brk.id, 0);
    assert_eq!(brk.min, 0);
    assert_eq!(brk.max, 0);
    assert!(!brk.manual);
    assert!(!brk.pt);
}

#[test]
fn page_break_serde_bytes_exact() {
    let brk = PageBreak {
        id: 5,
        min: 1,
        max: 10,
        manual: true,
        pt: false,
    };
    assert_eq!(
        serde_json::to_string(&brk).unwrap(),
        "{\"id\":5,\"min\":1,\"max\":10,\"manual\":true,\"pt\":false}"
    );
}

#[test]
fn page_breaks_default() {
    let pb = PageBreaks::default();
    assert_eq!(pb.count, None);
    assert_eq!(pb.manual_break_count, None);
    assert!(pb.breaks.is_empty());
}

#[test]
fn page_breaks_manual_breaks_iterator() {
    let pb = PageBreaks {
        count: Some(3),
        manual_break_count: Some(2),
        breaks: vec![
            PageBreak {
                id: 5,
                min: 0,
                max: 16383,
                manual: true,
                pt: false,
            },
            PageBreak {
                id: 7,
                min: 0,
                max: 16383,
                manual: false,
                pt: false,
            },
            PageBreak {
                id: 10,
                min: 0,
                max: 16383,
                manual: true,
                pt: false,
            },
        ],
    };
    let manual: Vec<_> = pb.manual_breaks().collect();
    assert_eq!(manual.len(), 2);
    assert_eq!(manual[0].id, 5);
    assert_eq!(manual[1].id, 10);
}

#[test]
fn page_breaks_manual_breaks_empty() {
    let pb = PageBreaks::default();
    assert_eq!(pb.manual_breaks().count(), 0);
}

#[test]
fn page_breaks_serde_bytes_exact() {
    let pb = PageBreaks {
        count: Some(1),
        manual_break_count: None,
        breaks: vec![PageBreak {
            id: 5,
            min: 1,
            max: 10,
            manual: true,
            pt: false,
        }],
    };
    assert_eq!(
        serde_json::to_string(&pb).unwrap(),
        "{\"count\":1,\"manual_break_count\":null,\"breaks\":[{\"id\":5,\"min\":1,\"max\":10,\"manual\":true,\"pt\":false}]}"
    );
}

// -----------------------------------------------------------------------
// hf_codes module
// -----------------------------------------------------------------------

#[test]
fn hf_codes_constants() {
    assert_eq!(hf_codes::PAGE_NUMBER, "&P");
    assert_eq!(hf_codes::TOTAL_PAGES, "&N");
    assert_eq!(hf_codes::DATE, "&D");
    assert_eq!(hf_codes::TIME, "&T");
    assert_eq!(hf_codes::FILE_PATH, "&Z");
    assert_eq!(hf_codes::FILE_NAME, "&F");
    assert_eq!(hf_codes::SHEET_NAME, "&A");
    assert_eq!(hf_codes::BOLD_ON, "&B");
    assert_eq!(hf_codes::ITALIC_ON, "&I");
    assert_eq!(hf_codes::UNDERLINE_ON, "&U");
    assert_eq!(hf_codes::STRIKETHROUGH_ON, "&S");
    assert_eq!(hf_codes::SUBSCRIPT_ON, "&Y");
    assert_eq!(hf_codes::SUPERSCRIPT_ON, "&X");
    assert_eq!(hf_codes::LEFT_SECTION, "&L");
    assert_eq!(hf_codes::CENTER_SECTION, "&C");
    assert_eq!(hf_codes::RIGHT_SECTION, "&R");
    assert_eq!(hf_codes::DOUBLE_UNDERLINE_ON, "&E");
    assert_eq!(hf_codes::PICTURE, "&G");
}

#[test]
fn hf_codes_font() {
    assert_eq!(hf_codes::font("Arial", "Bold"), "&\"Arial,Bold\"");
    assert_eq!(hf_codes::font("Calibri", "Regular"), "&\"Calibri,Regular\"");
}

#[test]
fn hf_codes_font_size() {
    assert_eq!(hf_codes::font_size(12), "&12");
    assert_eq!(hf_codes::font_size(8), "&8");
}

#[test]
fn hf_codes_font_color() {
    assert_eq!(hf_codes::font_color("FF0000"), "&KFF0000");
    assert_eq!(hf_codes::font_color("000000"), "&K000000");
}

#[test]
fn hf_codes_compose_header() {
    // Build a complete header: left has bold sheet name, center has date, right has page X of Y
    let header = format!(
        "{}{}{}{}{}{}Page {} of {}",
        hf_codes::LEFT_SECTION,
        hf_codes::BOLD_ON,
        hf_codes::SHEET_NAME,
        hf_codes::CENTER_SECTION,
        hf_codes::DATE,
        hf_codes::RIGHT_SECTION,
        hf_codes::PAGE_NUMBER,
        hf_codes::TOTAL_PAGES,
    );
    assert_eq!(header, "&L&B&A&C&D&RPage &P of &N");

    // Verify it parses correctly
    let section = HeaderFooterSection::parse(&header);
    assert_eq!(section.left, "&B&A");
    assert_eq!(section.center, "&D");
    assert_eq!(section.right, "Page &P of &N");
}
