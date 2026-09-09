//! Native cell and compact range ownership when copying a sheet.

use compute_document::identity::AxisIndex;
use std::collections::HashMap;
use std::sync::Arc;

use cell_types::{CellId, ColId, IdAllocator, RangeAnchor, RowId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use formula_types::{IdentityFormula, IdentityFormulaRef};
use rustc_hash::FxHashMap;
use value_types::ComputeError;

use crate::mirror::range_view::RangeView;
use crate::mirror::{CellMirror, SheetMirror};
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
        source: &SheetMirror,
        mirror: &CellMirror,
        sheet_id: SheetId,
        name: &str,
        allocator: &IdAllocator,
        cell_hex_remap: &mut HashMap<String, String>,
    ) -> Self {
        fn new_axis<Id: cell_types::AxisIdentityId + std::hash::Hash>(
            len: u32,
            allocator: &IdAllocator,
        ) -> Arc<AxisIndex<Id>> {
            Arc::new(AxisIndex::new(cell_types::AxisIdentityStore::from_runs([
                allocator.next_axis_run(len),
            ])))
        }
        let rows = new_axis(source.row_axis.len(), allocator);
        let cols = new_axis(source.col_axis.len(), allocator);
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
        for (&old_id, &pos) in &source.id_to_pos {
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
        let copied_cells = source
            .cells_iter()
            .filter_map(|(old_id, entry)| {
                let pos = source.position_of(old_id)?;
                let new_id = *cells.get(old_id)?;
                let mut formula = entry.formula.as_deref().cloned();
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
                    array_ref: mirror
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
                copied.row_offset_by_id = range
                    .row_offset_by_id
                    .iter()
                    .filter_map(|(id, &offset)| remap_row(*id).map(|id| (id, offset)))
                    .collect();
                copied.col_offset_by_id = range
                    .col_offset_by_id
                    .iter()
                    .filter_map(|(id, &offset)| remap_col(*id).map(|id| (id, offset)))
                    .collect();
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
                        let mut range_rows: Vec<_> = range
                            .row_offset_by_id
                            .keys()
                            .filter_map(|id| {
                                source
                                    .row_index_of(id)
                                    .map(|pos| (pos, remap_row(*id).unwrap()))
                            })
                            .collect();
                        let mut range_cols: Vec<_> = range
                            .col_offset_by_id
                            .keys()
                            .filter_map(|id| {
                                source
                                    .col_index_of(id)
                                    .map(|pos| (pos, remap_col(*id).unwrap()))
                            })
                            .collect();
                        range_rows.sort_unstable_by_key(|&(pos, _)| pos);
                        range_cols.sort_unstable_by_key(|&(pos, _)| pos);
                        if matches!(range.anchor, RangeAnchor::Elastic { .. })
                            && !range_rows.is_empty()
                            && !range_cols.is_empty()
                        {
                            RangeAnchor::Elastic {
                                start_row: range_rows[0].1,
                                end_row: range_rows.last().unwrap().1,
                                start_col: range_cols[0].1,
                                end_col: range_cols.last().unwrap().1,
                            }
                        } else {
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
            .id_to_pos
            .iter()
            .map(|(old, &pos)| (cells[old], pos))
            .collect();
        Self {
            formats: crate::storage::properties::CopiedFormats::from_sheet(source, allocator),
            source_id: source.id,
            destination_id: sheet_id,
            source_rows: source.row_axis.clone(),
            source_cols: source.col_axis.clone(),
            rows,
            cols,
            cell_remap: cells,
            snapshot: SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
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
        mirror: &mut CellMirror,
        sheet_id: SheetId,
    ) -> Result<(), ComputeError> {
        mirror.add_sheet(self.snapshot)?;
        if let Some(sheet) = mirror.get_sheet_mut(&sheet_id) {
            self.formats.install(sheet);
            for range in self.ranges {
                sheet.range_views.insert(range.range_id, range);
            }
        }
        for (id, pos) in self.identities {
            mirror.register_identity_position(sheet_id, pos, id);
        }
        mirror.install_sheet_axes(sheet_id, self.rows, self.cols);
        mirror.finalize_sheet_range_hydration(sheet_id);
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
