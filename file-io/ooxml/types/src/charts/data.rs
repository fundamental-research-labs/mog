//! Chart data source and reference types (ECMA-376 dml-chart.xsd).

use super::*;

/// Numeric reference — formula + optional cached data (CT_NumRef).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct NumRef {
    /// Cell reference formula (e.g., "Sheet1!$B$2:$B$10")
    pub f: String,
    /// Cached numeric data
    pub num_cache: Option<NumData>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Cached numeric data (CT_NumData).
///
/// Per ECMA-376, `ptCount` is optional (minOccurs=0). `None` means absent.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct NumData {
    /// Number format code
    pub format_code: Option<String>,
    /// Point count (optional per XSD)
    pub pt_count: Option<u32>,
    /// Data points (index → value)
    pub pts: Vec<NumPoint>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

impl NumData {
    /// Effective point count — falls back to the length of `pts` when absent.
    #[must_use]
    pub fn effective_pt_count(&self) -> u32 {
        self.pt_count.unwrap_or(self.pts.len() as u32)
    }
}

/// Single numeric data point (CT_NumVal).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct NumPoint {
    /// Point index
    pub idx: u32,
    /// Numeric value as string (preserves format)
    pub v: String,
    /// Optional format code override
    pub format_code: Option<String>,
}

/// String reference — formula + optional cached data (CT_StrRef).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StrRef {
    /// Cell reference formula (e.g., "Sheet1!$A$2:$A$10")
    pub f: String,
    /// Cached string data
    pub str_cache: Option<StrData>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Cached string data (CT_StrData).
///
/// Per ECMA-376, `ptCount` is optional (minOccurs=0). `None` means absent.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StrData {
    /// Point count (optional per XSD)
    pub pt_count: Option<u32>,
    /// Data points (index → value)
    pub pts: Vec<StrPoint>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

impl StrData {
    /// Effective point count — falls back to the length of `pts` when absent.
    #[must_use]
    pub fn effective_pt_count(&self) -> u32 {
        self.pt_count.unwrap_or(self.pts.len() as u32)
    }
}

/// Single string data point (CT_StrVal).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StrPoint {
    /// Point index
    pub idx: u32,
    /// String value
    pub v: String,
}

/// Cached multi-level string data (CT_MultiLvlStrData).
///
/// Contains a point count and multiple levels, each represented as [`StrData`].
/// Per ECMA-376, `ptCount` is optional (minOccurs=0).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MultiLvlStrData {
    /// Total point count across all levels (optional per XSD)
    pub pt_count: Option<u32>,
    /// Levels of string data (each level is a [`StrData`] with its own points)
    pub levels: Vec<StrData>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

impl MultiLvlStrData {
    /// Effective point count — falls back to 0 when absent.
    #[must_use]
    pub fn effective_pt_count(&self) -> u32 {
        self.pt_count.unwrap_or(0)
    }
}

/// Multi-level string reference (CT_MultiLvlStrRef).
/// Used for hierarchical category labels.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MultiLvlStrRef {
    /// Cell reference formula
    pub f: String,
    /// Cached multi-level data
    pub multi_lvl_str_cache: Option<MultiLvlStrData>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Numeric data source — either a reference or inline literal (EG_NumData).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NumDataSource {
    /// Reference to worksheet cells
    Ref(NumRef),
    /// Inline literal data
    Lit(NumData),
}

/// String data source — either a reference or inline literal (EG_StrData).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum StrDataSource {
    /// Reference to worksheet cells
    Ref(StrRef),
    /// Inline literal data
    Lit(StrData),
}

/// Category data source (CT_AxDataSource).
/// Can be numeric, string, or multi-level string.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum CatDataSource {
    /// Numeric reference
    NumRef(NumRef),
    /// Numeric literal
    NumLit(NumData),
    /// String reference
    StrRef(StrRef),
    /// String literal
    StrLit(StrData),
    /// Multi-level string reference
    MultiLvlStrRef(MultiLvlStrRef),
}

/// Series text source (CT_SerTx).
/// Either a string reference or a direct value.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SeriesTextSource {
    /// String reference
    StrRef(StrRef),
    /// Direct string value
    Value(String),
}

/// Chart text content (CT_Tx).
///
/// Used for chart titles, trendline labels, and display units labels.
/// A choice between rich text (inline formatting) and a string reference.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ChartText {
    /// Rich text (inline formatting)
    Rich(crate::drawings::TextBody),
    /// String reference (from worksheet cell)
    StrRef(StrRef),
}
