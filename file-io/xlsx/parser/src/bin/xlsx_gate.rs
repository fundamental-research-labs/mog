//! File I/O gate command surface.

use std::fs;
use std::path::PathBuf;
use std::str::FromStr;

use xlsx_parser::testing::{
    GateName, GateReport, GateReportDomain, GateScenario, GateStatus, GateSuiteName, MetricValue,
    PerfGateOptions, autonomous_full_run_schedule, enforce_rollout_report_policy,
    gate_command_contracts, gate_suite_contract, gate_suite_contracts, gate_suite_readiness,
    run_ooxml_contract_gate, run_perf_gate, validate_package_graph_bytes,
};

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(gate_name) = args.next() else {
        print_usage();
        std::process::exit(2);
    };
    if gate_name == "--help" || gate_name == "-h" {
        print_usage();
        return;
    }
    if gate_name == "--list" {
        print_json(&gate_command_contracts());
        return;
    }
    if gate_name == "--suites" {
        print_json(&gate_suite_contracts());
        return;
    }
    if gate_name == "--schedule" {
        print_json(&autonomous_full_run_schedule());
        return;
    }
    if gate_name == "--plan" {
        let Some(suite_name) = args.next() else {
            eprintln!("--plan requires a suite name: local-smoke, ci-golden, or autonomous-full");
            std::process::exit(2);
        };
        let suite = match GateSuiteName::from_str(&suite_name) {
            Ok(suite) => suite,
            Err(err) => {
                eprintln!("{err}");
                std::process::exit(2);
            }
        };
        print_json(&gate_suite_contract(suite));
        return;
    }
    if gate_name == "--check-suite" {
        let Some(suite_name) = args.next() else {
            eprintln!(
                "--check-suite requires a suite name: local-smoke, ci-golden, or autonomous-full"
            );
            std::process::exit(2);
        };
        let allow_heavy = args.any(|arg| arg == "--allow-heavy");
        let suite = match GateSuiteName::from_str(&suite_name) {
            Ok(suite) => suite,
            Err(err) => {
                eprintln!("{err}");
                std::process::exit(2);
            }
        };
        let readiness = gate_suite_readiness(suite, allow_heavy);
        let runnable = readiness.runnable;
        print_json(&readiness);
        std::process::exit(if runnable { 0 } else { 2 });
    }
    if gate_name == "--enforce-policy" {
        let Some(path) = args.next() else {
            eprintln!("--enforce-policy requires a report path");
            std::process::exit(2);
        };
        let report_json = match fs::read_to_string(&path) {
            Ok(json) => json,
            Err(err) => {
                eprintln!("failed to read report {path}: {err}");
                std::process::exit(1);
            }
        };
        let report: GateReport = match serde_json::from_str(&report_json) {
            Ok(report) => report,
            Err(err) => {
                eprintln!("failed to parse report {path}: {err}");
                std::process::exit(1);
            }
        };
        let violations = enforce_rollout_report_policy(&report);
        print_json(&violations);
        std::process::exit(if violations.is_empty() { 0 } else { 1 });
    }

    let gate = match GateName::from_str(&gate_name) {
        Ok(gate) => gate,
        Err(err) => {
            eprintln!("{err}");
            print_usage();
            std::process::exit(2);
        }
    };

    let mut output: Option<PathBuf> = None;
    let mut budget_path: Option<PathBuf> = None;
    let mut baseline_path: Option<PathBuf> = None;
    let mut manifest_path: Option<PathBuf> = None;
    let mut positional = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--output" | "-o" => {
                let Some(path) = args.next() else {
                    eprintln!("--output requires a path");
                    std::process::exit(2);
                };
                output = Some(PathBuf::from(path));
            }
            "--budgets" => {
                let Some(path) = args.next() else {
                    eprintln!("--budgets requires a path");
                    std::process::exit(2);
                };
                budget_path = Some(PathBuf::from(path));
            }
            "--baseline" => {
                let Some(path) = args.next() else {
                    eprintln!("--baseline requires a path");
                    std::process::exit(2);
                };
                baseline_path = Some(PathBuf::from(path));
            }
            "--manifest" => {
                let Some(path) = args.next() else {
                    eprintln!("--manifest requires a path");
                    std::process::exit(2);
                };
                manifest_path = Some(PathBuf::from(path));
            }
            other => positional.push(other.to_string()),
        }
    }

    let (report, exit_code) = match gate {
        GateName::OoxmlContract => {
            let report = run_ooxml_contract_gate();
            let exit_code = if report.totals.failed == 0 && report.totals.blocked == 0 {
                0
            } else {
                1
            };
            (report, exit_code)
        }
        GateName::PackageGraph => run_package_graph_gate(positional),
        GateName::PerfSmoke | GateName::PerfGolden | GateName::PerfFull => {
            let inputs = positional.into_iter().map(PathBuf::from).collect();
            run_perf_gate(PerfGateOptions {
                gate,
                inputs,
                manifest_path,
                budget_path,
                baseline_path,
            })
        }
        other => (not_implemented_report(other), not_implemented_exit(other)),
    };

    let json = serde_json::to_string_pretty(&report).expect("gate report should serialize");
    if let Some(path) = output {
        if let Err(err) = fs::write(&path, json.as_bytes()) {
            eprintln!("failed to write report {}: {err}", path.display());
            std::process::exit(1);
        }
    } else {
        println!("{json}");
    }
    std::process::exit(exit_code);
}

fn run_package_graph_gate(positional: Vec<String>) -> (GateReport, i32) {
    let Some(path) = positional.first() else {
        eprintln!("package-graph requires an XLSX path");
        return (
            GateReport::new(GateName::PackageGraph, GateStatus::Blocked),
            2,
        );
    };
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("failed to read {path}: {err}");
            return (
                GateReport::new(GateName::PackageGraph, GateStatus::Failed),
                1,
            );
        }
    };

    match validate_package_graph_bytes(&bytes) {
        Ok(validation) => {
            let status = if validation.valid {
                GateStatus::Passed
            } else {
                GateStatus::Failed
            };
            let mut scenario = GateScenario::new(path, status);
            scenario.fingerprints = validation.fingerprints.clone();
            scenario.metrics.insert(
                "package_graph_violation_count".to_string(),
                MetricValue::Integer(validation.violations.len() as i64),
            );

            let mut report = GateReport::from_scenarios(GateName::PackageGraph, vec![scenario], 0);
            let domain = report.domain.get_or_insert_with(GateReportDomain::default);
            domain.fingerprints = validation.fingerprints;
            domain.metrics.insert(
                "package_graph_violation_count".to_string(),
                MetricValue::Integer(validation.violations.len() as i64),
            );
            report.normalize();
            (report, if validation.valid { 0 } else { 1 })
        }
        Err(err) => {
            eprintln!("failed to open XLSX archive {path}: {err}");
            let mut scenario = GateScenario::new(path, GateStatus::Failed);
            scenario.message = Some(err.to_string());
            let report = GateReport::from_scenarios(GateName::PackageGraph, vec![scenario], 0);
            (report, 1)
        }
    }
}

fn not_implemented_report(gate: GateName) -> GateReport {
    let mut scenario = GateScenario::new(gate.as_str(), GateStatus::Blocked);
    scenario.release_blocking = false;
    scenario.message = Some("not implemented".to_string());
    GateReport::from_scenarios(gate, vec![scenario], 0)
}

fn not_implemented_exit(gate: GateName) -> i32 {
    eprintln!("file I/O gate '{gate}' is not implemented yet");
    2
}

fn print_usage() {
    eprintln!(
        "Usage: xlsx-gate <gate-name> [input.xlsx|corpus-dir ...] [--output report.json] [--manifest manifest.json] [--budgets budgets.json] [--baseline report.json]"
    );
    eprintln!("       xlsx-gate --list");
    eprintln!("       xlsx-gate --suites");
    eprintln!("       xlsx-gate --schedule");
    eprintln!("       xlsx-gate --plan <local-smoke|ci-golden|autonomous-full>");
    eprintln!(
        "       xlsx-gate --check-suite <local-smoke|ci-golden|autonomous-full> [--allow-heavy]"
    );
    eprintln!("       xlsx-gate --enforce-policy <report.json>");
    eprintln!("Gate names:");
    for gate in GateName::ALL {
        eprintln!("  {}", gate.as_str());
    }
}

fn print_json<T: serde::Serialize>(value: &T) {
    let json = serde_json::to_string_pretty(value).expect("gate metadata should serialize");
    println!("{json}");
}
