//! Primitive types and constants for DrawingML.
//!
//! This module defines:
//! - `Emu` type alias and measurement constants
//! - Validated newtypes for all ECMA-376 DML simple types (ST_* types)
//! - `EditAs` enum for drawing anchor behavior
//!
//! # Newtype design
//!
//! XSD simple types with range constraints are represented as `#[repr(transparent)]`
//! newtypes over their inner primitive. This provides:
//! - **Compile-time unit safety**: can't pass an `StAngle` where an `StPercentage` is expected
//! - **Parse-time validation**: `new()` rejects out-of-range values, `new_clamped()` clamps
//! - **Zero runtime cost**: `#[repr(transparent)]` is identical to the inner type at runtime
//! - **Transparent serde**: serializes/deserializes as the inner value

// =============================================================================
// Newtype macros (crate-internal)
// =============================================================================

/// Defines a `#[repr(transparent)]` newtype over a numeric primitive.
///
/// **Unconstrained** variant: any value of the inner type is valid.
/// **Constrained** variant: values must be within `MIN..=MAX`.
macro_rules! ooxml_newtype_int {
    // ── Unconstrained ────────────────────────────────────────────────────
    ($(#[$meta:meta])* $vis:vis $name:ident($inner:ty)) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
        #[derive(serde::Serialize, serde::Deserialize)]
        #[serde(transparent)]
        #[repr(transparent)]
        $vis struct $name($inner);

        impl $name {
            /// Create a new value (always succeeds for unconstrained types).
            #[inline]
            pub const fn new(val: $inner) -> Self { Self(val) }

            /// Extract the inner value.
            #[inline]
            pub const fn value(self) -> $inner { self.0 }
        }

        impl ::core::fmt::Debug for $name {
            fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
                write!(f, "{}({})", stringify!($name), self.0)
            }
        }

        impl ::core::fmt::Display for $name {
            fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
                ::core::fmt::Display::fmt(&self.0, f)
            }
        }

        impl From<$inner> for $name {
            #[inline]
            fn from(val: $inner) -> Self { Self(val) }
        }

        impl From<$name> for $inner {
            #[inline]
            fn from(val: $name) -> $inner { val.0 }
        }
    };

    // ── Constrained with range ───────────────────────────────────────────
    ($(#[$meta:meta])* $vis:vis $name:ident($inner:ty), range: $min:expr, $max:expr) => {
        $(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        #[derive(serde::Serialize, serde::Deserialize)]
        #[serde(transparent)]
        #[repr(transparent)]
        $vis struct $name($inner);

        impl $name {
            /// Minimum valid value per XSD constraint.
            pub const MIN: $inner = $min;
            /// Maximum valid value per XSD constraint.
            pub const MAX: $inner = $max;

            /// Create a new value, returning `None` if out of range.
            #[inline]
            pub const fn new(val: $inner) -> Option<Self> {
                if val >= Self::MIN && val <= Self::MAX {
                    Some(Self(val))
                } else {
                    None
                }
            }

            /// Create a new value, clamping to the valid range.
            /// Use this for lenient parsing of potentially-broken OOXML files.
            #[inline]
            pub const fn new_clamped(val: $inner) -> Self {
                if val < Self::MIN {
                    Self(Self::MIN)
                } else if val > Self::MAX {
                    Self(Self::MAX)
                } else {
                    Self(val)
                }
            }

            /// Create a new value without range checking.
            /// Use only for trusted/internal construction.
            #[inline]
            pub const fn new_unchecked(val: $inner) -> Self { Self(val) }

            /// Extract the inner value.
            #[inline]
            pub const fn value(self) -> $inner { self.0 }
        }

        impl ::core::fmt::Debug for $name {
            fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
                write!(f, "{}({})", stringify!($name), self.0)
            }
        }

        impl ::core::fmt::Display for $name {
            fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
                ::core::fmt::Display::fmt(&self.0, f)
            }
        }

        impl Default for $name {
            /// Defaults to 0 if in range, otherwise MIN.
            #[inline]
            fn default() -> Self {
                // 0 as $inner: works for all integer types
                #[allow(unused_comparisons)]
                if (0 as $inner) >= Self::MIN && (0 as $inner) <= Self::MAX {
                    Self(0 as $inner)
                } else {
                    Self(Self::MIN)
                }
            }
        }

        impl From<$name> for $inner {
            #[inline]
            fn from(val: $name) -> $inner { val.0 }
        }
    };
}

/// Defines a `String`-backed newtype for semantic distinction.
macro_rules! ooxml_newtype_str {
    ($(#[$meta:meta])* $vis:vis $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
        #[derive(serde::Serialize, serde::Deserialize)]
        #[serde(transparent)]
        $vis struct $name(String);

        impl $name {
            /// Create from any string-like value.
            #[inline]
            pub fn new(val: impl Into<String>) -> Self { Self(val.into()) }

            /// Borrow the inner string.
            #[inline]
            pub fn value(&self) -> &str { &self.0 }

            /// Consume and return the inner `String`.
            #[inline]
            pub fn into_inner(self) -> String { self.0 }
        }

        impl From<String> for $name {
            #[inline]
            fn from(val: String) -> Self { Self(val) }
        }

        impl From<&str> for $name {
            #[inline]
            fn from(val: &str) -> Self { Self(val.to_owned()) }
        }

        impl AsRef<str> for $name {
            #[inline]
            fn as_ref(&self) -> &str { &self.0 }
        }

        impl ::core::fmt::Display for $name {
            fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

// Make macros available to sibling modules within the drawings crate.

// =============================================================================
// EMU Constants
// =============================================================================

/// English Metric Units — the base measurement unit in DrawingML.
///
/// Kept as a type alias (not a newtype) because it is pervasive across the
/// entire codebase. Converting to a newtype is a separate, larger migration.
pub type Emu = i64;

/// EMUs per inch (914400).
pub const EMUS_PER_INCH: Emu = 914_400;

/// EMUs per centimeter (360000).
pub const EMUS_PER_CM: Emu = 360_000;

/// EMUs per point (12700).
pub const EMUS_PER_POINT: Emu = 12_700;

// =============================================================================
// EditAs (ST_EditAs)
// =============================================================================

/// Edit behavior when cells resize (ECMA-376 ST_EditAs).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum EditAs {
    /// Object moves and resizes with cells (default for twoCellAnchor).
    #[default]
    TwoCell,
    /// Object moves with cells but does not resize.
    OneCell,
    /// Object has absolute position.
    Absolute,
}

impl EditAs {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "twoCell" => Self::TwoCell,
            "oneCell" => Self::OneCell,
            "absolute" => Self::Absolute,
            _ => Self::TwoCell,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::TwoCell => "twoCell",
            Self::OneCell => "oneCell",
            Self::Absolute => "absolute",
        }
    }
}

// =============================================================================
// Coordinate Types
// =============================================================================

ooxml_newtype_int!(
    /// EMU coordinate (ECMA-376 ST_Coordinate).
    /// Union of ST_CoordinateUnqualified and ST_UniversalMeasure.
    pub StCoordinate(i64)
);

ooxml_newtype_int!(
    /// EMU coordinate as xsd:long (ECMA-376 ST_CoordinateUnqualified).
    /// Range: ±27273042316900.
    pub StCoordinateUnqualified(i64),
    range: -27273042316900, 27273042316900
);

ooxml_newtype_int!(
    /// 32-bit EMU coordinate (ECMA-376 ST_Coordinate32).
    /// Union of ST_Coordinate32Unqualified and ST_UniversalMeasure.
    pub StCoordinate32(i32)
);

ooxml_newtype_int!(
    /// 32-bit EMU coordinate as xsd:int (ECMA-376 ST_Coordinate32Unqualified).
    pub StCoordinate32Unqualified(i32)
);

ooxml_newtype_int!(
    /// Non-negative EMU coordinate (ECMA-376 ST_PositiveCoordinate).
    /// Range: 0..=27273042316900.
    pub StPositiveCoordinate(i64),
    range: 0, 27273042316900
);

ooxml_newtype_int!(
    /// Non-negative 32-bit EMU coordinate (ECMA-376 ST_PositiveCoordinate32).
    /// Range: 0..=i32::MAX.
    pub StPositiveCoordinate32(i32),
    range: 0, 2147483647 // i32::MAX
);

ooxml_newtype_int!(
    /// Line width in EMUs (ECMA-376 ST_LineWidth).
    /// Range: 0..=20116800.
    pub StLineWidth(i32),
    range: 0, 20116800
);

// =============================================================================
// Angle Types
// =============================================================================

ooxml_newtype_int!(
    /// Angle in 60000ths of a degree (ECMA-376 ST_Angle).
    /// Full xsd:int range — no constraint.
    pub StAngle(i32)
);

ooxml_newtype_int!(
    /// Angle restricted to ±90° (ECMA-376 ST_FixedAngle).
    /// Range: -5400000..=5400000 (in 60000ths of a degree).
    pub StFixedAngle(i32),
    range: -5400000, 5400000
);

ooxml_newtype_int!(
    /// Positive angle 0..360° (ECMA-376 ST_PositiveFixedAngle).
    /// Range: 0..=21600000 (in 60000ths of a degree).
    pub StPositiveFixedAngle(i64),
    range: 0, 21600000
);

ooxml_newtype_int!(
    /// Field-of-view angle 0..180° (ECMA-376 ST_FOVAngle).
    /// Range: 0..=10800000 (in 60000ths of a degree).
    pub StFovAngle(i64),
    range: 0, 10800000
);

// =============================================================================
// Percentage Types
// =============================================================================

ooxml_newtype_int!(
    /// Percentage value ×1000 (ECMA-376 ST_Percentage).
    /// E.g., 100000 = 100%. No range constraint.
    pub StPercentage(i32)
);

ooxml_newtype_int!(
    /// Percentage as xsd:int ×1000 (ECMA-376 ST_PercentageDecimal).
    /// No range constraint.
    pub StPercentageDecimal(i32)
);

ooxml_newtype_int!(
    /// Percentage restricted to -100%..100% (ECMA-376 ST_FixedPercentage).
    /// Range: -100000..=100000.
    pub StFixedPercentage(i32),
    range: -100000, 100000
);

ooxml_newtype_int!(
    /// Decimal form of fixed percentage (ECMA-376 ST_FixedPercentageDecimal).
    /// Range: -100000..=100000.
    pub StFixedPercentageDecimal(i32),
    range: -100000, 100000
);

ooxml_newtype_int!(
    /// Non-negative percentage (ECMA-376 ST_PositivePercentage).
    /// Range: 0..=i32::MAX.
    pub StPositivePercentage(i32),
    range: 0, 2147483647 // i32::MAX
);

ooxml_newtype_int!(
    /// Decimal form of positive percentage (ECMA-376 ST_PositivePercentageDecimal).
    /// Range: 0..=i32::MAX.
    pub StPositivePercentageDecimal(i32),
    range: 0, 2147483647 // i32::MAX
);

ooxml_newtype_int!(
    /// Percentage restricted to 0..100% (ECMA-376 ST_PositiveFixedPercentage).
    /// Range: 0..=100000.
    pub StPositiveFixedPercentage(i32),
    range: 0, 100000
);

ooxml_newtype_int!(
    /// Decimal form of 0..100% percentage (ECMA-376 ST_PositiveFixedPercentageDecimal).
    /// Range: 0..=100000.
    pub StPositiveFixedPercentageDecimal(u32),
    range: 0, 100000
);

// =============================================================================
// Text Measurement Types
// =============================================================================

ooxml_newtype_int!(
    /// Text measurement in hundredths of a point (ECMA-376 ST_TextPoint).
    /// Union of ST_TextPointUnqualified and ST_UniversalMeasure.
    pub StTextPoint(i32)
);

ooxml_newtype_int!(
    /// Text point as xsd:int (ECMA-376 ST_TextPointUnqualified).
    /// Range: -400000..=400000.
    pub StTextPointUnqualified(i32),
    range: -400000, 400000
);

ooxml_newtype_int!(
    /// Non-negative text point (ECMA-376 ST_TextNonNegativePoint).
    /// Range: 0..=400000.
    pub StTextNonNegativePoint(u32),
    range: 0, 400000
);

ooxml_newtype_int!(
    /// Font size in hundredths of a point (ECMA-376 ST_TextFontSize).
    /// Range: 100..=400000. E.g., 1100 = 11pt.
    pub StTextFontSize(u32),
    range: 100, 400000
);

ooxml_newtype_int!(
    /// Text margin in EMUs (ECMA-376 ST_TextMargin).
    /// Range: 0..=51206400.
    pub StTextMargin(i64),
    range: 0, 51206400
);

ooxml_newtype_int!(
    /// Text indent in EMUs (ECMA-376 ST_TextIndent).
    /// Range: -51206400..=51206400.
    pub StTextIndent(i64),
    range: -51206400, 51206400
);

ooxml_newtype_int!(
    /// Paragraph indent level (ECMA-376 ST_TextIndentLevelType).
    /// Range: 0..=8.
    pub StTextIndentLevelType(u32),
    range: 0, 8
);

ooxml_newtype_int!(
    /// Number of text columns (ECMA-376 ST_TextColumnCount).
    /// Range: 1..=16.
    pub StTextColumnCount(u32),
    range: 1, 16
);

ooxml_newtype_int!(
    /// Font scale in thousandths of a percent (ECMA-376 ST_TextFontScalePercent).
    /// Range: 1000..=100000. E.g., 100000 = 100%.
    pub StTextFontScalePercent(u32),
    range: 1000, 100000
);

ooxml_newtype_int!(
    /// Font scale percent or percent string (ECMA-376 ST_TextFontScalePercentOrPercentString).
    /// Range: 1000..=100000 (after parsing).
    pub StTextFontScalePercentOrPercentString(u32),
    range: 1000, 100000
);

// =============================================================================
// Text Spacing Types
// =============================================================================

ooxml_newtype_int!(
    /// Line spacing percentage (ECMA-376 ST_TextSpacingPercent).
    /// Range: 0..=13200000. E.g., 100000 = single spacing.
    pub StTextSpacingPercent(u32),
    range: 0, 13200000
);

ooxml_newtype_int!(
    /// Spacing percent or percent string (ECMA-376 ST_TextSpacingPercentOrPercentString).
    /// Range: 0..=13200000.
    pub StTextSpacingPercentOrPercentString(u32),
    range: 0, 13200000
);

ooxml_newtype_int!(
    /// Spacing in hundredths of a point (ECMA-376 ST_TextSpacingPoint).
    /// Range: 0..=158400.
    pub StTextSpacingPoint(u32),
    range: 0, 158400
);

// =============================================================================
// Bullet Types
// =============================================================================

ooxml_newtype_int!(
    /// Bullet size union (ECMA-376 ST_TextBulletSize).
    /// Range: 25000..=400000.
    pub StTextBulletSize(u32),
    range: 25000, 400000
);

ooxml_newtype_int!(
    /// Bullet size as decimal (ECMA-376 ST_TextBulletSizeDecimal).
    /// Range: 25000..=400000.
    pub StTextBulletSizeDecimal(u32),
    range: 25000, 400000
);

ooxml_newtype_int!(
    /// Bullet size percent (ECMA-376 ST_TextBulletSizePercent).
    /// Range: 25000..=400000.
    pub StTextBulletSizePercent(u32),
    range: 25000, 400000
);

ooxml_newtype_int!(
    /// Bullet start number (ECMA-376 ST_TextBulletStartAtNum).
    /// Range: 1..=32767.
    pub StTextBulletStartAtNum(u32),
    range: 1, 32767
);

// =============================================================================
// Identifier Types
// =============================================================================

ooxml_newtype_int!(
    /// Drawing element identifier (ECMA-376 ST_DrawingElementId).
    /// xsd:unsignedInt — no range constraint.
    pub StDrawingElementId(u32)
);

ooxml_newtype_int!(
    /// Style matrix column index (ECMA-376 ST_StyleMatrixColumnIndex).
    /// xsd:unsignedInt — no range constraint.
    pub StStyleMatrixColumnIndex(u32)
);

ooxml_newtype_int!(
    /// Font pitch and family byte (ECMA-376 ST_PitchFamily).
    /// Bit-encoded: bits 0-3 = pitch, bits 4-7 = family.
    pub StPitchFamily(u8)
);

// =============================================================================
// String Newtypes
// =============================================================================

ooxml_newtype_str!(
    /// Font typeface name (ECMA-376 ST_TextTypeface).
    pub StTextTypeface
);

ooxml_newtype_str!(
    /// Geometry guide name (ECMA-376 ST_GeomGuideName).
    /// Token identifying a named guide (e.g., "adj", "adj1").
    pub StGeomGuideName
);

ooxml_newtype_str!(
    /// Geometry guide formula (ECMA-376 ST_GeomGuideFormula).
    /// Expression string (e.g., "val 12500", "*/adj 100 1").
    pub StGeomGuideFormula
);

ooxml_newtype_str!(
    /// Adjustable angle (ECMA-376 ST_AdjAngle).
    /// Union of ST_Angle (literal) and ST_GeomGuideName (guide reference).
    pub StAdjAngle
);

ooxml_newtype_str!(
    /// Adjustable coordinate (ECMA-376 ST_AdjCoordinate).
    /// Union of ST_Coordinate (literal) and ST_GeomGuideName (guide reference).
    pub StAdjCoordinate
);

ooxml_newtype_str!(
    /// Shape identifier (ECMA-376 ST_ShapeID).
    /// xsd:token in format "_{decimal}".
    pub StShapeId
);

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ── EMU constants ────────────────────────────────────────────────────

    #[test]
    fn emu_constants() {
        assert_eq!(EMUS_PER_INCH, 914_400);
        assert_eq!(EMUS_PER_CM, 360_000);
        assert_eq!(EMUS_PER_POINT, 12_700);
    }

    // ── Unconstrained newtypes ───────────────────────────────────────────

    #[test]
    fn unconstrained_new_and_value() {
        let a = StAngle::new(5400000);
        assert_eq!(a.value(), 5400000);

        let c = StCoordinate::new(-123456);
        assert_eq!(c.value(), -123456);

        let p = StPercentage::new(100000);
        assert_eq!(p.value(), 100000);
    }

    #[test]
    fn unconstrained_from_into() {
        let a: StAngle = 12345.into();
        assert_eq!(a.value(), 12345);

        let v: i32 = a.into();
        assert_eq!(v, 12345);
    }

    #[test]
    fn unconstrained_default_is_zero() {
        assert_eq!(StAngle::default().value(), 0);
        assert_eq!(StCoordinate::default().value(), 0);
        assert_eq!(StPercentage::default().value(), 0);
        assert_eq!(StDrawingElementId::default().value(), 0);
    }

    #[test]
    fn unconstrained_serde_roundtrip() {
        let a = StAngle::new(5400000);
        let json = serde_json::to_string(&a).unwrap();
        assert_eq!(json, "5400000");
        let b: StAngle = serde_json::from_str(&json).unwrap();
        assert_eq!(a, b);
    }

    // ── Constrained newtypes ─────────────────────────────────────────────

    #[test]
    fn constrained_new_in_range() {
        assert!(StFixedAngle::new(0).is_some());
        assert!(StFixedAngle::new(5400000).is_some());
        assert!(StFixedAngle::new(-5400000).is_some());
    }

    #[test]
    fn constrained_new_out_of_range() {
        assert!(StFixedAngle::new(5400001).is_none());
        assert!(StFixedAngle::new(-5400001).is_none());
        assert!(StPositiveCoordinate::new(-1).is_none());
        assert!(StTextFontSize::new(99).is_none());
        assert!(StTextFontSize::new(400001).is_none());
        assert!(StTextColumnCount::new(0).is_none());
        assert!(StTextColumnCount::new(17).is_none());
    }

    #[test]
    fn constrained_new_clamped() {
        assert_eq!(StFixedAngle::new_clamped(9999999).value(), 5400000);
        assert_eq!(StFixedAngle::new_clamped(-9999999).value(), -5400000);
        assert_eq!(StPositiveCoordinate::new_clamped(-100).value(), 0);
        assert_eq!(StTextFontSize::new_clamped(50).value(), 100);
        assert_eq!(StTextFontSize::new_clamped(999999).value(), 400000);
        assert_eq!(StTextColumnCount::new_clamped(0).value(), 1);
    }

    #[test]
    fn constrained_new_unchecked() {
        // Bypasses validation — value can be out of range
        let a = StFixedAngle::new_unchecked(9999999);
        assert_eq!(a.value(), 9999999);
    }

    #[test]
    fn constrained_default_zero_when_in_range() {
        // Types where 0 is in the valid range
        assert_eq!(StFixedAngle::default().value(), 0);
        assert_eq!(StPositiveCoordinate::default().value(), 0);
        assert_eq!(StFixedPercentage::default().value(), 0);
        assert_eq!(StPositiveFixedPercentage::default().value(), 0);
        assert_eq!(StTextSpacingPercent::default().value(), 0);
        assert_eq!(StTextIndent::default().value(), 0);
        assert_eq!(StLineWidth::default().value(), 0);
    }

    #[test]
    fn constrained_default_min_when_zero_out_of_range() {
        // Types where 0 is NOT in the valid range → default to MIN
        assert_eq!(StTextFontSize::default().value(), 100);
        assert_eq!(StTextColumnCount::default().value(), 1);
        assert_eq!(StTextFontScalePercent::default().value(), 1000);
        assert_eq!(StTextBulletStartAtNum::default().value(), 1);
        assert_eq!(StTextBulletSize::default().value(), 25000);
    }

    #[test]
    fn constrained_min_max_constants() {
        assert_eq!(StFixedAngle::MIN, -5400000);
        assert_eq!(StFixedAngle::MAX, 5400000);
        assert_eq!(StPositiveFixedAngle::MIN, 0);
        assert_eq!(StPositiveFixedAngle::MAX, 21600000);
        assert_eq!(StTextFontSize::MIN, 100);
        assert_eq!(StTextFontSize::MAX, 400000);
        assert_eq!(StLineWidth::MIN, 0);
        assert_eq!(StLineWidth::MAX, 20116800);
    }

    #[test]
    fn constrained_serde_roundtrip() {
        let a = StFixedAngle::new(2700000).unwrap();
        let json = serde_json::to_string(&a).unwrap();
        assert_eq!(json, "2700000");
        let b: StFixedAngle = serde_json::from_str(&json).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn constrained_into_inner() {
        let a = StPositiveCoordinate::new(12700).unwrap();
        let v: i64 = a.into();
        assert_eq!(v, 12700);
    }

    // ── String newtypes ──────────────────────────────────────────────────

    #[test]
    fn string_newtype_new_and_value() {
        let t = StTextTypeface::new("Calibri");
        assert_eq!(t.value(), "Calibri");
    }

    #[test]
    fn string_newtype_from() {
        let t: StTextTypeface = "Arial".into();
        assert_eq!(t.value(), "Arial");

        let t2: StTextTypeface = String::from("Times").into();
        assert_eq!(t2.value(), "Times");
    }

    #[test]
    fn string_newtype_into_inner() {
        let t = StGeomGuideName::new("adj1");
        let s: String = t.into_inner();
        assert_eq!(s, "adj1");
    }

    #[test]
    fn string_newtype_default_is_empty() {
        assert_eq!(StTextTypeface::default().value(), "");
        assert_eq!(StGeomGuideName::default().value(), "");
    }

    #[test]
    fn string_newtype_serde_roundtrip() {
        let t = StTextTypeface::new("Calibri");
        let json = serde_json::to_string(&t).unwrap();
        assert_eq!(json, "\"Calibri\"");
        let t2: StTextTypeface = serde_json::from_str(&json).unwrap();
        assert_eq!(t, t2);
    }

    #[test]
    fn string_newtype_as_ref() {
        let t = StGeomGuideFormula::new("val 12500");
        let s: &str = t.as_ref();
        assert_eq!(s, "val 12500");
    }

    // ── EditAs ───────────────────────────────────────────────────────────

    #[test]
    fn edit_as_roundtrip() {
        assert_eq!(EditAs::from_ooxml("twoCell"), EditAs::TwoCell);
        assert_eq!(EditAs::from_ooxml("oneCell"), EditAs::OneCell);
        assert_eq!(EditAs::from_ooxml("absolute"), EditAs::Absolute);
        assert_eq!(EditAs::from_ooxml("unknown"), EditAs::TwoCell);

        assert_eq!(EditAs::TwoCell.to_ooxml(), "twoCell");
        assert_eq!(EditAs::OneCell.to_ooxml(), "oneCell");
        assert_eq!(EditAs::Absolute.to_ooxml(), "absolute");
    }

    // ── Ordering ─────────────────────────────────────────────────────────

    #[test]
    fn newtype_ordering() {
        let a = StAngle::new(100);
        let b = StAngle::new(200);
        assert!(a < b);

        let x = StPositiveCoordinate::new(10).unwrap();
        let y = StPositiveCoordinate::new(20).unwrap();
        assert!(x < y);
    }
}
