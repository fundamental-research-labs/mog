//! Office.js RangeFormat layout properties through the production runtime.

use compute_api::Workbook;
use mog::{run_office_js_with_workbook, OfficeJsError};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn dimensions_use_office_point_units_and_mixed_ranges_return_null() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r###"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:B2").format.rowHeight = 18.5;
          sheet.getRange("A1:B2").format.columnWidth = 12.75;
          sheet.getRange("A2:B2").format.rowHeight = 22;
          sheet.getRange("B2:B2").format.columnWidth = 15;
          await context.sync();

          const uniform = sheet.getRange("A1:B1");
          const mixedRows = sheet.getRange("A1:B2");
          const mixedColumns = sheet.getRange("A1:B2");
          uniform.format.load("rowHeight,columnWidth,useStandardHeight,useStandardWidth");
          mixedRows.format.load("rowHeight,useStandardHeight");
          mixedColumns.format.load("columnWidth,useStandardWidth");
          await context.sync();
          return {
            uniform: uniform.format.toJSON(),
            mixedRows: mixedRows.format.toJSON(),
            mixedColumns: mixedColumns.format.toJSON(),
          };
        });
        "###,
    )
    .expect("dimension reads should succeed");

    assert_eq!(
        output.value,
        json!({
            "uniform": {
                "rowHeight": 18.5,
                "columnWidth": 12.75,
                "useStandardHeight": false,
                "useStandardWidth": false,
            },
            "mixedRows": {
                "rowHeight": null,
                "useStandardHeight": null,
            },
            "mixedColumns": {
                "columnWidth": null,
                "useStandardWidth": null,
            },
        })
    );
}

#[test]
fn standard_dimension_setters_reset_custom_values_and_false_is_noop() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r###"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const row = sheet.getRange("4:4");
          const column = sheet.getRange("C:C");
          row.format.rowHeight = 31;
          column.format.columnWidth = 17.25;
          await context.sync();

          row.format.useStandardHeight = false;
          column.format.useStandardWidth = false;
          await context.sync();
          const custom = sheet.getRange("C4");
          custom.format.load("rowHeight,columnWidth");
          await context.sync();

          row.format.useStandardHeight = true;
          column.format.useStandardWidth = true;
          await context.sync();
          const standard = sheet.getRange("C4");
          standard.format.load("rowHeight,columnWidth,useStandardHeight,useStandardWidth");
          await context.sync();
          return { custom: custom.format.toJSON(), standard: standard.format.toJSON() };
        });
        "###,
    )
    .expect("standard dimension setters should succeed");

    let custom = output.value.get("custom").expect("custom dimensions");
    assert_eq!(custom["rowHeight"], json!(31));
    assert_eq!(custom["columnWidth"], json!(17.25));

    let standard = output.value.get("standard").expect("standard dimensions");
    assert_eq!(standard["rowHeight"], json!(15));
    assert_eq!(standard["useStandardHeight"], json!(true));
    assert_eq!(standard["useStandardWidth"], json!(true));
    let standard_width = standard["columnWidth"].as_f64().expect("standard width");
    assert!(standard_width > 0.0);
    assert_ne!(standard_width, 17.25);
}

#[test]
fn autofit_methods_update_real_layout_state_without_width_approximations() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r###"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:B2").values = [
            ["A value long enough to require a wider column", "line one\nline two"] ,
            ["short", "short"]
          ];
          const range = sheet.getRange("A1:B2");
          range.format.wrapText = true;
          range.format.autofitColumns();
          range.format.autofitRows();
          await context.sync();

          const first = sheet.getRange("A1");
          const second = sheet.getRange("B1");
          first.format.load("rowHeight,columnWidth");
          second.format.load("rowHeight,columnWidth");
          await context.sync();
          return { first: first.format.toJSON(), second: second.format.toJSON() };
        });
        "###,
    )
    .expect("autofit should use the production layout primitives");

    for fitted in ["first", "second"] {
        let object = output.value.get(fitted).expect("fitted format object");
        let row_height = object["rowHeight"].as_f64().expect("fitted row height");
        let column_width = object["columnWidth"].as_f64().expect("fitted column width");
        assert!(row_height > 0.0);
        assert!(column_width > 0.0);
    }
}

#[test]
fn full_row_and_column_formats_use_sparse_engine_layers() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r###"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A4:B4").values = [["row", 7]];
          sheet.getRange("4:4").format.font.bold = true;
          sheet.getRange("C:C").format.fill.color = "#123456";
          sheet.getRange("4:4").format.rowHeight = 24;
          sheet.getRange("C:C").format.columnWidth = 14.25;
          await context.sync();

          const rowCells = sheet.getRange("A4:B4");
          const columnCell = sheet.getRange("C1");
          rowCells.format.font.load("bold");
          columnCell.format.fill.load("color");
          rowCells.format.load("rowHeight");
          columnCell.format.load("columnWidth");
          rowCells.load("values");
          await context.sync();
          return {
            values: rowCells.values,
            rowBold: rowCells.format.font.toJSON(),
            rowHeight: rowCells.format.toJSON().rowHeight,
            columnColor: columnCell.format.fill.toJSON().color,
            columnWidth: columnCell.format.toJSON().columnWidth,
          };
        });
        "###,
    )
    .expect("whole row and column formatting should be sparse");

    assert_eq!(
        output.value,
        json!({
            "values": [["row", 7]],
            "rowBold": { "bold": true },
            "rowHeight": 24,
            "columnColor": "#123456",
            "columnWidth": 14.25,
        })
    );
}

#[test]
fn row_dimension_on_an_unbounded_row_axis_is_rejected_without_a_grid_walk() {
    let error = run_office_js_with_workbook(
        &blank_workbook(),
        r###"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A:A").format.rowHeight = 22;
          await context.sync();
          return null;
        });
        "###,
    )
    .expect_err("an entire column cannot be expanded into one million row writes");

    match error {
        OfficeJsError::Script(message) => assert!(message.contains("InvalidArgument"), "{message}"),
        other => panic!("unexpected error: {other:?}"),
    }
}
