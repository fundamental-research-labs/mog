use super::support::*;
use super::*;

#[test]
fn test_get_all_properties_resolves_compact_and_skips_malformed_entries() {
    let (storage, sid, _gi) = storage_with_sheet();
    let doc = storage.doc();
    let workbook = storage.workbook_map();
    let sheets = storage.sheets();
    let styled_cell = cell_types::CellId::from_raw(0x100);
    let metadata_cell = cell_types::CellId::from_raw(0x101);
    let styled_hex = id_to_hex(styled_cell.as_u128()).to_string();
    let metadata_hex = id_to_hex(metadata_cell.as_u128()).to_string();

    insert_style_palette_entry(
        doc,
        workbook,
        5,
        &CellFormat {
            bold: Some(true),
            font_family: Some("Calibri".to_string()),
            ..Default::default()
        },
    );
    insert_compact_cell_properties(
        &storage,
        &sid,
        &styled_hex,
        r#"{"s":5,"formulaResultType":2,"hasEmptyCachedValue":true,"sstIndex":7,"originalValue":"42"}"#,
    );
    insert_compact_cell_properties(&storage, &sid, &metadata_hex, r#"{"cm":1,"vm":3}"#);
    insert_compact_cell_properties(&storage, &sid, "not-a-cell-id", r#"{"s":5}"#);
    insert_compact_cell_properties(
        &storage,
        &sid,
        &id_to_hex(0x102).to_string(),
        r#"{"s":"bad"}"#,
    );

    {
        let mut txn = doc.transact_mut();
        let sheet_hex = id_to_hex(sid.as_u128());
        let sheet_map = match sheets.get(&txn, &sheet_hex) {
            Some(Out::YMap(map)) => map,
            _ => panic!("sheet map not found"),
        };
        let props_map = match sheet_map.get(&txn, KEY_CELL_PROPERTIES) {
            Some(Out::YMap(map)) => map,
            _ => panic!("cellProperties map not found"),
        };
        props_map.insert(&mut txn, &*id_to_hex(0x103).to_string(), Any::Number(12.0));
    }

    let all = get_all_properties(doc, workbook, sheets, &sid);
    assert_eq!(all.len(), 2);

    let styled = all.get(&styled_cell).unwrap();
    assert_eq!(styled.style_id, Some(5));
    assert_eq!(styled.format.as_ref().unwrap().bold, Some(true));
    assert_eq!(styled.formula_result_type, Some(2));
    assert!(styled.has_empty_cached_value);
    assert_eq!(styled.original_sst_index, Some(7));
    assert_eq!(styled.original_value.as_deref(), Some("42"));

    let metadata = all.get(&metadata_cell).unwrap();
    assert!(metadata.format.is_none());
    assert_eq!(metadata.cell_metadata_index, Some(1));
    assert_eq!(metadata.vm, Some(3));
}

#[test]
fn test_iter_all_properties_returns_original_keys_for_structured_and_compact_entries() {
    let (storage, sid, _gi) = storage_with_sheet();
    let doc = storage.doc();
    let workbook = storage.workbook_map();
    let sheets = storage.sheets();
    let structured_hex = id_to_hex(0x200).to_string();
    let compact_hex = id_to_hex(0x201).to_string();

    set_properties(
        doc,
        sheets,
        &sid,
        &structured_hex,
        &CellProperties {
            provenance: Some("structured".to_string()),
            ..Default::default()
        },
    );
    insert_style_palette_entry(
        doc,
        workbook,
        3,
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
    );
    insert_compact_cell_properties(&storage, &sid, &compact_hex, r#"{"s":3}"#);

    let mut entries = iter_all_properties(doc, workbook, sheets, &sid);
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].0, structured_hex);
    assert_eq!(entries[0].1.provenance.as_deref(), Some("structured"));
    assert_eq!(entries[1].0, compact_hex);
    assert_eq!(entries[1].1.style_id, Some(3));
    assert_eq!(entries[1].1.format.as_ref().unwrap().italic, Some(true));
}

#[test]
fn test_iter_formatted_property_cell_ids_reports_structured_and_compact_formats_only() {
    let (storage, sid, _gi) = storage_with_sheet();
    let doc = storage.doc();
    let workbook = storage.workbook_map();
    let sheets = storage.sheets();
    let structured_hex = id_to_hex(0x300).to_string();
    let compact_hex = id_to_hex(0x301).to_string();
    let metadata_hex = id_to_hex(0x302).to_string();

    set_properties(
        doc,
        sheets,
        &sid,
        &structured_hex,
        &CellProperties {
            format: Some(CellFormat {
                bold: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        },
    );
    insert_compact_cell_properties(&storage, &sid, &compact_hex, r#"{"s":9}"#);
    insert_compact_cell_properties(&storage, &sid, &metadata_hex, r#"{"cm":true}"#);

    let mut ids = iter_formatted_property_cell_ids(doc, sheets, &sid);
    ids.sort();

    assert_eq!(ids, vec![structured_hex, compact_hex]);
}
