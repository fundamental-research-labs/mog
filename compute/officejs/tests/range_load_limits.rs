use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;

#[test]
fn oversized_rectangular_properties_fail_before_allocating_and_allow_recovery() {
    let workbook = Workbook::blank().unwrap().0;
    for property in ["values", "formulas", "numberFormat", "text", "valueTypes"] {
        let error = run_office_js_with_workbook(
            &workbook,
            &format!(
                r#"await Excel.run(async c => {{
                    c.workbook.worksheets.getItem("Sheet1")
                      .getRange("A1:XFD1048576").load("{property}");
                    await c.sync();
                }});"#
            ),
        )
        .unwrap_err();
        assert!(error.to_string().contains("RequestPayloadSizeLimitExceeded"), "{error}");
    }
    let result = run_office_js_with_workbook(
        &workbook,
        r#"return await Excel.run(async c => {
            const r = c.workbook.worksheets.getItem("Sheet1").getRange("A1");
            r.values = [[42]];
            r.load("values");
            await c.sync();
            return r.values;
        });"#,
    ).unwrap();
    assert_eq!(result.value, json!([[42]]));
}

#[test]
fn formatted_used_range_keeps_metadata_but_rejects_dense_load() {
    let workbook = Workbook::blank().unwrap().0;
    let result = run_office_js_with_workbook(
        &workbook,
        r##"return await Excel.run(async c => {
            const s = c.workbook.worksheets.getItem("Sheet1");
            s.getRange("A1").values = [[7]];
            s.getRange("XFD1048576").format.fill.color = "#FFFF00";
            const used = s.getUsedRange();
            used.load("address,cellCount");
            const valuesOnly = s.getUsedRange(true);
            valuesOnly.load("values");
            await c.sync();
            return { address: used.address, cells: used.cellCount, values: valuesOnly.values };
        });"##,
    ).unwrap();
    assert_eq!(result.value, json!({"address": "Sheet1!A1:XFD1048576", "cells": -1, "values": [[7]]}));
    let error = run_office_js_with_workbook(
        &workbook,
        r#"await Excel.run(async c => {
            c.workbook.worksheets.getItem("Sheet1").getUsedRange().load("values");
            await c.sync();
        });"#,
    ).unwrap_err();
    assert!(error.to_string().contains("RequestPayloadSizeLimitExceeded"), "{error}");
}
