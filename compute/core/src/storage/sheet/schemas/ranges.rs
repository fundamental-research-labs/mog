use cell_types::IdAllocator;
use cell_types::SheetId;
use compute_document::schema::KEY_VALIDATION_RULES;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;
use yrs::{Doc, Map, MapRef, Origin, Transact, TransactionMut};

use super::{RangeSchema, range_store, range_view, validation_rules, yrs_io};
use crate::storage::sheet::yrs_helpers::KEY_DV_DECLARED_COUNT;

pub fn get_range_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Option<RangeSchema> {
    let txn = doc.transact();
    let specs = range_store::read_range_backed_validation_entries(&txn, sheets, sheet_id);
    specs.iter().find_map(|entry| {
        if entry.rule_id == schema_id {
            range_view::spec_to_range_schema(&entry.spec, entry.rule_id.clone())
        } else {
            None
        }
    })
}

pub fn get_range_schemas_for_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<RangeSchema> {
    let txn = doc.transact();
    let specs = range_store::read_range_backed_validation_entries(&txn, sheets, sheet_id);
    specs
        .iter()
        .filter_map(|entry| range_view::spec_to_range_schema(&entry.spec, entry.rule_id.clone()))
        .collect()
}

pub fn set_range_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema: &RangeSchema,
) -> Result<(), ComputeError> {
    set_range_schema_with_alloc(
        doc,
        sheets,
        sheet_id,
        schema,
        &crate::storage::RUNTIME_METADATA_ID_ALLOC,
    )
}

pub fn set_range_schema_with_alloc(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema: &RangeSchema,
    id_alloc: &IdAllocator,
) -> Result<(), ComputeError> {
    upsert_range_schema_by_id(doc, sheets, sheet_id, &schema.id, schema, id_alloc)
}

pub fn update_range_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema_id: &str,
    updates: &RangeSchema,
) -> Result<(), ComputeError> {
    update_range_schema_with_alloc(
        doc,
        sheets,
        sheet_id,
        schema_id,
        updates,
        &crate::storage::RUNTIME_METADATA_ID_ALLOC,
    )
}

pub fn update_range_schema_with_alloc(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema_id: &str,
    updates: &RangeSchema,
    id_alloc: &IdAllocator,
) -> Result<(), ComputeError> {
    upsert_range_schema_by_id(doc, sheets, sheet_id, schema_id, updates, id_alloc)
}

fn upsert_range_schema_by_id(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema_id: &str,
    schema: &RangeSchema,
    id_alloc: &IdAllocator,
) -> Result<(), ComputeError> {
    let new_spec = match schema.to_validation_spec() {
        Some(s) => s,
        None => return Ok(()),
    };

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let Some(meta_map) = yrs_io::get_properties_map(&txn, sheets, sheet_id) else {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    };
    clear_imported_validation_fidelity(&mut txn, &meta_map);

    let priority = yrs_io::get_sheet_sub_map(&txn, sheets, sheet_id, KEY_VALIDATION_RULES)
        .map(|rules_map| {
            validation_rules::validation_rule_priority(&txn, &rules_map, schema_id).unwrap_or_else(
                || validation_rules::next_validation_rule_priority(&txn, &rules_map),
            )
        })
        .unwrap_or(0);

    range_store::delete_validation_ranges_for_rule(&mut txn, sheets, sheet_id, schema_id);
    range_store::create_validation_ranges(
        &mut txn, sheets, sheet_id, schema_id, &new_spec, priority, id_alloc,
    );

    Ok(())
}

pub fn delete_range_schema(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, schema_id: &str) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let Some(meta_map) = yrs_io::get_properties_map(&txn, sheets, sheet_id) else {
        return;
    };
    clear_imported_validation_fidelity(&mut txn, &meta_map);

    range_store::delete_validation_ranges_for_rule(&mut txn, sheets, sheet_id, schema_id);
}

fn clear_imported_validation_fidelity(txn: &mut TransactionMut, meta_map: &MapRef) {
    for key in [
        "dataValidations",
        "x14DataValidations",
        KEY_DV_DECLARED_COUNT,
        "x14DvDeclaredCount",
    ] {
        meta_map.remove(txn, key);
    }
}
