use workbook_types::ExternalDepTarget;

use crate::identity_formula::{
    DepEdge, DepEdges, IdentityCellRef, IdentityColRangeRef, IdentityFormulaRef,
    IdentityFullColRef, IdentityFullRowRef, IdentityRangeRef, IdentityRectRangeRef,
    IdentityRowRangeRef, RefStyle, ReferenceTarget,
};

use super::helpers::{
    TestLookup, cell, col, external_cell_ref, external_name_ref, external_range_ref, row, sheet,
};

fn display_body<T: ReferenceTarget>(target: &T, lookup: &TestLookup, style: RefStyle) -> String {
    let mut out = String::new();
    target.display_body(lookup, style, &mut out);
    out
}

#[test]
fn cell_ref_resolved_sheet_returns_cells_sheet() {
    let mut lookup = TestLookup::with_formula_sheet(sheet(1));
    lookup.cells.insert(cell(1), (sheet(7), 0, 0));
    let r = IdentityCellRef {
        id: cell(1),
        row_absolute: false,
        col_absolute: false,
    };
    assert_eq!(r.resolved_sheet(&lookup), Some(sheet(7)));
}

#[test]
fn cell_ref_dep_edges_emits_cell_edge() {
    let r = IdentityCellRef {
        id: cell(1),
        row_absolute: false,
        col_absolute: false,
    };
    let mut edges = DepEdges::default();
    r.dep_edges(&mut edges);
    assert_eq!(edges.edges, vec![DepEdge::Cell(cell(1))]);
}

#[test]
fn full_row_ref_resolved_sheet_returns_row_sheet() {
    let mut lookup = TestLookup::with_formula_sheet(sheet(1));
    lookup.rows.insert(row(10), (sheet(2), 5));
    let r = IdentityFullRowRef {
        row_id: row(10),
        absolute: false,
    };
    assert_eq!(r.resolved_sheet(&lookup), Some(sheet(2)));
}

#[test]
fn row_and_col_refs_resolve_sheet_through_row_and_col_lookup() {
    let mut lookup = TestLookup::with_formula_sheet(sheet(1));
    lookup.rows.insert(row(1), (sheet(2), 0));
    lookup.rows.insert(row(2), (sheet(3), 1));
    lookup.cols.insert(col(1), (sheet(4), 0));
    lookup.cols.insert(col(2), (sheet(5), 1));

    assert_eq!(
        IdentityFullRowRef {
            row_id: row(1),
            absolute: false,
        }
        .resolved_sheet(&lookup),
        Some(sheet(2))
    );
    assert_eq!(
        IdentityRowRangeRef {
            start_row_id: row(2),
            end_row_id: row(1),
            start_absolute: false,
            end_absolute: false,
        }
        .resolved_sheet(&lookup),
        Some(sheet(3))
    );
    assert_eq!(
        IdentityFullColRef {
            col_id: col(1),
            absolute: false,
        }
        .resolved_sheet(&lookup),
        Some(sheet(4))
    );
    assert_eq!(
        IdentityColRangeRef {
            start_col_id: col(2),
            end_col_id: col(1),
            start_absolute: false,
            end_absolute: false,
        }
        .resolved_sheet(&lookup),
        Some(sheet(5))
    );
}

#[test]
fn rect_range_display_ref_when_any_identity_resolves_to_different_sheet() {
    let mut lookup = TestLookup::with_formula_sheet(sheet(1));
    lookup.rows.insert(row(1), (sheet(1), 0));
    lookup.rows.insert(row(2), (sheet(1), 1));
    lookup.cols.insert(col(1), (sheet(1), 0));
    lookup.cols.insert(col(2), (sheet(2), 1));
    let r = IdentityRectRangeRef {
        sheet_id: sheet(1),
        start_row_id: row(1),
        start_col_id: col(1),
        end_row_id: row(2),
        end_col_id: col(2),
        start_row_absolute: false,
        start_col_absolute: false,
        end_row_absolute: false,
        end_col_absolute: false,
    };

    assert_eq!(r.resolved_sheet(&lookup), None);
    assert_eq!(display_body(&r, &lookup, RefStyle::A1), "#REF!");
}

#[test]
fn r1c1_relative_zero_offsets_render_bare_row_and_col_parts() {
    let mut lookup = TestLookup::with_formula_sheet(sheet(1));
    lookup.cells.insert(cell(1), (sheet(1), 4, 6));
    lookup.cells.insert(cell(2), (sheet(1), 4, 6));
    lookup.rows.insert(row(1), (sheet(1), 4));
    lookup.rows.insert(row(2), (sheet(1), 4));
    lookup.cols.insert(col(1), (sheet(1), 6));
    lookup.cols.insert(col(2), (sheet(1), 6));
    let style = RefStyle::R1C1 {
        base_row: 4,
        base_col: 6,
    };

    assert_eq!(
        display_body(
            &IdentityCellRef {
                id: cell(1),
                row_absolute: false,
                col_absolute: false,
            },
            &lookup,
            style
        ),
        "RC"
    );
    assert_eq!(
        display_body(
            &IdentityRangeRef {
                start_id: cell(1),
                end_id: cell(2),
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: false,
                end_col_absolute: false,
            },
            &lookup,
            style
        ),
        "RC:RC"
    );
    assert_eq!(
        display_body(
            &IdentityFullRowRef {
                row_id: row(1),
                absolute: false,
            },
            &lookup,
            style
        ),
        "R:R"
    );
    assert_eq!(
        display_body(
            &IdentityRowRangeRef {
                start_row_id: row(1),
                end_row_id: row(2),
                start_absolute: false,
                end_absolute: false,
            },
            &lookup,
            style
        ),
        "R:R"
    );
    assert_eq!(
        display_body(
            &IdentityFullColRef {
                col_id: col(1),
                absolute: false,
            },
            &lookup,
            style
        ),
        "C:C"
    );
    assert_eq!(
        display_body(
            &IdentityColRangeRef {
                start_col_id: col(1),
                end_col_id: col(2),
                start_absolute: false,
                end_absolute: false,
            },
            &lookup,
            style
        ),
        "C:C"
    );
}

#[test]
fn dangling_local_targets_display_ref_but_keep_dependency_edges() {
    let lookup = TestLookup::with_formula_sheet(sheet(1));
    let cases: Vec<(IdentityFormulaRef, DepEdge)> = vec![
        (
            IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(1),
                row_absolute: false,
                col_absolute: false,
            }),
            DepEdge::Cell(cell(1)),
        ),
        (
            IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell(2),
                end_id: cell(3),
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: false,
                end_col_absolute: false,
            }),
            DepEdge::Range {
                start: cell(2),
                end: cell(3),
            },
        ),
        (
            IdentityFormulaRef::RectRange(IdentityRectRangeRef {
                sheet_id: sheet(1),
                start_row_id: row(1),
                start_col_id: col(1),
                end_row_id: row(2),
                end_col_id: col(2),
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: false,
                end_col_absolute: false,
            }),
            DepEdge::RectRange {
                sheet: sheet(1),
                start_row: row(1),
                end_row: row(2),
                start_col: col(1),
                end_col: col(2),
            },
        ),
        (
            IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row(3),
                absolute: false,
            }),
            DepEdge::Row(row(3)),
        ),
        (
            IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col(3),
                absolute: false,
            }),
            DepEdge::Col(col(3)),
        ),
    ];

    for (target, expected_edge) in cases {
        assert_eq!(display_body(&target, &lookup, RefStyle::A1), "#REF!");
        let mut edges = DepEdges::default();
        target.dep_edges(&mut edges);
        assert_eq!(edges.edges, vec![expected_edge]);
    }
}

#[test]
fn external_refs_display_ref_and_emit_external_edges() {
    let lookup = TestLookup::with_formula_sheet(sheet(1));
    let cell_ref = external_cell_ref(1);
    let range_ref = external_range_ref(2);
    let name_ref = external_name_ref(3);
    let cases = vec![
        (
            IdentityFormulaRef::ExternalCell(cell_ref.clone()),
            DepEdge::External(ExternalDepTarget::Cell(cell_ref)),
        ),
        (
            IdentityFormulaRef::ExternalRange(range_ref.clone()),
            DepEdge::External(ExternalDepTarget::Range(range_ref)),
        ),
        (
            IdentityFormulaRef::ExternalName(name_ref.clone()),
            DepEdge::External(ExternalDepTarget::Name(name_ref)),
        ),
    ];

    for (target, expected_edge) in cases {
        assert_eq!(target.resolved_sheet(&lookup), None);
        assert_eq!(display_body(&target, &lookup, RefStyle::A1), "#REF!");
        let mut edges = DepEdges::default();
        target.dep_edges(&mut edges);
        assert_eq!(edges.edges, vec![expected_edge]);
    }
}
