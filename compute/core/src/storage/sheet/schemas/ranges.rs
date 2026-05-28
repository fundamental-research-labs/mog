use cell_types::SheetId;
use compute_document::schema::KEY_VALIDATION_RULES;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;
use yrs::{Doc, Map, MapRef, Origin, Transact};

use super::{RangeSchema, range_store, range_view, validation_rules, yrs_io};
use crate::storage::sheet::yrs_helpers::KEY_DV_DECLARED_COUNT;

pub fn get_range_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Option<RangeSchema> {
    let txn = doc.transact();
    let specs = range_store::read_range_backed_validation_specs(&txn, sheets, sheet_id);
    specs.iter().enumerate().find_map(|(idx, spec)| {
        let id = range_view::range_schema_id_for(spec, idx);
        if id == schema_id {
            range_view::spec_to_range_schema(spec, id)
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
    let specs = range_store::read_range_backed_validation_specs(&txn, sheets, sheet_id);
    specs
        .iter()
        .enumerate()
        .filter_map(|(idx, spec)| {
            range_view::spec_to_range_schema(spec, range_view::range_schema_id_for(spec, idx))
        })
        .collect()
}

pub fn set_range_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema: &RangeSchema,
) -> Result<(), ComputeError> {
    upsert_range_schema_by_id(doc, sheets, sheet_id, &schema.id, schema)
}

pub fn update_range_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema_id: &str,
    updates: &RangeSchema,
) -> Result<(), ComputeError> {
    upsert_range_schema_by_id(doc, sheets, sheet_id, schema_id, updates)
}

fn upsert_range_schema_by_id(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema_id: &str,
    schema: &RangeSchema,
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
    meta_map.remove(&mut txn, KEY_DV_DECLARED_COUNT);

    let priority = yrs_io::get_sheet_sub_map(&txn, sheets, sheet_id, KEY_VALIDATION_RULES)
        .map(|rules_map| {
            validation_rules::validation_rule_priority(&txn, &rules_map, schema_id).unwrap_or_else(
                || validation_rules::next_validation_rule_priority(&txn, &rules_map),
            )
        })
        .unwrap_or(0);

    range_store::delete_validation_ranges_for_rule(&mut txn, sheets, sheet_id, schema_id);
    range_store::create_validation_ranges(
        &mut txn, sheets, sheet_id, schema_id, &new_spec, priority,
    );

    Ok(())
}

pub fn delete_range_schema(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, schema_id: &str) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let Some(meta_map) = yrs_io::get_properties_map(&txn, sheets, sheet_id) else {
        return;
    };
    meta_map.remove(&mut txn, KEY_DV_DECLARED_COUNT);

    range_store::delete_validation_ranges_for_rule(&mut txn, sheets, sheet_id, schema_id);
}
