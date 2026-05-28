use super::*;

#[test]
fn deferred_xlsx_import_exposes_first_sheet_formatting_before_full_hydration() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../file-io/xlsx/parser/test-corpus/parity/cells/basic-formatting.xlsx");
    let bytes = std::fs::read(fixture).expect("basic-formatting fixture should be readable");

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let sheet_id_hex = engine
        .get_all_sheet_ids()
        .first()
        .cloned()
        .expect("imported workbook should have a first sheet");
    let sheet_id = SheetId::from_uuid_str(&sheet_id_hex).unwrap();

    let a1_id = engine
        .get_cell_id_at(&sheet_id, 0, 0)
        .expect("A1 should be materialized on the deferred first sheet");
    let a1_format =
        engine.get_cell_format(&sheet_id, &CellId::from_uuid_str(&a1_id).unwrap(), 0, 0);
    assert_eq!(a1_format.bold, Some(true));

    let c2_id = engine
        .get_cell_id_at(&sheet_id, 1, 2)
        .expect("C2 should be materialized on the deferred first sheet");
    let c2_format =
        engine.get_cell_format(&sheet_id, &CellId::from_uuid_str(&c2_id).unwrap(), 1, 2);
    assert!(
        c2_format.background_color.is_some() || c2_format.pattern_foreground_color.is_some(),
        "C2 imported fill should be visible before complete_deferred_hydration; got {c2_format:?}"
    );

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");
    let c2_id_after = engine
        .get_cell_id_at(&sheet_id, 1, 2)
        .expect("C2 should remain materialized after full hydration");
    let c2_format_after = engine.get_cell_format(
        &sheet_id,
        &CellId::from_uuid_str(&c2_id_after).unwrap(),
        1,
        2,
    );
    assert!(
        c2_format_after.background_color.is_some()
            || c2_format_after.pattern_foreground_color.is_some(),
        "C2 imported fill should remain visible after full deferred hydration; got {c2_format_after:?}"
    );
}

#[test]
fn deferred_xlsx_import_emits_picture_floating_objects_before_full_hydration() {
    let (mut source, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let source_sheet_id = sheet_id();
    let picture_config = serde_json::json!({
        "type": "picture",
        "src": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        "anchor": {
            "anchorRow": 0,
            "anchorCol": 0,
            "anchorRowOffsetEmu": 0,
            "anchorColOffsetEmu": 0,
            "anchorMode": "oneCell",
            "extentCxEmu": 1905000,
            "extentCyEmu": 1428750
        },
        "width": 200.0,
        "height": 150.0,
        "visible": true,
        "printable": true,
        "flipH": false,
        "flipV": false,
        "opacity": 1.0,
        "rotation": 0.0,
        "name": "Deferred Picture"
    });
    source
        .create_floating_object(&source_sheet_id, &picture_config)
        .expect("picture creation should succeed");
    let exported = source
        .export_to_xlsx_bytes()
        .expect("source workbook with picture should export");
    let parsed_export = xlsx_api::parse(&exported).expect("exported XLSX should parse");
    assert_eq!(
        parsed_export.output.sheets[0].floating_objects.len(),
        1,
        "exported XLSX should contain one parsed picture floating object"
    );

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let (_patches, result) = imported
        .import_from_xlsx_bytes_deferred(&exported)
        .expect("deferred XLSX import should succeed");

    assert_eq!(
        result.floating_object_changes.len(),
        1,
        "deferred import must emit picture floating-object creation before full hydration"
    );
    let change = &result.floating_object_changes[0];
    assert!(
        matches!(
            change.kind,
            snapshot_types::FloatingObjectChangeKind::Created
        ),
        "deferred picture change must be Created, got {:?}",
        change.kind
    );
    assert_eq!(
        change.object_type,
        Some(domain_types::domain::floating_object::FloatingObjectKind::Picture)
    );
    assert!(
        change.data.is_some(),
        "deferred picture change must inline the typed object payload"
    );
    assert!(
        change
            .bounds
            .as_ref()
            .map(|b| b.width.get() > 0.0 && b.height.get() > 0.0)
            .unwrap_or(false),
        "deferred picture change must include positive render bounds, got {:?}",
        change.bounds
    );

    let sheet_id_after_import = imported
        .get_all_sheet_ids()
        .first()
        .cloned()
        .expect("deferred import should expose a sheet id");
    assert_eq!(
        change.sheet_id, sheet_id_after_import,
        "deferred picture change should be scoped to the imported sheet id"
    );
    let object = change.data.as_ref().unwrap();
    match &object.data {
        domain_types::domain::floating_object::FloatingObjectData::Picture(picture) => {
            assert!(
                picture.src.starts_with("data:image/png;base64,"),
                "hydrated picture src should be a browser-loadable data URL, got {}",
                picture.src
            );
        }
        other => panic!("deferred picture payload should be Picture data, got {other:?}"),
    }
    assert_eq!(
        object.common.sheet_id, sheet_id_after_import,
        "hydrated picture payload should carry the imported sheet id"
    );
}
