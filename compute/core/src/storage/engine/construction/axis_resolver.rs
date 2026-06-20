use std::sync::Arc;

use cell_types::{AxisIdentityId, AxisIdentityStore, CellId, ColId, IdAllocator, RowId, SheetId};
use serde::de::DeserializeOwned;
use value_types::ComputeError;
use yrs::{Any, Array, Map, MapRef, Out, Transact};

use crate::identity::GridIndex;
use crate::storage::YrsStorage;
use crate::storage::infra::grid_helpers;

#[derive(Clone)]
pub(in crate::storage::engine) struct ResolvedSheetAxes {
    pub row_axis: AxisIdentityStore<RowId>,
    pub col_axis: AxisIdentityStore<ColId>,
    pub pos_to_id_entries: Vec<(String, String)>,
}

impl ResolvedSheetAxes {
    pub fn row_count(&self) -> u32 {
        self.row_axis.len()
    }

    pub fn col_count(&self) -> u32 {
        self.col_axis.len()
    }

    pub fn into_grid(self, sheet_id: SheetId, id_alloc: Arc<IdAllocator>) -> GridIndex {
        GridIndex::from_axis_stores(sheet_id, self.row_axis, self.col_axis, id_alloc)
    }
}

pub(in crate::storage::engine) fn resolve_sheet_axes_from_yrs(
    storage: &YrsStorage,
    sheet_id: SheetId,
) -> Result<Option<ResolvedSheetAxes>, ComputeError> {
    let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let Some(Out::YMap(sheet_map)) = storage.sheets().get(&txn, &sheet_hex) else {
        return Ok(None);
    };

    let grid_index_map = sheet_map
        .get(&txn, compute_document::schema::KEY_GRID_INDEX)
        .and_then(|out| match out {
            Out::YMap(grid_index_map) => Some(grid_index_map),
            _ => None,
        });

    let pos_to_id_entries = grid_index_map
        .as_ref()
        .and_then(|grid_index_map| {
            grid_index_map.get(&txn, compute_document::schema::KEY_GRID_POS_TO_ID)
        })
        .and_then(|out| match out {
            Out::YMap(pos_to_id) => Some(
                pos_to_id
                    .iter(&txn)
                    .filter_map(|(pos_key, value)| match value {
                        Out::Any(Any::String(cell_hex)) => {
                            Some((pos_key.to_string(), cell_hex.to_string()))
                        }
                        _ => None,
                    })
                    .collect::<Vec<_>>(),
            ),
            _ => None,
        })
        .unwrap_or_default();

    if let Some(grid_index_map) = grid_index_map.as_ref() {
        let row_axis = read_axis_store_strict::<RowId>(
            &txn,
            grid_index_map,
            compute_document::schema::KEY_GRID_ROW_AXIS,
            "row",
            sheet_id,
        )?;
        let col_axis = read_axis_store_strict::<ColId>(
            &txn,
            grid_index_map,
            compute_document::schema::KEY_GRID_COL_AXIS,
            "column",
            sheet_id,
        )?;

        match (row_axis, col_axis) {
            (Some(row_axis), Some(col_axis)) => {
                return Ok(Some(ResolvedSheetAxes {
                    row_axis,
                    col_axis,
                    pos_to_id_entries,
                }));
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err(ComputeError::Deserialize {
                    message: format!(
                        "sheet {} has asymmetric compact grid axes",
                        sheet_id.to_uuid_string()
                    ),
                });
            }
            (None, None) => {}
        }
    }

    let row_order = grid_helpers::get_row_order_array(&sheet_map, &txn)
        .map(|arr| read_axis_order::<RowId>(&txn, &arr, "row", sheet_id))
        .transpose()?;
    let col_order = grid_helpers::get_col_order_array(&sheet_map, &txn)
        .map(|arr| read_axis_order::<ColId>(&txn, &arr, "column", sheet_id))
        .transpose()?;

    match (row_order, col_order) {
        (Some(row_ids), Some(col_ids)) => Ok(Some(ResolvedSheetAxes {
            row_axis: AxisIdentityStore::Explicit(row_ids),
            col_axis: AxisIdentityStore::Explicit(col_ids),
            pos_to_id_entries,
        })),
        (None, None) => Ok(None),
        _ => Err(ComputeError::Deserialize {
            message: format!(
                "sheet {} has asymmetric dense grid axes",
                sheet_id.to_uuid_string()
            ),
        }),
    }
}

pub(in crate::storage::engine) fn register_pos_to_id_entries(
    storage: &YrsStorage,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    entries: Vec<(String, String)>,
) -> Result<(), ComputeError> {
    for (pos_key, cell_hex) in entries {
        let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
            continue;
        };
        let Some(cell_raw) = compute_document::hex::hex_to_id(&cell_hex) else {
            continue;
        };
        let cell_id = CellId::from_raw(cell_raw);
        let (Some(row), Some(col)) = (
            grid.row_index_from_hex(row_hex),
            grid.col_index_from_hex(col_hex),
        ) else {
            if storage
                .read_cell_from_yrs_full(&sheet_id, &cell_id)
                .is_some()
            {
                return Err(ComputeError::Deserialize {
                    message: format!(
                        "sheet {} posToId entry {pos_key} for cell {} does not resolve through sheet axes",
                        sheet_id.to_uuid_string(),
                        cell_id.to_uuid_string(),
                    ),
                });
            }
            continue;
        };
        grid.register_cell(cell_id, row, col);
    }
    Ok(())
}

fn read_axis_store_strict<Id>(
    txn: &impl yrs::ReadTxn,
    grid_index: &MapRef,
    key: &str,
    axis_name: &str,
    sheet_id: SheetId,
) -> Result<Option<AxisIdentityStore<Id>>, ComputeError>
where
    Id: DeserializeOwned,
{
    let Some(out) = grid_index.get(txn, key) else {
        return Ok(None);
    };
    let Out::Any(Any::String(json)) = out else {
        return Err(ComputeError::Deserialize {
            message: format!(
                "sheet {} has non-string {axis_name} compact axis payload",
                sheet_id.to_uuid_string()
            ),
        });
    };
    serde_json::from_str(json.as_ref())
        .map(Some)
        .map_err(|err| ComputeError::Deserialize {
            message: format!(
                "sheet {} has malformed {axis_name} compact axis payload: {err}",
                sheet_id.to_uuid_string()
            ),
        })
}

fn read_axis_order<Id>(
    txn: &impl yrs::ReadTxn,
    arr: &yrs::ArrayRef,
    axis_name: &str,
    sheet_id: SheetId,
) -> Result<Vec<Id>, ComputeError>
where
    Id: AxisIdentityId,
{
    let len = arr.len(txn);
    let mut ids = Vec::with_capacity(len as usize);
    for index in 0..len {
        let Some(Out::Any(Any::String(hex))) = arr.get(txn, index) else {
            return Err(ComputeError::Deserialize {
                message: format!(
                    "sheet {} has non-string {axis_name} identity at index {index}",
                    sheet_id.to_uuid_string()
                ),
            });
        };
        let Some(raw) = compute_document::hex::hex_to_id(hex.as_ref()) else {
            return Err(ComputeError::Deserialize {
                message: format!(
                    "sheet {} has invalid {axis_name} identity hex at index {index}: {hex}",
                    sheet_id.to_uuid_string()
                ),
            });
        };
        ids.push(Id::from_compact_raw(raw));
    }
    Ok(ids)
}
