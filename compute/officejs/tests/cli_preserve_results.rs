//! Opt-in post-script cache preservation, including session request boundaries.
use compute_api::Workbook;
use std::{
    fs,
    process::{Command, Output},
};
use tempfile::TempDir;
use value_types::CellValue;

struct Fixture(TempDir);
impl Fixture {
    fn new() -> Self {
        let f = Self(tempfile::tempdir().unwrap());
        fs::write(
            f.0.path().join("input.xlsx"),
            include_bytes!("fixtures/preserve_results_manual.xlsx"),
        )
        .unwrap();
        f
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_mog"))
            .current_dir(self.0.path())
            .env("MOG_SESSION_DIR", self.0.path().join("sessions"))
            .args(args)
            .output()
            .unwrap()
    }
    fn ok(&self, args: &[&str]) -> String {
        let o = self.run(args);
        assert!(
            o.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&o.stderr)
        );
        String::from_utf8(o.stdout).unwrap().trim().to_owned()
    }
    fn book(&self, path: &str) -> Workbook {
        Workbook::from_xlsx_path(self.0.path().join(path).to_str().unwrap())
            .unwrap()
            .0
    }
    fn values(&self, path: &str, a1: f64, a2: f64) {
        let w = self.book(path);
        let s = w.sheet_by_index(0).unwrap();
        assert_eq!(s.get_cell_value("A1").unwrap(), CellValue::number(a1));
        assert_eq!(s.get_cell_value("A2").unwrap(), CellValue::number(a2));
        assert_eq!(s.get_formula("A2").unwrap().as_deref(), Some("=A1*2"));
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.run(&["--close-all", "--discard"]);
    }
}
const READ: &str = r#"await Excel.run(async c => {
 const r=c.workbook.worksheets.getItem('Sheet1').getRange('A1:A2');
 r.load('values'); await c.sync(); console.log(JSON.stringify(r.values));
});"#;
const EDIT: &str = r#"await Excel.run(async c => {
 const s=c.workbook.worksheets.getItem('Sheet1'); s.getRange('A1').values=[[7]];
 const r=s.getRange('A1:A2');r.load('values');await c.sync();console.log(JSON.stringify(r.values));
});"#;

#[test]
fn preserve_read_unrelated_edit_and_reimport_keep_imported_caches() {
    let f = Fixture::new();
    assert_eq!(
        f.ok(&[
            "-i",
            "input.xlsx",
            "-e",
            READ,
            "--preserve-results",
            "-o",
            "read.xlsx"
        ]),
        "[[42],[84]]"
    );
    f.values("read.xlsx", 42.0, 84.0);
    assert_eq!(
        f.book("read.xlsx")
            .sheet_by_index(0)
            .unwrap()
            .get_formula("A1")
            .unwrap()
            .as_deref(),
        Some("=CUSTOMFUNC(2)")
    );
    f.ok(&["-i","read.xlsx","--preserve-results","-e","await Excel.run(async c=>{c.workbook.worksheets.getItem('Sheet1').getRange('B1').values=[[9]];await c.sync();});","-o","edited.xlsx"]);
    f.values("edited.xlsx", 42.0, 84.0);
    assert_eq!(
        f.book("edited.xlsx")
            .sheet_by_index(0)
            .unwrap()
            .get_cell_value("B1")
            .unwrap(),
        CellValue::number(9.0)
    );
}

#[test]
fn precedent_edit_keeps_stale_dependent_until_explicit_recalculation() {
    let f = Fixture::new();
    assert_eq!(
        f.ok(&[
            "-i",
            "input.xlsx",
            "-e",
            EDIT,
            "--preserve-results",
            "-o",
            "edited.xlsx"
        ]),
        "[[7],[84]]"
    );
    f.values("edited.xlsx", 7.0, 84.0);
    assert_eq!(
        f.book("edited.xlsx")
            .sheet_by_index(0)
            .unwrap()
            .get_formula("A1")
            .unwrap(),
        None
    );
    assert_eq!(
        f.ok(&[
            "-i",
            "edited.xlsx",
            "--preserve-results",
            "-e",
            READ,
            "-o",
            "reimported.xlsx"
        ]),
        "[[7],[84]]"
    );
    f.values("reimported.xlsx", 7.0, 84.0);
    f.ok(&["-i", "reimported.xlsx", "-r", "-o", "calculated.xlsx"]);
    f.values("calculated.xlsx", 7.0, 14.0);
}

#[test]
fn default_manual_script_preserves_and_automatic_transition_recalculates() {
    let f = Fixture::new();
    assert_eq!(
        f.ok(&["-i", "input.xlsx", "-e", READ, "-o", "default.xlsx"]),
        "[[42],[84]]"
    );
    f.values("default.xlsx", 42.0, 84.0);
    assert_eq!(
        f.book("default.xlsx")
            .settings()
            .calculation_mode()
            .unwrap(),
        "manual"
    );
    f.ok(&[
        "-i",
        "default.xlsx",
        "-e",
        "await Excel.run(async c=>{c.application.calculationMode='Automatic';await c.sync();});",
        "-o",
        "auto.xlsx",
    ]);
    let w = f.book("auto.xlsx");
    let sheet = w.sheet_by_index(0).unwrap();
    assert!(matches!(
        sheet.get_cell_value("A1").unwrap(),
        CellValue::Error(..)
    ));
    assert!(matches!(
        sheet.get_cell_value("A2").unwrap(),
        CellValue::Error(..)
    ));
    assert_eq!(w.settings().calculation_mode().unwrap(), "auto");
}

#[test]
fn conflicting_flags_fail_before_script_or_output_writes() {
    let f = Fixture::new();
    fs::write(f.0.path().join("output.xlsx"), b"sentinel").unwrap();
    for flags in [
        ["--preserve-results", "-r"],
        ["--recalculate", "--preserve-results"],
    ] {
        let o = f.run(&[
            "-i",
            "input.xlsx",
            "-o",
            "output.xlsx",
            "-e",
            "throw new Error('executed');",
            flags[0],
            flags[1],
        ]);
        assert!(!o.status.success());
        assert!(String::from_utf8_lossy(&o.stderr).contains("conflicts"));
        assert_eq!(
            fs::read(f.0.path().join("output.xlsx")).unwrap(),
            b"sentinel"
        );
    }
}

#[test]
fn session_mode_persists_but_request_flag_does_not_override_later_mode_changes() {
    let f = Fixture::new();
    let id = f.ok(&[
        "-s",
        "-i",
        "input.xlsx",
        "-o",
        "session.xlsx",
        "--preserve-results",
        "-e",
        EDIT,
    ]);
    assert_eq!(
        f.ok(&["-s", &id, "--preserve-results", "-e", READ]),
        "[[7],[84]]"
    );
    let bad = f.run(&["-s", &id, "--preserve-results", "-r"]);
    assert!(!bad.status.success());
    assert_eq!(
        f.ok(&["-s", &id, "--preserve-results", "-e", READ]),
        "[[7],[84]]"
    );
    f.ok(&["-s", &id, "-r"]);
    assert_eq!(
        f.ok(&["-s", &id, "--preserve-results", "-e", READ]),
        "[[7],[14]]"
    );
    f.ok(&["-s", &id, "--close"]);
    f.values("session.xlsx", 7.0, 14.0);

    let id = f.ok(&[
        "-s",
        "-i",
        "input.xlsx",
        "-o",
        "nonsticky.xlsx",
        "--preserve-results",
        "-e",
        EDIT,
    ]);
    f.ok(&["-s", &id, "-e", "return 1;"]);
    assert_eq!(f.ok(&["-s", &id, "-e", READ]), "[[7],[84]]");
    f.ok(&[
        "-s",
        &id,
        "-e",
        "await Excel.run(async c=>{c.application.calculationMode='Automatic';await c.sync();});",
    ]);
    assert_eq!(
        f.ok(&["-s", &id, "--preserve-results", "-e", READ]),
        "[[7],[14]]"
    );
    f.ok(&["-s", &id, "--close"]);
    f.values("nonsticky.xlsx", 7.0, 14.0);
}

#[test]
fn older_session_without_capability_rejects_preservation_before_dispatch() {
    let f = Fixture::new();
    let id = f.ok(&["-s", "-i", "input.xlsx"]);
    let path = f.0.path().join("sessions").join(format!("{id}.json"));
    let mut record: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    record.as_object_mut().unwrap().remove("preserve_results");
    fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
    let o = f.run(&["-s", &id, "--preserve-results", "-e", EDIT]);
    assert!(!o.status.success());
    assert!(String::from_utf8_lossy(&o.stderr).contains("restart"));
    f.ok(&["-s", &id, "--close", "-o", "untouched.xlsx"]);
    f.values("untouched.xlsx", 42.0, 84.0);
}

#[test]
fn application_mode_and_full_calculation_are_queued_and_persisted() {
    let f = Fixture::new();
    let script = r#"await Excel.run(async c=>{
      const s=c.workbook.worksheets.getItem('Sheet1');
      c.application.load('calculationMode');await c.sync();
      console.log(c.application.calculationMode);
      c.application.calculationMode='Manual';s.getRange('A1').values=[[7]];
      const r=s.getRange('A1:A2');r.load('values');await c.sync();console.log(JSON.stringify(r.values));
      c.application.calculate(Excel.CalculationType.full);r.load('values');
      c.application.load('calculationMode');await c.sync();console.log(JSON.stringify(r.values));console.log(c.application.calculationMode);
    });"#;
    assert_eq!(
        f.ok(&["-i", "input.xlsx", "-e", script, "-o", "full.xlsx"]),
        "Manual\n[[7],[84]]\n[[7],[14]]\nManual"
    );
    f.values("full.xlsx", 7.0, 14.0);
    assert_eq!(
        f.book("full.xlsx").settings().calculation_mode().unwrap(),
        "manual"
    );
}

#[test]
fn preserve_flag_sets_manual_mode_before_auto_workbook_edit_and_saves_it() {
    let f = Fixture::new();
    let w = f.book("input.xlsx");
    w.settings().set_calculation_mode("auto").unwrap();
    w.to_xlsx_path(f.0.path().join("auto.xlsx").to_str().unwrap())
        .unwrap();
    assert_eq!(
        f.ok(&[
            "-i",
            "auto.xlsx",
            "--preserve-results",
            "-e",
            EDIT,
            "-o",
            "manual.xlsx"
        ]),
        "[[7],[84]]"
    );
    f.values("manual.xlsx", 7.0, 84.0);
    assert_eq!(
        f.book("manual.xlsx").settings().calculation_mode().unwrap(),
        "manual"
    );
    // This is a local override contract, not a claim about Excel automatic-mode open timing.
}

#[test]
fn imported_mode_and_calculation_on_save_control_live_and_saved_values() {
    let cases: [(&[u8], &str, bool, bool); 4] = [
        (
            include_bytes!("fixtures/calculation_manual-no-save.xlsx"),
            "manual",
            false,
            false,
        ),
        (
            include_bytes!("fixtures/calculation_manual-save.xlsx"),
            "manual",
            true,
            false,
        ),
        (
            include_bytes!("fixtures/calculation_automatic.xlsx"),
            "auto",
            true,
            true,
        ),
        (
            include_bytes!("fixtures/calculation_automatic-no-save.xlsx"),
            "auto",
            false,
            true,
        ),
    ];
    for (bytes, mode, save_calc, live_error) in cases {
        let f = Fixture::new();
        fs::write(f.0.path().join("input.xlsx"), bytes).unwrap();
        let original = f
            .book("input.xlsx")
            .settings()
            .get_workbook_settings()
            .unwrap()
            .calculation_settings
            .unwrap();
        assert_eq!(original.calc_on_save, save_calc);
        assert_eq!(
            f.book("input.xlsx").settings().calculation_mode().unwrap(),
            mode
        );
        let stdout = f.ok(&["-i", "input.xlsx", "-e", READ, "-o", "output.xlsx"]);
        assert_eq!(
            stdout,
            if live_error {
                "[[\"#NAME?\"],[\"#NAME?\"]]"
            } else {
                "[[42],[84]]"
            }
        );
        let w = f.book("output.xlsx");
        let sheet = w.sheet_by_index(0).unwrap();
        if live_error || save_calc {
            assert!(matches!(
                sheet.get_cell_value("A1").unwrap(),
                CellValue::Error(..)
            ));
            assert!(matches!(
                sheet.get_cell_value("A2").unwrap(),
                CellValue::Error(..)
            ));
        } else {
            f.values("output.xlsx", 42.0, 84.0);
        }
        // Existing MOG export policy identifies its calculation engine as 0;
        // all calculation behavior settings must remain intact.
        let mut exported_settings = original;
        exported_settings.calc_id = Some(0);
        assert_eq!(
            w.settings()
                .get_workbook_settings()
                .unwrap()
                .calculation_settings
                .unwrap(),
            exported_settings
        );
        f.ok(&["-i", "input.xlsx", "-o", "no-script.xlsx"]);
        let no_script = f.book("no-script.xlsx");
        assert_eq!(
            no_script
                .sheet_by_index(0)
                .unwrap()
                .get_cell_value("A1")
                .unwrap(),
            sheet.get_cell_value("A1").unwrap()
        );
        // A session also delays save-time calculation until close.
        let id = f.ok(&["-s", "-i", "input.xlsx", "-o", "session-mode.xlsx"]);
        assert_eq!(f.ok(&["-s", &id, "-e", READ]), stdout);
        assert!(!f.0.path().join("session-mode.xlsx").exists());
        f.ok(&["-s", &id, "--close"]);
        assert_eq!(
            f.book("session-mode.xlsx")
                .sheet_by_index(0)
                .unwrap()
                .get_cell_value("A1")
                .unwrap(),
            sheet.get_cell_value("A1").unwrap()
        );
    }
}

#[test]
fn queued_full_calculation_sees_preceding_unsynced_writes() {
    let f = Fixture::new();
    let script = r#"await Excel.run(async c=>{
      const s=c.workbook.worksheets.getItem('Sheet1');
      s.getRange('A1').values=[[7]];
      c.application.calculate('Full');
      const r=s.getRange('A1:A2');r.load('values');await c.sync();
      console.log(JSON.stringify(r.values));
    });"#;
    assert_eq!(
        f.ok(&["-i", "input.xlsx", "-e", script, "-o", "queued.xlsx"]),
        "[[7],[14]]"
    );
    f.values("queued.xlsx", 7.0, 14.0);
}
