use std::cmp::Ordering;

use value_types::{CellError, CellValue};

/// Internal comparable payload within a [`SortKey`].
///
/// Each variant implements `Ord` for within-type comparison.
#[derive(Debug, Clone)]
enum SortKeyData {
    /// f64 represented as canonicalized u64 bits for total ordering.
    Number(u64),
    /// Lowercased string for case-insensitive ordering.
    Text(String),
    /// Boolean value (false < true).
    Bool(bool),
    /// Error variant ordinal for deterministic ordering.
    ErrorOrdinal(u8),
    /// All blanks compare equal.
    Blank,
}

impl PartialEq for SortKeyData {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for SortKeyData {}

impl PartialOrd for SortKeyData {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SortKeyData {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (SortKeyData::Number(a), SortKeyData::Number(b)) => a.cmp(b),
            (SortKeyData::Text(a), SortKeyData::Text(b)) => a.cmp(b),
            (SortKeyData::Bool(a), SortKeyData::Bool(b)) => a.cmp(b),
            (SortKeyData::ErrorOrdinal(a), SortKeyData::ErrorOrdinal(b)) => a.cmp(b),
            _ => Ordering::Equal,
        }
    }
}

/// A fully-ordered sort key for `CellValue`.
///
/// Type priority (ascending) — matches Excel's sort behavior:
/// - 0 = Number
/// - 1 = Text
/// - 2 = Boolean
/// - 3 = Error
/// - 4 = Blank (always sorted last, regardless of direction)
///
/// When reversing sort direction (descending), only the **within-type**
/// comparison is reversed.  The type priority itself does NOT reverse.
/// This matches Excel's behavior: blanks always sort last; numbers sort
/// first (before text before booleans before errors).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SortKey {
    /// Type priority: Number(0) < Text(1) < Boolean(2) < Error(3) < Blank(4)
    type_priority: u8,
    /// Comparable representation within type.
    key_data: SortKeyData,
}

impl PartialOrd for SortKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SortKey {
    fn cmp(&self, other: &Self) -> Ordering {
        self.type_priority
            .cmp(&other.type_priority)
            .then_with(|| self.key_data.cmp(&other.key_data))
    }
}

impl SortKey {
    /// Returns the type priority of this sort key.
    ///
    /// Useful for verifying that type priority is stable across sort
    /// direction changes.
    #[must_use]
    pub fn type_priority(&self) -> u8 {
        self.type_priority
    }
}

/// Canonicalize an f64 into u64 bits that sort correctly.
///
/// IEEE 754 layout: sign(1) | exponent(11) | mantissa(52).
/// Positive floats already sort correctly as u64.
/// Negative floats need all bits flipped.
/// This gives a total order: -Inf < -1 < -0 == +0 < +1 < +Inf < NaN.
fn f64_to_sortable_bits(n: f64) -> u64 {
    let n = if n == 0.0 { 0.0 } else { n };
    let n = if n.is_nan() { f64::NAN } else { n };

    let bits = n.to_bits();
    if n.is_sign_negative() {
        !bits
    } else {
        bits ^ (1u64 << 63)
    }
}

/// Map a `CellError` variant to a stable ordinal for sorting.
fn error_ordinal(e: CellError) -> u8 {
    match e {
        CellError::Div0 => 0,
        CellError::Na => 1,
        CellError::Name => 2,
        CellError::Null => 3,
        CellError::Num => 4,
        CellError::Ref | CellError::Circ => 5,
        CellError::Value => 6,
        CellError::Spill => 7,
        CellError::Calc => 8,
        CellError::GettingData => 9,
    }
}

/// Convert a `CellValue` into a [`SortKey`] for deterministic, Excel-like
/// ordering.
///
/// Blanks always receive `type_priority = 4` so they sort **last**
/// regardless of ascending or descending direction.
///
/// # Sort direction
///
/// To sort descending, reverse only the within-type comparison:
/// ```text
/// // ascending:  key_a.cmp(&key_b)
/// // descending: key_b.cmp(&key_a)   // but blanks still sort last
/// ```
/// Because `type_priority` is always compared in ascending order, blanks
/// (priority 4) always appear after all other types.
#[must_use]
pub fn cell_value_to_sort_key(v: &CellValue) -> SortKey {
    if v.is_visually_blank() {
        return SortKey {
            type_priority: 4,
            key_data: SortKeyData::Blank,
        };
    }

    match v {
        CellValue::Number(n) => SortKey {
            type_priority: 0,
            key_data: SortKeyData::Number(f64_to_sortable_bits(n.get())),
        },
        CellValue::Text(s) => SortKey {
            type_priority: 1,
            key_data: SortKeyData::Text(s.to_lowercase()),
        },
        CellValue::Boolean(b) => SortKey {
            type_priority: 2,
            key_data: SortKeyData::Bool(*b),
        },
        CellValue::Control(c) => SortKey {
            type_priority: 2,
            key_data: SortKeyData::Bool(c.value),
        },
        CellValue::Image(image) => SortKey {
            type_priority: 1,
            key_data: SortKeyData::Text(image.fallback_text().to_lowercase()),
        },
        CellValue::Error(e, _) => SortKey {
            type_priority: 3,
            key_data: SortKeyData::ErrorOrdinal(error_ordinal(*e)),
        },
        CellValue::Null | CellValue::Array(_) => SortKey {
            type_priority: 4,
            key_data: SortKeyData::Blank,
        },
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use value_types::{CellControl, CellError, CellImage, CellImageSizing, CellValue};

    use super::*;

    #[test]
    fn test_sort_key_type_priority_ascending() {
        let number = cell_value_to_sort_key(&CellValue::number(1.0));
        let text = cell_value_to_sort_key(&CellValue::Text("a".into()));
        let bool_val = cell_value_to_sort_key(&CellValue::Boolean(false));
        let error = cell_value_to_sort_key(&CellValue::Error(CellError::Div0, None));
        let blank = cell_value_to_sort_key(&CellValue::Null);

        assert!(number < text);
        assert!(text < bool_val);
        assert!(bool_val < error);
        assert!(error < blank);
    }

    #[test]
    fn test_sort_key_blanks_always_last_ascending() {
        let values = [
            CellValue::number(1.0),
            CellValue::Null,
            CellValue::Text("z".into()),
            CellValue::Boolean(true),
            CellValue::Error(CellError::Na, None),
        ];

        let mut keys: Vec<_> = values.iter().map(cell_value_to_sort_key).collect();
        keys.sort();

        assert_eq!(keys.last().unwrap().type_priority(), 4);
    }

    #[test]
    fn test_sort_key_blanks_always_last_descending() {
        let blank = cell_value_to_sort_key(&CellValue::Null);
        let number = cell_value_to_sort_key(&CellValue::number(100.0));
        let text = cell_value_to_sort_key(&CellValue::Text("z".into()));

        assert!(blank.type_priority() > number.type_priority());
        assert!(blank.type_priority() > text.type_priority());
    }

    #[test]
    fn test_sort_key_type_priority_stable_in_descending() {
        assert_eq!(
            cell_value_to_sort_key(&CellValue::number(42.0)).type_priority(),
            0
        );
        assert_eq!(
            cell_value_to_sort_key(&CellValue::Error(CellError::Div0, None)).type_priority(),
            3
        );
        assert_eq!(cell_value_to_sort_key(&CellValue::Null).type_priority(), 4);
    }

    #[test]
    fn test_sort_key_within_type_number_ordering() {
        let neg = cell_value_to_sort_key(&CellValue::number(-1.0));
        let zero = cell_value_to_sort_key(&CellValue::number(0.0));
        let pos = cell_value_to_sort_key(&CellValue::number(1.0));

        assert!(neg < zero);
        assert!(zero < pos);
    }

    #[test]
    fn test_sort_key_within_type_text_ordering() {
        let a = cell_value_to_sort_key(&CellValue::Text("apple".into()));
        let b = cell_value_to_sort_key(&CellValue::Text("Banana".into()));
        assert!(a < b);
    }

    #[test]
    fn test_sort_key_text_case_insensitive_ordering() {
        let upper = cell_value_to_sort_key(&CellValue::Text("A".into()));
        let lower = cell_value_to_sort_key(&CellValue::Text("a".into()));
        assert_eq!(upper, lower);

        let a = cell_value_to_sort_key(&CellValue::Text("a".into()));
        let b = cell_value_to_sort_key(&CellValue::Text("b".into()));
        assert!(a < b);
    }

    #[test]
    fn test_sort_key_within_type_bool_ordering() {
        let f = cell_value_to_sort_key(&CellValue::Boolean(false));
        let t = cell_value_to_sort_key(&CellValue::Boolean(true));
        assert!(f < t);
    }

    #[test]
    fn test_sort_key_control_as_bool() {
        assert_eq!(
            cell_value_to_sort_key(&CellValue::Control(CellControl::checkbox(true))),
            cell_value_to_sort_key(&CellValue::Boolean(true))
        );
    }

    #[test]
    fn test_sort_key_image_fallback_ordering_is_lowercased() {
        let image = CellValue::Image(CellImage::new(
            "https://example.test/image.png",
            Some(Arc::from("Banana")),
            CellImageSizing::Fit,
            None,
            None,
        ));
        assert_eq!(
            cell_value_to_sort_key(&image),
            cell_value_to_sort_key(&CellValue::Text("banana".into()))
        );
    }

    #[test]
    fn test_sort_key_within_type_error_ordering() {
        let div0 = cell_value_to_sort_key(&CellValue::Error(CellError::Div0, None));
        let na = cell_value_to_sort_key(&CellValue::Error(CellError::Na, None));
        let value = cell_value_to_sort_key(&CellValue::Error(CellError::Value, None));

        assert!(div0 < na);
        assert!(na < value);
    }

    #[test]
    fn test_sort_key_error_ordinals() {
        let errors = [
            CellError::Div0,
            CellError::Na,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Circ,
            CellError::Value,
            CellError::Spill,
            CellError::Calc,
            CellError::GettingData,
        ];
        let ordinals: Vec<_> = errors.iter().map(|e| error_ordinal(*e)).collect();
        assert_eq!(ordinals, vec![0, 1, 2, 3, 4, 5, 5, 6, 7, 8, 9]);
    }

    #[test]
    fn test_sort_key_neg_zero_eq_pos_zero() {
        let pos = cell_value_to_sort_key(&CellValue::number(0.0));
        let neg = cell_value_to_sort_key(&CellValue::number(-0.0));
        assert_eq!(pos, neg);
    }

    #[test]
    fn test_sort_key_whitespace_only_is_blank() {
        let ws = cell_value_to_sort_key(&CellValue::Text("   ".into()));
        let null = cell_value_to_sort_key(&CellValue::Null);
        assert_eq!(ws, null);
        assert_eq!(ws.type_priority(), 4);
    }

    #[test]
    fn test_sort_key_blanks_all_equivalent() {
        let null = cell_value_to_sort_key(&CellValue::Null);
        let empty = cell_value_to_sort_key(&CellValue::Text("".into()));
        let spaces = cell_value_to_sort_key(&CellValue::Text("  ".into()));
        assert_eq!(null, empty);
        assert_eq!(empty, spaces);
        assert_eq!(null.type_priority(), 4);
    }

    #[test]
    fn test_sort_key_array_sorts_as_blank() {
        let array = cell_value_to_sort_key(&CellValue::from_rows(vec![vec![CellValue::Null]]));
        let blank = cell_value_to_sort_key(&CellValue::Null);
        assert_eq!(array, blank);
    }

    #[test]
    fn test_sortable_bits_total_order() {
        let values: Vec<f64> = vec![
            f64::NEG_INFINITY,
            -1e100,
            -1.0,
            -f64::MIN_POSITIVE,
            -0.0,
            0.0,
            f64::MIN_POSITIVE,
            1.0,
            1e100,
            f64::INFINITY,
        ];

        let bits: Vec<u64> = values.iter().map(|n| f64_to_sortable_bits(*n)).collect();
        for i in 0..(bits.len() - 1) {
            assert!(
                bits[i] <= bits[i + 1],
                "Expected bits[{}] ({}) <= bits[{}] ({}), for values {} <= {}",
                i,
                bits[i],
                i + 1,
                bits[i + 1],
                values[i],
                values[i + 1]
            );
        }
    }
}
