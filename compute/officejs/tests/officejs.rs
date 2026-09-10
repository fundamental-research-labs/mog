//! Office.js engine tests. Scripts go through `run_office_js`, the shipped
//! eval entry used by the `mog` CLI.

use compute_api::Workbook;
use mog::{OfficeJsError, run_office_js, run_office_js_with_workbook};

#[test]
fn a1_range_handle_reuses_resolved_bounds_across_reads_writes_and_syncs() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
            const sheet = context.workbook.worksheets.getItem("Sheet1");
            const data = sheet.getRange("$b$2:$C$3");
            data.values = [[1, 2], [3, 4]];
            data.load("values");
            await context.sync();
            const before = data.values;
            data.formulas = [["=10+1", 12], [13, "=B2+C2"]];
            data.load("values,formulas");
            await context.sync();
            const calculated = data.values;
            const formulas = data.formulas;
            data.values = [[21, 22], [23, 24]];
            data.load("values");
            await context.sync();
            return {before, calculated, formulas, after: data.values};
        });
    "#,
    )
    .unwrap();
    assert_eq!(
        output.value,
        serde_json::json!({
            "before": [[1, 2], [3, 4]],
            "calculated": [[11, 12], [13, 23]],
            "formulas": [["=10+1", 12], [13, "=B2+C2"]],
            "after": [[21, 22], [23, 24]]
        })
    );
}

#[test]
fn bulk_sync_and_subsequent_rust_edit_share_values_and_dependencies() {
    let (workbook, _) = Workbook::blank().unwrap();
    let first = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const values = Array.from({length: 100}, (_, r) =>
            Array.from({length: 10}, (_, c) => r * 10 + c + 1));
          sheet.getRange("A1:J100").values = values;
          const summary = context.workbook.worksheets.add("Summary");
          const total = summary.getRange("A1");
          total.formulas = [["=SUM(Sheet1!A1:J100)"]];
          const data = sheet.getRange("A1:J100");
          data.load("values");
          total.load("values");
          await context.sync();
          if (JSON.stringify(data.values) !== JSON.stringify(values)) {
            throw new Error("bulk write did not preserve every cell");
          }
          return total.values[0][0];
        });
        "#,
    )
    .expect("bulk Office.js sync");
    assert_eq!(first.value.as_f64(), Some(500_500.0));

    workbook
        .sheet_by_name("Sheet1")
        .unwrap()
        .set_cell("A1", "101")
        .unwrap();
    let second = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const total = context.workbook.worksheets.getItem("Summary").getRange("A1");
          total.load("values");
          await context.sync();
          return total.values[0][0];
        });
        "#,
    )
    .expect("read dependent result after Rust edit");
    assert_eq!(second.value.as_f64(), Some(500_600.0));
}

#[test]
fn repeated_sync_preserves_mixed_values_and_refreshes_formula_results() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:D1").values = [[7, true, "日本語 🦀", null]];
          const result = sheet.getRange("E1");
          result.formulas = [["=A1*3"]];
          result.load("values");
          await context.sync();
          const before = result.values[0][0];
          sheet.getRange("A1").values = [[11]];
          const range = sheet.getRange("A1:E1");
          range.load("values");
          await context.sync();
          return {before, after: range.values};
        });
        "#,
    )
    .expect("mixed values and repeated sync");
    assert_eq!(
        output.value,
        serde_json::json!({
            "before": 21,
            "after": [[11, true, "日本語 🦀", "", 33]]
        })
    );
}

#[test]
fn rust_workbook_can_add_sheet() {
    let (wb, _) = Workbook::blank().expect("blank workbook");
    wb.sheets().create_sheet("Data").expect("create_sheet");
    let sheet = wb.sheet_by_name("Data").expect("get Data");
    sheet.set_cell("A1", "42").expect("set A1");
    assert_eq!(sheet.get_cell_value("A1").unwrap().as_number(), Some(42.0));
}

#[test]
fn values_and_formulas_load_computed_result() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1").values = [[10]];
          sheet.getRange("A2").formulas = [["=A1*2"]];
          const result = sheet.getRange("A2");
          result.load("values");
          await context.sync();
          return result.values[0][0];
        });
        "#,
    )
    .expect("script should succeed");

    assert_eq!(output.value.as_f64(), Some(20.0));
}

#[test]
fn worksheets_add_getitem_and_get_range() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const created = context.workbook.worksheets.add("Data");
          created.getRange("A1").values = [[42]];
          const got = context.workbook.worksheets.getItem("Data");
          const range = got.getRange("A1");
          range.load("values");
          await context.sync();
          return range.values;
        });
        "#,
    )
    .expect("script should succeed");

    let cell = output.value.pointer("/0/0").and_then(|v| v.as_f64());
    assert_eq!(cell, Some(42.0));
}

#[test]
fn unloaded_property_is_not_readable() {
    let err = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const range = sheet.getRange("A1");
          await context.sync();
          return range.values;
        });
        "#,
    )
    .expect_err("reading values without load must fail");

    match err {
        OfficeJsError::Script(message) => {
            assert!(
                message.contains("PropertyNotLoaded") || message.contains("not available"),
                "unexpected error: {message}"
            );
        }
        other => panic!("expected script error, got {other}"),
    }
}

fn archive_text(bytes: &[u8], path: &str) -> String {
    String::from_utf8(
        xlsx_parser::zip::XlsxArchive::new(bytes)
            .unwrap()
            .read_file(path)
            .unwrap(),
    )
    .unwrap()
}

fn excel_shaped_xlsx(sheet_name: &str, sheet_id: &str) -> Vec<u8> {
    let mut zip = xlsx_parser::write::ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    </Types>"#
            .to_vec(),
    );
    zip.add_file(
        "_rels/.rels",
        br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>"#
            .to_vec(),
    );
    let workbook = format!(
        r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="{sheet_name}" sheetId="{sheet_id}" r:id="rId1"/></sheets>
      <calcPr calcId="191029"/>
      <extLst><ext uri="{{140A7094-0E35-4892-8432-C4D2E57EDEB7}}"><x15:workbookPr xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main" chartTrackingRefBase="1"/></ext></extLst>
    </workbook>"#
    );
    zip.add_file("xl/workbook.xml", workbook.into_bytes());
    zip.add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    </Relationships>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/worksheets/sheet1.xml",
        br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>
    </worksheet>"#
            .to_vec(),
    );
    zip.finish().unwrap()
}

#[test]
fn names_add_on_loaded_workbook_keeps_defined_names_in_schema_order() {
    let bytes = excel_shaped_xlsx("Sheet1", "1");
    let (workbook, _) = Workbook::from_xlsx_bytes(&bytes).unwrap();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          context.workbook.names.add("Repro_Name", sheet.getRange("A1:A10"));
          await context.sync();
        });
        "#,
    )
    .unwrap();
    let exported = workbook.to_xlsx_bytes().unwrap();
    let xml = archive_text(&exported, "xl/workbook.xml");
    let names = xml.find("<definedNames>").expect(&xml);
    let calc = xml.find("<calcPr").expect(&xml);
    assert!(names < calc, "{xml}");
    assert!(xml.contains("Repro_Name"), "{xml}");
}

#[test]
fn worksheets_add_after_sparse_import_emits_unique_sheet_ids() {
    let bytes = excel_shaped_xlsx("Imported", "2");
    let (workbook, _) = Workbook::from_xlsx_bytes(&bytes).unwrap();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          context.workbook.worksheets.add("Added");
          await context.sync();
        });
        "#,
    )
    .unwrap();
    let exported = workbook.to_xlsx_bytes().unwrap();
    let xml = archive_text(&exported, "xl/workbook.xml");
    let mut ids = Vec::new();
    for part in xml.split("sheetId=\"").skip(1) {
        ids.push(part.split('"').next().unwrap().parse::<u32>().unwrap());
    }
    assert_eq!(ids.len(), 2, "{xml}");
    assert!(ids.iter().all(|id| *id > 0), "{xml}");
    assert_eq!(
        ids.iter()
            .copied()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        2,
        "{xml}"
    );
}

#[test]
fn multi_row_formulas_survive_officejs_export() {
    let (workbook, _) = Workbook::blank().unwrap();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:C2").formulas = [
            [100, "=A1", "=B1+B2"],
            [200, "=A2", null],
          ];
          await context.sync();
        });
        "#,
    )
    .unwrap();
    let exported = workbook.to_xlsx_bytes().unwrap();
    let xml = archive_text(&exported, "xl/worksheets/sheet1.xml");
    assert!(
        xml.contains("<f>A2</f>") || xml.contains("<f>=A2</f>"),
        "{xml}"
    );
}

#[test]
fn authored_chart_titles_emit_overlay_through_officejs() {
    let (workbook, _) = Workbook::blank().unwrap();
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:B5").values = [
            ["Month", "Units"],
            ["M0", 10],
            ["M1", 13],
            ["M2", 16],
            ["M3", 19],
          ];
          const chart = sheet.charts.add(Excel.ChartType.columnClustered, sheet.getRange("A1:B5"));
          chart.title.text = "Monthly Units";
          chart.axes.categoryAxis.title.text = "Month";
          chart.axes.valueAxis.title.text = "Units Sold";
          await context.sync();
        });
        "#,
    )
    .unwrap();
    let exported = workbook.to_xlsx_bytes().unwrap();
    let chart = archive_text(&exported, "xl/charts/chart1.xml");
    assert!(chart.contains(">Monthly Units<"), "{chart}");
    assert!(
        chart.matches(r#"<c:overlay val="0"/>"#).count() >= 3,
        "{chart}"
    );
}
