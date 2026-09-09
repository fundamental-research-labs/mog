use crate::snapshot::{ChangeKind, MutationResult, NamedRangeChange, RecalcResult, SheetSnapshot};
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::history::metadata::{MetadataImpact, capture_workbook_entry};
use crate::storage::engine::mutation;
use crate::storage::workbook::named_ranges;
use cell_types::{CellId, SheetId};
use formula_types::{IdentityFormula, NamedRangeDef};
use value_types::ComputeError;

pub(in crate::storage::engine) fn add_compute_sheet(
    engine: &mut ComputeEngine,
    snapshot: SheetSnapshot,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = SheetId::from_uuid_str(&snapshot.id)?;
    engine
        .stores
        .compute
        .add_sheet(&mut engine.cell_store, snapshot.clone())?;
    let grid = super::super::build_grid_from_native_sheet(
        &engine.cell_store,
        sheet_id,
        &snapshot,
        engine.stores.grid_id_alloc.clone(),
    )?;
    engine.stores.grid_indexes.insert(sheet_id, grid);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn remove_compute_sheet(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    engine.stores.grid_indexes.remove(sheet_id);
    let recalc = engine
        .stores
        .compute
        .remove_sheet(&mut engine.cell_store, sheet_id)?;
    Ok(MutationResult::from_recalc(recalc))
}

pub(in crate::storage::engine) fn rename_compute_sheet(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    name: &str,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::RenameSheet {
        sheet_id: *sheet_id,
        name: name.to_string(),
    })? {
        mutation::MutationOutput::Plain(result) => Ok(result),
        _ => Ok(MutationResult::empty()),
    }
}

pub(in crate::storage::engine) fn set_named_range(
    engine: &mut ComputeEngine,
    name: String,
    def: NamedRangeDef,
) -> Result<MutationResult, ComputeError> {
    let scope_str = match &def.scope {
        formula_types::Scope::Sheet(id) => Some(id.to_uuid_string()),
        formula_types::Scope::Workbook => None,
    };

    let first_sheet = engine.cell_store.sheet_ids().next().copied();
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
            match engine.stores.compute.to_identity_formula_with_rect_ranges(
                &mut engine.cell_store,
                &ctx,
                &a1,
            ) {
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

    let scope_for_seed = def.scope.clone();
    let key_for_seed = name.to_ascii_lowercase();

    let linked_range_id = def.linked_range_id;
    engine
        .stores
        .compute
        .set_named_range(&mut engine.cell_store, name.clone(), def);

    let defined_name = if let Some(existing) = named_ranges::get_named_range_by_name(
        &engine.stores.storage.metadata,
        &name,
        scope_str.as_deref(),
    ) {
        named_ranges::StoredDefinedName {
            refers_to: identity,
            raw_refers_to: None,
            linked_range_id,
            ..existing
        }
    } else {
        named_ranges::StoredDefinedName {
            id: engine.stores.next_id_simple(),
            name: name.clone(),
            refers_to: identity,
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
            linked_range_id,
        }
    };
    capture_workbook_entry!(
        engine.stores.storage,
        named_ranges,
        named_ranges::get_defined_name_key(&defined_name.name, defined_name.scope.as_deref()),
        MetadataImpact::Names
    );
    named_ranges::upsert_named_range(&mut engine.stores.storage.metadata, &defined_name);

    let seed_id = engine
        .cell_store
        .variables
        .get_variable_cell_id(&scope_for_seed, &key_for_seed);
    let mut recalc = match seed_id {
        Some(cell_id) => engine
            .stores
            .compute
            .recalc(&mut engine.cell_store, &[cell_id])?,
        None => RecalcResult::empty(),
    };
    engine.postprocess_mutation_recalc(&mut recalc);

    let mut result = MutationResult::from_recalc(recalc);
    result.named_range_changes.push(NamedRangeChange {
        name,
        kind: ChangeKind::Set,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn remove_named_range(
    engine: &mut ComputeEngine,
    name: &str,
) -> Result<MutationResult, ComputeError> {
    let key = name.to_ascii_lowercase();
    let seed_ids: Vec<CellId> = engine
        .cell_store
        .variables
        .all_variables()
        .filter(|(_, var_name, _)| var_name.as_str() == key)
        .filter_map(|(scope, _, _)| {
            engine
                .cell_store
                .variables
                .get_variable_cell_id(scope, &key)
        })
        .collect();

    engine
        .stores
        .compute
        .remove_named_range(&mut engine.cell_store, name);

    capture_workbook_entry!(
        engine.stores.storage,
        named_ranges,
        named_ranges::get_defined_name_key(name, None),
        MetadataImpact::Names
    );
    named_ranges::remove_named_range_by_name(&mut engine.stores.storage.metadata, name, None);
    let sheet_ids: Vec<_> = engine.cell_store.sheet_ids().copied().collect();
    for sheet_id in &sheet_ids {
        capture_workbook_entry!(
            engine.stores.storage,
            named_ranges,
            named_ranges::get_defined_name_key(name, Some(&sheet_id.to_uuid_string())),
            MetadataImpact::Names
        );
        named_ranges::remove_named_range_by_name(
            &mut engine.stores.storage.metadata,
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
            .recalc(&mut engine.cell_store, &seed_ids)?
    };
    engine.postprocess_mutation_recalc(&mut recalc);

    let mut result = MutationResult::from_recalc(recalc);
    result.named_range_changes.push(NamedRangeChange {
        name: name.to_string(),
        kind: ChangeKind::Removed,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn eval_cf(
    engine: &ComputeEngine,
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
        .eval_cf(&engine.cell_store, sheet_id, &rules)
}

pub(in crate::storage::engine) fn to_identity_formula(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    formula_a1: &str,
) -> Result<IdentityFormula, ComputeError> {
    engine
        .stores
        .compute
        .to_identity_formula(&mut engine.cell_store, sheet_id, formula_a1)
}

pub(in crate::storage::engine) fn to_a1_display(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    formula: &IdentityFormula,
) -> String {
    engine
        .stores
        .compute
        .to_a1_display(&engine.cell_store, sheet_id, formula)
}

pub(in crate::storage::engine) fn to_a1_display_qualified(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    formula: &IdentityFormula,
) -> String {
    engine
        .stores
        .compute
        .to_a1_display_qualified(&engine.cell_store, sheet_id, formula)
}
