use serde::{Deserialize, Serialize};

use crate::field_id::FieldId;
use crate::placement_flat::PivotFieldArea;
use value_types::CellValue;

/// A PivotItem represents a unique value within a pivot field.
///
/// Items are extracted from a computed pivot result (row/column headers) or from
/// source data (filter fields). Each item carries metadata about its position in
/// the field hierarchy, visibility state, and structural flags.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
pub struct PivotItemInfo {
    /// Compound key uniquely identifying this item (same encoding as `PivotHeader::key`).
    pub key: String,
    /// The display value for this item.
    pub value: CellValue,
    /// The field this item belongs to.
    pub field_id: FieldId,
    /// Which area the field is placed in.
    pub area: PivotFieldArea,
    /// Nesting depth (0 = outermost grouping level).
    pub depth: usize,
    /// Whether this item can be expanded to show children.
    pub is_expandable: bool,
    /// Whether this item is currently expanded.
    pub is_expanded: bool,
    /// Whether this item is visible (not filtered out).
    pub is_visible: bool,
    /// Whether this is a subtotal item.
    pub is_subtotal: bool,
    /// Whether this is a grand total item.
    pub is_grand_total: bool,
    /// Keys of child items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_keys: Option<Vec<String>>,
    /// Key of the parent item.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_key: Option<String>,
}

/// Collection of pivot items for a single field.
///
/// Returned by `get_field_items` and `get_all_field_items`. Contains all unique
/// items for one field, preserving their display order from the computed result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotFieldItems {
    /// The field these items belong to.
    pub field_id: FieldId,
    /// Display name of the field.
    pub field_name: String,
    /// Which area the field is placed in.
    pub area: PivotFieldArea,
    /// The unique items for this field.
    pub items: Vec<PivotItemInfo>,
}
