#![allow(unused_imports, unused_variables)]
use crate::identity::GridIndex;
use crate::snapshot::{
    CellEdit, ChangeKind, MutationResult, NamedRangeChange, PageBreakChange, PrintAreaChange,
    PrintSettingsChange, PrintTitlesChange, RecalcResult, Scenario, ScenarioCreateInput,
    ScenarioUpdateInput, ScrollPositionChange, SheetChange, SheetChangeField,
    SheetLifecycleRuntimeHint, SheetSettingsChange, SheetSnapshot,
};
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::mutation::{EngineMutation, MutationOutput};
use crate::storage::engine::mutation_coordinator::SheetLifecycleHistoryHint;
use crate::storage::engine::{mutation, services};
use crate::storage::sheet::bindings;
use crate::storage::sheet::{
    order, print, properties, protection, settings, split_view, view, visibility,
};
use crate::storage::workbook::named_ranges;
use crate::what_if::scenarios;
use cell_types::{CellId, SheetId};
use compute_collab as sync;
use compute_document::hex::id_to_hex;
use compute_formats;
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::domain::print::PageBreaks;
use domain_types::domain::sheet::{
    PrintRange, PrintTitles, SheetProtectionOptions, SheetSettings, SplitViewConfig,
};
use formula_types::{IdentityFormula, NamedRangeDef};
use value_types::ComputeError;

pub(in crate::storage::engine) fn create_scenario(
    engine: &YrsComputeEngine,
    input: ScenarioCreateInput,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = scenarios::create(&engine.stores.storage, input, &engine.stores.id_alloc);
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty().with_data(&result)?,
    ))
}

pub(in crate::storage::engine) fn update_scenario(
    engine: &YrsComputeEngine,
    scenario_id: &str,
    input: ScenarioUpdateInput,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = scenarios::update(&engine.stores.storage, scenario_id, input);
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty().with_data(&result)?,
    ))
}

pub(in crate::storage::engine) fn remove_scenario(
    engine: &YrsComputeEngine,
    scenario_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = scenarios::remove(&engine.stores.storage, scenario_id);
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty().with_data(&result)?,
    ))
}

pub(in crate::storage::engine) fn get_all_scenarios(engine: &YrsComputeEngine) -> Vec<Scenario> {
    scenarios::get_all(&engine.stores.storage)
}

pub(in crate::storage::engine) fn get_active_scenario_state(
    engine: &YrsComputeEngine,
) -> Option<crate::snapshot::ScenarioActiveState> {
    scenarios::active_state(&engine.stores.storage, &engine.scenario_session)
}

pub(in crate::storage::engine) fn apply_scenario(
    engine: &mut YrsComputeEngine,
    scenario_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(EngineMutation::ApplyScenario {
        scenario_id: scenario_id.to_string(),
    })? {
        MutationOutput::Recalc(result) => Ok((engine.flush_viewport_patches(), result)),
        MutationOutput::Plain(result) => Ok((serialize_multi_viewport_patches(&[]), result)),
        _ => Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(in crate::storage::engine) fn restore_scenario(
    engine: &mut YrsComputeEngine,
    baseline_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(EngineMutation::RestoreScenario {
        baseline_id: baseline_id.to_string(),
    })? {
        MutationOutput::Recalc(result) => Ok((engine.flush_viewport_patches(), result)),
        MutationOutput::Plain(result) => Ok((serialize_multi_viewport_patches(&[]), result)),
        _ => Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(in crate::storage::engine) fn set_active_scenario(
    engine: &YrsComputeEngine,
    scenario_id: Option<String>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    scenarios::set_active_scenario_id(&engine.stores.storage, scenario_id.as_deref())?;
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn create_binding(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    binding: bindings::CreateBindingInput,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    let options = bindings::CreateBindingOptions {
        auto_generate_rows: binding.auto_generate_rows,
        header_row: binding.header_row,
        data_start_row: binding.data_start_row,
        preserve_header_formatting: binding.preserve_header_formatting,
    };
    let result = bindings::create_binding(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        &sheet_id,
        &binding.connection_id,
        binding.column_mappings,
        options,
        &engine.stores.id_alloc,
    )?;
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty().with_data(&result)?,
    ))
}

pub(in crate::storage::engine) fn update_binding(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    binding_id: &str,
    updates: bindings::UpdateBindingFields,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::update_binding(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        &sheet_id,
        binding_id,
        updates,
    );
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn remove_binding(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    binding_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::remove_binding(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        &sheet_id,
        binding_id,
    );
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn get_all_bindings(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<bindings::SheetDataBinding> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::get_all_bindings(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        &sheet_id,
    )
}

pub(in crate::storage::engine) fn get_binding(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    binding_id: &str,
) -> Option<bindings::SheetDataBinding> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::get_binding(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        &sheet_id,
        binding_id,
    )
}

pub(in crate::storage::engine) fn get_bindings_for_connection(
    engine: &YrsComputeEngine,
    connection_id: &str,
) -> Vec<bindings::SheetDataBinding> {
    bindings::get_bindings_for_connection(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        connection_id,
    )
}

pub(in crate::storage::engine) fn update_refresh_metadata(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    binding_id: &str,
    last_refresh: i64,
    last_row_count: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::update_refresh_metadata(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        &sheet_id,
        binding_id,
        last_refresh,
        last_row_count,
    );
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn remove_bindings_for_connection(
    engine: &YrsComputeEngine,
    connection_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let count = bindings::remove_bindings_for_connection(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        connection_id,
    );
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty().with_data(&count)?,
    ))
}
