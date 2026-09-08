//! Office.js Range structural operations through the production host path.

use compute_api::Workbook;
use mog::{run_office_js_with_workbook, OfficeJsError};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn insert_down_preserves_adjacent_cells_formulas_and_formats() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:B3").values = [[10, 100], [20, 200], [30, 300]];
          sheet.getRange("A2").formulas = [["=A1+10"]];
          sheet.getRange("A2").numberFormat = [["0.00"]];
          await context.sync();

          const inserted = sheet.getRange("A2").insert(Excel.InsertShiftDirection.down);
          inserted.values = [[99]];
          inserted.load("address");
          await context.sync();

          const read = sheet.getRange("A1:B4");
          read.load("values,formulas,numberFormat");
          await context.sync();
          return {
            insertedAddress: inserted.address,
            values: read.values,
            formulas: read.formulas,
            numberFormat: read.numberFormat
          };
        });
        "#,
    )
    .expect("insert down should succeed");

    assert_eq!(
        output.value,
        json!({
            "insertedAddress": "Sheet1!A2",
            "values": [[10, 100], [99, 200], [20, 300], [30, ""]],
            "formulas": [[10, 100], [99, 200], ["=A1+10", 300], [30, ""]],
            "numberFormat": [["General", "General"], ["General", "General"], ["0.00", "General"], ["General", "General"]]
        })
    );
}

#[test]
fn insert_right_and_delete_left_keep_other_rows_and_formula_references() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:D2").values = [[1, 2, 3, 4], [10, 20, 30, 40]];
          sheet.getRange("D1").formulas = [["=A1+B1+C1"]];
          await context.sync();

          sheet.getRange("B1").insert(Excel.InsertShiftDirection.right);
          await context.sync();
          const afterInsert = sheet.getRange("A1:E2");
          afterInsert.load("values,formulas");
          await context.sync();

          sheet.getRange("B1").delete(Excel.DeleteShiftDirection.left);
          await context.sync();
          const afterDelete = sheet.getRange("A1:E2");
          afterDelete.load("values,formulas");
          await context.sync();
          return { afterInsert: { values: afterInsert.values, formulas: afterInsert.formulas }, afterDelete: { values: afterDelete.values, formulas: afterDelete.formulas } };
        });
        "#,
    )
    .expect("insert right/delete left should succeed");

    assert_eq!(
        output.value,
        json!({
            "afterInsert": {
                "values": [[1, "", 2, 3, 6], [10, 20, 30, 40, ""]],
                "formulas": [[1, "", 2, 3, "=A1+C1+D1"], [10, 20, 30, 40, ""]]
            },
            "afterDelete": {
                "values": [[1, 2, 3, 6, ""], [10, 20, 30, 40, ""]],
                "formulas": [[1, 2, 3, "=A1+B1+C1", ""], [10, 20, 30, 40, ""]]
            }
        })
    );
}

#[test]
fn delete_up_preserves_adjacent_columns_and_moved_formula_identity() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:B4").values = [[1, 10], [2, 20], [3, 30], [4, 40]];
          sheet.getRange("A3").formulas = [["=A1+10"]];
          await context.sync();

          sheet.getRange("A2").delete(Excel.DeleteShiftDirection.up);
          await context.sync();
          const read = sheet.getRange("A1:B3");
          read.load("values,formulas");
          await context.sync();
          return { values: read.values, formulas: read.formulas };
        });
        "#,
    )
    .expect("delete up should succeed");

    assert_eq!(
        output.value,
        json!({
            "values": [[1, 10], [11, 20], [4, 40]],
            "formulas": [[1, 10], ["=A1+10", 20], [4, 40]]
        })
    );
}

#[test]
fn merge_unmerge_and_merge_across_follow_child_data_loss_semantics() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:C2").values = [["origin", "discarded", "also discarded"], ["row 2", "child", "child"]];
          sheet.getRange("B1").formulas = [["=1+1"]];
          sheet.getRange("D1:D2").values = [["adjacent 1"], ["adjacent 2"]];
          await context.sync();

          sheet.getRange("A1:C2").merge();
          await context.sync();
          const merged = sheet.getRange("A1:D2");
          merged.load("values,formulas");
          await context.sync();

          sheet.getRange("A1:C2").unmerge();
          await context.sync();
          const unmerged = sheet.getRange("A1:D2");
          unmerged.load("values,formulas");
          await context.sync();

          sheet.getRange("A3:C4").values = [["r3", "drop 3", "drop 3"], ["r4", "drop 4", "drop 4"]];
          sheet.getRange("A3:C4").merge(true);
          await context.sync();
          const across = sheet.getRange("A3:D4");
          across.load("values,formulas");
          await context.sync();
          return {
            merged: { values: merged.values, formulas: merged.formulas },
            unmerged: { values: unmerged.values, formulas: unmerged.formulas },
            across: { values: across.values, formulas: across.formulas }
          };
        });
        "#,
    )
    .expect("merge and unmerge should succeed");

    assert_eq!(
        output.value,
        json!({
            "merged": {
                "values": [["origin", "", "", "adjacent 1"], ["", "", "", "adjacent 2"]],
                "formulas": [["origin", "", "", "adjacent 1"], ["", "", "", "adjacent 2"]]
            },
            "unmerged": {
                "values": [["origin", "", "", "adjacent 1"], ["", "", "", "adjacent 2"]],
                "formulas": [["origin", "", "", "adjacent 1"], ["", "", "", "adjacent 2"]]
            },
            "across": {
                "values": [["r3", "", "", ""], ["r4", "", "", ""]],
                "formulas": [["r3", "", "", ""], ["r4", "", "", ""]]
            }
        })
    );
}

#[test]
fn invalid_structural_ranges_and_shift_tokens_fail_without_mutation() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:C1").values = [[1, 2, 3]];
          await context.sync();

          const errors = [];
          for (const action of [
            () => sheet.getRange("B1:A1").insert("Down"),
            () => sheet.getRange("A1").insert("Sideways"),
            () => sheet.getRange("A1").delete("Diagonal"),
            () => sheet.getRange("A1048577").merge()
          ]) {
            try {
              action();
              await context.sync();
            } catch (error) {
              errors.push(error.code);
            }
          }

          const read = sheet.getRange("A1:C1");
          read.load("values");
          await context.sync();
          return { errors, values: read.values };
        });
        "#,
    )
    .expect("invalid structural operations should be catchable");

    assert_eq!(
        output.value,
        json!({ "errors": ["InvalidArgument", "InvalidArgument", "InvalidArgument", "InvalidArgument"], "values": [[1, 2, 3]] })
    );
}

#[test]
fn insert_result_is_a_live_blank_range_at_the_inserted_address() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:C1").values = [[1, 2, 3]];
          await context.sync();

          const inserted = sheet.getRange("B1:C1").insert(Excel.InsertShiftDirection.right);
          inserted.values = [[20, 30]];
          inserted.load("address,values,formulas");
          await context.sync();
          return { address: inserted.address, values: inserted.values, formulas: inserted.formulas };
        });
        "#,
    )
    .expect("insert result should remain a live Range proxy");

    assert_eq!(
        output.value,
        json!({ "address": "Sheet1!B1:C1", "values": [[20, 30]], "formulas": [[20, 30]] })
    );
}

#[test]
fn structural_host_errors_keep_rich_api_error_shape() {
    let workbook = blank_workbook();
    let error = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const range = context.workbook.worksheets.getItem("Sheet1").getRange("B2:A1");
          range.delete("Up");
          await context.sync();
        });
        "#,
    )
    .expect_err("inverted structural range should reject at sync");

    match error {
        OfficeJsError::Script(message) => assert!(
            message.contains("InvalidArgument"),
            "expected Rich API InvalidArgument, got {message}"
        ),
        other => panic!("expected script error, got {other}"),
    }
}

#[test]
fn remove_duplicates_respects_relative_columns_headers_and_adjacent_cells() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:D5").values = [
            ["left", "Name", "Keep", "right 1"],
            ["left", "a", 1, "right 2"],
            ["left", "a", 2, "right 3"],
            ["left", "b", 3, "right 4"],
            ["left", "b", 4, "right 5"]
          ];
          const result = sheet.getRange("B1:C5").removeDuplicates([0], true);
          result.load("removed,uniqueRemaining");
          let beforeSync;
          try {
            result.removed;
          } catch (error) {
            beforeSync = error.code;
          }
          await context.sync();

          const read = sheet.getRange("A1:D5");
          read.load("values");
          await context.sync();
          return {
            beforeSync,
            removed: result.removed,
            uniqueRemaining: result.uniqueRemaining,
            resultJson: result.toJSON(),
            values: read.values
          };
        });
        "#,
    )
    .expect("removeDuplicates should use the selected range and return its deferred result");

    assert_eq!(
        output.value,
        json!({
            "beforeSync": "PropertyNotLoaded",
            "removed": 2,
            "uniqueRemaining": 2,
            "resultJson": {"removed": 2, "uniqueRemaining": 2},
            "values": [
                ["left", "Name", "Keep", "right 1"],
                ["left", "a", 1, "right 2"],
                ["left", "b", 3, "right 3"],
                ["left", "", "", "right 4"],
                ["left", "", "", "right 5"]
            ]
        })
    );
}

#[test]
fn remove_duplicates_rejects_empty_or_out_of_range_column_selection() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:C3").values = [[1, "a", "keep"], [2, "a", "x"], [3, "b", "y"]];
          const errors = [];
          try {
            sheet.getRange("B1:C3").removeDuplicates([], false);
          } catch (error) {
            errors.push(error.code);
          }
          try {
            const invalid = sheet.getRange("B1:C3").removeDuplicates([2], false);
            await context.sync();
          } catch (error) {
            errors.push(error.code);
          }

          const read = sheet.getRange("A1:C3");
          read.load("values");
          await context.sync();
          return { errors, values: read.values };
        });
        "#,
    )
    .expect("invalid removeDuplicates selections should be catchable");

    assert_eq!(
        output.value,
        json!({
            "errors": ["InvalidArgument", "InvalidArgument"],
            "values": [[1, "a", "keep"], [2, "a", "x"], [3, "b", "y"]]
        })
    );
}

#[test]
fn group_and_ungroup_use_row_and_column_outline_ranges_without_touching_cells() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:D5").values = [
            ["r1", "a", 1, "tail 1"],
            ["r2", "b", 2, "tail 2"],
            ["r3", "c", 3, "tail 3"],
            ["r4", "d", 4, "tail 4"],
            ["r5", "e", 5, "tail 5"]
          ];
          sheet.getRange("2:3").group("ByRows");
          sheet.getRange("B:C").group("ByColumns");
          await context.sync();

          sheet.getRange("2:3").ungroup("ByRows");
          sheet.getRange("B:C").ungroup("ByColumns");
          await context.sync();

          const read = sheet.getRange("A1:D5");
          read.load("values");
          await context.sync();
          return read.values;
        });
        "#,
    )
    .expect("row and column grouping should use SheetOutline");

    assert_eq!(
        output.value,
        json!([
            ["r1", "a", 1, "tail 1"],
            ["r2", "b", 2, "tail 2"],
            ["r3", "c", 3, "tail 3"],
            ["r4", "d", 4, "tail 4"],
            ["r5", "e", 5, "tail 5"]
        ])
    );
}

#[test]
fn group_and_ungroup_reject_the_opposite_axis_for_entire_ranges() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:B2").values = [[1, 2], [3, 4]];
          const errors = [];
          for (const action of [
            () => sheet.getRange("1:2").group("ByColumns"),
            () => sheet.getRange("A:B").ungroup("ByRows")
          ]) {
            try {
              action();
              await context.sync();
            } catch (error) {
              errors.push(error.code);
            }
          }
          const read = sheet.getRange("A1:B2");
          read.load("values");
          await context.sync();
          return { errors, values: read.values };
        });
        "#,
    )
    .expect("opposite-axis group operations should be catchable");

    assert_eq!(
        output.value,
        json!({
            "errors": ["InvalidArgument", "InvalidArgument"],
            "values": [[1, 2], [3, 4]]
        })
    );
}
