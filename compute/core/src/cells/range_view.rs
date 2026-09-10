use std::sync::Arc;

use cell_types::{ColId, RowId, SheetId};
use cell_types::{PayloadEncoding, RangeAnchor, RangeId, RangeKind, RectLike};
use rustc_hash::FxHashSet;

mod offsets;
pub use offsets::RangeOffsets;
use value_types::{CellError, CellValue};

#[derive(Debug, Clone)]
pub struct RangeView {
    pub range_id: RangeId,
    pub kind: RangeKind,
    pub anchor: RangeAnchor,
    pub encoding: PayloadEncoding,
    pub values: Arc<[CellValue]>,
    pub payload_cols: u32,
    pub row_offset_by_id: RangeOffsets<RowId>,
    pub col_offset_by_id: RangeOffsets<ColId>,
}

/// Read-only identity order used by compact ranges.
pub trait RangeAxis<Id: cell_types::AxisIdentityId + std::hash::Hash> {
    /// Resolve an axis identity to its current physical index.
    fn position_of(&self, id: Id) -> Option<u32>;

    fn bounds_of(&self, offsets: &RangeOffsets<Id>) -> Option<((u32, Id), (u32, Id))> {
        let mut bounds = None;
        for id in offsets.keys() {
            if let Some(pos) = self.position_of(id) {
                extend_bounds(&mut bounds, (pos, id));
            }
        }
        bounds
    }
}

impl<Id: cell_types::AxisIdentityId + std::hash::Hash> RangeAxis<Id> for [Id] {
    fn position_of(&self, id: Id) -> Option<u32> {
        self.iter()
            .position(|candidate| *candidate == id)
            .map(|pos| pos as u32)
    }
}
impl<Id: cell_types::AxisIdentityId + std::hash::Hash> RangeAxis<Id> for Vec<Id> {
    fn position_of(&self, id: Id) -> Option<u32> {
        self.as_slice().position_of(id)
    }
}
impl<Id: cell_types::AxisIdentityId + std::hash::Hash, const N: usize> RangeAxis<Id> for [Id; N] {
    fn position_of(&self, id: Id) -> Option<u32> {
        self.as_slice().position_of(id)
    }
}
impl<Id: cell_types::AxisIdentityId + std::hash::Hash> RangeAxis<Id>
    for (
        SheetId,
        std::sync::Arc<compute_document::identity::AxisIndex<Id>>,
    )
{
    fn position_of(&self, id: Id) -> Option<u32> {
        self.1.position_of(self.0, id)
    }

    fn bounds_of(&self, offsets: &RangeOffsets<Id>) -> Option<((u32, Id), (u32, Id))> {
        let (start, end) = offsets.position_bounds(self.0, &self.1)?;
        Some((
            (start, self.1.identity_at(self.0, start)?),
            (end, self.1.identity_at(self.0, end)?),
        ))
    }
}

fn extend_bounds<Id: Copy>(bounds: &mut Option<((u32, Id), (u32, Id))>, point: (u32, Id)) {
    match bounds {
        Some((start, end)) => {
            if point.0 < start.0 {
                *start = point;
            }
            if point.0 > end.0 {
                *end = point;
            }
        }
        None => *bounds = Some((point, point)),
    }
}

impl RangeView {
    pub fn num_cols(&self) -> u32 {
        self.col_offset_by_id.len() as u32
    }

    pub fn num_rows(&self) -> u32 {
        self.row_offset_by_id.len() as u32
    }

    /// Serialize active axes in payload order, compacting removed rows and columns.
    pub(crate) fn to_snapshot(&self) -> crate::snapshot::RangeData {
        let row_ids = self.row_offset_by_id.ordered_ids();
        let col_ids = self.col_offset_by_id.ordered_ids();
        let row_axis = self.row_offset_by_id.axis_ref();
        let col_axis = self.col_offset_by_id.axis_ref();
        crate::snapshot::RangeData {
            range_id: self.range_id,
            kind: self.kind,
            anchor: self.anchor.clone(),
            encoding: self.encoding,
            payload: encode_values(
                self.encoding,
                row_ids.iter().flat_map(|row| {
                    col_ids
                        .iter()
                        .map(move |col| self.value_at(row, col).unwrap_or(&CellValue::Null))
                }),
            ),
            row_ids: if row_axis.is_some() {
                Vec::new()
            } else {
                row_ids
            },
            col_ids: if col_axis.is_some() {
                Vec::new()
            } else {
                col_ids
            },
            row_axis,
            col_axis,
        }
    }

    /// Decode an imported payload once, then release its encoded bytes.
    pub fn decode_payload(
        encoding: PayloadEncoding,
        payload: &[u8],
        len: usize,
    ) -> Arc<[CellValue]> {
        if encoding == PayloadEncoding::None {
            return Arc::from([]);
        }
        let mut values = vec![CellValue::Null; len];
        match encoding {
            PayloadEncoding::None => unreachable!(),
            PayloadEncoding::MixedCbor => {
                visit_mixed_values(payload, len, |index, value| values[index] = value)
            }
            PayloadEncoding::F64Le | PayloadEncoding::I64Le => {
                for (value, bytes) in values.iter_mut().zip(payload.chunks_exact(8)) {
                    let bytes: [u8; 8] = bytes.try_into().unwrap();
                    *value = if encoding == PayloadEncoding::F64Le {
                        let n = f64::from_le_bytes(bytes);
                        if n.is_nan() {
                            CellValue::Null
                        } else {
                            CellValue::from(n)
                        }
                    } else {
                        CellValue::from(i64::from_le_bytes(bytes))
                    };
                }
            }
        }
        values.into()
    }

    /// Borrow a value from the one native range payload.
    pub fn value_at(&self, row_id: &RowId, col_id: &ColId) -> Option<&CellValue> {
        let row = self.row_offset_by_id.get(row_id)? as usize;
        let col = self.col_offset_by_id.get(col_id)? as usize;
        self.values.get(row * self.payload_cols as usize + col)
    }

    /// Release an imported value once an authored entry takes its place.
    pub(crate) fn consume_value(&mut self, row_id: &RowId, col_id: &ColId) {
        let Some(row) = self.row_offset_by_id.get(row_id) else {
            return;
        };
        let Some(col) = self.col_offset_by_id.get(col_id) else {
            return;
        };
        let index = row as usize * self.payload_cols as usize + col as usize;
        if self.values.get(index).is_some_and(|value| !value.is_null()) {
            Arc::make_mut(&mut self.values)[index] = CellValue::Null;
            // I64 has no null sentinel. F64 serializes a consumed slot as NaN.
            if self.encoding == PayloadEncoding::I64Le {
                self.encoding = PayloadEncoding::F64Le;
            }
        }
    }

    pub fn decode_value(&self, row_offset: u32, col_offset: u32) -> CellValue {
        self.values
            .get(row_offset as usize * self.payload_cols as usize + col_offset as usize)
            .cloned()
            .unwrap_or(CellValue::Null)
    }

    pub fn decode_at(&self, row_id: &RowId, col_id: &ColId) -> Option<CellValue> {
        self.value_at(row_id, col_id).cloned()
    }

    pub(crate) fn visit_values(&self, mut visit: impl FnMut(RowId, ColId, CellValue)) {
        self.visit_row_offset_range_values(0, usize::MAX, &mut visit);
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
        for (row_id, row_offset) in self.row_offset_by_id.iter() {
            if (row_offset as usize) < start_row_offset || row_offset as usize >= end_row_offset {
                continue;
            }
            for (col_id, col_offset) in self.col_offset_by_id.iter() {
                visit(row_id, col_id, self.decode_value(row_offset, col_offset));
            }
        }
    }

    // -- structural operation callbacks ---------------------------------------

    pub fn on_rows_inserted(
        &mut self,
        _new_row_ids: &[RowId],
        row_order: &(impl RangeAxis<RowId> + ?Sized),
        col_order: &(impl RangeAxis<ColId> + ?Sized),
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
        row_order: &(impl RangeAxis<RowId> + ?Sized),
        col_order: &(impl RangeAxis<ColId> + ?Sized),
    ) -> RangeExtentDelta {
        let deleted_offsets: Vec<_> = deleted_row_ids
            .iter()
            .filter_map(|id| self.row_offset_by_id.get(id))
            .collect();
        if !deleted_offsets.is_empty()
            && deleted_offsets.len() < self.row_offset_by_id.len()
            && self.payload_cols != 0
        {
            let values = Arc::make_mut(&mut self.values);
            for row in deleted_offsets {
                let start = row as usize * self.payload_cols as usize;
                let end = (start + self.payload_cols as usize).min(values.len());
                if start < end {
                    values[start..end].fill(CellValue::Null);
                }
            }
            if self.encoding == PayloadEncoding::I64Le {
                self.encoding = PayloadEncoding::F64Le;
            }
        }
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

                for id in deleted_row_ids {
                    self.row_offset_by_id.remove(id);
                }
                let mut bounds = row_order.bounds_of(&self.row_offset_by_id);
                for id in [start_row, end_row] {
                    if let Some(pos) = row_order.position_of(id) {
                        extend_bounds(&mut bounds, (pos, id));
                    }
                }
                let Some(((_, first), (_, last))) = bounds else {
                    return RangeExtentDelta::Removed;
                };

                let new_start = if deleted.contains(&start_row) {
                    first
                } else {
                    start_row
                };
                let new_end = if deleted.contains(&end_row) {
                    last
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
        row_order: &(impl RangeAxis<RowId> + ?Sized),
        col_order: &(impl RangeAxis<ColId> + ?Sized),
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
        row_order: &(impl RangeAxis<RowId> + ?Sized),
        col_order: &(impl RangeAxis<ColId> + ?Sized),
    ) -> RangeExtentDelta {
        let deleted_offsets: Vec<_> = deleted_col_ids
            .iter()
            .filter_map(|id| self.col_offset_by_id.get(id))
            .collect();
        if !deleted_offsets.is_empty()
            && deleted_offsets.len() < self.col_offset_by_id.len()
            && self.payload_cols != 0
        {
            let values = Arc::make_mut(&mut self.values);
            for row in values.chunks_mut(self.payload_cols as usize) {
                for &col in &deleted_offsets {
                    if let Some(value) = row.get_mut(col as usize) {
                        *value = CellValue::Null;
                    }
                }
            }
            if self.encoding == PayloadEncoding::I64Le {
                self.encoding = PayloadEncoding::F64Le;
            }
        }
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

                for id in deleted_col_ids {
                    self.col_offset_by_id.remove(id);
                }
                let mut bounds = col_order.bounds_of(&self.col_offset_by_id);
                for id in [start_col, end_col] {
                    if let Some(pos) = col_order.position_of(id) {
                        extend_bounds(&mut bounds, (pos, id));
                    }
                }
                let Some(((_, first), (_, last))) = bounds else {
                    return RangeExtentDelta::Removed;
                };

                let new_start = if deleted.contains(&start_col) {
                    first
                } else {
                    start_col
                };
                let new_end = if deleted.contains(&end_col) {
                    last
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
        row_order: &(impl RangeAxis<RowId> + ?Sized),
        col_order: &(impl RangeAxis<ColId> + ?Sized),
    ) -> RangeExtentDelta {
        match self.compute_extent(row_order, col_order) {
            Some(extent) => RangeExtentDelta::Updated(extent),
            None => RangeExtentDelta::Unchanged,
        }
    }

    pub fn on_cols_reordered(
        &mut self,
        row_order: &(impl RangeAxis<RowId> + ?Sized),
        col_order: &(impl RangeAxis<ColId> + ?Sized),
    ) -> RangeExtentDelta {
        match self.compute_extent(row_order, col_order) {
            Some(extent) => RangeExtentDelta::Updated(extent),
            None => RangeExtentDelta::Unchanged,
        }
    }

    // -- helpers --------------------------------------------------------------

    pub(crate) fn compute_extent(
        &self,
        row_order: &(impl RangeAxis<RowId> + ?Sized),
        col_order: &(impl RangeAxis<ColId> + ?Sized),
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
                    .filter_map(|rid| row_order.position_of(*rid))
                    .collect();
                let col_positions: Vec<u32> = col_ids
                    .iter()
                    .filter_map(|cid| col_order.position_of(*cid))
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

        let start_row = row_order.position_of(row_start_id)?;
        let end_row = row_order.position_of(row_end_id)?;
        let start_col = col_order.position_of(col_start_id)?;
        let end_col = col_order.position_of(col_end_id)?;

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

/// Encode native values only when crossing the snapshot/file boundary.
pub(crate) fn encode_values<'a>(
    encoding: PayloadEncoding,
    values: impl IntoIterator<Item = &'a CellValue>,
) -> Vec<u8> {
    let mut payload = Vec::new();
    if encoding == PayloadEncoding::None {
        return payload;
    }
    for value in values {
        match encoding {
            PayloadEncoding::None => unreachable!(),
            PayloadEncoding::F64Le => {
                payload.extend_from_slice(&value.as_number().unwrap_or(f64::NAN).to_le_bytes())
            }
            PayloadEncoding::I64Le => {
                payload.extend_from_slice(&(value.as_number().unwrap_or(0.0) as i64).to_le_bytes())
            }
            PayloadEncoding::MixedCbor => match value {
                CellValue::Number(n) => {
                    payload.push(1);
                    payload.extend_from_slice(&n.get().to_le_bytes());
                }
                CellValue::Text(text) => {
                    payload.push(2);
                    payload.extend_from_slice(&(text.len() as u32).to_le_bytes());
                    payload.extend_from_slice(text.as_bytes());
                }
                CellValue::Boolean(b) => {
                    payload.push(3);
                    payload.push(u8::from(*b));
                }
                CellValue::Error(error, _) => {
                    payload.push(4);
                    payload.push(match error {
                        CellError::Div0 => 0,
                        CellError::Na => 1,
                        CellError::Name => 2,
                        CellError::Null => 3,
                        CellError::Num => 4,
                        CellError::Ref => 5,
                        CellError::Value => 6,
                        CellError::Spill => 7,
                        CellError::Calc => 8,
                        CellError::GettingData => 9,
                        CellError::Circ => 10,
                    });
                }
                _ => payload.push(0),
            },
        }
    }
    payload
}

#[cfg(test)]
mod native_payload_tests {
    use super::*;

    #[test]
    fn consumed_integer_slot_roundtrips_as_null() {
        let row = RowId::from_raw(1);
        let col = ColId::from_raw(1);
        let mut range = RangeView {
            range_id: RangeId::from_raw(1),
            kind: RangeKind::Data,
            anchor: RangeAnchor::Strict {
                row_ids: vec![row],
                col_ids: vec![col],
            },
            encoding: PayloadEncoding::I64Le,
            values: Arc::from([CellValue::from(42.0)]),
            payload_cols: 1,
            row_offset_by_id: [(row, 0)].into_iter().collect(),
            col_offset_by_id: [(col, 0)].into_iter().collect(),
        };
        range.consume_value(&row, &col);
        let payload = encode_values(range.encoding, range.values.iter());
        assert_eq!(
            &*RangeView::decode_payload(range.encoding, &payload, 1),
            &[CellValue::Null]
        );
    }

    #[test]
    fn removing_axes_preserves_payload_stride_and_roundtrips_active_values() {
        let row_ids: Vec<_> = (1..=3).map(RowId::from_raw).collect();
        let col_ids: Vec<_> = (1..=3).map(ColId::from_raw).collect();
        let values: Vec<_> = (1..=9).map(|n| CellValue::from(n as f64)).collect();
        let encoded = encode_values(PayloadEncoding::F64Le, &values);
        let mut range = RangeView {
            range_id: RangeId::from_raw(1),
            kind: RangeKind::Data,
            anchor: RangeAnchor::Strict {
                row_ids: row_ids.clone(),
                col_ids: col_ids.clone(),
            },
            encoding: PayloadEncoding::F64Le,
            values: RangeView::decode_payload(PayloadEncoding::F64Le, &encoded, 9),
            payload_cols: 3,
            row_offset_by_id: row_ids
                .iter()
                .enumerate()
                .map(|(n, id)| (*id, n as u32))
                .collect(),
            col_offset_by_id: col_ids
                .iter()
                .enumerate()
                .map(|(n, id)| (*id, n as u32))
                .collect(),
        };
        let text: Arc<str> = Arc::from("deleted imported text");
        let text_owner = Arc::downgrade(&text);
        Arc::make_mut(&mut range.values)[4] = CellValue::Text(text);
        range.on_rows_deleted(&[row_ids[1]], &[row_ids[0], row_ids[2]], &col_ids);
        assert!(
            text_owner.upgrade().is_none(),
            "deleted text must be released"
        );
        range.on_cols_deleted(
            &[col_ids[1]],
            &[row_ids[0], row_ids[2]],
            &[col_ids[0], col_ids[2]],
        );
        assert!(range.values[1].is_null());
        assert!(range.values[4].is_null());
        assert_eq!(
            range.value_at(&row_ids[2], &col_ids[2]),
            Some(&CellValue::from(9.0))
        );
        let active: Vec<_> = [0, 2]
            .into_iter()
            .flat_map(|row| [0, 2].into_iter().map(move |col| (row, col)))
            .map(|(row, col)| range.value_at(&row_ids[row], &col_ids[col]).unwrap())
            .collect();
        let encoded = encode_values(range.encoding, active);
        assert_eq!(
            &*RangeView::decode_payload(range.encoding, &encoded, 4),
            &[
                CellValue::from(1.0),
                CellValue::from(3.0),
                CellValue::from(7.0),
                CellValue::from(9.0)
            ]
        );
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RangeExtentDelta {
    Updated(RangeExtent),
    Removed,
    Unchanged,
}
