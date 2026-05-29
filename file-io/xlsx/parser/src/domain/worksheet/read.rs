//! Compatibility facade for worksheet read/parse functions.
//!
//! Existing callers import worksheet parsers through this module. The
//! implementations live in focused sibling modules.

pub use super::read_dimensions::{parse_col_widths, parse_dimensions};
pub use super::read_merge::parse_merge_cells;
pub use super::read_passthrough::{extract_auto_filter_xml, extract_custom_properties_xml};
pub use super::read_properties::{
    SheetDimensionImport, parse_dimension_ref, parse_dimension_ref_value,
    parse_dimension_ref_with_text, parse_outline_properties, parse_page_setup_properties,
    parse_sheet_calc_pr, parse_sheet_format_pr, parse_sheet_properties,
};
pub use super::read_relationships::{parse_legacy_drawing_hf_r_id, parse_legacy_drawing_r_id};
pub use super::read_semantic::parse_worksheet_semantic_containers;
pub use super::read_sort::parse_standalone_sort_state;
pub use super::read_views::{
    parse_frozen_pane, parse_sheet_view, parse_sheet_views, parse_sheet_views_ext_lst,
};

pub(crate) use super::read_sort::parse_sort_state_slice;
