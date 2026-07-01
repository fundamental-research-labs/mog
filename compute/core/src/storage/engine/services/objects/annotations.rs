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
    crate::storage::infra::yrs_helpers::now_millis()
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
    sheet_id: &SheetId,
    cell_id: &CellId,
) -> Result<AnnotationFingerprint, ComputeError> {
    match stores.storage.read_cell_from_yrs(sheet_id, cell_id) {
        Some((_value, Some(formula), identity_formula)) => fingerprint(
            AnnotationFingerprintProfile::CellFormula,
            &json!({
                "kind": "cellFormula",
                "formula": formula,
                "identityFormula": identity_formula,
            }),
        ),
        Some((CellValue::Text(text), None, _)) => fingerprint(
            AnnotationFingerprintProfile::CellText,
            &json!({
                "kind": "cellText",
                "text": text.as_ref(),
            }),
        ),
        Some((CellValue::Null, None, _)) | None => fingerprint(
            AnnotationFingerprintProfile::CellBlank,
            &json!({
                "kind": "cellBlank",
            }),
        ),
        Some((value, None, _)) => fingerprint(
            AnnotationFingerprintProfile::CellValue,
            &json!({
                "kind": "cellValue",
                "value": value,
            }),
        ),
    }
}

fn cell_fingerprint_for_hex(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_hex: &str,
) -> Result<Option<AnnotationFingerprint>, ComputeError> {
    let Some(raw_id) = hex_to_id(cell_hex) else {
        return Ok(None);
    };
    let cell_id = CellId::from_raw(raw_id);
    Ok(Some(cell_fingerprint_for_id(stores, sheet_id, &cell_id)?))
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
    mirror: &CellMirror,
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
    let existing = sheet::annotations::get_cell_annotation(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &cell_hex,
    );
    let fingerprint = cell_fingerprint_for_id(stores, sheet_id, &cell_id)?;
    let record = build_record(stores, existing, cell_hex.clone(), text, fingerprint);
    sheet::annotations::set_cell_annotation(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &cell_hex,
        &record,
    )?;
    mutation_result_with_data(&record)
}

pub(in crate::storage::engine) fn get_cell_annotation_by_position(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<Option<AnnotationRecord>, ComputeError> {
    let Some(cell_id) = cell_editing::find_cell_id_at(stores, sheet_id, row, col) else {
        return Ok(None);
    };
    let cell_hex = id_to_hex(cell_id.as_u128()).to_string();
    let Some(record) = sheet::annotations::get_cell_annotation(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &cell_hex,
    ) else {
        return Ok(None);
    };
    let current = Some(cell_fingerprint_for_id(stores, sheet_id, &cell_id)?);
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
    let removed = sheet::annotations::remove_cell_annotation(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &cell_hex,
    );
    mutation_result_with_data(&AnnotationDeleteResult {
        anchor_id: cell_hex,
        removed: removed.is_some(),
        annotation: removed,
    })
}

pub(in crate::storage::engine) fn list_cell_annotations(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Result<Vec<AnnotationRecord>, ComputeError> {
    sheet::annotations::list_cell_annotations(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    )
    .into_iter()
    .map(|record| {
        let current = cell_fingerprint_for_hex(stores, sheet_id, &record.anchor_id)?;
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
    let existing = workbook::annotations::get_table_annotation(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        &anchor_id,
    );
    let fingerprint = table_fingerprint(table)?;
    let record = build_record(stores, existing, anchor_id.clone(), text, fingerprint);
    workbook::annotations::set_table_annotation(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        &anchor_id,
        &record,
    )?;
    mutation_result_with_data(&record)
}

pub(in crate::storage::engine) fn get_table_annotation(
    stores: &EngineStores,
    mirror: &CellMirror,
    table_ref: &str,
) -> Result<Option<AnnotationRecord>, ComputeError> {
    let anchor_id = table_anchor_id(mirror, table_ref);
    let Some(record) = workbook::annotations::get_table_annotation(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        &anchor_id,
    ) else {
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
    let removed = workbook::annotations::remove_table_annotation(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        &anchor_id,
    );
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
    workbook::annotations::list_table_annotations(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    )
    .into_iter()
    .map(|record| {
        let current = resolve_existing_table(mirror, &record.anchor_id)
            .map(table_fingerprint)
            .transpose()?;
        Ok(validate_record(record, current))
    })
    .collect()
}
