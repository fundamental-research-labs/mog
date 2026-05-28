#[test]
fn test_display_round_trip_corpus() {
    use crate::parse_formula;
    let formulas = vec![
        "42",
        "3.14",
        "\"hello\"",
        "\"say \"\"hi\"\"\"",
        "\"\"",
        "TRUE",
        "FALSE",
        "#DIV/0!",
        "#N/A",
        "#REF!",
        "#VALUE!",
        "#NAME?",
        "#NULL!",
        "#NUM!",
        "A1",
        "$A$1",
        "A$1",
        "$A1",
        "B2",
        "AA100",
        "A1:B10",
        "$A$1:$B$10",
        "A:C",
        "1:5",
        "1+2",
        "1+2*3",
        "2^3^4",
        "-5",
        "+5",
        "50%",
        "\"a\"&\"b\"",
        "SUM(A1:B10)",
        "IF(A1>0,1,0)",
        "NOW()",
        "(1+2)*3",
        "{1,2;3,4}",
        "{\"hello\",TRUE;1,#N/A}",
        "LAMBDA(x,x+1)",
        "LET(x,10,x+1)",
        "IF(A1,,0)",
        "FUNC(,,)",
        "A1:B10 B5:C20",
        "(A1:A5,C1:C5)",
        "(A1:A5,C1:C5,E1:E5)",
        "SUM((A1:A5,C1:C5))",
    ];
    for formula in &formulas {
        let ast1 = parse_formula(formula, None).unwrap_or_else(|e| {
            panic!("Failed to parse '{formula}': {e}");
        });
        let displayed = format!("{ast1}");
        let ast2 = parse_formula(&displayed, None).unwrap_or_else(|e| {
            panic!("Round-trip failed for '{formula}' -> '{displayed}': {e}");
        });
        assert_eq!(
            ast1, ast2,
            "Round-trip mismatch for '{formula}' -> '{displayed}'"
        );
    }
}
