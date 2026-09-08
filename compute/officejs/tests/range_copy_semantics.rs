//! Office.js Range copy/move contract tests through the production runtime.

use compute_api::Workbook;
use mog::{run_office_js_with_workbook, OfficeJsError};
use serde_json::json;

fn blank_workbook() -> Workbook {
    Workbook::blank().expect("blank workbook").0
}

#[test]
fn copy_from_all_rebases_formulas_and_copies_persistent_formats() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:B2");
          source.formulas = [["=10", "=A1+5"], ["=20", "=A2+5"]];
          source.numberFormat = [["0.00", "0"], ["0", "0"]];
          source.format.font.bold = true;
          await context.sync();

          const destination = sheet.getRange("D3:E4");
          destination.copyFrom(source, "All");
          await context.sync();

          const fresh = sheet.getRange("D3:E4");
          fresh.load("values,formulas,numberFormat");
          fresh.format.font.load("bold");
          const sourceFresh = sheet.getRange("A1:B2");
          sourceFresh.load("formulas");
          await context.sync();
          return {
            values: fresh.values,
            formulas: fresh.formulas,
            numberFormat: fresh.numberFormat,
            bold: fresh.format.font.bold,
            sourceFormulas: sourceFresh.formulas
          };
        });
        "#,
    )
    .expect("copyFrom All should preserve formulas and formats");

    assert_eq!(
        output.value,
        json!({
            "values": [[10, 15], [20, 25]],
            "formulas": [["=10", "=D3+5"], ["=20", "=D4+5"]],
            "numberFormat": [["0.00", "0"], ["0", "0"]],
            "bold": true,
            "sourceFormulas": [["=10", "=A1+5"], ["=20", "=A2+5"]]
        })
    );
}

#[test]
fn copy_from_values_drops_formulas_and_skip_blanks_preserves_targets_when_transposed() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:B2");
          source.formulas = [["=1", ""], ["=3", "=4"]];

          const destination = sheet.getRange("D1:E2");
          destination.values = [[9, 8], [7, 6]];
          await context.sync();

          destination.copyFrom(source, "Values", true, true);
          await context.sync();

          const fresh = sheet.getRange("D1:E2");
          fresh.load("values,formulas");
          await context.sync();
          return { values: fresh.values, formulas: fresh.formulas };
        });
        "#,
    )
    .expect("values copy with transpose and skipBlanks should succeed");

    assert_eq!(
        output.value,
        json!({
            "values": [[1, 3], [7, 4]],
            "formulas": [[1, 3], [7, 4]]
        })
    );
}

#[test]
fn copy_from_expands_a_small_destination_and_repeats_exact_multiples() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:B2");
          source.values = [[1, 2], [3, 4]];
          await context.sync();

          // A one-cell destination expands to the source's 2x2 shape.
          sheet.getRange("D1").copyFrom(source, "Values");
          // A 2x4 destination receives two exact source tiles.
          sheet.getRange("G1:J2").copyFrom(source, "Values");
          await context.sync();

          const expanded = sheet.getRange("D1:E2");
          const repeated = sheet.getRange("G1:J2");
          expanded.load("values");
          repeated.load("values");
          await context.sync();
          return { expanded: expanded.values, repeated: repeated.values };
        });
        "#,
    )
    .expect("copyFrom should expand and repeat source shape");

    assert_eq!(
        output.value,
        json!({
            "expanded": [[1, 2], [3, 4]],
            "repeated": [[1, 2, 1, 2], [3, 4, 3, 4]]
        })
    );
}

#[test]
fn copy_from_repeated_formula_tiles_rebase_each_tile_and_leave_source_unchanged() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:B1");
          source.formulas = [["=10", "=A1+5"]];
          await context.sync();

          // A 1x4 destination is an exact two-tile multiple of the 1x2
          // source. Each formula must be rebased from its own tile origin.
          sheet.getRange("D1:G1").copyFrom(source, "All");
          await context.sync();

          const repeated = sheet.getRange("D1:G1");
          const sourceFresh = sheet.getRange("A1:B1");
          repeated.load("values,formulas");
          sourceFresh.load("values,formulas");
          await context.sync();
          return {
            values: repeated.values,
            formulas: repeated.formulas,
            sourceValues: sourceFresh.values,
            sourceFormulas: sourceFresh.formulas
          };
        });
        "#,
    )
    .expect("repeated formula copy should preserve source and rebase each tile");

    assert_eq!(
        output.value,
        json!({
            "values": [[10, 15, 10, 15]],
            "formulas": [["=10", "=D1+5", "=10", "=F1+5"]],
            "sourceValues": [[10, 15]],
            "sourceFormulas": [["=10", "=A1+5"]]
        })
    );
}

#[test]
fn copy_from_overlapping_formula_range_snapshots_source_before_writing() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:B2");
          source.formulas = [["=10", "=A1+5"], ["=20", "=A2+5"]];
          await context.sync();

          // B1:B2 overlaps the source's formula column. The production copy
          // mutation must read all source formulas before writing B1:C2.
          sheet.getRange("B1:C2").copyFrom(source, "All");
          await context.sync();

          const destination = sheet.getRange("B1:C2");
          const sourceColumn = sheet.getRange("A1:A2");
          destination.load("values,formulas");
          sourceColumn.load("values,formulas");
          await context.sync();
          return {
            destinationValues: destination.values,
            destinationFormulas: destination.formulas,
            sourceValues: sourceColumn.values,
            sourceFormulas: sourceColumn.formulas
          };
        });
        "#,
    )
    .expect("overlapping copy should snapshot formulas before writing");

    assert_eq!(
        output.value,
        json!({
            "destinationValues": [[10, 15], [20, 25]],
            "destinationFormulas": [["=10", "=B1+5"], ["=20", "=B2+5"]],
            "sourceValues": [[10], [20]],
            "sourceFormulas": [["=10"], ["=20"]]
        })
    );
}

#[test]
fn copy_from_formats_only_keeps_target_content_and_persists_format_changes() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1");
          source.values = [[11]];
          source.numberFormat = [["$#,##0.00"]];
          source.format.font.bold = true;

          const destination = sheet.getRange("B1");
          destination.values = [[22]];
          destination.numberFormat = [["0"]];
          destination.format.font.bold = false;
          await context.sync();

          destination.copyFrom(source, "Formats");
          await context.sync();

          const fresh = sheet.getRange("B1");
          fresh.load("values,numberFormat");
          fresh.format.font.load("bold");
          await context.sync();
          return {
            values: fresh.values,
            numberFormat: fresh.numberFormat,
            bold: fresh.format.font.bold
          };
        });
        "#,
    )
    .expect("formats-only copy should preserve destination values");

    assert_eq!(
        output.value,
        json!({ "values": [[22]], "numberFormat": [["$#,##0.00"]], "bold": true })
    );
}

#[test]
fn copy_from_across_worksheets_rebinds_naked_formula_references_to_destination() {
    let workbook = blank_workbook();
    workbook
        .sheets()
        .create_sheet("Data")
        .expect("create destination worksheet");

    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sourceSheet = context.workbook.worksheets.getItem("Sheet1");
          const destinationSheet = context.workbook.worksheets.getItem("Data");
          const source = sourceSheet.getRange("A1:B1");
          source.values = [[5, 0]];
          source.getCell(0, 1).formulas = [["=A1+1"]];
          await context.sync();

          destinationSheet.getRange("D1").copyFrom(source, "Formulas");
          await context.sync();

          const fresh = destinationSheet.getRange("D1:E1");
          fresh.load("values,formulas");
          await context.sync();
          return { values: fresh.values, formulas: fresh.formulas };
        });
        "#,
    )
    .expect("cross-worksheet copy should preserve formula semantics");

    assert_eq!(
        output.value,
        json!({
            "values": [[5, 6]],
            "formulas": [[5, "=D1+1"]]
        })
    );
}

#[test]
fn copy_from_qualified_address_string_resolves_source_worksheet() {
    let workbook = blank_workbook();
    workbook
        .sheets()
        .create_sheet("Data")
        .expect("create destination worksheet");

    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sourceSheet = context.workbook.worksheets.getItem("Sheet1");
          const destinationSheet = context.workbook.worksheets.getItem("Data");
          sourceSheet.getRange("A1:B1").values = [[7, 8]];
          await context.sync();

          // A qualified string is resolved against the named source sheet,
          // while the destination remains the Data worksheet.
          destinationSheet.getRange("D1").copyFrom(
            "Sheet1!A1:B1",
            "Values"
          );
          await context.sync();

          const destination = destinationSheet.getRange("D1:E1");
          destination.load("values,formulas");
          await context.sync();
          return {
            values: destination.values,
            formulas: destination.formulas
          };
        });
        "#,
    )
    .expect("qualified source address should resolve to its worksheet");

    assert_eq!(
        output.value,
        json!({ "values": [[7, 8]], "formulas": [[7, 8]] })
    );
}

#[test]
fn move_to_preserves_cell_identity_formula_references_and_formats() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1");
          source.values = [[10]];
          source.numberFormat = [["0.00"]];
          source.format.font.bold = true;
          const dependent = sheet.getRange("B1");
          dependent.formulas = [["=A1*2"]];
          await context.sync();

          source.moveTo(sheet.getRange("D1"));
          await context.sync();

          const oldCell = sheet.getRange("A1");
          const movedCell = sheet.getRange("D1");
          const dependentFresh = sheet.getRange("B1");
          oldCell.load("values");
          movedCell.load("values,formulas,numberFormat");
          movedCell.format.font.load("bold");
          dependentFresh.load("values,formulas");
          await context.sync();
          return {
            oldValues: oldCell.values,
            movedValues: movedCell.values,
            movedFormulas: movedCell.formulas,
            movedNumberFormat: movedCell.numberFormat,
            movedBold: movedCell.format.font.bold,
            dependentValues: dependentFresh.values,
            dependentFormulas: dependentFresh.formulas
          };
        });
        "#,
    )
    .expect("moveTo should use identity-preserving relocation");

    assert_eq!(
        output.value,
        json!({
            "oldValues": [[""]],
            "movedValues": [[10]],
            "movedFormulas": [[10]],
            "movedNumberFormat": [["0.00"]],
            "movedBold": true,
            "dependentValues": [[20]],
            "dependentFormulas": [["=D1*2"]]
        })
    );
}

#[test]
fn move_to_overlapping_multicell_range_preserves_identity_and_rewrites_dependents() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:A3");
          source.values = [[1], [2], [3]];
          source.numberFormat = [["0.00"], ["0.00"], ["0.00"]];
          source.format.font.bold = true;
          const dependent = sheet.getRange("B1:B3");
          dependent.formulas = [["=A1"], ["=A2"], ["=A3"]];
          await context.sync();

          // This overlaps the source on A2:A3. The Yrs relocation path must
          // snapshot identities before moving and update dependent refs.
          source.moveTo(sheet.getRange("A2"));
          await context.sync();

          const moved = sheet.getRange("A2:A4");
          const oldCell = sheet.getRange("A1");
          const dependents = sheet.getRange("B1:B3");
          moved.load("values,formulas,numberFormat");
          moved.format.font.load("bold");
          oldCell.load("values");
          dependents.load("values,formulas");
          await context.sync();
          return {
            movedValues: moved.values,
            movedFormulas: moved.formulas,
            movedNumberFormat: moved.numberFormat,
            movedBold: moved.format.font.bold,
            oldValues: oldCell.values,
            dependentValues: dependents.values,
            dependentFormulas: dependents.formulas
          };
        });
        "#,
    )
    .expect("overlapping move should preserve cell identity and references");

    assert_eq!(
        output.value,
        json!({
            "movedValues": [[1], [2], [3]],
            "movedFormulas": [[1], [2], [3]],
            "movedNumberFormat": [["0.00"], ["0.00"], ["0.00"]],
            "movedBold": true,
            "oldValues": [[""]],
            "dependentValues": [[1], [2], [3]],
            "dependentFormulas": [["=A2"], ["=A3"], ["=A4"]]
        })
    );
}

#[test]
fn copy_from_rejects_link_and_destination_overflow_without_partial_paste() {
    let workbook = blank_workbook();
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const source = sheet.getRange("A1:B1");
          source.values = [[41, 42]];
          await context.sync();

          let linkCode = null;
          try {
            sheet.getRange("D1").copyFrom(source, "Link");
            await context.sync();
          } catch (error) {
            linkCode = error.code;
          }

          let boundaryCode = null;
          try {
            sheet.getRange("XFD1").copyFrom(source, "Values");
            await context.sync();
          } catch (error) {
            boundaryCode = error.code;
          }

          const fresh = sheet.getRange("XFD1");
          const sourceFresh = sheet.getRange("A1:B1");
          fresh.load("values");
          sourceFresh.load("values");
          await context.sync();
          return {
            linkCode,
            boundaryCode,
            destination: fresh.values,
            source: sourceFresh.values
          };
        });
        "#,
    )
    .expect("copyFrom boundary and unsupported mode checks should succeed");

    assert_eq!(
        output.value,
        json!({
            "linkCode": "UnsupportedOperation",
            "boundaryCode": "InvalidArgument",
            "destination": [[""]],
            "source": [[41, 42]]
        })
    );
}

#[test]
fn copy_from_rejects_cross_context_range_synchronously() {
    let workbook = blank_workbook();
    let error = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const source = context.workbook.worksheets.getItem("Sheet1").getRange("A1");
          const other = await Excel.run(async (otherContext) => {
            return otherContext.workbook.worksheets.getItem("Sheet1").getRange("B1");
          });
          context.workbook.worksheets.getItem("Sheet1").getRange("C1").copyFrom(source);
          // Keep this branch explicit in the contract: a range from another
          // request context is rejected before it can enter the host batch.
          context.workbook.worksheets.getItem("Sheet1").getRange("D1").copyFrom(other);
          await context.sync();
        });
        "#,
    )
    .expect_err("cross-context Range.copyFrom should fail");

    match error {
        OfficeJsError::Script(message) => assert!(
            message.contains("InvalidRequestContext"),
            "unexpected cross-context error: {message}"
        ),
        other => panic!("expected script error, got {other}"),
    }
}
