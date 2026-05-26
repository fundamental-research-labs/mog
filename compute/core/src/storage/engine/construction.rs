//! Shared construction helpers for `YrsComputeEngine`.
//!
//! Deduplicates the grid-index, merge-index, layout-index, observer, undo-manager,
//! locale, and theme-palette creation that was previously copy-pasted across
//! `from_snapshot`, `from_xlsx_bytes`, `import_from_xlsx_bytes`, and
//! `import_from_xlsx_bytes_no_recalc`.

use std::collections::HashMap;
use std::sync::Arc;

use rustc_hash::FxHashMap;
use yrs::{Any, Array, Map, Out, Transact};

use cell_types::{AxisIdentityStore, CellId, ColId, IdAllocator, RowId, SheetId};
use compute_layout_index::LayoutIndex;
use value_types::ComputeError;

use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use crate::range_manager::RangeSpatialIndex;
use crate::scheduler::ComputeCore;
use crate::snapshot::{RecalcResult, SheetSnapshot, WorkbookSnapshot};
use crate::storage::YrsStorage;
use crate::storage::sheet::{dimensions, grouping, merges};
use crate::storage::workbook::{named_ranges, settings as workbook_settings};
use domain_types::{self, ImportedCellProjectionRole};
use formula_types::{NamedRangeDef, Scope, WorkbookLookup};

use super::queries::{MergeRangeRef, MergeSpatialItem};
use super::settings::EngineSettings;
use super::stores::EngineStores;
use super::viewport::service::ViewportService;
use super::{MutationCoordinator, YrsComputeEngine};
use compute_document::hex::hex_to_id;
use compute_document::observe::DocumentObserver;
use compute_document::undo::UndoRedoManager;

fn range_style_formats_enabled() -> bool {
    std::env::var("MOG_XLSX_RANGE_STYLE_FORMATS")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "no" | "off")
        })
        .unwrap_or(true)
}

fn build_imported_range_style_plan(
    sheet_data: &domain_types::SheetData,
    alloc: &crate::storage::infra::hydration::SheetIdAllocation,
    ranges: &[snapshot_types::RangeData],
    allocator: &mut crate::storage::infra::hydration::DefaultIdAllocator,
) -> (
    std::collections::HashSet<(u32, u32)>,
    Vec<crate::storage::infra::hydration::ImportedRangeStyle>,
) {
    let mut style_by_pos: HashMap<(u32, u32), Option<u32>> =
        HashMap::with_capacity(sheet_data.cells.len());
    for cell in &sheet_data.cells {
        style_by_pos.insert((cell.row, cell.col), cell.style_id);
    }

    let row_index_by_id: HashMap<RowId, u32> = alloc
        .row_ids
        .iter()
        .copied()
        .enumerate()
        .map(|(idx, row_id)| (row_id, idx as u32))
        .collect();
    let col_index_by_id: HashMap<ColId, u32> = alloc
        .col_ids
        .iter()
        .copied()
        .enumerate()
        .map(|(idx, col_id)| (col_id, idx as u32))
        .collect();

    let mut positions = std::collections::HashSet::new();
    let mut styles = Vec::new();

    for range in ranges {
        let mut range_positions = Vec::with_capacity(range.row_ids.len() * range.col_ids.len());
        let mut style_id: Option<u32> = None;
        let mut eligible = true;

        for row_id in &range.row_ids {
            let Some(&row) = row_index_by_id.get(row_id) else {
                eligible = false;
                break;
            };
            for col_id in &range.col_ids {
                let Some(&col) = col_index_by_id.get(col_id) else {
                    eligible = false;
                    break;
                };
                let Some(cell_style) = style_by_pos.get(&(row, col)).copied().flatten() else {
                    eligible = false;
                    break;
                };
                match style_id {
                    Some(existing) if existing != cell_style => {
                        eligible = false;
                        break;
                    }
                    Some(_) => {}
                    None => style_id = Some(cell_style),
                }
                range_positions.push((row, col));
            }
            if !eligible {
                break;
            }
        }

        let Some(style_id) = style_id else {
            continue;
        };
        if !eligible {
            continue;
        }

        let range_position_set: std::collections::HashSet<(u32, u32)> =
            range_positions.iter().copied().collect();
        positions.extend(range_positions);
        for (idx, (start_row, start_col, end_row, end_col)) in
            coalesce_imported_style_positions(&range_position_set)
                .into_iter()
                .enumerate()
        {
            styles.push(crate::storage::infra::hydration::ImportedRangeStyle {
                range_id: if idx == 0 {
                    range.range_id
                } else {
                    allocator.alloc_range_id()
                },
                start_row,
                start_col,
                end_row,
                end_col,
                style_id,
            });
        }
    }

    (positions, styles)
}

fn coalesce_imported_style_positions(
    positions: &std::collections::HashSet<(u32, u32)>,
) -> Vec<(u32, u32, u32, u32)> {
    if positions.is_empty() {
        return Vec::new();
    }

    let mut points: Vec<(u32, u32)> = positions.iter().copied().collect();
    points.sort_unstable();

    let mut row_runs: Vec<(u32, u32, u32)> = Vec::new();
    for (row, col) in points {
        if let Some(last) = row_runs.last_mut()
            && last.0 == row
            && last.2.saturating_add(1) == col
        {
            last.2 = col;
            continue;
        }
        row_runs.push((row, col, col));
    }

    let mut rectangles: Vec<(u32, u32, u32, u32)> = Vec::new();
    let mut active: HashMap<(u32, u32), usize> = HashMap::new();
    for (row, start_col, end_col) in row_runs {
        let key = (start_col, end_col);
        if let Some(&idx) = active.get(&key)
            && rectangles[idx].2.saturating_add(1) == row
        {
            rectangles[idx].2 = row;
            continue;
        }
        let idx = rectangles.len();
        active.insert(key, idx);
        rectangles.push((row, start_col, row, end_col));
    }

    rectangles.sort_unstable();
    rectangles
}

fn defined_name_scope(scope_hex: Option<&str>) -> Scope {
    scope_hex
        .and_then(hex_to_id)
        .map_or(Scope::Workbook, |raw| Scope::Sheet(SheetId::from_raw(raw)))
}

fn named_range_raw_expression_from_a1(a1: &str, fallback: &str) -> String {
    let a1 = a1.strip_prefix('=').unwrap_or(a1);
    if a1.is_empty() {
        fallback.to_string()
    } else {
        format!("={a1}")
    }
}

/// Convert canonical Yrs defined names into evaluator-ready named-range defs.
///
/// Yrs stores `DefinedName.refers_to` as JSON-serialized `IdentityFormula`.
/// Readers must decode that typed shape first; treating the JSON bytes as raw
/// formula text makes provider replay diverge from first-load import.
pub(super) fn defined_names_to_named_range_defs<F>(
    defined_names: Vec<named_ranges::DefinedName>,
    mut identity_to_a1: F,
) -> Vec<NamedRangeDef>
where
    F: FnMut(&formula_types::IdentityFormula) -> String,
{
    defined_names
        .into_iter()
        .filter_map(|dn| {
            let scope = defined_name_scope(dn.scope.as_deref());
            let identity = match serde_json::from_str::<formula_types::IdentityFormula>(
                &dn.refers_to,
            ) {
                Ok(id) => id,
                Err(e) => {
                    tracing::warn!(
                        name = %dn.name,
                        error = %e,
                        "Yrs DefinedName.refers_to is not a valid IdentityFormula JSON; \
                         skipping. After typed formula boundary the only canonical on-disk format \
                         is IdentityFormula JSON."
                    );
                    return None;
                }
            };

            if identity.refs.is_empty() {
                let mut def = NamedRangeDef::from_expression(dn.name, scope, identity.template);
                def.linked_range_id = dn.linked_range_id;
                return Some(def);
            }

            let a1 = identity_to_a1(&identity);
            if identity_formula_uses_axis_identity_refs(&identity) {
                let mut def = NamedRangeDef::from_expression(
                    dn.name,
                    scope,
                    named_range_raw_expression_from_a1(&a1, &dn.refers_to),
                );
                def.linked_range_id = dn.linked_range_id;
                return Some(def);
            }

            Some(NamedRangeDef {
                name: dn.name,
                scope,
                refers_to: identity,
                raw_expression: Some(named_range_raw_expression_from_a1(&a1, &dn.refers_to)),
                linked_range_id: dn.linked_range_id,
            })
        })
        .collect()
}

fn identity_formula_uses_axis_identity_refs(identity: &formula_types::IdentityFormula) -> bool {
    identity.refs.iter().any(|reference| {
        matches!(
            reference,
            formula_types::IdentityFormulaRef::RectRange(_)
                | formula_types::IdentityFormulaRef::FullRow(_)
                | formula_types::IdentityFormulaRef::RowRange(_)
                | formula_types::IdentityFormulaRef::FullCol(_)
                | formula_types::IdentityFormulaRef::ColRange(_)
        )
    })
}

struct YrsIdentityFormulaLookup {
    formula_sheet: SheetId,
    cell_positions: HashMap<CellId, (SheetId, u32, u32)>,
    row_indices: HashMap<RowId, (SheetId, u32)>,
    col_indices: HashMap<ColId, (SheetId, u32)>,
    sheet_names: HashMap<SheetId, String>,
}

impl YrsIdentityFormulaLookup {
    fn from_storage(storage: &YrsStorage) -> Self {
        let sheet_order = storage.sheet_order();
        let formula_sheet = sheet_order
            .first()
            .copied()
            .unwrap_or_else(|| SheetId::from_raw(0));
        let mut lookup = Self {
            formula_sheet,
            cell_positions: HashMap::new(),
            row_indices: HashMap::new(),
            col_indices: HashMap::new(),
            sheet_names: HashMap::new(),
        };

        for sheet_id in sheet_order {
            if let Some(name) = crate::storage::sheet::properties::get_sheet_name(
                storage.doc(),
                storage.sheets(),
                &sheet_id,
            ) {
                lookup.sheet_names.insert(sheet_id, name);
            }
            lookup.read_sheet(storage, sheet_id);
        }

        lookup
    }

    fn read_sheet(&mut self, storage: &YrsStorage, sheet_id: SheetId) {
        use compute_document::schema::{KEY_GRID_ID_TO_POS, KEY_GRID_INDEX, KEY_GRID_POS_TO_ID};

        let txn = storage.doc().transact();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
        let Some(yrs::Out::YMap(sheet_map)) = storage.sheets().get(&txn, &sheet_hex) else {
            return;
        };

        let row_index_by_hex: HashMap<String, u32> =
            match crate::storage::infra::grid_helpers::get_row_order_array(&sheet_map, &txn) {
                Some(arr) => (0..arr.len(&txn))
                    .filter_map(|i| match arr.get(&txn, i) {
                        Some(yrs::Out::Any(yrs::Any::String(row_hex))) => {
                            let raw = hex_to_id(&row_hex)?;
                            self.row_indices.insert(RowId::from_raw(raw), (sheet_id, i));
                            Some((row_hex.to_string(), i))
                        }
                        _ => None,
                    })
                    .collect(),
                None => HashMap::new(),
            };

        let col_index_by_hex: HashMap<String, u32> =
            match crate::storage::infra::grid_helpers::get_col_order_array(&sheet_map, &txn) {
                Some(arr) => (0..arr.len(&txn))
                    .filter_map(|i| match arr.get(&txn, i) {
                        Some(yrs::Out::Any(yrs::Any::String(col_hex))) => {
                            let raw = hex_to_id(&col_hex)?;
                            self.col_indices.insert(ColId::from_raw(raw), (sheet_id, i));
                            Some((col_hex.to_string(), i))
                        }
                        _ => None,
                    })
                    .collect(),
                None => HashMap::new(),
            };

        let Some(yrs::Out::YMap(grid_index)) = sheet_map.get(&txn, KEY_GRID_INDEX) else {
            return;
        };

        let mut inserted_from_pos_to_id = false;
        if let Some(yrs::Out::YMap(pos_to_id)) = grid_index.get(&txn, KEY_GRID_POS_TO_ID) {
            for (pos_key, value) in pos_to_id.iter(&txn) {
                let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
                    continue;
                };
                let (Some(&row), Some(&col)) =
                    (row_index_by_hex.get(row_hex), col_index_by_hex.get(col_hex))
                else {
                    continue;
                };
                let yrs::Out::Any(yrs::Any::String(cell_hex)) = value else {
                    continue;
                };
                let Some(raw) = hex_to_id(&cell_hex) else {
                    continue;
                };
                self.cell_positions
                    .insert(CellId::from_raw(raw), (sheet_id, row, col));
                inserted_from_pos_to_id = true;
            }
        }

        if !inserted_from_pos_to_id
            && let Some(yrs::Out::YMap(id_to_pos)) = grid_index.get(&txn, KEY_GRID_ID_TO_POS)
        {
            for (cell_hex, value) in id_to_pos.iter(&txn) {
                let yrs::Out::Any(yrs::Any::String(pos_key)) = value else {
                    continue;
                };
                let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
                    continue;
                };
                let (Some(&row), Some(&col)) =
                    (row_index_by_hex.get(row_hex), col_index_by_hex.get(col_hex))
                else {
                    continue;
                };
                let Some(raw) = hex_to_id(cell_hex) else {
                    continue;
                };
                self.cell_positions
                    .insert(CellId::from_raw(raw), (sheet_id, row, col));
            }
        }
    }
}

impl WorkbookLookup for YrsIdentityFormulaLookup {
    fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        self.cell_positions.get(cell_id).copied()
    }

    fn row_index(&self, row_id: &RowId) -> Option<(SheetId, u32)> {
        self.row_indices.get(row_id).copied()
    }

    fn col_index(&self, col_id: &ColId) -> Option<(SheetId, u32)> {
        self.col_indices.get(col_id).copied()
    }

    fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str> {
        self.sheet_names
            .get(sheet_id)
            .map(std::string::String::as_str)
    }

    fn formula_sheet(&self) -> SheetId {
        self.formula_sheet
    }
}

/// Result of parsing and hydrating an XLSX file.
type XlsxHydrateResult = (
    YrsStorage,
    WorkbookSnapshot,
    domain_types::RoundTripContext,
    Vec<(SheetId, CellId, u32, u32)>,
);

/// Data stored for deferred Yrs CRDT hydration.
/// After the fast-path import, this holds everything needed to complete
/// the Yrs write and rebuild indexes with full fidelity.
pub struct DeferredHydrationData {
    pub(super) parse_output: domain_types::ParseOutput,
    pub(super) allocations: Vec<crate::storage::infra::hydration::SheetIdAllocation>,
    pub(super) workbook_snap: WorkbookSnapshot,
    pub(super) round_trip_ctx: domain_types::RoundTripContext,
    /// Raw XLSX bytes for full re-parse during deferred hydration.
    /// The fast-path parse uses values_only + skip options; the full parse
    /// during hydration needs the complete data.
    pub(super) raw_xlsx_bytes: Option<Vec<u8>>,
}

/// Fully staged deferred XLSX completion. This owns every component needed to
/// replace the live engine after any fallible import-open recalculation has
/// succeeded.
pub(super) struct DeferredHydrationCompletion {
    pub(super) stores: EngineStores,
    pub(super) mirror: CellMirror,
    pub(super) settings: EngineSettings,
    pub(super) round_trip_ctx: domain_types::RoundTripContext,
    pub(super) phantom_cells: Vec<(SheetId, CellId, u32, u32)>,
    pub(super) calculation: domain_types::CalculationProperties,
}

// ---------------------------------------------------------------------------
// Index builders
// ---------------------------------------------------------------------------

/// Build `GridIndex` maps for every sheet by reading rowOrder/colOrder from Yrs.
///
/// This is the preferred constructor when Yrs storage is available, as it
/// preserves the stable RowId/ColId identities from the CRDT document.
pub(super) fn build_grid_indexes_from_yrs(
    storage: &crate::storage::YrsStorage,
    snapshot: &WorkbookSnapshot,
    grid_id_alloc: Arc<IdAllocator>,
) -> Result<FxHashMap<SheetId, GridIndex>, ComputeError> {
    use crate::storage::infra::grid_helpers;

    let mut grid_indexes = FxHashMap::default();
    for sheet_snap in &snapshot.sheets {
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());

        // Try reading compact axis stores, legacy rowOrder/colOrder, and the
        // authoritative position index from Yrs.
        let (row_axis, col_axis, row_hexes, col_hexes, pos_to_id_entries) = {
            let txn = storage.doc().transact();
            let sheet_map = match storage.sheets().get(&txn, &sheet_hex) {
                Some(yrs::Out::YMap(m)) => Some(m),
                _ => None,
            };
            if let Some(sm) = sheet_map {
                let grid_index_map = sm
                    .get(&txn, compute_document::schema::KEY_GRID_INDEX)
                    .and_then(|out| match out {
                        yrs::Out::YMap(grid_index_map) => Some(grid_index_map),
                        _ => None,
                    });
                let row_axis = grid_index_map.as_ref().and_then(|grid_index_map| {
                    compute_document::schema::read_grid_row_axis(&txn, grid_index_map)
                });
                let col_axis = grid_index_map.as_ref().and_then(|grid_index_map| {
                    compute_document::schema::read_grid_col_axis(&txn, grid_index_map)
                });
                let rh = grid_helpers::get_row_order_array(&sm, &txn)
                    .map(|a| grid_helpers::read_row_order(&a, &txn))
                    .unwrap_or_default();
                let ch = grid_helpers::get_col_order_array(&sm, &txn)
                    .map(|a| grid_helpers::read_col_order(&a, &txn))
                    .unwrap_or_default();
                let pos_to_id_entries = grid_index_map
                    .and_then(|grid_index_map| {
                        grid_index_map.get(&txn, compute_document::schema::KEY_GRID_POS_TO_ID)
                    })
                    .and_then(|out| match out {
                        yrs::Out::YMap(pos_to_id) => Some(
                            pos_to_id
                                .iter(&txn)
                                .filter_map(|(pos_key, value)| match value {
                                    yrs::Out::Any(Any::String(cell_hex)) => {
                                        Some((pos_key.to_string(), cell_hex.to_string()))
                                    }
                                    _ => None,
                                })
                                .collect::<Vec<_>>(),
                        ),
                        _ => None,
                    })
                    .unwrap_or_default();
                (row_axis, col_axis, rh, ch, pos_to_id_entries)
            } else {
                (None, None, vec![], vec![], vec![])
            }
        };

        let mut grid = if let (Some(row_axis), Some(col_axis)) = (row_axis, col_axis) {
            GridIndex::from_axis_stores(sheet_id, row_axis, col_axis, grid_id_alloc.clone())
        } else if !row_hexes.is_empty() || !col_hexes.is_empty() {
            GridIndex::from_yrs_arrays(sheet_id, &row_hexes, &col_hexes, grid_id_alloc.clone())
        } else {
            GridIndex::new(
                sheet_id,
                sheet_snap.rows,
                sheet_snap.cols,
                grid_id_alloc.clone(),
            )
        };

        for (pos_key, cell_hex) in pos_to_id_entries {
            let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
                continue;
            };
            let (Some(row), Some(col)) = (
                grid.row_index_from_hex(row_hex),
                grid.col_index_from_hex(col_hex),
            ) else {
                continue;
            };
            if let Some(cell_raw) = hex_to_id(&cell_hex) {
                grid.register_cell(CellId::from_raw(cell_raw), row, col);
            }
        }

        for cell_data in &sheet_snap.cells {
            let cell_id = CellId::from_uuid_str(&cell_data.cell_id)?;
            grid.register_cell(cell_id, cell_data.row, cell_data.col);
        }
        grid_indexes.insert(sheet_id, grid);
    }
    Ok(grid_indexes)
}

/// Build `GridIndex` maps from the same row/column identities used to create
/// snapshot ranges during XLSX import.
///
/// Range payloads store RowId/ColId, not physical row/column numbers. Deferred
/// first-paint import cannot allocate fresh axes here or the mirror cannot map
/// range identities back to sheet positions when it materializes `col_data`.
pub(super) fn build_grid_indexes_from_allocations_range(
    snapshot: &WorkbookSnapshot,
    allocations: &[crate::storage::infra::hydration::SheetIdAllocation],
    range: std::ops::Range<usize>,
    grid_id_alloc: Arc<IdAllocator>,
) -> Result<FxHashMap<SheetId, GridIndex>, ComputeError> {
    let mut grid_indexes = FxHashMap::default();
    for i in range {
        let sheet_snap = &snapshot.sheets[i];
        let allocation = allocations
            .get(i)
            .ok_or_else(|| ComputeError::Deserialize {
                message: format!("missing sheet ID allocation for sheet index {i}"),
            })?;
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let mut grid = GridIndex::from_axis_stores(
            sheet_id,
            AxisIdentityStore::Explicit(allocation.row_ids.clone()),
            AxisIdentityStore::Explicit(allocation.col_ids.clone()),
            grid_id_alloc.clone(),
        );
        for cell_data in &sheet_snap.cells {
            let cell_id = CellId::from_uuid_str(&cell_data.cell_id)?;
            grid.register_cell(cell_id, cell_data.row, cell_data.col);
        }
        for identity in &allocation.identity_only_cells {
            grid.register_cell(identity.cell_id, identity.row, identity.col);
        }
        grid_indexes.insert(sheet_id, grid);
    }
    Ok(grid_indexes)
}

/// Build merge spatial indexes from ParseOutput for a range of sheets.
pub(super) fn build_merge_indexes_from_parse_output_range(
    parse_output: &domain_types::ParseOutput,
    snapshot: &WorkbookSnapshot,
    range: std::ops::Range<usize>,
) -> Result<FxHashMap<SheetId, RangeSpatialIndex<MergeSpatialItem>>, ComputeError> {
    let mut indexes = FxHashMap::default();
    for i in range {
        let sheet_snap = &snapshot.sheets[i];
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let sheet_data = &parse_output.sheets[i];
        let items: Vec<MergeSpatialItem> = sheet_data
            .merges
            .iter()
            .enumerate()
            .map(|(idx, m)| {
                let id = format!("merge_{}", idx);
                MergeSpatialItem {
                    id,
                    start_row: m.start_row,
                    start_col: m.start_col,
                    end_row: m.end_row,
                    end_col: m.end_col,
                    range_ref: MergeRangeRef {
                        start_row: m.start_row,
                        start_col: m.start_col,
                        end_row: m.end_row,
                        end_col: m.end_col,
                    },
                }
            })
            .collect();
        indexes.insert(sheet_id, RangeSpatialIndex::with_items(items));
    }
    Ok(indexes)
}

/// Build `LayoutIndex` from ParseOutput for a range of sheets.
pub(super) fn build_layout_indexes_from_parse_output_range(
    parse_output: &domain_types::ParseOutput,
    snapshot: &WorkbookSnapshot,
    grid_indexes: &FxHashMap<SheetId, GridIndex>,
    range: std::ops::Range<usize>,
) -> Result<FxHashMap<SheetId, LayoutIndex>, ComputeError> {
    let mut indexes = FxHashMap::default();
    for i in range {
        let sheet_snap = &snapshot.sheets[i];
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let sheet_data = &parse_output.sheets[i];
        let dims = &sheet_data.dimensions;

        let mdw = domain_types::units::platform_mdw();
        let default_row_height_pt = domain_types::units::Points(
            dims.default_row_height
                .unwrap_or(dimensions::DEFAULT_ROW_HEIGHT.0),
        );
        let default_col_width_cw = domain_types::units::CharWidth(
            dims.default_col_width
                .unwrap_or(dimensions::DEFAULT_COL_WIDTH.0),
        );
        let default_row_height_px = domain_types::units::points_to_pixels(default_row_height_pt);
        let default_col_width_px =
            domain_types::units::char_width_to_pixels(default_col_width_cw, mdw);

        let custom_row_heights: Vec<(usize, domain_types::units::Pixels)> = dims
            .row_heights
            .iter()
            .filter(|r| r.custom_height)
            .map(|r| {
                (
                    r.row as usize,
                    domain_types::units::points_to_pixels(domain_types::units::Points(r.height)),
                )
            })
            .collect();
        let custom_col_widths: Vec<(usize, domain_types::units::Pixels)> = dims
            .col_widths
            .iter()
            .filter(|c| c.custom_width)
            .map(|c| {
                (
                    c.col as usize,
                    domain_types::units::char_width_to_pixels(
                        domain_types::units::CharWidth(c.width),
                        mdw,
                    ),
                )
            })
            .collect();

        let hidden_rows: Vec<usize> = dims
            .row_heights
            .iter()
            .filter(|r| r.hidden)
            .map(|r| r.row as usize)
            .collect();
        let hidden_cols: Vec<usize> = dims
            .col_widths
            .iter()
            .filter(|c| c.hidden)
            .map(|c| c.col as usize)
            .collect();

        let _gi = grid_indexes.get(&sheet_id);
        let li = LayoutIndex::from_sparse(
            sheet_snap.rows as usize,
            sheet_snap.cols as usize,
            default_row_height_px,
            default_col_width_px,
            custom_row_heights,
            custom_col_widths,
            hidden_rows.into_iter(),
            hidden_cols.into_iter(),
        );
        indexes.insert(sheet_id, li);
    }
    Ok(indexes)
}

/// Build merge spatial indexes for every sheet.
pub(super) fn build_merge_indexes(
    storage: &YrsStorage,
    snapshot: &WorkbookSnapshot,
    grid_indexes: &FxHashMap<SheetId, compute_document::identity::GridIndex>,
) -> Result<FxHashMap<SheetId, RangeSpatialIndex<MergeSpatialItem>>, ComputeError> {
    let mut indexes = FxHashMap::default();
    for sheet_snap in &snapshot.sheets {
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let resolved = match grid_indexes.get(&sheet_id) {
            Some(grid) => merges::get_all_merges(storage.doc(), storage.sheets(), sheet_id, grid),
            None => Vec::new(),
        };
        let items: Vec<MergeSpatialItem> = resolved
            .iter()
            .map(|m| MergeSpatialItem {
                id: m.merge.top_left_id.clone(),
                start_row: m.start_row,
                start_col: m.start_col,
                end_row: m.end_row,
                end_col: m.end_col,
                range_ref: MergeRangeRef {
                    start_row: m.start_row,
                    start_col: m.start_col,
                    end_row: m.end_row,
                    end_col: m.end_col,
                },
            })
            .collect();
        indexes.insert(sheet_id, RangeSpatialIndex::with_items(items));
    }
    Ok(indexes)
}

/// Build `LayoutIndex` for every sheet from dimension data.
pub(super) fn build_layout_indexes(
    storage: &YrsStorage,
    snapshot: &WorkbookSnapshot,
    grid_indexes: &FxHashMap<SheetId, GridIndex>,
) -> Result<FxHashMap<SheetId, LayoutIndex>, ComputeError> {
    let mut indexes = FxHashMap::default();
    for sheet_snap in &snapshot.sheets {
        let sheet_id = SheetId::from_uuid_str(&sheet_snap.id)?;
        let gi = grid_indexes.get(&sheet_id);
        let li =
            build_layout_index_for_sheet(storage, &sheet_id, sheet_snap.rows, sheet_snap.cols, gi);
        indexes.insert(sheet_id, li);
    }
    Ok(indexes)
}

/// Build a `LayoutIndex` for a single sheet.
pub(super) fn build_layout_index_for_sheet(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    rows: u32,
    cols: u32,
    grid_index: Option<&GridIndex>,
) -> LayoutIndex {
    use crate::storage::sheet::properties;

    // Read canonical units (points / char-width) from Yrs metadata
    let meta = properties::get_sheet_meta(storage.doc(), storage.sheets(), sheet_id);
    let default_row_height_pt = meta
        .as_ref()
        .map(|m| domain_types::units::Points(m.default_row_height))
        .unwrap_or(dimensions::DEFAULT_ROW_HEIGHT);
    let default_col_width_cw = meta
        .as_ref()
        .map(|m| domain_types::units::CharWidth(m.default_col_width))
        .unwrap_or(dimensions::DEFAULT_COL_WIDTH);

    // Convert canonical → pixels for the LayoutIndex (rendering concern)
    let mdw = domain_types::units::platform_mdw();
    let default_row_height_px = domain_types::units::points_to_pixels(default_row_height_pt);
    let default_col_width_px = domain_types::units::char_width_to_pixels(default_col_width_cw, mdw);

    // Read custom dimensions (canonical units from Yrs) and convert to pixels
    let custom_row_heights: Vec<(usize, domain_types::units::Pixels)> =
        dimensions::get_all_custom_row_heights(
            storage.doc(),
            storage.sheets(),
            sheet_id,
            grid_index,
        )
        .into_iter()
        .map(|(row, pt)| (row, domain_types::units::points_to_pixels(pt)))
        .collect();
    let custom_col_widths: Vec<(usize, domain_types::units::Pixels)> =
        dimensions::get_all_custom_col_widths(
            storage.doc(),
            storage.sheets(),
            sheet_id,
            grid_index,
        )
        .into_iter()
        .map(|(col, cw)| (col, domain_types::units::char_width_to_pixels(cw, mdw)))
        .collect();

    let mut hidden_rows = dimensions::get_hidden_rows(storage.doc(), storage.sheets(), sheet_id);
    hidden_rows.extend(grouping::get_rows_hidden_by_collapsed_groups(
        storage.doc(),
        storage.sheets(),
        sheet_id,
    ));
    hidden_rows.sort_unstable();
    hidden_rows.dedup();

    let mut hidden_cols = dimensions::get_hidden_columns(storage.doc(), storage.sheets(), sheet_id);
    hidden_cols.extend(grouping::get_columns_hidden_by_collapsed_groups(
        storage.doc(),
        storage.sheets(),
        sheet_id,
    ));
    hidden_cols.sort_unstable();
    hidden_cols.dedup();
    LayoutIndex::from_sparse(
        rows as usize,
        cols as usize,
        default_row_height_px,
        default_col_width_px,
        custom_row_heights,
        custom_col_widths,
        hidden_rows.into_iter().map(|r| r as usize),
        hidden_cols.into_iter().map(|c| c as usize),
    )
}

// ---------------------------------------------------------------------------
// Observer + Undo
// ---------------------------------------------------------------------------

/// Create a `DocumentObserver` and `UndoRedoManager` for the given storage,
/// drain stale events, and return them.
pub(super) fn create_observer_and_undo(
    storage: &YrsStorage,
) -> (DocumentObserver, UndoRedoManager) {
    let sheets_map = storage.doc().get_or_insert_map("sheets");
    let workbook_map = storage.doc().get_or_insert_map("workbook");
    let observer = DocumentObserver::new(&sheets_map, &workbook_map);
    let mut undo_manager = UndoRedoManager::new(storage.doc(), &sheets_map);
    // Also track the workbook map so that named ranges, tables, and other
    // workbook-level structures participate in undo/redo.
    undo_manager.expand_scope(&workbook_map);
    let _ = observer.drain_changes();
    (observer, undo_manager)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// Derive locale + theme palette from workbook settings.
pub(super) fn derive_settings(storage: &YrsStorage) -> EngineSettings {
    let culture =
        crate::storage::workbook::settings::get_settings(storage.doc(), storage.workbook_map())
            .culture;
    let locale = compute_formats::get_culture(&culture);
    let theme_palette = load_theme_palette(storage);
    EngineSettings {
        locale,
        theme_palette,
    }
}

/// Load the theme palette from the workbook map in Yrs storage.
///
/// Reads the `"theme"` sub-map from the workbook map, extracts the
/// `"data"` key as a JSON string, deserializes it as `ThemeData`, and
/// builds a slot-name -> hex-color map from the color palette entries.
///
/// Returns an empty map if any step fails (missing key, bad JSON, etc.).
pub(super) fn load_theme_palette(storage: &YrsStorage) -> HashMap<String, String> {
    let doc = storage.doc();
    let txn = doc.transact();
    let workbook = storage.workbook_map();

    let theme_map = match workbook.get(&txn, "theme") {
        Some(Out::YMap(m)) => m,
        _ => return HashMap::new(),
    };

    let json_str = match theme_map.get(&txn, "data") {
        Some(Out::Any(Any::String(s))) => s,
        _ => return HashMap::new(),
    };

    use domain_types::domain::theme::ThemeData;

    let theme_data: ThemeData = match serde_json::from_str(&json_str) {
        Ok(d) => d,
        Err(_) => return HashMap::new(),
    };

    let mut palette = HashMap::new();
    for tc in &theme_data.colors {
        palette.insert(tc.name.clone(), tc.color.clone());
    }
    palette
}

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

/// Build a `SheetSnapshot` from the mirror data for a given sheet.
pub(super) fn build_sheet_snapshot(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    name: &str,
) -> SheetSnapshot {
    let (rows, cols) = stores
        .grid_indexes
        .get(sheet_id)
        .map(|g| (g.row_count(), g.col_count()))
        .unwrap_or((100, 26));

    let mut cells = Vec::new();
    if let Some(sheet) = mirror.get_sheet(sheet_id) {
        for (cell_id, entry) in sheet.cells_iter() {
            if let Some(pos) = mirror.resolve_position(cell_id) {
                let formula = stores.compute.get_formula(cell_id).map(|s| s.to_string());

                // Reconstruct array_ref from the projection registry so that
                // rebuild_compute_core() preserves dynamic array metadata.
                // Without this, projections are not pre-registered on the
                // second full_recalc, causing false #SPILL! errors.
                let array_ref = mirror.projection_registry.get(cell_id).map(|proj| {
                    let end_row = proj.origin_row + proj.rows - 1;
                    let end_col = proj.origin_col + proj.cols - 1;
                    let start = super::export::pos_to_a1(proj.origin_row, proj.origin_col);
                    let end = super::export::pos_to_a1(end_row, end_col);
                    format!("{start}:{end}")
                });

                cells.push(crate::snapshot::CellData {
                    cell_id: cell_id.to_uuid_string(),
                    row: pos.row(),
                    col: pos.col(),
                    value: entry.value.clone(),
                    formula,
                    identity_formula: entry.formula.as_deref().cloned(),
                    array_ref,
                });
            }
        }
    }

    let mut ranges = Vec::new();
    if let Some(sheet) = mirror.get_sheet(sheet_id) {
        for (_, rv) in sheet.iter_ranges() {
            let row_ids: Vec<cell_types::RowId> = {
                let mut pairs: Vec<_> = rv
                    .row_offset_by_id
                    .iter()
                    .map(|(&id, &off)| (off, id))
                    .collect();
                pairs.sort_by_key(|(off, _)| *off);
                pairs.into_iter().map(|(_, id)| id).collect()
            };
            let col_ids: Vec<cell_types::ColId> = {
                let mut pairs: Vec<_> = rv
                    .col_offset_by_id
                    .iter()
                    .map(|(&id, &off)| (off, id))
                    .collect();
                pairs.sort_by_key(|(off, _)| *off);
                pairs.into_iter().map(|(_, id)| id).collect()
            };
            ranges.push(crate::snapshot::RangeData {
                range_id: rv.range_id,
                kind: rv.kind,
                anchor: rv.anchor.clone(),
                encoding: rv.encoding,
                payload: rv.payload.to_vec(),
                row_axis: None,
                col_axis: None,
                row_ids,
                col_ids,
            });
        }
    }

    SheetSnapshot {
        id: sheet_id.to_uuid_string(),
        name: name.to_string(),
        rows,
        cols,
        cells,
        ranges,
    }
}

/// Build a complete `WorkbookSnapshot` from the engine's internal state.
///
/// Reads cell data from the `CellMirror` (via `build_sheet_snapshot`),
/// named ranges from `YrsStorage` (the CRDT source of truth), and
/// tables/pivot tables from the `CellMirror` metadata, and data table regions
/// from the canonical workbook-level Yrs map.
///
/// This MUST be called before replacing `ComputeCore`, since
/// `build_sheet_snapshot` reads formula strings from `ComputeCore`.
pub(super) fn build_workbook_snapshot(
    stores: &EngineStores,
    mirror: &CellMirror,
) -> WorkbookSnapshot {
    use crate::storage::sheet::properties;
    use crate::storage::workbook::named_ranges;

    // 1. Build sheet snapshots
    let sheet_ids = stores.storage.sheet_order();
    let sheet_snapshots: Vec<SheetSnapshot> = sheet_ids
        .iter()
        .filter_map(|sheet_id| {
            let name = properties::get_sheet_name(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
            )?;
            Some(build_sheet_snapshot(stores, mirror, sheet_id, &name))
        })
        .collect();

    // 2. Named ranges from YrsStorage (survives ComputeCore rebuild)
    //
    // Typed formula boundary: canonicalized the Yrs `refers_to` field to a single
    // on-disk format: `serde_json::to_string(&IdentityFormula)`. The prior
    // dual-decoder (try JSON, fall back to raw A1) is deleted; JSON parse
    // failure is now an error rather than a silent wrong-semantics fallback.
    // The hydration path's initial A1 writes are canonicalized by
    // `normalize_named_range_refs` before any reader runs, and both engine
    // write APIs (`set_named_range`, `regenerate_named_range_yrs_refs`) now
    // emit JSON directly.
    let defined_names =
        named_ranges::get_all_named_ranges(stores.storage.doc(), stores.storage.workbook_map());
    let nil_sheet = SheetId::from_raw(0);
    let named_ranges_vec = defined_names_to_named_range_defs(defined_names, |identity| {
        stores
            .compute
            .to_a1_display_qualified(mirror, &nil_sheet, identity)
    });

    // 3. Tables, pivot tables, data table regions from mirror (before rebuild)
    let tables = mirror.all_table_defs().to_vec();
    let pivot_tables = mirror.all_pivot_tables().to_vec();
    let data_table_regions = crate::storage::workbook::data_tables::get_all_data_table_regions(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    );

    // 4. Iterative calc settings
    let iterative_calc = stores.compute.iterative_calc();
    let max_iterations = stores.compute.max_iterations();
    let max_change = stores.compute.max_change();
    // The internal scheduler stores `max_change` as bare f64; the boundary
    // type pins it to `FiniteF64`. Convergence threshold values originate
    // from snapshots that were already finite-typed, so non-finite here
    // would only be possible via direct setter abuse — fall back to the
    // Excel default rather than panicking on extraction.
    let max_change = value_types::FiniteF64::new(max_change)
        .unwrap_or_else(|| value_types::FiniteF64::must(0.001));
    let mut calculation_settings = workbook_settings::get_calculation_settings(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    );
    calculation_settings.enable_iterative_calculation = iterative_calc;
    calculation_settings.max_iterations = max_iterations;
    calculation_settings.max_change = max_change;
    calculation_settings.calc_mode = stores.compute.calc_mode();

    WorkbookSnapshot {
        sheets: sheet_snapshots,
        named_ranges: named_ranges_vec,
        tables,
        pivot_tables,
        data_table_regions,
        iterative_calc,
        max_iterations,
        max_change,
        calculation_settings: Some(calculation_settings),
    }
}

// ---------------------------------------------------------------------------
// Per-sheet snapshot from yrs (for structural undo rebuild)
// ---------------------------------------------------------------------------

/// Build a `SheetSnapshot` for a single sheet by reading directly from yrs.
///
/// Used during structural undo/redo/sync when the in-memory GridIndex and
/// CellMirror are stale. Reads cell positions from the yrs grid index
/// (`idToPos`) and cell data from the yrs cells map. The yrs grid index
/// is never modified by structural operations, so after undo it naturally
/// contains the correct pre-structural positions.
pub(super) fn build_sheet_snapshot_from_yrs(
    storage: &YrsStorage,
    sheet_id: &SheetId,
) -> Option<SheetSnapshot> {
    use crate::storage::infra::grid_helpers;
    use crate::storage::sheet::properties;
    use compute_document::hex::hex_to_id;
    use compute_document::schema::KEY_GRID_INDEX;

    let name = properties::get_sheet_name(storage.doc(), storage.sheets(), sheet_id)?;

    // Derive dimensions from rowOrder/colOrder YArray lengths
    let (rows, cols) = {
        let txn = storage.doc().transact();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
        let sheet_map = match storage.sheets().get(&txn, &sheet_hex) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let r = grid_helpers::get_row_order_array(&sheet_map, &txn)
            .map(|a| a.len(&txn))
            .unwrap_or(100);
        let c = grid_helpers::get_col_order_array(&sheet_map, &txn)
            .map(|a| a.len(&txn))
            .unwrap_or(26);
        (r, c)
    };

    // Walk `gridIndex/posToId` — the CRDT winner map for position ownership.
    // `idToPos` is only an inverse mirror and can contain losing CellIds after
    // concurrent empty-position writes. Hydrating from it would resurrect cells
    // that lost the position LWW race and make peers disagree based on YMap
    // iteration order.
    let mut cells = Vec::new();
    {
        let txn = storage.doc().transact();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
        if let Some(yrs::Out::YMap(sheet_map)) = storage.sheets().get(&txn, &sheet_hex) {
            // Build rowHex -> row_index and colHex -> col_index maps from
            // rowOrder / colOrder arrays.
            let row_index: std::collections::HashMap<String, u32> =
                match grid_helpers::get_row_order_array(&sheet_map, &txn) {
                    Some(arr) => (0..arr.len(&txn))
                        .filter_map(|i| match arr.get(&txn, i) {
                            Some(yrs::Out::Any(yrs::Any::String(s))) => Some((s.to_string(), i)),
                            _ => None,
                        })
                        .collect(),
                    None => std::collections::HashMap::new(),
                };
            let col_index: std::collections::HashMap<String, u32> =
                match grid_helpers::get_col_order_array(&sheet_map, &txn) {
                    Some(arr) => (0..arr.len(&txn))
                        .filter_map(|i| match arr.get(&txn, i) {
                            Some(yrs::Out::Any(yrs::Any::String(s))) => Some((s.to_string(), i)),
                            _ => None,
                        })
                        .collect(),
                    None => std::collections::HashMap::new(),
                };

            if let Some(yrs::Out::YMap(gi_map)) = sheet_map.get(&txn, KEY_GRID_INDEX)
                && let Some(yrs::Out::YMap(pos_to_id)) = gi_map.get(&txn, "posToId")
            {
                for (pos_key, value) in pos_to_id.iter(&txn) {
                    let Some(colon) = pos_key.find(':') else {
                        continue;
                    };
                    if colon == 0 || colon == pos_key.len() - 1 {
                        continue;
                    }
                    // `colon` from find(':') — ASCII ':' is a single UTF-8 byte.
                    #[allow(clippy::string_slice)]
                    let row_hex = &pos_key[..colon];
                    #[allow(clippy::string_slice)] // colon + 1 is a char boundary (ASCII ':').
                    let col_hex = &pos_key[colon + 1..];
                    let Some(&row) = row_index.get(row_hex) else {
                        continue;
                    };
                    let Some(&col) = col_index.get(col_hex) else {
                        continue;
                    };
                    let cell_hex = match value {
                        yrs::Out::Any(yrs::Any::String(s)) => s.to_string(),
                        _ => continue,
                    };
                    let Some(raw) = hex_to_id(&cell_hex) else {
                        continue;
                    };
                    let cid = cell_types::CellId::from_raw(raw);
                    let Some((value, formula, identity_formula, array_ref)) =
                        storage.read_cell_from_yrs_full(sheet_id, &cid)
                    else {
                        // `posToId` also carries marker identities for metadata
                        // such as named-range endpoints, comments, and formats
                        // on empty cells. Those IDs must hydrate into GridIndex,
                        // but they are not physical cells and must not become
                        // Null-valued snapshot cells during a sync rebuild.
                        continue;
                    };
                    cells.push(crate::snapshot::CellData {
                        cell_id: cid.to_uuid_string(),
                        row,
                        col,
                        value,
                        formula,
                        identity_formula,
                        array_ref,
                    });
                }
            }
        }
    }

    // Read Range entries from the Yrs sub-maps
    let ranges = {
        let txn = storage.doc().transact();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
        let mut range_data_vec = Vec::new();
        if let Some(yrs::Out::YMap(sheet_map)) = storage.sheets().get(&txn, &sheet_hex)
            && let Some(yrs::Out::YMap(ranges_map)) =
                sheet_map.get(&txn, compute_document::schema::KEY_RANGES)
            && let Some(yrs::Out::YMap(payloads_map)) =
                sheet_map.get(&txn, compute_document::schema::KEY_RANGE_PAYLOADS)
        {
            for entry in
                compute_document::range::read_ranges_from_yrs(&txn, &ranges_map, &payloads_map)
            {
                range_data_vec.push(crate::snapshot::RangeData {
                    range_id: entry.metadata.range_id,
                    kind: entry.metadata.kind,
                    anchor: entry.metadata.anchor,
                    encoding: entry.metadata.encoding,
                    payload: entry.payload,
                    row_axis: entry.metadata.row_axis,
                    col_axis: entry.metadata.col_axis,
                    row_ids: entry.metadata.row_ids,
                    col_ids: entry.metadata.col_ids,
                });
            }
        }
        range_data_vec
    };

    Some(SheetSnapshot {
        id: sheet_id.to_uuid_string(),
        name,
        rows,
        cols,
        cells,
        ranges,
    })
}

// ---------------------------------------------------------------------------
// Workbook snapshot from Yrs state (for collaboration fork)
// ---------------------------------------------------------------------------

/// Build a complete `WorkbookSnapshot` by reading directly from the Yrs document.
///
/// Used when creating an engine from another engine's Yrs state bytes
/// (`from_yrs_state`). Reads all cell data, named ranges, and metadata
/// from the Yrs maps — no `CellMirror` or `ComputeCore` needed.
pub fn build_workbook_snapshot_from_yrs(
    storage: &YrsStorage,
) -> Result<WorkbookSnapshot, ComputeError> {
    // 1. Build sheet snapshots from Yrs
    let sheet_order = storage.sheet_order();
    let sheet_snapshots: Vec<SheetSnapshot> = sheet_order
        .iter()
        .filter_map(|sheet_id| build_sheet_snapshot_from_yrs(storage, sheet_id))
        .collect();

    // 2. Named ranges from Yrs
    let defined_names = named_ranges::get_all_named_ranges(storage.doc(), storage.workbook_map());
    let yrs_lookup = YrsIdentityFormulaLookup::from_storage(storage);
    let named_ranges_vec = defined_names_to_named_range_defs(defined_names, |identity| {
        compute_parser::to_a1_string_qualified(identity, &yrs_lookup)
    });

    // 3. Tables and Data Table regions from Yrs workbook maps.
    // Tables are stored as JSON strings in the workbook.tables map.
    let tables = read_tables_from_yrs(storage);
    let data_table_regions = crate::storage::workbook::data_tables::get_all_data_table_regions(
        storage.doc(),
        storage.workbook_map(),
    );
    let workbook_settings =
        crate::storage::workbook::settings::get_settings(storage.doc(), storage.workbook_map());
    let calculation_settings = workbook_settings.calculation_settings;
    let calc = calculation_settings.clone().unwrap_or_default();

    Ok(WorkbookSnapshot {
        sheets: sheet_snapshots,
        named_ranges: named_ranges_vec,
        tables,
        pivot_tables: vec![],
        data_table_regions,
        iterative_calc: calc.enable_iterative_calculation,
        max_iterations: calc.max_iterations,
        max_change: calc.max_change,
        calculation_settings,
    })
}

/// Read table definitions from Yrs.
///
/// Primary path: `rangeBindings[table:<name>]` entries (where runtime-created
/// tables are persisted by `persist_table_to_yrs`).
///
/// Fallback: the legacy `workbook.tables` map (used by XLSX imports that
/// haven't migrated to rangeBindings).
///
/// This mirrors the two-tier read in `services::tables::sync_tables_from_yrs`
/// but returns lightweight `TableDef`s for the snapshot rather than full
/// `CanonicalTable`s.
fn read_tables_from_yrs(storage: &YrsStorage) -> Vec<formula_types::TableDef> {
    let doc = storage.doc();
    let txn = doc.transact();
    let workbook = storage.workbook_map();

    let mut tables = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    // Tier 1: rangeBindings (primary path for runtime-created tables).
    let binding_entries = compute_document::range::all_range_bindings_wb(workbook, &txn);
    for (range_id, json) in &binding_entries {
        if let Some(_tname) = super::services::tables::table_name_from_range_id(range_id)
            && let Some(ct) = domain_types::yrs_schema::table::from_binding_json_standalone(json)
            && let Ok(sheet) = SheetId::from_uuid_str(&ct.sheet_id)
        {
            seen_names.insert(ct.name.clone());
            tables.push(formula_types::TableDef {
                name: ct.name,
                sheet,
                start_row: ct.range.start_row(),
                start_col: ct.range.start_col(),
                end_row: ct.range.end_row(),
                end_col: ct.range.end_col(),
                columns: ct.columns.iter().map(|c| c.name.clone()).collect(),
                has_headers: ct.has_header_row,
                has_totals: ct.has_totals_row,
            });
        }
    }

    // Tier 2: legacy workbook.tables map (XLSX-imported tables).
    if let Some(Out::YMap(tables_map)) = workbook.get(&txn, "tables") {
        for (key, value) in tables_map.iter(&txn) {
            if seen_names.contains(key) {
                continue;
            }
            match value {
                Out::Any(Any::String(json_str)) => {
                    if let Ok(table_def) =
                        serde_json::from_str::<formula_types::TableDef>(&json_str)
                    {
                        tables.push(table_def);
                    }
                }
                Out::YMap(inner) => {
                    if let Some(ct) =
                        domain_types::yrs_schema::table::from_yrs_map_to_table(&inner, &txn)
                        && let Ok(sheet) = SheetId::from_uuid_str(&ct.sheet_id)
                    {
                        tables.push(formula_types::TableDef {
                            name: ct.name,
                            sheet,
                            start_row: ct.range.start_row(),
                            start_col: ct.range.start_col(),
                            end_row: ct.range.end_row(),
                            end_col: ct.range.end_col(),
                            columns: ct.columns.iter().map(|c| c.name.clone()).collect(),
                            has_headers: ct.has_header_row,
                            has_totals: ct.has_totals_row,
                        });
                    }
                }
                _ => {}
            }
        }
    }

    tables
}

// ---------------------------------------------------------------------------
// Engine constructors
// ---------------------------------------------------------------------------

/// Create a `YrsComputeEngine` from a workbook snapshot.
///
/// Populates the yrs document, builds ComputeCore, GridIndexes, observer,
/// undo manager, and runs initial recalc.
pub(super) fn from_snapshot(
    snapshot: WorkbookSnapshot,
) -> Result<(YrsComputeEngine, RecalcResult), ComputeError> {
    let storage = {
        let _span = tracing::info_span!("yrs_storage_from_snapshot").entered();
        YrsStorage::from_snapshot(snapshot.clone())?
    };

    let (compute, recalc_result, mirror) = {
        let _span = tracing::info_span!("compute_init_from_snapshot").entered();
        let mut compute = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let recalc_result = compute.init_from_snapshot(&mut mirror, snapshot.clone())?;
        (compute, recalc_result, mirror)
    };

    let engine = assemble_engine(storage, mirror, compute, &snapshot, None)?;

    Ok((engine, recalc_result))
}

/// Create a `YrsComputeEngine` from raw Yrs state bytes.
///
/// Used for collaboration: the first engine pushes its Yrs state to the
/// coordinator, and subsequent engines are created from those bytes.
/// This ensures all engines share the same CellIds and Yrs document
/// history, which is required for CRDT sync to work correctly.
pub(super) fn from_yrs_state(
    state: &[u8],
) -> Result<(YrsComputeEngine, RecalcResult), ComputeError> {
    let storage = YrsStorage::from_yrs_state(state).map_err(|e| ComputeError::Eval {
        message: format!("from_yrs_state: {e}"),
    })?;

    // Guard: reject documents whose schema version is newer than this binary.
    {
        let txn = storage.doc().transact();
        compute_document::schema::guard_schema_version(&txn, storage.workbook_map())?;
    }

    // Use the Doc's unique client_id to partition the ID space.
    // Each collaborative engine gets a non-overlapping region of the u128 space:
    //   IDs = (client_id << 64) | counter
    // This prevents CellId collisions between engines that fork from the same state.
    let client_id = storage.doc().client_id();
    let collab_alloc =
        std::sync::Arc::new(cell_types::IdAllocator::with_client_partition(client_id));

    let snapshot = build_workbook_snapshot_from_yrs(&storage)?;

    let (compute, _initial_recalc_result, mirror) = {
        let mut compute = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let recalc_result = compute.init_from_snapshot(&mut mirror, snapshot.clone())?;
        // Override ComputeCore's allocator AFTER init_from_snapshot (which
        // unconditionally reseeds). Share the SAME Arc as grid_id_alloc to
        // prevent CellId collisions between ghost cells (allocated by
        // ComputeCore during formula resolution) and real cells (allocated
        // by mutation handlers via grid_id_alloc).
        compute.set_id_alloc(std::sync::Arc::clone(&collab_alloc));
        (compute, recalc_result, mirror)
    };

    let mut engine = assemble_engine_with_alloc(
        storage,
        mirror,
        compute,
        &snapshot,
        None,
        collab_alloc.clone(),
        collab_alloc,
    )?;

    // `assemble_engine_with_alloc` normalizes any legacy/import-era raw-A1
    // defined-name refs in Yrs to canonical IdentityFormula JSON. The initial
    // snapshot above was built before that normalization, so replaying an XLSX
    // import whose persisted names were still raw A1 would omit those names
    // from ComputeCore and recalculate dependent formulas to #REF!. Rebuild
    // once from the now-normalized Yrs state so provider replay observes the
    // same named-range semantics as first-load XLSX import.
    let recalc_result = engine.rebuild_compute_core()?;

    Ok((engine, recalc_result))
}

/// Construct a `YrsComputeEngine` from raw XLSX bytes without recalculation.
pub(super) fn from_xlsx_bytes(
    xlsx_data: &[u8],
) -> Result<(YrsComputeEngine, RecalcResult), ComputeError> {
    let (storage, workbook_snap, round_trip_ctx, phantom_cells) =
        parse_and_hydrate_xlsx(xlsx_data)?;

    let (mirror, compute, recalc_result) = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "mirror_compute_rebuild");
        let mut mirror = CellMirror::from_snapshot(workbook_snap.clone())?;
        let mut compute = ComputeCore::new();
        let recalc_result =
            compute.init_from_snapshot_no_recalc(&mut mirror, workbook_snap.clone())?;
        profile.counter("sheets", workbook_snap.sheets.len() as u64);
        profile.counter(
            "snapshot_cells",
            workbook_snap
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        (mirror, compute, recalc_result)
    };

    let mut engine = assemble_engine(
        storage,
        mirror,
        compute,
        &workbook_snap,
        Some(round_trip_ctx),
    )?;

    // Register physical phantom cells (created during hydration for merges and
    // hyperlinks on cells with no data) in the GridIndex so position-based
    // lookups can find them.
    for (sheet_id, cell_id, row, col) in phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(&sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
    }

    Ok((engine, recalc_result))
}

/// Import from raw XLSX bytes into an existing engine, with or without recalc.
///
/// Uses the Range-optimized hydration pipeline: the classifier runs BEFORE
/// Yrs cell writes, so ranged cells are written as compact Range entries
/// instead of individual per-cell entries. This keeps the Yrs document small
/// enough for WASM's 4GB memory ceiling.
pub(super) fn import_from_xlsx_bytes(
    engine: &mut YrsComputeEngine,
    xlsx_data: &[u8],
    do_recalc: bool,
) -> Result<RecalcResult, ComputeError> {
    let (storage, workbook_snap, round_trip_ctx, phantom_cells) =
        parse_and_hydrate_xlsx(xlsx_data)?;
    let result =
        rebuild_engine_from_snapshot(engine, storage, workbook_snap, round_trip_ctx, do_recalc)?;
    for (sheet_id, cell_id, row, col) in phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(&sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
    }
    Ok(result)
}

/// Fast-path XLSX import: parses XLSX, builds snapshot and indexes from
/// parse_output (NO Yrs CRDT hydration). Stores data for deferred hydration.
///
/// This is ~2x faster than `import_from_xlsx_bytes` because it skips the
/// 2-second Yrs hydration step. The engine can display viewport data
/// immediately. Call `complete_deferred_hydration()` after first paint
/// to perform the Yrs write and enable mutations.
pub(super) fn import_from_xlsx_bytes_deferred(
    engine: &mut YrsComputeEngine,
    xlsx_data: &[u8],
) -> Result<RecalcResult, ComputeError> {
    use crate::import;
    use crate::storage::infra::hydration::{DefaultIdAllocator, allocate_sheet_ids};

    // Pass 1: Parse XLSX — only first sheet's cells (ZIP decompress + XML parse).
    // Remaining sheets get metadata only. Full parse happens in complete_deferred_hydration.
    let parsed = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import_deferred", "parse");
        let parsed =
            xlsx_api::parse_max_sheets(xlsx_data, 1).map_err(|e| ComputeError::Deserialize {
                message: format!("XLSX parse error: {}", e),
            })?;
        profile.counter("sheets", parsed.output.sheets.len() as u64);
        profile.counter(
            "cells",
            parsed
                .output
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        parsed
    };
    let parse_output = parsed.output;
    let mut round_trip_ctx = parsed.round_trip_ctx;
    let diagnostics = parsed.diagnostics;
    if !diagnostics.errors.is_empty() {
        tracing::warn!(
            error_count = diagnostics.errors.len(),
            "XLSX import produced parse errors"
        );
    }

    round_trip_ctx.original_named_ranges_order = parse_output.named_ranges.clone();
    round_trip_ctx.skipped_named_ranges = parse_output
        .named_ranges
        .iter()
        .filter(|nr| {
            nr.hidden
                || matches!(
                    compute_parser::ParsedExpr::classify(&nr.refers_to),
                    compute_parser::ParsedExpr::BrokenRef { .. }
                        | compute_parser::ParsedExpr::Empty
                )
        })
        .cloned()
        .collect();

    // Import replaces the current document contents. The non-deferred path
    // rebuilds a fresh storage instance; the deferred path must do the same
    // before writing the critical first-paint hydration, otherwise callers that
    // import into an already-created blank/default engine can observe stale
    // sheet order and stale workbook maps.
    engine.update_buffer.clear();
    engine.stores.storage = YrsStorage::new();

    // Pass 2: Allocate IDs for ALL sheets (fast — only ~4ms for 28 sheets).
    // Cell/Row/Col IDs are only allocated for sheets with cells (first sheet).
    // Non-first sheets only get a SheetId (no cells to allocate).
    let mut allocator = DefaultIdAllocator::new();
    let allocations: Vec<_> = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import_deferred", "id_allocation");
        let allocations: Vec<_> = parse_output
            .sheets
            .iter()
            .map(|sheet| allocate_sheet_ids(sheet, &mut allocator))
            .collect();
        profile.counter("sheets", allocations.len() as u64);
        profile.counter(
            "allocated_cells",
            allocations
                .iter()
                .map(|allocation| allocation.cell_ids.len() as u64)
                .sum::<u64>(),
        );
        allocations
    };

    let id_map = {
        use crate::storage::infra::hydration::HydrationIdMap;
        let mut m = HydrationIdMap::default();
        for alloc in &allocations {
            m.sheet_ids.push(alloc.sheet_id);
            m.cell_ids.push(alloc.cell_ids.clone());
            m.row_ids.push(alloc.row_ids.clone());
            m.col_ids.push(alloc.col_ids.clone());
            for identity in &alloc.identity_only_cells {
                m.identity_only_cells.push((
                    alloc.sheet_id,
                    identity.cell_id,
                    identity.row,
                    identity.col,
                ));
            }
        }
        m
    };

    // Pass 3: Build snapshot for first sheet only + lightweight metadata for all.
    // We need sheet names/IDs for all sheets (for tab strip), but only
    // process cells for the first sheet.
    let workbook_snap = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new(
            "import_deferred",
            "parse_output_to_workbook_snapshot",
        );
        let first_sheet_parse = domain_types::ParseOutput {
            sheets: if parse_output.sheets.is_empty() {
                vec![]
            } else {
                vec![parse_output.sheets[0].clone()]
            },
            named_ranges: parse_output.named_ranges.clone(),
            calculation: parse_output.calculation.clone(),
            ..Default::default()
        };
        let first_id_map = {
            use crate::storage::infra::hydration::HydrationIdMap;
            let mut m = HydrationIdMap::default();
            if let Some(alloc) = allocations.first() {
                m.sheet_ids.push(alloc.sheet_id);
                m.cell_ids.push(alloc.cell_ids.clone());
                m.row_ids.push(alloc.row_ids.clone());
                m.col_ids.push(alloc.col_ids.clone());
                for identity in &alloc.identity_only_cells {
                    m.identity_only_cells.push((
                        alloc.sheet_id,
                        identity.cell_id,
                        identity.row,
                        identity.col,
                    ));
                }
            }
            m
        };
        let mut snap = import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
            &first_sheet_parse,
            Some(&first_id_map),
            &mut allocator,
        );
        // Add empty SheetSnapshot entries for remaining sheets using stable IDs
        // from the allocations (not random STORAGE_ID_ALLOC IDs).
        for (i, sheet_data) in parse_output.sheets.iter().enumerate().skip(1) {
            let sheet_id = allocations[i].sheet_id;
            snap.sheets.push(SheetSnapshot {
                id: compute_document::hex::id_to_hex(sheet_id.as_u128()).to_string(),
                name: sheet_data.name.clone(),
                rows: sheet_data.rows,
                cols: sheet_data.cols,
                cells: vec![],
                ranges: vec![],
            });
        }
        profile.counter("sheets", snap.sheets.len() as u64);
        profile.counter(
            "snapshot_cells",
            snap.sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        profile.counter(
            "ranges",
            snap.sheets
                .iter()
                .map(|sheet| sheet.ranges.len() as u64)
                .sum::<u64>(),
        );
        snap
    };

    // Pass 4: Collect ranged positions for first sheet only
    let mut ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> = Vec::new();
    let mut range_data_per_sheet: Vec<Vec<snapshot_types::RangeData>> = Vec::new();

    {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("import_deferred", "ranged_positions");
        if !parse_output.sheets.is_empty() && !workbook_snap.sheets.is_empty() {
            let snap_sheet = &workbook_snap.sheets[0];
            let snap_positions: std::collections::HashSet<(u32, u32)> =
                snap_sheet.cells.iter().map(|c| (c.row, c.col)).collect();
            let ranged: std::collections::HashSet<(u32, u32)> = parse_output.sheets[0]
                .cells
                .iter()
                .filter(|c| c.formula.is_some() || !c.value.is_null())
                .map(|c| (c.row, c.col))
                .filter(|pos| !snap_positions.contains(pos))
                .collect();
            ranged_positions.push(ranged);
            range_data_per_sheet.push(snap_sheet.ranges.clone());
        }
        profile.counter("sheets", ranged_positions.len() as u64);
        profile.counter(
            "ranged_positions",
            ranged_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
    }

    // Pass 5: Hydrate the critical parse output into Yrs.
    //
    // Deferred import still avoids the expensive full-workbook cell hydration:
    // `parse_output` contains all sheet headers but only the first sheet's
    // cells. Hydrating that data preserves the normal production format read
    // path (`properties::get_effective_format` -> Yrs stylePalette/properties)
    // for first paint, while keeping sheet order/settings coherent for all
    // tabs. A parse-output-backed format side channel would duplicate the
    // cascade contract and drift from the storage path.
    let mut critical_ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut critical_range_data_per_sheet: Vec<Vec<snapshot_types::RangeData>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut critical_range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut critical_range_styles_per_sheet: Vec<
        Vec<crate::storage::infra::hydration::ImportedRangeStyle>,
    > = Vec::with_capacity(parse_output.sheets.len());
    for sheet_idx in 0..parse_output.sheets.len() {
        if sheet_idx == 0 {
            critical_ranged_positions.push(
                ranged_positions
                    .first()
                    .cloned()
                    .unwrap_or_else(std::collections::HashSet::new),
            );
            critical_range_data_per_sheet
                .push(range_data_per_sheet.first().cloned().unwrap_or_default());
        } else {
            critical_ranged_positions.push(std::collections::HashSet::new());
            critical_range_data_per_sheet.push(Vec::new());
        }
        critical_range_style_positions.push(std::collections::HashSet::new());
        critical_range_styles_per_sheet.push(Vec::new());
    }
    let mut critical_allocator = DefaultIdAllocator::new();
    {
        let mut profile = crate::xlsx_profile::PhaseTimer::new(
            "import_deferred",
            "hydrate_from_parse_output_with_ranges",
        );
        let _critical_id_map = engine
            .stores
            .storage
            .hydrate_from_parse_output_with_ranges(
                &parse_output,
                &allocations,
                &critical_ranged_positions,
                &critical_range_style_positions,
                &critical_range_data_per_sheet,
                &critical_range_styles_per_sheet,
                &mut critical_allocator,
            )?;
        engine
            .stores
            .storage
            .hydrate_imported_external_links(&round_trip_ctx)?;
        profile.counter("sheets", parse_output.sheets.len() as u64);
        profile.counter(
            "ranged_positions",
            critical_ranged_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
    }

    // Build CellMirror + viewport-only compute init.
    // Skips formula extraction entirely (deferred to ensure_graph_built).
    {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("import_deferred", "mirror_compute_rebuild");
        engine.stores.compute = ComputeCore::new();
        engine
            .stores
            .compute
            .init_from_snapshot_viewport_only(&mut engine.mirror, workbook_snap.clone())?;
        profile.counter("sheets", workbook_snap.sheets.len() as u64);
        profile.counter(
            "snapshot_cells",
            workbook_snap
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
    }

    // Pass 8: Build indexes from snapshot/parse_output.
    let seed = snapshot_id_high_water_mark(&workbook_snap);
    let shared_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed));
    engine.stores.grid_id_alloc = std::sync::Arc::clone(&shared_alloc);
    engine.stores.compute.set_id_alloc(shared_alloc);
    engine.stores.id_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_client_partition(
        engine.stores.storage.doc().client_id(),
    ));

    // Build indexes for only the first sheet (viewport-visible).
    // Remaining sheets' indexes are built during complete_deferred_hydration.
    let first_n = if workbook_snap.sheets.is_empty() {
        0
    } else {
        1
    };
    engine.stores.grid_indexes = build_grid_indexes_from_allocations_range(
        &workbook_snap,
        &allocations,
        0..first_n,
        engine.stores.grid_id_alloc.clone(),
    )?;
    engine.stores.merge_indexes =
        build_merge_indexes_from_parse_output_range(&parse_output, &workbook_snap, 0..first_n)?;
    engine.stores.layout_indexes = build_layout_indexes_from_parse_output_range(
        &parse_output,
        &workbook_snap,
        &engine.stores.grid_indexes,
        0..first_n,
    )?;

    engine.mirror.install_row_col_indexes(
        engine
            .stores
            .grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
    );
    hydrate_mirror_format_ranges(&engine.stores.storage, &mut engine.mirror);
    engine.mirror.finalize_range_hydration();

    // Pass 9: Observer/undo/settings for the critical Yrs document.
    engine.update_buffer.clear();
    engine._update_subscription =
        super::update_buffer::install_observer(engine.stores.storage.doc(), &engine.update_buffer);
    let (observer, undo_manager) = create_observer_and_undo(&engine.stores.storage);
    engine.mutation.observer = observer;
    engine.mutation.undo_manager = undo_manager;
    engine.settings = derive_settings(&engine.stores.storage);
    engine.viewport.clear();
    engine.round_trip_context = Some(std::sync::Arc::new(round_trip_ctx.clone()));

    // Register phantom cells from first sheet
    for (sheet_id, cell_id, row, col) in &id_map.phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(sheet_id) {
            grid.register_cell(*cell_id, *row, *col);
        }
    }

    // Store data for deferred Yrs hydration. `complete_deferred_hydration`
    // re-parses the workbook and re-allocates cells for all sheets before it
    // commits anything to the live engine.
    engine.deferred_hydration = Some(DeferredHydrationData {
        parse_output,
        allocations,
        workbook_snap,
        round_trip_ctx,
        raw_xlsx_bytes: Some(xlsx_data.to_vec()),
    });

    Ok(RecalcResult::empty())
}

/// Complete the deferred Yrs CRDT hydration.
/// Call after first viewport paint to enable mutations and persistence.
pub(super) fn stage_deferred_hydration(
    engine: &YrsComputeEngine,
) -> Result<Option<DeferredHydrationCompletion>, ComputeError> {
    let Some(data) = engine.deferred_hydration.as_ref() else {
        return Ok(None);
    };

    // Debug breadcrumbs for WASM std::time panic investigation.
    // tracing::info! routes through the configured subscriber → browser console.
    macro_rules! dh_log {
        ($msg:expr) => {
            tracing::info!(target: "deferred_hydration", $msg);
        };
    }

    let completion = {
        // Pass 0: Re-parse XLSX with full options (all sheets' cells).
        // The fast path only parsed the first sheet's cells. Keep the pending
        // guard installed until every fallible full-hydration step has staged
        // successfully; a failed hydrate must remain retryable/protected.
        dh_log!("phase 0: re-parse XLSX");
        let (full_parse_output, mut full_round_trip_ctx) = {
            let mut profile =
                crate::xlsx_profile::PhaseTimer::new("complete_deferred_hydration", "parse");
            let parsed = if let Some(raw_bytes) = &data.raw_xlsx_bytes {
                let parsed = xlsx_api::parse(raw_bytes).map_err(|e| ComputeError::Deserialize {
                    message: format!("XLSX full re-parse error: {}", e),
                })?;
                (parsed.output, parsed.round_trip_ctx)
            } else {
                (data.parse_output.clone(), data.round_trip_ctx.clone())
            };
            profile.counter("sheets", parsed.0.sheets.len() as u64);
            profile.counter(
                "cells",
                parsed
                    .0
                    .sheets
                    .iter()
                    .map(|sheet| sheet.cells.len() as u64)
                    .sum::<u64>(),
            );
            parsed
        };
        full_round_trip_ctx.original_named_ranges_order = full_parse_output.named_ranges.clone();
        full_round_trip_ctx.skipped_named_ranges = full_parse_output
            .named_ranges
            .iter()
            .filter(|nr| {
                nr.hidden
                    || matches!(
                        compute_parser::ParsedExpr::classify(&nr.refers_to),
                        compute_parser::ParsedExpr::BrokenRef { .. }
                            | compute_parser::ParsedExpr::Empty
                    )
            })
            .cloned()
            .collect();

        dh_log!("phase 0 done");

        // Pass 1: Re-allocate IDs for ALL sheets with FIXED SheetIds.
        // The fast path already assigned SheetIds (stored in data.allocations).
        // The allocator sequence preserves first-sheet RowId/ColId/CellId when
        // the full parse returns the same first-sheet cell stream.
        use crate::storage::infra::hydration::allocate_sheet_ids_with_sheet_id;
        let mut allocator = crate::storage::infra::hydration::DefaultIdAllocator::new();
        let allocations: Vec<_> = {
            let mut profile = crate::xlsx_profile::PhaseTimer::new(
                "complete_deferred_hydration",
                "id_allocation",
            );
            let allocations: Vec<_> = full_parse_output
                .sheets
                .iter()
                .enumerate()
                .map(|(i, sheet)| {
                    let fixed_sid = data.allocations.get(i).map(|a| a.sheet_id);
                    allocate_sheet_ids_with_sheet_id(sheet, &mut allocator, fixed_sid)
                })
                .collect();
            profile.counter("sheets", allocations.len() as u64);
            profile.counter(
                "allocated_cells",
                allocations
                    .iter()
                    .map(|allocation| allocation.cell_ids.len() as u64)
                    .sum::<u64>(),
            );
            allocations
        };

        let id_map_full = {
            use crate::storage::infra::hydration::HydrationIdMap;
            let mut m = HydrationIdMap::default();
            for alloc in &allocations {
                m.sheet_ids.push(alloc.sheet_id);
                m.cell_ids.push(alloc.cell_ids.clone());
                m.row_ids.push(alloc.row_ids.clone());
                m.col_ids.push(alloc.col_ids.clone());
                for identity in &alloc.identity_only_cells {
                    m.identity_only_cells.push((
                        alloc.sheet_id,
                        identity.cell_id,
                        identity.row,
                        identity.col,
                    ));
                }
            }
            m
        };

        let full_snap = {
            use crate::import;
            let mut profile = crate::xlsx_profile::PhaseTimer::new(
                "complete_deferred_hydration",
                "parse_output_to_workbook_snapshot",
            );
            let snap = import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
                &full_parse_output,
                Some(&id_map_full),
                &mut allocator,
            );
            profile.counter("sheets", snap.sheets.len() as u64);
            profile.counter(
                "snapshot_cells",
                snap.sheets
                    .iter()
                    .map(|sheet| sheet.cells.len() as u64)
                    .sum::<u64>(),
            );
            profile.counter(
                "ranges",
                snap.sheets
                    .iter()
                    .map(|sheet| sheet.ranges.len() as u64)
                    .sum::<u64>(),
            );
            snap
        };

        let mut ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
            Vec::with_capacity(full_parse_output.sheets.len());
        let mut range_data_per_sheet: Vec<Vec<snapshot_types::RangeData>> =
            Vec::with_capacity(full_parse_output.sheets.len());
        let mut range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
            Vec::with_capacity(full_parse_output.sheets.len());
        let mut range_styles_per_sheet: Vec<
            Vec<crate::storage::infra::hydration::ImportedRangeStyle>,
        > = Vec::with_capacity(full_parse_output.sheets.len());
        {
            let mut profile = crate::xlsx_profile::PhaseTimer::new(
                "complete_deferred_hydration",
                "ranged_positions",
            );
            for (sheet_idx, sheet_data) in full_parse_output.sheets.iter().enumerate() {
                let snap_sheet = &full_snap.sheets[sheet_idx];
                let snap_positions: std::collections::HashSet<(u32, u32)> =
                    snap_sheet.cells.iter().map(|c| (c.row, c.col)).collect();
                let ranged: std::collections::HashSet<(u32, u32)> = sheet_data
                    .cells
                    .iter()
                    .filter(|c| c.formula.is_some() || !c.value.is_null())
                    .map(|c| (c.row, c.col))
                    .filter(|pos| !snap_positions.contains(pos))
                    .collect();
                ranged_positions.push(ranged);
                range_data_per_sheet.push(snap_sheet.ranges.clone());
                range_style_positions.push(std::collections::HashSet::new());
                range_styles_per_sheet.push(Vec::new());
            }
            profile.counter("sheets", ranged_positions.len() as u64);
            profile.counter(
                "ranged_positions",
                ranged_positions
                    .iter()
                    .map(|positions| positions.len() as u64)
                    .sum::<u64>(),
            );
        }

        dh_log!("phase 1 done: IDs allocated, snapshot built");

        dh_log!("phase 2a: YrsStorage::new()");
        let mut new_storage = YrsStorage::new();
        dh_log!("phase 2b: hydrate_from_parse_output_with_ranges start");
        let id_map = {
            let mut profile = crate::xlsx_profile::PhaseTimer::new(
                "complete_deferred_hydration",
                "hydrate_from_parse_output_with_ranges",
            );
            let id_map = new_storage.hydrate_from_parse_output_with_ranges(
                &full_parse_output,
                &allocations,
                &ranged_positions,
                &range_style_positions,
                &range_data_per_sheet,
                &range_styles_per_sheet,
                &mut allocator,
            )?;
            new_storage.hydrate_imported_external_links(&full_round_trip_ctx)?;
            profile.counter("sheets", full_parse_output.sheets.len() as u64);
            profile.counter(
                "ranged_positions",
                ranged_positions
                    .iter()
                    .map(|positions| positions.len() as u64)
                    .sum::<u64>(),
            );
            id_map
        };

        dh_log!("phase 2 done: YrsStorage hydrated");

        let seed = snapshot_id_high_water_mark(&full_snap);
        let shared_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed));
        let grid_indexes =
            build_grid_indexes_from_yrs(&new_storage, &full_snap, shared_alloc.clone())?;
        let merge_indexes = build_merge_indexes(&new_storage, &full_snap, &grid_indexes)?;
        let layout_indexes = build_layout_indexes(&new_storage, &full_snap, &grid_indexes)?;

        dh_log!("phase 3 done: grid/merge/layout indexes built");

        // Rebuild ComputeCore and CellMirror against the staged full snapshot
        // before committing them to the live engine.
        let (new_compute, mut new_mirror) = {
            let mut profile = crate::xlsx_profile::PhaseTimer::new(
                "complete_deferred_hydration",
                "mirror_compute_rebuild",
            );
            let mut new_compute = ComputeCore::new();
            let mut new_mirror = CellMirror::new();
            #[cfg(target_arch = "wasm32")]
            {
                new_compute.init_from_snapshot_minimal(&mut new_mirror, full_snap.clone())?;
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                new_compute.init_from_snapshot_no_recalc(&mut new_mirror, full_snap.clone())?;
            }
            profile.counter("sheets", full_snap.sheets.len() as u64);
            profile.counter(
                "snapshot_cells",
                full_snap
                    .sheets
                    .iter()
                    .map(|sheet| sheet.cells.len() as u64)
                    .sum::<u64>(),
            );
            new_compute.set_id_alloc(shared_alloc.clone());
            (new_compute, new_mirror)
        };

        dh_log!("phase 4 done: ComputeCore init_from_snapshot_minimal");

        new_mirror.install_row_col_indexes(
            grid_indexes
                .iter()
                .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
        );
        hydrate_mirror_format_ranges(&new_storage, &mut new_mirror);
        new_mirror.finalize_range_hydration();

        let settings = derive_settings(&new_storage);
        let calculation = full_parse_output.calculation.clone();
        let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_client_partition(
            new_storage.doc().client_id(),
        ));
        let mut stores = EngineStores {
            storage: new_storage,
            grid_id_alloc: shared_alloc,
            id_alloc,
            grid_indexes,
            layout_indexes,
            merge_indexes,
            compute: new_compute,
            cf_cache: FxHashMap::default(),
            font_db: compute_text_measurement::FontDb::with_defaults(),
            measurement_cache: compute_text_measurement::MeasurementCache::new(),
            custom_table_styles: FxHashMap::default(),
            custom_cell_styles: FxHashMap::default(),
        };
        load_custom_cell_styles(&mut stores);

        DeferredHydrationCompletion {
            stores,
            mirror: new_mirror,
            settings,
            round_trip_ctx: full_round_trip_ctx,
            phantom_cells: id_map.phantom_cells,
            calculation,
        }
    };

    dh_log!("phase 5 done: mirror finalized, settings derived");

    Ok(Some(completion))
}

pub(super) fn commit_deferred_hydration(
    engine: &mut YrsComputeEngine,
    completion: DeferredHydrationCompletion,
) {
    // Commit the fully staged state. From this point onward the live engine is
    // all-sheet materialized and export/graph guards can be cleared.
    engine.update_buffer.clear();
    engine.stores = completion.stores;
    engine._update_subscription =
        super::update_buffer::install_observer(engine.stores.storage.doc(), &engine.update_buffer);
    engine.mirror = completion.mirror;

    let (observer, undo_manager) = create_observer_and_undo(&engine.stores.storage);
    engine.mutation.observer = observer;
    engine.mutation.undo_manager = undo_manager;
    engine.settings = completion.settings;
    engine.viewport.clear();

    engine.init_cf_caches();

    normalize_named_range_refs(engine);
    sync_enable_calculation_flags(engine);
    engine.round_trip_context = Some(std::sync::Arc::new(completion.round_trip_ctx));

    for (sheet_id, cell_id, row, col) in completion.phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(&sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
    }

    engine.deferred_hydration = None;
}

// ---------------------------------------------------------------------------
// Engine assembly from components
// ---------------------------------------------------------------------------

/// Compute the high-water mark for ID allocation from an existing snapshot.
///
/// Scans all sheet IDs and cell IDs to find the maximum `u128` value, so that
/// the runtime [`IdAllocator`] can be seeded past it. Without this, the runtime
/// allocator starts at 1 and produces IDs that collide with XLSX-imported cells,
/// causing `GridIndex::register_cell` to evict existing cells.
fn snapshot_id_high_water_mark(snapshot: &WorkbookSnapshot) -> u64 {
    let mut max_id: u128 = 0;
    for sheet in &snapshot.sheets {
        if let Ok(sid) = cell_types::SheetId::from_uuid_str(&sheet.id) {
            max_id = max_id.max(sid.as_u128());
        }
        for cell in &sheet.cells {
            if let Ok(cid) = cell_types::CellId::from_uuid_str(&cell.cell_id) {
                max_id = max_id.max(cid.as_u128());
            }
        }
    }
    // The allocator's next_u128() returns the counter THEN increments, so we
    // need to seed with max + 1 to avoid reusing the max ID itself.
    // Also add headroom for row/col IDs that were allocated during hydration
    // but aren't stored in the snapshot (they live only in the yrs grid index).
    // A generous margin (+ 100_000) covers workbooks up to ~100K rows/cols of
    // interleaved row/col ID allocations.
    let seed = (max_id as u64).saturating_add(100_000);
    // Ensure seed is at least 1 (IdAllocator expects starting value >= 1).
    seed.max(1)
}

/// Assemble a fully initialized `YrsComputeEngine` from pre-built components.
///
/// Builds indexes, observer, undo manager, settings, and initializes CF caches.
/// Seeds the runtime ID allocator past any IDs already present in the snapshot,
/// preventing collisions with XLSX-imported cell/sheet identities.
pub(super) fn assemble_engine(
    storage: YrsStorage,
    mirror: CellMirror,
    mut compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
    round_trip_context: Option<domain_types::RoundTripContext>,
) -> Result<YrsComputeEngine, ComputeError> {
    let seed = snapshot_id_high_water_mark(snapshot);
    let grid_id_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed));
    // Share the same allocator with ComputeCore to prevent CellId collisions
    // between ghost cells (formula resolution) and real cells (mutation handlers).
    compute.set_id_alloc(std::sync::Arc::clone(&grid_id_alloc));
    let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_client_partition(
        storage.doc().client_id(),
    ));
    assemble_engine_inner(
        storage,
        mirror,
        compute,
        snapshot,
        round_trip_context,
        grid_id_alloc,
        id_alloc,
    )
}

/// Like `assemble_engine` but with custom ID allocators (for collaborative mode).
pub(super) fn assemble_engine_with_alloc(
    storage: YrsStorage,
    mirror: CellMirror,
    compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
    round_trip_context: Option<domain_types::RoundTripContext>,
    grid_id_alloc: std::sync::Arc<cell_types::IdAllocator>,
    id_alloc: std::sync::Arc<cell_types::IdAllocator>,
) -> Result<YrsComputeEngine, ComputeError> {
    assemble_engine_inner(
        storage,
        mirror,
        compute,
        snapshot,
        round_trip_context,
        grid_id_alloc,
        id_alloc,
    )
}

pub(super) fn hydrate_mirror_format_ranges(storage: &YrsStorage, mirror: &mut CellMirror) {
    let sheet_ids: Vec<_> = mirror.sheet_ids().copied().collect();
    for sheet_id in sheet_ids {
        if let Some(sheet_mirror) = mirror.get_sheet_mut(&sheet_id) {
            crate::storage::properties::hydrate_format_ranges(storage, &sheet_id, sheet_mirror);
        }
    }
}

fn assemble_engine_inner(
    storage: YrsStorage,
    mut mirror: CellMirror,
    compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
    round_trip_context: Option<domain_types::RoundTripContext>,
    grid_id_alloc: std::sync::Arc<cell_types::IdAllocator>,
    id_alloc: std::sync::Arc<cell_types::IdAllocator>,
) -> Result<YrsComputeEngine, ComputeError> {
    let grid_indexes = build_grid_indexes_from_yrs(&storage, snapshot, grid_id_alloc.clone())?;
    let merge_indexes = build_merge_indexes(&storage, snapshot, &grid_indexes)?;
    let layout_indexes = build_layout_indexes(&storage, snapshot, &grid_indexes)?;

    // unified reference model — seed the mirror's `RowId → (SheetId, row)` /
    // `ColId → (SheetId, col)` reverse index from the grid indexes so
    // `MirrorPositionLookup::row_index` / `col_index` can answer display
    // queries for full-row/full-col refs. Mutations that change row/col
    // identities re-seed via the same `install_row_col_indexes` entry point.
    mirror.install_row_col_indexes(
        grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
    );
    hydrate_mirror_format_ranges(&storage, &mut mirror);
    mirror.finalize_range_hydration();

    let (observer, undo_manager) = create_observer_and_undo(&storage);
    let settings = derive_settings(&storage);

    // Seed `SecurityState` from the current doc before returning —
    // R2.3 "seed on load" invariant. `SecurityState::new` reads the
    // security map and flips `active` to match the snapshot; a
    // freshly-loaded snapshot containing policies is active from the
    // first call, without waiting for the observer to fire on a
    // transition that never happens.
    //
    // The `SecurityEventBuffer` is allocated here so the engine and
    // `SecurityState` both carry a clone — the observer pushes
    // `PoliciesReloaded` through the `SecurityState` clone, while
    // `security_ops` emits per-CRUD events through the engine clone.
    // Both write into the same ring buffer (R2.3 step 5).
    let security_events =
        std::sync::Arc::new(super::security_events::SecurityEventBuffer::default());
    let security = crate::storage::security_state::SecurityState::with_event_buffer(
        storage.doc(),
        std::sync::Arc::clone(&security_events),
    );

    // Install the update_v1 observer for Provider-protocol fan-out.
    // The subscription handle's lifetime is tied to the engine via the
    // `_update_subscription` field so the observer stays attached for
    // the engine's lifetime (plan §3.1: "engine-side observer stays
    // installed for the doc's lifetime").
    let update_buffer = std::sync::Arc::new(super::update_buffer::UpdateBuffer::default());
    let update_subscription = super::update_buffer::install_observer(storage.doc(), &update_buffer);

    let mut engine = YrsComputeEngine {
        mirror,
        stores: EngineStores {
            storage,
            grid_id_alloc,
            id_alloc,
            grid_indexes,
            layout_indexes,
            merge_indexes,
            compute,
            cf_cache: FxHashMap::default(),
            font_db: compute_text_measurement::FontDb::with_defaults(),
            measurement_cache: compute_text_measurement::MeasurementCache::new(),
            custom_table_styles: FxHashMap::default(),
            custom_cell_styles: FxHashMap::default(),
        },
        mutation: MutationCoordinator {
            observer,
            undo_manager,
            pending_recalc: None,
            pending_format_patches: None,
            sheet_lifecycle_history: Default::default(),
        },
        viewport: ViewportService::new(),
        settings,
        round_trip_context: round_trip_context.map(std::sync::Arc::new),
        security,
        security_events,
        update_buffer,
        _update_subscription: update_subscription,
        scenario_session: crate::what_if::scenarios::ScenarioSessionState::default(),
        deferred_hydration: None,
    };

    load_custom_cell_styles(&mut engine.stores);
    engine.init_cf_caches();
    normalize_named_range_refs(&mut engine);
    sync_enable_calculation_flags(&mut engine);

    Ok(engine)
}

/// Sync per-sheet `enable_calculation` flags from the Yrs document into the
/// `CellMirror`'s `SheetMirror` structs. This ensures the scheduler respects
/// the persisted flags after engine construction (from snapshot or Yrs state).
fn sync_enable_calculation_flags(engine: &mut YrsComputeEngine) {
    use crate::storage::sheet::visibility;
    let sheet_ids = engine.stores.storage.sheet_order();
    for sheet_id in &sheet_ids {
        let enabled = visibility::is_sheet_calculation_enabled(
            engine.stores.storage.doc(),
            engine.stores.storage.sheets(),
            sheet_id,
        );
        engine.mirror.set_enable_calculation(sheet_id, enabled);
    }
}

// ---------------------------------------------------------------------------
// Custom cell style loading
// ---------------------------------------------------------------------------

/// Load custom cell styles from the Yrs `KEY_CUSTOM_CELL_STYLES` workbook map
/// into the in-memory `EngineStores::custom_cell_styles` FxHashMap.
///
/// Each entry in the Y.Map is a JSON-serialized `CellStyleDef`. Entries that
/// fail to deserialize are silently skipped (defensive — forward-compat).
fn load_custom_cell_styles(stores: &mut EngineStores) {
    use compute_document::schema::KEY_CUSTOM_CELL_STYLES;
    use domain_types::domain::cell_style::CellStyleDef;

    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let styles_map = match workbook.get(&txn, KEY_CUSTOM_CELL_STYLES) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    for (key, value) in styles_map.iter(&txn) {
        let json_str = match value {
            Out::Any(Any::String(s)) => s,
            _ => continue,
        };
        match serde_json::from_str::<CellStyleDef>(&json_str) {
            Ok(style) => {
                stores.custom_cell_styles.insert(key.to_string(), style);
            }
            Err(_) => continue,
        }
    }
}

// ---------------------------------------------------------------------------
// Named range normalization
// ---------------------------------------------------------------------------

/// Normalize all named-range `refers_to` values in Yrs to canonical
/// IdentityFormula JSON.
///
/// XLSX import stores `refers_to` as a plain A1 string (e.g.
/// `"Sheet1!$A$1:$D$100"`), while the API path stores it as a
/// JSON-serialized `IdentityFormula`.  This function converts any non-JSON
/// entries to proper `IdentityFormula` JSON so that every reader of Yrs
/// sees a single canonical format — no fallback parsing needed.
///
/// Must be called after the `CellMirror` and `ComputeCore` are initialized
/// (they provide the `IdentityResolver` used by the formula parser).
///
/// This permanently mutates Yrs — subsequent reads (including after
/// `rebuild_compute_core()`) see the normalized format.
fn normalize_named_range_refs(engine: &mut YrsComputeEngine) {
    let all = named_ranges::get_all_named_ranges(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
    );

    let to_normalize: Vec<_> = all
        .into_iter()
        .filter(|dn| serde_json::from_str::<formula_types::IdentityFormula>(&dn.refers_to).is_err())
        .collect();

    if to_normalize.is_empty() {
        return;
    }

    // Pick first sheet as context for workbook-scoped names.
    let first_sheet = engine.mirror.sheet_ids().next().copied();

    // RAII guard: observer is restored even if we panic mid-loop.
    let _guard = engine.mutation.suppress_guard();

    for dn in to_normalize {
        if dn.raw_refers_to.is_some() {
            continue;
        }

        // Determine context sheet: use the name's scope if sheet-scoped,
        // otherwise fall back to the first sheet.
        let context_sheet = dn
            .scope
            .as_deref()
            .and_then(hex_to_id)
            .map(SheetId::from_raw)
            .or(first_sheet);

        let context_sheet = match context_sheet {
            Some(s) => s,
            None => continue, // No sheets at all — nothing to resolve against.
        };

        // Ensure formula has '=' prefix for the parser.
        let a1 = if dn.refers_to.starts_with('=') {
            dn.refers_to.clone()
        } else {
            format!("={}", dn.refers_to)
        };

        let identity = match engine.stores.compute.to_identity_formula_with_rect_ranges(
            &mut engine.mirror,
            &context_sheet,
            &a1,
        ) {
            Ok(id) => id,
            Err(_) => {
                // Non-parseable formula (constants, #REF!, array literals, etc.).
                // Wrap as a template-only IdentityFormula with no cell refs.
                // Use the raw refers_to (without '=' prefix) as the template,
                // matching the convention that template holds the formula body.
                let template = dn
                    .refers_to
                    .strip_prefix('=')
                    .unwrap_or(&dn.refers_to)
                    .to_string();
                formula_types::IdentityFormula {
                    template,
                    refs: vec![],
                    is_dynamic_array: false,
                    is_volatile: false,
                    // Non-parseable fallback (constants, #REF!, array
                    // literals). Aggregate detection requires an AST; with
                    // no parse, the conservative default is false.
                    is_aggregate: false,
                }
            }
        };

        let raw_refers_to =
            if normalized_defined_name_text_lost_opaque_ref(&dn.refers_to, &identity) {
                Some(dn.refers_to.clone())
            } else {
                dn.raw_refers_to.clone()
            };

        let json = match serde_json::to_string(&identity) {
            Ok(j) => j,
            Err(e) => {
                tracing::warn!(
                    name = %dn.name,
                    error = %e,
                    "Failed to serialize normalized IdentityFormula, skipping"
                );
                continue;
            }
        };
        let updated = named_ranges::DefinedName {
            refers_to: json,
            raw_refers_to,
            ..dn
        };
        named_ranges::upsert_named_range(
            engine.stores.storage.doc(),
            engine.stores.storage.workbook_map(),
            &updated,
        );
    }
}

fn normalized_defined_name_text_lost_opaque_ref(
    original_refers_to: &str,
    identity: &formula_types::IdentityFormula,
) -> bool {
    let original_template = original_refers_to
        .strip_prefix('=')
        .unwrap_or(original_refers_to);
    identity.refs.is_empty() && identity.template != original_template
}

// ---------------------------------------------------------------------------
// XLSX import helpers
// ---------------------------------------------------------------------------

/// Parse XLSX bytes and hydrate a new `YrsStorage` from the parse output.
///
/// **Range-before-Yrs pipeline**: IDs are allocated first, the Range
/// classifier runs before Yrs writes, and ranged cells are skipped during
/// per-cell Yrs hydration. This reduces Yrs writes from O(cells) to
/// O(non-ranged cells + ranges).
///
/// Returns `(storage, workbook_snapshot, round_trip_context, phantom_cells)`.
pub(super) fn parse_and_hydrate_xlsx(xlsx_data: &[u8]) -> Result<XlsxHydrateResult, ComputeError> {
    use crate::import;
    use crate::storage::infra::hydration::{DefaultIdAllocator, allocate_sheet_ids};

    let parsed = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "parse");
        let parsed = xlsx_api::parse(xlsx_data).map_err(|e| ComputeError::Deserialize {
            message: format!("XLSX parse error: {}", e),
        })?;
        profile.counter("sheets", parsed.output.sheets.len() as u64);
        profile.counter(
            "cells",
            parsed
                .output
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        parsed
    };
    let parse_output = parsed.output;
    let mut round_trip_ctx = parsed.round_trip_ctx;
    let diagnostics = parsed.diagnostics;
    if !diagnostics.errors.is_empty() {
        tracing::warn!(
            error_count = diagnostics.errors.len(),
            "XLSX import produced parse errors"
        );
    }
    if !diagnostics.force_recalc_cells.is_empty() {
        tracing::info!(
            count = diagnostics.force_recalc_cells.len(),
            "XLSX import: cells requiring forced recalc"
        );
    }

    round_trip_ctx.original_named_ranges_order = parse_output.named_ranges.clone();
    round_trip_ctx.skipped_named_ranges = parse_output
        .named_ranges
        .iter()
        .filter(|nr| {
            nr.hidden
                || matches!(
                    compute_parser::ParsedExpr::classify(&nr.refers_to),
                    compute_parser::ParsedExpr::BrokenRef { .. }
                        | compute_parser::ParsedExpr::Empty
                )
        })
        .cloned()
        .collect();

    // ── Pass 1: Allocate IDs (no Yrs writes) ──────────────────────────
    let mut allocator = DefaultIdAllocator::new();
    let allocations: Vec<_> = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "id_allocation");
        let allocations: Vec<_> = parse_output
            .sheets
            .iter()
            .map(|sheet| allocate_sheet_ids(sheet, &mut allocator))
            .collect();
        profile.counter("sheets", allocations.len() as u64);
        profile.counter(
            "allocated_cells",
            allocations
                .iter()
                .map(|allocation| allocation.cell_ids.len() as u64)
                .sum::<u64>(),
        );
        allocations
    };

    // Build HydrationIdMap from pre-allocations so the snapshot builder
    // can use the same IDs.
    let id_map = {
        use crate::storage::infra::hydration::HydrationIdMap;
        let mut m = HydrationIdMap::default();
        for alloc in &allocations {
            m.sheet_ids.push(alloc.sheet_id);
            m.cell_ids.push(alloc.cell_ids.clone());
            m.row_ids.push(alloc.row_ids.clone());
            m.col_ids.push(alloc.col_ids.clone());
            for identity in &alloc.identity_only_cells {
                m.identity_only_cells.push((
                    alloc.sheet_id,
                    identity.cell_id,
                    identity.row,
                    identity.col,
                ));
            }
        }
        m
    };

    // ── Pass 2: Build snapshot + run classifier ───────────────────────
    let workbook_snap = {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("import", "parse_output_to_workbook_snapshot");
        let snap = import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
            &parse_output,
            Some(&id_map),
            &mut allocator,
        );
        profile.counter("sheets", snap.sheets.len() as u64);
        profile.counter(
            "snapshot_cells",
            snap.sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        profile.counter(
            "ranges",
            snap.sheets
                .iter()
                .map(|sheet| sheet.ranges.len() as u64)
                .sum::<u64>(),
        );
        snap
    };
    // ── Pass 3: Collect ranged positions per sheet ────────────────────
    // After the classifier runs, `workbook_snap.sheets[i].ranges` contains
    // the promoted RangeData entries. We need to identify which (row, col)
    // positions were ranged so we can skip them during Yrs cell writes.
    //
    // Only non-empty cells can be ranged (the classifier ignores Null cells).
    // Empty styled cells are already skipped by hydrate_cells_with_ids, so
    // we exclude them from the diff to keep the HashSet small.
    let mut ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_data_per_sheet: Vec<Vec<snapshot_types::RangeData>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_styles_per_sheet: Vec<Vec<crate::storage::infra::hydration::ImportedRangeStyle>> =
        Vec::with_capacity(parse_output.sheets.len());
    let range_style_formats_enabled = range_style_formats_enabled();

    {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "ranged_positions");
        for (sheet_idx, sheet_data) in parse_output.sheets.iter().enumerate() {
            let snap_sheet = &workbook_snap.sheets[sheet_idx];

            let snap_positions: std::collections::HashSet<(u32, u32)> =
                snap_sheet.cells.iter().map(|c| (c.row, c.col)).collect();

            // Only check non-empty cells against the snapshot. Empty cells are
            // skipped by hydrate_cells_with_ids regardless of ranged_positions.
            let ranged: std::collections::HashSet<(u32, u32)> = sheet_data
                .cells
                .iter()
                .filter(|c| c.formula.is_some() || !c.value.is_null())
                .map(|c| (c.row, c.col))
                .filter(|pos| !snap_positions.contains(pos))
                .collect();

            ranged_positions.push(ranged);
            let ranges = snap_sheet.ranges.clone();
            if range_style_formats_enabled {
                let (style_positions, range_styles) = build_imported_range_style_plan(
                    sheet_data,
                    &allocations[sheet_idx],
                    &ranges,
                    &mut allocator,
                );
                range_style_positions.push(style_positions);
                range_styles_per_sheet.push(range_styles);
            } else {
                range_style_positions.push(std::collections::HashSet::new());
                range_styles_per_sheet.push(Vec::new());
            }
            range_data_per_sheet.push(ranges);
        }
        profile.counter("sheets", ranged_positions.len() as u64);
        profile.counter(
            "ranged_positions",
            ranged_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
        let mut ranged_style_id = 0_u64;
        let mut ranged_original_value = 0_u64;
        let mut ranged_original_sst_index = 0_u64;
        let mut ranged_formula_metadata = 0_u64;
        for (sheet_idx, sheet_data) in parse_output.sheets.iter().enumerate() {
            let ranged = &ranged_positions[sheet_idx];
            for cell in &sheet_data.cells {
                if !ranged.contains(&(cell.row, cell.col)) {
                    continue;
                }
                if cell.style_id.is_some() {
                    ranged_style_id += 1;
                }
                if cell.original_value.is_some() {
                    ranged_original_value += 1;
                }
                if cell.original_sst_index.is_some() {
                    ranged_original_sst_index += 1;
                }
                if cell.formula.is_some()
                    || cell.cell_formula.is_some()
                    || cell.formula_result_type.is_some()
                    || cell.has_empty_cached_value
                {
                    ranged_formula_metadata += 1;
                }
            }
        }
        profile.counter("ranged_style_id", ranged_style_id);
        profile.counter("ranged_original_value", ranged_original_value);
        profile.counter("ranged_original_sst_index", ranged_original_sst_index);
        profile.counter("ranged_formula_metadata", ranged_formula_metadata);
        profile.counter(
            "range_style_positions",
            range_style_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
        profile.counter(
            "range_styles",
            range_styles_per_sheet
                .iter()
                .map(|styles| styles.len() as u64)
                .sum::<u64>(),
        );
    }

    // ── Pass 4: Hydrate Yrs (skipping ranged cells) ───────────────────
    let (storage, id_map) = {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("import", "hydrate_from_parse_output_with_ranges");
        let mut storage = YrsStorage::new();
        let id_map = storage.hydrate_from_parse_output_with_ranges(
            &parse_output,
            &allocations,
            &ranged_positions,
            &range_style_positions,
            &range_data_per_sheet,
            &range_styles_per_sheet,
            &mut allocator,
        )?;
        storage.hydrate_imported_external_links(&round_trip_ctx)?;
        profile.counter("sheets", parse_output.sheets.len() as u64);
        profile.counter(
            "ranged_positions",
            ranged_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
        (storage, id_map)
    };

    Ok((storage, workbook_snap, round_trip_ctx, id_map.phantom_cells))
}

/// Rebuild all engine sub-structures from a new storage + workbook snapshot.
///
/// Replaces storage, mirror, compute, indexes, observer, undo, settings.
/// The `init_compute` closure determines whether recalc runs or not:
/// - `init_from_snapshot` for full recalc
/// - `init_from_snapshot_no_recalc` for cached values only
pub(super) fn rebuild_engine_from_snapshot(
    engine: &mut YrsComputeEngine,
    new_storage: YrsStorage,
    workbook_snap: WorkbookSnapshot,
    round_trip_ctx: domain_types::RoundTripContext,
    do_recalc: bool,
) -> Result<RecalcResult, ComputeError> {
    engine.stores.storage = new_storage;
    // The update_v1 observer was installed on the old doc at engine construction
    // time. Replacing storage above discards that doc; reinstall the observer on
    // the new doc so cell edits continue to feed update_buffer (and from there,
    // the IndexedDB provider via drainPendingUpdates).
    engine._update_subscription =
        super::update_buffer::install_observer(engine.stores.storage.doc(), &engine.update_buffer);
    // CellMirror is built inside init_from_snapshot / init_from_snapshot_minimal.
    // Don't build it separately to avoid the double-build overhead.
    engine.round_trip_context = Some(std::sync::Arc::new(round_trip_ctx));

    // Rebuild ComputeCore (also rebuilds CellMirror)
    let recalc_result = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "mirror_compute_rebuild");
        engine.stores.compute = ComputeCore::new();
        let recalc_result = if do_recalc {
            engine
                .stores
                .compute
                .init_from_snapshot(&mut engine.mirror, workbook_snap.clone())?
        } else {
            #[cfg(target_arch = "wasm32")]
            {
                engine
                    .stores
                    .compute
                    .init_from_snapshot_minimal(&mut engine.mirror, workbook_snap.clone())?
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                engine
                    .stores
                    .compute
                    .init_from_snapshot_no_recalc(&mut engine.mirror, workbook_snap.clone())?
            }
        };
        profile.counter("sheets", workbook_snap.sheets.len() as u64);
        profile.counter(
            "snapshot_cells",
            workbook_snap
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        recalc_result
    };

    // Re-seed the ID allocator past any IDs in the new snapshot to avoid
    // collisions between newly allocated IDs and existing XLSX-imported ones.
    // Share a single allocator between grid_id_alloc and ComputeCore to prevent
    // CellId collisions between ghost cells and real cells.
    let seed = snapshot_id_high_water_mark(&workbook_snap);
    let shared_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed));
    engine.stores.grid_id_alloc = std::sync::Arc::clone(&shared_alloc);
    engine.stores.compute.set_id_alloc(shared_alloc);
    engine.stores.id_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_client_partition(
        engine.stores.storage.doc().client_id(),
    ));

    // Rebuild indexes
    engine.stores.grid_indexes = build_grid_indexes_from_yrs(
        &engine.stores.storage,
        &workbook_snap,
        engine.stores.grid_id_alloc.clone(),
    )?;
    engine.stores.merge_indexes = build_merge_indexes(
        &engine.stores.storage,
        &workbook_snap,
        &engine.stores.grid_indexes,
    )?;
    engine.stores.layout_indexes = build_layout_indexes(
        &engine.stores.storage,
        &workbook_snap,
        &engine.stores.grid_indexes,
    )?;

    // unified reference model — re-seed mirror's row/col reverse index after the rebuild.
    engine.mirror.install_row_col_indexes(
        engine
            .stores
            .grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
    );
    hydrate_mirror_format_ranges(&engine.stores.storage, &mut engine.mirror);
    engine.mirror.finalize_range_hydration();

    // Recreate observer + undo, derive settings, clear viewport
    let (observer, undo_manager) = create_observer_and_undo(&engine.stores.storage);
    engine.mutation.observer = observer;
    engine.mutation.undo_manager = undo_manager;
    engine.settings = derive_settings(&engine.stores.storage);
    engine.viewport.clear();

    // Pre-populate CF caches
    engine.init_cf_caches();

    // Normalize named-range refs so Yrs has a single canonical format.
    normalize_named_range_refs(engine);

    Ok(recalc_result)
}

// ---------------------------------------------------------------------------
// Import specific sheets from XLSX
// ---------------------------------------------------------------------------

/// Import specific sheets from an XLSX byte buffer into an existing engine.
///
/// Parses the XLSX, filters by `sheet_names` (case-insensitive), merges the
/// style palette, hydrates each matched sheet into the Yrs document, syncs
/// all stores, and optionally inserts them at `insert_position`.
pub(super) fn import_sheets_from_xlsx(
    engine: &mut YrsComputeEngine,
    xlsx_data: &[u8],
    sheet_names: &[String],
    insert_position: Option<u32>,
) -> Result<Vec<String>, ComputeError> {
    use crate::storage::infra::hydration::{
        self, DefaultIdAllocator, merge_style_palette_incremental, remap_sheet_style_ids,
    };
    use crate::storage::sheet::{order, properties};

    // 1. Parse the XLSX
    let parsed = xlsx_api::parse(xlsx_data).map_err(|e| ComputeError::Deserialize {
        message: format!("XLSX parse error: {}", e),
    })?;
    let parse_output = parsed.output;

    // 2. Filter sheets by name (case-insensitive)
    let wanted: std::collections::HashSet<String> =
        sheet_names.iter().map(|n| n.to_lowercase()).collect();
    let matched_sheets: Vec<(usize, &domain_types::SheetData)> = parse_output
        .sheets
        .iter()
        .enumerate()
        .filter(|(_, s)| wanted.contains(&s.name.to_lowercase()))
        .collect();

    if matched_sheets.is_empty() {
        return Err(ComputeError::Eval {
            message: format!(
                "import_sheets_from_xlsx: none of the requested sheets {:?} found in XLSX",
                sheet_names
            ),
        });
    }

    // 3. Seed a new allocator past the engine's current high-water mark
    //    so that new IDs don't collide with existing ones.
    let seed = engine.stores.grid_id_alloc.high_water_mark();
    let mut allocator = DefaultIdAllocator::with_seed(seed);

    // 4. Merge style palette + hydrate sheets inside a transaction
    //    Collect the results we need for index building.
    struct HydratedSheet {
        sheet_id: SheetId,
        cell_ids: Vec<CellId>,
        phantom_cells: Vec<(CellId, u32, u32)>,
        name: String,
        rows: u32,
        cols: u32,
        /// Cells for building the ComputeCore snapshot
        cells_data: Vec<domain_types::CellData>,
    }

    // Gather existing sheet names BEFORE opening the write transaction,
    // because get_sheet_name / sheet_order open their own read transactions
    // and Yrs does not allow nested txn on the same Doc.
    let existing_order = engine.stores.storage.sheet_order();
    let existing_names: std::collections::HashSet<String> = existing_order
        .iter()
        .filter_map(|sid| {
            properties::get_sheet_name(
                engine.stores.storage.doc(),
                engine.stores.storage.sheets(),
                sid,
            )
            .map(|n| n.to_lowercase())
        })
        .collect();

    let hydrated_sheets: Vec<HydratedSheet> = {
        let mut txn = engine.stores.storage.doc().transact_mut();
        let workbook = engine.stores.storage.workbook_map().clone();
        let sheets_map = engine.stores.storage.sheets().clone();
        // lazy-create — see `YrsStorage::new` doc.
        let order_arr = engine.stores.storage.ensure_sheet_order_array(&mut txn);

        // 4a. Merge style palettes
        let style_remap =
            merge_style_palette_incremental(&mut txn, &workbook, &parse_output.style_palette);

        // 4b. Resolve unique sheet names, hydrate each sheet
        let mut used_names = existing_names;
        let mut results = Vec::with_capacity(matched_sheets.len());

        for (_src_idx, sheet_data) in &matched_sheets {
            // Clone and remap style IDs
            let mut sheet = (*sheet_data).clone();
            remap_sheet_style_ids(&mut sheet, &style_remap);

            // Deduplicate name
            let base_name = &sheet.name;
            let unique_name = if used_names.contains(&base_name.to_lowercase()) {
                let mut n = 2u32;
                loop {
                    let candidate = format!("{} ({})", base_name, n);
                    if !used_names.contains(&candidate.to_lowercase()) {
                        break candidate;
                    }
                    n += 1;
                }
            } else {
                base_name.clone()
            };
            used_names.insert(unique_name.to_lowercase());
            sheet.name = unique_name;

            let cells_data = sheet.cells.clone();

            // Hydrate into Yrs
            let (sheet_id, cell_ids, phantom_cells, _identity_only_cells, _row_ids, _col_ids) =
                hydration::hydrate_sheet(
                    &mut txn,
                    &sheets_map,
                    &order_arr,
                    &sheet,
                    &parse_output.style_palette,
                    &parse_output.persons,
                    &mut allocator,
                )?;

            results.push(HydratedSheet {
                sheet_id,
                cell_ids,
                phantom_cells,
                name: sheet.name.clone(),
                rows: sheet.rows,
                cols: sheet.cols,
                cells_data,
            });
        }

        results
    }; // txn drops here, committing all Yrs changes

    // 5. Sync indexes and ComputeCore for each hydrated sheet
    for hs in &hydrated_sheets {
        // 5a. GridIndex (reads row/col order arrays from committed Yrs data)
        let snap_for_grid = crate::snapshot::SheetSnapshot {
            id: hs.sheet_id.to_uuid_string(),
            name: hs.name.clone(),
            rows: hs.rows,
            cols: hs.cols,
            cells: vec![],
            ranges: vec![],
        };
        let mut grid = super::build_grid_from_yrs_for_sheet(
            &engine.stores.storage,
            hs.sheet_id,
            &snap_for_grid,
            engine.stores.grid_id_alloc.clone(),
        );

        // Register all cell positions in the grid.
        // cell_ids from hydrate_sheet are in the same order as SheetData.cells.
        for (idx, cell_id) in hs.cell_ids.iter().enumerate() {
            if idx < hs.cells_data.len() {
                let cd = &hs.cells_data[idx];
                grid.register_cell(*cell_id, cd.row, cd.col);
            }
        }
        // Register phantom cells
        for (cell_id, row, col) in &hs.phantom_cells {
            grid.register_cell(*cell_id, *row, *col);
        }
        engine.stores.grid_indexes.insert(hs.sheet_id, grid);

        // 5b. MergeIndex
        let resolved = match engine.stores.grid_indexes.get(&hs.sheet_id) {
            Some(grid) => merges::get_all_merges(
                engine.stores.storage.doc(),
                engine.stores.storage.sheets(),
                hs.sheet_id,
                grid,
            ),
            None => Vec::new(),
        };
        let items: Vec<MergeSpatialItem> = resolved
            .iter()
            .map(|m| MergeSpatialItem {
                id: m.merge.top_left_id.clone(),
                start_row: m.start_row,
                start_col: m.start_col,
                end_row: m.end_row,
                end_col: m.end_col,
                range_ref: MergeRangeRef {
                    start_row: m.start_row,
                    start_col: m.start_col,
                    end_row: m.end_row,
                    end_col: m.end_col,
                },
            })
            .collect();
        engine
            .stores
            .merge_indexes
            .insert(hs.sheet_id, RangeSpatialIndex::with_items(items));

        // 5c. LayoutIndex
        let layout = build_layout_index_for_sheet(
            &engine.stores.storage,
            &hs.sheet_id,
            hs.rows,
            hs.cols,
            engine.stores.grid_indexes.get(&hs.sheet_id),
        );
        engine.stores.layout_indexes.insert(hs.sheet_id, layout);

        // 5d. ComputeCore — build SheetSnapshot and add
        let snap_cells: Vec<crate::snapshot::CellData> = hs
            .cells_data
            .iter()
            .enumerate()
            .filter_map(|(cell_idx, cell)| {
                // Skip only parser-proven dynamic array spill targets.
                if cell.projection_role == ImportedCellProjectionRole::DynamicArraySpillTarget {
                    return None;
                }
                if cell_idx >= hs.cell_ids.len() {
                    return None;
                }
                let cell_uuid = format!("{:032x}", hs.cell_ids[cell_idx].as_u128());
                Some(crate::snapshot::CellData {
                    cell_id: cell_uuid,
                    row: cell.row,
                    col: cell.col,
                    value: cell.value.clone(),
                    formula: cell.formula.clone(),
                    identity_formula: None,
                    array_ref: cell.array_ref.clone(),
                })
            })
            .collect();

        let sheet_snap = crate::snapshot::SheetSnapshot {
            id: hs.sheet_id.to_uuid_string(),
            name: hs.name.clone(),
            rows: hs.rows,
            cols: hs.cols,
            cells: snap_cells,
            ranges: vec![],
        };
        engine
            .stores
            .compute
            .add_sheet(&mut engine.mirror, sheet_snap)?;
    }

    // 6. Reorder sheets to place imported ones at insert_position
    if let Some(pos) = insert_position {
        let order = engine.stores.storage.sheet_order();
        let new_ids: std::collections::HashSet<u128> = hydrated_sheets
            .iter()
            .map(|hs| hs.sheet_id.as_u128())
            .collect();

        // Remove the newly added sheets from wherever they ended up (at the end)
        let mut existing: Vec<SheetId> = order
            .iter()
            .filter(|sid| !new_ids.contains(&sid.as_u128()))
            .copied()
            .collect();
        let new_sheets: Vec<SheetId> = order
            .iter()
            .filter(|sid| new_ids.contains(&sid.as_u128()))
            .copied()
            .collect();

        // Insert at the requested position
        let insert_at = (pos as usize).min(existing.len());
        for (i, sid) in new_sheets.into_iter().enumerate() {
            existing.insert(insert_at + i, sid);
        }

        order::reorder_sheets(
            engine.stores.storage.doc(),
            engine.stores.storage.workbook_map(),
            &existing,
        )?;
    }

    // 7. Refresh CF caches for new sheets
    for hs in &hydrated_sheets {
        engine.refresh_cf_cache(&hs.sheet_id);
    }

    // 8. Return inserted sheet names
    let inserted_names: Vec<String> = hydrated_sheets.iter().map(|hs| hs.name.clone()).collect();
    Ok(inserted_names)
}

// ---------------------------------------------------------------------------
// CSV import helpers
// ---------------------------------------------------------------------------
//
// CSV produces a `ParseOutput` (one sheet, 4-entry style palette, per-cell
// `style_id`) rather than its own intermediate IR. The hydration path is
// the same Range-before-Yrs pipeline as XLSX: allocate IDs →
// `parse_output_to_workbook_snapshot` with range classification →
// `hydrate_from_parse_output_with_ranges` → `rebuild_engine_from_snapshot`.
//
// `RoundTripContext` is empty for CSV — there's no original XLSX to
// round-trip back to. CSV warnings flow through `tracing::warn!` (matching
// the XLSX diagnostics-handling pattern at the top of
// `parse_and_hydrate_xlsx`); they do NOT cross the bridge as TS errors.

/// Parse CSV bytes and hydrate a new `YrsStorage` from the parse output.
///
/// Returns `(storage, workbook_snapshot, round_trip_context, phantom_cells)`.
/// `round_trip_context` is `RoundTripContext::default()` because CSV has
/// no original XLSX to round-trip to.
pub(super) fn parse_and_hydrate_csv(
    csv_data: &[u8],
    options: &csv_parser::CsvImportOptions,
) -> Result<XlsxHydrateResult, ComputeError> {
    use crate::import;
    use crate::storage::infra::hydration::{DefaultIdAllocator, allocate_sheet_ids};

    let t0 = crate::time_compat::WasmSafeInstant::now();
    let parsed = csv_parser::parse_csv_to_parse_output(csv_data, options.clone()).map_err(|e| {
        ComputeError::Deserialize {
            message: format!("CSV parse error: {}", e),
        }
    })?;
    let parse_output = parsed.output;
    eprintln!("[construction] csv parse: {}ms", t0.elapsed().as_millis());

    if !parsed.warnings.is_empty() {
        // Surface CSV warnings via tracing (matches XLSX diagnostics
        // handling). EncodingFallback means chardetng chose a non-UTF-8
        // encoding — this is informational, not a hard error, because
        // chardetng can misdetect valid UTF-8 CSVs (e.g. those with
        // BOM-less ASCII-only content). The file is still loaded with
        // the detected encoding; invalid sequences become U+FFFD.
        tracing::warn!(
            warning_count = parsed.warnings.len(),
            detected_encoding = %parsed.detected_encoding,
            detected_delimiter = %parsed.detected_delimiter,
            "CSV import produced warnings"
        );
        for warning in &parsed.warnings {
            tracing::warn!(?warning, "CSV warning");
        }
    }

    let mut allocator = DefaultIdAllocator::new();
    let allocations: Vec<_> = parse_output
        .sheets
        .iter()
        .map(|sheet| allocate_sheet_ids(sheet, &mut allocator))
        .collect();

    let id_map = {
        use crate::storage::infra::hydration::HydrationIdMap;
        let mut m = HydrationIdMap::default();
        for alloc in &allocations {
            m.sheet_ids.push(alloc.sheet_id);
            m.cell_ids.push(alloc.cell_ids.clone());
            m.row_ids.push(alloc.row_ids.clone());
            m.col_ids.push(alloc.col_ids.clone());
            for identity in &alloc.identity_only_cells {
                m.identity_only_cells.push((
                    alloc.sheet_id,
                    identity.cell_id,
                    identity.row,
                    identity.col,
                ));
            }
        }
        m
    };

    let t1 = crate::time_compat::WasmSafeInstant::now();
    let workbook_snap = import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
        &parse_output,
        Some(&id_map),
        &mut allocator,
    );
    eprintln!(
        "[construction] csv snapshot: {}ms",
        t1.elapsed().as_millis()
    );

    let t2 = crate::time_compat::WasmSafeInstant::now();
    let mut ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_data_per_sheet: Vec<Vec<snapshot_types::RangeData>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_styles_per_sheet: Vec<Vec<crate::storage::infra::hydration::ImportedRangeStyle>> =
        Vec::with_capacity(parse_output.sheets.len());

    for (sheet_idx, sheet_data) in parse_output.sheets.iter().enumerate() {
        let snap_sheet = &workbook_snap.sheets[sheet_idx];
        let snap_positions: std::collections::HashSet<(u32, u32)> =
            snap_sheet.cells.iter().map(|c| (c.row, c.col)).collect();
        let ranged: std::collections::HashSet<(u32, u32)> = sheet_data
            .cells
            .iter()
            .filter(|c| c.formula.is_some() || !c.value.is_null())
            .map(|c| (c.row, c.col))
            .filter(|pos| !snap_positions.contains(pos))
            .collect();

        ranged_positions.push(ranged);
        range_data_per_sheet.push(snap_sheet.ranges.clone());
        range_style_positions.push(std::collections::HashSet::new());
        range_styles_per_sheet.push(Vec::new());
    }

    let (storage, id_map) = {
        let mut storage = YrsStorage::new();
        let id_map = storage.hydrate_from_parse_output_with_ranges(
            &parse_output,
            &allocations,
            &ranged_positions,
            &range_style_positions,
            &range_data_per_sheet,
            &range_styles_per_sheet,
            &mut allocator,
        )?;
        (storage, id_map)
    };
    eprintln!("[construction] csv hydrate: {}ms", t2.elapsed().as_millis());

    Ok((
        storage,
        workbook_snap,
        domain_types::RoundTripContext::default(),
        id_map.phantom_cells,
    ))
}

/// Construct a `YrsComputeEngine` from raw CSV bytes without recalculation.
pub(super) fn from_csv_bytes(
    csv_data: &[u8],
    options: &csv_parser::CsvImportOptions,
) -> Result<(YrsComputeEngine, RecalcResult), ComputeError> {
    let (storage, workbook_snap, round_trip_ctx, phantom_cells) =
        parse_and_hydrate_csv(csv_data, options)?;

    let mut mirror = CellMirror::from_snapshot(workbook_snap.clone())?;
    let mut compute = ComputeCore::new();
    let recalc_result = compute.init_from_snapshot_no_recalc(&mut mirror, workbook_snap.clone())?;

    let mut engine = assemble_engine(
        storage,
        mirror,
        compute,
        &workbook_snap,
        Some(round_trip_ctx),
    )?;

    for (sheet_id, cell_id, row, col) in phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(&sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
    }

    Ok((engine, recalc_result))
}

/// Import from raw CSV bytes into an existing engine, with or without recalc.
pub(super) fn import_from_csv_bytes(
    engine: &mut YrsComputeEngine,
    csv_data: &[u8],
    options: &csv_parser::CsvImportOptions,
    do_recalc: bool,
) -> Result<RecalcResult, ComputeError> {
    let (storage, workbook_snap, round_trip_ctx, phantom_cells) =
        parse_and_hydrate_csv(csv_data, options)?;
    let result =
        rebuild_engine_from_snapshot(engine, storage, workbook_snap, round_trip_ctx, do_recalc)?;
    for (sheet_id, cell_id, row, col) in phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(&sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{build_imported_range_style_plan, normalized_defined_name_text_lost_opaque_ref};
    use crate::storage::infra::hydration::{DefaultIdAllocator, allocate_sheet_ids};
    use cell_types::{PayloadEncoding, RangeAnchor, RangeId, RangeKind};
    use domain_types::{CellData, SheetData};
    use snapshot_types::RangeData;
    use value_types::{CellValue, FiniteF64};

    fn identity_template(template: &str) -> formula_types::IdentityFormula {
        formula_types::IdentityFormula {
            template: template.to_string(),
            refs: Vec::new(),
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }
    }

    #[test]
    fn detects_opaque_defined_name_reference_lost_during_normalization() {
        let identity = identity_template("PRINTLOC");

        assert!(normalized_defined_name_text_lost_opaque_ref(
            "'FX Build'!PRINTLOC",
            &identity
        ));
    }

    #[test]
    fn unchanged_no_ref_defined_name_template_does_not_need_raw_preservation() {
        let identity = identity_template("0.01");

        assert!(!normalized_defined_name_text_lost_opaque_ref(
            "0.01", &identity
        ));
    }

    #[test]
    fn imported_range_style_plan_preserves_sparse_row_holes() {
        let sheet = SheetData {
            name: "Sheet1".to_string(),
            rows: 4,
            cols: 4,
            cells: vec![
                CellData {
                    row: 0,
                    col: 3,
                    value: CellValue::Number(FiniteF64::must(1.0)),
                    style_id: Some(18),
                    ..Default::default()
                },
                CellData {
                    row: 1,
                    col: 3,
                    value: CellValue::Number(FiniteF64::must(2.0)),
                    style_id: Some(18),
                    ..Default::default()
                },
                CellData {
                    row: 3,
                    col: 3,
                    value: CellValue::Number(FiniteF64::must(3.0)),
                    style_id: Some(18),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let mut allocator = DefaultIdAllocator::new();
        let alloc = allocate_sheet_ids(&sheet, &mut allocator);
        let range = RangeData {
            range_id: RangeId::from_raw(123),
            kind: RangeKind::Data,
            anchor: RangeAnchor::Elastic {
                start_row: alloc.row_ids[0],
                end_row: alloc.row_ids[3],
                start_col: alloc.col_ids[3],
                end_col: alloc.col_ids[3],
            },
            encoding: PayloadEncoding::MixedCbor,
            payload: Vec::new(),
            row_axis: None,
            col_axis: None,
            row_ids: vec![alloc.row_ids[0], alloc.row_ids[1], alloc.row_ids[3]],
            col_ids: vec![alloc.col_ids[3]],
        };

        let (_positions, styles) =
            build_imported_range_style_plan(&sheet, &alloc, &[range], &mut allocator);

        let rects: Vec<_> = styles
            .iter()
            .map(|style| {
                (
                    style.start_row,
                    style.start_col,
                    style.end_row,
                    style.end_col,
                    style.style_id,
                )
            })
            .collect();
        assert_eq!(rects, vec![(0, 3, 1, 3, 18), (3, 3, 3, 3, 18)]);
    }
}
