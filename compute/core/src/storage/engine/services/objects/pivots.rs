use crate::mirror::CellMirror;
use crate::snapshot::{ChangeKind, MutationResult, PivotTableChange};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::pivots;
use cell_types::SheetId;
use compute_pivot::PivotTableDefExt;
use domain_types::domain::pivot::PivotTableConfig;
use value_types::ComputeError;

pub(in crate::storage::engine) fn pivot_create_with_sheet_inner(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: PivotTableConfig,
) -> Result<PivotTableConfig, ComputeError> {
    pivots::create_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        &stores.id_alloc,
    )
}

// -------------------------------------------------------------------
// Comments (self-contained — no viewport patch calls)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn pivot_create(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: PivotTableConfig,
) -> Result<MutationResult, ComputeError> {
    let pivot_config = pivots::create_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
        &stores.id_alloc,
    )?;
    let mut result = MutationResult::empty();
    result.pivot_changes.push(PivotTableChange {
        sheet_id: sheet_id.to_uuid_string(),
        pivot_id: pivot_config.id.clone(),
        kind: ChangeKind::Set,
    });
    Ok(result.with_data(&pivot_config)?)
}

pub(in crate::storage::engine) fn pivot_update(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    pivot_id: &str,
    config: PivotTableConfig,
) -> Result<MutationResult, ComputeError> {
    let updated = pivots::update_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
        config,
    );
    let mut result = MutationResult::empty();
    if updated.is_some() {
        result.pivot_changes.push(PivotTableChange {
            sheet_id: sheet_id.to_uuid_string(),
            pivot_id: pivot_id.to_string(),
            kind: ChangeKind::Set,
        });
    }
    Ok(result.with_data(&updated)?)
}

pub(in crate::storage::engine) fn pivot_delete(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    pivot_id: &str,
) -> Result<MutationResult, ComputeError> {
    let deleted = pivots::delete_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
    );
    let mut result = MutationResult::empty();
    if deleted {
        result.pivot_changes.push(PivotTableChange {
            sheet_id: sheet_id.to_uuid_string(),
            pivot_id: pivot_id.to_string(),
            kind: ChangeKind::Removed,
        });
    }
    Ok(result.with_data(&deleted)?)
}

pub(in crate::storage::engine) fn pivot_get(
    stores: &EngineStores,
    sheet_id: &SheetId,
    pivot_id: &str,
) -> Option<PivotTableConfig> {
    pivots::get_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
    )
}

pub(in crate::storage::engine) fn pivot_get_all(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<PivotTableConfig> {
    pivots::get_all_pivots(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn pivot_register_def(
    stores: &EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    pivot_id: &str,
    total_rows: u32,
    total_cols: u32,
    first_data_row: u32,
    first_data_col: u32,
) -> Result<MutationResult, ComputeError> {
    let config = pivots::get_pivot(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        pivot_id,
    )
    .ok_or_else(|| ComputeError::Eval {
        message: format!("pivot_register_def: pivot {pivot_id} not found on sheet {sheet_id}"),
    })?;

    let bounds = compute_pivot::PivotRenderedBounds {
        total_rows,
        total_cols,
        first_data_row,
        first_data_col,
        num_data_cols: 0,
    };
    let output_sheet_id = mirror
        .sheet_by_name(&config.output_sheet_name)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: config.output_sheet_name.clone(),
        })?;

    let engine_config =
        compute_pivot::PivotEngineConfig::try_from(config).map_err(|e| ComputeError::Eval {
            message: format!("Pivot config conversion error: {e}"),
        })?;
    let def = engine_config.to_pivot_table_def(&bounds, &output_sheet_id);
    mirror.upsert_pivot_table_def(def);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn pivot_unregister_def(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    pivot_name: &str,
) -> Result<MutationResult, ComputeError> {
    let sheet_uuid = sheet_id.to_uuid_string();
    mirror.remove_pivot_table_def(pivot_name, &sheet_uuid);
    Ok(MutationResult::empty())
}
