//! Production-path Office.js chart series collection and series semantics.

use mog::run_office_js;
use serde_json::json;

#[test]
fn chart_series_collection_adds_loads_and_binds_dimensions() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B4").values = [
          ["Month", "Revenue"],
          ["Jan", 10],
          ["Feb", 20],
          ["Mar", 30]
        ];
        const chart = sheet.charts.add(
          Excel.ChartType.columnClustered,
          sheet.getRange("A1"),
          Excel.ChartSeriesBy.columns
        );
        const series = chart.series;
        const revenue = series.add("Revenue");
        revenue.setValues(sheet.getRange("B2:B4"));
        revenue.setXAxisValues(sheet.getRange("A2:A4"));
        revenue.chartType = Excel.ChartType.line;
        revenue.axisGroup = Excel.ChartAxisGroup.secondary;
        revenue.load(["name", "chartType", "axisGroup"]);

        series.load(["count", "items/name", "items/chartType", "items/axisGroup"]);
        const countResult = series.getCount();
        const valuesResult = revenue.getDimensionValues(Excel.ChartSeriesDimension.values);
        const categoriesResult = revenue.getDimensionValues(Excel.ChartSeriesDimension.categories);
        const valuesSource = revenue.getDimensionDataSourceString(Excel.ChartSeriesDimension.values);
        const categoriesSource = revenue.getDimensionDataSourceString(Excel.ChartSeriesDimension.categories);
        const valuesType = revenue.getDimensionDataSourceType(Excel.ChartSeriesDimension.values);
        await context.sync();
        return {
          count: series.count,
          countResult: countResult.value,
          items: series.items.map(item => item.toJSON()),
          revenue: revenue.toJSON(),
          values: valuesResult.value,
          categories: categoriesResult.value,
          valuesSource: valuesSource.value,
          categoriesSource: categoriesSource.value,
          valuesType: valuesType.value,
          types: {
            collection: series instanceof Excel.ChartSeriesCollection,
            series: revenue instanceof Excel.ChartSeries,
            clientObject: revenue instanceof OfficeExtension.ClientObject
          }
        };
      });
    "#,
    )
    .expect("chart series binding should succeed");

    assert_eq!(output.value["count"], json!(1));
    assert_eq!(output.value["countResult"], json!(1));
    assert_eq!(output.value["items"][0]["name"], json!("Revenue"));
    assert_eq!(output.value["items"][0]["chartType"], json!("Line"));
    assert_eq!(output.value["items"][0]["axisGroup"], json!("Secondary"));
    assert_eq!(output.value["revenue"]["name"], json!("Revenue"));
    assert_eq!(output.value["values"], json!(["10", "20", "30"]));
    assert_eq!(output.value["categories"], json!(["Jan", "Feb", "Mar"]));
    assert_eq!(output.value["valuesSource"], json!("Sheet1!B2:B4"));
    assert_eq!(output.value["categoriesSource"], json!("Sheet1!A2:A4"));
    assert_eq!(output.value["valuesType"], json!("LocalRange"));
    assert_eq!(
        output.value["types"],
        json!({ "collection": true, "series": true, "clientObject": true })
    );
}

#[test]
fn chart_series_collection_inserts_and_deletes_against_persisted_state() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const chart = sheet.charts.add(
          Excel.ChartType.columnClustered,
          sheet.getRange("A1")
        );
        const series = chart.series;
        const first = series.add("First");
        series.add("Last");
        series.add("Middle", 1);
        await context.sync();

        series.load(["count", "items/name"]);
        await context.sync();
        const beforeDelete = series.items.map(item => item.name);
        first.delete();
        await context.sync();

        series.load(["count", "items/name"]);
        await context.sync();
        return {
          beforeDelete,
          afterDelete: series.items.map(item => item.name),
          count: series.count,
          firstType: first instanceof Excel.ChartSeries
        };
      });
    "#,
    )
    .expect("chart series collection mutation should succeed");

    assert_eq!(output.value["beforeDelete"], json!(["First", "Middle", "Last"]));
    assert_eq!(output.value["afterDelete"], json!(["Middle", "Last"]));
    assert_eq!(output.value["count"], json!(2));
    assert_eq!(output.value["firstType"], json!(true));
}
