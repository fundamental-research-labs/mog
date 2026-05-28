use std::borrow::Cow;
use std::sync::Arc;

use value_types::CellValue;

use super::group::{ARRAY_KEY, BLANK_KEY, GroupKey, cell_value_to_group_key, f64_to_group_bits};

/// Convert a `CellValue` to the wire-format string key used at boundaries
/// that cannot yet carry a typed [`GroupKey`] (XLSX OOXML parser output,
/// persisted filter include/exclude lists).
///
/// New engine-internal code should prefer [`cell_value_to_group_key`] and
/// key `HashMap`s directly by [`GroupKey`]. This function is retained for
/// wire-format compatibility and will be removed once every caller routes
/// through `GroupKey`.
///
/// # Key format
///
/// | Type | Format | Example |
/// |------|--------|---------|
/// | Blank | `"\x00BLANK\x00"` | `Null`, `Text("")`, `Text("  ")` |
/// | Number | `"N:<bits>"` | `Number(42.0)` → `"N:4631107791820423168"` |
/// | Text | `"T:<lowercase>"` | `Text("Hello")` → `"T:hello"` |
/// | Boolean | `"B:<bool>"` | `Boolean(true)` → `"B:true"` |
/// | Error | `"E:<error_str>"` | `Error(Div0)` → `"E:#DIV/0!"` |
/// | Array | `"\x00ARRAY\x00"` | |
/// | Lambda | `"\x00LAMBDA\x00"` | |
///
/// Type prefixes prevent cross-type collisions (e.g., `Number(42.0)` and
/// `Text("42")` produce different keys).
///
/// Returns `Cow::Borrowed` for constant sentinel keys to avoid allocation.
#[must_use]
pub fn cell_value_to_key(value: &CellValue) -> Cow<'_, str> {
    if value.is_visually_blank() {
        return Cow::Borrowed(BLANK_KEY);
    }

    match value {
        CellValue::Array(_) => Cow::Borrowed(ARRAY_KEY),
        CellValue::Null => Cow::Borrowed(BLANK_KEY),
        _ => Cow::Owned(cell_value_to_group_key(value).to_wire_string()),
    }
}

/// Return all wire-format keys a value should match against in include/exclude
/// filter sets, allowing type-tolerant comparisons across `Number` and `Text`
/// representations.
///
/// Filter UIs and persisted filter lists frequently store values as strings
/// (e.g., the user types `2024` into a filter; the cell beneath is stored as
/// `Number(2024.0)`). The strict type-prefixed key format means `T:2024` and
/// `N:<bits-of-2024.0>` never collide — so without coercion the filter never
/// matches. Rather than coercing at every call site, this helper returns the
/// canonical key plus all alternate-typed keys the value could plausibly
/// represent. Callers insert *all* keys into the lookup set.
///
/// Coercion rules:
/// - `Text(s)` where `s` parses as `f64`: emit both the text key and the
///   number key for the parsed value.
/// - `Number(n)`: emit both the number key and the text-key matching the
///   number's lossless string form (e.g. `"2024"`, `"3.14"`).
/// - `Boolean(b)`: emit the bool key plus its `"true"`/`"false"` text key.
/// - All other variants: just the canonical single key.
///
/// The returned `Vec` is small (1–2 entries) and allocated only when
/// coercion applies; the canonical key is always first.
#[must_use]
pub fn cell_value_filter_keys(value: &CellValue) -> Vec<String> {
    let canonical = cell_value_to_key(value).into_owned();
    let mut out = vec![canonical];

    match value {
        CellValue::Text(s) => {
            let trimmed = s.trim();
            if !trimmed.is_empty()
                && let Ok(n) = trimmed.parse::<f64>()
                && n.is_finite()
            {
                let num_key = GroupKey::Number(f64_to_group_bits(n)).to_wire_string();
                if !out.contains(&num_key) {
                    out.push(num_key);
                }
            }
        }
        CellValue::Number(n) => {
            let v = n.get();
            if v.is_finite() {
                let s = format_number_for_text_key(v);
                let text_key =
                    GroupKey::Text(Arc::from(s.to_lowercase().as_str())).to_wire_string();
                if !out.contains(&text_key) {
                    out.push(text_key);
                }
            }
        }
        CellValue::Boolean(b) => {
            let text = if *b { "true" } else { "false" };
            let text_key = GroupKey::Text(Arc::from(text)).to_wire_string();
            if !out.contains(&text_key) {
                out.push(text_key);
            }
        }
        _ => {}
    }

    out
}

/// Format an `f64` as the shortest text representation that round-trips —
/// integers render without a decimal point (`2024` not `2024.0`), other
/// finite values use Rust's default `f64` `Display` impl.
fn format_number_for_text_key(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e16 {
        #[allow(clippy::cast_possible_truncation)]
        let i = n as i64;
        i.to_string()
    } else {
        n.to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use value_types::{CellError, CellValue};

    use super::*;
    use crate::values::cell_value_to_group_key;

    #[test]
    fn test_key_blank_variants() {
        assert_eq!(cell_value_to_key(&CellValue::Null).as_ref(), BLANK_KEY);
        assert_eq!(
            cell_value_to_key(&CellValue::Text("".into())).as_ref(),
            BLANK_KEY
        );
        assert_eq!(
            cell_value_to_key(&CellValue::Text("  ".into())).as_ref(),
            BLANK_KEY
        );
        assert_eq!(
            cell_value_to_key(&CellValue::Text("\t\n".into())).as_ref(),
            BLANK_KEY
        );
    }

    #[test]
    fn test_key_no_cross_type_collision() {
        assert_ne!(
            cell_value_to_key(&CellValue::number(42.0)),
            cell_value_to_key(&CellValue::Text("42".into()))
        );
        assert_ne!(
            cell_value_to_key(&CellValue::Boolean(true)),
            cell_value_to_key(&CellValue::Text("true".into()))
        );
    }

    #[test]
    fn test_key_negative_zero_positive_zero() {
        assert_eq!(
            cell_value_to_key(&CellValue::number(0.0)),
            cell_value_to_key(&CellValue::number(-0.0))
        );
    }

    #[test]
    fn test_key_nan_canonicalization() {
        let nan1 = f64::NAN;
        let nan2 = f64::from_bits(0x7FF8_0000_0000_0001);
        assert_eq!(
            cell_value_to_key(&CellValue::number(nan1)),
            cell_value_to_key(&CellValue::number(nan2))
        );
    }

    #[test]
    fn test_key_infinity_maps_to_error() {
        let pos_inf_val = CellValue::number(f64::INFINITY);
        let neg_inf_val = CellValue::number(f64::NEG_INFINITY);
        assert_eq!(
            cell_value_to_key(&pos_inf_val),
            cell_value_to_key(&neg_inf_val)
        );
    }

    #[test]
    fn test_key_case_insensitive_text() {
        assert_eq!(
            cell_value_to_key(&CellValue::Text("Hello".into())),
            cell_value_to_key(&CellValue::Text("hello".into()))
        );
    }

    #[test]
    fn test_key_text_that_looks_like_type_prefix() {
        let text_val = CellValue::Text("N:42".into());
        let num_val = CellValue::number(42.0);
        let text_key = cell_value_to_key(&text_val);
        let num_key = cell_value_to_key(&num_val);
        assert_ne!(text_key, num_key);
        assert!(text_key.starts_with("T:"));
    }

    #[test]
    fn test_key_error_distinct_from_text() {
        let err_val = CellValue::Error(CellError::Div0, None);
        let text_val = CellValue::Text("#DIV/0!".into());
        let err_key = cell_value_to_key(&err_val);
        let text_key = cell_value_to_key(&text_val);
        assert_ne!(err_key, text_key);
    }

    #[test]
    fn test_key_all_error_variants_except_ref_circ_distinct() {
        let errors = [
            CellError::Div0,
            CellError::Na,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Value,
            CellError::Spill,
            CellError::Calc,
            CellError::GettingData,
        ];
        let keys: Vec<_> = errors
            .iter()
            .map(|e| cell_value_to_key(&CellValue::Error(*e, None)).into_owned())
            .collect();
        for i in 0..keys.len() {
            for j in (i + 1)..keys.len() {
                assert_ne!(
                    keys[i], keys[j],
                    "Error keys {:?} and {:?} should be distinct",
                    errors[i], errors[j]
                );
            }
        }
        assert_eq!(
            cell_value_to_key(&CellValue::Error(CellError::Ref, None)),
            cell_value_to_key(&CellValue::Error(CellError::Circ, None))
        );
    }

    #[test]
    fn test_group_key_to_wire_string_matches_cell_value_to_key() {
        let cases: Vec<CellValue> = vec![
            CellValue::Null,
            CellValue::Text("".into()),
            CellValue::Text("  ".into()),
            CellValue::Text("Hello".into()),
            CellValue::Text("\x00BLANK\x00".into()),
            CellValue::number(0.0),
            CellValue::number(-0.0),
            CellValue::number(42.0),
            CellValue::number(3.14),
            CellValue::Boolean(true),
            CellValue::Boolean(false),
            CellValue::Error(CellError::Div0, None),
            CellValue::Error(CellError::Na, None),
            CellValue::from_rows(vec![vec![CellValue::number(1.0)]]),
        ];
        for v in cases {
            let wire = cell_value_to_key(&v).into_owned();
            let group = cell_value_to_group_key(&v).to_wire_string();
            assert_eq!(
                wire, group,
                "mismatch for {v:?}: cell_value_to_key={wire} group={group}"
            );
        }
    }

    #[test]
    fn test_key_returns_borrowed_for_constants() {
        let null_key = cell_value_to_key(&CellValue::Null);
        assert!(matches!(null_key, Cow::Borrowed(_)));

        let array_val = CellValue::from_rows(vec![vec![CellValue::Null]]);
        let array_key = cell_value_to_key(&array_val);
        assert!(matches!(array_key, Cow::Borrowed(_)));
    }

    #[test]
    fn test_key_fp_consistency() {
        let a = 0.1_f64 + 0.2;
        let b = 0.1_f64 + 0.2;
        assert_eq!(
            cell_value_to_key(&CellValue::number(a)),
            cell_value_to_key(&CellValue::number(b))
        );
    }

    #[test]
    fn test_whitespace_only_produces_blank_key() {
        assert_eq!(
            cell_value_to_key(&CellValue::Text("   ".into())).as_ref(),
            BLANK_KEY
        );
        assert_eq!(
            cell_value_to_key(&CellValue::Text("\t\n\r ".into())).as_ref(),
            BLANK_KEY
        );
    }

    #[test]
    fn filter_keys_for_text_numeric_includes_number_key() {
        let keys = cell_value_filter_keys(&CellValue::Text("2024".into()));
        assert!(keys.iter().any(|k| k.starts_with("T:2024")));
        let want_num = cell_value_to_key(&CellValue::number(2024.0)).into_owned();
        assert!(keys.contains(&want_num), "expected {want_num} in {keys:?}");
    }

    #[test]
    fn filter_keys_for_number_includes_integer_text_key() {
        let keys = cell_value_filter_keys(&CellValue::number(2024.0));
        let want_text = cell_value_to_key(&CellValue::Text("2024".into())).into_owned();
        assert!(
            keys.contains(&want_text),
            "expected {want_text} in {keys:?}"
        );
    }

    #[test]
    fn filter_keys_for_decimal_number_includes_decimal_text_key() {
        let keys = cell_value_filter_keys(&CellValue::number(3.14));
        assert!(keys.iter().any(|k| k == "T:3.14"), "{keys:?}");
    }

    #[test]
    fn filter_keys_for_text_non_numeric_returns_only_canonical() {
        let keys = cell_value_filter_keys(&CellValue::Text("North".into()));
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0], "T:north");
    }

    #[test]
    fn filter_keys_for_blank_returns_only_blank() {
        let keys = cell_value_filter_keys(&CellValue::Null);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0], BLANK_KEY);
    }

    #[test]
    fn filter_keys_for_boolean_includes_text_form() {
        let keys = cell_value_filter_keys(&CellValue::Boolean(true));
        assert!(keys.iter().any(|k| k.starts_with("B:true")));
        assert!(keys.iter().any(|k| k == "T:true"));
    }

    #[test]
    fn filter_keys_for_error_returns_only_canonical() {
        let keys = cell_value_filter_keys(&CellValue::Error(CellError::Div0, None));
        assert_eq!(keys, vec!["E:#DIV/0!".to_string()]);
    }
}
