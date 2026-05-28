use ooxml_types::cond_format::IconSetType;
use serde::{Deserialize, Serialize};

/// OOXML `<sortState>` element (CT_SortState, §18.3.1.92).
///
/// Typed OOXML preservation retyped this from a raw-XML sidecar on
/// sort state into a first-class domain field so
/// the writer no longer silently drops sort state when the blob is absent.
///
/// The `<sortState>` element is a closed XSD: every attribute and child is
/// modelled here, so the raw-XML passthrough is unnecessary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortState {
    /// Required `ref` attribute — the range the sort applies to (e.g. `A1:D20`).
    pub range_ref: String,
    /// Namespace declarations authored directly on `<sortState>`.
    ///
    /// These are XML lexical metadata rather than CT_SortState semantic fields,
    /// but producers sometimes place extension namespace declarations here.
    /// Preserve them on the typed node so parser/writer and Yrs import/export
    /// keep the complete authored element.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub namespace_attrs: Vec<(String, String)>,
    /// `columnSort` attribute — when true, sort operates column-wise rather
    /// than row-wise. Defaults to false.
    #[serde(default)]
    pub column_sort: bool,
    /// `caseSensitive` attribute — whether string comparison is case sensitive.
    /// Defaults to false.
    #[serde(default)]
    pub case_sensitive: bool,
    /// `sortMethod` attribute — CJK sort method (stroke / pinYin / none).
    /// Defaults to `None`.
    #[serde(default)]
    pub sort_method: SortMethod,
    /// Zero or more child `<sortCondition>` elements.
    #[serde(default)]
    pub conditions: Vec<SortCondition>,
    /// Raw direct-child `<extLst>` owned by this sortState.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_raw: Option<String>,
}

impl Default for SortState {
    fn default() -> Self {
        Self {
            range_ref: String::new(),
            namespace_attrs: Vec::new(),
            column_sort: false,
            case_sensitive: false,
            sort_method: SortMethod::None,
            conditions: Vec::new(),
            ext_lst_raw: None,
        }
    }
}

/// OOXML `<sortCondition>` element (CT_SortCondition, §18.3.1.91).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortCondition {
    /// Required `ref` attribute — the range this single condition applies to.
    pub range_ref: String,
    /// `descending` attribute. Defaults to false (ascending).
    #[serde(default)]
    pub descending: bool,
    /// `sortBy` attribute — what to sort on (value / cellColor / fontColor /
    /// icon). Defaults to `Value`.
    #[serde(default)]
    pub sort_by: SortConditionBy,
    /// `customList` attribute — pipe-separated custom sort list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_list: Option<String>,
    /// `dxfId` attribute — differential formatting record index used when
    /// sorting by cell/font color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dxf_id: Option<u32>,
    /// `iconSet` attribute — icon set used when sorting by icon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_set: Option<IconSetType>,
    /// `iconId` attribute — zero-based index into the icon set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_id: Option<u32>,
}

impl Default for SortCondition {
    fn default() -> Self {
        Self {
            range_ref: String::new(),
            descending: false,
            sort_by: SortConditionBy::Value,
            custom_list: None,
            dxf_id: None,
            icon_set: None,
            icon_id: None,
        }
    }
}

/// `ST_SortMethod` (§18.18.72) — CJK sort method on `<sortState>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SortMethod {
    /// No specific sort method (default).
    #[default]
    None,
    /// Sort by stroke count (CJK).
    Stroke,
    /// Sort by PinYin (CJK).
    PinYin,
}

impl SortMethod {
    /// Parse from an OOXML attribute token.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        match s {
            "none" => Some(SortMethod::None),
            "stroke" => Some(SortMethod::Stroke),
            "pinYin" => Some(SortMethod::PinYin),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute token.
    pub fn to_ooxml_token(self) -> &'static str {
        match self {
            SortMethod::None => "none",
            SortMethod::Stroke => "stroke",
            SortMethod::PinYin => "pinYin",
        }
    }
}

/// `ST_SortBy` (§18.18.71) — what a `<sortCondition>` sorts on.
///
/// Distinct from the runtime `SortBy` enum below, which collapses
/// `cellColor`/`fontColor` onto a single `Color` variant for simpler UI state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SortConditionBy {
    /// Sort by value (default).
    #[default]
    Value,
    /// Sort by cell fill color (resolved via `dxfId`).
    CellColor,
    /// Sort by font color (resolved via `dxfId`).
    FontColor,
    /// Sort by conditional-formatting icon (resolved via `iconSet` + `iconId`).
    Icon,
}

impl SortConditionBy {
    /// Parse from an OOXML attribute token.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        match s {
            "value" => Some(SortConditionBy::Value),
            "cellColor" => Some(SortConditionBy::CellColor),
            "fontColor" => Some(SortConditionBy::FontColor),
            "icon" => Some(SortConditionBy::Icon),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute token.
    pub fn to_ooxml_token(self) -> &'static str {
        match self {
            SortConditionBy::Value => "value",
            SortConditionBy::CellColor => "cellColor",
            SortConditionBy::FontColor => "fontColor",
            SortConditionBy::Icon => "icon",
        }
    }
}
