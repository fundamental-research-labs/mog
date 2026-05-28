use workbook_types::ExternalDepTarget;

use crate::identity_formula::{
    DepEdge, DepEdges, FormulaDeps, IdentityCellRef, IdentityColRangeRef, IdentityFormula,
    IdentityFormulaRef, IdentityFullColRef, IdentityFullRowRef, IdentityRangeRef,
    IdentityRectRangeRef, IdentityRowRangeRef,
};

use super::helpers::{
    cell, col, external_cell_ref, external_name_ref, external_range_ref, row, sheet,
};

#[test]
fn extract_dep_ids_mixed_refs() {
    let formula = IdentityFormula {
        template: "{0}+{1}+{2}+{3}".to_string(),
        refs: vec![
            IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(1),
                row_absolute: false,
                col_absolute: false,
            }),
            IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell(10),
                end_id: cell(20),
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: false,
                end_col_absolute: false,
            }),
            IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row(100),
                absolute: false,
            }),
            IdentityFormulaRef::RowRange(IdentityRowRangeRef {
                start_row_id: row(200),
                end_row_id: row(205),
                start_absolute: false,
                end_absolute: false,
            }),
            IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col(300),
                absolute: false,
            }),
            IdentityFormulaRef::ColRange(IdentityColRangeRef {
                start_col_id: col(400),
                end_col_id: col(403),
                start_absolute: false,
                end_absolute: false,
            }),
        ],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };

    let deps = formula.extract_dep_ids();

    assert_eq!(deps.cell_ids, vec![cell(1), cell(10), cell(20)]);
    assert_eq!(deps.row_ids, vec![row(100), row(200), row(205)]);
    assert_eq!(deps.col_ids, vec![col(300), col(400), col(403)]);
}

#[test]
fn extract_dep_ids_empty_refs() {
    let formula = IdentityFormula {
        template: "42".to_string(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    let deps = formula.extract_dep_ids();
    assert!(deps.cell_ids.is_empty());
    assert!(deps.row_ids.is_empty());
    assert!(deps.col_ids.is_empty());
}

#[test]
fn extract_dep_edges_mixed_refs() {
    let formula = IdentityFormula {
        template: "{0}+{1}".to_string(),
        refs: vec![
            IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(1),
                row_absolute: false,
                col_absolute: false,
            }),
            IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell(2),
                end_id: cell(3),
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: false,
                end_col_absolute: false,
            }),
        ],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    let edges = formula.extract_dep_edges();
    assert_eq!(
        edges.edges,
        vec![
            DepEdge::Cell(cell(1)),
            DepEdge::Range {
                start: cell(2),
                end: cell(3)
            }
        ]
    );
}

#[test]
fn formula_deps_from_edges_preserves_external_order() {
    let cell_ref = external_cell_ref(1);
    let range_ref = external_range_ref(2);
    let name_ref = external_name_ref(3);
    let edges = DepEdges {
        edges: vec![
            DepEdge::External(ExternalDepTarget::Cell(cell_ref.clone())),
            DepEdge::External(ExternalDepTarget::Range(range_ref.clone())),
            DepEdge::External(ExternalDepTarget::Name(name_ref.clone())),
        ],
    };
    let deps = FormulaDeps::from_edges(&edges);
    assert_eq!(
        deps.external,
        vec![
            ExternalDepTarget::Cell(cell_ref),
            ExternalDepTarget::Range(range_ref),
            ExternalDepTarget::Name(name_ref),
        ]
    );
}

#[test]
fn rect_range_flattens_to_row_and_col_ids() {
    let edges = DepEdges {
        edges: vec![DepEdge::RectRange {
            sheet: sheet(1),
            start_row: row(1),
            end_row: row(2),
            start_col: col(3),
            end_col: col(4),
        }],
    };
    let deps = FormulaDeps::from_edges(&edges);
    assert!(deps.cell_ids.is_empty());
    assert_eq!(deps.row_ids, vec![row(1), row(2)]);
    assert_eq!(deps.col_ids, vec![col(3), col(4)]);
}

#[test]
fn name_edges_are_dropped_by_compat_deps() {
    let edges = DepEdges {
        edges: vec![DepEdge::Name(cell_types::NameId::from_raw(7))],
    };
    let deps = FormulaDeps::from_edges(&edges);
    assert_eq!(deps, FormulaDeps::default());
}

#[test]
fn extract_dep_edges_includes_external_refs() {
    let cell_ref = external_cell_ref(1);
    let range_ref = external_range_ref(2);
    let name_ref = external_name_ref(3);
    let formula = IdentityFormula {
        template: "{0}+{1}+{2}".to_string(),
        refs: vec![
            IdentityFormulaRef::ExternalCell(cell_ref.clone()),
            IdentityFormulaRef::ExternalRange(range_ref.clone()),
            IdentityFormulaRef::ExternalName(name_ref.clone()),
        ],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    assert_eq!(
        formula.extract_dep_edges().edges,
        vec![
            DepEdge::External(ExternalDepTarget::Cell(cell_ref)),
            DepEdge::External(ExternalDepTarget::Range(range_ref)),
            DepEdge::External(ExternalDepTarget::Name(name_ref)),
        ]
    );
}

#[test]
fn extract_dep_ids_includes_rect_range_rows_and_cols() {
    let formula = IdentityFormula {
        template: "{0}".to_string(),
        refs: vec![IdentityFormulaRef::RectRange(IdentityRectRangeRef {
            sheet_id: sheet(1),
            start_row_id: row(10),
            start_col_id: col(20),
            end_row_id: row(11),
            end_col_id: col(21),
            start_row_absolute: false,
            start_col_absolute: false,
            end_row_absolute: false,
            end_col_absolute: false,
        })],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    let deps = formula.extract_dep_ids();
    assert_eq!(deps.row_ids, vec![row(10), row(11)]);
    assert_eq!(deps.col_ids, vec![col(20), col(21)]);
}
