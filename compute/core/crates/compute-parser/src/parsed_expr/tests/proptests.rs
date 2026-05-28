use proptest::prelude::*;

use super::*;

proptest! {
    /// Totality: `ParsedExpr::classify` never panics on any UTF-8 string.
    #[test]
    fn proptest_classify_never_panics(s in any::<String>()) {
        let _ = ParsedExpr::classify(&s);
    }

    /// Totality: `SqrefList::parse` never panics on any UTF-8 string.
    #[test]
    fn proptest_sqref_list_parse_never_panics(s in any::<String>()) {
        let _ = SqrefList::parse(&s);
    }

    /// Semantic round-trip: classify->serialize->classify is idempotent for
    /// ref-shaped inputs (Cell / Range / SqrefList / BrokenRef / Empty).
    #[test]
    fn proptest_classify_round_trip_ref_shaped(s in any::<String>()) {
        let a = ParsedExpr::classify(&s);
        let skip = matches!(a, ParsedExpr::Constant(_) | ParsedExpr::Formula(_));
        if !skip {
            let serialized = a.to_a1_string();
            let b = ParsedExpr::classify(&serialized);
            prop_assert_eq!(a, b);
        }
    }

    /// Byte round-trip: `FormulaSource::parse(s).original == s` for any UTF-8
    /// `s`.
    #[test]
    fn proptest_formula_source_byte_round_trip(s in any::<String>()) {
        let fs = FormulaSource::parse(&s);
        prop_assert_eq!(fs.original, s);
    }
}
