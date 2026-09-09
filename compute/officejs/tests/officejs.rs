//! Office.js engine tests. Scripts go through `run_office_js`, the shipped
//! eval entry used by the `mog` CLI.

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js, run_office_js_with_workbook};

#[test]
fn bulk_sync_and_subsequent_rust_edit_share_values_and_dependencies() {
    let (workbook, _) = Workbook::blank().unwrap();
    let first = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const values = Array.from({length: 100}, (_, r) =>
            Array.from({length: 10}, (_, c) => r * 10 + c + 1));
          sheet.getRange("A1:J100").values = values;
          const summary = context.workbook.worksheets.add("Summary");
          const total = summary.getRange("A1");
          total.formulas = [["=SUM(Sheet1!A1:J100)"]];
          const data = sheet.getRange("A1:J100");
          data.load("values");
          total.load("values");
          await context.sync();
          if (JSON.stringify(data.values) !== JSON.stringify(values)) {
            throw new Error("bulk write did not preserve every cell");
          }
          return total.values[0][0];
        });
        "#,
    )
    .expect("bulk Office.js sync");
    assert_eq!(first.value.as_f64(), Some(500_500.0));

    workbook
        .sheet_by_name("Sheet1")
        .unwrap()
        .set_cell("A1", "101")
        .unwrap();
    let second = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const total = context.workbook.worksheets.getItem("Summary").getRange("A1");
          total.load("values");
          await context.sync();
          return total.values[0][0];
        });
        "#,
    )
    .expect("read dependent result after Rust edit");
    assert_eq!(second.value.as_f64(), Some(500_600.0));
}

#[test]
fn repeated_sync_preserves_mixed_values_and_refreshes_formula_results() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:D1").values = [[7, true, "日本語 🦀", null]];
          const result = sheet.getRange("E1");
          result.formulas = [["=A1*3"]];
          result.load("values");
          await context.sync();
          const before = result.values[0][0];
          sheet.getRange("A1").values = [[11]];
          const range = sheet.getRange("A1:E1");
          range.load("values");
          await context.sync();
          return {before, after: range.values};
        });
        "#,
    )
    .expect("mixed values and repeated sync");
    assert_eq!(
        output.value,
        serde_json::json!({
            "before": 21,
            "after": [[11, true, "日本語 🦀", null, 33]]
        })
    );
}

#[test]
fn rust_workbook_can_add_sheet() {
    let (wb, _) = Workbook::blank().expect("blank workbook");
    wb.sheets().create_sheet("Data").expect("create_sheet");
    let sheet = wb.sheet_by_name("Data").expect("get Data");
    sheet.set_cell("A1", "42").expect("set A1");
    assert_eq!(sheet.get_cell_value("A1").unwrap().as_number(), Some(42.0));
}

#[test]
fn values_and_formulas_load_computed_result() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [[10]];
          sheet.getRange("A2").formulas = [["=A1*2"]];
          const result = sheet.getRange("A2");
          result.load("values");
          await context.sync();
          return result.values[0][0];
        });
        "#,
    )
    .expect("script should succeed");

    assert_eq!(output.value.as_f64(), Some(20.0));
}

#[test]
fn worksheets_add_getitem_and_get_range() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const created = context.workbook.worksheets.add("Data");
          created.getRange("A1").values = [[42]];
          const got = context.workbook.worksheets.getItem("Data");
          const range = got.getRange("A1");
          range.load("values");
          await context.sync();
          return range.values;
        });
        "#,
    )
    .expect("script should succeed");

    let cell = output.value.pointer("/0/0").and_then(|v| v.as_f64());
    assert_eq!(cell, Some(42.0));
}

#[test]
fn unloaded_property_is_not_readable() {
    let err = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("A1");
          range.values = [[1]];
          await context.sync();
          return range.values;
        });
        "#,
    )
    .expect_err("reading values without load must fail");

    match err {
        OfficeJsError::Script(message) => {
            assert!(
                message.contains("PropertyNotLoaded") || message.contains("not available"),
                "unexpected error: {message}"
            );
        }
        other => panic!("expected script error, got {other}"),
    }
}
