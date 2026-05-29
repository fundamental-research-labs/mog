//! Slicer types (x14/x15 extension namespaces, Excel 2010+).
//!
//! Unified from xlsx-parser read (`domain/slicers/read.rs`) and write sides.
//! These types represent the shared vocabulary; parsing and serialisation
//! logic stays in each respective module.
//!
//! Slicers are defined in Microsoft Office extension namespaces:
//! - **x14** (`http://schemas.microsoft.com/office/spreadsheetml/2009/9/main`) — CT_Slicer, CT_SlicerCacheDefinition
//! - **x15** (`http://schemas.microsoft.com/office/spreadsheetml/2010/11/main`) — CT_TableSlicerCache
//! - **sle** (`http://schemas.microsoft.com/office/drawing/2010/slicer`) — slicer anchor in drawing XML
//!
//! These are shared vocabulary types for targeted x14/x15 support. Parser and
//! writer modules own relationship closure, dirty invalidation, and any opaque
//! extension payload replay.

use crate::drawings::{CellAnchor, DrawingAnchorMetadata, Extent};

// ============================================================================
// Content Type & Relationship Constants
// ============================================================================

/// Content type for slicer parts (x14).
pub const CONTENT_TYPE_SLICER: &str = "application/vnd.ms-excel.slicer+xml";

/// Content type for slicer cache definitions (x14).
pub const CONTENT_TYPE_SLICER_CACHE: &str = "application/vnd.ms-excel.slicerCache+xml";

/// Relationship type for slicers (sheet-level).
pub const REL_SLICER: &str = "http://schemas.microsoft.com/office/2007/relationships/slicer";

/// Relationship type for slicer caches (workbook-level).
pub const REL_SLICER_CACHE: &str =
    "http://schemas.microsoft.com/office/2007/relationships/slicerCache";

// ============================================================================
// SlicerSortOrder (ST_SlicerSortOrder)
// ============================================================================

/// Sort order for slicer items.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum SlicerSortOrder {
    /// Ascending sort (default).
    #[default]
    Ascending,
    /// Descending sort.
    Descending,
}

impl SlicerSortOrder {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "ascending" => Self::Ascending,
            "descending" => Self::Descending,
            _ => Self::Ascending,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Ascending => "ascending",
            Self::Descending => "descending",
        }
    }
}

// ============================================================================
// SlicerCrossFilter (ST_SlicerCrossFilter)
// ============================================================================

/// Cross-filter behavior for slicers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum SlicerCrossFilter {
    /// No cross-filtering.
    None,
    /// Show items with data at top (default).
    #[default]
    ShowItemsWithDataAtTop,
    /// Show items with no data.
    ShowItemsWithNoData,
}

impl SlicerCrossFilter {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "showItemsWithDataAtTop" => Self::ShowItemsWithDataAtTop,
            "showItemsWithNoData" => Self::ShowItemsWithNoData,
            _ => Self::ShowItemsWithDataAtTop,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::ShowItemsWithDataAtTop => "showItemsWithDataAtTop",
            Self::ShowItemsWithNoData => "showItemsWithNoData",
        }
    }
}

// ============================================================================
// SlicerDef (CT_Slicer)
// ============================================================================

/// A single slicer definition (CT_Slicer from x14 namespace).
///
/// Parsed from `<x14:slicer>` elements inside `xl/slicers/slicer{N}.xml`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerDef {
    /// Slicer name (unique identifier within the workbook).
    pub name: String,
    /// Name of the associated slicer cache.
    pub cache: String,
    /// Display caption (defaults to name if absent).
    pub caption: Option<String>,
    /// Index of the first visible item (0-based).
    pub start_item: Option<u32>,
    /// Number of columns in the slicer (default: 1).
    pub column_count: u32,
    /// Whether to show the caption header (default: true).
    pub show_caption: bool,
    /// Hierarchy level for OLAP slicers (default: 0).
    pub level: u32,
    /// Slicer style name (e.g., "SlicerStyleLight1").
    pub style: Option<String>,
    /// Whether the slicer position is locked (default: false).
    pub locked_position: bool,
    /// Row height in EMUs (optional).
    pub row_height: Option<u32>,
    /// Optional UID (from xr10:uid attribute on individual slicer elements).
    pub uid: Option<String>,
    /// Extension list (opaque XML passthrough).
    pub ext_lst: Option<String>,
}

impl Default for SlicerDef {
    fn default() -> Self {
        Self {
            name: String::new(),
            cache: String::new(),
            caption: None,
            start_item: None,
            column_count: 1,    // OOXML spec default
            show_caption: true, // OOXML spec default
            level: 0,
            style: None,
            locked_position: false,
            row_height: None,
            uid: None,
            ext_lst: None,
        }
    }
}

// ============================================================================
// SlicerCacheDef (CT_SlicerCacheDefinition)
// ============================================================================

/// Slicer cache definition (CT_SlicerCacheDefinition from x14 namespace).
///
/// Parsed from `xl/slicerCaches/slicerCache{N}.xml`.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerCacheDef {
    /// Cache name (unique identifier).
    pub name: String,
    /// Optional UID (from xr10:uid attribute).
    pub uid: Option<String>,
    /// Source column/field name.
    pub source_name: String,
    /// Associated pivot tables (for pivot-backed slicers).
    pub pivot_tables: Vec<SlicerPivotTableRef>,
    /// Tabular data for pivot-backed non-OLAP slicers.
    pub tabular_data: Option<SlicerTabularData>,
    /// Table slicer cache (for table-backed slicers, from x15 extension).
    pub table_slicer_cache: Option<TableSlicerCache>,
    /// Extension list (opaque XML passthrough).
    pub ext_lst: Option<String>,
}

// ============================================================================
// SlicerPivotTableRef
// ============================================================================

/// Reference to a pivot table associated with a slicer cache.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerPivotTableRef {
    /// Tab (sheet) ID.
    pub tab_id: u32,
    /// Pivot table name.
    pub name: String,
}

// ============================================================================
// SlicerTabularData (CT_TabularSlicerCache)
// ============================================================================

/// Tabular slicer cache data for pivot-backed non-OLAP slicers (CT_TabularSlicerCache).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerTabularData {
    /// Pivot cache ID.
    pub pivot_cache_id: u32,
    /// Sort order for slicer items.
    pub sort_order: SlicerSortOrder,
    /// Whether to use custom list sorting (default: false).
    pub custom_list_sort: bool,
    /// Whether to show items with no data (default: false).
    pub show_missing: bool,
    /// Cross-filter behavior.
    pub cross_filter: SlicerCrossFilter,
    /// Slicer items (references into the pivot cache).
    pub items: Vec<SlicerTabularItem>,
    /// Extension list (opaque XML passthrough).
    pub ext_lst: Option<String>,
}

// ============================================================================
// SlicerTabularItem (CT_TabularSlicerCacheItem)
// ============================================================================

/// A single item in a tabular slicer cache (CT_TabularSlicerCacheItem).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerTabularItem {
    /// Index into pivot cache shared items.
    pub x: u32,
    /// Whether the item is selected (default: false).
    pub s: bool,
    /// Whether the item has no data (default: false).
    pub nd: bool,
    /// Unknown owner-local attributes on the item element.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_attrs: Vec<SlicerUnknownAttribute>,
}

/// Unknown owner-local slicer attribute.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerUnknownAttribute {
    /// Attribute qualified name as imported.
    pub name: String,
    /// Decoded or verbatim attribute value.
    pub value: String,
}

// ============================================================================
// TableSlicerCache (CT_TableSlicerCache)
// ============================================================================

/// Table slicer cache definition (CT_TableSlicerCache from x15 namespace).
///
/// This is the primary target for table-backed slicers.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSlicerCache {
    /// Table ID.
    pub table_id: u32,
    /// Column index within the table.
    pub column: u32,
    /// Sort order for slicer items.
    pub sort_order: SlicerSortOrder,
    /// Whether to use custom list sorting (default: false).
    pub custom_list_sort: bool,
    /// Cross-filter behavior.
    pub cross_filter: SlicerCrossFilter,
    /// Extension list (opaque XML passthrough).
    pub ext_lst: Option<String>,
}

// ============================================================================
// SlicerAnchor
// ============================================================================

/// Slicer anchor — position of a slicer in the drawing layer.
///
/// Extracted from drawing XML `mc:AlternateContent → mc:Choice Requires="a14"` elements.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerAnchor {
    /// Slicer name (links back to `SlicerDef.name`).
    pub slicer_name: String,
    /// Drawing object identity from `xdr:cNvPr/@id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_id: Option<u32>,
    /// Top-left anchor position.
    pub from: CellAnchor,
    /// Bottom-right anchor position.
    pub to: CellAnchor,
    /// Imported drawing anchor mode.
    ///
    /// Older callers only modeled two-cell slicer geometry.  This typed field
    /// lets the file-IO owner preserve one-cell slicer controls without raw
    /// drawing replay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_mode: Option<SlicerAnchorMode>,
    /// Object extent for one-cell anchors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extent: Option<Extent>,
    /// Optional `xdr:graphicFrame/@macro` attribute from the slicer frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub macro_name: Option<String>,
    /// Optional `xdr:cNvPr/a:extLst` XML from non-visual drawing properties.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nv_ext_lst: Option<String>,
    /// Metadata from the owning sheet drawing anchor.
    #[serde(default, skip_serializing_if = "DrawingAnchorMetadata::is_empty")]
    pub drawing: DrawingAnchorMetadata,
}

/// Drawing anchor mode for a slicer control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlicerAnchorMode {
    /// `xdr:twoCellAnchor`.
    #[default]
    TwoCell,
    /// `xdr:oneCellAnchor`.
    OneCell,
}
