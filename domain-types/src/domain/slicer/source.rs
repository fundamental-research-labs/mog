use serde::{Deserialize, Serialize};

/// Area of a pivot field that a slicer can bind to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PivotFieldArea {
    Row,
    Column,
    Filter,
}

/// Data source binding for a slicer. Tagged union — different source types
/// have different fields, and the enum enforces valid combinations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SlicerSource {
    #[serde(rename = "table", rename_all = "camelCase")]
    Table {
        table_id: String,
        /// CellId of the column header — Cell Identity Model, survives column moves.
        column_cell_id: String,
    },
    #[serde(rename = "pivot", rename_all = "camelCase")]
    Pivot {
        pivot_id: String,
        field_name: String,
        field_area: PivotFieldArea,
    },
}
