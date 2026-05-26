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
        let result = validate_with_optional_formula(
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
        let result = validate_with_optional_formula(
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
        let result = validate_with_optional_formula(
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
mod tests {
    use super::*;
    use crate::identity::GridIndex;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;
    use std::sync::Arc;

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    /// Helper: create a storage with one sheet.
    fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
        let (storage, sid, gi, _mirror) = storage_with_sheet_and_mirror();
        (storage, sid, gi)
    }

    fn storage_with_sheet_and_mirror() -> (YrsStorage, SheetId, GridIndex, crate::mirror::CellMirror)
    {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sid = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
            .unwrap();
        let id_alloc = Arc::new(cell_types::IdAllocator::new());
        let gi = GridIndex::new(sid, 100, 26, id_alloc);
        (storage, sid, gi, mirror)
    }

    /// Default mirror for tests that don't exercise the formula path.
    fn empty_mirror() -> crate::mirror::CellMirror {
        crate::mirror::CellMirror::new()
    }

    /// Count validation rule entries in the Range-backed store.
    fn validation_rule_count(storage: &YrsStorage, sid: &SheetId) -> usize {
        get_range_schemas_for_sheet(storage.doc(), storage.sheets(), sid).len()
    }

    // -----------------------------------------------------------------------
    // 1. position_in_range tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_position_in_range_inside() {
        let rr = IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "10:5".to_string(),
            sheet_id: None,
        };
        assert!(position_in_range(0, 0, &rr));
        assert!(position_in_range(5, 3, &rr));
        assert!(position_in_range(10, 5, &rr));
    }

    #[test]
    fn test_position_in_range_outside() {
        let rr = IdentityRangeSchemaRef {
            start_id: "2:2".to_string(),
            end_id: "5:5".to_string(),
            sheet_id: None,
        };
        assert!(!position_in_range(0, 0, &rr));
        assert!(!position_in_range(1, 3, &rr));
        assert!(!position_in_range(6, 3, &rr));
        assert!(!position_in_range(3, 6, &rr));
    }

    #[test]
    fn test_position_in_range_reversed_start_end() {
        let rr = IdentityRangeSchemaRef {
            start_id: "10:5".to_string(),
            end_id: "0:0".to_string(),
            sheet_id: None,
        };
        assert!(position_in_range(5, 3, &rr));
    }

    #[test]
    fn test_position_in_range_unparseable() {
        let rr = IdentityRangeSchemaRef {
            start_id: "abc".to_string(),
            end_id: "def".to_string(),
            sheet_id: None,
        };
        assert!(!position_in_range(0, 0, &rr));
    }

    // -----------------------------------------------------------------------
    // 2. Column schema CRUD
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_column_schema_none_initially() {
        let (storage, sid, gi) = storage_with_sheet();
        assert!(get_column_schema(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)).is_none());
    }

    #[test]
    fn test_set_and_get_column_schema() {
        let (storage, sid, gi) = storage_with_sheet();
        let schema = ColumnSchema {
            id: "col-schema-1".to_string(),
            name: "Amount".to_string(),
            schema_type: SchemaType::Number,
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(1000.0),
                ..Default::default()
            }),
            distribution: None,
            description: None,
        };
        set_column_schema(storage.doc(), storage.sheets(), &sid, 2, &schema, Some(&gi)).unwrap();
        let fetched = get_column_schema(storage.doc(), storage.sheets(), &sid, 2, Some(&gi));
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap(), schema);
    }

    #[test]
    fn test_set_column_schema_overwrite() {
        let (storage, sid, gi) = storage_with_sheet();
        let schema1 = ColumnSchema {
            id: "cs-1".to_string(),
            name: "V1".to_string(),
            schema_type: SchemaType::String,
            constraints: None,
            distribution: None,
            description: None,
        };
        let schema2 = ColumnSchema {
            id: "cs-2".to_string(),
            name: "V2".to_string(),
            schema_type: SchemaType::Number,
            constraints: None,
            distribution: None,
            description: None,
        };
        set_column_schema(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            &schema1,
            Some(&gi),
        )
        .unwrap();
        set_column_schema(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            &schema2,
            Some(&gi),
        )
        .unwrap();
        let fetched =
            get_column_schema(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)).unwrap();
        assert_eq!(fetched, schema2);
    }

    #[test]
    fn test_clear_column_schema() {
        let (storage, sid, gi) = storage_with_sheet();
        let schema = ColumnSchema {
            id: "cs-clear".to_string(),
            name: String::new(),
            schema_type: SchemaType::String,
            constraints: None,
            distribution: None,
            description: None,
        };
        set_column_schema(storage.doc(), storage.sheets(), &sid, 3, &schema, Some(&gi)).unwrap();
        assert!(get_column_schema(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)).is_some());

        clear_column_schema(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)).unwrap();
        assert!(get_column_schema(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)).is_none());
    }

    #[test]
    fn test_clear_column_schema_noop_when_missing() {
        let (storage, sid, gi) = storage_with_sheet();
        let result = clear_column_schema(storage.doc(), storage.sheets(), &sid, 99, Some(&gi));
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_all_column_schemas() {
        let (storage, sid, gi) = storage_with_sheet();
        let s1 = ColumnSchema {
            id: "a".to_string(),
            name: String::new(),
            schema_type: SchemaType::Number,
            constraints: None,
            distribution: None,
            description: None,
        };
        let s2 = ColumnSchema {
            id: "b".to_string(),
            name: String::new(),
            schema_type: SchemaType::String,
            constraints: None,
            distribution: None,
            description: None,
        };
        set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &s1, Some(&gi)).unwrap();
        set_column_schema(storage.doc(), storage.sheets(), &sid, 3, &s2, Some(&gi)).unwrap();

        let all = get_all_column_schemas(storage.doc(), storage.sheets(), &sid, Some(&gi));
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].0, 0);
        assert_eq!(all[0].1, s1);
        assert_eq!(all[1].0, 3);
        assert_eq!(all[1].1, s2);
    }

    #[test]
    fn test_get_all_column_schemas_empty() {
        let (storage, sid, gi) = storage_with_sheet();
        let all = get_all_column_schemas(storage.doc(), storage.sheets(), &sid, Some(&gi));
        assert!(all.is_empty());
    }

    // -----------------------------------------------------------------------
    // 3. Range schema CRUD (now backed by properties/dataValidations)
    // -----------------------------------------------------------------------

    fn make_range_schema(id: &str) -> RangeSchema {
        RangeSchema {
            id: id.to_string(),
            created_at: 1700000000,
            ranges: vec![IdentityRangeSchemaRef {
                start_id: "0:0".to_string(),
                end_id: "10:5".to_string(),
                sheet_id: None,
            }],
            schema: RangeSchemaDefinition {
                schema_type: Some(SchemaType::Number),
                constraints: Some(SchemaConstraints {
                    min: Some(0.0),
                    max: Some(100.0),
                    ..Default::default()
                }),
            },
            enforcement: Some(EnforcementLevel::Strict),
            ui: Some(RangeSchemaUi {
                show_dropdown: None,
                error_message: Some(ErrorMessage {
                    title: Some("Invalid".to_string()),
                    message: Some("Must be 0-100".to_string()),
                }),
                input_message: Some(InputMessage {
                    title: Some("Enter value".to_string()),
                    message: Some("0 to 100".to_string()),
                }),
            }),
        }
    }

    #[test]
    fn test_set_and_get_range_schema() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs = make_range_schema("rs-1");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        let fetched =
            get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-1").expect("rs-1");
        // The view-layer id round-trips because "rs-1" is stored as the spec's uid.
        assert_eq!(fetched.id, "rs-1");
        assert_eq!(fetched.ranges, rs.ranges);
        assert_eq!(fetched.schema.schema_type, rs.schema.schema_type);
        assert_eq!(fetched.enforcement, rs.enforcement);
    }

    #[test]
    fn test_get_range_schema_missing() {
        let (storage, sid, _gi) = storage_with_sheet();
        assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "nope").is_none());
    }

    #[test]
    fn test_get_range_schemas_for_sheet() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs1 = make_range_schema("rs-1");
        let rs2 = make_range_schema("rs-2");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs1).unwrap();
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs2).unwrap();

        let all = get_range_schemas_for_sheet(storage.doc(), storage.sheets(), &sid);
        assert_eq!(all.len(), 2);
        let ids: Vec<&str> = all.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&"rs-1"));
        assert!(ids.contains(&"rs-2"));
    }

    #[test]
    fn test_get_range_schemas_for_sheet_empty() {
        let (storage, sid, _gi) = storage_with_sheet();
        let all = get_range_schemas_for_sheet(storage.doc(), storage.sheets(), &sid);
        assert!(all.is_empty());
    }

    #[test]
    fn test_update_range_schema() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs = make_range_schema("rs-upd");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        let mut updated = rs.clone();
        updated.enforcement = Some(EnforcementLevel::Warning);
        update_range_schema(storage.doc(), storage.sheets(), &sid, "rs-upd", &updated).unwrap();

        let fetched =
            get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-upd").expect("present");
        assert_eq!(fetched.enforcement, Some(EnforcementLevel::Warning));
        // Updating in place must not duplicate the entry.
        assert_eq!(validation_rule_count(&storage, &sid), 1);
    }

    #[test]
    fn test_delete_range_schema() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs = make_range_schema("rs-del");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();
        assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-del").is_some());

        delete_range_schema(storage.doc(), storage.sheets(), &sid, "rs-del");
        assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-del").is_none());
        assert_eq!(validation_rule_count(&storage, &sid), 0);
    }

    #[test]
    fn test_delete_range_schema_noop() {
        let (storage, sid, _gi) = storage_with_sheet();
        // Should not panic
        delete_range_schema(storage.doc(), storage.sheets(), &sid, "nonexistent");
    }

    // -----------------------------------------------------------------------
    // 3b. Concurrent-edit CRDT semantics
    // -----------------------------------------------------------------------

    /// Build a RangeSchema that targets a specific row:col range and carries
    /// a stable uid.
    fn range_schema_at(id: &str, start: &str, end: &str) -> RangeSchema {
        RangeSchema {
            id: id.to_string(),
            created_at: 1700000000,
            ranges: vec![IdentityRangeSchemaRef {
                start_id: start.to_string(),
                end_id: end.to_string(),
                sheet_id: None,
            }],
            schema: RangeSchemaDefinition {
                schema_type: Some(SchemaType::Number),
                constraints: Some(SchemaConstraints {
                    min: Some(0.0),
                    max: Some(100.0),
                    ..Default::default()
                }),
            },
            enforcement: Some(EnforcementLevel::Strict),
            ui: None,
        }
    }

    /// Sync `src` state into `dst` by exchanging state-vector-based diffs.
    /// Uses the same pattern as the sync layer and floating_objects tests.
    fn sync_storage(src: &YrsStorage, dst: &YrsStorage) {
        use yrs::updates::decoder::Decode;
        let sv = dst.doc().transact().state_vector();
        let update = src.doc().transact().encode_diff_v1(&sv);
        let decoded = yrs::Update::decode_v1(&update).expect("decode update");
        dst.doc()
            .transact_mut()
            .apply_update(decoded)
            .expect("apply update");
    }

    /// Clone a YrsStorage at the given SheetId so two docs share identical
    /// baseline state before diverging.
    fn clone_storage(src: &YrsStorage) -> YrsStorage {
        use yrs::updates::decoder::Decode;
        let update = src
            .doc()
            .transact()
            .encode_diff_v1(&yrs::StateVector::default());
        let decoded = yrs::Update::decode_v1(&update).expect("decode update");
        let storage2 = YrsStorage::new();
        storage2
            .doc()
            .transact_mut()
            .apply_update(decoded)
            .expect("apply update");
        storage2
    }

    /// Collect spec ids from a storage's data-validations view.
    fn view_ids(storage: &YrsStorage, sid: &SheetId) -> Vec<String> {
        get_range_schemas_for_sheet(storage.doc(), storage.sheets(), sid)
            .into_iter()
            .map(|r| r.id)
            .collect()
    }

    #[test]
    fn test_update_preserves_entries() {
        // Insert A then B; update A; both entries still present.
        let (storage, sid, _gi) = storage_with_sheet();
        let a = range_schema_at("rs-A", "0:0", "0:0");
        let b = range_schema_at("rs-B", "1:0", "1:0");

        set_range_schema(storage.doc(), storage.sheets(), &sid, &a).unwrap();
        set_range_schema(storage.doc(), storage.sheets(), &sid, &b).unwrap();
        let mut ids = view_ids(&storage, &sid);
        ids.sort();
        assert_eq!(ids, vec!["rs-A", "rs-B"]);

        // Mutate A's enforcement and update by id.
        let mut a2 = a.clone();
        a2.enforcement = Some(EnforcementLevel::Warning);
        update_range_schema(storage.doc(), storage.sheets(), &sid, "rs-A", &a2).unwrap();

        // Both entries still present and the field was actually updated.
        let mut ids = view_ids(&storage, &sid);
        ids.sort();
        assert_eq!(ids, vec!["rs-A", "rs-B"]);
        let fetched =
            get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-A").expect("rs-A");
        assert_eq!(fetched.enforcement, Some(EnforcementLevel::Warning));
        assert_eq!(validation_rule_count(&storage, &sid), 2);
    }

    #[test]
    fn test_concurrent_insert_disjoint_ranges_merge() {
        // Two peers insert different specs simultaneously on disjoint cells.
        // Both must survive the merge. The Range-backed store uses Y.Map
        // entries with distinct keys, so concurrent inserts merge cleanly.
        let (storage1, sid, _gi) = storage_with_sheet();
        let storage2 = clone_storage(&storage1);

        // Concurrently insert different specs on each storage.
        let a = range_schema_at("rs-A", "0:0", "0:0"); // A1
        let b = range_schema_at("rs-B", "0:1", "0:1"); // B1
        set_range_schema(storage1.doc(), storage1.sheets(), &sid, &a).unwrap();
        set_range_schema(storage2.doc(), storage2.sheets(), &sid, &b).unwrap();

        // Cross-sync both directions.
        sync_storage(&storage1, &storage2);
        sync_storage(&storage2, &storage1);

        let mut ids1 = view_ids(&storage1, &sid);
        let mut ids2 = view_ids(&storage2, &sid);
        ids1.sort();
        ids2.sort();
        assert_eq!(ids1, vec!["rs-A".to_string(), "rs-B".to_string()]);
        assert_eq!(ids2, vec!["rs-A".to_string(), "rs-B".to_string()]);

        // Both peers converge to exactly two entries.
        assert_eq!(validation_rule_count(&storage1, &sid), 2);
        assert_eq!(validation_rule_count(&storage2, &sid), 2);
    }

    #[test]
    fn test_concurrent_update_converges() {
        // Two peers start from the same spec, then each updates a different
        // field. After sync, both peers converge to the same state (LWW on
        // the JSON rule body in `validationRules`).
        let (storage1, sid, _gi) = storage_with_sheet();
        let seed = range_schema_at("rs-seed", "0:0", "10:5");
        set_range_schema(storage1.doc(), storage1.sheets(), &sid, &seed).unwrap();

        // Fork post-seed so both docs share the spec.
        let storage2 = clone_storage(&storage1);
        assert_eq!(validation_rule_count(&storage1, &sid), 1);
        assert_eq!(validation_rule_count(&storage2, &sid), 1);

        // Peer 1: update enforcement → Warning.
        let mut u1 = seed.clone();
        u1.enforcement = Some(EnforcementLevel::Warning);
        update_range_schema(storage1.doc(), storage1.sheets(), &sid, "rs-seed", &u1).unwrap();

        // Peer 2: update schema.constraints.max → 200.0.
        let mut u2 = seed.clone();
        if let Some(c) = u2.schema.constraints.as_mut() {
            c.max = Some(200.0);
        }
        update_range_schema(storage2.doc(), storage2.sheets(), &sid, "rs-seed", &u2).unwrap();

        sync_storage(&storage1, &storage2);
        sync_storage(&storage2, &storage1);

        // Both converge to a single spec.
        assert_eq!(validation_rule_count(&storage1, &sid), 1);
        assert_eq!(validation_rule_count(&storage2, &sid), 1);

        // CRDT convergence: both peers agree on the same state.
        let r1 = get_range_schema(storage1.doc(), storage1.sheets(), &sid, "rs-seed")
            .expect("rs-seed on storage1");
        let r2 = get_range_schema(storage2.doc(), storage2.sheets(), &sid, "rs-seed")
            .expect("rs-seed on storage2");
        assert_eq!(r1.enforcement, r2.enforcement);
        assert_eq!(r1.schema.constraints, r2.schema.constraints);
    }

    #[test]
    fn test_concurrent_delete_and_update_converges() {
        // P0 deletes spec X, P1 updates a field on spec X. After sync, both
        // peers converge. With the Range-backed store, the delete removes
        // range entries and rule body; the update recreates them. LWW on the
        // Y.Map keys determines which wins.
        let (storage1, sid, _gi) = storage_with_sheet();
        let seed = range_schema_at("rs-del-upd", "0:0", "10:5");
        set_range_schema(storage1.doc(), storage1.sheets(), &sid, &seed).unwrap();
        let storage2 = clone_storage(&storage1);

        // P0: delete.
        delete_range_schema(storage1.doc(), storage1.sheets(), &sid, "rs-del-upd");
        // P1: update (set enforcement → Warning).
        let mut u = seed.clone();
        u.enforcement = Some(EnforcementLevel::Warning);
        update_range_schema(storage2.doc(), storage2.sheets(), &sid, "rs-del-upd", &u).unwrap();

        sync_storage(&storage1, &storage2);
        sync_storage(&storage2, &storage1);

        // CRDT convergence: both storages agree on the final view.
        let ids1 = view_ids(&storage1, &sid);
        let ids2 = view_ids(&storage2, &sid);
        assert_eq!(ids1, ids2);
        let len1 = validation_rule_count(&storage1, &sid);
        let len2 = validation_rule_count(&storage2, &sid);
        assert_eq!(len1, len2);
    }

    // -----------------------------------------------------------------------
    // 3a. Locking tests — the duplicate-storage fix
    // -----------------------------------------------------------------------

    #[test]
    fn test_set_range_schema_stores_single_entry() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs = make_range_schema("rs-single");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        // Exactly one stored ValidationSpec — no parallel rangeSchemas store.
        assert_eq!(validation_rule_count(&storage, &sid), 1);
    }

    #[test]
    fn test_multiple_range_schemas_yield_n_entries_not_2n() {
        let (storage, sid, _gi) = storage_with_sheet();
        let n = 5;
        for i in 0..n {
            set_range_schema(
                storage.doc(),
                storage.sheets(),
                &sid,
                &make_range_schema(&format!("rs-{i}")),
            )
            .unwrap();
        }
        assert_eq!(validation_rule_count(&storage, &sid), n);
        // View layer also reports exactly n entries.
        let view = get_range_schemas_for_sheet(storage.doc(), storage.sheets(), &sid);
        assert_eq!(view.len(), n as usize);
    }

    // -----------------------------------------------------------------------
    // 4. validate_cell_value
    // -----------------------------------------------------------------------

    #[test]
    fn test_validate_no_schema_returns_valid() {
        let (storage, sid, gi) = storage_with_sheet();
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            0,
            "hello",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::None);
    }

    #[test]
    fn test_validate_column_schema_number_valid() {
        let (storage, sid, gi) = storage_with_sheet();
        let schema = ColumnSchema {
            id: String::new(),
            name: String::new(),
            schema_type: SchemaType::Number,
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(100.0),
                ..Default::default()
            }),
            distribution: None,
            description: None,
        };
        set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, Some(&gi)).unwrap();

        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            5,
            0,
            "50",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::Strict);
    }

    #[test]
    fn test_validate_column_schema_number_invalid() {
        let (storage, sid, gi) = storage_with_sheet();
        let schema = ColumnSchema {
            id: String::new(),
            name: String::new(),
            schema_type: SchemaType::Number,
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(100.0),
                ..Default::default()
            }),
            distribution: None,
            description: None,
        };
        set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, Some(&gi)).unwrap();

        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            5,
            0,
            "200",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(!result.valid);
        assert!(result.error_message.is_some());
        assert_eq!(result.enforcement, EnforcementLevel::Strict);
    }

    #[test]
    fn test_validate_range_schema_valid() {
        let (storage, sid, gi) = storage_with_sheet();
        let rs = make_range_schema("rs-val");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        // Position (5, 3) is inside range 0:0..10:5
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            5,
            3,
            "50",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::Strict);
    }

    #[test]
    fn test_validate_range_schema_invalid_with_ui() {
        let (storage, sid, gi) = storage_with_sheet();
        let rs = make_range_schema("rs-inv");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        // Value 200 exceeds max 100
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            5,
            3,
            "200",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(!result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::Strict);
        assert_eq!(result.error_message, Some("Must be 0-100".to_string()));
        assert_eq!(result.error_title, Some("Invalid".to_string()));
    }

    #[test]
    fn test_validate_empty_value_always_valid() {
        let (storage, sid, gi) = storage_with_sheet();
        let schema = ColumnSchema {
            id: String::new(),
            name: String::new(),
            schema_type: SchemaType::Number,
            constraints: Some(SchemaConstraints {
                min: Some(10.0),
                ..Default::default()
            }),
            distribution: None,
            description: None,
        };
        set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, Some(&gi)).unwrap();

        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            0,
            "",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(result.valid);
    }

    // -----------------------------------------------------------------------
    // 5. str_to_cell_value unit tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_str_to_cell_value_number() {
        let cv = str_to_cell_value("42.5");
        assert!(matches!(cv, value_types::CellValue::Number(_)));
    }

    #[test]
    fn test_str_to_cell_value_bool() {
        assert!(matches!(
            str_to_cell_value("true"),
            value_types::CellValue::Boolean(true)
        ));
        assert!(matches!(
            str_to_cell_value("false"),
            value_types::CellValue::Boolean(false)
        ));
    }

    #[test]
    fn test_str_to_cell_value_text() {
        assert!(matches!(
            str_to_cell_value("hello"),
            value_types::CellValue::Text(_)
        ));
    }

    #[test]
    fn test_str_to_cell_value_empty() {
        assert!(
            matches!(str_to_cell_value(""), value_types::CellValue::Text(ref s) if s.is_empty())
        );
    }

    // -----------------------------------------------------------------------
    // 6. Serde roundtrip
    // -----------------------------------------------------------------------

    #[test]
    fn test_column_schema_serde_roundtrip() {
        let schema = ColumnSchema {
            id: "test".to_string(),
            name: "Name".to_string(),
            schema_type: SchemaType::String,
            constraints: Some(SchemaConstraints {
                min_length: Some(1),
                max_length: Some(50),
                allow_blank: Some(false),
                ..Default::default()
            }),
            distribution: None,
            description: None,
        };
        let json = serde_json::to_string(&schema).unwrap();
        let parsed: ColumnSchema = serde_json::from_str(&json).unwrap();
        assert_eq!(schema, parsed);
    }

    #[test]
    fn test_range_schema_serde_roundtrip() {
        let rs = make_range_schema("serde-test");
        let json = serde_json::to_string(&rs).unwrap();
        let parsed: RangeSchema = serde_json::from_str(&json).unwrap();
        assert_eq!(rs, parsed);
    }

    // -----------------------------------------------------------------------
    // 7. Edge cases / error paths
    // -----------------------------------------------------------------------

    #[test]
    fn test_set_column_schema_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let sid = make_sheet_id(999);
        let schema = ColumnSchema {
            id: String::new(),
            name: String::new(),
            schema_type: SchemaType::Any,
            constraints: None,
            distribution: None,
            description: None,
        };
        let result = set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_set_range_schema_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let sid = make_sheet_id(999);
        let rs = make_range_schema("rs-err");
        let result = set_range_schema(storage.doc(), storage.sheets(), &sid, &rs);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_all_column_schemas_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let sid = make_sheet_id(999);
        let all = get_all_column_schemas(storage.doc(), storage.sheets(), &sid, None);
        assert!(all.is_empty());
    }

    #[test]
    fn test_validate_cell_value_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let sid = make_sheet_id(999);
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            0,
            "hello",
            None,
            &empty_mirror(),
        );
        assert!(result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::None);
    }

    #[test]
    fn test_column_schema_with_any_type_no_constraints() {
        let (storage, sid, gi) = storage_with_sheet();
        let schema = ColumnSchema {
            id: "empty".to_string(),
            name: String::new(),
            schema_type: SchemaType::Any,
            constraints: None,
            distribution: None,
            description: None,
        };
        set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, Some(&gi)).unwrap();
        let fetched =
            get_column_schema(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)).unwrap();
        assert_eq!(fetched, schema);
    }

    #[test]
    fn test_validate_range_schema_outside_range() {
        let (storage, sid, gi) = storage_with_sheet();
        let rs = make_range_schema("rs-outside");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        // Position (50, 50) is outside range 0:0..10:5
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            50,
            50,
            "999",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::None);
    }

    #[test]
    fn test_update_range_schema_nonexistent_creates() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs = make_range_schema("rs-new");
        update_range_schema(storage.doc(), storage.sheets(), &sid, "rs-new", &rs).unwrap();

        let fetched = get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-new");
        assert!(fetched.is_some());
        assert_eq!(validation_rule_count(&storage, &sid), 1);
    }

    #[test]
    fn test_multiple_column_schemas_independent() {
        let (storage, sid, gi) = storage_with_sheet();
        let s1 = ColumnSchema {
            id: "s1".to_string(),
            name: String::new(),
            schema_type: SchemaType::Number,
            constraints: None,
            distribution: None,
            description: None,
        };
        let s2 = ColumnSchema {
            id: "s2".to_string(),
            name: String::new(),
            schema_type: SchemaType::String,
            constraints: None,
            distribution: None,
            description: None,
        };
        set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &s1, Some(&gi)).unwrap();
        set_column_schema(storage.doc(), storage.sheets(), &sid, 1, &s2, Some(&gi)).unwrap();

        // Clear col 0 should not affect col 1
        clear_column_schema(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)).unwrap();
        assert!(get_column_schema(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)).is_none());
        assert_eq!(
            get_column_schema(storage.doc(), storage.sheets(), &sid, 1, Some(&gi)).unwrap(),
            s2
        );
    }

    #[test]
    fn test_validate_not_a_number() {
        let (storage, sid, gi) = storage_with_sheet();
        let schema = ColumnSchema {
            id: String::new(),
            name: String::new(),
            schema_type: SchemaType::Number,
            constraints: Some(SchemaConstraints::default()),
            distribution: None,
            description: None,
        };
        set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, Some(&gi)).unwrap();

        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            0,
            "not_a_number",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(!result.valid);
        assert!(result.error_message.is_some());
    }

    // -----------------------------------------------------------------------
    // W3. Column schema takes priority over range schema
    // -----------------------------------------------------------------------

    #[test]
    fn test_validate_column_schema_priority_over_range() {
        let (storage, sid, gi) = storage_with_sheet();

        // Column 2 has a Number schema.
        let col_schema = ColumnSchema {
            id: "col-prio".to_string(),
            name: String::new(),
            schema_type: SchemaType::Number,
            constraints: None,
            distribution: None,
            description: None,
        };
        set_column_schema(
            storage.doc(),
            storage.sheets(),
            &sid,
            2,
            &col_schema,
            Some(&gi),
        )
        .unwrap();

        // Range schema covering column 2 (rows 0-10, cols 0-5) demands String type
        // with Warning enforcement (different from column schema's hardcoded Strict).
        let range_schema = RangeSchema {
            id: "rs-conflict".to_string(),
            created_at: 1700000000,
            ranges: vec![IdentityRangeSchemaRef {
                start_id: "0:0".to_string(),
                end_id: "10:5".to_string(),
                sheet_id: None,
            }],
            schema: RangeSchemaDefinition {
                schema_type: Some(SchemaType::String),
                constraints: None,
            },
            enforcement: Some(EnforcementLevel::Warning),
            ui: None,
        };
        set_range_schema(storage.doc(), storage.sheets(), &sid, &range_schema).unwrap();

        // "42" is a valid number — column schema (Number, Strict) takes priority.
        // If range schema (String, Warning) had won instead, enforcement would be Warning.
        // Asserting Strict proves the column schema path was taken.
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            5,
            2,
            "42",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::Strict);
    }

    // -----------------------------------------------------------------------
    // W4. Non-Strict enforcement levels
    // -----------------------------------------------------------------------

    #[test]
    fn test_validate_range_enforcement_warning() {
        let (storage, sid, gi) = storage_with_sheet();

        let range_schema = RangeSchema {
            id: "rs-warn".to_string(),
            created_at: 1700000000,
            ranges: vec![IdentityRangeSchemaRef {
                start_id: "0:0".to_string(),
                end_id: "10:5".to_string(),
                sheet_id: None,
            }],
            schema: RangeSchemaDefinition {
                schema_type: Some(SchemaType::Number),
                constraints: None,
            },
            enforcement: Some(EnforcementLevel::Warning),
            ui: None,
        };
        set_range_schema(storage.doc(), storage.sheets(), &sid, &range_schema).unwrap();

        // "abc" is not a number — should fail but with Warning enforcement.
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            3,
            3,
            "abc",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(!result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::Warning);
    }

    #[test]
    fn test_validate_range_enforcement_info_from_none() {
        // `EnforcementLevel::None` has no OOXML equivalent and round-trips to
        // `Info` through the canonical `properties/dataValidations` store
        // (via `EnforcementLevel` → `ErrorStyle::Information` →
        // `EnforcementLevel::Info`). This is expected: XLSX `errorStyle` is
        // stop/warning/information only, so None can't survive the trip.
        let (storage, sid, gi) = storage_with_sheet();

        let range_schema = RangeSchema {
            id: "rs-none-enf".to_string(),
            created_at: 1700000000,
            ranges: vec![IdentityRangeSchemaRef {
                start_id: "0:0".to_string(),
                end_id: "10:5".to_string(),
                sheet_id: None,
            }],
            schema: RangeSchemaDefinition {
                schema_type: Some(SchemaType::Number),
                constraints: None,
            },
            enforcement: Some(EnforcementLevel::None),
            ui: None,
        };
        set_range_schema(storage.doc(), storage.sheets(), &sid, &range_schema).unwrap();

        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            3,
            3,
            "abc",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(!result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::Info);
    }

    // -----------------------------------------------------------------------
    // Custom-formula validation: editor commit path uses pending value
    // -----------------------------------------------------------------------

    fn make_custom_formula_range_schema(
        id: &str,
        formula: &str,
        ranges: Vec<IdentityRangeSchemaRef>,
    ) -> RangeSchema {
        RangeSchema {
            id: id.to_string(),
            created_at: 1700000000,
            ranges,
            schema: RangeSchemaDefinition {
                schema_type: Some(SchemaType::Any),
                constraints: Some(SchemaConstraints {
                    formula: Some(formula.to_string()),
                    ..Default::default()
                }),
            },
            enforcement: Some(EnforcementLevel::Strict),
            ui: None,
        }
    }

    #[test]
    fn custom_formula_accepts_truthy_typed_value() {
        let (storage, sid, gi, mirror) = storage_with_sheet_and_mirror();
        let rs = make_custom_formula_range_schema(
            "rs-custom-truthy",
            "=ISNUMBER(E1)",
            vec![IdentityRangeSchemaRef {
                start_id: "0:4".to_string(),
                end_id: "4:4".to_string(),
                sheet_id: None,
            }],
        );
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            4,
            "42",
            Some(&gi),
            &mirror,
        );
        assert!(result.valid, "Numeric '42' must satisfy ISNUMBER");
    }

    #[test]
    fn custom_formula_rejects_falsy_typed_value() {
        let (storage, sid, gi, mirror) = storage_with_sheet_and_mirror();
        let rs = make_custom_formula_range_schema(
            "rs-custom-falsy",
            "=ISNUMBER(E1)",
            vec![IdentityRangeSchemaRef {
                start_id: "0:4".to_string(),
                end_id: "4:4".to_string(),
                sheet_id: None,
            }],
        );
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            1,
            4,
            "hello",
            Some(&gi),
            &mirror,
        );
        assert!(
            !result.valid,
            "Text 'hello' must fail ISNUMBER and reject the commit"
        );
        assert_eq!(result.enforcement, EnforcementLevel::Strict);
    }

    #[test]
    fn custom_formula_shifts_relative_refs_per_row() {
        // =ISNUMBER(E1) on E1:E5 must evaluate as ISNUMBER(E2) for row 1, etc.
        // The pending typed value is what gets fed to the (shifted) reference.
        let (storage, sid, gi, mirror) = storage_with_sheet_and_mirror();
        let rs = make_custom_formula_range_schema(
            "rs-custom-shift",
            "=ISNUMBER(E1)",
            vec![IdentityRangeSchemaRef {
                start_id: "0:4".to_string(),
                end_id: "4:4".to_string(),
                sheet_id: None,
            }],
        );
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        // Row 2 (E3): typing "3.14" shifts the formula to ISNUMBER(E3) and the
        // pending override at E3 supplies the number; ISNUMBER returns TRUE.
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            2,
            4,
            "3.14",
            Some(&gi),
            &mirror,
        );
        assert!(result.valid);
    }

    // -----------------------------------------------------------------------
    // Phase 5D: Range-backed validation tests
    // -----------------------------------------------------------------------

    #[test]
    fn phase5d_set_range_schema_creates_validation_ranges() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs = make_range_schema("rs-5d-1");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        // Range-backed store has the entry.
        assert_eq!(validation_rule_count(&storage, &sid), 1);
        let fetched =
            get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-1").expect("rs-5d-1");
        assert_eq!(fetched.id, "rs-5d-1");
    }

    #[test]
    fn phase5d_set_range_schema_clears_imported_declared_count_metadata() {
        let (storage, sid, _gi) = storage_with_sheet();
        {
            let mut txn = storage.doc().transact_mut();
            let meta = get_properties_map(&txn, storage.sheets(), &sid).expect("sheet meta");
            meta.insert(&mut txn, KEY_DV_DECLARED_COUNT, 2_i64);
        }

        let rs = make_range_schema("rs-5d-clear-count");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        let txn = storage.doc().transact();
        let meta = get_properties_map(&txn, storage.sheets(), &sid).expect("sheet meta");
        assert!(meta.get(&txn, KEY_DV_DECLARED_COUNT).is_none());
    }

    #[test]
    fn phase5d_delete_range_schema_cleans_up_ranges() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs = make_range_schema("rs-5d-del");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        assert_eq!(validation_rule_count(&storage, &sid), 1);
        delete_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-del");

        // Range-backed store cleaned up.
        assert_eq!(validation_rule_count(&storage, &sid), 0);
        // View layer confirms deletion.
        assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-del").is_none());
    }

    #[test]
    fn phase5d_delete_range_schema_clears_imported_declared_count_metadata() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs = make_range_schema("rs-5d-del-count");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();
        {
            let mut txn = storage.doc().transact_mut();
            let meta = get_properties_map(&txn, storage.sheets(), &sid).expect("sheet meta");
            meta.insert(&mut txn, KEY_DV_DECLARED_COUNT, 2_i64);
        }

        delete_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-del-count");

        let txn = storage.doc().transact();
        let meta = get_properties_map(&txn, storage.sheets(), &sid).expect("sheet meta");
        assert!(meta.get(&txn, KEY_DV_DECLARED_COUNT).is_none());
    }

    #[test]
    fn phase5d_multiple_range_schemas_independent_delete() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs1 = make_range_schema("rs-5d-a");
        let rs2 = make_range_schema("rs-5d-b");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs1).unwrap();
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs2).unwrap();

        assert_eq!(validation_rule_count(&storage, &sid), 2);

        // Delete one, keep the other.
        delete_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-a");
        assert_eq!(validation_rule_count(&storage, &sid), 1);
        assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-a").is_none());
        assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-b").is_some());
    }

    #[test]
    fn phase5d_update_range_schema_replaces_ranges() {
        let (storage, sid, _gi) = storage_with_sheet();
        let rs = make_range_schema("rs-5d-upd");
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        // Update enforcement.
        let mut updated = rs.clone();
        updated.enforcement = Some(EnforcementLevel::Warning);
        update_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-upd", &updated).unwrap();

        // Still only one entry in the store.
        assert_eq!(validation_rule_count(&storage, &sid), 1);

        // Updated field is reflected.
        let fetched = get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-upd")
            .expect("rs-5d-upd");
        assert_eq!(fetched.enforcement, Some(EnforcementLevel::Warning));
    }

    #[test]
    fn phase5d_single_cell_validation() {
        let (storage, sid, gi) = storage_with_sheet();

        // Single-cell validation at A1 (0:0 to 0:0).
        let rs = RangeSchema {
            id: "rs-single-cell".to_string(),
            created_at: 0,
            ranges: vec![IdentityRangeSchemaRef {
                start_id: "0:0".to_string(),
                end_id: "0:0".to_string(),
                sheet_id: None,
            }],
            schema: RangeSchemaDefinition {
                schema_type: Some(SchemaType::Number),
                constraints: Some(SchemaConstraints {
                    min: Some(1.0),
                    max: Some(10.0),
                    ..Default::default()
                }),
            },
            enforcement: Some(EnforcementLevel::Strict),
            ui: None,
        };
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

        // Cell A1 (0,0) should be validated.
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            0,
            "5",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(result.valid);

        // Cell A2 (1,0) should NOT be validated (outside single-cell range).
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            1,
            0,
            "999",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::None);
    }

    #[test]
    fn phase5d_first_match_semantics() {
        // Two overlapping validation rules. First match wins.
        let (storage, sid, gi) = storage_with_sheet();

        // Rule 1: A1:A10, Number 0-100
        let rs1 = RangeSchema {
            id: "rs-first".to_string(),
            created_at: 0,
            ranges: vec![IdentityRangeSchemaRef {
                start_id: "0:0".to_string(),
                end_id: "9:0".to_string(),
                sheet_id: None,
            }],
            schema: RangeSchemaDefinition {
                schema_type: Some(SchemaType::Number),
                constraints: Some(SchemaConstraints {
                    min: Some(0.0),
                    max: Some(100.0),
                    ..Default::default()
                }),
            },
            enforcement: Some(EnforcementLevel::Strict),
            ui: None,
        };

        // Rule 2: A1:A10, Number 0-200 (more permissive, but second)
        let rs2 = RangeSchema {
            id: "rs-second".to_string(),
            created_at: 0,
            ranges: vec![IdentityRangeSchemaRef {
                start_id: "0:0".to_string(),
                end_id: "9:0".to_string(),
                sheet_id: None,
            }],
            schema: RangeSchemaDefinition {
                schema_type: Some(SchemaType::Number),
                constraints: Some(SchemaConstraints {
                    min: Some(0.0),
                    max: Some(200.0),
                    ..Default::default()
                }),
            },
            enforcement: Some(EnforcementLevel::Warning),
            ui: None,
        };

        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs1).unwrap();
        set_range_schema(storage.doc(), storage.sheets(), &sid, &rs2).unwrap();

        // Value 150 passes rule 2 (0-200) but fails rule 1 (0-100).
        // First-match semantics: rule 1 wins, result is FAIL with Strict enforcement.
        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            0,
            "150",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(!result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::Strict);

        // Updating the first rule must preserve its priority.
        let mut rs1_updated = rs1.clone();
        rs1_updated.enforcement = Some(EnforcementLevel::Warning);
        update_range_schema(
            storage.doc(),
            storage.sheets(),
            &sid,
            "rs-first",
            &rs1_updated,
        )
        .unwrap();

        let result = validate_cell_value(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            0,
            "150",
            Some(&gi),
            &empty_mirror(),
        );
        assert!(!result.valid);
        assert_eq!(result.enforcement, EnforcementLevel::Warning);
    }
}
