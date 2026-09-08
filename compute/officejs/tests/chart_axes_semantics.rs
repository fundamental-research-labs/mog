//! Production-path chart axis and axis-title semantics.

use mog::run_office_js;
use serde_json::json;

#[test]
fn axes_read_write_and_title_round_trip_from_fresh_proxies() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const source = sheet.getRange("A1:B4");
        source.values = [["Month", "Revenue"], ["Jan", 10], ["Feb", 20], ["Mar", 30]];
        const chart = sheet.charts.add(Excel.ChartType.columnClustered, source);
        chart.name = "Axis chart";
        await context.sync();

        const axes = chart.axes;
        const category = axes.categoryAxis;
        const value = axes.valueAxis;
        category.load(["type", "axisGroup", "visible", "minimum", "maximum", "majorUnit", "minorUnit", "numberFormat", "scaleType", "categoryType"]);
        value.load(["type", "axisGroup", "visible", "minimum", "maximum", "majorUnit", "minorUnit", "numberFormat", "scaleType"]);
        category.title.load(["text", "visible"]);
        await context.sync();

        category.visible = false;
        category.minimum = 1;
        category.maximum = 12;
        category.majorUnit = 2;
        category.minorUnit = 1;
        category.numberFormat = "0";
        category.title.text = "Months";
        category.title.visible = true;
        value.scaleType = Excel.ChartAxisScaleType.logarithmic;
        value.logBase = 10;
        value.minimum = 1;
        value.maximum = 100;
        value.numberFormat = "$#,##0";
        value.title.text = "Revenue";
        await context.sync();

        const fresh = sheet.charts.getItem("Axis chart");
        const freshCategory = fresh.axes.categoryAxis;
        const freshValue = fresh.axes.valueAxis;
        freshCategory.load(["type", "axisGroup", "visible", "minimum", "maximum", "majorUnit", "minorUnit", "numberFormat"]);
        freshCategory.title.load(["text", "visible"]);
        freshValue.load(["type", "axisGroup", "minimum", "maximum", "numberFormat", "scaleType", "logBase"]);
        freshValue.title.load(["text", "visible"]);
        await context.sync();
        return {
          category: freshCategory.toJSON(),
          value: freshValue.toJSON(),
          types: {
            axes: axes instanceof Excel.ChartAxes,
            category: category instanceof Excel.ChartAxis,
            title: category.title instanceof Excel.ChartAxisTitle,
          },
        };
      });
    "#,
    )
    .expect("chart axis mutations should persist");

    assert_eq!(
        output.value["types"],
        json!({"axes": true, "category": true, "title": true})
    );
    assert_eq!(output.value["category"]["type"], json!("Category"));
    assert_eq!(output.value["category"]["axisGroup"], json!("Primary"));
    assert_eq!(output.value["category"]["visible"], json!(false));
    assert_eq!(output.value["category"]["minimum"], json!(1.0));
    assert_eq!(output.value["category"]["maximum"], json!(12.0));
    assert_eq!(output.value["category"]["majorUnit"], json!(2.0));
    assert_eq!(output.value["category"]["minorUnit"], json!(1.0));
    assert_eq!(output.value["category"]["numberFormat"], json!("0"));
    assert_eq!(output.value["category"]["title"]["text"], json!("Months"));
    assert_eq!(output.value["category"]["title"]["visible"], json!(true));
    assert_eq!(output.value["value"]["type"], json!("Value"));
    assert_eq!(output.value["value"]["scaleType"], json!("Logarithmic"));
    assert_eq!(output.value["value"]["logBase"], json!(10.0));
    assert_eq!(output.value["value"]["minimum"], json!(1.0));
    assert_eq!(output.value["value"]["maximum"], json!(100.0));
    assert_eq!(output.value["value"]["numberFormat"], json!("$#,##0"));
    assert_eq!(output.value["value"]["title"]["text"], json!("Revenue"));
}

#[test]
fn axis_enums_methods_and_auto_values_persist() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const source = sheet.getRange("A1:B3");
        source.values = [["Category", "Value"], ["A", 1], ["B", 2]];
        const chart = sheet.charts.add(Excel.ChartType.line, source);
        chart.name = "Enum chart";
        await context.sync();
        const axis = chart.axes.valueAxis;
        axis.displayUnit = Excel.ChartAxisDisplayUnit.millions;
        axis.setCustomDisplayUnit(1000);
        axis.position = Excel.ChartAxisPosition.minimum;
        axis.setPositionAt(2.5);
        axis.majorTickMark = Excel.ChartAxisTickMark.outside;
        axis.minorTickMark = Excel.ChartAxisTickMark.inside;
        axis.tickLabelPosition = Excel.ChartAxisTickLabelPosition.high;
        axis.baseTimeUnit = Excel.ChartAxisTimeUnit.months;
        axis.majorTimeUnitScale = Excel.ChartAxisTimeUnit.years;
        axis.minorTimeUnitScale = Excel.ChartAxisTimeUnit.days;
        axis.offset = 100;
        axis.tickLabelSpacing = 2;
        axis.tickMarkSpacing = 3;
        axis.reversePlotOrder = true;
        axis.isBetweenCategories = true;
        axis.linkNumberFormat = true;
        axis.showDisplayUnitLabel = true;
        axis.minimum = "";
        axis.maximum = "";
        await context.sync();

        const fresh = sheet.charts.getItem("Enum chart");
        const freshAxis = fresh.axes.valueAxis;
        freshAxis.load(["displayUnit", "customDisplayUnit", "position", "positionAt", "majorTickMark", "minorTickMark", "tickLabelPosition", "baseTimeUnit", "majorTimeUnitScale", "minorTimeUnitScale", "offset", "tickLabelSpacing", "tickMarkSpacing", "reversePlotOrder", "isBetweenCategories", "linkNumberFormat", "showDisplayUnitLabel", "minimum", "maximum"]);
        await context.sync();
        return freshAxis.toJSON();
      });
    "#,
    )
    .expect("axis enum setters should persist");

    assert_eq!(output.value["displayUnit"], json!("Custom"));
    assert_eq!(output.value["customDisplayUnit"], json!(1000.0));
    assert_eq!(output.value["position"], json!("Minimum"));
    assert_eq!(output.value["positionAt"], json!(2.5));
    assert_eq!(output.value["majorTickMark"], json!("Outside"));
    assert_eq!(output.value["minorTickMark"], json!("Inside"));
    assert_eq!(output.value["tickLabelPosition"], json!("High"));
    assert_eq!(output.value["majorTimeUnitScale"], json!("Years"));
    assert_eq!(output.value["minorTimeUnitScale"], json!("Days"));
    assert_eq!(output.value["offset"], json!(100));
    assert_eq!(output.value["tickLabelSpacing"], json!(2));
    assert_eq!(output.value["tickMarkSpacing"], json!(3));
    assert_eq!(output.value["reversePlotOrder"], json!(true));
    assert_eq!(output.value["isBetweenCategories"], json!(true));
    assert_eq!(output.value["linkNumberFormat"], json!(true));
    assert_eq!(output.value["showDisplayUnitLabel"], json!(true));
    assert_eq!(output.value["minimum"], json!(0.0));
    assert_eq!(output.value["maximum"], json!(0.0));
}

#[test]
fn unavailable_axes_fail_explicitly_and_three_d_series_axis_is_available() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const source = sheet.getRange("A1:B3");
        source.values = [["Category", "Value"], ["A", 1], ["B", 2]];
        const pie = sheet.charts.add(Excel.ChartType.pie, source);
        const threeD = sheet.charts.add(Excel.ChartType._3DColumnClustered, source);
        await context.sync();
        let pieCode;
        try {
          const axis = pie.axes.valueAxis;
          axis.load("type");
          await context.sync();
        } catch (error) { pieCode = error.code; }
        const series = threeD.axes.getItem(Excel.ChartAxisType.series);
        series.load(["type", "axisGroup"]);
        await context.sync();
        return { pieCode, series: series.toJSON() };
      });
    "#,
    )
    .expect("axis availability should be reported by the host");

    assert_eq!(output.value["pieCode"], json!("ItemNotFound"));
    assert_eq!(
        output.value["series"],
        json!({"type": "Series", "axisGroup": "Primary"})
    );
}
