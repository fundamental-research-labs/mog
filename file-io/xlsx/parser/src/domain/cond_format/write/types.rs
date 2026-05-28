//! Type definitions for conditional formatting.
//!
//! This module contains all the type definitions used for conditional formatting rules
//! including operators, value types, rules, and styles.
//!
//! Several types are re-exported from the common module for consistency
//! with the read module. The writer uses its own tagged enum [`CfRuleKind`]
//! as a builder API, while re-exporting the canonical ooxml-types enums for
//! shared vocabulary (`CfOperator`, `CfTimePeriod`, `CfvoType`, etc.).

// =============================================================================
// Re-exports from ooxml-types
// =============================================================================

pub use ooxml_types::cond_format::{
    CfOperator, CfRuleType, CfTimePeriod, CfvoType, DataBarAxisPosition, IconSetType,
};

// =============================================================================
// Core Types
// =============================================================================

/// Conditional formatting rule
#[derive(Debug, Clone)]
pub struct CfRule {
    pub rule_kind: CfRuleKind,
    pub priority: i32,
    pub stop_if_true: bool,
}

/// Tagged enum for constructing conditional formatting rules on the write path.
///
/// This is a builder-friendly tagged enum -- each variant carries the data
/// needed to emit that rule type. It is distinct from
/// [`ooxml_types::cond_format::CfRuleType`] which is a simple classification enum.
///
/// Use [`From<CfRule>`] for `ooxml_types::cond_format::CfRule` to convert
/// the writer's builder types to canonical ooxml-types.
#[derive(Debug, Clone)]
pub enum CfRuleKind {
    CellIs(CellIsRule),
    ColorScale(ColorScaleRule),
    DataBar(DataBarRule),
    IconSet(IconSetRule),
    Top10(Top10Rule),
    AboveAverage(AboveAverageRule),
    Expression(String),
    ContainsText(TextRule),
    NotContainsText(TextRule),
    BeginsWith(TextRule),
    EndsWith(TextRule),
    ContainsBlanks,
    NotContainsBlanks,
    ContainsErrors,
    NotContainsErrors,
    TimePeriod(CfTimePeriod),
    DuplicateValues,
    UniqueValues,
}

// =============================================================================
// Cell Value Rules
// =============================================================================

/// Cell value comparison rule
#[derive(Debug, Clone)]
pub struct CellIsRule {
    pub operator: CfOperator,
    pub value1: String,
    pub value2: Option<String>, // For between/notBetween
    pub style: CfStyle,
}

// =============================================================================
// Color Scale Rules
// =============================================================================

/// Color scale rule (2 or 3 colors)
#[derive(Debug, Clone)]
pub struct ColorScaleRule {
    pub min: CfValueObject,
    pub mid: Option<CfValueObject>, // None for 2-color scale
    pub max: CfValueObject,
}

/// Value object for color scales, data bars, and icon sets
#[derive(Debug, Clone)]
pub struct CfValueObject {
    pub value_type: CfvoType,
    pub value: Option<String>,
    pub color: String, // RGB hex (e.g., "FFF8696B")
}

impl CfValueObject {
    /// Create a new value object with min type (no value needed)
    pub fn min(color: &str) -> Self {
        Self {
            value_type: CfvoType::Min,
            value: None,
            color: color.to_string(),
        }
    }

    /// Create a new value object with max type (no value needed)
    pub fn max(color: &str) -> Self {
        Self {
            value_type: CfvoType::Max,
            value: None,
            color: color.to_string(),
        }
    }

    /// Create a new value object with percent type
    pub fn percent(value: u32, color: &str) -> Self {
        Self {
            value_type: CfvoType::Percent,
            value: Some(value.to_string()),
            color: color.to_string(),
        }
    }

    /// Create a new value object with percentile type
    pub fn percentile(value: u32, color: &str) -> Self {
        Self {
            value_type: CfvoType::Percentile,
            value: Some(value.to_string()),
            color: color.to_string(),
        }
    }

    /// Create a new value object with numeric type
    pub fn num(value: &str, color: &str) -> Self {
        Self {
            value_type: CfvoType::Num,
            value: Some(value.to_string()),
            color: color.to_string(),
        }
    }

    /// Create a new value object with formula type
    pub fn formula(formula: &str, color: &str) -> Self {
        Self {
            value_type: CfvoType::Formula,
            value: Some(formula.to_string()),
            color: color.to_string(),
        }
    }
}

// =============================================================================
// Data Bar Rules
// =============================================================================

/// Data bar rule
#[derive(Debug, Clone)]
pub struct DataBarRule {
    pub min: CfValueObject,
    pub max: CfValueObject,
    pub color: String,                  // RGB hex
    pub show_value: bool,               // Show cell value in addition to data bar
    pub gradient: bool,                 // Gradient fill vs solid
    pub border_color: Option<String>,   // RGB hex
    pub negative_color: Option<String>, // RGB hex for negative values
    pub axis_position: Option<DataBarAxisPosition>,
}

impl DataBarRule {
    /// Create a simple data bar with default settings
    pub fn simple(color: &str) -> Self {
        Self {
            min: CfValueObject::min(""),
            max: CfValueObject::max(""),
            color: color.to_string(),
            show_value: true,
            gradient: true,
            border_color: None,
            negative_color: None,
            axis_position: None,
        }
    }
}

// =============================================================================
// Icon Set Rules
// =============================================================================

/// Icon set rule
#[derive(Debug, Clone)]
pub struct IconSetRule {
    pub icon_set: IconSetType,
    pub show_value: bool,
    pub reverse: bool,
    pub thresholds: Vec<CfValueObject>,
}

impl IconSetRule {
    /// Create a default icon set rule with standard thresholds
    pub fn new(icon_set: IconSetType) -> Self {
        let num_icons = icon_set.num_icons();
        let mut thresholds = Vec::with_capacity(num_icons);

        // Create default percent thresholds
        for i in 0..num_icons {
            let percent = (i as u32 * 100) / (num_icons as u32);
            thresholds.push(CfValueObject {
                value_type: CfvoType::Percent,
                value: Some(percent.to_string()),
                color: String::new(), // Icon sets don't use colors in thresholds
            });
        }

        Self {
            icon_set,
            show_value: true,
            reverse: false,
            thresholds,
        }
    }
}

// =============================================================================
// Top/Bottom Rules
// =============================================================================

/// Top/bottom 10 rule
#[derive(Debug, Clone)]
pub struct Top10Rule {
    pub top: bool,     // true=top, false=bottom
    pub percent: bool, // true=percent, false=count
    pub rank: u32,
    pub style: CfStyle,
}

// =============================================================================
// Above/Below Average Rules
// =============================================================================

/// Above/below average rule
#[derive(Debug, Clone)]
pub struct AboveAverageRule {
    pub above_average: bool,
    pub equal_average: bool,
    pub std_dev: Option<i32>,
    pub style: CfStyle,
}

// =============================================================================
// Text Rules
// =============================================================================

/// Text-based rule
#[derive(Debug, Clone)]
pub struct TextRule {
    pub text: String,
    pub style: CfStyle,
}

// =============================================================================
// Style Definition
// =============================================================================

/// Style to apply when rule matches
#[derive(Debug, Clone, Default)]
pub struct CfStyle {
    pub dxf_id: Option<u32>, // Reference to styles.xml differential format
    // Inline styles (when dxf_id not used)
    pub font_color: Option<String>,
    pub font_bold: Option<bool>,
    pub font_italic: Option<bool>,
    pub fill_color: Option<String>,
    pub fill_pattern: Option<String>,
}

impl CfStyle {
    /// Create a style with a dxf reference
    pub fn with_dxf_id(dxf_id: u32) -> Self {
        Self {
            dxf_id: Some(dxf_id),
            ..Default::default()
        }
    }

    /// Create a style with a fill color
    pub fn with_fill(color: &str) -> Self {
        Self {
            fill_color: Some(color.to_string()),
            fill_pattern: Some("solid".to_string()),
            ..Default::default()
        }
    }

    /// Create a style with font color
    pub fn with_font_color(color: &str) -> Self {
        Self {
            font_color: Some(color.to_string()),
            ..Default::default()
        }
    }
}

// =============================================================================
// Conditional Formatting Block
// =============================================================================

/// Conditional formatting block
#[derive(Debug, Clone)]
pub struct ConditionalFormatting {
    pub sqref: String, // Range(s) like "A1:A10 B1:B10"
    pub rules: Vec<CfRule>,
}

impl ConditionalFormatting {
    /// Create a new conditional formatting block for a range
    pub fn new(sqref: &str) -> Self {
        Self {
            sqref: sqref.to_string(),
            rules: Vec::new(),
        }
    }

    /// Add a rule to this block
    pub fn add_rule(&mut self, rule: CfRule) -> &mut Self {
        self.rules.push(rule);
        self
    }
}

// =============================================================================
// From converters: writer builder types → ooxml-types canonical types
// =============================================================================

use ooxml_types::cond_format as ot;

/// Convert a writer `CfValueObject` to a canonical `ot::Cfvo`.
///
/// The writer's `CfValueObject` bundles a color with the CFVO (convenient for
/// builder APIs). The canonical `Cfvo` separates the color -- so the color is
/// discarded here. Callers that need the color should access `CfValueObject::color`
/// separately.
impl From<&CfValueObject> for ot::Cfvo {
    fn from(v: &CfValueObject) -> Self {
        ot::Cfvo {
            cfvo_type: v.value_type,
            val: v.value.clone(),
            gte: true,
            ext_lst_xml: None,
        }
    }
}

/// Convert a writer `ColorScaleRule` to a canonical `ot::ColorScale`.
impl From<&ColorScaleRule> for ot::ColorScale {
    fn from(r: &ColorScaleRule) -> Self {
        let mut cfvo = vec![ot::Cfvo::from(&r.min)];
        let mut colors = vec![cf_color_from_rgb(&r.min.color)];
        if let Some(ref mid) = r.mid {
            cfvo.push(ot::Cfvo::from(mid));
            colors.push(cf_color_from_rgb(&mid.color));
        }
        cfvo.push(ot::Cfvo::from(&r.max));
        colors.push(cf_color_from_rgb(&r.max.color));
        ot::ColorScale { cfvo, colors }
    }
}

/// Convert a writer `DataBarRule` to a canonical `ot::DataBar`.
impl From<&DataBarRule> for ot::DataBar {
    fn from(r: &DataBarRule) -> Self {
        ot::DataBar {
            min_length: 10,
            max_length: 90,
            show_value: r.show_value,
            cfvo: vec![ot::Cfvo::from(&r.min), ot::Cfvo::from(&r.max)],
            color: cf_color_from_rgb(&r.color),
            gradient: r.gradient,
            axis_position: r.axis_position.unwrap_or_default(),
            show_value_attr_present: !r.show_value,
            gradient_attr_present: !r.gradient,
            axis_position_attr_present: r.axis_position.is_some(),
            border_color: r.border_color.as_deref().map(cf_color_from_rgb),
            negative_fill_color: r.negative_color.as_deref().map(cf_color_from_rgb),
            ..ot::DataBar::default()
        }
    }
}

/// Convert a writer `IconSetRule` to a canonical `ot::IconSet`.
impl From<&IconSetRule> for ot::IconSet {
    fn from(r: &IconSetRule) -> Self {
        ot::IconSet {
            icon_set: r.icon_set,
            show_value: r.show_value,
            percent: true,
            percent_attr_present: false,
            reverse: r.reverse,
            cfvo: r.thresholds.iter().map(ot::Cfvo::from).collect(),
            custom: false,
            cf_icon: Vec::new(),
        }
    }
}

/// Convert a writer `CfRule` (tagged-enum) to a canonical flat `ot::CfRule`.
impl From<&CfRule> for ot::CfRule {
    fn from(r: &CfRule) -> Self {
        let mut out = ot::CfRule {
            priority: r.priority,
            stop_if_true: r.stop_if_true,
            ..ot::CfRule::default()
        };

        match &r.rule_kind {
            CfRuleKind::CellIs(cell_is) => {
                out.rule_type = ot::CfRuleType::CellIs;
                out.operator = Some(cell_is.operator);
                out.dxf_id = cell_is.style.dxf_id;
                out.formulas.push(cell_is.value1.clone());
                if let Some(ref v2) = cell_is.value2 {
                    out.formulas.push(v2.clone());
                }
            }
            CfRuleKind::ColorScale(cs) => {
                out.rule_type = ot::CfRuleType::ColorScale;
                out.color_scale = Some(ot::ColorScale::from(cs));
            }
            CfRuleKind::DataBar(db) => {
                out.rule_type = ot::CfRuleType::DataBar;
                out.data_bar = Some(ot::DataBar::from(db));
            }
            CfRuleKind::IconSet(is) => {
                out.rule_type = ot::CfRuleType::IconSet;
                out.icon_set = Some(ot::IconSet::from(is));
            }
            CfRuleKind::Top10(top) => {
                out.rule_type = ot::CfRuleType::Top10;
                out.dxf_id = top.style.dxf_id;
                out.rank = Some(top.rank);
                out.percent = top.percent;
                out.bottom = !top.top;
            }
            CfRuleKind::AboveAverage(aa) => {
                out.rule_type = ot::CfRuleType::AboveAverage;
                out.dxf_id = aa.style.dxf_id;
                out.above_average = aa.above_average;
                out.equal_average = aa.equal_average;
                out.std_dev = aa.std_dev;
            }
            CfRuleKind::Expression(formula) => {
                out.rule_type = ot::CfRuleType::Expression;
                out.formulas.push(formula.clone());
            }
            CfRuleKind::ContainsText(tr) => {
                out.rule_type = ot::CfRuleType::ContainsText;
                out.dxf_id = tr.style.dxf_id;
                out.text = Some(tr.text.clone());
                out.operator = Some(CfOperator::ContainsText);
            }
            CfRuleKind::NotContainsText(tr) => {
                out.rule_type = ot::CfRuleType::NotContainsText;
                out.dxf_id = tr.style.dxf_id;
                out.text = Some(tr.text.clone());
                out.operator = Some(CfOperator::NotContains);
            }
            CfRuleKind::BeginsWith(tr) => {
                out.rule_type = ot::CfRuleType::BeginsWith;
                out.dxf_id = tr.style.dxf_id;
                out.text = Some(tr.text.clone());
                out.operator = Some(CfOperator::BeginsWith);
            }
            CfRuleKind::EndsWith(tr) => {
                out.rule_type = ot::CfRuleType::EndsWith;
                out.dxf_id = tr.style.dxf_id;
                out.text = Some(tr.text.clone());
                out.operator = Some(CfOperator::EndsWith);
            }
            CfRuleKind::ContainsBlanks => {
                out.rule_type = ot::CfRuleType::ContainsBlanks;
            }
            CfRuleKind::NotContainsBlanks => {
                out.rule_type = ot::CfRuleType::NotContainsBlanks;
            }
            CfRuleKind::ContainsErrors => {
                out.rule_type = ot::CfRuleType::ContainsErrors;
            }
            CfRuleKind::NotContainsErrors => {
                out.rule_type = ot::CfRuleType::NotContainsErrors;
            }
            CfRuleKind::TimePeriod(period) => {
                out.rule_type = ot::CfRuleType::TimePeriod;
                out.time_period = Some(*period);
            }
            CfRuleKind::DuplicateValues => {
                out.rule_type = ot::CfRuleType::DuplicateValues;
            }
            CfRuleKind::UniqueValues => {
                out.rule_type = ot::CfRuleType::UniqueValues;
            }
        }

        out
    }
}

/// Helper: create a [`ot::CfColor`] from an RGB hex string.
fn cf_color_from_rgb(rgb: &str) -> ot::CfColor {
    if rgb.is_empty() {
        ot::CfColor::default()
    } else {
        ot::CfColor {
            rgb: Some(rgb.to_string()),
            ..ot::CfColor::default()
        }
    }
}
