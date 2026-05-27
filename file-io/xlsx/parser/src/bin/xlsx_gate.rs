//! File I/O gate command surface.

use std::fs;
use std::path::PathBuf;
use std::str::FromStr;

use xlsx_parser::testing::{
    GateName, GateReport, GateReportDomain, GateScenario, GateStatus, MetricValue,
    validate_package_graph_bytes,
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

    let gate = match GateName::from_str(&gate_name) {
        Ok(gate) => gate,
        Err(err) => {
            eprintln!("{err}");
            print_usage();
            std::process::exit(2);
        }
    };

    let mut output: Option<PathBuf> = None;
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
            other => positional.push(other.to_string()),
        }
    }

    let (report, exit_code) = match gate {
        GateName::PackageGraph => run_package_graph_gate(positional),
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
    eprintln!("Usage: xlsx-gate <gate-name> [input.xlsx] [--output report.json]");
    eprintln!("Gate names:");
    for gate in GateName::ALL {
        eprintln!("  {}", gate.as_str());
    }
}
