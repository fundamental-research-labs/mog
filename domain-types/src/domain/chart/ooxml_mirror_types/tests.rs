use super::*;
use ooxml_types::charts as ocharts;
use ooxml_types::themes as othemes;

#[test]
fn protection_round_trip_full() {
    let original = ocharts::ChartProtection {
        chart_object: Some(true),
        data: Some(false),
        formatting: Some(true),
        selection: Some(false),
        user_interface: Some(true),
    };
    let dom: ChartProtection = (&original).into();
    let round: ocharts::ChartProtection = dom.into();
    assert_eq!(original, round);
}

#[test]
fn protection_default_emits_no_keys() {
    let p = ChartProtection::default();
    assert_eq!(serde_json::to_string(&p).unwrap(), "{}");
}

#[test]
fn print_settings_round_trip_full() {
    let original = ocharts::PrintSettings {
        header_footer: Some(ooxml_types::print::HeaderFooter {
            odd_header: Some("H".into()),
            odd_footer: Some("F".into()),
            even_header: None,
            even_footer: None,
            first_header: None,
            first_footer: None,
            different_odd_even: true,
            different_first: false,
            scale_with_doc: Some(true),
            align_with_margins: Some(false),
        }),
        page_margins: Some(ocharts::PageMargins {
            left: 1.0,
            right: 1.0,
            top: 0.5,
            bottom: 0.5,
            header: 0.25,
            footer: 0.25,
        }),
        page_setup: Some(ocharts::PageSetup {
            paper_size: Some(9),
            paper_height: Some("297mm".into()),
            paper_width: Some("210mm".into()),
            first_page_number: Some(1),
            orientation: Some(ocharts::PageOrientation::Landscape),
            black_and_white: Some(true),
            draft: None,
            use_first_page_number: Some(true),
            horizontal_dpi: Some(300),
            vertical_dpi: Some(300),
            copies: Some(2),
        }),
        legacy_drawing_hf: Some("rId5".into()),
    };
    let dom: ChartPrintSettings = (&original).into();
    let round: ocharts::PrintSettings = dom.into();
    assert_eq!(original, round);
}

#[test]
fn print_settings_default_emits_no_keys() {
    let p = ChartPrintSettings::default();
    assert_eq!(serde_json::to_string(&p).unwrap(), "{}");
}

#[test]
fn pivot_source_round_trip_empty_ext() {
    let original = ocharts::PivotSource {
        name: "PivotTable1".into(),
        fmt_id: 0,
        extensions: Vec::new(),
    };
    let dom: ChartPivotSource = (&original).into();
    let round: ocharts::PivotSource = dom.into();
    assert_eq!(original, round);
}

#[test]
fn pivot_source_round_trip_extensions() {
    let original = ocharts::PivotSource {
        name: "PivotTable1".into(),
        fmt_id: 7,
        extensions: vec![extension_entry()],
    };
    let dom: ChartPivotSource = (&original).into();
    let round: ocharts::PivotSource = dom.into();
    assert_eq!(original, round);
}

#[test]
fn pivot_format_round_trip_empty() {
    let original = ocharts::PivotFmt {
        idx: 2,
        sp_pr: None,
        tx_pr: None,
        marker: None,
        d_lbl: None,
        extensions: Vec::new(),
    };
    let dom: ChartPivotFormat = (&original).into();
    let round: ocharts::PivotFmt = dom.into();
    assert_eq!(original, round);
}

#[test]
fn pivot_format_round_trip_inner_extensions() {
    let original = ocharts::PivotFmt {
        idx: 4,
        sp_pr: None,
        tx_pr: None,
        marker: None,
        d_lbl: None,
        extensions: vec![extension_entry()],
    };
    let dom: ChartPivotFormat = (&original).into();
    assert!(dom.inner.is_some());
    let round: ocharts::PivotFmt = dom.into();
    assert_eq!(original, round);
}

#[test]
fn pivot_format_malformed_inner_falls_back_to_empty_nested_fields() {
    let dom = ChartPivotFormat {
        idx: 9,
        inner: Some("{".into()),
    };
    let round: ocharts::PivotFmt = dom.into();
    assert_eq!(round.idx, 9);
    assert!(round.sp_pr.is_none());
    assert!(round.tx_pr.is_none());
    assert!(round.marker.is_none());
    assert!(round.d_lbl.is_none());
    assert!(round.extensions.is_empty());
}

#[test]
fn color_mapping_override_master() {
    let original = othemes::ColorMappingOverride::MasterClrMapping;
    let dom: ChartColorMappingOverride = (&original).into();
    let round: othemes::ColorMappingOverride = dom.into();
    assert_eq!(original, round);
}

#[test]
fn color_mapping_override_full() {
    let mapping = color_mapping();
    let original = othemes::ColorMappingOverride::OverrideClrMapping(mapping.clone());
    let dom: ChartColorMappingOverride = (&original).into();
    let round: othemes::ColorMappingOverride = dom.into();
    assert_eq!(original, round);
}

#[test]
fn color_mapping_override_serde_tagged_shape() {
    assert_eq!(
        serde_json::to_string(&ChartColorMappingOverride::Master).unwrap(),
        r#"{"kind":"master"}"#
    );

    let dom = ChartColorMappingOverride::Override((&color_mapping()).into());
    let json = serde_json::to_string(&dom).unwrap();
    assert!(json.contains(r#""kind":"override""#));
    let round: ChartColorMappingOverride = serde_json::from_str(&json).unwrap();
    assert_eq!(dom, round);
}

#[test]
fn waterfall_options_default_emits_no_keys() {
    let w = WaterfallOptions::default();
    assert_eq!(serde_json::to_string(&w).unwrap(), "{}");
}

#[test]
fn waterfall_options_round_trips_via_serde() {
    let w = WaterfallOptions {
        subtotal_indices: vec![0, 3, 7],
        show_connector_lines: Some(true),
    };
    let json = serde_json::to_string(&w).unwrap();
    let back: WaterfallOptions = serde_json::from_str(&json).unwrap();
    assert_eq!(w, back);
}

#[test]
fn chart_type_config_round_trip_bar() {
    let original = ocharts::ChartTypeConfig::Bar(ocharts::BarChartConfig {
        bar_dir: ocharts::BarDirection::Column,
        grouping: Some(ocharts::Grouping::Clustered),
        vary_colors: Some(false),
        gap_width: Some(150),
        overlap: Some(-20),
        ser: Vec::new(),
        d_lbls: None,
        ser_lines: Vec::new(),
        extensions: Vec::new(),
    });
    let dom: ChartTypeConfig = (&original).into();
    assert_eq!(dom.kind, OoxmlChartTypeKind::Bar);
    let round: ocharts::ChartTypeConfig = dom.into();
    assert_eq!(original, round);
}

#[test]
fn chart_type_config_combo() {
    let original = ocharts::ChartTypeConfig::Combo;
    let dom: ChartTypeConfig = (&original).into();
    assert_eq!(dom.kind, OoxmlChartTypeKind::Combo);
    assert!(dom.inner.is_none());
    let round: ocharts::ChartTypeConfig = dom.into();
    assert_eq!(original, round);
}

#[test]
fn chart_type_config_missing_inner_falls_back_to_default_config() {
    assert_default_config(OoxmlChartTypeKind::Bar);
    assert_default_config(OoxmlChartTypeKind::Line);
    assert_default_config(OoxmlChartTypeKind::Pie);
    assert_default_config(OoxmlChartTypeKind::Surface3D);
    assert_default_config(OoxmlChartTypeKind::OfPie);
}

#[test]
fn chart_type_config_malformed_inner_falls_back_to_default_config() {
    for kind in [
        OoxmlChartTypeKind::Bar,
        OoxmlChartTypeKind::Line,
        OoxmlChartTypeKind::Pie,
        OoxmlChartTypeKind::Surface3D,
        OoxmlChartTypeKind::OfPie,
    ] {
        let round: ocharts::ChartTypeConfig = ChartTypeConfig {
            kind,
            inner: Some("{".into()),
        }
        .into();
        assert_eq!(round.chart_type(), kind.into());
    }
}

#[test]
fn chart_type_kind_all_variants_round_trip() {
    for v in [
        ocharts::ChartType::Unknown,
        ocharts::ChartType::Bar,
        ocharts::ChartType::Bar3D,
        ocharts::ChartType::Line,
        ocharts::ChartType::Line3D,
        ocharts::ChartType::Pie,
        ocharts::ChartType::Pie3D,
        ocharts::ChartType::Doughnut,
        ocharts::ChartType::Area,
        ocharts::ChartType::Area3D,
        ocharts::ChartType::Scatter,
        ocharts::ChartType::Bubble,
        ocharts::ChartType::Radar,
        ocharts::ChartType::Surface,
        ocharts::ChartType::Surface3D,
        ocharts::ChartType::Stock,
        ocharts::ChartType::OfPie,
        ocharts::ChartType::Combo,
    ] {
        let dom: OoxmlChartTypeKind = v.into();
        let round: ocharts::ChartType = dom.into();
        assert_eq!(v, round);
    }
}

fn extension_entry() -> ocharts::ExtensionEntry {
    ocharts::ExtensionEntry {
        uri: "{pivot-source-ext}".into(),
        xml: "<c15:pivotSourceExt/>".into(),
    }
}

fn color_mapping() -> othemes::ColorMapping {
    othemes::ColorMapping {
        bg1: othemes::ColorSchemeIndex::Lt2,
        tx1: othemes::ColorSchemeIndex::Dk1,
        bg2: othemes::ColorSchemeIndex::Lt1,
        tx2: othemes::ColorSchemeIndex::Dk2,
        accent1: othemes::ColorSchemeIndex::Accent1,
        accent2: othemes::ColorSchemeIndex::Accent2,
        accent3: othemes::ColorSchemeIndex::Accent3,
        accent4: othemes::ColorSchemeIndex::Accent4,
        accent5: othemes::ColorSchemeIndex::Accent5,
        accent6: othemes::ColorSchemeIndex::Accent6,
        hlink: othemes::ColorSchemeIndex::Hlink,
        fol_hlink: othemes::ColorSchemeIndex::FolHlink,
        ext_lst: None,
    }
}

fn assert_default_config(kind: OoxmlChartTypeKind) {
    let round: ocharts::ChartTypeConfig = ChartTypeConfig { kind, inner: None }.into();
    assert_eq!(round.chart_type(), kind.into());
}
