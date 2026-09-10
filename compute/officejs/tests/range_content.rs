//! Office.js Range content projection tests.

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js_with_workbook};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn range_content_reads_number_formats_display_text_and_value_types() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [[42]];
          sheet.getRange("B1").values = [[45292]];
          sheet.getRange("C1").values = [[true]];
          sheet.getRange("A2").formulas = [["=\"\""]];
          sheet.getRange("B2").formulas = [["=1/0"]];
          sheet.getRange("C2").values = [["text"]];

          const range = sheet.getRange("A1:C2");
          range.numberFormat = [["0.00", "m/d/yyyy", null], [null, null, null]];
          await context.sync();

          const fresh = sheet.getRange("A1:C2");
          fresh.load("numberFormat,text,valueTypes,values,formulas");
          await context.sync();
          return {
            numberFormat: fresh.numberFormat,
            text: fresh.text,
            valueTypes: fresh.valueTypes,
            values: fresh.values,
            formulas: fresh.formulas
          };
        });
        "#,
    )
    .expect("Range content projections should load");

    assert_eq!(
        output.value,
        json!({
            "numberFormat": [
                ["0.00", "m/d/yyyy", "General"],
                ["General", "General", "General"]
            ],
            "text": [
                ["42.00", "1/1/2024", "TRUE"],
                ["", "#DIV/0!", "text"]
            ],
            "valueTypes": [
                ["Integer", "Integer", "Boolean"],
                ["String", "Error", "String"]
            ],
            "values": [
                [42, 45292, true],
                ["", "#DIV/0!", "text"]
            ],
            "formulas": [
                [42, 45292, true],
                ["=\"\"", "=1/0", "text"]
            ]
        })
    );
}

#[test]
fn range_set_copies_loaded_content_and_format_without_reading_unloaded_fields() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:B1");
          source.values = [[42, 0.5]];
          source.numberFormat = [["0.00", "0%"]];
          source.format.set({ wrapText: true });
          await context.sync();

          const sourceJson = source.toJSON();
          const target = sheet.getRange("A2:B2");
          target.set(source);
          await context.sync();

          const fresh = sheet.getRange("A2:B2");
          fresh.load("values,numberFormat");
          fresh.format.load("wrapText");
          await context.sync();
          return {
            sourceJson,
            hasUnloadedText: Object.prototype.hasOwnProperty.call(sourceJson, "text"),
            values: fresh.values,
            numberFormat: fresh.numberFormat,
            wrapText: fresh.format.wrapText
          };
        });
        "#,
    )
    .expect("Range.set and toJSON should preserve loaded fields");

    assert_eq!(
        output.value,
        json!({
            "sourceJson": {
                "values": [[42, 0.5]],
                "numberFormat": [["0.00", "0%"]],
                "format": { "wrapText": true }
            },
            "hasUnloadedText": false,
            "values": [[42, 0.5]],
            "numberFormat": [["0.00", "0%"]],
            "wrapText": true
        })
    );
}

#[test]
fn number_format_set_requires_exact_2d_shape_and_null_preserves_cells() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const target = sheet.getRange("A1:B1");
          target.numberFormat = [["0.0", "0.00"]];
          await context.sync();

          target.numberFormat = [["0.000", null]];
          await context.sync();

          const fresh = sheet.getRange("A1:B1");
          fresh.load("numberFormat");
          await context.sync();
          const preserved = fresh.numberFormat;

          let shapeCode = null;
          try {
            sheet.getRange("A1:B1").numberFormat = [["0"]];
            await context.sync();
          } catch (error) {
            shapeCode = error.code;
          }

          const afterError = sheet.getRange("A1:B1");
          afterError.load("numberFormat");
          await context.sync();
          return { preserved, shapeCode, afterError: afterError.numberFormat };
        });
        "#,
    )
    .expect("numberFormat shape checks should succeed");

    assert_eq!(
        output.value,
        json!({
            "preserved": [["0.000", "0.00"]],
            "shapeCode": "InvalidArgument",
            "afterError": [["0.000", "0.00"]]
        })
    );
}

#[test]
fn clear_contents_preserves_format_and_clear_formats_preserves_contents() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const target = sheet.getRange("A1:B1");
          target.values = [[42, 0.5]];
          target.numberFormat = [["0.00", "0%"]];
          await context.sync();

          target.clear("Contents");
          await context.sync();
          const afterContents = sheet.getRange("A1:B1");
          afterContents.load("values,numberFormat,valueTypes");
          await context.sync();

          target.values = [[42, 0.5]];
          await context.sync();
          target.clear("Formats");
          await context.sync();
          const afterFormats = sheet.getRange("A1:B1");
          afterFormats.load("values,numberFormat,valueTypes");
          await context.sync();

          return {
            afterContents: {
              values: afterContents.values,
              numberFormat: afterContents.numberFormat,
              valueTypes: afterContents.valueTypes
            },
            afterFormats: {
              values: afterFormats.values,
              numberFormat: afterFormats.numberFormat,
              valueTypes: afterFormats.valueTypes
            }
          };
        });
        "#,
    )
    .expect("content and format clear modes should succeed");

    assert_eq!(
        output.value,
        json!({
            "afterContents": {
                "values": [["", ""]],
                "numberFormat": [["0.00", "0%"]],
                "valueTypes": [["Empty", "Empty"]]
            },
            "afterFormats": {
                "values": [[42, 0.5]],
                "numberFormat": [["General", "General"]],
                "valueTypes": [["Integer", "Double"]]
            }
        })
    );
}

#[test]
fn clear_modes_without_a_compute_primitive_fail_explicitly() {
    let workbook = blank_workbook();
    for mode in ["RemoveHyperlinks", "ResetContents"] {
        let error = run_office_js_with_workbook(
            &workbook,
            &format!(
                r#"
                return await Excel.run(async (context) => {{
                  const range = context.workbook.worksheets.getItem("Sheet1").getRange("A1");
                  range.clear("{mode}");
                  await context.sync();
                }});
                "#
            ),
        )
        .expect_err("unsupported clear mode should fail");
        match error {
            OfficeJsError::Script(message) => {
                assert!(
                    message.contains("InvalidArgument"),
                    "unexpected error: {message}"
                );
            }
            other => panic!("expected script error, got {other}"),
        }
    }
}
