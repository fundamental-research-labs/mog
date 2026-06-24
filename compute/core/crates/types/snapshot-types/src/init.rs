//! Initialization snapshot types for IPC workbook loading.
//!
//! Two serialization paths, chosen by the caller at the IPC boundary:
//! - **JSON path** ([`WorkbookSnapshot`]): String UUIDs, parsed at boundary via `uuid::Uuid`.
//!   Used by Tauri commands (default).
//! - **Bincode path** ([`WorkbookSnapshotBin`]): Raw u128 IDs directly, no UUID string
//!   parsing overhead. Used for large workbooks where UUID parsing is measurable.

use serde::{Deserialize, Serialize};

use cell_types::{
    AxisIdentityRef, AxisIdentityRun, AxisIdentityRunRef, ColId, PayloadEncoding, RangeAnchor,
    RangeId, RangeKind, RowId,
};
use domain_types::domain::pivot::PivotTableStyle;
use formula_types::{CellRef, NamedRangeDef, TableDef};
use value_types::{CellValue, FiniteF64};

/// Lightweight pivot table definition for GETPIVOTDATA lookup.
///
/// Contains structural metadata to locate values in rendered pivot cells.
/// The pivot compute engine produces the cells; GETPIVOTDATA reads them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableDef {
    /// Stable pivot table ID. Display names are user-editable and not unique.
    #[serde(default)]
    pub id: String,
    /// Display name of the pivot table.
    pub name: String,
    /// Sheet ID as UUID string (JSON path).
    pub sheet: String,
    /// 0-based start row of the pivot table range.
    pub start_row: u32,
    /// 0-based start column of the pivot table range.
    pub start_col: u32,
    /// 0-based end row (inclusive) of the pivot table range.
    pub end_row: u32,
    /// 0-based end column (inclusive) of the pivot table range.
    pub end_col: u32,
    /// Rendered row count. `None` means legacy data should derive from bounds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rendered_rows: Option<u32>,
    /// Rendered column count. `None` means legacy data should derive from bounds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rendered_cols: Option<u32>,
    /// Row offset from start_row to the first data row.
    pub first_data_row: u32,
    /// Column offset from start_col to the first data column.
    pub first_data_col: u32,
    /// Data field display names, e.g. `["Sum of FMV", "Sum of Capital Invested"]`.
    pub data_field_names: Vec<String>,
    /// Cache field names (all source columns), e.g. `["Company Name", "FMV", ...]`.
    pub cache_field_names: Vec<String>,
    /// Indices into `cache_field_names` for row-axis fields.
    pub row_field_indices: Vec<u32>,
    /// Indices into `cache_field_names` for column-axis fields.
    pub col_field_indices: Vec<u32>,
    /// Whether data fields are arranged on rows (true) vs columns (false).
    #[serde(default)]
    pub data_on_rows: bool,
    /// Imported/native pivot style options used for display formatting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<PivotTableStyle>,
    /// Whether row grand totals are rendered and styled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_row_grand_totals: Option<bool>,
    /// Whether column grand totals are rendered and styled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_column_grand_totals: Option<bool>,
}

impl PivotTableDef {
    pub fn same_identity(&self, other: &Self) -> bool {
        self.sheet == other.sheet
            && if !self.id.is_empty() && !other.id.is_empty() {
                self.id == other.id
            } else {
                self.name == other.name
            }
    }

    pub fn matches_identity(&self, pivot_id: &str, fallback_name: &str, sheet_uuid: &str) -> bool {
        self.sheet == sheet_uuid
            && if !pivot_id.is_empty() && !self.id.is_empty() {
                self.id == pivot_id
            } else {
                self.name == fallback_name
            }
    }

    pub fn rendered_row_count(&self) -> u32 {
        self.rendered_rows.unwrap_or_else(|| {
            self.end_row
                .checked_sub(self.start_row)
                .map_or(0, |delta| delta.saturating_add(1))
        })
    }

    pub fn rendered_col_count(&self) -> u32 {
        self.rendered_cols.unwrap_or_else(|| {
            self.end_col
                .checked_sub(self.start_col)
                .map_or(0, |delta| delta.saturating_add(1))
        })
    }

    pub fn is_empty_rendered_region(&self) -> bool {
        self.rendered_row_count() == 0 || self.rendered_col_count() == 0
    }
}

/// Data table region definition for TABLE formula evaluation.
///
/// Contains the region bounds and input cell references from the XLSX
/// `<f t="dataTable">` element attributes (r1, r2).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTableOoxmlFlags {
    /// Authored `<f t="dataTable" r1="...">` attribute spelling, preserved for
    /// file round-trip. The typed `col_input_ref` remains the behavioral source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r1: Option<String>,
    /// Authored `<f t="dataTable" r2="...">` attribute spelling, preserved for
    /// file round-trip. The typed `row_input_ref` remains the behavioral source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r2: Option<String>,
    /// `<f t="dataTable" aca="1">`: always calculate array/data-table formula.
    #[serde(default)]
    pub aca: bool,
    /// `<f t="dataTable" ca="1">`: calculate this formula.
    #[serde(default)]
    pub ca: bool,
    /// `<f t="dataTable" bx="1">`: OOXML data-table input mode flag.
    #[serde(default)]
    pub bx: bool,
    /// `<f t="dataTable" dt2D="1">`: two-variable data table flag.
    #[serde(default)]
    pub dt2d: bool,
    /// `<f t="dataTable" dtr="1">`: data table uses row/column references.
    #[serde(default)]
    pub dtr: bool,
    /// `<f t="dataTable" del1="1">`: delete first input row flag.
    #[serde(default)]
    pub del1: bool,
    /// `<f t="dataTable" del2="1">`: delete second input row flag.
    #[serde(default)]
    pub del2: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTableRegionDef {
    /// Sheet ID as UUID string.
    pub sheet: String,
    /// 0-based top-left row of the data table region.
    pub start_row: u32,
    /// 0-based top-left column of the data table region.
    pub start_col: u32,
    /// 0-based bottom-right row (inclusive) of the data table region.
    pub end_row: u32,
    /// 0-based bottom-right column (inclusive) of the data table region.
    pub end_col: u32,
    /// Input cell that receives left-column header values (one per body row).
    /// For XLSX imports, normalized from Excel's r2 attribute.
    /// For API-entered TABLE formulas, this is args[0].
    ///
    /// Retyped from `Option<String>` to `Option<CellRef>`. The typed form drops
    /// abs-marker bytes (`$`) per the Cell Identity Model: a `CellRef`
    /// describes *what* is referenced, not *how it was written*.
    pub row_input_ref: Option<CellRef>,
    /// Input cell that receives top-row header values (one per body column).
    /// For XLSX imports, normalized from Excel's r1 attribute.
    /// For API-entered TABLE formulas, this is args[1].
    ///
    /// See `row_input_ref` for the typing rationale.
    pub col_input_ref: Option<CellRef>,
    /// OOXML `<f t="dataTable">` flags that are not yet product behavior but
    /// are durable file-IO metadata. Absence means normalized OOXML defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ooxml_flags: Option<DataTableOoxmlFlags>,
}

/// Default max iterations for iterative calculation (matches Excel default).
pub(super) fn default_max_iterations() -> u32 {
    100
}

/// Default max change (delta) for iterative calculation convergence (matches Excel default).
pub(super) fn default_max_change() -> FiniteF64 {
    FiniteF64::must(0.001)
}

/// Snapshot schema version used by current dense identity snapshots.
pub const WORKBOOK_SNAPSHOT_SCHEMA_VERSION_DENSE_IDENTITY: u32 = 1;

/// First snapshot schema version that may contain compact axis identity metadata.
pub const WORKBOOK_SNAPSHOT_SCHEMA_VERSION_COMPACT_AXIS_IDENTITY: u32 = 2;

/// Highest workbook snapshot schema version understood by this crate.
pub const WORKBOOK_SNAPSHOT_SCHEMA_VERSION_CURRENT: u32 =
    WORKBOOK_SNAPSHOT_SCHEMA_VERSION_COMPACT_AXIS_IDENTITY;

/// Snapshot contract for a row-axis identity reference.
pub type RowAxisIdentityRef = AxisIdentityRef<RowId>;

/// Snapshot contract for a column-axis identity reference.
pub type ColAxisIdentityRef = AxisIdentityRef<ColId>;

/// Bincode snapshot contract for a row-axis identity reference.
pub type RowAxisIdentityRefBin = AxisIdentityRef<u128>;

/// Bincode snapshot contract for a column-axis identity reference.
pub type ColAxisIdentityRefBin = AxisIdentityRef<u128>;

/// Snapshot contract for one compact axis run.
pub type SnapshotAxisIdentityRun = AxisIdentityRun;

/// Snapshot contract for one compact axis run span reference.
pub type SnapshotAxisIdentityRunRef = AxisIdentityRunRef;

// === JSON path (Tauri command default) ===

/// Full workbook snapshot for init (JSON path — string IDs).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSnapshot {
    /// All sheets in the workbook.
    pub sheets: Vec<SheetSnapshot>,
    /// Workbook-level named ranges.
    #[serde(default)]
    pub named_ranges: Vec<NamedRangeDef>,
    /// Table definitions.
    #[serde(default)]
    pub tables: Vec<TableDef>,
    /// Pivot table definitions for GETPIVOTDATA lookup.
    #[serde(default)]
    pub pivot_tables: Vec<PivotTableDef>,
    /// Data table region definitions for TABLE formula evaluation.
    #[serde(default)]
    pub data_table_regions: Vec<DataTableRegionDef>,
    /// Whether iterative calculation is enabled (Excel `<calcPr iterate="1"/>`).
    #[serde(default)]
    pub iterative_calc: bool,
    /// Maximum number of iterations for iterative calculation (default 100).
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
    /// Maximum change (delta) threshold for convergence (default 0.001).
    #[serde(default = "default_max_change")]
    pub max_change: FiniteF64,
    /// Full calculation settings (enriched from XLSX CalcPr).
    /// When present, this takes precedence over the flat `iterative_calc`/`max_iterations`/`max_change` fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculation_settings: Option<super::settings::CalculationSettings>,
}

impl Default for WorkbookSnapshot {
    fn default() -> Self {
        Self {
            sheets: vec![],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: default_max_iterations(),
            max_change: default_max_change(),
            calculation_settings: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RangeData {
    pub range_id: RangeId,
    pub kind: RangeKind,
    pub anchor: RangeAnchor,
    pub encoding: PayloadEncoding,
    #[serde(with = "serde_bytes")]
    pub payload: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_axis: Option<RowAxisIdentityRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col_axis: Option<ColAxisIdentityRef>,
    pub row_ids: Vec<RowId>,
    pub col_ids: Vec<ColId>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RangeDataBin {
    pub range_id: u128,
    pub kind: RangeKind,
    pub anchor: RangeAnchor,
    pub encoding: PayloadEncoding,
    #[serde(with = "serde_bytes")]
    pub payload: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_axis: Option<RowAxisIdentityRefBin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col_axis: Option<ColAxisIdentityRefBin>,
    pub row_ids: Vec<u128>,
    pub col_ids: Vec<u128>,
}

/// Single sheet snapshot (JSON path).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetSnapshot {
    /// Sheet ID as UUID string.
    pub id: String,
    /// Display name of the sheet.
    pub name: String,
    /// Total number of rows.
    pub rows: u32,
    /// Total number of columns.
    pub cols: u32,
    /// Sparse cell data (only non-empty cells).
    pub cells: Vec<CellData>,
    #[serde(default)]
    pub ranges: Vec<RangeData>,
}

/// Single cell data for init/sync (JSON path).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellData {
    /// Cell ID as UUID string (stable identity).
    pub cell_id: String,
    /// Zero-based row index.
    pub row: u32,
    /// Zero-based column index.
    pub col: u32,
    /// Cell value.
    pub value: CellValue,
    /// Legacy A1-style formula text. Kept for backward compatibility.
    /// When `identity_formula` is present, it takes precedence.
    #[serde(default)]
    pub formula: Option<String>,
    /// Identity-based formula (new format). Takes precedence over `formula` when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_formula: Option<formula_types::IdentityFormula>,
    /// For dynamic array source cells, the spill range from XLSX `<f t="array" ref="...">`.
    /// Format: `"A1:C5"` (A1-style range). Used to pre-register projections during snapshot
    /// loading so that projection-aware dep extraction works from the very first recalc.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub array_ref: Option<String>,
}

impl CellData {
    /// Get the identity formula if present, ignoring the legacy formula string.
    #[must_use]
    pub fn effective_identity_formula(&self) -> Option<&formula_types::IdentityFormula> {
        self.identity_formula.as_ref()
    }

    /// Returns true if this cell has any formula (identity or legacy).
    #[must_use]
    pub fn has_formula(&self) -> bool {
        self.identity_formula.is_some() || self.formula.is_some()
    }
}

// === Bincode path (for large workbooks) ===

/// Full workbook snapshot for init (bincode path — u128 IDs directly).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSnapshotBin {
    /// All sheets in the workbook.
    pub sheets: Vec<SheetSnapshotBin>,
    /// Workbook-level named ranges.
    #[serde(default)]
    pub named_ranges: Vec<NamedRangeDef>,
    /// Table definitions.
    #[serde(default)]
    pub tables: Vec<TableDef>,
    /// Pivot table definitions for GETPIVOTDATA lookup.
    #[serde(default)]
    pub pivot_tables: Vec<PivotTableDef>,
    /// Data table region definitions for TABLE formula evaluation.
    #[serde(default)]
    pub data_table_regions: Vec<DataTableRegionDef>,
    /// Whether iterative calculation is enabled (Excel `<calcPr iterate="1"/>`).
    #[serde(default)]
    pub iterative_calc: bool,
    /// Maximum number of iterations for iterative calculation (default 100).
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
    /// Maximum change (delta) threshold for convergence (default 0.001).
    #[serde(default = "default_max_change")]
    pub max_change: FiniteF64,
    /// Full calculation settings (enriched from XLSX CalcPr).
    /// When present, this takes precedence over the flat `iterative_calc`/`max_iterations`/`max_change` fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculation_settings: Option<super::settings::CalculationSettings>,
}

impl Default for WorkbookSnapshotBin {
    fn default() -> Self {
        Self {
            sheets: vec![],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: default_max_iterations(),
            max_change: default_max_change(),
            calculation_settings: None,
        }
    }
}

/// Single sheet snapshot (bincode path).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetSnapshotBin {
    /// Sheet ID as raw u128.
    pub id: u128,
    /// Display name of the sheet.
    pub name: String,
    /// Total number of rows.
    pub rows: u32,
    /// Total number of columns.
    pub cols: u32,
    /// Sparse cell data (only non-empty cells).
    pub cells: Vec<CellDataBin>,
    #[serde(default)]
    pub ranges: Vec<RangeDataBin>,
}

/// Single cell data (bincode path — pre-converted u128 IDs).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellDataBin {
    /// Cell ID as raw u128.
    pub cell_id: u128,
    /// Zero-based row index.
    pub row: u32,
    /// Zero-based column index.
    pub col: u32,
    /// Cell value.
    pub value: CellValue,
    /// Formula text if this cell contains a formula.
    #[serde(default)]
    pub formula: Option<String>,
    /// Identity-based formula (new format). Takes precedence over `formula` when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_formula: Option<formula_types::IdentityFormula>,
    /// For dynamic array source cells, the spill range from XLSX `<f t="array" ref="...">`.
    /// Format: `"A1:C5"` (A1-style range). Used to pre-register projections during snapshot
    /// loading so that projection-aware dep extraction works from the very first recalc.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub array_ref: Option<String>,
}

impl CellDataBin {
    /// Get the identity formula if present.
    #[must_use]
    pub fn effective_identity_formula(&self) -> Option<&formula_types::IdentityFormula> {
        self.identity_formula.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workbook_snapshot_serde_defaults() {
        let json = r#"{"sheets":[]}"#;
        let ws: WorkbookSnapshot = serde_json::from_str(json).unwrap();
        assert!(ws.sheets.is_empty());
        assert!(ws.named_ranges.is_empty());
        assert!(ws.tables.is_empty());
        assert!(ws.pivot_tables.is_empty());
        assert!(!ws.iterative_calc);
        assert_eq!(ws.max_iterations, 100);
        assert!((ws.max_change.get() - 0.001).abs() < f64::EPSILON);
    }

    #[test]
    fn workbook_snapshot_serde_roundtrip() {
        let ws = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "abc-123".into(),
                name: "Sheet1".into(),
                rows: 100,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: FiniteF64::must(0.001),
            calculation_settings: None,
        };
        let json = serde_json::to_string(&ws).unwrap();
        let ws2: WorkbookSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(ws2.sheets.len(), 1);
        assert_eq!(ws2.sheets[0].name, "Sheet1");
        assert_eq!(ws2.max_iterations, 100);
    }

    #[test]
    fn compact_axis_snapshot_contracts_are_exported_and_serializable() {
        assert_eq!(WORKBOOK_SNAPSHOT_SCHEMA_VERSION_DENSE_IDENTITY, 1);
        assert_eq!(WORKBOOK_SNAPSHOT_SCHEMA_VERSION_COMPACT_AXIS_IDENTITY, 2);
        assert_eq!(
            WORKBOOK_SNAPSHOT_SCHEMA_VERSION_CURRENT,
            WORKBOOK_SNAPSHOT_SCHEMA_VERSION_COMPACT_AXIS_IDENTITY
        );

        let row_axis: RowAxisIdentityRef = AxisIdentityRef::StoreRun {
            run_id: cell_types::AxisRunId::from_raw(7),
            start_offset: 10,
            len: 3,
        };
        let col_axis: ColAxisIdentityRef =
            AxisIdentityRef::Explicit(vec![ColId::from_raw(1), ColId::from_raw(2)]);

        let row_json = serde_json::to_string(&row_axis).unwrap();
        let col_json = serde_json::to_string(&col_axis).unwrap();
        assert!(row_json.contains("StoreRun"));
        assert!(row_json.contains("startOffset"));
        assert!(col_json.contains("Explicit"));
        assert_eq!(row_axis.len(), 3);
        assert_eq!(col_axis.len(), 2);
    }

    #[test]
    fn range_data_with_compact_axis_still_serializes_dense_id_vectors() {
        let range = RangeData {
            range_id: RangeId::from_raw(42),
            kind: RangeKind::Data,
            anchor: RangeAnchor::Strict {
                row_ids: vec![RowId::from_raw(1), RowId::from_raw(2)],
                col_ids: vec![ColId::from_raw(3)],
            },
            encoding: PayloadEncoding::F64Le,
            payload: vec![0, 1, 2, 3],
            row_axis: Some(AxisIdentityRef::StoreRun {
                run_id: cell_types::AxisRunId::from_raw(7),
                start_offset: 0,
                len: 2,
            }),
            col_axis: Some(AxisIdentityRef::Explicit(vec![ColId::from_raw(3)])),
            row_ids: vec![RowId::from_raw(1), RowId::from_raw(2)],
            col_ids: vec![ColId::from_raw(3)],
        };

        let json = serde_json::to_value(&range).unwrap();
        assert!(json.get("row_axis").is_some());
        assert!(json.get("col_axis").is_some());
        assert_eq!(json["row_ids"].as_array().unwrap().len(), 2);
        assert_eq!(json["col_ids"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn range_data_rejects_unknown_compact_axis_variant() {
        let json = r#"{
            "range_id":"0000000000000000000000000000002a",
            "kind":"Data",
            "anchor":{"Strict":{"rowIds":[],"colIds":[]}},
            "encoding":"F64Le",
            "payload":[],
            "row_axis":{"CompactOnly":{"runId":7,"startOffset":0,"len":2}},
            "row_ids":[],
            "col_ids":[]
        }"#;

        let err = serde_json::from_str::<RangeData>(json).unwrap_err();
        assert!(err.to_string().contains("unknown variant"));
    }

    #[test]
    fn range_data_rejects_malformed_store_run_axis() {
        let json = r#"{
            "range_id":"0000000000000000000000000000002a",
            "kind":"Data",
            "anchor":{"Strict":{"rowIds":[],"colIds":[]}},
            "encoding":"F64Le",
            "payload":[],
            "row_axis":{"StoreRun":{"runId":7,"startOffset":0}},
            "row_ids":[],
            "col_ids":[]
        }"#;

        let err = serde_json::from_str::<RangeData>(json).unwrap_err();
        assert!(err.to_string().contains("missing field"));
    }

    #[test]
    fn pivot_table_def_serde_roundtrip() {
        let ptd = PivotTableDef {
            id: "pivot-1".into(),
            name: "PivotTable1".into(),
            sheet: "abc-123".into(),
            start_row: 2,
            start_col: 19,
            end_row: 22,
            end_col: 24,
            rendered_rows: Some(21),
            rendered_cols: Some(6),
            first_data_row: 1,
            first_data_col: 1,
            data_field_names: vec!["Sum of FMV".into(), "Sum of Capital".into()],
            cache_field_names: vec!["Company".into(), "FMV".into(), "Capital".into()],
            row_field_indices: vec![0],
            col_field_indices: vec![],
            data_on_rows: false,
            style: None,
            show_row_grand_totals: None,
            show_column_grand_totals: None,
        };
        let json = serde_json::to_string(&ptd).unwrap();
        let ptd2: PivotTableDef = serde_json::from_str(&json).unwrap();
        assert_eq!(ptd2.id, "pivot-1");
        assert_eq!(ptd2.name, "PivotTable1");
        assert_eq!(ptd2.data_field_names.len(), 2);
        assert_eq!(ptd2.rendered_row_count(), 21);
        assert_eq!(ptd2.rendered_col_count(), 6);
        assert_eq!(ptd2.cache_field_names.len(), 3);
        assert_eq!(ptd2.row_field_indices, vec![0]);
        assert!(!ptd2.data_on_rows);
        // Verify camelCase serialization
        assert!(json.contains("\"startRow\""));
        assert!(json.contains("\"firstDataRow\""));
        assert!(json.contains("\"dataFieldNames\""));
        assert!(json.contains("\"dataOnRows\""));
    }

    #[test]
    fn pivot_table_def_data_on_rows_default() {
        // data_on_rows should default to false when missing from JSON
        let json = r#"{"name":"PT1","sheet":"s1","startRow":0,"startCol":0,"endRow":10,"endCol":5,"firstDataRow":1,"firstDataCol":1,"dataFieldNames":[],"cacheFieldNames":[],"rowFieldIndices":[],"colFieldIndices":[]}"#;
        let ptd: PivotTableDef = serde_json::from_str(json).unwrap();
        assert!(!ptd.data_on_rows);
    }

    #[test]
    fn cell_data_serde_roundtrip() {
        let cd = CellData {
            cell_id: "cell-1".into(),
            row: 0,
            col: 0,
            value: CellValue::number(42.0),
            formula: Some("=1+1".into()),
            identity_formula: None,
            array_ref: None,
        };
        let json = serde_json::to_string(&cd).unwrap();
        let cd2: CellData = serde_json::from_str(&json).unwrap();
        assert_eq!(cd2.cell_id, "cell-1");
        assert_eq!(cd2.row, 0);
        assert_eq!(cd2.value, CellValue::number(42.0));
        assert_eq!(cd2.formula, Some("=1+1".into()));
    }

    #[test]
    fn cell_data_no_formula() {
        let cd = CellData {
            cell_id: "cell-2".into(),
            row: 1,
            col: 2,
            value: CellValue::Text("hello".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        };
        let json = serde_json::to_string(&cd).unwrap();
        let cd2: CellData = serde_json::from_str(&json).unwrap();
        assert_eq!(cd2.formula, None);
    }

    // === Identity formula integration tests ===

    /// Helper to create a sample IdentityFormula for testing.
    fn sample_identity_formula() -> formula_types::IdentityFormula {
        crate::test_helpers::sample_identity_formula()
    }

    #[test]
    fn cell_data_with_identity_formula_serde_roundtrip() {
        let cd = CellData {
            cell_id: "cell-if".into(),
            row: 0,
            col: 0,
            value: CellValue::number(100.0),
            formula: Some("=SUM(A1)".into()),
            identity_formula: Some(sample_identity_formula()),
            array_ref: None,
        };
        let json = serde_json::to_string(&cd).unwrap();
        let cd2: CellData = serde_json::from_str(&json).unwrap();
        assert_eq!(cd2.cell_id, "cell-if");
        assert_eq!(cd2.identity_formula, Some(sample_identity_formula()));
        assert_eq!(cd2.formula, Some("=SUM(A1)".into()));
    }

    #[test]
    fn cell_data_backward_compat_no_identity_formula() {
        // Serialize a CellData without identity_formula, then verify it deserializes correctly.
        let cd_orig = CellData {
            cell_id: "cell-bc".into(),
            row: 0,
            col: 0,
            value: CellValue::number(42.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        };
        let json = serde_json::to_string(&cd_orig).unwrap();
        // The JSON should NOT contain identity_formula (skip_serializing_if)
        assert!(!json.contains("identityFormula"));
        // Deserializing it back should default identity_formula to None.
        let cd: CellData = serde_json::from_str(&json).unwrap();
        assert_eq!(cd.cell_id, "cell-bc");
        assert_eq!(cd.identity_formula, None);
        assert_eq!(cd.formula, None);
    }

    #[test]
    fn effective_identity_formula_present() {
        let cd = CellData {
            cell_id: "c".into(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: Some(sample_identity_formula()),
            array_ref: None,
        };
        assert!(cd.effective_identity_formula().is_some());
        assert_eq!(
            cd.effective_identity_formula().unwrap().template,
            "SUM({0})"
        );
    }

    #[test]
    fn effective_identity_formula_absent() {
        let cd = CellData {
            cell_id: "c".into(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        };
        assert!(cd.effective_identity_formula().is_none());
    }

    #[test]
    fn has_formula_identity_only() {
        let cd = CellData {
            cell_id: "c".into(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: Some(sample_identity_formula()),
            array_ref: None,
        };
        assert!(cd.has_formula());
    }

    #[test]
    fn has_formula_legacy_only() {
        let cd = CellData {
            cell_id: "c".into(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: Some("=1".into()),
            identity_formula: None,
            array_ref: None,
        };
        assert!(cd.has_formula());
    }

    #[test]
    fn has_formula_neither() {
        let cd = CellData {
            cell_id: "c".into(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        };
        assert!(!cd.has_formula());
    }

    #[test]
    fn cell_data_bin_with_identity_formula_serde_roundtrip() {
        let cdb = CellDataBin {
            cell_id: 999,
            row: 3,
            col: 4,
            value: CellValue::number(77.0),
            formula: None,
            identity_formula: Some(sample_identity_formula()),
            array_ref: None,
        };
        let json = serde_json::to_string(&cdb).unwrap();
        let cdb2: CellDataBin = serde_json::from_str(&json).unwrap();
        assert_eq!(cdb2.identity_formula, Some(sample_identity_formula()));
        assert_eq!(cdb2.cell_id, 999);
    }

    #[test]
    fn identity_formula_skipped_in_json_when_none() {
        let cd = CellData {
            cell_id: "c".into(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        };
        let json = serde_json::to_string(&cd).unwrap();
        assert!(
            !json.contains("identityFormula"),
            "identity_formula should be skipped when None, got: {}",
            json
        );
    }

    #[test]
    fn cell_data_bin_effective_identity_formula() {
        let cdb = CellDataBin {
            cell_id: 1,
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: Some(sample_identity_formula()),
            array_ref: None,
        };
        assert!(cdb.effective_identity_formula().is_some());

        let cdb2 = CellDataBin {
            cell_id: 1,
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        };
        assert!(cdb2.effective_identity_formula().is_none());
    }
}
