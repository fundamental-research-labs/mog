//! Import classifier: detects homogeneous column runs in sheet cells and
//! converts them to compact `RangeData` payloads.
//!
//! The classifier scans non-anchored cells column-by-column. Contiguous runs
//! of numeric values are encoded as `F64Le` or `I64Le` payloads; mixed-type
//! runs use the `MixedCbor` encoding. Only runs that meet the per-encoding
//! size threshold are promoted to ranges -- shorter runs stay as individual
//! `CellData` entries.

use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeKind, RowId};
use domain_types::SheetData;
use rustc_hash::{FxHashMap, FxHashSet};
use snapshot_types::{CellData, RangeData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

use super::DefaultIdAllocator;
use super::anchor_collection::collect_anchored_positions;

/// Minimum number of entries for an F64Le run to be promoted to a range.
const F64_THRESHOLD: usize = 256;
/// Minimum number of entries for an I64Le run to be promoted to a range.
const I64_THRESHOLD: usize = 256;
/// Minimum number of entries for a MixedCbor run to be promoted to a range.
const MIXED_CBOR_THRESHOLD: usize = 512;

/// The maximum safe integer magnitude representable exactly in f64 (2^53).
const MAX_SAFE_F64_INT: f64 = (1u64 << 53) as f64;

// ---------------------------------------------------------------------------
// Run-encoding tracking
// ---------------------------------------------------------------------------

/// What the current contiguous run can be encoded as.
#[derive(Clone, Copy, Debug)]
enum RunKind {
    /// All values are numeric. May be pure f64 or promotable integers.
    Numeric,
    /// Mixed types (text, bool, error, null interleaved with anything).
    Mixed,
}

/// Accumulated state for a numeric run.
#[derive(Debug)]
struct NumericRunState {
    /// Seen a Number value whose f64 representation is not an exact integer.
    has_pure_f64: bool,
    /// Seen an integer value outside the safe +-2^53 range.
    has_large_i64: bool,
}

impl NumericRunState {
    fn new() -> Self {
        Self {
            has_pure_f64: false,
            has_large_i64: false,
        }
    }

    fn encoding(&self) -> PayloadEncoding {
        if self.has_large_i64 && !self.has_pure_f64 {
            PayloadEncoding::I64Le
        } else {
            // All-promotable-integers, pure-f64, or mixed promotable+f64 all
            // encode losslessly as F64Le (integers within +-2^53 are exact in
            // f64). The `has_large_i64 && has_pure_f64` case should never
            // happen because we flush on incompatibility, but F64Le is safe
            // as a fallback since the only data loss would be >2^53 integers
            // which we actively prevent from entering this path.
            PayloadEncoding::F64Le
        }
    }
}

/// A single entry in a run: row position and index into the original cells vec.
#[derive(Clone, Copy)]
struct RunEntry {
    row: u32,
    cell_idx: usize,
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Classify non-anchored cells in `sheet` into column-oriented `RangeData`.
///
/// Cells that are promoted to ranges are removed from `sheet.cells`; the
/// resulting `RangeData` entries are written to `sheet.ranges`.
pub(crate) fn classify_sheet_ranges(
    sheet: &mut SheetSnapshot,
    sheet_data: &SheetData,
    snapshot: &WorkbookSnapshot,
    cell_id_to_pos: Option<&FxHashMap<String, (u32, u32)>>,
    sheet_row_ids: &[RowId],
    sheet_col_ids: &[ColId],
    allocator: &mut DefaultIdAllocator,
) {
    // 1. Collect anchored positions (cells that must not be ranged).
    let anchored = collect_anchored_positions(sheet_data, &sheet.id, snapshot, cell_id_to_pos);

    // 2. Build column -> sorted (row, cell_index) for non-anchored cells.
    // Explicit Null cells participate in classification: they split numeric
    // runs and can be encoded inside MixedCbor runs. Flush/removal logic keeps
    // Null identity cells from being deleted or promoted as null-only ranges.
    let mut col_runs: FxHashMap<u32, Vec<(u32, usize)>> = FxHashMap::default();
    for (idx, cell) in sheet.cells.iter().enumerate() {
        if anchored.contains(&(cell.row, cell.col)) {
            continue;
        }
        col_runs.entry(cell.col).or_default().push((cell.row, idx));
    }

    // 3. Sort column keys for deterministic RangeId allocation.
    let mut sorted_cols: Vec<u32> = col_runs.keys().copied().collect();
    sorted_cols.sort_unstable();

    // Sort entries within each column by row.
    for entries in col_runs.values_mut() {
        entries.sort_unstable_by_key(|&(row, _)| row);
    }

    // 4. Classify each column and collect ranges + ranged cell indices.
    let mut range_data: Vec<RangeData> = Vec::new();
    let mut ranged_cell_indices: FxHashSet<usize> = FxHashSet::default();

    for col in &sorted_cols {
        if let Some(entries) = col_runs.get(col) {
            classify_column(
                *col,
                entries,
                &sheet.cells,
                sheet_row_ids,
                sheet_col_ids,
                allocator,
                &mut range_data,
                &mut ranged_cell_indices,
            );
        }
    }

    // 5. Remove ranged cells from sheet.cells using swap_remove in reverse order.
    if !ranged_cell_indices.is_empty() {
        let mut indices: Vec<usize> = ranged_cell_indices.into_iter().collect();
        indices.sort_unstable();
        // Remove from the end so swap_remove doesn't invalidate earlier indices.
        for &idx in indices.iter().rev() {
            sheet.cells.swap_remove(idx);
        }
    }

    // 6. Attach ranges to the sheet.
    sheet.ranges = range_data;
}

// ---------------------------------------------------------------------------
// Per-column classification
// ---------------------------------------------------------------------------

/// Scan a single column's sorted entries and emit `RangeData` for qualifying runs.
fn classify_column(
    col: u32,
    entries: &[(u32, usize)],
    cells: &[CellData],
    sheet_row_ids: &[RowId],
    sheet_col_ids: &[ColId],
    allocator: &mut DefaultIdAllocator,
    range_data: &mut Vec<RangeData>,
    ranged_cell_indices: &mut FxHashSet<usize>,
) {
    if entries.is_empty() {
        return;
    }

    // Current run accumulator.
    let mut run: Vec<RunEntry> = Vec::new();
    let mut run_kind = RunKind::Numeric;
    let mut numeric_state = NumericRunState::new();

    for &(row, cell_idx) in entries {
        let value = &cells[cell_idx].value;

        match classify_value(value) {
            ValueClass::PromotableInt => {
                // Compatible with both F64 and I64 runs.
                if matches!(run_kind, RunKind::Mixed) && !run.is_empty() {
                    // Flush the mixed run, start a numeric one.
                    flush_run(
                        &run,
                        RunKind::Mixed,
                        &numeric_state,
                        col,
                        cells,
                        sheet_row_ids,
                        sheet_col_ids,
                        allocator,
                        range_data,
                        ranged_cell_indices,
                    );
                    run.clear();
                    numeric_state = NumericRunState::new();
                }
                run_kind = RunKind::Numeric;
                run.push(RunEntry { row, cell_idx });
            }
            ValueClass::LargeInt => {
                // I64 only. Incompatible with a run that has pure f64 values.
                if matches!(run_kind, RunKind::Mixed) && !run.is_empty() {
                    flush_run(
                        &run,
                        RunKind::Mixed,
                        &numeric_state,
                        col,
                        cells,
                        sheet_row_ids,
                        sheet_col_ids,
                        allocator,
                        range_data,
                        ranged_cell_indices,
                    );
                    run.clear();
                    numeric_state = NumericRunState::new();
                }
                if numeric_state.has_pure_f64 {
                    // Flush the current numeric run (it was F64-affinity),
                    // start a fresh I64 run.
                    flush_run(
                        &run,
                        RunKind::Numeric,
                        &numeric_state,
                        col,
                        cells,
                        sheet_row_ids,
                        sheet_col_ids,
                        allocator,
                        range_data,
                        ranged_cell_indices,
                    );
                    run.clear();
                    numeric_state = NumericRunState::new();
                }
                run_kind = RunKind::Numeric;
                numeric_state.has_large_i64 = true;
                run.push(RunEntry { row, cell_idx });
            }
            ValueClass::PureF64 => {
                // F64 only. Incompatible with a run that has large integers.
                if matches!(run_kind, RunKind::Mixed) && !run.is_empty() {
                    flush_run(
                        &run,
                        RunKind::Mixed,
                        &numeric_state,
                        col,
                        cells,
                        sheet_row_ids,
                        sheet_col_ids,
                        allocator,
                        range_data,
                        ranged_cell_indices,
                    );
                    run.clear();
                    numeric_state = NumericRunState::new();
                }
                if numeric_state.has_large_i64 {
                    // Flush the current I64 run, start a fresh F64 run.
                    flush_run(
                        &run,
                        RunKind::Numeric,
                        &numeric_state,
                        col,
                        cells,
                        sheet_row_ids,
                        sheet_col_ids,
                        allocator,
                        range_data,
                        ranged_cell_indices,
                    );
                    run.clear();
                    numeric_state = NumericRunState::new();
                }
                run_kind = RunKind::Numeric;
                numeric_state.has_pure_f64 = true;
                run.push(RunEntry { row, cell_idx });
            }
            ValueClass::NonNumeric => {
                // Breaks any numeric run. Joins/starts a Mixed run.
                if matches!(run_kind, RunKind::Numeric) && !run.is_empty() {
                    flush_run(
                        &run,
                        RunKind::Numeric,
                        &numeric_state,
                        col,
                        cells,
                        sheet_row_ids,
                        sheet_col_ids,
                        allocator,
                        range_data,
                        ranged_cell_indices,
                    );
                    run.clear();
                    numeric_state = NumericRunState::new();
                }
                run_kind = RunKind::Mixed;
                run.push(RunEntry { row, cell_idx });
            }
        }
    }

    // Flush any remaining run.
    if !run.is_empty() {
        flush_run(
            &run,
            run_kind,
            &numeric_state,
            col,
            cells,
            sheet_row_ids,
            sheet_col_ids,
            allocator,
            range_data,
            ranged_cell_indices,
        );
    }
}

// ---------------------------------------------------------------------------
// Value classification
// ---------------------------------------------------------------------------

/// Classification of a single `CellValue` for run-encoding purposes.
#[derive(Clone, Copy, Debug)]
enum ValueClass {
    /// Integer within +-2^53 — compatible with both F64Le and I64Le.
    PromotableInt,
    /// Integer outside +-2^53 — I64Le only.
    LargeInt,
    /// Non-integer Number — F64Le only.
    PureF64,
    /// Text, Boolean, Error, Null, Array, Control — MixedCbor only.
    NonNumeric,
}

fn classify_value(value: &CellValue) -> ValueClass {
    match value {
        CellValue::Number(f) => {
            let v: f64 = **f;
            // Check if the value is an exact integer representable as i64.
            if v == v.floor() && v >= i64::MIN as f64 && v < (i64::MAX as f64) {
                // It's an integer. Check if it's within the safe +-2^53 range
                // for exact f64 representation.
                if v.abs() <= MAX_SAFE_F64_INT {
                    ValueClass::PromotableInt
                } else {
                    ValueClass::LargeInt
                }
            } else {
                ValueClass::PureF64
            }
        }
        _ => ValueClass::NonNumeric,
    }
}

// ---------------------------------------------------------------------------
// Run flushing
// ---------------------------------------------------------------------------

/// Flush a completed run: check threshold and emit `RangeData` if met.
fn flush_run(
    run: &[RunEntry],
    kind: RunKind,
    numeric_state: &NumericRunState,
    col: u32,
    cells: &[CellData],
    sheet_row_ids: &[RowId],
    sheet_col_ids: &[ColId],
    allocator: &mut DefaultIdAllocator,
    range_data: &mut Vec<RangeData>,
    ranged_cell_indices: &mut FxHashSet<usize>,
) {
    if run.is_empty() {
        return;
    }

    if matches!(kind, RunKind::Mixed)
        && run
            .iter()
            .all(|entry| is_empty_null_cell(&cells[entry.cell_idx]))
    {
        return;
    }

    let (encoding, threshold) = match kind {
        RunKind::Numeric => {
            let enc = numeric_state.encoding();
            let thresh = match enc {
                PayloadEncoding::None => return,
                PayloadEncoding::F64Le => F64_THRESHOLD,
                PayloadEncoding::I64Le => I64_THRESHOLD,
                PayloadEncoding::MixedCbor => MIXED_CBOR_THRESHOLD,
            };
            (enc, thresh)
        }
        RunKind::Mixed => (PayloadEncoding::MixedCbor, MIXED_CBOR_THRESHOLD),
    };

    if run.len() < threshold {
        return; // Too short — cells stay per-cell.
    }

    // Encode payload.
    let payload = encode_payload(encoding, run, cells);

    // Build row_ids for the range.
    let row_ids: Vec<RowId> = run
        .iter()
        .map(|entry| sheet_row_ids[entry.row as usize])
        .collect();

    let first_row = run.first().unwrap().row;
    let last_row = run.last().unwrap().row;

    let col_id = sheet_col_ids[col as usize];

    let rd = RangeData {
        range_id: allocator.alloc_range_id(),
        kind: RangeKind::Data,
        anchor: RangeAnchor::Elastic {
            start_row: sheet_row_ids[first_row as usize],
            end_row: sheet_row_ids[last_row as usize],
            start_col: col_id,
            end_col: col_id,
        },
        encoding,
        payload,
        row_axis: None,
        col_axis: None,
        row_ids,
        col_ids: vec![col_id],
    };

    range_data.push(rd);

    // Mark these cell indices for removal.
    for entry in run {
        if !is_empty_null_cell(&cells[entry.cell_idx]) {
            ranged_cell_indices.insert(entry.cell_idx);
        }
    }
}

fn is_empty_null_cell(cell: &CellData) -> bool {
    matches!(cell.value, CellValue::Null)
        && cell.formula.is_none()
        && cell.identity_formula.is_none()
}

// ---------------------------------------------------------------------------
// Payload encoding
// ---------------------------------------------------------------------------

fn encode_payload(encoding: PayloadEncoding, run: &[RunEntry], cells: &[CellData]) -> Vec<u8> {
    match encoding {
        PayloadEncoding::None => Vec::new(),
        PayloadEncoding::F64Le => encode_f64le(run, cells),
        PayloadEncoding::I64Le => encode_i64le(run, cells),
        PayloadEncoding::MixedCbor => encode_mixed_cbor(run, cells),
    }
}

/// Encode all values as little-endian f64 (8 bytes each).
fn encode_f64le(run: &[RunEntry], cells: &[CellData]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(run.len() * 8);
    for entry in run {
        let f: f64 = match &cells[entry.cell_idx].value {
            CellValue::Number(v) => **v,
            // Shouldn't happen in a numeric run, but be defensive.
            _ => 0.0,
        };
        payload.extend_from_slice(&f.to_le_bytes());
    }
    payload
}

/// Encode all values as little-endian i64 (8 bytes each).
fn encode_i64le(run: &[RunEntry], cells: &[CellData]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(run.len() * 8);
    for entry in run {
        let i: i64 = match &cells[entry.cell_idx].value {
            CellValue::Number(v) => {
                let f: f64 = **v;
                // Safe: we verified these are exact integers during classification.
                f as i64
            }
            _ => 0,
        };
        payload.extend_from_slice(&i.to_le_bytes());
    }
    payload
}

/// Encode heterogeneous values with a tag-length-value scheme.
///
/// Wire format per entry:
/// - `0x00` — Null (1 byte total)
/// - `0x01` + 8-byte LE f64 — Number (9 bytes total)
/// - `0x02` + 4-byte LE u32 length + UTF-8 bytes — Text
/// - `0x03` + 1-byte (0 or 1) — Boolean
/// - `0x04` + 1-byte error discriminant — Error
///
/// Array and Control variants are encoded as Null (tag 0x00) since they are
/// not expected in import data; the mirror can refine this in a later phase.
fn encode_mixed_cbor(run: &[RunEntry], cells: &[CellData]) -> Vec<u8> {
    let mut payload = Vec::new();
    for entry in run {
        let value = &cells[entry.cell_idx].value;
        match value {
            CellValue::Null => {
                payload.push(0x00);
            }
            CellValue::Number(f) => {
                payload.push(0x01);
                payload.extend_from_slice(&(**f).to_le_bytes());
            }
            CellValue::Text(s) => {
                payload.push(0x02);
                let bytes = s.as_bytes();
                payload.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                payload.extend_from_slice(bytes);
            }
            CellValue::Boolean(b) => {
                payload.push(0x03);
                payload.push(u8::from(*b));
            }
            CellValue::Error(err, _) => {
                payload.push(0x04);
                payload.push(error_discriminant(*err));
            }
            CellValue::Array(_) | CellValue::Control(_) | CellValue::Image(_) => {
                // Treat as null for now — these are not expected in import data.
                payload.push(0x00);
            }
        }
    }
    payload
}

/// Map `CellError` variants to stable discriminant bytes for wire encoding.
fn error_discriminant(err: CellError) -> u8 {
    match err {
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::infra::hydration::IdAllocator;

    fn make_cell(row: u32, col: u32, value: CellValue) -> CellData {
        CellData {
            cell_id: format!("cell_r{row}_c{col}"),
            row,
            col,
            value,
            formula: None,
            identity_formula: None,
            array_ref: None,
        }
    }

    fn make_sheet(cells: Vec<CellData>, rows: u32, cols: u32) -> SheetSnapshot {
        SheetSnapshot {
            id: "test_sheet".into(),
            name: "Sheet1".into(),
            rows,
            cols,
            cells,
            ranges: vec![],
        }
    }

    fn alloc_ids(allocator: &mut DefaultIdAllocator, count: u32) -> (Vec<RowId>, Vec<ColId>) {
        let row_ids: Vec<RowId> = (0..count).map(|_| allocator.alloc_row_id()).collect();
        let col_ids: Vec<ColId> = (0..count).map(|_| allocator.alloc_col_id()).collect();
        (row_ids, col_ids)
    }

    fn run_classifier(
        sheet: &mut SheetSnapshot,
        row_ids: &[RowId],
        col_ids: &[ColId],
        allocator: &mut DefaultIdAllocator,
    ) {
        let sheet_data = SheetData::default();
        let snapshot = WorkbookSnapshot::default();
        classify_sheet_ranges(
            sheet,
            &sheet_data,
            &snapshot,
            None,
            row_ids,
            col_ids,
            allocator,
        );
    }

    // -----------------------------------------------------------------------
    // Gate 2: Threshold boundary
    // -----------------------------------------------------------------------

    #[test]
    fn f64_below_threshold_no_range() {
        let n = F64_THRESHOLD - 1;
        let cells: Vec<CellData> = (0..n)
            .map(|i| make_cell(i as u32, 0, CellValue::number(i as f64 + 0.5)))
            .collect();
        let mut sheet = make_sheet(cells, n as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, n as u32);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        assert!(sheet.ranges.is_empty());
        assert_eq!(sheet.cells.len(), n);
    }

    #[test]
    fn f64_at_threshold_creates_range() {
        let n = F64_THRESHOLD;
        let cells: Vec<CellData> = (0..n)
            .map(|i| make_cell(i as u32, 0, CellValue::number(i as f64 + 0.5)))
            .collect();
        let mut sheet = make_sheet(cells, n as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, n as u32);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        assert_eq!(sheet.ranges.len(), 1);
        assert_eq!(sheet.ranges[0].encoding, PayloadEncoding::F64Le);
        assert!(sheet.cells.is_empty());
    }

    #[test]
    fn i64_below_threshold_no_range() {
        let n = I64_THRESHOLD - 1;
        let large = (1i64 << 53) + 1;
        let cells: Vec<CellData> = (0..n)
            .map(|i| make_cell(i as u32, 0, CellValue::number((large + i as i64) as f64)))
            .collect();
        let mut sheet = make_sheet(cells, n as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, n as u32);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        assert!(sheet.ranges.is_empty());
        assert_eq!(sheet.cells.len(), n);
    }

    #[test]
    fn i64_at_threshold_creates_range() {
        let n = I64_THRESHOLD;
        let large = (1i64 << 53) + 1;
        let cells: Vec<CellData> = (0..n)
            .map(|i| make_cell(i as u32, 0, CellValue::number((large + i as i64) as f64)))
            .collect();
        let mut sheet = make_sheet(cells, n as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, n as u32);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        assert_eq!(sheet.ranges.len(), 1);
        assert_eq!(sheet.ranges[0].encoding, PayloadEncoding::I64Le);
        assert!(sheet.cells.is_empty());
    }

    #[test]
    fn mixed_cbor_below_threshold_no_range() {
        let n = MIXED_CBOR_THRESHOLD - 1;
        let cells: Vec<CellData> = (0..n)
            .map(|i| make_cell(i as u32, 0, CellValue::Text(format!("text_{i}").into())))
            .collect();
        let mut sheet = make_sheet(cells, n as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, n as u32);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        assert!(sheet.ranges.is_empty());
        assert_eq!(sheet.cells.len(), n);
    }

    #[test]
    fn mixed_cbor_at_threshold_creates_range() {
        let n = MIXED_CBOR_THRESHOLD;
        let cells: Vec<CellData> = (0..n)
            .map(|i| make_cell(i as u32, 0, CellValue::Text(format!("text_{i}").into())))
            .collect();
        let mut sheet = make_sheet(cells, n as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, n as u32);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        assert_eq!(sheet.ranges.len(), 1);
        assert_eq!(sheet.ranges[0].encoding, PayloadEncoding::MixedCbor);
        assert!(sheet.cells.is_empty());
    }

    // -----------------------------------------------------------------------
    // Gate 6: Encoding promotion
    // -----------------------------------------------------------------------

    #[test]
    fn promotable_int_and_f64_classified_as_f64le() {
        let n = F64_THRESHOLD;
        let cells: Vec<CellData> = (0..n)
            .map(|i| {
                let value = if i % 2 == 0 {
                    CellValue::number(42.0)
                } else {
                    CellValue::number(3.14)
                };
                make_cell(i as u32, 0, value)
            })
            .collect();
        let mut sheet = make_sheet(cells, n as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, n as u32);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        assert_eq!(sheet.ranges.len(), 1);
        assert_eq!(sheet.ranges[0].encoding, PayloadEncoding::F64Le);
    }

    #[test]
    fn large_integers_only_classified_as_i64le() {
        let n = I64_THRESHOLD;
        let large = (1i64 << 53) + 1;
        let cells: Vec<CellData> = (0..n)
            .map(|i| make_cell(i as u32, 0, CellValue::number((large + i as i64) as f64)))
            .collect();
        let mut sheet = make_sheet(cells, n as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, n as u32);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        assert_eq!(sheet.ranges.len(), 1);
        assert_eq!(sheet.ranges[0].encoding, PayloadEncoding::I64Le);
    }

    #[test]
    fn f64_and_large_int_splits_into_separate_runs() {
        let half = F64_THRESHOLD;
        let total = half * 2;
        let large = (1i64 << 53) + 1;
        let cells: Vec<CellData> = (0..total)
            .map(|i| {
                let value = if i < half {
                    CellValue::number(3.14)
                } else {
                    CellValue::number((large + i as i64) as f64)
                };
                make_cell(i as u32, 0, value)
            })
            .collect();
        let mut sheet = make_sheet(cells, total as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, total as u32);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        assert_eq!(sheet.ranges.len(), 2);
        assert_eq!(sheet.ranges[0].encoding, PayloadEncoding::F64Le);
        assert_eq!(sheet.ranges[1].encoding, PayloadEncoding::I64Le);
    }

    // -----------------------------------------------------------------------
    // Gate 7: Empty cell handling (Null breaks numeric, joins MixedCbor)
    // -----------------------------------------------------------------------

    #[test]
    fn null_breaks_f64_run() {
        let run_len = F64_THRESHOLD;
        let mut cells = Vec::new();
        for i in 0..run_len {
            cells.push(make_cell(i as u32, 0, CellValue::number(i as f64 + 0.5)));
        }
        cells.push(make_cell(run_len as u32, 0, CellValue::Null));
        for i in 0..run_len {
            let row = (run_len + 1 + i) as u32;
            cells.push(make_cell(row, 0, CellValue::number(i as f64 + 0.5)));
        }
        let total_rows = (run_len * 2 + 1) as u32;
        let mut sheet = make_sheet(cells, total_rows, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, total_rows);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        let f64_ranges: Vec<_> = sheet
            .ranges
            .iter()
            .filter(|r| r.encoding == PayloadEncoding::F64Le)
            .collect();
        assert_eq!(
            f64_ranges.len(),
            2,
            "Null should split into two F64Le sub-runs"
        );
        for r in &f64_ranges {
            assert_eq!(r.payload.len(), run_len * 8);
        }
    }

    #[test]
    fn null_breaks_i64_run() {
        let run_len = I64_THRESHOLD;
        let large = (1i64 << 53) + 1;
        let mut cells = Vec::new();
        for i in 0..run_len {
            cells.push(make_cell(
                i as u32,
                0,
                CellValue::number((large + i as i64) as f64),
            ));
        }
        cells.push(make_cell(run_len as u32, 0, CellValue::Null));
        for i in 0..run_len {
            let row = (run_len + 1 + i) as u32;
            cells.push(make_cell(
                row,
                0,
                CellValue::number((large + i as i64) as f64),
            ));
        }
        let total_rows = (run_len * 2 + 1) as u32;
        let mut sheet = make_sheet(cells, total_rows, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, total_rows);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        let i64_ranges: Vec<_> = sheet
            .ranges
            .iter()
            .filter(|r| r.encoding == PayloadEncoding::I64Le)
            .collect();
        assert_eq!(
            i64_ranges.len(),
            2,
            "Null should split into two I64Le sub-runs"
        );
        for r in &i64_ranges {
            assert_eq!(r.payload.len(), run_len * 8);
        }
    }

    #[test]
    fn null_joins_mixed_cbor_run() {
        let n = MIXED_CBOR_THRESHOLD;
        let cells: Vec<CellData> = (0..n)
            .map(|i| {
                if i % 10 == 0 {
                    make_cell(i as u32, 0, CellValue::Null)
                } else {
                    make_cell(i as u32, 0, CellValue::Text(format!("val_{i}").into()))
                }
            })
            .collect();
        let mut sheet = make_sheet(cells, n as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, n as u32);
        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);
        assert_eq!(sheet.ranges.len(), 1, "Null should NOT break MixedCbor run");
        assert_eq!(sheet.ranges[0].encoding, PayloadEncoding::MixedCbor);
        let null_tag_count = sheet.ranges[0]
            .payload
            .iter()
            .enumerate()
            .filter(|&(pos, &byte)| byte == 0x00 && is_tag_position(&sheet.ranges[0].payload, pos))
            .count();
        let expected_nulls = (0..n).filter(|i| i % 10 == 0).count();
        assert_eq!(null_tag_count, expected_nulls);
        assert_eq!(sheet.cells.len(), expected_nulls);
        assert!(sheet.cells.iter().all(|c| c.value == CellValue::Null));
    }

    #[test]
    fn null_only_run_does_not_create_mixed_cbor_range() {
        let n = MIXED_CBOR_THRESHOLD;
        let cells: Vec<CellData> = (0..n)
            .map(|i| make_cell(i as u32, 0, CellValue::Null))
            .collect();
        let mut sheet = make_sheet(cells, n as u32, 1);
        let mut allocator = DefaultIdAllocator::new();
        let (row_ids, col_ids) = alloc_ids(&mut allocator, n as u32);

        run_classifier(&mut sheet, &row_ids, &col_ids, &mut allocator);

        assert!(
            sheet.ranges.is_empty(),
            "Null-only placeholder runs should not be promoted"
        );
        assert_eq!(sheet.cells.len(), n);
    }

    /// Walk the MixedCbor payload to check whether `pos` is a tag byte position.
    fn is_tag_position(payload: &[u8], target: usize) -> bool {
        let mut cursor = 0;
        while cursor < payload.len() {
            if cursor == target {
                return true;
            }
            match payload[cursor] {
                0x00 => cursor += 1,
                0x01 => cursor += 9,
                0x02 => {
                    if cursor + 5 > payload.len() {
                        return false;
                    }
                    let len =
                        u32::from_le_bytes(payload[cursor + 1..cursor + 5].try_into().unwrap())
                            as usize;
                    cursor += 5 + len;
                }
                0x03 => cursor += 2,
                0x04 => cursor += 2,
                _ => return false,
            }
        }
        false
    }

    // -----------------------------------------------------------------------
    // Gate 9: Classification determinism
    // -----------------------------------------------------------------------

    #[test]
    fn deterministic_output() {
        let n = F64_THRESHOLD + MIXED_CBOR_THRESHOLD;
        let build_cells = || -> Vec<CellData> {
            let mut cells = Vec::new();
            for i in 0..F64_THRESHOLD {
                cells.push(make_cell(i as u32, 0, CellValue::number(i as f64 * 1.1)));
            }
            for i in 0..MIXED_CBOR_THRESHOLD {
                let row = (F64_THRESHOLD + i) as u32;
                cells.push(make_cell(row, 0, CellValue::Text(format!("s{i}").into())));
            }
            for i in 0..F64_THRESHOLD {
                cells.push(make_cell(i as u32, 1, CellValue::number(i as f64 + 0.5)));
            }
            cells
        };

        let max_rows = n as u32;
        let cols = 2u32;

        let mut sheet1 = make_sheet(build_cells(), max_rows, cols);
        let mut alloc1 = DefaultIdAllocator::new();
        let (rows1, cols1) = alloc_ids(&mut alloc1, max_rows);
        run_classifier(&mut sheet1, &rows1, &cols1, &mut alloc1);

        let mut sheet2 = make_sheet(build_cells(), max_rows, cols);
        let mut alloc2 = DefaultIdAllocator::new();
        let (rows2, cols2) = alloc_ids(&mut alloc2, max_rows);
        run_classifier(&mut sheet2, &rows2, &cols2, &mut alloc2);

        assert_eq!(sheet1.ranges.len(), sheet2.ranges.len());
        for (r1, r2) in sheet1.ranges.iter().zip(sheet2.ranges.iter()) {
            assert_eq!(r1.encoding, r2.encoding);
            assert_eq!(r1.payload, r2.payload);
            assert_eq!(r1.row_ids, r2.row_ids);
            assert_eq!(r1.col_ids, r2.col_ids);
            assert_eq!(r1.anchor, r2.anchor);
        }
        assert_eq!(sheet1.cells.len(), sheet2.cells.len());
    }
}
