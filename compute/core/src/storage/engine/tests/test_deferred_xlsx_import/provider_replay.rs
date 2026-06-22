use super::support::*;
use super::*;
use value_types::CellValue;

#[test]
fn deferred_xlsx_import_and_completion_do_not_enqueue_provider_updates() {
    let bytes = basic_import_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let pending_after_import = engine
        .drain_pending_updates()
        .expect("provider drain after import should not hit guardrail");
    assert!(
        pending_after_import.is_empty(),
        "deferred import bootstrap must be base state, not live provider updates; got {} update(s)",
        pending_after_import.len(),
    );

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let pending_after_completion = engine
        .drain_pending_updates()
        .expect("provider drain after deferred hydration should not hit guardrail");
    assert!(
        pending_after_completion.is_empty(),
        "deferred hydration completion must be base state, not live provider updates; got {} update(s)",
        pending_after_completion.len(),
    );

    let sheet_id = SheetId::from_uuid_str(
        engine
            .get_all_sheet_ids()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .unwrap();
    engine
        .set_cell_value_as_text(&sheet_id, 4, 0, "post-import-edit")
        .expect("post-import edit should succeed");
    let pending_after_edit = engine
        .drain_pending_updates()
        .expect("provider drain after edit should not hit guardrail");
    assert!(
        !pending_after_edit.is_empty(),
        "post-import user edits must still flow through live provider updates",
    );
}

#[test]
fn deferred_xlsx_full_hydration_provider_replay_restores_imported_values() {
    let bytes = basic_import_fixture_xlsx();

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    imported
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    imported
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let persisted_bytes = compute_collab::encode_full_state(imported.storage().doc());

    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update_legacy(&persisted_bytes)
        .expect("provider replay should accept deferred-hydrated full state");

    let sheet_id = SheetId::from_uuid_str(
        replayed
            .get_all_sheet_ids()
            .first()
            .expect("replayed workbook should have a sheet"),
    )
    .unwrap();

    let a1 = replayed.get_cell_value(&sheet_id, 0, 0);
    assert!(
        matches!(a1, CellValue::Text(ref s) if s.as_ref() == "Name"),
        "deferred XLSX provider replay must restore A1 text; got {a1:?}",
    );
    let b1 = replayed.get_cell_value(&sheet_id, 0, 1);
    assert!(
        matches!(b1, CellValue::Text(ref s) if s.as_ref() == "Score"),
        "deferred XLSX provider replay must restore B1 text; got {b1:?}",
    );
}

#[test]
fn deferred_xlsx_provider_replay_preserves_style_only_empty_cell_fill() {
    let bytes = style_only_empty_fill_fixture_xlsx();

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    imported
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    imported
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let sheet_id = SheetId::from_uuid_str(
        imported
            .get_all_sheet_ids()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .unwrap();
    assert_viewport_empty_cell_fill(&imported, &sheet_id, 1, 0, "first-load import");

    let persisted_bytes = compute_collab::encode_full_state(imported.storage().doc());

    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update_legacy(&persisted_bytes)
        .expect("provider replay should accept deferred-hydrated full state");

    let replayed_sheet_id = SheetId::from_uuid_str(
        replayed
            .get_all_sheet_ids()
            .first()
            .expect("replayed workbook should have a sheet"),
    )
    .unwrap();
    assert_viewport_empty_cell_fill(&replayed, &replayed_sheet_id, 1, 0, "provider replay");
}

#[test]
fn deferred_xlsx_provider_replay_preserves_named_range_formula_semantics() {
    let bytes = named_range_concat_fixture_xlsx();
    let expected =
        CellValue::Text("Central Japan Railway Co. - Operating Model - Base Case".into());

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    imported
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    imported
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let sheet_id = SheetId::from_uuid_str(
        imported
            .get_all_sheet_ids()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .unwrap();
    assert_eq!(
        imported.get_cell_value(&sheet_id, 1, 1),
        expected,
        "first-load XLSX import should resolve Company_Name and Scenario in B2",
    );
    assert_eq!(
        imported
            .get_cell_info(&sheet_id, 1, 1)
            .and_then(|info| info.formula),
        Some(r#"=Company_Name&" - Operating Model - "&Scenario&" Case""#.to_string()),
        "first-load XLSX import should preserve B2 formula source",
    );

    let persisted_bytes = compute_collab::encode_full_state(imported.storage().doc());

    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update_legacy(&persisted_bytes)
        .expect("provider replay should accept deferred-hydrated full state");

    let replayed_sheet_id = SheetId::from_uuid_str(
        replayed
            .get_all_sheet_ids()
            .first()
            .expect("replayed workbook should have a sheet"),
    )
    .unwrap();

    assert_eq!(
        replayed.get_cell_value(&replayed_sheet_id, 1, 1),
        expected,
        "provider replay must preserve named-range formula semantics for B2",
    );
    assert_eq!(
        replayed
            .get_cell_info(&replayed_sheet_id, 1, 1)
            .and_then(|info| info.formula),
        Some(r#"=Company_Name&" - Operating Model - "&Scenario&" Case""#.to_string()),
        "provider replay must preserve B2 formula source",
    );
}

#[test]
fn deferred_xlsx_critical_provider_replay_restores_imported_values() {
    let bytes = basic_import_fixture_xlsx();

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    imported
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let persisted_bytes = imported
        .encode_diff(&[0])
        .expect("critical deferred state should encode against empty SV");

    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update_legacy(&persisted_bytes)
        .expect("provider replay should accept deferred critical state");

    let sheet_id = SheetId::from_uuid_str(
        replayed
            .get_all_sheet_ids()
            .first()
            .expect("replayed workbook should have a sheet"),
    )
    .unwrap();

    let a1 = replayed.get_cell_value(&sheet_id, 0, 0);
    assert!(
        matches!(a1, CellValue::Text(ref s) if s.as_ref() == "Name"),
        "deferred XLSX critical replay must restore A1 text; got {a1:?}",
    );
    let b1 = replayed.get_cell_value(&sheet_id, 0, 1);
    assert!(
        matches!(b1, CellValue::Text(ref s) if s.as_ref() == "Score"),
        "deferred XLSX critical replay must restore B1 text; got {b1:?}",
    );

    match replayed.mirror().cell_render_at(&sheet_id, 0, 0) {
        crate::projection::CellRender::Plain(view) => assert!(
            matches!(view.value, CellValue::Text(s) if s.as_ref() == "Name"),
            "deferred XLSX critical replay must render range-backed A1 through the viewport path; got {:?}",
            view.value,
        ),
        other => panic!(
            "deferred XLSX critical replay must render range-backed A1 through the viewport path; got {other:?}",
        ),
    }
    match replayed.mirror().cell_render_at(&sheet_id, 0, 1) {
        crate::projection::CellRender::Plain(view) => assert!(
            matches!(view.value, CellValue::Text(s) if s.as_ref() == "Score"),
            "deferred XLSX critical replay must render range-backed B1 through the viewport path; got {:?}",
            view.value,
        ),
        other => panic!(
            "deferred XLSX critical replay must render range-backed B1 through the viewport path; got {other:?}",
        ),
    }
}

#[test]
fn deferred_xlsx_provider_replay_keeps_imported_values_after_later_edit_log() {
    use std::sync::{Arc, Mutex};

    let bytes = basic_import_fixture_xlsx();

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    imported
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    imported
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let persisted_snapshot = compute_collab::encode_full_state(imported.storage().doc());

    let captured: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
    let captured_for_cb = Arc::clone(&captured);
    let _sub = compute_collab::subscribe_update_v1(imported.storage().doc(), move |bytes| {
        captured_for_cb.lock().unwrap().push(bytes.to_vec());
    });

    let sheet_id = SheetId::from_uuid_str(
        imported
            .get_all_sheet_ids()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .unwrap();
    imported
        .set_cell_value_as_text(&sheet_id, 4, 0, "post-import-edit")
        .expect("post-import edit should succeed");

    let update_log = captured.lock().unwrap().clone();
    assert!(
        !update_log.is_empty(),
        "post-import edit should emit at least one provider update",
    );

    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update_legacy(&persisted_snapshot)
        .expect("provider replay should accept imported full-state snapshot");
    for update in &update_log {
        replayed
            .apply_sync_update_legacy(update)
            .expect("provider replay should accept post-import update log entry");
    }

    let replayed_sheet_id = SheetId::from_uuid_str(
        replayed
            .get_all_sheet_ids()
            .first()
            .expect("replayed workbook should have a sheet"),
    )
    .unwrap();

    let a1 = replayed.get_cell_value(&replayed_sheet_id, 0, 0);
    assert!(
        matches!(a1, CellValue::Text(ref s) if s.as_ref() == "Name"),
        "provider replay must keep imported A1 after later edit log; got {a1:?}",
    );
    let b1 = replayed.get_cell_value(&replayed_sheet_id, 0, 1);
    assert!(
        matches!(b1, CellValue::Text(ref s) if s.as_ref() == "Score"),
        "provider replay must keep imported B1 after later edit log; got {b1:?}",
    );
    let a5 = replayed.get_cell_value(&replayed_sheet_id, 4, 0);
    assert!(
        matches!(a5, CellValue::Text(ref s) if s.as_ref() == "post-import-edit"),
        "provider replay must apply post-import edit A5; got {a5:?}",
    );

    let queried = replayed.query_range(&replayed_sheet_id, 0, 0, 4, 1);
    assert!(
        queried.cells.iter().any(|cell| {
            cell.row == 0
                && cell.col == 0
                && matches!(cell.value, CellValue::Text(ref s) if s.as_ref() == "Name")
        }),
        "provider replay query_range must include imported A1; got {:?}",
        queried.cells,
    );
    assert!(
        queried.cells.iter().any(|cell| {
            cell.row == 0
                && cell.col == 1
                && matches!(cell.value, CellValue::Text(ref s) if s.as_ref() == "Score")
        }),
        "provider replay query_range must include imported B1; got {:?}",
        queried.cells,
    );
    assert!(
        queried.cells.iter().any(|cell| {
            cell.row == 4
                && cell.col == 0
                && matches!(cell.value, CellValue::Text(ref s) if s.as_ref() == "post-import-edit")
        }),
        "provider replay query_range must include post-import edit A5; got {:?}",
        queried.cells,
    );
}
