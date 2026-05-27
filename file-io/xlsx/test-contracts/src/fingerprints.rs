//! Stable failure fingerprints shared by correctness and performance gates.

use serde::{Deserialize, Serialize};

pub const FINGERPRINT_SCHEMA_VERSION: u32 = 1;
pub const FINGERPRINT_PREFIX: &str = "mog-xlsx-io-fp:v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FingerprintSeverity {
    Info,
    Warning,
    Error,
    Regression,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FingerprintOwner {
    Contract,
    Corpus,
    L2,
    Performance,
    PackageGraph,
    Harness,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CorrectnessFingerprintCategory {
    PackageGraph,
    RelationshipClassification,
    TargetResolution,
    ContentType,
    ModeledStateLoss,
    L2PersistenceLoss,
    StaleSourceReplay,
    OpaquePreservationPolicy,
    StyleThemeFidelity,
    SharedStringsFidelity,
    FormulaFidelity,
    DimensionsUsedRange,
    CommentsVmlDrawingOwnership,
    TablePivotChartSidecarOwnership,
    DocumentPropertyPolicy,
    UnsupportedFeaturePolicy,
    HarnessBug,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PerformanceFingerprintCategory {
    ZipReadWrite,
    XmlParseWrite,
    SharedStringsAlgorithmicPath,
    StylesAlgorithmicPath,
    WorksheetCellIteration,
    FormulaProcessing,
    DomainHydration,
    StorageYrsPersistence,
    ExportSerialization,
    PackageGraphConstruction,
    MemoryGrowth,
    OutputSizeGrowth,
    HarnessMeasurementBug,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "category", rename_all = "kebab-case")]
pub enum FingerprintCategory {
    Correctness(CorrectnessFingerprintCategory),
    Performance(PerformanceFingerprintCategory),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FingerprintId(pub String);

impl FingerprintId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct FailureFingerprint {
    pub schema_version: u32,
    pub id: FingerprintId,
    pub category: FingerprintCategory,
    pub severity: FingerprintSeverity,
    pub owner: FingerprintOwner,
    pub summary: String,
    pub proof: FingerprintProof,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<FingerprintEvidence>,
}

impl FailureFingerprint {
    pub fn new(
        id: impl Into<String>,
        category: FingerprintCategory,
        severity: FingerprintSeverity,
        owner: FingerprintOwner,
        summary: impl Into<String>,
    ) -> Self {
        let id = FingerprintId::new(id);
        Self {
            schema_version: FINGERPRINT_SCHEMA_VERSION,
            proof: FingerprintProof::from_id(&id),
            id,
            category,
            severity,
            owner,
            summary: summary.into(),
            evidence: Vec::new(),
        }
    }

    pub fn with_evidence(mut self, evidence: FingerprintEvidence) -> Self {
        self.evidence.push(evidence);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct FingerprintProof {
    pub version: String,
    pub algorithm: String,
    pub digest: String,
    pub canonicalization: String,
    pub covered_fields: Vec<String>,
    pub issued_by: String,
}

impl FingerprintProof {
    fn from_id(id: &FingerprintId) -> Self {
        Self {
            version: "v1".to_string(),
            algorithm: "stable-id".to_string(),
            digest: format!("{FINGERPRINT_PREFIX}:stable-id:{}", id.0),
            canonicalization: "sorted-canonical-json".to_string(),
            covered_fields: vec![
                "id".to_string(),
                "category".to_string(),
                "severity".to_string(),
                "owner".to_string(),
            ],
            issued_by: "xlsx-test-contracts".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct FingerprintEvidence {
    pub path: Option<String>,
    pub field: Option<String>,
    pub expected: Option<String>,
    pub actual: Option<String>,
    pub message: String,
}

impl FingerprintEvidence {
    pub fn message(message: impl Into<String>) -> Self {
        Self {
            path: None,
            field: None,
            expected: None,
            actual: None,
            message: message.into(),
        }
    }

    pub fn at_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
        self
    }

    pub fn expected_actual(
        mut self,
        expected: impl Into<String>,
        actual: impl Into<String>,
    ) -> Self {
        self.expected = Some(expected.into());
        self.actual = Some(actual.into());
        self
    }
}
