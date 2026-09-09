use cell_types::{CellId, SheetId};
use compute_document::hex::{hex_to_id, id_to_hex};
use serde::Serialize;
use serde_json::json;
use snapshot_types::versioning::canonical_digest;
use value_types::{CellValue, ComputeError};

use crate::engine_types::{
    ANNOTATION_FINGERPRINT_CANONICALIZER, ANNOTATION_SCHEMA_VERSION, AnnotationDeleteResult,
    AnnotationFingerprint, AnnotationFingerprintProfile, AnnotationRecord, AnnotationStatus,
};
use crate::mirror::CellMirror;
use crate::snapshot::MutationResult;
use crate::storage::engine::services::cell_editing;
use crate::storage::engine::stores::EngineStores;
use crate::storage::{sheet, workbook};

fn now_millis() -> u64 {
    crate::storage::infra::time::now_millis()
}

fn digest_hash(value: &impl Serialize) -> Result<String, ComputeError> {
    let digest = canonical_digest(value).map_err(|err| ComputeError::Eval {
        message: format!("annotation fingerprint serialization failed: {}", err),
    })?;
    Ok(format!("sha256:{}", digest.value))
}

fn fingerprint(
    profile: AnnotationFingerprintProfile,
    payload: &impl Serialize,
) -> Result<AnnotationFingerprint, ComputeError> {
    Ok(AnnotationFingerprint {
        profile,
        canonicalizer: ANNOTATION_FINGERPRINT_CANONICALIZER.to_string(),
        hash: digest_hash(payload)?,
    })
}

fn cell_fingerprint_for_id(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id: &CellId,
) -> Result<AnnotationFingerprint, ComputeError> {
    if let Some(formula) = crate::storage::engine::formula_read::formula_text_for_cell_id(
        stores, mirror, sheet_id, cell_id,
    ) {
        return fingerprint(
            AnnotationFingerprintProfile::CellFormula,
            &json!({
                "kind": "cellFormula",
                "formula": formula,
                "identityFormula": mirror.get_formula(cell_id),
            }),
        );
    }
    let value = mirror
        .get_sheet(sheet_id)
        .and_then(|sheet| sheet.position_of(cell_id))
        .and_then(|pos| mirror.get_cell_value_at(sheet_id, pos));
    match value {
        Some(CellValue::Text(text)) => fingerprint(
            AnnotationFingerprintProfile::CellText,
            &json!({ "kind": "cellText", "text": text.as_ref() }),
        ),
        Some(CellValue::Null) | None => fingerprint(
            AnnotationFingerprintProfile::CellBlank,
            &json!({ "kind": "cellBlank" }),
        ),
        Some(value) => fingerprint(
            AnnotationFingerprintProfile::CellValue,
            &json!({ "kind": "cellValue", "value": value }),
        ),
    }
}

fn cell_fingerprint_for_hex(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_hex: &str,
) -> Result<Option<AnnotationFingerprint>, ComputeError> {
    let Some(raw_id) = hex_to_id(cell_hex) else {
        return Ok(None);
    };
    let cell_id = CellId::from_raw(raw_id);
    if mirror.sheet_for_cell(&cell_id) != Some(*sheet_id)
        && !stores
            .grid_indexes
            .get(sheet_id)
            .is_some_and(|grid| grid.cell_position(&cell_id).is_some())
    {
        return Ok(None);
    }
    Ok(Some(cell_fingerprint_for_id(
        stores, mirror, sheet_id, &cell_id,
    )?))
}

fn table_fingerprint(
    table: &domain_types::domain::table::TableCatalogEntry,
) -> Result<AnnotationFingerprint, ComputeError> {
    fingerprint(
        AnnotationFingerprintProfile::TableSchema,
        &json!({
            "kind": "tableSchema",
            "table": table,
        }),
    )
}

fn validate_record(
    mut record: AnnotationRecord,
    current: Option<AnnotationFingerprint>,
) -> AnnotationRecord {
    record.checked_at = Some(now_millis());
    match current {
        Some(current)
            if current.profile == record.fingerprint.profile
                && current.canonicalizer == record.fingerprint.canonicalizer
                && current.hash == record.fingerprint.hash =>
        {
            record.status = AnnotationStatus::Fresh;
            record.stale_reason = None;
        }
        Some(_) => {
            record.status = AnnotationStatus::Stale;
            record.stale_reason = Some("fingerprintMismatch".to_string());
        }
        None => {
            record.status = AnnotationStatus::Stale;
            record.stale_reason = Some("anchorMissing".to_string());
        }
    }
    record
}

fn build_record(
    stores: &EngineStores,
    existing: Option<AnnotationRecord>,
    anchor_id: String,
    text: &str,
    fingerprint: AnnotationFingerprint,
) -> AnnotationRecord {
    let now = now_millis();
    AnnotationRecord {
        schema_version: ANNOTATION_SCHEMA_VERSION,
        id: existing
            .as_ref()
            .map(|record| record.id.clone())
            .unwrap_or_else(|| stores.next_id_simple()),
        anchor_id,
        text: text.to_string(),
        status: AnnotationStatus::Fresh,
        stale_reason: None,
        fingerprint,
        created_at: existing
            .as_ref()
            .map(|record| record.created_at)
            .unwrap_or(now),
        updated_at: now,
        checked_at: Some(now),
    }
}

fn mutation_result_with_data(data: &impl Serialize) -> Result<MutationResult, ComputeError> {
    Ok(MutationResult::empty().with_data(data)?)
}

pub(in crate::storage::engine) fn set_cell_annotation_by_position(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    text: &str,
) -> Result<MutationResult, ComputeError> {
    let cell_id = cell_editing::ensure_cell_id_mirrored(stores, mirror, sheet_id, row, col)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
    let cell_hex = id_to_hex(cell_id.as_u128()).to_string();
    let existing = sheet::annotations::get_cell_annotation(&stores.storage, sheet_id, &cell_hex);
    let fingerprint = cell_fingerprint_for_id(stores, mirror, sheet_id, &cell_id)?;
    let record = build_record(stores, existing, cell_hex.clone(), text, fingerprint);
    sheet::annotations::set_cell_annotation(&mut stores.storage, sheet_id, &cell_hex, &record)?;
    mutation_result_with_data(&record)
}

pub(in crate::storage::engine) fn get_cell_annotation_by_position(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<Option<AnnotationRecord>, ComputeError> {
    let Some(cell_id) = cell_editing::find_cell_id_at(stores, sheet_id, row, col) else {
        return Ok(None);
    };
    let cell_hex = id_to_hex(cell_id.as_u128()).to_string();
    let Some(record) =
        sheet::annotations::get_cell_annotation(&stores.storage, sheet_id, &cell_hex)
    else {
        return Ok(None);
    };
    let current = Some(cell_fingerprint_for_id(stores, mirror, sheet_id, &cell_id)?);
    Ok(Some(validate_record(record, current)))
}

pub(in crate::storage::engine) fn remove_cell_annotation_by_position(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    let Some(cell_id) = cell_editing::find_cell_id_at(stores, sheet_id, row, col) else {
        return mutation_result_with_data(&AnnotationDeleteResult {
            anchor_id: String::new(),
            removed: false,
            annotation: None,
        });
    };
    let cell_hex = id_to_hex(cell_id.as_u128()).to_string();
    let removed =
        sheet::annotations::remove_cell_annotation(&mut stores.storage, sheet_id, &cell_hex);
    mutation_result_with_data(&AnnotationDeleteResult {
        anchor_id: cell_hex,
        removed: removed.is_some(),
        annotation: removed,
    })
}

pub(in crate::storage::engine) fn list_cell_annotations(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Result<Vec<AnnotationRecord>, ComputeError> {
    sheet::annotations::list_cell_annotations(&stores.storage, sheet_id)
        .into_iter()
        .map(|record| {
            let current = cell_fingerprint_for_hex(stores, mirror, sheet_id, &record.anchor_id)?;
            Ok(validate_record(record, current))
        })
        .collect()
}

fn resolve_existing_table<'a>(
    mirror: &'a CellMirror,
    table_ref: &str,
) -> Option<&'a domain_types::domain::table::TableCatalogEntry> {
    mirror
        .get_table_by_id(table_ref)
        .or_else(|| mirror.get_table(table_ref))
}

fn resolve_required_table<'a>(
    mirror: &'a CellMirror,
    table_ref: &str,
) -> Result<&'a domain_types::domain::table::TableCatalogEntry, ComputeError> {
    resolve_existing_table(mirror, table_ref).ok_or_else(|| ComputeError::Eval {
        message: format!("Table not found: {}", table_ref),
    })
}

fn table_anchor_id(mirror: &CellMirror, table_ref: &str) -> String {
    resolve_existing_table(mirror, table_ref)
        .map(|table| table.id.clone())
        .unwrap_or_else(|| table_ref.to_string())
}

pub(in crate::storage::engine) fn set_table_annotation(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    table_ref: &str,
    text: &str,
) -> Result<MutationResult, ComputeError> {
    let table = resolve_required_table(mirror, table_ref)?;
    let anchor_id = table.id.clone();
    let existing = workbook::annotations::get_table_annotation(&stores.storage, &anchor_id);
    let fingerprint = table_fingerprint(table)?;
    let record = build_record(stores, existing, anchor_id.clone(), text, fingerprint);
    workbook::annotations::set_table_annotation(&mut stores.storage, &anchor_id, &record)?;
    mutation_result_with_data(&record)
}

pub(in crate::storage::engine) fn get_table_annotation(
    stores: &EngineStores,
    mirror: &CellMirror,
    table_ref: &str,
) -> Result<Option<AnnotationRecord>, ComputeError> {
    let anchor_id = table_anchor_id(mirror, table_ref);
    let Some(record) = workbook::annotations::get_table_annotation(&stores.storage, &anchor_id)
    else {
        return Ok(None);
    };
    let current = resolve_existing_table(mirror, &anchor_id)
        .map(table_fingerprint)
        .transpose()?;
    Ok(Some(validate_record(record, current)))
}

pub(in crate::storage::engine) fn remove_table_annotation(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    table_ref: &str,
) -> Result<MutationResult, ComputeError> {
    let anchor_id = table_anchor_id(mirror, table_ref);
    let removed = workbook::annotations::remove_table_annotation(&mut stores.storage, &anchor_id);
    mutation_result_with_data(&AnnotationDeleteResult {
        anchor_id,
        removed: removed.is_some(),
        annotation: removed,
    })
}

pub(in crate::storage::engine) fn list_table_annotations(
    stores: &EngineStores,
    mirror: &CellMirror,
) -> Result<Vec<AnnotationRecord>, ComputeError> {
    workbook::annotations::list_table_annotations(&stores.storage)
        .into_iter()
        .map(|record| {
            let current = resolve_existing_table(mirror, &record.anchor_id)
                .map(table_fingerprint)
                .transpose()?;
            Ok(validate_record(record, current))
        })
        .collect()
}

/// Copying establishes a new annotation identity and fingerprints its new anchor.
pub(in crate::storage::engine) fn refresh_copied_cell_annotations(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Result<(), ComputeError> {
    let ids: Vec<_> = stores
        .storage
        .sheet_metadata
        .get(sheet_id)
        .into_iter()
        .flat_map(|metadata| metadata.cell_annotations.keys().copied())
        .collect();
    for id in ids {
        let fingerprint = cell_fingerprint_for_id(stores, mirror, sheet_id, &id)?;
        if let Some(record) = stores
            .storage
            .sheet_metadata
            .get_mut(sheet_id)
            .and_then(|metadata| metadata.cell_annotations.get_mut(&id))
        {
            record.fingerprint = fingerprint;
            record.status = AnnotationStatus::Fresh;
            record.stale_reason = None;
            record.checked_at = Some(now_millis());
        }
    }
    Ok(())
}

pub(in crate::storage::engine) fn copy_table_annotation(
    stores: &mut EngineStores,
    source_table: &str,
    table: &domain_types::domain::table::TableCatalogEntry,
) -> Result<(), ComputeError> {
    let Some(mut record) = stores
        .storage
        .metadata
        .table_annotations
        .get(source_table)
        .cloned()
    else {
        return Ok(());
    };
    record.id = stores.next_id_simple();
    record.anchor_id = table.id.clone();
    record.fingerprint = table_fingerprint(table)?;
    record.status = AnnotationStatus::Fresh;
    record.checked_at = Some(now_millis());
    record.stale_reason = None;
    crate::storage::engine::history::metadata::capture_workbook_entry!(
        stores.storage,
        table_annotations,
        table.id
    );
    stores
        .storage
        .metadata
        .table_annotations
        .insert(table.id.clone(), record);
    Ok(())
}
