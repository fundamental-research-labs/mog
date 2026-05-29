use super::merge::{col_to_letters, to_a1};
use super::*;

// -- A1 helpers --------------------------------------------------------

#[test]
fn col_to_letters_single() {
    assert_eq!(col_to_letters(0), "A");
    assert_eq!(col_to_letters(1), "B");
    assert_eq!(col_to_letters(25), "Z");
}

#[test]
fn col_to_letters_double() {
    assert_eq!(col_to_letters(26), "AA");
    assert_eq!(col_to_letters(27), "AB");
    assert_eq!(col_to_letters(701), "ZZ");
}

#[test]
fn col_to_letters_triple() {
    assert_eq!(col_to_letters(702), "AAA");
}

#[test]
fn to_a1_basic() {
    assert_eq!(to_a1(0, 0), "A1");
    assert_eq!(to_a1(9, 2), "C10");
    assert_eq!(to_a1(0, 25), "Z1");
    assert_eq!(to_a1(0, 26), "AA1");
}

// -- SheetVisibility ---------------------------------------------------

#[test]
fn sheet_visibility_default() {
    assert_eq!(SheetVisibility::default(), SheetVisibility::Visible);
}

#[test]
fn sheet_visibility_from_ooxml() {
    assert_eq!(
        SheetVisibility::from_ooxml("visible"),
        SheetVisibility::Visible
    );
    assert_eq!(
        SheetVisibility::from_ooxml("hidden"),
        SheetVisibility::Hidden
    );
    assert_eq!(
        SheetVisibility::from_ooxml("veryHidden"),
        SheetVisibility::VeryHidden
    );
    // Unknown falls back to Visible
    assert_eq!(
        SheetVisibility::from_ooxml("unknown"),
        SheetVisibility::Visible
    );
    assert_eq!(SheetVisibility::from_ooxml(""), SheetVisibility::Visible);
}

#[test]
fn sheet_visibility_to_ooxml() {
    assert_eq!(SheetVisibility::Visible.to_ooxml(), "visible");
    assert_eq!(SheetVisibility::Hidden.to_ooxml(), "hidden");
    assert_eq!(SheetVisibility::VeryHidden.to_ooxml(), "veryHidden");
}

#[test]
fn sheet_visibility_roundtrip() {
    for v in [
        SheetVisibility::Visible,
        SheetVisibility::Hidden,
        SheetVisibility::VeryHidden,
    ] {
        assert_eq!(SheetVisibility::from_ooxml(v.to_ooxml()), v);
    }
}

// -- MergeRange --------------------------------------------------------

#[test]
fn merge_range_from_ref() {
    let mr = MergeRange::from_ref("A1:B3");
    assert_eq!(mr.to_ref(), "A1:B3");
    assert_eq!(mr.start_row, 0);
    assert_eq!(mr.start_col, 0);
    assert_eq!(mr.end_row, 2);
    assert_eq!(mr.end_col, 1);
}

#[test]
fn merge_range_from_coords() {
    let mr = MergeRange::from_coords(0, 0, 2, 1);
    assert_eq!(mr.to_ref(), "A1:B3");
    assert_eq!(mr.start_row, 0);
    assert_eq!(mr.start_col, 0);
    assert_eq!(mr.end_row, 2);
    assert_eq!(mr.end_col, 1);
}

#[test]
fn merge_range_from_coords_larger() {
    let mr = MergeRange::from_coords(0, 0, 9, 25);
    assert_eq!(mr.to_ref(), "A1:Z10");
}

#[test]
fn merge_range_from_coords_aa_columns() {
    let mr = MergeRange::from_coords(0, 26, 0, 27);
    assert_eq!(mr.to_ref(), "AA1:AB1");
}

// -- SheetPane ---------------------------------------------------------

#[test]
fn sheet_pane_frozen_basic() {
    let sp = SheetPane::frozen(1, 1);
    assert_eq!(sp.rows(), 1);
    assert_eq!(sp.cols(), 1);
    assert_eq!(sp.top_left_cell.as_deref(), Some("B2"));
    assert_eq!(sp.effective_active_pane(), Pane::BottomRight);
    assert_eq!(sp.effective_state(), PaneState::Frozen);
    assert!(sp.is_frozen());
    assert!(!sp.is_split());
}

#[test]
fn sheet_pane_frozen_rows_only() {
    let sp = SheetPane::frozen(5, 0);
    assert_eq!(sp.rows(), 5);
    assert_eq!(sp.cols(), 0);
    assert_eq!(sp.effective_active_pane(), Pane::BottomLeft);
    assert_eq!(sp.top_left_cell.as_deref(), Some("A6"));
    assert!(sp.is_frozen());
}

#[test]
fn sheet_pane_frozen_cols_only() {
    let sp = SheetPane::frozen(0, 3);
    assert_eq!(sp.rows(), 0);
    assert_eq!(sp.cols(), 3);
    assert_eq!(sp.effective_active_pane(), Pane::TopRight);
    assert_eq!(sp.top_left_cell.as_deref(), Some("D1"));
    assert!(sp.is_frozen());
}

#[test]
fn sheet_pane_frozen_both() {
    let sp = SheetPane::frozen(2, 3);
    assert_eq!(sp.effective_active_pane(), Pane::BottomRight);
    assert_eq!(sp.top_left_cell.as_deref(), Some("D3"));
}

#[test]
fn sheet_pane_frozen_none() {
    let sp = SheetPane::frozen(0, 0);
    assert_eq!(sp.effective_active_pane(), Pane::TopLeft);
    assert_eq!(sp.top_left_cell.as_deref(), Some("A1"));
}

#[test]
fn sheet_pane_split() {
    let sp = SheetPane::split(2400.0, 1800.0);
    assert!((sp.x_split - 2400.0).abs() < f64::EPSILON);
    assert!((sp.y_split - 1800.0).abs() < f64::EPSILON);
    assert_eq!(sp.top_left_cell, None);
    assert_eq!(sp.effective_active_pane(), Pane::BottomRight);
    assert_eq!(sp.effective_state(), PaneState::Split);
    assert!(sp.is_split());
    assert!(!sp.is_frozen());
}

#[test]
fn sheet_pane_from_parsed() {
    let sp = SheetPane::from_parsed(
        2.0,
        3.0,
        Some("C4"),
        Pane::BottomLeft,
        PaneState::FrozenSplit,
    );
    assert_eq!(sp.cols(), 2);
    assert_eq!(sp.rows(), 3);
    assert_eq!(sp.top_left_cell.as_deref(), Some("C4"));
    assert_eq!(sp.effective_active_pane(), Pane::BottomLeft);
    assert_eq!(sp.effective_state(), PaneState::FrozenSplit);
    assert!(sp.is_frozen());
}

#[test]
fn sheet_pane_from_parsed_no_top_left() {
    let sp = SheetPane::from_parsed(0.0, 0.0, None, Pane::TopLeft, PaneState::Split);
    assert_eq!(sp.top_left_cell, None);
    assert!(sp.is_split());
}

// -- ColWidth ----------------------------------------------------------

#[test]
fn col_width_simple() {
    let cw = ColWidth::simple(0, 8.43);
    assert_eq!(cw.col, 0);
    assert!((cw.width.unwrap() - 8.43).abs() < f64::EPSILON);
    assert_eq!(cw.min, 1);
    assert_eq!(cw.max, 1);
    assert!(!cw.custom_width);
    assert!(!cw.hidden);
    assert_eq!(cw.style, None);
    assert!(!cw.best_fit);
}

#[test]
fn col_width_range() {
    let cw = ColWidth::range(1, 5, 12.0);
    assert_eq!(cw.col, 0); // min - 1
    assert!((cw.width.unwrap() - 12.0).abs() < f64::EPSILON);
    assert_eq!(cw.min, 1);
    assert_eq!(cw.max, 5);
}

#[test]
fn col_width_builders() {
    let cw = ColWidth::simple(3, 10.0)
        .with_hidden(true)
        .with_style(2)
        .with_best_fit(true);
    assert!(cw.hidden);
    assert_eq!(cw.style, Some(2));
    assert!(cw.best_fit);
}

#[test]
fn col_width_with_outline_level() {
    let cw = ColWidth::simple(0, 8.0).with_outline_level(3);
    assert_eq!(cw.outline_level, Some(3));

    // Values above 7 are clamped.
    let cw2 = ColWidth::simple(0, 8.0).with_outline_level(10);
    assert_eq!(cw2.outline_level, Some(7));
}

#[test]
fn col_width_builder_chaining_new_fields() {
    let cw = ColWidth::range(1, 5, 12.0)
        .with_outline_level(2)
        .with_collapsed(true)
        .with_phonetic(true);
    assert_eq!(cw.outline_level, Some(2));
    assert!(cw.collapsed);
    assert!(cw.phonetic);
}

#[test]
fn col_width_serde_roundtrip() {
    let cw = ColWidth::range(1, 5, 12.0)
        .with_hidden(true)
        .with_style(4)
        .with_best_fit(true)
        .with_outline_level(5)
        .with_collapsed(true)
        .with_phonetic(true);
    let json = serde_json::to_string(&cw).unwrap();
    let cw2: ColWidth = serde_json::from_str(&json).unwrap();
    assert_eq!(cw, cw2);
}

// -- RowHeight ---------------------------------------------------------

#[test]
fn row_height_new() {
    let rh = RowHeight::new(0, 15.0);
    assert_eq!(rh.row, 0);
    assert!((rh.height - 15.0).abs() < f64::EPSILON);
    assert!(!rh.custom_height);
    assert_eq!(rh.hidden, None);
}

#[test]
fn row_height_custom() {
    let rh = RowHeight::custom(5, 30.0);
    assert_eq!(rh.row, 5);
    assert!((rh.height - 30.0).abs() < f64::EPSILON);
    assert!(rh.custom_height);
    assert_eq!(rh.hidden, None);
}

#[test]
fn row_height_with_hidden() {
    let rh = RowHeight::new(1, 15.0).with_hidden(true);
    assert_eq!(rh.hidden, Some(true));
}

#[test]
fn row_height_with_style() {
    let rh = RowHeight::new(0, 15.0).with_style(5);
    assert_eq!(rh.style, Some(5));
    assert!(rh.custom_format);
}

#[test]
fn row_height_outline_level_clamped() {
    let rh = RowHeight::new(0, 15.0).with_outline_level(10);
    assert_eq!(rh.outline_level, Some(7));
}

#[test]
fn row_height_builder_chaining() {
    let rh = RowHeight::custom(2, 20.0)
        .with_hidden(true)
        .with_style(3)
        .with_outline_level(4)
        .with_collapsed(true)
        .with_thick_top(true)
        .with_thick_bot(true);
    assert!(rh.custom_height);
    assert_eq!(rh.hidden, Some(true));
    assert_eq!(rh.style, Some(3));
    assert!(rh.custom_format);
    assert_eq!(rh.outline_level, Some(4));
    assert_eq!(rh.collapsed, Some(true));
    assert!(rh.thick_top);
    assert!(rh.thick_bot);
}

#[test]
fn row_height_serde_roundtrip() {
    let rh = RowHeight::custom(7, 25.5)
        .with_hidden(true)
        .with_style(2)
        .with_outline_level(3)
        .with_collapsed(true)
        .with_thick_top(true)
        .with_thick_bot(true);
    let json = serde_json::to_string(&rh).unwrap();
    let rh2: RowHeight = serde_json::from_str(&json).unwrap();
    assert_eq!(rh, rh2);
}

// -- SheetViewType -----------------------------------------------------

#[test]
fn sheet_view_type_roundtrip() {
    for v in [
        SheetViewType::Normal,
        SheetViewType::PageBreakPreview,
        SheetViewType::PageLayout,
    ] {
        assert_eq!(SheetViewType::from_ooxml(v.to_ooxml()), v);
    }
}

#[test]
fn sheet_view_type_unknown_fallback() {
    assert_eq!(SheetViewType::from_ooxml("unknown"), SheetViewType::Normal);
    assert_eq!(SheetViewType::from_ooxml(""), SheetViewType::Normal);
}

#[test]
fn sheet_view_type_default() {
    assert_eq!(SheetViewType::default(), SheetViewType::Normal);
}

#[test]
fn sheet_view_type_is_default() {
    assert!(SheetViewType::Normal.is_default());
    assert!(!SheetViewType::PageBreakPreview.is_default());
    assert!(!SheetViewType::PageLayout.is_default());
}

// -- Pane --------------------------------------------------------------

#[test]
fn pane_roundtrip() {
    for v in [
        Pane::BottomLeft,
        Pane::BottomRight,
        Pane::TopLeft,
        Pane::TopRight,
    ] {
        assert_eq!(Pane::from_ooxml(v.to_ooxml()), v);
    }
}

#[test]
fn pane_unknown_fallback() {
    assert_eq!(Pane::from_ooxml("unknown"), Pane::TopLeft);
    assert_eq!(Pane::from_ooxml(""), Pane::TopLeft);
}

#[test]
fn pane_default() {
    assert_eq!(Pane::default(), Pane::TopLeft);
}

// -- PaneState ---------------------------------------------------------

#[test]
fn pane_state_roundtrip() {
    for v in [PaneState::Frozen, PaneState::FrozenSplit, PaneState::Split] {
        assert_eq!(PaneState::from_ooxml(v.to_ooxml()), v);
    }
}

#[test]
fn pane_state_unknown_fallback() {
    assert_eq!(PaneState::from_ooxml("unknown"), PaneState::Split);
    assert_eq!(PaneState::from_ooxml(""), PaneState::Split);
}

#[test]
fn pane_state_default() {
    assert_eq!(PaneState::default(), PaneState::Split);
}

// -- SheetView -------------------------------------------------------------

#[test]
fn sheet_view_default_values() {
    let sv = SheetView::default();
    assert!(!sv.window_protection);
    assert!(!sv.show_formulas);
    assert!(sv.show_grid_lines);
    assert!(sv.show_row_col_headers);
    assert!(sv.show_zeros);
    assert!(!sv.tab_selected);
    assert!(sv.show_ruler);
    assert!(sv.show_outline_symbols);
    assert!(sv.show_white_space);
    assert_eq!(sv.view, SheetViewType::Normal);
    assert_eq!(sv.top_left_cell, None);
    assert_eq!(sv.zoom_scale, 100);
    assert_eq!(sv.zoom_scale_normal, 0);
    assert!(sv.default_grid_color);
    assert_eq!(sv.color_id, 64);
    assert_eq!(sv.workbook_view_id, 0);
    assert!(!sv.right_to_left);
    assert!(sv.pane.is_none());
    assert!(sv.selections.is_empty());
}

#[test]
fn sheet_view_with_pane_and_selection() {
    let sv = SheetView {
        pane: Some(SheetPane::frozen(1, 2)),
        selections: vec![Selection {
            pane: Some(Pane::BottomRight),
            active_cell: Some("C2".to_string()),
            active_cell_id: Some(0),
            sqref: Some("C2:D5".to_string()),
        }],
        tab_selected: true,
        ..SheetView::default()
    };
    assert!(sv.tab_selected);
    assert!(sv.pane.unwrap().is_frozen());
    assert_eq!(sv.selections.len(), 1);
    assert_eq!(sv.selections[0].active_cell.as_deref(), Some("C2"));
}

#[test]
fn selection_roundtrip() {
    let sel = Selection {
        pane: Some(Pane::TopLeft),
        active_cell: Some("B5".to_string()),
        active_cell_id: Some(0),
        sqref: Some("B5:C10".to_string()),
    };
    let json = serde_json::to_string(&sel).unwrap();
    let sel2: Selection = serde_json::from_str(&json).unwrap();
    assert_eq!(sel, sel2);
}

#[test]
fn sheet_view_serde_skip_defaults() {
    let sv = SheetView::default();
    let json = serde_json::to_string(&sv).unwrap();
    // Default-true fields should NOT appear in output (they are skipped).
    assert!(!json.contains("show_grid_lines"));
    assert!(!json.contains("show_row_col_headers"));
    assert!(!json.contains("show_zeros"));
    assert!(!json.contains("show_ruler"));
    assert!(!json.contains("show_outline_symbols"));
    assert!(!json.contains("show_white_space"));
    // Default-false fields should also be skipped.
    assert!(!json.contains("window_protection"));
    assert!(!json.contains("show_formulas"));
    assert!(!json.contains("tab_selected"));
    assert!(!json.contains("right_to_left"));
    // Numeric-default fields should also be skipped.
    assert!(!json.contains("default_grid_color"));
    assert!(!json.contains("color_id"));
    assert!(!json.contains("zoom_scale"));
    assert!(!json.contains("zoom_scale_normal"));
}

#[test]
fn sheet_view_with_zoom() {
    let sv = SheetView {
        zoom_scale: 150,
        zoom_scale_normal: 100,
        ..SheetView::default()
    };
    let json = serde_json::to_string(&sv).unwrap();
    let sv2: SheetView = serde_json::from_str(&json).unwrap();
    assert_eq!(sv2.zoom_scale, 150);
    assert_eq!(sv2.zoom_scale_normal, 100);
    assert_eq!(sv, sv2);
}

// -- PivotAxis ---------------------------------------------------------

#[test]
fn pivot_axis_roundtrip() {
    for v in [
        PivotAxis::AxisRow,
        PivotAxis::AxisCol,
        PivotAxis::AxisPage,
        PivotAxis::AxisValues,
    ] {
        assert_eq!(PivotAxis::from_ooxml(v.to_ooxml()), Some(v));
    }
}

#[test]
fn pivot_axis_unknown_returns_none() {
    assert_eq!(PivotAxis::from_ooxml("unknown"), None);
    assert_eq!(PivotAxis::from_ooxml(""), None);
}

// -- PivotSelection ----------------------------------------------------

#[test]
fn pivot_selection_defaults() {
    let ps = PivotSelection {
        pane: None,
        show_header: false,
        label: false,
        data: false,
        extendable: false,
        count: 0,
        axis: None,
        dimension: 0,
        start: 0,
        min: 0,
        max: 0,
        active_row: 0,
        active_col: 0,
        previous_row: 0,
        previous_col: 0,
        click: 0,
        id: Some("rId1".to_string()),
        pivot_area: None,
    };
    assert_eq!(ps.effective_pane(), Pane::TopLeft);
    assert!(!ps.show_header);
    assert!(!ps.label);
    assert!(!ps.data);
    assert!(!ps.extendable);
    assert_eq!(ps.count, 0);
    assert!(ps.axis.is_none());
    assert_eq!(ps.dimension, 0);
    assert_eq!(ps.effective_id(), "rId1");
    assert!(ps.pivot_area.is_none());
}

#[test]
fn pivot_selection_serde_roundtrip() {
    let ps = PivotSelection {
        pane: Some(Pane::BottomRight),
        show_header: true,
        label: true,
        data: true,
        extendable: false,
        count: 5,
        axis: Some(PivotAxis::AxisRow),
        dimension: 2,
        start: 1,
        min: 0,
        max: 10,
        active_row: 3,
        active_col: 4,
        previous_row: 2,
        previous_col: 1,
        click: 1,
        id: Some("rId42".to_string()),
        pivot_area: Some("<pivotArea/>".to_string()),
    };
    let json = serde_json::to_string(&ps).unwrap();
    let ps2: PivotSelection = serde_json::from_str(&json).unwrap();
    assert_eq!(ps, ps2);
}

#[test]
fn pivot_selection_serde_skip_defaults() {
    let ps = PivotSelection {
        pane: None,
        show_header: false,
        label: false,
        data: false,
        extendable: false,
        count: 0,
        axis: None,
        dimension: 0,
        start: 0,
        min: 0,
        max: 0,
        active_row: 0,
        active_col: 0,
        previous_row: 0,
        previous_col: 0,
        click: 0,
        id: Some("rId1".to_string()),
        pivot_area: None,
    };
    let json = serde_json::to_string(&ps).unwrap();
    // Boolean defaults should be skipped
    assert!(!json.contains("show_header"));
    assert!(!json.contains("label"));
    assert!(!json.contains("\"data\""));
    assert!(!json.contains("extendable"));
    // Zero u32 defaults should be skipped
    assert!(!json.contains("count"));
    assert!(!json.contains("dimension"));
    assert!(!json.contains("active_row"));
    // Required field should always be present
    assert!(json.contains("rId1"));
}

#[test]
fn sheet_view_default_has_empty_pivot_selection() {
    let sv = SheetView::default();
    assert!(sv.pivot_selection.is_empty());
}

#[test]
fn sheet_view_with_pivot_selection() {
    let sv = SheetView {
        pivot_selection: vec![PivotSelection {
            pane: Some(Pane::TopLeft),
            show_header: false,
            label: false,
            data: true,
            extendable: false,
            count: 1,
            axis: Some(PivotAxis::AxisCol),
            dimension: 0,
            start: 0,
            min: 0,
            max: 0,
            active_row: 5,
            active_col: 3,
            previous_row: 0,
            previous_col: 0,
            click: 0,
            id: Some("rId1".to_string()),
            pivot_area: None,
        }],
        ..SheetView::default()
    };
    assert_eq!(sv.pivot_selection.len(), 1);
    assert_eq!(sv.pivot_selection[0].axis, Some(PivotAxis::AxisCol));
    assert_eq!(sv.pivot_selection[0].active_row, 5);
}

// -- SheetProperties ---------------------------------------------------

#[test]
fn sheet_properties_default() {
    let sp = SheetProperties::default();
    assert!(sp.published, "published should default to true per XSD");
    assert!(
        sp.enable_format_conditions_calculation,
        "enable_format_conditions_calculation should default to true per XSD"
    );
    assert!(!sp.sync_horizontal);
    assert!(!sp.sync_vertical);
    assert!(!sp.transition_evaluation);
    assert!(!sp.transition_entry);
    assert!(!sp.filter_mode);
    assert!(sp.sync_ref.is_none());
    assert!(sp.code_name.is_none());
    assert!(sp.tab_color.is_none());
    assert!(sp.outline_pr.is_none());
    assert!(sp.page_set_up_pr.is_none());
}

#[test]
fn sheet_properties_with_tab_color() {
    use crate::styles::ColorDef;
    let mut sp = SheetProperties::default();
    sp.tab_color = Some(ColorDef::Rgb {
        val: "FF0000".to_string(),
        tint: None,
    });
    let json = serde_json::to_string(&sp).unwrap();
    let sp2: SheetProperties = serde_json::from_str(&json).unwrap();
    assert_eq!(sp, sp2);
    assert!(sp2.tab_color.is_some());
}

#[test]
fn outline_properties_defaults() {
    let op = OutlineProperties::default();
    assert!(!op.apply_styles);
    assert!(op.summary_below, "summary_below should default to true");
    assert!(op.summary_right, "summary_right should default to true");
    assert!(
        op.show_outline_symbols,
        "show_outline_symbols should default to true"
    );
}

#[test]
fn page_setup_properties_fit_to_page() {
    let psp = PageSetupProperties {
        auto_page_breaks: true,
        fit_to_page: true,
    };
    let json = serde_json::to_string(&psp).unwrap();
    let psp2: PageSetupProperties = serde_json::from_str(&json).unwrap();
    assert!(psp2.fit_to_page);
    assert!(psp2.auto_page_breaks);
}

#[test]
fn sheet_format_properties_roundtrip() {
    let sfp = SheetFormatProperties {
        base_col_width: Some(10),
        default_col_width: Some(8.43),
        default_row_height: 15.0,
        custom_height: true,
        zero_height: false,
        thick_top: true,
        thick_bottom: false,
        outline_level_row: 3,
        outline_level_col: 2,
    };
    let json = serde_json::to_string(&sfp).unwrap();
    let sfp2: SheetFormatProperties = serde_json::from_str(&json).unwrap();
    assert_eq!(sfp, sfp2);
}

#[test]
fn sheet_dimension_from_string() {
    let sd = SheetDimension::new("A1:F10");
    assert_eq!(sd.ref_range, "A1:F10");
    let json = serde_json::to_string(&sd).unwrap();
    let sd2: SheetDimension = serde_json::from_str(&json).unwrap();
    assert_eq!(sd, sd2);
}

#[test]
fn sheet_properties_with_all_children() {
    use crate::styles::ColorDef;
    let sp = SheetProperties {
        sync_horizontal: true,
        sync_vertical: true,
        sync_ref: Some("A1".to_string()),
        transition_evaluation: true,
        transition_entry: true,
        published: false,
        code_name: Some("Sheet1".to_string()),
        filter_mode: true,
        enable_format_conditions_calculation: false,
        tab_color: Some(ColorDef::Theme {
            id: 4,
            tint: Some("0.5".to_string()),
        }),
        outline_pr: Some(OutlineProperties {
            apply_styles: true,
            summary_below: false,
            summary_right: false,
            show_outline_symbols: false,
        }),
        page_set_up_pr: Some(PageSetupProperties {
            auto_page_breaks: false,
            fit_to_page: true,
        }),
    };
    let json = serde_json::to_string(&sp).unwrap();
    let sp2: SheetProperties = serde_json::from_str(&json).unwrap();
    assert_eq!(sp, sp2);
    // Verify non-default values survived roundtrip
    assert!(!sp2.published);
    assert!(!sp2.enable_format_conditions_calculation);
    assert!(sp2.outline_pr.as_ref().unwrap().apply_styles);
    assert!(!sp2.outline_pr.as_ref().unwrap().summary_below);
    assert!(sp2.page_set_up_pr.as_ref().unwrap().fit_to_page);
    assert!(!sp2.page_set_up_pr.as_ref().unwrap().auto_page_breaks);
}

// -- Integration: new types compose correctly ------------------------------

#[test]
fn integration_data_validation_auto_filter_sort_hyperlink() {
    use crate::tables::{FilterOperator, SortBy};

    // DataValidation with list type
    let dv = DataValidation {
        r#type: Some(DataValidationType::List),
        operator: DataValidationOperator::Between,
        show_drop_down: true,
        show_input_message: true,
        show_error_message: true,
        error_style: DataValidationErrorStyle::Stop,
        prompt_title: Some("Pick a value".to_string()),
        sqref: "A1:A100".to_string(),
        formula1: Some("Sheet2!$B$1:$B$10".to_string()),
        ..DataValidation::default()
    };
    assert_eq!(dv.effective_type(), DataValidationType::List);
    assert!(dv.show_drop_down);

    let dvs = DataValidations {
        count: Some(1),
        data_validation: vec![dv],
        ..DataValidations::default()
    };
    assert_eq!(dvs.data_validation.len(), 1);

    // AutoFilter with custom filter
    let af = AutoFilter {
        ref_range: Some("A1:D100".to_string()),
        filter_column: vec![FilterColumn {
            col_id: 2,
            filter_type: Some(FilterColumnType::CustomFilters(CustomFilters {
                and: true,
                custom_filter: vec![
                    CustomFilter {
                        operator: FilterOperator::GreaterThanOrEqual,
                        val: Some("100".to_string()),
                    },
                    CustomFilter {
                        operator: FilterOperator::LessThan,
                        val: Some("500".to_string()),
                    },
                ],
            })),
            ..FilterColumn::default()
        }],
        sort_state: Some(SortState {
            ref_range: "A2:D100".to_string(),
            sort_condition: vec![SortCondition {
                descending: true,
                sort_by: SortBy::Value,
                ref_range: "C2:C100".to_string(),
                ..SortCondition::default()
            }],
            ..SortState::default()
        }),
        ext_lst: None,
    };
    assert!(af.filter_column[0].show_button);
    assert_eq!(
        af.sort_state.as_ref().unwrap().sort_condition[0].sort_by,
        SortBy::Value
    );

    // Hyperlinks
    let links = Hyperlinks {
        hyperlink: vec![
            Hyperlink {
                ref_cell: "A1".to_string(),
                r_id: Some("rId1".to_string()),
                tooltip: Some("Visit site".to_string()),
                ..Hyperlink::default()
            },
            Hyperlink {
                ref_cell: "B2".to_string(),
                location: Some("Sheet2!A1".to_string()),
                ..Hyperlink::default()
            },
        ],
    };
    assert_eq!(links.hyperlink.len(), 2);
    assert!(links.hyperlink[0].r_id.is_some());
    assert!(links.hyperlink[1].location.is_some());
}
