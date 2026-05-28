//! Conditional Formatting Writer for XLSX generation.
//!
//! This module provides a writer for generating conditional formatting rules
//! in XLSX worksheet XML files. It supports all major conditional formatting
//! types including:
//!
//! - Cell value rules (greater than, less than, between, etc.)
//! - Color scales (2-color and 3-color)
//! - Data bars
//! - Icon sets
//! - Top/bottom N rules
//! - Above/below average rules
//! - Expression-based rules
//! - Text rules (contains, begins with, ends with)
//! - Duplicate/unique values
//! - Time period rules
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::{CfWriter, CfOperator, CfStyle, IconSetType};
//!
//! let mut cf_writer = CfWriter::new();
//!
//! // Add a cell value rule
//! cf_writer.add_cell_is("A1:A10", CfOperator::GreaterThan, "100", CfStyle::default());
//!
//! // Add a color scale
//! cf_writer.add_color_scale_3("B1:B10", "FFF8696B", "FFFFEB84", "FF63BE7B");
//!
//! // Add a data bar
//! cf_writer.add_data_bar("C1:C10", "FF638EC6");
//!
//! // Add an icon set
//! cf_writer.add_icon_set("D1:D10", IconSetType::Arrows3);
//!
//! // Write to XmlWriter
//! let mut xml_writer = XmlWriter::new();
//! cf_writer.write_to(&mut xml_writer);
//! ```

mod bridge;
mod rules;
mod types;
mod writer;
mod x14;

#[cfg(test)]
mod tests;

// Re-export all public types
pub use types::{
    AboveAverageRule, CellIsRule, CfOperator, CfRule, CfRuleKind, CfRuleType, CfStyle,
    CfTimePeriod, CfValueObject, CfvoType, ColorScaleRule, ConditionalFormatting,
    DataBarAxisPosition, DataBarRule, IconSetRule, IconSetType, TextRule, Top10Rule,
};

pub use bridge::cf_xml_from_domain;
pub use writer::CfWriter;
pub use x14::x14_conditional_formatting_ext_xml_from_domain;
