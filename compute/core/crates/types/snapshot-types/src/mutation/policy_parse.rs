use serde::{Deserialize, Serialize};

use cell_types::{CellId, SheetId};

/// Automatic conversion category that was disabled by workbook policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutomaticConversionCategory {
    /// Date-like input such as `3/15/2024`.
    DateLikeText,
    /// Time-like input such as `12:30`.
    TimeLikeText,
    /// Fraction-like input such as `1/2` in a fraction-formatted cell.
    FractionLikeText,
    /// Scientific notation such as `1e9`.
    ScientificNotation,
    /// Leading-zero numeric identifier such as `00123`.
    LeadingZeroNumber,
    /// Long digit token such as a 16-digit identifier.
    LongDigitNumber,
    /// Percent suffix such as `50%`.
    PercentSuffix,
    /// Currency symbol such as `$1,234.56`.
    CurrencySymbol,
    /// Formatted number such as `1,234` or `(500)`.
    FormattedNumber,
}

/// Per-cell metadata emitted when policy preserves parsed input as text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyPreservedParseOutcome {
    /// Sheet identity.
    pub sheet_id: SheetId,
    /// Stable cell identity.
    pub cell_id: CellId,
    /// Zero-based row.
    pub row: u32,
    /// Zero-based column.
    pub col: u32,
    /// Submitted text, possibly truncated in large mutation results.
    pub submitted_text: String,
    /// Disabled category that matched.
    pub category: AutomaticConversionCategory,
}

/// Bounded summary for policy-preserved parse metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PolicyPreservedParseSummary {
    /// Total preserved cells.
    pub total_preserved: u64,
    /// Detailed entries emitted.
    pub emitted_count: u64,
    /// Preserved cells omitted by the detail cap.
    pub omitted_count: u64,
    /// Whether detailed entries were capped.
    pub outcome_entries_truncated: bool,
    /// Emitted entries whose submitted text was shortened.
    pub submitted_text_truncated_count: u64,
}
