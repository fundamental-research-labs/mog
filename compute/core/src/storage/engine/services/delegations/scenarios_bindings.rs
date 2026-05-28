use crate::snapshot::{
    MutationResult, Scenario, ScenarioActiveState, ScenarioCreateInput, ScenarioUpdateInput,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::bindings;
use crate::what_if::scenarios;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use value_types::ComputeError;

// -------------------------------------------------------------------
// Scenarios
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn create_scenario(
    stores: &EngineStores,
    input: ScenarioCreateInput,
) -> Result<MutationResult, ComputeError> {
    let result = scenarios::create(&stores.storage, input, &stores.id_alloc);
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn update_scenario(
    stores: &EngineStores,
    scenario_id: &str,
    input: ScenarioUpdateInput,
) -> Result<MutationResult, ComputeError> {
    let result = scenarios::update(&stores.storage, scenario_id, input);
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn remove_scenario(
    stores: &EngineStores,
    scenario_id: &str,
) -> Result<MutationResult, ComputeError> {
    let result = scenarios::remove(&stores.storage, scenario_id);
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn get_all_scenarios(stores: &EngineStores) -> Vec<Scenario> {
    scenarios::get_all(&stores.storage)
}

pub(in crate::storage::engine) fn get_active_scenario_state(
    stores: &EngineStores,
    session: &scenarios::ScenarioSessionState,
) -> Option<ScenarioActiveState> {
    scenarios::active_state(&stores.storage, session)
}

pub(in crate::storage::engine) fn set_active_scenario(
    stores: &EngineStores,
    scenario_id: Option<&str>,
) -> Result<MutationResult, ComputeError> {
    scenarios::set_active_scenario_id(&stores.storage, scenario_id)?;
    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// Bindings
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn create_binding(
    stores: &EngineStores,
    sheet_id: &SheetId,
    binding: bindings::CreateBindingInput,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    let options = bindings::CreateBindingOptions {
        auto_generate_rows: binding.auto_generate_rows,
        header_row: binding.header_row,
        data_start_row: binding.data_start_row,
        preserve_header_formatting: binding.preserve_header_formatting,
    };
    let result = bindings::create_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        &sheet_id,
        &binding.connection_id,
        binding.column_mappings,
        options,
        &stores.id_alloc,
    )?;
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn update_binding(
    stores: &EngineStores,
    sheet_id: &SheetId,
    binding_id: &str,
    updates: bindings::UpdateBindingFields,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::update_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        &sheet_id,
        binding_id,
        updates,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn remove_binding(
    stores: &EngineStores,
    sheet_id: &SheetId,
    binding_id: &str,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::remove_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        &sheet_id,
        binding_id,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_all_bindings(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<bindings::SheetDataBinding> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::get_all_bindings(stores.storage.doc(), stores.storage.sheets(), &sheet_id)
}

pub(in crate::storage::engine) fn get_binding(
    stores: &EngineStores,
    sheet_id: &SheetId,
    binding_id: &str,
) -> Option<bindings::SheetDataBinding> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::get_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        &sheet_id,
        binding_id,
    )
}

pub(in crate::storage::engine) fn get_bindings_for_connection(
    stores: &EngineStores,
    connection_id: &str,
) -> Vec<bindings::SheetDataBinding> {
    bindings::get_bindings_for_connection(
        stores.storage.doc(),
        stores.storage.sheets(),
        connection_id,
    )
}

pub(in crate::storage::engine) fn update_refresh_metadata(
    stores: &EngineStores,
    sheet_id: &SheetId,
    binding_id: &str,
    last_refresh: i64,
    last_row_count: u32,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::update_refresh_metadata(
        stores.storage.doc(),
        stores.storage.sheets(),
        &sheet_id,
        binding_id,
        last_refresh,
        last_row_count,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn remove_bindings_for_connection(
    stores: &EngineStores,
    connection_id: &str,
) -> Result<MutationResult, ComputeError> {
    let count = bindings::remove_bindings_for_connection(
        stores.storage.doc(),
        stores.storage.sheets(),
        connection_id,
    );
    Ok(MutationResult::empty().with_data(&count)?)
}
