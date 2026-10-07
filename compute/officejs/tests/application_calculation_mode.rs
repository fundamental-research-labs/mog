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
    assert_eq!(result.value, json!({"mode":"Automatic","values":[[7],[2]]}));
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
    w.sheet_by_index(0).unwrap().set_cell("A1", "7").unwrap();
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
    assert_eq!(result.value, json!({"mode":"Manual","values":[[7],[14]]}));
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

/// The diagnostic Office namespace is test-only. It supplies no calculation
/// behavior and advertises no Office requirement support. Frozen action scripts
/// remain byte-for-byte unchanged from the Excel 16.0.20430.20146 probes.
#[test]
fn native_20430_reported_mode_runtime_and_reopen_are_distinct() {
    use std::{fs, process::Command};
    let cases = [
        (
            "manual-to-automatic",
            include_bytes!("fixtures/calculation_mode_20430/manual-to-automatic-input.xlsx")
                .as_slice(),
            include_str!("fixtures/calculation_mode_20430/manual-to-automatic.js"),
            "Manual",
            "manual",
            14.0,
        ),
        (
            "auto-to-manual",
            include_bytes!("fixtures/calculation_mode_20430/auto-to-manual-input.xlsx").as_slice(),
            include_str!("fixtures/calculation_mode_20430/auto-to-manual.js"),
            "Automatic",
            "auto",
            6.0,
        ),
    ];
    for (name, input, original_script, reported, stored, dependent) in cases {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("input.xlsx"), input).unwrap();
        let shim = "globalThis.Office={context:{requirements:{isSetSupported:()=>false},diagnostics:{host:'MOG test harness'}}};\n";
        fs::write(
            dir.path().join("script.js"),
            format!("{shim}{original_script}"),
        )
        .unwrap();
        let out = Command::new(env!("CARGO_BIN_EXE_mog"))
            .current_dir(dir.path())
            .args(["-i", "input.xlsx", "-f", "script.js", "-o", "saved.xlsx"])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{name}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let lines: Vec<serde_json::Value> = String::from_utf8(out.stdout)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(lines.len(), 6, "{name}");
        assert_eq!(lines[0]["stage"], "environment");
        assert_eq!(lines[0]["supports18"], false);
        assert_eq!(lines[0]["diagnostics"]["host"], "MOG test harness");
        assert_eq!(
            &lines[1..],
            &[
                json!({"stage":"before","mode":reported,"values":[[3],[6]]}),
                json!({"stage":"same_sync_after_set","mode":reported}),
                json!({"stage":"fresh_sync","mode":reported}),
                json!({"stage":"fresh_run_proxy","mode":reported}),
                json!({"stage":"after_precedent_edit","mode":reported,"values":[[7],[dependent as i64]]}),
            ],
            "{name}"
        );
        // API import preserves raw saved caches; CLI reopen applies open policy.
        let saved = Workbook::from_xlsx_path(dir.path().join("saved.xlsx").to_str().unwrap())
            .unwrap()
            .0;
        assert_eq!(saved.settings().calculation_mode().unwrap(), stored);
        assert_eq!(
            saved
                .sheet_by_index(0)
                .unwrap()
                .get_cell_value("A2")
                .unwrap(),
            CellValue::number(dependent)
        );
        let reopen = Command::new(env!("CARGO_BIN_EXE_mog")).current_dir(dir.path()).args([
            "-i","saved.xlsx","-e","await Excel.run(async c=>{const r=c.workbook.worksheets.getItem('Sheet1').getRange('A1:A2');r.load('values');c.application.load('calculationMode');await c.sync();console.log(JSON.stringify({mode:c.application.calculationMode,values:r.values}));});"
        ]).output().unwrap();
        assert!(
            reopen.status.success(),
            "{name}: {}",
            String::from_utf8_lossy(&reopen.stderr)
        );
        let value: serde_json::Value = serde_json::from_slice(&reopen.stdout).unwrap();
        assert_eq!(
            value,
            json!({"mode":reported,"values":[[7],[14]]}),
            "{name}"
        );
    }
}
