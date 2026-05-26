//! Wildcard matching in MATCH/HLOOKUP, and COUNT type coercion for
//! inline booleans.

use super::*;

// -----------------------------------------------------------------------
// COUNT: inline booleans must be counted
// -----------------------------------------------------------------------
// Root cause: `engine/aggregate.rs:183-193` — agg_count only counts Number.
// Excel counts inline boolean literals (they coerce to numbers).

#[test]
fn count_inline_true() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func("COUNT", vec![ASTNode::Boolean(true)]);
    assert_eq!(eval(&node, &ctx), CellValue::number(1.0));
}

#[test]
fn count_inline_false() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func("COUNT", vec![ASTNode::Boolean(false)]);
    assert_eq!(eval(&node, &ctx), CellValue::number(1.0));
}

#[test]
fn count_inline_booleans_and_number() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "COUNT",
        vec![
            ASTNode::Boolean(true),
            ASTNode::Number(1.0),
            ASTNode::Boolean(false),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

#[test]
fn count_mixed_with_text_skipped() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "COUNT",
        vec![
            ASTNode::Number(1.0),
            ASTNode::Number(2.0),
            ASTNode::Text("text".into()),
            ASTNode::Boolean(true),
        ],
    );
    // 2 numbers + 1 boolean = 3 (text skipped)
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

// -----------------------------------------------------------------------
// MATCH match_type=0: wildcards in materialization path
// -----------------------------------------------------------------------
// Root cause: `lookup/dispatch.rs:684` — match_scalar_in_flat uses literal
// equality, no wildcard handling. Array literals bypass the indexed path.

#[test]
fn match_exact_wildcard_star_prefix() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Text("Apple".into())],
            vec![ASTNode::Text("Banana".into())],
            vec![ASTNode::Text("Avocado".into())],
        ],
    };
    let node = func(
        "MATCH",
        vec![ASTNode::Text("A*".into()), arr, ASTNode::Number(0.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(1.0));
}

#[test]
fn match_exact_wildcard_question_mark() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Text("Apple".into())],
            vec![ASTNode::Text("Banana".into())],
            vec![ASTNode::Text("Cherry".into())],
        ],
    };
    let node = func(
        "MATCH",
        vec![ASTNode::Text("B?nana".into()), arr, ASTNode::Number(0.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(2.0));
}

#[test]
fn match_exact_wildcard_star_suffix() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Text("Apple".into())],
            vec![ASTNode::Text("Banana".into())],
            vec![ASTNode::Text("Cherry".into())],
        ],
    };
    let node = func(
        "MATCH",
        vec![ASTNode::Text("*rry".into()), arr, ASTNode::Number(0.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

// -----------------------------------------------------------------------
// HLOOKUP exact match: wildcard support
// -----------------------------------------------------------------------
// Root cause: VLOOKUP checks has_wildcard_chars + WildcardPattern.
// HLOOKUP does not — wildcards are treated as literals.

#[test]
fn hlookup_exact_wildcard_star() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![
            vec![
                ASTNode::Text("Apple".into()),
                ASTNode::Text("Banana".into()),
                ASTNode::Text("Avocado".into()),
            ],
            vec![
                ASTNode::Number(1.0),
                ASTNode::Number(2.0),
                ASTNode::Number(3.0),
            ],
        ],
    };
    let node = func(
        "HLOOKUP",
        vec![
            ASTNode::Text("A*".into()),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(1.0));
}

#[test]
fn hlookup_exact_wildcard_suffix() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![
            vec![
                ASTNode::Text("Apple".into()),
                ASTNode::Text("Banana".into()),
                ASTNode::Text("Cherry".into()),
            ],
            vec![
                ASTNode::Number(10.0),
                ASTNode::Number(20.0),
                ASTNode::Number(30.0),
            ],
        ],
    };
    let node = func(
        "HLOOKUP",
        vec![
            ASTNode::Text("*nana".into()),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(20.0));
}
