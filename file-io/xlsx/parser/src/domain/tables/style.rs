//! Style types for Excel Tables.
//!
//! This module re-exports `TableStyleInfo` from `ooxml_types::tables` and provides
//! the XML byte-level parsing implementation needed by the read path.

use crate::infra::scanner::{find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_opt, parse_string_attr};

// Re-export the canonical type.
pub use ooxml_types::tables::TableStyleInfo;

/// Parse a `<tableStyleInfo .../>` element from raw XML bytes.
pub fn parse_table_style_info(xml: &[u8]) -> Option<TableStyleInfo> {
    let si_start = find_tag_simd(xml, b"tableStyleInfo", 0)?;
    let si_end = find_gt_simd(xml, si_start)?;
    let tag = &xml[si_start..si_end];

    Some(TableStyleInfo {
        name: parse_string_attr(tag, b"name=\""),
        show_first_column: parse_bool_attr_opt(tag, b"showFirstColumn=\"").unwrap_or(false),
        show_last_column: parse_bool_attr_opt(tag, b"showLastColumn=\"").unwrap_or(false),
        show_row_stripes: parse_bool_attr_opt(tag, b"showRowStripes=\"").unwrap_or(true),
        show_column_stripes: parse_bool_attr_opt(tag, b"showColumnStripes=\"").unwrap_or(false),
    })
}
