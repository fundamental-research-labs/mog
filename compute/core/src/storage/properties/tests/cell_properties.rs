use super::support::*;
use super::*;

#[test]
fn test_set_and_get_properties() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    let props = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        }),
        provenance: Some("ai".to_string()),
        ..Default::default()
    };
    set_properties(
        &mut storage,
        &sid,
        "00000000000000000000000000000017",
        &props,
    );

    let got = get_properties(&storage, &sid, "00000000000000000000000000000017").unwrap();
    assert_eq!(got.format.as_ref().unwrap().bold, Some(true));
    assert_eq!(got.provenance, Some("ai".to_string()));
}

#[test]
fn test_clear_properties() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    let props = CellProperties {
        provenance: Some("user".to_string()),
        ..Default::default()
    };
    set_properties(
        &mut storage,
        &sid,
        "00000000000000000000000000000018",
        &props,
    );
    assert!(get_properties(&storage, &sid, "00000000000000000000000000000018").is_some());

    clear_properties(&mut storage, &sid, "00000000000000000000000000000018");
    assert!(get_properties(&storage, &sid, "00000000000000000000000000000018").is_none());
}

#[test]
fn test_set_and_get_cell_format() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    let fmt = CellFormat {
        font_size: Some(domain_types::FontSize::from_millipoints(14000)),
        bold: Some(true),
        ..Default::default()
    };
    set_cell_format(&mut storage, &sid, "00000000000000000000000000000019", &fmt);

    let got = get_cell_format(&storage, &sid, "00000000000000000000000000000019").unwrap();
    assert_eq!(
        got.font_size,
        Some(domain_types::FontSize::from_millipoints(14000))
    );
    assert_eq!(got.bold, Some(true));
}

#[test]
fn test_clear_cell_format_preserves_metadata() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    let props = CellProperties {
        format: Some(CellFormat {
            italic: Some(true),
            ..Default::default()
        }),
        provenance: Some("import".to_string()),
        ..Default::default()
    };
    set_properties(
        &mut storage,
        &sid,
        "0000000000000000000000000000001a",
        &props,
    );

    clear_cell_format(&mut storage, &sid, "0000000000000000000000000000001a");

    let got = get_properties(&storage, &sid, "0000000000000000000000000000001a").unwrap();
    assert!(got.format.is_none());
    assert_eq!(got.provenance, Some("import".to_string()));
}

#[test]
fn test_clear_cell_format_deletes_when_empty() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    let props = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    set_properties(
        &mut storage,
        &sid,
        "0000000000000000000000000000001b",
        &props,
    );

    clear_cell_format(&mut storage, &sid, "0000000000000000000000000000001b");
    assert!(get_properties(&storage, &sid, "0000000000000000000000000000001b").is_none());
}

#[test]
fn test_batch_set_formats() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    let fmt = CellFormat {
        font_color: Some("#FF0000".to_string()),
        ..Default::default()
    };
    set_cell_formats(
        &mut storage,
        &sid,
        &[
            "00000000000000000000000000000014",
            "00000000000000000000000000000015",
            "00000000000000000000000000000016",
        ],
        &fmt,
    );

    for cid in &[
        "00000000000000000000000000000014",
        "00000000000000000000000000000015",
        "00000000000000000000000000000016",
    ] {
        let got = get_cell_format(&storage, &sid, cid).unwrap();
        assert_eq!(got.font_color, Some("#FF0000".to_string()));
    }
}

#[test]
fn test_batch_clear_formats() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    let fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    set_cell_formats(
        &mut storage,
        &sid,
        &[
            "00000000000000000000000000000014",
            "00000000000000000000000000000015",
        ],
        &fmt,
    );

    clear_cell_formats(
        &mut storage,
        &sid,
        &[
            "00000000000000000000000000000014",
            "00000000000000000000000000000015",
        ],
    );

    assert!(get_cell_format(&storage, &sid, "00000000000000000000000000000014").is_none());
    assert!(get_cell_format(&storage, &sid, "00000000000000000000000000000015").is_none());
}

#[test]
fn test_properties_nonexistent_sheet() {
    let storage = WorkbookStorage::new();
    let sid = make_sheet_id(999);

    assert!(get_properties(&storage, &sid, "00000000000000000000000000000013").is_none());
    assert!(get_cell_format(&storage, &sid, "00000000000000000000000000000013").is_none());
    assert!(get_row_format(&storage, &sid, 0, None).is_none());
    assert!(get_col_format(&storage, &sid, 0, None).is_none());
    assert!(is_cell_locked(
        &storage,
        &sid,
        "00000000000000000000000000000013"
    )); // default true
    assert!(!is_formula_hidden(
        &storage,
        &sid,
        "00000000000000000000000000000013"
    )); // default false
}

#[test]
fn test_set_cell_format_merges() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    // First set: bold
    set_cell_format(
        &mut storage,
        &sid,
        "0000000000000000000000000000001f",
        &CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );

    // Second set: italic (should merge, not replace)
    set_cell_format(
        &mut storage,
        &sid,
        "0000000000000000000000000000001f",
        &CellFormat {
            italic: Some(true),
            ..Default::default()
        },
    );

    let got = get_cell_format(&storage, &sid, "0000000000000000000000000000001f").unwrap();
    assert_eq!(got.bold, Some(true));
    assert_eq!(got.italic, Some(true));
}
#[test]
fn test_wrap_text_and_shrink_to_fit_are_exclusive_for_cell_formats() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    set_cell_format(
        &mut storage,
        &sid,
        "0000000000000000000000000000001c",
        &CellFormat {
            wrap_text: Some(true),
            ..Default::default()
        },
    );

    set_cell_format(
        &mut storage,
        &sid,
        "0000000000000000000000000000001c",
        &CellFormat {
            shrink_to_fit: Some(true),
            ..Default::default()
        },
    );

    let got = get_cell_format(&storage, &sid, "0000000000000000000000000000001c").unwrap();
    assert_eq!(got.wrap_text, Some(false));
    assert_eq!(got.shrink_to_fit, Some(true));

    set_cell_format(
        &mut storage,
        &sid,
        "0000000000000000000000000000001c",
        &CellFormat {
            wrap_text: Some(true),
            ..Default::default()
        },
    );

    let got = get_cell_format(&storage, &sid, "0000000000000000000000000000001c").unwrap();
    assert_eq!(got.wrap_text, Some(true));
    assert_eq!(got.shrink_to_fit, Some(false));
}

#[test]
fn test_set_cell_formats_preserves_compact_palette_format() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    // 1. Simulate xlsx hydration: write a style palette entry
    let fmt = CellFormat {
        bold: Some(true),
        font_size: Some(domain_types::FontSize::from_millipoints(10000)),
        font_family: Some("Calibri".to_string()),
        number_format: Some("#,##0".to_string()),
        ..Default::default()
    };
    insert_style_palette_entry(&mut storage, 5, &fmt);
    let cell_hex = "deadbeef00000000deadbeef00000000";
    insert_compact_cell_properties(&mut storage, &sid, cell_hex, r#"{"s":5}"#);

    // 3. Verify get_properties reads the compact format correctly
    let existing = get_properties(&storage, &sid, cell_hex);
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
    set_cell_formats(&mut storage, &sid, &[cell_hex], &border_fmt);

    // 5. Read back and verify ALL format properties are preserved
    let after = get_properties(&storage, &sid, cell_hex);
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
fn preloaded_cell_format_layers_intern_compact_palette_styles_and_materialize_defaults() {
    use cell_types::CellId;

    let (mut storage, sid, _gi) = storage_with_sheet();
    let first_id = CellId::from_raw(0xA1);
    let second_id = CellId::from_raw(0xB1);

    let palette_format = CellFormat {
        bold: Some(true),
        font_family: Some("Calibri".to_string()),
        ..Default::default()
    };
    insert_style_palette_entry(&mut storage, 7, &palette_format);
    for id in [first_id, second_id] {
        insert_compact_cell_properties(&mut storage, &sid, &id_to_hex(id.as_u128()), r#"{"s":7}"#);
    }

    let layers = get_cell_format_layers_for_ids(&storage, &sid, &[second_id, first_id, second_id]);
    let first = layers.get(&first_id).expect("first compact style");
    let second = layers.get(&second_id).expect("second compact style");
    assert!(
        std::ptr::eq(first, second),
        "shared style must be interned once"
    );
    assert_eq!(first.bold, Some(true));
    assert_eq!(first.number_format.as_deref(), Some("General"));
    assert_eq!(
        first.horizontal_align,
        Some(ooxml_types::styles::HorizontalAlign::General)
    );
    assert_eq!(first.wrap_text, Some(false));
    assert_eq!(
        first.pattern_type,
        Some(ooxml_types::styles::PatternType::None),
        "bulk displayed-format reads must materialize imported fillId=0 as no-fill"
    );
}

#[test]
fn test_clear_formula_cache_metadata_preserves_unrelated_properties() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    let props = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        }),
        provenance: Some("import".to_string()),
        formula_result_type: Some(2),
        has_empty_cached_value: true,
        vm: Some(3),
        imported_rich_error: Some(domain_types::ImportedRichError {
            vm: 3,
            semantic: value_types::CellError::Spill,
            fallback: value_types::CellError::Value,
        }),
        original_sst_index: Some(9),
        original_value: Some("cached".to_string()),
        ..Default::default()
    };
    set_properties(
        &mut storage,
        &sid,
        "0000000000000000000000000000001d",
        &props,
    );

    clear_formula_cache_metadata(&mut storage, &sid, "0000000000000000000000000000001d");

    let got = get_properties(&storage, &sid, "0000000000000000000000000000001d").unwrap();
    assert_eq!(got.format.as_ref().unwrap().bold, Some(true));
    assert_eq!(got.provenance.as_deref(), Some("import"));
    assert_eq!(got.formula_result_type, None);
    assert_eq!(got.vm, None);
    assert_eq!(got.imported_rich_error, None);
    assert!(!got.has_empty_cached_value);
    assert_eq!(got.original_sst_index, Some(9));
    assert_eq!(got.original_value.as_deref(), Some("cached"));
}

#[test]
fn test_clear_formula_cache_metadata_deletes_entry_when_empty() {
    let (mut storage, sid, _gi) = storage_with_sheet();

    let props = CellProperties {
        formula_result_type: Some(1),
        has_empty_cached_value: true,
        ..Default::default()
    };
    set_properties(
        &mut storage,
        &sid,
        "0000000000000000000000000000001e",
        &props,
    );

    clear_formula_cache_metadata(&mut storage, &sid, "0000000000000000000000000000001e");

    assert!(get_properties(&storage, &sid, "0000000000000000000000000000001e").is_none());
}

#[test]
fn test_clear_formula_cache_metadata_for_cell_ids_preserves_unrelated_properties() {
    let (mut storage, sid, _gi) = storage_with_sheet();
    let keep_id = cell_types::CellId::from_raw(100);
    let delete_id = cell_types::CellId::from_raw(101);
    let keep_hex = compute_document::hex::id_to_hex(keep_id.as_u128());
    let delete_hex = compute_document::hex::id_to_hex(delete_id.as_u128());

    let keep_props = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        }),
        formula_result_type: Some(2),
        has_empty_cached_value: true,
        ..Default::default()
    };
    let delete_props = CellProperties {
        formula_result_type: Some(1),
        has_empty_cached_value: true,
        ..Default::default()
    };
    set_properties(&mut storage, &sid, &keep_hex, &keep_props);
    set_properties(&mut storage, &sid, &delete_hex, &delete_props);

    clear_formula_cache_metadata_for_cell_ids(&mut storage, &sid, &[keep_id, delete_id]);

    let kept = get_properties(&storage, &sid, &keep_hex).unwrap();
    assert_eq!(kept.format.as_ref().unwrap().bold, Some(true));
    assert_eq!(kept.formula_result_type, None);
    assert!(!kept.has_empty_cached_value);
    assert!(get_properties(&storage, &sid, &delete_hex).is_none());
}
