use crate::storage::engine::history::metadata::{MetadataImpact, capture_workbook_entry};
use cell_types::SheetId;
use formula_types::{IdentityFormula, Scope};
use value_types::ComputeError;

use crate::cells::CellStore;
use crate::snapshot::{ChangeKind, MutationResult, NamedRangeChange};
use crate::storage::engine::mutation::MutationOutput;
use crate::storage::engine::stores::EngineStores;
use crate::storage::workbook::named_ranges::{self, StoredDefinedName};

fn scope_of(scope: Option<&str>) -> Scope {
    scope
        .and_then(|scope| SheetId::from_uuid_str(scope).ok())
        .map_or(Scope::Workbook, Scope::Sheet)
}

/// Resolve API/import text once before it enters native authored storage.
pub(in crate::storage::engine) fn normalize_named_range_reference(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    scope: Option<&str>,
    expression: &str,
) -> IdentityFormula {
    // The existing string API can carry its serialized typed reference back in.
    if let Ok(identity) = serde_json::from_str::<IdentityFormula>(expression) {
        return identity;
    }
    let context = scope
        .and_then(|scope| SheetId::from_uuid_str(scope).ok())
        .or_else(|| cell_store.sheet_ids().next().copied());
    let a1 = format!("={}", expression.strip_prefix('=').unwrap_or(expression));
    context
        .and_then(|sheet| {
            stores
                .compute
                .to_identity_formula_with_rect_ranges(cell_store, &sheet, &a1)
                .ok()
        })
        .unwrap_or_else(|| named_ranges::expression_template(expression))
}

fn install_name(stores: &mut EngineStores, cell_store: &mut CellStore, name: StoredDefinedName) {
    let definitions = crate::storage::engine::construction::defined_names_to_named_range_defs(
        vec![name],
        |identity| {
            stores
                .compute
                .to_a1_display_qualified(cell_store, &SheetId::from_raw(0), identity)
        },
    );
    for definition in definitions {
        stores
            .compute
            .set_named_range(cell_store, definition.name.clone(), definition);
    }
}

fn name_result(name: &StoredDefinedName) -> Result<MutationResult, ComputeError> {
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: name.name.clone(),
        kind: ChangeKind::Set,
    });
    // Serialize only for the established external string response contract.
    let wire = name.clone().map_reference(|identity| {
        serde_json::to_string(&identity).expect("typed reference serializes")
    });
    Ok(result.with_data(&wire)?)
}

pub(in crate::storage::engine) fn mutation_named_range_create(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    input: domain_types::DefinedNameInput,
) -> Result<MutationOutput, ComputeError> {
    let identity = normalize_named_range_reference(
        stores,
        cell_store,
        input.scope.as_deref(),
        &input.refers_to,
    );
    capture_workbook_entry!(
        stores.storage,
        named_ranges,
        named_ranges::get_defined_name_key(&input.name, input.scope.as_deref()),
        MetadataImpact::Names
    );
    let name = named_ranges::create_named_range(
        &mut stores.storage.metadata,
        domain_types::DefinedNameInput {
            name: input.name,
            refers_to: identity,
            scope: input.scope,
            comment: input.comment,
        },
        &stores.id_alloc,
    )?;
    install_name(stores, cell_store, name.clone());
    stores.compute.mark_dirty();
    Ok(MutationOutput::Plain(name_result(&name)?))
}

/// Rename updates authored references, rendered formula source, cached ASTs and
/// dependency edges together. Recalculation sees the new name immediately.
pub(in crate::storage::engine) fn mutation_named_range_update(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    id: String,
    updates: domain_types::NamedRangeUpdate,
) -> Result<MutationOutput, ComputeError> {
    let existing =
        named_ranges::get_named_range_by_id(&stores.storage.metadata, &id).ok_or_else(|| {
            ComputeError::Eval {
                message: format!("Defined name with ID {} not found", id),
            }
        })?;
    let local_scopes: std::collections::HashSet<_> =
        named_ranges::get_all_named_ranges(&stores.storage.metadata)
            .iter()
            .filter(|name| name.name.eq_ignore_ascii_case(&existing.name))
            .filter_map(|name| {
                name.scope
                    .as_deref()
                    .and_then(|scope| SheetId::from_uuid_str(scope).ok())
            })
            .collect();
    let reference_changed = updates.refers_to.is_some();
    let reference = updates.refers_to.as_deref().map(|expression| {
        normalize_named_range_reference(stores, cell_store, existing.scope.as_deref(), expression)
    });
    capture_workbook_entry!(
        stores.storage,
        named_ranges,
        named_ranges::get_defined_name_key(&existing.name, existing.scope.as_deref()),
        MetadataImpact::Names
    );
    if let Some(new_name) = &updates.name {
        capture_workbook_entry!(
            stores.storage,
            named_ranges,
            named_ranges::get_defined_name_key(new_name, existing.scope.as_deref()),
            MetadataImpact::Names
        );
    }
    let name = named_ranges::update_named_range(
        &mut stores.storage.metadata,
        &id,
        domain_types::NamedRangeUpdate {
            name: updates.name,
            refers_to: reference,
            comment: updates.comment,
            visible: updates.visible,
        },
    )?;
    let renamed = existing.name != name.name;
    let recalc = if renamed {
        let renamed_scope = existing
            .scope
            .as_deref()
            .and_then(|scope| SheetId::from_uuid_str(scope).ok());
        let first_sheet = cell_store.sheet_ids().next().copied();
        let mut renamed_definitions = Vec::new();
        for (key, definition) in &stores.storage.metadata.named_ranges {
            let context = definition
                .scope
                .as_deref()
                .and_then(|scope| SheetId::from_uuid_str(scope).ok())
                .or(first_sheet);
            let template = rewrite_scoped_name_reference(
                &definition.refers_to.template,
                context,
                renamed_scope,
                &local_scopes,
                cell_store,
                &existing.name,
                &name.name,
            );
            if template != definition.refers_to.template {
                capture_workbook_entry!(stores.storage, named_ranges, key, MetadataImpact::Names);
                renamed_definitions.push((key.clone(), template));
            }
        }
        for (key, template) in renamed_definitions {
            stores
                .storage
                .metadata
                .named_ranges
                .get_mut(&key)
                .unwrap()
                .refers_to
                .template = template;
        }
        if stores.storage.history.is_active() {
            for sheet_id in cell_store.sheet_ids().copied() {
                let Some(sheet) = cell_store.get_sheet(&sheet_id) else {
                    continue;
                };
                for (cell_id, formula) in &sheet.formulas {
                    if rewrite_scoped_name_reference(
                        &formula.template,
                        Some(sheet_id),
                        renamed_scope,
                        &local_scopes,
                        cell_store,
                        &existing.name,
                        &name.name,
                    ) != formula.template
                        && let Some(pos) = cell_store.resolve_position(cell_id)
                    {
                        crate::storage::engine::history::cells::capture_cell(
                            stores,
                            cell_store,
                            sheet_id,
                            *cell_id,
                            pos.row(),
                            pos.col(),
                        );
                    }
                }
            }
        }
        let changed_cells =
            crate::storage::cells::formula_updater::update_store_formulas_on_named_range_rename(
                cell_store,
                |cell_store, sheet, template| {
                    rewrite_scoped_name_reference(
                        template,
                        Some(sheet),
                        renamed_scope,
                        &local_scopes,
                        cell_store,
                        &existing.name,
                        &name.name,
                    )
                },
            );
        stores.compute.remove_named_range_scoped(
            cell_store,
            &scope_of(existing.scope.as_deref()),
            &existing.name,
        );
        for definition in named_ranges::get_all_named_ranges(&stores.storage.metadata) {
            install_name(stores, cell_store, definition);
        }
        Some(stores.compute.structure_change_with_formula_refresh(
            cell_store,
            None,
            &changed_cells,
        )?)
    } else {
        install_name(stores, cell_store, name.clone());
        if reference_changed {
            let scope = scope_of(name.scope.as_deref());
            let seed = cell_store
                .variables
                .get_variable_cell_id(&scope, &name.name.to_ascii_lowercase());
            seed.map(|id| stores.compute.recalc(cell_store, &[id]))
                .transpose()?
        } else {
            None
        }
    };
    let mut result = name_result(&name)?;
    if let Some(recalc) = recalc {
        let mut recalculated = MutationResult::from_recalc(recalc);
        recalculated.named_range_changes = result.named_range_changes;
        recalculated.data = result.data.take();
        Ok(MutationOutput::Recalc(recalculated))
    } else {
        stores.compute.mark_dirty();
        Ok(MutationOutput::Plain(result))
    }
}

pub(in crate::storage::engine) fn mutation_named_ranges_import(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    names: Vec<domain_types::DefinedName>,
) -> Result<MutationOutput, ComputeError> {
    let names: Vec<_> = names
        .into_iter()
        .map(|name| {
            let scope = name.scope.clone();
            name.map_reference(|expression| {
                normalize_named_range_reference(stores, cell_store, scope.as_deref(), &expression)
            })
        })
        .collect();
    for name in &names {
        capture_workbook_entry!(
            stores.storage,
            named_ranges,
            named_ranges::get_defined_name_key(&name.name, name.scope.as_deref()),
            MetadataImpact::Names
        );
    }
    let count = named_ranges::import_named_ranges(&mut stores.storage.metadata, names);
    for name in named_ranges::get_all_named_ranges(&stores.storage.metadata) {
        install_name(stores, cell_store, name);
    }
    stores.compute.mark_dirty();
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: format!("{} names imported", count),
        kind: ChangeKind::Set,
    });
    Ok(MutationOutput::Plain(result.with_data(&count)?))
}

/// Resolve each name token's worksheet context before rewriting. A workbook
/// name must not capture a sheet-local shadow, and explicit sheet qualifiers
/// must continue to resolve in the qualified sheet.
fn rewrite_scoped_name_reference(
    expression: &str,
    current_sheet: Option<SheetId>,
    renamed_scope: Option<SheetId>,
    local_scopes: &std::collections::HashSet<SheetId>,
    cell_store: &CellStore,
    old_name: &str,
    new_name: &str,
) -> String {
    let mut output = String::with_capacity(expression.len());
    let mut cursor = 0;
    for (start, end) in
        crate::storage::cells::formula_updater::formula_identifier_candidates(expression)
    {
        if !expression[start..end].eq_ignore_ascii_case(old_name) {
            continue;
        }
        let prefix = &expression[..start];
        let trimmed = prefix.trim_end();
        let context = if let Some(qualifier) = trimmed.strip_suffix('!') {
            let qualifier = qualifier.trim_end();
            let sheet_name = if let Some(quoted) = qualifier.strip_suffix('\'') {
                let bytes = quoted.as_bytes();
                let mut index = bytes.len();
                let mut opening = None;
                while index > 0 {
                    index -= 1;
                    if bytes[index] == b'\'' {
                        if index > 0 && bytes[index - 1] == b'\'' {
                            index -= 1;
                        } else {
                            opening = Some(index);
                            break;
                        }
                    }
                }
                opening.map(|index| quoted[index + 1..].replace("''", "'"))
            } else {
                let start = qualifier
                    .char_indices()
                    .rev()
                    .find(|(_, c)| !(c.is_alphanumeric() || *c == '_' || *c == '.'))
                    .map_or(0, |(index, c)| index + c.len_utf8());
                Some(qualifier[start..].to_string())
            };
            let Some(sheet) = sheet_name.and_then(|sheet| cell_store.sheet_by_name(&sheet)) else {
                continue;
            };
            Some(sheet)
        } else {
            current_sheet
        };
        let resolves_to_renamed = match renamed_scope {
            Some(scope) => context == Some(scope),
            None => context.is_none_or(|sheet| !local_scopes.contains(&sheet)),
        };
        if resolves_to_renamed {
            output.push_str(&expression[cursor..start]);
            output.push_str(new_name);
            cursor = end;
        }
    }
    output.push_str(&expression[cursor..]);
    output
}
