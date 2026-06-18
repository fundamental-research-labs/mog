//! Domain extraction functions: OOXML -> domain types.

mod axes;
mod chart_space;
mod common;
mod data_refs;
mod formatting;
mod labels;
mod legacy;
mod legend;
mod markers;
mod series;
mod series_sources;
mod text;

pub use chart_space::extract_chart_spec_from_chart_space;

pub(super) use common::chart_import_status_for_renderability;
pub(crate) use data_refs::{parse_chart_a1_ref, synthesize_rectangular_data_range};
pub(crate) use formatting::{extract_chart_format, extract_chart_line, extract_chart_rich_text};
pub(super) use labels::extract_data_label_data;
pub(super) use legacy::{
    extract_axes, extract_chart_data_labels, extract_chart_series, extract_data_range,
    extract_legend, extract_sub_type, map_chart_type_to_ts,
};
