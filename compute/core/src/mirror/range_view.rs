use std::sync::Arc;

use cell_types::{CellId, ColId, RowId};
use cell_types::{PayloadEncoding, RangeAnchor, RangeId, RangeKind, RectLike};
use rustc_hash::{FxHashMap, FxHashSet};
use value_types::{CellError, CellValue};

#[derive(Debug, Clone)]
pub struct RangeView {
    pub range_id: RangeId,
    pub kind: RangeKind,
    pub anchor: RangeAnchor,
    pub encoding: PayloadEncoding,
    pub payload: Arc<[u8]>,
    pub row_offset_by_id: FxHashMap<RowId, u32>,
    pub col_offset_by_id: FxHashMap<ColId, u32>,
    pub overrides: FxHashMap<(RowId, ColId), CellId>,
    pub override_count: u32,
    pub folded_up_to: Option<usize>,
}

impl RangeView {
    pub fn num_cols(&self) -> u32 {
        self.col_offset_by_id.len() as u32
    }

    pub fn num_rows(&self) -> u32 {
        self.row_offset_by_id.len() as u32
    }

    /// Decode a single logical cell. This is suitable for sparse point reads.
    /// Bulk MixedCbor materialization must use the streaming APIs below.
    pub fn decode_value(&self, row_offset: u32, col_offset: u32) -> CellValue {
        let num_cols = self.num_cols();
        let index = (row_offset as usize) * (num_cols as usize) + (col_offset as usize);
        match self.encoding {
            PayloadEncoding::None => CellValue::Null,
            PayloadEncoding::F64Le => {
                let byte_offset = index * 8;
                if byte_offset + 8 > self.payload.len() {
                    return CellValue::Null;
                }
                let bytes: [u8; 8] = self.payload[byte_offset..byte_offset + 8]
                    .try_into()
                    .unwrap();
                let val = f64::from_le_bytes(bytes);
                if val.is_nan() {
                    CellValue::Null
                } else {
                    CellValue::from(val)
                }
            }
            PayloadEncoding::I64Le => {
                let byte_offset = index * 8;
                if byte_offset + 8 > self.payload.len() {
                    return CellValue::Null;
                }
                let bytes: [u8; 8] = self.payload[byte_offset..byte_offset + 8]
                    .try_into()
                    .unwrap();
                let val = i64::from_le_bytes(bytes);
                CellValue::from(val)
            }
            PayloadEncoding::MixedCbor => decode_mixed_value_at(&self.payload, index),
        }
    }

    pub fn decode_at(&self, row_id: &RowId, col_id: &ColId) -> Option<CellValue> {
        let row_offset = self.row_offset_by_id.get(row_id)?;
        let col_offset = self.col_offset_by_id.get(col_id)?;
        Some(self.decode_value(*row_offset, *col_offset))
    }

    /// Decode one range-backed column into an already-sized destination vector.
    ///
    /// This is for isolated single-column rebuilds. Callers that know they need
    /// multiple columns must use `decode_range_into_columns` so MixedCbor payloads
    /// are streamed once per range instead of once per column.
    pub(crate) fn decode_column_into(
        &self,
        col_offset: u32,
        row_to_index: &FxHashMap<RowId, u32>,
        out: &mut [CellValue],
    ) {
        if self.encoding == PayloadEncoding::None {
            return;
        }

        let rows = self.rows_by_offset();
        match self.encoding {
            PayloadEncoding::None => {}
            PayloadEncoding::F64Le | PayloadEncoding::I64Le => {
                for (&row_id, &row_offset) in &self.row_offset_by_id {
                    let Some(&row_idx) = row_to_index.get(&row_id) else {
                        continue;
                    };
                    let row_idx = row_idx as usize;
                    if row_idx < out.len() {
                        out[row_idx] = self.decode_value(row_offset, col_offset);
                    }
                }
            }
            PayloadEncoding::MixedCbor => {
                let num_cols = self.num_cols() as usize;
                if num_cols == 0 {
                    return;
                }
                let expected_cells = rows.len().saturating_mul(num_cols);
                visit_mixed_values(&self.payload, expected_cells, |flat_index, value| {
                    if flat_index % num_cols != col_offset as usize {
                        return;
                    }
                    let row_offset = flat_index / num_cols;
                    let Some(Some(row_id)) = rows.get(row_offset) else {
                        return;
                    };
                    let Some(&row_idx) = row_to_index.get(row_id) else {
                        return;
                    };
                    let row_idx = row_idx as usize;
                    if row_idx < out.len() {
                        out[row_idx] = value;
                    }
                });
            }
        }
    }

    /// Decode the full range into dense sheet columns.
    ///
    /// Destination vectors are grown as needed and are otherwise left unchanged.
    /// MixedCbor payloads are row-major with exactly `num_rows * num_cols`
    /// logical entries; malformed/truncated entries leave the corresponding
    /// destination cells as their prefilled values, and trailing extra payload
    /// entries are ignored by the canonical streaming visitor.
    pub(crate) fn decode_range_into_columns(
        &self,
        row_to_index: &FxHashMap<RowId, u32>,
        col_to_index: &FxHashMap<ColId, u32>,
        columns: &mut FxHashMap<u32, Vec<CellValue>>,
    ) {
        if self.encoding == PayloadEncoding::None {
            return;
        }

        let rows = self.rows_by_offset();
        let cols = self.cols_by_offset();
        let num_cols = cols.len();
        if rows.is_empty() || cols.is_empty() {
            return;
        }

        match self.encoding {
            PayloadEncoding::None => {}
            PayloadEncoding::F64Le | PayloadEncoding::I64Le => {
                for (row_offset, row_id) in rows.iter().enumerate() {
                    let Some(row_id) = row_id else {
                        continue;
                    };
                    let Some(&row_idx) = row_to_index.get(row_id) else {
                        continue;
                    };
                    for (col_offset, col_id) in cols.iter().enumerate() {
                        let Some(col_id) = col_id else {
                            continue;
                        };
                        let Some(&col_idx) = col_to_index.get(col_id) else {
                            continue;
                        };
                        let column = columns.entry(col_idx).or_default();
                        let row_idx = row_idx as usize;
                        if row_idx >= column.len() {
                            column.resize(row_idx + 1, CellValue::Null);
                        }
                        column[row_idx] = self.decode_value(row_offset as u32, col_offset as u32);
                    }
                }
            }
            PayloadEncoding::MixedCbor => {
                let expected_cells = rows.len().saturating_mul(num_cols);
                visit_mixed_values(&self.payload, expected_cells, |flat_index, value| {
                    let row_offset = flat_index / num_cols;
                    let col_offset = flat_index % num_cols;
                    let Some(Some(row_id)) = rows.get(row_offset) else {
                        return;
                    };
                    let Some(Some(col_id)) = cols.get(col_offset) else {
                        return;
                    };
                    let Some(&row_idx) = row_to_index.get(row_id) else {
                        return;
                    };
                    let Some(&col_idx) = col_to_index.get(col_id) else {
                        return;
                    };
                    let column = columns.entry(col_idx).or_default();
                    let row_idx = row_idx as usize;
                    if row_idx >= column.len() {
                        column.resize(row_idx + 1, CellValue::Null);
                    }
                    column[row_idx] = value;
                });
            }
        }
    }

    pub(crate) fn visit_values(&self, mut visit: impl FnMut(RowId, ColId, CellValue)) {
        let row_count = self.rows_by_offset().len();
        self.visit_row_offset_range_values(0, row_count, &mut visit);
    }

    pub(crate) fn visit_row_offset_range_values(
        &self,
        start_row_offset: usize,
        end_row_offset: usize,
        visit: &mut impl FnMut(RowId, ColId, CellValue),
    ) {
        if self.encoding == PayloadEncoding::None {
            return;
        }

        let rows = self.rows_by_offset();
        let cols = self.cols_by_offset();
        let num_cols = cols.len();
        if rows.is_empty() || cols.is_empty() || start_row_offset >= end_row_offset {
            return;
        }

        let end_row_offset = end_row_offset.min(rows.len());
        match self.encoding {
            PayloadEncoding::None => {}
            PayloadEncoding::F64Le | PayloadEncoding::I64Le => {
                for row_offset in start_row_offset..end_row_offset {
                    let Some(Some(row_id)) = rows.get(row_offset) else {
                        continue;
                    };
                    for (col_offset, col_id) in cols.iter().enumerate() {
                        let Some(col_id) = col_id else {
                            continue;
                        };
                        visit(
                            *row_id,
                            *col_id,
                            self.decode_value(row_offset as u32, col_offset as u32),
                        );
                    }
                }
            }
            PayloadEncoding::MixedCbor => {
                let expected_cells = rows.len().saturating_mul(num_cols);
                visit_mixed_values(&self.payload, expected_cells, |flat_index, value| {
                    let row_offset = flat_index / num_cols;
                    if row_offset < start_row_offset || row_offset >= end_row_offset {
                        return;
                    }
                    let col_offset = flat_index % num_cols;
                    let Some(Some(row_id)) = rows.get(row_offset) else {
                        return;
                    };
                    let Some(Some(col_id)) = cols.get(col_offset) else {
                        return;
                    };
                    visit(*row_id, *col_id, value);
                });
            }
        }
    }

    fn rows_by_offset(&self) -> Vec<Option<RowId>> {
        let max_offset = self
            .row_offset_by_id
            .values()
            .copied()
            .max()
            .map_or(0, |offset| offset as usize + 1);
        let mut rows = vec![None; max_offset];
        for (&row_id, &offset) in &self.row_offset_by_id {
            if let Some(slot) = rows.get_mut(offset as usize) {
                *slot = Some(row_id);
            }
        }
        rows
    }

    fn cols_by_offset(&self) -> Vec<Option<ColId>> {
        let max_offset = self
            .col_offset_by_id
            .values()
            .copied()
            .max()
            .map_or(0, |offset| offset as usize + 1);
        let mut cols = vec![None; max_offset];
        for (&col_id, &offset) in &self.col_offset_by_id {
            if let Some(slot) = cols.get_mut(offset as usize) {
                *slot = Some(col_id);
            }
        }
        cols
    }

    // -- structural operation callbacks ---------------------------------------

    pub fn on_rows_inserted(
        &mut self,
        _new_row_ids: &[RowId],
        row_order: &[RowId],
        col_order: &[ColId],
    ) -> RangeExtentDelta {
        match &self.anchor {
            RangeAnchor::Elastic { .. } => match self.compute_extent(row_order, col_order) {
                Some(extent) => RangeExtentDelta::Updated(extent),
                None => RangeExtentDelta::Unchanged,
            },
            RangeAnchor::Strict { .. } => RangeExtentDelta::Unchanged,
        }
    }

    pub fn on_rows_deleted(
        &mut self,
        deleted_row_ids: &[RowId],
        row_order: &[RowId],
        col_order: &[ColId],
    ) -> RangeExtentDelta {
        let deleted: FxHashSet<RowId> = deleted_row_ids.iter().copied().collect();

        match &self.anchor {
            RangeAnchor::Elastic {
                start_row,
                end_row,
                start_col,
                end_col,
            } => {
                let start_row = *start_row;
                let end_row = *end_row;
                let start_col = *start_col;
                let end_col = *end_col;

                let mut extent_rows: FxHashSet<RowId> =
                    self.row_offset_by_id.keys().copied().collect();
                extent_rows.insert(start_row);
                extent_rows.insert(end_row);

                for &rid in deleted_row_ids {
                    self.row_offset_by_id.remove(&rid);
                }

                let surviving: Vec<RowId> = row_order
                    .iter()
                    .copied()
                    .filter(|rid| extent_rows.contains(rid))
                    .collect();

                if surviving.is_empty() {
                    return RangeExtentDelta::Removed;
                }

                let new_start = if deleted.contains(&start_row) {
                    *surviving.first().unwrap()
                } else {
                    start_row
                };
                let new_end = if deleted.contains(&end_row) {
                    *surviving.last().unwrap()
                } else {
                    end_row
                };

                self.anchor = RangeAnchor::Elastic {
                    start_row: new_start,
                    end_row: new_end,
                    start_col,
                    end_col,
                };

                match self.compute_extent(row_order, col_order) {
                    Some(extent) => RangeExtentDelta::Updated(extent),
                    None => RangeExtentDelta::Removed,
                }
            }
            RangeAnchor::Strict { row_ids, col_ids } => {
                let new_row_ids: Vec<RowId> = row_ids
                    .iter()
                    .copied()
                    .filter(|rid| !deleted.contains(rid))
                    .collect();

                if new_row_ids.is_empty() {
                    return RangeExtentDelta::Removed;
                }

                let col_ids = col_ids.clone();

                for &rid in deleted_row_ids {
                    self.row_offset_by_id.remove(&rid);
                }

                self.anchor = RangeAnchor::Strict {
                    row_ids: new_row_ids,
                    col_ids,
                };

                match self.compute_extent(row_order, col_order) {
                    Some(extent) => RangeExtentDelta::Updated(extent),
                    None => RangeExtentDelta::Removed,
                }
            }
        }
    }

    pub fn on_cols_inserted(
        &mut self,
        _new_col_ids: &[ColId],
        row_order: &[RowId],
        col_order: &[ColId],
    ) -> RangeExtentDelta {
        match &self.anchor {
            RangeAnchor::Elastic { .. } => match self.compute_extent(row_order, col_order) {
                Some(extent) => RangeExtentDelta::Updated(extent),
                None => RangeExtentDelta::Unchanged,
            },
            RangeAnchor::Strict { .. } => RangeExtentDelta::Unchanged,
        }
    }

    pub fn on_cols_deleted(
        &mut self,
        deleted_col_ids: &[ColId],
        row_order: &[RowId],
        col_order: &[ColId],
    ) -> RangeExtentDelta {
        let deleted: FxHashSet<ColId> = deleted_col_ids.iter().copied().collect();

        match &self.anchor {
            RangeAnchor::Elastic {
                start_row,
                end_row,
                start_col,
                end_col,
            } => {
                let start_row = *start_row;
                let end_row = *end_row;
                let start_col = *start_col;
                let end_col = *end_col;

                let mut extent_cols: FxHashSet<ColId> =
                    self.col_offset_by_id.keys().copied().collect();
                extent_cols.insert(start_col);
                extent_cols.insert(end_col);

                for &cid in deleted_col_ids {
                    self.col_offset_by_id.remove(&cid);
                }

                let surviving: Vec<ColId> = col_order
                    .iter()
                    .copied()
                    .filter(|cid| extent_cols.contains(cid))
                    .collect();

                if surviving.is_empty() {
                    return RangeExtentDelta::Removed;
                }

                let new_start = if deleted.contains(&start_col) {
                    *surviving.first().unwrap()
                } else {
                    start_col
                };
                let new_end = if deleted.contains(&end_col) {
                    *surviving.last().unwrap()
                } else {
                    end_col
                };

                self.anchor = RangeAnchor::Elastic {
                    start_row,
                    end_row,
                    start_col: new_start,
                    end_col: new_end,
                };

                match self.compute_extent(row_order, col_order) {
                    Some(extent) => RangeExtentDelta::Updated(extent),
                    None => RangeExtentDelta::Removed,
                }
            }
            RangeAnchor::Strict { row_ids, col_ids } => {
                let new_col_ids: Vec<ColId> = col_ids
                    .iter()
                    .copied()
                    .filter(|cid| !deleted.contains(cid))
                    .collect();

                if new_col_ids.is_empty() {
                    return RangeExtentDelta::Removed;
                }

                let row_ids = row_ids.clone();

                for &cid in deleted_col_ids {
                    self.col_offset_by_id.remove(&cid);
                }

                self.anchor = RangeAnchor::Strict {
                    row_ids,
                    col_ids: new_col_ids,
                };

                match self.compute_extent(row_order, col_order) {
                    Some(extent) => RangeExtentDelta::Updated(extent),
                    None => RangeExtentDelta::Removed,
                }
            }
        }
    }

    pub fn on_rows_reordered(
        &mut self,
        row_order: &[RowId],
        col_order: &[ColId],
    ) -> RangeExtentDelta {
        match self.compute_extent(row_order, col_order) {
            Some(extent) => RangeExtentDelta::Updated(extent),
            None => RangeExtentDelta::Unchanged,
        }
    }

    pub fn on_cols_reordered(
        &mut self,
        row_order: &[RowId],
        col_order: &[ColId],
    ) -> RangeExtentDelta {
        match self.compute_extent(row_order, col_order) {
            Some(extent) => RangeExtentDelta::Updated(extent),
            None => RangeExtentDelta::Unchanged,
        }
    }

    // -- helpers --------------------------------------------------------------

    pub(crate) fn compute_extent(
        &self,
        row_order: &[RowId],
        col_order: &[ColId],
    ) -> Option<RangeExtent> {
        let (row_start_id, row_end_id, col_start_id, col_end_id) = match &self.anchor {
            RangeAnchor::Elastic {
                start_row,
                end_row,
                start_col,
                end_col,
            } => (*start_row, *end_row, *start_col, *end_col),
            RangeAnchor::Strict { row_ids, col_ids } => {
                if row_ids.is_empty() || col_ids.is_empty() {
                    return None;
                }

                let row_positions: Vec<u32> = row_ids
                    .iter()
                    .filter_map(|rid| row_order.iter().position(|r| r == rid).map(|p| p as u32))
                    .collect();
                let col_positions: Vec<u32> = col_ids
                    .iter()
                    .filter_map(|cid| col_order.iter().position(|c| c == cid).map(|p| p as u32))
                    .collect();

                if row_positions.is_empty() || col_positions.is_empty() {
                    return None;
                }

                let sr = *row_positions.iter().min().unwrap();
                let er = *row_positions.iter().max().unwrap();
                let sc = *col_positions.iter().min().unwrap();
                let ec = *col_positions.iter().max().unwrap();

                return Some(RangeExtent {
                    range_id: self.range_id,
                    kind: self.kind,
                    start_row: sr,
                    end_row: er,
                    start_col: sc,
                    end_col: ec,
                });
            }
        };

        let start_row = row_order.iter().position(|r| *r == row_start_id)? as u32;
        let end_row = row_order.iter().position(|r| *r == row_end_id)? as u32;
        let start_col = col_order.iter().position(|c| *c == col_start_id)? as u32;
        let end_col = col_order.iter().position(|c| *c == col_end_id)? as u32;

        Some(RangeExtent {
            range_id: self.range_id,
            kind: self.kind,
            start_row,
            end_row,
            start_col,
            end_col,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RangeExtent {
    pub range_id: RangeId,
    pub kind: RangeKind,
    pub start_row: u32,
    pub end_row: u32,
    pub start_col: u32,
    pub end_col: u32,
}

impl RectLike for RangeExtent {
    fn start_row(&self) -> u32 {
        self.start_row
    }
    fn end_row(&self) -> u32 {
        self.end_row
    }
    fn start_col(&self) -> u32 {
        self.start_col
    }
    fn end_col(&self) -> u32 {
        self.end_col
    }
}

fn decode_mixed_value_at(payload: &[u8], target_index: usize) -> CellValue {
    let mut result = CellValue::Null;
    visit_mixed_values(payload, target_index + 1, |index, value| {
        if index == target_index {
            result = value;
        }
    });
    result
}

pub(crate) fn visit_mixed_values(
    payload: &[u8],
    expected_cells: usize,
    mut visit: impl FnMut(usize, CellValue),
) {
    let mut offset = 0;
    for index in 0..expected_cells {
        if offset >= payload.len() {
            return;
        }
        let tag = payload[offset];
        offset += 1;
        let value = match tag {
            0x00 => CellValue::Null,
            0x01 => {
                if offset + 8 > payload.len() {
                    return;
                }
                let bytes: [u8; 8] = payload[offset..offset + 8].try_into().unwrap();
                offset += 8;
                CellValue::from(f64::from_le_bytes(bytes))
            }
            0x02 => {
                if offset + 4 > payload.len() {
                    return;
                }
                let len_bytes: [u8; 4] = payload[offset..offset + 4].try_into().unwrap();
                offset += 4;
                let len = u32::from_le_bytes(len_bytes) as usize;
                if offset + len > payload.len() {
                    return;
                }
                let value = std::str::from_utf8(&payload[offset..offset + len])
                    .map(CellValue::from)
                    .unwrap_or(CellValue::Null);
                offset += len;
                value
            }
            0x03 => {
                if offset >= payload.len() {
                    return;
                }
                let value = CellValue::from(payload[offset] != 0);
                offset += 1;
                value
            }
            0x04 => {
                if offset >= payload.len() {
                    return;
                }
                let err = match payload[offset] {
                    0 => CellError::Div0,
                    1 => CellError::Na,
                    2 => CellError::Name,
                    3 => CellError::Null,
                    4 => CellError::Num,
                    5 => CellError::Ref,
                    6 => CellError::Value,
                    7 => CellError::Spill,
                    8 => CellError::Calc,
                    9 => CellError::GettingData,
                    10 => CellError::Circ,
                    _ => return,
                };
                offset += 1;
                CellValue::from(err)
            }
            _ => return,
        };
        visit(index, value);
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ColDataState {
    Complete,
    Partial,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RangeExtentDelta {
    Updated(RangeExtent),
    Removed,
    Unchanged,
}
