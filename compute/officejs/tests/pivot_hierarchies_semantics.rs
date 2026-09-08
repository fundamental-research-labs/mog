//! Office.js PivotTable hierarchy collection contracts.
//!
//! These tests use the public Excel object model all the way through
//! `run_office_js`: collection lookup, descriptor hydration, hierarchy
//! mutation, and a read of the materialized output matrix are all request
//! context operations.

use mog::run_office_js;
use serde_json::json;

#[test]
fn hierarchy_collections_load_current_items_and_compute_matrix() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const source = sheet.getRange("A1:C5");
        source.values = [
          ["Region", "Product", "Amount"],
          ["East", "Pen", 4],
          ["East", "Paper", 9],
          ["West", "Pen", 12],
          ["West", "Paper", 3]
        ];
        const pivot = sheet.pivotTables.add("SalesPivot", source, "E1");
        await context.sync();

        const region = pivot.hierarchies.getItem("Region");
        const product = pivot.hierarchies.getItem("Product");
        const amount = pivot.hierarchies.getItem("Amount");
        pivot.rowHierarchies.add(region);
        pivot.columnHierarchies.add(product);
        const data = pivot.dataHierarchies.add(amount);
        data.numberFormat = "0.00";
        data.summarizeBy = Excel.AggregationFunction.sum;
        await context.sync();

        pivot.hierarchies.load(["count", "items/id", "items/name"]);
        pivot.rowHierarchies.load(["count", "items/id", "items/name", "items/position"]);
        pivot.columnHierarchies.load(["count", "items/id", "items/name", "items/position"]);
        pivot.dataHierarchies.load([
          "count",
          "items/id",
          "items/name",
          "items/position",
          "items/numberFormat",
          "items/summarizeBy"
        ]);
        const allRegion = pivot.hierarchies.getItem("Region");
        allRegion.load(["id", "name"]);
        const dataAgain = pivot.dataHierarchies.getItem("Amount");
        dataAgain.load(["id", "name", "position", "numberFormat", "summarizeBy", "field"]);
        const matrix = sheet.getRange("E1:G4");
        matrix.load("values");
        await context.sync();

        return {
          allCount: pivot.hierarchies.count,
          allNames: pivot.hierarchies.items.map(item => item.name),
          allRegion: { id: allRegion.id, name: allRegion.name },
          rowCount: pivot.rowHierarchies.count,
          columnCount: pivot.columnHierarchies.count,
          dataCount: pivot.dataHierarchies.count,
          data: {
            id: dataAgain.id,
            name: dataAgain.name,
            position: dataAgain.position,
            numberFormat: dataAgain.numberFormat,
            summarizeBy: dataAgain.summarizeBy,
            field: dataAgain.field
          },
          matrix: matrix.values
        };
      });
    "#,
    )
    .expect("pivot hierarchy collection batch should succeed");

    assert_eq!(
        output.value["allNames"],
        json!(["Region", "Product", "Amount"])
    );
    assert_eq!(output.value["allCount"], json!(3));
    assert_eq!(
        output.value["allRegion"],
        json!({"id": "Region", "name": "Region"})
    );
    assert_eq!(output.value["rowCount"], json!(1));
    assert_eq!(output.value["columnCount"], json!(1));
    assert_eq!(output.value["dataCount"], json!(1));
    assert_eq!(output.value["data"]["id"], json!("Amount"));
    assert_eq!(output.value["data"]["numberFormat"], json!("0.00"));
    assert_eq!(output.value["data"]["summarizeBy"], json!("Sum"));
    assert_eq!(
        output.value["data"]["field"],
        json!({"id": "Amount", "name": "Amount"})
    );

    // The matrix read proves that adding the hierarchy collections drives the
    // production pivot engine; metadata alone would allow a value-only stub.
    let matrix = output.value["matrix"].as_array().expect("matrix rows");
    assert!(matrix.iter().flatten().any(|value| value == &json!(13)));
    assert!(matrix.iter().flatten().any(|value| value == &json!(15)));
}

#[test]
fn hierarchy_add_remove_and_fresh_reads_follow_area_state() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const source = sheet.getRange("A1:B4");
        source.values = [
          ["Region", "Amount"],
          ["East", 4],
          ["West", 12],
          ["West", 3]
        ];
        const pivot = sheet.pivotTables.add("MovePivot", source, "D1");
        await context.sync();

        const region = pivot.hierarchies.getItem("Region");
        const amount = pivot.hierarchies.getItem("Amount");
        const row = pivot.rowHierarchies.add(region);
        const data = pivot.dataHierarchies.add(amount);
        await context.sync();

        row.name = "Sales Region";
        row.position = 0;
        data.summarizeBy = Excel.AggregationFunction.average;
        await context.sync();

        pivot.rowHierarchies.remove(row);
        pivot.dataHierarchies.remove(data);
        pivot.columnHierarchies.add(region);
        await context.sync();

        const freshRowCount = pivot.rowHierarchies.getCount();
        const freshColumnCount = pivot.columnHierarchies.getCount();
        const freshDataCount = pivot.dataHierarchies.getCount();
        pivot.columnHierarchies.load(["items/name", "items/position"]);
        await context.sync();
        return {
          freshRowCount: freshRowCount.value,
          freshColumnCount: freshColumnCount.value,
          freshDataCount: freshDataCount.value,
          columns: pivot.columnHierarchies.items.map(item => ({
            name: item.name,
            position: item.position
          }))
        };
      });
    "#,
    )
    .expect("pivot hierarchy movement batch should succeed");

    assert_eq!(
        output.value,
        json!({
            "freshRowCount": 0,
            "freshColumnCount": 1,
            "freshDataCount": 0,
            "columns": [{"name": "Region", "position": 0}]
        })
    );
}

#[test]
fn hierarchy_lookup_and_enum_validation_preserve_office_errors() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B2").values = [["Region", "Amount"], ["East", 4]];
        const pivot = sheet.pivotTables.add("ErrorPivot", sheet.getRange("A1:B2"), "D1");
        await context.sync();

        const missing = pivot.hierarchies.getItemOrNullObject("Missing");
        missing.load("isNullObject");
        let invalidEnum;
        try {
          const amount = pivot.dataHierarchies.add(pivot.hierarchies.getItem("Amount"));
          amount.summarizeBy = "sum";
        } catch (error) { invalidEnum = error.code; }
        let wrongType;
        try { pivot.hierarchies.getItem(1); }
        catch (error) { wrongType = error.code; }
        await context.sync();
        return { missing: missing.isNullObject, invalidEnum, wrongType };
      });
    "#,
    )
    .expect("pivot hierarchy error batch should succeed");

    assert_eq!(
        output.value,
        json!({"missing": true, "invalidEnum": "InvalidArgument", "wrongType": "InvalidArgument"})
    );
}
