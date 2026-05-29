use serde::{Deserialize, Serialize};

use ooxml_types::slicers::SlicerTabularItem;
use value_types::CellValue;

use super::super::floating_object::FloatingObjectAnchor;
use super::{SlicerSource, SlicerStyle};

/// Canonical slicer schema — Rust owns this type, TS is generated from it.
/// Matches the full persisted shape in Yrs CRDT storage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSlicer {
    pub id: String,
    pub sheet_id: String,
    pub source: SlicerSource,
    /// OOXML slicer cache name referenced by the slicer `cache` attribute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_name: Option<String>,
    /// OOXML slicer cache UID (`xr10:uid`/`uid`) from the cache definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_uid: Option<String>,
    pub caption: String,
    /// Programmatic name (OOXML `name` attribute). Falls back to `caption` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub style: SlicerStyle,
    /// Table-backed slicer source column index from `x15:tableSlicerCache`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_column_index: Option<u32>,
    /// Pivot-backed slicer cache id from `x14:tabular/@pivotCacheId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pivot_cache_id: Option<u32>,
    /// Pivot-backed slicer pivot table tab id from `x14:pivotTable/@tabId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pivot_table_tab_id: Option<u32>,
    /// Full pivot-backed slicer item state from `x14:tabular/x14:items`.
    ///
    /// `selected_values` is the runtime selection API. This field preserves the
    /// OOXML item index/no-data/unknown-attribute state owned by the slicer cache.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pivot_tabular_items: Vec<SlicerTabularItem>,
    /// OOXML slicer row height.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_height: Option<u32>,
    /// OOXML slicer hierarchy level.
    #[serde(default)]
    pub level: u32,
    /// OOXML rich-data UID from `xr10:uid`/`uid` on the slicer definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    /// Opaque extension XML from the slicer definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
    /// Opaque extension XML from the slicer cache definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_ext_lst_xml: Option<String>,
    /// Canonical anchor/position payload — shared with `FloatingObjectCommon`.
    ///
    /// Slicers are floating objects; their on-sheet position follows the
    /// `FloatingObjectAnchor` schema (cell-anchored or absolute EMU).
    /// Absent on freshly created slicers until a position is set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<FloatingObjectAnchor>,
    /// Drawing object identity (`xdr:cNvPr/@id`) for the slicer anchor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_object_id: Option<u32>,
    /// Optional `xdr:graphicFrame/@macro` from the slicer anchor frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_macro_name: Option<String>,
    /// Optional `xdr:cNvPr/a:extLst` XML from slicer anchor non-visual props.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_nv_ext_lst_xml: Option<String>,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default)]
    pub locked: bool,
    #[serde(default = "crate::default_true")]
    pub show_header: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_item: Option<i32>,
    #[serde(default = "crate::default_true")]
    pub multi_select: bool,
    /// Selection state — written by toggle_slicer_item/clear_slicer_selection.
    /// May be absent on freshly created slicers (hence default).
    #[serde(default)]
    pub selected_values: Vec<CellValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<f64>,
}

/// Partial update for a slicer — only present fields are applied.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSlicerUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<SlicerStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<FloatingObjectAnchor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_header: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_item: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multi_select: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_values: Option<Vec<CellValue>>,
}

impl StoredSlicer {
    /// Apply a partial update to this slicer. Only fields present in the update are changed.
    pub fn apply_update(&mut self, update: &StoredSlicerUpdate) {
        if let Some(ref caption) = update.caption {
            self.caption = caption.clone();
        }
        if let Some(ref name) = update.name {
            self.name = Some(name.clone());
        }
        if let Some(ref style) = update.style {
            self.style = style.clone();
        }
        if let Some(ref position) = update.position {
            self.position = Some(position.clone());
        }
        if let Some(z_index) = update.z_index {
            self.z_index = z_index;
        }
        if let Some(locked) = update.locked {
            self.locked = locked;
        }
        if let Some(show_header) = update.show_header {
            self.show_header = show_header;
        }
        if let Some(start_item) = update.start_item {
            self.start_item = Some(start_item);
        }
        if let Some(v) = update.multi_select {
            self.multi_select = v;
        }
        if let Some(ref selected_values) = update.selected_values {
            self.selected_values = selected_values.clone();
        }
    }
}
