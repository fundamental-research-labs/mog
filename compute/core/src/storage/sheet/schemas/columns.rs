use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::yrs_schema::column_schema;
use value_types::ComputeError;
use yrs::{Doc, Map, MapRef, Origin, Out, ReadTxn, Transact};

use super::ColumnSchema;
use super::yrs_io::get_schemas_map;
use crate::identity::GridIndex;

fn col_id_hex_to_position(gi: &GridIndex, col_id_hex: &str) -> Option<u32> {
    let raw = compute_document::hex::hex_to_id(col_id_hex)?;
    let cid = cell_types::ColId::from_raw(raw);
    gi.col_index(&cid)
}

fn read_column_schema_from_out<T: ReadTxn>(out: &Out, txn: &T) -> Option<ColumnSchema> {
    column_schema::column_from_yrs_out(out, txn)
}

fn write_column_schema(
    parent: &MapRef,
    txn: &mut yrs::TransactionMut,
    key: &str,
    cs: &ColumnSchema,
) {
    column_schema::write_column_schema(parent, txn, key, cs);
}

pub fn get_column_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col_index: u32,
    grid_index: Option<&GridIndex>,
) -> Option<ColumnSchema> {
    let col_id = id_to_hex(grid_index?.col_id(col_index)?.as_u128());
    let txn = doc.transact();
    let sm = get_schemas_map(&txn, sheets, sheet_id)?;
    let out = sm.get(&txn, &col_id)?;
    read_column_schema_from_out(&out, &txn)
}

pub fn set_column_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col_index: u32,
    schema: &ColumnSchema,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let col_id = grid_index
        .and_then(|gi| gi.col_id(col_index))
        .map(|cid| id_to_hex(cid.as_u128()))
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sm =
        get_schemas_map(&txn, sheets, sheet_id).ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
    write_column_schema(&sm, &mut txn, &col_id, schema);
    Ok(())
}

pub fn clear_column_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col_index: u32,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let col_id = match grid_index.and_then(|gi| gi.col_id(col_index)) {
        Some(cid) => id_to_hex(cid.as_u128()),
        None => return Ok(()),
    };
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(sm) = get_schemas_map(&txn, sheets, sheet_id) {
        sm.remove(&mut txn, &col_id);
    }
    Ok(())
}

pub fn get_all_column_schemas(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, ColumnSchema)> {
    let gi = match grid_index {
        Some(g) => g,
        None => return vec![],
    };
    let txn = doc.transact();
    let sm = match get_schemas_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (col_id, value) in sm.iter(&txn) {
        if let Some(schema) = read_column_schema_from_out(&value, &txn)
            && let Some(pos) = col_id_hex_to_position(gi, col_id)
        {
            result.push((pos, schema));
        }
    }
    result.sort_by_key(|(pos, _)| *pos);
    result
}
