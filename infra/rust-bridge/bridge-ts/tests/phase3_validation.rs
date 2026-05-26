//! Early validation against real codebase patterns.
//!
//! This test file mimics the actual compute-core API signatures to validate
//! that bridge-ts correctly handles all real-world patterns before we
//! annotate the production code.

use bridge_ts::{generate_from_source, merge_blocks, parse_source};

/// Source code mimicking the real compute engine API patterns.
const COMPUTE_ENGINE_SOURCE: &str = r#"
use bridge_core as bridge;
use serde::{Serialize, Deserialize};

// Types that mirror the real codebase
#[derive(Serialize, Deserialize)]
pub struct WorkbookSnapshot { /* ... */ }

#[derive(Serialize, Deserialize)]
pub struct RecalcResult { /* ... */ }

#[derive(Serialize, Deserialize)]
pub struct CellEdit { /* ... */ }

#[derive(Serialize, Deserialize)]
pub struct StructureChange { /* ... */ }

#[derive(Serialize, Deserialize)]
pub struct SheetSnapshot { /* ... */ }

#[derive(Serialize, Deserialize)]
pub struct MutationResult { /* ... */ }

#[derive(Serialize, Deserialize)]
pub struct ViewportData { /* ... */ }

pub struct SheetId;
pub struct CellId;

pub enum ComputeError {
    NotFound(String),
    ParseError(String),
}

impl std::fmt::Display for ComputeError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "ComputeError")
    }
}

// ---------------------------------------------------------------------------
// Mode 2: Stateful compute engine
// ---------------------------------------------------------------------------

#[bridge::service]
pub struct ComputeEngine {
    // internal state
}

// Group: lifecycle + core mutations
#[bridge::api(service = "ComputeEngine", key = "doc_id", group = "core")]
impl ComputeEngine {
    /// Create engine from workbook snapshot. Returns initial RecalcResult.
    #[bridge::lifecycle(create)]
    pub fn from_snapshot(snapshot: WorkbookSnapshot) -> Result<Self, ComputeError> {
        todo!()
    }

    /// Set a single cell's value or formula.
    /// Tests: many params, parse params for SheetId/CellId, primitive params.
    #[bridge::write]
    pub fn set_cell(
        &mut self,
        #[bridge::parse] sheet_id: &SheetId,
        #[bridge::parse] cell_id: &CellId,
        row: u32,
        col: u32,
        input: &str,
    ) -> Result<RecalcResult, ComputeError> {
        todo!()
    }

    /// Set multiple cells at once.
    /// Tests: serde Vec param.
    #[bridge::write]
    pub fn set_cells(&mut self, edits: Vec<CellEdit>) -> Result<RecalcResult, ComputeError> {
        todo!()
    }

    /// Clear cells.
    /// Tests: Vec<String> param.
    #[bridge::write]
    pub fn clear_cells(&mut self, cell_ids: Vec<String>) -> Result<RecalcResult, ComputeError> {
        todo!()
    }

    /// Structural change (insert/delete rows/cols).
    /// Tests: parse param + serde param.
    #[bridge::write]
    pub fn structure_change(
        &mut self,
        #[bridge::parse] sheet_id: &SheetId,
        change: StructureChange,
    ) -> Result<RecalcResult, ComputeError> {
        todo!()
    }

    /// Relocate cells.
    /// Tests: 8+ parameters (the edge case from our plan).
    #[bridge::write]
    pub fn relocate_cells(
        &mut self,
        #[bridge::parse] sheet_id: &SheetId,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_row: u32,
        target_col: u32,
    ) -> Result<RecalcResult, ComputeError> {
        todo!()
    }

    /// Insert cells with shift direction flag.
    /// Tests: boolean param.
    #[bridge::write]
    pub fn insert_cells_with_shift(
        &mut self,
        #[bridge::parse] sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_right: bool,
    ) -> Result<RecalcResult, ComputeError> {
        todo!()
    }
}

// Group: read-only queries
#[bridge::api(service = "ComputeEngine", key = "doc_id", group = "queries")]
impl ComputeEngine {
    /// Get viewport data for rendering.
    /// Tests: many params, read access.
    #[bridge::read]
    pub fn query_range(
        &self,
        #[bridge::parse] sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<ViewportData, ComputeError> {
        todo!()
    }

    /// Add a sheet (no recalc needed).
    /// Tests: unit return from write-like operation.
    #[bridge::write]
    pub fn add_sheet(&mut self, snapshot: SheetSnapshot) -> Result<(), ComputeError> {
        todo!()
    }
}

// ---------------------------------------------------------------------------
// Mode 1: Pure computation functions (no engine state)
// ---------------------------------------------------------------------------

pub struct PivotEngine;

#[bridge::api]
impl PivotEngine {
    /// Compute a pivot table from config and data.
    /// Tests: multiple serde params, named return type.
    #[bridge::pure]
    pub fn compute(config: PivotConfig, data: Vec<Vec<CellValue>>) -> Result<PivotResult, PivotError> {
        todo!()
    }

    /// Detect pivot fields from column data.
    /// Tests: serde param, serde return.
    #[bridge::pure]
    pub fn detect_fields(data: Vec<Vec<CellValue>>) -> Vec<PivotField> {
        todo!()
    }
}

pub struct TableEngine;

#[bridge::api]
impl TableEngine {
    /// Evaluate a column filter.
    /// Tests: multiple serde params.
    #[bridge::pure]
    pub fn evaluate_column_filter(criteria: FilterCriteria, column_data: Vec<CellValue>) -> Vec<bool> {
        todo!()
    }

    /// Compute sort order.
    /// Tests: serde + primitive params.
    #[bridge::pure]
    pub fn compute_sort_order(specs: Vec<SortSpec>, data: Vec<Vec<CellValue>>, total_rows: u32) -> Vec<u32> {
        todo!()
    }
}

// Placeholder types
pub struct PivotConfig;
pub struct CellValue;
pub struct PivotResult;
pub struct PivotError;
pub struct PivotField;
pub struct FilterCriteria;
pub struct SortSpec;

impl std::fmt::Display for PivotError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "PivotError")
    }
}
"#;

#[test]
fn parse_compute_engine_source() {
    let blocks = parse_source(COMPUTE_ENGINE_SOURCE).unwrap();
    // Should find 4 impl blocks:
    // 1. ComputeEngine core group (lifecycle + mutations)
    // 2. ComputeEngine queries group
    // 3. PivotEngine (stateless)
    // 4. TableEngine (stateless)
    assert_eq!(blocks.len(), 4, "Expected 4 impl blocks");
}

#[test]
fn compute_engine_merged_has_all_methods() {
    let blocks = parse_source(COMPUTE_ENGINE_SOURCE).unwrap();
    let api = merge_blocks(blocks);

    // 3 services: ComputeEngine, PivotEngine, TableEngine
    assert_eq!(api.services.len(), 3);

    // Find ComputeEngine
    let ce = api
        .services
        .iter()
        .find(|s| s.rust_name == "ComputeEngine")
        .unwrap();
    assert!(ce.key.is_some());
    assert_eq!(ce.key.as_ref().unwrap().param_name, "doc_id");
    // 7 from core + 2 from queries = 9
    assert_eq!(ce.methods.len(), 9, "ComputeEngine should have 9 methods");
}

#[test]
fn generate_ts_for_compute_engine() {
    let ts = generate_from_source(COMPUTE_ENGINE_SOURCE).unwrap();

    // --- ComputeEngine ---
    assert!(ts.contains("export function createComputeEngineClient(transport: BridgeTransport)"));
    assert!(ts.contains("export interface ComputeEngineClient"));

    // Lifecycle create
    assert!(ts.contains("fromSnapshot(docId: string, snapshot: WorkbookSnapshot): Promise<void>"));
    assert!(ts.contains("'compute_engine_from_snapshot'"));

    // Write method with parse params + primitives (set_cell: 5 params + key)
    assert!(ts.contains("setCell(docId: string, sheetId: string, cellId: string, row: number, col: number, input: string): Promise<RecalcResult>"));
    assert!(ts.contains("'compute_engine_set_cell'"));

    // Write method with serde vec param
    assert!(ts.contains("setCells(docId: string, edits: CellEdit[]): Promise<RecalcResult>"));

    // Write method with Vec<String>
    assert!(ts.contains("clearCells(docId: string, cellIds: string[]): Promise<RecalcResult>"));

    // 8+ params (relocate_cells: 7 params + key = 8)
    assert!(ts.contains("relocateCells(docId: string, sheetId: string, srcStartRow: number, srcStartCol: number, srcEndRow: number, srcEndCol: number, targetRow: number, targetCol: number): Promise<RecalcResult>"));

    // Boolean param
    assert!(ts.contains("insertCellsWithShift(docId: string, sheetId: string, row: number, col: number, rowCount: number, colCount: number, shiftRight: boolean): Promise<RecalcResult>"));

    // Read method
    assert!(ts.contains("queryRange(docId: string, sheetId: string, startRow: number, startCol: number, endRow: number, endCol: number): Promise<ViewportData>"));

    // Write returning void
    assert!(ts.contains("addSheet(docId: string, snapshot: SheetSnapshot): Promise<void>"));

    // Auto-generated destroy
    assert!(ts.contains("destroy(docId: string): Promise<void>"));
    assert!(ts.contains("'compute_engine_destroy'"));

    // --- PivotEngine (stateless) ---
    assert!(ts.contains("export function createPivotEngineClient(transport: BridgeTransport)"));
    // No key parameter on stateless methods
    assert!(ts.contains("compute(config: PivotConfig, data: CellValue[][]): Promise<PivotResult>"));
    assert!(ts.contains("detectFields(data: CellValue[][]): Promise<PivotField[]>"));
    // No destroy on stateless
    let pivot_section_start = ts.find("createPivotEngineClient").unwrap();
    let pivot_section = &ts[pivot_section_start..];
    let table_section_start = pivot_section
        .find("createTableEngineClient")
        .unwrap_or(pivot_section.len());
    let pivot_only = &pivot_section[..table_section_start];
    assert!(
        !pivot_only.contains("destroy"),
        "Stateless PivotEngine should not have destroy"
    );

    // --- TableEngine (stateless) ---
    assert!(ts.contains("export function createTableEngineClient(transport: BridgeTransport)"));
    assert!(ts.contains("evaluateColumnFilter(criteria: FilterCriteria, columnData: CellValue[]): Promise<boolean[]>"));
    assert!(ts.contains("computeSortOrder(specs: SortSpec[], data: CellValue[][], totalRows: number): Promise<number[]>"));
}

#[test]
fn ts_command_names_match_wasm_convention() {
    let ts = generate_from_source(COMPUTE_ENGINE_SOURCE).unwrap();

    // Command names should be: {type_snake}_{method_snake}
    // These should match what bridge-wasm generates as wasm_bindgen export names
    let expected_commands = [
        "compute_engine_from_snapshot",
        "compute_engine_set_cell",
        "compute_engine_set_cells",
        "compute_engine_clear_cells",
        "compute_engine_structure_change",
        "compute_engine_relocate_cells",
        "compute_engine_insert_cells_with_shift",
        "compute_engine_query_range",
        "compute_engine_add_sheet",
        "compute_engine_destroy",
        "pivot_engine_compute",
        "pivot_engine_detect_fields",
        "table_engine_evaluate_column_filter",
        "table_engine_compute_sort_order",
    ];

    for cmd in &expected_commands {
        assert!(
            ts.contains(&format!("'{}'", cmd)),
            "Missing command: {}",
            cmd
        );
    }
}

#[test]
fn ts_args_include_key_for_stateful() {
    let ts = generate_from_source(COMPUTE_ENGINE_SOURCE).unwrap();

    // All stateful methods should pass docId in args (camelCase shorthand)
    assert!(ts.contains("{ docId, sheetId, cellId, row, col, input }"));
    assert!(ts.contains("{ docId, edits }"));
    assert!(ts.contains("{ docId, cellIds }"));

    // Stateless methods should NOT have doc_id
    assert!(ts.contains("{ config, data }")); // pivot_engine_compute
    assert!(ts.contains("{ data }")); // pivot_engine_detect_fields
}

#[test]
fn parse_params_become_string() {
    let ts = generate_from_source(COMPUTE_ENGINE_SOURCE).unwrap();

    // SheetId and CellId with #[bridge::parse] should become string on the wire
    // In setCell: sheetId: string, cellId: string
    assert!(ts.contains("sheetId: string, cellId: string, row: number"));
}

#[test]
fn nested_vec_maps_correctly() {
    let ts = generate_from_source(COMPUTE_ENGINE_SOURCE).unwrap();

    // Vec<Vec<CellValue>> → CellValue[][]
    assert!(ts.contains("CellValue[][]"));
}

#[test]
fn vec_bool_return() {
    let ts = generate_from_source(COMPUTE_ENGINE_SOURCE).unwrap();

    // Vec<bool> → boolean[]
    assert!(ts.contains("boolean[]"));
}

#[test]
fn vec_u32_return() {
    let ts = generate_from_source(COMPUTE_ENGINE_SOURCE).unwrap();

    // Vec<u32> → number[]
    assert!(ts.contains("number[]"));
}
