//! Production-path Office.js chart collection and chart lifecycle semantics.

use mog::run_office_js;
use serde_json::json;

#[test]
fn chart_collection_adds_and_hydrates_core_properties() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const source = sheet.getRange("A1:B3");
        source.values = [["Month", "Revenue"], ["Jan", 10], ["Feb", 20]];
        const charts = sheet.charts;
        const chart = charts.add(
          Excel.ChartType.columnClustered,
          source,
          Excel.ChartSeriesBy.columns
        );
        chart.name = "Revenue chart";
        chart.load(["id", "name", "chartType", "height", "width", "left", "top"]);
        charts.load(["items/name", "items/chartType"]);
        const count = charts.getCount();
        await context.sync();
        return {
          count: count.value,
          chart: chart.toJSON(),
          collection: charts.toJSON(),
          types: {
            chart: chart instanceof Excel.Chart,
            collection: charts instanceof Excel.ChartCollection,
            clientObject: chart instanceof OfficeExtension.ClientObject,
          },
        };
      });
    "#,
    )
    .expect("chart creation should succeed");

    assert_eq!(output.value["count"], json!(1));
    assert_eq!(output.value["chart"]["name"], json!("Revenue chart"));
    assert_eq!(output.value["chart"]["chartType"], json!("ColumnClustered"));
    assert_eq!(output.value["chart"]["height"], json!(300.0));
    assert_eq!(output.value["chart"]["width"], json!(400.0));
    assert_eq!(output.value["chart"]["left"], json!(0.0));
    assert_eq!(output.value["chart"]["top"], json!(0.0));
    assert_eq!(
        output.value["collection"]["items"][0],
        json!({ "name": "Revenue chart", "chartType": "ColumnClustered" })
    );
    assert!(output.value["chart"]["id"]
        .as_str()
        .is_some_and(|id| id.starts_with("fobj-")));
    assert_eq!(
        output.value["types"],
        json!({ "chart": true, "collection": true, "clientObject": true })
    );
}

#[test]
fn chart_lookup_by_name_id_index_and_or_null_use_persisted_identity() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const source = sheet.getRange("A1:B2");
        source.values = [["Category", "Value"], ["A", 1]];
        const charts = sheet.charts;
        const first = charts.add(Excel.ChartType.barClustered, source);
        const second = charts.add(Excel.ChartType.line, source);
        first.name = "First chart";
        second.name = "Second chart";
        await context.sync();

        first.load("id");
        second.load("id");
        await context.sync();

        const byName = charts.getItem("First chart");
        const byId = charts.getItem(first.id);
        const byIndex = charts.getItemAt(1);
        const missing = charts.getItemOrNullObject("missing");
        byName.load(["id", "name"]);
        byId.load(["id", "name"]);
        byIndex.load(["id", "name"]);
        missing.load("isNullObject");
        await context.sync();
        return {
          firstId: first.id,
          byName: byName.toJSON(),
          byId: byId.toJSON(),
          byIndex: byIndex.toJSON(),
          missing: missing.isNullObject,
        };
      });
    "#,
    )
    .expect("chart lookup should succeed");

    assert_eq!(output.value["byName"]["name"], json!("First chart"));
    assert_eq!(output.value["byName"]["id"], output.value["firstId"]);
    assert_eq!(output.value["byId"]["id"], output.value["firstId"]);
    assert_eq!(output.value["byIndex"]["name"], json!("Second chart"));
    assert_eq!(output.value["missing"], json!(true));
}

#[test]
fn chart_setters_set_data_set_position_and_delete_persist() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const firstSource = sheet.getRange("A1:B2");
        firstSource.values = [["Category", "Value"], ["A", 1]];
        const secondSource = sheet.getRange("D1:E3");
        secondSource.values = [["Category", "Value"], ["A", 2], ["B", 3]];
        const charts = sheet.charts;
        const chart = charts.add(Excel.ChartType.line, firstSource);
        chart.name = "Lifecycle";
        chart.chartType = Excel.ChartType.area;
        chart.width = 640;
        chart.height = 360;
        chart.left = 18;
        chart.top = 24;
        chart.setData(secondSource, Excel.ChartSeriesBy.rows);
        chart.setPosition("B2", "E8");
        await context.sync();

        const fetched = charts.getItem("Lifecycle");
        fetched.load(["id", "name", "chartType", "height", "width", "left", "top"]);
        await context.sync();
        const id = fetched.id;
        fetched.delete();
        await context.sync();
        const missing = charts.getItemOrNullObject(id);
        missing.load("isNullObject");
        const count = charts.getCount();
        await context.sync();
        return { chart: fetched.toJSON(), missing: missing.isNullObject, count: count.value };
      });
    "#,
    )
    .expect("chart mutations should succeed");

    assert_eq!(output.value["chart"]["name"], json!("Lifecycle"));
    assert_eq!(output.value["chart"]["chartType"], json!("Area"));
    assert_eq!(output.value["chart"]["width"], json!(256.0));
    assert_eq!(output.value["chart"]["height"], json!(140.0));
    assert!(output.value["chart"]["left"]
        .as_f64()
        .is_some_and(|value| value > 0.0));
    assert!(output.value["chart"]["top"]
        .as_f64()
        .is_some_and(|value| value > 0.0));
    assert_eq!(output.value["missing"], json!(true));
    assert_eq!(output.value["count"], json!(0));
}

#[test]
fn chart_arguments_reject_foreign_ranges_and_invalid_collection_indices() {
    let output = run_office_js(
        r#"
      const first = new Excel.RequestContext();
      const second = new Excel.RequestContext();
      const sheet = first.workbook.worksheets.getItem("Sheet1");
      const chartSource = sheet.getRange("A1:B2");
      const foreign = second.workbook.worksheets.getItem("Sheet1").getRange("A1:B2");
      const charts = sheet.charts;
      let addCode;
      let dataCode;
      let indexCode;
      try { charts.add(Excel.ChartType.line, foreign); }
      catch (error) { addCode = error.code; }
      const chart = charts.add(Excel.ChartType.line, chartSource);
      try { chart.setData(foreign); }
      catch (error) { dataCode = error.code; }
      charts.getItemAt(-1);
      try { await first.sync(); }
      catch (error) { indexCode = error.code; }
      return { addCode, dataCode, indexCode };
    "#,
    )
    .expect("chart argument checks should succeed");

    assert_eq!(
        output.value,
        json!({
        "addCode": "InvalidRequestContext",
        "dataCode": "InvalidRequestContext",
            "indexCode": "ItemNotFound",
        })
    );
}
