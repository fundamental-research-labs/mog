use value_types::{CellError, CellValue};

/// Normalized key for case-insensitive text and tolerance-aware numeric matching.
///
/// Two cell values that COUNTIF considers "equal" must produce the same key.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum NormalizedKey {
    /// Quantized numeric: `(n * 1e10).round() as i64` for |n| <= 9e8,
    /// or `n.to_bits() as i64` for larger magnitudes.
    Number(i64),
    /// Lowercased text (case-insensitive matching).
    Text(String),
    Boolean(bool),
    Null,
    /// Preserves error variant: `#N/A` != `#VALUE!`.
    Error(CellError),
}

/// For |n| > this, quantization would overflow i64. At this magnitude, two
/// distinct representable f64 values can't be within 1e-10 of each other,
/// so bit-exact equality is correct.
const QUANTIZE_THRESHOLD: f64 = 9e8;

impl NormalizedKey {
    /// Quantize an f64 to an i64 key for tolerance-aware numeric matching.
    #[inline]
    fn quantize(n: f64) -> i64 {
        if n.abs() <= QUANTIZE_THRESHOLD {
            (n * 1e10).round() as i64
        } else {
            n.to_bits() as i64
        }
    }

    /// Normalize a cell value for frequency map keying.
    ///
    /// Text that parses as a number is normalized to `Number` so that
    /// `Text("2019")` and `Number(2019)` produce the same key. This matches
    /// Excel's COUNTIF/SUMIF/AVERAGEIF cross-type comparison semantics.
    #[inline]
    pub fn from_cell_value(v: &CellValue) -> Self {
        match v {
            CellValue::Number(n) => NormalizedKey::Number(Self::quantize(n.get())),
            CellValue::Text(s) => {
                let trimmed = s.trim();
                if let Ok(n) = trimmed.parse::<f64>()
                    && n.is_finite()
                {
                    return NormalizedKey::Number(Self::quantize(n));
                }
                NormalizedKey::Text(s.to_lowercase())
            }
            CellValue::Boolean(b) => NormalizedKey::Boolean(*b),
            CellValue::Control(c) => NormalizedKey::Boolean(c.value),
            CellValue::Image(image) => NormalizedKey::Text(image.fallback_text().to_lowercase()),
            CellValue::Null => NormalizedKey::Null,
            CellValue::Error(e, _) => NormalizedKey::Error(*e),
            CellValue::Array(arr) if arr.rows() == 1 && arr.cols() == 1 => {
                Self::from_cell_value(arr.get(0, 0).unwrap_or(&CellValue::Null))
            }
            _ => NormalizedKey::Null,
        }
    }
}
