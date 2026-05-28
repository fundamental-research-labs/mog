use super::primitives::PivotIndex;

// ============================================================================
// PivotDiscretePr — CT_DiscretePr
// ============================================================================

/// Discrete grouping mappings (CT_DiscretePr).
///
/// Maps source items to group items via index values.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotDiscretePr {
    /// Number of index entries (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// Index values mapping source items to group items.
    pub items: Vec<u32>,
    /// Index elements (`<x>`). XSD: CT_Index, 1..unbounded. // XSD: required
    #[serde(rename = "x")]
    pub x: Vec<PivotIndex>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pivot_discrete_pr_default() {
        let dp = PivotDiscretePr::default();
        assert!(dp.count.is_none());
        assert!(dp.items.is_empty());
        assert!(dp.x.is_empty());
    }
}
