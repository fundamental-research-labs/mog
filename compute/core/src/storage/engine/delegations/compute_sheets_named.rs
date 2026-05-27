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

pub(in crate::storage::engine) fn add_compute_sheet(
    engine: &mut YrsComputeEngine,
    snapshot: SheetSnapshot,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let sheet_id = SheetId::from_uuid_str(&snapshot.id)?;
    let mut grid = GridIndex::new(
        sheet_id,
        snapshot.rows,
        snapshot.cols,
        engine.stores.grid_id_alloc.clone(),
    );
    for cell_data in &snapshot.cells {
        let cell_id = CellId::from_uuid_str(&cell_data.cell_id)?;
        grid.register_cell(cell_id, cell_data.row, cell_data.col);
    }
    engine.stores.grid_indexes.insert(sheet_id, grid);

    engine
        .stores
        .compute
        .add_sheet(&mut engine.mirror, snapshot)?;
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn remove_compute_sheet(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    engine.stores.grid_indexes.remove(sheet_id);
    let recalc = engine
        .stores
        .compute
        .remove_sheet(&mut engine.mirror, sheet_id)?;
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::from_recalc(recalc),
    ))
}

pub(in crate::storage::engine) fn rename_compute_sheet(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    name: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::RenameSheet {
        sheet_id: *sheet_id,
        name: name.to_string(),
    })? {
        mutation::MutationOutput::Plain(result) => {
            Ok((serialize_multi_viewport_patches(&[]), result))
        }
        _ => Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(in crate::storage::engine) fn set_named_range(
    engine: &mut YrsComputeEngine,
    name: String,
    def: NamedRangeDef,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let scope_str = match &def.scope {
        formula_types::Scope::Sheet(id) => Some(id.to_uuid_string()),
        formula_types::Scope::Workbook => None,
    };

    let first_sheet = engine.mirror.sheet_ids().next().copied();
    let context_sheet = match &def.scope {
        formula_types::Scope::Sheet(id) => Some(*id),
        formula_types::Scope::Workbook => first_sheet,
    };
    let identity = match (&def.raw_expression, context_sheet) {
        (Some(expr), Some(ctx)) => {
            let a1 = if expr.starts_with('=') {
                expr.clone()
            } else {
                format!("={}", expr)
            };
            match engine
                .stores
                .compute
                .to_identity_formula(&mut engine.mirror, &ctx, &a1)
            {
                Ok(id) => id,
                Err(_) => {
                    let template = expr.strip_prefix('=').unwrap_or(expr).to_string();
                    IdentityFormula {
                        template,
                        refs: vec![],
                        is_dynamic_array: false,
                        is_volatile: false,
                        is_aggregate: false,
                    }
                }
            }
        }
        _ => def.refers_to.clone(),
    };

    services::cell_editing::persist_identity_formula_cell_identities(
        &mut engine.stores,
        &engine.mirror,
        &identity,
    );

    let refers_to_json =
        serde_json::to_string(&identity).expect("IdentityFormula serialization should not fail");

    let scope_for_seed = def.scope.clone();
    let key_for_seed = name.to_ascii_lowercase();

    engine
        .stores
        .compute
        .set_named_range(&mut engine.mirror, name.clone(), def);

    engine.mutation.observer.set_suppressed(true);
    let defined_name = named_ranges::DefinedName {
        id: engine.stores.next_id_simple(),
        name: name.clone(),
        refers_to: refers_to_json,
        raw_refers_to: None,
        scope: scope_str,
        comment: None,
        custom_menu: None,
        description: None,
        help: None,
        status_bar: None,
        visible: true,
        xlm: false,
        function: false,
        vb_procedure: false,
        publish_to_server: false,
        workbook_parameter: false,
        xml_space_preserve: false,
        order: None,
        linked_range_id: None,
    };
    named_ranges::upsert_named_range(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        &defined_name,
    );
    engine.mutation.observer.set_suppressed(false);

    let seed_id = engine
        .mirror
        .variables
        .get_variable_cell_id(&scope_for_seed, &key_for_seed);
    let mut recalc = match seed_id {
        Some(cell_id) => engine
            .stores
            .compute
            .recalc(&mut engine.mirror, &[cell_id])?,
        None => RecalcResult::empty(),
    };
    engine.prepare_recalc_for_flush(&mut recalc);
    let patches = engine.flush_viewport_patches();

    let mut result = MutationResult::from_recalc(recalc);
    result.named_range_changes.push(NamedRangeChange {
        name,
        kind: ChangeKind::Set,
    });
    Ok((patches, result))
}

pub(in crate::storage::engine) fn remove_named_range(
    engine: &mut YrsComputeEngine,
    name: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let key = name.to_ascii_lowercase();
    let seed_ids: Vec<CellId> = engine
        .mirror
        .variables
        .all_variables()
        .filter(|(_, var_name, _)| var_name.as_str() == key)
        .filter_map(|(scope, _, _)| engine.mirror.variables.get_variable_cell_id(scope, &key))
        .collect();

    engine
        .stores
        .compute
        .remove_named_range(&mut engine.mirror, name);

    named_ranges::remove_named_range_by_name(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        name,
        None,
    );
    let sheet_ids: Vec<_> = engine.mirror.sheet_ids().copied().collect();
    for sheet_id in &sheet_ids {
        named_ranges::remove_named_range_by_name(
            engine.stores.storage.doc(),
            engine.stores.storage.workbook_map(),
            name,
            Some(&sheet_id.to_uuid_string()),
        );
    }

    let mut recalc = if seed_ids.is_empty() {
        RecalcResult::empty()
    } else {
        engine
            .stores
            .compute
            .recalc(&mut engine.mirror, &seed_ids)?
    };
    engine.prepare_recalc_for_flush(&mut recalc);
    let patches = engine.flush_viewport_patches();

    let mut result = MutationResult::from_recalc(recalc);
    result.named_range_changes.push(NamedRangeChange {
        name: name.to_string(),
        kind: ChangeKind::Removed,
    });
    Ok((patches, result))
}

pub(in crate::storage::engine) fn eval_cf(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    rules: Vec<crate::cf::types::CFRuleWire>,
) -> Vec<crate::cf::types::CellCFResult> {
    let rules: Vec<crate::cf::types::CFRule> = rules
        .into_iter()
        .filter_map(|w| crate::cf::types::CFRule::try_from(w).ok())
        .collect();
    engine
        .stores
        .compute
        .eval_cf(&engine.mirror, sheet_id, &rules)
}

pub(in crate::storage::engine) fn to_identity_formula(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    formula_a1: &str,
) -> Result<IdentityFormula, ComputeError> {
    engine
        .stores
        .compute
        .to_identity_formula(&mut engine.mirror, sheet_id, formula_a1)
}

pub(in crate::storage::engine) fn to_a1_display(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    formula: &IdentityFormula,
) -> String {
    engine
        .stores
        .compute
        .to_a1_display(&engine.mirror, sheet_id, formula)
}

pub(in crate::storage::engine) fn to_a1_display_qualified(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    formula: &IdentityFormula,
) -> String {
    engine
        .stores
        .compute
        .to_a1_display_qualified(&engine.mirror, sheet_id, formula)
}
