//! Extracted read-only query functions.
//!
//! Each function takes explicit references to the engine sub-structs it needs
//! (e.g. `&EngineStores`, `&CellMirror`) instead of `&self`.  The original
//! bridge methods in `queries.rs` delegate to these with one-line calls.

use crate::engine_types::{
    CellPosition, CellPositionResult, ColumnEdge, DataBounds, DefaultFont, ProjectionData,
    RectBounds, RegexSearchMatch, RegexSearchOptions, RegexSearchResult, RowEdge,
    SheetProtectionConfig, SignAnomaly, SignCheckOptions, SignCheckResult, SignNeighbor,
    WorkbookSearchMatch, WorkbookSearchResult,
};
use crate::mirror::CellMirror;
use crate::range_manager::{self, A1CellRef, A1RangeRef, ViewportBounds};
use crate::snapshot::{
    CalcMode, CalculationSettings, ProtectedWorkbookOperation, WorkbookProtectionOptions,
    WorkbookSettings,
};
use crate::storage::cells::values as cell_values;
use crate::storage::infra::cell_iter;
use crate::storage::sheet::{
    dimensions as sheet_dimensions, grouping as sheet_grouping, merges, order, print, properties,
    protection, settings, view, visibility,
};
use crate::storage::workbook::named_ranges as workbook_named_ranges;
use crate::storage::workbook::settings as workbook_settings;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use domain_types::domain::merge::{
    CellMergeInfo, IdentityMergedRegion, MergeRegion, ResolvedMergedRegion,
};
use domain_types::domain::sheet::{FrozenPanes, SheetMeta, SheetScrollPosition, SheetViewOptions};
use domain_types::domain::slicer::NamedSlicerStyle;
use domain_types::units::{CharWidth, Pixels, Points};
use domain_types::{DefinedName, NameValidationResult};
use value_types::ComputeError;
use yrs::Transact;

use super::super::merge_index::MergeDirectResolver;
use super::super::query_serialization::{cell_data_to_json, cell_value_to_json};
use crate::storage::engine::stores::EngineStores;

/// Resolve a cell's (row, col) from its hex id via the authoritative
/// `GridIndex`. Returns `None` if the hex fails to parse or the cell is
/// unknown to the index.
fn resolve_pos_from_grid(
    grid: Option<&crate::identity::GridIndex>,
    cell_id_hex: &str,
) -> Option<(u32, u32)> {
    let grid = grid?;
    let raw = hex_to_id(cell_id_hex)?;
    grid.cell_position(&CellId::from_raw(raw))
}

// -------------------------------------------------------------------

mod cells;
mod dimensions;
mod named_ranges;
mod projections;
mod ranges;
mod search;
mod sheets;
mod workbook;

pub(in crate::storage::engine) use cells::*;
pub(in crate::storage::engine) use dimensions::*;
pub(in crate::storage::engine) use named_ranges::*;
pub(in crate::storage::engine) use projections::*;
pub(in crate::storage::engine) use ranges::*;
pub(in crate::storage::engine) use search::*;
pub(in crate::storage::engine) use sheets::*;
pub(in crate::storage::engine) use workbook::*;
