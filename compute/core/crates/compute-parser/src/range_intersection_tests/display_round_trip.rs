use super::*;

fn round_trip(formula: &str) {
    let ast1 = parse_formula(formula, None).unwrap().into_inner();
    let display = format!("{ast1}");
    let ast2 = parse_formula(&display, None).unwrap_or_else(|e| {
        panic!("Round-trip re-parse failed for '{formula}' -> '{display}': {e}")
    });
    let ast2 = ast2.into_inner();
    assert_eq!(
        ast1, ast2,
        "Round-trip failed for '{formula}' -> '{display}'"
    );
}

#[test]
fn round_trip_cell_range() {
    round_trip("A1:B10");
}

#[test]
fn round_trip_absolute_range() {
    round_trip("$A$1:$B$10");
}

#[test]
fn round_trip_mixed_absolute_range() {
    round_trip("$A1:B$10");
}

#[test]
fn round_trip_row_range() {
    round_trip("1:5");
}

#[test]
fn round_trip_absolute_row_range() {
    round_trip("$1:$5");
}

#[test]
fn round_trip_column_range() {
    round_trip("A:C");
}

#[test]
fn round_trip_absolute_column_range() {
    round_trip("$A:$C");
}

#[test]
fn round_trip_single_row() {
    round_trip("1:1");
}

#[test]
fn round_trip_single_column() {
    round_trip("A:A");
}

#[test]
fn round_trip_max_row_range() {
    round_trip("1:1048576");
}

#[test]
fn round_trip_max_column_range() {
    round_trip("A:XFD");
}

#[test]
fn round_trip_range_plus_arithmetic() {
    // A1:B1+C1 -> display -> re-parse should match
    round_trip("A1:B1+C1");
}

#[test]
fn round_trip_intersection() {
    // A1:B10 B5:C20 -> display -> re-parse
    // Display for Intersect uses a space separator
    round_trip("A1:B10 B5:C20");
}

#[test]
fn round_trip_range_op() {
    // (A1):(B1) -> display -> re-parse
    round_trip("(A1):(B1)");
}

#[test]
fn round_trip_nested_intersection() {
    // Three-way intersection round-trip
    round_trip("A1:B10 B5:C20 C1:D5");
}
