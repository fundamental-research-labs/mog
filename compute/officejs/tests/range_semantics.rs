//! Foundational Worksheet/Range tests through the shipped Office.js runtime.

use std::collections::HashMap;

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js_with_workbook};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn bounded_range_loads_canonical_address_indexes_and_counts() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("$b$2:$D$5");
          range.load("address,rowIndex,columnIndex,rowCount,columnCount,cellCount");
          await context.sync();
          return {
            address: range.address,
            rowIndex: range.rowIndex,
            columnIndex: range.columnIndex,
            rowCount: range.rowCount,
            columnCount: range.columnCount,
            cellCount: range.cellCount,
          };
        });
        "#,
    )
    .expect("range metadata load should succeed");

    assert_eq!(
        output.value,
        json!({
            "address": "Sheet1!B2:D5",
            "rowIndex": 1,
            "columnIndex": 1,
            "rowCount": 4,
            "columnCount": 3,
            "cellCount": 12,
        })
    );
}

#[test]
fn whole_worksheet_range_uses_excel_grid_counts_and_unbounded_values() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange();
          range.load("address,rowIndex,columnIndex,rowCount,columnCount,cellCount,values,formulas");
          await context.sync();
          return {
            address: range.address,
            rowIndex: range.rowIndex,
            columnIndex: range.columnIndex,
            rowCount: range.rowCount,
            columnCount: range.columnCount,
            cellCount: range.cellCount,
            values: range.values,
            formulas: range.formulas,
          };
        });
        "#,
    )
    .expect("whole-sheet metadata load should succeed");

    assert_eq!(
        output.value,
        json!({
            "address": "Sheet1!1:1048576",
            "rowIndex": 0,
            "columnIndex": 0,
            "rowCount": 1_048_576,
            "columnCount": 16_384,
            "cellCount": -1,
            "values": null,
            "formulas": null,
        })
    );
}

#[test]
fn worksheet_lookup_accepts_stable_id_and_common_case_insensitive_name() {
    let workbook = blank_workbook();
    workbook
        .sheets()
        .create_sheet("Data")
        .expect("create Data sheet");
    let data_id = workbook
        .sheet_by_name("Data")
        .expect("Data sheet")
        .id()
        .to_uuid_string();
    let source = format!(
        r#"
        return await Excel.run(async (context) => {{
          const byId = context.workbook.worksheets.getItem("{data_id}");
          const byNameCase = context.workbook.worksheets.getItem("data");
          byId.load("id,name");
          byNameCase.load("id,name");
          await context.sync();
          return {{
            byId: {{ id: byId.id, name: byId.name }},
            byNameCase: {{ id: byNameCase.id, name: byNameCase.name }},
          }};
        }});
        "#
    );
    let output = run_office_js_with_workbook(&workbook, &source)
        .expect("worksheet ID and common name lookup should succeed");

    assert_eq!(
        output.value,
        json!({
            "byId": { "id": data_id, "name": "Data" },
            "byNameCase": { "id": data_id, "name": "Data" },
        })
    );
}

#[test]
fn get_active_worksheet_uses_persisted_headless_active_sheet_state() {
    let workbook = blank_workbook();
    workbook
        .sheets()
        .create_sheet("Data")
        .expect("create Data sheet");
    let data_id = workbook
        .sheet_by_name("Data")
        .expect("Data sheet")
        .id()
        .to_uuid_string();
    let mut settings = workbook
        .settings()
        .get_workbook_settings()
        .expect("get workbook settings");
    settings.selected_sheet_ids = Some(vec![data_id.clone()]);
    settings.custom_settings = Some(HashMap::from([(
        "mog.activeSheetId".to_string(),
        json!(data_id.clone()),
    )]));
    workbook
        .settings()
        .set_workbook_settings(settings)
        .expect("set active worksheet state");

    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const active = context.workbook.worksheets.getActiveWorksheet();
          active.load("id,name");
          await context.sync();
          return { id: active.id, name: active.name };
        });
        "#,
    )
    .expect("active worksheet lookup should succeed");

    assert_eq!(output.value, json!({ "id": data_id, "name": "Data" }));
}

#[test]
fn missing_worksheet_id_fails_at_sync_with_item_not_found() {
    let workbook = blank_workbook();
    let error = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const missing = context.workbook.worksheets.getItem("ffffffff-ffff-ffff-ffff-ffffffffffff");
          missing.load("name");
          await context.sync();
          return missing.name;
        });
        "#,
    )
    .expect_err("missing worksheet must reject sync");

    match error {
        OfficeJsError::Script(message) => assert!(
            message.contains("ItemNotFound"),
            "unexpected missing-sheet error: {message}"
        ),
        other => panic!("expected script error, got {other}"),
    }
}
