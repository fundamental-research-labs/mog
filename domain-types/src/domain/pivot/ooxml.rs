use serde::{Deserialize, Serialize};

/// Full pivot table definition — enough to reconstruct pivotTable{N}.xml.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableDef {
    pub data_on_rows: bool,
    #[serde(default)]
    pub data_caption: String,
    pub location: PivotLocationDef,
    pub fields: Vec<PivotFieldDef>,
    pub row_fields: Vec<i32>,
    pub col_fields: Vec<i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub page_fields: Vec<PivotPageFieldDef>,
    pub data_fields: Vec<PivotDataFieldDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub row_items: Vec<PivotRowColItem>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub col_items: Vec<PivotRowColItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<PivotStyleDef>,
    /// Custom label for grand total rows/columns (OOXML `grandTotalCaption`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grand_total_caption: Option<String>,
    /// Custom label for the row header area (OOXML `rowHeaderCaption`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_header_caption: Option<String>,
    /// Custom label for the column header area (OOXML `colHeaderCaption`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col_header_caption: Option<String>,
    /// Show row grand totals. Default: true (OOXML `rowGrandTotals`).
    #[serde(default = "default_true")]
    pub row_grand_totals: bool,
    /// Show column grand totals. Default: true (OOXML `colGrandTotals`).
    #[serde(default = "default_true")]
    pub col_grand_totals: bool,
    /// Classic pivot layout with grid drop zones (OOXML `gridDropZones`).
    #[serde(default)]
    pub grid_drop_zones: bool,
    /// Caption for error values (OOXML `errorCaption`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_caption: Option<String>,
    /// Whether to show error caption (OOXML `showError`).
    #[serde(default)]
    pub show_error: bool,
    /// Caption for missing/empty values (OOXML `missingCaption`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing_caption: Option<String>,
    /// Whether to show missing caption (OOXML `showMissing`). Default: true.
    #[serde(default = "default_true")]
    pub show_missing: bool,
    /// Writer-only OOXML preservation state for imported pivot table details
    /// that are not modeled as editable pivot semantics.
    #[serde(default, skip_serializing_if = "PivotTableOoxmlPreservation::is_empty")]
    pub ooxml_preservation: PivotTableOoxmlPreservation,
}

/// Pivot table output location within the sheet.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotLocationDef {
    pub ref_range: String,
    pub first_header_row: u32,
    pub first_data_row: u32,
    pub first_data_col: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_per_page: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols_per_page: Option<u32>,
}

/// A field in the pivot table (one per cache field).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotFieldDef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<PivotAxis>,
    #[serde(default)]
    pub data_field: bool,
    #[serde(default = "default_true")]
    pub compact: bool,
    #[serde(default = "default_true")]
    pub outline: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_all: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_type: Option<String>,
    /// When present, the field is sorted by the aggregated values of the data field
    /// at this index (0-based into `data_fields`), not by label. Corresponds to
    /// OOXML `autoSortScope` with `field="0xFFFFFFFE"` and `<x v="N"/>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_sort_data_field: Option<u32>,
    #[serde(default = "default_true")]
    pub subtotal_top: bool,
    #[serde(default = "default_true")]
    pub default_subtotal: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subtotals: Vec<PivotFieldFunction>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<PivotFieldItem>,
}

fn default_true() -> bool {
    true
}

/// An item within a pivot field (shared item reference, subtotal, grand total, etc.).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotFieldItem {
    #[serde(default)]
    pub item_type: PivotItemType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<u32>,
    #[serde(default)]
    pub hidden: bool,
    /// Whether children are expanded (OOXML `sd` attribute). Defaults to true.
    #[serde(default = "default_true")]
    pub show_details: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s: Option<String>,
}

/// Data field — represents a value in the "Values" area.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotDataFieldDef {
    pub name: String,
    pub field_index: u32,
    #[serde(default)]
    pub function: PivotFieldFunction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_fmt_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_field: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_item: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_data_as: Option<String>,
}

/// Page (filter) field definition.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotPageFieldDef {
    pub field_index: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hierarchy: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
}

/// Row or column item for pivot table layout.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotRowColItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_type: Option<PivotItemType>,
    pub x_values: Vec<Option<u32>>,
}

/// Raw XML attribute captured as owner-scoped writer preservation state.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotRawXmlAttribute {
    pub name: String,
    pub value: String,
}

/// Raw XML child block captured under a pivot-owned element.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotRawXmlBlock {
    pub local_name: String,
    pub xml: String,
}

/// Per-field writer preservation state for unmodeled `pivotField` XML.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotFieldOoxmlPreservation {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attributes: Vec<PivotRawXmlAttribute>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<PivotRawXmlBlock>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub item_attributes: Vec<Vec<PivotRawXmlAttribute>>,
}

impl PivotFieldOoxmlPreservation {
    pub fn is_empty(&self) -> bool {
        self.attributes.is_empty()
            && self.children.is_empty()
            && self.item_attributes.iter().all(Vec::is_empty)
    }
}

/// Pivot table relationship identity discovered from the pivotTable part `.rels`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableRelationshipPreservation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rels_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_cache_definition_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consistency: Option<String>,
}

/// Writer-only OOXML preservation sidecar for imported pivotTableDefinition XML.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableOoxmlPreservation {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub root_namespace_declarations: Vec<PivotRawXmlAttribute>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub root_attributes: Vec<PivotRawXmlAttribute>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<PivotRawXmlBlock>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<PivotFieldOoxmlPreservation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub row_item_attributes: Vec<Vec<PivotRawXmlAttribute>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub col_item_attributes: Vec<Vec<PivotRawXmlAttribute>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship: Option<PivotTableRelationshipPreservation>,
    /// Named range/table source from pivot cache `<worksheetSource name="...">`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_source_name: Option<String>,
    /// Per-cache-field shared items from the imported cache definition.
    ///
    /// These are typed pivot semantics: pivot items and manual/custom ordering
    /// refer to shared item indexes, so export must keep the current shared item
    /// universe when regenerating cache definitions from live rows.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cache_shared_items: Vec<Vec<value_types::CellValue>>,
}

impl PivotTableOoxmlPreservation {
    pub fn is_empty(&self) -> bool {
        self.root_namespace_declarations.is_empty()
            && self.root_attributes.is_empty()
            && self.children.is_empty()
            && self
                .fields
                .iter()
                .all(PivotFieldOoxmlPreservation::is_empty)
            && self.row_item_attributes.iter().all(Vec::is_empty)
            && self.col_item_attributes.iter().all(Vec::is_empty)
            && self.relationship.is_none()
            && self.cache_source_name.is_none()
            && self.cache_shared_items.is_empty()
    }
}

/// Pivot table style configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotStyleDef {
    pub name: String,
    #[serde(default)]
    pub show_row_headers: bool,
    #[serde(default)]
    pub show_col_headers: bool,
    #[serde(default)]
    pub show_row_stripes: bool,
    #[serde(default)]
    pub show_col_stripes: bool,
    #[serde(default)]
    pub show_last_column: bool,
}

/// Pivot cache source metadata — tells the writer where to read data from.
/// The actual cache data is regenerated at export time.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotCacheSourceDef {
    pub cache_id: u32,
    /// Workbook-level reference scope that owns the cache relationship.
    #[serde(
        default,
        skip_serializing_if = "PivotCacheWorkbookRefScope::is_default"
    )]
    pub workbook_ref_scope: PivotCacheWorkbookRefScope,
    /// Typed source kind. A missing local sheet is not a source kind; imported
    /// external worksheet sources must stay external through export.
    #[serde(default, skip_serializing_if = "PivotCacheSourceKind::is_default")]
    pub source_kind: PivotCacheSourceKind,
    /// Named range/table source from pivot cache `<worksheetSource name="...">`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sheet: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_range: Option<String>,
    /// External worksheet relationship owned by the pivot cache definition part.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_worksheet: Option<PivotExternalWorksheetSourceDef>,
    /// Field (column) names from the cache definition header row.
    /// These are source metadata, not derived data.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_names: Vec<String>,
    /// Per-field shared items from the cache definition (unique values per column).
    /// Used to resolve PivotFieldItem.value indices to actual CellValues for filtering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_items: Vec<Vec<value_types::CellValue>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotCacheSourceKind {
    #[default]
    LocalWorksheet,
    LocalTableOrName,
    ExternalWorksheet,
    WorkbookConnection,
    Consolidation,
    Scenario,
    UnknownImported,
}

impl PivotCacheSourceKind {
    pub fn is_default(&self) -> bool {
        matches!(self, Self::LocalWorksheet)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotExternalWorksheetSourceDef {
    /// Imported `worksheetSource@r:id`; an allocation hint, not authority.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id_hint: Option<String>,
    /// Relationship type URI, usually `externalLinkPath`.
    pub relationship_type: String,
    /// External workbook/path target as current typed source state.
    pub target: String,
    /// Relationship TargetMode. External worksheet sources normally use External.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotCacheWorkbookRefScope {
    /// Standard workbook `<pivotCaches>` child.
    #[default]
    WorkbookPivotCaches,
    /// Office 2010 workbook extension `<x14:pivotCaches>`.
    X14PivotCaches,
    /// Office 2013 timeline extension `<x15:timelineCachePivotCaches>`.
    X15TimelineCachePivotCaches,
}

impl PivotCacheWorkbookRefScope {
    pub fn is_default(&self) -> bool {
        matches!(self, Self::WorkbookPivotCaches)
    }
}

/// A parsed pivot table: unified compute + OOXML config.
///
/// This is the unit stored in `ParseOutput.pivot_tables` and Yrs sheet-level storage.
/// The compute engine reads only compute-relevant fields of `config`; the XLSX
/// writer reads both compute and OOXML fields off the same config.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedPivotTable {
    /// Unified pivot table configuration (fields, placements, filters, layout,
    /// style, and OOXML attributes).
    pub config: super::config::PivotTableConfig,
    /// Initial expansion state built from OOXML `sd` (show_details) attributes.
    ///
    /// When present, this captures which row/column items were expanded vs
    /// collapsed in the source XLSX file. The TypeScript side should pass
    /// this to `pivotMaterialize()` / `pivotComputeFromSource()` on initial
    /// render so that the pivot matches the file's collapsed state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_expansion_state: Option<super::expansion::PivotExpansionState>,
    /// Writer-only pivotTableDefinition preservation state. Compute ignores this.
    #[serde(default, skip_serializing_if = "PivotTableOoxmlPreservation::is_empty")]
    pub ooxml_preservation: PivotTableOoxmlPreservation,
}

// ============================================================================
// Enums
// ============================================================================

/// Pivot field axis placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotAxis {
    Row,
    Col,
    Page,
    Values,
}

/// Aggregation function for pivot fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotFieldFunction {
    #[default]
    Sum,
    Count,
    Average,
    Max,
    Min,
    Product,
    CountNums,
    StdDev,
    StdDevP,
    Var,
    VarP,
}

/// Pivot field item type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotItemType {
    #[default]
    Data,
    Default,
    Sum,
    CountA,
    Avg,
    Max,
    Min,
    Product,
    Count,
    StdDev,
    StdDevP,
    Var,
    VarP,
    Grand,
    Blank,
}
