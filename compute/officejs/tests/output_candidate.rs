//! Real native processes, private registries and synthetic workbooks. A staged
//! candidate is never asserted to be a completed task or final declared output.
use compute_api::Workbook;
use serde_json::Value;
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};
use tempfile::TempDir;
use uuid::Uuid;
use value_types::CellValue;

struct Fixture(TempDir);
impl Fixture {
    fn new() -> Self {
        Self(tempfile::tempdir().unwrap())
    }
    fn path(&self) -> &Path {
        self.0.path()
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_mog"))
            .current_dir(self.path())
            .env("MOG_SESSION_DIR", self.path().join("sessions"))
            .args(args)
            .output()
            .unwrap()
    }
    fn ok(&self, args: &[&str]) -> String {
        let output = self.run(args);
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }
    fn fails(&self, args: &[&str], reason: &str) {
        let output = self.run(args);
        assert!(!output.status.success(), "unexpected success: {args:?}");
        assert!(
            String::from_utf8_lossy(&output.stderr).contains(reason),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fn registered(&self, task: &str) -> String {
        self.ok(&[
            "--session",
            "--output-task",
            task,
            "--intended-output",
            "result.xlsx",
            "--output",
            "wrong.xlsx",
        ])
    }
    fn prepare(&self, task: &str, request: &str) -> Value {
        serde_json::from_str(&self.ok(&[
            "--prepare-output",
            task,
            "--output-request",
            request,
            "--output-budget-ms",
            "10000",
        ]))
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.run(&["--close-all", "--discard"]);
    }
}

fn id() -> String {
    Uuid::new_v4().simple().to_string()
}
const EDIT: &str = r#"await Excel.run(async c => {
    const s = c.workbook.worksheets.getItem('Sheet1');
    s.getRange('A1').values = [[21]];
    s.getRange('B1').formulas = [['=A1*2']]; await c.sync();
});"#;

#[test]
fn registered_live_workbook_stages_readable_exact_candidate_once_and_freezes_edits() {
    let fixture = Fixture::new();
    let (task, request) = (id(), id());
    let session = fixture.registered(&task);
    fixture.ok(&["--session", &session, "--eval", EDIT]);
    let result = fixture.prepare(&task, &request);
    assert_eq!(result["outcome"], "candidate_saved");
    assert_eq!(result["task_id"], task);
    assert_eq!(result["workbook_id"], session);
    assert_eq!(result["request_id"], request);
    assert_eq!(result["evidence"]["status"], "net_cell_edit");
    assert_eq!(result["sha256"].as_str().unwrap().len(), 64);
    let candidate = Path::new(result["path"].as_str().unwrap());
    let workbook = Workbook::from_xlsx_path(candidate.to_str().unwrap())
        .unwrap()
        .0;
    assert_eq!(
        workbook
            .sheet_by_index(0)
            .unwrap()
            .get_cell_value("B1")
            .unwrap(),
        CellValue::number(42.0)
    );
    assert!(!fixture.path().join("result.xlsx").exists());
    assert!(!fixture.path().join("wrong.xlsx").exists());
    assert_eq!(fixture.prepare(&task, &request), result);
    fixture.fails(&["--session", &session, "--eval", EDIT], "frozen");
    fixture.fails(
        &[
            "--prepare-output",
            &task,
            "--output-request",
            &id(),
            "--output-budget-ms",
            "10000",
        ],
        "already_attempted",
    );
    fs::write(candidate, b"changed after receipt").unwrap();
    fixture.fails(
        &[
            "--prepare-output",
            &task,
            "--output-request",
            &request,
            "--output-budget-ms",
            "10000",
        ],
        "candidate_changed",
    );
}

#[test]
fn unedited_scratch_and_multiple_claims_cannot_supply_the_intended_workbook() {
    let fixture = Fixture::new();
    let task = id();
    fixture.registered(&task);
    let scratch = fixture.ok(&["--session", "--output", "scratch.xlsx"]);
    fixture.ok(&["--session", &scratch, "--eval", EDIT]);
    let result = fixture.prepare(&task, &id());
    assert_eq!(result["outcome"], "unavailable");
    assert_eq!(result["reason"], "no_net_cell_edits");
    assert!(result["path"].is_null());

    let ambiguous = id();
    let first = fixture.registered(&ambiguous);
    fixture.ok(&["--session", &first, "--eval", EDIT]);
    fixture.fails(
        &[
            "--session",
            "--output-task",
            &ambiguous,
            "--intended-output",
            "result.xlsx",
        ],
        "ambiguous_output_registration",
    );
    fixture.fails(
        &[
            "--prepare-output",
            &ambiguous,
            "--output-request",
            &id(),
            "--output-budget-ms",
            "10000",
        ],
        "ambiguous_output_registration",
    );
    assert!(!fixture.path().join("result.xlsx").exists());
}

#[test]
fn reverted_and_unsupported_changes_remain_unavailable() {
    for (script, reason) in [
        (
            r#"await Excel.run(async c => { const r=c.workbook.worksheets.getItem('Sheet1').getRange('A1'); r.values=[[1]]; await c.sync(); r.values=[['']]; await c.sync(); });"#,
            "no_net_cell_edits",
        ),
        (
            r#"await Excel.run(async c => { c.workbook.worksheets.getItem('Sheet1').getRange('A1').format.font.bold=true; await c.sync(); });"#,
            "edit_identity_unavailable",
        ),
        (
            r#"await Excel.run(async c => { c.workbook.worksheets.add('New'); await c.sync(); });"#,
            "edit_identity_unavailable",
        ),
    ] {
        let fixture = Fixture::new();
        let task = id();
        let session = fixture.registered(&task);
        fixture.ok(&["--session", &session, "--eval", script]);
        let result = fixture.prepare(&task, &id());
        assert_eq!(result["outcome"], "unavailable", "{result}");
        assert_eq!(result["reason"], reason, "{result}");
        assert!(!fixture.path().join("result.xlsx").exists());
    }
}

#[test]
fn failed_partial_script_and_lost_closed_state_are_not_promoted() {
    let fixture = Fixture::new();
    let task = id();
    let session = fixture.registered(&task);
    fixture.fails(&["--session", &session, "--eval", r#"await Excel.run(async c => { c.workbook.worksheets.getItem('Sheet1').getRange('A1').values=[[1]]; c.workbook.worksheets.getItem('Missing'); await c.sync(); });"#], "ItemNotFound");
    assert_eq!(
        fixture.prepare(&task, &id())["reason"],
        "edit_identity_unavailable"
    );

    let closed_task = id();
    let closed = fixture.registered(&closed_task);
    fixture.ok(&["--session", &closed, "--eval", EDIT]);
    fixture.ok(&["--session", &closed, "--close"]);
    fixture.fails(
        &[
            "--prepare-output",
            &closed_task,
            "--output-request",
            &id(),
            "--output-budget-ms",
            "10000",
        ],
        "unavailable",
    );
    assert!(!fixture.path().join("result.xlsx").exists());
}

#[test]
fn cancellation_is_terminal_for_candidate_preparation() {
    let fixture = Fixture::new();
    let task = id();
    let session = fixture.registered(&task);
    fixture.ok(&["--session", &session, "--eval", EDIT]);
    fixture.ok(&["--cancel-output", &task]);
    fixture.ok(&["--cancel-output", &task]);
    fixture.fails(
        &[
            "--prepare-output",
            &task,
            "--output-request",
            &id(),
            "--output-budget-ms",
            "10000",
        ],
        "output_cancelled",
    );
    assert!(!fixture.path().join("result.xlsx").exists());
    assert_eq!(
        fs::read_dir(fixture.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("candidate"))
            .count(),
        0
    );
}

#[test]
fn malformed_identity_budget_and_mixed_commands_fail_before_work() {
    let fixture = Fixture::new();
    for args in [
        vec![
            "--prepare-output",
            "../escape",
            "--output-request",
            "bad",
            "--output-budget-ms",
            "10",
        ],
        vec![
            "--prepare-output",
            "bad",
            "--output-request",
            "bad",
            "--output-budget-ms",
            "50001",
        ],
        vec![
            "--prepare-output",
            "bad",
            "--output-request",
            "bad",
            "--output-budget-ms",
            "0",
        ],
        vec![
            "--prepare-output",
            "bad",
            "--output-request",
            "bad",
            "--output-budget-ms",
            "10",
            "--eval",
            "return 1",
        ],
        vec!["--output-task", "bad", "--intended-output", "result.xlsx"],
    ] {
        assert!(!fixture.run(&args).status.success());
    }
    let capabilities: Value =
        serde_json::from_str(&fixture.ok(&["--output-capabilities"])).unwrap();
    assert_eq!(capabilities["protocol"], 1);
    assert_eq!(capabilities["publishes_final_output"], false);
}

fn raw_request(fixture: &Fixture, session: &str, request: Value) -> Value {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpStream;
    use std::time::Duration;
    let record: Value = serde_json::from_slice(
        &fs::read(
            fixture
                .path()
                .join("sessions")
                .join(format!("{session}.json")),
        )
        .unwrap(),
    )
    .unwrap();
    let mut stream =
        TcpStream::connect(("127.0.0.1", record["port"].as_u64().unwrap() as u16)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    writeln!(
        stream,
        "{}",
        serde_json::json!({"token":record["token"], "request":request})
    )
    .unwrap();
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).unwrap();
    serde_json::from_str(&line).unwrap()
}

fn preparation(task: &str, workbook: &str, request: &str, deadline: u64) -> Value {
    serde_json::json!({"source":null,"recalculate":false,"output":null,"close":false,"discard":false,
        "prepare_output":{"task_id":task,"workbook_id":workbook,"request_id":request,"deadline_ms":deadline}})
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[test]
fn stale_wrong_workbook_and_mixed_native_requests_do_not_consume_a_valid_attempt() {
    let fixture = Fixture::new();
    let (task, request) = (id(), id());
    let session = fixture.registered(&task);
    fixture.ok(&["--session", &session, "--eval", EDIT]);
    for (payload, expected) in [
        (
            preparation(&task, &session, &request, now_ms() - 1),
            "budget_invalid_or_exhausted",
        ),
        (
            preparation(&task, &session, &request, now_ms() + 100_000),
            "budget_invalid_or_exhausted",
        ),
        (
            preparation(&task, &id(), &request, now_ms() + 10_000),
            "identity_mismatch",
        ),
        (
            preparation(&id(), &session, &request, now_ms() + 10_000),
            "identity_mismatch",
        ),
    ] {
        let reply = raw_request(&fixture, &session, payload);
        assert!(
            reply["error"].as_str().unwrap().contains(expected),
            "{reply}"
        );
    }
    let mut mixed = preparation(&task, &session, &request, now_ms() + 10_000);
    mixed["source"] = EDIT.into();
    assert!(
        raw_request(&fixture, &session, mixed)["error"]
            .as_str()
            .unwrap()
            .contains("cannot include mutations")
    );
    assert_eq!(
        fixture.prepare(&task, &request)["outcome"],
        "candidate_saved"
    );
}

#[test]
fn queued_timed_out_request_cannot_publish_late_and_client_wait_is_bounded() {
    use std::{
        net::TcpStream,
        time::{Duration, Instant},
    };
    let fixture = Fixture::new();
    let (task, request) = (id(), id());
    let session = fixture.registered(&task);
    fixture.ok(&["--session", &session, "--eval", EDIT]);
    let record: Value = serde_json::from_slice(
        &fs::read(
            fixture
                .path()
                .join("sessions")
                .join(format!("{session}.json")),
        )
        .unwrap(),
    )
    .unwrap();
    // The first accepted TCP connection deliberately withholds its request.
    // The real worker serializes connections, so preparation queues behind it.
    let blocker =
        TcpStream::connect(("127.0.0.1", record["port"].as_u64().unwrap() as u16)).unwrap();
    let started = Instant::now();
    assert!(
        !fixture
            .run(&[
                "--prepare-output",
                &task,
                "--output-request",
                &request,
                "--output-budget-ms",
                "30"
            ])
            .status
            .success()
    );
    assert!(started.elapsed() < Duration::from_secs(2));
    drop(blocker);
    // A later ordinary request is a queue barrier, not a sleep. It proves the
    // expired request was handled and did not freeze or publish the workbook.
    fixture.ok(&["--session", &session, "--eval", EDIT]);
    let receipt: Value = serde_json::from_slice(
        &fs::read(
            fixture
                .path()
                .join("sessions")
                .join(format!("output-{task}.json")),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(receipt["attempted_request"].is_null());
    assert!(
        !fixture
            .path()
            .join(format!(".mog-{task}-{request}.candidate.xlsx"))
            .exists()
    );
    assert_eq!(
        fixture.prepare(&task, &request)["outcome"],
        "candidate_saved"
    );
}

#[test]
fn atomic_candidate_collision_preserves_existing_file_and_partial_evidence() {
    let fixture = Fixture::new();
    let (task, request) = (id(), id());
    let session = fixture.registered(&task);
    fixture.ok(&["--session", &session, "--eval", EDIT]);
    let destination = fixture
        .path()
        .join(format!(".mog-{task}-{request}.candidate.xlsx"));
    fs::write(&destination, b"existing candidate must survive").unwrap();
    let result = fixture.prepare(&task, &request);
    assert_eq!(result["outcome"], "unavailable");
    assert_eq!(result["reason"], "atomic_candidate_publish_unavailable");
    assert_eq!(
        fs::read(destination).unwrap(),
        b"existing candidate must survive"
    );
    let partial = result["path"].as_str().unwrap();
    assert!(Workbook::from_xlsx_path(partial).is_ok());
    assert!(!fixture.path().join("result.xlsx").exists());
    assert_eq!(fixture.prepare(&task, &request), result);
}
