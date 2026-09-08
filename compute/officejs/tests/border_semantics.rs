//! OfficeJS RangeBorder regressions through the shipped QuickJS and compute
//! border patch path.

use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::{Value, json};

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn border_edges_interiors_and_diagonals_mutate_real_grid_state() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r##"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("B2:D4");
          range.format.borders.getItem("EdgeTop").set({
            color: "#112233", style: "Continuous", weight: "Thick", tintAndShade: 0.25
          });
          range.format.borders.getItem("EdgeBottom").set({
            color: "#445566", style: "Double", weight: "Thin", tintAndShade: -0.25
          });
          range.format.borders.getItem("EdgeLeft").set({
            color: "#778899", style: "Dash", weight: "Medium"
          });
          range.format.borders.getItem("EdgeRight").set({
            color: "#AABBCC", style: "Dot", weight: "Thin"
          });
          range.format.borders.getItem("InsideVertical").set({
            color: "#010203", style: "DashDot", weight: "Thin"
          });
          range.format.borders.getItem("InsideHorizontal").set({
            color: "#040506", style: "SlantDashDot", weight: "Thin"
          });
          range.format.borders.getItem("DiagonalDown").set({
            color: "#070809", style: "Dot", weight: "Thin"
          });
          range.format.borders.getItem("DiagonalUp").set({
            color: "#070809", style: "Dot", weight: "Thin"
          });
          await context.sync();

          const fresh = sheet.getRange("B2:D4");
          const sides = ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight",
            "InsideVertical", "InsideHorizontal", "DiagonalDown", "DiagonalUp"];
          const loaded = {};
          sides.forEach(side => {
            loaded[side] = fresh.format.borders.getItem(side);
            loaded[side].load({ $all: true });
          });
          await context.sync();
          const result = {};
          sides.forEach(side => { result[side] = loaded[side].toJSON(); });
          return result;
        });
        "##,
    )
    .expect("border writes and fresh reads should succeed");

    assert_eq!(
        output.value,
        json!({
            "EdgeTop": {
                "color": "#112233",
                "sideIndex": "EdgeTop",
                "style": "Continuous",
                "tintAndShade": 0.25,
                "weight": "Thick"
            },
            "EdgeBottom": {
                "color": "#445566",
                "sideIndex": "EdgeBottom",
                "style": "Double",
                "tintAndShade": -0.25,
                "weight": "Thin"
            },
            "EdgeLeft": {
                "color": "#778899",
                "sideIndex": "EdgeLeft",
                "style": "Dash",
                "tintAndShade": 0,
                "weight": "Medium"
            },
            "EdgeRight": {
                "color": "#AABBCC",
                "sideIndex": "EdgeRight",
                "style": "Dot",
                "tintAndShade": 0,
                "weight": "Thin"
            },
            "InsideVertical": {
                "color": "#010203",
                "sideIndex": "InsideVertical",
                "style": "DashDot",
                "tintAndShade": 0,
                "weight": "Thin"
            },
            "InsideHorizontal": {
                "color": "#040506",
                "sideIndex": "InsideHorizontal",
                "style": "SlantDashDot",
                "tintAndShade": 0,
                "weight": "Thin"
            },
            "DiagonalDown": {
                "color": "#070809",
                "sideIndex": "DiagonalDown",
                "style": "Dot",
                "tintAndShade": 0,
                "weight": "Thin"
            },
            "DiagonalUp": {
                "color": "#070809",
                "sideIndex": "DiagonalUp",
                "style": "Dot",
                "tintAndShade": 0,
                "weight": "Thin"
            }
        })
    );

    let sheet = workbook.sheet_by_name("Sheet1").expect("Sheet1");
    let top = serde_json::to_value(
        sheet
            .formats()
            .get_cell_format(1, 1)
            .expect("effective format at B2"),
    )
    .expect("format serializes");
    assert_eq!(top["borders"]["top"]["style"], "thick");
    assert_eq!(top["borders"]["top"]["color"], "#112233");
    assert_eq!(top["borders"]["diagonalDown"], true);
    assert_eq!(top["borders"]["diagonalUp"], true);

    let interior = serde_json::to_value(
        sheet
            .formats()
            .get_cell_format(2, 2)
            .expect("effective format at C3"),
    )
    .expect("format serializes");
    assert_eq!(interior["borders"]["vertical"]["style"], "dashDot");
    assert_eq!(interior["borders"]["horizontal"]["style"], "slantDashDot");
}

#[test]
fn border_collection_has_stable_items_order_and_default_item_properties() {
    let output = mog::run_office_js(
        r##"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const borders = sheet.getRange("A1:C3").format.borders;
          let collectionCode;
          let childCode;
          try { borders.items; } catch (error) { collectionCode = error.code; }
          const top = borders.getItemAt(0);
          try { top.style; } catch (error) { childCode = error.code; }
          // Office's plain `items` load uses each RangeBorder's declared
          // scalar defaults.  An explicit items/<property> path remains a
          // narrow projection.
          borders.load(["count", "items"]);
          await context.sync();
          return {
            collectionCode,
            childCode,
            count: borders.count,
            itemCount: borders.items.length,
            keys: borders.items.map(item => item.sideIndex),
            first: borders.items[0].toJSON(),
            last: borders.getItemAt(7).toJSON(),
            types: {
              collection: borders instanceof Excel.RangeBorderCollection,
              border: top instanceof Excel.RangeBorder,
              clientObject: top instanceof OfficeExtension.ClientObject
            }
          };
        });
        "##,
    )
    .expect("border collection load should succeed");

    assert_eq!(
        output.value,
        json!({
            "collectionCode": "PropertyNotLoaded",
            "childCode": "PropertyNotLoaded",
            "count": 8,
            "itemCount": 8,
            "keys": [
                "EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight",
                "InsideVertical", "InsideHorizontal", "DiagonalDown", "DiagonalUp"
            ],
            "first": {
                "color": null,
                "sideIndex": "EdgeTop",
                "style": "None",
                "tintAndShade": 0,
                "weight": "Thin"
            },
            "last": {
                "color": null,
                "sideIndex": "DiagonalUp",
                "style": "None",
                "tintAndShade": 0,
                "weight": "Thin"
            },
            "types": { "collection": true, "border": true, "clientObject": true }
        })
    );
}

#[test]
fn border_reads_preserve_mixed_values_as_null() {
    let output = mog::run_office_js(
        r##"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").format.borders.getItem("EdgeTop").set({
            color: "#111111", style: "Continuous", weight: "Thin", tintAndShade: 0
          });
          sheet.getRange("B1").format.borders.getItem("EdgeTop").set({
            color: "#222222", style: "Continuous", weight: "Medium", tintAndShade: 0.5
          });
          await context.sync();
          // EdgeTop is the outer top edge of the selected range. Use two
          // cells on that edge so both stored sides participate in the
          // aggregate (A2 would be the bottom edge of A1:A2).
          const mixed = sheet.getRange("A1:B1").format.borders.getItem("EdgeTop");
          mixed.load({ $all: true });
          await context.sync();
          return mixed.toJSON();
        });
        "##,
    )
    .expect("mixed border load should succeed");

    assert_eq!(output.value["sideIndex"], "EdgeTop");
    assert_eq!(output.value["style"], "Continuous");
    assert_eq!(output.value["color"], Value::Null);
    assert_eq!(output.value["tintAndShade"], Value::Null);
    assert_eq!(output.value["weight"], Value::Null);
}

#[test]
fn collection_tint_write_updates_each_side_and_preserves_visual_fields() {
    let output = mog::run_office_js(
        r##"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("A1:B2");
          range.format.borders.getItem("EdgeTop").set({
            color: "#112233", style: "Continuous", weight: "Thick"
          });
          range.format.borders.getItem("EdgeBottom").set({
            color: "#445566", style: "Dash", weight: "Medium"
          });
          await context.sync();

          const borders = range.format.borders;
          borders.tintAndShade = 0.5;
          await context.sync();

          const fresh = sheet.getRange("A1:B2");
          const freshBorders = fresh.format.borders;
          const top = freshBorders.getItem("EdgeTop");
          const bottom = freshBorders.getItem("EdgeBottom");
          top.load({ $all: true });
          bottom.load({ $all: true });
          freshBorders.load("tintAndShade");
          await context.sync();
          return {
            collectionTint: freshBorders.tintAndShade,
            top: top.toJSON(),
            bottom: bottom.toJSON()
          };
        });
        "##,
    )
    .expect("collection tint should apply through the production border path");

    assert_eq!(
        output.value,
        json!({
            "collectionTint": 0.5,
            "top": {
                "color": "#112233",
                "sideIndex": "EdgeTop",
                "style": "Continuous",
                "tintAndShade": 0.5,
                "weight": "Thick"
            },
            "bottom": {
                "color": "#445566",
                "sideIndex": "EdgeBottom",
                "style": "Dash",
                "tintAndShade": 0.5,
                "weight": "Medium"
            }
        })
    );
}
