//! A sparse axis-title edit must preserve the chart's crossing axis on save.
use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use xlsx_parser::XlsxArchive;

fn chart_xml(bytes: &[u8]) -> String {
    String::from_utf8(
        XlsxArchive::new(bytes)
            .unwrap()
            .read_file("xl/charts/chart1.xml")
            .unwrap(),
    )
    .unwrap()
}

fn assert_axis_pair(xml: &str, category_title: Option<&str>, value_title: Option<&str>) {
    assert_eq!(xml.matches("<c:catAx>").count(), 1, "{xml}");
    assert_eq!(xml.matches("<c:valAx>").count(), 1, "{xml}");
    let category = xml
        .split_once("<c:catAx>")
        .unwrap()
        .1
        .split_once("</c:catAx>")
        .unwrap()
        .0;
    let value = xml
        .split_once("<c:valAx>")
        .unwrap()
        .1
        .split_once("</c:valAx>")
        .unwrap()
        .0;
    assert!(category.contains(r#"<c:axId val="111111111"/>"#), "{xml}");
    assert!(
        category.contains(r#"<c:crossAx val="222222222"/>"#),
        "{xml}"
    );
    assert!(value.contains(r#"<c:axId val="222222222"/>"#), "{xml}");
    assert!(value.contains(r#"<c:crossAx val="111111111"/>"#), "{xml}");
    if let Some(title) = category_title {
        assert!(category.contains(&format!(">{title}<")), "{xml}");
    }
    if let Some(title) = value_title {
        assert!(value.contains(&format!(">{title}<")), "{xml}");
    }
}

fn run_title_edits(edits: &[&str], category_title: Option<&str>, value_title: Option<&str>) {
    let (workbook, _) = Workbook::blank().unwrap();
    let edits = edits
        .iter()
        .map(|edit| format!("chart.axes.{edit}; await context.sync();"))
        .collect::<String>();
    run_office_js_with_workbook(
        &workbook,
        &format!(
            r#"await Excel.run(async context => {{
                const sheet = context.workbook.worksheets.getItem("Sheet1");
                sheet.getRange("A1:B3").values = [["Month", "Units"], ["Jan", 10], ["Feb", 20]];
                const chart = sheet.charts.add(Excel.ChartType.columnClustered, sheet.getRange("A1:B3"));
                await context.sync();
                {edits}
            }});"#
        ),
    )
    .unwrap();
    let bytes = workbook.to_xlsx_bytes().unwrap();
    assert_axis_pair(&chart_xml(&bytes), category_title, value_title);
    let (reopened, _) = Workbook::from_xlsx_bytes(&bytes).unwrap();
    assert_axis_pair(
        &chart_xml(&reopened.to_xlsx_bytes().unwrap()),
        category_title,
        value_title,
    );
}

fn with_export_stack(f: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(f)
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn category_title_preserves_value_axis_through_xlsx_roundtrip() {
    with_export_stack(|| {
        run_title_edits(&["categoryAxis.title.text = 'Month'"], Some("Month"), None)
    });
}

#[test]
fn value_title_preserves_category_axis_through_xlsx_roundtrip() {
    with_export_stack(|| run_title_edits(&["valueAxis.title.text = 'Units'"], None, Some("Units")));
}

#[test]
fn sequential_axis_titles_preserve_both_axes_in_either_order() {
    with_export_stack(|| {
        run_title_edits(
            &[
                "categoryAxis.title.text = 'Month'",
                "valueAxis.title.text = 'Units'",
            ],
            Some("Month"),
            Some("Units"),
        );
        run_title_edits(
            &[
                "valueAxis.title.text = 'Units'",
                "categoryAxis.title.text = 'Month'",
            ],
            Some("Month"),
            Some("Units"),
        );
    });
}
