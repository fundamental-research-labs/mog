use super::*;
use crate::identity::GridIndex;
use crate::storage::YrsStorage;
use crate::storage::{KEY_CELL_PROPERTIES, id_to_hex};
use ::yrs::{Any, Map, MapPrelim, Out, Transact};
use cell_types::SheetId;
use domain_types::{CellBorderSide, CellBorders, CellFormat};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a storage with a single sheet and return (storage, sheet_id).
fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
        .unwrap();
    let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::new());
    let gi = GridIndex::new(sid, 100, 26, id_alloc);
    (storage, sid, gi)
}

#[test]
fn test_merge_formats_merges_partial_borders_per_edge_and_side_field() {
    use ooxml_types::styles::BorderStyle;

    let lower = CellFormat {
        borders: Some(CellBorders {
            top: Some(CellBorderSide {
                style: Some(BorderStyle::Thin),
                color: Some("#111111".to_string()),
                ..Default::default()
            }),
            right: Some(CellBorderSide {
                style: Some(BorderStyle::Medium),
                color: Some("#222222".to_string()),
                ..Default::default()
            }),
            diagonal_up: Some(true),
            outline: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    let higher = CellFormat {
        borders: Some(CellBorders {
            top: Some(CellBorderSide {
                color: Some("#333333".to_string()),
                ..Default::default()
            }),
            bottom: Some(CellBorderSide {
                style: Some(BorderStyle::Dashed),
                color: Some("#444444".to_string()),
                ..Default::default()
            }),
            diagonal_up: Some(false),
            ..Default::default()
        }),
        ..Default::default()
    };

    let merged = merge_formats(&lower, &higher);
    let borders = merged.borders.expect("merged borders");

    let top = borders.top.expect("top border preserved");
    assert_eq!(top.style, Some(BorderStyle::Thin));
    assert_eq!(top.color, Some("#333333".to_string()));

    let right = borders.right.expect("right border preserved");
    assert_eq!(right.style, Some(BorderStyle::Medium));
    assert_eq!(right.color, Some("#222222".to_string()));

    let bottom = borders.bottom.expect("bottom border applied");
    assert_eq!(bottom.style, Some(BorderStyle::Dashed));
    assert_eq!(bottom.color, Some("#444444".to_string()));

    assert_eq!(borders.diagonal_up, Some(false));
    assert_eq!(borders.outline, Some(true));
}

#[test]
fn test_merge_formats_empty_borders_patch_clears_all_borders() {
    use ooxml_types::styles::BorderStyle;

    let lower = CellFormat {
        borders: Some(CellBorders {
            top: Some(CellBorderSide {
                style: Some(BorderStyle::Thin),
                color: Some("#111111".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        }),
        ..Default::default()
    };
    let higher = CellFormat {
        borders: Some(CellBorders::default()),
        ..Default::default()
    };

    let merged = merge_formats(&lower, &higher);
    assert_eq!(merged.borders, Some(CellBorders::default()));
}

#[test]
fn test_merge_formats_preserves_extended_sparse_fields() {
    let lower = CellFormat {
        font_color_tint: Some(0.25),
        auto_indent: Some(true),
        background_color_tint: Some(-0.4),
        pattern_foreground_color_tint: Some(0.5),
        ..Default::default()
    };
    let higher = CellFormat {
        auto_indent: Some(false),
        ..Default::default()
    };

    let merged = merge_formats(&lower, &higher);
    assert_eq!(merged.font_color_tint, Some(0.25));
    assert_eq!(merged.auto_indent, Some(false));
    assert_eq!(merged.background_color_tint, Some(-0.4));
    assert_eq!(merged.pattern_foreground_color_tint, Some(0.5));
}

// -------------------------------------------------------------------
// Test 1: Set + get properties
// -------------------------------------------------------------------

#[test]
fn test_set_and_get_properties() {
    let (mut storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    let props = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        }),
        provenance: Some("ai".to_string()),
        ..Default::default()
    };
    set_properties(doc, sheets, &sid, "cell-a", &props);

    let got = get_properties(doc, workbook, sheets, &sid, "cell-a").unwrap();
    assert_eq!(got.format.as_ref().unwrap().bold, Some(true));
    assert_eq!(got.provenance, Some("ai".to_string()));
}

// -------------------------------------------------------------------
// Test 2: Clear properties
// -------------------------------------------------------------------

#[test]
fn test_clear_properties() {
    let (mut storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    let props = CellProperties {
        provenance: Some("user".to_string()),
        ..Default::default()
    };
    set_properties(doc, sheets, &sid, "cell-b", &props);
    assert!(get_properties(doc, workbook, sheets, &sid, "cell-b").is_some());

    clear_properties(doc, sheets, &sid, "cell-b");
    assert!(get_properties(doc, workbook, sheets, &sid, "cell-b").is_none());
}

// -------------------------------------------------------------------
// Test 3: Set + get cell format
// -------------------------------------------------------------------

#[test]
fn test_set_and_get_cell_format() {
    let (mut storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    let fmt = CellFormat {
        font_size: Some(domain_types::FontSize::from_millipoints(14000)),
        bold: Some(true),
        ..Default::default()
    };
    set_cell_format(doc, workbook, sheets, &sid, "cell-c", &fmt);

    let got = get_cell_format(doc, workbook, sheets, &sid, "cell-c").unwrap();
    assert_eq!(
        got.font_size,
        Some(domain_types::FontSize::from_millipoints(14000))
    );
    assert_eq!(got.bold, Some(true));
}

// -------------------------------------------------------------------
// Test 4: Clear cell format preserves other properties
// -------------------------------------------------------------------

#[test]
fn test_clear_cell_format_preserves_metadata() {
    let (mut storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    let props = CellProperties {
        format: Some(CellFormat {
            italic: Some(true),
            ..Default::default()
        }),
        provenance: Some("import".to_string()),
        ..Default::default()
    };
    set_properties(doc, sheets, &sid, "cell-d", &props);

    clear_cell_format(doc, workbook, sheets, &sid, "cell-d");

    let got = get_properties(doc, workbook, sheets, &sid, "cell-d").unwrap();
    assert!(got.format.is_none());
    assert_eq!(got.provenance, Some("import".to_string()));
}

// -------------------------------------------------------------------
// Test 5: Clear cell format deletes entry when no metadata
// -------------------------------------------------------------------

#[test]
fn test_clear_cell_format_deletes_when_empty() {
    let (mut storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    let props = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    set_properties(doc, sheets, &sid, "cell-e", &props);

    clear_cell_format(doc, workbook, sheets, &sid, "cell-e");
    assert!(get_properties(doc, workbook, sheets, &sid, "cell-e").is_none());
}

// -------------------------------------------------------------------
// Test 6: Batch set formats
// -------------------------------------------------------------------

#[test]
fn test_batch_set_formats() {
    let (mut storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    let fmt = CellFormat {
        font_color: Some("#FF0000".to_string()),
        ..Default::default()
    };
    set_cell_formats(doc, workbook, sheets, &sid, &["c1", "c2", "c3"], &fmt);

    for cid in &["c1", "c2", "c3"] {
        let got = get_cell_format(doc, workbook, sheets, &sid, cid).unwrap();
        assert_eq!(got.font_color, Some("#FF0000".to_string()));
    }
}

// -------------------------------------------------------------------
// Test 7: Batch clear formats
// -------------------------------------------------------------------

#[test]
fn test_batch_clear_formats() {
    let (mut storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    let fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    set_cell_formats(doc, workbook, sheets, &sid, &["c1", "c2"], &fmt);

    clear_cell_formats(doc, workbook, sheets, &sid, &["c1", "c2"]);

    assert!(get_cell_format(doc, workbook, sheets, &sid, "c1").is_none());
    assert!(get_cell_format(doc, workbook, sheets, &sid, "c2").is_none());
}

// -------------------------------------------------------------------
// Test 8: Set + get row format (materializes row)
// -------------------------------------------------------------------

#[test]
fn test_set_and_get_row_format() {
    let (mut storage, sid, gi) = storage_with_sheet();

    let fmt = CellFormat {
        background_color: Some("#00FF00".to_string()),
        ..Default::default()
    };
    set_row_format(&mut storage, &sid, 5, &fmt, Some(&gi)).unwrap();

    let got = get_row_format(&storage, &sid, 5, Some(&gi)).unwrap();
    assert_eq!(got.background_color, Some("#00FF00".to_string()));
}

// -------------------------------------------------------------------
// Test 9: Get row format on unmaterialized row returns None
// -------------------------------------------------------------------

#[test]
fn test_get_row_format_unmaterialized() {
    let (storage, sid, gi) = storage_with_sheet();
    assert!(get_row_format(&storage, &sid, 99, Some(&gi)).is_none());
}

// -------------------------------------------------------------------
// Test 10: Clear row format
// -------------------------------------------------------------------

#[test]
fn test_clear_row_format() {
    let (mut storage, sid, gi) = storage_with_sheet();

    let fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    set_row_format(&mut storage, &sid, 3, &fmt, Some(&gi)).unwrap();
    assert!(get_row_format(&storage, &sid, 3, Some(&gi)).is_some());

    clear_row_format(&mut storage, &sid, 3, Some(&gi));
    assert!(get_row_format(&storage, &sid, 3, Some(&gi)).is_none());
}

// -------------------------------------------------------------------
// Test 11: Set + get col format (materializes column)
// -------------------------------------------------------------------

#[test]
fn test_set_and_get_col_format() {
    let (mut storage, sid, gi) = storage_with_sheet();

    let fmt = CellFormat {
        number_format: Some("#,##0.00".to_string()),
        ..Default::default()
    };
    set_col_format(&mut storage, &sid, 2, &fmt, Some(&gi)).unwrap();

    let got = get_col_format(&storage, &sid, 2, Some(&gi)).unwrap();
    assert_eq!(got.number_format, Some("#,##0.00".to_string()));
}

// -------------------------------------------------------------------
// Test 12: Get col format on unmaterialized column returns None
// -------------------------------------------------------------------

#[test]
fn test_get_col_format_unmaterialized() {
    let (storage, sid, gi) = storage_with_sheet();
    assert!(get_col_format(&storage, &sid, 25, Some(&gi)).is_none());
}

// -------------------------------------------------------------------
// Test 13: Clear col format
// -------------------------------------------------------------------

#[test]
fn test_clear_col_format() {
    let (mut storage, sid, gi) = storage_with_sheet();

    let fmt = CellFormat {
        italic: Some(true),
        ..Default::default()
    };
    set_col_format(&mut storage, &sid, 4, &fmt, Some(&gi)).unwrap();
    assert!(get_col_format(&storage, &sid, 4, Some(&gi)).is_some());

    clear_col_format(&mut storage, &sid, 4, Some(&gi));
    assert!(get_col_format(&storage, &sid, 4, Some(&gi)).is_none());
}

// -------------------------------------------------------------------
// Test 14: Effective format — cell overrides row overrides column overrides default
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Test 15: Effective format — no overrides returns default
// -------------------------------------------------------------------

#[test]
fn test_effective_format_no_overrides() {
    let (storage, sid, gi) = storage_with_sheet();

    let eff = get_effective_format(&storage, &sid, "no-cell", 0, 0, None, Some(&gi), None);
    let def = default_format();

    assert_eq!(eff.font_family, def.font_family);
    assert_eq!(eff.font_size, def.font_size);
    assert_eq!(eff.bold, def.bold);
    assert_eq!(eff.locked, def.locked);
}

// -------------------------------------------------------------------
// Test 16: Effective format — only row format set
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Test 17: Effective format — only col format set
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Test 18: is_cell_locked — default true
// -------------------------------------------------------------------

#[test]
fn test_is_locked_default_true() {
    let (storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());
    assert!(is_cell_locked(doc, workbook, sheets, &sid, "unknown-cell"));
}

// -------------------------------------------------------------------
// Test 19: is_cell_locked — explicitly false
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Test 20: is_formula_hidden — default false
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Test 21: is_formula_hidden — explicitly true
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Test 22: Properties on nonexistent sheet
// -------------------------------------------------------------------

#[test]
fn test_properties_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());
    let sid = make_sheet_id(999);

    assert!(get_properties(doc, workbook, sheets, &sid, "any").is_none());
    assert!(get_cell_format(doc, workbook, sheets, &sid, "any").is_none());
    assert!(get_row_format(&storage, &sid, 0, None).is_none());
    assert!(get_col_format(&storage, &sid, 0, None).is_none());
    assert!(is_cell_locked(doc, workbook, sheets, &sid, "any")); // default true
    assert!(!is_formula_hidden(doc, workbook, sheets, &sid, "any")); // default false
}

// -------------------------------------------------------------------
// Test 23: set_cell_format merges with existing format
// -------------------------------------------------------------------

#[test]
fn test_set_cell_format_merges() {
    let (mut storage, sid, gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    // First set: bold
    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "merge-cell",
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );

    // Second set: italic (should merge, not replace)
    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "merge-cell",
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
    );

    let got = get_cell_format(doc, workbook, sheets, &sid, "merge-cell").unwrap();
    assert_eq!(got.bold, Some(true));
    assert_eq!(got.italic, Some(true));
}

#[test]
fn test_wrap_text_and_shrink_to_fit_are_exclusive_for_cell_formats() {
    let (storage, sid, _gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    set_cell_format(
        doc,
        workbook,
        sheets,
        &sid,
        "cell-wrap-shrink",
        &CellFormat {
            wrap_text: Some(true),
            ..Default::default()
        },
    );

    set_cell_format(
        doc,
        workbook,
        sheets,
        &sid,
        "cell-wrap-shrink",
        &CellFormat {
            shrink_to_fit: Some(true),
            ..Default::default()
        },
    );

    let got = get_cell_format(doc, workbook, sheets, &sid, "cell-wrap-shrink").unwrap();
    assert_eq!(got.wrap_text, Some(false));
    assert_eq!(got.shrink_to_fit, Some(true));

    set_cell_format(
        doc,
        workbook,
        sheets,
        &sid,
        "cell-wrap-shrink",
        &CellFormat {
            wrap_text: Some(true),
            ..Default::default()
        },
    );

    let got = get_cell_format(doc, workbook, sheets, &sid, "cell-wrap-shrink").unwrap();
    assert_eq!(got.wrap_text, Some(true));
    assert_eq!(got.shrink_to_fit, Some(false));
}

// -------------------------------------------------------------------
// Test 24: set_row_format merges with existing row format
// -------------------------------------------------------------------

#[test]
fn test_set_row_format_merges() {
    let (mut storage, sid, gi) = storage_with_sheet();

    set_row_format(
        &mut storage,
        &sid,
        0,
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    set_row_format(
        &mut storage,
        &sid,
        0,
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    let got = get_row_format(&storage, &sid, 0, Some(&gi)).unwrap();
    assert_eq!(got.bold, Some(true));
    assert_eq!(got.italic, Some(true));
}

#[test]
fn test_wrap_text_and_shrink_to_fit_are_exclusive_for_row_and_col_formats() {
    let (mut storage, sid, gi) = storage_with_sheet();

    set_row_format(
        &mut storage,
        &sid,
        0,
        &CellFormat {
            wrap_text: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    set_row_format(
        &mut storage,
        &sid,
        0,
        &CellFormat {
            shrink_to_fit: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    let row = get_row_format(&storage, &sid, 0, Some(&gi)).unwrap();
    assert_eq!(row.wrap_text, Some(false));
    assert_eq!(row.shrink_to_fit, Some(true));

    set_col_format(
        &mut storage,
        &sid,
        0,
        &CellFormat {
            shrink_to_fit: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    set_col_format(
        &mut storage,
        &sid,
        0,
        &CellFormat {
            wrap_text: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    let col = get_col_format(&storage, &sid, 0, Some(&gi)).unwrap();
    assert_eq!(col.wrap_text, Some(true));
    assert_eq!(col.shrink_to_fit, Some(false));
}

// -------------------------------------------------------------------
// Test 25: CellProperties serde roundtrip
// -------------------------------------------------------------------

#[test]
fn test_cell_properties_serde_roundtrip() {
    let props = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            font_size: Some(domain_types::FontSize::from_millipoints(14000)),
            ..Default::default()
        }),
        provenance: Some("ai-generated".to_string()),
        validation: None,
        connection_id: Some("conn-1".to_string()),
        ..Default::default()
    };

    let json = serde_json::to_string(&props).unwrap();
    let parsed: CellProperties = serde_json::from_str(&json).unwrap();
    assert_eq!(props, parsed);
}

// -------------------------------------------------------------------
// Test 26: CellFormat serde roundtrip with camelCase
// -------------------------------------------------------------------

#[test]
fn test_cell_format_serde_camel_case() {
    let fmt = CellFormat {
        font_family: Some("Arial".to_string()),
        font_size: Some(domain_types::FontSize::from_millipoints(12000)),
        horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Center),
        wrap_text: Some(true),
        ..Default::default()
    };

    let json = serde_json::to_string(&fmt).unwrap();
    // Verify camelCase in JSON
    assert!(json.contains("fontFamily"));
    assert!(json.contains("fontSize"));
    assert!(json.contains("horizontalAlign"));
    assert!(json.contains("wrapText"));
    // Should NOT contain snake_case
    assert!(!json.contains("font_family"));
    assert!(!json.contains("font_size"));

    let parsed: CellFormat = serde_json::from_str(&json).unwrap();
    assert_eq!(fmt, parsed);
}

// -------------------------------------------------------------------
// Test 27: default_format has expected values
// -------------------------------------------------------------------

#[test]
fn test_default_format_values() {
    let def = default_format();
    assert_eq!(def.font_family, Some("Calibri".to_string()));
    assert_eq!(
        def.font_size,
        Some(domain_types::FontSize::from_millipoints(11000))
    );
    assert_eq!(def.font_color, Some("#000000".to_string()));
    assert_eq!(def.bold, Some(false));
    assert_eq!(def.italic, Some(false));
    assert_eq!(def.locked, Some(true));
    assert_eq!(def.hidden, Some(false));
    assert!(def.number_format.is_none());
    assert!(def.background_color.is_none());
}

// -------------------------------------------------------------------
// Test 28: merge_formats helper
// -------------------------------------------------------------------

#[test]
fn test_merge_formats_higher_wins() {
    let lower = CellFormat {
        bold: Some(true),
        font_size: Some(domain_types::FontSize::from_millipoints(10000)),
        ..Default::default()
    };
    let higher = CellFormat {
        bold: Some(false),
        italic: Some(true),
        ..Default::default()
    };

    let merged = merge_formats(&lower, &higher);
    assert_eq!(merged.bold, Some(false)); // higher wins
    assert_eq!(
        merged.font_size,
        Some(domain_types::FontSize::from_millipoints(10000))
    ); // from lower
    assert_eq!(merged.italic, Some(true)); // from higher
}

// -------------------------------------------------------------------
// Test 29: clear_row_format on virtual row is no-op
// -------------------------------------------------------------------

#[test]
fn test_clear_row_format_virtual_noop() {
    let (mut storage, sid, gi) = storage_with_sheet();
    // Should not panic
    clear_row_format(&mut storage, &sid, 99, Some(&gi));
    assert!(get_row_format(&storage, &sid, 99, Some(&gi)).is_none());
}

// -------------------------------------------------------------------
// Test 30: clear_col_format on virtual column is no-op
// -------------------------------------------------------------------

#[test]
fn test_clear_col_format_virtual_noop() {
    let (mut storage, sid, gi) = storage_with_sheet();
    // Should not panic
    clear_col_format(&mut storage, &sid, 25, Some(&gi));
    assert!(get_col_format(&storage, &sid, 25, Some(&gi)).is_none());
}

// -------------------------------------------------------------------
// Test 31: set_cell_formats preserves existing format from compact palette
// Reproduces the xlsx border-wipes-format bug
// -------------------------------------------------------------------

#[test]
fn test_set_cell_formats_preserves_compact_palette_format() {
    let (mut storage, sid, _gi) = storage_with_sheet();
    let doc = storage.doc();
    let workbook = storage.workbook_map().clone();
    let sheets = storage.sheets().clone();

    // 1. Simulate xlsx hydration: write a style palette entry
    let fmt = CellFormat {
        bold: Some(true),
        font_size: Some(domain_types::FontSize::from_millipoints(10000)),
        font_family: Some("Calibri".to_string()),
        number_format: Some("#,##0".to_string()),
        ..Default::default()
    };
    let fmt_json = serde_json::to_string(&fmt).unwrap();
    {
        let mut txn = doc.transact_mut();
        // Create stylePalette in workbook map
        let palette_prelim: MapPrelim =
            vec![("5", Any::String(std::sync::Arc::from(fmt_json.as_str())))]
                .into_iter()
                .collect();
        workbook.insert(
            &mut txn,
            compute_document::schema::KEY_STYLE_PALETTE,
            palette_prelim,
        );
    }

    // 2. Write compact JSON to cellProperties (like hydrate_cell_styles does)
    let cell_hex = "deadbeef00000000deadbeef00000000";
    {
        let mut txn = doc.transact_mut();
        let sheet_hex = id_to_hex(sid.as_u128());
        let sheet_map = match sheets.get(&txn, &sheet_hex) {
            Some(Out::YMap(m)) => m,
            _ => panic!("sheet map not found"),
        };
        let props_map = match sheet_map.get(&txn, KEY_CELL_PROPERTIES) {
            Some(Out::YMap(m)) => m,
            _ => panic!("cellProperties map not found"),
        };
        // Compact format: {"s":5}
        props_map.insert(
            &mut txn,
            cell_hex,
            Any::String(std::sync::Arc::from(r#"{"s":5}"#)),
        );
    }

    // 3. Verify get_properties reads the compact format correctly
    let existing = get_properties(doc, &workbook, &sheets, &sid, cell_hex);
    assert!(
        existing.is_some(),
        "get_properties should return Some for compact format cell"
    );
    let existing = existing.unwrap();
    assert!(
        existing.format.is_some(),
        "format should be resolved from palette"
    );
    assert_eq!(existing.format.as_ref().unwrap().bold, Some(true));
    assert_eq!(
        existing.format.as_ref().unwrap().font_family,
        Some("Calibri".to_string())
    );

    // 4. Call set_cell_formats with ONLY borders (simulating APPLY_BORDERS)
    let border_fmt = CellFormat {
        borders: Some(domain_types::CellBorders {
            top: Some(domain_types::CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Thin),
                color: Some("#000000".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        }),
        ..Default::default()
    };
    set_cell_formats(doc, &workbook, &sheets, &sid, &[cell_hex], &border_fmt);

    // 5. Read back and verify ALL format properties are preserved
    let after = get_properties(doc, &workbook, &sheets, &sid, cell_hex);
    assert!(
        after.is_some(),
        "properties should exist after set_cell_formats"
    );
    let after = after.unwrap();
    assert!(
        after.format.is_some(),
        "format should exist after set_cell_formats"
    );
    let after_fmt = after.format.unwrap();

    // Borders should be applied
    assert!(after_fmt.borders.is_some(), "borders should be applied");
    assert!(
        after_fmt.borders.as_ref().unwrap().top.is_some(),
        "top border should be set"
    );

    // Existing format properties MUST be preserved (this is the bug check)
    assert_eq!(
        after_fmt.bold,
        Some(true),
        "bold should be preserved after border-only operation"
    );
    assert_eq!(
        after_fmt.font_size,
        Some(domain_types::FontSize::from_millipoints(10000)),
        "font_size should be preserved after border-only operation"
    );
    assert_eq!(
        after_fmt.font_family,
        Some("Calibri".to_string()),
        "font_family should be preserved after border-only operation"
    );
    assert_eq!(
        after_fmt.number_format,
        Some("#,##0".to_string()),
        "number_format should be preserved after border-only operation"
    );
}

// ===================================================================
// Format Range Tests
// ===================================================================

/// Helper: create a storage with a sheet and get a mutable SheetMirror reference.
fn storage_with_sheet_and_mirror() -> (
    crate::storage::YrsStorage,
    SheetId,
    GridIndex,
    crate::mirror::CellMirror,
) {
    let mut storage = crate::storage::YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
        .unwrap();
    let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::new());
    let gi = GridIndex::new(sid, 100, 26, id_alloc);
    (storage, sid, gi, mirror)
}

// -------------------------------------------------------------------
// Test 32: Format cascade with all layers — cell > table > Format Range > row > col > default
// -------------------------------------------------------------------

#[test]
fn test_format_cascade_all_layers() {
    let (mut storage, sid, gi, mut mirror) = storage_with_sheet_and_mirror();

    // Column 1: number format
    set_col_format(
        &mut storage,
        &sid,
        1,
        &CellFormat {
            number_format: Some("0.00%".to_string()),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    // Row 2: font_color
    set_row_format(
        &mut storage,
        &sid,
        2,
        &CellFormat {
            font_color: Some("#FF0000".to_string()),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    // Format Range covering (0,0)-(5,5): background_color + italic
    let range_id = crate::mirror::RangeId::from_raw(1000);
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id,
        0,
        0,
        5,
        5,
        &CellFormat {
            background_color: Some("#00FF00".to_string()),
            italic: Some(true),
            ..Default::default()
        },
    );

    // Table format: bold
    let table_fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };

    // Cell format: wrap_text
    set_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        &sid,
        "cell-cascade",
        &CellFormat {
            wrap_text: Some(true),
            ..Default::default()
        },
    );

    // Get effective format at (2, 1) with all layers
    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let eff = get_effective_format(
        &storage,
        &sid,
        "cell-cascade",
        2,
        1,
        Some(&table_fmt),
        Some(&gi),
        Some(sheet_mirror),
    );

    // Verify cascade priority: cell > table > Format Range > row > col > default
    // wrap_text: from cell
    assert_eq!(eff.wrap_text, Some(true));
    // bold: from table
    assert_eq!(eff.bold, Some(true));
    // background_color: from Format Range
    assert_eq!(eff.background_color, Some("#00FF00".to_string()));
    // italic: from Format Range
    assert_eq!(eff.italic, Some(true));
    // font_color: from row
    assert_eq!(eff.font_color, Some("#FF0000".to_string()));
    // number_format: from col
    assert_eq!(eff.number_format, Some("0.00%".to_string()));
    // font_family: from default
    assert_eq!(eff.font_family, Some("Calibri".to_string()));
}

// -------------------------------------------------------------------
// Test 33: Two overlapping Format Ranges — non-conflicting merge + conflict resolution
// -------------------------------------------------------------------

#[test]
fn test_overlapping_format_ranges() {
    let (mut storage, sid, _gi, mut mirror) = storage_with_sheet_and_mirror();

    // Range 1 (lower RangeId): background_color + italic
    let range_id_low = crate::mirror::RangeId::from_raw(100);
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id_low,
        0,
        0,
        10,
        10,
        &CellFormat {
            background_color: Some("#AAAAAA".to_string()),
            italic: Some(true),
            ..Default::default()
        },
    );

    // Range 2 (higher RangeId): background_color (conflicting) + bold (non-conflicting)
    let range_id_high = crate::mirror::RangeId::from_raw(200);
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id_high,
        0,
        0,
        5,
        5,
        &CellFormat {
            background_color: Some("#BBBBBB".to_string()),
            bold: Some(true),
            ..Default::default()
        },
    );

    // Query at (3, 3) — both ranges overlap
    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let base = default_format();
    let result = apply_format_range_layer(&base, 3, 3, Some(sheet_mirror));

    // Non-conflicting: italic from range 1
    assert_eq!(result.italic, Some(true));
    // Non-conflicting: bold from range 2
    assert_eq!(result.bold, Some(true));
    // Conflicting: background_color — higher RangeId (200) wins
    assert_eq!(result.background_color, Some("#BBBBBB".to_string()));

    // Query at (7, 7) — only range 1 overlaps
    let result2 = apply_format_range_layer(&base, 7, 7, Some(sheet_mirror));
    assert_eq!(result2.background_color, Some("#AAAAAA".to_string()));
    assert_eq!(result2.italic, Some(true));
    assert_eq!(result2.bold, Some(false)); // from default

    // Query at (12, 12) — no ranges overlap
    let result3 = apply_format_range_layer(&base, 12, 12, Some(sheet_mirror));
    assert_eq!(result3.background_color, None); // default has no background
}

// -------------------------------------------------------------------
// Test 34: Format Range deletion — cascade falls back
// -------------------------------------------------------------------

#[test]
fn test_format_range_deletion_lifecycle() {
    let (mut storage, sid, gi, mut mirror) = storage_with_sheet_and_mirror();

    let range_id = crate::mirror::RangeId::from_raw(500);
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id,
        0,
        0,
        10,
        10,
        &CellFormat {
            background_color: Some("#FF0000".to_string()),
            ..Default::default()
        },
    );

    // Verify it's in the cascade
    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let base = default_format();
    let result = apply_format_range_layer(&base, 5, 5, Some(sheet_mirror));
    assert_eq!(result.background_color, Some("#FF0000".to_string()));

    // Delete the Format Range
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    remove_format_range(&mut storage, &sid, sheet_mirror, range_id);

    // After deletion, cascade falls back to base (no background_color)
    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let result2 = apply_format_range_layer(&base, 5, 5, Some(sheet_mirror));
    assert_eq!(result2.background_color, None);

    // Verify the mirror state
    assert!(sheet_mirror.format_ranges().is_empty());
    assert!(sheet_mirror.range_format_cache().is_empty());
}

// -------------------------------------------------------------------
// Test 35: Cold-load — Format Range survives Yrs rehydration
// -------------------------------------------------------------------

#[test]
fn test_format_range_cold_load() {
    let (mut storage, sid, _gi, mut mirror) = storage_with_sheet_and_mirror();

    // Add a Format Range
    let range_id = crate::mirror::RangeId::from_raw(777);
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id,
        2,
        3,
        8,
        7,
        &CellFormat {
            bold: Some(true),
            font_color: Some("#0000FF".to_string()),
            ..Default::default()
        },
    );

    // Create a fresh SheetMirror (simulating cold-load) and hydrate
    let mut fresh_mirror = crate::mirror::SheetMirror::new(sid, "Sheet1".to_string(), 100, 26);
    assert!(fresh_mirror.format_ranges().is_empty());
    assert!(fresh_mirror.range_format_cache().is_empty());

    hydrate_format_ranges(&storage, &sid, &mut fresh_mirror);

    // Verify hydration populated the mirror
    assert_eq!(fresh_mirror.format_ranges().len(), 1);
    assert_eq!(fresh_mirror.range_format_cache().len(), 1);

    let fr = &fresh_mirror.format_ranges()[0];
    assert_eq!(fr.id, range_id);
    assert_eq!(fr.start_row, 2);
    assert_eq!(fr.start_col, 3);
    assert_eq!(fr.end_row, 8);
    assert_eq!(fr.end_col, 7);

    let fmt = fresh_mirror.range_format_cache().get(&range_id).unwrap();
    assert_eq!(fmt.bold, Some(true));
    assert_eq!(fmt.font_color, Some("#0000FF".to_string()));

    // Verify the cascade works with the hydrated mirror
    let base = default_format();
    let result = apply_format_range_layer(&base, 5, 5, Some(&fresh_mirror));
    assert_eq!(result.bold, Some(true));
    assert_eq!(result.font_color, Some("#0000FF".to_string()));

    // Outside the range — no effect
    let result_outside = apply_format_range_layer(&base, 0, 0, Some(&fresh_mirror));
    assert_eq!(result_outside.bold, Some(false)); // from default
}

// -------------------------------------------------------------------
// Test 36: Hydration on empty rangeFormats is a no-op
// -------------------------------------------------------------------

#[test]
fn test_hydrate_empty_range_formats() {
    let (storage, sid, _gi, _mirror) = storage_with_sheet_and_mirror();

    // Fresh mirror + hydrate from a sheet with empty rangeFormats
    let mut fresh_mirror = crate::mirror::SheetMirror::new(sid, "Sheet1".to_string(), 100, 26);
    hydrate_format_ranges(&storage, &sid, &mut fresh_mirror);

    assert!(fresh_mirror.format_ranges().is_empty());
    assert!(fresh_mirror.range_format_cache().is_empty());
}

// -------------------------------------------------------------------
// Test 37: Positional format includes Format Range layer
// -------------------------------------------------------------------

#[test]
fn test_positional_format_with_ranges() {
    let (mut storage, sid, gi, mut mirror) = storage_with_sheet_and_mirror();

    let range_id = crate::mirror::RangeId::from_raw(300);
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id,
        0,
        0,
        10,
        10,
        &CellFormat {
            background_color: Some("#ABCDEF".to_string()),
            ..Default::default()
        },
    );

    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let eff = get_positional_format(&storage, &sid, 5, 5, Some(&gi), Some(sheet_mirror));
    assert_eq!(eff.background_color, Some("#ABCDEF".to_string()));
    // Default fields still present
    assert_eq!(eff.font_family, Some("Calibri".to_string()));
}

// -------------------------------------------------------------------
// Test 38: Format Range update (add same RangeId with different format)
// -------------------------------------------------------------------

#[test]
fn test_format_range_update() {
    let (mut storage, sid, _gi, mut mirror) = storage_with_sheet_and_mirror();

    let range_id = crate::mirror::RangeId::from_raw(400);
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();

    // Initial format: bold
    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id,
        0,
        0,
        5,
        5,
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );

    // Update: change to italic (same RangeId)
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id,
        0,
        0,
        5,
        5,
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
    );

    // Should have exactly 1 range, not 2
    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    assert_eq!(sheet_mirror.format_ranges().len(), 1);

    let base = default_format();
    let result = apply_format_range_layer(&base, 3, 3, Some(sheet_mirror));
    // Should have the updated format (italic), not the old one (bold)
    assert_eq!(result.italic, Some(true));
    // bold should come from default (false), since the update replaced the format
    assert_eq!(result.bold, Some(false));
}

// -------------------------------------------------------------------
// Test 39: preloaded cascade with Format Range
// -------------------------------------------------------------------

#[test]
fn test_effective_format_preloaded_with_ranges() {
    let (mut storage, sid, gi, mut mirror) = storage_with_sheet_and_mirror();

    let range_id = crate::mirror::RangeId::from_raw(600);
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id,
        0,
        0,
        10,
        10,
        &CellFormat {
            background_color: Some("#123456".to_string()),
            ..Default::default()
        },
    );

    let cell_fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };

    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let eff = get_effective_format_preloaded(
        &storage,
        &sid,
        5,
        5,
        None,
        &cell_fmt,
        Some(&gi),
        Some(sheet_mirror),
    );

    assert_eq!(eff.bold, Some(true)); // from cell format
    assert_eq!(eff.background_color, Some("#123456".to_string())); // from Format Range
    assert_eq!(eff.font_family, Some("Calibri".to_string())); // from default
}
