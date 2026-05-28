use super::super::delimiter::{DelimiterMatch, match_positions, split_by_delimiters};

#[test]
fn non_overlapping_positions_advance_by_delimiter_length() {
    assert_eq!(
        match_positions("aaa", "aa", 0),
        vec![DelimiterMatch { start: 0, len: 2 }]
    );
}

#[test]
fn split_uses_first_matching_delimiter_order() {
    let delimiters = vec!["--".to_string(), "-".to_string()];
    assert_eq!(
        split_by_delimiters("a--b-c", &delimiters, 0),
        vec!["a", "b", "c"]
    );
}

#[test]
fn case_insensitive_split_preserves_original_casing() {
    let delimiters = vec!["x".to_string()];
    assert_eq!(split_by_delimiters("aXb", &delimiters, 1), vec!["a", "b"]);
}

#[test]
fn split_is_char_index_safe_for_unicode() {
    let delimiters = vec!["\u{2615}".to_string()];
    assert_eq!(
        split_by_delimiters("caf\u{00e9}\u{2615}test", &delimiters, 0),
        vec!["caf\u{00e9}", "test"]
    );
}
