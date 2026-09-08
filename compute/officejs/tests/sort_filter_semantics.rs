//! Office.js RangeSort and Worksheet AutoFilter behavior through the shipped
//! headless runtime.

use mog::{OfficeJsError, run_office_js};
use serde_json::json;

#[test]
fn range_sort_orders_rows_as_pairs_and_preserves_header() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("A1:C4");
          range.values = [
            ["Name", "Score", "Tag"],
            ["Alice", 30, "a"],
            ["Bob", 10, "b"],
            ["Cara", 20, "c"]
          ];
          range.sort.apply([{ key: 1, ascending: true }], false, true);
          range.load("values");
          await context.sync();
          return range.values;
        });
        "#,
    )
    .expect("Range.sort.apply should sort through compute-api");

    assert_eq!(
        output.value,
        json!([
            ["Name", "Score", "Tag"],
            ["Bob", 10, "b"],
            ["Cara", 20, "c"],
            ["Alice", 30, "a"]
        ])
    );
}

#[test]
fn auto_filter_values_hides_rows_and_clear_reveals_them() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const data = sheet.getRange("A1:B5");
          data.values = [
            ["Name", "Status"],
            ["Alice", "Open"],
            ["Bob", "Closed"],
            ["Cara", "Open"],
            ["Dan", "Pending"]
          ];
          const visibleCount = sheet.getRange("D1");
          visibleCount.formulas = [["=SUBTOTAL(103,A2:A5)"]];
          await context.sync();

          const autoFilter = sheet.autoFilter;
          autoFilter.apply("A1:B5", 1, {
            filterOn: "Values",
            values: ["Open"]
          });
          autoFilter.load(["enabled", "isDataFiltered", "criteria"]);
          visibleCount.load("values");
          await context.sync();
          const filtered = {
            count: visibleCount.values[0][0],
            enabled: autoFilter.enabled,
            isDataFiltered: autoFilter.isDataFiltered,
            criteria: autoFilter.criteria
          };

          autoFilter.clearCriteria();
          autoFilter.load(["enabled", "isDataFiltered", "criteria"]);
          visibleCount.load("values");
          await context.sync();
          return {
            filtered,
            cleared: {
              count: visibleCount.values[0][0],
              enabled: autoFilter.enabled,
              isDataFiltered: autoFilter.isDataFiltered,
              criteria: autoFilter.criteria
            }
          };
        });
        "#,
    )
    .expect("AutoFilter values criteria should update row visibility");

    assert_eq!(output.value["filtered"]["count"], json!(2));
    assert_eq!(output.value["filtered"]["enabled"], json!(true));
    assert_eq!(output.value["filtered"]["isDataFiltered"], json!(true));
    assert_eq!(
        output.value["filtered"]["criteria"],
        json!([null, {"filterOn": "Values", "values": ["Open"]}])
    );
    assert_eq!(output.value["cleared"]["count"], json!(4));
    assert_eq!(output.value["cleared"]["enabled"], json!(true));
    assert_eq!(output.value["cleared"]["isDataFiltered"], json!(false));
}

#[test]
fn auto_filter_custom_numeric_threshold_maps_to_condition_engine() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:B5").values = [
            ["Name", "Score"],
            ["Alice", 30],
            ["Bob", 60],
            ["Cara", 90],
            ["Dan", 40]
          ];
          const visibleCount = sheet.getRange("D1");
          visibleCount.formulas = [["=SUBTOTAL(103,A2:A5)"]];
          await context.sync();

          const autoFilter = sheet.autoFilter;
          autoFilter.apply("A1:B5", 1, {
            filterOn: "Custom",
            criterion1: ">50"
          });
          autoFilter.load("criteria");
          visibleCount.load("values");
          await context.sync();
          return { count: visibleCount.values[0][0], criteria: autoFilter.criteria };
        });
        "#,
    )
    .expect("AutoFilter custom threshold should update row visibility");

    assert_eq!(output.value["count"], json!(2));
    assert_eq!(
        output.value["criteria"],
        json!([null, {"filterOn": "Custom", "criterion1": ">50"}])
    );
}

#[test]
fn auto_filter_remove_disables_surface_and_rejects_unsupported_icons() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:B2").values = [["Name", "Status"], ["Alice", "Open"]];
          const autoFilter = sheet.autoFilter;
          autoFilter.apply("A1:B2");
          autoFilter.remove();
          autoFilter.load(["enabled", "isDataFiltered"]);
          await context.sync();
          let unsupported;
          try {
            autoFilter.apply("A1:B2", 1, {
              filterOn: "Icon",
              icon: { set: "ThreeArrows", index: 0 }
            });
            await context.sync();
          } catch (error) {
            unsupported = error.code;
          }
          return { enabled: autoFilter.enabled, isDataFiltered: autoFilter.isDataFiltered, unsupported };
        });
        "#,
    )
    .expect("AutoFilter remove should complete");

    assert_eq!(
        output.value,
        json!({"enabled": false, "isDataFiltered": false, "unsupported": "UnsupportedOperation"})
    );
}

#[test]
fn range_sort_rejects_column_orientation_explicitly() {
    let error = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("A1:B2");
          range.values = [["A", "B"], [1, 2]];
          range.sort.apply([{ key: 0 }], false, false, "Columns");
          await context.sync();
        });
        "#,
    )
    .expect_err("column orientation should be reported as unsupported");

    match error {
        OfficeJsError::Script(message) => {
            assert!(message.contains("UnsupportedOperation"), "{message}");
            assert!(message.contains("Columns"), "{message}");
        }
        other => panic!("expected script error, got {other}"),
    }
}
