use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;

#[test]
fn malformed_note_formulas_reject_the_range_before_mutation() {
    for property in ["values", "formulas"] {
        let workbook = Workbook::blank().unwrap().0;
        let script = format!(
            r#"
            await Excel.run(async (context) => {{
              const sheet = context.workbook.worksheets.getItem("Sheet1");
              sheet.getRange("N22:N23").values = [[17], [23]];
              await context.sync();
            }});
            let errorCode = null;
            let message = null;
            try {{
              await Excel.run(async (context) => {{
                const sheet = context.workbook.worksheets.getItem("Sheet1");
                sheet.getRange("N22:N23").{property} = [
                  [99], ["= Revenue - operating costs (management note)."]
                ];
                await context.sync();
              }});
            }} catch (error) {{
              errorCode = error.code;
              message = error.message;
            }}
            return await Excel.run(async (context) => {{
              const read = context.workbook.worksheets.getItem("Sheet1").getRange("N22:N23");
              read.load("values,formulas");
              await context.sync();
              return {{ errorCode, message, values: read.values, formulas: read.formulas }};
            }});
            "#
        );
        let result = run_office_js_with_workbook(&workbook, &script).unwrap();
        assert_eq!(result.value["errorCode"], "InvalidArgument", "{property}");
        let message = result.value["message"].as_str().unwrap();
        assert!(message.contains("Sheet1!N23"), "{message}");
        assert!(message.contains("literal text note"), "{message}");
        assert_eq!(result.value["values"], json!([[17], [23]]), "{property}");
        assert_eq!(result.value["formulas"], json!([[17], [23]]), "{property}");
    }
}

#[test]
fn explicit_text_notes_survive_export_without_formula_records() {
    let workbook = Workbook::blank().unwrap().0;
    let note = "= Revenue - operating costs (management note).";
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("N23:P23").numberFormat = [["@", "@", "@"]];
          sheet.getRange("N23:P23").values = [["= Revenue - operating costs (management note).", "+ included items", "- excluded items"]];
          sheet.getRange("N24").values = [["'= Revenue - operating costs (management note)."]];
          await context.sync();
        });
        "#,
    )
    .unwrap();
    let bytes = workbook.to_xlsx_bytes().unwrap();
    let xml = String::from_utf8(
        xlsx_parser::zip::XlsxArchive::new(&bytes)
            .unwrap()
            .read_file("xl/worksheets/sheet1.xml")
            .unwrap(),
    )
    .unwrap();
    assert!(!xml.contains("<f>"), "{xml}");
    let reopened = Workbook::from_xlsx_bytes(&bytes).unwrap().0;
    let sheet = reopened.sheet_by_name("Sheet1").unwrap();
    for address in ["N23", "N24"] {
        assert_eq!(sheet.get_formula(address).unwrap(), None);
        assert_eq!(sheet.get_cell_value(address).unwrap().to_string(), note);
    }
    for (address, text) in [("O23", "+ included items"), ("P23", "- excluded items")] {
        assert_eq!(sheet.get_formula(address).unwrap(), None);
        assert_eq!(sheet.get_cell_value(address).unwrap().to_string(), text);
    }
}

#[test]
fn implicit_table_formulas_are_validated_in_the_target_table() {
    let workbook = Workbook::blank().unwrap().0;
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:C3").values = [["Price", "Qty", "Total"], [4, 3, 0], [7, 2, 0]];
          sheet.tables.add("A1:C3", true).name = "Orders";
          await context.sync();
          sheet.getRange("C2:C3").formulas = [["=[@Price]*[@Qty]"], ["=[@Price]*[@Qty]"]];
          const read = sheet.getRange("C2:C3");
          read.load("values");
          await context.sync();
          return read.values;
        });
    "#,
    )
    .unwrap();
    assert_eq!(output.value, json!([[12], [14]]));
}

#[test]
fn valid_calculations_and_text_results_keep_formula_intent() {
    let workbook = Workbook::blank().unwrap().0;
    let result = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("A1:F1").formulas = [[
            "=1+2", "=SUM(A1", "=MissingName", "=UnknownFunction(1)",
            "=\"Revenue - operating costs (management note).\"", "=A1*2"
          ]];
          const read = sheet.getRange("A1:F1");
          read.load("values,formulas");
          await context.sync();
          return {values: read.values, formulas: read.formulas};
        });
        "#,
    )
    .unwrap();
    assert_eq!(result.value["values"][0][0], 3);
    assert_eq!(result.value["values"][0][1], 3);
    assert_eq!(
        result.value["values"][0][4],
        "Revenue - operating costs (management note)."
    );
    assert_eq!(result.value["values"][0][5], 6);
    for address in ["A1", "B1", "C1", "D1", "E1", "F1"] {
        assert!(
            workbook
                .sheet_by_name("Sheet1")
                .unwrap()
                .get_formula(address)
                .unwrap()
                .is_some()
        );
    }
}
