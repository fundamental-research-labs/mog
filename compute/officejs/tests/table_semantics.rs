use mog::run_office_js;
use serde_json::json;

#[test]
fn table_add_load_rename_and_ranges_use_persistent_engine_state() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B3").values = [
          ["Product", "Amount"],
          ["Pen", 4],
          ["Paper", 9]
        ];
        const table = sheet.tables.add("A1:B3", true);
        table.name = "Orders";
        table.load(["id", "name", "style", "showHeaders", "showTotals"]);
        const all = table.getRange();
        const header = table.getHeaderRowRange();
        const body = table.getDataBodyRange();
        all.load(["address", "values"]);
        header.load(["address", "values"]);
        body.load(["address", "values"]);
        await context.sync();
        return {
          table: table.toJSON(),
          stableId: table.id.indexOf("tbl-") === 0,
          ranges: {
            all: { address: all.address, values: all.values },
            header: { address: header.address, values: header.values },
            body: { address: body.address, values: body.values }
          },
          types: {
            table: table instanceof Excel.Table,
            collection: sheet.tables instanceof Excel.TableCollection,
            clientObject: table instanceof OfficeExtension.ClientObject
          }
        };
      });
    "#,
    )
    .expect("table batch should succeed");

    assert_eq!(output.value["table"]["name"], json!("Orders"));
    assert_eq!(output.value["table"]["style"], json!("TableStyleMedium2"));
    assert_eq!(output.value["table"]["showHeaders"], json!(true));
    assert_eq!(output.value["table"]["showTotals"], json!(false));
    assert_eq!(output.value["stableId"], json!(true));
    assert_eq!(
        output.value["ranges"]["all"]["address"],
        json!("Sheet1!A1:B3")
    );
    assert_eq!(
        output.value["ranges"]["header"]["values"],
        json!([["Product", "Amount"]])
    );
    assert_eq!(
        output.value["ranges"]["body"]["values"],
        json!([["Pen", 4], ["Paper", 9]])
    );
    assert_eq!(
        output.value["types"],
        json!({
            "table": true,
            "collection": true,
            "clientObject": true
        })
    );
}

#[test]
fn range_overload_and_get_item_by_stable_id_survive_rename() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const source = sheet.getRange("C2:D4");
        source.values = [["A", "B"], [1, 2], [3, 4]];
        const created = sheet.tables.add(source, true);
        created.load("id");
        await context.sync();

        const originalId = created.id;
        created.name = "RenamedTable";
        await context.sync();

        const fetched = sheet.tables.getItem(originalId);
        fetched.load(["id", "name"]);
        const body = fetched.getDataBodyRange();
        body.load(["address", "values"]);
        await context.sync();
        return { originalId, fetchedId: fetched.id, name: fetched.name,
          address: body.address, values: body.values };
      });
    "#,
    )
    .expect("stable-id lookup should succeed");

    assert_eq!(output.value["fetchedId"], output.value["originalId"]);
    assert_eq!(output.value["name"], json!("RenamedTable"));
    assert_eq!(output.value["address"], json!("Sheet1!C3:D4"));
    assert_eq!(output.value["values"], json!([[1, 2], [3, 4]]));
}

#[test]
fn table_add_without_source_headers_generates_headers_and_shifts_data() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B2").values = [[1, 2], [3, 4]];
        const table = sheet.tables.add("A1:B2", false);
        table.load("showHeaders");
        const full = table.getRange();
        const header = table.getHeaderRowRange();
        const body = table.getDataBodyRange();
        full.load(["address", "values"]);
        header.load("values");
        body.load("values");
        await context.sync();
        return {
          showHeaders: table.showHeaders,
          address: full.address,
          full: full.values,
          header: header.values,
          body: body.values
        };
      });
    "#,
    )
    .expect("header generation should succeed");

    assert_eq!(
        output.value,
        json!({
            "showHeaders": true,
            "address": "Sheet1!A1:B3",
            "full": [["Column1", "Column2"], [1, 2], [3, 4]],
            "header": [["Column1", "Column2"]],
            "body": [[1, 2], [3, 4]]
        })
    );
}

#[test]
fn rejected_headerless_overlap_does_not_shift_worksheet_data() {
    let output = run_office_js(
        r#"
      await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:C3").values = [
          ["A", "B", "side"],
          [1, 2, "below"],
          ["tailA", "tailB", "tailC"]
        ];
        const existing = sheet.tables.add("A1:B2", true);
        existing.name = "Existing";
        await context.sync();
      });

      let code;
      try {
        await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.tables.add("A1:B2", false);
          await context.sync();
        });
      } catch (error) { code = error.code; }

      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const cells = sheet.getRange("A1:C3");
        const existing = sheet.tables.getItem("Existing");
        const tableRange = existing.getRange();
        cells.load("values");
        tableRange.load("address");
        await context.sync();
        return { code, values: cells.values, tableAddress: tableRange.address };
      });
    "#,
    )
    .expect("overlap rejection should be observable without corrupting data");

    assert_eq!(
        output.value,
        json!({
            "code": "InvalidArgument",
            "values": [
                ["A", "B", "side"],
                [1, 2, "below"],
                ["tailA", "tailB", "tailC"]
            ],
            "tableAddress": "Sheet1!A1:B2"
        })
    );
}

#[test]
fn table_scalar_setters_persist_for_fresh_proxies() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B2").values = [["A", "B"], [1, 2]];
        const created = sheet.tables.add("A1:B2", true);
        created.name = "Styled";
        created.style = "TableStyleLight1";
        created.showHeaders = false;
        created.showTotals = true;
        await context.sync();

        const fetched = sheet.tables.getItem("Styled");
        fetched.load(["name", "style", "showHeaders", "showTotals"]);
        await context.sync();
        return fetched.toJSON();
      });
    "#,
    )
    .expect("table setters should persist");

    assert_eq!(
        output.value,
        json!({
            "name": "Styled",
            "style": "TableStyleLight1",
            "showHeaders": false,
            "showTotals": true
        })
    );
}

#[test]
fn table_style_flags_load_from_engine_metadata_and_serialize() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B2").values = [["A", "B"], [1, 2]];
        const table = sheet.tables.add("A1:B2", true);
        table.load([
          "highlightFirstColumn",
          "highlightLastColumn",
          "showBandedRows",
          "showBandedColumns",
          "showFilterButton"
        ]);
        await context.sync();
        return table.toJSON();
      });
    "#,
    )
    .expect("table style flags should load");

    assert_eq!(
        output.value,
        json!({
            "highlightFirstColumn": false,
            "highlightLastColumn": false,
            "showBandedRows": true,
            "showBandedColumns": false,
            "showFilterButton": true
        })
    );
}

#[test]
fn table_style_flags_set_allowlist_round_trips_through_engine() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B2").values = [["A", "B"], [1, 2]];
        const table = sheet.tables.add("A1:B2", true);
        table.name = "Styled";
        await context.sync();

        table.set({
          highlightFirstColumn: true,
          highlightLastColumn: true,
          showBandedRows: false,
          showBandedColumns: true,
          showFilterButton: false
        });
        await context.sync();

        const fresh = sheet.tables.getItem("Styled");
        fresh.load([
          "highlightFirstColumn",
          "highlightLastColumn",
          "showBandedRows",
          "showBandedColumns",
          "showFilterButton"
        ]);
        await context.sync();
        return fresh.toJSON();
      });
    "#,
    )
    .expect("table style flags should persist");

    assert_eq!(
        output.value,
        json!({
            "highlightFirstColumn": true,
            "highlightLastColumn": true,
            "showBandedRows": false,
            "showBandedColumns": true,
            "showFilterButton": false
        })
    );
}

#[test]
fn table_filter_button_set_requires_a_header_row() {
    let output = run_office_js(
        r#"
      let code;
      await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B2").values = [["A", "B"], [1, 2]];
        const table = sheet.tables.add("A1:B2", true);
        await context.sync();

        table.showHeaders = false;
        await context.sync();
        try {
          table.showFilterButton = false;
          await context.sync();
        } catch (error) { code = error.code; }
      });
      return code;
    "#,
    )
    .expect("filter button header validation should be observable");

    assert_eq!(output.value, json!("InvalidArgument"));
}

#[test]
fn table_get_item_reports_office_item_not_found() {
    let output = run_office_js(
        r#"
      let code;
      try {
        await Excel.run(async context => {
          context.workbook.worksheets.getItem("Sheet1").tables.getItem("Missing");
          await context.sync();
        });
      } catch (error) { code = error.code; }
      return code;
    "#,
    )
    .expect("script should catch lookup rejection");

    assert_eq!(output.value, json!("ItemNotFound"));
}

#[test]
fn table_add_rejects_a_range_from_another_request_context() {
    let output = run_office_js(
        r#"
      const first = new Excel.RequestContext();
      const second = new Excel.RequestContext();
      const sheet = first.workbook.worksheets.getItem("Sheet1");
      const foreign = second.workbook.worksheets.getItem("Sheet1").getRange("A1:B2");
      let code;
      try { sheet.tables.add(foreign, true); }
      catch (error) { code = error.code; }
      const source = sheet.getRange("A1:B2");
      source.values = [["kept", 1], ["data", 2]];
      await first.sync();
      const cells = sheet.getRange("A1:B2");
      const tables = sheet.tables;
      cells.load("values");
      tables.load("count");
      await first.sync();
      return {
        code,
        values: cells.values,
        tableCount: tables.count,
        api: {
          collection: tables instanceof Excel.TableCollection,
          clientObject: tables instanceof OfficeExtension.ClientObject
        }
      };
    "#,
    )
    .expect("script should catch the cross-context error");

    assert_eq!(
        output.value,
        json!({
            "code": "InvalidRequestContext",
            "values": [["kept", 1], ["data", 2]],
            "tableCount": 0,
            "api": {"collection": true, "clientObject": true}
        })
    );
}

#[test]
fn workbook_and_worksheet_table_collections_hydrate_items_and_counts() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B2").values = [["A", "B"], [1, 2]];
        sheet.getRange("D1:E2").values = [["C", "D"], [3, 4]];
        sheet.tables.add("A1:B2", true).name = "First";
        sheet.tables.add("D1:E2", true).name = "Second";
        await context.sync();

        const workbookTables = context.workbook.tables;
        const worksheetTables = sheet.tables;
        workbookTables.load(["count", "items/id", "items/name"]);
        worksheetTables.load(["count", "items/name"]);
        const workbookCount = workbookTables.getCount();
        const worksheetCount = worksheetTables.getCount();
        const second = workbookTables.getItemAt(1);
        second.load(["id", "name"]);
        const missing = worksheetTables.getItemOrNullObject("Missing");
        missing.load("isNullObject");
        await context.sync();
        return {
          workbookCount: workbookCount.value,
          worksheetCount: worksheetCount.value,
          workbookItems: workbookTables.items.map(table => ({
            type: table instanceof Excel.Table,
            id: table.id,
            name: table.name
          })),
          worksheetItems: worksheetTables.items.map(table => table.name),
          second: second.toJSON(),
          missing: missing.isNullObject,
          collectionTypes: {
            workbook: workbookTables instanceof Excel.TableCollection,
            worksheet: worksheetTables instanceof Excel.TableCollection
          }
        };
      });
    "#,
    )
    .expect("workbook and worksheet table collections should succeed");

    assert_eq!(output.value["workbookCount"], json!(2));
    assert_eq!(output.value["worksheetCount"], json!(2));
    assert_eq!(
        output.value["workbookItems"]
            .as_array()
            .expect("workbook items")
            .iter()
            .map(|item| item["name"].clone())
            .collect::<Vec<_>>(),
        vec![json!("First"), json!("Second")]
    );
    assert!(output.value["workbookItems"]
        .as_array()
        .expect("workbook items")
        .iter()
        .all(|item| item["type"] == json!(true)));
    assert_eq!(output.value["worksheetItems"], json!(["First", "Second"]));
    assert_eq!(output.value["second"]["name"], json!("Second"));
    assert_eq!(output.value["missing"], json!(true));
    assert_eq!(
        output.value["collectionTypes"],
        json!({"workbook": true, "worksheet": true})
    );
}

#[test]
fn workbook_table_add_uses_active_sheet_for_unqualified_and_address_sheet_for_qualified() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const first = context.workbook.worksheets.getItem("Sheet1");
        const second = context.workbook.worksheets.add("Second Sheet");
        second.getRange("A1:B2").values = [["C", "D"], [3, 4]];
        second.activate();
        first.activate();
        await context.sync();

        const tables = context.workbook.tables;
        const unqualified = tables.add("A1:B2", true);
        unqualified.name = "ActiveTable";
        const qualified = tables.add("'Second Sheet'!A1:B2", true);
        qualified.name = "QualifiedTable";
        await context.sync();

        const firstRange = first.getRange("A1:B2");
        const secondRange = second.getRange("A1:B2");
        const firstTable = first.tables.getItem("ActiveTable");
        const secondTable = second.tables.getItem("QualifiedTable");
        firstRange.load("values");
        secondRange.load("values");
        firstTable.load("id");
        secondTable.load("id");
        await context.sync();
        return {
          first: { values: firstRange.values, table: firstTable.id },
          second: { values: secondRange.values, table: secondTable.id },
          types: {
            workbook: tables instanceof Excel.TableCollection,
            first: first.tables instanceof Excel.TableCollection,
            second: second.tables instanceof Excel.TableCollection
          }
        };
      });
    "#,
    )
    .expect("workbook table address scoping should succeed");

    assert_eq!(output.value["first"]["values"], json!([["", ""], ["", ""]]));
    assert_eq!(
        output.value["second"]["values"],
        json!([["C", "D"], [3, 4]])
    );
    assert!(output.value["first"]["table"]
        .as_str()
        .is_some_and(|id| id.starts_with("tbl-")));
    assert!(output.value["second"]["table"]
        .as_str()
        .is_some_and(|id| id.starts_with("tbl-")));
    assert_eq!(
        output.value["types"],
        json!({"workbook": true, "first": true, "second": true})
    );
}

#[test]
fn table_delete_preserves_cells_and_removes_fresh_lookup() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B3").values = [["A", "B"], [1, 2], [3, 4]];
        const table = sheet.tables.add("A1:B3", true);
        table.name = "Orders";
        await context.sync();

        table.delete();
        await context.sync();

        const cells = sheet.getRange("A1:B3");
        const missing = sheet.tables.getItemOrNullObject("Orders");
        cells.load("values");
        missing.load("isNullObject");
        await context.sync();
        return { cells: cells.values, missing: missing.isNullObject };
      });
    "#,
    )
    .expect("table delete should preserve values");

    assert_eq!(
        output.value,
        json!({
            "cells": [["A", "B"], [1, 2], [3, 4]],
            "missing": true
        })
    );
}

#[test]
fn table_convert_to_range_returns_preserved_range_and_total_row_range() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B3").values = [["A", "B"], [1, 2], [3, 4]];
        const table = sheet.tables.add("A1:B3", true);
        table.name = "Orders";
        table.showTotals = true;
        const totals = table.getTotalRowRange();
        totals.load("address");
        await context.sync();

        const converted = table.convertToRange();
        converted.load(["address", "values"]);
        const missing = sheet.tables.getItemOrNullObject("Orders");
        missing.load("isNullObject");
        await context.sync();
        return {
          totals: totals.address,
          converted: { address: converted.address, values: converted.values },
          missing: missing.isNullObject
        };
      });
    "#,
    )
    .expect("table conversion should preserve the full range");

    assert_eq!(
        output.value,
        json!({
            "totals": "Sheet1!A4:B4",
            "converted": {
                "address": "Sheet1!A1:B4",
                "values": [["A", "B"], [1, 2], [3, 4], ["", ""]]
            },
            "missing": true
        })
    );
}

#[test]
fn table_resize_supports_range_and_string_overloads() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:C4").values = [
          ["A", "B", "C"],
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9]
        ];
        const table = sheet.tables.add("A1:B3", true);
        table.name = "Orders";
        table.resize("A1:C4");
        await context.sync();

        const range = sheet.getRange("A1:C5");
        table.resize(range);
        const full = table.getRange();
        full.load(["address", "values"]);
        await context.sync();
        return { address: full.address, values: full.values };
      });
    "#,
    )
    .expect("table resize overloads should succeed");

    assert_eq!(
        output.value,
        json!({
            "address": "Sheet1!A1:C5",
            "values": [
                ["A", "B", "C"],
                [1, 2, 3],
                [4, 5, 6],
                [7, 8, 9],
                ["", "", ""]
            ]
        })
    );
}
