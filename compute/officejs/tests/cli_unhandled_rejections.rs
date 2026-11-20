//! Script failures must be detected before the CLI publishes an XLSX.
use std::{fs, path::Path, process::Command};

use compute_api::Workbook;
use value_types::CellValue;

const UNAWAITED_RUN: &str = r#"
    Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1").values = [["before-throw"]];
        await context.sync();
        throw new Error("boom");
    });
"#;

const DETACHED_ASYNC: &str = r#"
    await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        sheet.getRange("A1").values = [["before-throw"]];
        await context.sync();
        (async () => {
            await Promise.resolve();
            throw new Error("boom");
        })();
    });
"#;

fn run_script(directory: &Path, source: &str) -> std::process::Output {
    let script = directory.join("script.js");
    fs::write(&script, source).unwrap();
    Command::new(env!("CARGO_BIN_EXE_mog"))
        .arg("--file")
        .arg(script)
        .arg("--output")
        .arg(directory.join("output.xlsx"))
        .output()
        .unwrap()
}

fn assert_rejection_prevents_save(source: &str, existing: bool) {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("output.xlsx");
    let original = if existing {
        let (workbook, _) = Workbook::blank().unwrap();
        let bytes = workbook.to_xlsx_bytes().unwrap();
        fs::write(&destination, &bytes).unwrap();
        Some(bytes)
    } else {
        None
    };

    let output = run_script(directory.path(), source);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        !output.status.success(),
        "rejected script exited successfully; output exists: {}; stderr: {stderr}",
        destination.exists()
    );
    assert!(stderr.contains("boom"), "{stderr}");
    if let Some(original) = original {
        assert_eq!(fs::read(destination).unwrap(), original);
    } else {
        assert!(!destination.exists(), "failed script created an XLSX");
    }
}

#[test]
fn unawaited_run_rejection_does_not_create_output() {
    assert_rejection_prevents_save(UNAWAITED_RUN, false);
}

#[test]
fn unawaited_run_rejection_does_not_replace_output() {
    assert_rejection_prevents_save(UNAWAITED_RUN, true);
}

#[test]
fn detached_async_rejection_does_not_create_output() {
    assert_rejection_prevents_save(DETACHED_ASYNC, false);
}

#[test]
fn detached_async_rejection_does_not_replace_output() {
    assert_rejection_prevents_save(DETACHED_ASYNC, true);
}

fn assert_successful_save(source: &str) {
    let directory = tempfile::tempdir().unwrap();
    let output = run_script(directory.path(), source);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let (workbook, _) =
        Workbook::from_xlsx_path(directory.path().join("output.xlsx").to_str().unwrap()).unwrap();
    assert_eq!(
        workbook
            .sheet_by_index(0)
            .unwrap()
            .get_cell_value("A1")
            .unwrap(),
        CellValue::from("saved")
    );
}

#[test]
fn awaited_caught_rejection_allows_save() {
    assert_successful_save(
        r#"
        try {
            await Excel.run(async context => {
                await context.sync();
                throw new Error("caught");
            });
        } catch (error) {
            if (error.message !== "caught") throw error;
        }
        await Excel.run(async context => {
            context.workbook.worksheets.getItem("Sheet1").getRange("A1").values = [["saved"]];
        });
        "#,
    );
}

#[test]
fn attached_catch_allows_save() {
    assert_successful_save(
        r#"
        Excel.run(async context => {
            await context.sync();
            throw new Error("caught");
        }).catch(async error => {
            if (error.message !== "caught") throw error;
            await Excel.run(async context => {
                context.workbook.worksheets.getItem("Sheet1").getRange("A1").values = [["saved"]];
            });
        });
        "#,
    );
}

#[test]
fn successful_unawaited_run_finishes_before_save() {
    assert_successful_save(
        r#"
        Excel.run(async context => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
            context.workbook.worksheets.getItem("Sheet1").getRange("A1").values = [["saved"]];
        });
        "#,
    );
}
