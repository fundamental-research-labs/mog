use compute_parser::{ReferenceTokenClass, collect_reference_tokens, rewrite_reference_tokens};

#[test]
fn table_reference_rewrites_preserve_utf8_literals_and_nested_escaped_columns() {
    let formula = "=\"😀 Sales[Amount]\"&SUM(Sales[[#Headers],['A]]B']])+Other[Amount]";
    let tokens = collect_reference_tokens(formula);
    assert_eq!(
        tokens
            .iter()
            .filter(|token| token.class == ReferenceTokenClass::StructuredRef)
            .count(),
        2
    );
    let rewritten = rewrite_reference_tokens(formula, |class, text| {
        (class == ReferenceTokenClass::StructuredRef && text.starts_with("Sales["))
            .then(|| text.replacen("Sales", "Revenue", 1))
    });
    assert_eq!(
        rewritten,
        "=\"😀 Sales[Amount]\"&SUM(Revenue[[#Headers],['A]]B']])+Other[Amount]"
    );
}
