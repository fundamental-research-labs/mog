use yrs::{Doc, Map, MapRef, Origin, Transact};

use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::named_range::{DefinedName, DefinedNameInput, NamedRangeUpdate};
use value_types::ComputeError;

use super::keys::get_defined_name_key;
use super::queries::{get_named_range_by_id, get_named_ranges_by_scope};
use super::validation::validate_name;
use super::yrs_codec::{
    ensure_named_ranges_map, get_named_ranges_map, write_named_range_structured,
};

/// Upsert a named range into Yrs storage (insert or overwrite).
///
/// Unlike `create_named_range`, this skips validation — the caller is
/// responsible for ensuring the name is valid. This is used by the bridge
/// `set_named_range` path where validation already happened at the API layer.
pub fn upsert_named_range(doc: &Doc, workbook: &MapRef, dn: &DefinedName) {
    let key = get_defined_name_key(&dn.name, dn.scope.as_deref());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    // Provider Protocol lifecycle: lazy-create the namedRanges sub-map if missing.
    let nr_map = ensure_named_ranges_map(workbook, &mut txn);
    write_named_range_structured(&nr_map, &mut txn, &key, dn, None);
}

/// Remove a named range from Yrs storage by name and scope.
pub fn remove_named_range_by_name(doc: &Doc, workbook: &MapRef, name: &str, scope: Option<&str>) {
    let key = get_defined_name_key(name, scope);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = match get_named_ranges_map(workbook, &txn) {
        Some(m) => m,
        None => return,
    };
    nr_map.remove(&mut txn, &key);
}

/// Create a new defined name.
///
/// Validates the name and returns an error if invalid or duplicate.
pub fn create_named_range(
    doc: &Doc,
    workbook: &MapRef,
    input: DefinedNameInput,
    id_alloc: &cell_types::IdAllocator,
) -> Result<DefinedName, ComputeError> {
    // Validate
    let validation = validate_name(doc, workbook, &input.name, input.scope.as_deref(), None);
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
        scope: input.scope.clone(),
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

    // Store in Yrs
    let key = get_defined_name_key(&input.name, input.scope.as_deref());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = ensure_named_ranges_map(workbook, &mut txn);
    write_named_range_structured(&nr_map, &mut txn, &key, &defined_name, None);

    Ok(defined_name)
}

/// Update an existing defined name.
///
/// Returns the updated name, or an error if not found or the update is invalid.
pub fn update_named_range(
    doc: &Doc,
    workbook: &MapRef,
    id: &str,
    updates: NamedRangeUpdate,
) -> Result<DefinedName, ComputeError> {
    // Find existing
    let existing = get_named_range_by_id(doc, workbook, id).ok_or_else(|| ComputeError::Eval {
        message: format!("Defined name with ID {} not found", id),
    })?;

    // If renaming, validate new name
    if let Some(ref new_name) = updates.name
        && new_name != &existing.name
    {
        let validation =
            validate_name(doc, workbook, new_name, existing.scope.as_deref(), Some(id));
        if !validation.valid {
            return Err(ComputeError::Eval {
                message: validation
                    .message
                    .unwrap_or_else(|| format!("Invalid name: {:?}", validation.error)),
            });
        }
    }

    // Build updated name
    let updated = DefinedName {
        id: existing.id.clone(),
        name: updates.name.unwrap_or_else(|| existing.name.clone()),
        refers_to: updates
            .refers_to
            .unwrap_or_else(|| existing.refers_to.clone()),
        raw_refers_to: existing.raw_refers_to.clone(),
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

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = ensure_named_ranges_map(workbook, &mut txn);

    if old_key != new_key {
        nr_map.remove(&mut txn, &old_key);
    }
    write_named_range_structured(&nr_map, &mut txn, &new_key, &updated, None);

    Ok(updated)
}

/// Delete a defined name by ID.
pub fn remove_named_range_by_id(
    doc: &Doc,
    workbook: &MapRef,
    id: &str,
) -> Result<(), ComputeError> {
    let existing = get_named_range_by_id(doc, workbook, id).ok_or_else(|| ComputeError::Eval {
        message: format!("Defined name with ID {} not found", id),
    })?;

    let key = get_defined_name_key(&existing.name, existing.scope.as_deref());

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = ensure_named_ranges_map(workbook, &mut txn);
    nr_map.remove(&mut txn, &key);

    Ok(())
}

/// Delete all defined names in a scope.
///
/// Useful when deleting a sheet (removes all sheet-scoped names).
pub fn remove_named_ranges_by_scope(doc: &Doc, workbook: &MapRef, scope: Option<&str>) {
    let names = get_named_ranges_by_scope(doc, workbook, scope);
    if names.is_empty() {
        return;
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = match get_named_ranges_map(workbook, &txn) {
        Some(m) => m,
        None => return,
    };

    for dn in &names {
        let key = get_defined_name_key(&dn.name, dn.scope.as_deref());
        nr_map.remove(&mut txn, &key);
    }
}

/// Import multiple defined names (e.g., from XLSX).
///
/// Duplicates are skipped (not errors). Returns the number of successfully imported names.
pub fn import_named_ranges(doc: &Doc, workbook: &MapRef, names: Vec<DefinedName>) -> usize {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let nr_map = match get_named_ranges_map(workbook, &txn) {
        Some(m) => m,
        None => return 0,
    };

    let mut imported = 0;
    for (idx, dn) in names.iter().enumerate() {
        let key = get_defined_name_key(&dn.name, dn.scope.as_deref());

        // Skip if already exists
        if nr_map.get(&txn, &key).is_some() {
            continue;
        }

        write_named_range_structured(&nr_map, &mut txn, &key, dn, Some(idx as u32));
        imported += 1;
    }

    imported
}
