use super::support::*;
use super::*;
use crate::snapshot::{RuntimeDiagnosticsOptions, RuntimeOperationDiagnostic, WorkbookSettings};
use value_types::CellValue;

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
fn deferred_xlsx_replacement_clears_runtime_diagnostics() {
    let bytes = active_visible_deferred_fixture_xlsx();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let mut diagnostics = vec![RuntimeOperationDiagnostic {
        id: "runtime-diagnostic-pending".to_string(),
        sequence: "0".to_string(),
        code: "unsupported_filter_reapply".to_string(),
        severity: "warning".to_string(),
        recoverability: "unsupported_preserved".to_string(),
        operation: "reapplyFilter".to_string(),
        sheet_id: sheet_id().to_uuid_string(),
        filter_id: Some("filter-1".to_string()),
        filter_kind: Some("autoFilter".to_string()),
        table_id: None,
        reason: Some("iconFilterUnsupported".to_string()),
        reasons: vec!["iconFilterUnsupported".to_string()],
        details: None,
        location: None,
    }];
    engine.assign_and_record_runtime_diagnostics(&mut diagnostics);
    assert_eq!(
        engine
            .get_runtime_diagnostics(RuntimeDiagnosticsOptions::default())
            .diagnostics
            .len(),
        1
    );

    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX replacement should succeed");

    let page = engine.get_runtime_diagnostics(RuntimeDiagnosticsOptions::default());
    assert!(
        page.diagnostics.is_empty(),
        "deferred import replacement must clear stale runtime diagnostics: {page:?}"
    );
    assert!(!page.truncated);
}

#[test]
fn deferred_xlsx_import_materializes_active_visible_sheet_before_full_hydration() {
    let bytes = active_visible_deferred_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let (_, import_result) = engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let (hidden_first, active_visible) = sheet_ids(&engine);
    assert_eq!(
        engine.get_sheet_name(&hidden_first).as_deref(),
        Some("HiddenFirst")
    );
    assert_eq!(
        engine.get_sheet_name(&active_visible).as_deref(),
        Some("ActiveVisible")
    );

    assert_eq!(
        engine.get_cell_value(&active_visible, 0, 0),
        CellValue::number(21.0),
        "active visible sheet should be the first-paint materialized sheet"
    );
    assert!(
        engine.get_cell_id_at(&hidden_first, 0, 0).is_none(),
        "hidden first sheet sentinel should not be materialized before full hydration"
    );

    let filters = engine.get_filters_in_sheet(&active_visible);
    let active_filter = filters
        .iter()
        .find(|filter| filter.filter_kind == crate::storage::sheet::filters::FilterKind::AutoFilter)
        .expect("active visible sheet AutoFilter should be hydrated before full hydration");
    let active_filter_id = active_filter.id.clone();
    assert!(
        import_result.filter_changes.iter().any(|change| {
            change.sheet_id == active_visible.to_uuid_string()
                && change.filter_id == active_filter_id.as_str()
                && change.filter_kind.as_deref() == Some("autoFilter")
                && change.action.as_deref() == Some("created")
                && change.kind == crate::snapshot::ChangeKind::Set
        }),
        "active visible sheet AutoFilter should be announced in deferred first-paint result: {:?}",
        import_result.filter_changes
    );
    assert!(
        import_result
            .filter_changes
            .iter()
            .all(|change| change.sheet_id != hidden_first.to_uuid_string()),
        "hidden leading sheet should not emit first-paint filter changes: {:?}",
        import_result.filter_changes
    );
    assert!(
        filters
            .iter()
            .any(|filter| filter.id == active_filter_id.as_str()),
        "active visible sheet AutoFilter should be hydrated before full hydration: {filters:?}"
    );
    let header_info = engine.get_filter_header_info(&active_visible);
    let first_header = header_info
        .iter()
        .find(|entry| entry.col == 0)
        .expect("first AutoFilter header should be listed before full hydration");
    assert_eq!(first_header.filter_id, active_filter_id);
    assert!(
        first_header.hidden_button,
        "imported hiddenButton should suppress the header button: {first_header:?}"
    );
    assert!(
        !first_header.show_button,
        "imported showButton=0 should suppress the header button: {first_header:?}"
    );

    let (_, completion_result) = engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    assert_eq!(
        engine.get_cell_value(&hidden_first, 0, 0),
        CellValue::number(11.0)
    );
    assert_eq!(
        engine.get_cell_value(&active_visible, 0, 0),
        CellValue::number(21.0)
    );
    let filters_after = engine.get_filters_in_sheet(&active_visible);
    assert!(
        filters_after.iter().any(|filter| {
            filter.filter_kind == crate::storage::sheet::filters::FilterKind::AutoFilter
        }),
        "active visible sheet AutoFilter should remain after full hydration: {filters_after:?}"
    );
    assert!(
        completion_result.filter_changes.iter().all(|change| {
            !(change.sheet_id == active_visible.to_uuid_string()
                && change.filter_id == active_filter_id.as_str()
                && change.action.as_deref() == Some("created"))
        }),
        "full deferred hydration should not re-emit the first-paint AutoFilter creation: {:?}",
        completion_result.filter_changes
    );
}

#[test]
fn deferred_xlsx_completion_then_grouped_paste_undo_preserves_redo_stack() {
    let bytes = active_visible_deferred_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let (_, active_visible) = sheet_ids(&engine);
    engine.begin_undo_group().unwrap();
    engine
        .batch_set_cells_by_position(
            vec![(
                active_visible,
                17,
                0,
                crate::storage::engine::mutation::CellInput::Parse {
                    text: "atlas91 paste alpha".into(),
                },
            )],
            true,
        )
        .unwrap();
    engine.end_undo_group().unwrap();

    assert_eq!(
        cell_value_at(&engine, &active_visible, 17, 0),
        CellValue::Text("atlas91 paste alpha".into())
    );
    assert_eq!(engine.get_undo_state().undo_depth, 1);

    engine.undo().unwrap();
    assert_eq!(
        cell_value_at(&engine, &active_visible, 17, 0),
        CellValue::Null
    );
    assert_eq!(
        engine.get_undo_state().redo_depth,
        1,
        "undoing a post-materialization paste must leave the paste redoable"
    );

    engine.redo().unwrap();
    assert_eq!(
        cell_value_at(&engine, &active_visible, 17, 0),
        CellValue::Text("atlas91 paste alpha".into())
    );
}

#[test]
fn deferred_xlsx_import_exposes_metadata_only_sheet_outlines_before_full_hydration() {
    let bytes = metadata_outline_deferred_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let (active_visible, outlined_metadata) = sheet_ids(&engine);
    assert_eq!(
        engine.get_sheet_name(&active_visible).as_deref(),
        Some("ActiveVisible")
    );
    assert_eq!(
        engine.get_sheet_name(&outlined_metadata).as_deref(),
        Some("OutlinedMetadata")
    );
    assert_eq!(
        engine.get_cell_value(&active_visible, 0, 0),
        CellValue::number(21.0),
        "active visible sheet should still be the materialized first-paint sheet"
    );
    assert!(
        engine.get_cell_id_at(&outlined_metadata, 0, 0).is_none(),
        "outlined non-critical sheet should remain cell-metadata-only before full hydration"
    );

    let row_groups = engine.get_groups(&outlined_metadata, "row");
    assert_eq!(
        row_groups.len(),
        1,
        "metadata-only sheet should hydrate imported row outline groups before full hydration: {row_groups:?}"
    );
    assert_eq!(row_groups[0].start, 5);
    assert_eq!(row_groups[0].end, 6);
    assert_eq!(row_groups[0].level, 1);
    assert!(!row_groups[0].collapsed);

    let column_groups = engine.get_groups(&outlined_metadata, "column");
    assert_eq!(
        column_groups.len(),
        1,
        "metadata-only sheet should hydrate imported column outline groups before full hydration: {column_groups:?}"
    );
    assert_eq!(column_groups[0].start, 4);
    assert_eq!(column_groups[0].end, 8);
    assert_eq!(column_groups[0].level, 1);
    assert!(!column_groups[0].collapsed);

    let row_levels = engine.get_row_outline_levels(&outlined_metadata, 4, 7);
    assert_eq!(
        row_levels
            .iter()
            .map(|level| (level.index, level.level))
            .collect::<Vec<_>>(),
        vec![(4, 0), (5, 1), (6, 1), (7, 0)]
    );
    let column_levels = engine.get_column_outline_levels(&outlined_metadata, 3, 9);
    assert_eq!(
        column_levels
            .iter()
            .map(|level| (level.index, level.level))
            .collect::<Vec<_>>(),
        vec![(3, 0), (4, 1), (5, 1), (6, 1), (7, 1), (8, 1), (9, 0)]
    );
}

#[test]
fn deferred_xlsx_import_emits_saved_view_before_full_hydration() {
    let bytes = saved_view_deferred_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let (_, import_result) = engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let sheet_id_hex = engine
        .get_all_sheet_ids()
        .first()
        .cloned()
        .expect("imported workbook should have a first sheet");

    let scroll = import_result
        .scroll_position_changes
        .iter()
        .find(|change| change.sheet_id == sheet_id_hex)
        .expect("deferred first-paint result should emit saved scroll");
    assert_eq!(scroll.top_row, 440);
    assert_eq!(scroll.left_col, 8);

    let selection = import_result
        .view_selection_changes
        .iter()
        .find(|change| change.sheet_id == sheet_id_hex)
        .expect("deferred first-paint result should emit saved active selection");
    assert_eq!(selection.active_cell.row, 453);
    assert_eq!(selection.active_cell.col, 35);
    assert_eq!(selection.ranges.len(), 1);
    assert_eq!(selection.ranges[0].start_row, 453);
    assert_eq!(selection.ranges[0].start_col, 35);
    assert_eq!(selection.ranges[0].end_row, 453);
    assert_eq!(selection.ranges[0].end_col, 35);
}

#[test]
fn deferred_xlsx_import_emits_active_second_sheet_view_state_before_full_hydration() {
    let bytes = active_second_saved_view_deferred_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let (_, import_result) = engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let sheet_ids = engine.get_all_sheet_ids();
    assert_eq!(sheet_ids.len(), 2, "fixture should import two sheets");
    let second_sheet_id = &sheet_ids[1];

    let workbook_settings_change = import_result
        .workbook_settings_changes
        .first()
        .expect("deferred first-paint result should emit workbook settings");
    let workbook_settings: WorkbookSettings =
        serde_json::from_value(workbook_settings_change.settings.clone())
            .expect("workbook settings change should carry a valid settings snapshot");
    assert_eq!(
        workbook_settings.selected_sheet_ids,
        Some(vec![second_sheet_id.clone()])
    );

    let selection = import_result
        .view_selection_changes
        .iter()
        .find(|change| &change.sheet_id == second_sheet_id)
        .expect("deferred first-paint result should emit second sheet selection");
    assert_eq!(selection.active_cell.row, 3);
    assert_eq!(selection.active_cell.col, 2);
    assert_eq!(selection.ranges.len(), 1);
    assert_eq!(selection.ranges[0].start_row, 3);
    assert_eq!(selection.ranges[0].start_col, 2);
    assert_eq!(selection.ranges[0].end_row, 3);
    assert_eq!(selection.ranges[0].end_col, 2);
}

#[test]
fn deferred_xlsx_filter_clear_rejects_before_hydration_without_partial_mutation() {
    let bytes = active_visible_deferred_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let (_, active_visible) = sheet_ids(&engine);
    let active_filter = engine
        .get_filters_in_sheet(&active_visible)
        .into_iter()
        .find(|filter| filter.filter_kind == crate::storage::sheet::filters::FilterKind::AutoFilter)
        .expect("active visible sheet AutoFilter should be hydrated before full hydration");
    assert!(
        !active_filter.column_filters.is_empty(),
        "fixture AutoFilter should start with criteria: {active_filter:?}"
    );
    let active_filter_id = active_filter.id.clone();
    let criteria_before = active_filter.column_filters.clone();
    let hidden_before = engine.is_row_hidden_query(&active_visible, 2);

    let err = match engine.clear_all_column_filters(&active_visible, &active_filter_id) {
        Ok(_) => panic!("filter clear should reject before full deferred hydration"),
        Err(err) => err,
    };

    assert!(
        err.to_string().contains("deferred XLSX hydration"),
        "clear should fail on the deferred hydration preflight, got {err:?}"
    );
    let filter_after = engine
        .get_filters_in_sheet(&active_visible)
        .into_iter()
        .find(|filter| filter.id == active_filter_id)
        .expect("rejected clear must not remove the imported AutoFilter");
    assert_eq!(
        filter_after.column_filters, criteria_before,
        "rejected clear must leave imported criteria unchanged"
    );
    assert_eq!(
        engine.is_row_hidden_query(&active_visible, 2),
        hidden_before,
        "rejected clear must leave filtered row visibility unchanged"
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
