use mog::run_office_js;
use serde_json::json;

#[test]
fn table_sort_applies_to_data_rows_and_preserves_headers() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:C4").values = [
          ["Name", "Score", "Group"],
          ["first", 4, "A"],
          ["second", 9, "B"],
          ["third", 1, "C"]
        ];
        const table = sheet.tables.add("A1:C4", true);
        table.name = "Scores";
        table.sort.apply([{ key: 1, ascending: true }]);
        const header = table.getHeaderRowRange();
        const body = table.getDataBodyRange();
        header.load("values");
        body.load("values");
        await context.sync();
        return { header: header.values, body: body.values };
      });
    "#,
    )
    .expect("table sort should use the production range sorter");

    assert_eq!(
        output.value,
        json!({
            "header": [["Name", "Score", "Group"]],
            "body": [["third", 1, "C"], ["first", 4, "A"], ["second", 9, "B"]]
        })
    );
}

#[test]
fn table_filter_values_and_custom_criteria_persist_and_clear() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B5").values = [
          ["Status", "Amount"],
          ["Open", 10],
          ["Closed", 20],
          ["Open", 30],
          ["Pending", 40]
        ];
        const table = sheet.tables.add("A1:B5", true);
        table.name = "Orders";

        const status = table.columns.getItemAt(0).filter;
        status.applyValuesFilter(["Open"]);
        status.load("criteria");
        await context.sync();
        const valuesCriteria = status.criteria;

        const amount = table.columns.getItemAt(1).filter;
        amount.applyCustomFilter(">15", "<35", "And");
        amount.load("criteria");
        await context.sync();
        const customCriteria = amount.criteria;

        amount.clear();
        amount.load("criteria");
        await context.sync();
        return { valuesCriteria, customCriteria, cleared: amount.criteria };
      });
    "#,
    )
    .expect("table filters should use durable SheetFilters state");

    assert_eq!(
        output.value["valuesCriteria"],
        json!({"filterOn": "Values", "values": ["Open"]})
    );
    assert_eq!(
        output.value["customCriteria"],
        json!({
            "filterOn": "Custom",
            "criterion1": ">15",
            "criterion2": "<35",
            "operator": "And"
        })
    );
    assert_eq!(
        output.value["cleared"],
        json!({"filterOn": "Values", "values": []})
    );
}

#[test]
fn table_filter_wrappers_cover_top_bottom_percent_and_dynamic_rules() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B6").values = [
          ["Name", "Score"],
          ["A", 1],
          ["B", 2],
          ["C", 3],
          ["D", 4],
          ["E", 5]
        ];
        const table = sheet.tables.add("A1:B6", true);
        table.name = "Scores";
        const filter = table.columns.getItemAt(1).filter;

        filter.applyTopItemsFilter(2);
        filter.load("criteria");
        await context.sync();
        const top = filter.criteria;

        filter.applyBottomPercentFilter(40);
        filter.load("criteria");
        await context.sync();
        const bottomPercent = filter.criteria;

        filter.applyDynamicFilter("AboveAverage");
        filter.load("criteria");
        await context.sync();
        return { top, bottomPercent, dynamic: filter.criteria };
      });
    "#,
    )
    .expect("table filter convenience methods should persist");

    assert_eq!(
        output.value,
        json!({
            "top": {"filterOn": "TopItems", "criterion1": "2"},
            "bottomPercent": {"filterOn": "BottomPercent", "criterion1": "40"},
            "dynamic": {"filterOn": "Dynamic", "dynamicCriteria": "AboveAverage"}
        })
    );
}

#[test]
fn table_sort_and_filter_reject_unsupported_or_out_of_bounds_descriptors() {
    let output = run_office_js(
        r#"
      await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1:B3").values = [
          ["Name", "Score"],
          ["A", 2],
          ["B", 1]
        ];
        const table = sheet.tables.add("A1:B3", true);
        table.name = "Scores";
        await context.sync();
      });

      let sortCode;
      try {
        await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const table = sheet.tables.getItem("Scores");
          table.sort.apply([{ key: 2 }]);
          await context.sync();
        });
      } catch (error) { sortCode = error.code; }

      let iconCode;
      try {
        await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          const table = sheet.tables.getItem("Scores");
          table.columns.getItemAt(0).filter.applyIconFilter({
            set: "ThreeArrows",
            index: 0
          });
          await context.sync();
        });
      } catch (error) { iconCode = error.code; }
      return { sortCode, iconCode };
    "#,
    )
    .expect("descriptor failures should be observable at sync");

    assert_eq!(
        output.value,
        json!({"sortCode": "InvalidArgument", "iconCode": "UnsupportedOperation"})
    );
}
