//! Office.js members from issues #373–#380 through the shipped runtime.

use compute_api::Workbook;
use mog::run_office_js_with_workbook;

fn blank() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn auto_filter_apply_persists_engine_filter() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          sheet.getRange("A1:B3").values = [
            ["Name", "Value"],
            ["a", 1],
            ["b", 2],
          ];
          sheet.autoFilter.apply(sheet.getRange("A1:B3"));
          await context.sync();
        });
        "#,
    )
    .expect("autoFilter.apply should succeed");
    let sheet = workbook.sheet_by_name("Sheet1").unwrap();
    let filters = sheet.filters().get_all().expect("autofilter query");
    assert!(
        !filters.is_empty(),
        "exported workbook should carry an autofilter"
    );
}

#[test]
fn conditional_format_cell_value_rule_is_stored() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          sheet.getRange("A1:A5").values = [[1], [5], [10], [15], [20]];
          const cf = sheet.getRange("A1:A5").conditionalFormats.add(
            Excel.ConditionalFormatType.cellValue
          );
          cf.cellValue.rule = {
            formula1: "10",
            operator: Excel.ConditionalCellValueOperator.greaterThan,
          };
          cf.cellValue.format.fill.color = "yellow";
          await context.sync();
        });
        "#,
    )
    .expect("conditionalFormats.add should succeed");
    let rules = workbook
        .sheet_by_name("Sheet1")
        .unwrap()
        .conditional_formats()
        .get_all_rules()
        .expect("cf rules");
    assert!(
        !rules.is_empty(),
        "workbook should store a cell-value conditional format"
    );
}

#[test]
fn freeze_rows_persists_pane() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          sheet.getRange("A1:C1").values = [["Name", "Qty", "Price"]];
          sheet.freezePanes.freezeRows(1);
          await context.sync();
        });
        "#,
    )
    .expect("freezePanes.freezeRows should succeed");
    let panes = workbook
        .sheet_by_name("Sheet1")
        .unwrap()
        .layout()
        .get_frozen_panes()
        .expect("frozen panes");
    assert_eq!(panes.rows, 1);
}

#[test]
fn pivot_table_add_writes_destination_cells() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const data = context.workbook.worksheets.getActiveWorksheet();
          data.getRange("A1:C4").values = [
            ["Region", "Product", "Sales"],
            ["East", "A", 10],
            ["West", "A", 20],
            ["East", "B", 30],
          ];
          await context.sync();
          const dest = context.workbook.worksheets.add("Pivot");
          await context.sync();
          const pivot = context.workbook.pivotTables.add(
            "SalesPivot",
            data.getRange("A1:C4"),
            dest.getRange("A1")
          );
          pivot.rowHierarchies.add(pivot.hierarchies.getItem("Region"));
          pivot.dataHierarchies.add(pivot.hierarchies.getItem("Sales"));
          await context.sync();
        });
        "#,
    )
    .expect("pivotTables.add should succeed");
    let pivot = workbook.sheet_by_name("Pivot").unwrap();
    let configs = pivot.pivots().get_all().expect("pivot configs");
    assert!(
        !configs.is_empty(),
        "destination sheet should store a pivot table"
    );
}

#[test]
fn column_width_and_row_height_go_through_layout() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          sheet.getRange("A1").format.columnWidth = 24;
          sheet.getRange("A1").format.rowHeight = 30;
          await context.sync();
        });
        "#,
    )
    .expect("columnWidth/rowHeight should succeed");
    let layout = workbook.sheet_by_name("Sheet1").unwrap().layout();
    let width = layout.get_col_width(0).expect("col width");
    let height = layout.get_row_height(0).expect("row height");
    assert!(width > 0.0, "column width should be stored");
    assert!(
        (height - 40.0).abs() < 0.01,
        "30pt row height should convert to 40px, got {height}"
    );
}

#[test]
fn data_validation_list_rule_is_stored() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          const range = sheet.getRange("A1");
          range.dataValidation.rule = {
            list: { inCellDropDown: true, source: "Yes,No" },
          };
          await context.sync();
        });
        "#,
    )
    .expect("dataValidation.rule should succeed");
    let rules = workbook
        .sheet_by_name("Sheet1")
        .unwrap()
        .validation()
        .get_range_schemas()
        .expect("validation rules");
    assert!(
        !rules.is_empty(),
        "workbook should store list data validation"
    );
}

#[test]
fn range_merge_creates_engine_region() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          sheet.getRange("A1").values = [["merged"]];
          sheet.getRange("A1:B2").merge();
          await context.sync();
        });
        "#,
    )
    .expect("Range.merge should succeed");
    let origin = workbook
        .sheet_by_name("Sheet1")
        .unwrap()
        .structure()
        .is_merge_origin(0, 0)
        .expect("merge origin");
    assert!(origin, "A1 should be a merge origin");
}

#[test]
fn worksheet_tables_add_creates_table() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          sheet.getRange("A1:B3").values = [
            ["Name", "Value"],
            ["a", 1],
            ["b", 2],
          ];
          sheet.tables.add("A1:B3", true);
          await context.sync();
        });
        "#,
    )
    .expect("tables.add should succeed");
    let tables = workbook
        .sheet_by_name("Sheet1")
        .unwrap()
        .tables()
        .get_all()
        .expect("tables");
    assert!(!tables.is_empty(), "workbook should store an Excel table");
}

#[test]
fn get_range_by_indexes_copy_from_and_insert_shift_cells() {
    let workbook = blank();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          sheet.getRangeByIndexes(0, 0, 2, 2).values = [[1, 2], [3, 4]];
          sheet.getRange("C1").copyFrom(sheet.getRange("A1:A2"));
          sheet.getRange("A2:A2").insert(Excel.InsertShiftDirection.down);
          sheet.getRange("A2").values = [[99]];
          const used = sheet.getRange("A1:C3");
          used.load("values");
          await context.sync();
          return used.values;
        });
        "#,
    )
    .expect("range navigation/copy/insert should succeed");
    assert_eq!(
        output.value,
        serde_json::json!([[1, 2, 1], [99, "", ""], [3, 4, 3]])
    );
}

#[test]
fn worksheet_copy_tab_color_and_gridlines_persist() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r##"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          sheet.getRange("A1").values = [["copied"]];
          sheet.tabColor = "#FF0000";
          sheet.showGridlines = false;
          sheet.copy(Excel.WorksheetPositionType.end);
          await context.sync();
        });
        "##,
    )
    .expect("worksheet copy/tabColor/gridlines should succeed");
    let names = workbook.sheet_names().unwrap();
    assert!(names.iter().any(|name| name == "Sheet1 (2)"));
    let meta = workbook
        .sheets()
        .get_sheet_meta(workbook.sheet_by_name("Sheet1").unwrap().id())
        .unwrap()
        .expect("sheet meta");
    assert_eq!(meta.tab_color.as_deref(), Some("#FF0000"));
    let settings = workbook
        .sheets()
        .get_sheet_settings(workbook.sheet_by_name("Sheet1").unwrap().id())
        .unwrap();
    assert!(!settings.show_gridlines);
}

#[test]
fn inside_borders_write_interior_cell_edges() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r##"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          sheet.getRange("A1:B2").values = [[1, 2], [3, 4]];
          const b = sheet.getRange("A1:B2").format.borders;
          b.getItem("InsideHorizontal").style = Excel.BorderLineStyle.continuous;
          b.getItem("InsideVertical").style = Excel.BorderLineStyle.continuous;
          b.getItem("InsideHorizontal").color = "#666666";
          b.getItem("InsideVertical").color = "#666666";
          await context.sync();
        });
        "##,
    )
    .expect("inside borders should succeed");
    let sheet = workbook.sheet_by_name("Sheet1").unwrap();
    let a1 = serde_json::to_value(sheet.formats().get_cell_format(0, 0).unwrap()).unwrap();
    let b2 = serde_json::to_value(sheet.formats().get_cell_format(1, 1).unwrap()).unwrap();
    assert_eq!(a1["borders"]["right"]["style"], "thin");
    assert_eq!(a1["borders"]["bottom"]["style"], "thin");
    assert_eq!(b2["borders"]["left"]["style"], "thin");
    assert_eq!(b2["borders"]["top"]["style"], "thin");
}

#[test]
fn pivot_count_on_text_uses_counta_and_left_aligns_row_labels() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const data = context.workbook.worksheets.getActiveWorksheet();
          data.getRange("A1:B6").values = [
            ["Region", "Product"],
            ["East", "A"],
            ["West", "A"],
            ["East", "B"],
            ["West", "B"],
            ["East", "A"],
          ];
          await context.sync();
          const dest = context.workbook.worksheets.add("Pivot");
          await context.sync();
          const pivot = context.workbook.pivotTables.add(
            "CountPivot",
            data.getRange("A1:B6"),
            dest.getRange("A1")
          );
          pivot.rowHierarchies.add(pivot.hierarchies.getItem("Region"));
          const dh = pivot.dataHierarchies.add(pivot.hierarchies.getItem("Product"));
          dh.summarizeBy = Excel.AggregationFunction.count;
          await context.sync();
        });
        "#,
    )
    .expect("pivot count should succeed");
    let pivot = workbook.sheet_by_name("Pivot").unwrap();
    let values = pivot
        .get_range_values_2d("A1:B4")
        .expect("pivot values");
    assert_eq!(values[0][0].to_string(), "Row Labels");
    assert!(
        values[3][1].to_string() == "5" || values[3][1].to_string() == "5.0",
        "grand total count should be 5, got {:?}",
        values[3][1]
    );
    let label = serde_json::to_value(pivot.formats().get_cell_format(1, 0).unwrap()).unwrap();
    assert_eq!(label["horizontalAlign"], "left");
}

#[test]
fn pivot_column_and_filter_extras_do_not_left_align_header_captions() {
    let workbook = blank();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const data = context.workbook.worksheets.getActiveWorksheet();
          data.getRange("A1:C6").values = [
            ["Region", "Product", "Sales"],
            ["East", "A", 10],
            ["West", "A", 20],
            ["East", "B", 30],
            ["West", "B", 40],
            ["East", "A", 15],
          ];
          await context.sync();
          const dest = context.workbook.worksheets.add("Pivot");
          await context.sync();
          const pivot = context.workbook.pivotTables.add(
            "GridPivot",
            data.getRange("A1:C6"),
            dest.getRange("A1")
          );
          pivot.rowHierarchies.add(pivot.hierarchies.getItem("Region"));
          pivot.columnHierarchies.add(pivot.hierarchies.getItem("Product"));
          pivot.dataHierarchies.add(pivot.hierarchies.getItem("Sales"));
          await context.sync();
        });
        "#,
    )
    .expect("row+column pivot should succeed");
    let pivot = workbook.sheet_by_name("Pivot").unwrap();
    let values = pivot.get_range_values_2d("A1:D5").expect("pivot values");
    assert_eq!(values[0][0].to_string(), "Sum of Sales");
    assert_eq!(values[1][0].to_string(), "Row Labels");
    let header = serde_json::to_value(pivot.formats().get_cell_format(1, 0).unwrap()).unwrap();
    assert_ne!(
        header["horizontalAlign"],
        "left",
        "Row Labels caption must not keep leftover item alignment"
    );
    let item = serde_json::to_value(pivot.formats().get_cell_format(2, 0).unwrap()).unwrap();
    assert_eq!(item["horizontalAlign"], "left");
}
