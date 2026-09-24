//! End-to-end CLI contracts. Every fixture has an isolated session registry and
//! closes its workers on drop, including when an assertion fails.
use compute_api::Workbook;
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};
use tempfile::TempDir;
use value_types::CellValue;

struct Fixture(TempDir);
impl Fixture {
    fn new() -> Self {
        Self(tempfile::tempdir().unwrap())
    }
    fn path(&self) -> &Path {
        self.0.path()
    }
    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_mog"));
        command
            .current_dir(self.path())
            .env("MOG_SESSION_DIR", self.path().join("sessions"));
        command
    }
    fn run(&self, args: &[&str]) -> Output {
        self.command().args(args).output().unwrap()
    }
    fn ok(&self, args: &[&str]) -> String {
        let output = self.run(args);
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .unwrap()
            .trim_end()
            .to_owned()
    }
    fn fails(&self, args: &[&str], expected: &str) {
        let output = self.run(args);
        assert!(!output.status.success(), "unexpected success: {args:?}");
        assert!(
            String::from_utf8_lossy(&output.stderr).contains(expected),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fn value(&self, file: &str, address: &str) -> CellValue {
        Workbook::from_xlsx_path(self.path().join(file).to_str().unwrap())
            .unwrap()
            .0
            .sheet_by_index(0)
            .unwrap()
            .get_cell_value(address)
            .unwrap()
    }
    fn session(&self) -> String {
        self.ok(&["-s"])
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.run(&["--close-all", "--discard"]);
    }
}

const WRITE: &str = r#"await Excel.run(async c => {
    const s = c.workbook.worksheets.getItem('Sheet1');
    s.getRange('A1').values = [[21]];
    s.getRange('B1').formulas = [['=A1*2']];
    await c.sync();
});"#;
const READ: &str = r#"return await Excel.run(async c => {
    const r = c.workbook.worksheets.getItem('Sheet1').getRange('B1');
    r.load('values'); await c.sync(); return r.values[0][0];
});"#;

// Inject real syscall failures only into the CLI child. This exercises the full
// exporter and session worker without requiring a privileged FUSE/cloud mount.
#[cfg(target_os = "linux")]
fn deny_syscalls(command: &mut Command, syscalls: &[libc::c_long], errno: i32) {
    use std::os::unix::process::CommandExt;
    let instruction = |code, jt, jf, k| libc::sock_filter { code, jt, jf, k };
    let mut filter = vec![instruction(
        (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16,
        0,
        0,
        0,
    )];
    for &syscall in syscalls {
        filter.push(instruction(
            (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16,
            0,
            1,
            syscall as u32,
        ));
        filter.push(instruction(
            (libc::BPF_RET | libc::BPF_K) as u16,
            0,
            0,
            libc::SECCOMP_RET_ERRNO | errno as u32,
        ));
    }
    filter.push(instruction(
        (libc::BPF_RET | libc::BPF_K) as u16,
        0,
        0,
        libc::SECCOMP_RET_ALLOW,
    ));
    // SAFETY: after fork this only constructs a stack value and calls prctl.
    // The filter was allocated in the parent and remains alive during both calls.
    unsafe {
        command.pre_exec(move || {
            let program = libc::sock_fprog {
                len: filter.len() as u16,
                filter: filter.as_ptr() as *mut _,
            };
            if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0
                || libc::prctl(libc::PR_SET_SECCOMP, libc::SECCOMP_MODE_FILTER, &program) != 0
            {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(target_os = "linux")]
#[test]
fn unsupported_rename_and_permissions_fall_back_for_new_and_imported_workbooks() {
    let f = Fixture::new();
    for errno in [libc::ENOSYS, libc::EOPNOTSUPP, libc::EXDEV] {
        for imported in [false, true] {
            let mut command = f.command();
            deny_syscalls(&mut command, &[libc::SYS_renameat], errno);
            if errno != libc::EXDEV {
                deny_syscalls(&mut command, &[libc::SYS_fchmod], errno);
            }
            if imported {
                command.args([
                    "-i",
                    "output.xlsx",
                    "-e",
                    "await Excel.run(async c => { await c.sync(); });",
                ]);
            } else {
                command.args(["-e", WRITE]);
            }
            let output = command.args(["-o", "output.xlsx"]).output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stderr).contains("replacement was not atomic"));
            assert_eq!(f.value("output.xlsx", "B1"), CellValue::number(42.0));
            assert_eq!(fs::read_dir(f.path()).unwrap().count(), 1);
        }
        fs::remove_file(f.path().join("output.xlsx")).unwrap();
    }
}

#[cfg(target_os = "linux")]
#[test]
fn copy_fallback_claims_automatic_names_without_overwriting_concurrent_saves() {
    let f = Fixture::new();
    let mut children: Vec<_> = (0..4)
        .map(|_| {
            let mut command = f.command();
            deny_syscalls(
                &mut command,
                &[
                    libc::SYS_renameat,
                    libc::SYS_renameat2,
                    libc::SYS_linkat,
                    libc::SYS_fchmod,
                ],
                libc::ENOSYS,
            );
            command
                .args(["-e", WRITE])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap()
        })
        .collect();
    for child in children.drain(..) {
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stderr).contains("replacement was not atomic"));
    }
    for name in [
        "workbook.xlsx",
        "workbook-2.xlsx",
        "workbook-3.xlsx",
        "workbook-4.xlsx",
    ] {
        assert_eq!(f.value(name, "B1"), CellValue::number(42.0));
    }
    assert_eq!(fs::read_dir(f.path()).unwrap().count(), 4);
}

#[cfg(target_os = "linux")]
#[test]
fn session_close_and_close_all_deliver_copy_warnings_to_the_client() {
    let f = Fixture::new();
    for close_all in [false, true] {
        let mut command = f.command();
        // Leave renameat2 available for the private session registry.
        deny_syscalls(
            &mut command,
            &[libc::SYS_renameat, libc::SYS_fchmod],
            libc::ENOSYS,
        );
        let output = command
            .args(["-s", "-e", WRITE, "-o", "output.xlsx"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let id = String::from_utf8(output.stdout).unwrap();
        let output = if close_all {
            f.run(&["--close-all"])
        } else {
            f.run(&["-s", id.trim(), "--close"])
        };
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stderr).contains("replacement was not atomic"));
        assert!(output.stdout.is_empty());
        assert_eq!(f.value("output.xlsx", "B1"), CellValue::number(42.0));
        assert_eq!(fs::read_dir(f.path().join("sessions")).unwrap().count(), 0);
    }
}

#[cfg(target_os = "linux")]
#[test]
fn permission_and_sync_errors_do_not_trigger_copy_or_damage_destination() {
    let f = Fixture::new();
    f.ok(&["-e", WRITE, "-o", "output.xlsx"]);
    let before = fs::read(f.path().join("output.xlsx")).unwrap();
    for (syscall, errno, operation) in [
        (libc::SYS_renameat, libc::EACCES, "publish temporary file"),
        (
            libc::SYS_fchmod,
            libc::EPERM,
            "set temporary export permissions",
        ),
        (libc::SYS_fsync, libc::EIO, "sync temporary export"),
    ] {
        let mut command = f.command();
        deny_syscalls(&mut command, &[syscall], errno);
        let output = command
            .args(["-o", "output.xlsx", "-e", &WRITE.replace("21", "30")])
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(
            String::from_utf8_lossy(&output.stderr).contains(operation),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(fs::read(f.path().join("output.xlsx")).unwrap(), before);
        assert_eq!(fs::read_dir(f.path()).unwrap().count(), 1);
    }
}

#[test]
fn diagnostics_distinguish_import_script_and_successful_save() {
    let f = Fixture::new();
    for (args, expected_stage, expected_status, success) in [
        (
            vec!["-i", "missing.xlsx", "-e", WRITE],
            "load_workbook",
            "failed",
            false,
        ),
        (
            vec!["-e", "throw new Error('broken')"],
            "run_script",
            "failed",
            false,
        ),
        (vec!["-e", WRITE], "save_workbook", "completed", true),
    ] {
        let path = f.path().join(format!("{expected_stage}.jsonl"));
        let output = f
            .command()
            .env("MOG_DIAGNOSTICS_FILE", &path)
            .args(args)
            .output()
            .unwrap();
        assert_eq!(output.status.success(), success);
        let records: Vec<serde_json::Value> = fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert!(
            records
                .iter()
                .any(|r| r["stage"] == expected_stage && r["status"] == expected_status)
        );
        if expected_stage != "load_workbook" {
            assert!(
                records
                    .iter()
                    .any(|r| r["stage"] == "evaluate_javascript" && r["status"] == "started")
            );
        }
        assert!(
            records
                .iter()
                .all(|r| r["pid"].as_u64().is_some() && r["timestamp_ms"].as_u64().is_some())
        );
    }
    // A failed diagnostics sink must not prevent normal workbook work.
    let output = f
        .command()
        .env("MOG_DIAGNOSTICS_FILE", f.path())
        .args(["-e", "return 7"])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), "7");
}

#[cfg(unix)]
#[test]
fn fatal_signal_records_address_and_backtrace_then_reraises() {
    if !cfg!(debug_assertions) {
        return;
    }
    for (hook, signal, status) in [
        ("sigbus", libc::SIGBUS, "sigbus"),
        ("sigsegv", libc::SIGSEGV, "sigsegv"),
    ] {
        let f = Fixture::new();
        let path = f.path().join(format!("{status}.jsonl"));
        let output = f
            .command()
            .env("MOG_DIAGNOSTICS_FILE", &path)
            .env("MOG_DIAGNOSTICS_SELF_TEST", hook)
            .output()
            .unwrap();
        assert_eq!(
            std::os::unix::process::ExitStatusExt::signal(&output.status),
            Some(signal),
            "{hook}: {:?}",
            output.status
        );
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stderr.contains("\"stage\":\"native_fault\""),
            "{hook} stderr: {stderr}"
        );
        let records: Vec<serde_json::Value> = fs::read_to_string(&path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let fault = records
            .iter()
            .find(|record| record["stage"] == "native_fault" && record["status"] == status)
            .unwrap_or_else(|| panic!("{hook} records: {records:?}"));
        assert_eq!(fault["signal"], signal);
        assert!(fault["pid"].as_u64().is_some());
        assert!(fault["timestamp_ms"].as_u64().is_some());
        let address = fault["fault_address"].as_str().unwrap();
        assert!(address.starts_with("0x"), "{address}");
        let frames = fault["backtrace"].as_array().unwrap();
        assert!(!frames.is_empty());
        assert!(frames.iter().all(|frame| {
            frame
                .as_str()
                .is_some_and(|value| value.starts_with("0x") && value.len() > 2)
        }));
    }
}

#[test]
fn session_worker_persists_diagnostics() {
    let f = Fixture::new();
    let path = f.path().join("worker.jsonl");
    let output = f
        .command()
        .env("MOG_DIAGNOSTICS_FILE", &path)
        .args(["-s", "-e", WRITE])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let id = String::from_utf8(output.stdout).unwrap();
    f.ok(&["-s", id.trim(), "--close"]);
    let records: Vec<serde_json::Value> = fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(
        records
            .iter()
            .any(|r| r["stage"] == "save_workbook" && r["status"] == "completed")
    );
    assert_eq!(f.value("workbook.xlsx", "B1"), CellValue::number(42.0));
}

#[test]
fn no_arguments_shows_help_without_creating_files() {
    let f = Fixture::new();
    let output = f.ok(&[]);
    assert!(output.starts_with("Usage: mog"));
    assert_eq!(output, f.ok(&["--help"]));
    assert_eq!(fs::read_dir(f.path()).unwrap().count(), 0);
}

#[test]
fn blank_workbooks_use_collision_safe_names() {
    let f = Fixture::new();
    for name in ["workbook.xlsx", "workbook-2.xlsx", "workbook-3.xlsx"] {
        assert_eq!(f.ok(&["-r"]), "");
        assert!(f.path().join(name).exists());
    }
    let before = fs::read(f.path().join("workbook.xlsx")).unwrap();
    f.ok(&["-e", WRITE]);
    assert_eq!(fs::read(f.path().join("workbook.xlsx")).unwrap(), before);
    assert_eq!(f.value("workbook-4.xlsx", "B1"), CellValue::number(42.0));
}

#[test]
fn concurrent_blank_saves_do_not_overwrite_each_other() {
    let f = Fixture::new();
    let mut children: Vec<_> = (0..4)
        .map(|_| f.command().arg("-r").spawn().unwrap())
        .collect();
    for child in &mut children {
        assert!(child.wait().unwrap().success());
    }
    for name in [
        "workbook.xlsx",
        "workbook-2.xlsx",
        "workbook-3.xlsx",
        "workbook-4.xlsx",
    ] {
        assert!(f.path().join(name).exists());
    }
}

#[test]
fn inline_file_output_and_in_place_input() {
    let f = Fixture::new();
    f.ok(&["--eval", WRITE, "--output", "nested/original.xlsx"]);
    let before = fs::read(f.path().join("nested/original.xlsx")).unwrap();
    fs::write(
        f.path().join("script.js"),
        "console.log('hello'); return 99;",
    )
    .unwrap();
    assert_eq!(
        f.ok(&[
            "-i",
            "nested/original.xlsx",
            "-f",
            "script.js",
            "-o",
            "copy.XLSX"
        ]),
        "hello"
    );
    assert_eq!(
        fs::read(f.path().join("nested/original.xlsx")).unwrap(),
        before
    );
    assert_eq!(f.ok(&["--input=copy.XLSX", "--eval=return 7"]), "7");
    f.ok(&["-i", "copy.XLSX", "-e", &WRITE.replace("21", "30")]);
    assert_eq!(f.value("copy.XLSX", "B1"), CellValue::number(60.0));
}

#[test]
fn failed_script_does_not_save_or_damage_input() {
    let f = Fixture::new();
    f.ok(&["-e", WRITE]);
    let before = fs::read(f.path().join("workbook.xlsx")).unwrap();
    f.fails(
        &["-i", "workbook.xlsx", "-e", "throw new Error('broken')"],
        "broken",
    );
    assert_eq!(fs::read(f.path().join("workbook.xlsx")).unwrap(), before);
    f.fails(&["-e", "throw new Error('broken')"], "broken");
    assert!(!f.path().join("workbook-2.xlsx").exists());
}

#[test]
fn invalid_arguments_and_help_have_no_workbook_side_effects() {
    let f = Fixture::new();
    assert!(f.ok(&["--help"]).contains("--close-all"));
    for (args, message) in [
        (vec!["-i"], "requires a value"),
        (vec!["-o", "--close"], "requires a value"),
        (vec!["-e"], "requires a value"),
        (vec!["-i", "missing.xlsx"], "failed to read"),
        (vec!["-o", "bad.csv"], "output must be .xlsx"),
        (vec!["--unknown"], "unknown option"),
        (vec!["--sesion"], "unknown option: --sesion"),
        (vec!["--close"], "requires -s"),
        (vec!["--discard"], "requires --close"),
        (vec!["--close-all", "-o", "x.xlsx"], "only be combined"),
        (vec!["-e", "return 1", "-f", "script.js"], "either --eval"),
        (vec!["a.js"], "unexpected argument"),
        (vec!["--", "a.js"], "unknown option"),
        (vec!["-f", "a.js", "b.js"], "unexpected argument"),
        (vec!["-f", "a.js", "--file", "b.js"], "more than once"),
        (vec!["-f"], "requires a value"),
        (vec!["--file="], "requires a value"),
        (vec!["--file", "missing.js"], "failed to read script"),
        (vec!["-i", "a.xlsx", "-i", "b.xlsx"], "more than once"),
        (vec!["-s", "../escape"], "invalid session ID"),
        (vec!["-s", ""], "invalid session ID"),
        (vec!["--session="], "cannot be empty"),
        (vec!["--recalculate=yes"], "unknown option"),
        (vec!["-s", "id", "-i", "a.xlsx"], "only valid"),
        (
            vec!["-s", "id", "--close", "--discard", "-e", "return 1"],
            "without script",
        ),
    ] {
        f.fails(&args, message);
    }
    assert!(!f.path().join("workbook.xlsx").exists());
}

#[test]
fn session_retains_workbook_until_close_and_returns_output_once() {
    let f = Fixture::new();
    let output = f.run(&["--session", "--eval", "console.log('starting')"]);
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stderr).trim(), "starting");
    let id = String::from_utf8(output.stdout).unwrap().trim().to_owned();
    assert!(uuid::Uuid::parse_str(&id).is_ok());
    assert!(!f.path().join("workbook.xlsx").exists());
    assert_eq!(f.ok(&["-s", &id, "-e", WRITE]), "");
    assert_eq!(f.ok(&["--session", &id, "--eval", READ]), "42");
    assert_eq!(
        f.ok(&[
            "--session",
            &id,
            "-e",
            "console.log('one'); console.log('two'); return 5"
        ]),
        "one\ntwo"
    );
    f.ok(&["-s", &id, "--close"]);
    assert_eq!(f.value("workbook.xlsx", "B1"), CellValue::number(42.0));
    f.fails(&["-s", &id], "unavailable");
    assert_eq!(fs::read_dir(f.path().join("sessions")).unwrap().count(), 0);
}

#[test]
fn session_input_defaults_to_in_place_and_discard_preserves_original() {
    let f = Fixture::new();
    f.ok(&["-e", WRITE, "-o", "input.xlsx"]);
    let before = fs::read(f.path().join("input.xlsx")).unwrap();
    let id = f.ok(&["-s", "-i", "input.xlsx"]);
    f.ok(&["-s", &id, "-e", &WRITE.replace("21", "30")]);
    assert_eq!(fs::read(f.path().join("input.xlsx")).unwrap(), before);
    f.ok(&["--close", "-s", &id, "--discard"]);
    assert_eq!(fs::read(f.path().join("input.xlsx")).unwrap(), before);
    let id = f.ok(&["-s", "-i", "input.xlsx"]);
    f.ok(&["-s", &id, "-e", &WRITE.replace("21", "30"), "--close"]);
    assert_eq!(f.value("input.xlsx", "B1"), CellValue::number(60.0));
}

#[test]
fn failed_session_script_keeps_worker_available() {
    let f = Fixture::new();
    let id = f.session();
    f.fails(&["-s", &id, "-e", "throw new Error('broken')"], "broken");
    f.ok(&["-s", &id, "-e", WRITE]);
    assert_eq!(f.ok(&["-s", &id, "-e", READ]), "42");
    f.ok(&["-s", &id, "--close", "--discard"]);
    assert!(!f.path().join("workbook.xlsx").exists());
}

#[test]
fn failed_save_keeps_session_alive_and_output_can_be_corrected() {
    let f = Fixture::new();
    fs::write(f.path().join("blocked"), "not a directory").unwrap();
    let id = f.ok(&["-s", "-o", "blocked/output.xlsx", "-e", WRITE]);
    f.fails(&["-s", &id, "--close"], "Session remains open.");
    assert_eq!(f.ok(&["-s", &id, "-e", READ]), "42");
    f.ok(&["-s", &id, "-o", "recovered.xlsx"]);
    assert!(!f.path().join("recovered.xlsx").exists());
    f.ok(&["-s", &id, "--close"]);
    assert_eq!(f.value("recovered.xlsx", "B1"), CellValue::number(42.0));
}

#[test]
fn startup_failures_leave_no_sessions() {
    let f = Fixture::new();
    f.fails(&["-s", "-i", "missing.xlsx"], "failed to read");
    f.fails(&["-s", "-e", "throw new Error('startup')"], "startup");
    f.fails(&["-s", "-o", "bad.csv"], "output must be .xlsx");
    assert_eq!(fs::read_dir(f.path().join("sessions")).unwrap().count(), 0);
}

#[test]
fn close_all_saves_isolated_workbooks_and_discard_skips_saving() {
    let f = Fixture::new();
    let first = f.ok(&["-s", "-e", WRITE]);
    let second = f.ok(&["-s", "-e", &WRITE.replace("21", "30")]);
    assert_eq!(f.ok(&["-s", &first, "-e", READ]), "42");
    assert_eq!(f.ok(&["-s", &second, "-e", READ]), "60");
    f.ok(&["--close-all"]);
    let a = f.value("workbook.xlsx", "B1");
    let b = f.value("workbook-2.xlsx", "B1");
    assert!(
        a == CellValue::number(42.0) && b == CellValue::number(60.0)
            || a == CellValue::number(60.0) && b == CellValue::number(42.0)
    );
    let first = f.session();
    let second = f.session();
    f.ok(&["--close-all", "--discard"]);
    f.fails(&["-s", &first], "unavailable");
    f.fails(&["-s", &second], "unavailable");
    assert!(!f.path().join("workbook-3.xlsx").exists());
    f.ok(&["--close-all"]);
}

#[test]
fn close_all_attempts_every_session_when_one_save_fails() {
    let f = Fixture::new();
    fs::write(f.path().join("blocked"), "not a directory").unwrap();
    let bad = f.ok(&["-s", "-o", "blocked/output.xlsx"]);
    let good = f.ok(&["-s", "-o", "good.xlsx"]);
    f.fails(&["--close-all"], &bad);
    assert!(f.path().join("good.xlsx").exists());
    f.fails(&["-s", &good], "unavailable");
    f.ok(&["-s", &bad]);
    f.ok(&["--close-all", "--discard"]);
}

#[test]
fn session_paths_are_resolved_from_the_callers_directory() {
    let f = Fixture::new();
    let id = f.ok(&["-s", "-e", WRITE]);
    let other = tempfile::tempdir().unwrap();
    let output = f
        .command()
        .current_dir(other.path())
        .args(["-s", &id, "--close", "-o", "elsewhere.xlsx"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(other.path().join("elsewhere.xlsx").exists());
    assert!(!f.path().join("workbook.xlsx").exists());
}

#[test]
fn concurrent_session_requests_are_serialized() {
    let f = Fixture::new();
    let id = f.ok(&["-s", "-e", WRITE]);
    let script = r#"await Excel.run(async c => {
        const r = c.workbook.worksheets.getItem('Sheet1').getRange('A1');
        r.load('values'); await c.sync(); r.values = [[r.values[0][0]+1]]; await c.sync();
    });"#;
    let mut children: Vec<_> = (0..4)
        .map(|_| f.command().args(["-s", &id, "-e", script]).spawn().unwrap())
        .collect();
    for child in &mut children {
        assert!(child.wait().unwrap().success());
    }
    assert_eq!(f.ok(&["-s", &id, "-e", READ]), "50");
}

#[test]
fn stale_registration_is_cleaned_up() {
    let f = Fixture::new();
    f.ok(&["--close-all"]); // creates a private registry
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    // Keep an established pair alive so parallel workers cannot reuse this
    // ephemeral port after we remove its listener.
    let _client = std::net::TcpStream::connect(address).unwrap();
    let (_server, _) = listener.accept().unwrap();
    let port = address.port();
    drop(listener);
    let id = uuid::Uuid::new_v4().simple().to_string();
    let path = f.path().join("sessions").join(format!("{id}.json"));
    fs::write(
        &path,
        serde_json::to_vec(&serde_json::json!({"port": port, "token": "stale"})).unwrap(),
    )
    .unwrap();
    f.fails(&["-s", &id], "unavailable");
    assert!(!path.exists());
}

#[test]
fn worker_rejects_bad_credentials_and_malformed_requests() {
    use std::io::{BufRead, BufReader, Write};
    let f = Fixture::new();
    let id = f.session();
    let record: serde_json::Value = serde_json::from_slice(
        &fs::read(f.path().join("sessions").join(format!("{id}.json"))).unwrap(),
    )
    .unwrap();
    for request in ["not json\n".to_owned(), serde_json::json!({"token": "wrong", "request": {"source": null, "recalculate": false, "output": null, "close": true, "discard": true}}).to_string() + "\n"] {
        let mut stream = std::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, record["port"].as_u64().unwrap() as u16)).unwrap();
        stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).unwrap();
        let response: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert!(response["error"].is_string());
    }
    f.ok(&["-s", &id, "-e", WRITE]);
}

#[test]
fn close_stops_the_background_listener() {
    use std::{
        net::{Ipv4Addr, SocketAddr, TcpStream},
        time::{Duration, Instant},
    };
    let f = Fixture::new();
    let id = f.session();
    let record: serde_json::Value = serde_json::from_slice(
        &fs::read(f.path().join("sessions").join(format!("{id}.json"))).unwrap(),
    )
    .unwrap();
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, record["port"].as_u64().unwrap() as u16));
    f.ok(&["-s", &id, "--close", "--discard"]);
    let deadline = Instant::now() + Duration::from_secs(5);
    while TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
        assert!(
            Instant::now() < deadline,
            "worker still accepts connections after close"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(unix)]
#[test]
fn in_place_save_follows_symlink_and_preserves_permissions() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let f = Fixture::new();
    f.ok(&["-o", "original.xlsx"]);
    fs::set_permissions(
        f.path().join("original.xlsx"),
        fs::Permissions::from_mode(0o640),
    )
    .unwrap();
    symlink("original.xlsx", f.path().join("link.xlsx")).unwrap();
    f.ok(&["-i", "link.xlsx", "-e", WRITE]);
    assert!(f.path().join("link.xlsx").is_symlink());
    assert_eq!(f.value("original.xlsx", "B1"), CellValue::number(42.0));
    assert_eq!(
        fs::metadata(f.path().join("original.xlsx"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o640
    );
}

#[cfg(unix)]
#[test]
fn shared_session_directory_is_rejected() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    let directory = f.path().join("sessions");
    fs::create_dir(&directory).unwrap();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o755)).unwrap();
    f.fails(&["-s"], "mode 0700");
    assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
}

#[test]
fn automatic_and_explicit_recalculation_preserve_compact_pivot_layout() {
    let f = Fixture::new();
    // Recalculation used to take a second rendering path that dropped Excel's
    // compact captions and extra header rows, shifting values up by one row.
    for (area, caption, label_row) in [("column", "Sum of Sales", 2), ("filter", "Product", 3)] {
        let script = format!(
            r#"await Excel.run(async c => {{
            const data = c.workbook.worksheets.getItem('Sheet1');
            data.getRange('A1:C6').values = [
                ['Region','Product','Sales'], ['East','A',10], ['West','A',20],
                ['East','B',30], ['West','B',40], ['East','A',15]
            ];
            const dest = c.workbook.worksheets.add('Pivot');
            await c.sync();
            const p = c.workbook.pivotTables.add('SalesPivot', data.getRange('A1:C6'), dest.getRange('A1'));
            p.rowHierarchies.add(p.hierarchies.getItem('Region'));
            p.{area}Hierarchies.add(p.hierarchies.getItem('Product'));
            p.dataHierarchies.add(p.hierarchies.getItem('Sales'));
            await c.sync();
        }});"#
        );
        let file = format!("{area}.xlsx");
        f.ok(&["-e", &script, "-o", &file]);
        let assert_layout = || {
            let workbook = Workbook::from_xlsx_path(f.path().join(&file).to_str().unwrap())
                .unwrap()
                .0;
            let pivot = workbook.sheet_by_name("Pivot").unwrap();
            assert_eq!(
                pivot.get_cell_value("A1").unwrap(),
                CellValue::from(caption)
            );
            assert_eq!(
                pivot
                    .get_cell_value(format!("A{label_row}").as_str())
                    .unwrap(),
                CellValue::from("Row Labels")
            );
            assert_eq!(
                pivot
                    .get_cell_value(format!("A{}", label_row + 1).as_str())
                    .unwrap(),
                CellValue::from("East")
            );
            assert_eq!(
                pivot
                    .get_cell_value(format!("B{}", label_row + 1).as_str())
                    .unwrap(),
                CellValue::number(if area == "column" { 25.0 } else { 55.0 })
            );
        };
        assert_layout();
        f.ok(&["-i", &file, "-r"]);
        assert_layout();
    }
}

#[test]
fn file_flag_supports_session_scripts_and_hyphenated_filenames() {
    let f = Fixture::new();
    fs::write(f.path().join("-write.js"), WRITE).unwrap();
    fs::write(f.path().join("read.js"), READ).unwrap();
    let id = f.ok(&["-s", "--file=-write.js"]);
    assert_eq!(f.ok(&["-s", &id, "--file", "read.js"]), "42");
    f.ok(&["-s", &id, "--close"]);
    assert_eq!(f.value("workbook.xlsx", "B1"), CellValue::number(42.0));
}

#[test]
fn version_has_no_workbook_side_effects() {
    let f = Fixture::new();
    let expected = format!("mog {}", env!("CARGO_PKG_VERSION"));
    assert_eq!(f.ok(&["--version"]), expected);
    assert_eq!(f.ok(&["-V"]), expected);
    assert_eq!(f.ok(&["--version", "-o", "unused.xlsx"]), expected);
    assert_eq!(fs::read_dir(f.path()).unwrap().count(), 0);
}
