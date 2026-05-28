//! Pivot field and item types (ECMA-376 §18.10 — pivot table fields).
//!
//! Covers `<pivotFields>`, row/column/page field references, data fields,
//! hierarchies, and sort types used in pivot table definitions.

use super::enums::{DataConsolidateFunction, ShowDataAs};
use super::layout::PivotArea;

// ============================================================================
// FieldSortType — ST_FieldSortType
// ============================================================================

/// Field sort type for pivot fields (ST_FieldSortType, §18.18.28).
///
/// Specifies how items in a pivot field are sorted.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum FieldSortType {
    /// Manual sort order (default).
    #[default]
    #[xml("manual")]
    Manual,
    /// Ascending sort.
    #[xml("ascending")]
    Ascending,
    /// Descending sort.
    #[xml("descending")]
    Descending,
}

// ============================================================================
// ItemType — ST_ItemType
// ============================================================================

/// Pivot item type (ST_ItemType, §18.18.43).
///
/// Specifies the type of a pivot table item (data value, subtotal function, etc.).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum ItemType {
    /// Data item (default).
    #[default]
    #[xml("data")]
    Data,
    /// Default subtotal.
    #[xml("default")]
    Default,
    /// Sum subtotal.
    #[xml("sum")]
    Sum,
    /// CountA subtotal.
    #[xml("countA")]
    CountA,
    /// Average subtotal.
    #[xml("avg")]
    Avg,
    /// Max subtotal.
    #[xml("max")]
    Max,
    /// Min subtotal.
    #[xml("min")]
    Min,
    /// Product subtotal.
    #[xml("product")]
    Product,
    /// Count subtotal.
    #[xml("count")]
    Count,
    /// Standard deviation subtotal (sample).
    #[xml("stdDev")]
    StdDev,
    /// Standard deviation subtotal (population).
    #[xml("stdDevP")]
    StdDevP,
    /// Variance subtotal (sample).
    #[xml("var")]
    Var,
    /// Variance subtotal (population).
    #[xml("varP")]
    VarP,
    /// Grand total.
    #[xml("grand")]
    Grand,
    /// Blank item.
    #[xml("blank")]
    Blank,
}

// ============================================================================
// PivotDataField — CT_DataField
// ============================================================================

/// Data field definition in a pivot table (CT_DataField).
///
/// Specifies a field from the pivot cache to be used as a data (values) field
/// with an aggregation function.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotDataField {
    /// Display name for this data field.
    pub name: Option<String>,
    /// Index of the source field in the pivot cache.
    pub fld: u32,
    /// Aggregation function. Default: `Sum`.
    pub subtotal: DataConsolidateFunction,
    /// How to display the calculated values.
    pub show_data_as: ShowDataAs,
    /// Base field index for show-data-as calculations.
    pub base_field: i32,
    /// Base item index for show-data-as calculations.
    pub base_item: u32,
    /// Number format ID.
    pub num_fmt_id: Option<u32>,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for PivotDataField {
    fn default() -> Self {
        Self {
            name: None,
            fld: 0,
            subtotal: DataConsolidateFunction::Sum,
            show_data_as: ShowDataAs::Normal,
            base_field: -1,
            base_item: 1_048_832,
            num_fmt_id: None,
            ext_lst: None,
        }
    }
}

// ============================================================================
// PivotDataFields — CT_DataFields
// ============================================================================

/// Collection of data field definitions (CT_DataFields).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotDataFields {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The data field definitions.
    pub items: Vec<PivotDataField>,
    /// Data field elements (`<dataField>`). XSD: CT_DataField, 1..unbounded. // XSD: required
    #[serde(rename = "dataField")]
    pub data_field: Vec<PivotDataField>,
}

// ============================================================================
// PivotFieldReference — CT_Field
// ============================================================================

/// Simple field index reference (CT_Field).
///
/// Used within row fields, column fields, and page fields to reference a
/// pivot cache field by index.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotFieldReference {
    /// Zero-based index into the pivot cache fields.
    pub x: i32,
}

// ============================================================================
// PivotColFields — CT_ColFields
// ============================================================================

/// Collection of column field references (CT_ColFields).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotColFields {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The column field references.
    pub items: Vec<PivotFieldReference>,
    /// Field elements (`<field>`). XSD: CT_Field, 1..unbounded. // XSD: required
    #[serde(rename = "field")]
    pub field: Vec<PivotFieldReference>,
}

// ============================================================================
// PivotHierarchyUsage — CT_HierarchyUsage
// ============================================================================

/// Hierarchy usage reference (CT_HierarchyUsage).
///
/// References an OLAP hierarchy by index.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotHierarchyUsage {
    /// Index of the hierarchy.
    pub hierarchy_usage: i32,
}

impl Default for PivotHierarchyUsage {
    fn default() -> Self {
        Self {
            hierarchy_usage: -1,
        }
    }
}

// ============================================================================
// PivotColHierarchiesUsage — CT_ColHierarchiesUsage
// ============================================================================

/// Collection of column hierarchy usage references (CT_ColHierarchiesUsage).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotColHierarchiesUsage {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The column hierarchy usage references.
    pub items: Vec<PivotHierarchyUsage>,
    /// Column hierarchy usage elements (`<colHierarchyUsage>`). XSD: CT_HierarchyUsage, 1..unbounded. // XSD: required
    #[serde(rename = "colHierarchyUsage")]
    pub col_hierarchy_usage: Vec<PivotHierarchyUsage>,
}

// ============================================================================
// PivotDimension — CT_PivotDimension
// ============================================================================

/// Pivot dimension reference (CT_PivotDimension).
///
/// References an OLAP dimension for use in the pivot table.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotDimension {
    /// Whether this dimension provides a measure. Default: `false`.
    pub measure: bool,
    /// Unique name of the dimension.
    pub name: String,
    /// Unique name of the dimension.
    pub unique_name: String,
    /// Caption for the dimension.
    pub caption: String,
}

// ============================================================================
// PivotDimensions — CT_Dimensions
// ============================================================================

/// Collection of pivot dimension references (CT_Dimensions).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotDimensions {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The dimension references.
    pub items: Vec<PivotDimension>,
}

// ============================================================================
// PivotAutoSortScope — CT_AutoSortScope
// ============================================================================

/// Auto sort scope definition (CT_AutoSortScope).
///
/// Defines the pivot area used for auto-sort operations on a pivot field.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotAutoSortScope {
    /// Pivot area defining the sort scope.
    pub pivot_area: PivotArea,
}

// ============================================================================
// PivotFields — CT_PivotFields (placeholder)
// ============================================================================

/// Collection of pivot field definitions (CT_PivotFields, §18.10.1.70).
///
/// Wraps the `<pivotFields>` element. Individual `CT_PivotField` items are not
/// yet modelled; the inner XML is preserved as a raw string for round-tripping.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotFields {
    /// Number of items (informational).
    pub count: Option<u32>,
    /// Raw inner XML (placeholder until CT_PivotField is fully typed).
    pub raw: String,
}

// ============================================================================
// PivotRowFields — CT_RowFields
// ============================================================================

/// Collection of row field references (CT_RowFields, §18.10.1.81).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotRowFields {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The row field references.
    pub field: Vec<PivotFieldReference>,
}

// ============================================================================
// PivotPageField — CT_PageField (placeholder)
// ============================================================================

/// A single page field entry (CT_PageField, §18.10.1.64).
///
/// Placeholder — fields stored as raw string until fully typed.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotPageField {
    /// Field index. // XSD: required
    pub fld: Option<i32>,
    /// Raw inner XML (placeholder for remaining attributes).
    pub raw: String,
}

// ============================================================================
// PivotPageFields — CT_PageFields
// ============================================================================

/// Collection of page field definitions (CT_PageFields, §18.10.1.63).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotPageFields {
    /// Number of items (informational).
    pub count: Option<u32>,
    /// The page field definitions.
    pub items: Vec<PivotPageField>,
}

// ============================================================================
// PivotHierarchy — CT_PivotHierarchy (placeholder)
// ============================================================================

/// A single pivot hierarchy entry (CT_PivotHierarchy, §18.10.1.68).
///
/// Placeholder — stored as raw string until fully typed.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotHierarchy {
    /// Raw inner XML (placeholder).
    pub raw: String,
}

// ============================================================================
// PivotHierarchies — CT_PivotHierarchies
// ============================================================================

/// Collection of pivot hierarchy definitions (CT_PivotHierarchies, §18.10.1.67).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotHierarchies {
    /// Number of items (informational).
    pub count: Option<u32>,
    /// The pivot hierarchy definitions.
    pub items: Vec<PivotHierarchy>,
}

// ============================================================================
// PivotRowHierarchiesUsage — CT_RowHierarchiesUsage
// ============================================================================

/// Collection of row hierarchy usage references (CT_RowHierarchiesUsage, §18.10.1.80).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotRowHierarchiesUsage {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// Row hierarchy usage elements (`<rowHierarchyUsage>`).
    #[serde(rename = "rowHierarchyUsage")]
    pub row_hierarchy_usage: Vec<PivotHierarchyUsage>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pivot_data_field_default() {
        let df = PivotDataField::default();
        assert!(df.name.is_none());
        assert_eq!(df.fld, 0);
        assert_eq!(df.subtotal, DataConsolidateFunction::Sum);
        assert_eq!(df.show_data_as, ShowDataAs::Normal);
        assert_eq!(df.base_field, -1);
        assert_eq!(df.base_item, 1_048_832);
        assert!(df.num_fmt_id.is_none());
        assert!(df.ext_lst.is_none());
    }

    #[test]
    fn field_wrapper_types_default() {
        let df = PivotDataFields::default();
        assert!(df.count.is_none());
        assert!(df.items.is_empty());
        assert!(df.data_field.is_empty());

        let colfields = PivotColFields::default();
        assert!(colfields.count.is_none());
        assert!(colfields.items.is_empty());

        let chu = PivotColHierarchiesUsage::default();
        assert!(chu.count.is_none());
        assert!(chu.items.is_empty());
        assert!(chu.col_hierarchy_usage.is_empty());

        let pd = PivotDimensions::default();
        assert!(pd.count.is_none());
        assert!(pd.items.is_empty());
    }

    #[test]
    fn field_sort_type_roundtrip() {
        let variants = [
            (FieldSortType::Manual, "manual"),
            (FieldSortType::Ascending, "ascending"),
            (FieldSortType::Descending, "descending"),
        ];
        for (variant, s) in &variants {
            assert_eq!(FieldSortType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                FieldSortType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(FieldSortType::from_ooxml("bogus"), FieldSortType::Manual);
        assert_eq!(FieldSortType::default(), FieldSortType::Manual);
    }

    #[test]
    fn item_type_roundtrip() {
        let variants = [
            (ItemType::Data, "data"),
            (ItemType::Default, "default"),
            (ItemType::Sum, "sum"),
            (ItemType::CountA, "countA"),
            (ItemType::Avg, "avg"),
            (ItemType::Max, "max"),
            (ItemType::Min, "min"),
            (ItemType::Product, "product"),
            (ItemType::Count, "count"),
            (ItemType::StdDev, "stdDev"),
            (ItemType::StdDevP, "stdDevP"),
            (ItemType::Var, "var"),
            (ItemType::VarP, "varP"),
            (ItemType::Grand, "grand"),
            (ItemType::Blank, "blank"),
        ];
        for (variant, s) in &variants {
            assert_eq!(ItemType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                ItemType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(ItemType::from_ooxml("bogus"), ItemType::Data);
        assert_eq!(ItemType::default(), ItemType::Data);
    }
}
