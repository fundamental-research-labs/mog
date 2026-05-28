//! Pivot cache definition types (ECMA-376 §18.10 — pivot cache).
//!
//! Covers `xl/pivotCache/pivotCacheDefinition{N}.xml` structures:
//! cache sources, cache fields, shared items, field groups, and
//! OLAP hierarchy / group-level types.

use super::enums::PivotSourceType;
use super::field::PivotDimensions;
use super::grouping::PivotDiscretePr;
use super::layout::{PivotCalculatedItems, PivotCalculatedMembers};
use super::primitives::{PivotX, TupleCache};
use super::shared_items::{
    PivotBoolean, PivotCacheString, PivotDateTime, PivotError, PivotMissing, PivotNumber,
    SharedItem,
};

// ============================================================================
// WorksheetSource — CT_WorksheetSource
// ============================================================================

/// Worksheet source for pivot cache (CT_WorksheetSource).
///
/// Identifies the worksheet range or named range/table that provides data.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct WorksheetSource {
    /// Cell range reference (e.g. "A1:D100").
    pub r#ref: Option<String>,
    /// Name of the source worksheet.
    pub name: Option<String>,
    /// Named range or table name.
    pub sheet: Option<String>,
    /// Relationship ID for the source worksheet part.
    pub r_id: Option<String>,
}

// ============================================================================
// PivotCacheSource — CT_CacheSource
// ============================================================================

/// Pivot cache source definition (CT_CacheSource).
///
/// Identifies the type and location of the data source for a pivot cache.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotCacheSource {
    /// Type of data source.
    pub r#type: PivotSourceType,
    /// Connection ID for external data sources.
    pub connection_id: Option<u32>,
    /// Worksheet source definition (when type = worksheet).
    pub worksheet_source: Option<WorksheetSource>,
    /// Consolidation source definition (when type = consolidation).
    pub consolidation: Option<PivotConsolidation>,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for PivotCacheSource {
    fn default() -> Self {
        Self {
            r#type: PivotSourceType::Worksheet,
            connection_id: Some(0),
            worksheet_source: None,
            consolidation: None,
            ext_lst: None,
        }
    }
}

// ============================================================================
// PivotConsolidation — CT_Consolidation
// ============================================================================

/// Consolidation source for pivot cache (CT_Consolidation).
///
/// Used when multiple ranges are consolidated into a single pivot cache.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotConsolidation {
    /// Whether to auto-generate page fields. Default: `true`.
    pub auto_page: bool,
    /// Page item definitions.
    pub pages: Vec<PivotConsolidationPage>,
    /// Range set definitions.
    pub range_sets: Vec<PivotRangeSet>,
}

impl Default for PivotConsolidation {
    fn default() -> Self {
        Self {
            auto_page: true,
            pages: Vec::new(),
            range_sets: Vec::new(),
        }
    }
}

/// Page definition within a consolidation source (CT_Pages child).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotConsolidationPage {
    /// Page item values.
    pub items: Vec<PivotPageItem>,
    /// Number of items.
    pub count: Option<u32>,
}

/// Page item within a consolidation page (CT_PageItem).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotPageItem {
    /// Item name.
    pub name: String,
}

/// Range set within a consolidation source (CT_RangeSet).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotRangeSet {
    /// First page field item index.
    pub i1: Option<u32>,
    /// Second page field item index.
    pub i2: Option<u32>,
    /// Third page field item index.
    pub i3: Option<u32>,
    /// Fourth page field item index.
    pub i4: Option<u32>,
    /// Cell reference for this range.
    pub r#ref: Option<String>,
    /// Name of the source range.
    pub name: Option<String>,
    /// Name of the source sheet.
    pub sheet: Option<String>,
    /// Relationship ID for the source worksheet.
    pub r_id: Option<String>,
}

// ============================================================================
// SharedItems — CT_SharedItems
// ============================================================================

/// Shared items for a cache field (CT_SharedItems).
///
/// Contains a mixed list of values (missing, number, boolean, error, string,
/// date-time) shared across pivot cache records.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SharedItems {
    /// Whether the field contains semi-mixed types. Default: `true`.
    pub contains_semi_mixed_types: bool,
    /// Whether the field contains non-date values. Default: `true`.
    pub contains_non_date: bool,
    /// Whether the field contains date values. Default: `false`.
    pub contains_date: bool,
    /// Whether the field contains string values. Default: `true`.
    pub contains_string: bool,
    /// Whether the field contains blank values. Default: `false`.
    pub contains_blank: bool,
    /// Whether the field contains mixed types. Default: `false`.
    pub contains_mixed_types: bool,
    /// Whether the field contains number values. Default: `false`.
    pub contains_number: bool,
    /// Whether the field contains integer values. Default: `false`.
    pub contains_integer: bool,
    /// Minimum numeric value.
    pub min_value: Option<f64>,
    /// Maximum numeric value.
    pub max_value: Option<f64>,
    /// Minimum date value (ISO 8601 string).
    pub min_date: Option<String>,
    /// Maximum date value (ISO 8601 string).
    pub max_date: Option<String>,
    /// Number of items.
    pub count: Option<u32>,
    /// Whether long text. Default: `false`.
    pub long_text: bool,
    /// Mixed item values (m/n/b/e/s/d) — unified enum representation.
    pub items: Vec<SharedItem>,
    /// Missing value elements (`<m>`). XSD: CT_Missing, choice element.
    #[serde(rename = "m")]
    pub m: Vec<PivotMissing>,
    /// Numeric value elements (`<n>`). XSD: CT_Number, choice element.
    #[serde(rename = "n")]
    pub n: Vec<PivotNumber>,
    /// Boolean value elements (`<b>`). XSD: CT_Boolean, choice element.
    #[serde(rename = "b")]
    pub b: Vec<PivotBoolean>,
    /// Error value elements (`<e>`). XSD: CT_Error, choice element.
    #[serde(rename = "e")]
    pub e: Vec<PivotError>,
    /// String value elements (`<s>`). XSD: CT_String, choice element.
    #[serde(rename = "s")]
    pub s: Vec<PivotCacheString>,
    /// Date-time value elements (`<d>`). XSD: CT_DateTime, choice element.
    #[serde(rename = "d")]
    pub d: Vec<PivotDateTime>,
}

impl Default for SharedItems {
    fn default() -> Self {
        Self {
            contains_semi_mixed_types: true,
            contains_non_date: true,
            contains_date: false,
            contains_string: true,
            contains_blank: false,
            contains_mixed_types: false,
            contains_number: false,
            contains_integer: false,
            min_value: None,
            max_value: None,
            min_date: None,
            max_date: None,
            count: None,
            long_text: false,
            items: Vec::new(),
            m: Vec::new(),
            n: Vec::new(),
            b: Vec::new(),
            e: Vec::new(),
            s: Vec::new(),
            d: Vec::new(),
        }
    }
}

// ============================================================================
// PivotCacheField — CT_CacheField
// ============================================================================

/// Pivot cache field definition (CT_CacheField).
///
/// Describes a single field (column) in the pivot cache, including its name,
/// shared items, and optional field grouping.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotCacheField {
    /// Field name (required).
    pub name: String,
    /// Display caption.
    pub caption: Option<String>,
    /// Number format ID.
    pub num_fmt_id: Option<u32>,
    /// Formula for a calculated field.
    pub formula: Option<String>,
    /// SQL data type.
    pub sql_type: Option<i32>,
    /// Hierarchy index for OLAP.
    pub hierarchy: Option<i32>,
    /// Level within the hierarchy for OLAP. XSD default: `0`.
    pub level: Option<u32>,
    /// Whether this is a database field. Default: `true`.
    pub database_field: bool,
    /// Whether the unique items list is used. Default: `true`.
    pub unique_list: Option<bool>,
    /// Whether this is a member property field. Default: `false`.
    pub member_property_field: bool,
    /// Whether this is a server-based field. Default: `false`.
    pub server_field: bool,
    /// Member property name (OLAP).
    pub property_name: Option<String>,
    /// Number of property mappings.
    pub mapping_count: Option<u32>,
    /// Shared items for this field.
    pub shared_items: Option<SharedItems>,
    /// Field grouping definition.
    pub field_group: Option<PivotFieldGroup>,
    /// Member property map entries (`<mpMap>` elements, CT_X).
    pub mp_map: Vec<PivotX>,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for PivotCacheField {
    fn default() -> Self {
        Self {
            name: String::new(),
            caption: None,
            num_fmt_id: None,
            formula: None,
            sql_type: Some(0),
            hierarchy: Some(0),
            level: Some(0),
            database_field: true,
            unique_list: Some(true),
            member_property_field: false,
            server_field: false,
            property_name: None,
            mapping_count: None,
            shared_items: None,
            field_group: None,
            mp_map: Vec::new(),
            ext_lst: None,
        }
    }
}

// ============================================================================
// PivotCacheFields — CT_CacheFields
// ============================================================================

/// Collection of pivot cache field definitions (CT_CacheFields).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotCacheFields {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The cache field definitions.
    pub items: Vec<PivotCacheField>,
}

// ============================================================================
// PivotCacheHierarchy — CT_CacheHierarchy
// ============================================================================

/// OLAP cache hierarchy definition (CT_CacheHierarchy).
///
/// Describes a single hierarchy in an OLAP-based pivot cache.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotCacheHierarchy {
    /// Unique name of the hierarchy.
    pub unique_name: String,
    /// Display caption.
    pub caption: Option<String>,
    /// Whether this is a measure hierarchy. Default: `false`.
    pub measure: bool,
    /// Whether this is a named set. Default: `false`.
    pub set: bool,
    /// Index of the parent set.
    pub parent_set: Option<u32>,
    /// Icon set index.
    pub icon_set: Option<i32>,
    /// Whether this is an attribute hierarchy. Default: `false`.
    pub attribute: bool,
    /// Whether this is a time-based hierarchy. Default: `false`.
    pub time: bool,
    /// Whether this is a key attribute. Default: `false`.
    pub key_attribute: bool,
    /// Default member unique name.
    pub default_member_unique_name: Option<String>,
    /// "All" member unique name.
    pub all_unique_name: Option<String>,
    /// Caption for the "All" member.
    pub all_caption: Option<String>,
    /// Unique name of the parent dimension.
    pub dimension_unique_name: Option<String>,
    /// Display folder path.
    pub display_folder: Option<String>,
    /// Measure group name.
    pub measure_group: Option<String>,
    /// Whether this hierarchy has measures. Default: `false`.
    pub measures: bool,
    /// Number of items in this hierarchy.
    pub count: u32,
    /// Whether this hierarchy references a single field. Default: `false`.
    pub one_field: bool,
    /// Data type for member values.
    pub member_value_datatype: Option<u16>,
    /// Whether the hierarchy is unbalanced.
    pub unbalanced: Option<bool>,
    /// Whether the hierarchy has an unbalanced group.
    pub unbalanced_group: Option<bool>,
    /// Whether this hierarchy is hidden. Default: `false`.
    pub hidden: bool,
    /// Fields usage for this hierarchy (`<fieldsUsage>`, CT_FieldsUsage).
    pub fields_usage: Option<PivotFieldsUsage>,
    /// Group levels for this hierarchy (`<groupLevels>`, CT_GroupLevels).
    pub group_levels: Option<PivotGroupLevels>,
}

impl Default for PivotCacheHierarchy {
    fn default() -> Self {
        Self {
            unique_name: String::new(),
            caption: None,
            measure: false,
            set: false,
            parent_set: None,
            icon_set: Some(0),
            attribute: false,
            time: false,
            key_attribute: false,
            default_member_unique_name: None,
            all_unique_name: None,
            all_caption: None,
            dimension_unique_name: None,
            display_folder: None,
            measure_group: None,
            measures: false,
            count: 0,
            one_field: false,
            member_value_datatype: None,
            unbalanced: None,
            unbalanced_group: None,
            hidden: false,
            fields_usage: None,
            group_levels: None,
        }
    }
}

// ============================================================================
// PivotCacheHierarchies — CT_CacheHierarchies
// ============================================================================

/// Collection of OLAP cache hierarchy definitions (CT_CacheHierarchies).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotCacheHierarchies {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The hierarchy definitions.
    pub items: Vec<PivotCacheHierarchy>,
}

// ============================================================================
// PivotFieldGroup — CT_FieldGroup
// ============================================================================

/// Field grouping definition (CT_FieldGroup).
///
/// Defines how a cache field is grouped, including parent/base field indices
/// and group ranges or discrete mappings.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotFieldGroup {
    /// Index of the parent (grouped) field.
    pub par: Option<u32>,
    /// Index of the base (source) field.
    pub base: Option<u32>,
    /// Range grouping properties.
    pub range_pr: Option<PivotRangePr>,
    /// Discrete grouping mappings.
    pub discrete_pr: Option<PivotDiscretePr>,
    /// Group item values.
    pub group_items: Option<PivotGroupItems>,
}

// ============================================================================
// PivotRangePr — CT_RangePr
// ============================================================================

/// Range grouping properties (CT_RangePr).
///
/// Defines numeric or date range grouping parameters for a field group.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotRangePr {
    /// Whether to auto-start. Default: `true`.
    pub auto_start: bool,
    /// Whether to auto-end. Default: `true`.
    pub auto_end: bool,
    /// Grouping by type (e.g. "range", "seconds", "minutes", "hours", "days", "months", "quarters", "years").
    pub group_by: Option<String>,
    /// Start value for the range.
    pub start_num: Option<f64>,
    /// End value for the range.
    pub end_num: Option<f64>,
    /// Start date (ISO 8601).
    pub start_date: Option<String>,
    /// End date (ISO 8601).
    pub end_date: Option<String>,
    /// Grouping interval value.
    pub group_interval: Option<f64>,
}

impl Default for PivotRangePr {
    fn default() -> Self {
        Self {
            auto_start: true,
            auto_end: true,
            group_by: Some("range".to_string()),
            start_num: None,
            end_num: None,
            start_date: None,
            end_date: None,
            group_interval: Some(1.0),
        }
    }
}

// ============================================================================
// PivotGroupItems — CT_GroupItems
// ============================================================================

/// Group item values (CT_GroupItems).
///
/// Contains the display values for grouped items as a mixed list of
/// missing/number/boolean/error/string/date-time values.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotGroupItems {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// Mixed item values (m/n/b/e/s/d) — unified enum representation.
    pub items: Vec<SharedItem>,
    /// Missing value elements (`<m>`). XSD: CT_Missing, choice element.
    #[serde(rename = "m")]
    pub m: Vec<PivotMissing>,
    /// Numeric value elements (`<n>`). XSD: CT_Number, choice element.
    #[serde(rename = "n")]
    pub n: Vec<PivotNumber>,
    /// Boolean value elements (`<b>`). XSD: CT_Boolean, choice element.
    #[serde(rename = "b")]
    pub b: Vec<PivotBoolean>,
    /// Error value elements (`<e>`). XSD: CT_Error, choice element.
    #[serde(rename = "e")]
    pub e: Vec<PivotError>,
    /// String value elements (`<s>`). XSD: CT_String, choice element.
    #[serde(rename = "s")]
    pub s: Vec<PivotCacheString>,
    /// Date-time value elements (`<d>`). XSD: CT_DateTime, choice element.
    #[serde(rename = "d")]
    pub d: Vec<PivotDateTime>,
}

// ============================================================================
// PivotGroupLevel — CT_GroupLevel
// ============================================================================

/// Group level definition (CT_GroupLevel).
///
/// Defines a level within a group hierarchy for OLAP pivot caches.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotGroupLevel {
    /// Unique name for this group level.
    pub unique_name: String,
    /// Display caption.
    pub caption: String,
    /// Whether to show a user-defined caption. Default: `false`.
    pub user: bool,
    /// Whether to include a custom roll-up. Default: `false`.
    pub custom_roll_up: bool,
    /// Groups within this level.
    pub groups: Option<PivotGroups>,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

// ============================================================================
// PivotGroupLevels — CT_GroupLevels
// ============================================================================

/// Collection of group level definitions (CT_GroupLevels).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotGroupLevels {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The group level definitions.
    pub items: Vec<PivotGroupLevel>,
    /// Group level elements (`<groupLevel>`). XSD: CT_GroupLevel, 1..unbounded. // XSD: required
    #[serde(rename = "groupLevel")]
    pub group_level: Vec<PivotGroupLevel>,
}

// ============================================================================
// PivotGroupMember — CT_GroupMember
// ============================================================================

/// Group member definition (CT_GroupMember).
///
/// Identifies a member within a level group.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotGroupMember {
    /// Unique name of the member.
    pub unique_name: String,
    /// Whether this member is part of a group. Default: `false`.
    pub group: bool,
}

// ============================================================================
// PivotGroupMembers — CT_GroupMembers
// ============================================================================

/// Collection of group member definitions (CT_GroupMembers).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotGroupMembers {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The group members.
    pub items: Vec<PivotGroupMember>,
    /// Group member elements (`<groupMember>`). XSD: CT_GroupMember, 1..unbounded. // XSD: required
    #[serde(rename = "groupMember")]
    pub group_member: Vec<PivotGroupMember>,
}

// ============================================================================
// PivotLevelGroup — CT_LevelGroup
// ============================================================================

/// A single group within a group level (CT_LevelGroup).
///
/// Contains a name, unique name, and a set of group members.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotLevelGroup {
    /// Display name of the group.
    pub name: String,
    /// Unique name of the group.
    pub unique_name: String,
    /// Caption for the group.
    pub caption: String,
    /// Unique name of the parent group.
    pub unique_parent: Option<String>,
    /// Group ID.
    pub id: Option<i32>,
    /// Group members.
    pub group_members: PivotGroupMembers,
}

// ============================================================================
// PivotGroups — CT_Groups
// ============================================================================

/// Collection of level groups (CT_Groups).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotGroups {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The level groups.
    pub items: Vec<PivotLevelGroup>,
    /// Group elements (`<group>`). XSD: CT_LevelGroup, 1..unbounded. // XSD: required
    #[serde(rename = "group")]
    pub group: Vec<PivotLevelGroup>,
}

// ============================================================================
// PivotFieldsUsage — CT_FieldsUsage
// ============================================================================

/// Field usage reference (CT_FieldUsage).
///
/// References a field by index within a hierarchy usage context.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotFieldUsage {
    /// Index of the field. Default: `-1` (indicating no field).
    pub x: i32,
}

impl Default for PivotFieldUsage {
    fn default() -> Self {
        Self { x: -1 }
    }
}

/// Collection of field usage references (CT_FieldsUsage).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotFieldsUsage {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The field usage references.
    pub items: Vec<PivotFieldUsage>,
}

// ============================================================================
// PivotDeletedField — CT_DeletedField
// ============================================================================

/// Deleted field reference (CT_DeletedField).
///
/// Records the name of a field that was removed from the pivot cache.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotDeletedField {
    /// Name of the deleted field.
    pub name: String,
}

// ============================================================================
// PivotCacheDefinition — CT_PivotCacheDefinition
// ============================================================================

/// Pivot cache definition root element (CT_PivotCacheDefinition, §18.10.1.67).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotCacheDefinition {
    pub r_id: Option<String>,
    pub invalid: bool,
    pub save_data: bool,
    pub refresh_on_load: bool,
    pub optimize_memory: bool,
    pub enable_refresh: bool,
    pub refreshed_by: Option<String>,
    pub refreshed_date_iso: Option<String>,
    pub background_query: bool,
    pub missing_items_limit: Option<u32>,
    pub created_version: u8,
    pub refreshed_version: u8,
    pub min_refreshable_version: u8,
    pub record_count: Option<u32>,
    pub upgrade_on_refresh: bool,
    pub tuple_cache_attr: bool,
    pub support_subquery: bool,
    pub support_advanced_drill: bool,
    pub cache_source: PivotCacheSource,
    pub cache_fields: PivotCacheFields,
    pub cache_hierarchies: Option<PivotCacheHierarchies>,
    pub kpis: Option<PivotKPIs>,
    pub tuple_cache: Option<TupleCache>,
    pub calculated_items: Option<PivotCalculatedItems>,
    pub calculated_members: Option<PivotCalculatedMembers>,
    pub dimensions: Option<PivotDimensions>,
    pub measure_groups: Option<MeasureGroups>,
    pub maps: Option<MeasureDimensionMaps>,
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for PivotCacheDefinition {
    fn default() -> Self {
        Self {
            r_id: None,
            invalid: false,
            save_data: true,
            refresh_on_load: false,
            optimize_memory: false,
            enable_refresh: true,
            refreshed_by: None,
            refreshed_date_iso: None,
            background_query: false,
            missing_items_limit: None,
            created_version: 0,
            refreshed_version: 0,
            min_refreshable_version: 0,
            record_count: None,
            upgrade_on_refresh: false,
            tuple_cache_attr: false,
            support_subquery: false,
            support_advanced_drill: false,
            cache_source: PivotCacheSource::default(),
            cache_fields: PivotCacheFields::default(),
            cache_hierarchies: None,
            kpis: None,
            tuple_cache: None,
            calculated_items: None,
            calculated_members: None,
            dimensions: None,
            measure_groups: None,
            maps: None,
            ext_lst: None,
        }
    }
}

// ============================================================================
// PivotCacheRecords — CT_PivotCacheRecords
// ============================================================================

/// Pivot cache records root element (CT_PivotCacheRecords, §18.10.1.68).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotCacheRecords {
    pub count: Option<u32>,
    pub records: Vec<PivotRecord>,
    pub ext_lst: Option<crate::ExtensionList>,
}

// ============================================================================
// PivotRecord — CT_Record
// ============================================================================

/// A single pivot cache record (CT_Record, §18.10.1.70).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotRecord {
    pub values: Vec<PivotRecordValue>,
}

// ============================================================================
// PivotRecordValue — choice group within CT_Record
// ============================================================================

/// A single value within a pivot cache record.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum PivotRecordValue {
    Missing,
    Number(f64),
    Boolean(bool),
    Error(String),
    String(String),
    DateTime(String),
    Index(u32),
}

// ============================================================================
// OLAP types — CT_MeasureDimensionMaps, CT_MeasureGroups, CT_PCDKPI
// ============================================================================

/// KPI definitions for OLAP pivot caches (CT_PCDKPIs, §18.10.1.50).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotKPIs {
    pub count: Option<u32>,
    pub kpis: Vec<PivotKPI>,
}

/// A single KPI definition (CT_PCDKPI, §18.10.1.49).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotKPI {
    pub unique_name: String,
    pub caption: Option<String>,
    pub display_folder: Option<String>,
    pub measure_group: Option<String>,
    pub parent: Option<String>,
    pub value: String,
    pub goal: Option<String>,
    pub status: Option<String>,
    pub trend: Option<String>,
    pub weight: Option<String>,
    pub time: Option<String>,
}

/// Measure groups in OLAP pivot caches (CT_MeasureGroups, §18.10.1.52).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct MeasureGroups {
    pub count: Option<u32>,
    pub groups: Vec<MeasureGroup>,
}

/// A single measure group (CT_MeasureGroup, §18.10.1.51).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct MeasureGroup {
    pub name: String,
    pub caption: String,
}

/// Maps between measure groups and dimensions (CT_MeasureDimensionMaps, §18.10.1.54).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct MeasureDimensionMaps {
    pub count: Option<u32>,
    pub maps: Vec<MeasureDimensionMap>,
}

/// A single measure-to-dimension mapping (CT_MeasureDimensionMap, §18.10.1.53).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct MeasureDimensionMap {
    pub measure_group: Option<u32>,
    pub dimension: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pivot_cache_source_default() {
        let src = PivotCacheSource::default();
        assert_eq!(src.r#type, PivotSourceType::Worksheet);
        assert_eq!(src.connection_id, Some(0));
        assert!(src.worksheet_source.is_none());
        assert!(src.consolidation.is_none());
        assert!(src.ext_lst.is_none());
    }

    #[test]
    fn pivot_cache_field_default() {
        let f = PivotCacheField::default();
        assert!(f.name.is_empty());
        assert!(f.caption.is_none());
        assert!(f.num_fmt_id.is_none());
        assert!(f.formula.is_none());
        assert_eq!(f.sql_type, Some(0));
        assert_eq!(f.hierarchy, Some(0));
        assert_eq!(f.level, Some(0));
        assert!(f.database_field);
        assert_eq!(f.unique_list, Some(true));
        assert!(!f.member_property_field);
        assert!(!f.server_field);
        assert!(f.shared_items.is_none());
        assert!(f.field_group.is_none());
        assert!(f.ext_lst.is_none());
    }

    #[test]
    fn pivot_cache_hierarchy_default() {
        let h = PivotCacheHierarchy::default();
        assert!(h.unique_name.is_empty());
        assert!(h.caption.is_none());
        assert!(!h.measure);
        assert!(!h.set);
        assert!(h.parent_set.is_none());
        assert_eq!(h.icon_set, Some(0));
        assert!(!h.attribute);
        assert!(!h.time);
        assert!(!h.key_attribute);
        assert!(h.default_member_unique_name.is_none());
        assert!(h.all_unique_name.is_none());
        assert!(h.all_caption.is_none());
        assert!(h.dimension_unique_name.is_none());
        assert!(h.display_folder.is_none());
        assert!(h.measure_group.is_none());
        assert!(!h.measures);
        assert_eq!(h.count, 0);
        assert!(!h.one_field);
        assert!(h.member_value_datatype.is_none());
        assert!(h.unbalanced.is_none());
        assert!(h.unbalanced_group.is_none());
        assert!(!h.hidden);
    }

    #[test]
    fn shared_items_default() {
        let si = SharedItems::default();
        assert!(si.contains_semi_mixed_types);
        assert!(si.contains_non_date);
        assert!(!si.contains_date);
        assert!(si.contains_string);
        assert!(!si.contains_blank);
        assert!(!si.contains_mixed_types);
        assert!(!si.contains_number);
        assert!(!si.contains_integer);
        assert!(si.min_value.is_none());
        assert!(si.max_value.is_none());
        assert!(si.min_date.is_none());
        assert!(si.max_date.is_none());
        assert!(si.count.is_none());
        assert!(!si.long_text);
        assert!(si.items.is_empty());
        assert!(si.m.is_empty());
        assert!(si.n.is_empty());
        assert!(si.b.is_empty());
        assert!(si.e.is_empty());
        assert!(si.s.is_empty());
        assert!(si.d.is_empty());
    }

    #[test]
    fn cache_wrapper_types_default() {
        let cf = PivotCacheFields::default();
        assert!(cf.count.is_none());
        assert!(cf.items.is_empty());

        let ch = PivotCacheHierarchies::default();
        assert!(ch.count.is_none());
        assert!(ch.items.is_empty());

        let gl = PivotGroupLevels::default();
        assert!(gl.count.is_none());
        assert!(gl.items.is_empty());

        let gm = PivotGroupMembers::default();
        assert!(gm.count.is_none());
        assert!(gm.items.is_empty());

        let g = PivotGroups::default();
        assert!(g.count.is_none());
        assert!(g.items.is_empty());

        let fu = PivotFieldsUsage::default();
        assert!(fu.count.is_none());
        assert!(fu.items.is_empty());

        let gi = PivotGroupItems::default();
        assert!(gi.count.is_none());
        assert!(gi.items.is_empty());
        assert!(gi.m.is_empty());
        assert!(gi.n.is_empty());
        assert!(gi.b.is_empty());
        assert!(gi.e.is_empty());
        assert!(gi.s.is_empty());
        assert!(gi.d.is_empty());
    }

    #[test]
    fn pivot_consolidation_default() {
        let c = PivotConsolidation::default();
        assert!(c.auto_page);
        assert!(c.pages.is_empty());
        assert!(c.range_sets.is_empty());
    }

    #[test]
    fn pivot_field_group_default() {
        let fg = PivotFieldGroup::default();
        assert!(fg.par.is_none());
        assert!(fg.base.is_none());
        assert!(fg.range_pr.is_none());
        assert!(fg.discrete_pr.is_none());
        assert!(fg.group_items.is_none());
    }

    #[test]
    fn pivot_deleted_field_default() {
        let df = PivotDeletedField::default();
        assert!(df.name.is_empty());
    }
}
