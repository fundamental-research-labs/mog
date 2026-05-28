//! Dense viewport cell-record construction.

use crate::flags as render_flags;
use crate::types::{DataBarRenderData, IconRenderData, ViewportRenderCell};

use super::records::ViewportCellRecord;
use super::string_pool::DedupStringPool;

/// Cell records and sparse conditional-format sections built from render cells.
pub(super) struct CellBuildResult<'a> {
    /// Dense cell records in `cells` iteration order.
    pub(super) cell_records: Vec<ViewportCellRecord>,
    /// Deduplicated UTF-8 string pool bytes.
    pub(super) string_pool: Vec<u8>,
    /// Sparse data bar entries keyed by dense cell index.
    pub(super) data_bar_entries: Vec<(u32, &'a DataBarRenderData)>,
    /// Sparse icon entries keyed by dense cell index.
    pub(super) icon_entries: Vec<(u32, &'a IconRenderData)>,
}

/// Iterate viewport cells, intern strings into a deduplicated byte pool, and
/// collect cell records plus sparse CF extras indices.
#[allow(clippy::cast_possible_truncation)] // string offsets bounded by pool size
pub(super) fn build_string_pool_and_records(cells: &[ViewportRenderCell]) -> CellBuildResult<'_> {
    let estimated_pool = cells.len() * 12; // ~60% of cells have strings, ~20 bytes avg
    let mut pool = DedupStringPool::with_capacity(estimated_pool);
    let mut cell_records = Vec::with_capacity(cells.len());
    let mut data_bar_entries = Vec::new();
    let mut icon_entries = Vec::new();

    for (cell_idx, cell) in cells.iter().enumerate() {
        let mut flags = cell.flags;

        if let Some(ref extras) = cell.cf_extras {
            flags |= render_flags::HAS_CF_EXTRAS;
            if let Some(ref db) = extras.data_bar {
                data_bar_entries.push((cell_idx as u32, db));
            }
            if let Some(ref icon) = extras.icon {
                icon_entries.push((cell_idx as u32, icon));
            }
        }

        let (display_off, display_len) = pool.intern_optional(cell.formatted.as_deref());
        let (error_off, error_len) = pool.intern_optional(cell.error.as_deref());

        cell_records.push(ViewportCellRecord {
            number_value: cell.number_value,
            display_off,
            error_off,
            flags,
            format_idx: cell.format_idx,
            display_len,
            error_len,
            bg_color_override: cell.bg_color_override,
            font_color_override: cell.font_color_override,
        });
    }

    CellBuildResult {
        cell_records,
        string_pool: pool.into_bytes(),
        data_bar_entries,
        icon_entries,
    }
}
