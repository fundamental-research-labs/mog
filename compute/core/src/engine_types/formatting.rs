//! Cell formatting types — re-exported from `snapshot-types`.
//!
//! `CellFormat` and `FontSize` live in the `domain-types` crate —
//! import from there directly.

pub use snapshot_types::properties::*;

/// Palette-compressed displayed formats for an ordered list of cell positions.
///
/// `format_ids` is aligned one-for-one with the input positions. Each ID indexes
/// `palette`; duplicate input positions are preserved and produce duplicate IDs.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayedFormatProjection {
    pub palette: Vec<domain_types::CellFormat>,
    pub format_ids: Vec<u32>,
}
