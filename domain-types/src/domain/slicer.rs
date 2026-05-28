use serde::{Deserialize, Serialize};

use ooxml_types::drawings::CellAnchor;
use ooxml_types::slicers::{
    SlicerAnchor as OoxmlSlicerAnchor, SlicerCacheDef as OoxmlSlicerCacheDef,
    SlicerDef as OoxmlSlicerDef, SlicerTabularItem, TableSlicerCache,
};
use value_types::CellValue;

use super::floating_object::{AnchorMode, FloatingObjectAnchor};

// ══════════════════════════════════════════════════════════════════
// Canonical StoredSlicer types (moved from compute-core::domain_types::slicers)

/// Internal reason code for slicer cache invalidation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlicerInvalidationReason {
    /// Underlying data cells changed.
    DataChanged,
    /// A filter was applied/removed.
    FilterChanged,
    /// Table/pivot structure changed.
    StructureChanged,
}

/// Contract event reason code for cache invalidation (for IPC/events).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CacheInvalidationEventReason {
    /// Cells changed.
    CellsChanged,
    /// Filter applied.
    FilterApplied,
    /// Table structure changed.
    TableStructureChanged,
    /// Pivot table updated.
    PivotUpdated,
}

/// Internal reason code for slicer disconnection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlicerDisconnectionReason {
    /// Source column was deleted.
    ColumnDeleted,
    /// Source table was deleted.
    TableDeleted,
    /// Source pivot table was deleted.
    PivotDeleted,
}

/// Contract event reason code for disconnection (for IPC/events).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DisconnectionEventReason {
    /// Column was deleted.
    ColumnDeleted,
    /// Table was deleted.
    TableDeleted,
    /// Pivot table was deleted.
    PivotDeleted,
}

/// State of a slicer item in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlicerItemState {
    /// Item is selected (filter active, this value included).
    Selected,
    /// Item is available but not selected.
    Available,
    /// Item has no matching data (hidden by other filters).
    Unavailable,
    /// Item has no data at all (e.g. column is empty or slicer is disconnected).
    #[serde(rename = "noData")]
    NoData,
}

/// A slicer item for UI display.
///
/// This maps from `SlicerCacheItem` (table-engine) to the UI representation
/// used by the slicer component.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerItem {
    /// The cell value.
    pub value: CellValue,
    /// Display text for the item.
    pub display_text: String,
    /// Current state of the item.
    pub state: SlicerItemState,
    /// Number of matching rows (absent when state is `NoData`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
}

/// Type of slicer selection change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlicerSelectionChangeType {
    /// Values were selected.
    Select,
    /// A single value was toggled.
    Toggle,
    /// Selection was cleared (show all).
    Clear,
    /// Selection was synchronized from another source.
    Sync,
}

/// Area of a pivot field that a slicer can bind to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PivotFieldArea {
    Row,
    Column,
    Filter,
}

/// Cross-filter behavior for slicer items.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CrossFilterMode {
    /// No cross-filtering.
    None,
    /// Items with data appear at top.
    ShowItemsWithDataAtTop,
    /// Show items even without data.
    ShowItemsWithNoData,
}

/// Sort order for slicer items. Wire format: "ascending" | "descending" | "dataSourceOrder".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlicerSortOrder {
    Ascending,
    Descending,
    DataSourceOrder,
}

/// Visual preset for slicer styling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlicerStylePreset {
    Light1,
    Light2,
    Light3,
    Light4,
    Light5,
    Light6,
    Dark1,
    Dark2,
    Dark3,
    Dark4,
    Dark5,
    Dark6,
    Other1,
    Other2,
}

/// Custom visual properties for a slicer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerCustomStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_border_radius: Option<f64>,
}

/// A named slicer style stored in the workbook-level style registry.
///
/// These styles live in a workbook-scoped collection and can be applied to any
/// slicer by name, similar to named table styles.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NamedSlicerStyle {
    /// Unique style name (user-assigned).
    pub name: String,
    /// Whether this is a built-in style (cannot be deleted).
    pub read_only: bool,
    /// The style definition.
    pub style: SlicerCustomStyle,
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

/// Visual style configuration for a slicer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<SlicerStylePreset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom: Option<SlicerCustomStyle>,
    pub column_count: i32,
    pub button_height: i32,
    pub show_selection_indicator: bool,
    pub cross_filter: CrossFilterMode,
    pub custom_list_sort: bool,
    pub show_items_with_no_data: bool,
    pub sort_order: SlicerSortOrder,
}

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimelineLevel {
    Years,
    Quarters,
    Months,
    Days,
}

impl Default for TimelineLevel {
    fn default() -> Self {
        Self::Months
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTimelineCache {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    pub source_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pivot_cache_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pivot_table_tab_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pivot_table_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTimeline {
    pub id: String,
    pub sheet_id: String,
    pub name: String,
    pub cache_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    #[serde(default)]
    pub level: TimelineLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache: Option<StoredTimelineCache>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<FloatingObjectAnchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_object_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
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

// ══════════════════════════════════════════════════════════════════
// Conversion helpers between ooxml-types and domain enums

fn ooxml_cross_filter_to_domain(cf: ooxml_types::slicers::SlicerCrossFilter) -> CrossFilterMode {
    match cf {
        ooxml_types::slicers::SlicerCrossFilter::None => CrossFilterMode::None,
        ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithDataAtTop => {
            CrossFilterMode::ShowItemsWithDataAtTop
        }
        ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithNoData => {
            CrossFilterMode::ShowItemsWithNoData
        }
    }
}

fn domain_cross_filter_to_ooxml(cf: CrossFilterMode) -> ooxml_types::slicers::SlicerCrossFilter {
    match cf {
        CrossFilterMode::None => ooxml_types::slicers::SlicerCrossFilter::None,
        CrossFilterMode::ShowItemsWithDataAtTop => {
            ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithDataAtTop
        }
        CrossFilterMode::ShowItemsWithNoData => {
            ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithNoData
        }
    }
}

fn ooxml_sort_order_to_domain(so: ooxml_types::slicers::SlicerSortOrder) -> SlicerSortOrder {
    match so {
        ooxml_types::slicers::SlicerSortOrder::Ascending => SlicerSortOrder::Ascending,
        ooxml_types::slicers::SlicerSortOrder::Descending => SlicerSortOrder::Descending,
    }
}

fn domain_sort_order_to_ooxml(so: SlicerSortOrder) -> ooxml_types::slicers::SlicerSortOrder {
    match so {
        SlicerSortOrder::Ascending | SlicerSortOrder::DataSourceOrder => {
            ooxml_types::slicers::SlicerSortOrder::Ascending
        }
        SlicerSortOrder::Descending => ooxml_types::slicers::SlicerSortOrder::Descending,
    }
}

// ══════════════════════════════════════════════════════════════════
// XLSX import conversion: old domain-types intermediates → StoredSlicer

/// Convert XLSX import types (ooxml-types) to StoredSlicer.
///
/// This bridges the ParseOutput types (`SlicerDef`, `SlicerCacheDef`,
/// `SlicerAnchor`) from ooxml-types to the canonical runtime type
/// (`StoredSlicer`).  Called during hydration to populate the workbook
/// `slicers` Y.Map.
pub fn xlsx_import_to_stored_slicer(
    slicer: &OoxmlSlicerDef,
    cache: Option<&OoxmlSlicerCacheDef>,
    anchor: Option<&OoxmlSlicerAnchor>,
    sheet_id: &str,
) -> StoredSlicer {
    // Deterministic ID from slicer name — stable across re-imports of the same file.
    let id = format!("slicer-{}", slicer.name);

    // Build source from cache definition
    let source = if let Some(cache_def) = cache {
        if let Some(ref tsc) = cache_def.table_slicer_cache {
            // Table-backed slicer
            SlicerSource::Table {
                table_id: tsc.table_id.to_string(),
                column_cell_id: cache_def.source_name.clone(),
            }
        } else if !cache_def.pivot_tables.is_empty() {
            // Pivot-backed slicer
            SlicerSource::Pivot {
                pivot_id: cache_def
                    .pivot_tables
                    .first()
                    .map(|pt| pt.name.clone())
                    .unwrap_or_default(),
                field_name: cache_def.source_name.clone(),
                field_area: PivotFieldArea::Row, // OOXML doesn't specify area in cache
            }
        } else {
            // Default: treat as table source with source_name
            SlicerSource::Table {
                table_id: String::new(),
                column_cell_id: cache_def.source_name.clone(),
            }
        }
    } else {
        // No cache found — placeholder table source
        SlicerSource::Table {
            table_id: String::new(),
            column_cell_id: String::new(),
        }
    };

    // Sort order, cross-filter, custom_list_sort, show_items_with_no_data from cache
    let (sort_order, cross_filter, custom_list_sort, show_items_with_no_data) = cache
        .and_then(|c| {
            if let Some(ref tsc) = c.table_slicer_cache {
                Some((
                    ooxml_sort_order_to_domain(tsc.sort_order),
                    ooxml_cross_filter_to_domain(tsc.cross_filter),
                    tsc.custom_list_sort,
                    false, // TableSlicerCache doesn't have show_missing
                ))
            } else {
                c.tabular_data.as_ref().map(|tab| {
                    (
                        ooxml_sort_order_to_domain(tab.sort_order),
                        ooxml_cross_filter_to_domain(tab.cross_filter),
                        tab.custom_list_sort,
                        tab.show_missing,
                    )
                })
            }
        })
        .unwrap_or((
            SlicerSortOrder::Ascending,
            CrossFilterMode::ShowItemsWithDataAtTop,
            false,
            false,
        ));

    // Selected values from tabular items
    let selected_values = cache
        .and_then(|c| c.tabular_data.as_ref())
        .map(|tab| {
            tab.items
                .iter()
                .filter(|item| item.s)
                .map(|item| CellValue::from(item.x.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // Map OOXML style name → preset enum
    let preset = slicer.style.as_deref().and_then(|s| {
        let s = s.strip_prefix("SlicerStyle").unwrap_or(s);
        match s {
            "Light1" => Some(SlicerStylePreset::Light1),
            "Light2" => Some(SlicerStylePreset::Light2),
            "Light3" => Some(SlicerStylePreset::Light3),
            "Light4" => Some(SlicerStylePreset::Light4),
            "Light5" => Some(SlicerStylePreset::Light5),
            "Light6" => Some(SlicerStylePreset::Light6),
            "Dark1" => Some(SlicerStylePreset::Dark1),
            "Dark2" => Some(SlicerStylePreset::Dark2),
            "Dark3" => Some(SlicerStylePreset::Dark3),
            "Dark4" => Some(SlicerStylePreset::Dark4),
            "Dark5" => Some(SlicerStylePreset::Dark5),
            "Dark6" => Some(SlicerStylePreset::Dark6),
            "Other1" => Some(SlicerStylePreset::Other1),
            "Other2" => Some(SlicerStylePreset::Other2),
            _ => None,
        }
    });

    // Build two-cell anchor position from SlicerAnchor
    let position = anchor.map(|a| FloatingObjectAnchor {
        anchor_row: a.from.row,
        anchor_col: a.from.col,
        anchor_row_offset: a.from.row_off,
        anchor_col_offset: a.from.col_off,
        anchor_mode: AnchorMode::TwoCell,
        absolute_x: None,
        absolute_y: None,
        end_row: Some(a.to.row),
        end_col: Some(a.to.col),
        end_row_offset: Some(a.to.row_off),
        end_col_offset: Some(a.to.col_off),
        extent_cx: None,
        extent_cy: None,
    });

    StoredSlicer {
        id,
        sheet_id: sheet_id.to_string(),
        source,
        cache_name: Some(slicer.cache.clone()),
        cache_uid: cache.and_then(|c| c.uid.clone()),
        caption: slicer
            .caption
            .clone()
            .unwrap_or_else(|| slicer.name.clone()),
        name: Some(slicer.name.clone()),
        style: SlicerStyle {
            preset,
            custom: None,
            column_count: slicer.column_count as i32,
            button_height: 0,
            show_selection_indicator: true,
            cross_filter,
            custom_list_sort,
            show_items_with_no_data,
            sort_order,
        },
        table_column_index: cache
            .and_then(|c| c.table_slicer_cache.as_ref())
            .map(|tsc| tsc.column),
        pivot_cache_id: cache
            .and_then(|c| c.tabular_data.as_ref())
            .map(|tab| tab.pivot_cache_id),
        pivot_table_tab_id: cache
            .and_then(|c| c.pivot_tables.first())
            .map(|pt| pt.tab_id),
        row_height: slicer.row_height,
        level: slicer.level,
        uid: slicer.uid.clone(),
        ext_lst_xml: slicer.ext_lst.clone(),
        cache_ext_lst_xml: cache.and_then(|c| c.ext_lst.clone()),
        position,
        anchor_object_id: anchor.and_then(|a| a.object_id),
        z_index: 0,
        locked: slicer.locked_position,
        show_header: slicer.show_caption,
        start_item: slicer.start_item.map(|v| v as i32),
        multi_select: true,
        selected_values,
        created_at: None,
        updated_at: None,
    }
}

/// Reconstruct an ooxml-types `SlicerCacheDef` from a `StoredSlicer`.
///
/// Used by the export path to produce `ParseOutput.slicer_caches` from
/// the workbook `slicers` Y.Map.
pub fn stored_slicer_to_cache_def(stored: &StoredSlicer) -> OoxmlSlicerCacheDef {
    let cache_name = stored
        .cache_name
        .clone()
        .unwrap_or_else(|| format!("Slicer_{}", stored.caption));
    match &stored.source {
        SlicerSource::Table {
            table_id,
            column_cell_id,
        } => {
            OoxmlSlicerCacheDef {
                name: cache_name,
                uid: stored.cache_uid.clone(),
                source_name: column_cell_id.clone(),
                pivot_tables: vec![],
                tabular_data: None,
                table_slicer_cache: Some(TableSlicerCache {
                    table_id: table_id.parse::<u32>().unwrap_or(0),
                    column: stored.table_column_index.unwrap_or(0),
                    sort_order: domain_sort_order_to_ooxml(stored.style.sort_order),
                    custom_list_sort: stored.style.custom_list_sort,
                    cross_filter: domain_cross_filter_to_ooxml(stored.style.cross_filter),
                    ext_lst: None,
                }),
                ext_lst: stored.cache_ext_lst_xml.clone(),
            }
        }
        SlicerSource::Pivot {
            pivot_id,
            field_name,
            ..
        } => {
            let items: Vec<SlicerTabularItem> = stored
                .selected_values
                .iter()
                .enumerate()
                .map(|(i, _v)| SlicerTabularItem {
                    x: i as u32,
                    s: true,
                    nd: false,
                })
                .collect();
            OoxmlSlicerCacheDef {
                name: cache_name,
                uid: stored.cache_uid.clone(),
                source_name: field_name.clone(),
                pivot_tables: vec![ooxml_types::slicers::SlicerPivotTableRef {
                    tab_id: stored.pivot_table_tab_id.unwrap_or(0),
                    name: pivot_id.clone(),
                }],
                tabular_data: Some(ooxml_types::slicers::SlicerTabularData {
                    pivot_cache_id: stored.pivot_cache_id.unwrap_or(0),
                    sort_order: domain_sort_order_to_ooxml(stored.style.sort_order),
                    custom_list_sort: stored.style.custom_list_sort,
                    show_missing: stored.style.show_items_with_no_data,
                    cross_filter: domain_cross_filter_to_ooxml(stored.style.cross_filter),
                    items,
                    ext_lst: None,
                }),
                table_slicer_cache: None,
                ext_lst: stored.cache_ext_lst_xml.clone(),
            }
        }
    }
}

/// Reconstruct an ooxml-types `SlicerDef` from a `StoredSlicer`.
///
/// Used by the export path to produce `SheetData.slicers` from
/// the workbook `slicers` Y.Map.
pub fn stored_slicer_to_slicer_def(stored: &StoredSlicer) -> OoxmlSlicerDef {
    let cache_name = stored
        .cache_name
        .clone()
        .unwrap_or_else(|| format!("Slicer_{}", stored.caption));
    let style_name = stored.style.preset.map(|p| {
        let variant = match p {
            SlicerStylePreset::Light1 => "Light1",
            SlicerStylePreset::Light2 => "Light2",
            SlicerStylePreset::Light3 => "Light3",
            SlicerStylePreset::Light4 => "Light4",
            SlicerStylePreset::Light5 => "Light5",
            SlicerStylePreset::Light6 => "Light6",
            SlicerStylePreset::Dark1 => "Dark1",
            SlicerStylePreset::Dark2 => "Dark2",
            SlicerStylePreset::Dark3 => "Dark3",
            SlicerStylePreset::Dark4 => "Dark4",
            SlicerStylePreset::Dark5 => "Dark5",
            SlicerStylePreset::Dark6 => "Dark6",
            SlicerStylePreset::Other1 => "Other1",
            SlicerStylePreset::Other2 => "Other2",
        };
        format!("SlicerStyle{}", variant)
    });
    OoxmlSlicerDef {
        name: stored.name.clone().unwrap_or_else(|| {
            stored
                .id
                .strip_prefix("slicer-")
                .unwrap_or(&stored.id)
                .to_string()
        }),
        cache: cache_name,
        caption: Some(stored.caption.clone()),
        start_item: stored.start_item.map(|v| v as u32),
        column_count: stored.style.column_count as u32,
        show_caption: stored.show_header,
        level: stored.level,
        style: style_name,
        locked_position: stored.locked,
        row_height: stored.row_height,
        uid: stored.uid.clone(),
        ext_lst: stored.ext_lst_xml.clone(),
    }
}

/// Reconstruct an ooxml-types `SlicerAnchor` from a `StoredSlicer`.
///
/// Returns `None` if the stored slicer has no position data.
pub fn stored_slicer_to_anchor(stored: &StoredSlicer) -> Option<OoxmlSlicerAnchor> {
    let pos = stored.position.as_ref()?;
    // OOXML slicer anchors require a two-cell rectangle (`from`/`to`).
    // Skip export when the stored anchor lacks end coordinates.
    let end_row = pos.end_row?;
    let end_col = pos.end_col?;
    let end_row_offset = pos.end_row_offset.unwrap_or(0);
    let end_col_offset = pos.end_col_offset.unwrap_or(0);
    Some(OoxmlSlicerAnchor {
        slicer_name: stored.name.clone().unwrap_or_else(|| {
            stored
                .id
                .strip_prefix("slicer-")
                .unwrap_or(&stored.id)
                .to_string()
        }),
        object_id: stored.anchor_object_id,
        from: CellAnchor {
            col: pos.anchor_col,
            col_off: pos.anchor_col_offset,
            row: pos.anchor_row,
            row_off: pos.anchor_row_offset,
        },
        to: CellAnchor {
            col: end_col,
            col_off: end_col_offset,
            row: end_row,
            row_off: end_row_offset,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_slicer_table_source_round_trip() {
        let slicer = StoredSlicer {
            id: "slicer-1".into(),
            sheet_id: "00000000000000000000000000000001".into(),
            source: SlicerSource::Table {
                table_id: "table-1".into(),
                column_cell_id: "cell-1".into(),
            },
            cache_name: None,
            cache_uid: None,
            caption: "Region".into(),
            name: None,
            style: SlicerStyle {
                preset: Some(SlicerStylePreset::Light1),
                custom: None,
                column_count: 1,
                button_height: 25,
                show_selection_indicator: true,
                cross_filter: CrossFilterMode::None,
                custom_list_sort: false,
                show_items_with_no_data: false,
                sort_order: SlicerSortOrder::Ascending,
            },
            table_column_index: None,
            pivot_cache_id: None,
            pivot_table_tab_id: None,
            row_height: None,
            level: 0,
            uid: None,
            ext_lst_xml: None,
            cache_ext_lst_xml: None,
            position: None,
            anchor_object_id: None,
            z_index: 0,
            locked: false,
            show_header: true,
            start_item: None,
            multi_select: true,
            selected_values: vec![
                CellValue::Text("East".into()),
                CellValue::Text("West".into()),
            ],
            created_at: None,
            updated_at: None,
        };

        let json = serde_json::to_string(&slicer).unwrap();
        let deserialized: StoredSlicer = serde_json::from_str(&json).unwrap();
        assert_eq!(slicer, deserialized);
    }

    #[test]
    fn stored_slicer_pivot_source_round_trip() {
        let slicer = StoredSlicer {
            id: "slicer-2".into(),
            sheet_id: "00000000000000000000000000000002".into(),
            source: SlicerSource::Pivot {
                pivot_id: "pivot-1".into(),
                field_name: "Category".into(),
                field_area: PivotFieldArea::Row,
            },
            cache_name: None,
            cache_uid: None,
            caption: "Category".into(),
            name: None,
            style: SlicerStyle {
                preset: None,
                custom: Some(SlicerCustomStyle {
                    header_background_color: Some("#333".into()),
                    header_text_color: Some("#fff".into()),
                    header_font_size: None,
                    selected_background_color: None,
                    selected_text_color: None,
                    available_background_color: None,
                    available_text_color: None,
                    unavailable_background_color: None,
                    unavailable_text_color: None,
                    border_color: None,
                    border_width: None,
                    item_border_radius: None,
                }),
                column_count: 2,
                button_height: 30,
                show_selection_indicator: false,
                cross_filter: CrossFilterMode::ShowItemsWithNoData,
                custom_list_sort: true,
                show_items_with_no_data: true,
                sort_order: SlicerSortOrder::DataSourceOrder,
            },
            table_column_index: None,
            pivot_cache_id: None,
            pivot_table_tab_id: None,
            row_height: None,
            level: 0,
            uid: None,
            ext_lst_xml: None,
            cache_ext_lst_xml: None,
            position: Some(FloatingObjectAnchor {
                anchor_mode: AnchorMode::Absolute,
                anchor_row_offset: 200 * 9525,
                anchor_col_offset: 100 * 9525,
                ..Default::default()
            }),
            anchor_object_id: None,
            z_index: 5,
            locked: true,
            show_header: false,
            start_item: Some(3),
            multi_select: true,
            selected_values: vec![],
            created_at: Some(1710000000.0),
            updated_at: Some(1710003600.0),
        };

        let json = serde_json::to_string(&slicer).unwrap();
        let deserialized: StoredSlicer = serde_json::from_str(&json).unwrap();
        assert_eq!(slicer, deserialized);
    }

    #[test]
    fn slicer_source_tagged_union_serialization() {
        let table = SlicerSource::Table {
            table_id: "t1".into(),
            column_cell_id: "c1".into(),
        };
        let json = serde_json::to_value(&table).unwrap();
        assert_eq!(json["type"], "table");
        assert_eq!(json["tableId"], "t1");
        assert_eq!(json["columnCellId"], "c1");

        let pivot = SlicerSource::Pivot {
            pivot_id: "p1".into(),
            field_name: "Sales".into(),
            field_area: PivotFieldArea::Filter,
        };
        let json = serde_json::to_value(&pivot).unwrap();
        assert_eq!(json["type"], "pivot");
        assert_eq!(json["pivotId"], "p1");
        assert_eq!(json["fieldName"], "Sales");
        assert_eq!(json["fieldArea"], "filter");
    }

    #[test]
    fn slicer_style_wire_names() {
        let style = SlicerStyle {
            preset: Some(SlicerStylePreset::Dark3),
            custom: None,
            column_count: 1,
            button_height: 25,
            show_selection_indicator: true,
            cross_filter: CrossFilterMode::ShowItemsWithDataAtTop,
            custom_list_sort: false,
            show_items_with_no_data: false,
            sort_order: SlicerSortOrder::DataSourceOrder,
        };
        let json = serde_json::to_value(&style).unwrap();
        assert_eq!(json["crossFilter"], "showItemsWithDataAtTop");
        assert_eq!(json["sortOrder"], "dataSourceOrder");
        assert_eq!(json["preset"], "dark3");

        // Round-trip
        let back: SlicerStyle = serde_json::from_value(json).unwrap();
        assert_eq!(style, back);
    }

    #[test]
    fn apply_update_partial_merge() {
        let mut slicer = StoredSlicer {
            id: "s1".into(),
            sheet_id: "sheet1".into(),
            source: SlicerSource::Table {
                table_id: "t1".into(),
                column_cell_id: "c1".into(),
            },
            cache_name: None,
            cache_uid: None,
            caption: "Old".into(),
            name: None,
            style: SlicerStyle {
                preset: None,
                custom: None,
                column_count: 1,
                button_height: 25,
                show_selection_indicator: true,
                cross_filter: CrossFilterMode::None,
                custom_list_sort: false,
                show_items_with_no_data: false,
                sort_order: SlicerSortOrder::Ascending,
            },
            table_column_index: None,
            pivot_cache_id: None,
            pivot_table_tab_id: None,
            row_height: None,
            level: 0,
            uid: None,
            ext_lst_xml: None,
            cache_ext_lst_xml: None,
            position: None,
            anchor_object_id: None,
            z_index: 0,
            locked: false,
            show_header: true,
            start_item: None,
            multi_select: true,
            selected_values: vec![CellValue::Text("a".into())],
            created_at: None,
            updated_at: None,
        };

        let update = StoredSlicerUpdate {
            caption: Some("New".into()),
            name: None,
            style: None,
            position: None,
            z_index: Some(10),
            locked: None,
            show_header: None,
            start_item: None,
            multi_select: None,
            selected_values: None,
        };

        slicer.apply_update(&update);
        assert_eq!(slicer.caption, "New");
        assert_eq!(slicer.z_index, 10);
        // Unchanged fields
        assert!(!slicer.locked);
        assert!(slicer.show_header);
        assert_eq!(slicer.selected_values, vec![CellValue::Text("a".into())]);
    }

    #[test]
    fn deserialize_from_existing_stored_json() {
        // Matches the canonical FloatingObjectAnchor wire shape now that
        // StoredSlicer.position is typed (typed OOXML preservation / 01-slicer-typing).
        let json = serde_json::json!({
            "id": "slicer-abc",
            "sheetId": "00000000000000000000000000000001",
            "source": {
                "type": "table",
                "tableId": "table-xyz",
                "columnCellId": "cell-123"
            },
            "caption": "Region",
            "style": {
                "columnCount": 1,
                "buttonHeight": 25,
                "showSelectionIndicator": true,
                "crossFilter": "none",
                "customListSort": false,
                "showItemsWithNoData": false,
                "sortOrder": "ascending"
            },
            "position": {
                "anchorRow": 0,
                "anchorCol": 0,
                "anchorRowOffset": 952500,
                "anchorColOffset": 952500,
                "anchorMode": "absolute",
                "extentCx": 1905000,
                "extentCy": 2857500
            },
            "zIndex": 0,
            "locked": false,
            "showHeader": true
        });

        let slicer: StoredSlicer = serde_json::from_value(json).unwrap();
        assert_eq!(slicer.id, "slicer-abc");
        assert!(matches!(slicer.source, SlicerSource::Table { .. }));
        assert_eq!(slicer.style.column_count, 1);
        let pos = slicer.position.as_ref().expect("position present");
        assert_eq!(pos.anchor_mode, AnchorMode::Absolute);
        assert_eq!(pos.extent_cx, Some(1_905_000));
        // selected_values defaults to empty vec when absent
        assert!(slicer.selected_values.is_empty());
        // show_header defaults to true
        assert!(slicer.show_header);
        // multi_select defaults to true when absent
        assert!(slicer.multi_select);
    }

    #[test]
    fn multi_select_defaults_to_true() {
        let json = serde_json::json!({
            "id": "slicer-ms",
            "sheetId": "sheet1",
            "source": {
                "type": "table",
                "tableId": "t1",
                "columnCellId": "c1"
            },
            "caption": "Test",
            "style": {
                "columnCount": 1,
                "buttonHeight": 25,
                "showSelectionIndicator": true,
                "crossFilter": "none",
                "customListSort": false,
                "showItemsWithNoData": false,
                "sortOrder": "ascending"
            }
        });

        let slicer: StoredSlicer = serde_json::from_value(json).unwrap();
        assert!(
            slicer.multi_select,
            "multi_select should default to true when absent from JSON"
        );

        // Explicit false should be respected
        let json_false = serde_json::json!({
            "id": "slicer-ms2",
            "sheetId": "sheet1",
            "source": {
                "type": "table",
                "tableId": "t1",
                "columnCellId": "c1"
            },
            "caption": "Test",
            "style": {
                "columnCount": 1,
                "buttonHeight": 25,
                "showSelectionIndicator": true,
                "crossFilter": "none",
                "customListSort": false,
                "showItemsWithNoData": false,
                "sortOrder": "ascending"
            },
            "multiSelect": false
        });

        let slicer2: StoredSlicer = serde_json::from_value(json_false).unwrap();
        assert!(
            !slicer2.multi_select,
            "multi_select should be false when explicitly set"
        );
    }

    #[test]
    fn xlsx_import_table_slicer_conversion() {
        let slicer = OoxmlSlicerDef {
            name: "Region".into(),
            cache: "Slicer_Region".into(),
            caption: Some("Region Filter".into()),
            column_count: 2,
            style: Some("SlicerStyleLight3".into()),
            locked_position: true,
            show_caption: true,
            level: 0,
            start_item: None,
            row_height: None,
            uid: None,
            ext_lst: None,
        };
        let cache = OoxmlSlicerCacheDef {
            name: "Slicer_Region".into(),
            uid: None,
            source_name: "Region".into(),
            pivot_tables: vec![],
            tabular_data: None,
            table_slicer_cache: Some(TableSlicerCache {
                table_id: 1,
                column: 0,
                sort_order: ooxml_types::slicers::SlicerSortOrder::Descending,
                custom_list_sort: false,
                cross_filter: ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithDataAtTop,
                ext_lst: None,
            }),
            ext_lst: None,
        };
        let anchor = OoxmlSlicerAnchor {
            slicer_name: "Region".into(),
            object_id: Some(42),
            from: CellAnchor {
                col: 5,
                col_off: 200,
                row: 0,
                row_off: 100,
            },
            to: CellAnchor {
                col: 8,
                col_off: 0,
                row: 10,
                row_off: 0,
            },
        };

        let stored =
            xlsx_import_to_stored_slicer(&slicer, Some(&cache), Some(&anchor), "sheet-hex-1");
        assert_eq!(stored.id, "slicer-Region");
        assert_eq!(stored.sheet_id, "sheet-hex-1");
        assert_eq!(stored.caption, "Region Filter");
        assert!(stored.locked);
        assert_eq!(stored.style.column_count, 2);
        assert_eq!(stored.style.preset, Some(SlicerStylePreset::Light3));
        assert_eq!(stored.style.sort_order, SlicerSortOrder::Descending);
        assert!(
            matches!(stored.source, SlicerSource::Table { ref table_id, ref column_cell_id }
            if table_id == "1" && column_cell_id == "Region")
        );
        let pos = stored.position.as_ref().expect("position is populated");
        assert_eq!(pos.anchor_col, 5);
        assert_eq!(pos.end_row, Some(10));
        assert_eq!(pos.anchor_mode, AnchorMode::TwoCell);
    }

    #[test]
    fn xlsx_import_pivot_slicer_conversion() {
        let slicer = OoxmlSlicerDef {
            name: "Category".into(),
            cache: "Slicer_Category".into(),
            caption: None,
            column_count: 1,
            style: None,
            locked_position: false,
            show_caption: true,
            level: 0,
            start_item: None,
            row_height: None,
            uid: None,
            ext_lst: None,
        };
        let cache = OoxmlSlicerCacheDef {
            name: "Slicer_Category".into(),
            uid: None,
            source_name: "Category".into(),
            pivot_tables: vec![ooxml_types::slicers::SlicerPivotTableRef {
                tab_id: 0,
                name: "PivotTable1".into(),
            }],
            tabular_data: Some(ooxml_types::slicers::SlicerTabularData {
                pivot_cache_id: 0,
                sort_order: ooxml_types::slicers::SlicerSortOrder::Ascending,
                custom_list_sort: false,
                show_missing: false,
                cross_filter: ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithDataAtTop,
                items: vec![
                    SlicerTabularItem {
                        x: 0,
                        s: true,
                        nd: false,
                    },
                    SlicerTabularItem {
                        x: 1,
                        s: false,
                        nd: false,
                    },
                    SlicerTabularItem {
                        x: 2,
                        s: true,
                        nd: false,
                    },
                ],
                ext_lst: None,
            }),
            table_slicer_cache: None,
            ext_lst: None,
        };

        let stored = xlsx_import_to_stored_slicer(&slicer, Some(&cache), None, "sheet-hex-2");
        assert_eq!(stored.caption, "Category"); // defaults to name when caption is None
        assert!(stored.position.is_none());
        assert_eq!(stored.style.column_count, 1);
        assert!(stored.style.preset.is_none());
        assert!(
            matches!(stored.source, SlicerSource::Pivot { ref pivot_id, .. }
            if pivot_id == "PivotTable1")
        );
        // Only selected items (indices 0 and 2 have s=true)
        assert_eq!(stored.selected_values.len(), 2);
        assert_eq!(stored.selected_values[0], CellValue::from("0".to_string()));
        assert_eq!(stored.selected_values[1], CellValue::from("2".to_string()));
    }

    #[test]
    fn stored_slicer_round_trip_to_ooxml_types() {
        let stored = StoredSlicer {
            id: "slicer-Region".into(),
            sheet_id: "sheet-1".into(),
            source: SlicerSource::Table {
                table_id: "1".into(),
                column_cell_id: "Region".into(),
            },
            cache_name: Some("Slicer_Region".into()),
            cache_uid: Some("{CACHE-UID}".into()),
            caption: "Region".into(),
            name: Some("Region".into()),
            style: SlicerStyle {
                preset: Some(SlicerStylePreset::Dark2),
                custom: None,
                column_count: 3,
                button_height: 0,
                show_selection_indicator: true,
                cross_filter: CrossFilterMode::ShowItemsWithDataAtTop,
                custom_list_sort: false,
                show_items_with_no_data: false,
                sort_order: SlicerSortOrder::Descending,
            },
            table_column_index: Some(2),
            pivot_cache_id: None,
            pivot_table_tab_id: None,
            row_height: Some(241300),
            level: 0,
            uid: Some("{SLICER-UID}".into()),
            ext_lst_xml: None,
            cache_ext_lst_xml: None,
            position: Some(FloatingObjectAnchor {
                anchor_row: 0,
                anchor_col: 5,
                anchor_row_offset: 100,
                anchor_col_offset: 200,
                anchor_mode: AnchorMode::TwoCell,
                absolute_x: None,
                absolute_y: None,
                end_row: Some(10),
                end_col: Some(8),
                end_row_offset: Some(0),
                end_col_offset: Some(0),
                extent_cx: None,
                extent_cy: None,
            }),
            anchor_object_id: Some(7),
            z_index: 0,
            locked: true,
            show_header: true,
            start_item: None,
            multi_select: true,
            selected_values: vec![],
            created_at: None,
            updated_at: None,
        };

        let slicer_def = stored_slicer_to_slicer_def(&stored);
        assert_eq!(slicer_def.name, "Region");
        assert_eq!(slicer_def.style, Some("SlicerStyleDark2".into()));
        assert_eq!(slicer_def.column_count, 3);
        assert!(slicer_def.locked_position);

        let cache_def = stored_slicer_to_cache_def(&stored);
        assert_eq!(cache_def.source_name, "Region");
        assert!(cache_def.table_slicer_cache.is_some());
        assert_eq!(cache_def.table_slicer_cache.as_ref().unwrap().table_id, 1);

        let anchor = stored_slicer_to_anchor(&stored).unwrap();
        assert_eq!(anchor.slicer_name, "Region");
        assert_eq!(anchor.from.col, 5);
        assert_eq!(anchor.to.row, 10);
    }

    /// Helper to build a minimal StoredSlicer for tests.
    fn make_test_slicer(id: &str, name: Option<&str>) -> StoredSlicer {
        StoredSlicer {
            id: id.into(),
            sheet_id: "sheet1".into(),
            source: SlicerSource::Table {
                table_id: "t1".into(),
                column_cell_id: "c1".into(),
            },
            cache_name: None,
            cache_uid: None,
            caption: "Cap".into(),
            name: name.map(|s| s.into()),
            style: SlicerStyle {
                preset: None,
                custom: None,
                column_count: 1,
                button_height: 25,
                show_selection_indicator: true,
                cross_filter: CrossFilterMode::None,
                custom_list_sort: false,
                show_items_with_no_data: false,
                sort_order: SlicerSortOrder::Ascending,
            },
            table_column_index: None,
            pivot_cache_id: None,
            pivot_table_tab_id: None,
            row_height: None,
            level: 0,
            uid: None,
            ext_lst_xml: None,
            cache_ext_lst_xml: None,
            position: None,
            anchor_object_id: None,
            z_index: 0,
            locked: false,
            show_header: true,
            start_item: None,
            multi_select: true,
            selected_values: vec![],
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn name_none_export_fallback_strips_slicer_prefix() {
        let slicer = make_test_slicer("slicer-TestName", None);
        let def = stored_slicer_to_slicer_def(&slicer);
        assert_eq!(
            def.name, "TestName",
            "should strip 'slicer-' prefix from id"
        );
    }

    #[test]
    fn name_none_export_fallback_raw_uuid() {
        let raw_id = "550e8400-e29b-41d4-a716-446655440000";
        let slicer = make_test_slicer(raw_id, None);
        let def = stored_slicer_to_slicer_def(&slicer);
        assert_eq!(
            def.name, raw_id,
            "should return full id when no 'slicer-' prefix"
        );
    }

    #[test]
    fn apply_update_sets_name() {
        let mut slicer = make_test_slicer("s1", None);
        assert_eq!(slicer.name, None);

        let update = StoredSlicerUpdate {
            name: Some("NewName".into()),
            caption: None,
            style: None,
            position: None,
            z_index: None,
            locked: None,
            show_header: None,
            start_item: None,
            multi_select: None,
            selected_values: None,
        };

        slicer.apply_update(&update);
        assert_eq!(slicer.name, Some("NewName".into()));
    }
}
