use super::support::*;
use super::*;

#[test]
fn typed_properties_preserve_full_width_ids_and_shared_style_metadata() {
    let (mut storage, sid, _) = storage_with_sheet();
    insert_style_palette_entry(
        &mut storage,
        3,
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );
    for raw in [0, u128::MAX, 0x123456789abcdef0123456789abcdef0] {
        let id = cell_types::CellId::from_raw(raw);
        let props = CellProperties {
            style_id: Some(3),
            original_sst_index: Some(7),
            original_value: Some("shared value".into()),
            ..Default::default()
        };
        set_properties_by_id(&mut storage, &sid, &id, &props);
        let mut expected = props.clone();
        expected.format = Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        });
        assert_eq!(
            get_properties_by_id(&storage, &sid, &id),
            Some(expected.clone())
        );
        assert_eq!(
            get_properties(&storage, &sid, &id_to_hex(raw)),
            Some(expected)
        );
        clear_cell_format_by_id(&mut storage, &sid, &id);
        let remaining = get_properties_by_id(&storage, &sid, &id).unwrap();
        assert!(remaining.format.is_none());
        assert_eq!(remaining.original_value, props.original_value);
        clear_properties_by_id(&mut storage, &sid, &id);
        assert!(get_properties_by_id(&storage, &sid, &id).is_none());
    }
}

#[test]
fn typed_bulk_format_patch_validates_before_mutating_and_keeps_metadata() {
    let (mut storage, sid, _) = storage_with_sheet();
    let ids = [
        cell_types::CellId::from_raw(1),
        cell_types::CellId::from_raw(u128::MAX),
    ];
    for id in &ids {
        set_properties_by_id(
            &mut storage,
            &sid,
            id,
            &CellProperties {
                original_value: Some("preserved".into()),
                ..Default::default()
            },
        );
    }
    let before = get_all_properties(&storage, &sid);
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    assert!(
        patch_cell_formats_by_id(&mut storage, &sid, &ids, &format, &["invalidField".into()])
            .is_err()
    );
    assert_eq!(get_all_properties(&storage, &sid), before);
    patch_cell_formats_by_id(&mut storage, &sid, &ids, &format, &[]).unwrap();
    for id in &ids {
        let props = get_properties_by_id(&storage, &sid, id).unwrap();
        assert_eq!(props.format.unwrap().bold, Some(true));
        assert_eq!(props.original_value.as_deref(), Some("preserved"));
    }
    clear_cell_formats_by_id(&mut storage, &sid, &ids);
    assert_eq!(get_all_properties(&storage, &sid), before);
}

#[test]
fn test_get_all_properties_resolves_shared_styles_and_metadata() {
    let (mut storage, sid, _gi) = storage_with_sheet();
    let styled_cell = cell_types::CellId::from_raw(0x100);
    let metadata_cell = cell_types::CellId::from_raw(0x101);
    let styled_hex = id_to_hex(styled_cell.as_u128()).to_string();
    let metadata_hex = id_to_hex(metadata_cell.as_u128()).to_string();

    insert_style_palette_entry(
        &mut storage,
        5,
        &CellFormat {
            bold: Some(true),
            font_family: Some("Calibri".to_string()),
            ..Default::default()
        },
    );
    insert_compact_cell_properties(
        &mut storage,
        &sid,
        &styled_hex,
        r#"{"s":5,"formulaResultType":2,"hasEmptyCachedValue":true,"sstIndex":7,"originalValue":"42"}"#,
    );
    insert_compact_cell_properties(&mut storage, &sid, &metadata_hex, r#"{"cm":1,"vm":3}"#);
    insert_compact_cell_properties(&mut storage, &sid, "not-a-cell-id", r#"{"s":5}"#);
    let all = get_all_properties(&storage, &sid);
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
fn test_iter_all_properties_returns_original_keys_for_direct_and_shared_entries() {
    let (mut storage, sid, _gi) = storage_with_sheet();
    let structured_hex = id_to_hex(0x200).to_string();
    let compact_hex = id_to_hex(0x201).to_string();

    set_properties(
        &mut storage,
        &sid,
        &structured_hex,
        &CellProperties {
            provenance: Some("structured".to_string()),
            ..Default::default()
        },
    );
    insert_style_palette_entry(
        &mut storage,
        3,
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
    );
    insert_compact_cell_properties(&mut storage, &sid, &compact_hex, r#"{"s":3}"#);

    let mut entries = iter_all_properties(&storage, &sid);
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].0, structured_hex);
    assert_eq!(entries[0].1.provenance.as_deref(), Some("structured"));
    assert_eq!(entries[1].0, compact_hex);
    assert_eq!(entries[1].1.style_id, Some(3));
    assert_eq!(entries[1].1.format.as_ref().unwrap().italic, Some(true));
}

#[test]
fn test_iter_formatted_property_cell_ids_reports_direct_and_shared_formats_only() {
    let (mut storage, sid, _gi) = storage_with_sheet();
    let structured_hex = id_to_hex(0x300).to_string();
    let compact_hex = id_to_hex(0x301).to_string();
    let metadata_hex = id_to_hex(0x302).to_string();

    set_properties(
        &mut storage,
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
    insert_compact_cell_properties(&mut storage, &sid, &compact_hex, r#"{"s":9}"#);
    insert_compact_cell_properties(&mut storage, &sid, &metadata_hex, r#"{"cm":1}"#);

    let mut ids = iter_formatted_property_cell_ids(&storage, &sid);
    ids.sort();

    assert_eq!(ids, vec![structured_hex, compact_hex]);
}

#[test]
fn imported_property_metadata_does_not_reserve_an_inline_format() {
    use crate::storage::properties::cell::{StoredCellProperties, StoredDetailedProperties};
    assert!(std::mem::size_of::<StoredCellProperties>() <= 24);
    assert!(std::mem::size_of::<StoredDetailedProperties>() <= 256);
}
