//! Custom cell style catalog in native workbook metadata.

use crate::storage::engine::history::metadata::capture_workbook_entry;
use domain_types::domain::cell_style::CellStyleDef;
use value_types::ComputeError;

use crate::snapshot::MutationResult;
use crate::storage::engine::stores::EngineStores;

pub(in crate::storage::engine) fn get_all_custom_cell_styles(
    stores: &EngineStores,
) -> Vec<CellStyleDef> {
    let mut result: Vec<_> = stores
        .storage
        .metadata
        .custom_cell_styles
        .values()
        .cloned()
        .collect();
    result.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    result
}

pub(in crate::storage::engine) fn create_custom_cell_style(
    stores: &mut EngineStores,
    style: CellStyleDef,
) -> Result<MutationResult, ComputeError> {
    let id = style.id.clone();
    capture_workbook_entry!(stores.storage, custom_cell_styles, id);
    stores
        .storage
        .metadata
        .custom_cell_styles
        .insert(id.clone(), style);
    Ok(MutationResult::empty().with_data(&id)?)
}

pub(in crate::storage::engine) fn delete_custom_cell_style(
    stores: &mut EngineStores,
    style_id: &str,
) -> Result<MutationResult, ComputeError> {
    capture_workbook_entry!(stores.storage, custom_cell_styles, style_id);
    stores.storage.metadata.custom_cell_styles.remove(style_id);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn update_custom_cell_style(
    stores: &mut EngineStores,
    style_id: &str,
    mut style: CellStyleDef,
) -> Result<MutationResult, ComputeError> {
    capture_workbook_entry!(stores.storage, custom_cell_styles, style_id);
    style.id = style_id.to_owned();
    stores
        .storage
        .metadata
        .custom_cell_styles
        .insert(style_id.to_owned(), style);
    Ok(MutationResult::empty())
}
