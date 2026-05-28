use super::support::*;
use super::*;

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

#[test]
fn test_clear_formula_cache_metadata_preserves_unrelated_properties() {
    let (storage, sid, _gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    let props = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        }),
        provenance: Some("import".to_string()),
        formula_result_type: Some(2),
        has_empty_cached_value: true,
        original_sst_index: Some(9),
        original_value: Some("cached".to_string()),
        ..Default::default()
    };
    set_properties(doc, sheets, &sid, "formula-cell", &props);

    clear_formula_cache_metadata(doc, workbook, sheets, &sid, "formula-cell");

    let got = get_properties(doc, workbook, sheets, &sid, "formula-cell").unwrap();
    assert_eq!(got.format.as_ref().unwrap().bold, Some(true));
    assert_eq!(got.provenance.as_deref(), Some("import"));
    assert_eq!(got.formula_result_type, None);
    assert!(!got.has_empty_cached_value);
    assert_eq!(got.original_sst_index, Some(9));
    assert_eq!(got.original_value.as_deref(), Some("cached"));
}

#[test]
fn test_clear_formula_cache_metadata_deletes_entry_when_empty() {
    let (storage, sid, _gi) = storage_with_sheet();
    let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

    let props = CellProperties {
        formula_result_type: Some(1),
        has_empty_cached_value: true,
        ..Default::default()
    };
    set_properties(doc, sheets, &sid, "formula-only", &props);

    clear_formula_cache_metadata(doc, workbook, sheets, &sid, "formula-only");

    assert!(get_properties(doc, workbook, sheets, &sid, "formula-only").is_none());
}

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
