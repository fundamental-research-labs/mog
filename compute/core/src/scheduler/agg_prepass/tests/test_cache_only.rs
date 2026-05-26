use super::*;

// -----------------------------------------------------------------------
// detect_cache_only_patterns -- SUMIFS inside IF/IFERROR wrappers
// -----------------------------------------------------------------------

#[test]
fn test_detect_cache_only_patterns_if_wrapped() {
    // IF($D6="", "", SUMIFS(C:C, A:A, E_row, B:B, F_row))
    // The SUMIFS pattern should be detected as a cache-only pattern.
    let s = sheet_id_1();
    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    for row in 0..4u32 {
        let id = cell_id(900 + row as u128);
        dirty.insert(id);
        pos_map.insert(id, (s, row, 7));

        ast_map.insert(
            id,
            ASTNode::Function {
                name: Cow::Borrowed("IF"),
                args: vec![
                    ASTNode::BinaryOp {
                        op: compute_parser::BinOp::Eq,
                        left: Box::new(dynamic_ref_node(3, row)),
                        right: Box::new(ASTNode::Text("".to_string())),
                    },
                    ASTNode::Text("".to_string()),
                    sumifs_node(row),
                ],
            },
        );
    }

    let resolved_set = FxHashSet::default();
    let patterns = detect_cache_only_patterns(
        &dirty,
        &resolved_set,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
    );

    // Should find exactly one unique SUMIFS pattern
    assert_eq!(patterns.len(), 1);
    assert_eq!(patterns[0].agg_fn, AggFn::SumIfs);
    assert_eq!(patterns[0].pairs.len(), 2);
    assert_eq!(patterns[0].value_range.unwrap().1, 2); // sum over col C
}

#[test]
fn test_detect_cache_only_patterns_iferror_wrapped() {
    // IFERROR(SUMIFS(C:C, A:A, E_row, B:B, F_row), "")
    let s = sheet_id_1();
    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    let id = cell_id(950);
    dirty.insert(id);
    pos_map.insert(id, (s, 0, 7));
    ast_map.insert(
        id,
        ASTNode::Function {
            name: Cow::Borrowed("IFERROR"),
            args: vec![sumifs_node(0), ASTNode::Text("".to_string())],
        },
    );

    let resolved_set = FxHashSet::default();
    let patterns = detect_cache_only_patterns(
        &dirty,
        &resolved_set,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
    );

    assert_eq!(patterns.len(), 1);
    assert_eq!(patterns[0].agg_fn, AggFn::SumIfs);
}

#[test]
fn test_detect_cache_only_patterns_nested_if_iferror() {
    // IF($D6="", "", IF(SUMIFS(...)=0, "", IFERROR(SUMIFS(...)/expr, "")))
    // Should find the SUMIFS pattern even through deep nesting.
    let s = sheet_id_1();
    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    let inner_iferror = ASTNode::Function {
        name: Cow::Borrowed("IFERROR"),
        args: vec![
            ASTNode::BinaryOp {
                op: compute_parser::BinOp::Div,
                left: Box::new(sumifs_node(5)),
                right: Box::new(dynamic_ref_node(3, 5)),
            },
            ASTNode::Text("".to_string()),
        ],
    };

    let inner_if = ASTNode::Function {
        name: Cow::Borrowed("IF"),
        args: vec![
            ASTNode::BinaryOp {
                op: compute_parser::BinOp::Eq,
                left: Box::new(sumifs_node(5)),
                right: Box::new(ASTNode::Number(0.0)),
            },
            ASTNode::Text("".to_string()),
            inner_iferror,
        ],
    };

    let outer_if = ASTNode::Function {
        name: Cow::Borrowed("IF"),
        args: vec![
            ASTNode::BinaryOp {
                op: compute_parser::BinOp::Eq,
                left: Box::new(dynamic_ref_node(3, 5)),
                right: Box::new(ASTNode::Text("".to_string())),
            },
            ASTNode::Text("".to_string()),
            inner_if,
        ],
    };

    let id = cell_id(960);
    dirty.insert(id);
    pos_map.insert(id, (s, 5, 7));
    ast_map.insert(id, outer_if);

    let resolved_set = FxHashSet::default();
    let patterns = detect_cache_only_patterns(
        &dirty,
        &resolved_set,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
    );

    // Should find one unique SUMIFS pattern (both SUMIFS calls have the same
    // pattern since they use the same ranges and criteria structure)
    assert_eq!(patterns.len(), 1);
    assert_eq!(patterns[0].agg_fn, AggFn::SumIfs);
    assert_eq!(patterns[0].pairs.len(), 2);
}

#[test]
fn test_detect_cache_only_patterns_multiple_sumifs_different_ranges() {
    // (SUMIFS(C:C, A:A, E5, B:B, F5) - SUMIFS(D:D, A:A, E5, B:B, F5)) / $C5
    // Two SUMIFS with different value ranges -> two patterns
    let s = sheet_id_1();

    let sumifs1 = ASTNode::Function {
        name: Cow::Borrowed("SUMIFS"),
        args: vec![
            col_range_node(2), // C:C
            col_range_node(0),
            dynamic_ref_node(4, 5),
            col_range_node(1),
            dynamic_ref_node(5, 5),
        ],
    };

    let sumifs2 = ASTNode::Function {
        name: Cow::Borrowed("SUMIFS"),
        args: vec![
            col_range_node(3), // D:D (different sum range)
            col_range_node(0),
            dynamic_ref_node(4, 5),
            col_range_node(1),
            dynamic_ref_node(5, 5),
        ],
    };

    let subtraction = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Sub,
        left: Box::new(sumifs1),
        right: Box::new(sumifs2),
    };

    let div = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Div,
        left: Box::new(ASTNode::Paren(Box::new(subtraction))),
        right: Box::new(dynamic_ref_node(2, 5)),
    };

    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    let id = cell_id(970);
    dirty.insert(id);
    pos_map.insert(id, (s, 5, 7));
    ast_map.insert(id, div);

    let resolved_set = FxHashSet::default();
    let patterns = detect_cache_only_patterns(
        &dirty,
        &resolved_set,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
    );

    // Two distinct patterns (different sum ranges)
    assert_eq!(patterns.len(), 2);
}

#[test]
fn test_detect_cache_only_patterns_excludes_already_resolved() {
    // Cells already resolved by the direct prepass should be excluded
    let s = sheet_id_1();
    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    let id = cell_id(980);
    dirty.insert(id);
    pos_map.insert(id, (s, 0, 7));
    ast_map.insert(
        id,
        ASTNode::Function {
            name: Cow::Borrowed("IF"),
            args: vec![
                ASTNode::Text("foo".to_string()),
                sumifs_node(0),
                ASTNode::Number(0.0),
            ],
        },
    );

    // Mark as already resolved
    let mut resolved_set = FxHashSet::default();
    resolved_set.insert(id);

    let patterns = detect_cache_only_patterns(
        &dirty,
        &resolved_set,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
    );

    assert!(patterns.is_empty());
}

#[test]
fn test_detect_cache_only_patterns_skips_direct_sumifs() {
    // A bare SUMIFS (no wrapper) should NOT be picked up as cache-only
    let s = sheet_id_1();
    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    let id = cell_id(990);
    dirty.insert(id);
    pos_map.insert(id, (s, 0, 7));
    ast_map.insert(id, sumifs_node(0));

    let resolved_set = FxHashSet::default();
    let patterns = detect_cache_only_patterns(
        &dirty,
        &resolved_set,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
    );

    // Direct SUMIFS is handled by the direct prepass, not cache-only
    assert!(patterns.is_empty());
}

#[test]
fn test_detect_cache_only_patterns_skips_countifs() {
    // COUNTIFS inside IF should NOT be cache-only (sumifs_result_cache only handles sums)
    let s = sheet_id_1();
    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    let countifs = ASTNode::Function {
        name: Cow::Borrowed("COUNTIFS"),
        args: vec![
            col_range_node(0),
            dynamic_ref_node(4, 0),
            col_range_node(1),
            dynamic_ref_node(5, 0),
        ],
    };

    let id = cell_id(995);
    dirty.insert(id);
    pos_map.insert(id, (s, 0, 7));
    ast_map.insert(
        id,
        ASTNode::Function {
            name: Cow::Borrowed("IF"),
            args: vec![
                ASTNode::Text("foo".to_string()),
                countifs,
                ASTNode::Number(0.0),
            ],
        },
    );

    let resolved_set = FxHashSet::default();
    let patterns = detect_cache_only_patterns(
        &dirty,
        &resolved_set,
        |id| ast_map.get(id),
        &MapResolver(&pos_map),
    );

    // COUNTIFS is not suitable for sumifs_result_cache
    assert!(patterns.is_empty());
}

#[test]
fn test_warm_sumifs_result_cache_basic() {
    // Test that warm_sumifs_result_cache correctly pre-populates the cache
    compute_functions::helpers::sumifs_result_cache::clear();

    let mirror = test_mirror();
    let s = sheet_id_1();

    // Pattern: SUMIFS(C1:C5, A1:A5, <dynamic>)
    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 2, 0, 5)),
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::Dynamic { sheet: s, col: 4 },
        }]),
    };

    let no_formulas = |_: &SheetId, _: u32, _: u32, _: u32| false;
    let domain = compute_functions::helpers::sumifs_result_cache::new_cache_domain();
    let epoch = compute_functions::helpers::sumifs_result_cache::begin_recalc_epoch(domain);
    let warmed = warm_sumifs_result_cache(&[pattern], &mirror, &no_formulas, epoch);
    assert_eq!(warmed, 1);

    // Now verify the cache was populated by doing a lookup with the same slices
    let sheet = mirror.get_sheet(&s).unwrap();
    let crit_slice = sheet.get_column_slice(0).unwrap();
    let sum_slice = sheet.get_column_slice(2).unwrap();

    // "X" rows: 0(10), 2(30), 4(50) = 90
    let key_x = vec![NormalizedKey::from_cell_value(&CellValue::Text("X".into()))];
    let cache_key = compute_functions::helpers::sumifs_result_cache::SumifsCacheKey::new(
        epoch,
        5,
        compute_functions::helpers::sumifs_result_cache::SumifsRangeIdentity::sum_range(
            s.as_u128(),
            2,
            0,
            5,
            5,
        ),
        vec![
            compute_functions::helpers::sumifs_result_cache::SumifsRangeIdentity::criteria_range(
                0,
                s.as_u128(),
                0,
                0,
                5,
                5,
            ),
        ],
    );
    let result = compute_functions::helpers::sumifs_result_cache::sumifs_lookup(
        &cache_key,
        &[&crit_slice[0..5]],
        &sum_slice[0..5],
        5,
        &key_x,
    );
    assert_eq!(result.unwrap(), 90.0);

    compute_functions::helpers::sumifs_result_cache::clear();
}

#[test]
fn test_warm_sumifs_result_cache_skips_stale_data() {
    // When data columns have dirty formulas, warming should skip
    compute_functions::helpers::sumifs_result_cache::clear();

    let mirror = test_mirror();
    let s = sheet_id_1();

    let pattern = AggPattern {
        agg_fn: AggFn::SumIfs,
        value_range: Some((s, 2, 0, 5)),
        pairs: SmallVec::from_vec(vec![AggCriteriaPair {
            data_sheet: s,
            data_col: 0,
            data_start_row: 0,
            data_end_row: 5,
            criteria: CriteriaSource::Dynamic { sheet: s, col: 4 },
        }]),
    };

    let has_formulas = |_: &SheetId, _: u32, _: u32, _: u32| true;
    let domain = compute_functions::helpers::sumifs_result_cache::new_cache_domain();
    let epoch = compute_functions::helpers::sumifs_result_cache::begin_recalc_epoch(domain);
    let warmed = warm_sumifs_result_cache(&[pattern], &mirror, &has_formulas, epoch);
    assert_eq!(warmed, 0);

    compute_functions::helpers::sumifs_result_cache::clear();
}
