use super::*;

use bridge_types::DescribeSchema;
use ooxml_types::cond_format::{
    CfOperator, CfTimePeriod, CfvoType, DataBarAxisPosition, DataBarDirection, IconSetType,
};
use ooxml_types::styles::{BorderStyle, UnderlineStyle};
use serde::de::IntoDeserializer;
use serde::{Deserialize, Serialize};

/// Cell range for conditional formatting (position-based).
/// Re-export of `cell_types::SheetRange` for ergonomic use in CF contexts.
pub type CFCellRange = cell_types::SheetRange;

/// Cell-identity-based range for collaborative editing.
/// Identifies a rectangular region by the stable IDs of its corner cells,
/// so the range survives row/column insertions and deletions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellIdRange {
    pub top_left_cell_id: String,
    pub bottom_right_cell_id: String,
}

// =============================================================================
// Top-level: ConditionalFormat
// =============================================================================

/// A conditional format definition.
/// Associates one or more rules with cell ranges on a sheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, DescribeSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConditionalFormat {
    /// Format identifier (UUID string).
    pub id: String,
    /// Sheet ID (UUID string).
    pub sheet_id: String,
    /// Whether this CF applies to a pivot table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pivot: Option<bool>,
    /// Position-based ranges (structured, not A1 strings).
    pub ranges: Vec<CFCellRange>,
    /// Cell-identity-based ranges (optional, for collaborative editing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range_identities: Option<Vec<CellIdRange>>,
    /// Rules to evaluate (in priority order).
    pub rules: Vec<CFRule>,
}

// =============================================================================
// CFRule: tagged enum
// =============================================================================

/// A single conditional formatting rule.
/// Tagged enum — each variant carries only its relevant fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CFRule {
    /// Compare cell value against threshold(s).
    #[serde(rename = "cellValue")]
    CellValue {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        /// Comparison operator. Only the `lessThan` / `lessThanOrEqual` /
        /// `equal` / `notEqual` / `greaterThan` / `greaterThanOrEqual` /
        /// `between` / `notBetween` subset of [`CfOperator`] is meaningful for
        /// cellIs rules; the text-operator variants belong on
        /// [`CFRule::ContainsText`]. Domain not narrowed at the type level
        /// because the OOXML vocabulary is a single `ST_ConditionalFormattingOperator`.
        operator: CfOperator,
        value1: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value2: Option<serde_json::Value>,
        style: CFStyle,
        /// Preserved `text` attribute from OOXML for round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    /// Custom formula returns TRUE/FALSE.
    #[serde(rename = "formula", alias = "expression")]
    Formula {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        formula: String,
        style: CFStyle,
        /// Preserved `text` attribute from OOXML for round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    /// 2-color or 3-color gradient.
    #[serde(rename = "colorScale")]
    ColorScale {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        #[serde(alias = "colorScale")]
        color_scale: CFColorScale,
    },
    /// In-cell horizontal bar chart.
    #[serde(rename = "dataBar")]
    DataBar {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        #[serde(alias = "dataBar")]
        data_bar: CFDataBar,
    },
    /// Conditional icons (arrows, flags, etc.).
    #[serde(rename = "iconSet")]
    IconSet {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        #[serde(alias = "iconSet")]
        icon_set: CFIconSet,
    },
    /// Top/bottom N or N%.
    #[serde(rename = "top10")]
    Top10 {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        rank: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        percent: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bottom: Option<bool>,
        style: CFStyle,
    },
    /// Above/below average.
    #[serde(rename = "aboveAverage")]
    AboveAverage {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        above_average: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        equal_average: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        std_dev: Option<i32>,
        style: CFStyle,
        /// Original formula preserved for XLSX round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formula: Option<String>,
    },
    /// Highlight duplicates or uniques.
    #[serde(rename = "duplicateValues")]
    DuplicateValues {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        unique: Option<bool>,
        style: CFStyle,
    },
    /// Text contains, begins with, ends with, not contains.
    #[serde(rename = "containsText")]
    ContainsText {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        /// Text operator. Only the `containsText` / `notContains` /
        /// `beginsWith` / `endsWith` subset of [`CfOperator`] is meaningful
        /// for text rules; the cellIs comparison variants belong on
        /// [`CFRule::CellValue`]. Domain not narrowed at the type level
        /// because the OOXML vocabulary is a single `ST_ConditionalFormattingOperator`.
        operator: CfOperator,
        text: String,
        style: CFStyle,
        /// Original formula preserved for XLSX round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formula: Option<String>,
    },
    /// Blank or non-blank cells.
    #[serde(rename = "containsBlanks")]
    ContainsBlanks {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        blanks: bool,
        style: CFStyle,
        /// Original formula preserved for XLSX round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formula: Option<String>,
    },
    /// Error or non-error cells.
    #[serde(rename = "containsErrors")]
    ContainsErrors {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        errors: bool,
        style: CFStyle,
        /// Original formula preserved for XLSX round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formula: Option<String>,
    },
    /// Date-based rules (yesterday, today, tomorrow, etc.).
    #[serde(rename = "timePeriod")]
    TimePeriod {
        id: String,
        priority: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_if_true: Option<bool>,
        time_period: CfTimePeriod,
        style: CFStyle,
        /// Original formula preserved for XLSX round-trip fidelity.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formula: Option<String>,
    },
}

impl CFRule {
    /// Returns the rule's unique identifier.
    pub fn id(&self) -> &str {
        match self {
            Self::CellValue { id, .. }
            | Self::Formula { id, .. }
            | Self::ColorScale { id, .. }
            | Self::DataBar { id, .. }
            | Self::IconSet { id, .. }
            | Self::Top10 { id, .. }
            | Self::AboveAverage { id, .. }
            | Self::DuplicateValues { id, .. }
            | Self::ContainsText { id, .. }
            | Self::ContainsBlanks { id, .. }
            | Self::ContainsErrors { id, .. }
            | Self::TimePeriod { id, .. } => id,
        }
    }

    /// Returns the rule's priority.
    pub fn priority(&self) -> i32 {
        match self {
            Self::CellValue { priority, .. }
            | Self::Formula { priority, .. }
            | Self::ColorScale { priority, .. }
            | Self::DataBar { priority, .. }
            | Self::IconSet { priority, .. }
            | Self::Top10 { priority, .. }
            | Self::AboveAverage { priority, .. }
            | Self::DuplicateValues { priority, .. }
            | Self::ContainsText { priority, .. }
            | Self::ContainsBlanks { priority, .. }
            | Self::ContainsErrors { priority, .. }
            | Self::TimePeriod { priority, .. } => *priority,
        }
    }

    /// Sets the rule's priority in-place.
    pub fn set_priority(&mut self, p: i32) {
        match self {
            Self::CellValue { priority, .. }
            | Self::Formula { priority, .. }
            | Self::ColorScale { priority, .. }
            | Self::DataBar { priority, .. }
            | Self::IconSet { priority, .. }
            | Self::Top10 { priority, .. }
            | Self::AboveAverage { priority, .. }
            | Self::DuplicateValues { priority, .. }
            | Self::ContainsText { priority, .. }
            | Self::ContainsBlanks { priority, .. }
            | Self::ContainsErrors { priority, .. }
            | Self::TimePeriod { priority, .. } => *priority = p,
        }
    }
}

// =============================================================================
// Wire-Input Normalization
// =============================================================================
//
// The public/canonical TS schema accepts several aliases and shape variants
// that the canonical Rust [`CFRule`] enum doesn't directly model:
//
// - `notContainsBlanks` — semantic alias for `containsBlanks` with `blanks: false`
// - `notContainsErrors` — semantic alias for `containsErrors` with `errors: false`
// - `cellValue` + text-operator — should promote to `containsText`
//   (the text operator subset of `CfOperator` belongs on a `containsText` rule)
// - `top10` with `value1` instead of `rank`, plus operator-based `bottom`/`percent` flags
// - `containsText` with `value1` instead of `text`
//
// `expression` → `formula` is handled by `#[serde(alias = "expression")]` on
// the `Formula` variant; numeric `value1` → `formula` mapping is **not**
// supported because they're different semantic fields (formula is a string,
// value1 is a comparison threshold) — callers must send `formula` explicitly.
//
// Field renames within a single variant could be expressed as
// `#[serde(alias = "...")]` but the *type* promotions
// (`cellValue` → `containsText`, negation flips) require rewriting the JSON
// before deserialization. We do that in [`normalize_cf_rule_input`], which
// mutates a `serde_json::Value` in-place.

/// Set of cellValue operators that actually belong on a `containsText` rule.
/// Callers historically sent `{ type: 'cellValue', operator: 'containsText',
/// value1: 'foo' }`; the correct shape is `{ type: 'containsText', operator:
/// 'containsText', text: 'foo' }`.
const TEXT_OPERATORS: &[&str] = &[
    "containsText",
    "notContainsText",
    "notContains",
    "beginsWith",
    "endsWith",
];

/// Public CF rule types the canonical [`CFRule`] enum models (after
/// normalization). This is the complete enumeration of every variant
/// the public TS API can produce or that XLSX hydration emits.
///
/// Used as a reference target for [`normalize_cf_rule_input`] —
/// every input the public API accepts must rewrite into one of these
/// canonical type tags.
pub const CANONICAL_CF_RULE_TYPES: &[&str] = &[
    "cellValue",
    "formula",
    "colorScale",
    "dataBar",
    "iconSet",
    "top10",
    "aboveAverage",
    "duplicateValues",
    "containsText",
    "containsBlanks",
    "containsErrors",
    "timePeriod",
];

/// Normalize a single CF rule's wire JSON in-place to the canonical
/// [`CFRule`] shape. Idempotent on already-canonical input.
///
/// Handles every **public CF rule type variant** the TS API accepts or
/// XLSX hydration emits. The complete public set:
///
/// | Public type tag       | Canonical tag       | Normalization                                                           |
/// |-----------------------|---------------------|-------------------------------------------------------------------------|
/// | `cellIs`              | `cellValue`         | OOXML alias for `cellValue`; rewrites the type tag                      |
/// | `cellValue` + text op | `containsText`      | text-operator subset (containsText / beginsWith / etc.) belongs on `containsText` |
/// | `cellValue`           | `cellValue`         | comparison operators stay; `formula`/`value` shorthand → `value1`       |
/// | `formula`/`expression`| `formula`           | `expression` is a serde alias; `value1` shorthand → `formula` field     |
/// | `colorScale`          | `colorScale`        | nested `colorScale` payload — no shape change                           |
/// | `dataBar`             | `dataBar`           | nested `dataBar` payload — no shape change                              |
/// | `iconSet`             | `iconSet`           | nested `iconSet` payload — no shape change                              |
/// | `top10`               | `top10`             | `value1` → `rank`, operator → `percent`/`bottom` flags                  |
/// | `aboveAverage`        | `aboveAverage`      | default `above_average: true` if unset; `belowAverage` flips the flag    |
/// | `belowAverage`        | `aboveAverage`      | OOXML doesn't have a separate type; this is the negation of aboveAverage |
/// | `duplicateValues`     | `duplicateValues`   | direct                                                                  |
/// | `uniqueValues`        | `duplicateValues`   | OOXML semantic: unique = duplicate-style with `unique: true`             |
/// | `containsText` + `value1` | `containsText`  | `value1` → `text` fallback                                              |
/// | `containsBlanks`      | `containsBlanks`    | default `blanks: true` if unset                                         |
/// | `notContainsBlanks`   | `containsBlanks`    | sets `blanks: false`                                                    |
/// | `containsErrors`      | `containsErrors`    | default `errors: true` if unset                                         |
/// | `notContainsErrors`   | `containsErrors`    | sets `errors: false`                                                    |
/// | `timePeriod`          | `timePeriod`        | direct                                                                  |
///
/// Field-rename aliases that don't change the type tag (e.g.
/// `expression` → `formula` variant) are handled by `#[serde(alias)]`
/// on the canonical enum directly.
pub fn normalize_cf_rule_input(rule: &mut serde_json::Value) {
    let serde_json::Value::Object(obj) = rule else {
        return;
    };
    let Some(serde_json::Value::String(rule_type)) = obj.get("type").cloned() else {
        return;
    };

    match rule_type.as_str() {
        // --- cellIs → cellValue (OOXML alias for the public `cellIs` type) ---
        // `<cfRule type="cellIs">` is the OOXML element name; the canonical
        // Rust enum uses `cellValue`. After the type rename, the same
        // shape-normalization the `cellValue` arm performs runs through.
        "cellIs" => {
            obj.insert("type".into(), serde_json::Value::String("cellValue".into()));
            normalize_cell_value_arm(obj);
        }
        // --- notContainsBlanks → containsBlanks{blanks:false} ---
        "notContainsBlanks" => {
            obj.insert(
                "type".into(),
                serde_json::Value::String("containsBlanks".into()),
            );
            obj.entry("blanks")
                .or_insert(serde_json::Value::Bool(false));
        }
        "containsBlanks" => {
            obj.entry("blanks").or_insert(serde_json::Value::Bool(true));
        }
        // --- notContainsErrors → containsErrors{errors:false} ---
        "notContainsErrors" => {
            obj.insert(
                "type".into(),
                serde_json::Value::String("containsErrors".into()),
            );
            obj.entry("errors")
                .or_insert(serde_json::Value::Bool(false));
        }
        "containsErrors" => {
            obj.entry("errors").or_insert(serde_json::Value::Bool(true));
        }
        // --- cellValue: text op → containsText; comparison op → keep ---
        "cellValue" => {
            normalize_cell_value_arm(obj);
        }
        // --- top10: value1 → rank + operator-based flags ---
        "top10" => {
            if !obj.contains_key("rank")
                && let Some(v1) = obj.remove("value1")
            {
                let rank = match &v1 {
                    serde_json::Value::Number(n) => n.as_u64().unwrap_or(10),
                    serde_json::Value::String(s) => s.parse::<u64>().unwrap_or(10),
                    _ => 10,
                };
                obj.insert("rank".into(), serde_json::json!(rank));
            }
            if let Some(serde_json::Value::String(op)) = obj.get("operator").cloned() {
                match op.as_str() {
                    "bottom" => {
                        obj.entry("bottom").or_insert(serde_json::Value::Bool(true));
                    }
                    "topPercent" | "bottomPercent" => {
                        obj.entry("percent")
                            .or_insert(serde_json::Value::Bool(true));
                        if op == "bottomPercent" {
                            obj.entry("bottom").or_insert(serde_json::Value::Bool(true));
                        }
                    }
                    _ => {}
                }
            }
            // top10 has no `operator` field on the canonical struct.
            obj.remove("operator");
        }
        // --- containsText: value1 → text fallback ---
        "containsText" => {
            if !obj.contains_key("text")
                && let Some(v1) = obj.remove("value1")
            {
                let text = match v1 {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                };
                obj.insert("text".into(), serde_json::Value::String(text));
            }
            if obj.get("operator").and_then(|v| v.as_str()) == Some("notContainsText") {
                obj.insert(
                    "operator".into(),
                    serde_json::Value::String("notContains".into()),
                );
            }
        }
        // --- formula / expression: value1 shorthand → formula field ---
        // The `expression` alias is handled by `#[serde(alias = "expression")]`
        // on the `Formula` variant tag. But callers historically also send
        // the formula text in `value1` instead of `formula` (matching the
        // `cellValue` shape). Promote `value1` → `formula` when the
        // `formula` field is missing.
        "formula" | "expression" => {
            obj.insert("type".into(), serde_json::Value::String("formula".into()));
            if !obj.contains_key("formula")
                && let Some(v1) = obj.remove("value1")
            {
                let formula = match v1 {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                };
                obj.insert("formula".into(), serde_json::Value::String(formula));
            }
            // `formula` has no `operator` field on the canonical struct.
            obj.remove("operator");
            obj.remove("value2");
        }
        // --- aboveAverage: default flag if absent ---
        // Rust fields stay snake_case (`above_average`); serialized JSON
        // uses the camelCase TS/API wire shape.
        "aboveAverage" => {
            obj.entry("aboveAverage")
                .or_insert(serde_json::Value::Bool(true));
        }
        // --- belowAverage → aboveAverage{aboveAverage:false} ---
        // OOXML uses a single type with a flag; some public callers send
        // `belowAverage` as a separate type tag.
        "belowAverage" => {
            obj.insert(
                "type".into(),
                serde_json::Value::String("aboveAverage".into()),
            );
            obj.insert("aboveAverage".into(), serde_json::Value::Bool(false));
        }
        // --- uniqueValues → duplicateValues{unique:true} ---
        // OOXML's `uniqueValues` is the negation form of `duplicateValues`;
        // the canonical enum collapses both into `DuplicateValues` with a
        // `unique` flag.
        "uniqueValues" => {
            obj.insert(
                "type".into(),
                serde_json::Value::String("duplicateValues".into()),
            );
            obj.entry("unique").or_insert(serde_json::Value::Bool(true));
        }
        "duplicateValues" => {
            // No-op: the canonical `DuplicateValues { unique: Option<bool> }`
            // accepts a missing field (defaults via serde to `None`, which
            // the evaluator interprets as "duplicates").
        }
        // The remaining canonical type tags carry only a nested payload
        // (colorScale / dataBar / iconSet) or a typed field
        // (timePeriod) and have no public-shape coercion to perform.
        "colorScale" | "dataBar" | "iconSet" | "timePeriod" => {}
        _ => {}
    }
}

/// Shape-coerce a `cellValue`/`cellIs` rule. Extracted so the `cellIs`
/// type-rename arm can share the same body without re-entering
/// `normalize_cf_rule_input` recursively.
fn normalize_cell_value_arm(obj: &mut serde_json::Map<String, serde_json::Value>) {
    let op_is_text = obj
        .get("operator")
        .and_then(|v| v.as_str())
        .is_some_and(|op| TEXT_OPERATORS.contains(&op));
    if op_is_text {
        obj.insert(
            "type".into(),
            serde_json::Value::String("containsText".into()),
        );
        let text = obj
            .get("value1")
            .map(|v| match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default();
        obj.insert("text".into(), serde_json::Value::String(text));
        // Normalize `notContainsText` (deprecated public alias) to
        // the canonical `notContains` OOXML token enforced on
        // `containsText.operator`.
        if obj.get("operator").and_then(|v| v.as_str()) == Some("notContainsText") {
            obj.insert(
                "operator".into(),
                serde_json::Value::String("notContains".into()),
            );
        }
        obj.remove("value1");
        obj.remove("value2");
        return;
    }

    // `cellValue` with a comparison operator: support shorthand fields
    // historically used by the public API.
    //   - `value` → `value1` (single-shorthand for an equality/comparison test)
    //   - `formula` field on a `cellValue` rule: the public API sometimes
    //     ships an OOXML-style formula token as the comparison value;
    //     the canonical schema accepts any JSON in `value1`, so we promote
    //     `formula: '...'` → `value1: '...'` when `value1` is missing.
    if !obj.contains_key("value1") {
        if let Some(v) = obj.remove("value") {
            obj.insert("value1".into(), v);
        } else if let Some(f) = obj.remove("formula") {
            obj.insert("value1".into(), f);
        }
    }
}

/// Normalize all rules in a `ConditionalFormat`-shaped JSON value in-place.
/// Walks `value["rules"]` and applies [`normalize_cf_rule_input`] to each
/// element. No-op if `rules` is missing or not an array.
pub fn normalize_conditional_format_input(value: &mut serde_json::Value) {
    let Some(rules) = value.get_mut("rules").and_then(|r| r.as_array_mut()) else {
        return;
    };
    for rule in rules.iter_mut() {
        normalize_cf_rule_input(rule);
    }
}

// =============================================================================
// CFStyle (unified — inline struct, not a style_id index)
// =============================================================================

/// Style to apply when a CF rule matches.
/// All properties are optional — only specified properties are applied.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CFStyle {
    // -- Background --
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,

    // -- Font --
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// Underline type (ECMA-376 ST_UnderlineValues). Serializes as OOXML
    /// tokens: `"none"` | `"single"` | `"double"` | `"singleAccounting"` |
    /// `"doubleAccounting"`. Legacy `underline: true/false` values are
    /// accepted via the separate `underline_legacy` field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline_type: Option<UnderlineStyle>,
    /// Legacy boolean underline — accepted on read (alias), but we always
    /// write `underlineType` for new data. Kept for backward compat with
    /// existing Yrs documents that stored `"underline": true`.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "underline")]
    pub underline_legacy: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strikethrough: Option<bool>,

    // -- Number format --
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,

    // -- Borders (unified) --
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    /// Unified border style (ECMA-376 ST_BorderStyle). Serializes as
    /// OOXML tokens like `"thin"`, `"medium"`, `"dashed"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_style: Option<BorderStyle>,

    // -- Per-side borders --
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_top_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_top_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_bottom_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_bottom_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_left_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_left_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_right_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_right_style: Option<String>,

    /// OOXML dxfId index — preserved for roundtrip fidelity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dxf_id: Option<u32>,
}

// =============================================================================
// Sub-configs (color scale, data bar, icon set)
// =============================================================================

/// Typed boundary value for a color-scale / data-bar / icon-set point.
///
/// Replaces the former `value_type: CfvoType` + `value:
/// Option<serde_json::Value>` pair with a single tagged enum. The pair was a
/// typed union ("kind" + "payload") pushed through `serde_json::Value`
/// because `domain-types` did not have a typed spelling for the payload. Each
/// variant carries exactly the data that boundary kind needs (or `()` for
/// min/max / auto-min/auto-max).
///
/// Wire shape: `{ "kind": "num"|"percent"|... , "value": <payload> }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CFValueRef {
    /// Numeric threshold (`cfvo.type="num"`).
    #[serde(rename = "num")]
    Number { value: f64 },
    /// Percent along the [min, max] range (`cfvo.type="percent"`).
    Percent { value: f64 },
    /// Percentile over the evaluated range (`cfvo.type="percentile"`).
    Percentile { value: f64 },
    /// Formula whose result is coerced to a numeric threshold
    /// (`cfvo.type="formula"`). The formula text is preserved verbatim
    /// for round-trip; parsing happens at the compute-cf boundary.
    Formula { source: String },
    /// Automatic minimum of the evaluated range (`cfvo.type="min"`).
    Min,
    /// Automatic maximum of the evaluated range (`cfvo.type="max"`).
    Max,
    /// Excel 2010+ extension: auto-computed minimum
    /// (`cfvo.type="autoMin"`). Preserved for round-trip with files
    /// written by Excel 2010+.
    AutoMin,
    /// Excel 2010+ extension: auto-computed maximum
    /// (`cfvo.type="autoMax"`).
    AutoMax,
}

impl Default for CFValueRef {
    fn default() -> Self {
        // Match the pre-typed-OOXML-preservation default: `value_type: CfvoType::Num`
        // (the CfvoType::default()) + `value: None` flattened to a
        // number point whose value is zero. Existing consumers that
        // default-constructed a `CFColorPoint` then assigned fields
        // continue to behave identically — the `value_type=Num, value=None`
        // combination never appeared on a valid rule.
        Self::Number { value: 0.0 }
    }
}

impl CFValueRef {
    /// Returns the corresponding OOXML `ST_CfvoType` token.
    pub fn cfvo_type(&self) -> CfvoType {
        match self {
            Self::Number { .. } => CfvoType::Num,
            Self::Percent { .. } => CfvoType::Percent,
            Self::Percentile { .. } => CfvoType::Percentile,
            Self::Formula { .. } => CfvoType::Formula,
            Self::Min => CfvoType::Min,
            Self::Max => CfvoType::Max,
            Self::AutoMin => CfvoType::AutoMin,
            Self::AutoMax => CfvoType::AutoMax,
        }
    }

    /// Returns the numeric payload if this variant carries one.
    pub fn number_value(&self) -> Option<f64> {
        match self {
            Self::Number { value } | Self::Percent { value } | Self::Percentile { value } => {
                Some(*value)
            }
            _ => None,
        }
    }

    /// Build a typed value from an OOXML `<cfvo>` `(type, val)` pair.
    /// `val` is the raw `val=` attribute string; numeric variants parse
    /// it as `f64` falling back to `0.0` (matching the historical
    /// forgiving parse via `serde_json::Value`). The formula variant
    /// preserves the attribute verbatim.
    pub fn from_ooxml(cfvo_type: CfvoType, val: Option<&str>) -> Self {
        match cfvo_type {
            CfvoType::Num => Self::Number {
                value: val.and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0),
            },
            CfvoType::Percent => Self::Percent {
                value: val.and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0),
            },
            CfvoType::Percentile => Self::Percentile {
                value: val.and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0),
            },
            CfvoType::Formula => Self::Formula {
                source: val.unwrap_or("").to_string(),
            },
            CfvoType::Min => Self::Min,
            CfvoType::Max => Self::Max,
            CfvoType::AutoMin => Self::AutoMin,
            CfvoType::AutoMax => Self::AutoMax,
        }
    }

    /// Returns the OOXML `val=` attribute contents for writer code that
    /// needs to emit the `val=` attribute verbatim.
    pub fn to_ooxml_val(&self) -> Option<String> {
        match self {
            Self::Number { value } | Self::Percent { value } | Self::Percentile { value } => {
                Some(format_f64_compact(*value))
            }
            Self::Formula { source } => Some(source.clone()),
            Self::Min | Self::Max | Self::AutoMin | Self::AutoMax => None,
        }
    }
}

/// Render an `f64` compactly for OOXML attribute emission — integer-
/// valued numbers produce their integer form ("50" not "50.0").
#[inline]
fn format_f64_compact(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e16 {
        format!("{}", n as i64)
    } else {
        format!("{}", n)
    }
}

/// A single point in a color scale (min, mid, max) or data bar (min, max).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFColorPoint {
    /// Typed boundary value. The former `value_type: CfvoType` + `value:
    /// Option<serde_json::Value>` pair collapsed into one enum in
    /// typed OOXML preservation. See [`CFValueRef`].
    pub value: CFValueRef,
    /// Original OOXML `cfvo@val` text. Payload-carrying CFVO kinds can be
    /// reconstructed from `value`, but payloadless kinds such as `min`/`max`
    /// still sometimes carry `val="0"` in producer files. Preserve it for
    /// byte-fidelity without changing evaluation semantics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ooxml_value: Option<String>,
    pub color: String,
    /// Theme color index (0-based), e.g. 0 = background1, 1 = text1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_theme: Option<u32>,
    /// Tint adjustment (-1.0 to 1.0) applied on top of theme/indexed color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_tint: Option<f64>,
    /// Indexed color palette entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_indexed: Option<u32>,
    /// Automatic color flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_auto: Option<bool>,
}

/// Color scale configuration (2 or 3 colors).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFColorScale {
    pub min_point: CFColorPoint,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mid_point: Option<CFColorPoint>,
    pub max_point: CFColorPoint,
}

/// Data bar configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFDataBar {
    pub min_point: CFColorPoint,
    pub max_point: CFColorPoint,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_length: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<u32>,
    pub positive_color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub negative_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_border: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gradient: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<DataBarDirection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis_position: Option<DataBarAxisPosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_value: Option<bool>,
    /// When true, negative bars use the positive fill color instead of negative_color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_positive_fill_color: Option<bool>,
    /// When true, negative bars use the positive border color instead of negative_border_color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_positive_border_color: Option<bool>,
    /// XLSX round-trip: x14:id linking standard databar to its extended version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_id: Option<String>,
}

/// Icon set configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFIconSet {
    pub icon_set_name: IconSetType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverse_order: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_icon_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thresholds: Vec<CFIconThreshold>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_icons: Vec<Option<CFCustomIcon>>,
}

/// A threshold within an icon set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFIconThreshold {
    #[serde(rename = "type")]
    pub value_type: CfvoType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub gte: bool,
}

/// A custom icon override within an icon set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFCustomIcon {
    pub icon_set: String,
    pub icon_id: u32,
}

// === CF Classification Enums (moved from compute-cf) ===

/// Conditional formatting rule types (Excel-compatible).
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CFRuleType {
    CellValue,
    #[serde(alias = "expression")]
    Formula,
    ColorScale,
    DataBar,
    IconSet,
    Top10,
    AboveAverage,
    DuplicateValues,
    ContainsText,
    #[serde(alias = "notContainsText")]
    NotContainsText,
    #[serde(alias = "beginsWith")]
    BeginsWith,
    #[serde(alias = "endsWith")]
    EndsWith,
    ContainsBlanks,
    NotContainsBlanks,
    ContainsErrors,
    NotContainsErrors,
    TimePeriod,
}

/// Comparison operators for cellValue rules.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CFOperator {
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
    Equal,
    NotEqual,
    Between,
    NotBetween,
}

impl CFOperator {
    /// Deserialize an OOXML operator token (e.g. `"greaterThan"`) into the typed enum.
    ///
    /// Returns `None` if `s` is not a recognized OOXML operator token. Does not
    /// panic on arbitrary input; malformed tokens yield `None` via serde's
    /// standard deserialization error path.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        let de: serde::de::value::StrDeserializer<serde::de::value::Error> = s.into_deserializer();
        Self::deserialize(de).ok()
    }
}

/// Text operators for containsText rules.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CFTextOperator {
    Contains,
    NotContains,
    BeginsWith,
    EndsWith,
}

impl CFTextOperator {
    /// Deserialize an OOXML text operator token (e.g. `"beginsWith"`) into the typed enum.
    ///
    /// Returns `None` if `s` is not a recognized token. Does not panic on
    /// arbitrary input.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        let de: serde::de::value::StrDeserializer<serde::de::value::Error> = s.into_deserializer();
        Self::deserialize(de).ok()
    }
}

/// Date periods for timePeriod rules (Excel-compatible).
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum DatePeriod {
    Yesterday,
    Today,
    Tomorrow,
    Last7Days,
    LastWeek,
    ThisWeek,
    NextWeek,
    LastMonth,
    ThisMonth,
    NextMonth,
    LastQuarter,
    ThisQuarter,
    NextQuarter,
    LastYear,
    ThisYear,
    NextYear,
}

impl DatePeriod {
    /// Deserialize an OOXML time-period token (e.g. `"last7Days"`) into the typed enum.
    ///
    /// Returns `None` if `s` is not a recognized token. Does not panic on
    /// arbitrary input.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        let de: serde::de::value::StrDeserializer<serde::de::value::Error> = s.into_deserializer();
        Self::deserialize(de).ok()
    }
}
