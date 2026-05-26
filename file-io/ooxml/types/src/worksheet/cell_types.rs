//! Cell-level simple type enums (ST_CellType, ST_CellFormulaType).

// ============================================================================
// CellType -- ST_CellType (sml.xsd §18.18.11)
// ============================================================================

/// Cell value type (ST_CellType).
///
/// Specifies the data type of the cell value.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum CellType {
    /// Boolean value
    #[xml("b")]
    Boolean,
    /// Date value
    #[xml("d")]
    Date,
    /// Error value
    #[xml("e")]
    Error,
    /// Inline string value
    #[xml("inlineStr")]
    InlineStr,
    /// Numeric value (default)
    #[default]
    #[xml("n")]
    Number,
    /// Shared string value
    #[xml("s")]
    SharedString,
    /// Formula string value
    #[xml("str")]
    Str,
}

// ============================================================================
// CellFormulaType -- ST_CellFormulaType (sml.xsd §18.18.6)
// ============================================================================

/// Cell formula type (ST_CellFormulaType).
///
/// Specifies the type of formula in a cell.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum CellFormulaType {
    /// Normal formula (default)
    #[default]
    #[xml("normal")]
    Normal,
    /// Array formula
    #[xml("array")]
    Array,
    /// Data table formula
    #[xml("dataTable")]
    DataTable,
    /// Shared formula
    #[xml("shared")]
    Shared,
}

// ============================================================================
// Cell -- CT_Cell
// ============================================================================

/// A single cell in a worksheet row (CT_Cell).
///
/// Contains the cell's reference, type, style, value, formula, and metadata indices.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Cell {
    /// Cell reference in A1 notation (e.g. "A1", "B12"). Required.
    pub r: Option<String>,
    /// Zero-based style index into cellXfs. Default: 0.
    pub s: u32,
    /// Cell data type. Default: Number ("n").
    pub t: CellType,
    /// Cell metadata index (XLDM). Default: 0.
    pub cm: u32,
    /// Value metadata index. Default: 0.
    pub vm: u32,
    /// Whether the cell contains a phonetic guide. Default: false.
    pub ph: bool,
    /// Cell formula (CT_CellFormula), if present.
    pub f: Option<CellFormula>,
    /// Cell value as string, if present.
    pub v: Option<String>,
    /// Inline string (CT_Rst), if present.
    pub is: Option<crate::shared_strings::Rst>,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            r: None,
            s: 0,
            t: CellType::Number,
            cm: 0,
            vm: 0,
            ph: false,
            f: None,
            v: None,
            is: None,
        }
    }
}

// ============================================================================
// CellFormula -- CT_CellFormula
// ============================================================================

/// Cell formula (CT_CellFormula).
///
/// Represents a formula attached to a cell, including shared/array formula
/// metadata and data table properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CellFormula {
    /// Formula text.
    pub text: String,
    /// Formula type. Default: Normal.
    pub t: CellFormulaType,
    /// Shared formula index.
    pub si: Option<u32>,
    /// Range of cells using this shared/array formula (A1-style).
    pub r#ref: Option<String>,
    /// Whether to always calculate. Default: false.
    pub aca: bool,
    /// Whether the formula is a data table 2D formula.
    pub dt2d: bool,
    /// Whether to delete row 1 of the data table.
    pub del1: bool,
    /// Whether to delete row 2 of the data table.
    pub del2: bool,
    /// Data table row cell reference.
    pub r1: Option<String>,
    /// Data table column cell reference.
    pub r2: Option<String>,
    /// Whether to calculate the cell. Default: false.
    pub ca: bool,
    /// Whether a data table input is 1D. Default: false.
    pub bx: bool,
    /// Whether the data table uses row/column references. Default: false.
    pub dtr: bool,
}

impl Default for CellFormula {
    fn default() -> Self {
        Self {
            text: String::new(),
            t: CellFormulaType::Normal,
            si: None,
            r#ref: None,
            aca: false,
            dt2d: false,
            del1: false,
            del2: false,
            r1: None,
            r2: None,
            ca: false,
            bx: false,
            dtr: false,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- CellType ---

    #[test]
    fn cell_type_roundtrip() {
        let variants = [
            CellType::Boolean,
            CellType::Date,
            CellType::Error,
            CellType::InlineStr,
            CellType::Number,
            CellType::SharedString,
            CellType::Str,
        ];
        for v in &variants {
            assert_eq!(CellType::from_ooxml(v.to_ooxml()), *v);
        }
    }

    #[test]
    fn cell_type_from_bytes() {
        let variants = [
            CellType::Boolean,
            CellType::Date,
            CellType::Error,
            CellType::InlineStr,
            CellType::Number,
            CellType::SharedString,
            CellType::Str,
        ];
        for v in &variants {
            assert_eq!(CellType::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    #[test]
    fn cell_type_default_is_number() {
        assert_eq!(CellType::default(), CellType::Number);
    }

    #[test]
    fn cell_type_unknown_defaults() {
        assert_eq!(CellType::from_ooxml("bogus"), CellType::Number);
        assert_eq!(CellType::from_bytes(b"bogus"), CellType::Number);
    }

    // --- CellFormulaType ---

    #[test]
    fn cell_formula_type_roundtrip() {
        let variants = [
            CellFormulaType::Normal,
            CellFormulaType::Array,
            CellFormulaType::DataTable,
            CellFormulaType::Shared,
        ];
        for v in &variants {
            assert_eq!(CellFormulaType::from_ooxml(v.to_ooxml()), *v);
        }
    }

    #[test]
    fn cell_formula_type_from_bytes() {
        let variants = [
            CellFormulaType::Normal,
            CellFormulaType::Array,
            CellFormulaType::DataTable,
            CellFormulaType::Shared,
        ];
        for v in &variants {
            assert_eq!(CellFormulaType::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    #[test]
    fn cell_formula_type_default_is_normal() {
        assert_eq!(CellFormulaType::default(), CellFormulaType::Normal);
    }

    #[test]
    fn cell_formula_type_unknown_defaults() {
        assert_eq!(
            CellFormulaType::from_ooxml("bogus"),
            CellFormulaType::Normal
        );
        assert_eq!(
            CellFormulaType::from_bytes(b"bogus"),
            CellFormulaType::Normal
        );
    }

    // --- Cell ---

    #[test]
    fn cell_defaults() {
        let c = Cell::default();
        assert!(c.r.is_none());
        assert_eq!(c.s, 0);
        assert_eq!(c.t, CellType::Number);
        assert_eq!(c.cm, 0);
        assert_eq!(c.vm, 0);
        assert!(!c.ph);
        assert!(c.f.is_none());
        assert!(c.v.is_none());
        assert!(c.is.is_none());
    }

    #[test]
    fn cell_with_value() {
        let c = Cell {
            r: Some("A1".to_string()),
            v: Some("42".to_string()),
            ..Cell::default()
        };
        assert_eq!(c.r.as_deref(), Some("A1"));
        assert_eq!(c.v.as_deref(), Some("42"));
    }

    // --- CellFormula ---

    #[test]
    fn cell_formula_defaults() {
        let f = CellFormula::default();
        assert!(f.text.is_empty());
        assert_eq!(f.t, CellFormulaType::Normal);
        assert!(f.si.is_none());
        assert!(f.r#ref.is_none());
        assert!(!f.aca);
        assert!(!f.dt2d);
        assert!(!f.del1);
        assert!(!f.del2);
        assert!(f.r1.is_none());
        assert!(f.r2.is_none());
        assert!(!f.ca);
        assert!(!f.bx);
        assert!(!f.dtr);
    }

    #[test]
    fn cell_formula_shared() {
        let f = CellFormula {
            text: "A1+B1".to_string(),
            t: CellFormulaType::Shared,
            si: Some(0),
            r#ref: Some("C1:C10".to_string()),
            ..CellFormula::default()
        };
        assert_eq!(f.text, "A1+B1");
        assert_eq!(f.t, CellFormulaType::Shared);
        assert_eq!(f.si, Some(0));
        assert_eq!(f.r#ref.as_deref(), Some("C1:C10"));
    }
}
