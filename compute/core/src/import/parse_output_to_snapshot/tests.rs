//! Tests for the `parse_output_to_snapshot` orchestrator.
//!
//! These tests span multiple lowering submodules (sheet / name / table / etc.)
//! and therefore live at the orchestrator level rather than inside any one
//! submodule's file.

use super::parse_output_to_workbook_snapshot;
use crate::storage::infra::hydration::DefaultIdAllocator;
use domain_types::domain::pivot::{
    CellRange, OutputLocation, PIVOT_CONFIG_SCHEMA_VERSION, ParsedPivotTable, PivotTableConfig,
    PivotTableLayout, PivotTableStyle,
};
use domain_types::{
    CalculationProperties, CellData as DtCellData, ImportedCellProjectionRole, NamedRange,
    ParseOutput, SheetData, TableColumnSpec, TableSpec,
};
use formula_types::Scope;
use value_types::CellValue;

fn make_parse_output() -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".into(),
            rows: 100,
            cols: 26,
            cells: vec![
                DtCellData {
                    row: 0,
                    col: 0,
                    value: CellValue::number(42.0),
                    ..Default::default()
                },
                DtCellData {
                    row: 1,
                    col: 0,
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".into()),
                    ..Default::default()
                },
                DtCellData {
                    row: 0,
                    col: 1,
                    value: CellValue::Text("hello".into()),
                    style_id: Some(1),
                    ..Default::default()
                },
            ],
            tables: vec![TableSpec {
                name: "Table1".into(),
                display_name: "Table1".into(),
                range_ref: "A1:C5".into(),
                has_headers: true,
                has_totals: false,
                columns: vec![
                    TableColumnSpec {
                        name: "Col1".into(),
                        ..Default::default()
                    },
                    TableColumnSpec {
                        name: "Col2".into(),
                        ..Default::default()
                    },
                    TableColumnSpec {
                        name: "Col3".into(),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        }],
        named_ranges: vec![NamedRange {
            name: "MyRange".into(),
            refers_to: "Sheet1!$A$1:$B$10".into(),
            ..Default::default()
        }],
        calculation: CalculationProperties {
            iterate: true,
            iterate_count: 200,
            iterate_delta: 0.0001,
            ..Default::default()
        },
        ..Default::default()
    }
}

#[test]
fn basic_conversion_produces_correct_structure() {
    let output = make_parse_output();
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);

    // One sheet
    assert_eq!(snapshot.sheets.len(), 1);
    let sheet = &snapshot.sheets[0];
    assert_eq!(sheet.name, "Sheet1");
    assert_eq!(sheet.rows, 100);
    assert_eq!(sheet.cols, 26);

    // Three cells
    assert_eq!(sheet.cells.len(), 3);

    // Cell 0: number, no formula
    assert_eq!(sheet.cells[0].row, 0);
    assert_eq!(sheet.cells[0].col, 0);
    assert_eq!(sheet.cells[0].value, CellValue::number(42.0));
    assert_eq!(sheet.cells[0].formula, None);
    assert!(sheet.cells[0].identity_formula.is_none());

    // Cell 1: formula cell
    assert_eq!(sheet.cells[1].row, 1);
    assert_eq!(sheet.cells[1].col, 0);
    assert_eq!(sheet.cells[1].formula, Some("=A1*2".into()));

    // Cell 2: text
    assert_eq!(sheet.cells[2].value, CellValue::Text("hello".into()));
}

#[test]
fn projection_role_controls_spill_target_snapshot_filtering_not_cm() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".into(),
            rows: 10,
            cols: 10,
            cells: vec![
                DtCellData {
                    row: 0,
                    col: 0,
                    value: CellValue::number(1.0),
                    formula: Some("=SEQUENCE(1,2)".into()),
                    cell_metadata_index: Some(1),
                    projection_role: ImportedCellProjectionRole::DynamicArraySource,
                    ..Default::default()
                },
                DtCellData {
                    row: 0,
                    col: 1,
                    value: CellValue::number(2.0),
                    cell_metadata_index: Some(1),
                    projection_role: ImportedCellProjectionRole::DynamicArraySpillTarget,
                    ..Default::default()
                },
                DtCellData {
                    row: 5,
                    col: 5,
                    value: CellValue::number(35.676741130091997),
                    cell_metadata_index: Some(1),
                    projection_role: ImportedCellProjectionRole::UnknownCellMetadata,
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);
    let cells = &snapshot.sheets[0].cells;

    assert!(cells.iter().any(|cell| (cell.row, cell.col) == (0, 0)));
    assert!(!cells.iter().any(|cell| (cell.row, cell.col) == (0, 1)));
    assert!(cells.iter().any(|cell| (cell.row, cell.col) == (5, 5)));
}

#[test]
fn sheet_and_cell_ids_are_valid_uuids() {
    let output = make_parse_output();
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);

    // Sheet ID should be a valid UUID (simple format, 32 hex chars).
    let sheet_id = &snapshot.sheets[0].id;
    assert_eq!(sheet_id.len(), 32);
    assert!(sheet_id.chars().all(|c| c.is_ascii_hexdigit()));

    // Cell IDs should be unique valid UUIDs.
    let cell_ids: Vec<&str> = snapshot.sheets[0]
        .cells
        .iter()
        .map(|c| c.cell_id.as_str())
        .collect();
    for id in &cell_ids {
        assert_eq!(id.len(), 32);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }
    // All IDs should be unique.
    let mut unique = cell_ids.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), cell_ids.len());
}

#[test]
fn named_ranges_converted() {
    let output = make_parse_output();
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);

    assert_eq!(snapshot.named_ranges.len(), 1);
    assert_eq!(snapshot.named_ranges[0].name, "MyRange");
    assert_eq!(
        snapshot.named_ranges[0].raw_expression,
        Some("Sheet1!$A$1:$B$10".into())
    );
    assert_eq!(snapshot.named_ranges[0].scope, Scope::Workbook);
}

#[test]
fn hidden_named_ranges_skipped() {
    let mut output = make_parse_output();
    output.named_ranges.push(NamedRange {
        name: "_xlnm.Print_Area".into(),
        refers_to: "Sheet1!$A$1:$Z$100".into(),
        hidden: true,
        ..Default::default()
    });
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);
    assert_eq!(snapshot.named_ranges.len(), 1); // Only the non-hidden one
}

#[test]
fn tables_converted_with_parsed_range() {
    let output = make_parse_output();
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);

    assert_eq!(snapshot.tables.len(), 1);
    let table = &snapshot.tables[0];
    assert_eq!(table.name, "Table1");
    assert_eq!(table.start_row, 0); // A1 → row 0
    assert_eq!(table.start_col, 0); // A → col 0
    assert_eq!(table.end_row, 4); // row 5 → index 4
    assert_eq!(table.end_col, 2); // C → col 2
    assert_eq!(table.columns, vec!["Col1", "Col2", "Col3"]);
    assert!(table.has_headers);
    assert!(!table.has_totals);
}

#[test]
fn imported_pivot_uses_ooxml_ref_range_and_style() {
    let mut output = ParseOutput {
        sheets: vec![SheetData {
            name: "Pivot".into(),
            rows: 100,
            cols: 10,
            cells: vec![DtCellData {
                row: 35,
                col: 6,
                value: CellValue::number(1.0),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    output.pivot_tables.push(ParsedPivotTable {
        config: PivotTableConfig {
            schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
            id: "pivot-1".into(),
            name: "PivotTable1".into(),
            source_sheet_id: None,
            source_sheet_name: "Data".into(),
            source_range: CellRange::new(0, 0, 1, 1),
            output_sheet_id: None,
            output_sheet_name: "Pivot".into(),
            output_location: OutputLocation { row: 16, col: 2 },
            fields: vec![],
            placements: vec![],
            filters: vec![],
            layout: Some(PivotTableLayout {
                show_row_grand_totals: Some(true),
                show_column_grand_totals: Some(true),
                ..Default::default()
            }),
            style: Some(PivotTableStyle {
                style_name: Some("PivotStyleLight16".into()),
                show_row_headers: Some(true),
                show_column_headers: Some(true),
                show_row_stripes: Some(false),
                show_column_stripes: Some(false),
                show_last_column: Some(true),
            }),
            data_options: None,
            created_at: None,
            updated_at: None,
            calculated_fields: None,
            allow_multiple_filters_per_field: None,
            auto_format: None,
            preserve_formatting: None,
            cache_id: None,
            data_on_rows: Some(false),
            ref_range: Some("C17:G36".into()),
            first_data_row: Some(2),
            first_header_row: Some(1),
            first_data_col: Some(1),
            rows_per_page: None,
            cols_per_page: None,
            row_items: vec![],
            col_items: vec![],
        },
        initial_expansion_state: None,
        ooxml_preservation: Default::default(),
    });

    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);

    let pivot = snapshot.pivot_tables.first().expect("pivot table def");
    assert_eq!(pivot.start_row, 16);
    assert_eq!(pivot.start_col, 2);
    assert_eq!(pivot.end_row, 35);
    assert_eq!(pivot.end_col, 6);
    assert_eq!(pivot.first_data_row, 2);
    assert_eq!(pivot.first_data_col, 1);
    assert_eq!(
        pivot
            .style
            .as_ref()
            .and_then(|style| style.style_name.as_deref()),
        Some("PivotStyleLight16")
    );
    assert_eq!(pivot.show_row_grand_totals, Some(true));
    assert_eq!(pivot.show_column_grand_totals, Some(true));
}

#[test]
fn iterative_calc_settings_mapped() {
    let output = make_parse_output();
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);

    assert!(snapshot.iterative_calc);
    assert_eq!(snapshot.max_iterations, 200);
    assert!((snapshot.max_change.get() - 0.0001).abs() < f64::EPSILON);
}

#[test]
fn empty_parse_output_produces_empty_snapshot() {
    let output = ParseOutput::default();
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);

    assert!(snapshot.sheets.is_empty());
    assert!(snapshot.named_ranges.is_empty());
    assert!(snapshot.tables.is_empty());
    assert!(snapshot.pivot_tables.is_empty());
    assert!(snapshot.data_table_regions.is_empty());
    assert!(!snapshot.iterative_calc);
    assert_eq!(snapshot.max_iterations, 100);
    assert!((snapshot.max_change.get() - 0.001).abs() < f64::EPSILON);
}

#[test]
fn phantom_cells_filtered_from_snapshot() {
    // Simulate a dynamic array formula at A1 with spill targets at A2, A3.
    // Origin (A1): cm=true, has formula → KEPT
    // Phantoms (A2, A3): cm=true, no formula → FILTERED
    // Regular value (B1): cm=false, no formula → KEPT
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".into(),
            rows: 10,
            cols: 2,
            cells: vec![
                // Origin cell: cm=true WITH formula → keep
                DtCellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text("Business Development".into()),
                    formula: Some("UNIQUE(C1:C100)".into()),
                    cell_metadata_index: Some(1),
                    projection_role: ImportedCellProjectionRole::DynamicArraySource,
                    ..Default::default()
                },
                // Phantom spill target: cm=true, NO formula → filter
                DtCellData {
                    row: 1,
                    col: 0,
                    value: CellValue::Text("Engineering".into()),
                    formula: None,
                    cell_metadata_index: Some(1),
                    projection_role: ImportedCellProjectionRole::DynamicArraySpillTarget,
                    ..Default::default()
                },
                // Phantom spill target: cm=true, NO formula → filter
                DtCellData {
                    row: 2,
                    col: 0,
                    value: CellValue::Text("Sales".into()),
                    formula: None,
                    cell_metadata_index: Some(1),
                    projection_role: ImportedCellProjectionRole::DynamicArraySpillTarget,
                    ..Default::default()
                },
                // Regular value cell: cm=false → keep
                DtCellData {
                    row: 0,
                    col: 1,
                    value: CellValue::number(100.0),
                    formula: None,
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);
    let sheet = &snapshot.sheets[0];

    assert_eq!(
        sheet.cells.len(),
        2,
        "retain the authored source and ordinary value"
    );
    let mut metadata_positions: Vec<_> = sheet
        .identities
        .iter()
        .map(|identity| (identity.row, identity.col))
        .collect();
    metadata_positions.sort_unstable();
    assert_eq!(metadata_positions, vec![(1, 0), (2, 0)]);
    assert!(sheet.cells.iter().all(|cell| cell.row == 0));
    let origin = sheet
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 0)
        .unwrap();
    assert_eq!(origin.value, CellValue::Text("Business Development".into()));
    assert_eq!(origin.formula.as_deref(), Some("UNIQUE(C1:C100)"));
    assert_eq!(
        sheet
            .cells
            .iter()
            .find(|cell| cell.row == 0 && cell.col == 1)
            .unwrap()
            .value,
        CellValue::number(100.0)
    );
}

/// Regression test for the DATA TABLE constant-collapse bug.
///
/// Sheet-scoped named ranges must use the actual SheetId allocated during
/// snapshot conversion, NOT the raw XLSX local_sheet_id index. If scope
/// SheetIds don't match, `VariableStore::resolve_with_id()` silently
/// returns None, breaking dependency graph construction for any formula
/// referencing a named range.
#[test]
fn sheet_scoped_named_range_uses_actual_sheet_id() {
    let output = ParseOutput {
        sheets: vec![
            SheetData {
                name: "First".into(),
                rows: 10,
                cols: 10,
                ..Default::default()
            },
            SheetData {
                name: "Second".into(),
                rows: 10,
                cols: 10,
                ..Default::default()
            },
        ],
        named_ranges: vec![
            NamedRange {
                name: "MyVar".into(),
                refers_to: "Second!$A$1".into(),
                local_sheet_id: Some(1), // scoped to "Second" (index 1)
                ..Default::default()
            },
            NamedRange {
                name: "FirstVar".into(),
                refers_to: "First!$B$2".into(),
                local_sheet_id: Some(0), // scoped to "First" (index 0)
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);

    // The snapshot's sheets have real (non-sequential) SheetIds.
    let first_sheet_id = cell_types::SheetId::from_uuid_str(&snapshot.sheets[0].id).unwrap();
    let second_sheet_id = cell_types::SheetId::from_uuid_str(&snapshot.sheets[1].id).unwrap();

    // Named ranges' scopes must match the actual SheetIds, not raw indices.
    let my_var = snapshot
        .named_ranges
        .iter()
        .find(|nr| nr.name == "MyVar")
        .expect("MyVar not found");
    assert_eq!(
        my_var.scope,
        Scope::Sheet(second_sheet_id),
        "Sheet-scoped named range must use actual SheetId, not XLSX index"
    );

    let first_var = snapshot
        .named_ranges
        .iter()
        .find(|nr| nr.name == "FirstVar")
        .expect("FirstVar not found");
    assert_eq!(
        first_var.scope,
        Scope::Sheet(first_sheet_id),
        "Sheet-scoped named range must use actual SheetId, not XLSX index"
    );

    // Workbook-scoped named ranges should still use Scope::Workbook.
    let mut output_with_wb = output.clone();
    output_with_wb.named_ranges = vec![NamedRange {
        name: "GlobalVar".into(),
        refers_to: "First!$C$3".into(),
        local_sheet_id: None,
        ..Default::default()
    }];
    let mut allocator2 = DefaultIdAllocator::new();
    let snapshot2 = parse_output_to_workbook_snapshot(&output_with_wb, None, &mut allocator2);
    assert_eq!(snapshot2.named_ranges[0].scope, Scope::Workbook);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hydration-pipeline helpers
// ─────────────────────────────────────────────────────────────────────────────

fn hydrate_and_snapshot(
    output: &ParseOutput,
) -> (
    snapshot_types::WorkbookSnapshot,
    crate::storage::infra::hydration::HydrationIdMap,
) {
    let mut allocator = DefaultIdAllocator::new();
    let mut storage = crate::storage::WorkbookStorage::new();
    let id_map = storage
        .hydrate_from_parse_output(output, &mut allocator)
        .unwrap();
    let snapshot = parse_output_to_workbook_snapshot(output, Some(&id_map), &mut allocator);
    (snapshot, id_map)
}

/// Verify that after init_from_snapshot, formulas referencing sheet-scoped
/// named ranges have dependency edges through the synthetic variable CellId.
/// This is the end-to-end regression test for the DATA TABLE constant-collapse.
#[test]
fn named_range_creates_dependency_graph_edge() {
    use crate::cells::CellStore;
    use crate::scheduler::ComputeCore;

    // Build a two-sheet ParseOutput:
    //   Sheet "Inputs": A1 = 100 (the input value)
    //   Sheet "Model":  A1 = "=InputVal*2" (references named range)
    //   Named range "InputVal" = Inputs!$A$1, scoped to sheet "Model"
    let output = ParseOutput {
        sheets: vec![
            SheetData {
                name: "Inputs".into(),
                rows: 10,
                cols: 10,
                cells: vec![DtCellData {
                    row: 0,
                    col: 0,
                    value: CellValue::number(100.0),
                    ..Default::default()
                }],
                ..Default::default()
            },
            SheetData {
                name: "Model".into(),
                rows: 10,
                cols: 10,
                cells: vec![DtCellData {
                    row: 0,
                    col: 0,
                    value: CellValue::number(0.0),
                    formula: Some("=InputVal*2".into()),
                    ..Default::default()
                }],
                ..Default::default()
            },
        ],
        named_ranges: vec![NamedRange {
            name: "InputVal".into(),
            refers_to: "Inputs!$A$1".into(),
            local_sheet_id: Some(1), // scoped to "Model" (index 1)
            ..Default::default()
        }],
        ..Default::default()
    };

    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);
    let model_sheet_id = cell_types::SheetId::from_uuid_str(&snapshot.sheets[1].id).unwrap();

    // Verify the scope was remapped correctly
    assert_eq!(
        snapshot.named_ranges[0].scope,
        Scope::Sheet(model_sheet_id),
        "InputVal scope must match Model sheet's actual SheetId"
    );

    // Init compute-core and check the formula evaluates correctly
    let mut core = ComputeCore::new();
    let mut cell_store = CellStore::new();
    let _result = core.init_from_snapshot(&mut cell_store, snapshot).unwrap();

    // Find Model!A1's CellId and check its computed value.
    // If the named range resolved correctly, =InputVal*2 = 100*2 = 200.
    let model_a1 = cell_store
        .resolve_cell_id(&model_sheet_id, cell_types::SheetPos::new(0, 0))
        .expect("Model!A1 should exist");
    let value = core
        .get_cell_value(&cell_store, &model_a1)
        .expect("Should have value");

    assert_eq!(
        *value,
        CellValue::number(200.0),
        "=InputVal*2 should evaluate to 200 (InputVal=Inputs!A1=100). \
         If this fails, the named range scope SheetId likely doesn't match."
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed range refs: — regression tests (Boundary 1.10 / 1.17)
//
// These pin the typed-pass semantics the sub-band introduced. Each asserts
// the lowering step produces the expected snapshot shape for inputs the
// previous string-hop path silently tolerated or mishandled.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn w4c_table_lowering_accepts_sheet_qualified_range() {
    // A table `range_ref` can arrive sheet-qualified (e.g. `Sheet1!A1:C5`).
    // Typed range refs: the lowering peels the prefix via
    // `compute_parser::split_sheet_prefix` — not `rfind('!')` — so a quoted
    // sheet name with spaces survives the strip.
    let mut output = make_parse_output();
    output.sheets[0].tables[0].range_ref = "'Sheet With Spaces'!A1:C5".into();
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);
    assert_eq!(snapshot.tables.len(), 1);
    let table = &snapshot.tables[0];
    assert_eq!(table.start_row, 0);
    assert_eq!(table.start_col, 0);
    assert_eq!(table.end_row, 4);
    assert_eq!(table.end_col, 2);
}

#[test]
fn w4c_table_lowering_rejects_malformed_range_without_panic() {
    // Typed range refs: the typed pass returns `None` on malformed input
    // rather than panicking on byte-arithmetic in a shadow parser. The
    // problematic UTF-8 boundary inputs from UTF-8 boundary must not panic when
    // routed through the table path.
    let mut output = make_parse_output();
    output.sheets[0].tables[0].range_ref = "μμμμμμ".into();
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);
    // Table with unparseable range is filtered out (filter_map returns None).
    assert!(snapshot.tables.is_empty());
}

#[test]
fn w4c_table_lowering_typed_pass_round_trip() {
    // Typed range refs: classic A1 range round-trips through the typed pass
    // without byte-level surgery.
    let mut output = make_parse_output();
    output.sheets[0].tables[0].range_ref = "B2:F20".into();
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&output, None, &mut allocator);
    let table = &snapshot.tables[0];
    assert_eq!(table.start_row, 1); // B2 → row 1
    assert_eq!(table.start_col, 1); // B → col 1
    assert_eq!(table.end_row, 19); // F20 → row 19
    assert_eq!(table.end_col, 5); // F → col 5
}

// ─────────────────────────────────────────────────────────────────────────────
// pass 2 import classifier integration tests (full hydration pipeline)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn gate1_range_anchor_exclusion() {
    use domain_types::{Comment, MergeRegion};

    const N: u32 = 600;
    let formula_row = 100u32;
    let comment_row = 300u32;
    let merge_row = 450u32;

    let mut cells: Vec<DtCellData> = (0..N)
        .map(|r| DtCellData {
            row: r,
            col: 0,
            value: CellValue::number(r as f64 * 1.1),
            ..Default::default()
        })
        .collect();

    cells[formula_row as usize].formula = Some("=1+1".into());

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".into(),
            rows: N,
            cols: 1,
            cells,
            comments: vec![Comment {
                cell_ref: format!(
                    "A{}",
                    comment_row + 1 // A1-notation is 1-based
                ),
                ..Default::default()
            }],
            merges: vec![MergeRegion {
                start_row: merge_row,
                start_col: 0,
                end_row: merge_row + 1,
                end_col: 0,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let (snapshot, _id_map) = hydrate_and_snapshot(&output);
    let sheet = &snapshot.sheets[0];

    let anchored_rows: Vec<u32> = sheet.cells.iter().map(|c| c.row).collect();
    assert!(
        anchored_rows.contains(&formula_row),
        "Formula cell at row {formula_row} must survive as per-cell entry"
    );
    assert!(
        anchored_rows.contains(&comment_row),
        "Comment target at row {comment_row} must survive as per-cell entry"
    );
    assert!(
        anchored_rows.contains(&merge_row),
        "Merge origin at row {merge_row} must survive as per-cell entry"
    );

    assert!(
        !sheet.ranges.is_empty(),
        "Non-anchored cells should form Range payloads"
    );

    let range_row_count: usize = sheet
        .ranges
        .iter()
        .map(|r| {
            r.row_axis
                .as_ref()
                .map_or(r.row_ids.len(), |axis| axis.len() as usize)
        })
        .sum();
    let total = sheet.cells.len() + range_row_count;
    assert_eq!(
        total, N as usize,
        "Total cells ({total}) must equal original count ({N})"
    );
}

#[test]
fn gate4_anchor_gap_in_middle_of_run() {
    const N: u32 = 1000;
    let anchor_row = 500u32;

    let mut cells: Vec<DtCellData> = (0..N)
        .map(|r| DtCellData {
            row: r,
            col: 0,
            value: CellValue::number(r as f64),
            ..Default::default()
        })
        .collect();

    cells[anchor_row as usize].formula = Some("=1+1".into());

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".into(),
            rows: N,
            cols: 1,
            cells,
            ..Default::default()
        }],
        ..Default::default()
    };

    let (snapshot, id_map) = hydrate_and_snapshot(&output);
    let sheet = &snapshot.sheets[0];

    let anchor_cell = sheet
        .cells
        .iter()
        .find(|c| c.row == anchor_row && c.col == 0);
    assert!(
        anchor_cell.is_some(),
        "Row {anchor_row} (formula anchor) must be a per-cell entry"
    );

    assert!(
        !sheet.ranges.is_empty(),
        "Non-anchored cells must form Range payloads"
    );

    let anchor_row_id = id_map.row_axes[0]
        .identity_at(id_map.sheet_ids[0], (anchor_row as usize) as u32)
        .unwrap();
    for range in &sheet.ranges {
        assert!(
            !range_row_offsets(range, id_map.sheet_ids[0], &id_map.row_axes[0])
                .contains_key(&anchor_row_id),
            "Range row_ids must not contain the anchored row's RowId"
        );
    }

    let check_row_accessible = |target_row: u32| -> bool {
        let target_row_id = id_map.row_axes[0]
            .identity_at(id_map.sheet_ids[0], (target_row as usize) as u32)
            .unwrap();
        for range in &sheet.ranges {
            if let Some(idx) = range_row_offsets(range, id_map.sheet_ids[0], &id_map.row_axes[0])
                .get(&target_row_id)
            {
                let idx = idx as usize;
                if range.encoding == cell_types::PayloadEncoding::F64Le {
                    let bytes = &range.payload[idx * 8..(idx + 1) * 8];
                    let val = f64::from_le_bytes(bytes.try_into().unwrap());
                    return (val - target_row as f64).abs() < f64::EPSILON;
                }
            }
        }
        false
    };

    assert!(
        check_row_accessible(anchor_row - 1),
        "Row {} must be accessible from a range payload",
        anchor_row - 1
    );
    assert!(
        check_row_accessible(anchor_row + 1),
        "Row {} must be accessible from a range payload",
        anchor_row + 1
    );
}

#[test]
fn gate5_hydration_id_map_extension() {
    const N: u32 = 1000;

    let cells: Vec<DtCellData> = (0..N)
        .map(|r| DtCellData {
            row: r,
            col: 0,
            value: CellValue::number(r as f64),
            ..Default::default()
        })
        .collect();

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".into(),
            rows: N,
            cols: 5,
            cells,
            ..Default::default()
        }],
        ..Default::default()
    };

    let (snapshot, id_map) = hydrate_and_snapshot(&output);
    let sheet = &snapshot.sheets[0];

    assert_eq!(
        id_map.row_axes[0].len(),
        sheet.rows,
        "id_map.row_axes[0] length must equal the sheet row count"
    );
    assert_eq!(
        id_map.col_axes[0].len(),
        sheet.cols,
        "id_map.col_axes[0] length must equal the sheet col count"
    );

    for range in &sheet.ranges {
        for rid in range_row_offsets(range, id_map.sheet_ids[0], &id_map.row_axes[0]).keys() {
            assert!(
                id_map.row_axes[0].contains_identity(id_map.sheet_ids[0], rid),
                "Every RangeData row_id must exist in id_map.row_axes"
            );
        }
    }
}

#[test]
fn gate8_large_import_produces_range_backed_snapshot() {
    const N: u32 = 1000;

    let cells: Vec<DtCellData> = (0..N)
        .map(|r| DtCellData {
            row: r,
            col: 0,
            value: CellValue::number(r as f64 * 2.5),
            ..Default::default()
        })
        .collect();

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".into(),
            rows: N,
            cols: 1,
            cells,
            ..Default::default()
        }],
        ..Default::default()
    };

    let (snapshot, _id_map) = hydrate_and_snapshot(&output);
    let sheet = &snapshot.sheets[0];

    assert!(
        !sheet.ranges.is_empty(),
        "1000-row numeric import must produce Range-backed storage"
    );

    assert_eq!(
        sheet.ranges[0].encoding,
        cell_types::PayloadEncoding::F64Le,
        "Numeric column must use F64Le encoding"
    );

    let range_row_count: usize = sheet
        .ranges
        .iter()
        .map(|r| {
            r.row_axis
                .as_ref()
                .map_or(r.row_ids.len(), |axis| axis.len() as usize)
        })
        .sum();
    let total = sheet.cells.len() + range_row_count;
    assert_eq!(
        total,
        N as usize,
        "cells ({}) + range rows ({range_row_count}) must equal {N}",
        sheet.cells.len()
    );
}

fn range_row_offsets(
    range: &snapshot_types::RangeData,
    sheet: cell_types::SheetId,
    axis: &cell_types::AxisIdentityStore<cell_types::RowId>,
) -> crate::cells::range_view::RangeOffsets<cell_types::RowId> {
    range
        .row_axis
        .as_ref()
        .and_then(|reference| {
            crate::cells::range_view::RangeOffsets::from_axis_ref(sheet, reference, axis)
        })
        .unwrap_or_else(|| {
            range
                .row_ids
                .iter()
                .enumerate()
                .map(|(i, id)| (*id, i as u32))
                .collect()
        })
}
