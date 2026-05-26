//! OOXML ↔ pixel unit conversion with type-safe dimension newtypes.
//!
//! ECMA-376 stores column widths in "character units" (relative to the Normal
//! style font's maximum digit width) and row heights in points. The rendering
//! pipeline works in pixels. This module provides:
//!
//! 1. **Newtypes** (`Points`, `Pixels`, `CharWidth`) that make unit mismatches
//!    a compile-time error.
//! 2. **Typed conversion functions** that enforce correct unit flow.
//!
//! # Key concepts
//!
//! - **MDW** (Maximum Digit Width): the advance width of the widest digit (0-9)
//!   in the Normal style font, in pixels. For Calibri 11pt: 7px at 96 DPI
//!   (Windows/Linux), 8px on macOS (Core Text).
//!
//! - **PP** (Pixel Padding): `2 * ceil(MDW / 4) + 1`. Accounts for left/right
//!   cell margin (2× quarter-MDW) plus 1px gridline.
//!
//! # Formulas (from ClosedXML's reverse-engineering of Excel behavior)
//!
//! ```text
//! char_width → pixels:
//!   content_px = trunc(((256 × width + trunc(128 / MDW)) / 256) × MDW)
//!   total_px   = content_px + PP
//!
//! pixels → char_width:
//!   width = trunc(((pixels - PP) / MDW) × 256) / 256
//!
//! points → pixels:
//!   pixels = points × DPI / 72        (DPI = 96 for standard screens)
//!
//! pixels → points:
//!   points = pixels × 72 / DPI
//! ```
//!
//! Reference: <https://github.com/ClosedXML/ClosedXML/wiki/Cell-Dimensions>

use serde::{Deserialize, Serialize};
use std::fmt;
use std::iter::Sum;
use std::ops::{Add, Div, Mul, Sub};

// =============================================================================
// Type-safe dimension newtypes
// =============================================================================

/// Row height in OOXML points (1pt = 1/72 inch). Stored in Yrs.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct Points(pub f64);

/// Pixel dimension for rendering/bridge. Used by LayoutIndex and TypeScript.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct Pixels(pub f64);

/// Column width in OOXML character-width units (relative to MDW). Stored in Yrs.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct CharWidth(pub f64);

// --- Arithmetic impls (macro to avoid repetition) ---

macro_rules! impl_unit_ops {
    ($T:ty) => {
        impl Add for $T {
            type Output = Self;
            fn add(self, rhs: Self) -> Self {
                Self(self.0 + rhs.0)
            }
        }
        impl Sub for $T {
            type Output = Self;
            fn sub(self, rhs: Self) -> Self {
                Self(self.0 - rhs.0)
            }
        }
        impl Mul<f64> for $T {
            type Output = Self;
            fn mul(self, rhs: f64) -> Self {
                Self(self.0 * rhs)
            }
        }
        impl Div<f64> for $T {
            type Output = Self;
            fn div(self, rhs: f64) -> Self {
                Self(self.0 / rhs)
            }
        }
        impl Sum for $T {
            fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
                Self(iter.map(|v| v.0).sum())
            }
        }
        impl fmt::Display for $T {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }
    };
}

impl_unit_ops!(Points);
impl_unit_ops!(Pixels);
impl_unit_ops!(CharWidth);

// =============================================================================
// MDW constants
// =============================================================================

/// MDW for Calibri 11pt at 96 DPI (Windows/Linux).
pub const MDW_CALIBRI_11_96DPI: f64 = 7.0;

/// MDW for Calibri 11pt on macOS (Core Text rendering).
pub const MDW_CALIBRI_11_MACOS: f64 = 8.0;

/// Returns the platform-appropriate MDW for Calibri 11pt.
pub fn platform_mdw() -> f64 {
    if cfg!(target_os = "macos") {
        MDW_CALIBRI_11_MACOS
    } else {
        MDW_CALIBRI_11_96DPI
    }
}

// =============================================================================
// Column width: character units ↔ pixels
// =============================================================================

/// Pixel padding for a given MDW.
///
/// ECMA-376: PP = 2 × ⌈MDW/4⌉ + 1
fn pixel_padding(mdw: f64) -> f64 {
    2.0 * (mdw / 4.0).ceil() + 1.0
}

/// Convert OOXML character-width units to pixels.
///
/// Uses the ECMA-376 formula (via ClosedXML reverse-engineering):
///   content_px = trunc(((256 × width + trunc(128/MDW)) / 256) × MDW)
///   total_px   = content_px + PP
pub fn char_width_to_pixels(width: CharWidth, mdw: f64) -> Pixels {
    let pp = pixel_padding(mdw);
    if width.0 <= 0.0 {
        return Pixels(0.0);
    }
    let content_px = (((256.0 * width.0 + (128.0_f64 / mdw).trunc()) / 256.0) * mdw).trunc();
    Pixels(content_px + pp)
}

/// Convert pixels to OOXML character-width units.
///
/// Inverse of `char_width_to_pixels`:
///   width = trunc(((pixels - PP) / MDW) × 256) / 256
pub fn pixels_to_char_width(pixels: Pixels, mdw: f64) -> CharWidth {
    let pp = pixel_padding(mdw);
    if pixels.0 <= 0.0 {
        return CharWidth(0.0);
    }
    if pixels.0 >= mdw + pp {
        CharWidth((((pixels.0 - pp) / mdw) * 256.0).trunc() / 256.0)
    } else {
        CharWidth((pixels.0 / (mdw + pp) * 256.0).trunc() / 256.0)
    }
}

// =============================================================================
// Row height: points ↔ pixels
// =============================================================================

/// Standard screen DPI.
const SCREEN_DPI: f64 = 96.0;

/// Convert OOXML row height (points) to pixels.
///
/// points × DPI / 72. At 96 DPI: points × 4/3.
pub fn points_to_pixels(pt: Points) -> Pixels {
    Pixels(pt.0 * SCREEN_DPI / 72.0)
}

/// Convert pixels to OOXML row height (points).
///
/// pixels × 72 / DPI. At 96 DPI: pixels × 3/4.
pub fn pixels_to_points(px: Pixels) -> Points {
    Points(px.0 * 72.0 / SCREEN_DPI)
}

// =============================================================================
// Default dimension constants (canonical units)
// =============================================================================

/// Default row height: 15 points (= 20px at 96 DPI).
pub const DEFAULT_ROW_HEIGHT: Points = Points(15.0);

/// Default column width: 8.43 character-width units.
pub const DEFAULT_COL_WIDTH: CharWidth = CharWidth(8.43);

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_col_width_windows() {
        // 8.43 chars @ MDW=7 should give 64 pixels
        let px = char_width_to_pixels(CharWidth(8.43), MDW_CALIBRI_11_96DPI);
        assert_eq!(px, Pixels(64.0));
    }

    #[test]
    fn default_col_width_macos() {
        // 8.43 chars @ MDW=8 should give 72 pixels
        let px = char_width_to_pixels(CharWidth(8.43), MDW_CALIBRI_11_MACOS);
        assert_eq!(px, Pixels(72.0));
    }

    #[test]
    fn roundtrip_char_width_windows() {
        let mdw = MDW_CALIBRI_11_96DPI;
        let original = CharWidth(8.43);
        let px = char_width_to_pixels(original, mdw);
        let back = pixels_to_char_width(px, mdw);
        assert!((back.0 - original.0).abs() < 0.01, "got {back}");
    }

    #[test]
    fn roundtrip_char_width_macos() {
        let mdw = MDW_CALIBRI_11_MACOS;
        let original = CharWidth(8.43);
        let px = char_width_to_pixels(original, mdw);
        assert_eq!(px, Pixels(72.0));
        let back = pixels_to_char_width(px, mdw);
        assert!((back.0 - original.0).abs() < 0.1, "got {back}");
    }

    #[test]
    fn wide_column() {
        let px = char_width_to_pixels(CharWidth(20.0), MDW_CALIBRI_11_96DPI);
        assert_eq!(px, Pixels(145.0));
    }

    #[test]
    fn narrow_column() {
        let px = char_width_to_pixels(CharWidth(1.0), MDW_CALIBRI_11_96DPI);
        assert_eq!(px, Pixels(12.0));
    }

    #[test]
    fn zero_width() {
        assert_eq!(char_width_to_pixels(CharWidth(0.0), 7.0), Pixels(0.0));
        assert_eq!(pixels_to_char_width(Pixels(0.0), 7.0), CharWidth(0.0));
    }

    #[test]
    fn default_row_height() {
        // 15pt → 20px at 96 DPI
        assert_eq!(points_to_pixels(Points(15.0)), Pixels(20.0));
    }

    #[test]
    fn roundtrip_row_height() {
        let pt = Points(15.0);
        let px = points_to_pixels(pt);
        let back = pixels_to_points(px);
        assert!((back.0 - pt.0).abs() < 0.001);
    }

    #[test]
    fn arithmetic_same_type() {
        assert_eq!(Pixels(10.0) + Pixels(5.0), Pixels(15.0));
        assert_eq!(Points(10.0) - Points(3.0), Points(7.0));
        assert_eq!(CharWidth(4.0) * 2.0, CharWidth(8.0));
        assert_eq!(Pixels(20.0) / 4.0, Pixels(5.0));
    }

    #[test]
    fn sum_trait() {
        let vals = vec![Pixels(10.0), Pixels(20.0), Pixels(30.0)];
        let total: Pixels = vals.into_iter().sum();
        assert_eq!(total, Pixels(60.0));
    }

    #[test]
    fn default_is_zero() {
        assert_eq!(Points::default(), Points(0.0));
        assert_eq!(Pixels::default(), Pixels(0.0));
        assert_eq!(CharWidth::default(), CharWidth(0.0));
    }
}
