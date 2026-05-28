use serde::{Deserialize, Serialize};

/// Waterfall-chart specific options.
///
/// Mirrors the `cx:layoutPr` bits relevant to waterfall charts: subtotal
/// indices and connector-line visibility.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct WaterfallOptions {
    /// Zero-based indices of data points rendered as subtotals.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub subtotal_indices: Vec<u32>,
    /// Whether connector lines between bars are drawn.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_connector_lines: Option<bool>,
}
