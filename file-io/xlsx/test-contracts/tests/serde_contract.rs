use xlsx_test_contracts::{
    autonomous_full_run_schedule, enforce_rollout_report_policy, gate_command_contracts,
    gate_suite_contract, gate_suite_readiness, FailureFingerprint, FingerprintCategory,
    FingerprintOwner, FingerprintSeverity, GateName, GateReport, GateScenario, GateStatus,
    GateSuiteName, REPORT_SCHEMA_VERSION,
};

#[test]
fn report_envelope_uses_stable_schema_and_snake_case() {
    let report = GateReport::new(GateName::PackageGraph, GateStatus::Passed);
    let json = serde_json::to_string(&report).expect("report serializes");

    assert!(json.contains("\"$schema\":\"mog.xlsx.file_io.report.v1\""));
    assert!(json.contains("\"release_blocking_failures\""));
    assert!(!json.contains("releaseBlockingFailures"));
    assert_eq!(report.schema, REPORT_SCHEMA_VERSION);
}

#[test]
fn fingerprints_include_stable_proof_metadata() {
    let fingerprint = FailureFingerprint::new(
        "pkg-rel-target-missing",
        FingerprintCategory::Correctness(
            xlsx_test_contracts::CorrectnessFingerprintCategory::TargetResolution,
        ),
        FingerprintSeverity::Error,
        FingerprintOwner::PackageGraph,
        "relationship target missing",
    );

    assert_eq!(fingerprint.proof.version, "v1");
    assert_eq!(fingerprint.proof.algorithm, "stable-id");
    assert!(fingerprint.proof.digest.starts_with("mog-xlsx-io-fp:v1:"));
    assert!(fingerprint.proof.covered_fields.iter().any(|f| f == "id"));
}

#[test]
fn command_contracts_publish_every_phase_zero_gate_name() {
    let contracts = gate_command_contracts();

    assert_eq!(contracts.len(), GateName::ALL.len());
    assert!(contracts
        .iter()
        .any(|contract| contract.gate == GateName::PackageGraph && contract.implemented));
    assert!(contracts
        .iter()
        .any(|contract| contract.gate == GateName::PerfFull && contract.implemented));
    assert!(contracts
        .iter()
        .any(|contract| contract.gate == GateName::CorpusFull && contract.heavy));
    assert!(contracts
        .iter()
        .all(|contract| !contract.command.is_empty()));
}

#[test]
fn rollout_suites_publish_local_ci_and_autonomous_gate_sets() {
    let local = gate_suite_contract(GateSuiteName::LocalSmoke);
    let golden = gate_suite_contract(GateSuiteName::CiGolden);
    let full = gate_suite_contract(GateSuiteName::AutonomousFull);

    assert_eq!(local.name, "local-smoke");
    assert!(local
        .gates
        .iter()
        .any(|gate| gate.gate == GateName::PerfSmoke));
    assert!(golden.gates.len() > local.gates.len());
    assert_eq!(full.gates.len(), GateName::ALL.len());
    assert!(full
        .gates
        .iter()
        .any(|gate| gate.gate == GateName::PerfFull));
}

#[test]
fn rollout_readiness_blocks_unimplemented_and_unapproved_heavy_gates() {
    let smoke = gate_suite_readiness(GateSuiteName::LocalSmoke, false);
    assert!(!smoke.runnable);
    assert!(smoke
        .blockers
        .iter()
        .any(|blocker| blocker.code == "gate-not-implemented"));

    let full_without_heavy = gate_suite_readiness(GateSuiteName::AutonomousFull, false);
    assert!(full_without_heavy
        .blockers
        .iter()
        .any(|blocker| blocker.code == "heavy-gate-requires-explicit-opt-in"));
}

#[test]
fn autonomous_schedule_serializes_full_corpus_before_full_perf() {
    let schedule = autonomous_full_run_schedule();

    assert_eq!(schedule.name, "xlsx-autonomous-full");
    assert_eq!(schedule.jobs.len(), 2);
    assert_eq!(schedule.jobs[0].gate, GateName::CorpusFull);
    assert_eq!(schedule.jobs[1].gate, GateName::PerfFull);
    assert!(schedule.jobs.iter().all(|job| job.allow_heavy));
    assert_ne!(
        schedule.jobs[0].exclusive_resource_key,
        schedule.jobs[1].exclusive_resource_key
    );
}

#[test]
fn rollout_policy_rejects_failed_reports_without_actionable_fingerprints() {
    let scenario = GateScenario::new("fixture-with-loss", GateStatus::Failed);
    let report = GateReport::from_scenarios(GateName::OoxmlContract, vec![scenario], 0);

    let violations = enforce_rollout_report_policy(&report);

    assert!(violations
        .iter()
        .any(|v| v.code == "failed-scenario-without-fingerprint"));
}

#[test]
fn rollout_policy_rejects_broad_fingerprint_buckets() {
    let mut scenario = GateScenario::new("fixture-with-loss", GateStatus::Failed);
    scenario.fingerprints.push(FailureFingerprint::new(
        "misc-raw-xml-diff",
        FingerprintCategory::Correctness(
            xlsx_test_contracts::CorrectnessFingerprintCategory::HarnessBug,
        ),
        FingerprintSeverity::Error,
        FingerprintOwner::Harness,
        "broad diff bucket",
    ));
    let report = GateReport::from_scenarios(GateName::OoxmlContract, vec![scenario], 0);

    let violations = enforce_rollout_report_policy(&report);

    assert!(violations
        .iter()
        .any(|v| v.code == "non-actionable-fingerprint"));
}
