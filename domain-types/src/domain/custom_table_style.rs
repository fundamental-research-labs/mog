//! Custom table style domain types.
//!
//! Consolidated from `compute-table/src/custom_styles.rs` into `domain-types`.

use serde::{Deserialize, Serialize};

mod ooxml;

pub use ooxml::CustomTableStyleOoxmlExport;

/// Stripe pattern configuration for rows or columns.
/// Excel supports stripe sizes of 1-9 alternating rows/columns.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StripePattern {
    /// Number of rows/columns per stripe (1-9, default 1).
    pub stripe_size: u8,
    /// Fill color for stripe 1.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stripe1_fill: Option<String>,
    /// Fill color for stripe 2.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stripe2_fill: Option<String>,
}

impl Default for StripePattern {
    fn default() -> Self {
        Self {
            stripe_size: 1,
            stripe1_fill: None,
            stripe2_fill: None,
        }
    }
}

/// Element formatting for table style elements (header, total, columns, etc.).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableElementStyle {
    /// Fill (background) color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    /// Font color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_color: Option<String>,
    /// Font bold.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_bold: Option<bool>,
    /// Border style for top.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_top: Option<String>,
    /// Border style for bottom.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_bottom: Option<String>,
    /// Border style for left.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_left: Option<String>,
    /// Border style for right.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_right: Option<String>,
}

/// Complete custom table style definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTableStyleConfig {
    /// Unique ID.
    pub id: String,
    /// User-defined name for the style.
    pub name: String,
    /// Creation timestamp (millis since epoch).
    pub created_at: f64,
    /// Last modified timestamp (millis since epoch).
    pub updated_at: f64,
    /// Header row formatting.
    pub header_row: TableElementStyle,
    /// Total row formatting.
    pub total_row: TableElementStyle,
    /// First column formatting.
    pub first_column: TableElementStyle,
    /// Last column formatting.
    pub last_column: TableElementStyle,
    /// Row stripe pattern.
    pub row_stripes: StripePattern,
    /// Column stripe pattern.
    pub column_stripes: StripePattern,
    /// Whole table default styling.
    pub whole_table: TableElementStyle,
}
