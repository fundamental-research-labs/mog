use super::support::*;
use super::*;

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

#[test]
fn test_get_row_format_unmaterialized() {
    let (storage, sid, gi) = storage_with_sheet();
    assert!(get_row_format(&storage, &sid, 99, Some(&gi)).is_none());
}

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

#[test]
fn test_get_col_format_unmaterialized() {
    let (storage, sid, gi) = storage_with_sheet();
    assert!(get_col_format(&storage, &sid, 25, Some(&gi)).is_none());
}

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

#[test]
fn test_clear_row_format_virtual_noop() {
    let (mut storage, sid, gi) = storage_with_sheet();
    // Should not panic
    clear_row_format(&mut storage, &sid, 99, Some(&gi));
    assert!(get_row_format(&storage, &sid, 99, Some(&gi)).is_none());
}

#[test]
fn test_clear_col_format_virtual_noop() {
    let (mut storage, sid, gi) = storage_with_sheet();
    // Should not panic
    clear_col_format(&mut storage, &sid, 25, Some(&gi));
    assert!(get_col_format(&storage, &sid, 25, Some(&gi)).is_none());
}

#[test]
fn test_get_all_row_formats_surfaces_formats_and_xlsx_style_ids() {
    let (mut storage, sid, gi) = storage_with_sheet();

    set_row_format(
        &mut storage,
        &sid,
        2,
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    insert_row_xlsx_style_id(&storage, &sid, &gi, 4, 17);
    {
        let sheets = storage.sheets();
        let mut txn = storage.doc().transact_mut();
        let sheet_hex = id_to_hex(sid.as_u128());
        let sheet_map = match sheets.get(&txn, &sheet_hex) {
            Some(Out::YMap(map)) => map,
            _ => panic!("sheet map not found"),
        };
        let row_formats = match sheet_map.get(&txn, compute_document::schema::KEY_ROW_FORMATS) {
            Some(Out::YMap(map)) => map,
            _ => panic!("rowFormats map not found"),
        };
        row_formats.insert(&mut txn, "not-a-row-id", Any::Number(1.0));
        let row_key = id_to_hex(gi.row_id(6).unwrap().as_u128());
        row_formats.insert(&mut txn, &*row_key, Any::Number(2.0));
    }

    let mut rows = get_all_row_formats(&storage, &sid, Some(&gi));
    rows.sort_by_key(|entry| entry.row);

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].row, 2);
    assert_eq!(rows[0].format.as_ref().unwrap().bold, Some(true));
    assert_eq!(rows[0].xlsx_style_id, None);
    assert_eq!(rows[1].row, 4);
    assert!(rows[1].format.is_none());
    assert_eq!(rows[1].xlsx_style_id, Some(17));
    assert_eq!(
        get_row_xlsx_style_id(&storage, &sid, 4, Some(&gi)),
        Some(17)
    );
    assert!(get_all_row_formats(&storage, &sid, None).is_empty());
}

#[test]
fn test_get_all_col_formats_surfaces_formats_and_xlsx_style_ids() {
    let (mut storage, sid, gi) = storage_with_sheet();

    set_col_format(
        &mut storage,
        &sid,
        1,
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
        Some(&gi),
    )
    .unwrap();
    insert_col_xlsx_style_id(&storage, &sid, &gi, 3, 23);
    {
        let sheets = storage.sheets();
        let mut txn = storage.doc().transact_mut();
        let sheet_hex = id_to_hex(sid.as_u128());
        let sheet_map = match sheets.get(&txn, &sheet_hex) {
            Some(Out::YMap(map)) => map,
            _ => panic!("sheet map not found"),
        };
        let col_formats = match sheet_map.get(&txn, compute_document::schema::KEY_COL_FORMATS) {
            Some(Out::YMap(map)) => map,
            _ => panic!("colFormats map not found"),
        };
        col_formats.insert(&mut txn, "not-a-col-id", Any::Number(1.0));
        let col_key = id_to_hex(gi.col_id(6).unwrap().as_u128());
        col_formats.insert(&mut txn, &*col_key, Any::Number(2.0));
    }

    let mut cols = get_all_col_formats(&storage, &sid, Some(&gi));
    cols.sort_by_key(|entry| entry.col);

    assert_eq!(cols.len(), 2);
    assert_eq!(cols[0].col, 1);
    assert_eq!(cols[0].format.as_ref().unwrap().italic, Some(true));
    assert_eq!(cols[0].xlsx_style_id, None);
    assert_eq!(cols[1].col, 3);
    assert!(cols[1].format.is_none());
    assert_eq!(cols[1].xlsx_style_id, Some(23));
    assert_eq!(
        get_col_xlsx_style_id(&storage, &sid, 3, Some(&gi)),
        Some(23)
    );
    assert!(get_all_col_formats(&storage, &sid, None).is_empty());
}

// Reproduces the xlsx border-wipes-format bug
