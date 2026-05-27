//! Stable gate command names and tiers.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GateName {
    OoxmlContract,
    PackageGraph,
    L2Contract,
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
        GateName::L2Contract,
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
            GateName::L2Contract => "l2-contract",
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
            | GateName::L2Contract
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
            "l2-contract" => Ok(GateName::L2Contract),
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
            GateName::L2Contract => GateProducer::LaneBContractMatrix,
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
            GateName::L2Contract => "cargo test -p compute-core xlsx_contract",
            GateName::CorpusSmoke => "pnpm --filter @mog/xlsx-parser-wasm run gate:corpus-smoke",
            GateName::CorpusAntiCheat => {
                "pnpm --filter @mog/xlsx-parser-wasm run gate:corpus-anti-cheat"
            }
            GateName::CorpusGolden => "pnpm --filter @mog/xlsx-parser-wasm run gate:corpus-golden",
            GateName::PerfSmoke => "pnpm --filter @mog/xlsx-corpus-eval run perf-smoke",
            GateName::PerfGolden => "pnpm --filter @mog/xlsx-corpus-eval run perf-golden",
            GateName::CorpusFull => "pnpm --filter @mog/xlsx-parser-wasm run gate:corpus-full",
            GateName::PerfFull => "pnpm --filter @mog/xlsx-corpus-eval run perf-full",
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
            GateName::OoxmlContract | GateName::L2Contract => Vec::new(),
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            GateName::OoxmlContract => "generated OOXML contract fixtures",
            GateName::PackageGraph => "OPC relationship and content type integrity",
            GateName::L2Contract => "production import, storage, and export persistence",
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
        GateSuiteName::LocalSmoke => vec![
            GateName::OoxmlContract,
            GateName::PackageGraph,
            GateName::L2Contract,
            GateName::CorpusSmoke,
            GateName::PerfSmoke,
        ],
        GateSuiteName::CiGolden => vec![
            GateName::OoxmlContract,
            GateName::PackageGraph,
            GateName::L2Contract,
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
