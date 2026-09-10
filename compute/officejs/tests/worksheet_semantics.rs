//! Worksheet and WorksheetCollection lifecycle semantics through the shipped
//! Office.js runtime.

use std::collections::HashMap;

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js_with_workbook};
use serde_json::json;

fn workbook_with_sheets(names: &[&str]) -> Workbook {
    let workbook = Workbook::blank().expect("blank workbook").0;
    for name in names.iter().skip(1) {
        workbook
            .sheets()
            .create_sheet(name)
            .expect("create worksheet");
    }
    workbook
}

fn set_active(workbook: &Workbook, id: &str) {
    let mut settings = workbook
        .settings()
        .get_workbook_settings()
        .expect("get workbook settings");
    settings.selected_sheet_ids = Some(vec![id.to_string()]);
    settings.custom_settings = Some(HashMap::from([(
        "mog.activeSheetId".to_string(),
        json!(id),
    )]));
    workbook
        .settings()
        .set_workbook_settings(settings)
        .expect("set active worksheet");
}

#[test]
fn worksheet_lifecycle_preserves_stable_id_and_tab_order() {
    let workbook = workbook_with_sheets(&["Sheet1", "Data", "Summary"]);
    let expected_id = workbook
        .sheet_by_name("Data")
        .expect("Data worksheet")
        .id()
        .to_uuid_string();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const worksheets = context.workbook.worksheets;
          const data = worksheets.getItem("Data");
          data.load(["id", "name", "position", "visibility"]);
          await context.sync();

          const stableId = data.id;
          data.name = "Renamed";
          data.position = 0;
          data.visibility = Excel.SheetVisibility.hidden;
          await context.sync();

          const fresh = worksheets.getItem(stableId);
          fresh.load(["id", "name", "position", "visibility"]);
          await context.sync();
          return {
            before: { id: stableId, name: "Data", position: 1, visibility: "Visible" },
            after: fresh.toJSON(),
            sameId: fresh.id === stableId,
          };
        });
        "#,
    )
    .expect("worksheet lifecycle should succeed");

    assert_eq!(
        output.value,
        json!({
            "before": { "id": expected_id.clone(), "name": "Data", "position": 1, "visibility": "Visible" },
            "after": { "id": expected_id, "name": "Renamed", "position": 0, "visibility": "Hidden" },
            "sameId": true,
        })
    );
}

#[test]
fn worksheet_collection_loads_real_item_proxies_in_tab_order() {
    let workbook = workbook_with_sheets(&["Sheet1", "Data", "Summary"]);
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const worksheets = context.workbook.worksheets;
          worksheets.load("items/name,items/id,items/position");
          await context.sync();
          return {
            items: worksheets.items.map((worksheet) => ({
              type: worksheet instanceof Excel.Worksheet,
              clientObject: worksheet instanceof OfficeExtension.ClientObject,
              name: worksheet.name,
              id: worksheet.id,
              position: worksheet.position,
            })),
            collection: worksheets.toJSON().items.map((worksheet) => worksheet.name),
          };
        });
        "#,
    )
    .expect("worksheet collection load should succeed");

    assert_eq!(
        output.value["items"]
            .as_array()
            .expect("items array")
            .iter()
            .map(|item| item["name"].as_str().expect("name").to_string())
            .collect::<Vec<_>>(),
        vec!["Sheet1", "Data", "Summary"]
    );
    assert!(
        output.value["items"]
            .as_array()
            .expect("items array")
            .iter()
            .all(|item| item["type"] == json!(true) && item["clientObject"] == json!(true))
    );
    assert_eq!(
        output.value["collection"],
        json!(["Sheet1", "Data", "Summary"])
    );
}

#[test]
fn worksheet_collection_count_edges_and_or_null_follow_order_and_visibility() {
    let workbook = workbook_with_sheets(&["Sheet1", "Data", "Summary"]);
    let summary_id = workbook
        .sheet_by_name("Summary")
        .expect("Summary worksheet")
        .id()
        .to_uuid_string();
    set_active(&workbook, &summary_id);

    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const worksheets = context.workbook.worksheets;
          const data = worksheets.getItem("Data");
          data.visibility = Excel.SheetVisibility.hidden;
          await context.sync();

          const allCount = worksheets.getCount();
          const visibleCount = worksheets.getCount(true);
          const first = worksheets.getFirst(true);
          const last = worksheets.getLast(true);
          const next = data.getNext(true);
          const previous = data.getPrevious(true);
          const beyond = worksheets.getItem("Summary").getNextOrNullObject();
          const missing = worksheets.getItemOrNullObject("Missing");
          first.load("name");
          last.load("name");
          next.load(["name", "visibility"]);
          previous.load(["name", "visibility"]);
          await context.sync();
          return {
            allCount: allCount.value,
            visibleCount: visibleCount.value,
            first: first.name,
            last: last.name,
            next: next.toJSON(),
            previous: previous.toJSON(),
            beyond: beyond.isNullObject,
            missing: missing.isNullObject,
          };
        });
        "#,
    )
    .expect("worksheet collection edge methods should succeed");

    assert_eq!(
        output.value,
        json!({
            "allCount": 3,
            "visibleCount": 2,
            "first": "Sheet1",
            "last": "Summary",
            "next": { "name": "Summary", "visibility": "Visible" },
            "previous": { "name": "Sheet1", "visibility": "Visible" },
            "beyond": true,
            "missing": true,
        })
    );
}

#[test]
fn worksheet_activation_uses_persisted_state_and_delete_errors_match_office() {
    let workbook = workbook_with_sheets(&["Sheet1", "Data"]);
    let data_id = workbook
        .sheet_by_name("Data")
        .expect("Data worksheet")
        .id()
        .to_uuid_string();
    set_active(&workbook, &data_id);

    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const worksheets = context.workbook.worksheets;
          const active = worksheets.getActiveWorksheet();
          active.load(["id", "name"]);
          await context.sync();
          const first = worksheets.getItem("Sheet1");
          first.activate();
          await context.sync();
          const after = worksheets.getActiveWorksheet();
          after.load("name");
          await context.sync();

          const veryHidden = worksheets.getItem("Data");
          veryHidden.visibility = Excel.SheetVisibility.veryHidden;
          await context.sync();
          let veryHiddenDelete;
          try {
            veryHidden.delete();
            await context.sync();
          } catch (error) { veryHiddenDelete = error.code; }
          return { active: active.toJSON(), after: after.name, veryHiddenDelete };
        });
        "#,
    )
    .expect("worksheet activation should succeed");

    assert_eq!(
        output.value,
        json!({
            "active": { "id": data_id, "name": "Data" },
            "after": "Sheet1",
            "veryHiddenDelete": "InvalidOperation",
        })
    );
}

#[test]
fn worksheet_blank_default_active_and_hide_switches_to_neighbor() {
    let workbook = workbook_with_sheets(&["Sheet1", "Data", "Summary"]);
    let data_id = workbook
        .sheet_by_name("Data")
        .expect("Data worksheet")
        .id()
        .to_uuid_string();

    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const worksheets = context.workbook.worksheets;
          const initial = worksheets.getActiveWorksheet();
          initial.load("name");
          await context.sync();

          initial.visibility = Excel.SheetVisibility.hidden;
          await context.sync();

          const after = worksheets.getActiveWorksheet();
          after.load(["id", "name", "position", "visibility"]);
          await context.sync();
          return { initial: initial.name, after: after.toJSON() };
        });
        "#,
    )
    .expect("blank workbook active worksheet should use the production default");

    assert_eq!(
        output.value,
        json!({
            "initial": "Sheet1",
            "after": {
                "id": data_id,
                "name": "Data",
                "position": 1,
                "visibility": "Visible",
            },
        })
    );
    assert_eq!(
        workbook
            .settings()
            .get_workbook_view_active_tab()
            .expect("read persisted active view"),
        Some(1)
    );
}

#[test]
fn worksheet_active_reads_persisted_workbook_view_tab() {
    let workbook = workbook_with_sheets(&["Sheet1", "Data", "Summary"]);
    workbook
        .settings()
        .set_workbook_view_active_tab(2)
        .expect("set persisted workbook view");

    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const active = context.workbook.worksheets.getActiveWorksheet();
          active.load(["id", "name", "position"]);
          await context.sync();
          return active.toJSON();
        });
        "#,
    )
    .expect("persisted workbook view should select its active tab");

    assert_eq!(
        output.value,
        json!({
            "id": workbook
                .sheet_by_name("Summary")
                .expect("Summary worksheet")
                .id()
                .to_uuid_string(),
            "name": "Summary",
            "position": 2,
        })
    );
}

#[test]
fn worksheet_delete_active_switches_to_neighbor_and_updates_view() {
    let workbook = workbook_with_sheets(&["Sheet1", "Data", "Summary"]);
    let data_id = workbook
        .sheet_by_name("Data")
        .expect("Data worksheet")
        .id()
        .to_uuid_string();
    set_active(&workbook, &data_id);

    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const worksheets = context.workbook.worksheets;
          const active = worksheets.getActiveWorksheet();
          active.delete();
          await context.sync();

          const after = worksheets.getActiveWorksheet();
          after.load(["name", "position"]);
          await context.sync();
          return after.toJSON();
        });
        "#,
    )
    .expect("deleting the active worksheet should select a neighbor");

    assert_eq!(output.value, json!({ "name": "Summary", "position": 1 }));
    assert_eq!(
        workbook
            .settings()
            .get_workbook_view_active_tab()
            .expect("read persisted active view"),
        Some(1)
    );
}

#[test]
fn worksheet_delete_last_sheet_is_rejected_at_sync() {
    let workbook = Workbook::blank().expect("blank workbook").0;
    let error = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          context.workbook.worksheets.getItem("Sheet1").delete();
          await context.sync();
          return "unexpected success";
        });
        "#,
    )
    .expect_err("deleting the only worksheet must fail");

    match error {
        OfficeJsError::Script(message) => assert!(
            message.contains("InvalidOperation"),
            "unexpected delete error: {message}"
        ),
        other => panic!("expected script error, got {other}"),
    }
}

#[test]
fn fresh_worksheet_proxy_requires_load_for_new_scalars() {
    let workbook = workbook_with_sheets(&["Sheet1", "Data"]);
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const worksheet = context.workbook.worksheets.getItem("Data");
          const fresh = context.workbook.worksheets.getItem("Data");
          worksheet.load(["position", "visibility"]);
          await context.sync();
          let unloadedPosition;
          let unloadedVisibility;
          let unloadedItems;
          try { fresh.position; } catch (error) { unloadedPosition = error.code; }
          try { fresh.visibility; } catch (error) { unloadedVisibility = error.code; }
          try { context.workbook.worksheets.items; } catch (error) { unloadedItems = error.code; }
          return {
            position: worksheet.position,
            visibility: worksheet.visibility,
            unloadedPosition,
            unloadedVisibility,
            unloadedItems,
          };
        });
        "#,
    )
    .expect("fresh worksheet proxy contract should succeed");

    assert_eq!(
        output.value,
        json!({
            "position": 1,
            "visibility": "Visible",
            "unloadedPosition": "PropertyNotLoaded",
            "unloadedVisibility": "PropertyNotLoaded",
            "unloadedItems": "PropertyNotLoaded",
        })
    );
}
