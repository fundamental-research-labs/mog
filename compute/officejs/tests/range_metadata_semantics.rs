//! Range metadata projections through the production Office.js runtime.

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js_with_workbook};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn formulas_r1c1_reads_values_and_round_trips_relative_and_absolute_refs() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [[10]];
          sheet.getRange("C1").values = [[5]];
          sheet.getRange("B2").formulas = [["=A1+$C$1"]];
          const before = sheet.getRange("A1:C2");
          before.load("formulasR1C1");
          await context.sync();

          const target = sheet.getRange("B2");
          target.formulasR1C1 = [["=R[-1]C[-1]+R1C3"]];
          await context.sync();
          const after = sheet.getRange("B2");
          after.load("formulas,formulasR1C1,values");
          await context.sync();
          return { before: before.formulasR1C1, after: after.formulas, afterR1C1: after.formulasR1C1, value: after.values };
        });
        "#,
    )
    .expect("R1C1 formula projection should round-trip");

    assert_eq!(
        output.value,
        json!({
            "before": [
                [10, "", 5],
                ["", "=R[-1]C[-1]+R1C3", ""]
            ],
            "after": [["=A1+$C$1"]],
            "afterR1C1": [["=R[-1]C[-1]+R1C3"]],
            "value": [[15]]
        })
    );
}

#[test]
fn hidden_row_column_and_cell_aggregates_round_trip_with_mixed_states() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const row = sheet.getRange("2:2");
          const column = sheet.getRange("B:B");
          row.rowHidden = true;
          column.columnHidden = true;
          await context.sync();

          const mixed = sheet.getRange("A1:C3");
          const hiddenRow = sheet.getRange("2:2");
          const entireColumn = sheet.getRange("B:B");
          [mixed, hiddenRow, entireColumn].forEach((range) => range.load("hidden,rowHidden,columnHidden,isEntireRow,isEntireColumn"));
          await context.sync();
          const result = {
            mixed: [mixed.hidden, mixed.rowHidden, mixed.columnHidden, mixed.isEntireRow, mixed.isEntireColumn],
            hiddenRow: [hiddenRow.hidden, hiddenRow.rowHidden, hiddenRow.columnHidden, hiddenRow.isEntireRow, hiddenRow.isEntireColumn],
            entireColumn: [entireColumn.hidden, entireColumn.rowHidden, entireColumn.columnHidden, entireColumn.isEntireRow, entireColumn.isEntireColumn]
          };

          row.rowHidden = false;
          column.columnHidden = false;
          await context.sync();
          const visible = sheet.getRange("A1:C3");
          visible.load("hidden,rowHidden,columnHidden");
          await context.sync();
          result.visible = [visible.hidden, visible.rowHidden, visible.columnHidden];
          return result;
        });
        "#,
    )
    .expect("row and column visibility should round-trip");

    assert_eq!(
        output.value,
        json!({
            "mixed": [null, null, null, false, false],
            "hiddenRow": [true, true, null, true, false],
            "entireColumn": [true, null, true, false, true],
            "visible": [false, false, false]
        })
    );
}

#[test]
fn number_format_categories_use_the_engine_format_detector() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r##"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("A1:L1");
          range.numberFormat = [[
            "General", "0.00", "$#,##0.00", "_($* #,##0.00_)",
            "m/d/yyyy", "h:mm:ss", "0%", "# ?/?", "0.00E+00", "@", "00000", "???"
          ]];
          await context.sync();
          const result = sheet.getRange("A1:L1");
          result.load("numberFormatCategories");
          await context.sync();
          return result.numberFormatCategories;
        });
        "##,
    )
    .expect("number format categories should load");

    assert_eq!(
        output.value,
        json!([[
            "General",
            "Number",
            "Currency",
            "Accounting",
            "Date",
            "Time",
            "Percentage",
            "Fraction",
            "Scientific",
            "Text",
            "Special",
            "Custom"
        ]])
    );
}

#[test]
fn has_spill_reports_true_false_and_mixed_from_projection_regions() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").formulas = [["=SEQUENCE(2,1)"]];
          await context.sync();
          const spill = sheet.getRange("A1:A2");
          const empty = sheet.getRange("B1:B2");
          const mixed = sheet.getRange("A1:B2");
          [spill, empty, mixed].forEach((range) => range.load("hasSpill"));
          await context.sync();
          return [spill.hasSpill, empty.hasSpill, mixed.hasSpill];
        });
        "#,
    )
    .expect("spill metadata should load");

    assert_eq!(output.value, json!([true, false, null]));
}

#[test]
fn locale_properties_fail_explicitly_without_locale_context() {
    for property in ["formulasLocal", "numberFormatLocal"] {
        let source = format!(
            r#"
            return await Excel.run(async (context) => {{
              const sheet = context.workbook.worksheets.getItem("Sheet1");
              const range = sheet.getRange("A1");
              range.load("{property}");
              await context.sync();
              return range.{property};
            }});
            "#
        );
        let error = run_office_js_with_workbook(&blank_workbook(), &source)
            .expect_err("locale-aware metadata must not be silently aliased");
        match error {
            OfficeJsError::Script(message) => {
                assert!(
                    message.contains("InvalidArgument"),
                    "unexpected error: {message}"
                );
                assert!(message.contains("locale"), "unexpected error: {message}");
            }
            other => panic!("expected script error, got {other:?}"),
        }

        let setter_value = if property == "formulasLocal" {
            r#"[["=SUM(A1,1)"]]"#
        } else {
            r#"[["0,0"]]"#
        };
        let source = format!(
            r#"
            return await Excel.run(async (context) => {{
              const sheet = context.workbook.worksheets.getItem("Sheet1");
              const range = sheet.getRange("A1");
              range.{property} = {setter_value};
              await context.sync();
              return true;
            }});
            "#
        );
        let error = run_office_js_with_workbook(&blank_workbook(), &source)
            .expect_err("locale-aware metadata writes must not be silently aliased");
        match error {
            OfficeJsError::Script(message) => {
                assert!(
                    message.contains("InvalidArgument"),
                    "unexpected error: {message}"
                );
                assert!(message.contains("locale"), "unexpected error: {message}");
            }
            other => panic!("expected script error, got {other:?}"),
        }
    }
}
