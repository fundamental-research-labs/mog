//! Unified conditional formatting types.
//!
//! Single source of truth for CF data — used by the XLSX parser, yrs_schema
//! hydration, cf_store runtime CRUD, and XLSX export. Replaces both the old
//! `domain::conditional::CFSpec` and `compute-core::domain_types::cf::ConditionalFormat`.
//!
//! # Typed-enum fields
//!
//! Eight CF enum-valued fields are typed as their `ooxml-types` enum directly
//! instead of `String` / `Option<String>`:
//!
//! - [`CFRule::CellValue`] `operator`
//! - [`CFRule::ContainsText`] `operator`
//! - [`CFRule::TimePeriod`] `time_period`
//! - [`CFColorPoint`] `value_type`
//! - [`CFIconThreshold`] `value_type`
//! - [`CFDataBar`] `direction` / `axis_position`
//! - [`CFIconSet`] `icon_set_name`
//!
//! Wire compat is preserved: each enum carries `#[serde(rename = "<ooxml-token>")]`
//! so the JSON / Yrs byte shape is identical to what the pre-refactor `String`
//! field held (`op.to_ooxml().to_string()`).

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

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip_json<T: Serialize + for<'de> Deserialize<'de> + PartialEq + std::fmt::Debug>(
        val: &T,
    ) {
        let json = serde_json::to_string(val).unwrap();
        let back: T = serde_json::from_str(&json).unwrap();
        assert_eq!(val, &back);
    }

    #[test]
    fn cell_value_roundtrip() {
        let rule = CFRule::CellValue {
            id: "r1".into(),
            priority: 1,
            stop_if_true: Some(true),
            operator: CfOperator::GreaterThan,
            value1: serde_json::json!(100),
            value2: None,
            style: CFStyle {
                background_color: Some("#FF0000".into()),
                ..Default::default()
            },
            text: None,
        };
        roundtrip_json(&rule);
    }

    /// Locks the wire-compat invariant: the on-wire form of the
    /// `operator` field is the OOXML token string `"greaterThan"`, not a
    /// Rust variant name or PascalCase rendering.
    #[test]
    fn cell_value_operator_wire_shape() {
        let rule = CFRule::CellValue {
            id: "r1".into(),
            priority: 1,
            stop_if_true: None,
            operator: CfOperator::GreaterThan,
            value1: serde_json::json!(100),
            value2: None,
            style: CFStyle::default(),
            text: None,
        };
        let v: serde_json::Value = serde_json::to_value(&rule).unwrap();
        assert_eq!(v["operator"], "greaterThan");
    }

    #[test]
    fn formula_roundtrip() {
        let rule = CFRule::Formula {
            id: "r2".into(),
            priority: 2,
            stop_if_true: None,
            formula: "=A1>B1".into(),
            style: CFStyle::default(),
            text: None,
        };
        roundtrip_json(&rule);
    }

    #[test]
    fn color_scale_roundtrip() {
        let rule = CFRule::ColorScale {
            id: "r3".into(),
            priority: 3,
            stop_if_true: None,
            color_scale: CFColorScale {
                min_point: CFColorPoint {
                    value: CFValueRef::Min,
                    color: "#FF0000".into(),
                    ..Default::default()
                },
                mid_point: Some(CFColorPoint {
                    value: CFValueRef::Percentile { value: 50.0 },
                    color: "#FFFF00".into(),
                    ..Default::default()
                }),
                max_point: CFColorPoint {
                    value: CFValueRef::Max,
                    color: "#00FF00".into(),
                    ..Default::default()
                },
            },
        };
        roundtrip_json(&rule);
    }

    #[test]
    fn data_bar_roundtrip() {
        let rule = CFRule::DataBar {
            id: "r4".into(),
            priority: 4,
            stop_if_true: None,
            data_bar: CFDataBar {
                min_point: CFColorPoint {
                    value: CFValueRef::Min,
                    color: "".into(),
                    ..Default::default()
                },
                max_point: CFColorPoint {
                    value: CFValueRef::Max,
                    color: "".into(),
                    ..Default::default()
                },
                min_length: None,
                max_length: None,
                positive_color: "#638EC6".into(),
                negative_color: Some("#FF0000".into()),
                border_color: None,
                show_border: None,
                gradient: Some(true),
                direction: None,
                axis_position: None,
                axis_color: None,
                show_value: Some(true),
                ext_id: Some("{abc-123}".into()),
                match_positive_fill_color: None,
                match_positive_border_color: None,
            },
        };
        roundtrip_json(&rule);
    }

    #[test]
    fn icon_set_roundtrip() {
        let rule = CFRule::IconSet {
            id: "r5".into(),
            priority: 5,
            stop_if_true: None,
            icon_set: CFIconSet {
                icon_set_name: IconSetType::ThreeArrows,
                reverse_order: Some(false),
                show_icon_only: None,
                thresholds: vec![
                    CFIconThreshold {
                        value_type: CfvoType::Percent,
                        value: Some("33".into()),
                        gte: true,
                    },
                    CFIconThreshold {
                        value_type: CfvoType::Percent,
                        value: Some("67".into()),
                        gte: true,
                    },
                ],
                custom_icons: vec![],
            },
        };
        roundtrip_json(&rule);
    }

    #[test]
    fn top10_roundtrip() {
        let rule = CFRule::Top10 {
            id: "r6".into(),
            priority: 6,
            stop_if_true: None,
            rank: 10,
            percent: Some(true),
            bottom: Some(false),
            style: CFStyle::default(),
        };
        roundtrip_json(&rule);
    }

    #[test]
    fn above_average_roundtrip() {
        let rule = CFRule::AboveAverage {
            id: "r7".into(),
            priority: 7,
            stop_if_true: None,
            above_average: true,
            equal_average: Some(false),
            std_dev: Some(1),
            style: CFStyle::default(),
            formula: Some("=AVERAGE(A1:A10)".into()),
        };
        roundtrip_json(&rule);
    }

    #[test]
    fn duplicate_values_roundtrip() {
        let rule = CFRule::DuplicateValues {
            id: "r8".into(),
            priority: 8,
            stop_if_true: None,
            unique: Some(true),
            style: CFStyle::default(),
        };
        roundtrip_json(&rule);
    }

    #[test]
    fn contains_text_roundtrip() {
        let rule = CFRule::ContainsText {
            id: "r9".into(),
            priority: 9,
            stop_if_true: None,
            operator: CfOperator::ContainsText,
            text: "hello".into(),
            style: CFStyle::default(),
            formula: Some("=NOT(ISERROR(SEARCH(\"hello\",A1)))".into()),
        };
        roundtrip_json(&rule);
    }

    /// Locks the wire-compat invariant for ContainsText: the `operator`
    /// field serializes to the OOXML token string (e.g. `"containsText"`),
    /// not a Rust variant name.
    #[test]
    fn contains_text_operator_wire_shape() {
        let rule = CFRule::ContainsText {
            id: "r9".into(),
            priority: 9,
            stop_if_true: None,
            operator: CfOperator::ContainsText,
            text: "hello".into(),
            style: CFStyle::default(),
            formula: None,
        };
        let v: serde_json::Value = serde_json::to_value(&rule).unwrap();
        assert_eq!(v["operator"], "containsText");
    }

    #[test]
    fn contains_blanks_roundtrip() {
        let rule = CFRule::ContainsBlanks {
            id: "r10".into(),
            priority: 10,
            stop_if_true: None,
            blanks: true,
            style: CFStyle::default(),
            formula: Some("=LEN(TRIM(A1))=0".into()),
        };
        roundtrip_json(&rule);
        // Non-blank variant
        let non_blank = CFRule::ContainsBlanks {
            id: "r10b".into(),
            priority: 11,
            stop_if_true: None,
            blanks: false,
            style: CFStyle::default(),
            formula: Some("=LEN(TRIM(A1))>0".into()),
        };
        roundtrip_json(&non_blank);
    }

    #[test]
    fn contains_errors_roundtrip() {
        let rule = CFRule::ContainsErrors {
            id: "r11".into(),
            priority: 12,
            stop_if_true: None,
            errors: true,
            style: CFStyle::default(),
            formula: Some("=ISERROR(A1)".into()),
        };
        roundtrip_json(&rule);
        // Non-error variant
        let non_error = CFRule::ContainsErrors {
            id: "r11b".into(),
            priority: 13,
            stop_if_true: None,
            errors: false,
            style: CFStyle::default(),
            formula: Some("=NOT(ISERROR(A1))".into()),
        };
        roundtrip_json(&non_error);
    }

    #[test]
    fn time_period_roundtrip() {
        let rule = CFRule::TimePeriod {
            id: "r12".into(),
            priority: 14,
            stop_if_true: None,
            time_period: CfTimePeriod::Today,
            style: CFStyle::default(),
            formula: Some("=FLOOR(A1,1)=TODAY()".into()),
        };
        roundtrip_json(&rule);
    }

    /// Locks the wire-compat invariant for TimePeriod: the
    /// `time_period` field serializes to the OOXML token string, and reads
    /// back as the same enum variant.
    #[test]
    fn time_period_wire_shape() {
        let rule = CFRule::TimePeriod {
            id: "r12".into(),
            priority: 14,
            stop_if_true: None,
            time_period: CfTimePeriod::Last7Days,
            style: CFStyle::default(),
            formula: None,
        };
        let v: serde_json::Value = serde_json::to_value(&rule).unwrap();
        assert_eq!(v["timePeriod"], "last7Days");
        let back: CFRule = serde_json::from_value(v).unwrap();
        match back {
            CFRule::TimePeriod { time_period, .. } => {
                assert_eq!(time_period, CfTimePeriod::Last7Days)
            }
            _ => panic!("unexpected variant"),
        }
    }

    #[test]
    fn cf_style_roundtrip() {
        let style = CFStyle {
            background_color: Some("#FFFF00".into()),
            font_color: Some("#000000".into()),
            bold: Some(true),
            italic: Some(false),
            underline_type: Some(UnderlineStyle::Single),
            underline_legacy: None,
            strikethrough: None,
            number_format: Some("#,##0.00".into()),
            border_color: Some("#0000FF".into()),
            border_style: Some(BorderStyle::Thin),
            border_top_color: None,
            border_top_style: None,
            border_bottom_color: None,
            border_bottom_style: None,
            border_left_color: None,
            border_left_style: None,
            border_right_color: None,
            border_right_style: None,
            dxf_id: None,
        };
        roundtrip_json(&style);
    }

    #[test]
    fn cf_style_legacy_underline_bool_deserializes() {
        // Old Yrs documents store `"underline": true` — must still parse.
        let json = r#"{"underline":true,"bold":true}"#;
        let style: CFStyle = serde_json::from_str(json).unwrap();
        assert_eq!(style.underline_legacy, Some(true));
        assert_eq!(style.bold, Some(true));
    }

    #[test]
    fn cf_style_typed_enum_wire_is_ooxml_token() {
        // CFStyle.underline_type / .border_style are typed ooxml enums; the
        // serde wire format must still be OOXML token strings byte-for-byte so
        // legacy Yrs/JSON docs continue to deserialize correctly.
        let style = CFStyle {
            underline_type: Some(UnderlineStyle::DoubleAccounting),
            border_style: Some(BorderStyle::MediumDashDotDot),
            ..Default::default()
        };
        let json = serde_json::to_value(&style).unwrap();
        assert_eq!(json["underlineType"], "doubleAccounting");
        assert_eq!(json["borderStyle"], "mediumDashDotDot");

        let rt: CFStyle = serde_json::from_value(json).unwrap();
        assert_eq!(rt.underline_type, Some(UnderlineStyle::DoubleAccounting));
        assert_eq!(rt.border_style, Some(BorderStyle::MediumDashDotDot));
    }

    #[test]
    fn cf_style_legacy_string_tokens_deserialize_into_typed_enum() {
        // A legacy document with string values for underlineType / borderStyle
        // must still deserialize into the typed enum.
        let json = r#"{"underlineType":"single","borderStyle":"thin"}"#;
        let style: CFStyle = serde_json::from_str(json).unwrap();
        assert_eq!(style.underline_type, Some(UnderlineStyle::Single));
        assert_eq!(style.border_style, Some(BorderStyle::Thin));
    }

    #[test]
    fn conditional_format_roundtrip() {
        let cf = ConditionalFormat {
            id: "cf1".into(),
            sheet_id: "s1".into(),
            pivot: Some(true),
            ranges: vec![CFCellRange::new(0, 0, 9, 3)],
            range_identities: Some(vec![CellIdRange {
                top_left_cell_id: "c1".into(),
                bottom_right_cell_id: "c2".into(),
            }]),
            rules: vec![CFRule::CellValue {
                id: "r1".into(),
                priority: 1,
                stop_if_true: None,
                operator: CfOperator::GreaterThan,
                value1: serde_json::json!(50),
                value2: None,
                style: CFStyle::default(),
                text: None,
            }],
        };
        roundtrip_json(&cf);
    }

    #[test]
    fn tag_discriminator_is_type() {
        let rule = CFRule::CellValue {
            id: "r1".into(),
            priority: 1,
            stop_if_true: None,
            operator: CfOperator::GreaterThan,
            value1: serde_json::json!(100),
            value2: None,
            style: CFStyle::default(),
            text: None,
        };
        let json: serde_json::Value = serde_json::to_value(&rule).unwrap();
        assert_eq!(json["type"], "cellValue");
    }

    #[test]
    fn id_and_priority_accessors() {
        let rule = CFRule::Formula {
            id: "test-id".into(),
            priority: 42,
            stop_if_true: None,
            formula: "=TRUE".into(),
            style: CFStyle::default(),
            text: None,
        };
        assert_eq!(rule.id(), "test-id");
        assert_eq!(rule.priority(), 42);
    }

    // =========================================================================
    // from_ooxml_token — regression tests for typed formula boundary
    //
    // Each OOXML token the deleted `parse_cf_operator` / `parse_text_operator` /
    // `parse_date_period` shadow parsers accepted must continue to parse via
    // `from_ooxml_token`. Every malformed token must return `None` without
    // panicking.
    // =========================================================================

    #[test]
    fn cf_operator_from_ooxml_token_accepts_all_known_tokens() {
        let cases = [
            ("greaterThan", CFOperator::GreaterThan),
            ("lessThan", CFOperator::LessThan),
            ("greaterThanOrEqual", CFOperator::GreaterThanOrEqual),
            ("lessThanOrEqual", CFOperator::LessThanOrEqual),
            ("equal", CFOperator::Equal),
            ("notEqual", CFOperator::NotEqual),
            ("between", CFOperator::Between),
            ("notBetween", CFOperator::NotBetween),
        ];
        for (token, expected) in cases {
            assert_eq!(
                CFOperator::from_ooxml_token(token),
                Some(expected),
                "token {token} should parse"
            );
        }
    }

    #[test]
    fn cf_operator_from_ooxml_token_rejects_malformed() {
        assert_eq!(CFOperator::from_ooxml_token(""), None);
        assert_eq!(CFOperator::from_ooxml_token("GreaterThan"), None); // wrong case
        assert_eq!(CFOperator::from_ooxml_token("nope"), None);
        assert_eq!(CFOperator::from_ooxml_token("greaterThan "), None); // trailing space
        assert_eq!(CFOperator::from_ooxml_token("ΕΛΛΗΝΙΚΑ"), None); // non-ASCII
    }

    #[test]
    fn cf_text_operator_from_ooxml_token_accepts_all_known_tokens() {
        let cases = [
            ("contains", CFTextOperator::Contains),
            ("notContains", CFTextOperator::NotContains),
            ("beginsWith", CFTextOperator::BeginsWith),
            ("endsWith", CFTextOperator::EndsWith),
        ];
        for (token, expected) in cases {
            assert_eq!(
                CFTextOperator::from_ooxml_token(token),
                Some(expected),
                "token {token} should parse"
            );
        }
    }

    #[test]
    fn cf_text_operator_from_ooxml_token_rejects_malformed() {
        assert_eq!(CFTextOperator::from_ooxml_token(""), None);
        assert_eq!(CFTextOperator::from_ooxml_token("Contains"), None);
        assert_eq!(CFTextOperator::from_ooxml_token("nope"), None);
    }

    #[test]
    fn date_period_from_ooxml_token_accepts_all_known_tokens() {
        let cases = [
            ("yesterday", DatePeriod::Yesterday),
            ("today", DatePeriod::Today),
            ("tomorrow", DatePeriod::Tomorrow),
            ("last7Days", DatePeriod::Last7Days),
            ("lastWeek", DatePeriod::LastWeek),
            ("thisWeek", DatePeriod::ThisWeek),
            ("nextWeek", DatePeriod::NextWeek),
            ("lastMonth", DatePeriod::LastMonth),
            ("thisMonth", DatePeriod::ThisMonth),
            ("nextMonth", DatePeriod::NextMonth),
            ("lastQuarter", DatePeriod::LastQuarter),
            ("thisQuarter", DatePeriod::ThisQuarter),
            ("nextQuarter", DatePeriod::NextQuarter),
            ("lastYear", DatePeriod::LastYear),
            ("thisYear", DatePeriod::ThisYear),
            ("nextYear", DatePeriod::NextYear),
        ];
        for (token, expected) in cases {
            assert_eq!(
                DatePeriod::from_ooxml_token(token),
                Some(expected),
                "token {token} should parse"
            );
        }
    }

    #[test]
    fn date_period_from_ooxml_token_rejects_malformed() {
        assert_eq!(DatePeriod::from_ooxml_token(""), None);
        assert_eq!(DatePeriod::from_ooxml_token("Today"), None);
        assert_eq!(DatePeriod::from_ooxml_token("last7days"), None); // wrong case
        assert_eq!(DatePeriod::from_ooxml_token("nope"), None);
    }

    // =========================================================================
    // Wire-input normalization — replaces the deleted TS `coerceRuleShape`.
    //
    // Each test exercises one of the rule-shape variants the deleted TS
    // adapter handled. The normalization function is the single Rust-side
    // entry point that translates the public/canonical TS schema into the
    // canonical `CFRule` enum.
    // =========================================================================

    fn normalize_and_parse(json: serde_json::Value) -> CFRule {
        let mut v = json;
        normalize_cf_rule_input(&mut v);
        serde_json::from_value::<CFRule>(v).expect("normalized JSON must deserialize to CFRule")
    }

    #[test]
    fn normalize_contains_blanks_default_blanks_true() {
        // Canonical schema: `containsBlanks` requires `blanks: bool`. Public
        // callers historically omitted it, expecting the default to be `true`.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "containsBlanks",
            "id": "r1",
            "priority": 1,
            "style": {},
        }));
        match rule {
            CFRule::ContainsBlanks { blanks, .. } => assert!(blanks),
            _ => panic!("expected ContainsBlanks variant"),
        }
    }

    #[test]
    fn normalize_not_contains_blanks_to_contains_blanks_false() {
        // `notContainsBlanks` is a public-API type promotion: the canonical
        // schema only models `containsBlanks` with `blanks: bool`.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "notContainsBlanks",
            "id": "r1",
            "priority": 1,
            "style": {},
        }));
        match rule {
            CFRule::ContainsBlanks { blanks, .. } => assert!(!blanks),
            _ => panic!("expected ContainsBlanks variant"),
        }
    }

    #[test]
    fn normalize_contains_errors_default_errors_true() {
        let rule = normalize_and_parse(serde_json::json!({
            "type": "containsErrors",
            "id": "r1",
            "priority": 1,
            "style": {},
        }));
        match rule {
            CFRule::ContainsErrors { errors, .. } => assert!(errors),
            _ => panic!("expected ContainsErrors variant"),
        }
    }

    #[test]
    fn normalize_not_contains_errors_to_contains_errors_false() {
        let rule = normalize_and_parse(serde_json::json!({
            "type": "notContainsErrors",
            "id": "r1",
            "priority": 1,
            "style": {},
        }));
        match rule {
            CFRule::ContainsErrors { errors, .. } => assert!(!errors),
            _ => panic!("expected ContainsErrors variant"),
        }
    }

    #[test]
    fn normalize_top10_value1_to_rank() {
        let rule = normalize_and_parse(serde_json::json!({
            "type": "top10",
            "id": "r1",
            "priority": 1,
            "value1": 5,
            "operator": "topPercent",
            "style": {},
        }));
        match rule {
            CFRule::Top10 {
                rank,
                percent,
                bottom,
                ..
            } => {
                assert_eq!(rank, 5);
                assert_eq!(percent, Some(true));
                assert_eq!(bottom, None);
            }
            _ => panic!("expected Top10 variant"),
        }
    }

    #[test]
    fn normalize_top10_bottom_operator_sets_bottom_flag() {
        let rule = normalize_and_parse(serde_json::json!({
            "type": "top10",
            "id": "r1",
            "priority": 1,
            "value1": 3,
            "operator": "bottom",
            "style": {},
        }));
        match rule {
            CFRule::Top10 { rank, bottom, .. } => {
                assert_eq!(rank, 3);
                assert_eq!(bottom, Some(true));
            }
            _ => panic!("expected Top10 variant"),
        }
    }

    #[test]
    fn normalize_cell_value_with_text_op_promotes_to_contains_text() {
        // Public API ergonomics: callers historically sent
        // `{ type: 'cellValue', operator: 'containsText', value1: 'foo' }`.
        // The canonical Rust shape is `{ type: 'containsText', operator:
        // 'containsText', text: 'foo' }`.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "cellValue",
            "id": "r1",
            "priority": 1,
            "operator": "containsText",
            "value1": "hello",
            "style": {},
        }));
        match rule {
            CFRule::ContainsText { operator, text, .. } => {
                assert_eq!(operator, CfOperator::ContainsText);
                assert_eq!(text, "hello");
            }
            _ => panic!("expected ContainsText variant"),
        }
    }

    #[test]
    fn normalize_cell_value_not_contains_promotes_to_contains_text_not_contains() {
        // `notContainsText` is a deprecated public alias; the canonical
        // OOXML token on `containsText.operator` is `notContains`.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "cellValue",
            "id": "r1",
            "priority": 1,
            "operator": "notContainsText",
            "value1": "bad",
            "style": {},
        }));
        match rule {
            CFRule::ContainsText { operator, text, .. } => {
                assert_eq!(operator, CfOperator::NotContains);
                assert_eq!(text, "bad");
            }
            _ => panic!("expected ContainsText variant"),
        }
    }

    #[test]
    fn normalize_cell_value_with_comparison_op_stays_cell_value() {
        // Non-text operators must keep `cellValue` shape untouched.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "cellValue",
            "id": "r1",
            "priority": 1,
            "operator": "greaterThan",
            "value1": 100,
            "style": {},
        }));
        match rule {
            CFRule::CellValue {
                operator, value1, ..
            } => {
                assert_eq!(operator, CfOperator::GreaterThan);
                assert_eq!(value1, serde_json::json!(100));
            }
            _ => panic!("expected CellValue variant"),
        }
    }

    #[test]
    fn expression_alias_deserializes_to_formula_variant() {
        // Field-rename aliases are handled by `#[serde(alias = "expression")]`
        // on the `Formula` variant, not by `normalize_cf_rule_input`. This
        // test locks the behavior so future refactors can't drop the alias.
        let json = serde_json::json!({
            "type": "expression",
            "id": "r1",
            "priority": 1,
            "formula": "=A1>10",
            "style": {},
        });
        let rule: CFRule = serde_json::from_value(json).unwrap();
        match rule {
            CFRule::Formula { formula, .. } => assert_eq!(formula, "=A1>10"),
            _ => panic!("expected Formula variant"),
        }
    }

    #[test]
    fn normalize_contains_text_value1_fallback_to_text() {
        let rule = normalize_and_parse(serde_json::json!({
            "type": "containsText",
            "id": "r1",
            "priority": 1,
            "operator": "containsText",
            "value1": "needle",
            "style": {},
        }));
        match rule {
            CFRule::ContainsText { text, .. } => assert_eq!(text, "needle"),
            _ => panic!("expected ContainsText variant"),
        }
    }

    #[test]
    fn normalize_idempotent_on_canonical_input() {
        // A fully-canonical rule must round-trip unchanged through normalization.
        let canonical = serde_json::json!({
            "type": "containsBlanks",
            "id": "r1",
            "priority": 1,
            "blanks": true,
            "style": {},
        });
        let mut v = canonical.clone();
        normalize_cf_rule_input(&mut v);
        assert_eq!(v, canonical);
    }

    #[test]
    fn normalize_conditional_format_walks_all_rules() {
        let mut cf = serde_json::json!({
            "id": "cf-1",
            "sheetId": "s1",
            "ranges": [],
            "rules": [
                { "type": "notContainsBlanks", "id": "r1", "priority": 1, "style": {} },
                { "type": "expression", "id": "r2", "priority": 2, "formula": "=TRUE", "style": {} },
            ],
        });
        normalize_conditional_format_input(&mut cf);
        let parsed: ConditionalFormat = serde_json::from_value(cf).unwrap();
        assert_eq!(parsed.rules.len(), 2);
        match &parsed.rules[0] {
            CFRule::ContainsBlanks { blanks, .. } => assert!(!blanks),
            _ => panic!("expected ContainsBlanks variant"),
        }
        match &parsed.rules[1] {
            CFRule::Formula { formula, .. } => assert_eq!(formula, "=TRUE"),
            _ => panic!("expected Formula variant"),
        }
    }

    // =========================================================================
    // Public CF rule type completeness
    //
    // Every variant the public TS API can produce or that XLSX hydration
    // emits must round-trip through `normalize_cf_rule_input` to a
    // canonical [`CFRule`]. This test set is the structural enumeration.
    // =========================================================================

    #[test]
    fn normalize_cell_is_alias_to_cell_value() {
        // OOXML uses `<cfRule type="cellIs">`; the public TS API exposes
        // `cellIs` for parity. The canonical Rust enum tag is `cellValue`.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "cellIs",
            "id": "r1",
            "priority": 1,
            "operator": "greaterThan",
            "value1": 10,
            "style": {},
        }));
        match rule {
            CFRule::CellValue {
                operator, value1, ..
            } => {
                assert_eq!(operator, CfOperator::GreaterThan);
                assert_eq!(value1, serde_json::json!(10));
            }
            _ => panic!("expected CellValue variant"),
        }
    }

    #[test]
    fn normalize_cell_is_with_text_op_promotes_to_contains_text() {
        // `cellIs` with a text operator should rewrite to `containsText`,
        // matching the `cellValue` arm's behavior.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "cellIs",
            "id": "r1",
            "priority": 1,
            "operator": "containsText",
            "value1": "hello",
            "style": {},
        }));
        match rule {
            CFRule::ContainsText { operator, text, .. } => {
                assert_eq!(operator, CfOperator::ContainsText);
                assert_eq!(text, "hello");
            }
            _ => panic!("expected ContainsText variant"),
        }
    }

    #[test]
    fn normalize_cell_value_value_shorthand_to_value1() {
        // Public API ergonomics: `value` is a single-shorthand for
        // `value1` on equality / comparison rules.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "cellValue",
            "id": "r1",
            "priority": 1,
            "operator": "equal",
            "value": 42,
            "style": {},
        }));
        match rule {
            CFRule::CellValue {
                operator, value1, ..
            } => {
                assert_eq!(operator, CfOperator::Equal);
                assert_eq!(value1, serde_json::json!(42));
            }
            _ => panic!("expected CellValue variant"),
        }
    }

    #[test]
    fn normalize_cell_value_formula_field_to_value1() {
        // OOXML-style: a `cellIs`/`cellValue` rule sometimes ships its
        // comparison value inside `formula` (an OOXML formula token).
        // The canonical schema accepts any JSON in `value1`.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "cellValue",
            "id": "r1",
            "priority": 1,
            "operator": "greaterThan",
            "formula": "=A1*2",
            "style": {},
        }));
        match rule {
            CFRule::CellValue {
                operator, value1, ..
            } => {
                assert_eq!(operator, CfOperator::GreaterThan);
                assert_eq!(value1, serde_json::json!("=A1*2"));
            }
            _ => panic!("expected CellValue variant"),
        }
    }

    #[test]
    fn normalize_formula_value1_shorthand() {
        // `formula` with `value1` shorthand (matches the `cellValue`
        // shape used by `cf-custom-formula` app-eval scenario).
        let rule = normalize_and_parse(serde_json::json!({
            "type": "formula",
            "id": "r1",
            "priority": 1,
            "operator": "expression",
            "value1": "=MOD(ROW(),2)=0",
            "style": {},
        }));
        match rule {
            CFRule::Formula { formula, .. } => assert_eq!(formula, "=MOD(ROW(),2)=0"),
            _ => panic!("expected Formula variant"),
        }
    }

    #[test]
    fn normalize_expression_value1_shorthand_promotes_to_formula() {
        // `expression` is a deprecated public alias for the `formula`
        // type tag; combined with the `value1` shorthand it must still
        // produce a valid Formula variant. This is the exact shape
        // shipped by the `cf-custom-formula` app-eval scenario.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "expression",
            "id": "r1",
            "priority": 1,
            "operator": "expression",
            "value1": "=MOD(ROW(),2)=0",
            "style": { "backgroundColor": "#E6F0FF" },
        }));
        match rule {
            CFRule::Formula { formula, .. } => assert_eq!(formula, "=MOD(ROW(),2)=0"),
            _ => panic!("expected Formula variant"),
        }
    }

    #[test]
    fn normalize_above_average_default_true() {
        // `aboveAverage` without an explicit flag defaults to `true`
        // (Excel's "Above Average" UI command).
        let rule = normalize_and_parse(serde_json::json!({
            "type": "aboveAverage",
            "id": "r1",
            "priority": 1,
            "style": {},
        }));
        match rule {
            CFRule::AboveAverage { above_average, .. } => assert!(above_average),
            _ => panic!("expected AboveAverage variant"),
        }
    }

    #[test]
    fn normalize_above_average_camelcase_field() {
        // Rust uses `above_average`; normalized JSON uses the camelCase
        // TS/API wire field.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "aboveAverage",
            "id": "r1",
            "priority": 1,
            "aboveAverage": false,
            "style": {},
        }));
        match rule {
            CFRule::AboveAverage { above_average, .. } => assert!(!above_average),
            _ => panic!("expected AboveAverage variant"),
        }
    }

    #[test]
    fn normalize_below_average_to_above_average_false() {
        // `belowAverage` is a public alias for the negation form of
        // `aboveAverage`.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "belowAverage",
            "id": "r1",
            "priority": 1,
            "style": {},
        }));
        match rule {
            CFRule::AboveAverage { above_average, .. } => assert!(!above_average),
            _ => panic!("expected AboveAverage variant"),
        }
    }

    #[test]
    fn normalize_unique_values_to_duplicate_values_unique_true() {
        // OOXML's `uniqueValues` is the negation form of
        // `duplicateValues`; the canonical enum collapses both into
        // `DuplicateValues { unique: bool }`.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "uniqueValues",
            "id": "r1",
            "priority": 1,
            "style": {},
        }));
        match rule {
            CFRule::DuplicateValues { unique, .. } => assert_eq!(unique, Some(true)),
            _ => panic!("expected DuplicateValues variant"),
        }
    }

    #[test]
    fn normalize_duplicate_values_canonical() {
        let rule = normalize_and_parse(serde_json::json!({
            "type": "duplicateValues",
            "id": "r1",
            "priority": 1,
            "style": {},
        }));
        match rule {
            CFRule::DuplicateValues { unique, .. } => assert_eq!(unique, None),
            _ => panic!("expected DuplicateValues variant"),
        }
    }

    #[test]
    fn normalize_time_period_canonical() {
        // Rust uses `time_period`; normalized JSON uses the camelCase
        // TS/API wire field.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "timePeriod",
            "id": "r1",
            "priority": 1,
            "timePeriod": "today",
            "style": {},
        }));
        match rule {
            CFRule::TimePeriod { time_period, .. } => {
                assert_eq!(time_period, CfTimePeriod::Today);
            }
            _ => panic!("expected TimePeriod variant"),
        }
    }

    #[test]
    fn normalize_color_scale_canonical_passthrough() {
        // colorScale carries its payload nested; the normalizer must
        // not alter the shape. The canonical CFColorPoint uses
        // `value: { kind: ... }` (a typed `CFValueRef`), not
        // `valueType`.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "colorScale",
            "id": "r1",
            "priority": 1,
            "colorScale": {
                "minPoint": { "value": { "kind": "min" }, "color": "#FF0000" },
                "maxPoint": { "value": { "kind": "max" }, "color": "#00FF00" },
            },
        }));
        assert!(matches!(rule, CFRule::ColorScale { .. }));
    }

    #[test]
    fn normalize_data_bar_canonical_passthrough() {
        // CFDataBar uses `#[serde(rename_all = "camelCase")]`. Each
        // CFColorPoint requires `value` (CFValueRef) and `color`.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "dataBar",
            "id": "r1",
            "priority": 1,
            "dataBar": {
                "minPoint": { "value": { "kind": "min" }, "color": "" },
                "maxPoint": { "value": { "kind": "max" }, "color": "" },
                "positiveColor": "#638EC6",
            },
        }));
        assert!(matches!(rule, CFRule::DataBar { .. }));
    }

    #[test]
    fn normalize_icon_set_canonical_passthrough() {
        // CFIconSet uses `#[serde(rename_all = "camelCase")]`, so
        // `icon_set_name` becomes `iconSetName` in JSON.
        let rule = normalize_and_parse(serde_json::json!({
            "type": "iconSet",
            "id": "r1",
            "priority": 1,
            "iconSet": {
                "iconSetName": "3TrafficLights1",
                "thresholds": [],
            },
        }));
        assert!(matches!(rule, CFRule::IconSet { .. }));
    }

    /// Drives [`normalize_cf_rule_input`] across every public rule type
    /// and verifies the result deserializes to a canonical [`CFRule`].
    /// The asserted set is [`CANONICAL_CF_RULE_TYPES`] plus the public
    /// aliases (`cellIs`, `belowAverage`, `uniqueValues`, `expression`,
    /// `notContainsBlanks`, `notContainsErrors`).
    ///
    /// If a future audit adds a new public rule type, this test must
    /// fail until the normalization arm is added.
    #[test]
    fn normalize_full_public_cf_rule_type_set() {
        let cases: Vec<(&str, serde_json::Value)> = vec![
            (
                "cellValue",
                serde_json::json!({
                    "type": "cellValue", "id": "r", "priority": 1,
                    "operator": "greaterThan", "value1": 1, "style": {}
                }),
            ),
            (
                "cellIs",
                serde_json::json!({
                    "type": "cellIs", "id": "r", "priority": 1,
                    "operator": "lessThan", "value1": 1, "style": {}
                }),
            ),
            (
                "formula",
                serde_json::json!({
                    "type": "formula", "id": "r", "priority": 1,
                    "formula": "=TRUE", "style": {}
                }),
            ),
            (
                "expression",
                serde_json::json!({
                    "type": "expression", "id": "r", "priority": 1,
                    "value1": "=TRUE", "style": {}
                }),
            ),
            (
                "colorScale",
                serde_json::json!({
                    "type": "colorScale", "id": "r", "priority": 1,
                    "colorScale": {
                        "minPoint": { "value": { "kind": "min" }, "color": "#FF0000" },
                        "maxPoint": { "value": { "kind": "max" }, "color": "#00FF00" },
                    },
                }),
            ),
            (
                "dataBar",
                serde_json::json!({
                    "type": "dataBar", "id": "r", "priority": 1,
                    "dataBar": {
                        "minPoint": { "value": { "kind": "min" }, "color": "" },
                        "maxPoint": { "value": { "kind": "max" }, "color": "" },
                        "positiveColor": "#638EC6",
                    },
                }),
            ),
            (
                "iconSet",
                serde_json::json!({
                    "type": "iconSet", "id": "r", "priority": 1,
                    "iconSet": {
                        "iconSetName": "3TrafficLights1",
                        "thresholds": [],
                    },
                }),
            ),
            (
                "top10",
                serde_json::json!({
                    "type": "top10", "id": "r", "priority": 1,
                    "rank": 10, "style": {}
                }),
            ),
            (
                "aboveAverage",
                serde_json::json!({
                    "type": "aboveAverage", "id": "r", "priority": 1,
                    "style": {}
                }),
            ),
            (
                "belowAverage",
                serde_json::json!({
                    "type": "belowAverage", "id": "r", "priority": 1,
                    "style": {}
                }),
            ),
            (
                "duplicateValues",
                serde_json::json!({
                    "type": "duplicateValues", "id": "r", "priority": 1,
                    "style": {}
                }),
            ),
            (
                "uniqueValues",
                serde_json::json!({
                    "type": "uniqueValues", "id": "r", "priority": 1,
                    "style": {}
                }),
            ),
            (
                "containsText",
                serde_json::json!({
                    "type": "containsText", "id": "r", "priority": 1,
                    "operator": "containsText", "text": "x", "style": {}
                }),
            ),
            (
                "containsBlanks",
                serde_json::json!({
                    "type": "containsBlanks", "id": "r", "priority": 1,
                    "style": {}
                }),
            ),
            (
                "notContainsBlanks",
                serde_json::json!({
                    "type": "notContainsBlanks", "id": "r", "priority": 1,
                    "style": {}
                }),
            ),
            (
                "containsErrors",
                serde_json::json!({
                    "type": "containsErrors", "id": "r", "priority": 1,
                    "style": {}
                }),
            ),
            (
                "notContainsErrors",
                serde_json::json!({
                    "type": "notContainsErrors", "id": "r", "priority": 1,
                    "style": {}
                }),
            ),
            (
                "timePeriod",
                serde_json::json!({
                    "type": "timePeriod", "id": "r", "priority": 1,
                    "timePeriod": "today", "style": {}
                }),
            ),
        ];

        for (label, mut json) in cases {
            normalize_cf_rule_input(&mut json);
            let parsed: CFRule = serde_json::from_value(json.clone()).unwrap_or_else(|e| {
                panic!("input '{}' must normalize: err={} json={}", label, e, json)
            });
            // Every output type tag must be in the canonical set.
            let json_after = serde_json::to_value(&parsed).unwrap();
            let tag = json_after
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            assert!(
                CANONICAL_CF_RULE_TYPES.contains(&tag),
                "input '{}' produced non-canonical tag '{}'",
                label,
                tag,
            );
        }
    }

    // =========================================================================
    // Typed priority bumping
    //
    // The set_priority API is used by `services::formatting::bump_cf_priorities`
    // (called from `add_cf_rule` to renumber existing formats when a new
    // one is inserted at priority 1). This test confirms the typed API
    // covers every variant that carries a priority field.
    // =========================================================================

    #[test]
    fn set_priority_covers_every_variant() {
        // Build one rule per variant and confirm `set_priority` mutates
        // the field on each. The list mirrors `CANONICAL_CF_RULE_TYPES`.
        let mut rules: Vec<CFRule> = vec![
            CFRule::CellValue {
                id: "a".into(),
                priority: 5,
                stop_if_true: None,
                operator: CfOperator::GreaterThan,
                value1: serde_json::json!(0),
                value2: None,
                style: CFStyle::default(),
                text: None,
            },
            CFRule::Formula {
                id: "b".into(),
                priority: 5,
                stop_if_true: None,
                formula: "=TRUE".into(),
                style: CFStyle::default(),
                text: None,
            },
            CFRule::Top10 {
                id: "c".into(),
                priority: 5,
                stop_if_true: None,
                rank: 10,
                percent: None,
                bottom: None,
                style: CFStyle::default(),
            },
            CFRule::AboveAverage {
                id: "d".into(),
                priority: 5,
                stop_if_true: None,
                above_average: true,
                equal_average: None,
                std_dev: None,
                style: CFStyle::default(),
                formula: None,
            },
            CFRule::DuplicateValues {
                id: "e".into(),
                priority: 5,
                stop_if_true: None,
                unique: None,
                style: CFStyle::default(),
            },
            CFRule::ContainsText {
                id: "f".into(),
                priority: 5,
                stop_if_true: None,
                operator: CfOperator::ContainsText,
                text: "x".into(),
                style: CFStyle::default(),
                formula: None,
            },
            CFRule::ContainsBlanks {
                id: "g".into(),
                priority: 5,
                stop_if_true: None,
                blanks: true,
                style: CFStyle::default(),
                formula: None,
            },
            CFRule::ContainsErrors {
                id: "h".into(),
                priority: 5,
                stop_if_true: None,
                errors: true,
                style: CFStyle::default(),
                formula: None,
            },
            CFRule::TimePeriod {
                id: "i".into(),
                priority: 5,
                stop_if_true: None,
                time_period: CfTimePeriod::Today,
                style: CFStyle::default(),
                formula: None,
            },
        ];
        for r in rules.iter_mut() {
            assert_eq!(r.priority(), 5);
            r.set_priority(99);
            assert_eq!(r.priority(), 99);
        }
    }
}
