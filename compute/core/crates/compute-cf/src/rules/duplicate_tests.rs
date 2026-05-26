use super::*;
use crate::stats::parse_plain_number;
use rustc_hash::FxHashMap;
use value_types::FiniteF64;

/// Convenience: wrap a known-finite f64 literal in CellValue::Number for tests.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

/// Build a RangeStatistics with just a numeric frequency map (other fields default).
fn stats_with_frequency(entries: &[(f64, usize)]) -> RangeStatistics {
    let mut frequency = FxHashMap::default();
    for &(val, count) in entries {
        let bits = canonical_bits(val);
        frequency.insert(bits, count);
    }
    RangeStatistics {
        frequency,
        ..Default::default()
    }
}

/// Build a RangeStatistics with just a text frequency map (other fields default).
fn stats_with_text_frequency(entries: &[(&str, usize)]) -> RangeStatistics {
    let mut text_frequency = FxHashMap::default();
    for &(key, count) in entries {
        text_frequency.insert(key.to_string(), count);
    }
    RangeStatistics {
        text_frequency,
        ..Default::default()
    }
}

/// Build a RangeStatistics with just a bool frequency map (other fields default).
fn stats_with_bool_frequency(entries: &[(bool, usize)]) -> RangeStatistics {
    let mut bool_frequency = FxHashMap::default();
    for &(key, count) in entries {
        bool_frequency.insert(key, count);
    }
    RangeStatistics {
        bool_frequency,
        ..Default::default()
    }
}

/// Build a RangeStatistics with both numeric and text frequency maps.
/// Also pre-computes numeric_text_frequency for cross-type O(1) lookups.
fn stats_with_both_frequencies(
    numeric: &[(f64, usize)],
    text: &[(&str, usize)],
) -> RangeStatistics {
    let mut frequency = FxHashMap::default();
    for &(val, count) in numeric {
        let bits = canonical_bits(val);
        frequency.insert(bits, count);
    }
    let mut text_frequency = FxHashMap::default();
    for &(key, count) in text {
        text_frequency.insert(key.to_string(), count);
    }
    // Build numeric_text_frequency: for each text entry that parses as a plain number
    // (no scientific notation), map its canonical bits to the text count.
    let mut numeric_text_frequency = FxHashMap::default();
    for &(key, count) in text {
        if let Some(parsed) = parse_plain_number(key) {
            let bits = canonical_bits(parsed);
            *numeric_text_frequency.entry(bits).or_insert(0) += count;
        }
    }
    RangeStatistics {
        frequency,
        text_frequency,
        numeric_text_frequency,
        ..Default::default()
    }
}

// -----------------------------------------------------------------------
// Duplicate detection (unique=false)
// -----------------------------------------------------------------------

#[test]
fn test_duplicate_detected() {
    // 10.0 appears 3 times -> duplicate
    let stats = stats_with_frequency(&[(10.0, 3), (20.0, 1)]);

    assert!(evaluate_duplicate(&n(10.0), false, &stats));
}

#[test]
fn test_not_duplicate_when_count_is_one() {
    // 20.0 appears 1 time -> not duplicate
    let stats = stats_with_frequency(&[(10.0, 3), (20.0, 1)]);

    assert!(!evaluate_duplicate(&n(20.0), false, &stats));
}

// -----------------------------------------------------------------------
// Unique detection (unique=true)
// -----------------------------------------------------------------------

#[test]
fn test_unique_detected() {
    // 20.0 appears 1 time -> unique
    let stats = stats_with_frequency(&[(10.0, 3), (20.0, 1)]);

    assert!(evaluate_duplicate(&n(20.0), true, &stats));
}

#[test]
fn test_not_unique_when_duplicate() {
    // 10.0 appears 3 times -> not unique
    let stats = stats_with_frequency(&[(10.0, 3), (20.0, 1)]);

    assert!(!evaluate_duplicate(&n(10.0), true, &stats));
}

// -----------------------------------------------------------------------
// Blank cell excluded
// -----------------------------------------------------------------------

#[test]
fn test_blank_cell_excluded() {
    let stats = stats_with_frequency(&[(10.0, 3)]);

    assert!(!evaluate_duplicate(&CellValue::Null, false, &stats));
    assert!(!evaluate_duplicate(&CellValue::Null, true, &stats));
}

// -----------------------------------------------------------------------
// Text cell — not in text_frequency -> not duplicate
// -----------------------------------------------------------------------

#[test]
fn test_text_cell_not_in_frequency() {
    let stats = stats_with_frequency(&[(10.0, 3)]);

    // "hello" not in text_frequency -> count=0 -> not duplicate
    assert!(!evaluate_duplicate(
        &CellValue::Text("hello".into()),
        false,
        &stats
    ));
}

// -----------------------------------------------------------------------
// Boolean cell — not in text_frequency -> not duplicate
// -----------------------------------------------------------------------

#[test]
fn test_boolean_cell_not_in_frequency() {
    let stats = stats_with_frequency(&[(10.0, 3)]);

    assert!(!evaluate_duplicate(
        &CellValue::Boolean(true),
        false,
        &stats
    ));
}

// -----------------------------------------------------------------------
// Empty frequency map
// -----------------------------------------------------------------------

#[test]
fn test_empty_frequency_map() {
    let stats = RangeStatistics::default();

    // Value not in frequency map -> count=0 -> not duplicate
    assert!(!evaluate_duplicate(&n(42.0), false, &stats));

    // Value not in frequency map -> count=0 -> IS unique (count <= 1)
    assert!(evaluate_duplicate(&n(42.0), true, &stats));
}

// -----------------------------------------------------------------------
// Single occurrence (count = 1)
// -----------------------------------------------------------------------

#[test]
fn test_single_occurrence_not_duplicate() {
    let stats = stats_with_frequency(&[(42.0, 1)]);

    // count=1 -> not duplicate
    assert!(!evaluate_duplicate(&n(42.0), false, &stats));

    // count=1 -> IS unique
    assert!(evaluate_duplicate(&n(42.0), true, &stats));
}

// -----------------------------------------------------------------------
// Exact count=2 boundary
// -----------------------------------------------------------------------

#[test]
fn test_count_two_is_duplicate() {
    let stats = stats_with_frequency(&[(7.0, 2)]);

    // count=2 -> IS duplicate
    assert!(evaluate_duplicate(&n(7.0), false, &stats));

    // count=2 -> NOT unique
    assert!(!evaluate_duplicate(&n(7.0), true, &stats));
}

// -----------------------------------------------------------------------
// Text duplicate detection (case-insensitive)
// -----------------------------------------------------------------------

#[test]
fn test_text_duplicate_case_insensitive() {
    // "hello" appears 3 times (case-insensitive: "Hello", "hello", "HELLO")
    let stats = stats_with_text_frequency(&[("hello", 3), ("world", 1)]);

    // "Hello" -> lowercased "hello" -> count=3 -> IS duplicate
    assert!(evaluate_duplicate(
        &CellValue::Text("Hello".into()),
        false,
        &stats
    ));

    // "hello" -> lowercased "hello" -> count=3 -> IS duplicate
    assert!(evaluate_duplicate(
        &CellValue::Text("hello".into()),
        false,
        &stats
    ));

    // "HELLO" -> lowercased "hello" -> count=3 -> IS duplicate
    assert!(evaluate_duplicate(
        &CellValue::Text("HELLO".into()),
        false,
        &stats
    ));

    // "world" -> count=1 -> NOT duplicate
    assert!(!evaluate_duplicate(
        &CellValue::Text("world".into()),
        false,
        &stats
    ));

    // "world" -> count=1 -> IS unique
    assert!(evaluate_duplicate(
        &CellValue::Text("world".into()),
        true,
        &stats
    ));
}

// -----------------------------------------------------------------------
// Boolean duplicate detection
// -----------------------------------------------------------------------

#[test]
fn test_boolean_duplicate_detection() {
    // true appears 2 times, false appears 1 time
    let stats = stats_with_bool_frequency(&[(true, 2), (false, 1)]);

    // true -> bool_frequency[true]=2 -> IS duplicate
    assert!(evaluate_duplicate(&CellValue::Boolean(true), false, &stats));

    // false -> bool_frequency[false]=1 -> NOT duplicate
    assert!(!evaluate_duplicate(
        &CellValue::Boolean(false),
        false,
        &stats
    ));

    // false -> bool_frequency[false]=1 -> IS unique
    assert!(evaluate_duplicate(&CellValue::Boolean(false), true, &stats));
}

// -----------------------------------------------------------------------
// Cross-type coercion: Number(1.0) and Text("1") ARE duplicates (Excel)
// -----------------------------------------------------------------------

#[test]
fn test_cross_type_number_and_text_are_duplicates() {
    // Number 1.0 appears once, text "1" appears once -> unified count = 2 -> duplicate
    let stats = stats_with_both_frequencies(&[(1.0, 1)], &[("1", 1)]);

    // Number 1.0 -> numeric(1) + text "1" parses to 1.0 (1) = 2 -> IS duplicate
    assert!(evaluate_duplicate(&n(1.0), false, &stats));

    // Text "1" -> text(1) + numeric 1.0 (1) = 2 -> IS duplicate
    assert!(evaluate_duplicate(
        &CellValue::Text("1".into()),
        false,
        &stats
    ));
}

#[test]
fn test_cross_type_number_and_non_numeric_text_not_duplicates() {
    // Number 1.0 appears once, text "hello" appears once -> no cross-type match
    let stats = stats_with_both_frequencies(&[(1.0, 1)], &[("hello", 1)]);

    // Number 1.0 -> numeric(1) + no text parses to 1.0 = 1 -> NOT duplicate
    assert!(!evaluate_duplicate(&n(1.0), false, &stats));

    // Text "hello" -> text(1) + doesn't parse as number = 1 -> NOT duplicate
    assert!(!evaluate_duplicate(
        &CellValue::Text("hello".into()),
        false,
        &stats
    ));
}

#[test]
fn test_cross_type_multiple_representations() {
    // Number(1.0) x1, Text("1") x2 -> unified count = 3 for both
    let stats = stats_with_both_frequencies(&[(1.0, 1)], &[("1", 2)]);

    assert!(evaluate_duplicate(&n(1.0), false, &stats)); // count = 1 + 2 = 3

    assert!(evaluate_duplicate(
        &CellValue::Text("1".into()),
        false,
        &stats
    )); // count = 2 + 1 = 3
}

#[test]
fn test_cross_type_boolean_not_coerced_to_number() {
    // Boolean(true) uses bool_frequency, NOT numeric frequency for 1.0
    let stats = stats_with_both_frequencies(&[(1.0, 1)], &[("true", 1)]);

    // Boolean(true) -> bool_frequency empty, no numeric coercion -> NOT duplicate
    assert!(!evaluate_duplicate(
        &CellValue::Boolean(true),
        false,
        &stats
    ));

    // Number(1.0) -> numeric(1), "true" doesn't parse to 1.0 -> NOT duplicate
    assert!(!evaluate_duplicate(&n(1.0), false, &stats));
}

#[test]
fn test_cross_type_text_number_only_when_parseable() {
    // Text "1.5" and Number(1.5) -> unified count = 2
    // Text "abc" has no cross-type match
    let stats = stats_with_both_frequencies(&[(1.5, 1)], &[("1.5", 1), ("abc", 1)]);

    assert!(evaluate_duplicate(&n(1.5), false, &stats)); // 1 + 1 = 2

    assert!(evaluate_duplicate(
        &CellValue::Text("1.5".into()),
        false,
        &stats
    )); // 1 + 1 = 2

    assert!(!evaluate_duplicate(
        &CellValue::Text("abc".into()),
        false,
        &stats
    )); // 1, not parseable -> no cross-type
}

// -----------------------------------------------------------------------
// -0.0 and 0.0 are treated as duplicates
// -----------------------------------------------------------------------

#[test]
fn test_negative_zero_and_zero_are_duplicates() {
    // Both -0.0 and 0.0 map to canonical +0.0 bits, so count=2
    let stats = stats_with_frequency(&[(0.0, 2)]);

    // 0.0 -> canonical bits -> count=2 -> IS duplicate
    assert!(evaluate_duplicate(&n(0.0), false, &stats));

    // -0.0 -> canonical bits (same as +0.0) -> count=2 -> IS duplicate
    assert!(evaluate_duplicate(&n(-0.0), false, &stats));
}

// -----------------------------------------------------------------------
// Boolean and Text("true") are NOT considered duplicates of each other
// -----------------------------------------------------------------------

#[test]
fn test_boolean_not_duplicate_of_text_true() {
    // Boolean(true) lives in bool_frequency, Text("true") lives in text_frequency.
    // They are separate namespaces and should NOT cross-contaminate.
    let mut text_frequency = FxHashMap::default();
    text_frequency.insert("true".to_string(), 1usize);
    let mut bool_frequency = FxHashMap::default();
    bool_frequency.insert(true, 1usize);
    let stats = RangeStatistics {
        text_frequency,
        bool_frequency,
        ..Default::default()
    };

    // Boolean(true) -> bool_frequency[true]=1 -> count=1 -> NOT duplicate
    assert!(!evaluate_duplicate(
        &CellValue::Boolean(true),
        false,
        &stats
    ));

    // Text("true") -> text_frequency["true"]=1, not numeric -> count=1 -> NOT duplicate
    assert!(!evaluate_duplicate(
        &CellValue::Text("true".into()),
        false,
        &stats
    ));

    // Both should be unique (count <= 1)
    assert!(evaluate_duplicate(&CellValue::Boolean(true), true, &stats));

    assert!(evaluate_duplicate(
        &CellValue::Text("true".into()),
        true,
        &stats
    ));
}

// -----------------------------------------------------------------------
// Scientific notation text is NOT coerced to number (Excel behavior)
// -----------------------------------------------------------------------

#[test]
fn test_scientific_notation_text_not_coerced_to_number() {
    // Text "1e2" should NOT be treated as duplicate of Number(100.0).
    // Excel does not coerce scientific notation text for duplicate detection.
    let stats = stats_with_both_frequencies(&[(100.0, 1)], &[("1e2", 1)]);

    // Number(100.0) -> numeric(1), "1e2" rejected by parse_plain_number -> no text match -> count=1 -> NOT duplicate
    assert!(!evaluate_duplicate(&n(100.0), false, &stats));

    // Text("1e2") -> text(1), doesn't parse as plain number -> no numeric match -> count=1 -> NOT duplicate
    assert!(!evaluate_duplicate(
        &CellValue::Text("1e2".into()),
        false,
        &stats
    ));
}

#[test]
fn test_scientific_notation_uppercase_e_not_coerced() {
    // Text "1E3" should NOT be treated as duplicate of Number(1000.0).
    let stats = stats_with_both_frequencies(&[(1000.0, 1)], &[("1E3", 1)]);

    // Number(1000.0) -> numeric(1), "1e3" (lowercased) rejected -> count=1 -> NOT duplicate
    assert!(!evaluate_duplicate(&n(1000.0), false, &stats));

    // Text("1E3") -> text(1), doesn't parse as plain number -> count=1 -> NOT duplicate
    assert!(!evaluate_duplicate(
        &CellValue::Text("1E3".into()),
        false,
        &stats
    ));
}

// -----------------------------------------------------------------------
// Error values don't participate in duplicate detection
// -----------------------------------------------------------------------

#[test]
fn test_error_cell_returns_none() {
    // Error values (e.g., #DIV/0!) should not participate in duplicate
    // detection. unified_count returns None for Error, so evaluate_duplicate
    // returns false regardless of unique flag.
    let stats = stats_with_frequency(&[(10.0, 3)]);

    assert!(
        !evaluate_duplicate(
            &CellValue::Error(value_types::CellError::Div0, None),
            false,
            &stats
        ),
        "Error values should not be detected as duplicates"
    );
    assert!(
        !evaluate_duplicate(
            &CellValue::Error(value_types::CellError::Div0, None),
            true,
            &stats
        ),
        "Error values should not be detected as unique either"
    );
}

#[test]
fn test_various_error_types_excluded() {
    let stats = stats_with_frequency(&[(1.0, 2)]);

    // All error types should be excluded
    for error in [
        value_types::CellError::Value,
        value_types::CellError::Ref,
        value_types::CellError::Name,
        value_types::CellError::Null,
        value_types::CellError::Na,
    ] {
        assert!(
            !evaluate_duplicate(&CellValue::Error(error, None), false, &stats),
            "Error({:?}) should not participate in duplicate detection",
            error
        );
    }
}

#[test]
fn test_plain_numeric_text_still_coerced() {
    // Text "100" SHOULD still be treated as duplicate of Number(100.0) (plain numeric text).
    let stats = stats_with_both_frequencies(&[(100.0, 1)], &[("100", 1)]);

    // Number(100.0) -> numeric(1) + text "100" parses to 100.0 (1) = 2 -> IS duplicate
    assert!(evaluate_duplicate(&n(100.0), false, &stats));

    // Text("100") -> text(1) + numeric 100.0 (1) = 2 -> IS duplicate
    assert!(evaluate_duplicate(
        &CellValue::Text("100".into()),
        false,
        &stats
    ));
}

#[test]
fn test_plain_decimal_text_still_coerced() {
    // Text "1.5" SHOULD still be treated as duplicate of Number(1.5) (plain decimal text).
    let stats = stats_with_both_frequencies(&[(1.5, 1)], &[("1.5", 1)]);

    // Number(1.5) -> numeric(1) + text "1.5" parses to 1.5 (1) = 2 -> IS duplicate
    assert!(evaluate_duplicate(&n(1.5), false, &stats));

    // Text("1.5") -> text(1) + numeric 1.5 (1) = 2 -> IS duplicate
    assert!(evaluate_duplicate(
        &CellValue::Text("1.5".into()),
        false,
        &stats
    ));
}
