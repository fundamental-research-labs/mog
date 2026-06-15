//! Yrs document schema key constants.
//!
//! These constants define the key names used in the Yrs CRDT document schema.
//! They mirror the Yjs schema used by the TypeScript layer.

/// Top-level doc keys
pub const KEY_WORKBOOK: &str = "workbook";
pub const KEY_SHEETS: &str = "sheets";
pub const KEY_SECURITY: &str = "security";

/// Security map keys
pub const KEY_SECURITY_POLICIES: &str = "policies";
pub const KEY_SECURITY_VERSION: &str = "version";
pub const KEY_SECURITY_TEMPLATES: &str = "templates";

/// Workbook map keys
pub const KEY_SHEET_ORDER: &str = "sheetOrder";
pub const KEY_SCHEMA_VERSION: &str = "schemaVersion";

/// Current schema version written by `init_canonical_schema` and the snapshot/
/// import hydration paths. Readers that encounter a version higher than
/// `MAX_SUPPORTED_SCHEMA_VERSION` must refuse to load the document.
pub const CURRENT_SCHEMA_VERSION: u32 = 18;
/// Maximum schema version this binary can safely operate on.
pub const MAX_SUPPORTED_SCHEMA_VERSION: u32 = 18;

/// Per-sheet map keys
pub const KEY_CELLS: &str = "cells";
pub const KEY_CELL_PROPERTIES: &str = "cellProperties";
/// Legacy grid index key — kept only for observer skip list backward compat
pub const KEY_GRID_INDEX: &str = "gridIndex";
pub const KEY_GRID_POS_TO_ID: &str = "posToId";
pub const KEY_GRID_ID_TO_POS: &str = "idToPos";
pub const KEY_GRID_ROW_AXIS: &str = "rowAxis";
pub const KEY_GRID_COL_AXIS: &str = "colAxis";
pub const KEY_ROW_HEIGHTS: &str = "rowHeights";
pub const KEY_COL_WIDTHS: &str = "colWidths";
pub const KEY_PROPERTIES: &str = "properties";
pub const KEY_SCHEMAS: &str = "schemas";
pub const KEY_PIVOT_TABLES: &str = "pivotTables";

/// Per-sheet structural maps
pub const KEY_MERGES: &str = "merges";
pub const KEY_MERGE_BACKUPS: &str = "mergeBackups";
pub const KEY_MANUAL_HIDDEN_ROWS: &str = "manualHiddenRows";
pub const KEY_FILTER_HIDDEN_ROWS: &str = "filterHiddenRows";
pub const KEY_HIDDEN_ROWS: &str = "hiddenRows";
pub const KEY_HIDDEN_COLS: &str = "hiddenCols";

/// YArray-based row/column ordering (CRDT-safe concurrent structural ops)
pub const KEY_ROW_ORDER: &str = "rowOrder";
pub const KEY_COL_ORDER: &str = "colOrder";
// `cellGrid` / `cellPos` retired in identity-grid migration; `gridIndex/{posToId,idToPos}`
// is the authoritative yrs-side identity store.

/// Per-sheet feature maps
pub const KEY_ROW_FORMATS: &str = "rowFormats";
pub const KEY_COL_FORMATS: &str = "colFormats";
pub const KEY_COL_FORMAT_RANGES: &str = "colFormatRanges";
pub const KEY_COMMENTS: &str = "comments";
pub const KEY_FILTERS: &str = "filters";
pub const KEY_FILTER_METADATA_BINDINGS: &str = "filterMetadataBindings";
pub const KEY_SPARKLINES: &str = "sparklines";
pub const KEY_CONDITIONAL_FORMAT: &str = "conditionalFormat";
pub const KEY_BINDINGS: &str = "bindings";
pub const KEY_GROUPING: &str = "grouping";
pub const KEY_SORTING: &str = "sorting";
pub const KEY_FLOATING_OBJECTS: &str = "floatingObjects";
pub const KEY_FLOATING_OBJECT_ORDER: &str = "floatingObjectOrder";
pub const KEY_FLOATING_OBJECT_GROUPS: &str = "floatingObjectGroups";

/// Per-sheet range maps
pub const KEY_RANGES: &str = "ranges";
pub const KEY_RANGE_PAYLOADS: &str = "rangePayloads";
pub const KEY_RANGE_FORMATS: &str = "rangeFormats";
pub const KEY_RANGE_BINDINGS: &str = "rangeBindings";

/// Per-sheet shared CF rule body store.
///
/// Each entry is keyed by a rule ID and stores the JSON-serialized rule body.
/// Multiple `RangeKind::CondFormat` Ranges can share the same rule body via
/// their `CfBinding.rule_ref` pointing to the same key in this map.
pub const KEY_CF_RULES: &str = "cfRules";

/// Per-sheet validation rules map (Phase 5D: rule bodies keyed by rule ID).
pub const KEY_VALIDATION_RULES: &str = "validationRules";

/// Workbook-level domain maps
pub const KEY_STYLE_PALETTE: &str = "stylePalette";
pub const KEY_WORKBOOK_STYLESHEET: &str = "workbookStylesheet";
pub const KEY_DXF_REGISTRY: &str = "differentialFormatRegistry";
pub const KEY_SHARED_STRING_HINTS: &str = "sharedStringHints";
pub const KEY_PACKAGE_FIDELITY_METADATA: &str = "packageFidelityMetadata";
pub const KEY_WORKBOOK_SETTINGS: &str = "workbookSettings";
pub const KEY_WORKBOOK_IDENTITY: &str = "workbookIdentity";
pub const KEY_WORKBOOK_LINKS: &str = "workbookLinks";
pub const KEY_WORKBOOK_CONNECTIONS: &str = "workbookConnections";
pub const KEY_IMPORTED_EXTERNAL_CACHE: &str = "importedExternalCache";
pub const KEY_IMPORTED_EXTERNAL_USAGE_PROVENANCE: &str = "importedExternalUsageProvenance";
pub const KEY_IMPORTED_EXTERNAL_PACKAGE_ARTIFACTS: &str = "importedExternalPackageArtifacts";
pub const KEY_NAMED_RANGES: &str = "namedRanges";
pub const KEY_TABLES: &str = "tables";
pub const KEY_CUSTOM_TABLE_STYLES: &str = "customTableStyles";
pub const KEY_XLSX_TABLE_STYLES: &str = "xlsxTableStyles";
pub const KEY_DATA_TABLE_REGIONS: &str = "dataTableRegions";
pub const KEY_SLICERS: &str = "slicers";
pub const KEY_TIMELINES: &str = "timelines";
pub const KEY_PIVOT_SPECS: &str = "pivotSpecs";
pub const KEY_IMPORTED_PIVOT_ASSOCIATIONS: &str = "importedPivotAssociations";
pub const KEY_PIVOT_CACHE_SOURCES: &str = "pivotCacheSources";
pub const KEY_PIVOT_CACHE_RECORDS: &str = "pivotCacheRecords";
pub const KEY_POWER_QUERY: &str = "powerQuery";
pub const KEY_SCENARIOS: &str = "scenarios";
pub const KEY_THEME: &str = "theme";
pub const KEY_CUSTOM_CELL_STYLES: &str = "custom_cell_styles";
pub const KEY_DOCUMENT_PROPERTIES: &str = "documentProperties";
pub const KEY_EXTENDED_DOCUMENT_PROPERTIES: &str = "extendedDocumentProperties";
pub const KEY_XLSX_METADATA: &str = "xlsxMetadata";
pub const KEY_FILE_VERSION: &str = "fileVersion";
pub const KEY_FILE_SHARING: &str = "fileSharing";
pub const KEY_WEB_PUBLISHING: &str = "webPublishing";
pub const KEY_THREADED_COMMENT_PERSONS: &str = "threadedCommentPersons";
pub const KEY_THREADED_COMMENT_PERSONS_PART_PRESENT: &str = "threadedCommentPersonsPartPresent";
pub const KEY_THREADED_COMMENT_PERSON_ORDER: &str = "threadedCommentPersonOrder";

/// Meta map keys
pub const KEY_NAME: &str = "name";
pub const KEY_ROWS: &str = "rows";
pub const KEY_COLS: &str = "cols";

/// Cell map keys
pub const KEY_VALUE: &str = "v";
pub const KEY_FORMULA: &str = "f";
pub const KEY_FORMULA_TEMPLATE: &str = "ft";
pub const KEY_FORMULA_REFS: &str = "fr";
pub const KEY_FORMULA_DYNAMIC_ARRAY: &str = "fda";
pub const KEY_FORMULA_VOLATILE: &str = "fv";
/// Typed formula boundary: top-level `SUBTOTAL`/`AGGREGATE` flag. Written only when
/// `true` (symmetric with `fda`/`fv`); absent means `false` — matches the
/// `#[serde(default)]` default on [`formula_types::IdentityFormula`], so
/// pre-W7 Yrs documents that never wrote this key deserialize correctly.
pub const KEY_FORMULA_AGGREGATE: &str = "fa";
/// Original OOXML formula metadata for import/export fidelity.
///
/// Stored as a JSON-serialized `ooxml_types::worksheet::CellFormula` on formula
/// cells. The plain formula body remains in [`KEY_FORMULA`]; this field only
/// carries OOXML attributes such as `t="array"`, `ref`, `si`, and data-table
/// flags.
pub const KEY_FORMULA_METADATA: &str = "fm";

/// CSE array-formula: CSE (`Ctrl+Shift+Enter`) array-formula range, written on
/// the anchor cell only. Stored as A1 range string (e.g. `"A1:C5"`) so it
/// survives Yrs undo/redo — runtime-only `cse_anchors` markers were lost
/// on undo, leaving the value but losing the array-formula brace.
///
/// Mirrors the OOXML `<f t="array" ref="A1:C5">` semantic. Absent on
/// non-CSE cells. Per [`feedback_yrs_keys_are_runtime`], the key name is
/// runtime-only — XLSX is the saved format, so the rename is free.
pub const KEY_ARRAY_REF: &str = "ar";

// =========================================================================
// Canonical schema initialisation
// =========================================================================

use std::sync::Arc;

use cell_types::{AxisIdentityStore, ColId, IdAllocator, RowId, SheetId};
use yrs::{Any, Array, ArrayPrelim, Doc, Map, MapPrelim, MapRef, Out, ReadTxn, Transact, WriteTxn};

use crate::hex::id_to_hex;

/// Persisted compact/dense row axis store payload.
pub type RowAxisStore = AxisIdentityStore<RowId>;

/// Persisted compact/dense column axis store payload.
pub type ColAxisStore = AxisIdentityStore<ColId>;

/// Read `schemaVersion` from the workbook root map. Returns 0 if absent (pre-legacy3).
pub fn read_schema_version<T: ReadTxn>(txn: &T, workbook: &MapRef) -> u32 {
    match workbook.get(txn, KEY_SCHEMA_VERSION) {
        Some(Out::Any(Any::BigInt(v))) => v as u32,
        _ => 0,
    }
}

/// Guard against unsupported schema versions. Returns `Ok(version)` or `Err`.
pub fn guard_schema_version<T: ReadTxn>(
    txn: &T,
    workbook: &MapRef,
) -> Result<u32, value_types::ComputeError> {
    let version = read_schema_version(txn, workbook);
    if version > MAX_SUPPORTED_SCHEMA_VERSION {
        Err(value_types::ComputeError::UnsupportedSchemaVersion {
            found: version,
            max_supported: MAX_SUPPORTED_SCHEMA_VERSION,
        })
    } else {
        Ok(version)
    }
}

/// Write current schema version to the workbook root map.
pub fn write_schema_version(txn: &mut yrs::TransactionMut<'_>, workbook: &MapRef) {
    workbook.insert(
        txn,
        KEY_SCHEMA_VERSION,
        Any::BigInt(CURRENT_SCHEMA_VERSION as i64),
    );
}

/// Read the optional persisted row-axis identity store under `gridIndex`.
///
/// Absence means callers should fall back to legacy dense `rowOrder`.
pub fn read_grid_row_axis<T: ReadTxn>(txn: &T, grid_index: &MapRef) -> Option<RowAxisStore> {
    read_axis_store(txn, grid_index, KEY_GRID_ROW_AXIS)
}

/// Read the optional persisted column-axis identity store under `gridIndex`.
///
/// Absence means callers should fall back to legacy dense `colOrder`.
pub fn read_grid_col_axis<T: ReadTxn>(txn: &T, grid_index: &MapRef) -> Option<ColAxisStore> {
    read_axis_store(txn, grid_index, KEY_GRID_COL_AXIS)
}

/// Write a persisted row-axis identity store under `gridIndex`.
pub fn write_grid_row_axis(
    txn: &mut yrs::TransactionMut<'_>,
    grid_index: &MapRef,
    store: &RowAxisStore,
) -> Result<(), serde_json::Error> {
    write_axis_store(txn, grid_index, KEY_GRID_ROW_AXIS, store)
}

/// Write a persisted column-axis identity store under `gridIndex`.
pub fn write_grid_col_axis(
    txn: &mut yrs::TransactionMut<'_>,
    grid_index: &MapRef,
    store: &ColAxisStore,
) -> Result<(), serde_json::Error> {
    write_axis_store(txn, grid_index, KEY_GRID_COL_AXIS, store)
}

fn read_axis_store<T, Id>(txn: &T, grid_index: &MapRef, key: &str) -> Option<AxisIdentityStore<Id>>
where
    T: ReadTxn,
    Id: serde::de::DeserializeOwned,
{
    let Some(Out::Any(Any::String(json))) = grid_index.get(txn, key) else {
        return None;
    };
    serde_json::from_str(&json).ok()
}

fn write_axis_store<Id>(
    txn: &mut yrs::TransactionMut<'_>,
    grid_index: &MapRef,
    key: &str,
    store: &AxisIdentityStore<Id>,
) -> Result<(), serde_json::Error>
where
    Id: serde::Serialize,
{
    let json = serde_json::to_string(store)?;
    grid_index.insert(txn, key, Any::String(Arc::from(json)));
    Ok(())
}

/// Create the full canonical Yrs schema on a [`Doc`].
///
/// For a new blank workbook this is the **single origin** for all collaborative
/// type IDs. The coordinator creates this state once; participants hydrate from
/// the coordinator so all Yrs internal type IDs are identical across peers.
///
/// Returns `(workbook MapRef, sheets MapRef, default_sheet_hex)`.
pub fn init_canonical_schema(doc: &Doc) -> (MapRef, MapRef, crate::hex::SmallHex) {
    let mut txn = doc.transact_mut();

    // ------------------------------------------------------------------
    // Root maps
    // ------------------------------------------------------------------
    let workbook: MapRef = txn.get_or_insert_map(KEY_WORKBOOK);
    let sheets: MapRef = txn.get_or_insert_map(KEY_SHEETS);
    let security: MapRef = txn.get_or_insert_map(KEY_SECURITY);

    // ------------------------------------------------------------------
    // Workbook sub-structures
    // ------------------------------------------------------------------
    let order_arr = workbook.insert(&mut txn, KEY_SHEET_ORDER, ArrayPrelim::default());

    let empty = || MapPrelim::from([] as [(&str, Any); 0]);

    workbook.insert(&mut txn, KEY_WORKBOOK_SETTINGS, empty());
    workbook.insert(&mut txn, KEY_WORKBOOK_IDENTITY, empty());
    workbook.insert(&mut txn, KEY_WORKBOOK_LINKS, empty());
    workbook.insert(&mut txn, KEY_IMPORTED_EXTERNAL_CACHE, empty());
    workbook.insert(&mut txn, KEY_IMPORTED_EXTERNAL_USAGE_PROVENANCE, empty());
    workbook.insert(&mut txn, KEY_IMPORTED_EXTERNAL_PACKAGE_ARTIFACTS, empty());
    workbook.insert(&mut txn, KEY_PACKAGE_FIDELITY_METADATA, empty());
    workbook.insert(&mut txn, KEY_NAMED_RANGES, empty());
    workbook.insert(&mut txn, KEY_TABLES, empty());
    workbook.insert(&mut txn, KEY_SLICERS, empty());
    workbook.insert(&mut txn, KEY_TIMELINES, empty());
    workbook.insert(&mut txn, KEY_POWER_QUERY, empty());
    workbook.insert(&mut txn, KEY_SCENARIOS, empty());
    workbook.insert(&mut txn, KEY_PIVOT_SPECS, empty());
    workbook.insert(&mut txn, KEY_IMPORTED_PIVOT_ASSOCIATIONS, empty());
    workbook.insert(&mut txn, KEY_PIVOT_CACHE_SOURCES, empty());
    workbook.insert(&mut txn, KEY_PIVOT_CACHE_RECORDS, empty());
    workbook.insert(&mut txn, KEY_THEME, empty());
    workbook.insert(&mut txn, KEY_EXTENDED_DOCUMENT_PROPERTIES, empty());
    workbook.insert(&mut txn, KEY_XLSX_METADATA, empty());
    workbook.insert(&mut txn, KEY_CUSTOM_CELL_STYLES, empty());

    // ------------------------------------------------------------------
    // Security sub-structures
    //
    // `policies` and `templates` are YMaps; `version` is a bare `i64`
    // counter stored directly under the security map (written on first
    // mutation by `SecurityStore::write_version`). Pre-creating the
    // counter as a map would force SecurityStore to awkwardly nest the
    // scalar under some sub-key — the counter model is "top-level i64",
    // so we leave it absent here and let the store initialize it lazily.
    // ------------------------------------------------------------------
    security.insert(&mut txn, KEY_SECURITY_POLICIES, empty());
    security.insert(&mut txn, KEY_SECURITY_TEMPLATES, empty());

    // ------------------------------------------------------------------
    // Default Sheet1
    // ------------------------------------------------------------------
    let sheet_id = SheetId::from_raw(uuid::Uuid::new_v4().as_u128());
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    // Append to sheetOrder
    order_arr.push_back(&mut txn, Any::String(Arc::from(sheet_hex.as_str())));

    // Create the per-sheet map
    let sheet_map: MapRef = sheets.insert(&mut txn, &*sheet_hex, empty());

    // Meta (name only — row/col counts derived from YArray lengths)
    let meta_prelim = MapPrelim::from([(KEY_NAME, Any::String(Arc::from("Sheet1")))]);
    let meta_map: MapRef = sheet_map.insert(&mut txn, KEY_PROPERTIES, meta_prelim);

    // Pre-create the `dataValidations` Y.Array so its CRDT id is identical
    // across all peers that fork this state. Without this, two peers each
    // calling `set_range_schema` for the first time would race on
    // `properties.insert("dataValidations", ArrayPrelim::default())` and one
    // side's ArrayRef — along with any `push_back` that referenced it — would
    // be dropped by LWW at the parent-map key.
    meta_map.insert(&mut txn, "dataValidations", ArrayPrelim::default());

    // All per-sheet structural sub-maps (empty — data populated by engines)
    sheet_map.insert(&mut txn, KEY_CELLS, empty());
    sheet_map.insert(&mut txn, KEY_CELL_PROPERTIES, empty());

    // YArray-based row/column ordering (CRDT-safe, insert_range for O(n) bulk insert)
    let id_alloc = IdAllocator::new();
    let row_order = sheet_map.insert(&mut txn, KEY_ROW_ORDER, ArrayPrelim::default());
    let row_hexes: Vec<Any> = (0..1000u32)
        .map(|_| {
            let rid = id_alloc.next_row_id();
            Any::String(Arc::from(id_to_hex(rid.as_u128()).as_str()))
        })
        .collect();
    row_order.insert_range(&mut txn, 0, row_hexes);

    let col_order = sheet_map.insert(&mut txn, KEY_COL_ORDER, ArrayPrelim::default());
    let col_hexes: Vec<Any> = (0..26u32)
        .map(|_| {
            let cid = id_alloc.next_col_id();
            Any::String(Arc::from(id_to_hex(cid.as_u128()).as_str()))
        })
        .collect();
    col_order.insert_range(&mut txn, 0, col_hexes);

    // Grid index (posToId / idToPos) — authoritative yrs-side identity store
    // post-R51. `cellGrid` / `cellPos` retired.
    let gi_map: MapRef = sheet_map.insert(&mut txn, KEY_GRID_INDEX, empty());
    gi_map.insert(&mut txn, KEY_GRID_POS_TO_ID, empty());
    gi_map.insert(&mut txn, KEY_GRID_ID_TO_POS, empty());

    sheet_map.insert(&mut txn, KEY_ROW_HEIGHTS, empty());
    sheet_map.insert(&mut txn, KEY_COL_WIDTHS, empty());
    sheet_map.insert(&mut txn, KEY_SCHEMAS, empty());
    sheet_map.insert(&mut txn, KEY_PIVOT_TABLES, empty());
    sheet_map.insert(&mut txn, KEY_MERGES, empty());
    sheet_map.insert(&mut txn, KEY_MERGE_BACKUPS, empty());
    sheet_map.insert(&mut txn, KEY_MANUAL_HIDDEN_ROWS, empty());
    sheet_map.insert(&mut txn, KEY_FILTER_HIDDEN_ROWS, empty());
    sheet_map.insert(&mut txn, KEY_HIDDEN_ROWS, empty());
    sheet_map.insert(&mut txn, KEY_HIDDEN_COLS, empty());
    sheet_map.insert(&mut txn, KEY_ROW_FORMATS, empty());
    sheet_map.insert(&mut txn, KEY_COL_FORMATS, empty());
    sheet_map.insert(&mut txn, KEY_COL_FORMAT_RANGES, empty());
    sheet_map.insert(&mut txn, KEY_COMMENTS, empty());
    sheet_map.insert(&mut txn, KEY_FILTERS, empty());
    sheet_map.insert(&mut txn, KEY_FILTER_METADATA_BINDINGS, empty());
    sheet_map.insert(&mut txn, KEY_SPARKLINES, empty());
    sheet_map.insert(&mut txn, KEY_CONDITIONAL_FORMAT, empty());
    sheet_map.insert(&mut txn, KEY_BINDINGS, empty());
    sheet_map.insert(&mut txn, KEY_GROUPING, empty());
    sheet_map.insert(&mut txn, KEY_SORTING, empty());
    sheet_map.insert(&mut txn, KEY_FLOATING_OBJECTS, empty());
    sheet_map.insert(&mut txn, KEY_FLOATING_OBJECT_ORDER, ArrayPrelim::default());
    sheet_map.insert(&mut txn, KEY_FLOATING_OBJECT_GROUPS, empty());
    sheet_map.insert(&mut txn, KEY_RANGES, empty());
    sheet_map.insert(&mut txn, KEY_RANGE_PAYLOADS, empty());
    sheet_map.insert(&mut txn, KEY_RANGE_FORMATS, empty());
    sheet_map.insert(&mut txn, KEY_RANGE_BINDINGS, empty());
    sheet_map.insert(&mut txn, KEY_CF_RULES, empty());
    sheet_map.insert(&mut txn, KEY_VALIDATION_RULES, empty());

    // Write the schema version sentinel so future readers can detect
    // whether the document was produced by a compatible binary.
    write_schema_version(&mut txn, &workbook);

    drop(txn);

    (workbook, sheets, sheet_hex)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::{AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId};
    use yrs::{Out, ReadTxn};

    #[test]
    fn schema_version_guard_absent_returns_zero() {
        let doc = Doc::new();
        let workbook = doc.get_or_insert_map("workbook");
        let txn = doc.transact();
        assert_eq!(read_schema_version(&txn, &workbook), 0);
        assert!(guard_schema_version(&txn, &workbook).is_ok());
    }

    #[test]
    fn schema_version_guard_at_max_succeeds() {
        let doc = Doc::new();
        let workbook = doc.get_or_insert_map("workbook");
        let mut txn = doc.transact_mut();
        workbook.insert(
            &mut txn,
            KEY_SCHEMA_VERSION,
            Any::BigInt(MAX_SUPPORTED_SCHEMA_VERSION as i64),
        );
        assert!(guard_schema_version(&txn, &workbook).is_ok());
    }

    #[test]
    fn schema_version_guard_above_max_fails() {
        let doc = Doc::new();
        let workbook = doc.get_or_insert_map("workbook");
        let mut txn = doc.transact_mut();
        workbook.insert(
            &mut txn,
            KEY_SCHEMA_VERSION,
            Any::BigInt((MAX_SUPPORTED_SCHEMA_VERSION + 1) as i64),
        );
        assert!(guard_schema_version(&txn, &workbook).is_err());
    }

    #[test]
    fn init_canonical_schema_writes_schema_version() {
        let doc = Doc::new();
        init_canonical_schema(&doc);
        let workbook = doc.get_or_insert_map("workbook");
        let txn = doc.transact();
        assert_eq!(read_schema_version(&txn, &workbook), CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn canonical_schema_creates_expected_structure() {
        let doc = Doc::new();
        let (_wb, _sheets, sheet_hex) = init_canonical_schema(&doc);

        let txn = doc.transact();

        // Root maps exist
        let wb: MapRef = txn.get_map(KEY_WORKBOOK).expect("workbook map");
        let sheets: MapRef = txn.get_map(KEY_SHEETS).expect("sheets map");
        let security: MapRef = txn.get_map(KEY_SECURITY).expect("security map");

        // sheetOrder has one entry
        let order = match wb.get(&txn, KEY_SHEET_ORDER) {
            Some(Out::YArray(a)) => a,
            other => panic!("expected YArray for sheetOrder, got {:?}", other),
        };
        assert_eq!(order.len(&txn), 1);
        match order.get(&txn, 0) {
            Some(Out::Any(Any::String(s))) => assert_eq!(sheet_hex, *s),
            other => panic!("expected sheet hex in sheetOrder, got {:?}", other),
        }

        // Workbook sub-maps exist
        for key in [
            KEY_WORKBOOK_SETTINGS,
            KEY_WORKBOOK_IDENTITY,
            KEY_WORKBOOK_LINKS,
            KEY_IMPORTED_EXTERNAL_CACHE,
            KEY_IMPORTED_EXTERNAL_USAGE_PROVENANCE,
            KEY_IMPORTED_EXTERNAL_PACKAGE_ARTIFACTS,
            KEY_PACKAGE_FIDELITY_METADATA,
            KEY_EXTENDED_DOCUMENT_PROPERTIES,
            KEY_XLSX_METADATA,
            KEY_NAMED_RANGES,
            KEY_TABLES,
            KEY_SLICERS,
            KEY_TIMELINES,
            KEY_POWER_QUERY,
            KEY_SCENARIOS,
            KEY_IMPORTED_PIVOT_ASSOCIATIONS,
            KEY_PIVOT_CACHE_SOURCES,
            KEY_PIVOT_CACHE_RECORDS,
        ] {
            assert!(
                matches!(wb.get(&txn, key), Some(Out::YMap(_))),
                "missing workbook sub-map: {}",
                key
            );
        }

        // Security sub-maps exist (version is intentionally absent — see
        // `init_canonical_schema` doc — SecurityStore lazily writes it as
        // a bare i64 on first mutation).
        for key in [KEY_SECURITY_POLICIES, KEY_SECURITY_TEMPLATES] {
            assert!(
                matches!(security.get(&txn, key), Some(Out::YMap(_))),
                "missing security sub-map: {}",
                key
            );
        }
        assert!(
            security.get(&txn, KEY_SECURITY_VERSION).is_none(),
            "version counter should be absent until first SecurityStore write",
        );

        // Sheet map exists with all sub-maps
        let sheet_map = match sheets.get(&txn, &*sheet_hex) {
            Some(Out::YMap(m)) => m,
            other => panic!("expected sheet map, got {:?}", other),
        };

        // Maps that should be present
        let expected_maps = [
            KEY_PROPERTIES,
            KEY_CELLS,
            KEY_CELL_PROPERTIES,
            KEY_GRID_INDEX,
            KEY_ROW_HEIGHTS,
            KEY_COL_WIDTHS,
            KEY_SCHEMAS,
            KEY_PIVOT_TABLES,
            KEY_MERGES,
            KEY_MERGE_BACKUPS,
            KEY_MANUAL_HIDDEN_ROWS,
            KEY_FILTER_HIDDEN_ROWS,
            KEY_HIDDEN_ROWS,
            KEY_HIDDEN_COLS,
            KEY_ROW_FORMATS,
            KEY_COL_FORMATS,
            KEY_COL_FORMAT_RANGES,
            KEY_COMMENTS,
            KEY_FILTERS,
            KEY_FILTER_METADATA_BINDINGS,
            KEY_SPARKLINES,
            KEY_CONDITIONAL_FORMAT,
            KEY_BINDINGS,
            KEY_GROUPING,
            KEY_SORTING,
            KEY_FLOATING_OBJECTS,
            KEY_FLOATING_OBJECT_GROUPS,
            KEY_RANGES,
            KEY_RANGE_PAYLOADS,
            KEY_RANGE_FORMATS,
            KEY_RANGE_BINDINGS,
            KEY_CF_RULES,
            KEY_VALIDATION_RULES,
        ];

        for key in expected_maps {
            assert!(
                matches!(sheet_map.get(&txn, key), Some(Out::YMap(_))),
                "missing sheet sub-map: {}",
                key
            );
        }

        // YArray-based row/column ordering
        let row_order = match sheet_map.get(&txn, KEY_ROW_ORDER) {
            Some(Out::YArray(a)) => a,
            other => panic!("expected YArray for rowOrder, got {:?}", other),
        };
        assert_eq!(row_order.len(&txn), 1000);

        let col_order = match sheet_map.get(&txn, KEY_COL_ORDER) {
            Some(Out::YArray(a)) => a,
            other => panic!("expected YArray for colOrder, got {:?}", other),
        };
        assert_eq!(col_order.len(&txn), 26);

        match sheet_map.get(&txn, KEY_FLOATING_OBJECT_ORDER) {
            Some(Out::YArray(a)) => assert_eq!(a.len(&txn), 0),
            other => panic!("expected YArray for floatingObjectOrder, got {:?}", other),
        }

        // Meta has name only (no rows/cols — derived from YArray lengths)
        let meta = match sheet_map.get(&txn, KEY_PROPERTIES) {
            Some(Out::YMap(m)) => m,
            _ => panic!("missing meta"),
        };
        assert_eq!(
            meta.get(&txn, KEY_NAME),
            Some(Out::Any(Any::String(Arc::from("Sheet1"))))
        );
        // rows/cols no longer stored in meta
        assert!(meta.get(&txn, KEY_ROWS).is_none());
        assert!(meta.get(&txn, KEY_COLS).is_none());

        let grid_index = match sheet_map.get(&txn, KEY_GRID_INDEX) {
            Some(Out::YMap(m)) => m,
            _ => panic!("missing gridIndex"),
        };
        assert!(matches!(
            grid_index.get(&txn, KEY_GRID_POS_TO_ID),
            Some(Out::YMap(_))
        ));
        assert!(matches!(
            grid_index.get(&txn, KEY_GRID_ID_TO_POS),
            Some(Out::YMap(_))
        ));
        assert!(
            grid_index.get(&txn, KEY_GRID_ROW_AXIS).is_none(),
            "rowAxis is optional; absence preserves legacy rowOrder readers",
        );
        assert!(
            grid_index.get(&txn, KEY_GRID_COL_AXIS).is_none(),
            "colAxis is optional; absence preserves legacy colOrder readers",
        );
    }

    #[test]
    fn grid_axis_store_helpers_roundtrip_compact_payloads() {
        let doc = Doc::new();
        let grid_index = doc.get_or_insert_map(KEY_GRID_INDEX);
        let row_store = AxisIdentityStore::<RowId>::from_runs([AxisIdentityRun::new(
            AxisRunId::from_raw(11),
            AxisIdentitySeed::from_raw(0xAA),
            5,
            10,
        )]);
        let col_store = AxisIdentityStore::<ColId>::from_runs([AxisIdentityRun::new(
            AxisRunId::from_raw(12),
            AxisIdentitySeed::from_raw(0xBB),
            0,
            4,
        )]);

        let mut txn = doc.transact_mut();
        write_grid_row_axis(&mut txn, &grid_index, &row_store).unwrap();
        write_grid_col_axis(&mut txn, &grid_index, &col_store).unwrap();
        drop(txn);

        let txn = doc.transact();
        assert_eq!(read_grid_row_axis(&txn, &grid_index), Some(row_store));
        assert_eq!(read_grid_col_axis(&txn, &grid_index), Some(col_store));
    }
}
