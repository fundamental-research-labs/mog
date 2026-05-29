//! Stable gate command names and tiers.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GateName {
    OoxmlContract,
    PackageGraph,
    CorpusSmoke,
    CorpusAntiCheat,
    CorpusGolden,
    PerfSmoke,
    PerfGolden,
    CorpusFull,
    PerfFull,
}

impl GateName {
    pub const ALL: &'static [GateName] = &[
        GateName::OoxmlContract,
        GateName::PackageGraph,
        GateName::CorpusSmoke,
        GateName::CorpusAntiCheat,
        GateName::CorpusGolden,
        GateName::PerfSmoke,
        GateName::PerfGolden,
        GateName::CorpusFull,
        GateName::PerfFull,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            GateName::OoxmlContract => "ooxml-contract",
            GateName::PackageGraph => "package-graph",
            GateName::CorpusSmoke => "corpus-smoke",
            GateName::CorpusAntiCheat => "corpus-anti-cheat",
            GateName::CorpusGolden => "corpus-golden",
            GateName::PerfSmoke => "perf-smoke",
            GateName::PerfGolden => "perf-golden",
            GateName::CorpusFull => "corpus-full",
            GateName::PerfFull => "perf-full",
        }
    }

    pub fn tier(self) -> GateTier {
        match self {
            GateName::OoxmlContract
            | GateName::PackageGraph
            | GateName::CorpusSmoke
            | GateName::PerfSmoke => GateTier::Smoke,
            GateName::CorpusAntiCheat | GateName::CorpusGolden | GateName::PerfGolden => {
                GateTier::Golden
            }
            GateName::CorpusFull | GateName::PerfFull => GateTier::Full,
        }
    }
}

impl std::str::FromStr for GateName {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "ooxml-contract" => Ok(GateName::OoxmlContract),
            "package-graph" => Ok(GateName::PackageGraph),
            "corpus-smoke" => Ok(GateName::CorpusSmoke),
            "corpus-anti-cheat" => Ok(GateName::CorpusAntiCheat),
            "corpus-golden" => Ok(GateName::CorpusGolden),
            "perf-smoke" => Ok(GateName::PerfSmoke),
            "perf-golden" => Ok(GateName::PerfGolden),
            "corpus-full" => Ok(GateName::CorpusFull),
            "perf-full" => Ok(GateName::PerfFull),
            other => Err(format!("unknown file I/O gate: {other}")),
        }
    }
}

impl std::fmt::Display for GateName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GateTier {
    Smoke,
    Golden,
    Full,
}

impl GateTier {
    pub fn as_str(self) -> &'static str {
        match self {
            GateTier::Smoke => "smoke",
            GateTier::Golden => "golden",
            GateTier::Full => "full",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GateCommandContract {
    pub gate: GateName,
    pub tier: GateTier,
    pub implemented: bool,
    pub producer: GateProducer,
    pub command: String,
    pub required_inputs: Vec<String>,
    pub heavy: bool,
    pub description: String,
}

pub fn gate_command_contracts() -> Vec<GateCommandContract> {
    GateName::ALL
        .iter()
        .copied()
        .map(gate_command_contract)
        .collect()
}

pub fn gate_command_contract(gate: GateName) -> GateCommandContract {
    GateCommandContract {
        gate,
        tier: gate.tier(),
        implemented: matches!(
            gate,
            GateName::OoxmlContract
                | GateName::PackageGraph
                | GateName::PerfSmoke
                | GateName::PerfGolden
                | GateName::PerfFull
        ),
        producer: gate.producer(),
        command: gate.default_command().to_string(),
        required_inputs: gate.required_inputs(),
        heavy: matches!(
            gate,
            GateName::CorpusAntiCheat
                | GateName::CorpusGolden
                | GateName::PerfGolden
                | GateName::CorpusFull
                | GateName::PerfFull
        ),
        description: gate.description().to_string(),
    }
}

impl GateName {
    pub fn producer(self) -> GateProducer {
        match self {
            GateName::PackageGraph => GateProducer::LaneAOpcOwnership,
            GateName::OoxmlContract => GateProducer::LaneBContractMatrix,
            GateName::CorpusSmoke | GateName::CorpusAntiCheat | GateName::CorpusGolden => {
                GateProducer::LaneCCorpusAntiCheat
            }
            GateName::PerfSmoke | GateName::PerfGolden | GateName::PerfFull => {
                GateProducer::LaneDProductionPerformance
            }
            GateName::CorpusFull => GateProducer::LaneEGatesRollout,
        }
    }

    pub fn default_command(self) -> &'static str {
        match self {
            GateName::OoxmlContract => "cargo test -p xlsx-parser ooxml_contract",
            GateName::PackageGraph => {
                "cargo run -p xlsx-parser --bin xlsx-gate --features cli -- package-graph <input.xlsx>"
            }
            GateName::CorpusSmoke => "pnpm --filter @mog/xlsx-parser-wasm run gate:corpus-smoke",
            GateName::CorpusAntiCheat => {
                "pnpm --filter @mog/xlsx-parser-wasm run gate:corpus-anti-cheat"
            }
            GateName::CorpusGolden => "pnpm --filter @mog/xlsx-parser-wasm run gate:corpus-golden",
            GateName::PerfSmoke => "pnpm --filter @mog/xlsx-parser-wasm run gate:perf-smoke",
            GateName::PerfGolden => "pnpm --filter @mog/xlsx-parser-wasm run gate:perf-golden",
            GateName::CorpusFull => "pnpm --filter @mog/xlsx-parser-wasm run gate:corpus-full",
            GateName::PerfFull => "pnpm --filter @mog/xlsx-parser-wasm run gate:perf-full",
        }
    }

    pub fn required_inputs(self) -> Vec<String> {
        match self {
            GateName::PackageGraph => vec!["input_xlsx_path".to_string()],
            GateName::CorpusSmoke
            | GateName::CorpusAntiCheat
            | GateName::CorpusGolden
            | GateName::CorpusFull => vec!["corpus_root_or_manifest".to_string()],
            GateName::PerfSmoke | GateName::PerfGolden | GateName::PerfFull => Vec::new(),
            GateName::OoxmlContract => Vec::new(),
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            GateName::OoxmlContract => "generated OOXML contract fixtures",
            GateName::PackageGraph => "OPC relationship and content type integrity",
            GateName::CorpusSmoke => "quick real-file correctness",
            GateName::CorpusAntiCheat => "mutation and context replay rejection",
            GateName::CorpusGolden => "curated real-file correctness budgets",
            GateName::PerfSmoke => "quick production-path performance",
            GateName::PerfGolden => "real and generated scale performance budgets",
            GateName::CorpusFull => "broad real-file dialect discovery",
            GateName::PerfFull => "broad production-path performance discovery",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GateProducer {
    LaneAOpcOwnership,
    LaneBContractMatrix,
    LaneCCorpusAntiCheat,
    LaneDProductionPerformance,
    LaneEGatesRollout,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GateSuiteContract {
    pub name: String,
    pub description: String,
    pub gates: Vec<GateCommandContract>,
}

impl GateSuiteContract {
    pub fn commands(&self) -> Vec<&str> {
        self.gates
            .iter()
            .map(|contract| contract.command.as_str())
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GateSuiteReadiness {
    pub suite: String,
    pub runnable: bool,
    pub allow_heavy: bool,
    pub blockers: Vec<GateSuiteReadinessBlocker>,
    pub commands: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GateSuiteReadinessBlocker {
    pub gate: GateName,
    pub code: String,
    pub message: String,
}

pub fn gate_suite_readiness(suite: GateSuiteName, allow_heavy: bool) -> GateSuiteReadiness {
    let contract = gate_suite_contract(suite);
    let mut blockers = Vec::new();

    for gate in &contract.gates {
        if !gate.implemented {
            blockers.push(GateSuiteReadinessBlocker {
                gate: gate.gate,
                code: "gate-not-implemented".to_string(),
                message: format!(
                    "{} is owned by {:?} and has not published a runnable gate yet",
                    gate.gate, gate.producer
                ),
            });
        }
        if gate.heavy && !allow_heavy {
            blockers.push(GateSuiteReadinessBlocker {
                gate: gate.gate,
                code: "heavy-gate-requires-explicit-opt-in".to_string(),
                message: format!("{} is a heavy gate and requires --allow-heavy", gate.gate),
            });
        }
    }

    GateSuiteReadiness {
        suite: contract.name,
        runnable: blockers.is_empty(),
        allow_heavy,
        blockers,
        commands: contract
            .gates
            .into_iter()
            .map(|gate| gate.command)
            .collect(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GateSuiteName {
    LocalSmoke,
    CiGolden,
    AutonomousFull,
}

impl GateSuiteName {
    pub fn as_str(self) -> &'static str {
        match self {
            GateSuiteName::LocalSmoke => "local-smoke",
            GateSuiteName::CiGolden => "ci-golden",
            GateSuiteName::AutonomousFull => "autonomous-full",
        }
    }
}

impl std::str::FromStr for GateSuiteName {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "local-smoke" | "smoke" | "local" => Ok(GateSuiteName::LocalSmoke),
            "ci-golden" | "golden" | "ci" => Ok(GateSuiteName::CiGolden),
            "autonomous-full" | "full" | "autonomous" => Ok(GateSuiteName::AutonomousFull),
            other => Err(format!("unknown XLSX gate suite: {other}")),
        }
    }
}

pub fn gate_suite_contract(suite: GateSuiteName) -> GateSuiteContract {
    let gates = match suite {
        GateSuiteName::LocalSmoke => vec![GateName::OoxmlContract, GateName::PerfSmoke],
        GateSuiteName::CiGolden => vec![
            GateName::OoxmlContract,
            GateName::PackageGraph,
            GateName::CorpusSmoke,
            GateName::CorpusAntiCheat,
            GateName::CorpusGolden,
            GateName::PerfSmoke,
            GateName::PerfGolden,
        ],
        GateSuiteName::AutonomousFull => GateName::ALL.to_vec(),
    };

    GateSuiteContract {
        name: suite.as_str().to_string(),
        description: match suite {
            GateSuiteName::LocalSmoke => "fast local/CI gates for routine file I/O changes",
            GateSuiteName::CiGolden => {
                "golden correctness and performance gates for release readiness"
            }
            GateSuiteName::AutonomousFull => {
                "expensive discovery gates for autonomous or nightly workers"
            }
        }
        .to_string(),
        gates: gates.into_iter().map(gate_command_contract).collect(),
    }
}

pub fn gate_suite_contracts() -> Vec<GateSuiteContract> {
    vec![
        gate_suite_contract(GateSuiteName::LocalSmoke),
        gate_suite_contract(GateSuiteName::CiGolden),
        gate_suite_contract(GateSuiteName::AutonomousFull),
    ]
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AutonomousRunSchedule {
    pub name: String,
    pub cadence: String,
    pub execution_policy: String,
    pub jobs: Vec<AutonomousRunJob>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AutonomousRunJob {
    pub gate: GateName,
    pub command: String,
    pub sequence: u32,
    pub allow_heavy: bool,
    pub exclusive_resource_key: String,
    pub output_report: String,
    pub notes: Vec<String>,
}

pub fn autonomous_full_run_schedule() -> AutonomousRunSchedule {
    let corpus_full = gate_command_contract(GateName::CorpusFull);
    let perf_full = gate_command_contract(GateName::PerfFull);

    AutonomousRunSchedule {
        name: "xlsx-autonomous-full".to_string(),
        cadence: "nightly-or-explicit-autonomous-worker".to_string(),
        execution_policy:
            "run correctness discovery before performance discovery; do not overlap perf-full with CPU-heavy corpus gates"
                .to_string(),
        jobs: vec![
            AutonomousRunJob {
                gate: GateName::CorpusFull,
                command: corpus_full.command,
                sequence: 1,
                allow_heavy: true,
                exclusive_resource_key: "xlsx-corpus-cpu-heavy".to_string(),
                output_report: "xlsx-corpus-full-report.json".to_string(),
                notes: vec![
                    "map every failure to a stable fingerprint".to_string(),
                    "promote recurring failures into Lane B matrix rows or explicit policy"
                        .to_string(),
                ],
            },
            AutonomousRunJob {
                gate: GateName::PerfFull,
                command: perf_full.command,
                sequence: 2,
                allow_heavy: true,
                exclusive_resource_key: "xlsx-perf-cpu-exclusive".to_string(),
                output_report: "xlsx-perf-full-report.json".to_string(),
                notes: vec![
                    "compare by workbook class and phase".to_string(),
                    "budget changes require a named reason".to_string(),
                ],
            },
        ],
    }
}
