//! Office.js Range.dataValidation behavior through the shipped runtime.

use mog::run_office_js;
use serde_json::json;

#[test]
fn data_validation_rule_families_round_trip_through_fresh_proxies() {
    let output = run_office_js(
        r#"
        await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A2").dataValidation.set({
            rule: { wholeNumber: { operator: "Between", formula1: 1, formula2: 10 } },
            ignoreBlanks: false,
            errorAlert: {
              message: "Use an integer from 1 through 10",
              showAlert: true,
              style: "Stop",
              title: "Whole number"
            },
            prompt: {
              message: "Enter a whole number",
              showPrompt: true,
              title: "Input"
            }
          });
          sheet.getRange("B1:B2").dataValidation.set({
            rule: { decimal: { operator: "GreaterThanOrEqualTo", formula1: 0.5 } }
          });
          sheet.getRange("C1:C2").dataValidation.set({
            rule: { date: { operator: "Between", formula1: "2024-01-01", formula2: "2024-12-31" } }
          });
          sheet.getRange("D1:D2").dataValidation.set({
            rule: { time: { operator: "GreaterThanOrEqualTo", formula1: "08:00" } }
          });
          sheet.getRange("E1:E2").dataValidation.set({
            rule: { textLength: { operator: "Between", formula1: 2, formula2: 5 } }
          });
          sheet.getRange("F1:F2").dataValidation.set({
            rule: { list: { source: "Red,Green,Blue", inCellDropDown: false } }
          });
          sheet.getRange("G1:G2").dataValidation.set({
            rule: { custom: { formula: "=ISNUMBER(A1)" } }
          });
        });

        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const result = {};
          ["A1:A2", "B1:B2", "C1:C2", "D1:D2", "E1:E2", "F1:F2", "G1:G2"]
            .forEach((address, index) => {
              const validation = sheet.getRange(address).dataValidation;
              validation.load(["rule", "errorAlert", "ignoreBlanks", "prompt", "type"]);
              result[index] = validation;
            });
          await context.sync();
          return result;
        });
        "#,
    )
    .expect("data validation families should persist");

    assert_eq!(output.value["0"]["type"], json!("WholeNumber"));
    assert_eq!(
        output.value["0"]["rule"]["wholeNumber"],
        json!({
            "operator": "Between",
            "formula1": "=1",
            "formula2": "=10"
        })
    );
    assert_eq!(output.value["0"]["ignoreBlanks"], json!(false));
    assert_eq!(
        output.value["0"]["errorAlert"],
        json!({
            "message": "Use an integer from 1 through 10",
            "showAlert": true,
            "style": "Stop",
            "title": "Whole number"
        })
    );
    assert_eq!(
        output.value["0"]["prompt"],
        json!({
            "message": "Enter a whole number",
            "showPrompt": true,
            "title": "Input"
        })
    );

    assert_eq!(output.value["1"]["type"], json!("Decimal"));
    assert_eq!(
        output.value["1"]["rule"]["decimal"],
        json!({
            "operator": "GreaterThanOrEqualTo",
            "formula1": "=0.5"
        })
    );
    assert_eq!(output.value["2"]["type"], json!("Date"));
    assert_eq!(
        output.value["2"]["rule"]["date"],
        json!({
            "operator": "Between",
            "formula1": "=45292",
            "formula2": "=45657"
        })
    );
    assert_eq!(output.value["3"]["type"], json!("Time"));
    assert_eq!(
        output.value["3"]["rule"]["time"],
        json!({
            "operator": "GreaterThanOrEqualTo",
            "formula1": "=0.3333333333333333"
        })
    );
    assert_eq!(output.value["4"]["type"], json!("TextLength"));
    assert_eq!(
        output.value["4"]["rule"]["textLength"],
        json!({
            "operator": "Between",
            "formula1": "=2",
            "formula2": "=5"
        })
    );
    assert_eq!(output.value["5"]["type"], json!("List"));
    assert_eq!(
        output.value["5"]["rule"]["list"],
        json!({
            "source": "Red,Green,Blue",
            "inCellDropDown": false
        })
    );
    assert_eq!(output.value["6"]["type"], json!("Custom"));
    assert_eq!(
        output.value["6"]["rule"]["custom"],
        json!({"formula": "=ISNUMBER(A1)"})
    );
}

#[test]
fn data_validation_list_dropdown_false_survives_fresh_engine_round_trip() {
    let output = run_office_js(
        r#"
        await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("H1:H2").dataValidation.rule = {
            list: { source: "Red,Green,Blue", inCellDropDown: false }
          };
        });

        return await Excel.run(async context => {
          const validation = context.workbook.worksheets
            .getItem("Sheet1").getRange("H1:H2").dataValidation;
          validation.load("rule");
          await context.sync();
          return validation.toJSON();
        });
        "#,
    )
    .expect("list dropdown setting should survive a fresh engine round trip");

    assert_eq!(
        output.value,
        json!({
            "rule": {
                "list": {
                    "source": "Red,Green,Blue",
                    "inCellDropDown": false
                }
            }
        })
    );
}

#[test]
fn data_validation_bound_formulas_round_trip_as_strings() {
    let output = run_office_js(
        r#"
        await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A2").dataValidation.rule = {
            wholeNumber: {
              operator: "Between",
              formula1: sheet.getRange("J1"),
              formula2: "=SUM(J1:J2)"
            }
          };
          sheet.getRange("B1:B2").dataValidation.rule = {
            decimal: { operator: "GreaterThanOrEqualTo", formula1: "=J1" }
          };
          sheet.getRange("C1:C2").dataValidation.rule = {
            date: { operator: "GreaterThanOrEqualTo", formula1: "=DATE(2024,1,1)" }
          };
          sheet.getRange("D1:D2").dataValidation.rule = {
            time: { operator: "GreaterThanOrEqualTo", formula1: "=TIME(8,0,0)" }
          };
          sheet.getRange("E1:E2").dataValidation.rule = {
            textLength: {
              operator: "Between",
              formula1: "=1+1",
              formula2: "=1+4"
            }
          };
        });

        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const result = {};
          ["A1:A2", "B1:B2", "C1:C2", "D1:D2", "E1:E2"]
            .forEach((address, index) => {
              const validation = sheet.getRange(address).dataValidation;
              validation.load("rule");
              result[index] = validation;
            });
          await context.sync();
          return result;
        });
        "#,
    )
    .expect("formula bounds should survive the durable validation round trip");

    assert_eq!(
        output.value["0"]["rule"]["wholeNumber"],
        json!({
            "operator": "Between",
            "formula1": "=J1",
            "formula2": "=SUM(J1:J2)"
        })
    );
    assert_eq!(
        output.value["1"]["rule"]["decimal"],
        json!({"operator": "GreaterThanOrEqualTo", "formula1": "=J1"})
    );
    assert_eq!(
        output.value["2"]["rule"]["date"],
        json!({"operator": "GreaterThanOrEqualTo", "formula1": "=DATE(2024,1,1)"})
    );
    assert_eq!(
        output.value["3"]["rule"]["time"],
        json!({"operator": "GreaterThanOrEqualTo", "formula1": "=TIME(8,0,0)"})
    );
    assert_eq!(
        output.value["4"]["rule"]["textLength"],
        json!({
            "operator": "Between",
            "formula1": "=1+1",
            "formula2": "=1+4"
        })
    );
}

#[test]
fn data_validation_bound_formulas_are_evaluated_dynamically() {
    let output = run_office_js(
        r#"
        await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [[5]];
          sheet.getRange("J1").values = [[3]];
          sheet.getRange("A1").dataValidation.rule = {
            wholeNumber: { operator: "GreaterThanOrEqualTo", formula1: "=J1" }
          };
        });

        const before = await Excel.run(async context => {
          const validation = context.workbook.worksheets
            .getItem("Sheet1").getRange("A1").dataValidation;
          validation.load("valid");
          await context.sync();
          return validation.valid;
        });

        await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("J1").values = [[6]];
        });

        const after = await Excel.run(async context => {
          const validation = context.workbook.worksheets
            .getItem("Sheet1").getRange("A1").dataValidation;
          validation.load("valid");
          await context.sync();
          return validation.valid;
        });
        return { before, after };
        "#,
    )
    .expect("formula bounds should be evaluated against current referenced cells");

    assert_eq!(output.value, json!({"before": true, "after": false}));
}

#[test]
fn data_validation_clear_removes_the_rule_for_fresh_proxies() {
    let output = run_office_js(
        r#"
        await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").dataValidation.rule = {
            wholeNumber: { operator: "EqualTo", formula1: 7 }
          };
        });
        await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").dataValidation.clear();
        });
        return await Excel.run(async context => {
          const validation = context.workbook.worksheets
            .getItem("Sheet1").getRange("A1").dataValidation;
          validation.load(["type", "rule", "ignoreBlanks"]);
          await context.sync();
          return validation.toJSON();
        });
        "#,
    )
    .expect("clear should succeed");

    assert_eq!(
        output.value,
        json!({
            "type": "None",
            "rule": {},
            "ignoreBlanks": true
        })
    );
}

#[test]
fn data_validation_valid_reports_mixed_cells() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A2").values = [[3], [99]];
          const validation = sheet.getRange("A1:A2").dataValidation;
          validation.rule = {
            wholeNumber: { operator: "Between", formula1: 1, formula2: 10 }
          };
          validation.load("valid");
          await context.sync();
          return validation.valid;
        });
        "#,
    )
    .expect("valid should be evaluated");

    assert_eq!(output.value, json!(null));
}

#[test]
fn data_validation_rejects_unknown_rule_members() {
    let output = run_office_js(
        r#"
        let code;
        try {
          await Excel.run(async context => {
            const validation = context.workbook.worksheets
              .getItem("Sheet1").getRange("A1").dataValidation;
            validation.rule = { wholeNumber: { operator: "Between", formula1: 1, formula2: 2, extra: 1 } };
            await context.sync();
          });
        } catch (error) {
          code = error.code;
        }
        return code;
        "#,
    )
    .expect("script should catch invalid rule");

    assert_eq!(output.value, json!("InvalidArgument"));
}
