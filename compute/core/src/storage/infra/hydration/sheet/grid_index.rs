use std::collections::HashSet;
use std::sync::Arc;

use cell_types::CellId;
use compute_document::hex::{SmallHex, id_to_hex};
use value_types::ComputeError;
use yrs::{Any, Map, MapRef};

use crate::storage::infra::hydration::helpers::PositionMap;

pub(crate) fn mirror_pos_map_into_grid_index(
    txn: &mut yrs::TransactionMut,
    pos_to_id: &MapRef,
    id_to_pos: &MapRef,
    pos_map: &PositionMap,
    row_id_hexes: &[SmallHex],
    col_id_hexes: &[SmallHex],
    required_positions: &HashSet<(u32, u32)>,
) -> Result<(), ComputeError> {
    for (&(row, col), cell_hex) in pos_map {
        let (Some(rh), Some(ch)) = (
            row_id_hexes.get(row as usize),
            col_id_hexes.get(col as usize),
        ) else {
            if required_positions.contains(&(row, col)) {
                return Err(ComputeError::Deserialize {
                    message: format!(
                        "metadata anchor identity at row {row} col {col} is missing row/col identity"
                    ),
                });
            }
            continue;
        };
        let yrs_pos_key = format!("{}:{}", rh, ch);
        pos_to_id.insert(
            txn,
            yrs_pos_key.as_str(),
            Any::String(Arc::from(cell_hex.as_str())),
        );
        id_to_pos.insert(
            txn,
            cell_hex.as_str(),
            Any::String(Arc::from(yrs_pos_key.as_str())),
        );
    }
    Ok(())
}

pub(crate) fn collect_physical_phantom_cells(
    pos_map: &PositionMap,
    data_cell_ids: &[CellId],
    identity_only_cells: &[(CellId, u32, u32)],
) -> Vec<(CellId, u32, u32)> {
    let data_cell_hexes: HashSet<SmallHex> = data_cell_ids
        .iter()
        .map(|cid| id_to_hex(cid.as_u128()))
        .collect();
    let identity_only_hexes: HashSet<SmallHex> = identity_only_cells
        .iter()
        .map(|(cid, _, _)| id_to_hex(cid.as_u128()))
        .collect();

    pos_map
        .iter()
        .filter(|(_pos_key, cell_hex)| !data_cell_hexes.contains(cell_hex.as_str()))
        .filter(|(_pos_key, cell_hex)| !identity_only_hexes.contains(cell_hex.as_str()))
        .filter_map(|(&(row, col), cell_hex)| {
            let raw_id = compute_document::hex::hex_to_id(cell_hex)?;
            Some((CellId::from_raw(raw_id), row, col))
        })
        .collect()
}
