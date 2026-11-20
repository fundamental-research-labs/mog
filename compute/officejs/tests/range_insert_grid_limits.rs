//! Insertions must reject occupied worksheet tails before changing the workbook.

use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use regex::Regex;
use serde_json::json;

fn reopen(workbook: &Workbook) -> Workbook {
    let bytes = workbook.to_xlsx_bytes().unwrap();
    assert_export_within_grid(&bytes);
    Workbook::from_xlsx_bytes(&bytes).unwrap().0
}

fn assert_export_within_grid(bytes: &[u8]) {
    let xml = String::from_utf8(
        xlsx_parser::zip::XlsxArchive::new(bytes)
            .unwrap()
            .read_file("xl/worksheets/sheet1.xml")
            .unwrap(),
    )
    .unwrap();
    for capture in Regex::new(r#"<row\b[^>]*\br="(\d+)""#)
        .unwrap()
        .captures_iter(&xml)
    {
        assert!((1..=1_048_576).contains(&capture[1].parse::<u32>().unwrap()));
    }
    let references = Regex::new(r#"<(?:c|dimension)\b[^>]*\b(?:r|ref)="([^"]+)""#).unwrap();
    for capture in references.captures_iter(&xml) {
        for reference in capture[1].split(':') {
            let split = reference.find(|c: char| c.is_ascii_digit()).unwrap();
            let (letters, digits) = reference.split_at(split);
            let col = letters
                .bytes()
                .fold(0u32, |n, c| n * 26 + u32::from(c - b'A' + 1));
            assert!((1..=16_384).contains(&col), "invalid reference {reference}");
            assert!(
                (1..=1_048_576).contains(&digits.parse::<u32>().unwrap()),
                "invalid reference {reference}"
            );
        }
    }
}

fn assert_original_contents(workbook: &Workbook, horizontal: bool) {
    let values = if horizontal { "A1:C1" } else { "A1:A3" };
    let tail = if horizontal { "XFD1" } else { "A1048576" };
    let output = run_office_js_with_workbook(
        workbook,
        &format!(
            r#"
            return await Excel.run(async context => {{
                const sheet = context.workbook.worksheets.getItem("Sheet1");
                const values = sheet.getRange("{values}");
                const tail = sheet.getRange("{tail}");
                values.load("values");
                tail.format.fill.load("color");
                await context.sync();
                return {{values: values.values, color: tail.format.fill.color}};
            }});
            "#
        ),
    )
    .unwrap();
    let expected_values = if horizontal {
        json!([[1, 2, 3]])
    } else {
        json!([[1], [2], [3]])
    };
    assert_eq!(
        output.value,
        json!({"values": expected_values, "color": "#FFFF00"})
    );
}

fn rejects_formatted_tail(range: &str, entire_axis: bool, horizontal: bool) {
    let workbook = Workbook::blank().unwrap().0;
    let (values, contents, tail, direction, entire) = if horizontal {
        (
            "A1:C1",
            "[[1, 2, 3]]",
            "XFD1",
            "Right",
            ".getEntireColumn()",
        )
    } else {
        (
            "A1:A3",
            "[[1], [2], [3]]",
            "A1048576",
            "Down",
            ".getEntireRow()",
        )
    };
    run_office_js_with_workbook(
        &workbook,
        &format!(
            r##"
            await Excel.run(async context => {{
                const sheet = context.workbook.worksheets.getItem("Sheet1");
                sheet.getRange("{values}").values = {contents};
                sheet.getRange("{tail}").format.fill.color = "#FFFF00";
                await context.sync();
            }});
            "##
        ),
    )
    .unwrap();
    let workbook = reopen(&workbook);
    assert_original_contents(&workbook, horizontal);
    let entire = if entire_axis { entire } else { "" };
    let output = run_office_js_with_workbook(
        &workbook,
        &format!(
            r#"
            return await Excel.run(async context => {{
                const sheet = context.workbook.worksheets.getItem("Sheet1");
                sheet.getRange("{range}"){entire}.insert("{direction}");
                try {{
                    await context.sync();
                    return false;
                }} catch (error) {{
                    return true;
                }}
            }});
            "#
        ),
    )
    .unwrap();
    assert_eq!(
        output.value,
        json!(true),
        "occupied tail must reject insertion"
    );
    assert_original_contents(&workbook, horizontal);
    assert_original_contents(&reopen(&workbook), horizontal);
}

#[test]
fn whole_row_insert_rejects_formatted_last_row_after_xlsx_reopen() {
    rejects_formatted_tail("2:2", false, false);
}

#[test]
fn partial_insert_down_rejects_formatted_last_row() {
    rejects_formatted_tail("A2:A3", false, false);
}

#[test]
fn entire_row_insert_rejects_formatted_last_row() {
    rejects_formatted_tail("A2", true, false);
}

#[test]
fn whole_column_insert_rejects_formatted_last_column() {
    rejects_formatted_tail("B:B", false, true);
}

#[test]
fn partial_insert_right_rejects_formatted_last_column() {
    rejects_formatted_tail("B1:C1", false, true);
}

#[test]
fn entire_column_insert_rejects_formatted_last_column() {
    rejects_formatted_tail("B1", true, true);
}

#[test]
fn insert_into_empty_final_position_survives_xlsx_reopen() {
    for horizontal in [false, true] {
        for partial in [false, true] {
            let workbook = Workbook::blank().unwrap().0;
            let (source, target, range, direction) = match (horizontal, partial) {
                (false, false) => ("A1048575", "A1048576", "2:2", "Down"),
                (false, true) => ("A1048575", "A1048576", "A2", "Down"),
                (true, false) => ("XFC1", "XFD1", "B:B", "Right"),
                (true, true) => ("XFC1", "XFD1", "B1", "Right"),
            };
            run_office_js_with_workbook(
                &workbook,
                &format!(
                    r##"
                await Excel.run(async context => {{
                    const sheet = context.workbook.worksheets.getItem("Sheet1");
                    sheet.getRange("{source}").values = [[7]];
                    sheet.getRange("{source}").format.fill.color = "#FFFF00";
                    await context.sync();
                }});
            "##
                ),
            )
            .unwrap();
            let workbook = reopen(&workbook);
            run_office_js_with_workbook(&workbook, &format!(r#"
                await Excel.run(async context => {{
                    context.workbook.worksheets.getItem("Sheet1").getRange("{range}").insert("{direction}");
                    await context.sync();
                }});
            "#)).unwrap();
            let workbook = reopen(&workbook);
            let output = run_office_js_with_workbook(
                &workbook,
                &format!(
                    r#"
                return await Excel.run(async context => {{
                    const sheet = context.workbook.worksheets.getItem("Sheet1");
                    const target = sheet.getRange("{target}");
                    target.load("values");
                    target.format.fill.load("color");
                    await context.sync();
                    return {{values: target.values, color: target.format.fill.color}};
                }});
            "#
                ),
            )
            .unwrap();
            assert_eq!(output.value, json!({"values": [[7]], "color": "#FFFF00"}));
        }
    }
}
