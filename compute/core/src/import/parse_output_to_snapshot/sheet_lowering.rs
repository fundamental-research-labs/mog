//! Sheet-level lowering: cells + iterative-calc settings.

use std::collections::{HashMap, HashSet};

use domain_types::{CalculationProperties, ImportedCellProjectionRole, SheetData};
use snapshot_types::{CellData as SnapshotCellData, SheetSnapshot};
use value_types::CellValue;

use crate::import::phantom::parse_cell_ref;
use crate::storage::infra::hydration::HydrationIdMap;

#[inline]
fn u128_to_hex32(val: u128) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut buf = [0u8; 32];
    for i in 0..32 {
        buf[31 - i] = HEX[((val >> (i * 4)) & 0xF) as usize];
    }
    String::from_utf8(buf.to_vec()).expect("u128_to_hex32 writes only ASCII hex digits")
}

pub(crate) fn convert_sheets(
    sheets: &[SheetData],
    id_map: Option<&HydrationIdMap>,
) -> Vec<SheetSnapshot> {
    sheets
        .iter()
        .enumerate()
        .map(|(sheet_idx, sheet)| {
            // Use hydration-allocated SheetId when available, otherwise
            // generate a fast monotonic ID (no getentropy syscall).
            let sheet_uuid = match id_map {
                Some(map) => u128_to_hex32(map.sheet_ids[sheet_idx].as_u128()),
                None => u128_to_hex32(crate::storage::STORAGE_ID_ALLOC.next_u128()),
            };

            // Build row/col default style lookups for redundancy filtering.
            let row_default_style: HashMap<u32, u32> = sheet
                .row_styles
                .iter()
                .map(|rs| (rs.row, rs.style_id))
                .collect();
            let col_default_style: HashMap<u32, u32> = sheet
                .col_styles
                .iter()
                .map(|cs| (cs.col, cs.style_id))
                .collect();

            let mut cells: Vec<SnapshotCellData> = sheet
                .cells
                .iter()
                .enumerate()
                .filter_map(|(cell_idx, cell)| {
                    // Skip only parser-proven dynamic array spill targets.
                    if cell.projection_role == ImportedCellProjectionRole::DynamicArraySpillTarget {
                        return None;
                    }

                    // Skip empty cells whose style is redundant with row/col
                    // defaults. Cells with a style that differs from the
                    // positional default must be kept so their CellId is
                    // allocated and cell-level properties are hydrated.
                    if cell.formula.is_none()
                        && matches!(cell.value, CellValue::Null)
                        && cell.original_value.is_none()
                    {
                        let cell_sid = cell.style_id.unwrap_or(0);
                        let row_sid = row_default_style.get(&cell.row).copied().unwrap_or(0);
                        let col_sid = col_default_style.get(&cell.col).copied().unwrap_or(0);
                        let positional_sid = if row_sid != 0 { row_sid } else { col_sid };
                        if cell_sid == positional_sid {
                            return None;
                        }
                    }

                    let cell_uuid = match id_map {
                        Some(map) => u128_to_hex32(map.cell_ids[sheet_idx][cell_idx].as_u128()),
                        None => u128_to_hex32(crate::storage::STORAGE_ID_ALLOC.next_u128()),
                    };
                    Some(SnapshotCellData {
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

            // Inject synthetic cells for comment targets on empty positions.
            // Comments in XLSX reference a cell_ref (A1 notation). If the target
            // cell has no data, it won't appear in ParseOutput.cells, and the
            // comment will be orphaned during hydration. We create a Null-valued
            // placeholder cell so the comment has something to attach to.
            //
            // Skip injection when id_map is present (hydration path) — hydration
            // preallocates metadata-only identities for comment targets, and we
            // must not introduce a second CellId for the same position.
            if id_map.is_none() {
                let mut occupied: HashSet<(u32, u32)> =
                    cells.iter().map(|c| (c.row, c.col)).collect();
                for comment in &sheet.comments {
                    if let Some((row, col)) = parse_cell_ref(&comment.cell_ref)
                        && occupied.insert((row, col))
                    {
                        let cell_uuid =
                            format!("{:032x}", crate::storage::STORAGE_ID_ALLOC.next_u128());
                        cells.push(SnapshotCellData {
                            cell_id: cell_uuid,
                            row,
                            col,
                            value: CellValue::Null,
                            formula: None,
                            identity_formula: None,
                            array_ref: None,
                        });
                    }
                }
            }

            SheetSnapshot {
                id: sheet_uuid,
                name: sheet.name.clone(),
                rows: sheet.rows,
                cols: sheet.cols,
                cells,
                ranges: vec![],
            }
        })
        .collect()
}

pub(crate) fn convert_iterative_calc(
    settings: &CalculationProperties,
) -> (bool, u32, value_types::FiniteF64) {
    // Domain `iterate_delta` is bare f64 from XLSX parsing; if a malformed
    // file carries a non-finite delta, fall back to the Excel default rather
    // than panicking. This matches the policy in
    // `From<CalculationProperties> for CalculationSettings`.
    let max_change = value_types::FiniteF64::new(settings.iterate_delta)
        .unwrap_or_else(|| value_types::FiniteF64::must(0.001));
    (settings.iterate, settings.iterate_count, max_change)
}

#[cfg(test)]
mod tests {
    use super::u128_to_hex32;

    fn assert_hex32(s: &str) {
        assert_eq!(s.len(), 32);
        assert!(
            s.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        );
    }

    #[test]
    fn u128_to_hex32_preserves_width_and_lowercase_boundaries() {
        let zero = u128_to_hex32(0);
        assert_eq!(zero, "00000000000000000000000000000000");
        assert_hex32(&zero);

        let one = u128_to_hex32(1);
        assert_eq!(one, "00000000000000000000000000000001");
        assert_hex32(&one);

        let high_bit = u128_to_hex32(1u128 << 127);
        assert_eq!(high_bit, "80000000000000000000000000000000");
        assert_hex32(&high_bit);

        let max = u128_to_hex32(u128::MAX);
        assert_eq!(max, "ffffffffffffffffffffffffffffffff");
        assert_hex32(&max);
    }
}
