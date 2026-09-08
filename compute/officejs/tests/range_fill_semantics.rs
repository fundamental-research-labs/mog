//! Office.js Range fill-family behavior through the shipped runtime.

use compute_api::Workbook;
use mog::{run_office_js_with_workbook, OfficeJsError};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn auto_fill_copies_formulas_down_and_preserves_source_cells() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [[10]];
          sheet.getRange("A2").values = [[20]];
          sheet.getRange("B1").formulas = [["=A1*2"]];
          sheet.getRange("B2").formulas = [["=A2*2"]];
          await context.sync();

          sheet.getRange("B1:B2").autoFill("B1:B5", Excel.AutoFillType.fillCopy);
          await context.sync();

          const result = sheet.getRange("B1:B5");
          result.load("values,formulas");
          await context.sync();
          return { values: result.values, formulas: result.formulas };
        });
        "#,
    )
    .expect("formula autofill should succeed");

    assert_eq!(
        output.value,
        json!({
            "values": [[20], [40], [60], [80], [100]],
            "formulas": [["=A1*2"], ["=A2*2"], ["=A3*2"], ["=A4*2"], ["=A5*2"]]
        })
    );
}

#[test]
fn auto_fill_series_and_exact_enum_members_work_in_both_directions() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A2").values = [[2], [4]];
          sheet.getRange("C4:C5").values = [[5], [3]];
          sheet.getRange("E1:F1").values = [[1, 3]];
          await context.sync();

          sheet.getRange("A1:A2").autoFill("A1:A5", "FillSeries");
          sheet.getRange("C4:C5").autoFill("C1:C5", Excel.AutoFillType.fillSeries);
          sheet.getRange("E1:F1").autoFill("E1:I1", Excel.AutoFillType.fillSeries);
          await context.sync();

          const result = sheet.getRange("A1:I5");
          result.load("values");
          await context.sync();
          return result.values;
        });
        "#,
    )
    .expect("series autofill should succeed");

    assert_eq!(
        output.value,
        json!([
            [2, "", 11, "", 1, 3, 5, 7, 9],
            [4, "", 9, "", "", "", "", "", ""],
            [6, "", 7, "", "", "", "", "", ""],
            ["", "", 5, "", "", "", "", "", ""],
            ["", "", 3, "", "", "", "", "", ""]
        ])
    );
}

#[test]
fn auto_fill_rejects_invalid_shape_and_out_of_grid_destination_before_mutation() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A2").values = [[1], [2]];
          await context.sync();

          const errors = [];
          for (const destination of ["B1:B5", "A1:B5", "A1:A1048577"]) {
            try {
              sheet.getRange("A1:A2").autoFill(destination, Excel.AutoFillType.fillCopy);
              await context.sync();
            } catch (error) {
              errors.push(error.code);
            }
          }

          const result = sheet.getRange("A1:A2");
          result.load("values");
          await context.sync();
          return { errors, values: result.values };
        });
        "#,
    )
    .expect("invalid autofill requests should be reported by sync");

    assert_eq!(
        output.value,
        json!({ "errors": ["InvalidArgument", "InvalidArgument", "InvalidArgument"], "values": [[1], [2]] })
    );
}

#[test]
fn auto_fill_validates_exact_auto_fill_type_values() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A2").values = [[1], [2]];
          await context.sync();

          const errors = [];
          for (const kind of ["fillSeries", "FillNotAType", "FlashFill"]) {
            try {
              sheet.getRange("A1:A2").autoFill("A1:A4", kind);
              await context.sync();
            } catch (error) {
              errors.push({ kind, code: error.code });
            }
          }
          return errors;
        });
        "#,
    )
    .expect("AutoFillType validation should be deferred to sync");

    assert_eq!(
        output.value,
        json!([
            { "kind": "fillSeries", "code": "InvalidArgument" },
            { "kind": "FillNotAType", "code": "InvalidArgument" },
            { "kind": "FlashFill", "code": "UnsupportedOperation" }
        ])
    );
}

#[test]
fn auto_fill_null_destination_uses_contiguous_neighboring_values() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A2").values = [[10], [20]];
          sheet.getRange("B1:B6").values = [[1], [2], [3], [4], [5], [6]];
          await context.sync();

          sheet.getRange("A1:A2").autoFill(null, Excel.AutoFillType.fillSeries);
          await context.sync();

          const result = sheet.getRange("A1:A6");
          result.load("values");
          await context.sync();
          return result.values;
        });
        "#,
    )
    .expect("null destination autofill should use neighboring values");

    assert_eq!(output.value, json!([[10], [20], [30], [40], [50], [60]]));
}

#[test]
fn flash_fill_uses_the_populated_neighboring_column() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A3").values = [["John Smith"], ["Jane Doe"], ["Bob Wilson"]];
          sheet.getRange("B1").values = [["John"]];
          const target = sheet.getRange("B1:B3");
          await context.sync();

          target.flashFill();
          await context.sync();

          const result = sheet.getRange("B1:B3");
          result.load("values");
          await context.sync();
          return result.values;
        });
        "#,
    )
    .expect("flash fill should succeed");

    assert_eq!(output.value, json!([["John"], ["Jane"], ["Bob"]]));
}

#[test]
fn flash_fill_requires_one_bounded_column() {
    let workbook = blank_workbook();
    let error = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const target = context.workbook.worksheets.getItem("Sheet1").getRange("A1:B3");
          target.flashFill();
          await context.sync();
        });
        "#,
    )
    .expect_err("multi-column flash fill should fail");

    match error {
        OfficeJsError::Script(message) => assert!(message.contains("InvalidArgument"), "{message}"),
        other => panic!("expected script error, got {other}"),
    }
}

#[test]
fn flash_fill_rejects_a_column_without_neighboring_data() {
    let workbook = blank_workbook();
    let error = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const target = context.workbook.worksheets.getItem("Sheet1").getRange("B1:B3");
          target.values = [["John"], [null], [null]];
          target.flashFill();
          await context.sync();
        });
        "#,
    )
    .expect_err("flash fill without neighboring data should fail");

    match error {
        OfficeJsError::Script(message) => assert!(message.contains("InvalidArgument"), "{message}"),
        other => panic!("expected script error, got {other}"),
    }
}

#[test]
fn no_directional_fill_methods_are_invented() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const range = context.workbook.worksheets.getItem("Sheet1").getRange("A1");
          return {
            autoFill: typeof range.autoFill,
            flashFill: typeof range.flashFill,
            fillDown: typeof range.fillDown,
            fillRight: typeof range.fillRight,
            fillUp: typeof range.fillUp,
            fillLeft: typeof range.fillLeft
          };
        });
        "#,
    )
    .expect("method surface observation should succeed");

    assert_eq!(
        output.value,
        json!({
            "autoFill": "function",
            "flashFill": "function",
            "fillDown": "undefined",
            "fillRight": "undefined",
            "fillUp": "undefined",
            "fillLeft": "undefined"
        })
    );
}
