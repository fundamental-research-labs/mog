//! First-principles operator precedence tests for the formula parser.
//!
//! These tests verify correct parsing according to Excel's operator precedence
//! rules, NOT simply "what the parser currently does." Each test is derived from
//! the well-documented Excel operator precedence hierarchy:
//!
//!   Lowest  →  Highest
//!   Comparison (=, <>, <, >, <=, >=)
//!   Concat (&)
//!   Add/Sub (+, -)
//!   Mul/Div (*, /)
//!   Exponentiation (^) — right-associative
//!   Prefix unary (+, -)
//!   Postfix percent (%)
//!   Intersection (space)
//!   Range operator (:)

use super::*;
use crate::ast::{BinOp, CellRefNode, UnaryOp};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse a formula string (with or without leading `=`) and return the AST node.
fn parse(formula: &str) -> ASTNode {
    parse_formula(formula, None).unwrap().into_inner()
}

/// Assert the top-level node is a `BinaryOp` with the given operator, then
/// return references to (left, right).
fn expect_binop(node: &ASTNode, expected_op: BinOp) -> (&ASTNode, &ASTNode) {
    match node {
        ASTNode::BinaryOp { op, left, right } => {
            assert_eq!(
                *op, expected_op,
                "Expected {expected_op:?} at top, got {op:?} in node {node:?}"
            );
            (left.as_ref(), right.as_ref())
        }
        other => panic!("Expected BinaryOp({expected_op:?}), got {other:?}"),
    }
}

/// Assert the node is a `UnaryOp` with the given operator, return the operand.
fn expect_unary(node: &ASTNode, expected_op: UnaryOp) -> &ASTNode {
    match node {
        ASTNode::UnaryOp { op, operand } => {
            assert_eq!(
                *op, expected_op,
                "Expected UnaryOp({expected_op:?}), got UnaryOp({op:?})"
            );
            operand.as_ref()
        }
        other => panic!("Expected UnaryOp({expected_op:?}), got {other:?}"),
    }
}

/// Assert the node is a Number with the given value.
fn expect_number(node: &ASTNode, expected: f64) {
    match node {
        ASTNode::Number(v) => assert!(
            (*v - expected).abs() < 1e-10,
            "Expected Number({expected}), got Number({v})"
        ),
        other => panic!("Expected Number({expected}), got {other:?}"),
    }
}

/// Assert the node is a Text literal with the given value.
fn expect_text(node: &ASTNode, expected: &str) {
    match node {
        ASTNode::Text(s) => assert_eq!(s, expected, "Expected Text({expected:?}), got Text({s:?})"),
        other => panic!("Expected Text({expected:?}), got {other:?}"),
    }
}

/// Assert the node is a `CellReference` and return (row, col).
fn expect_cell_ref(node: &ASTNode) -> (u32, u32) {
    match node {
        ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
            formula_types::CellRef::Positional { row, col, .. } => (*row, *col),
            other @ formula_types::CellRef::Resolved(_) => {
                panic!("Expected Positional CellRef, got {other:?}")
            }
        },
        other => panic!("Expected CellReference, got {other:?}"),
    }
}

/// Assert the node is a Paren, and return the inner node.
fn expect_paren(node: &ASTNode) -> &ASTNode {
    match node {
        ASTNode::Paren(inner) => inner.as_ref(),
        other => panic!("Expected Paren, got {other:?}"),
    }
}

// ===========================================================================
// 1. Complex Precedence Chains
// ===========================================================================
mod complex_precedence_chains {
    use super::*;

    #[test]
    fn mul_binds_tighter_than_add() {
        // Excel: A1+B1*C1 = A1+(B1*C1)
        let ast = parse("A1+B1*C1");
        let (left, right) = expect_binop(&ast, BinOp::Add);
        expect_cell_ref(left); // A1
        let (ml, mr) = expect_binop(right, BinOp::Mul);
        expect_cell_ref(ml); // B1
        expect_cell_ref(mr); // C1
    }

    #[test]
    fn two_mul_groups_added() {
        // Excel: A1*B1+C1*D1 = (A1*B1)+(C1*D1)
        let ast = parse("A1*B1+C1*D1");
        let (left, right) = expect_binop(&ast, BinOp::Add);
        let (a, b) = expect_binop(left, BinOp::Mul);
        expect_cell_ref(a); // A1
        expect_cell_ref(b); // B1
        let (c, d) = expect_binop(right, BinOp::Mul);
        expect_cell_ref(c); // C1
        expect_cell_ref(d); // D1
    }

    #[test]
    fn power_binds_tighter_than_mul_and_add() {
        // Excel: A1+B1*C1^D1 = A1+(B1*(C1^D1))
        let ast = parse("A1+B1*C1^D1");
        let (left, right) = expect_binop(&ast, BinOp::Add);
        expect_cell_ref(left); // A1
        let (ml, mr) = expect_binop(right, BinOp::Mul);
        expect_cell_ref(ml); // B1
        let (pl, pr) = expect_binop(mr, BinOp::Pow);
        expect_cell_ref(pl); // C1
        expect_cell_ref(pr); // D1
    }

    #[test]
    fn all_arithmetic_operators_in_one_chain() {
        // 1+2*3^4/5-6
        // Expected tree (from precedence):
        //   Sub(Add(1, Div(Mul(2, Pow(3,4)), 5)), 6)
        //
        // Step by step:
        //   3^4 first (highest among binary ops)
        //   2*(3^4) next
        //   (2*(3^4))/5 next (left-assoc: * and / same precedence)
        //   1+((2*(3^4))/5) next
        //   (1+((2*(3^4))/5))-6 last
        let ast = parse("1+2*3^4/5-6");

        // Top: Sub
        let (add_node, six) = expect_binop(&ast, BinOp::Sub);
        expect_number(six, 6.0);

        // Left of Sub: Add
        let (one, div_node) = expect_binop(add_node, BinOp::Add);
        expect_number(one, 1.0);

        // Right of Add: Div
        let (mul_node, five) = expect_binop(div_node, BinOp::Div);
        expect_number(five, 5.0);

        // Left of Div: Mul
        let (two, pow_node) = expect_binop(mul_node, BinOp::Mul);
        expect_number(two, 2.0);

        // Right of Mul: Pow
        let (three, four) = expect_binop(pow_node, BinOp::Pow);
        expect_number(three, 3.0);
        expect_number(four, 4.0);
    }

    #[test]
    fn comparison_is_lowest_among_value_operators() {
        // Excel: A1=B1+C1*D1^E1&F1
        // Precedence (low to high): = < & < + < * < ^
        // So: A1 = ((B1 + (C1 * (D1 ^ E1))) & F1)
        //
        // Wait — concat (&) is between comparison and add/sub.
        // So: = is lowest, & is next, + is next, * is next, ^ highest.
        // A1 = (B1+C1*D1^E1) & F1
        // Actually: & binds tighter than =, but looser than +.
        // So the & splits the right side: A1 = ((B1 + (C1*(D1^E1))) & F1)
        let ast = parse("A1=B1+C1*D1^E1&F1");

        // Top: Eq
        let (a1, concat_node) = expect_binop(&ast, BinOp::Eq);
        expect_cell_ref(a1);

        // Right of Eq: Concat
        let (add_node, f1) = expect_binop(concat_node, BinOp::Concat);
        expect_cell_ref(f1);

        // Left of Concat: Add
        let (b1, mul_node) = expect_binop(add_node, BinOp::Add);
        expect_cell_ref(b1);

        // Right of Add: Mul
        let (c1, pow_node) = expect_binop(mul_node, BinOp::Mul);
        expect_cell_ref(c1);

        // Right of Mul: Pow
        let (d1, e1) = expect_binop(pow_node, BinOp::Pow);
        expect_cell_ref(d1);
        expect_cell_ref(e1);
    }
}

// ===========================================================================
// 2. Right-Associativity of Power
// ===========================================================================
mod right_associativity_of_power {
    use super::*;

    #[test]
    fn power_is_right_associative_two_ops() {
        // Excel: 2^3^4 = 2^(3^4), NOT (2^3)^4
        // 2^(3^4) = 2^81 = a huge number
        // (2^3)^4 = 8^4 = 4096
        // Excel gives 2^(3^4).
        let ast = parse("2^3^4");
        let (two, inner_pow) = expect_binop(&ast, BinOp::Pow);
        expect_number(two, 2.0);
        let (three, four) = expect_binop(inner_pow, BinOp::Pow);
        expect_number(three, 3.0);
        expect_number(four, 4.0);
    }

    #[test]
    fn power_is_right_associative_chain_of_four() {
        // A1^B1^C1^D1 = A1^(B1^(C1^D1))
        let ast = parse("A1^B1^C1^D1");
        let (a1, rest) = expect_binop(&ast, BinOp::Pow);
        expect_cell_ref(a1);
        let (b1, rest2) = expect_binop(rest, BinOp::Pow);
        expect_cell_ref(b1);
        let (c1, d1) = expect_binop(rest2, BinOp::Pow);
        expect_cell_ref(c1);
        expect_cell_ref(d1);
    }
}

// ===========================================================================
// 3. Left-Associativity of Other Operators
// ===========================================================================
mod left_associativity {
    use super::*;

    #[test]
    fn subtraction_is_left_associative() {
        // 1-2-3 = (1-2)-3, NOT 1-(2-3)
        // (1-2)-3 = -4, 1-(2-3) = 2. Excel gives -4.
        let ast = parse("1-2-3");
        let (sub1, three) = expect_binop(&ast, BinOp::Sub);
        expect_number(three, 3.0);
        let (one, two) = expect_binop(sub1, BinOp::Sub);
        expect_number(one, 1.0);
        expect_number(two, 2.0);
    }

    #[test]
    fn division_is_left_associative() {
        // 10/2/5 = (10/2)/5 = 1, NOT 10/(2/5) = 25
        let ast = parse("10/2/5");
        let (div1, five) = expect_binop(&ast, BinOp::Div);
        expect_number(five, 5.0);
        let (ten, two) = expect_binop(div1, BinOp::Div);
        expect_number(ten, 10.0);
        expect_number(two, 2.0);
    }

    #[test]
    fn comparison_is_left_associative() {
        // A1=B1=C1 = (A1=B1)=C1
        // In Excel this evaluates: first compare A1=B1 -> TRUE/FALSE,
        // then compare that boolean to C1.
        let ast = parse("A1=B1=C1");
        let (eq1, c1) = expect_binop(&ast, BinOp::Eq);
        expect_cell_ref(c1);
        let (a1, b1) = expect_binop(eq1, BinOp::Eq);
        expect_cell_ref(a1);
        expect_cell_ref(b1);
    }

    #[test]
    fn concat_is_left_associative() {
        // "a"&"b"&"c" = ("a"&"b")&"c"
        let ast = parse("\"a\"&\"b\"&\"c\"");
        let (concat1, c) = expect_binop(&ast, BinOp::Concat);
        expect_text(c, "c");
        let (a, b) = expect_binop(concat1, BinOp::Concat);
        expect_text(a, "a");
        expect_text(b, "b");
    }

    #[test]
    fn addition_is_left_associative() {
        // 1+2+3 = (1+2)+3
        let ast = parse("1+2+3");
        let (add1, three) = expect_binop(&ast, BinOp::Add);
        expect_number(three, 3.0);
        let (one, two) = expect_binop(add1, BinOp::Add);
        expect_number(one, 1.0);
        expect_number(two, 2.0);
    }

    #[test]
    fn multiplication_is_left_associative() {
        // 2*3*4 = (2*3)*4
        let ast = parse("2*3*4");
        let (mul1, four) = expect_binop(&ast, BinOp::Mul);
        expect_number(four, 4.0);
        let (two, three) = expect_binop(mul1, BinOp::Mul);
        expect_number(two, 2.0);
        expect_number(three, 3.0);
    }
}

// ===========================================================================
// 4. Percent Postfix Interactions
// ===========================================================================
mod percent_postfix {
    use super::*;

    #[test]
    fn simple_percent() {
        // 50% = UnaryOp(Percent, 50)
        let ast = parse("50%");
        let operand = expect_unary(&ast, UnaryOp::Percent);
        expect_number(operand, 50.0);
    }

    #[test]
    fn percent_binds_tighter_than_add() {
        // A1%+B1 = (A1%)+B1
        // Percent postfix (bp=14) is tighter than Add (l_bp=6)
        let ast = parse("A1%+B1");
        let (left, right) = expect_binop(&ast, BinOp::Add);
        let inner = expect_unary(left, UnaryOp::Percent);
        expect_cell_ref(inner);
        expect_cell_ref(right);
    }

    #[test]
    fn percent_binds_tighter_than_mul() {
        // A1%*B1 = (A1%)*B1
        // Percent (bp=14) > Mul (l_bp=8)
        let ast = parse("A1%*B1");
        let (left, right) = expect_binop(&ast, BinOp::Mul);
        let inner = expect_unary(left, UnaryOp::Percent);
        expect_cell_ref(inner);
        expect_cell_ref(right);
    }

    #[test]
    fn percent_binds_tighter_than_power() {
        // A1%^B1 = (A1%)^B1
        // Percent (bp=14) > Power (l_bp=11), so % is consumed first.
        let ast = parse("A1%^B1");
        let (left, right) = expect_binop(&ast, BinOp::Pow);
        let inner = expect_unary(left, UnaryOp::Percent);
        expect_cell_ref(inner);
        expect_cell_ref(right);
    }

    #[test]
    fn double_percent() {
        // 100%% = Percent(Percent(100))
        // Each % divides by 100, so 100%% = 0.01
        let ast = parse("100%%");
        let inner = expect_unary(&ast, UnaryOp::Percent);
        let inner2 = expect_unary(inner, UnaryOp::Percent);
        expect_number(inner2, 100.0);
    }

    #[test]
    fn percent_on_both_operands() {
        // A1%+B1% = (A1%)+(B1%)
        let ast = parse("A1%+B1%");
        let (left, right) = expect_binop(&ast, BinOp::Add);
        let l_inner = expect_unary(left, UnaryOp::Percent);
        expect_cell_ref(l_inner);
        let r_inner = expect_unary(right, UnaryOp::Percent);
        expect_cell_ref(r_inner);
    }
}

// ===========================================================================
// 5. Unary Prefix Interactions
// ===========================================================================
mod unary_prefix {
    use super::*;

    #[test]
    fn unary_minus_binds_tighter_than_add() {
        // -A1+B1 = (-A1)+B1
        // Prefix bp=12 > Add l_bp=6
        let ast = parse("-A1+B1");
        let (left, right) = expect_binop(&ast, BinOp::Add);
        let inner = expect_unary(left, UnaryOp::Minus);
        expect_cell_ref(inner);
        expect_cell_ref(right);
    }

    #[test]
    fn unary_minus_binds_tighter_than_mul() {
        // -A1*B1 = (-A1)*B1
        // Prefix bp=12 > Mul l_bp=8
        let ast = parse("-A1*B1");
        let (left, right) = expect_binop(&ast, BinOp::Mul);
        let inner = expect_unary(left, UnaryOp::Minus);
        expect_cell_ref(inner);
        expect_cell_ref(right);
    }

    #[test]
    fn unary_minus_vs_power() {
        // Excel semantics: -A1^B1 = -(A1^B1). Excel evaluates -2^2 as -4.
        // Unary minus binds LOOSER than ^, so power captures the operand first.
        let ast = parse("-A1^B1");
        // Expected: -(A1^B1)
        let inner = expect_unary(&ast, UnaryOp::Minus);
        let (left, right) = expect_binop(inner, BinOp::Pow);
        expect_cell_ref(left);
        expect_cell_ref(right);
    }

    #[test]
    fn double_negation() {
        // --A1 = -(-A1)
        let ast = parse("--A1");
        let inner = expect_unary(&ast, UnaryOp::Minus);
        let inner2 = expect_unary(inner, UnaryOp::Minus);
        expect_cell_ref(inner2);
    }

    #[test]
    fn plus_minus_prefix() {
        // +-A1 = +(-A1)
        let ast = parse("+-A1");
        let inner = expect_unary(&ast, UnaryOp::Plus);
        let inner2 = expect_unary(inner, UnaryOp::Minus);
        expect_cell_ref(inner2);
    }

    #[test]
    fn minus_plus_prefix() {
        // -+A1 = -(+A1)
        let ast = parse("-+A1");
        let inner = expect_unary(&ast, UnaryOp::Minus);
        let inner2 = expect_unary(inner, UnaryOp::Plus);
        expect_cell_ref(inner2);
    }
}

// ===========================================================================
// 6. Concat vs Comparison
// ===========================================================================
mod concat_vs_comparison {
    use super::*;

    #[test]
    fn concat_binds_tighter_than_comparison() {
        // "a"&"b"="ab" → ("a"&"b")="ab"
        // Concat (l_bp=4) > Comparison (l_bp=2), so & groups first.
        let ast = parse("\"a\"&\"b\"=\"ab\"");
        let (left, right) = expect_binop(&ast, BinOp::Eq);
        expect_text(right, "ab");
        let (a, b) = expect_binop(left, BinOp::Concat);
        expect_text(a, "a");
        expect_text(b, "b");
    }

    #[test]
    fn concat_on_right_of_comparison() {
        // A1="x"&B1 → A1=("x"&B1)
        // The & binds tighter than =, so "x"&B1 groups on the right.
        let ast = parse("A1=\"x\"&B1");
        let (left, right) = expect_binop(&ast, BinOp::Eq);
        expect_cell_ref(left);
        let (x, b1) = expect_binop(right, BinOp::Concat);
        expect_text(x, "x");
        expect_cell_ref(b1);
    }
}

// ===========================================================================
// 7. Mixed Unary and Binary
// ===========================================================================
mod mixed_unary_and_binary {
    use super::*;

    #[test]
    fn unary_minus_with_add() {
        // -1+2 = (-1)+2
        let ast = parse("-1+2");
        let (left, right) = expect_binop(&ast, BinOp::Add);
        let inner = expect_unary(left, UnaryOp::Minus);
        expect_number(inner, 1.0);
        expect_number(right, 2.0);
    }

    #[test]
    fn binary_plus_then_unary_minus() {
        // 1+-2 = 1+(-2)
        // The parser sees + as binary, then - as unary prefix on 2.
        let ast = parse("1+-2");
        let (left, right) = expect_binop(&ast, BinOp::Add);
        expect_number(left, 1.0);
        let inner = expect_unary(right, UnaryOp::Minus);
        expect_number(inner, 2.0);
    }

    #[test]
    fn binary_mul_then_unary_minus() {
        // 1*-2 = 1*(-2)
        let ast = parse("1*-2");
        let (left, right) = expect_binop(&ast, BinOp::Mul);
        expect_number(left, 1.0);
        let inner = expect_unary(right, UnaryOp::Minus);
        expect_number(inner, 2.0);
    }

    #[test]
    fn power_right_side_consumes_unary() {
        // 1^-2 = 1^(-2)
        // Power is right-associative, and in the right-hand recursive call
        // the parser encounters unary minus and consumes it.
        let ast = parse("1^-2");
        let (left, right) = expect_binop(&ast, BinOp::Pow);
        expect_number(left, 1.0);
        let inner = expect_unary(right, UnaryOp::Minus);
        expect_number(inner, 2.0);
    }

    #[test]
    fn unary_minus_before_power_with_numbers() {
        // Excel: -1^2 = -(1^2) = -1
        // Unary minus binds looser than ^.
        let ast = parse("-1^2");
        // Expected: -(1^2)
        let inner = expect_unary(&ast, UnaryOp::Minus);
        let (left, right) = expect_binop(inner, BinOp::Pow);
        expect_number(left, 1.0);
        expect_number(right, 2.0);
    }
}

// ===========================================================================
// 8. Full Precedence Stress Test
// ===========================================================================
mod stress_test {
    use super::*;

    #[test]
    fn full_precedence_chain_all_operators() {
        // 1+2*3^4%-5/6&"x"=7<>8
        //
        // Precedence (low to high): <> and = (comparison), & (concat),
        //   +/- (add/sub), */ (mul/div), ^ (power), unary prefix, % (postfix)
        //
        // Parsing step by step:
        //   1. % binds tightest to its left operand: 3^4% means 3^(4%)
        //      Actually 4% = Percent(4). Then ^ groups: 3^(4%).
        //      Wait — % is postfix with bp=14, ^ has l_bp=11.
        //      In Pratt parsing, after parsing "4", we check postfix %.
        //      Since postfix bp=14 > the current min_bp from ^ right side (10),
        //      the % binds to 4. So: 3 ^ Percent(4).
        //
        //   2. * groups: 2 * (3 ^ Percent(4))
        //   3. / groups with 5 and 6: but let's trace more carefully.
        //
        // Full formula: 1 + 2 * 3 ^ 4 % - 5 / 6 & "x" = 7 <> 8
        //
        // Parse from the start with min_bp=0:
        //   lhs = 1
        //   See +, l_bp=6 > 0, consume +, recurse with min_bp=7
        //     lhs = 2
        //     See *, l_bp=8 > 7, consume *, recurse with min_bp=9
        //       lhs = 3
        //       See ^, l_bp=11 > 9, consume ^, recurse with min_bp=10
        //         lhs = 4
        //         See %, postfix bp=14 > 10, consume % -> lhs = Percent(4)
        //         See -, l_bp=6 < 10, stop
        //       rhs = Percent(4), lhs = Pow(3, Percent(4))
        //       See -, l_bp=6 < 9, stop
        //     rhs = Pow(3, Percent(4)), lhs = Mul(2, Pow(3, Percent(4)))
        //     See -, l_bp=6 < 7, stop
        //   rhs = Mul(2, Pow(3, Percent(4))), lhs = Add(1, Mul(2, Pow(3, Percent(4))))
        //   See -, l_bp=6 >= 0? yes (6 > 0), consume -, recurse with min_bp=7
        //     Wait, but - and + have same precedence. l_bp=6 for Sub.
        //     After "Add(1, ...)", we check -. l_bp for Sub = 6 > 0? yes.
        //     consume -, recurse with min_bp=7
        //       lhs = 5
        //       See /, l_bp=8 > 7, consume /, recurse with min_bp=9
        //         lhs = 6
        //         See &, l_bp=4 < 9, stop
        //       rhs = 6, lhs = Div(5, 6)
        //       See &, l_bp=4 < 7, stop
        //     rhs = Div(5, 6)
        //   lhs = Sub(Add(1, Mul(2, Pow(3, Percent(4)))), Div(5, 6))
        //   See &, l_bp=4 > 0, consume &, recurse with min_bp=5
        //     lhs = "x"
        //     See =, l_bp=2 < 5, stop
        //   rhs = "x", lhs = Concat(Sub(...), "x")
        //   See =, l_bp=2 > 0, consume =, recurse with min_bp=3
        //     lhs = 7
        //     See <>, l_bp=2 < 3, stop
        //   rhs = 7, lhs = Eq(Concat(...), 7)
        //   See <>, l_bp=2 > 0, consume <>, recurse with min_bp=3
        //     lhs = 8
        //     no more tokens, stop
        //   rhs = 8, lhs = Neq(Eq(Concat(...), 7), 8)
        //
        // Final tree:
        //   Neq(
        //     Eq(
        //       Concat(
        //         Sub(
        //           Add(1, Mul(2, Pow(3, Percent(4)))),
        //           Div(5, 6)
        //         ),
        //         "x"
        //       ),
        //       7
        //     ),
        //     8
        //   )

        let ast = parse("1+2*3^4%-5/6&\"x\"=7<>8");

        // Top: Neq
        let (eq_node, eight) = expect_binop(&ast, BinOp::Neq);
        expect_number(eight, 8.0);

        // Eq
        let (concat_node, seven) = expect_binop(eq_node, BinOp::Eq);
        expect_number(seven, 7.0);

        // Concat
        let (sub_node, x) = expect_binop(concat_node, BinOp::Concat);
        expect_text(x, "x");

        // Sub
        let (add_node, div_node) = expect_binop(sub_node, BinOp::Sub);

        // Add
        let (one, mul_node) = expect_binop(add_node, BinOp::Add);
        expect_number(one, 1.0);

        // Mul
        let (two, pow_node) = expect_binop(mul_node, BinOp::Mul);
        expect_number(two, 2.0);

        // Pow
        let (three, pct_node) = expect_binop(pow_node, BinOp::Pow);
        expect_number(three, 3.0);

        // Percent
        let four = expect_unary(pct_node, UnaryOp::Percent);
        expect_number(four, 4.0);

        // Div
        let (five, six) = expect_binop(div_node, BinOp::Div);
        expect_number(five, 5.0);
        expect_number(six, 6.0);
    }
}

// ===========================================================================
// 9. Whitespace Does Not Affect Precedence
// ===========================================================================
mod whitespace_invariance {
    use super::*;

    /// Helper: parse a formula and return a canonicalized Debug string of the AST.
    /// We use this to compare two formulas that should produce identical trees.
    fn ast_debug(formula: &str) -> String {
        format!("{:?}", parse(formula))
    }

    #[test]
    fn spaces_around_operators_dont_change_precedence() {
        // A1 + B1 * C1 should parse the same as A1+B1*C1
        let compact = ast_debug("A1+B1*C1");
        let spaced = ast_debug("A1 + B1 * C1");
        assert_eq!(compact, spaced);
    }

    #[test]
    fn extra_spaces_dont_change_precedence() {
        // A1  +  B1 should parse the same as A1+B1
        let compact = ast_debug("A1+B1");
        let spaced = ast_debug("A1  +  B1");
        assert_eq!(compact, spaced);
    }

    #[test]
    fn spaces_in_complex_expression() {
        // Verify structural equivalence with the mul-binds-tighter test
        let ast = parse("A1 + B1 * C1");
        let (left, right) = expect_binop(&ast, BinOp::Add);
        expect_cell_ref(left);
        expect_binop(right, BinOp::Mul);
    }
}

// ===========================================================================
// 10. Parentheses Override Precedence
// ===========================================================================
mod parentheses_override {
    use super::*;

    #[test]
    fn parens_make_add_bind_before_mul() {
        // (A1+B1)*C1 = Mul(Paren(Add(A1, B1)), C1)
        // Without parens, this would be A1+(B1*C1).
        let ast = parse("(A1+B1)*C1");
        let (left, right) = expect_binop(&ast, BinOp::Mul);
        expect_cell_ref(right); // C1

        let inner = expect_paren(left);
        let (a1, b1) = expect_binop(inner, BinOp::Add);
        expect_cell_ref(a1);
        expect_cell_ref(b1);
    }

    #[test]
    fn parens_on_both_sides_of_power() {
        // (A1+B1)^(C1-D1) = Pow(Paren(Add(A1,B1)), Paren(Sub(C1,D1)))
        let ast = parse("(A1+B1)^(C1-D1)");
        let (left, right) = expect_binop(&ast, BinOp::Pow);

        let left_inner = expect_paren(left);
        let (a1, b1) = expect_binop(left_inner, BinOp::Add);
        expect_cell_ref(a1);
        expect_cell_ref(b1);

        let right_inner = expect_paren(right);
        let (c1, d1) = expect_binop(right_inner, BinOp::Sub);
        expect_cell_ref(c1);
        expect_cell_ref(d1);
    }

    #[test]
    fn nested_parentheses() {
        // ((1+2))*3 = Mul(Paren(Paren(Add(1,2))), 3)
        let ast = parse("((1+2))*3");
        let (left, right) = expect_binop(&ast, BinOp::Mul);
        expect_number(right, 3.0);

        let inner1 = expect_paren(left);
        let inner2 = expect_paren(inner1);
        let (one, two) = expect_binop(inner2, BinOp::Add);
        expect_number(one, 1.0);
        expect_number(two, 2.0);
    }

    #[test]
    fn parens_override_right_associativity_of_power() {
        // (2^3)^4: Without parens, 2^3^4 = 2^(3^4) (right-assoc).
        // Parens force left grouping.
        let ast = parse("(2^3)^4");
        let (left, right) = expect_binop(&ast, BinOp::Pow);
        expect_number(right, 4.0);

        let inner = expect_paren(left);
        let (two, three) = expect_binop(inner, BinOp::Pow);
        expect_number(two, 2.0);
        expect_number(three, 3.0);
    }
}
