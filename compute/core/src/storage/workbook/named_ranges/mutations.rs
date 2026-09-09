use super::StoredDefinedName;
use super::keys::{get_defined_name_key, normalize_scope};
use super::queries::get_named_range_by_id;
use super::validation::validate_name;
use crate::storage::workbook::WorkbookMetadata;
use domain_types::domain::named_range::{DefinedName, DefinedNameInput, NamedRangeUpdate};
use formula_types::IdentityFormula;
use value_types::ComputeError;

/// Insert or replace an already normalized typed name.
pub(crate) fn upsert_named_range(metadata: &mut WorkbookMetadata, dn: &StoredDefinedName) {
    let mut name = dn.clone();
    name.scope = name.scope.as_deref().map(normalize_scope);
    metadata.named_ranges.insert(
        get_defined_name_key(&name.name, name.scope.as_deref()),
        name,
    );
}

pub(crate) fn remove_named_range_by_name(
    metadata: &mut WorkbookMetadata,
    name: &str,
    scope: Option<&str>,
) {
    metadata
        .named_ranges
        .remove(&get_defined_name_key(name, scope));
}

/// Create a new defined name.
///
/// Validates the name and returns an error if invalid or duplicate.
pub(crate) fn create_named_range(
    metadata: &mut WorkbookMetadata,
    input: DefinedNameInput<IdentityFormula>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<StoredDefinedName, ComputeError> {
    // Validate
    let validation = validate_name(metadata, &input.name, input.scope.as_deref(), None);
    if !validation.valid {
        return Err(ComputeError::Eval {
            message: validation
                .message
                .unwrap_or_else(|| format!("Invalid name: {:?}", validation.error)),
        });
    }

    // Generate ID
    let id = {
        let n = id_alloc.next_u128();
        format!("{:032x}", n)
    };

    let defined_name = DefinedName {
        id,
        name: input.name.clone(),
        refers_to: input.refers_to,
        raw_refers_to: None,
        scope: input.scope.as_deref().map(normalize_scope),
        comment: input.comment,
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

    upsert_named_range(metadata, &defined_name);

    Ok(defined_name)
}

/// Update an existing defined name.
///
/// Returns the updated name, or an error if not found or the update is invalid.
pub(crate) fn update_named_range(
    metadata: &mut WorkbookMetadata,
    id: &str,
    updates: NamedRangeUpdate<IdentityFormula>,
) -> Result<StoredDefinedName, ComputeError> {
    // Find existing
    let existing = get_named_range_by_id(metadata, id).ok_or_else(|| ComputeError::Eval {
        message: format!("Defined name with ID {} not found", id),
    })?;

    // If renaming, validate new name
    if let Some(ref new_name) = updates.name
        && new_name != &existing.name
    {
        let validation = validate_name(metadata, new_name, existing.scope.as_deref(), Some(id));
        if !validation.valid {
            return Err(ComputeError::Eval {
                message: validation
                    .message
                    .unwrap_or_else(|| format!("Invalid name: {:?}", validation.error)),
            });
        }
    }

    // Build updated name
    let reference_changed = updates.refers_to.is_some();
    let updated = DefinedName {
        id: existing.id.clone(),
        name: updates.name.unwrap_or_else(|| existing.name.clone()),
        refers_to: updates
            .refers_to
            .unwrap_or_else(|| existing.refers_to.clone()),
        raw_refers_to: if reference_changed {
            None
        } else {
            existing.raw_refers_to.clone()
        },
        scope: existing.scope.clone(),
        comment: match updates.comment {
            Some(c) => c,
            None => existing.comment.clone(),
        },
        visible: updates.visible.unwrap_or(existing.visible),
        custom_menu: existing.custom_menu.clone(),
        description: existing.description.clone(),
        help: existing.help.clone(),
        status_bar: existing.status_bar.clone(),
        xlm: existing.xlm,
        function: existing.function,
        vb_procedure: existing.vb_procedure,
        publish_to_server: existing.publish_to_server,
        workbook_parameter: existing.workbook_parameter,
        xml_space_preserve: existing.xml_space_preserve,
        order: existing.order,
        linked_range_id: existing.linked_range_id,
    };

    // If name changed, remove old key and add new key
    let old_key = get_defined_name_key(&existing.name, existing.scope.as_deref());
    let new_key = get_defined_name_key(&updated.name, updated.scope.as_deref());

    if old_key != new_key {
        metadata.named_ranges.remove(&old_key);
    }
    metadata.named_ranges.insert(new_key, updated.clone());

    Ok(updated)
}

/// Remove a name while preserving every other scope.
pub(crate) fn remove_named_range_by_id(
    metadata: &mut WorkbookMetadata,
    id: &str,
) -> Result<(), ComputeError> {
    let existing = get_named_range_by_id(metadata, id).ok_or_else(|| ComputeError::Eval {
        message: format!("Defined name with ID {} not found", id),
    })?;
    remove_named_range_by_name(metadata, &existing.name, existing.scope.as_deref());
    Ok(())
}

pub(crate) fn remove_named_ranges_by_scope(metadata: &mut WorkbookMetadata, scope: Option<&str>) {
    let scope = scope.map(normalize_scope);
    metadata.named_ranges.retain(|_, name| name.scope != scope);
}

/// Import typed names in source order, retaining existing names on duplicates.
pub(crate) fn import_named_ranges(
    metadata: &mut WorkbookMetadata,
    names: Vec<StoredDefinedName>,
) -> usize {
    let mut imported = 0;
    for (index, mut name) in names.into_iter().enumerate() {
        name.scope = name.scope.as_deref().map(normalize_scope);
        let key = get_defined_name_key(&name.name, name.scope.as_deref());
        if let std::collections::btree_map::Entry::Vacant(entry) = metadata.named_ranges.entry(key)
        {
            name.order = Some(index as u32);
            entry.insert(name);
            imported += 1;
        }
    }
    imported
}
