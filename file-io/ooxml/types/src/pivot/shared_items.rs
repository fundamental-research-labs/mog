use super::primitives::{PivotX, Tuples};

// ============================================================================
// SharedItem — unified enum for pivot cache value types
// ============================================================================

/// A single shared item value (union of m/n/b/e/s/d elements).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SharedItem {
    /// Missing value (`<m>`).
    Missing,
    /// Numeric value (`<n>`).
    Number(f64),
    /// Boolean value (`<b>`).
    Boolean(bool),
    /// Error value (`<e>`).
    Error(String),
    /// String value (`<s>`).
    String(String),
    /// Date-time value (`<d>`, ISO 8601 string).
    DateTime(String),
}

// ============================================================================
// PivotBoolean — CT_Boolean
// ============================================================================

/// Boolean shared item in a pivot cache (CT_Boolean).
///
/// Represents a boolean value with optional member properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotBoolean {
    /// The boolean value.
    pub v: bool,
    /// Whether this item is unused. Default: `false`.
    pub u: bool,
    /// Whether this item has a calculated value. Default: `false`.
    pub f: bool,
    /// Caption for display.
    pub c: Option<String>,
    /// Count of member property values.
    pub cp: Option<u32>,
    /// Member property value indices (x elements / tpls).
    pub x: Vec<u32>,
}

// ============================================================================
// PivotDateTime — CT_DateTime
// ============================================================================

/// Date-time shared item in a pivot cache (CT_DateTime).
///
/// Represents a date-time value with optional member properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotDateTime {
    /// The date-time value (ISO 8601 string).
    pub v: String,
    /// Whether this item is unused. Default: `false`.
    pub u: bool,
    /// Whether this item has a calculated value. Default: `false`.
    pub f: bool,
    /// Caption for display.
    pub c: Option<String>,
    /// Count of member property values.
    pub cp: Option<u32>,
    /// Member property value indices (`<x>` elements).
    pub x: Vec<PivotX>,
}

// ============================================================================
// PivotError — CT_Error
// ============================================================================

/// Error shared item in a pivot cache (CT_Error).
///
/// Represents an error value with optional formatting and member properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotError {
    /// The error value string (e.g. "#REF!", "#N/A").
    pub v: String,
    /// Whether this item is unused. Default: `false`.
    pub u: bool,
    /// Whether this item has a calculated value. Default: `false`.
    pub f: bool,
    /// Caption for display.
    pub c: Option<String>,
    /// Count of member property values.
    pub cp: Option<u32>,
    /// Background colour index.
    pub bc: Option<u32>,
    /// Foreground colour index.
    pub fc: Option<u32>,
    /// Whether italic. Default: `false`.
    pub i: bool,
    /// Whether underline. Default: `false`.
    pub un: bool,
    /// Whether strikethrough. Default: `false`.
    pub st: bool,
    /// Whether bold. Default: `false`.
    pub b: bool,
    /// Member property field index.
    pub r#in: Option<u32>,
    /// Tuple member property indices (tpls).
    pub tpls: Vec<u32>,
    /// Member property value indices (x elements).
    pub x: Vec<u32>,
}

// ============================================================================
// PivotMissing — CT_Missing
// ============================================================================

/// Missing value shared item in a pivot cache (CT_Missing).
///
/// Represents a missing/blank value with optional formatting and member properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotMissing {
    /// Whether this item is unused. Default: `false`.
    pub u: bool,
    /// Whether this item has a calculated value. Default: `false`.
    pub f: bool,
    /// Caption for display.
    pub c: Option<String>,
    /// Count of member property values.
    pub cp: Option<u32>,
    /// Background colour index.
    pub bc: Option<u32>,
    /// Foreground colour index.
    pub fc: Option<u32>,
    /// Whether italic. Default: `false`.
    pub i: bool,
    /// Whether underline. Default: `false`.
    pub un: bool,
    /// Whether strikethrough. Default: `false`.
    pub st: bool,
    /// Whether bold. Default: `false`.
    pub b: bool,
    /// Member property field index.
    pub r#in: Option<u32>,
    /// Tuple member property indices (tpls).
    pub tpls: Vec<Tuples>,
    /// Member property value indices (x elements).
    pub x: Vec<PivotX>,
}

// ============================================================================
// PivotNumber — CT_Number
// ============================================================================

/// Numeric shared item in a pivot cache (CT_Number).
///
/// Represents a numeric value with optional formatting and member properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotNumber {
    /// The numeric value.
    pub v: f64,
    /// Whether this item is unused. Default: `false`.
    pub u: bool,
    /// Whether this item has a calculated value. Default: `false`.
    pub f: bool,
    /// Caption for display.
    pub c: Option<String>,
    /// Count of member property values.
    pub cp: Option<u32>,
    /// Background colour index.
    pub bc: Option<u32>,
    /// Foreground colour index.
    pub fc: Option<u32>,
    /// Whether italic. Default: `false`.
    pub i: bool,
    /// Whether underline. Default: `false`.
    pub un: bool,
    /// Whether strikethrough. Default: `false`.
    pub st: bool,
    /// Whether bold. Default: `false`.
    pub b: bool,
    /// Member property field index.
    pub r#in: Option<u32>,
    /// Tuple member property indices (tpls).
    pub tpls: Vec<Tuples>,
    /// Member property value indices (x elements).
    pub x: Vec<PivotX>,
}

impl Default for PivotNumber {
    fn default() -> Self {
        Self {
            v: 0.0,
            u: false,
            f: false,
            c: None,
            cp: None,
            bc: None,
            fc: None,
            i: false,
            un: false,
            st: false,
            b: false,
            r#in: None,
            tpls: Vec::new(),
            x: Vec::new(),
        }
    }
}

// ============================================================================
// PivotCacheString — CT_String
// ============================================================================

/// Pivot cache string value (ECMA-376 CT_String, §18.10.1.83).
///
/// Represents a string item in the pivot cache shared items or group items.
/// Contains optional formatting attributes that indicate how the value appeared
/// in the source data.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotCacheString {
    /// The string value (required).
    pub v: String,
    /// Whether this item is unused in the pivot table.
    pub u: Option<bool>,
    /// Whether this is a calculated item value.
    pub f: Option<bool>,
    /// Display caption (overrides `v` in the UI).
    pub c: Option<String>,
    /// Number of property values associated with this item.
    pub cp: Option<u32>,
    /// Member property field index.
    pub r#in: Option<u32>,
    /// Background color (hex ARGB string).
    pub bc: Option<String>,
    /// Foreground (font) color (hex ARGB string).
    pub fc: Option<String>,
    /// Whether the value was italic in the source.
    pub i: Option<bool>,
    /// Whether the value was underlined in the source.
    pub un: Option<bool>,
    /// Whether the value was struck through in the source.
    pub st: Option<bool>,
    /// Whether the value was bold in the source.
    pub b: Option<bool>,
    /// Tuple index values (for OLAP).
    pub tpls: Vec<Tuples>,
    /// Member property indexes.
    pub x: Vec<PivotX>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pivot_boolean_default() {
        let b = PivotBoolean::default();
        assert!(!b.v);
        assert!(!b.u);
        assert!(!b.f);
        assert!(b.c.is_none());
        assert!(b.cp.is_none());
        assert!(b.x.is_empty());
    }

    #[test]
    fn pivot_date_time_default() {
        let dt = PivotDateTime::default();
        assert!(dt.v.is_empty());
        assert!(!dt.u);
        assert!(!dt.f);
        assert!(dt.c.is_none());
        assert!(dt.cp.is_none());
        assert!(dt.x.is_empty());
    }

    #[test]
    fn pivot_error_default() {
        let e = PivotError::default();
        assert!(e.v.is_empty());
        assert!(!e.u);
        assert!(!e.f);
        assert!(e.c.is_none());
        assert!(e.cp.is_none());
        assert!(e.bc.is_none());
        assert!(e.fc.is_none());
        assert!(!e.i);
        assert!(!e.un);
        assert!(!e.st);
        assert!(!e.b);
        assert!(e.tpls.is_empty());
        assert!(e.x.is_empty());
    }

    #[test]
    fn pivot_number_default() {
        let n = PivotNumber::default();
        assert_eq!(n.v, 0.0);
        assert!(!n.u);
        assert!(!n.f);
        assert!(n.c.is_none());
        assert!(n.cp.is_none());
        assert!(n.bc.is_none());
        assert!(n.fc.is_none());
        assert!(!n.i);
        assert!(!n.un);
        assert!(!n.st);
        assert!(!n.b);
        assert!(n.r#in.is_none());
        assert!(n.tpls.is_empty());
        assert!(n.x.is_empty());
    }

    #[test]
    fn pivot_cache_string_default() {
        let s = PivotCacheString::default();
        assert_eq!(s.v, "");
        assert_eq!(s.u, None);
        assert_eq!(s.f, None);
        assert_eq!(s.c, None);
        assert_eq!(s.b, None);
        assert!(s.tpls.is_empty());
        assert!(s.x.is_empty());
    }

    #[test]
    fn pivot_cache_string_serde_roundtrip() {
        let original = PivotCacheString {
            v: "East".to_string(),
            b: Some(true),
            c: Some("Eastern Region".to_string()),
            ..PivotCacheString::default()
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: PivotCacheString = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }
}
