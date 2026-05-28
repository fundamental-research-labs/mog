// ============================================================================
// PivotX — CT_X
// ============================================================================

/// Simple pivot index element (CT_X).
///
/// Represents a single `<x>` element used throughout pivot table structures
/// to reference items by index.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct PivotX {
    /// The index value. Default: `0`. XSD: optional with default 0.
    pub v: Option<i32>,
}

// ============================================================================
// PivotIndex — CT_Index
// ============================================================================

/// Simple index element (CT_Index).
///
/// Represents a single `<x>` element with a required unsigned integer index value,
/// used in CT_DiscretePr and similar structures.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct PivotIndex {
    /// The index value (required).
    pub v: u32,
}

// ============================================================================
// Tuple — CT_Tuple
// ============================================================================

/// OLAP tuple element (CT_Tuple, §18.10.1.86).
///
/// Represents a single tuple reference used in OLAP pivot table structures.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Tuple {
    /// Field index.
    pub fld: Option<u32>,
    /// Hierarchy index.
    pub hier: Option<u32>,
    /// Item index (required).
    pub item: u32,
}

// ============================================================================
// Tuples — CT_Tuples
// ============================================================================

/// Collection of OLAP tuples (CT_Tuples, §18.10.1.87).
///
/// Container for a set of tuple references used in OLAP pivot structures.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Tuples {
    /// The tuple elements.
    pub tpl: Vec<Tuple>,
    /// Member name count.
    pub c: Option<u32>,
}

// ============================================================================
// TupleCache — CT_TupleCache
// ============================================================================

/// OLAP tuple cache (CT_TupleCache, §18.10.1.85).
///
/// Contains OLAP-specific cache entries. Stored as raw XML for now due to the
/// complexity of the OLAP hierarchy structure.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TupleCache {
    /// Entries stored as an extension list (raw XML for complex OLAP structure).
    pub entries: Option<crate::ExtensionList>,
    /// OLAP set definitions (`<sets>`, CT_Sets). Placeholder as raw string.
    pub sets: Option<String>,
    /// OLAP query cache (`<queryCache>`, CT_QueryCache). Placeholder as raw string.
    pub query_cache: Option<String>,
    /// Server format definitions (`<serverFormats>`, CT_ServerFormats). Placeholder as raw string.
    pub server_formats: Option<String>,
}

// ============================================================================
// XStringElement — CT_XStringElement
// ============================================================================

/// Simple string element wrapper (ECMA-376 CT_XStringElement).
///
/// A minimal type wrapping a single string value. Used in various OOXML
/// contexts where a sequence of string elements is needed (e.g. pivot cache
/// field groups, shared string references).
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct XStringElement {
    /// The string value (required `v` attribute).
    pub v: String,
}

impl XStringElement {
    /// Create a new `XStringElement` with the given value.
    pub fn new(v: impl Into<String>) -> Self {
        Self { v: v.into() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pivot_x_default() {
        let x = PivotX::default();
        assert_eq!(x.v, None);
    }

    #[test]
    fn tuple_default() {
        let t = Tuple::default();
        assert!(t.fld.is_none());
        assert!(t.hier.is_none());
        assert_eq!(t.item, 0);
    }

    #[test]
    fn tuples_default() {
        let ts = Tuples::default();
        assert!(ts.tpl.is_empty());
        assert!(ts.c.is_none());
    }

    #[test]
    fn tuple_cache_default() {
        let tc = TupleCache::default();
        assert!(tc.entries.is_none());
    }

    #[test]
    fn x_string_element_new() {
        let el = XStringElement::new("hello");
        assert_eq!(el.v, "hello");
    }

    #[test]
    fn x_string_element_default() {
        let el = XStringElement::default();
        assert_eq!(el.v, "");
    }
}
