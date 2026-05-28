use super::*;

#[test]
fn trailing_colon_errors() {
    // A1: -> trailing colon should error
    p_err("A1:");
}

#[test]
fn leading_colon_errors() {
    // :A1 -> leading colon should error
    p_err(":A1");
}

#[test]
fn double_colon_errors() {
    // A1::B1 -> double colon should error
    p_err("A1::B1");
}

#[test]
fn colon_alone_errors() {
    // Just a colon
    p_err(":");
}

#[test]
fn colon_in_expression_context() {
    // 1+: -> colon after operator
    p_err("1+:");
}

#[test]
fn row_range_overflow() {
    // Row beyond max
    p_err("1:1048577");
}
