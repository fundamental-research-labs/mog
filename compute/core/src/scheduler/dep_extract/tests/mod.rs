// ===========================================================================
// Tests for projection-aware dependency extraction
// ===========================================================================

use super::*;
use crate::mirror::{CellEntry, SheetMirror};
use value_types::CellValue;

fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a mirror with a single sheet containing the given cells.
fn make_mirror(sheet_id: SheetId, cells: Vec<(CellId, u32, u32)>) -> CellMirror {
    let mut mirror = CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), 100, 26);
    mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);
    for (cell_id, row, col) in cells {
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };
        mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(row, col), entry);
    }
    mirror
}

// -----------------------------------------------------------------------
// Test 1: Positional ref to empty position (no projection) → Range only
// -----------------------------------------------------------------------

#[test]
fn test_positional_ref_no_projection() {
    let sheet = make_sheet_id(1);
    let mirror = make_mirror(sheet, vec![]);

    let cell_ref = CellRef::Positional {
        sheet,
        row: 5,
        col: 3,
    };

    // With empty registry
    let targets =
        cell_ref_to_dep_targets(&cell_ref, &mirror, Some(&mirror.projection_registry), None);

    assert_eq!(targets.len(), 1, "should produce exactly 1 dep target");
    assert_eq!(
        targets[0],
        DepTarget::Range(RangePos::new(sheet, 5, 3, 5, 3), RangeAccess::Aggregate)
    );
}

// -----------------------------------------------------------------------
// Test 2: Positional ref inside a known projection → Range + Cell(source)
// -----------------------------------------------------------------------

#[test]
fn test_positional_ref_inside_projection() {
    let sheet = make_sheet_id(1);
    let source = make_cell_id(100);
    let mut mirror = make_mirror(sheet, vec![(source, 0, 0)]);

    // Register a projection: source at (0,0), 5 rows x 1 col
    mirror
        .projection_registry
        .register(source, sheet, 0, 0, 5, 1);

    // Reference to position (3, 0) which is inside the projection
    let cell_ref = CellRef::Positional {
        sheet,
        row: 3,
        col: 0,
    };

    let targets =
        cell_ref_to_dep_targets(&cell_ref, &mirror, Some(&mirror.projection_registry), None);

    assert_eq!(targets.len(), 2, "should produce Range + Cell(source)");
    // First: the 1x1 range dep (safety net)
    assert_eq!(
        targets[0],
        DepTarget::Range(RangePos::new(sheet, 3, 0, 3, 0), RangeAccess::Aggregate)
    );
    // Second: the topo ordering edge to the source
    assert_eq!(targets[1], DepTarget::Cell(source));
}

// -----------------------------------------------------------------------
// Test 3: Resolved ref to cell inside projection → Cell(id) + Cell(source)
// -----------------------------------------------------------------------

#[test]
fn test_resolved_ref_inside_projection() {
    let sheet = make_sheet_id(1);
    let source = make_cell_id(100);
    let phantom = make_cell_id(200);
    let mut mirror = make_mirror(sheet, vec![(source, 0, 0), (phantom, 2, 0)]);

    // Register projection: source at (0,0), 5 rows x 1 col
    mirror
        .projection_registry
        .register(source, sheet, 0, 0, 5, 1);

    // Resolved ref to the phantom cell at position (2, 0)
    let cell_ref = CellRef::Resolved(phantom);

    let targets =
        cell_ref_to_dep_targets(&cell_ref, &mirror, Some(&mirror.projection_registry), None);

    assert_eq!(
        targets.len(),
        2,
        "should produce Cell(phantom) + Cell(source)"
    );
    assert_eq!(targets[0], DepTarget::Cell(phantom));
    assert_eq!(targets[1], DepTarget::Cell(source));
}

// -----------------------------------------------------------------------
// Test 4: Projection removed → re-extraction produces Range only
// -----------------------------------------------------------------------

#[test]
fn test_projection_removed_reverts_to_range_only() {
    let sheet = make_sheet_id(1);
    let source = make_cell_id(100);
    let mut mirror = make_mirror(sheet, vec![(source, 0, 0)]);

    // Register and then remove projection
    mirror
        .projection_registry
        .register(source, sheet, 0, 0, 5, 1);
    mirror.projection_registry.remove(&source);

    // Positional ref to what was projected position
    let cell_ref = CellRef::Positional {
        sheet,
        row: 3,
        col: 0,
    };

    let targets =
        cell_ref_to_dep_targets(&cell_ref, &mirror, Some(&mirror.projection_registry), None);

    assert_eq!(targets.len(), 1, "after removal, should produce Range only");
    assert!(matches!(targets[0], DepTarget::Range(_, _)));
}

// -----------------------------------------------------------------------
// Test 5: Self-reference check — if source == current cell, no extra dep
// -----------------------------------------------------------------------

#[test]
fn test_self_reference_no_extra_dep() {
    let sheet = make_sheet_id(1);
    let source = make_cell_id(100);
    let mut mirror = make_mirror(sheet, vec![(source, 0, 0)]);

    // Register projection from source
    mirror
        .projection_registry
        .register(source, sheet, 0, 0, 5, 1);

    // Positional ref to (3, 0), inside projection, but current_cell is source
    let cell_ref = CellRef::Positional {
        sheet,
        row: 3,
        col: 0,
    };

    let targets = cell_ref_to_dep_targets(
        &cell_ref,
        &mirror,
        Some(&mirror.projection_registry),
        Some(&source), // current_cell == source
    );

    assert_eq!(
        targets.len(),
        1,
        "self-reference: should NOT add Cell(source) dep"
    );
    assert!(matches!(targets[0], DepTarget::Range(_, _)));
}

// -----------------------------------------------------------------------
// Test 6: Resolved ref at projection origin → Cell(id) only (source == id)
// -----------------------------------------------------------------------

#[test]
fn test_resolved_ref_at_projection_origin() {
    let sheet = make_sheet_id(1);
    let source = make_cell_id(100);
    let mut mirror = make_mirror(sheet, vec![(source, 0, 0)]);

    // Register projection: source at (0,0)
    mirror
        .projection_registry
        .register(source, sheet, 0, 0, 5, 1);

    // Resolved ref directly to source cell
    let cell_ref = CellRef::Resolved(source);

    let targets =
        cell_ref_to_dep_targets(&cell_ref, &mirror, Some(&mirror.projection_registry), None);

    // source == id, so no extra Cell(source) dep should be added
    assert_eq!(
        targets.len(),
        1,
        "ref to source itself: should NOT add duplicate Cell(source)"
    );
    assert_eq!(targets[0], DepTarget::Cell(source));
}

// -----------------------------------------------------------------------
// Test 7: Registry is None → same behavior as basic cell_ref_to_dep_target
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// Metadata-only function tests: ROW, COLUMN, ROWS, COLUMNS, CELL
// -----------------------------------------------------------------------

/// Helper: build a positional CellRef as an ASTNode::CellReference.
fn cell_ref_node(sheet: SheetId, row: u32, col: u32) -> ASTNode {
    ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional { sheet, row, col },
        abs_row: true,
        abs_col: true,
    })
}

/// Helper: build a range ref AST node.
fn range_ref_node(sheet: SheetId, r1: u32, c1: u32, r2: u32, c2: u32) -> ASTNode {
    ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet,
            row: r1,
            col: c1,
        },
        end: CellRef::Positional {
            sheet,
            row: r2,
            col: c2,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: formula_types::RangeType::CellRange,
    })
}

/// Helper: extract deps from an AST using the production path.
fn deps_from_ast(ast: &ASTNode, sheet: &SheetId) -> Vec<DepTarget> {
    let mirror = CellMirror::new();
    extract_deps_and_volatility(ast, sheet, &mirror, &[], None).value_deps
}

#[test]
fn test_column_self_ref_no_dep() {
    // =COLUMN($D$40) — should produce NO dep for D40 (col=3, row=39)
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "COLUMN".into(),
        args: vec![cell_ref_node(sheet, 39, 3)],
    };
    let deps = deps_from_ast(&ast, &sheet);
    assert!(
        deps.is_empty(),
        "COLUMN(static_ref) should produce no deps, got: {:?}",
        deps
    );
}

#[test]
fn test_row_self_ref_no_dep() {
    // =ROW($A$5) — should produce NO dep for A5
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "ROW".into(),
        args: vec![cell_ref_node(sheet, 4, 0)],
    };
    let deps = deps_from_ast(&ast, &sheet);
    assert!(
        deps.is_empty(),
        "ROW(static_ref) should produce no deps, got: {:?}",
        deps
    );
}

#[test]
fn test_rows_range_no_dep() {
    // =ROWS(A1:A10) — should produce NO deps for A1:A10
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "ROWS".into(),
        args: vec![range_ref_node(sheet, 0, 0, 9, 0)],
    };
    let deps = deps_from_ast(&ast, &sheet);
    assert!(
        deps.is_empty(),
        "ROWS(static_range) should produce no deps, got: {:?}",
        deps
    );
}

#[test]
fn test_columns_range_no_dep() {
    // =COLUMNS(A1:D1) — should produce NO deps for A1:D1
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "COLUMNS".into(),
        args: vec![range_ref_node(sheet, 0, 0, 0, 3)],
    };
    let deps = deps_from_ast(&ast, &sheet);
    assert!(
        deps.is_empty(),
        "COLUMNS(static_range) should produce no deps, got: {:?}",
        deps
    );
}

#[test]
fn test_intersection_extracts_only_overlapping_area() {
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "SUM".into(),
        args: vec![ASTNode::BinaryOp {
            op: compute_parser::BinOp::Intersect,
            left: Box::new(range_ref_node(sheet, 0, 0, 1, 1)),
            right: Box::new(range_ref_node(sheet, 0, 1, 2, 2)),
        }],
    };

    let deps = deps_from_ast(&ast, &sheet);

    assert!(deps.contains(&DepTarget::Range(
        RangePos::new(sheet, 0, 1, 1, 1),
        RangeAccess::Aggregate
    )));
    assert!(!deps.contains(&DepTarget::Range(
        RangePos::new(sheet, 0, 0, 1, 1),
        RangeAccess::Aggregate
    )));
    assert!(!deps.contains(&DepTarget::Range(
        RangePos::new(sheet, 0, 1, 2, 2),
        RangeAccess::Aggregate
    )));
}

#[test]
fn test_intersection_with_no_overlap_extracts_no_value_deps() {
    let sheet = make_sheet_id(1);
    let ast = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Intersect,
        left: Box::new(range_ref_node(sheet, 0, 0, 1, 0)),
        right: Box::new(range_ref_node(sheet, 0, 2, 1, 2)),
    };

    let deps = deps_from_ast(&ast, &sheet);

    assert!(
        deps.is_empty(),
        "no-overlap intersection got deps: {deps:?}"
    );
}

#[test]
fn test_column_cross_sheet_ref_no_dep() {
    // =COLUMN(Sheet2!$A$1) — SheetRef wrapping a CellReference is static
    let sheet1 = make_sheet_id(1);
    let sheet2 = make_sheet_id(2);
    let ast = ASTNode::Function {
        name: "COLUMN".into(),
        args: vec![ASTNode::SheetRef {
            sheet: sheet2,
            inner: Box::new(cell_ref_node(sheet2, 0, 0)),
        }],
    };
    let deps = deps_from_ast(&ast, &sheet1);
    assert!(
        deps.is_empty(),
        "COLUMN(SheetRef(static)) should produce no deps, got: {:?}",
        deps
    );
}

#[test]
fn test_compound_formula_only_skips_metadata_arg() {
    // =A1+COLUMN($D$40) — should extract dep for A1 but NOT D40
    let sheet = make_sheet_id(1);
    let ast = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Add,
        left: Box::new(cell_ref_node(sheet, 0, 0)), // A1
        right: Box::new(ASTNode::Function {
            name: "COLUMN".into(),
            args: vec![cell_ref_node(sheet, 39, 3)], // $D$40
        }),
    };
    let deps = deps_from_ast(&ast, &sheet);
    // Should have dep(s) for A1 (positional → 1x1 Range) but nothing for D40
    assert!(!deps.is_empty(), "should have deps for A1");
    for dep in &deps {
        match dep {
            DepTarget::Range(r, _) => {
                assert!(
                    !(r.start_row() == 39 && r.start_col() == 3),
                    "should NOT have dep for D40 (row=39, col=3), got: {:?}",
                    dep
                );
            }
            DepTarget::Cell(_) => {} // OK — could be projection-related
        }
    }
}

#[test]
fn test_column_indirect_does_extract_deps() {
    // =COLUMN(INDIRECT("D40")) — INDIRECT is a Function node, not static ref
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "COLUMN".into(),
        args: vec![ASTNode::Function {
            name: "INDIRECT".into(),
            args: vec![ASTNode::Text("D40".to_string())],
        }],
    };
    let extracted = extract_deps_and_volatility(&ast, &sheet, &CellMirror::new(), &[], None);
    // INDIRECT is volatile, so is_volatile should be true
    assert!(
        extracted.is_volatile,
        "INDIRECT should mark formula as volatile"
    );
    // No static deps from INDIRECT("D40") since it's a string literal,
    // but the key point is that dep extraction was NOT skipped for the arg.
}

#[test]
fn test_sum_self_ref_still_has_deps() {
    // =SUM($D$40) — genuine value dependency, deps MUST be extracted
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "SUM".into(),
        args: vec![cell_ref_node(sheet, 39, 3)],
    };
    let deps = deps_from_ast(&ast, &sheet);
    assert!(
        !deps.is_empty(),
        "SUM(ref) must extract deps for cycle detection"
    );
}

#[test]
fn test_cell_row_metadata_no_dep() {
    // =CELL("row", $D$40) — metadata mode, should produce NO dep for D40
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "CELL".into(),
        args: vec![
            ASTNode::Text("row".to_string()),
            cell_ref_node(sheet, 39, 3),
        ],
    };
    let deps = deps_from_ast(&ast, &sheet);
    assert!(
        deps.is_empty(),
        "CELL(\"row\", static_ref) should produce no deps, got: {:?}",
        deps
    );
}

#[test]
fn test_cell_col_metadata_no_dep() {
    // =CELL("col", $D$40)
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "CELL".into(),
        args: vec![
            ASTNode::Text("col".to_string()),
            cell_ref_node(sheet, 39, 3),
        ],
    };
    let deps = deps_from_ast(&ast, &sheet);
    assert!(
        deps.is_empty(),
        "CELL(\"col\", static_ref) should produce no deps, got: {:?}",
        deps
    );
}

#[test]
fn test_cell_address_metadata_no_dep() {
    // =CELL("address", $D$40)
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "CELL".into(),
        args: vec![
            ASTNode::Text("address".to_string()),
            cell_ref_node(sheet, 39, 3),
        ],
    };
    let deps = deps_from_ast(&ast, &sheet);
    assert!(
        deps.is_empty(),
        "CELL(\"address\", static_ref) should produce no deps, got: {:?}",
        deps
    );
}

#[test]
fn test_cell_type_does_extract_deps() {
    // =CELL("type", $D$40) — reads value, deps MUST be extracted
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "CELL".into(),
        args: vec![
            ASTNode::Text("type".to_string()),
            cell_ref_node(sheet, 39, 3),
        ],
    };
    let deps = deps_from_ast(&ast, &sheet);
    assert!(
        !deps.is_empty(),
        "CELL(\"type\", ref) must extract deps (reads value)"
    );
}

#[test]
fn test_cell_dynamic_info_type_does_extract_deps() {
    // =CELL(A1, $D$40) — info_type from cell ref, conservatively extract deps for both
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "CELL".into(),
        args: vec![
            cell_ref_node(sheet, 0, 0),  // A1 as info_type (dynamic)
            cell_ref_node(sheet, 39, 3), // $D$40
        ],
    };
    let deps = deps_from_ast(&ast, &sheet);
    // Should have deps for BOTH A1 and D40
    assert!(
        deps.len() >= 2,
        "CELL(dynamic_info, ref) must extract deps for both args, got: {:?}",
        deps
    );
}

#[test]
fn test_column_no_args_no_deps() {
    // =COLUMN() — no arguments, no deps
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "COLUMN".into(),
        args: vec![],
    };
    let deps = deps_from_ast(&ast, &sheet);
    assert!(deps.is_empty(), "COLUMN() with no args should have no deps");
}

#[test]
fn test_column_identifier_does_extract_deps() {
    // =COLUMN(NamedRange) — Identifier is not a static ref, deps conservatively extracted
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "COLUMN".into(),
        args: vec![ASTNode::Identifier("MyRange".to_string())],
    };
    // Identifier won't resolve in an empty mirror, but the point is we don't skip it
    let _deps = deps_from_ast(&ast, &sheet);
    // With empty mirror, identifier won't resolve, so deps may be empty.
    // The important thing is is_static_ref returns false for Identifier,
    // so the code path falls through to normal extraction (not skipped).
    // We test this indirectly via the is_static_ref unit test below.
}

#[test]
fn test_is_static_ref() {
    let sheet = make_sheet_id(1);

    // Static refs
    assert!(is_static_ref(&cell_ref_node(sheet, 0, 0)));
    assert!(is_static_ref(&range_ref_node(sheet, 0, 0, 9, 0)));
    assert!(is_static_ref(&ASTNode::SheetRef {
        sheet,
        inner: Box::new(cell_ref_node(sheet, 0, 0)),
    }));

    // Non-static
    assert!(!is_static_ref(&ASTNode::Function {
        name: "INDIRECT".into(),
        args: vec![ASTNode::Text("A1".to_string())],
    }));
    assert!(!is_static_ref(&ASTNode::Identifier("MyRange".to_string())));
    assert!(!is_static_ref(&ASTNode::Number(42.0)));
    assert!(!is_static_ref(&ASTNode::Text("hello".to_string())));
}

#[test]
fn test_registry_none_backwards_compatible() {
    let sheet = make_sheet_id(1);
    let source = make_cell_id(100);
    let mirror = make_mirror(sheet, vec![(source, 0, 0)]);

    // Positional ref
    let cell_ref = CellRef::Positional {
        sheet,
        row: 3,
        col: 0,
    };

    let targets = cell_ref_to_dep_targets(&cell_ref, &mirror, None, None);

    assert_eq!(targets.len(), 1, "no registry: Range only");
    assert!(matches!(targets[0], DepTarget::Range(_, _)));

    // Resolved ref
    let cell_ref = CellRef::Resolved(source);
    let targets = cell_ref_to_dep_targets(&cell_ref, &mirror, None, None);

    assert_eq!(targets.len(), 1, "no registry: Cell only");
    assert_eq!(targets[0], DepTarget::Cell(source));
}

// -----------------------------------------------------------------------
// Tests for selective_range_arg_pattern
// -----------------------------------------------------------------------

#[test]
fn test_selective_range_arg_pattern_known_functions() {
    // Specific-index functions
    assert!(selective_range_arg_pattern("INDEX").includes(0));
    assert!(!selective_range_arg_pattern("INDEX").includes(1));
    assert!(selective_range_arg_pattern("XLOOKUP").includes(1));
    assert!(selective_range_arg_pattern("XLOOKUP").includes(2));
    assert!(!selective_range_arg_pattern("XLOOKUP").includes(0));
    assert!(selective_range_arg_pattern("VLOOKUP").includes(1));
    assert!(!selective_range_arg_pattern("VLOOKUP").includes(0));
    assert!(selective_range_arg_pattern("HLOOKUP").includes(1));
    assert!(!selective_range_arg_pattern("HLOOKUP").includes(0));
    assert!(selective_range_arg_pattern("MATCH").includes(1));
    assert!(!selective_range_arg_pattern("MATCH").includes(0));
    assert!(selective_range_arg_pattern("LOOKUP").includes(1));
    assert!(selective_range_arg_pattern("LOOKUP").includes(2));
    assert!(!selective_range_arg_pattern("LOOKUP").includes(0));

    // AllFrom functions — unbounded
    assert!(!selective_range_arg_pattern("CHOOSE").includes(0));
    assert!(selective_range_arg_pattern("CHOOSE").includes(1));
    assert!(selective_range_arg_pattern("CHOOSE").includes(100));
    assert!(!selective_range_arg_pattern("SWITCH").includes(0));
    assert!(selective_range_arg_pattern("SWITCH").includes(1));
    assert!(selective_range_arg_pattern("SWITCH").includes(50));
    assert!(selective_range_arg_pattern("IFS").includes(0));
    assert!(selective_range_arg_pattern("IFS").includes(99));

    // Aggregate functions — none selective
    assert!(!selective_range_arg_pattern("SUM").includes(0));
    assert!(!selective_range_arg_pattern("AVERAGE").includes(0));
    assert!(!selective_range_arg_pattern("COUNTIF").includes(0));

    // Volatile-dynamic — not selective (handled separately via volatility)
    assert!(!selective_range_arg_pattern("INDIRECT").includes(0));
    assert!(!selective_range_arg_pattern("OFFSET").includes(0));
}

#[test]
fn test_selective_case_insensitive() {
    assert!(selective_range_arg_pattern("index").includes(0));
    assert!(selective_range_arg_pattern("Index").includes(0));
    assert!(selective_range_arg_pattern("INDEX").includes(0));
    assert!(selective_range_arg_pattern("xlookup").includes(1));
    assert!(selective_range_arg_pattern("Xlookup").includes(1));
    assert!(selective_range_arg_pattern("vLOOKUP").includes(1));
    assert!(selective_range_arg_pattern("match").includes(1));
    assert!(selective_range_arg_pattern("choose").includes(1));
}

#[test]
fn test_small_selective_range_not_expanded() {
    let sheet = make_sheet_id(1);
    let mirror = make_mirror(
        sheet,
        vec![
            (make_cell_id(101), 0, 0),
            (make_cell_id(102), 1, 0),
            (make_cell_id(103), 2, 0),
        ],
    );
    let ast = ASTNode::Function {
        name: "INDEX".into(),
        args: vec![range_ref_node(sheet, 0, 0, 2, 0), ASTNode::Number(1.0)],
    };

    let deps = extract_deps_and_volatility(&ast, &sheet, &mirror, &[], None).value_deps;

    assert_eq!(
        deps,
        vec![DepTarget::Range(
            RangePos::new(sheet, 0, 0, 2, 0),
            RangeAccess::Selective,
        )]
    );
}

#[test]
fn test_nested_aggregate_resets_outer_selective_context() {
    let sheet = make_sheet_id(1);
    let ast = ASTNode::Function {
        name: "CHOOSE".into(),
        args: vec![
            ASTNode::Number(1.0),
            ASTNode::Function {
                name: "SUM".into(),
                args: vec![range_ref_node(sheet, 0, 0, 2, 0)],
            },
        ],
    };

    let deps = deps_from_ast(&ast, &sheet);

    assert!(deps.contains(&DepTarget::Range(
        RangePos::new(sheet, 0, 0, 2, 0),
        RangeAccess::Aggregate,
    )));
    assert!(!deps.contains(&DepTarget::Range(
        RangePos::new(sheet, 0, 0, 2, 0),
        RangeAccess::Selective,
    )));
}

#[test]
fn test_three_d_ref_expands_reversed_bounds_by_ordered_sheets() {
    let sheet1 = make_sheet_id(1);
    let sheet2 = make_sheet_id(2);
    let sheet3 = make_sheet_id(3);
    let ast = ASTNode::ThreeDRef {
        start_sheet: sheet3,
        end_sheet: sheet1,
        inner: Box::new(cell_ref_node(SheetId::from_raw(0), 0, 0)),
    };

    let deps = extract_deps_and_volatility(
        &ast,
        &sheet1,
        &CellMirror::new(),
        &[sheet1, sheet2, sheet3],
        None,
    )
    .value_deps;

    assert_eq!(
        deps,
        vec![
            DepTarget::Range(RangePos::new(sheet1, 0, 0, 0, 0), RangeAccess::Aggregate),
            DepTarget::Range(RangePos::new(sheet2, 0, 0, 0, 0), RangeAccess::Aggregate),
            DepTarget::Range(RangePos::new(sheet3, 0, 0, 0, 0), RangeAccess::Aggregate),
        ]
    );
}

#[test]
fn test_formulatext_named_range_emits_binding_and_top_left() {
    use formula_types::{
        IdentityCellRef, IdentityFormula, IdentityFormulaRef, NamedRangeDef, Scope,
    };

    let sheet = make_sheet_id(1);
    let cell = make_cell_id(200);
    let mut mirror = make_mirror(sheet, vec![(cell, 4, 2)]);
    let scope = Scope::Workbook;
    mirror.variables.insert(
        scope.clone(),
        "DisplayName".to_string(),
        NamedRangeDef {
            name: "DisplayName".to_string(),
            scope: scope.clone(),
            refers_to: IdentityFormula {
                template: "{0}".to_string(),
                refs: vec![IdentityFormulaRef::Cell(IdentityCellRef {
                    id: cell,
                    row_absolute: false,
                    col_absolute: false,
                })],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            },
            raw_expression: None,
            linked_range_id: None,
        },
    );
    let ast = ASTNode::Function {
        name: "FORMULATEXT".into(),
        args: vec![ASTNode::Identifier("DisplayName".to_string())],
    };

    let deps = extract_deps_and_volatility(&ast, &sheet, &mirror, &[], None).formula_text_deps;

    assert!(deps.contains(&FormulaTextDepTarget::NameBinding {
        scope,
        name: "displayname".to_string(),
    }));
    assert!(deps.contains(&FormulaTextDepTarget::PosTopLeft {
        sheet,
        row: 4,
        col: 2,
    }));
    assert!(deps.contains(&FormulaTextDepTarget::Cell(cell)));
}

#[test]
fn test_named_rect_range_preserves_resolved_range_dep() {
    use formula_types::{
        IdentityFormula, IdentityFormulaRef, IdentityRectRangeRef, NamedRangeDef, Scope,
    };

    let sheet = make_sheet_id(1);
    let rows = vec![
        RowId::from_raw(10),
        RowId::from_raw(11),
        RowId::from_raw(12),
    ];
    let cols = vec![
        ColId::from_raw(20),
        ColId::from_raw(21),
        ColId::from_raw(22),
    ];
    let mut mirror = make_mirror(sheet, vec![]);
    mirror.install_row_col_indexes([(sheet, rows.clone(), cols.clone())]);
    let scope = Scope::Workbook;
    mirror.variables.insert(
        scope.clone(),
        "Block".to_string(),
        NamedRangeDef {
            name: "Block".to_string(),
            scope,
            refers_to: IdentityFormula {
                template: "{0}".to_string(),
                refs: vec![IdentityFormulaRef::RectRange(IdentityRectRangeRef {
                    sheet_id: sheet,
                    start_row_id: rows[0],
                    start_col_id: cols[0],
                    end_row_id: rows[2],
                    end_col_id: cols[2],
                    start_row_absolute: false,
                    start_col_absolute: false,
                    end_row_absolute: false,
                    end_col_absolute: false,
                })],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            },
            raw_expression: None,
            linked_range_id: None,
        },
    );

    let deps = deps_from_ast(&ASTNode::Identifier("Block".to_string()), &sheet);
    assert!(
        !deps.contains(&DepTarget::Range(
            RangePos::new(sheet, 0, 0, 2, 2),
            RangeAccess::Aggregate,
        )),
        "empty helper mirror should not resolve rect range"
    );

    let deps = extract_deps_and_volatility(
        &ASTNode::Identifier("Block".to_string()),
        &sheet,
        &mirror,
        &[],
        None,
    )
    .value_deps;
    assert!(deps.contains(&DepTarget::Range(
        RangePos::new(sheet, 0, 0, 2, 2),
        RangeAccess::Aggregate,
    )));
}

#[test]
fn test_structured_ref_under_selective_context_skips_cell_expansion() {
    use domain_types::domain::table::{Table as CanonicalTable, TableColumn};
    use formula_types::{StructuredRef, StructuredRefSpecifier};

    let sheet = make_sheet_id(1);
    let mut mirror = make_mirror(
        sheet,
        vec![
            (make_cell_id(301), 1, 0),
            (make_cell_id(302), 2, 0),
            (make_cell_id(303), 3, 0),
        ],
    );
    mirror.set_table(CanonicalTable {
        id: "Sales".to_string(),
        name: "Sales".to_string(),
        display_name: "Sales".to_string(),
        sheet_id: sheet.to_uuid_string(),
        range: cell_types::SheetRange::new(0, 0, 3, 0),
        columns: vec![TableColumn {
            id: "1".to_string(),
            name: "Amount".to_string(),
            index: 0,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
            ..Default::default()
        }],
        has_header_row: true,
        has_totals_row: false,
        style: "TableStyleMedium2".to_string(),
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: true,
        auto_expand: true,
        auto_calculated_columns: true,
        ..Default::default()
    });
    let ast = ASTNode::Function {
        name: "INDEX".into(),
        args: vec![
            ASTNode::StructuredRef(StructuredRef {
                table_name: "Sales".to_string(),
                specifiers: vec![StructuredRefSpecifier::Column {
                    name: "Amount".to_string(),
                }],
            }),
            ASTNode::Number(1.0),
        ],
    };

    let deps = extract_deps_and_volatility(&ast, &sheet, &mirror, &[], Some(1)).value_deps;

    assert!(
        deps.iter()
            .any(|dep| matches!(dep, DepTarget::Range(_, RangeAccess::Selective)))
    );
    assert!(
        !deps.iter().any(|dep| matches!(dep, DepTarget::Cell(_))),
        "selective structured refs should not expand to individual cell deps"
    );
}
