//! History through the shipped Office.js runtime and Rust workbook facade.

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js_with_workbook};
use serde_json::{Value, json};

fn run(workbook: &Workbook, source: &str) -> Value {
    run_office_js_with_workbook(workbook, source)
        .expect("Office.js script succeeds")
        .value
}

fn load(workbook: &Workbook, address: &str) -> Value {
    run(
        workbook,
        &format!(
            r#"
            return await Excel.run(async (context) => {{
              const range = context.workbook.worksheets.getItem("Sheet1").getRange({});
              range.load("values,formulas");
              await context.sync();
              return {{values: range.values, formulas: range.formulas}};
            }});
            "#,
            serde_json::to_string(address).unwrap()
        ),
    )
}

fn assert_depths(workbook: &Workbook, undo: usize, redo: usize) {
    let state = workbook.history().get_undo_state().unwrap();
    assert_eq!((state.undo_depth, state.redo_depth), (undo, redo));
    assert_eq!((state.can_undo, state.can_redo), (undo != 0, redo != 0));
}

#[test]
fn one_sync_undoes_bulk_values_and_formula_together() {
    let (workbook, _) = Workbook::blank().unwrap();
    let expected = run(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const values = Array.from({length: 100}, (_, row) =>
            Array.from({length: 10}, (_, col) => row * 10 + col + 1));
          sheet.getRange("A1:J100").values = values;
          const total = sheet.getRange("K1");
          total.formulas = [["=SUM(A1:J100)"]];
          total.load("values");
          await context.sync();
          return {values, total: total.values};
        });
        "#,
    );
    assert_eq!(expected["total"], json!([[500500]]));
    assert_depths(&workbook, 1, 0);

    workbook.history().undo().unwrap();
    let cleared = load(&workbook, "A1:K100");
    for row in cleared["values"].as_array().unwrap() {
        assert!(row.as_array().unwrap().iter().all(Value::is_null));
    }
    assert_eq!(load(&workbook, "K1")["formulas"], json!([[null]]));
    assert_depths(&workbook, 0, 1);

    workbook.history().redo().unwrap();
    assert_eq!(load(&workbook, "A1:J100")["values"], expected["values"]);
    let total = load(&workbook, "K1");
    assert_eq!(total["values"], json!([[500500]]));
    assert_eq!(total["formulas"], json!([["=SUM(A1:J100)"]]));
    assert_depths(&workbook, 1, 0);
}

#[test]
fn separate_syncs_are_separate_actions_and_reads_preserve_redo() {
    let (workbook, _) = Workbook::blank().unwrap();
    run(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [[10]];
          sheet.getRange("A2").formulas = [["=A1*2"]];
          await context.sync();
          sheet.getRange("A1").values = [[11]];
          await context.sync();
          await context.sync();
        });
        "#,
    );
    assert_depths(&workbook, 2, 0);
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[11], [22]]));
    workbook.history().undo().unwrap();
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[10], [20]]));
    assert_depths(&workbook, 1, 1);
    workbook.history().undo().unwrap();
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[null], [null]]));
    assert_depths(&workbook, 0, 2);
    workbook.history().redo().unwrap();
    workbook.history().redo().unwrap();
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[11], [22]]));
    assert_depths(&workbook, 2, 0);
}

#[test]
fn explicit_group_combines_multiple_excel_runs_and_automatic_syncs() {
    let (workbook, _) = Workbook::blank().unwrap();
    let history = workbook.history();
    history.begin_undo_group().unwrap();
    run(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          context.workbook.worksheets.getItem("Sheet1").getRange("A1").values = [[10]];
        });
        "#,
    );
    run(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          context.workbook.worksheets.getItem("Sheet1").getRange("A2").formulas = [["=A1*2"]];
        });
        "#,
    );
    history.end_undo_group().unwrap();
    assert_depths(&workbook, 1, 0);
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[10], [20]]));
    history.undo().unwrap();
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[null], [null]]));
    history.redo().unwrap();
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[10], [20]]));
}

#[test]
fn worksheet_creation_and_its_writes_share_one_sync_action() {
    let (workbook, _) = Workbook::blank().unwrap();
    run(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.add("Data");
          sheet.getRange("A1:B1").values = [[8, 9]];
          await context.sync();
        });
        "#,
    );
    assert_depths(&workbook, 1, 0);
    workbook.history().undo().unwrap();
    assert_eq!(workbook.sheet_names().unwrap(), vec!["Sheet1"]);
    assert_depths(&workbook, 0, 1);
    workbook.history().redo().unwrap();
    assert_eq!(
        run(
            &workbook,
            r#"
            return await Excel.run(async (context) => {
              const range = context.workbook.worksheets.getItem("Data").getRange("A1:B1");
              range.load("values");
              await context.sync();
              return range.values;
            });
            "#,
        ),
        json!([[8, 9]])
    );
    assert_depths(&workbook, 1, 0);
}

#[test]
fn failed_sync_keeps_successful_prefix_and_closes_its_group() {
    let (workbook, _) = Workbook::blank().unwrap();
    let error = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [[10]];
          sheet.getRange("A2").formulas = [["=A1*2"]];
          context.workbook.worksheets.getItem("Missing");
          await context.sync();
        });
        "#,
    )
    .expect_err("later missing worksheet fails sync");
    assert!(
        matches!(error, OfficeJsError::Script(ref message) if message.contains("ItemNotFound"))
    );
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[10], [20]]));
    assert_depths(&workbook, 1, 0);

    run(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          context.workbook.worksheets.getItem("Sheet1").getRange("B1").values = [[7]];
        });
        "#,
    );
    assert_depths(&workbook, 2, 0);
    workbook.history().undo().unwrap();
    assert_eq!(load(&workbook, "B1")["values"], json!([[null]]));
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[10], [20]]));
    workbook.history().undo().unwrap();
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[null], [null]]));
    assert_depths(&workbook, 0, 2);
}

#[test]
fn failure_before_any_write_preserves_redo_and_does_not_leak_a_group() {
    let (workbook, _) = Workbook::blank().unwrap();
    workbook
        .sheet_by_name("Sheet1")
        .unwrap()
        .set_cell("A1", "5")
        .unwrap();
    workbook.history().undo().unwrap();
    let error = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          context.workbook.worksheets.getItem("Missing").getRange("A1").values = [[9]];
          await context.sync();
        });
        "#,
    );
    assert!(error.is_err());
    assert_depths(&workbook, 0, 1);
    workbook.history().redo().unwrap();
    assert_eq!(load(&workbook, "A1")["values"], json!([[5]]));
    workbook
        .sheet_by_name("Sheet1")
        .unwrap()
        .set_cell("B1", "6")
        .unwrap();
    assert_depths(&workbook, 2, 0);
}

#[test]
fn script_failure_only_retains_writes_from_completed_syncs() {
    let (workbook, _) = Workbook::blank().unwrap();
    let before_sync = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          context.workbook.worksheets.getItem("Sheet1").getRange("A1").values = [[10]];
          throw new Error("before sync");
        });
        "#,
    );
    assert!(before_sync.is_err());
    assert_eq!(load(&workbook, "A1")["values"], json!([[null]]));
    assert_depths(&workbook, 0, 0);

    let after_sync = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [[10]];
          await context.sync();
          sheet.getRange("A2").values = [[99]];
          throw new Error("after sync");
        });
        "#,
    );
    assert!(after_sync.is_err());
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[10], [null]]));
    assert_depths(&workbook, 1, 0);
    workbook.history().undo().unwrap();
    assert_eq!(load(&workbook, "A1:A2")["values"], json!([[null], [null]]));
}
