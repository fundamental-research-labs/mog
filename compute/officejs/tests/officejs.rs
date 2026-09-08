//! Office.js engine tests. Scripts go through `run_office_js`, the shipped
//! eval entry used by the `mog` CLI.

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js};

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
