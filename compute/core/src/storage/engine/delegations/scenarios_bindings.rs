use crate::snapshot::{MutationResult, Scenario, ScenarioCreateInput, ScenarioUpdateInput};
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::mutation::{EngineMutation, MutationOutput};
use crate::storage::sheet::bindings;
use crate::what_if::scenarios;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use value_types::ComputeError;

pub(in crate::storage::engine) fn create_scenario(
    engine: &mut ComputeEngine,
    input: ScenarioCreateInput,
) -> Result<MutationResult, ComputeError> {
    let result = scenarios::create(&mut engine.stores.storage, input, &engine.stores.id_alloc);
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn update_scenario(
    engine: &mut ComputeEngine,
    scenario_id: &str,
    input: ScenarioUpdateInput,
) -> Result<MutationResult, ComputeError> {
    let result = scenarios::update(&mut engine.stores.storage, scenario_id, input);
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn remove_scenario(
    engine: &mut ComputeEngine,
    scenario_id: &str,
) -> Result<MutationResult, ComputeError> {
    let result = scenarios::remove(&mut engine.stores.storage, scenario_id);
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn get_all_scenarios(engine: &ComputeEngine) -> Vec<Scenario> {
    scenarios::get_all(&engine.stores.storage)
}

pub(in crate::storage::engine) fn get_active_scenario_state(
    engine: &ComputeEngine,
) -> Option<crate::snapshot::ScenarioActiveState> {
    scenarios::active_state(&engine.stores.storage, &engine.scenario_session)
}

pub(in crate::storage::engine) fn apply_scenario(
    engine: &mut ComputeEngine,
    scenario_id: &str,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(EngineMutation::ApplyScenario {
        scenario_id: scenario_id.to_string(),
    })? {
        MutationOutput::Recalc(result) => Ok(result),
        MutationOutput::Plain(result) => Ok(result),
        _ => Ok(MutationResult::empty()),
    }
}

pub(in crate::storage::engine) fn restore_scenario(
    engine: &mut ComputeEngine,
    baseline_id: &str,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(EngineMutation::RestoreScenario {
        baseline_id: baseline_id.to_string(),
    })? {
        MutationOutput::Recalc(result) => Ok(result),
        MutationOutput::Plain(result) => Ok(result),
        _ => Ok(MutationResult::empty()),
    }
}

pub(in crate::storage::engine) fn create_binding(
    engine: &mut ComputeEngine,
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
        &mut engine.stores.storage,
        &sheet_id,
        &binding.connection_id,
        binding.column_mappings,
        options,
        &engine.stores.id_alloc,
    )?;
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn update_binding(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    binding_id: &str,
    updates: bindings::UpdateBindingFields,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::update_binding(&mut engine.stores.storage, &sheet_id, binding_id, updates);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn remove_binding(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    binding_id: &str,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::remove_binding(&mut engine.stores.storage, &sheet_id, binding_id);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_all_bindings(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<bindings::SheetDataBinding> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::get_all_bindings(&engine.stores.storage, &sheet_id)
}

pub(in crate::storage::engine) fn get_binding(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    binding_id: &str,
) -> Option<bindings::SheetDataBinding> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::get_binding(&engine.stores.storage, &sheet_id, binding_id)
}

pub(in crate::storage::engine) fn get_bindings_for_connection(
    engine: &ComputeEngine,
    connection_id: &str,
) -> Vec<bindings::SheetDataBinding> {
    bindings::get_bindings_for_connection(&engine.stores.storage, connection_id)
}

pub(in crate::storage::engine) fn update_refresh_metadata(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    binding_id: &str,
    last_refresh: i64,
    last_row_count: u32,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::update_refresh_metadata(
        &mut engine.stores.storage,
        &sheet_id,
        binding_id,
        last_refresh,
        last_row_count,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn remove_bindings_for_connection(
    engine: &mut ComputeEngine,
    connection_id: &str,
) -> Result<MutationResult, ComputeError> {
    let count = bindings::remove_bindings_for_connection(&mut engine.stores.storage, connection_id);
    Ok(MutationResult::empty().with_data(&count)?)
}
