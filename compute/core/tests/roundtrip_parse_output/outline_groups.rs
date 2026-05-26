use super::helpers::*;
use domain_types::OutlineGroup;
use value_types::{CellValue, FiniteF64};

#[test]
fn roundtrip_outline_groups_row() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap())),
            cell(5, 0, CellValue::Number(FiniteF64::new(2.0).unwrap())),
        ],
    );
    output.sheets[0].outline_groups = vec![OutlineGroup {
        is_row: true,
        start: 1,
        end: 4,
        level: 1,
        collapsed: false,
        hidden: false,
        collapsed_on_member: false,
    }];
    let rt = roundtrip(&output);
    // Outline groups may be reconstructed from row/col outline levels,
    // so check that at least one row outline group exists covering the range.
    let row_groups: Vec<&OutlineGroup> = rt.sheets[0]
        .outline_groups
        .iter()
        .filter(|g| g.is_row)
        .collect();
    assert!(
        !row_groups.is_empty(),
        "row outline groups should survive round-trip"
    );
    let g = row_groups[0];
    assert_eq!(g.start, 1);
    assert_eq!(g.end, 4);
    assert_eq!(g.level, 1);
}

#[test]
fn roundtrip_outline_groups_col() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap())),
            cell(0, 5, CellValue::Number(FiniteF64::new(2.0).unwrap())),
        ],
    );
    output.sheets[0].outline_groups = vec![OutlineGroup {
        is_row: false,
        start: 1,
        end: 3,
        level: 1,
        collapsed: false,
        hidden: false,
        collapsed_on_member: false,
    }];
    let rt = roundtrip(&output);
    let col_groups: Vec<&OutlineGroup> = rt.sheets[0]
        .outline_groups
        .iter()
        .filter(|g| !g.is_row)
        .collect();
    assert!(
        !col_groups.is_empty(),
        "column outline groups should survive round-trip"
    );
    let g = col_groups[0];
    assert_eq!(g.start, 1);
    assert_eq!(g.end, 3);
    assert_eq!(g.level, 1);
}
