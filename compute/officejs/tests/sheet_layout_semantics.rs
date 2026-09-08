//! Worksheet view, freeze-pane, and PageLayout semantics through Office.js.

use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn freeze_panes_preserve_the_other_axis_and_read_from_fresh_proxies() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const worksheets = context.workbook.worksheets;
          const sheet = worksheets.getItem("Sheet1");
          sheet.freezePanes.freezeRows(2);
          sheet.freezePanes.freezeColumns(3);
          await context.sync();

          const both = worksheets.getItem("Sheet1").freezePanes.getLocation();
          both.load("address");
          await context.sync();

          // A zero row count clears only row freezing and retains columns.
          const sameSheet = worksheets.getItem("Sheet1");
          sameSheet.freezePanes.freezeRows(0);
          await context.sync();
          const columns = worksheets.getItem("Sheet1").freezePanes.getLocation();
          columns.load("address");
          await context.sync();

          worksheets.getItem("Sheet1").freezePanes.unfreeze();
          await context.sync();
          const none = worksheets.getItem("Sheet1").freezePanes.getLocationOrNullObject();
          none.load("isNullObject");
          await context.sync();

          return {
            both: both.address,
            columns: columns.address,
            noFrozenPane: none.isNullObject,
          };
        });
        "#,
    )
    .expect("freeze panes should preserve axes and fresh reads");

    assert_eq!(
        output.value,
        json!({
            "both": "Sheet1!A1:C2",
            "columns": "Sheet1!A:C",
            "noFrozenPane": true,
        })
    );
}

#[test]
fn freeze_at_uses_the_selected_range_bottom_and_right_boundaries() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.freezePanes.freezeAt(sheet.getRange("H2:K5"));
          await context.sync();

          const fresh = context.workbook.worksheets.getItem("Sheet1");
          const location = fresh.freezePanes.getLocation();
          location.load("address");
          await context.sync();
          return location.address;
        });
        "#,
    )
    .expect("freezeAt should persist the pane boundary");

    assert_eq!(output.value, json!("Sheet1!A1:K5"));
}

#[test]
fn worksheet_view_properties_round_trip_through_persisted_state() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r##"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.showGridlines = false;
          sheet.showHeadings = false;
          sheet.tabColor = "#4285f4";
          await context.sync();

          const fresh = context.workbook.worksheets.getItem("Sheet1");
          fresh.load(["showGridlines", "showHeadings", "tabColor"]);
          await context.sync();
          return fresh.toJSON();
        });
        "##,
    )
    .expect("worksheet view properties should round-trip");

    assert_eq!(
        output.value,
        json!({
            "showGridlines": false,
            "showHeadings": false,
            "tabColor": "#4285f4",
        })
    );
}

#[test]
fn page_layout_scalars_round_trip_with_office_units_and_enum_tokens() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.pageLayout.set({
            orientation: "Landscape",
            paperSize: "A4",
            printComments: "EndSheet",
            printErrors: "Dash",
            printGridlines: true,
            printHeadings: true,
            centerHorizontally: true,
            centerVertically: true,
            blackAndWhite: true,
            draftMode: true,
            firstPageNumber: 3,
            printOrder: "OverThenDown",
            printQuality: [300, 600],
            topMargin: 72,
            bottomMargin: 36,
            leftMargin: 50.4,
            rightMargin: 72,
            headerMargin: 18,
            footerMargin: 21.6,
            zoom: { scale: 120 },
          });
          await context.sync();

          const fresh = context.workbook.worksheets.getItem("Sheet1").pageLayout;
          fresh.load([
            "orientation", "paperSize", "printComments", "printErrors",
            "printGridlines", "printHeadings", "centerHorizontally",
            "centerVertically", "blackAndWhite", "draftMode", "firstPageNumber",
            "printOrder", "printQuality", "topMargin", "bottomMargin",
            "leftMargin", "rightMargin", "headerMargin", "footerMargin", "zoom",
          ]);
          await context.sync();
          return fresh.toJSON();
        });
        "#,
    )
    .expect("PageLayout scalar fields should round-trip");

    assert_eq!(
        output.value,
        json!({
            "orientation": "Landscape",
            "paperSize": "A4",
            "printComments": "EndSheet",
            "printErrors": "Dash",
            "printGridlines": true,
            "printHeadings": true,
            "centerHorizontally": true,
            "centerVertically": true,
            "blackAndWhite": true,
            "draftMode": true,
            "firstPageNumber": 3,
            "printOrder": "OverThenDown",
            "printQuality": [300, 600],
            "topMargin": 72.0,
            "bottomMargin": 36.0,
            "leftMargin": 50.4,
            "rightMargin": 72.0,
            "headerMargin": 18.0,
            "footerMargin": 21.6,
            "zoom": {
                "horizontalFitToPages": null,
                "scale": 120,
                "verticalFitToPages": null,
            },
        })
    );
}

#[test]
fn page_layout_print_area_titles_and_margins_use_typed_primitives() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const layout = context.workbook.worksheets.getItem("Sheet1").pageLayout;
          layout.setPrintArea("B2:D8");
          layout.setPrintTitleRows("1:2");
          layout.setPrintTitleColumns("A:C");
          layout.setPrintMargins("Inches", { top: 1, left: 0.5 });
          await context.sync();

          const fresh = context.workbook.worksheets.getItem("Sheet1").pageLayout;
          const area = fresh.getPrintArea();
          const rows = fresh.getPrintTitleRows();
          const columns = fresh.getPrintTitleColumns();
          area.load(["address", "areaCount"]);
          rows.load("address");
          columns.load("address");
          await context.sync();

          const settings = context.workbook.worksheets.getItem("Sheet1").pageLayout;
          settings.load(["topMargin", "leftMargin"]);
          await context.sync();
          return {
            area: area.toJSON(),
            rows: rows.address,
            columns: columns.address,
            topMargin: settings.topMargin,
            leftMargin: settings.leftMargin,
          };
        });
        "#,
    )
    .expect("PageLayout print primitives should round-trip");

    assert_eq!(
        output.value,
        json!({
            "area": { "address": "Sheet1!B2:D8", "areaCount": 1 },
            "rows": "Sheet1!1:2",
            "columns": "Sheet1!A:C",
            "topMargin": 72.0,
            "leftMargin": 36.0,
        })
    );
}
