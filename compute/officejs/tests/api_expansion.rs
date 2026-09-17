use mog::run_office_js;

#[test]
fn freeze_at_retains_range_position_and_supports_string_and_null() {
    let result = run_office_js(
        r#"
      return Excel.run(async context => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        sheet.freezePanes.freezeAt("B2:D4");
        const frozen = sheet.freezePanes.getLocation().load("address");
        await context.sync();
        sheet.freezePanes.freezeAt(null);
        const none = sheet.freezePanes.getLocationOrNullObject();
        await context.sync();
        return [frozen.address, none.isNullObject];
      });
    "#,
    )
    .unwrap();
    assert_eq!(result.value, serde_json::json!(["Sheet1!B2:D4", true]));
}

#[test]
fn table_filters_are_scoped_and_reapplied() {
    let result = run_office_js(r##"
      return Excel.run(async context => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        sheet.getRange("A1:B5").values = [["Name", "Amount"], ["a", 10], ["b", 20], ["c", 30], ["d", 40]];
        const table = sheet.tables.add("A1:B5", true);
        const filter = table.columns.getItem("Amount").filter;
        filter.applyCustomFilter(">20");
        const row = sheet.getRange("A2");
        row.load("rowHidden");
        filter.load("criteria");
        await context.sync();
        const before = row.rowHidden;
        const criteria = filter.criteria;
        sheet.getRange("B2").values = [[50]];
        table.reapplyFilters();
        row.load("rowHidden");
        await context.sync();
        const after = row.rowHidden;
        table.clearFilters();
        sheet.getRange("A1:B5").load("rowHidden");
        await context.sync();
        return {before, after, criteria};
      });
    "##).unwrap();
    assert_eq!(result.value["before"], true);
    assert_eq!(result.value["after"], false);
    assert_eq!(result.value["criteria"]["filterOn"], "Custom");
}

#[test]
fn expansion_caliper_scripts_execute() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../vendor/calipers/verification/cases/officejs");
    let mut count = 0;
    for entry in std::fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if !path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("api_")
        {
            continue;
        }
        let script = std::fs::read_to_string(path.join("script.js")).unwrap();
        let name = path.file_name().unwrap().to_string_lossy();
        let capture = r##"
          return Excel.run(async context => {
            const sheet = context.workbook.worksheets.getItem("Sheet1");
            const output = sheet.getRange("D1:F5").load("values");
            await context.sync();
            return output.values;
          });
        "##;
        let output = run_office_js(&format!("{script}\n{capture}"))
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
            .value;
        if let Some(method) = name.strip_prefix("api_filter_") {
            let expected = match method {
                "apply" | "dynamic" | "top_items" | "top_percent" => [true, true, false, false],
                "bottom_items" | "bottom_percent" => [false, false, true, true],
                "values" => [true, false, true, false],
                "custom" => [true, false, false, true],
                "cell_color" => [true, false, true, true],
                "font_color" => [true, true, false, true],
                "clear" | "table_clear" => [false; 4],
                "table_reapply" => [false, true, false, false],
                other => panic!("Missing expected filter result for {other}"),
            };
            for (row, hidden) in expected.into_iter().enumerate() {
                assert_eq!(output[row + 1][1], hidden, "{name}, row {}", row + 2);
            }
        } else {
            let expected = match name.as_ref() {
                "api_comment_count" | "api_comment_reply_count" | "api_cf_count" => {
                    serde_json::json!(1)
                }
                "api_comment_delete"
                | "api_comment_reply_delete"
                | "api_cf_delete"
                | "api_cf_clear" => serde_json::json!(0),
                "api_comment_null"
                | "api_comment_reply_null"
                | "api_cf_null"
                | "api_range_range_used_null"
                | "api_range_sheet_used_null"
                | "api_range_find_null"
                | "api_range_freeze_location_null" => serde_json::json!(true),
                "api_comment_location" | "api_comment_reply_location" => {
                    serde_json::json!("Sheet1!B2")
                }
                "api_comment_reply_add" | "api_comment_reply_item" | "api_comment_reply_at" => {
                    serde_json::json!("reply")
                }
                "api_comment_item"
                | "api_comment_at"
                | "api_comment_cell"
                | "api_comment_reply_id"
                | "api_comment_reply_parent" => serde_json::json!("root"),
                "api_cf_item" | "api_cf_at" => serde_json::json!("CellValue"),
                "api_cf_range" | "api_cf_range_null" => serde_json::json!("Sheet1!B2:B5"),
                "api_range_range_used" => serde_json::json!("Sheet1!B2:D5"),
                "api_range_sheet_used" => serde_json::json!("Sheet1!B2:C3"),
                "api_range_intersection_null" => serde_json::json!("Sheet1!C3:true"),
                "api_range_find" => serde_json::json!("Sheet1!B2"),
                "api_range_range_replace" => serde_json::json!(2),
                "api_range_sheet_replace" => serde_json::json!(3),
                "api_range_freeze_location" => serde_json::json!("Sheet1!1:2"),
                "api_range_adjust_indent" => serde_json::json!(2.0 / 1440.0),
                other => panic!("Missing expected result for {other}"),
            };
            assert_eq!(
                output[0][if name.starts_with("api_range_") { 2 } else { 0 }],
                expected,
                "{name}"
            );
        }
        count += 1;
    }
    assert_eq!(count, 49, "every new method must have a caliper fixture");
}

#[test]
fn range_queries_handle_sparse_cells_wildcards_and_null_results() {
    let result = run_office_js(r##"
      return Excel.run(async context => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        sheet.getRange("A1").values = [["one"]];
        sheet.getRange("XFD1048576").values = [["last"]];
        const used = sheet.getUsedRange(true).load("address");
        await context.sync();
        const sparse = used.address;
        sheet.getRange("XFD1048576").clear();
        sheet.getRange("B2:B5").values = [["a.b"], ["A*B"], ["a?b"], ["a.b"]];
        const literal = sheet.getRange("B2:B5").find("a.b", {completeMatch:true}).load("address");
        const escaped = sheet.getRange("B2:B5").find("a~*b", {completeMatch:true}).load("address");
        const next = sheet.getRange("B2").find("a.b", {completeMatch:true}).load("address");
        const previous = sheet.getRange("B2").find("a.b", {searchDirection:"Backwards"}).load("address");
        const empty = sheet.getRange("H2:I3").getUsedRangeOrNullObject();
        await context.sync();
        empty.getUsedRange();
        let code;
        try { await context.sync(); } catch (error) { code = error.code; }
        return [sparse, literal.address, escaped.address, next.address, previous.address, empty.isNullObject, code];
      });
    "##).unwrap();
    assert_eq!(
        result.value,
        serde_json::json!([
            "Sheet1!A1:XFD1048576",
            "Sheet1!B2",
            "Sheet1!B3",
            "Sheet1!B5",
            "Sheet1!B5",
            true,
            "InvalidObjectPath"
        ])
    );
}

#[test]
fn comment_identity_survives_edits_and_root_deletion_removes_replies() {
    let workbook = compute_api::Workbook::blank().unwrap().0;
    let result = mog::run_office_js_with_workbook(
        &workbook,
        r##"
      return Excel.run(async context => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        const comments = context.workbook.comments;
        const root = comments.add(sheet.getRange("B3"), "original");
        const reply = root.replies.add("reply");
        root.load("id"); reply.load("id");
        await context.sync();
        const alias = comments.getItem(root.id);
        alias.content = "updated";
        root.load("content");
        await context.sync();
        const content = root.content;
        sheet.getRange("2:2").insert("Down");
        const location = reply.getLocation().load("address");
        await context.sync();
        const address = location.address;
        root.delete();
        const missing = comments.getItemOrNullObject(root.id);
        await context.sync();
        return [content, address, missing.isNullObject];
      });
    "##,
    )
    .unwrap();
    assert_eq!(
        result.value,
        serde_json::json!(["updated", "Sheet1!B4", true])
    );
    assert!(
        workbook
            .sheet_by_index(0)
            .unwrap()
            .comments()
            .get_all()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn conditional_format_aliases_read_current_state_and_clear_only_the_target_range() {
    let result = run_office_js(
        r##"
      return Excel.run(async context => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        const formats = sheet.getRange("A1:A5").conditionalFormats;
        const first = formats.add("CellValue");
        first.load("id");
        await context.sync();
        const alias = formats.getItem(first.id);
        alias.cellValue.format.fill.color = "#FFFF00";
        first.cellValue.rule = {formula1: "3", operator: "GreaterThan"};
        sheet.getRange("A3").conditionalFormats.clearAll();
        const middleCount = sheet.getRange("A3").conditionalFormats.getCount();
        const outsideCount = sheet.getRange("A1:A2").conditionalFormats.getCount();
        const range = first.getRangeOrNullObject();
        await context.sync();
        return [middleCount.value, outsideCount.value, range.isNullObject];
      });
    "##,
    )
    .unwrap();
    assert_eq!(result.value, serde_json::json!([0, 1, true]));
}

#[test]
fn used_range_distinguishes_values_from_formatting_and_clips_the_scope() {
    let result = run_office_js(r##"
      return Excel.run(async context => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        sheet.getRange("B2:C4").format.fill.color = "#FFFF00";
        sheet.getRange("C3").values = [[42]];
        const formatted = sheet.getRange("C1:D8").getUsedRange().load("address");
        const values = sheet.getUsedRange(true).load("address");
        const empty = sheet.getRange("B2:B4").getUsedRangeOrNullObject(true);
        const missing = sheet.getRange("F2").getIntersectionOrNullObject("G2");
        await context.sync();
        let unloaded;
        try { missing.values; } catch (error) { unloaded = error.code; }
        return [formatted.address, values.address, empty.isNullObject, missing.isNullObject, unloaded];
      });
    "##).unwrap();
    assert_eq!(
        result.value,
        serde_json::json!(["Sheet1!C2:C4", "Sheet1!C3", true, true, "PropertyNotLoaded"])
    );
}

#[test]
fn replacement_edits_formula_text_without_replacing_computed_values() {
    let result = run_office_js(
        r##"
      return Excel.run(async context => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        sheet.getRange("A1:A2").formulas = [["=10+10"], ["=5+5"]];
        const count = sheet.getRange("A1:A2").replaceAll("10", "20", {});
        const output = sheet.getRange("A1:A2").load("formulas,values");
        await context.sync();
        return [count.value, output.formulas, output.values];
      });
    "##,
    )
    .unwrap();
    assert_eq!(
        result.value,
        serde_json::json!([1, [["=20+20"], ["=5+5"]], [[40], [10]]])
    );
}
