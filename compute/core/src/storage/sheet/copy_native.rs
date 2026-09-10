//! Native cell and compact range ownership when copying a sheet.

use compute_document::identity::AxisIndex;
use std::collections::HashMap;
use std::sync::Arc;

use cell_types::{CellId, ColId, IdAllocator, RangeAnchor, RowId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use formula_types::{IdentityFormula, IdentityFormulaRef};
use rustc_hash::FxHashMap;
use value_types::ComputeError;

use crate::cells::range_view::RangeView;
use crate::cells::{CellStore, SheetStore};
use crate::snapshot::{CellData, SheetSnapshot};

pub(super) struct NativeSheetCopy {
    snapshot: SheetSnapshot,
    formats: crate::storage::properties::CopiedFormats,
    source_id: SheetId,
    destination_id: SheetId,
    source_rows: Arc<AxisIndex<RowId>>,
    source_cols: Arc<AxisIndex<ColId>>,
    rows: Arc<AxisIndex<RowId>>,
    cols: Arc<AxisIndex<ColId>>,
    ranges: Vec<RangeView>,
    pub(super) cell_remap: FxHashMap<CellId, CellId>,
    pub identities: Vec<(CellId, SheetPos)>,
}

impl NativeSheetCopy {
    pub(super) fn new(
        source: &SheetStore,
        cell_store: &CellStore,
        sheet_id: SheetId,
        name: &str,
        allocator: &IdAllocator,
        cell_hex_remap: &mut HashMap<String, String>,
    ) -> Self {
        fn new_axis<Id: cell_types::AxisIdentityId + std::hash::Hash>(
            sheet_id: SheetId,
            len: u32,
            allocator: &IdAllocator,
        ) -> Arc<AxisIndex<Id>> {
            Arc::new(AxisIndex::new(
                sheet_id,
                cell_types::AxisIdentityStore::from_runs([allocator.next_axis_run(len)]),
            ))
        }
        let rows = new_axis(sheet_id, source.row_axis.len(), allocator);
        let cols = new_axis(sheet_id, source.col_axis.len(), allocator);
        let remap_row = |id: RowId| {
            source
                .row_index_of(&id)
                .and_then(|pos| rows.identity_at(sheet_id, pos))
        };
        let remap_col = |id: ColId| {
            source
                .col_index_of(&id)
                .and_then(|pos| cols.identity_at(sheet_id, pos))
        };
        let mut cells = FxHashMap::default();
        for (old_id, row, col) in source.cells() {
            let pos = cell_types::SheetPos::new(row, col);
            let new_id = if old_id.is_virtual() {
                CellId::virtual_at(
                    sheet_id,
                    rows.identity_at(sheet_id, pos.row())
                        .expect("copied row identity"),
                    cols.identity_at(sheet_id, pos.col())
                        .expect("copied column identity"),
                )
            } else {
                allocator.next_cell_id()
            };
            cells.insert(old_id, new_id);
            cell_hex_remap.insert(
                id_to_hex(old_id.as_u128()).to_string(),
                id_to_hex(new_id.as_u128()).to_string(),
            );
        }
        let copied_cells = cell_store
            .iter_sheet_cells(&source.id)
            .filter_map(|(old_id, entry)| {
                let pos = source.position_of(old_id)?;
                let new_id = *cells.get(old_id)?;
                let mut formula = cell_store.get_formula(old_id).cloned();
                if let Some(formula) = &mut formula {
                    remap_formula(formula, source.id, sheet_id, &cells, remap_row, remap_col);
                }
                Some(CellData {
                    cell_id: new_id.to_uuid_string(),
                    row: pos.row(),
                    col: pos.col(),
                    value: entry.value.clone(),
                    formula: None,
                    identity_formula: formula,
                    array_ref: cell_store
                        .projection_registry
                        .get(old_id)
                        .filter(|projection| projection.rows > 0 && projection.cols > 0)
                        .map(|projection| {
                            let start = crate::range_manager::pos_to_a1(
                                projection.origin_row,
                                projection.origin_col,
                            );
                            let end = crate::range_manager::pos_to_a1(
                                projection.origin_row + projection.rows - 1,
                                projection.origin_col + projection.cols - 1,
                            );
                            format!("{start}:{end}")
                        }),
                })
            })
            .collect();
        let ranges = source
            .iter_ranges()
            .map(|(_, range)| {
                let mut copied = range.clone();
                copied.range_id = allocator.next_range_id();
                copied.row_offset_by_id = range.row_offset_by_id.remap_positions(
                    source.id,
                    &source.row_axis,
                    sheet_id,
                    &rows,
                );
                copied.col_offset_by_id = range.col_offset_by_id.remap_positions(
                    source.id,
                    &source.col_axis,
                    sheet_id,
                    &cols,
                );
                copied.anchor = match &range.anchor {
                    RangeAnchor::Elastic {
                        start_row,
                        end_row,
                        start_col,
                        end_col,
                    } if remap_row(*start_row).is_some()
                        && remap_row(*end_row).is_some()
                        && remap_col(*start_col).is_some()
                        && remap_col(*end_col).is_some() =>
                    {
                        RangeAnchor::Elastic {
                            start_row: remap_row(*start_row).unwrap(),
                            end_row: remap_row(*end_row).unwrap(),
                            start_col: remap_col(*start_col).unwrap(),
                            end_col: remap_col(*end_col).unwrap(),
                        }
                    }
                    _ => {
                        if matches!(range.anchor, RangeAnchor::Elastic { .. })
                            && let (Some((first_row, last_row)), Some((first_col, last_col))) = (
                                copied.row_offset_by_id.position_bounds(sheet_id, &rows),
                                copied.col_offset_by_id.position_bounds(sheet_id, &cols),
                            )
                        {
                            RangeAnchor::Elastic {
                                start_row: rows.identity_at(sheet_id, first_row).unwrap(),
                                end_row: rows.identity_at(sheet_id, last_row).unwrap(),
                                start_col: cols.identity_at(sheet_id, first_col).unwrap(),
                                end_col: cols.identity_at(sheet_id, last_col).unwrap(),
                            }
                        } else {
                            let mut range_rows: Vec<_> = copied
                                .row_offset_by_id
                                .keys()
                                .filter_map(|id| {
                                    rows.position_of(sheet_id, id).map(|pos| (pos, id))
                                })
                                .collect();
                            let mut range_cols: Vec<_> = copied
                                .col_offset_by_id
                                .keys()
                                .filter_map(|id| {
                                    cols.position_of(sheet_id, id).map(|pos| (pos, id))
                                })
                                .collect();
                            range_rows.sort_unstable_by_key(|&(pos, _)| pos);
                            range_cols.sort_unstable_by_key(|&(pos, _)| pos);
                            RangeAnchor::Strict {
                                row_ids: range_rows.into_iter().map(|(_, id)| id).collect(),
                                col_ids: range_cols.into_iter().map(|(_, id)| id).collect(),
                            }
                        }
                    }
                };
                copied
            })
            .collect();
        let identities = source
            .cells()
            .map(|(old, row, col)| (cells[&old], cell_types::SheetPos::new(row, col)))
            .collect();
        Self {
            formats: crate::storage::properties::CopiedFormats::from_sheet(source, allocator),
            source_id: source.id,
            destination_id: sheet_id,
            source_rows: source.row_axis.clone(),
            source_cols: source.col_axis.clone(),
            rows: rows.clone(),
            cols: cols.clone(),
            cell_remap: cells,
            snapshot: SheetSnapshot {
                identities: Vec::new(),
                row_axis: Some(rows.store().clone()),
                col_axis: Some(cols.store().clone()),
                id: sheet_id.to_uuid_string(),
                name: name.to_owned(),
                rows: source.grid_rows,
                cols: source.grid_cols,
                cells: copied_cells,
                ranges: Vec::new(),
            },
            ranges,
            identities,
        }
    }

    pub(super) fn remap_row(&self, id: RowId) -> Option<RowId> {
        self.source_rows
            .position_of(self.source_id, id)
            .and_then(|pos| self.rows.identity_at(self.destination_id, pos))
    }

    pub(super) fn remap_col(&self, id: ColId) -> Option<ColId> {
        self.source_cols
            .position_of(self.source_id, id)
            .and_then(|pos| self.cols.identity_at(self.destination_id, pos))
    }

    pub(super) fn install(
        self,
        cell_store: &mut CellStore,
        sheet_id: SheetId,
    ) -> Result<(), ComputeError> {
        cell_store.add_sheet(self.snapshot)?;
        if let Some(sheet) = cell_store.get_sheet_mut(&sheet_id) {
            self.formats.install(sheet);
            for range in self.ranges {
                sheet.range_views.insert(range.range_id, range);
            }
        }
        for (id, pos) in self.identities {
            cell_store.register_identity_position(sheet_id, pos, id);
        }
        cell_store.install_sheet_axes(sheet_id, self.rows, self.cols);
        cell_store.finalize_sheet_range_hydration(sheet_id);
        Ok(())
    }
}

fn remap_formula(
    formula: &mut IdentityFormula,
    source: SheetId,
    destination: SheetId,
    cells: &FxHashMap<CellId, CellId>,
    rows: impl Fn(RowId) -> Option<RowId>,
    cols: impl Fn(ColId) -> Option<ColId>,
) {
    fn remap<Id: Eq + std::hash::Hash + Copy>(id: &mut Id, map: &FxHashMap<Id, Id>) {
        if let Some(new) = map.get(id) {
            *id = *new;
        }
    }
    for reference in &mut formula.refs {
        match reference {
            IdentityFormulaRef::Cell(r) => remap(&mut r.id, cells),
            IdentityFormulaRef::Range(r) => {
                remap(&mut r.start_id, cells);
                remap(&mut r.end_id, cells);
            }
            IdentityFormulaRef::RectRange(r) if r.sheet_id == source => {
                r.sheet_id = destination;
                if let Some(id) = rows(r.start_row_id) {
                    r.start_row_id = id;
                };
                if let Some(id) = rows(r.end_row_id) {
                    r.end_row_id = id;
                };
                if let Some(id) = cols(r.start_col_id) {
                    r.start_col_id = id;
                };
                if let Some(id) = cols(r.end_col_id) {
                    r.end_col_id = id;
                };
            }
            IdentityFormulaRef::FullRow(r) => {
                if let Some(id) = rows(r.row_id) {
                    r.row_id = id;
                }
            }
            IdentityFormulaRef::RowRange(r) => {
                if let Some(id) = rows(r.start_row_id) {
                    r.start_row_id = id;
                };
                if let Some(id) = rows(r.end_row_id) {
                    r.end_row_id = id;
                };
            }
            IdentityFormulaRef::FullCol(r) => {
                if let Some(id) = cols(r.col_id) {
                    r.col_id = id;
                }
            }
            IdentityFormulaRef::ColRange(r) => {
                if let Some(id) = cols(r.start_col_id) {
                    r.start_col_id = id;
                };
                if let Some(id) = cols(r.end_col_id) {
                    r.end_col_id = id;
                };
            }
            IdentityFormulaRef::RectRange(_)
            | IdentityFormulaRef::ExternalCell(_)
            | IdentityFormulaRef::ExternalRange(_)
            | IdentityFormulaRef::ExternalName(_) => {}
        }
    }
}
