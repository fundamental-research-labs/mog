//! Office.js format regressions through the shipped QuickJS and compute-api path.

use compute_api::Workbook;
use mog::{run_office_js, run_office_js_with_workbook};
use serde_json::{Value, json};

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn format_font_fill_and_protection_round_trip_all_exposed_fields() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r##"
        return await Excel.run(async context => {
          const range = context.workbook.worksheets.getItem("Sheet1").getRange("A1:B2");
          range.format.set({
            horizontalAlignment: "CenterAcrossSelection",
            verticalAlignment: "Center",
            wrapText: true,
            autoIndent: true,
            indentLevel: 7,
            shrinkToFit: false,
            textOrientation: -45,
            readingOrder: "RightToLeft"
          });
          range.format.font.set({
            bold: true,
            color: "#123456",
            italic: true,
            name: "Arial",
            size: 13.375,
            underline: "DoubleAccountant",
            strikethrough: true,
            subscript: false,
            superscript: true,
            tintAndShade: 0.25
          });
          range.format.fill.set({
            color: "#ABCDEF",
            pattern: "LightDown",
            patternColor: "#102030",
            patternTintAndShade: -0.5,
            tintAndShade: 0.75
          });
          range.format.protection.set({ locked: false, formulaHidden: true });
          const shrinkOnly = context.workbook.worksheets.getItem("Sheet1").getRange("C1");
          shrinkOnly.format.shrinkToFit = true;
          await context.sync();

          const fresh = context.workbook.worksheets.getItem("Sheet1").getRange("A1:B2");
          fresh.format.load({ $all: true });
          fresh.format.font.load({ $all: true });
          fresh.format.fill.load({ $all: true });
          fresh.format.protection.load({ $all: true });
          const freshShrink = context.workbook.worksheets.getItem("Sheet1").getRange("C1");
          freshShrink.format.load("shrinkToFit,wrapText");
          await context.sync();
          return {
            format: fresh.format.toJSON(),
            font: fresh.format.font.toJSON(),
            fill: fresh.format.fill.toJSON(),
            protection: fresh.format.protection.toJSON(),
            shrinkOnly: freshShrink.format.toJSON(),
            types: {
              format: fresh.format instanceof Excel.RangeFormat,
              font: fresh.format.font instanceof Excel.RangeFont,
              fill: fresh.format.fill instanceof Excel.RangeFill,
              protection: fresh.format.protection instanceof Excel.FormatProtection,
              clientObject: fresh.format.font instanceof OfficeExtension.ClientObject
            }
          };
        });
        "##,
    )
    .expect("format write and load should succeed");

    assert_eq!(
        output.value,
        json!({
            "format": {
                "horizontalAlignment": "CenterAcrossSelection",
                "verticalAlignment": "Center",
                "wrapText": true,
                "autoIndent": true,
                "indentLevel": 7,
                "shrinkToFit": false,
                "textOrientation": -45,
                "readingOrder": "RightToLeft",
                "font": {
                    "bold": true,
                    "color": "#123456",
                    "italic": true,
                    "name": "Arial",
                    "size": 13.375,
                    "underline": "DoubleAccountant",
                    "strikethrough": true,
                    "subscript": false,
                    "superscript": true,
                    "tintAndShade": 0.25
                },
                "fill": {
                    "color": "#ABCDEF",
                    "pattern": "LightDown",
                    "patternColor": "#102030",
                    "patternTintAndShade": -0.5,
                    "tintAndShade": 0.75
                },
                "protection": { "locked": false, "formulaHidden": true }
            },
            "font": {
                "bold": true,
                "color": "#123456",
                "italic": true,
                "name": "Arial",
                "size": 13.375,
                "underline": "DoubleAccountant",
                "strikethrough": true,
                "subscript": false,
                "superscript": true,
                "tintAndShade": 0.25
            },
            "fill": {
                "color": "#ABCDEF",
                "pattern": "LightDown",
                "patternColor": "#102030",
                "patternTintAndShade": -0.5,
                "tintAndShade": 0.75
            },
            "protection": { "locked": false, "formulaHidden": true },
            "shrinkOnly": { "shrinkToFit": true, "wrapText": false },
            "types": {
                "format": true,
                "font": true,
                "fill": true,
                "protection": true,
                "clientObject": true
            }
        })
    );

    // Verify the JavaScript adapter reached the real engine representation.
    let sheet = workbook.sheet_by_name("Sheet1").expect("Sheet1");
    let stored = serde_json::to_value(
        sheet
            .formats()
            .get_cell_format(1, 1)
            .expect("effective format at B2"),
    )
    .expect("format serializes");
    assert_eq!(stored["horizontalAlign"], "centerContinuous");
    assert_eq!(stored["verticalAlign"], "middle");
    assert_eq!(stored["underlineType"], "doubleAccounting");
    assert_eq!(stored["patternType"], "lightDown");
    assert_eq!(stored["hidden"], true);
}

#[test]
fn loaded_format_defaults_and_mixed_values_follow_office_contract() {
    let output = run_office_js(
        r##"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const defaults = sheet.getRange("A1");
          defaults.format.load("horizontalAlignment,verticalAlignment,wrapText,autoIndent,indentLevel,shrinkToFit,textOrientation,readingOrder");
          defaults.format.font.load("bold,color,italic,name,size,underline,strikethrough,subscript,superscript,tintAndShade");
          defaults.format.protection.load("locked,formulaHidden");

          sheet.getRange("A2").format.font.bold = true;
          sheet.getRange("A3").format.font.bold = false;
          sheet.getRange("A2").format.wrapText = true;
          sheet.getRange("A3").format.wrapText = false;
          sheet.getRange("A2").format.protection.locked = true;
          sheet.getRange("A3").format.protection.locked = false;
          await context.sync();

          const mixed = sheet.getRange("A2:A3");
          mixed.format.load("wrapText,verticalAlignment");
          mixed.format.font.load("bold,name");
          mixed.format.protection.load("locked,formulaHidden");
          await context.sync();
          return {
            defaults: {
              format: defaults.format.toJSON(),
              font: defaults.format.font.toJSON(),
              protection: defaults.format.protection.toJSON()
            },
            mixed: {
              format: mixed.format.toJSON(),
              font: mixed.format.font.toJSON(),
              protection: mixed.format.protection.toJSON()
            }
          };
        });
        "##,
    )
    .expect("default and mixed format loads should succeed");

    assert_eq!(
        output.value["defaults"],
        json!({
            "format": {
                "horizontalAlignment": "General",
                "verticalAlignment": "Bottom",
                "wrapText": false,
                "autoIndent": false,
                "indentLevel": 0,
                "shrinkToFit": false,
                "textOrientation": 0,
                "readingOrder": "Context",
                "font": {
                    "bold": false,
                    "color": "#000000",
                    "italic": false,
                    "name": "Calibri",
                    "size": 11,
                    "underline": "None",
                    "strikethrough": false,
                    "subscript": false,
                    "superscript": false,
                    "tintAndShade": 0
                },
                "protection": { "locked": true, "formulaHidden": false }
            },
            "font": {
                "bold": false,
                "color": "#000000",
                "italic": false,
                "name": "Calibri",
                "size": 11,
                "underline": "None",
                "strikethrough": false,
                "subscript": false,
                "superscript": false,
                "tintAndShade": 0
            },
            "protection": { "locked": true, "formulaHidden": false }
        })
    );
    assert_eq!(output.value["mixed"]["format"]["wrapText"], Value::Null);
    assert_eq!(
        output.value["mixed"]["format"]["verticalAlignment"],
        "Bottom"
    );
    assert_eq!(output.value["mixed"]["font"]["bold"], Value::Null);
    assert_eq!(output.value["mixed"]["font"]["name"], "Calibri");
    assert_eq!(output.value["mixed"]["protection"]["locked"], Value::Null);
    assert_eq!(output.value["mixed"]["protection"]["formulaHidden"], false);
}

#[test]
fn nested_range_load_routes_to_a_fresh_format_child_proxy() {
    let output = run_office_js(
        r##"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").format.font.bold = true;
          await context.sync();

          const fresh = sheet.getRange("A1");
          fresh.load({ format: { font: { bold: true } } });
          await context.sync();
          return {
            bold: fresh.format.font.bold,
            font: fresh.format.font.toJSON()
          };
        });
        "##,
    )
    .expect("nested format load should reach the fresh font proxy");

    assert_eq!(
        output.value,
        json!({ "bold": true, "font": { "bold": true } })
    );
}

#[test]
fn nested_range_format_set_and_client_object_copy_load_on_fresh_range() {
    let output = run_office_js(
        r##"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1");
          source.format.set({
            horizontalAlignment: "Right",
            font: { bold: true, color: "#123456" },
            fill: { color: "#ABCDEF", pattern: "Solid" },
            protection: { locked: false, formulaHidden: true }
          });
          await context.sync();

          const copied = sheet.getRange("B1");
          copied.format.set(source.format);
          await context.sync();

          const fresh = sheet.getRange("B1");
          fresh.format.load({
            horizontalAlignment: true,
            font: { bold: true, color: true },
            fill: { color: true, pattern: true },
            protection: { locked: true, formulaHidden: true }
          });
          await context.sync();
          return {
            format: fresh.format.toJSON(),
            font: fresh.format.font.toJSON(),
            fill: fresh.format.fill.toJSON(),
            protection: fresh.format.protection.toJSON()
          };
        });
        "##,
    )
    .expect("nested format set and copy should load on a fresh range");

    assert_eq!(
        output.value,
        json!({
            "format": {
                "horizontalAlignment": "Right",
                "font": { "bold": true, "color": "#123456" },
                "fill": { "color": "#ABCDEF", "pattern": "Solid" },
                "protection": { "locked": false, "formulaHidden": true }
            },
            "font": { "bold": true, "color": "#123456" },
            "fill": { "color": "#ABCDEF", "pattern": "Solid" },
            "protection": { "locked": false, "formulaHidden": true }
        })
    );
}

#[test]
fn fill_clear_removes_only_fill_fields() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r##"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const target = sheet.getRange("C4");
          target.values = [[42]];
          target.format.font.bold = true;
          target.format.horizontalAlignment = "Right";
          target.format.protection.locked = false;
          target.format.fill.set({
            color: "#FEDCBA", pattern: "Gray50", patternColor: "#010203",
            patternTintAndShade: 0.2, tintAndShade: -0.2
          });
          await context.sync();
          target.format.fill.clear();
          await context.sync();

          const fresh = sheet.getRange("C4");
          fresh.load("values");
          fresh.format.load("horizontalAlignment");
          fresh.format.font.load("bold");
          fresh.format.fill.load({ $all: true });
          fresh.format.protection.load("locked");
          await context.sync();
          return {
            values: fresh.values,
            alignment: fresh.format.horizontalAlignment,
            bold: fresh.format.font.bold,
            locked: fresh.format.protection.locked,
            fill: fresh.format.fill.toJSON()
          };
        });
        "##,
    )
    .expect("fill-only clear should succeed");

    assert_eq!(output.value["values"], json!([[42]]));
    assert_eq!(output.value["alignment"], "Right");
    assert_eq!(output.value["bold"], true);
    assert_eq!(output.value["locked"], false);
    assert_eq!(
        output.value["fill"],
        json!({
            "color": null,
            "pattern": "None",
            "patternColor": null,
            "patternTintAndShade": 0,
            "tintAndShade": 0
        })
    );

    let sheet = workbook.sheet_by_name("Sheet1").expect("Sheet1");
    let stored = serde_json::to_value(
        sheet
            .formats()
            .get_cell_format(3, 2)
            .expect("effective format at C4"),
    )
    .expect("format serializes");
    assert_eq!(stored["bold"], true);
    assert_eq!(stored["horizontalAlign"], "right");
    assert_eq!(stored["locked"], false);
    assert!(stored.get("backgroundColor").is_none() || stored["backgroundColor"].is_null());
}

#[test]
fn every_supported_fill_pattern_and_alignment_enum_round_trips() {
    let output = run_office_js(
        r##"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const patterns = [
            "None", "Solid", "Gray50", "Gray75", "Gray25", "Horizontal",
            "Vertical", "Down", "Up", "Checker", "SemiGray75",
            "LightHorizontal", "LightVertical", "LightDown", "LightUp", "Grid",
            "CrissCross", "Gray16", "Gray8"
          ];
          const horizontal = [
            "General", "Left", "Center", "Right", "Fill", "Justify",
            "CenterAcrossSelection", "Distributed"
          ];
          const vertical = ["Top", "Center", "Bottom", "Justify", "Distributed"];
          const underline = ["None", "Single", "Double", "SingleAccountant", "DoubleAccountant"];
          for (let i = 0; i < patterns.length; i++) {
            sheet.getRange("A" + (i + 1)).format.fill.pattern = patterns[i];
          }
          for (let i = 0; i < horizontal.length; i++) {
            sheet.getRange("B" + (i + 1)).format.horizontalAlignment = horizontal[i];
          }
          for (let i = 0; i < vertical.length; i++) {
            sheet.getRange("C" + (i + 1)).format.verticalAlignment = vertical[i];
          }
          for (let i = 0; i < underline.length; i++) {
            sheet.getRange("D" + (i + 1)).format.font.underline = underline[i];
          }
          await context.sync();

          const read = async (column, count, child, property) => {
            const values = [];
            const refs = [];
            for (let i = 0; i < count; i++) {
              let ref = sheet.getRange(column + (i + 1)).format;
              if (child) ref = ref[child];
              ref.load(property);
              refs.push(ref);
            }
            await context.sync();
            for (let i = 0; i < refs.length; i++) values.push(refs[i][property]);
            return values;
          };
          return {
            patterns: await read("A", patterns.length, "fill", "pattern"),
            horizontal: await read("B", horizontal.length, null, "horizontalAlignment"),
            vertical: await read("C", vertical.length, null, "verticalAlignment"),
            underline: await read("D", underline.length, "font", "underline")
          };
        });
        "##,
    )
    .expect("all supported enum values should round-trip");

    assert_eq!(
        output.value["patterns"],
        json!([
            "None",
            "Solid",
            "Gray50",
            "Gray75",
            "Gray25",
            "Horizontal",
            "Vertical",
            "Down",
            "Up",
            "Checker",
            "SemiGray75",
            "LightHorizontal",
            "LightVertical",
            "LightDown",
            "LightUp",
            "Grid",
            "CrissCross",
            "Gray16",
            "Gray8"
        ])
    );
    assert_eq!(
        output.value["horizontal"],
        json!([
            "General",
            "Left",
            "Center",
            "Right",
            "Fill",
            "Justify",
            "CenterAcrossSelection",
            "Distributed"
        ])
    );
    assert_eq!(
        output.value["vertical"],
        json!(["Top", "Center", "Bottom", "Justify", "Distributed"])
    );
    assert_eq!(
        output.value["underline"],
        json!([
            "None",
            "Single",
            "Double",
            "SingleAccountant",
            "DoubleAccountant"
        ])
    );
}

#[test]
fn invalid_format_values_fail_at_sync_without_mutating_the_engine() {
    let output = run_office_js(
        r##"
        const attempts = [
          ["indent", range => range.format.indentLevel = 251],
          ["orientation", range => range.format.textOrientation = 91],
          ["font size", range => range.format.font.size = 0],
          ["tint", range => range.format.fill.tintAndShade = 1.1],
          ["gradient", range => range.format.fill.pattern = "LinearGradient"]
        ];
        const codes = [];
        for (const attempt of attempts) {
          try {
            await Excel.run(async context => {
              const range = context.workbook.worksheets.getItem("Sheet1").getRange("A1");
              attempt[1](range);
              await context.sync();
            });
          } catch (error) { codes.push([attempt[0], error.code]); }
        }
        return await Excel.run(async context => {
          const range = context.workbook.worksheets.getItem("Sheet1").getRange("A1");
          range.format.load("indentLevel,textOrientation");
          range.format.font.load("size");
          range.format.fill.load("pattern,tintAndShade");
          await context.sync();
          return { codes, format: range.format.toJSON(), font: range.format.font.toJSON(), fill: range.format.fill.toJSON() };
        });
        "##,
    )
    .expect("script should catch invalid format errors");

    assert_eq!(
        output.value["codes"],
        json!([
            ["indent", "InvalidArgument"],
            ["orientation", "InvalidArgument"],
            ["font size", "InvalidArgument"],
            ["tint", "InvalidArgument"],
            ["gradient", "InvalidArgument"]
        ])
    );
    assert_eq!(
        output.value["format"],
        json!({
            "indentLevel": 0,
            "textOrientation": 0,
            "font": { "size": 11 },
            "fill": { "pattern": "None", "tintAndShade": 0 }
        })
    );
    assert_eq!(output.value["font"], json!({"size": 11}));
    assert_eq!(
        output.value["fill"],
        json!({"pattern": "None", "tintAndShade": 0})
    );
}

#[test]
fn format_set_rejects_unknown_properties_before_queueing_siblings() {
    let output = run_office_js(
        r##"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("A1");
          const errors = [];

          try {
            range.format.set({ horizontalAlignment: "Right", unsupported: true });
          } catch (error) {
            errors.push(["format", error.code]);
          }
          range.format.load("horizontalAlignment");
          await context.sync();

          try {
            range.format.font.set({ bold: true, unsupported: true });
          } catch (error) {
            errors.push(["font", error.code]);
          }
          range.format.font.load("bold");
          await context.sync();

          return {
            errors,
            horizontalAlignment: range.format.horizontalAlignment,
            bold: range.format.font.bold
          };
        });
        "##,
    )
    .expect("unknown format properties should fail before queueing siblings");

    assert_eq!(
        output.value,
        json!({
            "errors": [["format", "InvalidArgument"], ["font", "InvalidArgument"]],
            "horizontalAlignment": "General",
            "bold": false
        })
    );
}
