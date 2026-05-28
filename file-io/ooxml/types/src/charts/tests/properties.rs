use crate::charts::*;

#[test]
fn view_3d_default() {
    let v = View3D::default();
    assert_eq!(v.rot_x, None);
    assert_eq!(v.rot_y, None);
    assert_eq!(v.right_angle_axes, None);
    assert_eq!(v.perspective, None);
    assert_eq!(v.height_percent, None);
    assert_eq!(v.depth_percent, None);
}
#[test]
fn data_label_options_default() {
    let opts = DataLabelOptions::default();
    assert!(!opts.show_value);
    assert!(!opts.show_category);
    assert!(!opts.show_series_name);
    assert!(!opts.show_percent);
    assert!(!opts.show_legend_key);
    assert!(!opts.show_bubble_size);
    assert_eq!(opts.position, DataLabelPosition::BestFit);
    assert!(opts.separator.is_none());
    assert!(opts.num_fmt.is_none());
    assert!(opts.sp_pr.is_none());
    assert!(opts.tx_pr.is_none());
    assert!(opts.show_leader_lines.is_none());
    assert!(opts.leader_lines.is_none());
    assert!(opts.num_fmt_obj.is_none());
}

// --------------------------------------------------
// StockType (no OOXML string -- just default test)
// --------------------------------------------------
#[test]
fn chart_protection_default() {
    let p = ChartProtection::default();
    assert_eq!(p.chart_object, None);
    assert_eq!(p.data, None);
    assert_eq!(p.formatting, None);
    assert_eq!(p.selection, None);
    assert_eq!(p.user_interface, None);
    // Effective values default to false
    assert!(!p.effective_chart_object());
    assert!(!p.effective_data());
    assert!(!p.effective_formatting());
    assert!(!p.effective_selection());
    assert!(!p.effective_user_interface());
}

// --------------------------------------------------
// PageMargins default
// --------------------------------------------------
#[test]
fn page_margins_default() {
    let m = PageMargins::default();
    assert!((m.left - 0.7).abs() < f64::EPSILON);
    assert!((m.right - 0.7).abs() < f64::EPSILON);
    assert!((m.top - 0.75).abs() < f64::EPSILON);
    assert!((m.bottom - 0.75).abs() < f64::EPSILON);
    assert!((m.header - 0.3).abs() < f64::EPSILON);
    assert!((m.footer - 0.3).abs() < f64::EPSILON);
}

// --------------------------------------------------
// NumFmt default
// --------------------------------------------------
#[test]
fn num_fmt_default() {
    let nf = NumFmt::default();
    assert!(nf.format_code.is_empty());
    assert_eq!(nf.source_linked, None);
}

// --------------------------------------------------
// Data source types
// --------------------------------------------------
#[test]
fn data_label_with_num_fmt() {
    let label = DataLabel {
        idx: 0,
        num_fmt: Some(NumFmt {
            format_code: "0.00%".to_string(),
            source_linked: Some(false),
        }),
        ..Default::default()
    };
    assert_eq!(label.num_fmt.as_ref().unwrap().format_code, "0.00%");
    assert_eq!(label.num_fmt.as_ref().unwrap().source_linked, Some(false));
}

// --------------------------------------------------
// DataLabelOptions.delete + .d_lbl
// --------------------------------------------------
#[test]
fn data_label_options_with_delete() {
    let opts = DataLabelOptions {
        delete: Some(true),
        ..Default::default()
    };
    assert_eq!(opts.delete, Some(true));
}
#[test]
fn data_label_options_with_individual_overrides() {
    let opts = DataLabelOptions {
        d_lbl: vec![
            DataLabel {
                idx: 0,
                ..Default::default()
            },
            DataLabel {
                idx: 3,
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    assert_eq!(opts.d_lbl.len(), 2);
    assert_eq!(opts.d_lbl[0].idx, 0);
    assert_eq!(opts.d_lbl[1].idx, 3);
}
#[test]
fn data_label_options_default_has_no_delete_no_d_lbl() {
    let opts = DataLabelOptions::default();
    assert!(opts.delete.is_none());
    assert!(opts.d_lbl.is_empty());
}

// --------------------------------------------------
// PageOrientation + PageSetup
// --------------------------------------------------
#[test]
fn page_setup_all_fields() {
    let ps = PageSetup {
        paper_size: Some(1),
        paper_height: Some("297mm".to_string()),
        paper_width: Some("210mm".to_string()),
        first_page_number: Some(1),
        orientation: Some(PageOrientation::Landscape),
        black_and_white: Some(false),
        draft: Some(true),
        use_first_page_number: Some(true),
        horizontal_dpi: Some(600),
        vertical_dpi: Some(600),
        copies: Some(2),
    };
    assert_eq!(ps.paper_size, Some(1));
    assert_eq!(ps.orientation, Some(PageOrientation::Landscape));
    assert_eq!(ps.horizontal_dpi, Some(600));
    assert_eq!(ps.copies, Some(2));
}

// --------------------------------------------------
// DisplayUnitKind + DisplayUnits
// --------------------------------------------------
#[test]
fn display_unit_kind_built_in() {
    let du = DisplayUnits {
        kind: Some(DisplayUnitKind::BuiltIn(BuiltInUnit::Millions)),
        disp_units_lbl: None,
        ..Default::default()
    };
    match du.kind {
        Some(DisplayUnitKind::BuiltIn(BuiltInUnit::Millions)) => {} // ok
        _ => panic!("expected BuiltIn(Millions)"),
    }
}
#[test]
fn display_unit_kind_custom() {
    let du = DisplayUnits {
        kind: Some(DisplayUnitKind::Custom(1000.0)),
        disp_units_lbl: None,
        ..Default::default()
    };
    match du.kind {
        Some(DisplayUnitKind::Custom(v)) => assert!((v - 1000.0).abs() < f64::EPSILON),
        _ => panic!("expected Custom(1000.0)"),
    }
}
#[test]
fn display_units_default_has_no_kind() {
    let du = DisplayUnits::default();
    assert!(du.kind.is_none());
    assert!(du.disp_units_lbl.is_none());
}

// --------------------------------------------------
// LegendEntry mutual exclusivity
// --------------------------------------------------
