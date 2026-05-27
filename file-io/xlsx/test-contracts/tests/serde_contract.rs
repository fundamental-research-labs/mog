use xlsx_test_contracts::{
    FailureFingerprint, FingerprintCategory, FingerprintOwner, FingerprintSeverity, GateName,
    GateReport, GateStatus, REPORT_SCHEMA_VERSION, gate_command_contracts,
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
    assert!(
        contracts
            .iter()
            .any(|contract| contract.gate == GateName::PackageGraph && contract.implemented)
    );
    assert!(
        contracts
            .iter()
            .any(|contract| contract.gate == GateName::PerfFull && !contract.implemented)
    );
}
