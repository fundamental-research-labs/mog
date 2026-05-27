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
    pub required_inputs: Vec<String>,
}

pub fn gate_command_contracts() -> Vec<GateCommandContract> {
    GateName::ALL
        .iter()
        .copied()
        .map(|gate| GateCommandContract {
            gate,
            tier: gate.tier(),
            implemented: matches!(gate, GateName::PackageGraph),
            required_inputs: match gate {
                GateName::PackageGraph => vec!["input_xlsx_path".to_string()],
                _ => Vec::new(),
            },
        })
        .collect()
}
