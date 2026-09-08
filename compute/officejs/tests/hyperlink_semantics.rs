//! Office.js `Range.hyperlink` semantics through the shipped host.

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js_with_workbook};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn hyperlink_load_requires_sync_and_unlinked_ranges_return_an_empty_value() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async context => {
          const range = context.workbook.worksheets.getItem("Sheet1").getRange("A1");
          let beforeSync = null;
          try {
            void range.hyperlink;
          } catch (error) {
            beforeSync = error.code;
          }
          range.load("hyperlink");
          await context.sync();
          return { beforeSync, hyperlink: range.hyperlink };
        });
        "#,
    )
    .expect("unlinked hyperlink load should succeed");

    assert_eq!(
        output.value,
        json!({
            "beforeSync": "PropertyNotLoaded",
            "hyperlink": {}
        })
    );
}

#[test]
fn hyperlink_round_trip_preserves_all_declared_fields_and_adjacent_cells() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const target = sheet.getRange("A1");
          const adjacent = sheet.getRange("B1");
          target.values = [["Keep target content"]];
          target.numberFormat = [["0.00"]];
          adjacent.values = [[42]];
          adjacent.numberFormat = [["0%"]];
          target.hyperlink = {
            address: "https://example.com/docs",
            screenTip: "Open documentation",
            textToDisplay: "Read the docs"
          };
          await context.sync();

          const fresh = sheet.getRange("A1:B1");
          fresh.load("hyperlink,values,numberFormat");
          await context.sync();
          return {
            hyperlink: fresh.hyperlink,
            values: fresh.values,
            numberFormat: fresh.numberFormat,
            adjacent: {
              value: fresh.values[0][1],
              numberFormat: fresh.numberFormat[0][1]
            }
          };
        });
        "#,
    )
    .expect("hyperlink fields should round trip");

    assert_eq!(
        output.value,
        json!({
            "hyperlink": {
                "address": "https://example.com/docs",
                "screenTip": "Open documentation",
                "textToDisplay": "Read the docs"
            },
            "values": [["Keep target content", 42]],
            "numberFormat": [["0.00", "0%"]],
            "adjacent": { "value": 42, "numberFormat": "0%" }
        })
    );
}

#[test]
fn internal_hyperlink_uses_document_reference_and_keeps_target_content() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          context.workbook.worksheets.add("Sheet2");
          const target = sheet.getRange("C3");
          target.values = [["Jump"]];
          target.hyperlink = {
            documentReference: "Sheet2!B2",
            screenTip: "Go to the target",
            textToDisplay: "Jump now"
          };
          await context.sync();

          const fresh = sheet.getRange("C3");
          fresh.load("hyperlink,values");
          await context.sync();
          return { hyperlink: fresh.hyperlink, values: fresh.values };
        });
        "#,
    )
    .expect("internal hyperlink should round trip");

    assert_eq!(
        output.value,
        json!({
            "hyperlink": {
                "documentReference": "Sheet2!B2",
                "screenTip": "Go to the target",
                "textToDisplay": "Jump now"
            },
            "values": [["Jump"]]
        })
    );
}

#[test]
fn clear_hyperlinks_preserves_content_and_format_remove_hyperlinks_also_clears_format() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("A1:B1");
          range.values = [["A", "B"]];
          range.numberFormat = [["0.00", "0%"]];
          sheet.getRange("A1").hyperlink = { address: "https://a.example" };
          sheet.getRange("B1").hyperlink = { address: "https://b.example" };
          await context.sync();

          range.clear("Hyperlinks");
          await context.sync();
          const afterHyperlinks = sheet.getRange("A1:B1");
          afterHyperlinks.load("hyperlink,values,numberFormat");
          await context.sync();

          sheet.getRange("A1").hyperlink = { address: "https://a.example" };
          sheet.getRange("A1").clear("RemoveHyperlinks");
          await context.sync();
          const afterRemove = sheet.getRange("A1");
          afterRemove.load("hyperlink,values,numberFormat");
          await context.sync();

          return {
            afterHyperlinks: {
              a: afterHyperlinks.hyperlink,
              values: afterHyperlinks.values,
              numberFormat: afterHyperlinks.numberFormat
            },
            afterRemove: {
              hyperlink: afterRemove.hyperlink,
              values: afterRemove.values,
              numberFormat: afterRemove.numberFormat
            }
          };
        });
        "#,
    )
    .expect("hyperlink clear modes should preserve their documented fields");

    assert_eq!(
        output.value,
        json!({
            "afterHyperlinks": {
                "a": {},
                "values": [["A", "B"]],
                "numberFormat": [["0.00", "0%"]]
            },
            "afterRemove": {
                "hyperlink": {},
                "values": [["A"]],
                "numberFormat": [["General"]]
            }
        })
    );
}

#[test]
fn hyperlink_set_supports_range_set_and_rejects_non_string_fields() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1");
          source.values = [["Source"]];
          source.hyperlink = {
            address: "https://source.example",
            screenTip: "Source tip",
            textToDisplay: "Source link"
          };
          await context.sync();

          const target = sheet.getRange("A2");
          target.set(source);
          await context.sync();
          const fresh = sheet.getRange("A2");
          fresh.load("hyperlink,values");
          await context.sync();

          let invalidCode = null;
          try {
            sheet.getRange("C1").hyperlink = { address: 42 };
          } catch (error) {
            invalidCode = error.code;
          }
          return { hyperlink: fresh.hyperlink, values: fresh.values, invalidCode };
        });
        "#,
    )
    .expect("Range.set should copy hyperlink values");

    assert_eq!(
        output.value,
        json!({
            "hyperlink": {
                "address": "https://source.example",
                "screenTip": "Source tip",
                "textToDisplay": "Source link"
            },
            "values": [["Source"]],
            "invalidCode": "InvalidArgument"
        })
    );
}

#[test]
fn hyperlink_on_unbounded_range_fails_at_sync() {
    let workbook = blank_workbook();
    let error = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async context => {
          const range = context.workbook.worksheets.getItem("Sheet1").getRange();
          range.hyperlink = { address: "https://example.com" };
          await context.sync();
          return true;
        });
        "#,
    )
    .expect_err("whole-sheet hyperlink writes must be rejected");

    match error {
        OfficeJsError::Script(message) => assert!(
            message.contains("InvalidArgument"),
            "unexpected unbounded hyperlink error: {message}"
        ),
        other => panic!("expected script error, got {other}"),
    }
}
