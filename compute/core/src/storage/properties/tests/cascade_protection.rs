use super::support::*;
use super::*;

#[test]
fn test_effective_format_full_inheritance() {
    let (mut storage, sid, gi) = storage_with_sheet();

    // Column 1: set number_format
    set_col_format(
        &mut storage,
        &sid,
        1,
        &CellFormat {
            number_format: Some("0.00%".to_string()),
            font_color: Some("#0000FF".to_string()),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    // Row 2: set font_color (overrides column's font_color)
    set_row_format(
        &mut storage,
        &sid,
        2,
        &CellFormat {
            font_color: Some("#FF0000".to_string()),
            bold: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    // Cell at (2, 1): set bold=false (overrides row's bold)
    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "cell-x",
        &CellFormat {
            bold: Some(false),
            ..Default::default()
        },
    );

    let eff = get_effective_format(&storage, &sid, "cell-x", 2, 1, None, Some(&gi), None);

    // bold: cell says false -> false
    assert_eq!(eff.bold, Some(false));
    // font_color: row says #FF0000, overrides column #0000FF
    assert_eq!(eff.font_color, Some("#FF0000".to_string()));
    // number_format: from column
    assert_eq!(eff.number_format, Some("0.00%".to_string()));
    // font_family: from default
    assert_eq!(eff.font_family, Some("Calibri".to_string()));
}

#[test]
fn test_effective_format_no_overrides() {
    let (storage, sid, gi) = storage_with_sheet();

    let eff = get_effective_format(&storage, &sid, "no-cell", 0, 0, None, Some(&gi), None);
    let def = default_format();

    assert_eq!(eff.font_family, def.font_family);
    assert_eq!(eff.font_size, def.font_size);
    assert_eq!(eff.bold, def.bold);
    assert_eq!(eff.locked, def.locked);
    assert_eq!(
        eff.pattern_type,
        Some(ooxml_types::styles::PatternType::None),
        "a fully-resolved absent fill has an explicit transferable sentinel"
    );
}

#[test]
fn test_effective_format_canonicalizes_sparse_authored_no_fill_only_after_cascade() {
    let (mut storage, sid, gi) = storage_with_sheet();

    set_col_format(
        &mut storage,
        &sid,
        2,
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "sparse-authored-cell",
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );

    let eff = get_effective_format(
        &storage,
        &sid,
        "sparse-authored-cell",
        3,
        2,
        None,
        Some(&gi),
        None,
    );

    assert_eq!(eff.bold, Some(true));
    assert_eq!(eff.italic, Some(true));
    assert_eq!(
        eff.pattern_type,
        Some(ooxml_types::styles::PatternType::None)
    );
    assert!(eff.background_color.is_none());
    assert!(eff.gradient_fill.is_none());
}

#[test]
fn test_premerged_range_cascade_uses_the_same_effective_fill_contract() {
    let base = default_format();

    let no_fill = get_effective_format_from_preloaded_layers_with_range(
        &base, None, None, 2, None, None, None, None, false,
    );
    assert_eq!(
        no_fill.pattern_type,
        Some(ooxml_types::styles::PatternType::None)
    );

    let range_fill = CellFormat {
        background_color: Some("#70AD47".to_string()),
        ..Default::default()
    };
    let shorthand = get_effective_format_from_preloaded_layers_with_range(
        &base,
        None,
        None,
        2,
        Some(&range_fill),
        None,
        None,
        None,
        false,
    );
    assert_eq!(shorthand.background_color.as_deref(), Some("#70AD47"));
    assert_eq!(
        shorthand.pattern_type,
        Some(ooxml_types::styles::PatternType::Solid)
    );
}

#[test]
fn test_higher_fill_layers_prevent_effective_no_fill_canonicalization() {
    let (mut storage, sid, gi) = storage_with_sheet();

    // A background-color-only authored layer is a supported fill shorthand.
    // It must not encounter a prematurely seeded no-fill sentinel from the
    // lower default layer, which would clear the higher color during merging.
    set_row_format(
        &mut storage,
        &sid,
        3,
        &CellFormat {
            background_color: Some("#4472C4".to_string()),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    let shorthand = get_effective_format(
        &storage,
        &sid,
        "background-shorthand",
        3,
        2,
        None,
        Some(&gi),
        None,
    );
    assert_eq!(shorthand.background_color.as_deref(), Some("#4472C4"));
    assert_eq!(
        shorthand.pattern_type,
        Some(ooxml_types::styles::PatternType::Solid),
        "the final effective contract must match XLSX's solid-fill lowering"
    );

    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "higher-solid-fill",
        &CellFormat {
            background_color: Some("#ED7D31".to_string()),
            pattern_type: Some(ooxml_types::styles::PatternType::Solid),
            ..Default::default()
        },
    );

    let solid = get_effective_format(
        &storage,
        &sid,
        "higher-solid-fill",
        3,
        2,
        None,
        Some(&gi),
        None,
    );
    assert_eq!(solid.background_color.as_deref(), Some("#ED7D31"));
    assert_eq!(
        solid.pattern_type,
        Some(ooxml_types::styles::PatternType::Solid)
    );
}

#[test]
fn test_workbook_normal_style_overrides_builtin_default_base() {
    let (storage, sid, gi) = storage_with_sheet();
    insert_style_palette_entry(
        storage.doc(),
        storage.workbook_map(),
        0,
        &CellFormat {
            font_family: Some("Aptos".to_string()),
            font_size: Some(domain_types::FontSize::from_millipoints(12000)),
            ..Default::default()
        },
    );

    let eff = get_effective_format(&storage, &sid, "no-cell", 0, 0, None, Some(&gi), None);

    assert_eq!(eff.font_family, Some("Aptos".to_string()));
    assert_eq!(
        eff.font_size,
        Some(domain_types::FontSize::from_millipoints(12000))
    );
    assert_eq!(eff.bold, Some(false));
    assert_eq!(eff.locked, Some(true));
}

#[test]
fn test_workbook_normal_style_is_below_row_col_and_cell_layers() {
    let (mut storage, sid, gi) = storage_with_sheet();
    insert_style_palette_entry(
        storage.doc(),
        storage.workbook_map(),
        0,
        &CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(12000)),
            font_color: Some("#111111".to_string()),
            ..Default::default()
        },
    );

    set_col_format(
        &mut storage,
        &sid,
        1,
        &CellFormat {
            font_color: Some("#222222".to_string()),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    set_row_format(
        &mut storage,
        &sid,
        2,
        &CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(14000)),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "cell-normal-cascade",
        &CellFormat {
            font_color: Some("#333333".to_string()),
            ..Default::default()
        },
    );

    let eff = get_effective_format(
        &storage,
        &sid,
        "cell-normal-cascade",
        2,
        1,
        None,
        Some(&gi),
        None,
    );

    assert_eq!(
        eff.font_size,
        Some(domain_types::FontSize::from_millipoints(14000))
    );
    assert_eq!(eff.font_color, Some("#333333".to_string()));
}

#[test]
fn test_positional_format_uses_workbook_normal_style() {
    let (storage, sid, gi) = storage_with_sheet();
    insert_style_palette_entry(
        storage.doc(),
        storage.workbook_map(),
        0,
        &CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(12000)),
            ..Default::default()
        },
    );

    let eff = get_positional_format(&storage, &sid, 4, 1, Some(&gi), None);

    assert_eq!(
        eff.font_size,
        Some(domain_types::FontSize::from_millipoints(12000))
    );
}

#[test]
fn test_effective_format_only_row() {
    let (mut storage, sid, gi) = storage_with_sheet();

    set_row_format(
        &mut storage,
        &sid,
        7,
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    let eff = get_effective_format(&storage, &sid, "some-cell", 7, 0, None, Some(&gi), None);
    assert_eq!(eff.italic, Some(true));
    // Other properties from default
    assert_eq!(eff.font_family, Some("Calibri".to_string()));
}

#[test]
fn test_effective_format_only_col() {
    let (mut storage, sid, gi) = storage_with_sheet();

    set_col_format(
        &mut storage,
        &sid,
        3,
        &CellFormat {
            wrap_text: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    let eff = get_effective_format(&storage, &sid, "some-cell", 0, 3, None, Some(&gi), None);
    assert_eq!(eff.wrap_text, Some(true));
    assert_eq!(
        eff.font_size,
        Some(domain_types::FontSize::from_millipoints(11000))
    );
}

#[test]
fn test_is_locked_default_true() {
    let (storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());
    assert!(is_cell_locked(doc, workbook, sheets, &sid, "unknown-cell"));
}

#[test]
fn test_is_locked_explicitly_false() {
    let (mut storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "unlocked-cell",
        &CellFormat {
            locked: Some(false),
            ..Default::default()
        },
    );

    assert!(!is_cell_locked(
        doc,
        workbook,
        sheets,
        &sid,
        "unlocked-cell"
    ));
}

#[test]
fn test_is_formula_hidden_default_false() {
    let (storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());
    assert!(!is_formula_hidden(
        doc,
        workbook,
        sheets,
        &sid,
        "unknown-cell"
    ));
}

#[test]
fn test_is_formula_hidden_explicitly_true() {
    let (mut storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "hidden-cell",
        &CellFormat {
            hidden: Some(true),
            ..Default::default()
        },
    );

    assert!(is_formula_hidden(
        doc,
        workbook,
        sheets,
        &sid,
        "hidden-cell"
    ));
}

#[test]
fn test_effective_format_preloaded_no_ranges_uses_supplied_cell_format() {
    let (mut storage, sid, gi) = storage_with_sheet();

    set_col_format(
        &mut storage,
        &sid,
        2,
        &CellFormat {
            number_format: Some("0.00".to_string()),
            font_color: Some("#0000FF".to_string()),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    set_row_format(
        &mut storage,
        &sid,
        3,
        &CellFormat {
            font_color: Some("#FF0000".to_string()),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    let cell_properties = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    let eff = get_effective_format_preloaded(
        &storage,
        &sid,
        3,
        2,
        None,
        Some(&cell_properties),
        Some(&gi),
        None,
    );

    assert_eq!(eff.bold, Some(true));
    assert_eq!(eff.font_color, Some("#FF0000".to_string()));
    assert_eq!(eff.number_format, Some("0.00".to_string()));
    assert_eq!(eff.font_family, Some("Calibri".to_string()));
}

#[test]
fn test_imported_cell_xf_blocks_row_col_alignment_defaults() {
    let (mut storage, sid, gi) = storage_with_sheet();
    insert_style_palette_entry(
        storage.doc(),
        storage.workbook_map(),
        7,
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );
    insert_compact_cell_properties(&storage, &sid, "imported-cell", r#"{"s":7}"#);

    set_col_format(
        &mut storage,
        &sid,
        2,
        &CellFormat {
            number_format: Some("0.00".to_string()),
            horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Center),
            vertical_align: Some(domain_types::CellVerticalAlign::Middle),
            wrap_text: Some(true),
            indent: Some(2),
            text_rotation: Some(45),
            shrink_to_fit: Some(true),
            reading_order: Some("rtl".to_string()),
            auto_indent: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    let eff = get_effective_format(&storage, &sid, "imported-cell", 3, 2, None, Some(&gi), None);

    assert_eq!(eff.bold, Some(true));
    assert_eq!(eff.number_format.as_deref(), Some("General"));
    assert_eq!(
        eff.horizontal_align,
        Some(ooxml_types::styles::HorizontalAlign::General)
    );
    assert_eq!(
        eff.vertical_align,
        Some(domain_types::CellVerticalAlign::Bottom)
    );
    assert_eq!(eff.wrap_text, Some(false));
    assert_eq!(eff.indent, Some(0));
    assert_eq!(eff.text_rotation, Some(0));
    assert_eq!(eff.shrink_to_fit, Some(false));
    assert_eq!(eff.reading_order.as_deref(), Some("context"));
    assert_eq!(eff.auto_indent, Some(false));
}

#[test]
fn test_imported_cell_xf_no_fill_clears_row_fill_while_unstyled_cell_inherits() {
    let (mut storage, sid, gi) = storage_with_sheet();
    insert_style_palette_entry(
        storage.doc(),
        storage.workbook_map(),
        7,
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );
    insert_compact_cell_properties(&storage, &sid, "imported-no-fill", r#"{"s":7}"#);

    set_row_format(
        &mut storage,
        &sid,
        3,
        &CellFormat {
            background_color: Some("#4472C4".to_string()),
            pattern_type: Some(ooxml_types::styles::PatternType::Solid),
            pattern_foreground_color: Some("#ED7D31".to_string()),
            pattern_foreground_color_tint: Some(0.25),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    let imported = get_effective_format(
        &storage,
        &sid,
        "imported-no-fill",
        3,
        2,
        None,
        Some(&gi),
        None,
    );
    assert_eq!(
        imported.pattern_type,
        Some(ooxml_types::styles::PatternType::None)
    );
    assert!(imported.background_color.is_none());
    assert!(imported.pattern_foreground_color.is_none());
    assert!(imported.pattern_foreground_color_tint.is_none());

    let unstyled = get_effective_format(&storage, &sid, "unstyled", 3, 2, None, Some(&gi), None);
    assert_eq!(
        unstyled.pattern_type,
        Some(ooxml_types::styles::PatternType::Solid)
    );
    assert_eq!(unstyled.background_color.as_deref(), Some("#4472C4"));
    assert_eq!(
        unstyled.pattern_foreground_color.as_deref(),
        Some("#ED7D31")
    );
}

#[test]
fn test_imported_cell_xf_no_fill_clears_column_fill_while_user_cell_inherits() {
    let (mut storage, sid, gi) = storage_with_sheet();
    insert_style_palette_entry(
        storage.doc(),
        storage.workbook_map(),
        7,
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
    );
    insert_compact_cell_properties(&storage, &sid, "imported-no-fill", r#"{"s":7}"#);

    set_col_format(
        &mut storage,
        &sid,
        2,
        &CellFormat {
            background_color: Some("#70AD47".to_string()),
            pattern_type: Some(ooxml_types::styles::PatternType::Solid),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    let imported = get_effective_format(
        &storage,
        &sid,
        "imported-no-fill",
        3,
        2,
        None,
        Some(&gi),
        None,
    );
    assert_eq!(
        imported.pattern_type,
        Some(ooxml_types::styles::PatternType::None)
    );
    assert!(imported.background_color.is_none());

    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "user-sparse-cell",
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );
    let user = get_effective_format(
        &storage,
        &sid,
        "user-sparse-cell",
        3,
        2,
        None,
        Some(&gi),
        None,
    );
    assert_eq!(
        user.pattern_type,
        Some(ooxml_types::styles::PatternType::Solid)
    );
    assert_eq!(user.background_color.as_deref(), Some("#70AD47"));
}

#[test]
fn test_imported_cell_xf_materialization_preserves_direct_pattern_and_gradient_fills() {
    let (storage, sid, gi) = storage_with_sheet();
    let gradient = domain_types::GradientFillFormat {
        gradient_type: "linear".to_string(),
        degree: Some(45.0),
        center: None,
        stops: Vec::new(),
    };
    insert_style_palette_entry(
        storage.doc(),
        storage.workbook_map(),
        8,
        &CellFormat {
            background_color: Some("#FFF2CC".to_string()),
            pattern_type: Some(ooxml_types::styles::PatternType::DarkGrid),
            pattern_foreground_color: Some("#BF9000".to_string()),
            ..Default::default()
        },
    );
    insert_style_palette_entry(
        storage.doc(),
        storage.workbook_map(),
        9,
        &CellFormat {
            gradient_fill: Some(gradient.clone()),
            ..Default::default()
        },
    );
    insert_compact_cell_properties(&storage, &sid, "imported-pattern", r#"{"s":8}"#);
    insert_compact_cell_properties(&storage, &sid, "imported-gradient", r#"{"s":9}"#);

    let pattern = get_effective_format(
        &storage,
        &sid,
        "imported-pattern",
        1,
        1,
        None,
        Some(&gi),
        None,
    );
    assert_eq!(
        pattern.pattern_type,
        Some(ooxml_types::styles::PatternType::DarkGrid)
    );
    assert_eq!(pattern.background_color.as_deref(), Some("#FFF2CC"));
    assert_eq!(pattern.pattern_foreground_color.as_deref(), Some("#BF9000"));

    let gradient_format = get_effective_format(
        &storage,
        &sid,
        "imported-gradient",
        2,
        2,
        None,
        Some(&gi),
        None,
    );
    assert_eq!(gradient_format.gradient_fill, Some(gradient));
    assert!(gradient_format.pattern_type.is_none());
}

#[test]
fn test_user_sparse_cell_format_still_inherits_row_col_alignment() {
    let (mut storage, sid, gi) = storage_with_sheet();

    set_col_format(
        &mut storage,
        &sid,
        2,
        &CellFormat {
            horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Center),
            vertical_align: Some(domain_types::CellVerticalAlign::Middle),
            wrap_text: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "user-cell",
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );

    let eff = get_effective_format(&storage, &sid, "user-cell", 3, 2, None, Some(&gi), None);

    assert_eq!(eff.bold, Some(true));
    assert_eq!(
        eff.horizontal_align,
        Some(ooxml_types::styles::HorizontalAlign::Center)
    );
    assert_eq!(
        eff.vertical_align,
        Some(domain_types::CellVerticalAlign::Middle)
    );
    assert_eq!(eff.wrap_text, Some(true));
}

#[test]
fn test_positional_format_no_ranges_omits_cell_and_table_layers() {
    let (mut storage, sid, gi) = storage_with_sheet();

    set_col_format(
        &mut storage,
        &sid,
        1,
        &CellFormat {
            number_format: Some("0.0%".to_string()),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    set_row_format(
        &mut storage,
        &sid,
        4,
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "ignored-cell",
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );

    let eff = get_positional_format(&storage, &sid, 4, 1, Some(&gi), None);

    assert_eq!(eff.number_format, Some("0.0%".to_string()));
    assert_eq!(eff.italic, Some(true));
    assert_eq!(eff.bold, Some(false));
}
