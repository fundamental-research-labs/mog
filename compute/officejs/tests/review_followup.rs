//! Synthetic regressions for the follow-up review of PR 461.
use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;
use std::{fs, process::Command};
use xlsx_parser::{XlsxArchive, write::ZipWriter};

fn package(sheet: &str, extras: &[(&str, &str)]) -> Vec<u8> {
    let mut z = ZipWriter::new();
    for (name, xml) in [
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        ),
        (
            "xl/workbook.xml",
            r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="auto" calcOnSave="1"/></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
        ),
    ] {
        z.add_file(name, xml.as_bytes().to_vec());
    }
    z.add_file("xl/worksheets/sheet1.xml", format!(r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">{sheet}</worksheet>"#).into_bytes());
    for (name, xml) in extras {
        z.add_file(name, xml.as_bytes().to_vec());
    }
    z.finish().unwrap()
}

fn save(bytes: &[u8], args: &[&str]) -> Vec<u8> {
    let d = tempfile::tempdir().unwrap();
    fs::write(d.path().join("in.xlsx"), bytes).unwrap();
    let o = Command::new(env!("CARGO_BIN_EXE_mog"))
        .current_dir(d.path())
        .args(["-i", "in.xlsx", "-o", "out.xlsx"])
        .args(args)
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    assert!(!String::from_utf8_lossy(&o.stderr).contains("[DT-EVAL]"));
    fs::read(d.path().join("out.xlsx")).unwrap()
}

#[test]
fn count_counts_direct_numeric_text_only() {
    let w = Workbook::blank().unwrap().0;
    let r = run_office_js_with_workbook(&w, r#"return await Excel.run(async c=>{
      const s=c.workbook.worksheets.getItem('Sheet1');
      s.getRange('B1').formulas=[['=\"2\"']];s.getRange('B2').values=[[true]];
      s.getRange('A1:A7').formulas=[['=COUNT("2")'],['=COUNT("2",TRUE)'],['=COUNT("abc")'],['=COUNT(B1:B2)'],['=COUNT({"2",TRUE,4})'],['=COUNT(" 2 ")'],['=COUNT(1/0,"2")']];
      const r=s.getRange('A1:A7');r.load('values');await c.sync();return r.values;
    });"#).unwrap();
    assert_eq!(r.value, json!([[1], [2], [0], [0], [1], [1], [1]]));
}

#[test]
fn sumifs_empty_text_matches_blank_and_empty_formula_cells() {
    let w = Workbook::blank().unwrap().0;
    let r = run_office_js_with_workbook(&w, r#"return await Excel.run(async c=>{
      const s=c.workbook.worksheets.getItem('Sheet1');
      s.getRange('A1:A4').values=[['x'],['x'],['x'],['x']];
      s.getRange('B1').values=[['k']];s.getRange('B3').values=[['k']];s.getRange('B4').formulas=[['=""']];
      s.getRange('C1:C4').values=[[1],[2],[4],[8]];
      s.getRange('E1:E5').formulas=[['=SUMIFS(C1:C4,A1:A4,"x",B1:B4,"")'],['=SUMIFS(C:C,A:A,"x",B:B,"")'],['=SUMIFS(C1:C4,B1:B4,"")'],['=SUMIFS(C1:C4,B1:B4,"=")'],['=SUMIF(B1:B4,"",C1:C4)']];
      const r=s.getRange('E1:E5');r.load('values');await c.sync();return r.values;
    });"#).unwrap();
    assert_eq!(r.value, json!([[10], [10], [10], [10], [10]]));
}

#[test]
fn oversized_bounded_loads_fail_before_materialization() {
    let w = Workbook::blank().unwrap().0;
    for property in ["values", "formulas", "text", "numberFormat", "valueTypes"] {
        let script = format!(
            r#"return await Excel.run(async c=>{{
        const s=c.workbook.worksheets.getItem('Sheet1');
        s.getRange('A1').values=[[1]];s.getRange('XFD1048576').format.fill.color='#FFFF00';await c.sync();
        const r=s.getUsedRange();r.load('{}');try{{await c.sync();return 'unexpected';}}catch(e){{return e.code;}}
      }});"#,
            property
        );
        let r = run_office_js_with_workbook(&w, &script).unwrap();
        assert_eq!(
            r.value,
            json!("RequestPayloadSizeLimitExceeded"),
            "{property}"
        );
    }
}

#[test]
fn automatic_import_keeps_unrelated_caches_and_recalculates_edited_dependents() {
    let input = package(
        r#"<sheetData><row r="1"><c r="A1"><f>CUSTOMFUNC(2)</f><v>42</v></c><c r="B1"><v>5</v></c></row><row r="2"><c r="A2"><f>A1*2</f><v>84</v></c><c r="B2"><f>B1*2</f><v>10</v></c></row></sheetData>"#,
        &[],
    );
    for (args, b1, b2) in [
        (vec![], 5.0, 10.0),
        (
            vec![
                "-e",
                "await Excel.run(async c=>{const r=c.workbook.worksheets.getItem('Sheet1').getRange('B1');r.load('values');await c.sync();});",
            ],
            5.0,
            10.0,
        ),
        (
            vec![
                "-e",
                "await Excel.run(async c=>{c.workbook.worksheets.getItem('Sheet1').getRange('B1').values=[[6]];await c.sync();});",
            ],
            6.0,
            12.0,
        ),
    ] {
        let out = save(&input, &args);
        let w = Workbook::from_xlsx_bytes(&out).unwrap().0;
        let s = w.sheet_by_index(0).unwrap();
        for (a, v) in [("A1", 42.0), ("A2", 84.0), ("B1", b1), ("B2", b2)] {
            assert_eq!(
                s.get_cell_value(a).unwrap(),
                value_types::CellValue::number(v),
                "{a}"
            );
        }
        assert_eq!(w.settings().calculation_mode().unwrap(), "auto");
    }
    let out = save(&input, &["-r"]);
    let w = Workbook::from_xlsx_bytes(&out).unwrap().0;
    assert_eq!(
        w.sheet_by_index(0).unwrap().get_cell_value("A1").unwrap(),
        value_types::CellValue::Error(value_types::CellError::Name, None)
    );
}

#[test]
fn missing_scalar_cache_does_not_replace_unrelated_unsupported_results() {
    let input = package(
        r#"<sheetData><row r="1"><c r="A1"><f>CUSTOMFUNC(2)</f><v>42</v></c><c r="B1"><v>5</v></c></row><row r="2"><c r="A2"><f>A1*2</f><v>84</v></c><c r="B2"><f>B1*2</f><v/></c></row></sheetData>"#,
        &[],
    );
    let out = save(&input, &[]);
    let w = Workbook::from_xlsx_bytes(&out).unwrap().0;
    let s = w.sheet_by_index(0).unwrap();
    for (a, v) in [("A1", 42.0), ("A2", 84.0), ("B2", 10.0)] {
        assert_eq!(
            s.get_cell_value(a).unwrap(),
            value_types::CellValue::number(v)
        );
    }
}

#[test]
fn column_and_row_input_data_tables_recalculate_and_save() {
    let model = r#"<row r="1"><c r="B1"><v>3</v></c></row><row r="2"><c r="B2"><f>B1*2</f><v>6</v></c></row>"#;
    for (rows, range) in [
        (
            r#"<row r="4"><c r="B4"><f>B2</f><v>6</v></c></row><row r="5"><c r="A5"><v>1</v></c><c r="B5"><f t="dataTable" ref="B5:B7" dt2D="0" dtr="0" r1="B1"/><v>2</v></c></row><row r="6"><c r="A6"><v>2</v></c><c r="B6"><v>4</v></c></row><row r="7"><c r="A7"><v>3</v></c><c r="B7"><v>6</v></c></row>"#,
            "B5:B7",
        ),
        (
            r#"<row r="4"><c r="B4"><v>1</v></c><c r="C4"><v>2</v></c><c r="D4"><v>3</v></c></row><row r="5"><c r="A5"><f>B2</f><v>6</v></c><c r="B5"><f t="dataTable" ref="B5:D5" dt2D="0" dtr="1" r1="B1"/><v>2</v></c><c r="C5"><v>4</v></c><c r="D5"><v>6</v></c></row>"#,
            "B5:D5",
        ),
    ] {
        let input = package(&format!("<sheetData>{model}{rows}</sheetData>"), &[]);
        let out = save(&input, &["-r"]);
        let w = Workbook::from_xlsx_bytes(&out).unwrap().0;
        let values = w
            .sheet_by_index(0)
            .unwrap()
            .get_range_values_2d(range)
            .unwrap();
        let flat: Vec<_> = values.into_iter().flatten().collect();
        assert_eq!(
            flat,
            vec![
                value_types::CellValue::number(2.0),
                value_types::CellValue::number(4.0),
                value_types::CellValue::number(6.0)
            ],
            "{range}"
        );
        let again = save(&out, &["-r"]);
        let w = Workbook::from_xlsx_bytes(&again).unwrap().0;
        assert_eq!(
            w.sheet_by_index(0)
                .unwrap()
                .get_range_values_2d(range)
                .unwrap()
                .into_iter()
                .flatten()
                .collect::<Vec<_>>(),
            flat
        );
    }
}

#[test]
fn imported_long_this_row_results_survive_full_calculation_and_export() {
    let input = package(
        r#"<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1" t="inlineStr"><is><t>Sales</t></is></c><c r="C1" t="inlineStr"><is><t>Double</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>A</t></is></c><c r="B2"><v>10</v></c><c r="C2"><f>[[#This Row],Sales]*2</f><v/></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>B</t></is></c><c r="B3"><v>20</v></c><c r="C3"><f>[[#This Row],Sales]*2</f><v/></c></row></sheetData><tableParts count="1"><tablePart r:id="rIdTable"/></tableParts>"#,
        &[
            (
                "xl/worksheets/_rels/sheet1.xml.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>"#,
            ),
            (
                "xl/tables/table1.xml",
                r#"<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Data" displayName="Data" ref="A1:C3" totalsRowShown="0"><autoFilter ref="A1:C3"/><tableColumns count="3"><tableColumn id="1" name="Item"/><tableColumn id="2" name="Sales"/><tableColumn id="3" name="Double"><calculatedColumnFormula>[[#This Row],Sales]*2</calculatedColumnFormula></tableColumn></tableColumns></table>"#,
            ),
        ],
    );
    for args in [
        vec![],
        vec!["-r"],
        vec![
            "-e",
            "await Excel.run(async c=>{const r=c.workbook.worksheets.getItem('Sheet1').getRange('C2:C3');r.load('values');await c.sync();});",
        ],
    ] {
        let out = save(&input, &args);
        let w = Workbook::from_xlsx_bytes(&out).unwrap().0;
        let s = w.sheet_by_index(0).unwrap();
        assert_eq!(
            s.get_cell_value("C2").unwrap(),
            value_types::CellValue::number(20.0)
        );
        assert_eq!(
            s.get_cell_value("C3").unwrap(),
            value_types::CellValue::number(40.0)
        );
        let archive = XlsxArchive::new(&out).unwrap();
        let xml =
            String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
        assert!(!xml.contains("<v/>"), "{xml}");
    }
}

#[test]
fn unicode_and_period_sheet_references_parse_without_recalculation() {
    let w = Workbook::blank().unwrap().0;
    let result=run_office_js_with_workbook(&w,r#"return await Excel.run(async c=>{
      const main=c.workbook.worksheets.getItem('Sheet1');
      for(const name of ['Opções','Hypothèses','Assum.Site','Plain']){const s=c.workbook.worksheets.add(name);s.getRange('A1').values=[[7]];}
      main.getRange('A1:A5').formulas=[['=Opções!A1*2'],['=Hypothèses!A1*2'],['=Assum.Site!A1*2'],['=Plain!A1*2'],["='Opções'!A1*2"]];
      const r=main.getRange('A1:A5');r.load('values');await c.sync();return r.values;
    });"#).unwrap();
    assert_eq!(result.value, json!([[14], [14], [14], [14], [14]]));
    let input = w.to_xlsx_bytes().unwrap();
    let out = save(&input, &["--preserve-results"]);
    let w = Workbook::from_xlsx_bytes(&out).unwrap().0;
    for address in ["A1", "A2", "A3", "A4", "A5"] {
        assert_eq!(
            w.sheet_by_index(0)
                .unwrap()
                .get_cell_value(address)
                .unwrap(),
            value_types::CellValue::number(14.0)
        );
    }
}

#[test]
fn xlfn_title_sources_keep_original_chart_xml_until_edited() {
    let base = XlsxArchive::new(include_bytes!("fixtures/issue438.xlsx")).unwrap();
    for formula in [
        r#""Returns "&amp;_xlfn.TEXTJOIN(", ",TRUE,"Peak")"#,
        r#"_xlfn.CONCAT("Returns ","Peak")"#,
        r#""Returns "&amp;"Peak""#,
    ] {
        let mut zip = ZipWriter::new();
        let mut original_chart = Vec::new();
        for entry in base.entries() {
            let mut data = base.read_file(&entry.name).unwrap();
            if entry.name == "xl/charts/chart1.xml" {
                let mut xml = String::from_utf8(data).unwrap();
                let title = r#"<c:title xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:tx><c:strRef><c:f>Sheet1!$F$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Returns Peak</c:v></c:pt></c:strCache></c:strRef></c:tx><c:overlay val="0"/></c:title>"#;
                if let Some(start) = xml.find("<c:title>") {
                    let end = xml[start..].find("</c:title>").unwrap() + start + "</c:title>".len();
                    xml.replace_range(start..end, title);
                } else {
                    xml = xml.replacen("<chart>", &format!("<chart>{title}"), 1);
                }
                data = xml.into_bytes();
                original_chart = data.clone();
            } else if entry.name == "xl/worksheets/sheet1.xml" {
                let xml = String::from_utf8(data).unwrap();
                let cell = format!(r#"<c r="F1" t="str"><f>{formula}</f><v>Returns Peak</v></c>"#);
                data = xml
                    .replacen("</row>", &format!("{cell}</row>"), 1)
                    .into_bytes();
            }
            zip.add_file(&entry.name, data);
        }
        let input = zip.finish().unwrap();
        for args in [vec![], vec!["-r"]] {
            let out = save(&input, &args);
            let archive = XlsxArchive::new(&out).unwrap();
            assert_eq!(
                archive.read_file("xl/charts/chart1.xml").unwrap(),
                original_chart,
                "{formula}, {args:?}"
            );
        }
        let out = save(
            &input,
            &[
                "-e",
                "await Excel.run(async c=>{c.workbook.worksheets.getItem('Sheet1').getRange('F1').values=[['Edited']];await c.sync();});",
            ],
        );
        let archive = XlsxArchive::new(&out).unwrap();
        let chart = archive.read_file("xl/charts/chart1.xml").unwrap();
        assert_ne!(chart, original_chart);
        assert!(String::from_utf8(chart).unwrap().contains("Edited"));
    }
}

#[test]
fn imported_row_and_column_styles_cannot_allocate_the_whole_used_range() {
    let input = package(
        r#"<cols><col min="3" max="3" style="1"/></cols><sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="5" s="2" customFormat="1"/></sheetData>"#,
        &[(
            "xl/styles.xml",
            r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font/><font><b/></font><font><i/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>"#,
        )],
    );
    let w = Workbook::from_xlsx_bytes(&input).unwrap().0;
    let r=run_office_js_with_workbook(&w,r#"return await Excel.run(async c=>{
      const s=c.workbook.worksheets.getItem('Sheet1');const u=s.getUsedRange();const v=s.getUsedRange(true);
      u.load('address,cellCount');v.load('values,address');await c.sync();
      const address=u.address,count=u.cellCount,values=v.values,valuesAddress=v.address;
      u.load('values');try{await c.sync();return 'unexpected';}catch(e){return {address,count,values,valuesAddress,error:e.code};}
    });"#).unwrap();
    assert_eq!(
        r.value,
        json!({"address":"Sheet1!A1:XFD1048576","count":-1,"values":[[1]],"valuesAddress":"Sheet1!A1","error":"RequestPayloadSizeLimitExceeded"})
    );
}
