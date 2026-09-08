//! Named-item regressions through the shipped Office.js runtime.

use mog::{OfficeJsError, run_office_js};
use serde_json::json;

#[test]
fn named_range_add_loads_and_resolves_to_a_real_range() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:B2");
          source.values = [[10, 20], [30, 40]];
          const named = context.workbook.names.add("Sales", source, "source range");
          named.load("name,formula,value,type,scope,visible,comment");
          const count = context.workbook.names.getCount();
          await context.sync();

          const resolved = named.getRange();
          resolved.load("address,values");
          await context.sync();
          return {
            named: named.toJSON(),
            collection: context.workbook.names.toJSON(),
            count: count.value,
            resolved: { address: resolved.address, values: resolved.values },
            types: {
              collection: context.workbook.names instanceof Excel.NamedItemCollection,
              item: named instanceof Excel.NamedItem,
              range: resolved instanceof Excel.Range,
              clientObject: named instanceof OfficeExtension.ClientObject
            }
          };
        });
        "#,
    )
    .expect("named range batch should succeed");

    assert_eq!(
        output.value["named"],
        json!({
            "name": "Sales",
            "formula": "=Sheet1!$A$1:$B$2",
            "value": "Sheet1!A1:B2",
            "type": "Range",
            "scope": "Workbook",
            "visible": true,
            "comment": "source range"
        })
    );
    assert_eq!(output.value["count"], json!(1));
    assert_eq!(
        output.value["resolved"],
        json!({
            "address": "Sheet1!A1:B2",
            "values": [[10, 20], [30, 40]]
        })
    );
    assert_eq!(
        output.value["types"],
        json!({
            "collection": true,
            "item": true,
            "range": true,
            "clientObject": true
        })
    );
}

#[test]
fn named_constants_cover_string_number_and_boolean_references() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const names = context.workbook.names;
          const number = names.add("IntegerValue", "=42");
          const decimal = names.add("DecimalValue", "=1.25");
          const flag = names.add("Enabled", "=TRUE");
          const text = names.add("Label", "=\"hello\"");
          const formula = names.addFormulaLocal("FormulaValue", "=2");
          [number, decimal, flag, text, formula].forEach(item =>
            item.load("name,formula,value,type,scope,visible,comment")
          );
          await context.sync();
          return {
            number: number.toJSON(),
            decimal: decimal.toJSON(),
            flag: flag.toJSON(),
            text: text.toJSON(),
            formula: formula.toJSON()
          };
        });
        "#,
    )
    .expect("named constants batch should succeed");

    assert_eq!(
        output.value,
        json!({
            "number": {
                "name": "IntegerValue",
                "formula": "=42",
                "value": 42,
                "type": "Integer",
                "scope": "Workbook",
                "visible": true,
                "comment": ""
            },
            "decimal": {
                "name": "DecimalValue",
                "formula": "=1.25",
                "value": 1.25,
                "type": "Double",
                "scope": "Workbook",
                "visible": true,
                "comment": ""
            },
            "flag": {
                "name": "Enabled",
                "formula": "=TRUE",
                "value": true,
                "type": "Boolean",
                "scope": "Workbook",
                "visible": true,
                "comment": ""
            },
            "text": {
                "name": "Label",
                "formula": "=\"hello\"",
                "value": "hello",
                "type": "String",
                "scope": "Workbook",
                "visible": true,
                "comment": ""
            },
            "formula": {
                "name": "FormulaValue",
                "formula": "=2",
                "value": 2,
                "type": "Integer",
                "scope": "Workbook",
                "visible": true,
                "comment": ""
            }
        })
    );
}

#[test]
fn named_formula_values_evaluate_cells_names_and_recalculate() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:A2");
          source.values = [[2], [3]];
          const total = context.workbook.names.add(
            "Total",
            "=SUM(Sheet1!$A$1:$A$2)"
          );
          const doubled = context.workbook.names.add("Doubled", "=Total*2");
          total.load("formula,value,type");
          doubled.load("formula,value,type");
          await context.sync();
          const first = { total: total.toJSON(), doubled: doubled.toJSON() };

          doubled.formula = "=Total*3";
          doubled.load("formula,value,type");
          await context.sync();
          const changed = doubled.toJSON();

          source.values = [[5], [6]];
          total.load("value,type");
          doubled.load("value,type");
          await context.sync();
          return { first, changed, second: { total: total.toJSON(), doubled: doubled.toJSON() } };
        });
        "#,
    )
    .expect("named formulas should use the production evaluator");

    assert_eq!(
        output.value,
        json!({
            "first": {
                "total": {
                    "formula": "=SUM(Sheet1!$A$1:$A$2)",
                    "value": 5,
                    "type": "Integer"
                },
                "doubled": {
                    "formula": "=Total*2",
                    "value": 10,
                    "type": "Integer"
                }
            },
            "changed": {
                "formula": "=Total*3",
                "value": 15,
                "type": "Integer"
            },
            "second": {
                "total": { "value": 11, "type": "Integer" },
                "doubled": { "value": 33, "type": "Integer" }
            }
        })
    );
}

#[test]
fn named_item_worksheet_navigation_respects_scope_and_null_object_contract() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const global = context.workbook.names.add("GlobalName", "=42");
          const local = sheet.names.add("LocalName", "=Sheet1!A1");
          await context.sync();

          const owner = local.worksheet;
          owner.load("name");
          const workbookNull = global.worksheetOrNullObject;
          await context.sync();

          let errorCode;
          try {
            const invalid = global.worksheet;
            invalid.load("name");
            await context.sync();
          } catch (error) {
            errorCode = error.code;
          }
          return {
            owner: owner.name,
            workbookNull: workbookNull.isNullObject,
            errorCode
          };
        });
        "#,
    )
    .expect("named item worksheet navigation should honor scope");

    assert_eq!(
        output.value,
        json!({
            "owner": "Sheet1",
            "workbookNull": true,
            "errorCode": "InvalidOperation"
        })
    );
}

#[test]
fn named_item_array_values_reads_real_range_values_and_types() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:B2");
          source.values = [[1, "text"], [2.5, false]];
          const named = context.workbook.names.add("Matrix", source);
          await context.sync();

          const arrays = named.arrayValues;
          arrays.load("values,types");
          await context.sync();
          return { arrays: arrays.toJSON(), named: named.toJSON() };
        });
        "#,
    )
    .expect("named item arrayValues should read a real range");

    assert_eq!(
        output.value,
        json!({
            "arrays": {
                "values": [[1, "text"], [2.5, false]],
                "types": [["Integer", "String"], ["Double", "Boolean"]]
            },
            "named": {
                "arrayValues": {
                    "values": [[1, "text"], [2.5, false]],
                    "types": [["Integer", "String"], ["Double", "Boolean"]]
                }
            }
        })
    );
}

#[test]
fn named_item_array_values_reads_scalar_evaluator_results_and_recalculates() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:A2");
          source.values = [[2], [3]];
          const total = context.workbook.names.add(
            "ScalarTotal",
            "=SUM(Sheet1!$A$1:$A$2)"
          );
          const constant = context.workbook.names.add("ScalarConstant", "=42");
          await context.sync();

          const totalValues = total.arrayValues;
          const constantValues = constant.arrayValues;
          totalValues.load("values,types");
          constantValues.load("values,types");
          await context.sync();
          const initial = {
            total: totalValues.toJSON(),
            constant: constantValues.toJSON()
          };

          source.values = [[5], [6]];
          totalValues.load("values,types");
          await context.sync();
          return { initial, changed: totalValues.toJSON() };
        });
        "#,
    )
    .expect("scalar named formulas should expose 1x1 arrayValues grids");

    assert_eq!(
        output.value,
        json!({
            "initial": {
                "total": { "values": [[5]], "types": [["Integer"]] },
                "constant": { "values": [[42]], "types": [["Integer"]] }
            },
            "changed": { "values": [[11]], "types": [["Integer"]] }
        })
    );
}

#[test]
fn delete_removes_name_and_missing_lookups_follow_office_errors() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const names = context.workbook.names;
          names.add("Temporary", "=Sheet1!A1");
          await context.sync();

          names.getItem("Temporary").delete();
          await context.sync();

          const nullItem = names.getItemOrNullObject("Temporary");
          await context.sync();

          let errorCode;
          try {
            const missing = names.getItem("Temporary");
            missing.load("name");
            await context.sync();
          } catch (error) {
            errorCode = error.code;
          }
          const count = names.getCount();
          await context.sync();
          return { isNullObject: nullItem.isNullObject, errorCode, count: count.value };
        });
        "#,
    )
    .expect("name deletion and missing lookup should be observable");

    assert_eq!(
        output.value,
        json!({ "isNullObject": true, "errorCode": "ItemNotFound", "count": 0 })
    );
}

#[test]
fn named_item_set_updates_comment_and_visibility() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const names = context.workbook.names;
          names.add("Editable", "=Sheet1!A1", "before");
          await context.sync();

          const item = names.getItem("Editable");
          item.comment = "after";
          item.visible = false;
          item.load("comment,visible");
          await context.sync();
          return item.toJSON();
        });
        "#,
    )
    .expect("named item setters should persist through compute-api");

    assert_eq!(
        output.value,
        json!({ "comment": "after", "visible": false })
    );
}

#[test]
fn workbook_and_worksheet_collections_keep_scope_collisions_separate() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const workbookNames = context.workbook.names;
          const sheet = context.workbook.worksheets.add("Data");
          workbookNames.add("Sales", "=Sheet1!A1");
          sheet.names.add("Sales", "=Data!A1", "local");
          await context.sync();

          const global = workbookNames.getItem("sales");
          const local = sheet.names.getItem("SALES");
          global.load("formula,scope,comment");
          local.load("formula,scope,comment");
          const globalCount = workbookNames.getCount();
          const localCount = sheet.names.getCount();
          await context.sync();
          const localCollection = sheet.names;
          localCollection.load("items");
          await context.sync();
          return {
            global: global.toJSON(),
            local: local.toJSON(),
            counts: { global: globalCount.value, local: localCount.value },
            localItems: localCollection.toJSON()
          };
        });
        "#,
    )
    .expect("workbook and worksheet name scopes should coexist");

    assert_eq!(
        output.value,
        json!({
            "global": {
                "formula": "=Sheet1!A1",
                "scope": "Workbook",
                "comment": ""
            },
            "local": {
                "formula": "=Data!A1",
                "scope": "Worksheet",
                "comment": "local"
            },
            "counts": { "global": 1, "local": 1 },
            "localItems": {
                "items": [{
                    "comment": "local",
                    "formula": "=Data!A1",
                    "name": "Sales",
                    "scope": "Worksheet",
                    "type": "Range",
                    "value": "Data!A1",
                    "visible": true
                }]
            }
        })
    );
}

#[test]
fn named_item_cross_context_range_is_rejected_before_sync() {
    let output = run_office_js(
        r#"
        const first = new Excel.RequestContext();
        const second = new Excel.RequestContext();
        const names = first.workbook.names;
        const foreign = second.workbook.worksheets.getItem("Sheet1").getRange("A1");
        let code;
        try { names.add("CrossContext", foreign); }
        catch (error) { code = error.code; }
        const count = names.getCount();
        await first.sync();
        return { code, count: count.value };
        "#,
    )
    .expect("cross-context validation should run in JavaScript");

    assert_eq!(
        output.value,
        json!({ "code": "InvalidRequestContext", "count": 0 })
    );
}

#[test]
fn missing_name_errors_are_rich_api_script_errors() {
    let error = run_office_js(
        r#"
        return await Excel.run(async context => {
          const item = context.workbook.names.getItem("Missing");
          item.load("name");
          await context.sync();
          return item.name;
        });
        "#,
    )
    .expect_err("getItem should fail at sync for missing names");

    match error {
        OfficeJsError::Script(message) => assert!(
            message.contains("ItemNotFound"),
            "unexpected missing-name error: {message}"
        ),
        other => panic!("expected script error, got {other}"),
    }
}
