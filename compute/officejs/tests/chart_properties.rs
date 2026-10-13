use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;
fn part(w: &Workbook, path: &str) -> String {
    let bytes = w.to_xlsx_bytes().unwrap();
    let z = xlsx_parser::zip::XlsxArchive::new(&bytes).unwrap();
    String::from_utf8(z.read_file(path).unwrap()).unwrap()
}
fn assert_sales_series_cache(xml: &str) {
    use xlsx_parser::domain::charts::{CatDataSource, Chart, NumDataSource, SeriesTextSource};
    let chart = Chart::parse(xml.as_bytes());
    assert_eq!(chart.series.len(), 1, "Expected exactly one Sales series");
    let series = &chart.series[0];
    let Some(SeriesTextSource::StrRef(name)) = series.tx.as_ref() else {
        panic!("Series name reference")
    };
    let name_cache = name.str_cache.as_ref().expect("Series name cache");
    assert_eq!(name_cache.pt_count, Some(1));
    assert_eq!(
        name_cache
            .pts
            .iter()
            .map(|point| (point.idx, point.v.as_str()))
            .collect::<Vec<_>>(),
        vec![(0, "Sales")]
    );

    let values = match series.val.as_ref().expect("Series value source") {
        NumDataSource::Ref(reference) => reference.num_cache.as_ref().expect("Numeric cache"),
        other => panic!("Expected worksheet numeric reference, got {other:?}"),
    };
    assert_eq!(values.pt_count, Some(3));
    assert_eq!(
        values
            .pts
            .iter()
            .map(|point| (point.idx, point.v.as_str()))
            .collect::<Vec<_>>(),
        vec![(0, "15"), (1, "20"), (2, "10")]
    );
    let categories = match series.cat.as_ref().expect("Series category source") {
        CatDataSource::StrRef(reference) => reference.str_cache.as_ref().expect("String cache"),
        other => panic!("Expected worksheet string reference, got {other:?}"),
    };
    assert_eq!(categories.pt_count, Some(3));
    assert_eq!(
        categories
            .pts
            .iter()
            .map(|point| (point.idx, point.v.as_str()))
            .collect::<Vec<_>>(),
        vec![(0, "A"), (1, "B"), (2, "C")]
    );
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
        assert_sales_series_cache(&chart);
        for text in [
            "Revised title",
            "Category",
            "Revenue",
            "<c:legendPos val=\"b\"",
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
    assert_sales_series_cache(&part(&w, "xl/charts/chart1.xml"));
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
    assert_sales_series_cache(&chart);
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

#[test]
fn size_only_change_keeps_positioned_start_cell() {
    let (w, _) = Workbook::blank().unwrap();
    run_office_js_with_workbook(&w, include_str!("fixtures/issue440_position.js")).unwrap();
    run_office_js_with_workbook(
        &w,
        r#"await Excel.run(async c=>{
      const ch=c.workbook.worksheets.getItem("Sheet1").charts.getItem("SyntheticSales");
      ch.width=480;await c.sync();
    });"#,
    )
    .unwrap();
    let drawing = part(&w, "xl/drawings/drawing1.xml");
    assert!(drawing.contains("<xdr:oneCellAnchor>"), "{drawing}");
    assert!(
        drawing.contains("<xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row>"),
        "{drawing}"
    );
    assert!(drawing.contains("cx=\"6096000\""), "{drawing}");
    assert!(!drawing.contains("absoluteAnchor"));
}

#[test]
fn frozen_column_charts_use_series_legend_without_overlay() {
    use xlsx_parser::domain::charts::{Chart, ChartTypeConfig};
    for script in [
        include_str!("fixtures/issue440_sized.js"),
        include_str!("fixtures/issue440_position.js"),
    ] {
        let (w, _) =
            Workbook::from_xlsx_bytes(include_bytes!("fixtures/issue440_input.xlsx")).unwrap();
        run_office_js_with_workbook(&w, script).unwrap();
        for w in [
            w.clone(),
            Workbook::from_xlsx_bytes(&w.to_xlsx_bytes().unwrap())
                .unwrap()
                .0,
        ] {
            let xml = part(&w, "xl/charts/chart1.xml");
            let chart = Chart::parse(xml.as_bytes());
            let Some(ChartTypeConfig::Bar(config)) = chart.chart_type_config else {
                panic!("column chart")
            };
            assert_eq!(
                config.vary_colors,
                Some(false),
                "Single Sales series must not use category legend entries"
            );
            assert_eq!(
                chart.legend.unwrap().overlay,
                Some(false),
                "Reserve space for the bottom legend"
            );
            assert_sales_series_cache(&xml);
        }
    }
}

#[test]
fn authored_column_defaults_do_not_replace_imported_or_pie_settings() {
    use xlsx_parser::domain::charts::{Chart, ChartTypeConfig};
    for chart_type in ["ColumnClustered", "Pie", "Doughnut"] {
        let (w, _) = Workbook::blank().unwrap();
        let script = format!(
            "await Excel.run(async c=>{{const s=c.workbook.worksheets.getItem('Sheet1');s.getRange('A1:C3').values=[['Category','Sales','Cost'],['A',15,5],['B',20,8]];const ch=s.charts.add('{chart_type}',s.getRange('A1:C3'),'Columns');ch.legend.visible=true;await c.sync();}});"
        );
        run_office_js_with_workbook(&w, &script).unwrap();
        let chart = Chart::parse(part(&w, "xl/charts/chart1.xml").as_bytes());
        match chart.chart_type_config.unwrap() {
            ChartTypeConfig::Bar(config) => {
                assert_eq!(config.vary_colors, Some(false));
                assert_eq!(chart.series.len(), 2);
            }
            ChartTypeConfig::Pie(config) => assert_eq!(config.vary_colors, Some(true)),
            ChartTypeConfig::Doughnut(config) => assert_eq!(config.vary_colors, Some(true)),
            other => panic!("unexpected config: {other:?}"),
        }
        if chart_type == "ColumnClustered" {
            let sheet = w.sheet_by_name("Sheet1").unwrap();
            let object = sheet.charts().get_all().unwrap().remove(0);
            let mut legend = serde_json::to_value(&object).unwrap()["legend"].clone();
            legend["overlay"] = json!(true);
            sheet
                .charts()
                .update(
                    &object.common.id,
                    &json!({"varyByCategories":true,"legend":legend}),
                )
                .unwrap();
            let (reloaded, _) = Workbook::from_xlsx_bytes(&w.to_xlsx_bytes().unwrap()).unwrap();
            run_office_js_with_workbook(&reloaded,"await Excel.run(async c=>{const ch=c.workbook.worksheets.getItem('Sheet1').charts.getItem('Chart 1');ch.legend.position='Bottom';await c.sync();});").unwrap();
            let chart = Chart::parse(part(&reloaded, "xl/charts/chart1.xml").as_bytes());
            let Some(ChartTypeConfig::Bar(config)) = chart.chart_type_config else {
                panic!("column chart")
            };
            assert_eq!(config.vary_colors, Some(true));
            assert_eq!(chart.legend.unwrap().overlay, Some(true));
        }
    }
}
