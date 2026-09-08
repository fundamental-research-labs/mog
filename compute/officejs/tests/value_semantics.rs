//! Office.js range value regressions through the shipped QuickJS/host path.

use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::{Value, json};

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn values_preserve_javascript_scalar_types_and_formula_intent() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:F1").values = [["001", "TRUE", "1.5", true, false, 7.25]];
          sheet.getRange("A2:F2").formulas = [["=F1*2", "001", "", null, null, null]];
          await context.sync();

          const read = sheet.getRange("A1:F2");
          read.load("values");
          read.load({ select: "formulas" });
          await context.sync();
          return { values: read.values, formulas: read.formulas };
        });
        "#,
    )
    .expect("typed Office.js write should succeed");

    assert_eq!(
        output.value["values"],
        json!([
            ["001", "TRUE", "1.5", true, false, 7.25],
            [14.5, "001", "", "", "", ""]
        ])
    );
    assert_eq!(
        output.value["formulas"],
        json!([
            ["001", "TRUE", "1.5", true, false, 7.25],
            ["=F1*2", "001", "", "", "", ""]
        ])
    );
}

#[test]
fn values_formula_markers_are_distinct_from_literal_strings() {
    // Microsoft documents +, -, and = as Range.values formula markers. It
    // does not document editor-style apostrophe stripping for this API; the
    // apostrophe expectation below is a provisional local policy pending a
    // recorded Excel host observation.
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:E1").values = [[10, "=A1*2", "+A1*3", "-A1", "'001"]];
          await context.sync();
          const read = sheet.getRange("A1:E1");
          read.load("values,formulas");
          await context.sync();
          return { values: read.values, formulas: read.formulas };
        });
        "#,
    )
    .expect("formula-marker Office.js write should succeed");

    assert_eq!(output.value["values"], json!([[10, 20, 30, -10, "'001"]]));
    assert_eq!(
        output.value["formulas"],
        json!([[10, "=A1*2", "=+A1*3", "=-A1", "'001"]])
    );
}

#[test]
fn null_entries_preserve_cells_and_blank_reads_are_empty_strings() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:D4").values = [
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [9, 10, 11, 12],
            [13, 14, 15, 16]
          ];
          await context.sync();

          sheet.getRange("B2:C3").values = [[null, ""], [99, null]];
          await context.sync();

          const read = sheet.getRange("A1:D4");
          read.load("values, formulas");
          await context.sync();
          return { values: read.values, formulas: read.formulas };
        });
        "#,
    )
    .expect("null-preserving Office.js write should succeed");

    let expected_values = json!([
        [1, 2, 3, 4],
        [5, 6, "", 8],
        [9, 99, 11, 12],
        [13, 14, 15, 16]
    ]);
    assert_eq!(output.value["values"], expected_values);
    assert_eq!(output.value["formulas"], expected_values);
}

#[test]
fn multiple_loads_for_one_proxy_accumulate_properties() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").formulas = [["=1+2"]];
          await context.sync();

          const read = sheet.getRange("A1");
          read.load("values");
          read.load(["formulas"]);
          await context.sync();
          return { values: read.values, formulas: read.formulas };
        });
        "#,
    )
    .expect("independent loads should merge");

    assert_eq!(
        output.value,
        json!({ "values": [[3]], "formulas": [["=1+2"]] })
    );
}

#[test]
fn invalid_grids_are_rejected_without_mutating_target_or_neighbors() {
    // Range property setters take a 2-D array representing the target range.
    // These cases cover every structural mismatch around a 2x2 target:
    // non-grid, empty, empty row, too few/many rows, too few/many columns,
    // and ragged rows. Each case is executed by run_office_js_with_workbook,
    // then the complete sentinel neighborhood is read through Office.js.
    let cases: &[(&str, &str)] = &[
        ("null property", "null"),
        ("one dimensional", "[1, 2]"),
        ("empty grid", "[]"),
        ("empty row", "[[]]"),
        ("undersized rows", "[[101, 102]]"),
        ("undersized columns", "[[101], [102]]"),
        ("oversized rows", "[[101, 102], [103, 104], [105, 106]]"),
        ("oversized columns", "[[101, 102, 103], [104, 105, 106]]"),
        ("ragged short", "[[101, 102], [103]]"),
        ("ragged long", "[[101], [102, 103]]"),
    ];
    let sentinels = json!([
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16]
    ]);

    for (name, payload) in cases {
        let workbook = blank_workbook();
        let source = format!(
            r#"
            await Excel.run(async (context) => {{
              const sheet = context.workbook.worksheets.getItem("Sheet1");
              sheet.getRange("A1:D4").values = [
                [1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12],
                [13, 14, 15, 16]
              ];
              await context.sync();
            }});

            let errorCode = null;
            try {{
              await Excel.run(async (context) => {{
                const sheet = context.workbook.worksheets.getItem("Sheet1");
                sheet.getRange("B2:C3").values = {payload};
                await context.sync();
              }});
            }} catch (error) {{
              errorCode = error && error.code;
            }}

            return await Excel.run(async (context) => {{
              const sheet = context.workbook.worksheets.getItem("Sheet1");
              const read = sheet.getRange("A1:D4");
              read.load("values");
              await context.sync();
              return {{ errorCode, values: read.values }};
            }});
            "#
        );
        let output = run_office_js_with_workbook(&workbook, &source)
            .unwrap_or_else(|error| panic!("{name}: script should catch shape error: {error}"));

        assert_eq!(
            output.value["errorCode"],
            Value::String("InvalidArgument".to_string()),
            "{name}: expected InvalidArgument"
        );
        assert_eq!(
            output.value["values"], sentinels,
            "{name}: invalid grid changed target or neighboring cells"
        );
    }
}
