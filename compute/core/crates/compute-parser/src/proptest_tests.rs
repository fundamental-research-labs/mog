//! Property-based tests using proptest.

use crate::parse_formula;
use proptest::prelude::*;

// ── Generators ──────────────────────────────────────────────────────

/// Generate a random valid cell reference (A1 through XFD1048576).
fn arb_cell_ref() -> impl Strategy<Value = String> {
    // Column: A-XFD (1-16384)
    // Row: 1-1048576
    (1u32..=16384u32, 1u32..=1_048_576_u32).prop_map(|(col, row)| {
        let col_str = col_to_letter_test(col - 1);
        format!("{col_str}{row}")
    })
}

/// Convert 0-based column index to letter(s).
fn col_to_letter_test(col: u32) -> String {
    let mut result = String::new();
    let mut c = col;
    loop {
        result.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }
    result
}

/// Generate a random valid range reference.
fn arb_range() -> impl Strategy<Value = String> {
    (arb_cell_ref(), arb_cell_ref()).prop_map(|(a, b)| format!("{a}:{b}"))
}

/// Generate a simple arithmetic expression.
fn arb_simple_expr() -> impl Strategy<Value = String> {
    let leaf = prop_oneof![
        (1i32..1000).prop_map(|n| n.to_string()),
        arb_cell_ref(),
        Just("TRUE".to_string()),
        Just("FALSE".to_string()),
    ];

    let ops = prop_oneof![
        Just("+"),
        Just("-"),
        Just("*"),
        Just("/"),
        Just("^"),
        Just("&"),
        Just("="),
        Just("<>"),
        Just("<"),
        Just(">"),
        Just("<="),
        Just(">="),
    ];

    (leaf.clone(), ops, leaf).prop_map(|(l, op, r)| format!("{l}{op}{r}"))
}

/// Generate a function call with simple arguments.
fn arb_function_call() -> impl Strategy<Value = String> {
    let func_names = prop_oneof![
        Just("SUM"),
        Just("AVERAGE"),
        Just("COUNT"),
        Just("MAX"),
        Just("MIN"),
        Just("IF"),
        Just("VLOOKUP"),
        Just("INDEX"),
        Just("MATCH"),
        Just("IFERROR"),
    ];

    let arg = prop_oneof![
        arb_cell_ref(),
        arb_range(),
        (1i32..1000).prop_map(|n| n.to_string()),
        Just("TRUE".to_string()),
    ];

    (func_names, proptest::collection::vec(arg, 1..=4))
        .prop_map(|(name, args)| format!("{}({})", name, args.join(",")))
}

/// Generate an arbitrary formula string (valid or invalid).
fn arb_formula_string() -> impl Strategy<Value = String> {
    prop_oneof![
        arb_cell_ref(),
        arb_range(),
        arb_simple_expr(),
        arb_function_call(),
        ".*", // arbitrary UTF-8 string
    ]
}

// ── Properties ──────────────────────────────────────────────────────

proptest! {
    /// Property 1: parse never panics on arbitrary input.
    #[test]
    fn parse_never_panics(s in ".*") {
        let _ = parse_formula(&s, None);
    }

    /// Property 2: parse never panics on arbitrary UTF-8 strings (wider range).
    #[test]
    fn parse_never_panics_any_string(s in any::<String>()) {
        let _ = parse_formula(&s, None);
    }

    /// Property 3: round-trip property — parse(display(parse(f))) == parse(f) for valid formulas.
    #[test]
    fn round_trip_cell_refs(ref_str in arb_cell_ref()) {
        if let Ok(ast1) = parse_formula(&ref_str, None) {
            let displayed = format!("{ast1}");
            let ast2 = parse_formula(&displayed, None)
                .unwrap_or_else(|e| panic!("Round-trip failed: '{ref_str}' -> '{displayed}': {e}"));
            prop_assert_eq!(ast1, ast2, "Round-trip mismatch: '{}' -> '{}'", ref_str, displayed);
        }
    }

    /// Property 4: round-trip for range references.
    #[test]
    fn round_trip_ranges(range_str in arb_range()) {
        if let Ok(ast1) = parse_formula(&range_str, None) {
            let displayed = format!("{ast1}");
            let ast2 = parse_formula(&displayed, None)
                .unwrap_or_else(|e| panic!("Round-trip failed: '{range_str}' -> '{displayed}': {e}"));
            prop_assert_eq!(ast1, ast2, "Round-trip mismatch: '{}' -> '{}'", range_str, displayed);
        }
    }

    /// Property 5: round-trip for simple expressions.
    #[test]
    fn round_trip_simple_expr(expr in arb_simple_expr()) {
        if let Ok(ast1) = parse_formula(&expr, None) {
            let displayed = format!("{ast1}");
            let ast2 = parse_formula(&displayed, None)
                .unwrap_or_else(|e| panic!("Round-trip failed: '{expr}' -> '{displayed}': {e}"));
            prop_assert_eq!(ast1, ast2, "Round-trip mismatch: '{}' -> '{}'", expr, displayed);
        }
    }

    /// Property 6: round-trip for function calls.
    #[test]
    fn round_trip_function_calls(func in arb_function_call()) {
        if let Ok(ast1) = parse_formula(&func, None) {
            let displayed = format!("{ast1}");
            let ast2 = parse_formula(&displayed, None)
                .unwrap_or_else(|e| panic!("Round-trip failed: '{func}' -> '{displayed}': {e}"));
            prop_assert_eq!(ast1, ast2, "Round-trip mismatch: '{}' -> '{}'", func, displayed);
        }
    }

    /// Property 7: parse result is deterministic — same input always gives same result.
    #[test]
    fn parse_deterministic(s in arb_formula_string()) {
        let r1 = parse_formula(&s, None);
        let r2 = parse_formula(&s, None);
        match (r1, r2) {
            (Ok(a1), Ok(a2)) => prop_assert_eq!(a1, a2),
            (Err(_), Err(_)) => {}, // both errors is fine
            _ => prop_assert!(false, "Non-deterministic parse for '{}'", s),
        }
    }

    /// Property 8: if parse succeeds, Display produces non-empty output.
    #[test]
    fn successful_parse_has_display(s in arb_formula_string()) {
        if let Ok(ast) = parse_formula(&s, None) {
            let displayed = format!("{ast}");
            // Only Number(0), Boolean(false), and Omitted produce special displays
            // Most ASTs should produce non-empty display
            // (Omitted is empty, so skip that check for it)
            if !matches!(ast.node, crate::ast::ASTNode::Omitted) {
                prop_assert!(!displayed.is_empty(), "Empty display for '{}'", s);
            }
        }
    }
}
