use super::{CfOperator, CfRuleType, CfTimePeriod, ColorScale, DataBar, IconSet, default_true};

// ============================================================================
// CfRule and container types
// ============================================================================

/// Conditional formatting rule (ECMA-376 CT_CfRule).
///
/// A flat struct (not a tagged enum) matching the OOXML schema. The `rule_type`
/// field determines which optional fields are meaningful:
/// - `CellIs`: uses `operator`, `formulas` (1-2)
/// - `Expression`: uses `formulas` (1)
/// - `ColorScale`: uses `color_scale`
/// - `DataBar`: uses `data_bar`
/// - `IconSet`: uses `icon_set`
/// - `Top10`: uses `rank`, `percent`, `bottom`
/// - `AboveAverage`: uses `above_average`, `equal_average`, `std_dev`
/// - `ContainsText`/`BeginsWith`/`EndsWith`: uses `text`, `operator`
/// - `TimePeriod`: uses `time_period`
/// - Others: only `rule_type` + `dxf_id`
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CfRule {
    /// Rule type (required).
    pub rule_type: CfRuleType,
    /// Priority (1 = highest, required).
    pub priority: i32,
    /// Differential format ID (references styles.xml dxf list).
    pub dxf_id: Option<u32>,
    /// Stop evaluating lower-priority rules if this one matches.
    #[serde(default)]
    pub stop_if_true: bool,

    // -- cellIs fields --
    /// Comparison operator (for cellIs and text rules).
    pub operator: Option<CfOperator>,

    // -- text rule fields --
    /// Text value (for containsText, beginsWith, endsWith).
    pub text: Option<String>,

    // -- timePeriod field --
    /// Time period (for timePeriod rules).
    pub time_period: Option<CfTimePeriod>,

    // -- top10 / aboveAverage fields --
    /// Rank threshold (for top10 rules).
    pub rank: Option<u32>,
    /// Interpret rank as percentage (for top10).
    #[serde(default)]
    pub percent: bool,
    /// Select bottom instead of top (for top10).
    #[serde(default)]
    pub bottom: bool,
    /// Above average (default true for aboveAverage type).
    #[serde(default = "default_true")]
    pub above_average: bool,
    /// Standard deviation multiplier (for aboveAverage).
    pub std_dev: Option<i32>,
    /// Include values equal to average (for aboveAverage).
    #[serde(default)]
    pub equal_average: bool,

    // -- formula(s) --
    /// 0-3 formula strings (for expression: 1, cellIs: 1-2, text rules: 1).
    #[serde(default)]
    pub formulas: Vec<String>,

    // -- visual elements (mutually exclusive based on rule_type) --
    /// Color scale configuration (for colorScale type).
    pub color_scale: Option<ColorScale>,
    /// Data bar configuration (for dataBar type).
    pub data_bar: Option<DataBar>,
    /// Icon set configuration (for iconSet type).
    pub icon_set: Option<IconSet>,
    /// x14:id from `<extLst>` inside the cfRule, linking to extended CF data
    /// in the worksheet's `<extLst>` section. Preserved for round-trip fidelity.
    pub ext_id: Option<String>,
}

impl Default for CfRule {
    fn default() -> Self {
        Self {
            rule_type: CfRuleType::default(),
            priority: 0,
            dxf_id: None,
            stop_if_true: false,
            operator: None,
            text: None,
            time_period: None,
            rank: None,
            percent: false,
            bottom: false,
            above_average: true,
            std_dev: None,
            equal_average: false,
            formulas: Vec::new(),
            color_scale: None,
            data_bar: None,
            icon_set: None,
            ext_id: None,
        }
    }
}

/// Conditional formatting block (ECMA-376 CT_ConditionalFormatting).
///
/// Associates one or more rules with cell ranges on a worksheet.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ConditionalFormatting {
    /// Space-separated cell ranges in A1 notation (e.g., "A1:C10 E1:E10").
    ///
    /// # Layering rule (typed OOXML layering rule)
    ///
    /// Stays `String` at the `ooxml-types` layer by policy:
    /// `ooxml-types` must never depend on `formula-types`. This is the
    /// XLSX external-format boundary, symmetric to typed Yrs boundary's Yrs
    /// on-disk JSON rule — `String` here is architecturally correct, not
    /// debt. The typed treatment lives at every in-engine consumer:
    ///
    /// - Read: `xlsx-parser::output::to_parse_output::features::
    ///   convert_conditional_formats` parses via `SqrefList::parse`.
    /// - Write: `xlsx-parser::domain::cond_format::write::bridge::
    ///   ranges_to_sqref` emits via `SqrefList::to_a1_string`.
    /// - Lowering helpers: `compute::import::parse_output_to_snapshot::
    ///   cond_format_lowering`.
    pub sqref: String,
    /// Whether this applies to a pivot table.
    #[serde(default)]
    pub pivot: bool,
    /// Rules in priority order.
    pub rules: Vec<CfRule>,
}

/// Extended CF rule for x14 namespace (Excel 2010+).
///
/// Carries additional data bar / icon set properties not available in the
/// base CT_CfRule schema.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CfRuleX14 {
    /// Rule type.
    pub rule_type: CfRuleType,
    /// Priority.
    pub priority: i32,
    /// Differential format ID (references styles.xml dxf list).
    pub dxf_id: Option<u32>,
    /// GUID linking to the base rule.
    pub id: String,
    /// Extended color scale configuration.
    pub color_scale: Option<ColorScale>,
    /// Extended data bar configuration.
    pub data_bar: Option<DataBar>,
    /// Extended icon set configuration.
    pub icon_set: Option<IconSet>,
}

/// X14 conditional formatting container (Excel 2010+).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ConditionalFormattingX14 {
    /// GUID.
    pub id: String,
    /// Cell ranges. Same `String` vs `SqrefList` layering constraint as
    /// [`ConditionalFormatting::sqref`] — see the doc there for full
    /// rationale. No live consumer reads this field today (only
    /// `parse_conditional_formatting_x14_element` writes it and the X14
    /// parser output is not routed through any downstream pipeline), so
    /// the typed migration is deferred with the sibling base-CF field.
    pub sqref: String,
    /// Extended rules.
    pub rules: Vec<CfRuleX14>,
}

// ============================================================================
// Tests
// ============================================================================
