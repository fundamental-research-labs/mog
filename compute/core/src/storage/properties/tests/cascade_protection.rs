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

    let cell_format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let eff =
        get_effective_format_preloaded(&storage, &sid, 3, 2, None, &cell_format, Some(&gi), None);

    assert_eq!(eff.bold, Some(true));
    assert_eq!(eff.font_color, Some("#FF0000".to_string()));
    assert_eq!(eff.number_format, Some("0.00".to_string()));
    assert_eq!(eff.font_family, Some("Calibri".to_string()));
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
