use mog::{run_office_js, run_office_js_with_workbook};
use serde_json::json;

#[test]
fn all_fifty_function_calipers_cases_produce_expected_values_and_errors() {
    // Independent expected results for the committed scripts. These are local
    // engine assertions, not substitutes for Excel-generated golden workbooks.
    let cases = [
        ("abs", json!([12.5, 0])),
        ("acos", json!([std::f64::consts::PI / 3.0, "#NUM!"])),
        ("acosh", json!([1.3169578969248166, "#NUM!"])),
        ("asin", json!([std::f64::consts::PI / 6.0, "#NUM!"])),
        ("asinh", json!([1.4436354751788103, -1.4436354751788103])),
        (
            "atan",
            json!([std::f64::consts::FRAC_PI_4, -std::f64::consts::FRAC_PI_4]),
        ),
        (
            "atan2",
            json!([3.0 * std::f64::consts::FRAC_PI_4, "#DIV/0!"]),
        ),
        ("atanh", json!([0.5493061443340548, "#NUM!"])),
        ("cos", json!([0.5403023058681398, 1])),
        ("cosh", json!([1.5430806348152437, 1])),
        ("sin", json!([0.8414709848078965, 0])),
        ("sinh", json!([1.1752011936438014, -1.1752011936438014])),
        ("tan", json!([1.5574077246549023, 0])),
        ("tanh", json!([0.7615941559557649, -0.7615941559557649])),
        ("degrees", json!([180, -90])),
        (
            "radians",
            json!([std::f64::consts::PI, -std::f64::consts::FRAC_PI_2]),
        ),
        ("exp", json!([std::f64::consts::E, 1])),
        ("ln", json!([1, "#NUM!"])),
        ("log", json!([3, 2])),
        ("log10", json!([3, "#NUM!"])),
        ("pi", json!([std::f64::consts::PI, std::f64::consts::PI])),
        ("power", json!([1024, -8])),
        ("sqrt", json!([9, "#NUM!"])),
        ("sqrtPi", json!([2.5066282746310002, "#NUM!"])),
        ("sign", json!([-1, 0])),
        ("int", json!([-3, 2])),
        ("trunc", json!([-12.34, -12])),
        ("round", json!([-12.35, 130])),
        ("roundUp", json!([-12.35, 130])),
        ("roundDown", json!([-12.34, 120])),
        ("mod", json!([2, "#DIV/0!"])),
        ("quotient", json!([-2, "#DIV/0!"])),
        ("product", json!([12, 0])),
        ("sum", json!([10, 6])),
        ("sumSq", json!([14, 13])),
        ("average", json!([2, 5])),
        ("min", json!([-4, 0])),
        ("max", json!([4, -2])),
        ("median", json!([2, 5])),
        ("count", json!([3, 3])),
        ("countA", json!([5, "#VALUE!"])),
        ("len", json!([8, 0])),
        ("left", json!(["abc", "a"])),
        ("right", json!(["def", "f"])),
        ("mid", json!(["bcd", "#VALUE!"])),
        ("lower", json!(["hello", "a1 b2"])),
        ("upper", json!(["HELLO", "A1 B2"])),
        ("trim", json!(["one two", ""])),
        ("concatenate", json!(["#VALUE!", "=1+1"])),
        ("exact", json!([true, false])),
    ];
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../vendor/calipers/verification/cases/officejs");
    assert_eq!(cases.len(), 50);
    let generated_count = std::fs::read_dir(&root)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("api_function_")
        })
        .count();
    assert_eq!(generated_count, cases.len());
    let mut failures = Vec::new();
    for (name, expected) in cases {
        let path = root.join(format!("api_function_{name}"));
        let script = std::fs::read_to_string(path.join("script.js")).unwrap();
        let bytes = std::fs::read(path.join("init.xlsx")).unwrap();
        let (workbook, _) = compute_api::Workbook::from_xlsx_bytes(&bytes).unwrap();
        if let Err(error) = run_office_js_with_workbook(&workbook, &script) {
            failures.push(format!("{name}: {error}"));
            continue;
        }
        // Calipers compares saved workbooks. Check the exported result too.
        let saved = workbook.to_xlsx_bytes().unwrap();
        let (workbook, _) = compute_api::Workbook::from_xlsx_bytes(&saved).unwrap();
        let source = r#"
            return await Excel.run(async context => {
                const result = context.workbook.worksheets.getActiveWorksheet().getRange("E2:F3");
                result.load("values");
                await context.sync();
                return result.values;
            });"#;
        let actual = match run_office_js_with_workbook(&workbook, source) {
            Ok(output) => output.value,
            Err(error) => {
                failures.push(format!("{name}: {error}"));
                continue;
            }
        };
        for row in 0..2 {
            let want = &expected[row];
            let error = want.as_str().is_some_and(|text| text.starts_with('#'));
            let (value, other) = if error {
                (&actual[row][1], &actual[row][0])
            } else {
                (&actual[row][0], &actual[row][1])
            };
            let matches = if let (Some(got), Some(want)) = (value.as_f64(), want.as_f64()) {
                (got - want).abs() <= 1e-12 * want.abs().max(1.0)
            } else {
                value == want
            };
            if !matches || other != "" {
                failures.push(format!(
                    "{name} row {row}: got {}, expected {want}",
                    actual[row]
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn concatenate_rejects_js_numbers_and_counta_rejects_js_text() {
    let result = run_office_js(
        r#"
        return await Excel.run(async context => {
            const f = context.workbook.functions;
            const concatNum = f.concatenate("say ", "\"hi\"", 2).load();
            const concatText = f.concatenate("=", "1+1").load();
            const countNumbers = f.countA(1, 0, 4).load();
            const countScalars = f.countA("", false, 0).load();
            await context.sync();
            return {concatNum, concatText, countNumbers, countScalars};
        });
    "#,
    )
    .unwrap()
    .value;
    assert_eq!(
        result,
        json!({
            "concatNum": {"value": null, "error": "#VALUE!"},
            "concatText": {"value": "=1+1", "error": null},
            "countNumbers": {"value": 3, "error": null},
            "countScalars": {"value": null, "error": "#VALUE!"}
        })
    );
}

#[test]
fn function_results_are_queued_loadable_snapshots_and_can_be_nested() {
    let result = run_office_js(
        r#"
        return await Excel.run(async context => {
            const sheet = context.workbook.worksheets.getActiveWorksheet();
            sheet.name = "O'Brien data";
            const range = sheet.getRange("B2:B3");
            range.values = [[2], [3]];
            const f = context.workbook.functions;
            const sum = f.sum(range);
            const before = sum.toJSON();
            let early;
            try { sum.value; } catch (e) { early = e.code; }
            // Nested results do not require an intervening load or sync.
            const nested = f.power(sum, 2).load("value");
            const failed = f.sqrt(-1).load();
            const propagated = f.sum(failed, 1).load();
            const quoted = f.sum({address: "'O''Brien data'!B2:B3"}).load();
            const array = f.sum([[1, 2], [3, 4]]).load();
            sum.load("value");
            let afterLoad;
            try { sum.value; } catch (e) { afterLoad = e.code; }
            await context.sync();
            let unloaded;
            try { sum.error; } catch (e) { unloaded = e.code; }
            const selected = sum.toJSON();
            range.values = [[20], [30]];
            const reused = f.sum(sum, 1).load();
            const fresh = f.sum(range).load();
            sum.load();
            await context.sync();
            return {before, early, afterLoad, unloaded, selected, sum, nested, failed,
                    propagated, quoted, array, reused, fresh};
        });
    "#,
    )
    .unwrap()
    .value;
    assert_eq!(
        result,
        json!({
            "before": {}, "early": "PropertyNotLoaded", "afterLoad": "PropertyNotLoaded",
            "unloaded": "PropertyNotLoaded", "selected": {"value": 5},
            "sum": {"value": 5, "error": null}, "nested": {"value": 25},
            "failed": {"value": null, "error": "#NUM!"},
            "propagated": {"value": null, "error": "#NUM!"},
            "quoted": {"value": 5, "error": null}, "array": {"value": 10, "error": null},
            "reused": {"value": 6, "error": null}, "fresh": {"value": 50, "error": null}
        })
    );
}

#[test]
fn function_arguments_preserve_literals_optional_parameters_and_context() {
    let output = run_office_js(r#"
        const other = new Excel.RequestContext();
        return await Excel.run(async context => {
            const f = context.workbook.functions;
            const errors = [];
            for (const arg of [other.workbook.worksheets.getActiveWorksheet().getRange("A1"), other.workbook.functions.abs(-1), NaN, Infinity, {}, () => 1]) {
                try { f.sum(arg); } catch (e) { errors.push(e.code); }
            }
            const literal = f.concatenate('x"),SUM(1,2),"', '=A1').load();
            const optional = f.log(100, undefined).load();
            const bool = f.exact(true, "TRUE").load();
            await context.sync();
            return {errors, literal, optional, bool};
        });
    "#).unwrap();
    assert_eq!(
        output.value,
        json!({
            "errors": ["InvalidRequestContext", "InvalidRequestContext", "InvalidArgument", "InvalidArgument", "InvalidArgument", "InvalidArgument"],
            "literal": {"value": "x\"),SUM(1,2),\"=A1", "error": null},
            "optional": {"value": 2, "error": null},
            "bool": {"value": true, "error": null}
        })
    );
}

#[test]
fn function_calls_do_not_create_scratch_cells_or_sheets() {
    let (workbook, _) = compute_api::Workbook::blank().unwrap();
    let before = workbook.sheet_names().unwrap();
    let output = run_office_js_with_workbook(&workbook, r#"
        return await Excel.run(async context => {
            const result = context.workbook.functions.sum(1, 2, 3).load();
            await context.sync();
            const used = context.workbook.worksheets.getActiveWorksheet().getUsedRangeOrNullObject();
            await context.sync();
            return {result, empty: used.isNullObject};
        });
    "#).unwrap();
    assert_eq!(
        output.value,
        json!({"result": {"value": 6, "error": null}, "empty": true})
    );
    assert_eq!(before, workbook.sheet_names().unwrap());
}

#[test]
fn function_references_resolve_active_sheets_names_and_queued_formula_writes() {
    let result = run_office_js(
        r#"
        return await Excel.run(async context => {
            const first = context.workbook.worksheets.getActiveWorksheet();
            first.getRange("A1:A2").values = [[100], [200]];
            const sheet = context.workbook.worksheets.add("Data");
            sheet.activate();
            sheet.getRange("A1:A2").values = [[2], [3]];
            sheet.getRange("B1:B2").formulas = [["=A1*2"], ["=A2*2"]];
            context.workbook.names.add("InputNumbers", "=Data!A1:A2");
            sheet.names.add("LocalNumbers", "=Data!B1:B2");
            const f = context.workbook.functions;
            const results = [
                f.sum({address: "A1:A2"}),
                f.sum({address: "InputNumbers"}),
                f.sum({address: "Data!LocalNumbers"}),
                f.sum(first.getRange("A:A")),
                f.sum(sheet.getRange("B1:B2")),
                f.abs(sheet.getRange("A1")),
                f.sum([1, 2, 3]),
            ];
            results.forEach(result => result.load());
            await context.sync();
            return results.map(result => result.error || result.value);
        });
    "#,
    )
    .unwrap();
    assert_eq!(result.value, json!([5, 5, 10, 300, 10, 2, 6]));
}

#[test]
fn malformed_function_references_and_arrays_fail_without_formula_injection() {
    for argument in [
        r#"{address: "A1)+SUM(1,2)"}"#,
        "[[1, 2], [3]]",
        "[]",
        "[[[1]]]",
    ] {
        let source = format!(
            r#"
            return await Excel.run(async context => {{
                try {{
                    context.workbook.functions.sum({argument}).load();
                    await context.sync();
                }} catch (error) {{ return error.code; }}
                return "unexpected success";
            }});
        "#
        );
        assert_eq!(
            run_office_js(&source).unwrap().value,
            "InvalidArgument",
            "{argument}"
        );
    }
}
