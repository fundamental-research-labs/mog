//! Office.js table row/column collection semantics.
//!
//! These tests deliberately go through `run_office_js`, including collection
//! loading, child binding, and range access.  They are kept separate from the
//! table lifecycle tests so a collection regression cannot hide behind the
//! table proxy's scalar properties.

use mog::run_office_js;
use serde_json::json;

#[test]
fn fresh_collection_load_hydrates_columns_and_data_rows() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B4").values = [
          ["Product", "Amount"],
          ["Pen", 4],
          ["Paper", 9],
          ["Book", 12]
        ];
        const table = sheet.tables.add("A1:B4", true);
        table.name = "Orders";

        const columns = table.columns;
        const rows = table.rows;
        columns.load(["count", "items"]);
        rows.load(["count", "items"]);
        await context.sync();

        const firstColumn = columns.items[0];
        const numericLookup = columns.getItem(firstColumn.id);
        numericLookup.load(["id", "index", "name"]);
        const firstBody = firstColumn.getDataBodyRange();
        firstBody.load(["address", "values"]);
        await context.sync();

        return {
          columnCount: columns.count,
          columns: columns.items.map(column => ({
            id: column.id,
            index: column.index,
            name: column.name,
            values: column.values
          })),
            rowCount: rows.count,
            rows: rows.items.map(row => ({ index: row.index, values: row.values })),
            numericLookup: {
              id: numericLookup.id,
              index: numericLookup.index,
              name: numericLookup.name
            },
            firstBody: { address: firstBody.address, values: firstBody.values },
            types: {
            columns: columns instanceof Excel.TableColumnCollection,
            column: columns.items[0] instanceof Excel.TableColumn,
            rows: rows instanceof Excel.TableRowCollection,
            row: rows.items[0] instanceof Excel.TableRow,
            clientObject: rows.items[0] instanceof OfficeExtension.ClientObject
          }
        };
      });
    "#,
    )
    .expect("collection load should succeed");

    assert_eq!(
        output.value,
        json!({
            "columnCount": 2,
            "columns": [
                {"id": output.value["columns"][0]["id"], "index": 0, "name": "Product", "values": [["Pen"], ["Paper"], ["Book"]]},
                {"id": output.value["columns"][1]["id"], "index": 1, "name": "Amount", "values": [[4], [9], [12]]}
            ],
            "rowCount": 3,
            "rows": [
                {"index": 0, "values": [["Pen", 4]]},
                {"index": 1, "values": [["Paper", 9]]},
                {"index": 2, "values": [["Book", 12]]}
            ],
            "numericLookup": {
                "id": output.value["columns"][0]["id"],
                "index": 0,
                "name": "Product"
            },
            "firstBody": {
                "address": "Sheet1!A2:A4",
                "values": [["Pen"], ["Paper"], ["Book"]]
            },
            "types": {
                "columns": true,
                "column": true,
                "rows": true,
                "row": true,
                "clientObject": true
            }
        })
    );
    assert!(output.value["columns"][0]["id"].as_u64().is_some());
    assert!(output.value["columns"][1]["id"].as_u64().is_some());
    assert_ne!(
        output.value["columns"][0]["id"],
        output.value["columns"][1]["id"]
    );
}

#[test]
fn row_append_middle_insert_delete_preserve_neighbor_order_and_ranges() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:C5").values = [
          ["Product", "Amount", "Side"],
          ["A", 1, "side-1"],
          ["B", 2, "side-2"],
          ["C", 3, "side-3"],
          ["tail", 99, "side-4"]
        ];
        const table = sheet.tables.add("A1:B4", true);
        table.name = "Orders";
        await context.sync();

        table.rows.add(-1, [["D", 4]]);
        await context.sync();
        const afterAppend = table.getDataBodyRange();
        afterAppend.load(["address", "values"]);
        await context.sync();

        table.rows.add(1, [["X", 10]]);
        await context.sync();
        const afterInsert = table.getDataBodyRange();
        const sideAfterInsert = sheet.getRange("C1:C6");
        afterInsert.load(["address", "values"]);
        sideAfterInsert.load("values");
        await context.sync();

        table.rows.getItemAt(1).delete();
        await context.sync();
        const afterDelete = table.getDataBodyRange();
        const sideAfterDelete = sheet.getRange("C1:C6");
        afterDelete.load(["address", "values"]);
        sideAfterDelete.load("values");
        await context.sync();

        return {
          afterAppend: { address: afterAppend.address, values: afterAppend.values },
          afterInsert: { address: afterInsert.address, values: afterInsert.values },
          afterDelete: { address: afterDelete.address, values: afterDelete.values },
          sideAfterInsert: sideAfterInsert.values,
          sideAfterDelete: sideAfterDelete.values
        };
      });
    "#,
    )
    .expect("row collection mutations should succeed");

    assert_eq!(
        output.value["afterAppend"],
        json!({"address": "Sheet1!A2:B5", "values": [["A", 1], ["B", 2], ["C", 3], ["D", 4]]})
    );
    assert_eq!(
        output.value["afterInsert"],
        json!({"address": "Sheet1!A2:B6", "values": [["A", 1], ["X", 10], ["B", 2], ["C", 3], ["D", 4]]})
    );
    assert_eq!(
        output.value["afterDelete"],
        json!({"address": "Sheet1!A2:B5", "values": [["A", 1], ["B", 2], ["C", 3], ["D", 4]]})
    );
    assert_eq!(
        output.value["sideAfterInsert"],
        json!([["Side"], ["side-1"], [""], ["side-2"], ["side-3"], [""]])
    );
    assert_eq!(
        output.value["sideAfterDelete"],
        json!([
            ["Side"],
            ["side-1"],
            ["side-2"],
            ["side-3"],
            [""],
            ["side-4"]
        ])
    );
}

#[test]
fn always_insert_false_uses_blank_space_and_shifts_occupied_neighbors() {
    let empty_below = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:C3").values = [
          ["Product", "Amount", "Side"],
          ["A", 1, "side-1"],
          ["B", 2, "side-2"]
        ];
        const table = sheet.tables.add("A1:B3", true);
        const added = table.rows.add(-1, [["E", 5]], false);
        added.load(["index", "values"]);
        const body = table.getDataBodyRange();
        const below = sheet.getRange("A4:C4");
        body.load(["address", "values"]);
        below.load("values");
        await context.sync();
        return {
          added: { index: added.index, values: added.values },
          body: { address: body.address, values: body.values },
          below: below.values
        };
      });
    "#,
    )
    .expect("alwaysInsert:false should use an empty row below the table");

    assert_eq!(
        empty_below.value,
        json!({
            "added": {"index": 2, "values": [["E", 5]]},
            "body": {"address": "Sheet1!A2:B3", "values": [["A", 1], ["B", 2]]},
            "below": [["E", 5, ""]]
        })
    );

    let occupied_below = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:C4").values = [
          ["Product", "Amount", "Side"],
          ["A", 1, "side-1"],
          ["B", 2, "side-2"],
          ["tail", 99, "side-tail"]
        ];
        const table = sheet.tables.add("A1:B3", true);
        const added = table.rows.add(-1, [["E", 5]], false);
        added.load(["index", "values"]);
        const body = table.getDataBodyRange();
        const neighbors = sheet.getRange("A4:C5");
        body.load(["address", "values"]);
        neighbors.load("values");
        await context.sync();
        return {
          added: { index: added.index, values: added.values },
          body: { address: body.address, values: body.values },
          neighbors: neighbors.values
        };
      });
    "#,
    )
    .expect("alwaysInsert:false should shift occupied rows below the table");

    assert_eq!(
        occupied_below.value,
        json!({
            "added": {"index": 2, "values": [["E", 5]]},
            "body": {"address": "Sheet1!A2:B3", "values": [["A", 1], ["B", 2]]},
            "neighbors": [["E", 5, ""], ["tail", 99, "side-tail"]]
        })
    );
}

#[test]
fn collection_children_reject_unloaded_reads_and_wrong_value_shapes() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B2").values = [["A", "B"], [1, 2]];
        const table = sheet.tables.add("A1:B2", true);
        await context.sync();

        let unloaded;
        try { table.columns.getItemAt(0).name; }
        catch (error) { unloaded = error.code; }

        let wrongShape;
        try {
          table.rows.getItemAt(0).values = [[1]];
          await context.sync();
        } catch (error) { wrongShape = error.code; }

        let missing;
        try {
          table.columns.getItem("Missing");
          await context.sync();
        } catch (error) { missing = error.code; }
        return { unloaded, wrongShape, missing };
      });
    "#,
    )
    .expect("collection error probes should be catchable");

    assert_eq!(
        output.value,
        json!({"unloaded": "PropertyNotLoaded", "wrongShape": "InvalidArgument", "missing": "ItemNotFound"})
    );
}
