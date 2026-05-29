use xlsx_test_contracts::{
    AnchorFact, AnchorGeometryFact, AnchorKindFact, CellAnchorFact, ClientDataFact, DrawingFacts,
    FailureFingerprint, FingerprintCategory, FingerprintOwner, FingerprintSeverity, GateName,
    GateReport, GateScenario, GateStatus, GateSuiteName, ObjectFact, ParagraphFact,
    REPORT_SCHEMA_VERSION, SheetDrawingFacts, TextFact, TextRunFact, TextRunPropertiesFact,
    WORKBOOK_FACTS_SCHEMA_VERSION, WorkbookFacts, autonomous_full_run_schedule,
    enforce_rollout_report_policy, gate_command_contracts, gate_suite_contract,
    gate_suite_readiness,
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
fn workbook_facts_publish_drawing_facts_as_snake_case_schema_v4() {
    let mut facts = WorkbookFacts::new();
    facts.drawings.push(SheetDrawingFacts {
        sheet_index: 2,
        sheet_name: " Sheet 2 ".to_string(),
        drawing: DrawingFacts {
            anchors: vec![AnchorFact {
                kind: AnchorKindFact::TwoCell,
                geometry: AnchorGeometryFact::TwoCell {
                    from: CellAnchorFact {
                        col: 1,
                        row: 2,
                        col_off: 3,
                        row_off: 4,
                    },
                    to: CellAnchorFact {
                        col: 5,
                        row: 6,
                        col_off: 7,
                        row_off: 8,
                    },
                    edit_as: Some("OneCell".to_string()),
                },
                object: ObjectFact::Unknown,
                client_data: ClientDataFact {
                    locks_with_sheet: true,
                    prints_with_sheet: false,
                },
                raw_alternate_content: true,
            }],
        },
    });

    facts.normalize();
    let json = serde_json::to_string(&facts).expect("workbook facts serialize");

    assert_eq!(facts.schema_version, WORKBOOK_FACTS_SCHEMA_VERSION);
    assert_eq!(WORKBOOK_FACTS_SCHEMA_VERSION, 4);
    assert_eq!(facts.drawings[0].sheet_name, "Sheet 2");
    assert!(json.contains("\"drawings\""));
    assert!(json.contains("\"sheet_index\""));
    assert!(json.contains("\"raw_alternate_content\""));
    assert!(json.contains("\"two_cell\""));
    assert!(!json.contains("rawAlternateContent"));
}

#[test]
fn drawing_text_facts_publish_rich_text_shape_details() {
    let mut facts = WorkbookFacts::new();
    facts.drawings.push(SheetDrawingFacts {
        sheet_index: 0,
        sheet_name: "Sheet1".to_string(),
        drawing: DrawingFacts {
            anchors: vec![AnchorFact {
                kind: AnchorKindFact::TwoCell,
                geometry: AnchorGeometryFact::TwoCell {
                    from: CellAnchorFact {
                        col: 0,
                        row: 0,
                        col_off: 0,
                        row_off: 0,
                    },
                    to: CellAnchorFact {
                        col: 1,
                        row: 1,
                        col_off: 0,
                        row_off: 0,
                    },
                    edit_as: None,
                },
                object: ObjectFact::Shape(xlsx_test_contracts::ShapeFact {
                    name: "Text Box 1".to_string(),
                    preset: Some("Rect".to_string()),
                    text: TextFact {
                        paragraph_count: 1,
                        run_count: 1,
                        text: "Styled".to_string(),
                        paragraphs: vec![ParagraphFact {
                            index: 0,
                            align: Some("Center".to_string()),
                            default_run: Some(TextRunPropertiesFact {
                                latin_font: Some("Aptos".to_string()),
                                ..TextRunPropertiesFact::default()
                            }),
                            ..ParagraphFact::default()
                        }],
                        runs: vec![TextRunFact {
                            paragraph_index: 0,
                            run_index: 0,
                            text: "Styled".to_string(),
                            properties: TextRunPropertiesFact {
                                size: Some(1400),
                                bold: Some(true),
                                color: Some("srgb:FF0000:transforms=0".to_string()),
                                latin_font: Some("Arial".to_string()),
                                ..TextRunPropertiesFact::default()
                            },
                        }],
                        ..TextFact::default()
                    },
                    properties: xlsx_test_contracts::ShapePropertiesFact {
                        fill: Some("solid".to_string()),
                        fill_detail: Some("Solid".to_string()),
                        outline: true,
                        outline_detail: Some("Outline".to_string()),
                        ..xlsx_test_contracts::ShapePropertiesFact::default()
                    },
                }),
                client_data: ClientDataFact {
                    locks_with_sheet: false,
                    prints_with_sheet: false,
                },
                raw_alternate_content: false,
            }],
        },
    });

    let json = serde_json::to_string(&facts).expect("workbook facts serialize");

    assert!(json.contains("\"paragraphs\""));
    assert!(json.contains("\"default_run\""));
    assert!(json.contains("\"runs\""));
    assert!(json.contains("\"latin_font\""));
    assert!(json.contains("\"fill_detail\""));
    assert!(json.contains("\"outline_detail\""));
    assert!(json.contains("\"srgb:FF0000:transforms=0\""));
    assert!(!json.contains("defaultRun"));
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
            .any(|contract| contract.gate == GateName::PerfFull && contract.implemented)
    );
    assert!(
        contracts
            .iter()
            .any(|contract| contract.gate == GateName::CorpusFull && contract.heavy)
    );
    assert!(
        contracts
            .iter()
            .all(|contract| !contract.command.is_empty())
    );
}

#[test]
fn rollout_suites_publish_local_ci_and_autonomous_gate_sets() {
    let local = gate_suite_contract(GateSuiteName::LocalSmoke);
    let golden = gate_suite_contract(GateSuiteName::CiGolden);
    let full = gate_suite_contract(GateSuiteName::AutonomousFull);

    assert_eq!(local.name, "local-smoke");
    assert!(
        local
            .gates
            .iter()
            .any(|gate| gate.gate == GateName::PerfSmoke)
    );
    assert!(golden.gates.len() > local.gates.len());
    assert_eq!(full.gates.len(), GateName::ALL.len());
    assert!(
        full.gates
            .iter()
            .any(|gate| gate.gate == GateName::PerfFull)
    );
}

#[test]
fn rollout_readiness_accepts_local_smoke_and_blocks_unapproved_heavy_gates() {
    let smoke = gate_suite_readiness(GateSuiteName::LocalSmoke, false);
    assert!(smoke.runnable);
    assert!(smoke.blockers.is_empty());

    let full_without_heavy = gate_suite_readiness(GateSuiteName::AutonomousFull, false);
    assert!(
        full_without_heavy
            .blockers
            .iter()
            .any(|blocker| blocker.code == "heavy-gate-requires-explicit-opt-in")
    );
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

    assert!(
        violations
            .iter()
            .any(|v| v.code == "failed-scenario-without-fingerprint")
    );
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

    assert!(
        violations
            .iter()
            .any(|v| v.code == "non-actionable-fingerprint")
    );
}
