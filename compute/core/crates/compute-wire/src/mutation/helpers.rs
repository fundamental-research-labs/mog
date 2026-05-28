//! Shared helper functions for mutation serialization.

use std::collections::HashMap;

use crate::constants::NO_STRING;
use crate::types::ViewportBounds;
use crate::viewport::intern_str;
use value_types::CellValue;

/// Pre-resolved CF color overrides for a set of cells.
///
/// Wraps a map from `(row, col)` to `(bg_color_override, font_color_override)`
/// as packed RGBA `u32` values (0 means no override).
///
/// Callers build this from the CF cache so that `compute-wire` doesn't need a
/// dependency on `compute-cf`.
#[derive(Debug, Clone, Default)]
pub struct CfColorOverrides(HashMap<(u32, u32), (u32, u32)>);

impl CfColorOverrides {
    /// Create an empty overrides map with the given capacity.
    #[must_use]
    pub fn with_capacity(capacity: usize) -> Self {
        Self(HashMap::with_capacity(capacity))
    }

    /// Insert a color override for a cell position.
    pub fn insert(&mut self, row: u32, col: u32, bg_color: u32, font_color: u32) {
        self.0.insert((row, col), (bg_color, font_color));
    }

    /// Look up color overrides for a cell position.
    #[must_use]
    pub fn get(&self, row: u32, col: u32) -> Option<(u32, u32)> {
        self.0.get(&(row, col)).copied()
    }

    /// Whether the map is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// Extract the wire `f64` number value from a [`CellValue`].
///
/// Numbers and booleans produce their numeric representation; all other
/// variants produce `NaN`.
#[inline]
pub(crate) fn number_value_for(value: &CellValue) -> f64 {
    match value {
        CellValue::Number(n) => n.get(),
        CellValue::Boolean(b) => f64::from(u8::from(*b)),
        _ => f64::NAN,
    }
}

/// Intern the error string (if any) from a [`CellValue`] into the string pool.
///
/// Returns `(offset, len)` or `(NO_STRING, 0)` for non-error values.
#[inline]
pub(crate) fn intern_error_string(pool: &mut Vec<u8>, value: &CellValue) -> (u32, u16) {
    match value {
        CellValue::Error(e, _) => intern_str(pool, e.as_str()),
        CellValue::Image(image) => match serde_json::to_string(image) {
            Ok(metadata) => intern_str(pool, &metadata),
            Err(_) => (NO_STRING, 0),
        },
        _ => (NO_STRING, 0),
    }
}

/// Generate default display text for a [`CellValue`] that lacks a pre-computed
/// `display_text` field (e.g. spill projection cells).
///
/// Uses [`CellValue`]'s `Display` impl for `Number`, `Text`, `Boolean`, and
/// `Error` variants, returning `None` for `Null` and a placeholder `"{...}"`
/// for `Array` (since expanding full arrays in display text is unhelpful).
pub(crate) fn display_text_for_value(value: &CellValue) -> Option<String> {
    match value {
        CellValue::Null => None,
        // Array Display impl expands every element; use a compact placeholder.
        CellValue::Array(_) => Some("{...}".to_string()),
        // All other variants: use the canonical CellValue::Display impl which
        // calls value_types::format_number, "TRUE"/"FALSE", error.as_str(), etc.
        other => Some(other.to_string()),
    }
}

/// Return `true` if `(row, col)` is within the inclusive `bounds`, or if no
/// bounds are specified.
#[inline]
pub(crate) fn within_bounds(row: u32, col: u32, bounds: Option<ViewportBounds>) -> bool {
    match bounds {
        None => true,
        Some(b) => b.contains(row, col),
    }
}

/// Resolve CF color overrides for a `(row, col)` pair.
#[inline]
pub(crate) fn resolve_cf_colors(
    cf_colors: Option<&CfColorOverrides>,
    row: u32,
    col: u32,
) -> (u32, u32) {
    cf_colors.and_then(|m| m.get(row, col)).unwrap_or((0, 0))
}
