//! Cell watch types (ECMA-376 Part 1, Section 18.3).
//!
//! Types modelling the cell watch window, which allows users to monitor
//! specific cells and their formula results in a floating pane.

// ============================================================================
// CellWatch — CT_CellWatch
// ============================================================================

/// A single cell watch entry (CT_CellWatch).
///
/// References a cell whose value is monitored in the watch window.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CellWatch {
    /// Cell reference in A1 notation (required).
    pub r: String,
}

// ============================================================================
// CellWatches — CT_CellWatches (wrapper)
// ============================================================================

/// Collection of cell watches (CT_CellWatches).
///
/// Wrapper around a list of [`CellWatch`] entries.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CellWatches {
    /// Cell watch entries.
    pub watches: Vec<CellWatch>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cell_watch_default() {
        let w = CellWatch::default();
        assert!(w.r.is_empty());
    }

    #[test]
    fn cell_watches_default() {
        let ws = CellWatches::default();
        assert!(ws.watches.is_empty());
    }
}
