//! Chart series parsing for XLSX charts
//!
//! This module parses chart data series from OOXML chart XML.
//! Series contain the actual data displayed in charts.
//!
//! # OOXML Structure
//!
//! Series elements (c:ser) contain:
//! - idx: Series index
//! - order: Plot order
//! - tx: Series name (title text)
//! - cat: Category data (X-axis labels)
//! - val: Value data (Y-axis values)
//! - Data point customization
//! - Data labels
//! - Error bars
//! - Trendlines

mod data_sources;
mod error_bars;
mod labels;
mod parse;
mod points;
mod trendlines;
mod xml_values;

// Re-export series-related enums from ooxml-types.
pub use ooxml_types::charts::{
    DataLabelPosition, ErrorBarDirection, ErrorBarType, ErrorValueType, LayoutMode, LayoutTarget,
    ManualLayout, TrendlineLabel, TrendlineType,
};

// Re-export chart data source types from ooxml-types (canonical definitions).
pub use ooxml_types::charts::{
    NumData, NumPoint, NumRef, SeriesTextSource, StrData, StrPoint, StrRef,
};

// Re-export canonical series-level types from ooxml-types.
pub use ooxml_types::charts::{
    CatDataSource, ChartSeries, DataLabel, DataLabelOptions, DataPointOverride, ErrorBars, Marker,
    NumDataSource, Trendline,
};

pub use data_sources::{
    AxisData, parse_num_data, parse_num_ref, parse_series_text, parse_str_data, parse_str_ref,
};
pub use error_bars::parse_error_bars;
pub use labels::parse_data_labels;
pub(crate) use labels::parse_individual_data_label;
pub(crate) use parse::is_standard_ser_tag;
pub use parse::{parse_all_series, parse_series};
pub use points::{parse_all_data_points, parse_data_point, parse_marker};
pub use trendlines::parse_trendline;
pub(crate) use xml_values::parse_val_attr_u32;

/// Find the direct-child `<c:extLst>` in a series-like XML fragment.
pub fn find_top_level_ext_lst(xml: &[u8]) -> Option<usize> {
    super::parse::ext::find_top_level_ext_lst(xml)
}

/// Parse `<c:extLst>` starting from a known position and return a `Vec<ExtensionEntry>`.
pub fn parse_chart_ext_lst_at(
    xml: &[u8],
    ext_lst_start: usize,
) -> Vec<ooxml_types::charts::ExtensionEntry> {
    super::parse::ext::parse_chart_ext_lst_at(xml, ext_lst_start)
}

/// Parse the first `<c:extLst>` in an XML fragment.
pub fn parse_chart_ext_lst(xml: &[u8]) -> Vec<ooxml_types::charts::ExtensionEntry> {
    super::parse::ext::parse_chart_ext_lst(xml)
}

#[cfg(test)]
mod tests;
