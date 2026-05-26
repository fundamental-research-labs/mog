use super::*;

// -----------------------------------------------------------------------
// extract_agg_pattern: COUNTIFS
// -----------------------------------------------------------------------

#[test]
fn test_extract_countifs_pattern() {
    // COUNTIFS(A:A, E1, B:B, "Widget")
    let ast = ASTNode::Function {
        name: Cow::Borrowed("COUNTIFS"),
        args: vec![
            col_range_node(0),                   // A:A
            dynamic_ref_node(4, 0),              // E1 (relative row)
            col_range_node(1),                   // B:B
            ASTNode::Text("Widget".to_string()), // "Widget" (static exact)
        ],
    };

    let (pattern, post_op) = extract_agg_pattern(&ast, sheet_id_1(), 0, 5, &NoopResolver).unwrap();
    assert!(post_op.is_none());
    assert_eq!(pattern.agg_fn, AggFn::CountIfs);
    assert!(pattern.value_range.is_none());
    assert_eq!(pattern.pairs.len(), 2);

    // First pair: A:A with dynamic E column
    assert_eq!(pattern.pairs[0].data_col, 0);
    assert!(matches!(
        pattern.pairs[0].criteria,
        CriteriaSource::Dynamic { col: 4, .. }
    ));

    // Second pair: B:B with static "Widget"
    assert_eq!(pattern.pairs[1].data_col, 1);
    assert!(matches!(
        pattern.pairs[1].criteria,
        CriteriaSource::StaticExact { .. }
    ));
}

// -----------------------------------------------------------------------
// extract_agg_pattern: SUMIF (2 args -- value_range defaults to criteria_range)
// -----------------------------------------------------------------------

#[test]
fn test_extract_sumif_2arg_pattern() {
    // SUMIF(A1:A100, ">50")
    let ast = ASTNode::Function {
        name: Cow::Borrowed("SUMIF"),
        args: vec![
            cell_range_node(0, 0, 99),        // A1:A100
            ASTNode::Text(">50".to_string()), // criteria with operator
        ],
    };

    let (pattern, post_op) = extract_agg_pattern(&ast, sheet_id_1(), 0, 2, &NoopResolver).unwrap();
    assert!(post_op.is_none());
    assert_eq!(pattern.agg_fn, AggFn::SumIf);

    // value_range should default to the criteria range (A1:A100)
    let vr = pattern.value_range.unwrap();
    assert_eq!(vr.1, 0); // col A
    assert_eq!(vr.2, 0); // start_row
    assert_eq!(vr.3, 100); // end_row (exclusive)

    assert_eq!(pattern.pairs.len(), 1);
    assert!(matches!(
        pattern.pairs[0].criteria,
        CriteriaSource::StaticFilter { ref text } if text == ">50"
    ));
}

// -----------------------------------------------------------------------
// extract_agg_pattern: SUMIF (3 args)
// -----------------------------------------------------------------------

#[test]
fn test_extract_sumif_3arg_pattern() {
    // SUMIF(A:A, E1, C:C)
    let ast = ASTNode::Function {
        name: Cow::Borrowed("SUMIF"),
        args: vec![
            col_range_node(0),      // A:A (criteria range)
            dynamic_ref_node(4, 0), // E1 (criteria)
            col_range_node(2),      // C:C (sum range)
        ],
    };

    let (pattern, post_op) = extract_agg_pattern(&ast, sheet_id_1(), 0, 5, &NoopResolver).unwrap();
    assert!(post_op.is_none());
    assert_eq!(pattern.agg_fn, AggFn::SumIf);

    let vr = pattern.value_range.unwrap();
    assert_eq!(vr.1, 2); // col C
}

// -----------------------------------------------------------------------
// extract_agg_pattern: SUMIFS
// -----------------------------------------------------------------------

#[test]
fn test_extract_sumifs_pattern() {
    // SUMIFS(C:C, A:A, E1, B:B, F1)
    let ast = ASTNode::Function {
        name: Cow::Borrowed("SUMIFS"),
        args: vec![
            col_range_node(2),      // C:C (sum range)
            col_range_node(0),      // A:A (criteria range 1)
            dynamic_ref_node(4, 0), // E1 (criteria 1)
            col_range_node(1),      // B:B (criteria range 2)
            dynamic_ref_node(5, 0), // F1 (criteria 2)
        ],
    };

    let (pattern, post_op) = extract_agg_pattern(&ast, sheet_id_1(), 0, 6, &NoopResolver).unwrap();
    assert!(post_op.is_none());
    assert_eq!(pattern.agg_fn, AggFn::SumIfs);
    assert_eq!(pattern.value_range.unwrap().1, 2); // sum over col C
    assert_eq!(pattern.pairs.len(), 2);
}

// -----------------------------------------------------------------------
// extract_agg_pattern: rejects unsupported
// -----------------------------------------------------------------------

#[test]
fn test_extract_rejects_non_agg_function() {
    let ast = ASTNode::Function {
        name: Cow::Borrowed("SUM"),
        args: vec![col_range_node(0)],
    };
    assert!(extract_agg_pattern(&ast, sheet_id_1(), 0, 0, &NoopResolver).is_none());
}

#[test]
fn test_extract_rejects_number_node() {
    let ast = ASTNode::Number(42.0);
    assert!(extract_agg_pattern(&ast, sheet_id_1(), 0, 0, &NoopResolver).is_none());
}
