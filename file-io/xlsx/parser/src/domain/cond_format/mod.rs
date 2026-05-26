//! Conditional formatting parser for XLSX files.
//!
//! This module parses conditional formatting rules from worksheet XML,
//! supporting all ECMA-376 CT_ConditionalFormatting types including:
//! - cellIs, expression, colorScale, dataBar, iconSet, top10
//! - text-based rules (containsText, beginsWith, endsWith)
//! - uniqueValues, duplicateValues, containsBlanks, containsErrors
//! - timePeriod, aboveAverage
//! - x14 extensions (Excel 2010+ features)
//!
//! # Performance
//! Uses SIMD-optimized scanning functions for fast XML parsing.
//!
//! # Module Structure
//! - `types` - Re-exports from ooxml-types plus byte-parsing helpers
//! - `rules` - Parse functions for structural types (ColorScale, DataBar, etc.)
//! - `parser` - Main parsing functions

mod parser;
pub mod read;
mod rules;
mod types;
pub mod write;

#[cfg(test)]
mod tests;

// Re-export all types (these come from ooxml-types via types module)
pub use types::{
    CfColor, CfIcon, CfOperator, CfRule, CfRuleType, CfRuleX14, CfTimePeriod, Cfvo, CfvoType,
    ColorScale, ConditionalFormatting, ConditionalFormattingX14, DataBar, DataBarAxisPosition,
    DataBarDirection, IconSet, IconSetType,
};

// Re-export byte-parsing helpers from types module
pub use types::{
    axis_position_from_bytes, cf_operator_from_bytes, cf_rule_type_from_bytes,
    cf_time_period_from_bytes, cfvo_type_from_bytes, data_bar_direction_from_bytes,
    icon_set_type_from_bytes, parse_cf_color, parse_cfvo,
};

// Re-export structural parse functions from rules module
pub use rules::{
    parse_cf_icon, parse_cf_rule, parse_cf_rule_x14, parse_color_scale,
    parse_conditional_formatting_element, parse_conditional_formatting_x14_element, parse_data_bar,
    parse_icon_set,
};

// Re-export all public functions from parser module
pub use parser::{
    parse_conditional_formatting, parse_conditional_formatting_with_scanner,
    parse_conditional_formatting_x14,
};
