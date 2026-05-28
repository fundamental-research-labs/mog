use super::primitives::PivotX;

// ============================================================================
// PivotI — CT_I
// ============================================================================

/// A single row or column item entry (CT_I).
///
/// Represents one `<i>` element within row items or column items.
/// Contains a list of `<x>` references and attributes for item type, repeat count, and index.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotI {
    /// Item type (ST_ItemType). Default: `"data"`.
    pub t: Option<String>,
    /// Repeat count of the previous item. Default: `0`.
    pub r: Option<u32>,
    /// Zero-based index. Default: `0`.
    pub i: Option<u32>,
    /// Pivot index references (`<x>` children).
    pub x: Vec<PivotX>,
}

// ============================================================================
// PivotRowItems — CT_rowItems
// ============================================================================

/// Row items collection for a pivot table (CT_rowItems).
///
/// Contains the row item entries, where each row item (`<i>`) holds a list of
/// pivot index references (`<x>` elements).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotRowItems {
    /// Rows of pivot indices. Each inner `Vec<PivotX>` represents one `<i>` element
    /// containing multiple `<x>` children.
    pub items: Vec<Vec<PivotX>>,
    /// Count of row items.
    pub count: Option<u32>,
    /// Row item elements (`<i>`). XSD: CT_I, 1..unbounded. // XSD: required
    #[serde(rename = "i")]
    pub i: Vec<PivotI>,
}

// ============================================================================
// PivotColItems — CT_colItems
// ============================================================================

/// Column items collection for a pivot table (CT_colItems).
///
/// Contains the column item entries, structured identically to row items.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotColItems {
    /// Columns of pivot indices. Each inner `Vec<PivotX>` represents one `<i>` element
    /// containing multiple `<x>` children.
    pub items: Vec<Vec<PivotX>>,
    /// Count of column items.
    pub count: Option<u32>,
    /// Column item elements (`<i>`). XSD: CT_I, 1..unbounded. // XSD: required
    #[serde(rename = "i")]
    pub i: Vec<PivotI>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pivot_row_items_default() {
        let ri = PivotRowItems::default();
        assert!(ri.items.is_empty());
        assert!(ri.count.is_none());
        assert!(ri.i.is_empty());
    }

    #[test]
    fn pivot_col_items_default() {
        let ci = PivotColItems::default();
        assert!(ci.items.is_empty());
        assert!(ci.count.is_none());
        assert!(ci.i.is_empty());
    }
}
