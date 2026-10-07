use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;
fn part(w: &Workbook, path: &str) -> String {
    let bytes = w.to_xlsx_bytes().unwrap();
    let z = xlsx_parser::zip::XlsxArchive::new(&bytes).unwrap();
    String::from_utf8(z.read_file(path).unwrap()).unwrap()
}
#[test]
fn original_sized_chart_persists_name_geometry_legend_and_content() {
    let (w, _) = Workbook::blank().unwrap();
    run_office_js_with_workbook(&w, include_str!("fixtures/issue440_sized.js")).unwrap();
    let output = run_office_js_with_workbook(
        &w,
        r#"return await Excel.run(async c=>{
 const ch=c.workbook.worksheets.getItem("Sheet1").charts.getItem("SyntheticSales");
 ch.title.text="Revised title";ch.load(["name","left","top","width","height"]);await c.sync();
 return [ch.name,ch.left,ch.top,ch.width,ch.height];});"#,
    )
    .unwrap();
    assert_eq!(output.value, json!(["SyntheticSales", 200, 20, 480, 300]));
    for w in [
        w.clone(),
        Workbook::from_xlsx_bytes(&w.to_xlsx_bytes().unwrap())
            .unwrap()
            .0,
    ] {
        let drawing = part(&w, "xl/drawings/drawing1.xml");
        let chart = part(&w, "xl/charts/chart1.xml");
        assert!(drawing.contains("name=\"SyntheticSales\""), "{drawing}");
        assert!(drawing.contains("x=\"2540000\" y=\"254000\""), "{drawing}");
        assert!(
            drawing.contains("cx=\"6096000\" cy=\"3810000\""),
            "{drawing}"
        );
        for text in [
            "Revised title",
            "Category",
            "Revenue",
            "<c:legendPos val=\"b\"",
            "15",
            "20",
            "10",
        ] {
            assert!(chart.contains(text), "missing {text}: {chart}");
        }
    }
}
#[test]
fn original_set_position_includes_end_cell_and_uses_sheet_geometry() {
    let (w, _) = Workbook::blank().unwrap();
    let sheet = w.sheet_by_name("Sheet1").unwrap();
    sheet.layout().set_col_width(3, 120.0).unwrap();
    sheet.layout().set_row_height(1, 40.0).unwrap();
    run_office_js_with_workbook(&w, include_str!("fixtures/issue440_position.js")).unwrap();
    let object = sheet.charts().get_all().unwrap().remove(0);
    assert_eq!(object.common.anchor.anchor_col, 3);
    assert_eq!(object.common.anchor.anchor_row, 1);
    assert_eq!(object.common.anchor.end_col, Some(12));
    assert_eq!(object.common.anchor.end_row, Some(18));
    assert_eq!(
        object.common.width,
        sheet.layout().get_col_position(12).unwrap() - sheet.layout().get_col_position(3).unwrap()
    );
    assert_eq!(
        object.common.height,
        sheet.layout().get_row_position(18).unwrap() - sheet.layout().get_row_position(1).unwrap()
    );
    let drawing = part(&w, "xl/drawings/drawing1.xml");
    assert!(drawing.contains("<xdr:twoCellAnchor"), "{drawing}");
    assert!(
        drawing.contains(
            "<xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>18</xdr:row>"
        ),
        "{drawing}"
    );
}
#[test]
fn chart_invalid_geometry_is_rejected_and_hidden_legend_persists() {
    let (w, _) = Workbook::blank().unwrap();
    run_office_js_with_workbook(&w, include_str!("fixtures/issue440_sized.js")).unwrap();
    for assignment in [
        "ch.width=-1",
        "ch.left=NaN",
        "ch.height=0",
        "ch.legend.position='Bad'",
        "ch.setPosition('L18','D2')",
        "ch.setPosition('A:A','D2')",
    ] {
        let script = format!(
            "await Excel.run(async c=>{{const ch=c.workbook.worksheets.getItem('Sheet1').charts.getItem('SyntheticSales');{assignment};await c.sync();}});"
        );
        assert!(
            run_office_js_with_workbook(&w, &script).is_err(),
            "{assignment}"
        );
    }
    run_office_js_with_workbook(&w,"await Excel.run(async c=>{const ch=c.workbook.worksheets.getItem('Sheet1').charts.getItem('SyntheticSales');ch.legend.visible=false;await c.sync();});").unwrap();
    assert!(!part(&w, "xl/charts/chart1.xml").contains("<c:legend>"));
}

#[test]
fn imported_chart_rename_does_not_replace_title_or_series_cache() {
    let (w, _) = Workbook::blank().unwrap();
    run_office_js_with_workbook(&w, include_str!("fixtures/issue440_sized.js")).unwrap();
    let (w, _) = Workbook::from_xlsx_bytes(&w.to_xlsx_bytes().unwrap()).unwrap();
    run_office_js_with_workbook(
        &w,
        r#"await Excel.run(async c=>{
 const ch=c.workbook.worksheets.getItem("Sheet1").charts.getItem("SyntheticSales");
 ch.name="Renamed";ch.title.text="Another title";await c.sync();});"#,
    )
    .unwrap();
    assert!(part(&w, "xl/drawings/drawing1.xml").contains("name=\"Renamed\""));
    let chart = part(&w, "xl/charts/chart1.xml");
    for text in [
        "Another title",
        "Sales",
        "Category",
        "Revenue",
        "<c:legendPos val=\"b\"",
    ] {
        assert!(chart.contains(text), "{text}: {chart}");
    }
}

#[test]
fn range_endpoints_and_single_anchor_use_live_sheet_positions() {
    let (w, _) = Workbook::blank().unwrap();
    run_office_js_with_workbook(&w, include_str!("fixtures/issue440_sized.js")).unwrap();
    let output = run_office_js_with_workbook(
        &w,
        r#"return await Excel.run(async c=>{
      const s=c.workbook.worksheets.getItem("Sheet1");const ch=s.charts.getItem("SyntheticSales");
      ch.setPosition(s.getRange("D2"),s.getRange("L18"));await c.sync();
      ch.load(["width","height"]);await c.sync();const size=[ch.width,ch.height];
      ch.setPosition("A1");ch.load(["left","top","width","height"]);await c.sync();
      return [ch.left,ch.top,ch.width===size[0],ch.height===size[1]];
    });"#,
    )
    .unwrap();
    assert_eq!(output.value, json!([0, 0, true, true]));
}
