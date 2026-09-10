use super::*;

fn defined_name_scope(scope_hex: Option<&str>) -> Scope {
    scope_hex
        .and_then(hex_to_id)
        .map_or(Scope::Workbook, |raw| Scope::Sheet(SheetId::from_raw(raw)))
}

fn named_range_raw_expression_from_a1(a1: &str, fallback: &str) -> String {
    let a1 = a1.strip_prefix('=').unwrap_or(a1);
    if a1.is_empty() {
        fallback.to_string()
    } else {
        format!("={a1}")
    }
}

/// Convert canonical native names into evaluator definitions.
pub(in crate::storage::engine) fn defined_names_to_named_range_defs<F>(
    defined_names: Vec<workbook_named_ranges::StoredDefinedName>,
    mut identity_to_a1: F,
) -> Vec<NamedRangeDef>
where
    F: FnMut(&formula_types::IdentityFormula) -> String,
{
    defined_names
        .into_iter()
        .filter_map(|dn| {
            let scope = defined_name_scope(dn.scope.as_deref());
            let identity = dn.refers_to;

            if identity.refs.is_empty() {
                let mut def = NamedRangeDef::from_expression(dn.name, scope, identity.template);
                def.linked_range_id = dn.linked_range_id;
                return Some(def);
            }

            let a1 = identity_to_a1(&identity);
            if identity_formula_uses_axis_identity_refs(&identity) {
                let mut def = NamedRangeDef::from_expression(
                    dn.name,
                    scope,
                    named_range_raw_expression_from_a1(&a1, &identity.template),
                );
                def.linked_range_id = dn.linked_range_id;
                return Some(def);
            }

            let raw_expression = Some(named_range_raw_expression_from_a1(&a1, &identity.template));
            Some(NamedRangeDef {
                name: dn.name,
                scope,
                refers_to: identity,
                raw_expression,
                linked_range_id: dn.linked_range_id,
            })
        })
        .collect()
}

fn identity_formula_uses_axis_identity_refs(identity: &formula_types::IdentityFormula) -> bool {
    identity.refs.iter().any(|reference| {
        matches!(
            reference,
            formula_types::IdentityFormulaRef::RectRange(_)
                | formula_types::IdentityFormulaRef::FullRow(_)
                | formula_types::IdentityFormulaRef::RowRange(_)
                | formula_types::IdentityFormulaRef::FullCol(_)
                | formula_types::IdentityFormulaRef::ColRange(_)
        )
    })
}

pub(in crate::storage::engine) fn normalize_named_range_refs(engine: &mut ComputeEngine) {
    // Snapshot construction initializes evaluator variables directly. Seed their
    // authored records once so a later snapshot/export keeps the names as well.
    let snapshot_names: Vec<_> = engine
        .cell_store
        .variables
        .all_variables()
        .map(|(_, _, definition)| definition.clone())
        .collect();
    for definition in snapshot_names {
        let scope = match &definition.scope {
            Scope::Workbook => None,
            Scope::Sheet(sheet) => Some(sheet.to_uuid_string()),
        };
        if workbook_named_ranges::named_range_exists(
            &engine.stores.storage.metadata,
            &definition.name,
            scope.as_deref(),
        ) {
            continue;
        }
        let refers_to = definition
            .raw_expression
            .as_deref()
            .map(workbook_named_ranges::expression_template)
            .unwrap_or(definition.refers_to);
        let name = workbook_named_ranges::StoredDefinedName {
            id: engine.stores.next_id_simple(),
            name: definition.name,
            refers_to,
            raw_refers_to: None,
            scope,
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
            linked_range_id: definition.linked_range_id,
        };
        workbook_named_ranges::upsert_named_range(&mut engine.stores.storage.metadata, &name);
    }
    let all = workbook_named_ranges::get_all_named_ranges(&engine.stores.storage.metadata);

    let to_normalize: Vec<_> = all
        .into_iter()
        .filter(|dn| dn.refers_to.refs.is_empty() && dn.raw_refers_to.is_none())
        .collect();

    if to_normalize.is_empty() {
        return;
    }

    // Pick first sheet as context for workbook-scoped names.
    let first_sheet = engine.cell_store.sheet_ids().next().copied();

    for dn in to_normalize {
        if dn.raw_refers_to.is_some() {
            continue;
        }

        // Determine context sheet: use the name's scope if sheet-scoped,
        // otherwise fall back to the first sheet.
        let context_sheet = dn
            .scope
            .as_deref()
            .and_then(hex_to_id)
            .map(SheetId::from_raw)
            .or(first_sheet);

        let context_sheet = match context_sheet {
            Some(s) => s,
            None => continue, // No sheets at all — nothing to resolve against.
        };

        // Ensure formula has '=' prefix for the parser.
        let a1 = format!("={}", dn.refers_to.template);

        let identity = match engine.stores.compute.to_identity_formula_with_rect_ranges(
            &mut engine.cell_store,
            &context_sheet,
            &a1,
        ) {
            Ok(id) => id,
            Err(_) => {
                // Non-parseable formula (constants, #REF!, array literals, etc.).
                // Wrap as a template-only IdentityFormula with no cell refs.
                // Use the raw refers_to (without '=' prefix) as the template,
                // matching the convention that template holds the formula body.
                let template = dn.refers_to.template.clone();
                formula_types::IdentityFormula {
                    template,
                    refs: vec![],
                    is_dynamic_array: false,
                    is_volatile: false,
                    // Non-parseable fallback (constants, #REF!, array
                    // literals). Aggregate detection requires an AST; with
                    // no parse, the conservative default is false.
                    is_aggregate: false,
                }
            }
        };

        let raw_refers_to =
            if normalized_defined_name_text_lost_opaque_ref(&dn.refers_to.template, &identity) {
                Some(dn.refers_to.template.clone())
            } else {
                dn.raw_refers_to.clone()
            };

        let updated = workbook_named_ranges::StoredDefinedName {
            refers_to: identity,
            raw_refers_to,
            ..dn
        };
        workbook_named_ranges::upsert_named_range(&mut engine.stores.storage.metadata, &updated);
    }
}

pub(in crate::storage::engine) fn normalized_defined_name_text_lost_opaque_ref(
    original_refers_to: &str,
    identity: &formula_types::IdentityFormula,
) -> bool {
    let original_template = original_refers_to
        .strip_prefix('=')
        .unwrap_or(original_refers_to);
    identity.refs.is_empty() && identity.template != original_template
}
