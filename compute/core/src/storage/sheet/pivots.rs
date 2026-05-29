//! Sheet-level Pivot Table CRUD operations.
//!
//! Port of pivot table storage from TypeScript to Rust (Yrs-backed).
//!
//! ## Yrs Storage Layout
//!
//! Each sheet has a `pivotTables` sub-map storing pivot configs as JSON strings keyed by pivot ID:
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- pivotTables: Y.Map
//!           +-- {pivotId}: String (JSON-serialized PivotTableConfig)
//! ```
//!
//! ## Design Decisions
//!
//! - Pivot tables are stored as JSON strings (same pattern as charts/comments/sparklines).
//! - EventBus emission, observer/cache patterns, and legacy migration are not ported.

use std::sync::Arc;

use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::storage::infra::yrs_helpers::deserialize_yrs_json;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_PIVOT_TABLES;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::pivot::{PIVOT_CONFIG_SCHEMA_VERSION, PivotTableConfig};
use value_types::ComputeError;

// =============================================================================
// Private Helpers
// =============================================================================

/// Get the `pivotTables` MapRef for a given sheet (read-only).
fn get_pivots_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_PIVOT_TABLES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

// =============================================================================
// Structured Y.Map keys for PivotTableConfig
// =============================================================================

mod pivot_keys {
    pub const SCHEMA_VERSION: &str = "schemaVersion";
    pub const ID: &str = "id";
    pub const NAME: &str = "name";
    pub const SOURCE_SHEET_ID: &str = "sourceSheetId";
    pub const SOURCE_SHEET_NAME: &str = "sourceSheetName";
    pub const SOURCE_RANGE: &str = "sourceRange";
    pub const OUTPUT_SHEET_NAME: &str = "outputSheetName";
    pub const OUTPUT_LOCATION: &str = "outputLocation";
    pub const FIELDS: &str = "fields";
    pub const PLACEMENTS: &str = "placements";
    pub const FILTERS: &str = "filters";
    pub const LAYOUT: &str = "layout";
    pub const STYLE: &str = "style";
    pub const DATA_OPTIONS: &str = "dataOptions";
    pub const CREATED_AT: &str = "createdAt";
    pub const UPDATED_AT: &str = "updatedAt";
    pub const CALCULATED_FIELDS: &str = "calculatedFields";
    pub const ALLOW_MULTIPLE_FILTERS: &str = "allowMultipleFiltersPerField";
    pub const AUTO_FORMAT: &str = "autoFormat";
    pub const PRESERVE_FORMATTING: &str = "preserveFormatting";
    pub const CACHE_ID: &str = "cacheId";
    pub const DATA_ON_ROWS: &str = "dataOnRows";
    pub const REF_RANGE: &str = "refRange";
    pub const FIRST_DATA_ROW: &str = "firstDataRow";
    pub const FIRST_HEADER_ROW: &str = "firstHeaderRow";
    pub const FIRST_DATA_COL: &str = "firstDataCol";
    pub const ROWS_PER_PAGE: &str = "rowsPerPage";
    pub const COLS_PER_PAGE: &str = "colsPerPage";
    pub const ROW_ITEMS: &str = "rowItems";
    pub const COL_ITEMS: &str = "colItems";
}

// =============================================================================
// Structured Y.Map read/write helpers
// =============================================================================

fn read_str<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<String> {
    match map.get(txn, key)? {
        Out::Any(Any::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

fn read_bool<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<bool> {
    match map.get(txn, key)? {
        Out::Any(Any::Bool(b)) => Some(b),
        _ => None,
    }
}

fn read_num<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<f64> {
    match map.get(txn, key)? {
        Out::Any(Any::Number(n)) => Some(n),
        _ => None,
    }
}

/// Read a JSON-serialized sub-field from a Y.Map key.
fn read_json_field<T: yrs::ReadTxn, V: serde::de::DeserializeOwned>(
    map: &MapRef,
    txn: &T,
    key: &str,
) -> Option<V> {
    match map.get(txn, key)? {
        Out::Any(Any::String(s)) => serde_json::from_str(&s).ok(),
        _ => None,
    }
}

/// Read a PivotTableConfig from a structured Y.Map.
fn pivot_from_yrs_map<T: yrs::ReadTxn>(map: &MapRef, txn: &T) -> Option<PivotTableConfig> {
    use pivot_keys::*;
    let id = read_str(map, txn, ID)?;
    let name = read_str(map, txn, NAME).unwrap_or_default();

    use compute_pivot::{CellRange, OutputLocation};

    Some(PivotTableConfig {
        schema_version: read_num(map, txn, SCHEMA_VERSION)
            .map(|n| n as u32)
            .unwrap_or(PIVOT_CONFIG_SCHEMA_VERSION),
        id,
        name,
        source_sheet_id: read_str(map, txn, SOURCE_SHEET_ID),
        source_sheet_name: read_str(map, txn, SOURCE_SHEET_NAME).unwrap_or_default(),
        source_range: read_json_field(map, txn, SOURCE_RANGE).unwrap_or(CellRange::new(0, 0, 0, 0)),
        output_sheet_name: read_str(map, txn, OUTPUT_SHEET_NAME).unwrap_or_default(),
        output_location: read_json_field(map, txn, OUTPUT_LOCATION)
            .unwrap_or(OutputLocation { row: 0, col: 0 }),
        fields: read_json_field(map, txn, FIELDS).unwrap_or_default(),
        placements: read_json_field(map, txn, PLACEMENTS).unwrap_or_default(),
        filters: read_json_field(map, txn, FILTERS).unwrap_or_default(),
        layout: read_json_field(map, txn, LAYOUT),
        style: read_json_field(map, txn, STYLE),
        data_options: read_json_field(map, txn, DATA_OPTIONS),
        created_at: read_num(map, txn, CREATED_AT),
        updated_at: read_num(map, txn, UPDATED_AT),
        calculated_fields: read_json_field(map, txn, CALCULATED_FIELDS),
        allow_multiple_filters_per_field: read_bool(map, txn, ALLOW_MULTIPLE_FILTERS),
        auto_format: read_bool(map, txn, AUTO_FORMAT),
        preserve_formatting: read_bool(map, txn, PRESERVE_FORMATTING),
        cache_id: read_num(map, txn, CACHE_ID).map(|n| n as u32),
        data_on_rows: read_bool(map, txn, DATA_ON_ROWS),
        ref_range: read_str(map, txn, REF_RANGE),
        first_data_row: read_num(map, txn, FIRST_DATA_ROW).map(|n| n as u32),
        first_header_row: read_num(map, txn, FIRST_HEADER_ROW).map(|n| n as u32),
        first_data_col: read_num(map, txn, FIRST_DATA_COL).map(|n| n as u32),
        rows_per_page: read_num(map, txn, ROWS_PER_PAGE).map(|n| n as u32),
        cols_per_page: read_num(map, txn, COLS_PER_PAGE).map(|n| n as u32),
        row_items: read_json_field(map, txn, ROW_ITEMS).unwrap_or_default(),
        col_items: read_json_field(map, txn, COL_ITEMS).unwrap_or_default(),
    })
}

/// Write a PivotTableConfig into a parent Y.Map at the given key.
fn write_pivot(parent: &MapRef, txn: &mut yrs::TransactionMut, key: &str, p: &PivotTableConfig) {
    use pivot_keys::*;
    parent.insert(txn, key, MapPrelim::from([] as [(&str, Any); 0]));
    let map = match parent.get(txn, key) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };
    map.insert(
        txn,
        SCHEMA_VERSION,
        Any::Number(f64::from(p.schema_version)),
    );
    map.insert(txn, ID, Any::String(Arc::from(p.id.as_str())));
    map.insert(txn, NAME, Any::String(Arc::from(p.name.as_str())));
    if let Some(ref source_sheet_id) = p.source_sheet_id {
        map.insert(
            txn,
            SOURCE_SHEET_ID,
            Any::String(Arc::from(source_sheet_id.as_str())),
        );
    }
    map.insert(
        txn,
        SOURCE_SHEET_NAME,
        Any::String(Arc::from(p.source_sheet_name.as_str())),
    );
    map.insert(
        txn,
        OUTPUT_SHEET_NAME,
        Any::String(Arc::from(p.output_sheet_name.as_str())),
    );

    // Complex sub-objects as JSON strings
    fn json_any<V: serde::Serialize>(v: &V) -> Any {
        Any::String(Arc::from(
            serde_json::to_string(v).unwrap_or_default().as_str(),
        ))
    }
    map.insert(txn, SOURCE_RANGE, json_any(&p.source_range));
    map.insert(txn, OUTPUT_LOCATION, json_any(&p.output_location));
    map.insert(txn, FIELDS, json_any(&p.fields));
    map.insert(txn, PLACEMENTS, json_any(&p.placements));
    map.insert(txn, FILTERS, json_any(&p.filters));
    if let Some(ref layout) = p.layout {
        map.insert(txn, LAYOUT, json_any(layout));
    }
    if let Some(ref style) = p.style {
        map.insert(txn, STYLE, json_any(style));
    }
    if let Some(ref opts) = p.data_options {
        map.insert(txn, DATA_OPTIONS, json_any(opts));
    }
    if let Some(ts) = p.created_at {
        map.insert(txn, CREATED_AT, Any::Number(ts));
    }
    if let Some(ts) = p.updated_at {
        map.insert(txn, UPDATED_AT, Any::Number(ts));
    }
    if let Some(ref cf) = p.calculated_fields {
        map.insert(txn, CALCULATED_FIELDS, json_any(cf));
    }
    if let Some(v) = p.allow_multiple_filters_per_field {
        map.insert(txn, ALLOW_MULTIPLE_FILTERS, Any::Bool(v));
    }
    if let Some(v) = p.auto_format {
        map.insert(txn, AUTO_FORMAT, Any::Bool(v));
    }
    if let Some(v) = p.preserve_formatting {
        map.insert(txn, PRESERVE_FORMATTING, Any::Bool(v));
    }
    if let Some(cache_id) = p.cache_id {
        map.insert(txn, CACHE_ID, Any::Number(f64::from(cache_id)));
    }
    if let Some(data_on_rows) = p.data_on_rows {
        map.insert(txn, DATA_ON_ROWS, Any::Bool(data_on_rows));
    }
    if let Some(ref ref_range) = p.ref_range {
        map.insert(txn, REF_RANGE, Any::String(Arc::from(ref_range.as_str())));
    }
    if let Some(first_data_row) = p.first_data_row {
        map.insert(txn, FIRST_DATA_ROW, Any::Number(f64::from(first_data_row)));
    }
    if let Some(first_header_row) = p.first_header_row {
        map.insert(
            txn,
            FIRST_HEADER_ROW,
            Any::Number(f64::from(first_header_row)),
        );
    }
    if let Some(first_data_col) = p.first_data_col {
        map.insert(txn, FIRST_DATA_COL, Any::Number(f64::from(first_data_col)));
    }
    if let Some(rows_per_page) = p.rows_per_page {
        map.insert(txn, ROWS_PER_PAGE, Any::Number(f64::from(rows_per_page)));
    }
    if let Some(cols_per_page) = p.cols_per_page {
        map.insert(txn, COLS_PER_PAGE, Any::Number(f64::from(cols_per_page)));
    }
    if !p.row_items.is_empty() {
        map.insert(txn, ROW_ITEMS, json_any(&p.row_items));
    }
    if !p.col_items.is_empty() {
        map.insert(txn, COL_ITEMS, json_any(&p.col_items));
    }
}

/// Read a PivotTableConfig from a Yrs Out value.
///
/// Tries structured Y.Map first, then falls back to legacy JSON string.
fn read_pivot_from_out<T: yrs::ReadTxn>(out: &Out, txn: &T) -> Option<PivotTableConfig> {
    match out {
        Out::YMap(map) => pivot_from_yrs_map(map, txn),
        Out::Any(Any::String(_)) => deserialize_yrs_json::<PivotTableConfig>(out),
        _ => None,
    }
}

/// Read all pivot tables from a pivots map.
fn read_all_pivots<T: yrs::ReadTxn>(txn: &T, pivots_map: &MapRef) -> Vec<PivotTableConfig> {
    let mut result = Vec::new();
    for (_key, value) in pivots_map.iter(txn) {
        if let Some(pivot) = read_pivot_from_out(&value, txn) {
            result.push(pivot);
        }
    }
    result
}

/// Get the current timestamp in milliseconds since UNIX epoch.
fn now_millis() -> f64 {
    crate::storage::infra::yrs_helpers::now_millis() as f64
}

/// Generate a unique pivot table ID: `pivot-{timestamp_millis}-{allocator_id}`.
///
/// The metadata allocator is client-partitioned: the high 64 bits identify the
/// client and the low 64 bits are the monotonic counter. Use the full u128 so
/// same-millisecond creates cannot collide by truncating away the changing
/// counter bits.
fn generate_pivot_id(id_alloc: &cell_types::IdAllocator) -> String {
    let ts = now_millis() as i64;
    let n = id_alloc.next_u128();
    format!("pivot-{}-{:032x}", ts, n)
}

// =============================================================================
// Pivot Table Operations (free functions)
// =============================================================================

// -------------------------------------------------------------------
// Pivot Table CRUD
// -------------------------------------------------------------------

pub fn create_pivot(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    mut config: PivotTableConfig,
    id_alloc: &cell_types::IdAllocator,
) -> Result<PivotTableConfig, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let pivot_id = generate_pivot_id(id_alloc);
    let now = now_millis();

    config.id = pivot_id.clone();
    config.created_at = Some(now);
    config.updated_at = Some(now);

    // Write as structured Y.Map
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let pivots_map =
        get_pivots_map(&txn, sheets, &sheet_hex).ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_hex.to_string(),
        })?;
    write_pivot(&pivots_map, &mut txn, &pivot_id, &config);

    Ok(config)
}

/// Get a single pivot table by ID.
pub fn get_pivot(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    pivot_id: &str,
) -> Option<PivotTableConfig> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let pivots_map = get_pivots_map(&txn, sheets, &sheet_hex)?;
    let out = pivots_map.get(&txn, pivot_id)?;
    read_pivot_from_out(&out, &txn)
}

/// Get all pivot tables in a sheet (unordered).
pub fn get_all_pivots(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<PivotTableConfig> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    match get_pivots_map(&txn, sheets, &sheet_hex) {
        Some(m) => read_all_pivots(&txn, &m),
        None => vec![],
    }
}

pub fn update_pivot(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    pivot_id: &str,
    mut config: PivotTableConfig,
) -> Option<PivotTableConfig> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    // Verify the pivot exists
    {
        let txn = doc.transact();
        let pivots_map = get_pivots_map(&txn, sheets, &sheet_hex)?;
        pivots_map.get(&txn, pivot_id)?;
    }

    config.updated_at = Some(now_millis());

    // Write as structured Y.Map
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let pivots_map = get_pivots_map(&txn, sheets, &sheet_hex)?;
    write_pivot(&pivots_map, &mut txn, pivot_id, &config);

    Some(config)
}

/// Delete a pivot table by ID. Returns `true` if the pivot existed and was removed.
pub fn delete_pivot(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, pivot_id: &str) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let pivots_map = match get_pivots_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    if pivots_map.get(&txn, pivot_id).is_none() {
        return false;
    }
    pivots_map.remove(&mut txn, pivot_id);
    true
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::super::test_support::setup;
    use super::*;
    use domain_types::domain::pivot::{CellRange, OutputLocation, PivotTableConfig};

    fn minimal_config(name: &str, output_col: u32) -> PivotTableConfig {
        PivotTableConfig {
            id: "caller-provided-id-must-be-replaced".to_string(),
            name: name.to_string(),
            source_sheet_id: Some("00000000000000000000000000000001".to_string()),
            source_sheet_name: "Sheet1".to_string(),
            source_range: CellRange::new(0, 0, 2, 1),
            output_sheet_name: "Sheet1".to_string(),
            output_location: OutputLocation {
                row: 0,
                col: output_col,
            },
            fields: Vec::new(),
            placements: Vec::new(),
            filters: Vec::new(),
            layout: None,
            style: None,
            data_options: None,
            created_at: None,
            updated_at: None,
            calculated_fields: None,
            allow_multiple_filters_per_field: None,
            auto_format: None,
            preserve_formatting: None,
            cache_id: None,
            data_on_rows: None,
            ref_range: None,
            first_data_row: None,
            first_header_row: None,
            first_data_col: None,
            rows_per_page: None,
            cols_per_page: None,
            row_items: Vec::new(),
            col_items: Vec::new(),
            schema_version: 0,
        }
    }

    #[test]
    fn create_multiple_pivots_does_not_overwrite_same_millisecond_ids() {
        let (storage, _mirror, sheet_id) = setup();
        let id_alloc = cell_types::IdAllocator::with_client_partition(storage.doc().client_id());

        let p1 = create_pivot(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            minimal_config("Pivot1", 4),
            &id_alloc,
        )
        .expect("create Pivot1");
        let p2 = create_pivot(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            minimal_config("Pivot2", 8),
            &id_alloc,
        )
        .expect("create Pivot2");
        let p3 = create_pivot(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            minimal_config("Pivot3", 12),
            &id_alloc,
        )
        .expect("create Pivot3");

        let ids: HashSet<&str> = [p1.id.as_str(), p2.id.as_str(), p3.id.as_str()]
            .into_iter()
            .collect();
        assert_eq!(ids.len(), 3, "Rust-owned pivot IDs must be unique");

        let pivots = get_all_pivots(storage.doc(), storage.sheets(), &sheet_id);
        let names: HashSet<&str> = pivots.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(pivots.len(), 3);
        assert!(names.contains("Pivot1"));
        assert!(names.contains("Pivot2"));
        assert!(names.contains("Pivot3"));
    }

    #[test]
    fn generated_pivot_id_uses_full_client_partitioned_allocator_value() {
        let id_alloc = cell_types::IdAllocator::with_client_partition(7);

        let first = generate_pivot_id(&id_alloc);
        let second = generate_pivot_id(&id_alloc);

        assert_ne!(first, second);
        assert!(
            first.ends_with("00000000000000070000000000000001"),
            "first pivot id should contain the full 128-bit allocator value: {first}"
        );
        assert!(
            second.ends_with("00000000000000070000000000000002"),
            "second pivot id should contain the full 128-bit allocator value: {second}"
        );
    }

    #[test]
    fn source_sheet_id_round_trips_through_structured_storage() {
        let (storage, _mirror, sheet_id) = setup();
        let id_alloc = cell_types::IdAllocator::with_client_partition(storage.doc().client_id());

        let created = create_pivot(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            minimal_config("SourceIdentity", 4),
            &id_alloc,
        )
        .expect("create pivot with source sheet ID");

        let loaded = get_pivot(storage.doc(), storage.sheets(), &sheet_id, &created.id)
            .expect("stored pivot should load");
        assert_eq!(
            loaded.source_sheet_id.as_deref(),
            Some("00000000000000000000000000000001")
        );
        assert_eq!(loaded.source_sheet_name, "Sheet1");
    }

    #[test]
    fn ooxml_pivot_fields_round_trip_through_structured_storage() {
        let (storage, _mirror, sheet_id) = setup();
        let id_alloc = cell_types::IdAllocator::with_client_partition(storage.doc().client_id());
        let mut config = minimal_config("OoxmlPivot", 4);
        config.cache_id = Some(42);
        config.ref_range = Some("B2:D9".to_string());
        config.first_header_row = Some(1);
        config.first_data_row = Some(2);
        config.first_data_col = Some(3);
        config.rows_per_page = Some(4);
        config.cols_per_page = Some(5);
        config.row_items = vec![domain_types::PivotRowColItem {
            item_type: Some(domain_types::PivotItemType::Grand),
            x_values: vec![None, Some(2)],
        }];

        let created = create_pivot(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            config,
            &id_alloc,
        )
        .expect("create pivot with OOXML fields");

        let loaded = get_pivot(storage.doc(), storage.sheets(), &sheet_id, &created.id)
            .expect("stored pivot should load");
        assert_eq!(loaded.cache_id, Some(42));
        assert_eq!(loaded.ref_range.as_deref(), Some("B2:D9"));
        assert_eq!(loaded.first_header_row, Some(1));
        assert_eq!(loaded.first_data_row, Some(2));
        assert_eq!(loaded.first_data_col, Some(3));
        assert_eq!(loaded.rows_per_page, Some(4));
        assert_eq!(loaded.cols_per_page, Some(5));
        assert_eq!(loaded.row_items, created.row_items);
    }
}
