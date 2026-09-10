//! Worksheet/Range geometry through the production Office.js runtime.

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js_with_workbook};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn range_navigation_returns_canonical_addresses_for_the_complete_family() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("C4:F8");
          const worksheetCell = sheet.getCell(0, 0);
          const cell = source.getCell(3, 4);
          const row = source.getRow(1);
          const column = source.getColumn(2);
          const lastCell = source.getLastCell();
          const lastRow = source.getLastRow();
          const lastColumn = source.getLastColumn();
          const offset = source.getOffsetRange(1, -1);
          const resized = source.getResizedRange(-1, 2);
          const absolute = source.getAbsoluteResizedRange(3, 2);
          const above = source.getRowsAbove(2);
          const aboveInside = source.getRowsAbove(-2);
          const below = source.getRowsBelow(2);
          const before = source.getColumnsBefore(2);
          const after = source.getColumnsAfter(2);
          const afterInside = source.getColumnsAfter(-2);
          const bounding = source.getBoundingRect("G7:H9");
          const intersection = source.getIntersection("D5:G7");
          const entireRow = source.getEntireRow();
          const entireColumn = source.getEntireColumn();
          [worksheetCell, cell, row, column, lastCell, lastRow, lastColumn,
           offset, resized, absolute, above, aboveInside, below, before, after,
           afterInside, bounding, intersection, entireRow, entireColumn].forEach((range) => range.load("address"));
          await context.sync();
          return [worksheetCell.address, cell.address, row.address, column.address,
            lastCell.address, lastRow.address, lastColumn.address, offset.address,
            resized.address, absolute.address, above.address, aboveInside.address,
            below.address, before.address, after.address, afterInside.address,
            bounding.address, intersection.address, entireRow.address, entireColumn.address];
        });
        "#,
    )
    .expect("range navigation should succeed");

    assert_eq!(
        output.value,
        json!([
            "Sheet1!A1",
            "Sheet1!G7",
            "Sheet1!C5:F5",
            "Sheet1!E4:E8",
            "Sheet1!F8",
            "Sheet1!C8:F8",
            "Sheet1!F4:F8",
            "Sheet1!B5:E9",
            "Sheet1!C4:H7",
            "Sheet1!C4:D6",
            "Sheet1!C2:F3",
            "Sheet1!C4:F5",
            "Sheet1!C9:F10",
            "Sheet1!A4:B8",
            "Sheet1!G4:H8",
            "Sheet1!E4:F8",
            "Sheet1!C4:H9",
            "Sheet1!D5:F7",
            "Sheet1!4:8",
            "Sheet1!C:F",
        ])
    );
}

#[test]
fn worksheet_and_range_navigation_preserve_full_row_and_column_shapes() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const rows = sheet.getRange("4:8");
          const columns = sheet.getRange("C:F");
          const whole = sheet.getRange();
          const rowCell = rows.getCell(2, 16383);
          const rowLast = rows.getLastColumn();
          const rowEntire = rows.getEntireRow();
          const columnCell = columns.getCell(1048575, 1);
          const columnLast = columns.getLastRow();
          const columnEntire = columns.getEntireColumn();
          const wholeRow = whole.getRow(4);
          const wholeColumn = whole.getColumn(2);
          [rowCell, rowLast, rowEntire, columnCell, columnLast, columnEntire,
           wholeRow, wholeColumn].forEach((range) => range.load("address,rowIndex,columnIndex,rowCount,columnCount,cellCount"));
          await context.sync();
          return [
            [rowCell.address, rowCell.rowCount, rowCell.columnCount],
            [rowLast.address, rowLast.rowCount, rowLast.columnCount],
            [rowEntire.address, rowEntire.rowCount, rowEntire.columnCount, rowEntire.cellCount],
            [columnCell.address, columnCell.rowCount, columnCell.columnCount],
            [columnLast.address, columnLast.rowCount, columnLast.columnCount],
            [columnEntire.address, columnEntire.rowCount, columnEntire.columnCount, columnEntire.cellCount],
            [wholeRow.address, wholeRow.rowCount, wholeRow.columnCount],
            [wholeColumn.address, wholeColumn.rowCount, wholeColumn.columnCount],
          ];
        });
        "#,
    )
    .expect("full row and column navigation should succeed");

    assert_eq!(
        output.value,
        json!([
            ["Sheet1!XFD6", 1, 1],
            ["Sheet1!XFD4:XFD8", 5, 1],
            ["Sheet1!4:8", 5, 16384, 81920],
            ["Sheet1!D1048576", 1, 1],
            ["Sheet1!C1048576:F1048576", 1, 4],
            ["Sheet1!C:F", 1048576, 4, 4194304],
            ["Sheet1!5:5", 1, 16384],
            ["Sheet1!C:C", 1048576, 1],
        ])
    );
}

#[test]
fn range_navigation_rejects_invalid_indices_and_grid_overflows_at_sync() {
    let cases = [
        ("getCell(-1, 0)", "getCell"),
        ("getCell(0, 16384)", "getCell"),
        ("getRow(5)", "getRow"),
        ("getColumn(4)", "getColumn"),
        ("getOffsetRange(-4, 0)", "getOffsetRange"),
        ("getResizedRange(-5, 0)", "getResizedRange"),
        ("getAbsoluteResizedRange(0, 1)", "getAbsoluteResizedRange"),
        ("getRowsAbove()", "getRowsAbove"),
        ("getColumnsBefore()", "getColumnsBefore"),
    ];

    for (expression, label) in cases {
        let source = format!(
            r#"
            return await Excel.run(async (context) => {{
              const sheet = context.workbook.worksheets.getItem("Sheet1");
              const range = sheet.getRange("A1:D4");
              const result = range.{expression};
              result.load("address");
              await context.sync();
              return result.address;
            }});
            "#
        );
        let error = run_office_js_with_workbook(&blank_workbook(), &source)
            .expect_err("invalid navigation should reject context.sync");
        match error {
            OfficeJsError::Script(message) => assert!(
                message.contains("InvalidArgument"),
                "{label} returned the wrong error: {message}"
            ),
            other => panic!("{label} returned unexpected error: {other:?}"),
        }
    }
}

#[test]
fn range_navigation_rejects_non_intersecting_ranges_and_cross_grid_cells() {
    let workbook = blank_workbook();
    let non_intersection = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const result = sheet.getRange("A1:B2").getIntersection("D4:E5");
          result.load("address");
          await context.sync();
          return result.address;
        });
        "#,
    )
    .expect_err("non-intersecting ranges should reject");
    match non_intersection {
        OfficeJsError::Script(message) => assert!(
            message.contains("ItemNotFound"),
            "unexpected intersection error: {message}"
        ),
        other => panic!("expected script error, got {other:?}"),
    }

    let overflow = run_office_js_with_workbook(
        &blank_workbook(),
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const result = sheet.getRange("XFD1048576").getCell(1, 0);
          result.load("address");
          await context.sync();
          return result.address;
        });
        "#,
    )
    .expect_err("cell outside the worksheet grid should reject");
    match overflow {
        OfficeJsError::Script(message) => assert!(
            message.contains("InvalidArgument"),
            "unexpected grid overflow error: {message}"
        ),
        other => panic!("expected script error, got {other:?}"),
    }
}
