use super::*;

// -----------------------------------------------------------------------
// extract_agg_pattern: unwrapping IF/IFERROR/nested arithmetic
// -----------------------------------------------------------------------

#[test]
fn test_extract_through_iferror_wrapper() {
    // IFERROR(SUMIFS(...), "") -- extract_agg_pattern returns None (wrapper not used for cell resolution)
    // but extract_through_wrappers finds the pattern.
    let ast = ASTNode::Function {
        name: Cow::Borrowed("IFERROR"),
        args: vec![sumifs_node(0), ASTNode::Text("".to_string())],
    };

    // extract_agg_pattern should NOT extract through wrappers (would produce wrong cell values)
    assert!(extract_agg_pattern(&ast, sheet_id_1(), 0, 6, &NoopResolver).is_none());

    // But the internal extract_through_wrappers function finds the pattern
    let pattern =
        pattern::extract_through_wrappers(&ast, sheet_id_1(), 0, 6, &NoopResolver).unwrap();
    assert_eq!(pattern.agg_fn, AggFn::SumIfs);
    assert_eq!(pattern.pairs.len(), 2);
    assert_eq!(pattern.value_range.unwrap().1, 2); // sum over col C
}

#[test]
fn test_extract_through_if_then_branch() {
    // IF($D6="", "", SUMIFS(...)) -- wrapper not used for cell resolution
    let ast = ASTNode::Function {
        name: Cow::Borrowed("IF"),
        args: vec![
            ASTNode::BinaryOp {
                op: compute_parser::BinOp::Eq,
                left: Box::new(dynamic_ref_node(3, 5)),
                right: Box::new(ASTNode::Text("".to_string())),
            },
            ASTNode::Text("".to_string()),
            sumifs_node(5),
        ],
    };

    assert!(extract_agg_pattern(&ast, sheet_id_1(), 5, 6, &NoopResolver).is_none());
    let pattern =
        pattern::extract_through_wrappers(&ast, sheet_id_1(), 5, 6, &NoopResolver).unwrap();
    assert_eq!(pattern.agg_fn, AggFn::SumIfs);
    assert_eq!(pattern.pairs.len(), 2);
}

#[test]
fn test_extract_through_nested_if_iferror() {
    // IF($D6="", "", IF(SUMIFS(...)=0, "", IFERROR(SUMIFS(...)/expr, "")))
    // This mirrors the real "Inc % by Cohort" formula structure.
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

    assert!(extract_agg_pattern(&outer_if, sheet_id_1(), 5, 6, &NoopResolver).is_none());
    let pattern =
        pattern::extract_through_wrappers(&outer_if, sheet_id_1(), 5, 6, &NoopResolver).unwrap();
    assert_eq!(pattern.agg_fn, AggFn::SumIfs);
    assert_eq!(pattern.pairs.len(), 2);
}

#[test]
fn test_extract_through_nested_arithmetic() {
    // (SUMIFS(...) - SUMIFS(...)) / $C6 / $D6
    let subtraction = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Sub,
        left: Box::new(sumifs_node(5)),
        right: Box::new(sumifs_node(5)),
    };

    let paren = ASTNode::Paren(Box::new(subtraction));

    let div1 = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Div,
        left: Box::new(paren),
        right: Box::new(dynamic_ref_node(2, 5)),
    };

    let div2 = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Div,
        left: Box::new(div1),
        right: Box::new(dynamic_ref_node(3, 5)),
    };

    assert!(extract_agg_pattern(&div2, sheet_id_1(), 5, 6, &NoopResolver).is_none());
    let pattern =
        pattern::extract_through_wrappers(&div2, sheet_id_1(), 5, 6, &NoopResolver).unwrap();
    assert_eq!(pattern.agg_fn, AggFn::SumIfs);
    assert_eq!(pattern.pairs.len(), 2);
}

#[test]
fn test_extract_through_paren_wrapper() {
    // (SUMIFS(...))
    let ast = ASTNode::Paren(Box::new(sumifs_node(0)));

    assert!(extract_agg_pattern(&ast, sheet_id_1(), 0, 6, &NoopResolver).is_none());
    let pattern =
        pattern::extract_through_wrappers(&ast, sheet_id_1(), 0, 6, &NoopResolver).unwrap();
    assert_eq!(pattern.agg_fn, AggFn::SumIfs);
    assert_eq!(pattern.pairs.len(), 2);
}

#[test]
fn test_extract_through_ifna_wrapper() {
    // IFNA(SUMIFS(...), 0)
    let ast = ASTNode::Function {
        name: Cow::Borrowed("IFNA"),
        args: vec![sumifs_node(0), ASTNode::Number(0.0)],
    };

    assert!(extract_agg_pattern(&ast, sheet_id_1(), 0, 6, &NoopResolver).is_none());
    let pattern =
        pattern::extract_through_wrappers(&ast, sheet_id_1(), 0, 6, &NoopResolver).unwrap();
    assert_eq!(pattern.agg_fn, AggFn::SumIfs);
}

#[test]
fn test_extract_through_if_condition_branch() {
    // IF(SUMIFS(...)=0, "", "found")
    // The SUMIFS is in the condition, not in then/else.
    let ast = ASTNode::Function {
        name: Cow::Borrowed("IF"),
        args: vec![
            ASTNode::BinaryOp {
                op: compute_parser::BinOp::Eq,
                left: Box::new(sumifs_node(0)),
                right: Box::new(ASTNode::Number(0.0)),
            },
            ASTNode::Text("".to_string()),
            ASTNode::Text("found".to_string()),
        ],
    };

    assert!(extract_agg_pattern(&ast, sheet_id_1(), 0, 6, &NoopResolver).is_none());
    let pattern =
        pattern::extract_through_wrappers(&ast, sheet_id_1(), 0, 6, &NoopResolver).unwrap();
    assert_eq!(pattern.agg_fn, AggFn::SumIfs);
}

#[test]
fn test_extract_wrapper_still_rejects_non_agg() {
    // IF("foo", SUM(A:A), 0) -- SUM is not an agg function for the prepass
    let ast = ASTNode::Function {
        name: Cow::Borrowed("IF"),
        args: vec![
            ASTNode::Text("foo".to_string()),
            ASTNode::Function {
                name: Cow::Borrowed("SUM"),
                args: vec![col_range_node(0)],
            },
            ASTNode::Number(0.0),
        ],
    };

    assert!(extract_agg_pattern(&ast, sheet_id_1(), 0, 0, &NoopResolver).is_none());
}

#[test]
fn test_detect_groups_through_if_wrapper_not_grouped() {
    // IF-wrapped SUMIFS should NOT form groups (wrapper extraction disabled for cell resolution).
    // The prepass can't resolve wrapped formulas to correct cell values.
    let s = sheet_id_1();
    let mut dirty = FxHashSet::default();
    let mut ast_map: FxHashMap<CellId, ASTNode> = FxHashMap::default();
    let mut pos_map: FxHashMap<CellId, (SheetId, u32, u32)> = FxHashMap::default();

    for row in 0..4u32 {
        let id = cell_id(800 + row as u128);
        dirty.insert(id);
        pos_map.insert(id, (s, row, 7));

        // IF($D_row="", "", SUMIFS(C:C, A:A, E_row, B:B, F_row))
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

    let groups = detect_agg_groups(&dirty, |id| ast_map.get(id), &MapResolver(&pos_map), 2);

    // No groups -- wrapper extraction is disabled for cell resolution
    assert_eq!(groups.len(), 0);
}
