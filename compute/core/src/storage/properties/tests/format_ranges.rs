use super::support::*;
use super::*;

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

#[test]
fn col_format_ranges_are_column_defaults_below_explicit_col_and_row_formats() {
    let (mut storage, sid, gi, mut mirror) = storage_with_sheet_and_mirror();

    insert_col_format_range(
        &storage,
        &sid,
        crate::mirror::RangeId::from_raw(500),
        1,
        200,
        &CellFormat {
            number_format: Some("0.0".to_string()),
            font_color: Some("#0000FF".to_string()),
            background_color: Some("#EEEEEE".to_string()),
            ..Default::default()
        },
        Some(9),
    );
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    hydrate_col_format_ranges(&storage, &sid, sheet_mirror);

    set_col_format(
        &mut storage,
        &sid,
        2,
        &CellFormat {
            number_format: Some("0.00%".to_string()),
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
            font_color: Some("#FF0000".to_string()),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();

    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let inherited = get_positional_format(&storage, &sid, 4, 1, Some(&gi), Some(sheet_mirror));
    assert_eq!(inherited.number_format, Some("0.0".to_string()));
    assert_eq!(inherited.font_color, Some("#FF0000".to_string()));
    assert_eq!(inherited.background_color, Some("#EEEEEE".to_string()));

    let explicit_col = get_positional_format(&storage, &sid, 4, 2, Some(&gi), Some(sheet_mirror));
    assert_eq!(explicit_col.number_format, Some("0.00%".to_string()));
    assert_eq!(explicit_col.font_color, Some("#FF0000".to_string()));

    let virtual_col = get_positional_format(&storage, &sid, 0, 200, Some(&gi), Some(sheet_mirror));
    assert_eq!(virtual_col.number_format, Some("0.0".to_string()));
}

#[test]
fn imported_col_style_ranges_only_apply_to_positional_cells() {
    let (storage, sid, gi, mut mirror) = storage_with_sheet_and_mirror();

    insert_style_palette_entry(
        storage.doc(),
        storage.workbook_map(),
        0,
        &CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(12000)),
            ..Default::default()
        },
    );
    insert_col_format_range(
        &storage,
        &sid,
        crate::mirror::RangeId::from_raw(700),
        1,
        1,
        &CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(11000)),
            font_color: Some("#777777".to_string()),
            ..Default::default()
        },
        Some(50),
    );
    insert_col_format_range(
        &storage,
        &sid,
        crate::mirror::RangeId::from_raw(701),
        2,
        2,
        &CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(10000)),
            font_color: Some("#123456".to_string()),
            ..Default::default()
        },
        None,
    );
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    hydrate_col_format_ranges(&storage, &sid, sheet_mirror);

    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let populated_imported_col = get_effective_format(
        &storage,
        &sid,
        "allocated-b5",
        4,
        1,
        None,
        Some(&gi),
        Some(sheet_mirror),
    );
    assert_eq!(
        populated_imported_col.font_size,
        Some(domain_types::FontSize::from_millipoints(12000)),
        "allocated cells should keep workbook Normal instead of XLSX column defaults"
    );
    assert_ne!(
        populated_imported_col.font_color.as_deref(),
        Some("#777777"),
        "allocated cells should not inherit XLSX column-default color"
    );

    let virtual_imported_col =
        get_positional_format(&storage, &sid, 5, 1, Some(&gi), Some(sheet_mirror));
    assert_eq!(
        virtual_imported_col.font_size,
        Some(domain_types::FontSize::from_millipoints(11000)),
        "positional empty cells still inherit XLSX column defaults"
    );
    assert_eq!(virtual_imported_col.font_color.as_deref(), Some("#777777"));

    let populated_user_sparse_col = get_effective_format(
        &storage,
        &sid,
        "allocated-c5",
        4,
        2,
        None,
        Some(&gi),
        Some(sheet_mirror),
    );
    assert_eq!(
        populated_user_sparse_col.font_size,
        Some(domain_types::FontSize::from_millipoints(10000)),
        "user sparse column ranges should keep applying to allocated cells"
    );
    assert_eq!(
        populated_user_sparse_col.font_color.as_deref(),
        Some("#123456")
    );
}

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

#[test]
fn test_hydrate_empty_range_formats() {
    let (storage, sid, _gi, _mirror) = storage_with_sheet_and_mirror();

    // Fresh mirror + hydrate from a sheet with empty rangeFormats
    let mut fresh_mirror = crate::mirror::SheetMirror::new(sid, "Sheet1".to_string(), 100, 26);
    hydrate_format_ranges(&storage, &sid, &mut fresh_mirror);

    assert!(fresh_mirror.format_ranges().is_empty());
    assert!(fresh_mirror.range_format_cache().is_empty());
}

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

#[test]
fn test_format_range_update_rebuilds_lookup_index_for_new_bounds() {
    let (mut storage, sid, _gi, mut mirror) = storage_with_sheet_and_mirror();

    let range_id = crate::mirror::RangeId::from_raw(401);
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();

    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id,
        0,
        0,
        2,
        2,
        &CellFormat {
            background_color: Some("#AA0000".to_string()),
            ..Default::default()
        },
    );

    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
    add_format_range(
        &mut storage,
        &sid,
        sheet_mirror,
        range_id,
        20,
        20,
        22,
        22,
        &CellFormat {
            background_color: Some("#00AA00".to_string()),
            ..Default::default()
        },
    );

    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let base = default_format();
    let old_location = apply_format_range_layer(&base, 1, 1, Some(sheet_mirror));
    let new_location = apply_format_range_layer(&base, 21, 21, Some(sheet_mirror));

    assert_eq!(old_location.background_color, None);
    assert_eq!(new_location.background_color, Some("#00AA00".to_string()));
}

#[test]
fn test_format_range_lookup_with_many_ranges_preserves_range_id_order() {
    let (_storage, sid, _gi, mut mirror) = storage_with_sheet_and_mirror();
    let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();

    for idx in 0..2_000u32 {
        let range_id = crate::mirror::RangeId::from_raw(10_000 + idx as u128);
        sheet_mirror.format_ranges.push(crate::mirror::FormatRange {
            id: range_id,
            start_row: idx + 100,
            start_col: 0,
            end_row: idx + 100,
            end_col: 1,
        });
        sheet_mirror.range_format_cache.insert(
            range_id,
            CellFormat {
                italic: Some(true),
                ..Default::default()
            },
        );
    }

    let low_id = crate::mirror::RangeId::from_raw(10);
    let high_id = crate::mirror::RangeId::from_raw(20);
    sheet_mirror.format_ranges.push(crate::mirror::FormatRange {
        id: high_id,
        start_row: 5,
        start_col: 5,
        end_row: 5,
        end_col: 5,
    });
    sheet_mirror.format_ranges.push(crate::mirror::FormatRange {
        id: low_id,
        start_row: 5,
        start_col: 5,
        end_row: 5,
        end_col: 5,
    });
    sheet_mirror.range_format_cache.insert(
        low_id,
        CellFormat {
            background_color: Some("#111111".to_string()),
            ..Default::default()
        },
    );
    sheet_mirror.range_format_cache.insert(
        high_id,
        CellFormat {
            background_color: Some("#222222".to_string()),
            bold: Some(true),
            ..Default::default()
        },
    );
    sheet_mirror.rebuild_format_range_spatial_index();

    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let matching_ids: Vec<_> = sheet_mirror
        .format_ranges_at(5, 5)
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert_eq!(matching_ids, vec![low_id, high_id]);

    let result = apply_format_range_layer(&default_format(), 5, 5, Some(sheet_mirror));
    assert_eq!(result.background_color, Some("#222222".to_string()));
    assert_eq!(result.bold, Some(true));
}

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

    let cell_props = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };

    let sheet_mirror = mirror.get_sheet(&sid).unwrap();
    let eff = get_effective_format_preloaded(
        &storage,
        &sid,
        5,
        5,
        None,
        Some(&cell_props),
        Some(&gi),
        Some(sheet_mirror),
    );

    assert_eq!(eff.bold, Some(true)); // from cell format
    assert_eq!(eff.background_color, Some("#123456".to_string())); // from Format Range
    assert_eq!(eff.font_family, Some("Calibri".to_string())); // from default
}

#[test]
fn test_format_range_cold_load_hydrates_imported_style_only_range() {
    let (storage, sid, _gi, _mirror) = storage_with_sheet_and_mirror();
    let range_id = crate::mirror::RangeId::from_raw(900);
    {
        let sheets = storage.sheets();
        let mut txn = storage.doc().transact_mut();
        let sheet_hex = id_to_hex(sid.as_u128());
        let sheet_map = match sheets.get(&txn, &sheet_hex) {
            Some(Out::YMap(map)) => map,
            _ => panic!("sheet map not found"),
        };
        let range_formats = match sheet_map.get(&txn, compute_document::schema::KEY_RANGE_FORMATS) {
            Some(Out::YMap(map)) => map,
            _ => {
                let empty: MapPrelim = Vec::<(&str, Any)>::new().into_iter().collect();
                sheet_map.insert(&mut txn, compute_document::schema::KEY_RANGE_FORMATS, empty)
            }
        };
        let entries: MapPrelim = vec![
            (
                domain_types::yrs_schema::cell_format::KEY_XLSX_STYLE_ID,
                Any::Number(44.0),
            ),
            ("_sr", Any::Number(1.0)),
            ("_sc", Any::Number(2.0)),
            ("_er", Any::Number(3.0)),
            ("_ec", Any::Number(4.0)),
        ]
        .into_iter()
        .collect();
        let range_hex = id_to_hex(range_id.as_u128());
        range_formats.insert(&mut txn, &*range_hex, entries);
    }

    let mut fresh_mirror = crate::mirror::SheetMirror::new(sid, "Sheet1".to_string(), 100, 26);
    hydrate_format_ranges(&storage, &sid, &mut fresh_mirror);

    assert_eq!(fresh_mirror.format_ranges().len(), 1);
    let range = &fresh_mirror.format_ranges()[0];
    assert_eq!(range.id, range_id);
    assert_eq!(range.start_row, 1);
    assert_eq!(range.start_col, 2);
    assert_eq!(range.end_row, 3);
    assert_eq!(range.end_col, 4);
    assert_eq!(
        fresh_mirror.range_format_cache().get(&range_id),
        Some(&CellFormat::default())
    );
    assert_eq!(
        fresh_mirror.range_xlsx_style_id_cache().get(&range_id),
        Some(&44)
    );
}
