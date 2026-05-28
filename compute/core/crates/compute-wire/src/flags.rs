//! Flag bit constants for [`super::types::ViewportRenderCell::flags`].
//!
//! These constants define the bitfield layout used in both the viewport
//! binary transfer and the mutation binary transfer protocols.
//!
//! # Cell flags layout (u16)
//!
//! ```text
//! Bit  0-2: ValueType enum (0=Null, 1=Number, 2=Text, 3=Bool, 4=Error)
//! Bit    3: HAS_FORMULA
//! Bit    4: HAS_COMMENT
//! Bit    5: HAS_SPARKLINE
//! Bit    6: HAS_HYPERLINK
//! Bit    7: IS_CHECKBOX
//! Bit    8: IS_SPILL_MEMBER
//! Bit    9: HAS_VALIDATION_ERROR
//! Bit   10: HAS_CF_EXTRAS
//! Bit 11-15: reserved
//! ```
//!
//! # Mutation header flags layout (u8)
//!
//! ```text
//! Bit 0: MUT_HAS_PROJECTION_CHANGES
//! Bit 1: MUT_HAS_ERRORS
//! Bit 2: MUT_HAS_PALETTE
//! Bit 3-7: reserved
//! ```

use value_types::CellValue;

/// Error returned when converting a raw `u16` into a [`ValueType`] fails
/// because the discriminant is not 0-5.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidValueType(
    /// The invalid discriminant (already masked to bits 0-2).
    pub u16,
);

impl std::fmt::Display for InvalidValueType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "invalid value type discriminant: {}", self.0)
    }
}

impl std::error::Error for InvalidValueType {}

// ---------------------------------------------------------------------------
// Value type enum (bits 0-2 of cell flags)
// ---------------------------------------------------------------------------

/// Bits 0-2: value type mask.
pub const VALUE_TYPE_MASK: u16 = 0x7;
/// Value type 0: null / empty cell.
pub const VALUE_TYPE_NULL: u16 = 0;
/// Value type 1: numeric value.
pub const VALUE_TYPE_NUMBER: u16 = 1;
/// Value type 2: text / string value.
pub const VALUE_TYPE_TEXT: u16 = 2;
/// Value type 3: boolean value.
pub const VALUE_TYPE_BOOL: u16 = 3;
/// Value type 4: error value.
pub const VALUE_TYPE_ERROR: u16 = 4;
/// Value type 5: in-cell image value.
pub const VALUE_TYPE_IMAGE: u16 = 5;

/// Cell value type encoded in bits 0-2 of the flags `u16`.
///
/// Provides type-safe conversion between [`CellValue`] variants and their
/// wire representation, preventing invalid discriminants from being written.
///
/// # Examples
///
/// ```
/// use compute_wire::flags::ValueType;
/// use value_types::CellValue;
///
/// let vt = ValueType::from_cell_value(&CellValue::number(42.0));
/// assert_eq!(vt as u16, 1); // NUMBER
///
/// let round_tripped = ValueType::try_from(1u16).unwrap();
/// assert_eq!(round_tripped, ValueType::Number);
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum ValueType {
    /// Null / empty cell (discriminant 0).
    Null = VALUE_TYPE_NULL,
    /// Numeric value (discriminant 1). Also used for arrays.
    Number = VALUE_TYPE_NUMBER,
    /// Text / string value (discriminant 2).
    Text = VALUE_TYPE_TEXT,
    /// Boolean value (discriminant 3).
    Bool = VALUE_TYPE_BOOL,
    /// Error value (discriminant 4).
    Error = VALUE_TYPE_ERROR,
    /// In-cell image value (discriminant 5).
    Image = VALUE_TYPE_IMAGE,
}

impl ValueType {
    /// Derive the wire value type from a [`CellValue`].
    #[inline]
    #[must_use]
    pub fn from_cell_value(value: &CellValue) -> Self {
        match value {
            CellValue::Null => Self::Null,
            CellValue::Number(_) | CellValue::Array(_) => Self::Number,
            CellValue::Text(_) => Self::Text,
            CellValue::Boolean(_) | CellValue::Control(_) => Self::Bool,
            CellValue::Error(..) => Self::Error,
            CellValue::Image(_) => Self::Image,
        }
    }
}

impl From<ValueType> for u16 {
    #[inline]
    fn from(vt: ValueType) -> Self {
        vt as Self
    }
}

impl TryFrom<u16> for ValueType {
    type Error = InvalidValueType;

    /// Convert a raw `u16` (masked to bits 0-2) into a [`ValueType`].
    ///
    /// Returns `Err(InvalidValueType)` if the discriminant is not 0-5.
    #[inline]
    fn try_from(raw: u16) -> Result<Self, InvalidValueType> {
        match raw & VALUE_TYPE_MASK {
            VALUE_TYPE_NULL => Ok(Self::Null),
            VALUE_TYPE_NUMBER => Ok(Self::Number),
            VALUE_TYPE_TEXT => Ok(Self::Text),
            VALUE_TYPE_BOOL => Ok(Self::Bool),
            VALUE_TYPE_ERROR => Ok(Self::Error),
            VALUE_TYPE_IMAGE => Ok(Self::Image),
            other => Err(InvalidValueType(other)),
        }
    }
}

// ---------------------------------------------------------------------------
// Cell property flags (bits 3-10)
// ---------------------------------------------------------------------------

/// Bit 3: cell owns formula text.
pub const HAS_FORMULA: u16 = 0x8;
/// Bit 4: cell has a comment/note.
pub const HAS_COMMENT: u16 = 0x10;
/// Bit 5: cell has a sparkline.
pub const HAS_SPARKLINE: u16 = 0x20;
/// Bit 6: cell has a hyperlink.
pub const HAS_HYPERLINK: u16 = 0x40;
/// Bit 7: cell is rendered as a checkbox.
pub const IS_CHECKBOX: u16 = 0x80;
/// Bit 8: cell is a spill / array-region member projected from an anchor.
pub const IS_SPILL_MEMBER: u16 = 0x100;
/// Bit 9: cell has a data validation error.
pub const HAS_VALIDATION_ERROR: u16 = 0x200;
/// Bit 10: cell has CF extras (data bar and/or icon) in the trailing sections.
pub const HAS_CF_EXTRAS: u16 = 0x400;
/// Bit 11: cell has structured in-cell image metadata.
pub const HAS_CELL_IMAGE: u16 = 0x800;

// ---------------------------------------------------------------------------
// Mutation header flags (u8 bitfield at header offset 10)
// ---------------------------------------------------------------------------

/// Bit 0: mutation contains projection (spill) changes.
pub const MUT_HAS_PROJECTION_CHANGES: u8 = 0x01;
/// Bit 1: mutation contains cell errors.
pub const MUT_HAS_ERRORS: u8 = 0x02;
/// Bit 2: mutation contains a format palette delta.
pub const MUT_HAS_PALETTE: u8 = 0x04;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_type_roundtrip() {
        for raw in 0u16..=5 {
            let vt = ValueType::try_from(raw).unwrap();
            assert_eq!(u16::from(vt), raw);
        }
    }

    #[test]
    fn value_type_invalid_discriminant() {
        assert_eq!(ValueType::try_from(7u16), Err(InvalidValueType(7)));
    }

    #[test]
    fn value_type_from_cell_value() {
        assert_eq!(
            ValueType::from_cell_value(&CellValue::Null),
            ValueType::Null
        );
        assert_eq!(
            ValueType::from_cell_value(&CellValue::number(1.0)),
            ValueType::Number
        );
        assert_eq!(
            ValueType::from_cell_value(&CellValue::Text("hi".into())),
            ValueType::Text
        );
        assert_eq!(
            ValueType::from_cell_value(&CellValue::Boolean(true)),
            ValueType::Bool
        );
        assert_eq!(
            ValueType::from_cell_value(&CellValue::Error(value_types::CellError::Value, None)),
            ValueType::Error
        );
    }

    #[test]
    fn cell_flag_bits_are_disjoint() {
        let all_flags = [
            HAS_FORMULA,
            HAS_COMMENT,
            HAS_SPARKLINE,
            HAS_HYPERLINK,
            IS_CHECKBOX,
            IS_SPILL_MEMBER,
            HAS_VALIDATION_ERROR,
            HAS_CF_EXTRAS,
        ];
        // No two flags share a bit
        for (i, &a) in all_flags.iter().enumerate() {
            for &b in &all_flags[i + 1..] {
                assert_eq!(a & b, 0, "flags 0x{a:x} and 0x{b:x} overlap");
            }
            // None overlap with value type mask
            assert_eq!(
                a & VALUE_TYPE_MASK,
                0,
                "flag 0x{a:x} overlaps value type mask"
            );
        }
    }
}
