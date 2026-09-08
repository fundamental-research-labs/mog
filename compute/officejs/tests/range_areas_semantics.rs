//! Office.js RangeAreas and RangeCollection behavior through the shipped
//! production runtime.

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js_with_workbook};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn get_ranges_loads_discontiguous_metadata_and_range_items() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:B2").values = [[1, 2], [3, 4]];
          sheet.getRange("D1:D2").values = [[5], [6]];

          const areas = sheet.getRanges("A1:B2; D1:D2");
          areas.load("address,areaCount,cellCount,isEntireRow,isEntireColumn");
          const count = areas.areas.getCount();
          areas.areas.load(
            "items/address,items/rowIndex,items/columnIndex,items/rowCount,items/columnCount,items/cellCount,items/values"
          );
          await context.sync();

          return {
            metadata: {
              address: areas.address,
              areaCount: areas.areaCount,
              cellCount: areas.cellCount,
              isEntireRow: areas.isEntireRow,
              isEntireColumn: areas.isEntireColumn
            },
            count: count.value,
            items: areas.areas.items.map((range) => ({
              address: range.address,
              rowIndex: range.rowIndex,
              columnIndex: range.columnIndex,
              rowCount: range.rowCount,
              columnCount: range.columnCount,
              cellCount: range.cellCount,
              values: range.values
            }))
          };
        });
        "#,
    )
    .expect("RangeAreas metadata and collection items should load");

    assert_eq!(
        output.value,
        json!({
            "metadata": {
                "address": "Sheet1!A1:B2, Sheet1!D1:D2",
                "areaCount": 2,
                "cellCount": 6,
                "isEntireRow": false,
                "isEntireColumn": false
            },
            "count": 2,
            "items": [
                {
                    "address": "Sheet1!A1:B2",
                    "rowIndex": 0,
                    "columnIndex": 0,
                    "rowCount": 2,
                    "columnCount": 2,
                    "cellCount": 4,
                    "values": [[1, 2], [3, 4]]
                },
                {
                    "address": "Sheet1!D1:D2",
                    "rowIndex": 0,
                    "columnIndex": 3,
                    "rowCount": 2,
                    "columnCount": 1,
                    "cellCount": 2,
                    "values": [[5], [6]]
                }
            ]
        })
    );
}

#[test]
fn range_collection_get_item_at_returns_a_real_range_proxy() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("B2:C2").values = [[10, 20]];
          const collection = sheet.getRanges("A1:A1,B2:C2").areas;
          const count = collection.getCount();
          const second = collection.getItemAt(1);
          second.load("address,values");
          await context.sync();
          return {
            count: count.value,
            isRange: second instanceof Excel.Range,
            address: second.address,
            values: second.values
          };
        });
        "#,
    )
    .expect("RangeCollection.getItemAt should return a Range");

    assert_eq!(
        output.value,
        json!({
            "count": 2,
            "isRange": true,
            "address": "Sheet1!B2:C2",
            "values": [[10, 20]]
        })
    );
}

#[test]
fn bounded_range_areas_clear_each_area_without_touching_other_cells() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:B1").values = [[1, 2]];
          sheet.getRange("D1:E1").values = [[3, 4]];
          sheet.getRange("C1").values = [[99]];
          const areas = sheet.getRanges("A1:B1,D1:E1");
          areas.clear("Contents");
          await context.sync();

          const fresh = sheet.getRange("A1:E1");
          fresh.load("values");
          await context.sync();
          return fresh.values;
        });
        "#,
    )
    .expect("RangeAreas.clear should clear every bounded area");

    assert_eq!(output.value, json!([["", "", 99, "", ""]]));
}

#[test]
fn range_areas_intersection_or_null_preserves_intersection_areas() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRanges("A1:B2,C1:C2");
          const hit = source.getIntersectionOrNullObject("B2:C3");
          const miss = source.getIntersectionOrNullObject("E1:E3");
          hit.load("address,areaCount,cellCount");
          miss.load("isNullObject");
          await context.sync();
          return {
            hit: {
              address: hit.address,
              areaCount: hit.areaCount,
              cellCount: hit.cellCount
            },
            miss: miss.isNullObject
          };
        });
        "#,
    )
    .expect("RangeAreas intersection should support null objects");

    assert_eq!(
        output.value,
        json!({
            "hit": {
                "address": "Sheet1!B2, Sheet1!C1:C2",
                "areaCount": 2,
                "cellCount": 3
            },
            "miss": true
        })
    );
}

#[test]
fn omitted_range_areas_address_keeps_whole_sheet_bounded_by_metadata_only() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const areas = context.workbook.worksheets.getItem("Sheet1").getRanges();
          areas.load("address,areaCount,cellCount");
          await context.sync();
          return {
            address: areas.address,
            areaCount: areas.areaCount,
            cellCount: areas.cellCount
          };
        });
        "#,
    )
    .expect("omitted RangeAreas address should load metadata");

    assert_eq!(
        output.value,
        json!({
            "address": "Sheet1!1:1048576",
            "areaCount": 1,
            "cellCount": -1
        })
    );
}

#[test]
fn malformed_range_areas_address_fails_at_sync() {
    let workbook = blank_workbook();
    let error = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const areas = context.workbook.worksheets.getItem("Sheet1").getRanges("A1,,B1");
          areas.load("address");
          await context.sync();
        });
        "#,
    )
    .expect_err("malformed RangeAreas address must fail");

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
