use std::collections::HashSet;

use cell_types::CellId;
use compute_document::hex::{SmallHex, id_to_hex};

use crate::storage::infra::hydration::helpers::PositionMap;

pub(crate) fn collect_identity_cells(
    pos_map: &PositionMap,
    cells: &[domain_types::CellData],
    data_cell_ids: &[CellId],
    ranged_positions: &HashSet<(u32, u32)>,
) -> Vec<(CellId, u32, u32)> {
    let data_cell_hexes: HashSet<SmallHex> = cells
        .iter()
        .zip(data_cell_ids)
        .filter(|(cell, _)| {
            cell.formula.is_some() || !cell.value.is_null() || cell.original_value.is_some()
        })
        .map(|(_, cid)| id_to_hex(cid.as_u128()))
        .collect();
    let projection_identity_hexes: HashSet<SmallHex> = cells
        .iter()
        .zip(data_cell_ids)
        .filter(|(cell, _)| {
            cell.projection_role
                == domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget
        })
        .map(|(_, cid)| id_to_hex(cid.as_u128()))
        .collect();

    pos_map
        .iter()
        .filter(|(pos, cell_hex)| {
            ranged_positions.contains(pos)
                || projection_identity_hexes.contains(cell_hex.as_str())
                || !data_cell_hexes.contains(cell_hex.as_str())
        })
        .filter_map(|(&(row, col), cell_hex)| {
            let raw_id = compute_document::hex::hex_to_id(cell_hex)?;
            Some((CellId::from_raw(raw_id), row, col))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranged_feature_anchors_are_retained_as_sparse_identities() {
        let cell_id = CellId::from_raw(10);
        let pos_map = PositionMap::from([((4, 2), id_to_hex(cell_id.as_u128()).to_string())]);
        let identities = collect_identity_cells(
            &pos_map,
            &[domain_types::CellData {
                row: 4,
                col: 2,
                value: value_types::CellValue::number(7.0),
                ..Default::default()
            }],
            &[cell_id],
            &HashSet::from([(4, 2)]),
        );
        assert_eq!(identities, vec![(cell_id, 4, 2)]);
    }
}
