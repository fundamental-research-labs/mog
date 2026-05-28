use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// Canonical diagnostics report for spreadsheet import.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ImportDiagnostic>,
    pub stats: ImportStats,
    /// Cells that need forced recalculation.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub force_recalc_cells: Vec<ImportForceRecalcCell>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub object_statuses: Vec<ImportObjectStatus>,
}

impl ImportReport {
    /// Sort and deduplicate unordered import report collections so serialized
    /// output is stable across parser execution order.
    pub fn canonicalize(&mut self) {
        canonicalize_diagnostics(&mut self.diagnostics);
        canonicalize_force_recalc_cells(&mut self.force_recalc_cells);
        self.object_statuses.sort();
        self.object_statuses.dedup();
    }

    pub fn canonicalized(mut self) -> Self {
        self.canonicalize();
        self
    }
}

/// A cell that should be recalculated after import.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub struct ImportForceRecalcCell {
    pub sheet_index: u32,
    pub row: u32,
    pub col: u32,
}

impl From<(u32, u32, u32)> for ImportForceRecalcCell {
    fn from((sheet_index, row, col): (u32, u32, u32)) -> Self {
        Self {
            sheet_index,
            row,
            col,
        }
    }
}

impl From<ImportForceRecalcCell> for (u32, u32, u32) {
    fn from(cell: ImportForceRecalcCell) -> Self {
        (cell.sheet_index, cell.row, cell.col)
    }
}

/// A single import diagnostic.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDiagnostic {
    pub id: String,
    pub code: ImportDiagnosticCode,
    pub severity: ImportSeverity,
    pub feature: ImportFeatureKind,
    pub recoverability: ImportRecoverability,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<ImportDiagnosticRef>,
}

/// A stable reference to the imported source object that produced a diagnostic.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDiagnosticRef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_range: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature_kind: Option<ImportFeatureKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_parts: Vec<String>,
}

/// Aggregate statistics from an import run.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStats {
    pub total_cells: u32,
    pub total_sheets: u32,
    pub parse_time_us: u64,
}

/// Render/edit status for a non-cell imported object or feature.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportObjectStatus {
    pub source: ImportSource,
    pub feature_kind: ImportFeatureKind,
    pub recoverability: ImportRecoverability,
    pub renderability: ImportRenderability,
    pub editability: ImportEditability,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ImportDiagnosticRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<ImportDiagnosticRef>,
}

impl Default for ImportObjectStatus {
    fn default() -> Self {
        Self {
            source: ImportSource::Xlsx,
            feature_kind: ImportFeatureKind::Unknown,
            recoverability: ImportRecoverability::FullySupported,
            renderability: ImportRenderability::Renderable,
            editability: ImportEditability::Editable,
            diagnostics: Vec::new(),
            reference: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportSource {
    Xlsx,
    Csv,
    Native,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ImportSeverity {
    Info,
    #[default]
    Warning,
    Error,
    Fatal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ImportRecoverability {
    #[default]
    FullySupported,
    Repaired,
    PartiallySupported,
    PreservedNotRenderable,
    PreservedNotEditable,
    UnsupportedPreserved,
    UnsupportedDropped,
    MalformedDropped,
    SecurityDisabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportFeatureKind {
    Workbook,
    Worksheet,
    Cell,
    Formula,
    Style,
    Theme,
    Chart,
    Diagram,
    TextEffects,
    Drawing,
    Image,
    Table,
    PivotTable,
    Slicer,
    ConditionalFormat,
    DataValidation,
    Comment,
    FormControl,
    OleObject,
    ActiveX,
    Hyperlink,
    Protection,
    PrintSettings,
    ExternalLink,
    Macro,
    Metadata,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportDiagnosticCode {
    InvalidArchive,
    MissingPart,
    MissingRelationshipTarget,
    MalformedRelationshipTarget,
    ChartPartEmptySeries,
    ChartPartMissingDataRange,
    UnsupportedChartType,
    MissingImagePart,
    UnsupportedImageMime,
    FormulaParseFailed,
    UnsupportedFormulaFunction,
    InvalidStyleIndex,
    InvalidSharedStringIndex,
    InvalidRangeReference,
    SecurityDisabledActiveContent,
    MalformedXml,
    InvalidRelationship,
    InvalidCellReference,
    InvalidCellValue,
    InvalidFormula,
    UnsupportedFeature,
    UnsupportedVersion,
    UnsupportedEncryption,
    ExternalReference,
    CompatibilityAcknowledgement,
    DataCorruption,
    TruncatedFile,
    RoundTripLoss,
    RecalcRequired,
    InternalInvariant,
    LegacyParseCode(u32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ImportRenderability {
    #[default]
    Renderable,
    Placeholder,
    NotRenderable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ImportEditability {
    #[default]
    Editable,
    PartiallyEditable,
    NotEditable,
}

pub fn canonicalize_force_recalc_cells(cells: &mut Vec<ImportForceRecalcCell>) {
    cells.sort_unstable();
    cells.dedup();
}

pub fn canonicalize_diagnostics(diagnostics: &mut Vec<ImportDiagnostic>) {
    diagnostics.sort();
    diagnostics.dedup();
}

/// Diagnostics collected during parsing.
///
/// Compatibility type. New code should use [`ImportReport`].
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseDiagnostics {
    pub errors: Vec<ParseError>,
    pub stats: ParseStats,
    /// Cells that need forced recalculation (e.g., volatile functions, external refs).
    /// Each tuple is (sheet_index, row, col) to preserve sheet identity.
    /// Skipped during serialization for legacy compatibility.
    #[serde(skip)]
    pub force_recalc_cells: HashSet<(u32, u32, u32)>,
    /// Canonical import report. Legacy callers may still read `errors`/`stats`,
    /// but public import APIs should prefer this when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_report: Option<ImportReport>,
}

impl ParseDiagnostics {
    pub fn into_import_report(self) -> ImportReport {
        self.into()
    }

    pub fn from_import_report(report: ImportReport) -> Self {
        report.into()
    }
}

/// Compatibility type. New code should use [`ImportDiagnostic`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseError {
    pub code: u32,
    /// Severity level: "warning", "error", or "fatal".
    pub severity: String,
    pub message: String,
    /// The OOXML part path where the error occurred.
    pub part: Option<String>,
    pub row: Option<u32>,
    pub col: Option<u32>,
}

impl ParseError {
    pub fn into_import_diagnostic(self) -> ImportDiagnostic {
        self.into()
    }
}

/// Compatibility type. New code should use [`ImportStats`].
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseStats {
    pub total_cells: u32,
    pub total_sheets: u32,
    pub parse_time_us: u64,
}

impl From<ParseStats> for ImportStats {
    fn from(stats: ParseStats) -> Self {
        Self {
            total_cells: stats.total_cells,
            total_sheets: stats.total_sheets,
            parse_time_us: stats.parse_time_us,
        }
    }
}

impl From<ImportStats> for ParseStats {
    fn from(stats: ImportStats) -> Self {
        Self {
            total_cells: stats.total_cells,
            total_sheets: stats.total_sheets,
            parse_time_us: stats.parse_time_us,
        }
    }
}

impl From<ParseError> for ImportDiagnostic {
    fn from(error: ParseError) -> Self {
        Self {
            id: deterministic_diagnostic_id(
                &ImportDiagnosticCode::LegacyParseCode(error.code),
                error.part.as_deref(),
                None,
                error.row,
                error.col,
                None,
            ),
            code: ImportDiagnosticCode::LegacyParseCode(error.code),
            severity: parse_legacy_severity(&error.severity),
            feature: ImportFeatureKind::Unknown,
            recoverability: ImportRecoverability::PartiallySupported,
            message: error.message,
            reference: Some(ImportDiagnosticRef {
                part: error.part,
                row: error.row,
                col: error.col,
                ..ImportDiagnosticRef::default()
            }),
        }
    }
}

impl From<ImportDiagnostic> for ParseError {
    fn from(diagnostic: ImportDiagnostic) -> Self {
        let reference = diagnostic.reference.unwrap_or_default();
        Self {
            code: match diagnostic.code {
                ImportDiagnosticCode::LegacyParseCode(code) => code,
                _ => 0,
            },
            severity: legacy_severity(diagnostic.severity).to_string(),
            message: diagnostic.message,
            part: reference.part,
            row: reference.row,
            col: reference.col,
        }
    }
}

impl From<ParseDiagnostics> for ImportReport {
    fn from(diagnostics: ParseDiagnostics) -> Self {
        if let Some(report) = diagnostics.import_report {
            return report.canonicalized();
        }

        let mut force_recalc_cells: Vec<_> = diagnostics
            .force_recalc_cells
            .into_iter()
            .map(ImportForceRecalcCell::from)
            .collect();
        canonicalize_force_recalc_cells(&mut force_recalc_cells);

        Self {
            diagnostics: diagnostics
                .errors
                .into_iter()
                .map(ImportDiagnostic::from)
                .collect(),
            stats: diagnostics.stats.into(),
            force_recalc_cells,
            object_statuses: Vec::new(),
        }
        .canonicalized()
    }
}

impl From<ImportReport> for ParseDiagnostics {
    fn from(mut report: ImportReport) -> Self {
        report.canonicalize();
        Self {
            errors: report
                .diagnostics
                .clone()
                .into_iter()
                .map(ParseError::from)
                .collect(),
            stats: report.stats.clone().into(),
            force_recalc_cells: report
                .force_recalc_cells
                .clone()
                .into_iter()
                .map(Into::into)
                .collect(),
            import_report: Some(report),
        }
    }
}

pub fn deterministic_diagnostic_id(
    code: &ImportDiagnosticCode,
    part: Option<&str>,
    relationship_id: Option<&str>,
    row: Option<u32>,
    col: Option<u32>,
    object_id: Option<&str>,
) -> String {
    let code = serde_json::to_string(code)
        .unwrap_or_else(|_| format!("{code:?}"))
        .trim_matches('"')
        .to_string();
    format!(
        "{}:{}:{}:{}:{}:{}",
        code,
        part.unwrap_or(""),
        relationship_id.unwrap_or(""),
        row.map(|v| v.to_string()).unwrap_or_default(),
        col.map(|v| v.to_string()).unwrap_or_default(),
        object_id.unwrap_or("")
    )
}

fn parse_legacy_severity(severity: &str) -> ImportSeverity {
    match severity {
        "info" => ImportSeverity::Info,
        "error" => ImportSeverity::Error,
        "fatal" => ImportSeverity::Fatal,
        _ => ImportSeverity::Warning,
    }
}

fn legacy_severity(severity: ImportSeverity) -> &'static str {
    match severity {
        ImportSeverity::Info => "info",
        ImportSeverity::Warning => "warning",
        ImportSeverity::Error => "error",
        ImportSeverity::Fatal => "fatal",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn import_report_serializes_camel_case_with_force_recalc_cells() {
        let report = ImportReport {
            diagnostics: vec![ImportDiagnostic {
                code: ImportDiagnosticCode::UnsupportedFeature,
                severity: ImportSeverity::Warning,
                feature: ImportFeatureKind::Chart,
                recoverability: ImportRecoverability::PartiallySupported,
                id: "unsupportedFeature:xl/charts/chart1.xml:::4:6:chart-1".to_string(),
                message: "Unsupported chart extension".to_string(),
                reference: Some(ImportDiagnosticRef {
                    id: None,
                    part: Some("xl/charts/chart1.xml".to_string()),
                    relationship_id: None,
                    relationship_target: None,
                    sheet_index: Some(2),
                    sheet_name: None,
                    row: Some(4),
                    col: Some(6),
                    cell_ref: None,
                    source_range: None,
                    feature_kind: Some(ImportFeatureKind::Chart),
                    object_id: Some("chart-1".to_string()),
                    object_name: None,
                    related_parts: Vec::new(),
                }),
            }],
            stats: ImportStats {
                total_cells: 12,
                total_sheets: 1,
                parse_time_us: 42,
            },
            force_recalc_cells: vec![ImportForceRecalcCell {
                sheet_index: 2,
                row: 4,
                col: 6,
            }],
            object_statuses: vec![ImportObjectStatus {
                source: ImportSource::Xlsx,
                feature_kind: ImportFeatureKind::Chart,
                recoverability: ImportRecoverability::PreservedNotRenderable,
                renderability: ImportRenderability::Placeholder,
                editability: ImportEditability::PartiallyEditable,
                diagnostics: Vec::new(),
                reference: None,
            }],
        };

        assert_eq!(
            serde_json::to_value(report).unwrap(),
            json!({
                "diagnostics": [{
                    "code": "unsupportedFeature",
                    "severity": "warning",
                    "feature": "chart",
                    "recoverability": "partiallySupported",
                    "id": "unsupportedFeature:xl/charts/chart1.xml:::4:6:chart-1",
                    "message": "Unsupported chart extension",
                    "reference": {
                        "part": "xl/charts/chart1.xml",
                        "sheetIndex": 2,
                        "row": 4,
                        "col": 6,
                        "featureKind": "chart",
                        "objectId": "chart-1"
                    }
                }],
                "stats": {
                    "totalCells": 12,
                    "totalSheets": 1,
                    "parseTimeUs": 42
                },
                "forceRecalcCells": [{"sheetIndex": 2, "row": 4, "col": 6}],
                "objectStatuses": [{
                    "source": "xlsx",
                    "featureKind": "chart",
                    "recoverability": "preservedNotRenderable",
                    "renderability": "placeholder",
                    "editability": "partiallyEditable"
                }]
            })
        );
    }

    #[test]
    fn canonicalize_sorts_and_dedupes_force_recalc_cells_and_diagnostics() {
        let diagnostic = ImportDiagnostic {
            id: "recalc".to_string(),
            code: ImportDiagnosticCode::RecalcRequired,
            severity: ImportSeverity::Info,
            feature: ImportFeatureKind::Formula,
            recoverability: ImportRecoverability::Repaired,
            message: "Formula cache is stale".to_string(),
            reference: None,
        };
        let earlier = ImportDiagnostic {
            message: "Earlier diagnostic".to_string(),
            ..diagnostic.clone()
        };
        let mut report = ImportReport {
            diagnostics: vec![diagnostic.clone(), earlier.clone(), diagnostic.clone()],
            force_recalc_cells: vec![
                ImportForceRecalcCell::from((1, 4, 1)),
                ImportForceRecalcCell::from((0, 2, 3)),
                ImportForceRecalcCell::from((1, 4, 1)),
            ],
            ..ImportReport::default()
        };

        report.canonicalize();

        assert_eq!(
            report.force_recalc_cells,
            vec![
                ImportForceRecalcCell::from((0, 2, 3)),
                ImportForceRecalcCell::from((1, 4, 1))
            ]
        );
        assert_eq!(report.diagnostics, vec![earlier, diagnostic]);
    }

    #[test]
    fn parse_diagnostics_from_import_report_preserves_canonical_report() {
        let report = ImportReport {
            object_statuses: vec![ImportObjectStatus {
                source: ImportSource::Xlsx,
                feature_kind: ImportFeatureKind::Chart,
                recoverability: ImportRecoverability::PreservedNotRenderable,
                renderability: ImportRenderability::Placeholder,
                editability: ImportEditability::PartiallyEditable,
                diagnostics: Vec::new(),
                reference: None,
            }],
            ..ImportReport::default()
        };

        let diagnostics = ParseDiagnostics::from_import_report(report.clone());

        assert_eq!(diagnostics.import_report, Some(report));
    }
}
