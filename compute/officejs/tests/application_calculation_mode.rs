//! Office.js runtime mode is workbook-session state, not persisted calcMode.
use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;
use value_types::CellValue;

fn automatic_book() -> Workbook {
    let w = Workbook::blank().unwrap().0;
    let s = w.sheet_by_index(0).unwrap();
    s.set_cell("A1", "1").unwrap();
    s.set_cell("A2", "=A1*2").unwrap();
    w.recalculate().unwrap();
    w
}

#[test]
fn runtime_mode_survives_contexts_but_does_not_leak_to_other_workbooks_or_export() {
    let w = automatic_book();
    run_office_js_with_workbook(
        &w,
        r#"await Excel.run(async c=>{
      c.application.calculationMode='Manual';await c.sync();
    });"#,
    )
    .unwrap();
    let result = run_office_js_with_workbook(&w, r#"return await Excel.run(async c=>{
      const s=c.workbook.worksheets.getItem('Sheet1');s.getRange('A1').values=[[7]];
      const r=s.getRange('A1:A2');r.load('values');c.application.load('calculationMode');await c.sync();
      return {mode:c.application.calculationMode,values:r.values};
    });"#).unwrap();
    assert_eq!(result.value, json!({"mode":"Manual","values":[[7],[2]]}));
    assert_eq!(w.settings().calculation_mode().unwrap(), "auto");
    assert_eq!(
        w.clone().settings().runtime_calculation_mode().unwrap(),
        "manual"
    );
    let other = automatic_book();
    assert_eq!(other.settings().runtime_calculation_mode().unwrap(), "auto");
    other
        .sheet_by_index(0)
        .unwrap()
        .set_cell("A1", "8")
        .unwrap();
    assert_eq!(
        other
            .sheet_by_index(0)
            .unwrap()
            .get_cell_value("A2")
            .unwrap(),
        CellValue::number(16.0)
    );
    let reopened = Workbook::from_xlsx_bytes(&w.to_xlsx_bytes().unwrap())
        .unwrap()
        .0;
    assert_eq!(reopened.settings().calculation_mode().unwrap(), "auto");
    assert_eq!(
        reopened.settings().runtime_calculation_mode().unwrap(),
        "auto"
    );
    assert_eq!(w.settings().runtime_calculation_mode().unwrap(), "manual");
}

#[test]
fn runtime_override_survives_unrelated_persisted_settings_changes() {
    let w = automatic_book();
    w.settings().set_runtime_calculation_mode("manual").unwrap();
    w.settings().set_max_iterations(33).unwrap();
    assert_eq!(w.settings().runtime_calculation_mode().unwrap(), "manual");
    assert_eq!(w.settings().calculation_mode().unwrap(), "auto");
    w.sheet_by_index(0)
        .unwrap()
        .set_cell("A1", "7")
        .unwrap();
    assert_eq!(
        w.sheet_by_index(0).unwrap().get_cell_value("A2").unwrap(),
        CellValue::number(2.0)
    );
}

#[test]
fn automatic_runtime_transition_calculates_without_changing_imported_manual_mode() {
    let w = Workbook::from_xlsx_bytes(include_bytes!("fixtures/preserve_results_manual.xlsx"))
        .unwrap()
        .0;
    let result=run_office_js_with_workbook(&w,r#"return await Excel.run(async c=>{
      const s=c.workbook.worksheets.getItem('Sheet1');s.getRange('A1').values=[[7]];
      c.application.calculationMode='Automatic';
      const r=s.getRange('A1:A2');r.load('values');c.application.load('calculationMode');await c.sync();
      return {mode:c.application.calculationMode,values:r.values};
    });"#).unwrap();
    assert_eq!(
        result.value,
        json!({"mode":"Automatic","values":[[7],[14]]})
    );
    assert_eq!(w.settings().calculation_mode().unwrap(), "manual");
    let reopened = Workbook::from_xlsx_bytes(&w.to_xlsx_bytes().unwrap())
        .unwrap()
        .0;
    assert_eq!(
        reopened.settings().runtime_calculation_mode().unwrap(),
        "manual"
    );
    reopened
        .sheet_by_index(0)
        .unwrap()
        .set_cell("A1", "8")
        .unwrap();
    assert_eq!(
        reopened
            .sheet_by_index(0)
            .unwrap()
            .get_cell_value("A2")
            .unwrap(),
        CellValue::number(14.0)
    );
}
