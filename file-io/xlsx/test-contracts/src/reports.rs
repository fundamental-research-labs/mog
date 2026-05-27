//! Stable JSON report envelope for correctness and performance gates.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::commands::{GateName, GateTier};
use crate::facts::WorkbookFacts;
use crate::fingerprints::FailureFingerprint;

pub const REPORT_SCHEMA_VERSION: &str = "mog.xlsx.file_io.report.v1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GateReport {
    #[serde(rename = "$schema")]
    pub schema: String,
    pub eval: String,
    pub gate: GateName,
    pub tier: GateTier,
    pub run_id: String,
    pub timestamp: String,
    pub totals: ReportTotals,
    pub duration_ms: u64,
    pub scenarios: Vec<GateScenario>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<GateReportDomain>,
}

impl GateReport {
    pub fn new(gate: GateName, status: GateStatus) -> Self {
        let scenario = GateScenario::new(gate.as_str(), status);
        Self::from_scenarios(gate, vec![scenario], 0)
    }

    pub fn from_scenarios(gate: GateName, scenarios: Vec<GateScenario>, duration_ms: u64) -> Self {
        Self {
            schema: REPORT_SCHEMA_VERSION.to_string(),
            eval: "xlsx-file-io".to_string(),
            gate,
            tier: gate.tier(),
            run_id: format!("xlsx-file-io-{}", unix_ms()),
            timestamp: unix_ms().to_string(),
            totals: ReportTotals::from_scenarios(&scenarios),
            duration_ms,
            scenarios,
            domain: Some(GateReportDomain::default()),
        }
    }

    pub fn status(&self) -> GateStatus {
        if self.totals.failed > 0 || self.totals.blocked > 0 {
            GateStatus::Failed
        } else if self.totals.skipped == self.totals.scenarios {
            GateStatus::Skipped
        } else {
            GateStatus::Passed
        }
    }

    pub fn normalize(&mut self) {
        if let Some(domain) = &mut self.domain {
            domain
                .fingerprints
                .sort_by(|a, b| a.id.0.cmp(&b.id.0).then_with(|| a.summary.cmp(&b.summary)));
            domain.artifacts.sort_by(|a, b| a.path.cmp(&b.path));
        }
        self.scenarios.sort_by(|a, b| a.id.cmp(&b.id));
        self.totals = ReportTotals::from_scenarios(&self.scenarios);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GateStatus {
    Passed,
    Failed,
    Skipped,
    Blocked,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ReportTotals {
    pub scenarios: u32,
    pub passed: u32,
    pub failed: u32,
    pub skipped: u32,
    pub blocked: u32,
    pub release_blocking_failures: u32,
}

impl ReportTotals {
    pub fn from_scenarios(scenarios: &[GateScenario]) -> Self {
        let mut totals = Self {
            scenarios: scenarios.len() as u32,
            ..Self::default()
        };
        for scenario in scenarios {
            match scenario.status {
                GateStatus::Passed => totals.passed += 1,
                GateStatus::Failed => {
                    totals.failed += 1;
                    if scenario.release_blocking {
                        totals.release_blocking_failures += 1;
                    }
                }
                GateStatus::Skipped => totals.skipped += 1,
                GateStatus::Blocked => totals.blocked += 1,
            }
        }
        totals
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GateScenario {
    pub id: String,
    pub status: GateStatus,
    pub release_blocking: bool,
    pub duration_ms: Option<u64>,
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts: Option<WorkbookFacts>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fingerprints: Vec<FailureFingerprint>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metrics: BTreeMap<String, MetricValue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<ReportArtifact>,
}

impl GateScenario {
    pub fn new(id: impl Into<String>, status: GateStatus) -> Self {
        Self {
            id: id.into(),
            status,
            release_blocking: true,
            duration_ms: None,
            message: None,
            facts: None,
            fingerprints: Vec::new(),
            metrics: BTreeMap::new(),
            artifacts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GateReportDomain {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fingerprints: Vec<FailureFingerprint>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metrics: BTreeMap<String, MetricValue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub budgets: Vec<BudgetResult>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<ReportArtifact>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MetricValue {
    Integer(i64),
    Float(f64),
    Text(String),
    Bool(bool),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BudgetResult {
    pub name: String,
    pub status: GateStatus,
    pub actual: MetricValue,
    pub limit: MetricValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ReportArtifact {
    pub kind: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ReportPolicyViolation {
    pub code: String,
    pub path: String,
    pub message: String,
}

impl ReportPolicyViolation {
    fn new(code: impl Into<String>, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            path: path.into(),
            message: message.into(),
        }
    }
}

pub fn enforce_rollout_report_policy(report: &GateReport) -> Vec<ReportPolicyViolation> {
    let mut violations = Vec::new();

    if report.schema != REPORT_SCHEMA_VERSION {
        violations.push(ReportPolicyViolation::new(
            "report-schema-version",
            "$schema",
            format!("expected {REPORT_SCHEMA_VERSION}, got {}", report.schema),
        ));
    }

    for scenario in &report.scenarios {
        let path = format!("scenarios.{}", scenario.id);
        if scenario.status == GateStatus::Failed && scenario.fingerprints.is_empty() {
            violations.push(ReportPolicyViolation::new(
                "failed-scenario-without-fingerprint",
                &path,
                "failed scenarios must carry at least one stable fingerprint",
            ));
        }
        for fingerprint in &scenario.fingerprints {
            enforce_fingerprint_policy(fingerprint, &path, &mut violations);
        }
    }

    if let Some(domain) = &report.domain {
        for fingerprint in &domain.fingerprints {
            enforce_fingerprint_policy(fingerprint, "domain.fingerprints", &mut violations);
        }
        if matches!(report.gate, GateName::PerfGolden | GateName::PerfFull) {
            for budget in &domain.budgets {
                if budget.status == GateStatus::Failed && budget.reason.is_none() {
                    violations.push(ReportPolicyViolation::new(
                        "failed-performance-budget-without-reason",
                        format!("domain.budgets.{}", budget.name),
                        "failed performance budget updates require a named reason",
                    ));
                }
            }
        }
    }

    violations
}

fn enforce_fingerprint_policy(
    fingerprint: &FailureFingerprint,
    path: &str,
    violations: &mut Vec<ReportPolicyViolation>,
) {
    let normalized = fingerprint.id.0.to_ascii_lowercase();
    if normalized.contains("unknown")
        || normalized.contains("misc")
        || normalized.contains("raw-xml-diff")
    {
        violations.push(ReportPolicyViolation::new(
            "non-actionable-fingerprint",
            path,
            format!(
                "fingerprint '{}' uses a forbidden broad failure bucket",
                fingerprint.id.0
            ),
        ));
    }
}

fn unix_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
