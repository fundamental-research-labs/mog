use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::snapshot::{ChangeKind, MutationResult, NamedRangeChange};
use crate::storage::engine::mutation::MutationOutput;
use crate::storage::engine::stores::EngineStores;

/// Apply a named range mutation (create, update, or import).
pub(in crate::storage::engine) fn mutation_named_range_create(
    stores: &EngineStores,
    input: domain_types::DefinedNameInput,
) -> Result<MutationOutput, ComputeError> {
    use crate::storage::workbook::named_ranges;
    let defined_name = named_ranges::create_named_range(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        input,
        &stores.id_alloc,
    )?;
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: defined_name.name.clone(),
        kind: ChangeKind::Set,
    });
    Ok(MutationOutput::Plain(result.with_data(&defined_name)?))
}

/// Update an existing named range.
///
/// If the update renames the name (`updates.name` differs from the existing
/// name), every formula in the workbook that references the old name is
/// rewritten to use the new name — both in the Yrs-persisted formula text and
/// in the in-memory mirror's [`IdentityFormula::template`] strings (named-range
/// refs aren't AST nodes today, so they live in the template literally). This
/// is the Rust source of truth for the rename-rewrite contract; the kernel
/// must not duplicate this in TS.
pub(in crate::storage::engine) fn mutation_named_range_update(
    stores: &EngineStores,
    mirror: &mut CellMirror,
    id: String,
    updates: domain_types::NamedRangeUpdate,
) -> Result<MutationOutput, ComputeError> {
    use crate::storage::cells::formula_updater;
    use crate::storage::workbook::named_ranges;

    // Capture the old name before applying the update so we can detect a
    // rename and rewrite formula bodies.
    let old_name = named_ranges::get_named_range_by_id(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        &id,
    )
    .map(|dn| dn.name);

    let defined_name = named_ranges::update_named_range(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        &id,
        updates,
    )?;

    // Sole site that performs the formula-text rewrite on a name rename.
    // The TS layer used to do this with a regex scan of every sheet
    // (`_rewriteNamedRangeInFormulas`); that work belongs here so it
    // happens atomically with the rename and so callers can't forget it.
    if let Some(prev) = old_name
        && prev != defined_name.name
    {
        // 1) Yrs storage rewrite (persistent).
        let _ = formula_updater::update_formula_templates_on_named_range_rename(
            stores.storage.doc(),
            stores.storage.workbook_map(),
            stores.storage.sheets(),
            &prev,
            &defined_name.name,
        );
        // 2) In-memory mirror rewrite (drives `formula_strings` /
        // `to_a1_display`). Without this, the formula bar would still show
        // the old name because the IdentityFormula.template carries the bare
        // identifier verbatim.
        formula_updater::update_mirror_formulas_on_named_range_rename(
            mirror,
            &prev,
            &defined_name.name,
        );
    }

    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: defined_name.name.clone(),
        kind: ChangeKind::Set,
    });
    Ok(MutationOutput::Plain(result.with_data(&defined_name)?))
}

/// Import multiple named ranges in bulk.
pub(in crate::storage::engine) fn mutation_named_ranges_import(
    stores: &EngineStores,
    names: Vec<domain_types::DefinedName>,
) -> Result<MutationOutput, ComputeError> {
    use crate::storage::workbook::named_ranges;
    let count = named_ranges::import_named_ranges(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        names,
    );
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: format!("{} names imported", count),
        kind: ChangeKind::Set,
    });
    Ok(MutationOutput::Plain(result.with_data(&count)?))
}
