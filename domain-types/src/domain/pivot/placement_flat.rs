//! Pivot field placement types (flat serde form).
//!
//! Consolidated from `pivot-types/src/placement_flat.rs`.

use serde::{Deserialize, Serialize};

use super::field::FieldId;
use super::placement::{
    AxisPlacement, FilterPlacement, PivotFieldPlacement, PivotValueSource, PlacementBase,
    PlacementId, ValuePlacement,
};
use super::show_values_as::{ShowValuesAsConfig, SortByValueConfig};
use crate::domain::analytics::{AggregateFunction, DateGrouping, NumberGrouping, SortDirection};
use value_types::CellValue;

/// Areas where a field can be placed.
///
/// Used by [`PivotFieldPlacementFlat`] for serde compatibility and by internal
/// area-matching logic.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PivotFieldArea {
    /// Row axis (left side of pivot table)
    Row,
    /// Column axis (top of pivot table)
    Column,
    /// Values area (aggregated data cells)
    Value,
    /// Filter area (page filter / slicer)
    Filter,
}

/// Legacy flat representation for serde compatibility with TypeScript contracts.
///
/// This struct preserves the original flat JSON format where all fields are optional
/// and the `area` field determines which options are meaningful. Use
/// `PivotFieldPlacement::from(flat)` to convert to the type-safe representation.
///
/// # When to use
///
/// - At the serde boundary (deserializing from TypeScript JSON)
/// - When serializing back to TypeScript
///
/// # When NOT to use
///
/// - Internal engine logic — use [`PivotFieldPlacement`] instead
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotFieldPlacementFlat {
    /// Stable identity for this placement slot.
    #[serde(default)]
    pub placement_id: PlacementId,
    /// The field being placed.
    pub field_id: FieldId,
    /// Calculated field backing a value placement.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calculated_field_id: Option<super::config::CalculatedFieldId>,
    /// Which area this field is placed in.
    pub area: PivotFieldArea,
    /// Position within the area.
    pub position: usize,
    /// Aggregate function (only meaningful for Value area).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregate_function: Option<AggregateFunction>,
    /// Sort direction (only meaningful for Row/Column area).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<SortDirection>,
    /// Custom sort order (only meaningful for Row/Column area).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_sort_list: Option<Vec<CellValue>>,
    /// Sort by value config (only meaningful for Row/Column area).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_by_value: Option<SortByValueConfig>,
    /// Date grouping (only meaningful for Row/Column area).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_grouping: Option<DateGrouping>,
    /// Number grouping (only meaningful for Row/Column area).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_grouping: Option<NumberGrouping>,
    /// Show subtotals (only meaningful for Row/Column area).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_subtotals: Option<bool>,
    /// Display name override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Number format (only meaningful for Value area).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    /// Show values as config (only meaningful for Value area).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_values_as: Option<ShowValuesAsConfig>,
}

impl PivotFieldPlacementFlat {
    /// Get the field ID for this placement.
    #[must_use]
    pub fn field_id(&self) -> &FieldId {
        &self.field_id
    }

    /// Get the stable placement ID for this placement.
    #[must_use]
    pub fn placement_id(&self) -> &super::placement::PlacementId {
        &self.placement_id
    }

    /// Get the source field ID when this placement is field-backed.
    #[must_use]
    pub fn source_field_id(&self) -> Option<&FieldId> {
        if self.area == PivotFieldArea::Value && self.calculated_field_id.is_some() {
            None
        } else {
            Some(&self.field_id)
        }
    }

    /// Get the position within this placement's area.
    #[must_use]
    pub fn position(&self) -> usize {
        self.position
    }

    /// Get the display name, if set.
    #[must_use]
    pub fn display_name(&self) -> Option<&str> {
        self.display_name.as_deref()
    }

    /// Returns `true` if this placement is on the row axis.
    #[must_use]
    pub fn is_row(&self) -> bool {
        self.area == PivotFieldArea::Row
    }

    /// Returns `true` if this placement is on the column axis.
    #[must_use]
    pub fn is_column(&self) -> bool {
        self.area == PivotFieldArea::Column
    }

    /// Returns `true` if this placement is in the values area.
    #[must_use]
    pub fn is_value(&self) -> bool {
        self.area == PivotFieldArea::Value
    }

    /// Returns `true` if this placement is in the filter area.
    #[must_use]
    pub fn is_filter(&self) -> bool {
        self.area == PivotFieldArea::Filter
    }
}

impl From<PivotFieldPlacementFlat> for PivotFieldPlacement {
    fn from(flat: PivotFieldPlacementFlat) -> Self {
        let field_id = flat.field_id;
        let source = match flat.calculated_field_id {
            Some(calculated_field_id) => PivotValueSource::CalculatedField {
                calculated_field_id,
            },
            None => PivotValueSource::Field {
                field_id: field_id.clone(),
            },
        };

        match flat.area {
            PivotFieldArea::Row => PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: field_id.clone(),
                    placement_id: flat.placement_id,
                    position: flat.position,
                    display_name: flat.display_name,
                },
                sort_order: flat.sort_order,
                custom_sort_list: flat.custom_sort_list,
                sort_by_value: flat.sort_by_value,
                date_grouping: flat.date_grouping,
                number_grouping: flat.number_grouping,
                show_subtotals: flat.show_subtotals,
            }),
            PivotFieldArea::Column => PivotFieldPlacement::Column(AxisPlacement {
                base: PlacementBase {
                    field_id: field_id.clone(),
                    placement_id: flat.placement_id,
                    position: flat.position,
                    display_name: flat.display_name,
                },
                sort_order: flat.sort_order,
                custom_sort_list: flat.custom_sort_list,
                sort_by_value: flat.sort_by_value,
                date_grouping: flat.date_grouping,
                number_grouping: flat.number_grouping,
                show_subtotals: flat.show_subtotals,
            }),
            PivotFieldArea::Value => PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: field_id.clone(),
                    placement_id: flat.placement_id,
                    position: flat.position,
                    display_name: flat.display_name,
                },
                source,
                aggregate_function: flat.aggregate_function.unwrap_or(AggregateFunction::Sum),
                number_format: flat.number_format,
                show_values_as: flat.show_values_as,
            }),
            PivotFieldArea::Filter => PivotFieldPlacement::Filter(FilterPlacement {
                base: PlacementBase {
                    field_id,
                    placement_id: flat.placement_id,
                    position: flat.position,
                    display_name: flat.display_name,
                },
            }),
        }
    }
}

impl From<PivotFieldPlacement> for PivotFieldPlacementFlat {
    fn from(typed: PivotFieldPlacement) -> Self {
        match typed {
            PivotFieldPlacement::Row(p) => PivotFieldPlacementFlat {
                placement_id: p.base.placement_id,
                field_id: p.base.field_id,
                calculated_field_id: None,
                area: PivotFieldArea::Row,
                position: p.base.position,
                aggregate_function: None,
                sort_order: p.sort_order,
                custom_sort_list: p.custom_sort_list,
                sort_by_value: p.sort_by_value,
                date_grouping: p.date_grouping,
                number_grouping: p.number_grouping,
                show_subtotals: p.show_subtotals,
                display_name: p.base.display_name,
                number_format: None,
                show_values_as: None,
            },
            PivotFieldPlacement::Column(p) => PivotFieldPlacementFlat {
                placement_id: p.base.placement_id,
                field_id: p.base.field_id,
                calculated_field_id: None,
                area: PivotFieldArea::Column,
                position: p.base.position,
                aggregate_function: None,
                sort_order: p.sort_order,
                custom_sort_list: p.custom_sort_list,
                sort_by_value: p.sort_by_value,
                date_grouping: p.date_grouping,
                number_grouping: p.number_grouping,
                show_subtotals: p.show_subtotals,
                display_name: p.base.display_name,
                number_format: None,
                show_values_as: None,
            },
            PivotFieldPlacement::Value(p) => {
                let field_id = p
                    .field_id()
                    .cloned()
                    .unwrap_or_else(|| p.base.field_id.clone());
                PivotFieldPlacementFlat {
                    placement_id: p.base.placement_id,
                    field_id,
                    calculated_field_id: p.source.calculated_field_id().cloned(),
                    area: PivotFieldArea::Value,
                    position: p.base.position,
                    aggregate_function: Some(p.aggregate_function),
                    sort_order: None,
                    custom_sort_list: None,
                    sort_by_value: None,
                    date_grouping: None,
                    number_grouping: None,
                    show_subtotals: None,
                    display_name: p.base.display_name,
                    number_format: p.number_format,
                    show_values_as: p.show_values_as,
                }
            }
            PivotFieldPlacement::Filter(p) => PivotFieldPlacementFlat {
                placement_id: p.base.placement_id,
                field_id: p.base.field_id,
                calculated_field_id: None,
                area: PivotFieldArea::Filter,
                position: p.base.position,
                aggregate_function: None,
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: None,
                display_name: p.base.display_name,
                number_format: None,
                show_values_as: None,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_value_placement_preserves_legacy_field_source() {
        let flat = PivotFieldPlacementFlat {
            placement_id: PlacementId::from("value-sales"),
            field_id: FieldId::from("sales"),
            calculated_field_id: None,
            area: PivotFieldArea::Value,
            position: 0,
            aggregate_function: Some(AggregateFunction::Sum),
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
            display_name: Some("Sales".to_string()),
            number_format: Some("$#,##0".to_string()),
            show_values_as: None,
        };

        let typed = PivotFieldPlacement::from(flat);
        let value = typed.as_value().expect("value placement");

        assert_eq!(typed.placement_id().as_str(), "value-sales");
        assert_eq!(value.field_id().map(FieldId::as_str), Some("sales"));
        assert_eq!(value.aggregate_function, AggregateFunction::Sum);
    }

    #[test]
    fn flat_value_placement_supports_calculated_field_source() {
        let flat = PivotFieldPlacementFlat {
            placement_id: PlacementId::from("value-margin"),
            field_id: FieldId::default(),
            calculated_field_id: Some(super::super::config::CalculatedFieldId::from("margin")),
            area: PivotFieldArea::Value,
            position: 1,
            aggregate_function: Some(AggregateFunction::Sum),
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
            display_name: None,
            number_format: None,
            show_values_as: None,
        };

        let typed = PivotFieldPlacement::from(flat);
        let value = typed.as_value().expect("value placement");

        assert_eq!(typed.source_field_id(), None);
        assert_eq!(
            value.source.calculated_field_id().map(|id| id.as_str()),
            Some("margin")
        );
    }
}
