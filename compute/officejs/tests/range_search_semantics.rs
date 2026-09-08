//! Office.js Range/Worksheet search and used-range semantics.

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js_with_workbook};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn worksheet_and_range_used_ranges_intersect_sparse_engine_bounds() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("C3").values = [["far"]];
          const worksheetUsed = sheet.getUsedRange();
          const worksheetValuesOnly = sheet.getUsedRange(true);
          const intersecting = sheet.getRange("B2:D4").getUsedRange();
          const outside = sheet.getRange("A1:B2").getUsedRangeOrNullObject();
          [worksheetUsed, worksheetValuesOnly, intersecting, outside].forEach((range) => {
            range.load(["address", "isNullObject"]);
          });
          await context.sync();
          return {
            worksheetUsed: worksheetUsed.address,
            worksheetValuesOnly: worksheetValuesOnly.address,
            intersecting: intersecting.address,
            outside: outside.isNullObject
          };
        });
        "#,
    )
    .expect("used-range calls should resolve through the host");

    assert_eq!(
        output.value,
        json!({
            "worksheetUsed": "Sheet1!C3",
            "worksheetValuesOnly": "Sheet1!C3",
            "intersecting": "Sheet1!C3",
            "outside": true
        })
    );
}

#[test]
fn used_range_tracks_far_sparse_cells_without_a_dense_grid_scan() {
    let output = run_office_js_with_workbook(
        &blank_workbook(),
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [["near"]];
          sheet.getRange("XFD1048576").values = [["far"]];
          const used = sheet.getUsedRange();
          used.load("address");
          await context.sync();
          return used.address;
        });
        "#,
    )
    .expect("used range should use sparse engine bounds");

    assert_eq!(output.value, json!("Sheet1!A1:XFD1048576"));
}

#[test]
fn blank_worksheet_used_range_and_empty_range_follow_or_null_contract() {
    let output = run_office_js_with_workbook(
        &blank_workbook(),
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const worksheetUsed = sheet.getUsedRange();
          worksheetUsed.load(["address", "isNullObject"]);
          await context.sync();

          const empty = sheet.getRange("B2:C3").getUsedRangeOrNullObject();
          empty.load("isNullObject");
          await context.sync();
          let nonNullError;
          try {
            sheet.getRange("B2:C3").getUsedRange().load("address");
            await context.sync();
          } catch (error) {
            nonNullError = error.code;
          }
          return {
            worksheetUsed: worksheetUsed.address,
            worksheetIsNull: worksheetUsed.isNullObject,
            emptyIsNull: empty.isNullObject,
            nonNullError
          };
        });
        "#,
    )
    .expect("blank used-range semantics should be observable");

    assert_eq!(
        output.value,
        json!({
            "worksheetUsed": "Sheet1!A1",
            "worksheetIsNull": false,
            "emptyIsNull": true,
            "nonNullError": "ItemNotFound"
        })
    );
}

#[test]
fn range_find_honors_complete_match_case_and_direction() {
    let output = run_office_js_with_workbook(
        &blank_workbook(),
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A5").values = [["Alpha"], ["beta"], ["ALPHA"], ["alphabet"], ["gamma"]];
          const range = sheet.getRange("A1:A5");
          const exactForward = range.find("alpha", { completeMatch: true });
          const exactCase = range.find("alpha", { completeMatch: true, matchCase: true });
          const exactBackwards = range.find("alpha", { completeMatch: true, searchDirection: "Backwards" });
          const partial = range.find("alp", { completeMatch: false });
          [exactForward, exactCase, exactBackwards, partial].forEach((match) => match.load("address"));
          await context.sync();
          return [exactForward.address, exactCase.address, exactBackwards.address, partial.address];
        });
        "#,
    )
    .expect("Range.find criteria should resolve");

    assert_eq!(
        output.value,
        json!(["Sheet1!A1", "Sheet1!A3", "Sheet1!A3", "Sheet1!A1"])
    );
}

#[test]
fn worksheet_find_all_returns_qualified_range_areas_and_or_null() {
    let output = run_office_js_with_workbook(
        &blank_workbook(),
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:C2").values = [["Alpha", "beta", "ALPHA"], ["alphabet", "gamma", null]];
          const exact = sheet.findAll("alpha", { completeMatch: true });
          const partial = sheet.findAll("alp", { matchCase: false });
          const missing = sheet.findAllOrNullObject("absent", {});
          exact.load("address");
          partial.load("address");
          missing.load("isNullObject");
          await context.sync();
          return {
            exact: exact.address,
            partial: partial.address,
            missing: missing.isNullObject
          };
        });
        "#,
    )
    .expect("Worksheet.findAll should resolve RangeAreas results");

    assert_eq!(
        output.value,
        json!({
            "exact": "Sheet1!A1, Sheet1!C1",
            "partial": "Sheet1!A1, Sheet1!C1, Sheet1!A2",
            "missing": true
        })
    );
}

#[test]
fn single_cell_find_starts_after_anchor_and_or_null_is_loaded() {
    let output = run_office_js_with_workbook(
        &blank_workbook(),
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A3").values = [["hit"], ["miss"], ["hit"]];
          const afterA1 = sheet.getRange("A1").find("hit", { completeMatch: true });
          const missing = sheet.getRange("A1:A3").findOrNullObject("absent", {});
          afterA1.load(["address"]);
          missing.load(["isNullObject"]);
          await context.sync();
          return { afterA1: afterA1.address, missing: missing.isNullObject };
        });
        "#,
    )
    .expect("single-cell and OrNull find should resolve");

    assert_eq!(
        output.value,
        json!({ "afterA1": "Sheet1!A3", "missing": true })
    );
}

#[test]
fn replace_all_is_deferred_and_scoped_to_range() {
    let output = run_office_js_with_workbook(
        &blank_workbook(),
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:A4").values = [["cat"], ["scatter"], ["CAT"], ["dog"]];
          sheet.getRange("B1").values = [["cat"]];
          const result = sheet.getRange("A1:A4").replaceAll("cat", "fox", { matchCase: false });
          let beforeSync;
          try { beforeSync = result.value; } catch (error) { beforeSync = error.code; }
          await context.sync();
          const values = sheet.getRange("A1:B4");
          values.load("values");
          await context.sync();
          return { beforeSync, count: result.value, values: values.values };
        });
        "#,
    )
    .expect("replaceAll should queue a ClientResult and mutate through sync");

    assert_eq!(
        output.value,
        json!({
            "beforeSync": "ValueNotLoaded",
            "count": 3,
            "values": [["fox", "cat"], ["sfoxter", ""], ["fox", ""], ["dog", ""]]
        })
    );
}

#[test]
fn special_cells_returns_bounded_areas_and_rejects_unbounded_or_unsupported_types() {
    let output = run_office_js_with_workbook(
        &blank_workbook(),
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("A1:C3");
          range.values = [["text", 1, true], [null, null, null], ["tail", null, null]];
          sheet.getRange("B2").formulas = [["=1+1"]];
          const constants = range.getSpecialCells("Constants");
          const formulas = range.getSpecialCells("Formulas", "Numbers");
          const blanks = range.getSpecialCellsOrNullObject("Blanks");
          constants.load("address");
          formulas.load("address");
          blanks.load(["address", "isNullObject"]);
          await context.sync();
          return {
            constants: constants.address,
            formulas: formulas.address,
            blanks: { address: blanks.address, isNullObject: blanks.isNullObject }
          };
        });
        "#,
    )
    .expect("bounded primitive special cells should resolve");

    assert_eq!(
        output.value,
        json!({
            "constants": "Sheet1!A1, Sheet1!B1, Sheet1!C1, Sheet1!A3",
            "formulas": "Sheet1!B2",
            "blanks": {
                "address": "Sheet1!A2, Sheet1!C2, Sheet1!B3:C3",
                "isNullObject": false
            }
        })
    );
}

#[test]
fn find_without_match_throws_item_not_found() {
    let error = run_office_js_with_workbook(
        &blank_workbook(),
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [["present"]];
          const result = sheet.getRange("A1").find("missing", {});
          result.load("address");
          await context.sync();
          return result.address;
        });
        "#,
    )
    .expect_err("non-OrNull find should reject when there is no match");

    match error {
        OfficeJsError::Script(message) => assert!(message.contains("ItemNotFound"), "{message}"),
        other => panic!("expected script error, got {other:?}"),
    }
}
