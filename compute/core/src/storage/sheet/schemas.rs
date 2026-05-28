//! Column schema and range schema (data validation) CRUD operations.
//!
//! Column schemas live under `sheets/{hex}/schemas` (keyed by ColId hex) and
//! are independent of data validations.
//!
//! Range schemas (data validations) are stored via the Range-backed store:
//! rule bodies live in `sheets/{hex}/validationRules`, individual range
//! entries live in `sheets/{hex}/ranges` with bindings in `rangeBindings`.
//! The runtime API translates between [`RangeSchema`] and [`ValidationSpec`]
//! at the boundary.

use std::sync::Arc;

use compute_document::undo::ORIGIN_USER_EDIT;
use serde::{Deserialize, Serialize};
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, ReadTxn, Transact};

use crate::eval::sync_block_on;
use crate::eval_bridge::MirrorContext;
use crate::eval_bridge::mirror_access::PendingCellOverride;
use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use crate::scheduler::ast_transform::shift_ast_for_cf;
use crate::storage::sheet::yrs_helpers::KEY_DV_DECLARED_COUNT;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use compute_document::range::ValidationBinding;
use compute_document::schema::{
    KEY_PROPERTIES, KEY_RANGE_BINDINGS, KEY_RANGE_PAYLOADS, KEY_RANGES, KEY_SCHEMAS,
    KEY_VALIDATION_RULES,
};
use compute_parser::parse_formula;
use value_types::{CellValue, ComputeError};

// Re-export pure domain types from domain-types.
pub use domain_types::domain::validation::*;

fn get_schemas_map<T: ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sm = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, KEY_SCHEMAS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Get the `properties` Y.Map for a sheet (read-only).
fn get_properties_map<T: ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sm = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, KEY_PROPERTIES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Get the per-sheet map by key (e.g. `ranges`, `rangeBindings`, `validationRules`).
fn get_sheet_sub_map<T: ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    key: &str,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sm = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

fn ensure_sheet_sub_map(
    txn: &mut yrs::TransactionMut<'_>,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    key: &'static str,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sm = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            Some(sm.insert(txn, key, empty))
        }
    }
}

/// Resolve a ColId hex string to its column position via the GridIndex.
fn col_id_hex_to_position(gi: &GridIndex, col_id_hex: &str) -> Option<u32> {
    let raw = compute_document::hex::hex_to_id(col_id_hex)?;
    let cid = cell_types::ColId::from_raw(raw);
    gi.col_index(&cid)
}

fn parse_range_corners(rr: &IdentityRangeSchemaRef) -> Option<((u32, u32), (u32, u32))> {
    fn parse_row_col(id: &str) -> Option<(u32, u32)> {
        let (r_str, c_str) = id.split_once(':')?;
        Some((r_str.parse::<u32>().ok()?, c_str.parse::<u32>().ok()?))
    }
    Some((parse_row_col(&rr.start_id)?, parse_row_col(&rr.end_id)?))
}

/// Check whether the given (row, col) position falls within a range.
///
/// Range IDs use the lightweight "row:col" encoding (e.g. "0:0" to "10:5").
/// This is sufficient for the compute-core validation path where the caller
/// resolves CellId-based refs to positional strings before checking.
/// Returns `false` if the IDs cannot be parsed.
fn position_in_range(row: u32, col: u32, rr: &IdentityRangeSchemaRef) -> bool {
    let Some(((sr, sc), (er, ec))) = parse_range_corners(rr) else {
        return false;
    };
    let min_r = sr.min(er);
    let max_r = sr.max(er);
    let min_c = sc.min(ec);
    let max_c = sc.max(ec);
    row >= min_r && row <= max_r && col >= min_c && col <= max_c
}

/// Return the top-left corner of the first range in `ranges` that contains
/// `(row, col)`. Used as the anchor for relative-reference shifting in
/// custom-formula data validations (Excel parity: the formula is authored
/// against the anchor and shifts per-cell).
fn anchor_of_first_containing_range(
    ranges: &[IdentityRangeSchemaRef],
    row: u32,
    col: u32,
) -> Option<(u32, u32)> {
    for rr in ranges {
        if !position_in_range(row, col, rr) {
            continue;
        }
        let ((sr, sc), (er, ec)) = parse_range_corners(rr)?;
        return Some((sr.min(er), sc.min(ec)));
    }
    None
}

/// Convert a string value to a `CellValue` for the compute-schema validator.
///
/// Tries parsing as f64, then bool, falls back to text.
fn str_to_cell_value(s: &str) -> value_types::CellValue {
    if s.is_empty() {
        return value_types::CellValue::Text(Arc::from(""));
    }
    if let Ok(n) = s.parse::<f64>()
        && let Some(f) = value_types::FiniteF64::new(n)
    {
        return value_types::CellValue::Number(f);
    }
    match s {
        "true" => value_types::CellValue::Boolean(true),
        "false" => value_types::CellValue::Boolean(false),
        _ => value_types::CellValue::Text(Arc::from(s)),
    }
}

// =============================================================================
// Column schema Y.Map read/write — delegated to domain_types::yrs_schema::column_schema
// =============================================================================

use domain_types::yrs_schema::column_schema;

/// Read a ColumnSchema from a Yrs Out value.
fn read_column_schema_from_out<T: ReadTxn>(out: &Out, txn: &T) -> Option<ColumnSchema> {
    column_schema::column_from_yrs_out(out, txn)
}

/// Write a ColumnSchema into a parent Y.Map at the given key.
fn write_column_schema(
    parent: &MapRef,
    txn: &mut yrs::TransactionMut,
    key: &str,
    cs: &ColumnSchema,
) {
    column_schema::write_column_schema(parent, txn, key, cs);
}

// =============================================================================
// Range schema <-> ValidationSpec adapter (the view layer)
// =============================================================================

/// Assign a stable id to a [`ValidationSpec`] when viewed as a [`RangeSchema`].
///
/// Prefers `spec.uid` (the xr:uid from the original XLSX, or a uid stored by an
/// earlier runtime `set_range_schema` call) and falls back to a synthetic
/// `rs-{idx}` id for anonymous specs.
fn range_schema_id_for(spec: &ValidationSpec, idx: usize) -> String {
    spec.uid
        .as_ref()
        .filter(|u| !u.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("rs-{idx}"))
}

/// View a stored [`ValidationSpec`] as a [`RangeSchema`] with the given id.
fn spec_to_range_schema(spec: &ValidationSpec, id: String) -> Option<RangeSchema> {
    spec.to_range_schema(id)
}

// =============================================================================
// Schema CRUD (free functions)
// =============================================================================

/// Get the column schema at the given column index.
///
/// Returns `None` if the column has no ColId in the GridIndex or no schema entry.
pub fn get_column_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col_index: u32,
    grid_index: Option<&GridIndex>,
) -> Option<ColumnSchema> {
    let col_id = id_to_hex(grid_index?.col_id(col_index)?.as_u128());
    let txn = doc.transact();
    let sm = get_schemas_map(&txn, sheets, sheet_id)?;
    let out = sm.get(&txn, &col_id)?;
    read_column_schema_from_out(&out, &txn)
}

/// Set (create or overwrite) a column schema at the given column index.
///
/// All columns have IDs from creation (via GridIndex). Serializes the schema
/// as a structured Y.Map into the `schemas` sub-map keyed by the ColId hex.
pub fn set_column_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col_index: u32,
    schema: &ColumnSchema,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let col_id = grid_index
        .and_then(|gi| gi.col_id(col_index))
        .map(|cid| id_to_hex(cid.as_u128()))
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sm =
        get_schemas_map(&txn, sheets, sheet_id).ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
    write_column_schema(&sm, &mut txn, &col_id, schema);
    Ok(())
}

/// Remove the column schema at the given column index.
///
/// No-op if the column has no ColId or no schema entry.
pub fn clear_column_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col_index: u32,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let col_id = match grid_index.and_then(|gi| gi.col_id(col_index)) {
        Some(cid) => id_to_hex(cid.as_u128()),
        None => return Ok(()), // nothing to clear
    };
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(sm) = get_schemas_map(&txn, sheets, sheet_id) {
        sm.remove(&mut txn, &col_id);
    }
    Ok(())
}

/// Return all column schemas for a sheet as `(col_position, ColumnSchema)` pairs.
///
/// Iterates through the `schemas` sub-map, resolves each ColId key to its
/// column position via the GridIndex, and deserializes the value.
/// Results are sorted by column position.
pub fn get_all_column_schemas(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, ColumnSchema)> {
    let gi = match grid_index {
        Some(g) => g,
        None => return vec![],
    };
    let txn = doc.transact();
    let sm = match get_schemas_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (col_id, value) in sm.iter(&txn) {
        if let Some(schema) = read_column_schema_from_out(&value, &txn)
            && let Some(pos) = col_id_hex_to_position(gi, col_id)
        {
            result.push((pos, schema));
        }
    }
    result.sort_by_key(|(pos, _)| *pos);
    result
}

/// Get a single range schema by its id.
///
/// Ids are the `uid` carried on the stored [`ValidationSpec`] (typically
/// the `xr:uid` from the original XLSX or the runtime-assigned schema id).
pub fn get_range_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Option<RangeSchema> {
    let txn = doc.transact();
    let specs = read_range_backed_validation_specs(&txn, sheets, sheet_id);
    specs.iter().enumerate().find_map(|(idx, spec)| {
        let id = range_schema_id_for(spec, idx);
        if id == schema_id {
            spec_to_range_schema(spec, id)
        } else {
            None
        }
    })
}

/// Return all range schemas for a sheet.
///
/// Reads every [`ValidationSpec`] from the Range-backed `validationRules`
/// store and converts each to a [`RangeSchema`] view.
pub fn get_range_schemas_for_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<RangeSchema> {
    let txn = doc.transact();
    let specs = read_range_backed_validation_specs(&txn, sheets, sheet_id);
    specs
        .iter()
        .enumerate()
        .filter_map(|(idx, spec)| spec_to_range_schema(spec, range_schema_id_for(spec, idx)))
        .collect()
}

/// Create or overwrite a range schema.
///
/// Translates `schema` to a [`ValidationSpec`] and either replaces the existing
/// entry (when an entry with the same view id exists) or appends a new one.
pub fn set_range_schema(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    schema: &RangeSchema,
) -> Result<(), ComputeError> {
    upsert_range_schema_by_id(doc, sheets, sheet_id, &schema.id, schema)
}

/// Update an existing range schema by id.
///
/// Semantics are `upsert` — the entry is replaced if present, otherwise
/// appended. Mirrors the pre-refactor behaviour of `set_range_schema`.
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
        None => return Ok(()), // nothing convertible — silent no-op
    };

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    // Verify the sheet exists (properties map must be present).
    let Some(meta_map) = get_properties_map(&txn, sheets, sheet_id) else {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    };
    meta_map.remove(&mut txn, KEY_DV_DECLARED_COUNT);

    let priority = get_sheet_sub_map(&txn, sheets, sheet_id, KEY_VALIDATION_RULES)
        .map(|rules_map| {
            validation_rule_priority(&txn, &rules_map, schema_id)
                .unwrap_or_else(|| next_validation_rule_priority(&txn, &rules_map))
        })
        .unwrap_or(0);

    // Remove old Range-backed entries for this rule (if updating).
    delete_validation_ranges_for_rule(&mut txn, sheets, sheet_id, schema_id);

    // Write Range-backed validation entries.
    create_validation_ranges(&mut txn, sheets, sheet_id, schema_id, &new_spec, priority);

    Ok(())
}

/// Delete a range schema by id.
///
/// Removes associated `RangeKind::Validation` ranges and performs orphan GC
/// on the `validationRules` map.
pub fn delete_range_schema(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, schema_id: &str) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let Some(meta_map) = get_properties_map(&txn, sheets, sheet_id) else {
        return;
    };
    meta_map.remove(&mut txn, KEY_DV_DECLARED_COUNT);

    // Remove associated Range-backed validation entries.
    delete_validation_ranges_for_rule(&mut txn, sheets, sheet_id, schema_id);
}

// =============================================================================
// Range-backed validation helpers (Phase 5D)
// =============================================================================

const VALIDATION_RULE_STORAGE_VERSION: u32 = 1;

#[derive(Debug, Clone)]
struct OrderedValidationRule {
    rule_id: String,
    spec: ValidationSpec,
    priority: u64,
}

#[derive(Debug)]
struct ParsedValidationRule {
    rule_id: String,
    spec: ValidationSpec,
    priority: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredValidationRuleRef<'a> {
    version: u32,
    priority: u64,
    spec: &'a ValidationSpec,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredValidationRule {
    #[serde(rename = "version")]
    _version: u32,
    priority: u64,
    spec: ValidationSpec,
}

/// Serialize a `ValidationSpec` as the rule body JSON for storage in
/// `validationRules`. The full spec (including ranges) and rule priority are
/// stored so the Range-backed read path can preserve first-match semantics.
fn validation_spec_to_rule_json(spec: &ValidationSpec, priority: u64) -> String {
    let stored = StoredValidationRuleRef {
        version: VALIDATION_RULE_STORAGE_VERSION,
        priority,
        spec,
    };
    serde_json::to_string(&stored).expect("ValidationSpec must serialize")
}

fn rule_json_to_parsed_validation_rule(rule_id: &str, json: &str) -> Option<ParsedValidationRule> {
    if let Ok(stored) = serde_json::from_str::<StoredValidationRule>(json) {
        return Some(ParsedValidationRule {
            rule_id: rule_id.to_string(),
            spec: stored.spec,
            priority: Some(stored.priority),
        });
    }

    serde_json::from_str::<ValidationSpec>(json)
        .ok()
        .map(|spec| ParsedValidationRule {
            rule_id: rule_id.to_string(),
            spec,
            priority: None,
        })
}

fn read_ordered_validation_rules(
    txn: &impl ReadTxn,
    rules_map: &MapRef,
) -> Vec<OrderedValidationRule> {
    let mut parsed: Vec<ParsedValidationRule> =
        compute_document::range::read_all_validation_rules(txn, rules_map)
            .into_iter()
            .filter_map(|(rule_id, rule_json)| {
                rule_json_to_parsed_validation_rule(&rule_id, &rule_json)
            })
            .collect();

    // Legacy rule bodies predate the explicit priority field. Their original
    // insertion order cannot be recovered from the Y.Map, so use rule id as a
    // deterministic fallback and keep newly-written rules after them.
    parsed.sort_by(|a, b| a.rule_id.cmp(&b.rule_id));

    let mut next_legacy_priority = 0;
    let mut ordered: Vec<OrderedValidationRule> = parsed
        .into_iter()
        .map(|rule| {
            let priority = rule.priority.unwrap_or_else(|| {
                let priority = next_legacy_priority;
                next_legacy_priority += 1;
                priority
            });
            OrderedValidationRule {
                rule_id: rule.rule_id,
                spec: rule.spec,
                priority,
            }
        })
        .collect();

    ordered.sort_by(|a, b| {
        a.priority
            .cmp(&b.priority)
            .then_with(|| a.rule_id.cmp(&b.rule_id))
    });
    ordered
}

fn validation_rule_priority(txn: &impl ReadTxn, rules_map: &MapRef, rule_id: &str) -> Option<u64> {
    read_ordered_validation_rules(txn, rules_map)
        .into_iter()
        .find(|rule| rule.rule_id == rule_id)
        .map(|rule| rule.priority)
}

fn next_validation_rule_priority(txn: &impl ReadTxn, rules_map: &MapRef) -> u64 {
    read_ordered_validation_rules(txn, rules_map)
        .into_iter()
        .map(|rule| rule.priority)
        .max()
        .map_or(0, |priority| priority.saturating_add(1))
}

/// Create `RangeKind::Validation` Range entries for each region in a
/// `ValidationSpec`, storing the rule body in `validationRules` and a
/// `ValidationBinding` in `rangeBindings` for each Range.
///
/// `rule_id` is the stable key (typically the spec's uid or schema id).
fn create_validation_ranges(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    rule_id: &str,
    spec: &ValidationSpec,
    priority: u64,
) {
    let Some(rules_map) = ensure_sheet_sub_map(txn, sheets_root, sheet_id, KEY_VALIDATION_RULES)
    else {
        return;
    };
    let Some(ranges_map) = ensure_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGES) else {
        return;
    };
    let Some(payloads_map) = ensure_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_PAYLOADS)
    else {
        return;
    };
    let Some(bindings_map) = ensure_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_BINDINGS)
    else {
        return;
    };

    // 1. Store rule body
    let rule_json = validation_spec_to_rule_json(spec, priority);
    compute_document::range::write_validation_rule(txn, &rules_map, rule_id, &rule_json);

    // 2. Create a Range entry for each A1 range string in spec.ranges
    let binding = ValidationBinding {
        rule_ref: rule_id.to_string(),
    };
    let binding_bytes = binding.to_bytes();

    for _range_str in &spec.ranges {
        let range_id = cell_types::RangeId::from_raw(uuid::Uuid::new_v4().as_u128());
        let metadata = compute_document::range::RangeMetadata {
            range_id,
            kind: cell_types::RangeKind::Validation,
            anchor: cell_types::RangeAnchor::Strict {
                row_ids: Vec::new(),
                col_ids: Vec::new(),
            },
            encoding: cell_types::PayloadEncoding::None,
            row_axis: None,
            col_axis: None,
            row_ids: Vec::new(),
            col_ids: Vec::new(),
        };
        compute_document::range::write_range_to_yrs(
            txn,
            &ranges_map,
            &payloads_map,
            &metadata,
            &[],
        );
        compute_document::range::write_range_binding(txn, &bindings_map, &range_id, &binding_bytes);
    }
}

/// Write imported XLSX validation specs into the live range-backed validation
/// store while preserving the lossless `properties/dataValidations` metadata
/// for export.
pub(crate) fn write_imported_validation_specs(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    specs: &[ValidationSpec],
    anonymous_id_prefix: &str,
) {
    for (idx, spec) in specs.iter().enumerate() {
        let base_id = range_schema_id_for(spec, idx);
        let rule_id = if spec.uid.as_deref().unwrap_or_default().is_empty() {
            format!("{anonymous_id_prefix}{base_id}")
        } else {
            base_id
        };
        create_validation_ranges(txn, sheets_root, sheet_id, &rule_id, spec, idx as u64);
    }
}

/// Delete all `RangeKind::Validation` Range entries whose binding references
/// `rule_id`. Performs orphan GC on the rule body afterward.
fn delete_validation_ranges_for_rule(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    rule_id: &str,
) {
    let Some(ranges_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGES) else {
        return;
    };
    let Some(payloads_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_PAYLOADS)
    else {
        return;
    };
    let Some(bindings_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_BINDINGS)
    else {
        return;
    };

    // Collect range IDs to remove (can't mutate while iterating).
    let entries = compute_document::range::read_ranges_from_yrs(txn, &ranges_map, &payloads_map);
    let mut to_remove = Vec::new();
    for entry in &entries {
        if entry.metadata.kind != cell_types::RangeKind::Validation {
            continue;
        }
        if let Some(binding_data) = compute_document::range::read_range_binding(
            txn,
            &bindings_map,
            &entry.metadata.range_id,
        ) && let Some(binding) = ValidationBinding::from_bytes(&binding_data)
            && binding.rule_ref == rule_id
        {
            to_remove.push(entry.metadata.range_id);
        }
    }

    for range_id in &to_remove {
        compute_document::range::remove_range_from_yrs(txn, &ranges_map, &payloads_map, range_id);
        compute_document::range::remove_range_binding(txn, &bindings_map, range_id);
    }

    // Orphan GC: if no more bindings reference this rule, remove the rule body.
    if let Some(rules_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_VALIDATION_RULES) {
        let remaining =
            compute_document::range::count_bindings_for_rule(txn, &bindings_map, rule_id);
        if remaining == 0 {
            compute_document::range::remove_validation_rule(txn, &rules_map, rule_id);
        }
    }
}

/// Read `ValidationSpec` entries from the Range-backed store. Each unique
/// rule in `validationRules` that has at least one `RangeKind::Validation`
/// Range entry is reconstructed from its stored JSON body.
fn read_range_backed_validation_specs(
    txn: &impl ReadTxn,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Vec<ValidationSpec> {
    let Some(ranges_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGES) else {
        return Vec::new();
    };
    let Some(payloads_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_PAYLOADS)
    else {
        return Vec::new();
    };
    let Some(bindings_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_BINDINGS)
    else {
        return Vec::new();
    };
    let Some(rules_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_VALIDATION_RULES)
    else {
        return Vec::new();
    };

    // Collect unique rule_refs from validation range bindings.
    let entries = compute_document::range::read_ranges_from_yrs(txn, &ranges_map, &payloads_map);
    let mut seen_rules: std::collections::HashSet<String> = std::collections::HashSet::new();

    for entry in &entries {
        if entry.metadata.kind != cell_types::RangeKind::Validation {
            continue;
        }
        if let Some(binding_data) = compute_document::range::read_range_binding(
            txn,
            &bindings_map,
            &entry.metadata.range_id,
        ) && let Some(binding) = ValidationBinding::from_bytes(&binding_data)
        {
            seen_rules.insert(binding.rule_ref);
        }
    }

    // Reconstruct specs from rule bodies in validation priority order.
    let mut specs = Vec::new();
    for rule in read_ordered_validation_rules(txn, &rules_map) {
        if seen_rules.contains(&rule.rule_id) {
            let mut spec = rule.spec;
            spec.uid = Some(rule.rule_id);
            specs.push(spec);
        }
    }
    specs
}

/// Returns true if the schema's constraints include a non-empty formula.
fn schema_has_formula_constraint(schema: &ColumnSchema) -> bool {
    schema
        .constraints
        .as_ref()
        .and_then(|c| c.formula.as_ref())
        .map(|f| !f.is_empty())
        .unwrap_or(false)
}

/// Run the standard validator, augmented with the formula-constraint check
/// when the schema has a `formula` constraint. The pending typed value is
/// substituted at the cell's position so custom formulas referencing the
/// validated cell observe the entry under evaluation rather than the
/// pre-commit mirror state.
///
/// `anchor` is the top-left of the rule's range and provides the
/// `(row_delta, col_delta)` shift for relative references. For column
/// schemas (unbounded down a column), pass `(row, col)` to yield a zero
/// shift relative to the cell itself.
fn validate_with_optional_formula(
    cell_value: &CellValue,
    schema: &ColumnSchema,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    anchor_row: u32,
    anchor_col: u32,
    grid_index: Option<&GridIndex>,
) -> compute_schema::types::ValidationResult {
    if !schema_has_formula_constraint(schema) {
        return compute_schema::validator::validate(cell_value, schema);
    }

    let row_delta = row as i64 - anchor_row as i64;
    let col_delta = col as i64 - anchor_col as i64;
    let current_cell_id = grid_index
        .and_then(|g| g.cell_id_at(row, col))
        .unwrap_or_else(|| CellId::from_raw(0));
    let pending = PendingCellOverride {
        sheet: *sheet_id,
        pos: SheetPos::new(row, col),
        value: cell_value.clone(),
    };

    compute_schema::validator::validate_with_formula_evaluator(cell_value, schema, |formula_str| {
        let spanned = parse_formula(formula_str, None).ok()?;
        let shifted = shift_ast_for_cf(&spanned.node, row_delta, col_delta, *sheet_id);
        let ctx = MirrorContext::with_pending_override(
            mirror,
            current_cell_id,
            *sheet_id,
            pending.clone(),
        );
        sync_block_on(crate::eval::Evaluator::evaluate(&shifted, &ctx, &ctx)).ok()
    })
}

fn validation_cell_value_to_string(value: &CellValue) -> Option<String> {
    match value {
        CellValue::Null => None,
        CellValue::Text(s) => Some(s.to_string()),
        CellValue::Number(n) => {
            let value = n.get();
            if value.fract() == 0.0 && value.abs() < i64::MAX as f64 {
                Some(format!("{}", value as i64))
            } else {
                Some(format!("{value}"))
            }
        }
        CellValue::Boolean(b) => Some(b.to_string()),
        CellValue::Error(..) => None,
        CellValue::Array(arr) => arr.get(0, 0).and_then(validation_cell_value_to_string),
        CellValue::Control(control) => Some(control.value.to_string()),
    }
}

fn resolve_enum_source_values(
    source: &IdentityRangeSchemaRef,
    default_sheet_id: &SheetId,
    mirror: &CellMirror,
) -> Option<Vec<String>> {
    let sheet_id = match source.sheet_id.as_deref() {
        Some(raw) => SheetId::from_uuid_str(raw).ok()?,
        None => *default_sheet_id,
    };
    let ((sr, sc), (er, ec)) = parse_range_corners(source)?;
    let min_row = sr.min(er);
    let max_row = sr.max(er);
    let min_col = sc.min(ec);
    let max_col = sc.max(ec);
    let mut values = Vec::new();
    for row in min_row..=max_row {
        for col in min_col..=max_col {
            if let Some(value) = mirror.get_cell_value_at(&sheet_id, SheetPos::new(row, col))
                && let Some(display) = validation_cell_value_to_string(value)
            {
                values.push(display);
            }
        }
    }
    Some(values)
}

fn with_resolved_enum_source(
    schema: &ColumnSchema,
    sheet_id: &SheetId,
    mirror: &CellMirror,
) -> ColumnSchema {
    let mut schema = schema.clone();
    let Some(constraints) = schema.constraints.as_mut() else {
        return schema;
    };
    if constraints.enum_values.is_none()
        && let Some(source) = constraints.enum_source.as_ref()
        && let Some(values) = resolve_enum_source_values(source, sheet_id, mirror)
    {
        constraints.enum_values = Some(values);
    }
    schema
}

fn validate_with_resolved_constraints(
    cell_value: &CellValue,
    schema: &ColumnSchema,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    anchor_row: u32,
    anchor_col: u32,
    grid_index: Option<&GridIndex>,
) -> compute_schema::types::ValidationResult {
    let resolved_schema = with_resolved_enum_source(schema, sheet_id, mirror);
    validate_with_optional_formula(
        cell_value,
        &resolved_schema,
        mirror,
        sheet_id,
        row,
        col,
        anchor_row,
        anchor_col,
        grid_index,
    )
}

/// Validate a cell value against any applicable schema (column or range).
///
/// Resolution order:
/// 1. Column schema for the given column index.
/// 2. Range schemas (derived from `properties/dataValidations`) whose ranges
///    contain the (row, col) position.
///
/// If no schema applies, the value is considered valid with "none" enforcement.
///
/// For schemas carrying a `formula` constraint, the formula is evaluated with
/// the typed value substituted at `(row, col)` and relative refs shifted by
/// the cell's offset from the rule's anchor (Excel-parity semantics).
pub(crate) fn validate_cell_value(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &str,
    grid_index: Option<&GridIndex>,
    mirror: &CellMirror,
) -> CellValidationResult {
    let cell_value = str_to_cell_value(value);

    // 1. Try column schema
    if let Some(cs) = get_column_schema(doc, sheets, sheet_id, col, grid_index) {
        let result = validate_with_resolved_constraints(
            &cell_value,
            &cs,
            mirror,
            sheet_id,
            row,
            col,
            row,
            col,
            grid_index,
        );
        if !result.valid {
            let err_msg = result.errors.first().map(|e| e.message.clone());
            return CellValidationResult {
                valid: false,
                error_message: err_msg,
                error_title: Some("Validation Error".to_string()),
                enforcement: EnforcementLevel::Strict,
            };
        }
        return CellValidationResult {
            valid: true,
            error_message: None,
            error_title: None,
            enforcement: EnforcementLevel::Strict,
        };
    }

    // 2. Try range schemas — read validations from the Range-backed store.
    let txn = doc.transact();
    let specs = read_range_backed_validation_specs(&txn, sheets, sheet_id);
    drop(txn);

    for (idx, spec) in specs.iter().enumerate() {
        let Some(rs) = spec_to_range_schema(spec, range_schema_id_for(spec, idx)) else {
            continue;
        };
        let Some((anchor_row, anchor_col)) = anchor_of_first_containing_range(&rs.ranges, row, col)
        else {
            continue;
        };
        let enforcement = rs.enforcement.unwrap_or(EnforcementLevel::Strict);

        let col_schema = ColumnSchema {
            id: String::new(),
            name: String::new(),
            schema_type: rs.schema.schema_type.unwrap_or(SchemaType::Any),
            constraints: rs.schema.constraints.clone(),
            distribution: None,
            description: None,
        };
        let result = validate_with_resolved_constraints(
            &cell_value,
            &col_schema,
            mirror,
            sheet_id,
            row,
            col,
            anchor_row,
            anchor_col,
            grid_index,
        );

        if !result.valid {
            let default_err_msg = result.errors.first().map(|e| e.message.clone());
            let (error_title, error_message) = match rs.ui.as_ref() {
                Some(ui) => {
                    let title = ui.error_message.as_ref().and_then(|em| em.title.clone());
                    let msg = ui
                        .error_message
                        .as_ref()
                        .and_then(|em| em.message.clone())
                        .or(default_err_msg);
                    (title, msg)
                }
                None => (None, default_err_msg),
            };
            return CellValidationResult {
                valid: false,
                error_message,
                error_title,
                enforcement,
            };
        }
        return CellValidationResult {
            valid: true,
            error_message: None,
            error_title: None,
            enforcement,
        };
    }

    // 3. No schema applies
    CellValidationResult {
        valid: true,
        error_message: None,
        error_title: None,
        enforcement: EnforcementLevel::None,
    }
}

/// Result of validating a cell against the data-validation rules covering it.
///
/// Distinguishes three states:
/// - `NoRule`: no data-validation rule covers `(row, col)` — caller should
///   produce no annotation.
/// - `Pass`: a rule covers the cell and the value passed validation — caller
///   should emit an annotation with empty errors so the bridge fires
///   `validation:passed`.
/// - `Fail`: a rule covers the cell and the value failed validation — caller
///   should emit an annotation with the error message.
pub(crate) enum DataValidationOutcome {
    NoRule,
    Pass,
    Fail { message: String },
}

/// Validate a `CellValue` at `(row, col)` against the sheet's data-validation
/// rules. Returns `DataValidationOutcome` so the caller can decide whether to
/// emit a pass/fail annotation.
///
/// This is the recalc-time companion to [`validate_cell_value`]: that function
/// returns a single `CellValidationResult` for the on-demand bridge call;
/// this function is shaped for the recalc pass which needs to emit pass/fail
/// annotations alongside column-schema annotations so TS can fire
/// `validation:passed` / `validation:failed` events on every transition.
///
/// Skips column schemas — those are handled separately by
/// `ComputeCore::validate_dirty_cells`.
pub(crate) fn validate_cell_value_against_data_validations(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &CellValue,
    grid_index: Option<&GridIndex>,
    mirror: &CellMirror,
) -> DataValidationOutcome {
    let txn = doc.transact();
    let specs = read_range_backed_validation_specs(&txn, sheets, sheet_id);
    drop(txn);

    for (idx, spec) in specs.iter().enumerate() {
        let Some(rs) = spec_to_range_schema(spec, range_schema_id_for(spec, idx)) else {
            continue;
        };
        let Some((anchor_row, anchor_col)) = anchor_of_first_containing_range(&rs.ranges, row, col)
        else {
            continue;
        };

        let col_schema = ColumnSchema {
            id: String::new(),
            name: String::new(),
            schema_type: rs.schema.schema_type.unwrap_or(SchemaType::Any),
            constraints: rs.schema.constraints.clone(),
            distribution: None,
            description: None,
        };
        let result = validate_with_resolved_constraints(
            value,
            &col_schema,
            mirror,
            sheet_id,
            row,
            col,
            anchor_row,
            anchor_col,
            grid_index,
        );

        if !result.valid {
            let message = result
                .errors
                .first()
                .map(|e| e.message.clone())
                .or_else(|| {
                    rs.ui
                        .as_ref()
                        .and_then(|ui| ui.error_message.as_ref())
                        .and_then(|em| em.message.clone())
                })
                .unwrap_or_else(|| "Validation failed".to_string());
            return DataValidationOutcome::Fail { message };
        }
        return DataValidationOutcome::Pass;
    }

    DataValidationOutcome::NoRule
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests;
