//! Append-only format palette with stable indices.
//!
//! New formats get new indices; old indices never change within a sheet session.
//! Used for viewport binary transfer -- deduplicates format objects so only
//! 5-20 unique formats are sent instead of 2000 copies.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use domain_types::CellFormat;

/// Error returned when [`FormatPalette::intern`] is called on a full palette
/// (≥ 65 535 unique formats).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaletteFullError;

impl std::fmt::Display for PaletteFullError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("format palette is full (u16::MAX unique formats)")
    }
}

impl std::error::Error for PaletteFullError {}

/// Compute a deterministic 64-bit hash for a `CellFormat`.
fn hash_format(format: &CellFormat) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    format.hash(&mut hasher);
    hasher.finish()
}

/// Append-only palette that interns [`CellFormat`] instances and returns stable
/// `u16` indices. Stored per-sheet in the engine.
///
/// Uses a hash-based index for O(1) lookups without cloning the full
/// `CellFormat` struct on each miss. Hash collisions are resolved by
/// comparing against the stored format in the `formats` vec.
#[derive(Debug, Clone)]
pub struct FormatPalette {
    formats: Vec<CellFormat>,
    /// Maps content hash → list of indices with that hash (handles collisions).
    index: HashMap<u64, Vec<u16>>,
}

impl FormatPalette {
    /// Creates a new empty palette.
    #[must_use]
    pub fn new() -> Self {
        Self {
            formats: Vec::new(),
            index: HashMap::new(),
        }
    }

    /// Intern a format, returning its stable index.
    /// If the format already exists, returns the existing index.
    /// If it is new, appends it and returns the new index.
    ///
    /// # Errors
    ///
    /// Returns [`PaletteFullError`] if the palette already contains `u16::MAX`
    /// unique formats.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_wire::FormatPalette;
    /// use domain_types::CellFormat;
    ///
    /// let mut palette = FormatPalette::new();
    /// let bold = CellFormat { bold: Some(true), ..Default::default() };
    /// let idx1 = palette.intern(&bold).unwrap();
    /// let idx2 = palette.intern(&bold).unwrap(); // same format → same index
    /// assert_eq!(idx1, idx2);
    /// assert_eq!(palette.len(), 1);
    /// ```
    pub fn intern(&mut self, format: &CellFormat) -> Result<u16, PaletteFullError> {
        let h = hash_format(format);

        // Check existing entries with this hash for an exact match.
        if let Some(indices) = self.index.get(&h) {
            for &idx in indices {
                if self.formats[idx as usize] == *format {
                    return Ok(idx);
                }
            }
        }

        let len = self.formats.len();
        if len >= u16::MAX as usize {
            return Err(PaletteFullError);
        }
        // Safe: guarded by the check above.
        #[allow(clippy::cast_possible_truncation)]
        let idx = len as u16;
        self.index.entry(h).or_default().push(idx);
        self.formats.push(format.clone());
        Ok(idx)
    }

    /// Get all interned formats (ordered by index).
    #[must_use]
    pub fn formats(&self) -> &[CellFormat] {
        &self.formats
    }

    /// Get a format by index.
    #[must_use]
    pub fn get(&self, idx: u16) -> Option<&CellFormat> {
        self.formats.get(idx as usize)
    }

    /// Number of unique formats in the palette.
    #[must_use]
    pub fn len(&self) -> usize {
        self.formats.len()
    }

    /// Whether the palette is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.formats.is_empty()
    }

    /// Reset the palette (used on sheet switch).
    pub fn clear(&mut self) {
        self.formats.clear();
        self.index.clear();
    }

    /// Get formats added since a given index (for delta responses).
    /// Returns `formats[since_index..]` -- the new entries.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_wire::FormatPalette;
    /// use domain_types::CellFormat;
    ///
    /// let mut palette = FormatPalette::new();
    /// palette.intern(&CellFormat { bold: Some(true), ..Default::default() }).unwrap();
    /// palette.intern(&CellFormat { italic: Some(true), ..Default::default() }).unwrap();
    /// palette.intern(&CellFormat { strikethrough: Some(true), ..Default::default() }).unwrap();
    ///
    /// let delta = palette.formats_since(1);
    /// assert_eq!(delta.len(), 2); // only the italic + strikethrough entries
    /// ```
    #[must_use]
    pub fn formats_since(&self, since_index: u16) -> &[CellFormat] {
        let start = since_index as usize;
        if start >= self.formats.len() {
            &[]
        } else {
            &self.formats[start..]
        }
    }
}

impl Default for FormatPalette {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::CellFormat;

    #[test]
    fn test_intern_returns_same_index_for_identical_formats() {
        let mut palette = FormatPalette::new();
        let fmt = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        let idx1 = palette.intern(&fmt).unwrap();
        let idx2 = palette.intern(&fmt).unwrap();
        assert_eq!(idx1, idx2);
        assert_eq!(palette.len(), 1);
    }

    #[test]
    fn test_intern_returns_new_index_for_different_formats() {
        let mut palette = FormatPalette::new();
        let bold = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        let italic = CellFormat {
            italic: Some(true),
            ..Default::default()
        };
        let idx1 = palette.intern(&bold).unwrap();
        let idx2 = palette.intern(&italic).unwrap();
        assert_ne!(idx1, idx2);
        assert_eq!(palette.len(), 2);
    }

    #[test]
    fn test_indices_are_stable_after_adding_more() {
        let mut palette = FormatPalette::new();
        let fmt1 = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        let fmt2 = CellFormat {
            italic: Some(true),
            ..Default::default()
        };
        let idx1 = palette.intern(&fmt1).unwrap();
        let _ = palette.intern(&fmt2);
        let idx1_again = palette.intern(&fmt1).unwrap();
        assert_eq!(idx1, idx1_again);
    }

    #[test]
    fn test_get_returns_correct_format() {
        let mut palette = FormatPalette::new();
        let fmt = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        let idx = palette.intern(&fmt).unwrap();
        assert_eq!(palette.get(idx), Some(&fmt));
    }

    #[test]
    fn test_clear_resets_palette() {
        let mut palette = FormatPalette::new();
        let _ = palette.intern(&CellFormat::default());
        palette.clear();
        assert_eq!(palette.len(), 0);
        assert!(palette.is_empty());
    }

    #[test]
    fn test_formats_since() {
        let mut palette = FormatPalette::new();
        let fmt1 = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        let fmt2 = CellFormat {
            italic: Some(true),
            ..Default::default()
        };
        let fmt3 = CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(14000)),
            ..Default::default()
        };
        let _ = palette.intern(&fmt1);
        let _ = palette.intern(&fmt2);
        let _ = palette.intern(&fmt3);
        let since = palette.formats_since(1);
        assert_eq!(since.len(), 2);
        assert_eq!(since[0], fmt2);
        assert_eq!(since[1], fmt3);
    }

    #[test]
    fn test_formats_since_out_of_range() {
        let mut palette = FormatPalette::new();
        let _ = palette.intern(&CellFormat::default());
        let since = palette.formats_since(5);
        assert!(since.is_empty());
    }

    #[test]
    fn test_default_format_gets_index_zero() {
        let mut palette = FormatPalette::new();
        let idx = palette.intern(&CellFormat::default()).unwrap();
        assert_eq!(idx, 0);
    }

    #[test]
    fn test_default_trait() {
        let palette = FormatPalette::default();
        assert_eq!(palette.len(), 0);
        assert!(palette.is_empty());
    }

    #[test]
    fn test_get_out_of_bounds() {
        let mut palette = FormatPalette::new();
        let _ = palette.intern(&CellFormat {
            bold: Some(true),
            ..Default::default()
        });
        assert!(palette.get(0).is_some());
        assert!(palette.get(1).is_none());
        assert!(palette.get(u16::MAX).is_none());
    }

    #[test]
    fn test_high_volume_interning() {
        let mut palette = FormatPalette::new();
        for i in 0..1000u32 {
            let fmt = CellFormat {
                font_size: Some(domain_types::FontSize::from_millipoints(i * 100 + 1000)),
                ..Default::default()
            };
            let _ = palette.intern(&fmt);
        }
        assert_eq!(palette.len(), 1000);

        // Re-intern the first format — should return stable index 0.
        let first = CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(1000)),
            ..Default::default()
        };
        assert_eq!(palette.intern(&first).unwrap(), 0);
        assert_eq!(palette.len(), 1000);
    }

    #[test]
    fn test_formats_returns_ordered_slice() {
        let mut palette = FormatPalette::new();
        let fmt0 = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        let fmt1 = CellFormat {
            italic: Some(true),
            ..Default::default()
        };
        let fmt2 = CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(20000)),
            ..Default::default()
        };
        let _ = palette.intern(&fmt0);
        let _ = palette.intern(&fmt1);
        let _ = palette.intern(&fmt2);

        let all = palette.formats();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0], fmt0);
        assert_eq!(all[1], fmt1);
        assert_eq!(all[2], fmt2);
    }

    #[test]
    fn test_clear_then_reuse() {
        let mut palette = FormatPalette::new();
        let old0 = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        let old1 = CellFormat {
            italic: Some(true),
            ..Default::default()
        };
        let old2 = CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(12000)),
            ..Default::default()
        };
        let _ = palette.intern(&old0);
        let _ = palette.intern(&old1);
        let _ = palette.intern(&old2);

        palette.clear();

        let new0 = CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(18000)),
            ..Default::default()
        };
        let new1 = CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(24000)),
            ..Default::default()
        };
        let idx0 = palette.intern(&new0).unwrap();
        let idx1 = palette.intern(&new1).unwrap();

        assert_eq!(palette.len(), 2);
        assert_eq!(idx0, 0);
        assert_eq!(idx1, 1);
        // Old indices no longer valid — only 2 entries exist now.
        assert!(palette.get(2).is_none());
    }

    #[test]
    fn test_formats_since_zero() {
        let mut palette = FormatPalette::new();
        let fmt0 = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        let fmt1 = CellFormat {
            italic: Some(true),
            ..Default::default()
        };
        let fmt2 = CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(14000)),
            ..Default::default()
        };
        let _ = palette.intern(&fmt0);
        let _ = palette.intern(&fmt1);
        let _ = palette.intern(&fmt2);

        let since = palette.formats_since(0);
        assert_eq!(since.len(), 3);
        assert_eq!(since[0], fmt0);
        assert_eq!(since[1], fmt1);
        assert_eq!(since[2], fmt2);
    }

    #[test]
    fn test_intern_after_clear_reindexes() {
        let mut palette = FormatPalette::new();
        let fmt_a = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        let fmt_b = CellFormat {
            italic: Some(true),
            ..Default::default()
        };
        assert_eq!(palette.intern(&fmt_a).unwrap(), 0);
        assert_eq!(palette.intern(&fmt_b).unwrap(), 1);

        palette.clear();

        // After clear, fmt_b gets index 0, not its old index 1.
        assert_eq!(palette.intern(&fmt_b).unwrap(), 0);
        assert_eq!(palette.len(), 1);
    }
}
