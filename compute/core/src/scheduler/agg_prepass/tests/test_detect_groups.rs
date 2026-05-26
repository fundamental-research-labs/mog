use super::*;

// -----------------------------------------------------------------------
// detect_agg_groups
// -----------------------------------------------------------------------

#[test]
fn test_detect_agg_groups_basic() {
    let s = sheet_id_1();

    // Build 4 dirty cells in a column, all with same COUNTIFS pattern.
    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    for row in 0..4u32 {
        let id = cell_id(100 + row as u128);
        dirty.insert(id);
        pos_map.insert(id, (s, row, 5)); // col 5

        ast_map.insert(
            id,
            ASTNode::Function {
                name: Cow::Borrowed("COUNTIFS"),
                args: vec![col_range_node(0), dynamic_ref_node(4, row)],
            },
        );
    }

    let groups = detect_agg_groups(
        &dirty,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
        2, // min group size
    );

    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].cell_ids.len(), 4);
    assert_eq!(groups[0].start_row, 0);
    assert_eq!(groups[0].end_row, 4); // exclusive
}

#[test]
fn test_detect_agg_groups_filters_small() {
    let s = sheet_id_1();
    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    // Only 2 cells -- below min_group_size of 3
    for row in 0..2u32 {
        let id = cell_id(200 + row as u128);
        dirty.insert(id);
        pos_map.insert(id, (s, row, 5));
        ast_map.insert(
            id,
            ASTNode::Function {
                name: Cow::Borrowed("COUNTIF"),
                args: vec![col_range_node(0), dynamic_ref_node(4, row)],
            },
        );
    }

    let groups = detect_agg_groups(
        &dirty,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
        3, // min group size
    );

    assert!(groups.is_empty());
}

// -----------------------------------------------------------------------
// Row-gap splitting in detect_agg_groups
// -----------------------------------------------------------------------

#[test]
fn test_detect_agg_groups_splits_at_row_gaps() {
    // Regression test: when non-SUMIFS cells create gaps between SUMIFS rows,
    // detect_agg_groups must split into separate groups. Previously it only
    // checked (sheet, col, pattern) without enforcing row-consecutiveness,
    // causing execute_agg_group to use `start_row + idx` for wrong criteria rows.
    let s = sheet_id_1();

    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    // Rows: 0,1,2 (consecutive), gap at 3, then 5,6,7,8 (consecutive).
    // Both spans have the same COUNTIFS pattern.
    let rows_with_pattern = [0u32, 1, 2, 5, 6, 7, 8];
    for &row in &rows_with_pattern {
        let id = cell_id(600 + row as u128);
        dirty.insert(id);
        pos_map.insert(id, (s, row, 5));
        ast_map.insert(
            id,
            ASTNode::Function {
                name: Cow::Borrowed("COUNTIFS"),
                args: vec![col_range_node(0), dynamic_ref_node(4, row)],
            },
        );
    }

    let groups = detect_agg_groups(
        &dirty,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
        2, // min group size
    );

    // Should produce TWO groups: [0,1,2] and [5,6,7,8]
    assert_eq!(
        groups.len(),
        2,
        "Expected 2 groups split at the row gap, got {}",
        groups.len()
    );
    assert_eq!(groups[0].start_row, 0);
    assert_eq!(groups[0].end_row, 3); // exclusive
    assert_eq!(groups[0].cell_ids.len(), 3);
    assert_eq!(groups[1].start_row, 5);
    assert_eq!(groups[1].end_row, 9); // exclusive
    assert_eq!(groups[1].cell_ids.len(), 4);
}

#[test]
fn test_detect_agg_groups_single_gap_filters_small() {
    // When a gap splits a group of 4 into two groups of 2,
    // both fall below min_group_size=3 and are filtered out.
    let s = sheet_id_1();

    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    // Rows: 0,1 (gap) 3,4 -- each sub-group has only 2 cells
    let rows = [0u32, 1, 3, 4];
    for &row in &rows {
        let id = cell_id(700 + row as u128);
        dirty.insert(id);
        pos_map.insert(id, (s, row, 5));
        ast_map.insert(
            id,
            ASTNode::Function {
                name: Cow::Borrowed("COUNTIFS"),
                args: vec![col_range_node(0), dynamic_ref_node(4, row)],
            },
        );
    }

    let groups = detect_agg_groups(
        &dirty,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
        3, // min group size
    );

    // Both sub-groups have 2 cells, below min_group_size=3 -> empty
    assert!(
        groups.is_empty(),
        "Expected no groups (both sub-groups too small), got {}",
        groups.len()
    );
}

#[test]
fn test_execute_agg_group_with_gaps_uses_correct_criteria() {
    // Demonstrates that execute_agg_group needs consecutive rows.
    // With the fix in detect_agg_groups, groups will always have consecutive rows,
    // so execute_agg_group's `start_row + idx` is correct.
    let mirror = test_mirror();
    let s = sheet_id_1();

    // Create a group of consecutive rows 0-4. This should work correctly.
    let pattern = AggPattern {
        agg_fn: AggFn::CountIfs,
        value_range: None,
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::Dynamic { sheet: s, col: 4 },
        }]),
    };

    let cell_ids: Vec<CellId> = (0..5).map(|i| cell_id(6000 + i)).collect();
    let group = AggFormulaGroup {
        sheet: s,
        col: 5,
        start_row: 0,
        end_row: 5,
        pattern,
        post_op: None,
        cell_ids,
    };

    let no_formulas = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let no_stale = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let results = execute_agg_group(&group, &mirror, no_formulas, no_stale).unwrap();

    // Criteria col 4 has: "X","Y","X","Y","X"
    // Col A has: "X","Y","X","Y","X"  -> X=3, Y=2
    assert_eq!(results[0].1, CellValue::number(3.0)); // row 0: "X" -> 3
    assert_eq!(results[1].1, CellValue::number(2.0)); // row 1: "Y" -> 2
    assert_eq!(results[2].1, CellValue::number(3.0)); // row 2: "X" -> 3
    assert_eq!(results[3].1, CellValue::number(2.0)); // row 3: "Y" -> 2
    assert_eq!(results[4].1, CellValue::number(3.0)); // row 4: "X" -> 3
}
