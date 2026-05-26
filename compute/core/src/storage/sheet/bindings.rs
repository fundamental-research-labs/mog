//! Sheet-level Data Binding CRUD operations.
//!
//! Port of `spreadsheet-model/src/bindings.ts` (spreadsheet-model elimination).
//!
//! Sheet-level bindings are position-based, NOT CellId-based.
//! They define a region where data will be written, creating new cells on refresh.
//!
//! ## Yrs Storage Layout
//!
//! Each sheet has a `bindings` map storing bindings as structured Y.Maps keyed by binding ID:
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- bindings: Y.Map
//!           +-- {bindingId}: Y.Map (structured SheetDataBinding)
//! ```

use std::sync::Arc;

use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

pub use crate::engine_types::bindings::*;
use compute_document::schema::KEY_BINDINGS;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;

// =============================================================================
// ID Generation
// =============================================================================

/// Generate a unique sheet data binding ID.
fn generate_binding_id(id_alloc: &cell_types::IdAllocator) -> String {
    format!(
        "sdb-{}",
        cell_types::CellId::from_raw(id_alloc.next_u128()).to_uuid_string()
    )
}

// =============================================================================
// Internal Helpers
// =============================================================================

/// Get the `bindings` MapRef for a given sheet (read-only).
fn get_bindings_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_id) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_BINDINGS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

// =============================================================================
// Structured Y.Map read/write for SheetDataBinding (inline, since the type
// lives in snapshot-types which depends on domain-types)
// =============================================================================

mod binding_yrs {
    use super::*;
    use domain_types::yrs_schema::helpers::*;

    pub const KEY_ID: &str = "id";
    pub const KEY_SHEET_ID: &str = "sheetId";
    pub const KEY_CONNECTION_ID: &str = "connectionId";
    pub const KEY_COLUMN_MAPPINGS: &str = "columnMappings";
    pub const KEY_AUTO_GENERATE_ROWS: &str = "autoGenerateRows";
    pub const KEY_HEADER_ROW: &str = "headerRow";
    pub const KEY_DATA_START_ROW: &str = "dataStartRow";
    pub const KEY_PRESERVE_HEADER_FORMATTING: &str = "preserveHeaderFormatting";
    pub const KEY_LAST_REFRESH: &str = "lastRefresh";
    pub const KEY_LAST_ROW_COUNT: &str = "lastRowCount";

    /// Convert a [`SheetDataBinding`] to Yrs prelim entries.
    ///
    /// Scalar fields → native Yrs keys. `column_mappings` uses JSON bridge.
    pub fn to_yrs_prelim(b: &SheetDataBinding) -> Vec<(&str, Any)> {
        let mut entries: Vec<(&str, Any)> = vec![
            (KEY_ID, Any::String(Arc::from(b.id.as_str()))),
            (KEY_SHEET_ID, Any::String(Arc::from(b.sheet_id.as_str()))),
            (
                KEY_CONNECTION_ID,
                Any::String(Arc::from(b.connection_id.as_str())),
            ),
            (KEY_COLUMN_MAPPINGS, json_any(&b.column_mappings)),
            (KEY_AUTO_GENERATE_ROWS, Any::Bool(b.auto_generate_rows)),
            (KEY_HEADER_ROW, Any::Number(b.header_row as f64)),
            (KEY_DATA_START_ROW, Any::Number(b.data_start_row as f64)),
            (
                KEY_PRESERVE_HEADER_FORMATTING,
                Any::Bool(b.preserve_header_formatting),
            ),
        ];
        if let Some(ts) = b.last_refresh {
            entries.push((KEY_LAST_REFRESH, Any::Number(ts as f64)));
        }
        if let Some(count) = b.last_row_count {
            entries.push((KEY_LAST_ROW_COUNT, Any::Number(count as f64)));
        }
        entries
    }

    /// Read a [`SheetDataBinding`] from a structured Y.Map.
    pub fn from_yrs_map<T: yrs::ReadTxn>(map: &MapRef, txn: &T) -> Option<SheetDataBinding> {
        let id = read_string(map, txn, KEY_ID)?;
        Some(SheetDataBinding {
            id,
            sheet_id: read_string(map, txn, KEY_SHEET_ID).unwrap_or_default(),
            connection_id: read_string(map, txn, KEY_CONNECTION_ID).unwrap_or_default(),
            column_mappings: read_json(map, txn, KEY_COLUMN_MAPPINGS).unwrap_or_default(),
            auto_generate_rows: read_bool(map, txn, KEY_AUTO_GENERATE_ROWS).unwrap_or(true),
            header_row: read_i32(map, txn, KEY_HEADER_ROW).unwrap_or(0),
            data_start_row: read_i32(map, txn, KEY_DATA_START_ROW).unwrap_or(1),
            preserve_header_formatting: read_bool(map, txn, KEY_PRESERVE_HEADER_FORMATTING)
                .unwrap_or(true),
            last_refresh: read_i64(map, txn, KEY_LAST_REFRESH),
            last_row_count: read_u32(map, txn, KEY_LAST_ROW_COUNT),
        })
    }
}

/// Read all bindings from a bindings map (structured Y.Map format).
fn read_all_bindings<T: yrs::ReadTxn>(txn: &T, bindings_map: &MapRef) -> Vec<SheetDataBinding> {
    let mut result = Vec::new();
    for (_key, value) in bindings_map.iter(txn) {
        if let Out::YMap(map) = &value
            && let Some(b) = binding_yrs::from_yrs_map(map, txn)
        {
            result.push(b);
        }
    }
    result
}

// =============================================================================
// CRUD Operations
// =============================================================================

/// Create a new sheet data binding.
///
/// Stores the binding as a structured Y.Map in the sheet's `bindings` map.
///
/// # Errors
///
/// Returns `ComputeError::SheetNotFound` if the sheet does not exist.
pub fn create_binding(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &str,
    connection_id: &str,
    column_mappings: Vec<ColumnMapping>,
    options: CreateBindingOptions,
    id_alloc: &cell_types::IdAllocator,
) -> Result<SheetDataBinding, ComputeError> {
    let binding_id = generate_binding_id(id_alloc);

    let binding = SheetDataBinding {
        id: binding_id.clone(),
        sheet_id: sheet_id.to_string(),
        connection_id: connection_id.to_string(),
        column_mappings,
        auto_generate_rows: options.auto_generate_rows.unwrap_or(true),
        header_row: options.header_row.unwrap_or(0),
        data_start_row: options.data_start_row.unwrap_or(1),
        preserve_header_formatting: options.preserve_header_formatting.unwrap_or(true),
        last_refresh: None,
        last_row_count: None,
    };

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let bindings_map =
        get_bindings_map(&txn, sheets, sheet_id).ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_string(),
        })?;

    // Write as structured Y.Map
    let prelim: MapPrelim = binding_yrs::to_yrs_prelim(&binding).into_iter().collect();
    bindings_map.insert(&mut txn, &*binding_id, prelim);

    Ok(binding)
}

/// Get all data bindings for a sheet.
///
/// Returns an empty vector if the sheet or bindings map does not exist.
pub fn get_all_bindings(doc: &Doc, sheets: &MapRef, sheet_id: &str) -> Vec<SheetDataBinding> {
    let txn = doc.transact();
    let bindings_map = match get_bindings_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return vec![],
    };
    read_all_bindings(&txn, &bindings_map)
}

/// Get a specific data binding by ID.
///
/// Returns `None` if the sheet or binding does not exist.
pub fn get_binding(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &str,
    binding_id: &str,
) -> Option<SheetDataBinding> {
    let txn = doc.transact();
    let bindings_map = get_bindings_map(&txn, sheets, sheet_id)?;
    let out = bindings_map.get(&txn, binding_id)?;
    match &out {
        Out::YMap(map) => binding_yrs::from_yrs_map(map, &txn),
        _ => None,
    }
}

/// Get data bindings for a specific connection across all sheets.
///
/// Iterates over every sheet's `bindings` map and collects bindings matching
/// the given `connection_id`.
pub fn get_bindings_for_connection(
    doc: &Doc,
    sheets: &MapRef,
    connection_id: &str,
) -> Vec<SheetDataBinding> {
    let txn = doc.transact();
    let mut result = Vec::new();

    for (_sheet_key, sheet_value) in sheets.iter(&txn) {
        let sheet_map = match sheet_value {
            Out::YMap(m) => m,
            _ => continue,
        };
        let bindings_map = match sheet_map.get(&txn, KEY_BINDINGS) {
            Some(Out::YMap(m)) => m,
            _ => continue,
        };
        for (_key, value) in bindings_map.iter(&txn) {
            if let Out::YMap(map) = &value
                && let Some(b) = binding_yrs::from_yrs_map(map, &txn)
                && b.connection_id == connection_id
            {
                result.push(b);
            }
        }
    }

    result
}

/// Update a sheet data binding with partial field updates.
///
/// Returns the updated binding, or `None` if the sheet or binding was not found.
pub fn update_binding(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &str,
    binding_id: &str,
    updates: UpdateBindingFields,
) -> Option<SheetDataBinding> {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let bindings_map = get_bindings_map(&txn, sheets, sheet_id)?;
    let out = bindings_map.get(&txn, binding_id)?;
    let mut binding = match &out {
        Out::YMap(map) => binding_yrs::from_yrs_map(map, &txn)?,
        _ => return None,
    };

    // Apply updates
    if let Some(conn) = updates.connection_id {
        binding.connection_id = conn;
    }
    if let Some(mappings) = updates.column_mappings {
        binding.column_mappings = mappings;
    }
    if let Some(v) = updates.auto_generate_rows {
        binding.auto_generate_rows = v;
    }
    if let Some(v) = updates.header_row {
        binding.header_row = v;
    }
    if let Some(v) = updates.data_start_row {
        binding.data_start_row = v;
    }
    if let Some(v) = updates.preserve_header_formatting {
        binding.preserve_header_formatting = v;
    }

    // Write back as structured Y.Map
    let prelim: MapPrelim = binding_yrs::to_yrs_prelim(&binding).into_iter().collect();
    bindings_map.insert(&mut txn, binding_id, prelim);

    Some(binding)
}

/// Update binding refresh metadata (lastRefresh, lastRowCount).
///
/// This is a lightweight update intended for system-level bookkeeping
/// (no undo tracking in the TS version).
pub fn update_refresh_metadata(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &str,
    binding_id: &str,
    last_refresh: i64,
    last_row_count: u32,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let bindings_map = match get_bindings_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return,
    };
    let out = match bindings_map.get(&txn, binding_id) {
        Some(v) => v,
        None => return,
    };
    let mut binding = match &out {
        Out::YMap(map) => match binding_yrs::from_yrs_map(map, &txn) {
            Some(b) => b,
            None => return,
        },
        _ => return,
    };

    binding.last_refresh = Some(last_refresh);
    binding.last_row_count = Some(last_row_count);

    // Write back as structured Y.Map
    let prelim: MapPrelim = binding_yrs::to_yrs_prelim(&binding).into_iter().collect();
    bindings_map.insert(&mut txn, binding_id, prelim);
}

/// Remove a sheet data binding.
///
/// Returns `true` if the binding was found and removed, `false` otherwise.
pub fn remove_binding(doc: &Doc, sheets: &MapRef, sheet_id: &str, binding_id: &str) -> bool {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let bindings_map = match get_bindings_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return false,
    };

    // Check if binding exists before removing
    if bindings_map.get(&txn, binding_id).is_none() {
        return false;
    }

    bindings_map.remove(&mut txn, binding_id);
    true
}

/// Remove all data bindings for a connection across all sheets.
///
/// Returns the number of bindings removed.
pub fn remove_bindings_for_connection(doc: &Doc, sheets: &MapRef, connection_id: &str) -> u32 {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let mut count = 0u32;

    // Collect sheet keys first (to avoid borrowing issues)
    let sheet_keys: Vec<String> = sheets.iter(&txn).map(|(k, _)| k.to_string()).collect();

    for sheet_key in &sheet_keys {
        let sheet_map = match sheets.get(&txn, sheet_key.as_str()) {
            Some(Out::YMap(m)) => m,
            _ => continue,
        };
        let bindings_map = match sheet_map.get(&txn, KEY_BINDINGS) {
            Some(Out::YMap(m)) => m,
            _ => continue,
        };

        // Collect binding IDs to remove
        let to_remove: Vec<String> = bindings_map
            .iter(&txn)
            .filter_map(|(key, value)| {
                if let Out::YMap(map) = &value
                    && let Some(b) = binding_yrs::from_yrs_map(map, &txn)
                    && b.connection_id == connection_id
                {
                    return Some(key.to_string());
                }
                None
            })
            .collect();

        for binding_id in &to_remove {
            bindings_map.remove(&mut txn, binding_id.as_str());
            count += 1;
        }
    }

    count
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    /// Create a YrsStorage with one sheet and return (storage, sheet_hex).
    fn storage_with_sheet() -> (YrsStorage, String) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sheet_id = cell_types::SheetId::from_raw(1);
        storage
            .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
            .expect("add_sheet should succeed");
        let sheet_hex = format!("{:032x}", 1u128);
        (storage, sheet_hex)
    }

    /// Create a YrsStorage with two sheets and return (storage, sheet1_hex, sheet2_hex).
    fn storage_with_two_sheets() -> (YrsStorage, String, String) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = cell_types::SheetId::from_raw(1);
        let s2 = cell_types::SheetId::from_raw(2);
        storage
            .add_sheet(&mut mirror, s1, "Sheet1", 100, 26)
            .unwrap();
        storage
            .add_sheet(&mut mirror, s2, "Sheet2", 100, 26)
            .unwrap();
        let hex1 = format!("{:032x}", 1u128);
        let hex2 = format!("{:032x}", 2u128);
        (storage, hex1, hex2)
    }

    fn sample_mappings() -> Vec<ColumnMapping> {
        vec![
            ColumnMapping {
                column_index: 0,
                data_path: "name".to_string(),
                header_text: Some("Name".to_string()),
            },
            ColumnMapping {
                column_index: 1,
                data_path: "value".to_string(),
                header_text: None,
            },
        ]
    }

    // -------------------------------------------------------------------
    // Test 1: Create binding with default options
    // -------------------------------------------------------------------

    #[test]
    fn test_create_binding_default_options() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let binding = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .expect("create should succeed");

        assert!(binding.id.starts_with("sdb-"));
        assert_eq!(binding.sheet_id, sheet_hex);
        assert_eq!(binding.connection_id, "conn-1");
        assert_eq!(binding.column_mappings.len(), 2);
        assert!(binding.auto_generate_rows);
        assert_eq!(binding.header_row, 0);
        assert_eq!(binding.data_start_row, 1);
        assert!(binding.preserve_header_formatting);
        assert!(binding.last_refresh.is_none());
        assert!(binding.last_row_count.is_none());
    }

    // -------------------------------------------------------------------
    // Test 2: Create binding with custom options
    // -------------------------------------------------------------------

    #[test]
    fn test_create_binding_custom_options() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let options = CreateBindingOptions {
            auto_generate_rows: Some(false),
            header_row: Some(-1),
            data_start_row: Some(5),
            preserve_header_formatting: Some(false),
        };

        let binding = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-2",
            sample_mappings(),
            options,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert!(!binding.auto_generate_rows);
        assert_eq!(binding.header_row, -1);
        assert_eq!(binding.data_start_row, 5);
        assert!(!binding.preserve_header_formatting);
    }

    // -------------------------------------------------------------------
    // Test 3: Create binding fails for invalid sheet
    // -------------------------------------------------------------------

    #[test]
    fn test_create_binding_invalid_sheet() {
        let storage = YrsStorage::new();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let result = create_binding(
            doc,
            sheets,
            "nonexistent-sheet",
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        );

        assert!(result.is_err());
        match result.unwrap_err() {
            ComputeError::SheetNotFound { sheet_id } => {
                assert_eq!(sheet_id, "nonexistent-sheet");
            }
            other => panic!("Expected SheetNotFound, got {:?}", other),
        }
    }

    // -------------------------------------------------------------------
    // Test 4: Get all bindings from empty sheet
    // -------------------------------------------------------------------

    #[test]
    fn test_get_all_bindings_empty() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let bindings = get_all_bindings(doc, sheets, &sheet_hex);
        assert!(bindings.is_empty());
    }

    // -------------------------------------------------------------------
    // Test 5: Get all bindings with one binding
    // -------------------------------------------------------------------

    #[test]
    fn test_get_all_bindings_one() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let bindings = get_all_bindings(doc, sheets, &sheet_hex);
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].connection_id, "conn-1");
    }

    // -------------------------------------------------------------------
    // Test 6: Get all bindings with multiple bindings
    // -------------------------------------------------------------------

    #[test]
    fn test_get_all_bindings_multiple() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        for i in 0..3 {
            create_binding(
                doc,
                sheets,
                &sheet_hex,
                &format!("conn-{}", i),
                sample_mappings(),
                CreateBindingOptions::default(),
                &crate::storage::STORAGE_ID_ALLOC,
            )
            .unwrap();
        }

        let bindings = get_all_bindings(doc, sheets, &sheet_hex);
        assert_eq!(bindings.len(), 3);
    }

    // -------------------------------------------------------------------
    // Test 7: Get all bindings for nonexistent sheet returns empty
    // -------------------------------------------------------------------

    #[test]
    fn test_get_all_bindings_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let bindings = get_all_bindings(doc, sheets, "no-such-sheet");
        assert!(bindings.is_empty());
    }

    // -------------------------------------------------------------------
    // Test 8: Get specific binding (found)
    // -------------------------------------------------------------------

    #[test]
    fn test_get_binding_found() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let created = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let binding = get_binding(doc, sheets, &sheet_hex, &created.id);
        assert!(binding.is_some());
        let binding = binding.unwrap();
        assert_eq!(binding.id, created.id);
        assert_eq!(binding.connection_id, "conn-1");
    }

    // -------------------------------------------------------------------
    // Test 9: Get specific binding (not found)
    // -------------------------------------------------------------------

    #[test]
    fn test_get_binding_not_found() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let binding = get_binding(doc, sheets, &sheet_hex, "nonexistent-binding");
        assert!(binding.is_none());
    }

    // -------------------------------------------------------------------
    // Test 10: Get bindings for connection across sheets
    // -------------------------------------------------------------------

    #[test]
    fn test_get_bindings_for_connection() {
        let (storage, hex1, hex2) = storage_with_two_sheets();
        let doc = storage.doc();
        let sheets = storage.sheets();

        // Create bindings on both sheets for the same connection
        create_binding(
            doc,
            sheets,
            &hex1,
            "shared-conn",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        create_binding(
            doc,
            sheets,
            &hex2,
            "shared-conn",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        // Also create a binding for a different connection
        create_binding(
            doc,
            sheets,
            &hex1,
            "other-conn",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let bindings = get_bindings_for_connection(doc, sheets, "shared-conn");
        assert_eq!(bindings.len(), 2);
        assert!(bindings.iter().all(|b| b.connection_id == "shared-conn"));
    }

    // -------------------------------------------------------------------
    // Test 11: Get bindings for connection with no matches
    // -------------------------------------------------------------------

    #[test]
    fn test_get_bindings_for_connection_none() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let bindings = get_bindings_for_connection(doc, sheets, "nonexistent-conn");
        assert!(bindings.is_empty());
    }

    // -------------------------------------------------------------------
    // Test 12: Update binding fields
    // -------------------------------------------------------------------

    #[test]
    fn test_update_binding() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let created = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let updated = update_binding(
            doc,
            sheets,
            &sheet_hex,
            &created.id,
            UpdateBindingFields {
                connection_id: Some("conn-2".to_string()),
                auto_generate_rows: Some(false),
                header_row: Some(3),
                ..Default::default()
            },
        );

        assert!(updated.is_some());
        let updated = updated.unwrap();
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.connection_id, "conn-2");
        assert!(!updated.auto_generate_rows);
        assert_eq!(updated.header_row, 3);
        // Unchanged fields
        assert_eq!(updated.data_start_row, 1);
        assert!(updated.preserve_header_formatting);
    }

    // -------------------------------------------------------------------
    // Test 13: Update binding column mappings
    // -------------------------------------------------------------------

    #[test]
    fn test_update_binding_column_mappings() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let created = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
        assert_eq!(created.column_mappings.len(), 2);

        let new_mappings = vec![ColumnMapping {
            column_index: 5,
            data_path: "total".to_string(),
            header_text: Some("Total".to_string()),
        }];

        let updated = update_binding(
            doc,
            sheets,
            &sheet_hex,
            &created.id,
            UpdateBindingFields {
                column_mappings: Some(new_mappings),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.column_mappings.len(), 1);
        assert_eq!(updated.column_mappings[0].column_index, 5);
        assert_eq!(updated.column_mappings[0].data_path, "total");
    }

    // -------------------------------------------------------------------
    // Test 14: Update binding not found
    // -------------------------------------------------------------------

    #[test]
    fn test_update_binding_not_found() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let result = update_binding(
            doc,
            sheets,
            &sheet_hex,
            "nonexistent",
            UpdateBindingFields {
                connection_id: Some("x".to_string()),
                ..Default::default()
            },
        );

        assert!(result.is_none());
    }

    // -------------------------------------------------------------------
    // Test 15: Update refresh metadata
    // -------------------------------------------------------------------

    #[test]
    fn test_update_refresh_metadata() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let created = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert!(created.last_refresh.is_none());
        assert!(created.last_row_count.is_none());

        update_refresh_metadata(doc, sheets, &sheet_hex, &created.id, 1700000000000, 42);

        let binding = get_binding(doc, sheets, &sheet_hex, &created.id).unwrap();
        assert_eq!(binding.last_refresh, Some(1700000000000));
        assert_eq!(binding.last_row_count, Some(42));
    }

    // -------------------------------------------------------------------
    // Test 16: Update refresh metadata for nonexistent binding (no-op)
    // -------------------------------------------------------------------

    #[test]
    fn test_update_refresh_metadata_nonexistent() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        // Should not panic
        update_refresh_metadata(doc, sheets, &sheet_hex, "nonexistent", 123, 0);
    }

    // -------------------------------------------------------------------
    // Test 17: Remove binding (found)
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_binding_found() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let created = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let removed = remove_binding(doc, sheets, &sheet_hex, &created.id);
        assert!(removed);

        // Verify it's gone
        let binding = get_binding(doc, sheets, &sheet_hex, &created.id);
        assert!(binding.is_none());
        assert!(get_all_bindings(doc, sheets, &sheet_hex).is_empty());
    }

    // -------------------------------------------------------------------
    // Test 18: Remove binding (not found)
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_binding_not_found() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let removed = remove_binding(doc, sheets, &sheet_hex, "nonexistent");
        assert!(!removed);
    }

    // -------------------------------------------------------------------
    // Test 19: Remove binding from nonexistent sheet
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_binding_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let removed = remove_binding(doc, sheets, "no-sheet", "no-binding");
        assert!(!removed);
    }

    // -------------------------------------------------------------------
    // Test 20: Remove bindings for connection across sheets
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_bindings_for_connection() {
        let (storage, hex1, hex2) = storage_with_two_sheets();
        let doc = storage.doc();
        let sheets = storage.sheets();

        // Create 2 bindings for "shared-conn" and 1 for "other-conn"
        create_binding(
            doc,
            sheets,
            &hex1,
            "shared-conn",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        create_binding(
            doc,
            sheets,
            &hex2,
            "shared-conn",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        create_binding(
            doc,
            sheets,
            &hex1,
            "other-conn",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let removed_count = remove_bindings_for_connection(doc, sheets, "shared-conn");
        assert_eq!(removed_count, 2);

        // Verify shared-conn bindings are gone
        assert!(get_bindings_for_connection(doc, sheets, "shared-conn").is_empty());

        // other-conn still has its binding
        let remaining = get_all_bindings(doc, sheets, &hex1);
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].connection_id, "other-conn");
    }

    // -------------------------------------------------------------------
    // Test 21: Remove bindings for connection with no matches
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_bindings_for_connection_none() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let removed_count = remove_bindings_for_connection(doc, sheets, "nonexistent-conn");
        assert_eq!(removed_count, 0);

        // Original binding still exists
        assert_eq!(get_all_bindings(doc, sheets, &sheet_hex).len(), 1);
    }

    // -------------------------------------------------------------------
    // Test 22: Create binding with empty column mappings
    // -------------------------------------------------------------------

    #[test]
    fn test_create_binding_empty_mappings() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let binding = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            vec![],
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert!(binding.column_mappings.is_empty());

        // Should still be retrievable
        let fetched = get_binding(doc, sheets, &sheet_hex, &binding.id).unwrap();
        assert!(fetched.column_mappings.is_empty());
    }

    // -------------------------------------------------------------------
    // Test 23: Multiple bindings on same sheet have unique IDs
    // -------------------------------------------------------------------

    #[test]
    fn test_unique_binding_ids() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let b1 = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let b2 = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-2",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert_ne!(b1.id, b2.id);
        assert!(b1.id.starts_with("sdb-"));
        assert!(b2.id.starts_with("sdb-"));
    }

    // -------------------------------------------------------------------
    // Test 24: Binding serde roundtrip
    // -------------------------------------------------------------------

    #[test]
    fn test_binding_serde_roundtrip() {
        let binding = SheetDataBinding {
            id: "sdb-test".to_string(),
            sheet_id: "sheet-1".to_string(),
            connection_id: "conn-1".to_string(),
            column_mappings: vec![
                ColumnMapping {
                    column_index: 0,
                    data_path: "name".to_string(),
                    header_text: Some("Name".to_string()),
                },
                ColumnMapping {
                    column_index: 1,
                    data_path: "items[0].value".to_string(),
                    header_text: None,
                },
            ],
            auto_generate_rows: true,
            header_row: 0,
            data_start_row: 1,
            preserve_header_formatting: true,
            last_refresh: Some(1700000000000),
            last_row_count: Some(100),
        };

        let json = serde_json::to_string(&binding).unwrap();
        let deserialized: SheetDataBinding = serde_json::from_str(&json).unwrap();
        assert_eq!(binding, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 25: ColumnMapping serde roundtrip
    // -------------------------------------------------------------------

    #[test]
    fn test_column_mapping_serde_roundtrip() {
        let mapping = ColumnMapping {
            column_index: 5,
            data_path: "nested.path[0]".to_string(),
            header_text: Some("Header".to_string()),
        };

        let json = serde_json::to_string(&mapping).unwrap();
        let deserialized: ColumnMapping = serde_json::from_str(&json).unwrap();
        assert_eq!(mapping, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 26: Create and remove, then create again
    // -------------------------------------------------------------------

    #[test]
    fn test_create_remove_create_again() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let b1 = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert!(remove_binding(doc, sheets, &sheet_hex, &b1.id));
        assert!(get_all_bindings(doc, sheets, &sheet_hex).is_empty());

        let b2 = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        assert_ne!(b1.id, b2.id);
        assert_eq!(get_all_bindings(doc, sheets, &sheet_hex).len(), 1);
    }

    // -------------------------------------------------------------------
    // Test 27: Update preserves id and sheet_id
    // -------------------------------------------------------------------

    #[test]
    fn test_update_preserves_immutable_fields() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let created = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        let updated = update_binding(
            doc,
            sheets,
            &sheet_hex,
            &created.id,
            UpdateBindingFields {
                connection_id: Some("conn-99".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        // id and sheet_id should remain the same
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.sheet_id, created.sheet_id);
        assert_eq!(updated.connection_id, "conn-99");
    }

    // -------------------------------------------------------------------
    // Test 28: Update refresh metadata preserves other fields
    // -------------------------------------------------------------------

    #[test]
    fn test_update_refresh_metadata_preserves_fields() {
        let (storage, sheet_hex) = storage_with_sheet();
        let doc = storage.doc();
        let sheets = storage.sheets();

        let created = create_binding(
            doc,
            sheets,
            &sheet_hex,
            "conn-1",
            sample_mappings(),
            CreateBindingOptions {
                auto_generate_rows: Some(false),
                header_row: Some(5),
                data_start_row: Some(10),
                preserve_header_formatting: Some(false),
            },
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();

        update_refresh_metadata(doc, sheets, &sheet_hex, &created.id, 999, 50);

        let binding = get_binding(doc, sheets, &sheet_hex, &created.id).unwrap();
        // Refresh metadata updated
        assert_eq!(binding.last_refresh, Some(999));
        assert_eq!(binding.last_row_count, Some(50));
        // Other fields preserved
        assert!(!binding.auto_generate_rows);
        assert_eq!(binding.header_row, 5);
        assert_eq!(binding.data_start_row, 10);
        assert!(!binding.preserve_header_formatting);
        assert_eq!(binding.connection_id, "conn-1");
        assert_eq!(binding.column_mappings.len(), 2);
    }

    // -------------------------------------------------------------------
    // Test 29: Get binding from nonexistent sheet returns None
    // -------------------------------------------------------------------

    #[test]
    fn test_get_binding_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let binding = get_binding(doc, sheets, "no-sheet", "no-binding");
        assert!(binding.is_none());
    }

    // -------------------------------------------------------------------
    // Test 30: Remove bindings for connection on empty storage
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_bindings_for_connection_empty_storage() {
        let storage = YrsStorage::new();
        let doc = storage.doc();
        let sheets = storage.sheets();
        let count = remove_bindings_for_connection(doc, sheets, "some-conn");
        assert_eq!(count, 0);
    }
}
