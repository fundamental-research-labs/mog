//! Pivot field placement types (structured form).
//!
//! Consolidated from `pivot-types/src/placement.rs`.

use serde::{Deserialize, Serialize};
use std::fmt;

use super::field::FieldId;
use super::placement_flat::PivotFieldArea;
use super::show_values_as::{ShowValuesAsConfig, SortByValueConfig};
use crate::domain::analytics::{AggregateFunction, DateGrouping, NumberGrouping, SortDirection};
use value_types::CellValue;

/// Stable identifier for a placement within a pivot table.
///
/// This is distinct from [`FieldId`]: the same source field may appear in more
/// than one area or value slot, and each slot needs its own persistent identity
/// for UI state, formatting, and result metadata.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PlacementId(String);

impl PlacementId {
    /// Create a new `PlacementId`.
    #[must_use]
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }

    /// Return the inner string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::ops::Deref for PlacementId {
    type Target = str;

    fn deref(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PlacementId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl From<String> for PlacementId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for PlacementId {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

impl AsRef<str> for PlacementId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Common base fields shared by all placement types.
///
/// Every placement (axis, value, filter) has a source field ID where legacy
/// callers expect one, a stable placement ID, a position within its area, and
/// an optional display name. This struct extracts those shared fields to avoid
/// duplication across [`AxisPlacement`], [`ValuePlacement`], and [`FilterPlacement`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementBase {
    /// Legacy source field identity for field-backed placements.
    ///
    /// For calculated-field value placements this may be empty; use
    /// [`ValuePlacement::value_source`] for authoritative value source identity.
    pub field_id: FieldId,
    /// Stable identity for this placement slot.
    #[serde(default)]
    pub placement_id: PlacementId,
    /// Zero-based position within this area.
    pub position: usize,
    /// Optional custom display name (overrides the field's default name).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// Type-safe field placement — area-specific fields are only available in the correct variant.
///
/// This enum replaces the old flat `PivotFieldPlacement` struct that had 12 `Option` fields.
/// Each variant carries only the fields that are valid for that area:
///
/// - **Row/Column** ([`AxisPlacement`]): sort order, grouping, subtotals
/// - **Value** ([`ValuePlacement`]): aggregate function (required!), number format, show values as
/// - **Filter** ([`FilterPlacement`]): just identity (filtering is configured in `PivotFilter`)
///
/// # Serde
///
/// Serializes with `#[serde(tag = "area")]` for clean JSON:
/// ```json
/// {"area": "row", "fieldId": "region", "position": 0, "sortOrder": "asc"}
/// {"area": "value", "fieldId": "sales", "position": 0, "aggregateFunction": "sum"}
/// ```
///
/// For TypeScript compatibility, use `PivotFieldPlacementFlat` at the serde boundary
/// and convert with `From` implementations.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "area", rename_all = "lowercase")]
pub enum PivotFieldPlacement {
    /// Field placed on the row axis (left side of the pivot table).
    Row(AxisPlacement),
    /// Field placed on the column axis (top of the pivot table).
    Column(AxisPlacement),
    /// Field placed in the values area (aggregated data cells).
    Value(ValuePlacement),
    /// Field placed in the filter area (page filter / slicer).
    Filter(FilterPlacement),
}

/// Source of a value placement.
///
/// Legacy value placements are field-backed and serialize with `fieldId` at the
/// placement level. Calculated fields use `calculatedFieldId`; this lets the
/// values area contain measures that do not correspond to a source column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", untagged)]
pub enum PivotValueSource {
    /// A measure derived from aggregating a source field.
    Field {
        /// Source field to aggregate.
        field_id: FieldId,
    },
    /// A measure derived from a calculated field.
    CalculatedField {
        /// Calculated field to evaluate.
        calculated_field_id: super::config::CalculatedFieldId,
    },
}

impl PivotValueSource {
    /// Return the source field ID when this value is field-backed.
    #[must_use]
    pub fn field_id(&self) -> Option<&FieldId> {
        match self {
            PivotValueSource::Field { field_id } => Some(field_id),
            PivotValueSource::CalculatedField { .. } => None,
        }
    }

    /// Return the calculated field ID when this value is calculated-field-backed.
    #[must_use]
    pub fn calculated_field_id(&self) -> Option<&super::config::CalculatedFieldId> {
        match self {
            PivotValueSource::Field { .. } => None,
            PivotValueSource::CalculatedField {
                calculated_field_id,
            } => Some(calculated_field_id),
        }
    }
}

/// Placement configuration for a field on the row or column axis.
///
/// Row and column fields define the grouping structure of the pivot table.
/// They support sorting, date/number grouping, custom sort orders, and subtotals.
///
/// # Field-Specific Attributes
///
/// | Field | Purpose | Default |
/// |-------|---------|---------|
/// | `sort_order` | Sort direction for group labels | `None` (engine default: Asc) |
/// | `custom_sort_list` | Custom ordering for group labels | `None` (natural order) |
/// | `sort_by_value` | Sort by aggregated value instead of label | `None` (sort by label) |
/// | `date_grouping` | Group date values by year/quarter/month/etc. | `None` (no grouping) |
/// | `number_grouping` | Group numeric values into bins | `None` (no grouping) |
/// | `show_subtotals` | Show subtotal row/column for this level | `None` (engine default) |
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisPlacement {
    /// Common placement fields (field_id, position, display_name).
    #[serde(flatten)]
    pub base: PlacementBase,
    /// Sort direction for group labels. `None` means use engine default (Asc).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<SortDirection>,
    /// Custom sort order for group labels.
    ///
    /// Values are `CellValue` (not `String`) to support numeric and date custom orders.
    /// Items not in this list are sorted after listed items using the `sort_order` direction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_sort_list: Option<Vec<CellValue>>,
    /// Sort by a value field's aggregated values instead of labels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_by_value: Option<SortByValueConfig>,
    /// Group date values by the specified unit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_grouping: Option<DateGrouping>,
    /// Group numeric values into equal-width bins.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_grouping: Option<NumberGrouping>,
    /// Whether to show subtotals for this grouping level.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_subtotals: Option<bool>,
}

/// Placement configuration for a field in the values area.
///
/// Value fields define what is computed in each pivot table cell. Unlike axis
/// placements, `aggregate_function` is **required** — a value field without
/// an aggregation function is nonsensical.
///
/// # Field-Specific Attributes
///
/// | Field | Purpose | Default |
/// |-------|---------|---------|
/// | `aggregate_function` | How to aggregate values | **Required** (no default) |
/// | `number_format` | Display format string | `None` (use source format) |
/// | `show_values_as` | Post-aggregation transform | `None` (show raw values) |
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValuePlacement {
    /// Common placement fields (field_id, position, display_name).
    #[serde(flatten)]
    pub base: PlacementBase,
    /// Field or calculated field that supplies this value measure.
    pub source: PivotValueSource,
    /// Aggregation function to apply. **Required** — cannot be omitted.
    pub aggregate_function: AggregateFunction,
    /// Optional number format string (e.g., "#,##0.00", "0%").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    /// Optional "Show Values As" post-aggregation transform.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_values_as: Option<ShowValuesAsConfig>,
}

/// Placement configuration for a field in the filter area.
///
/// Filter placements simply register a field as available for page-level filtering.
/// The actual filter conditions are configured in `PivotFilter`, not here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterPlacement {
    /// Common placement fields (field_id, position, display_name).
    #[serde(flatten)]
    pub base: PlacementBase,
}

impl PivotFieldPlacement {
    /// Get the field ID for this placement, regardless of area.
    #[must_use]
    pub fn field_id(&self) -> &FieldId {
        match self {
            PivotFieldPlacement::Row(p) | PivotFieldPlacement::Column(p) => &p.base.field_id,
            PivotFieldPlacement::Value(p) => p.field_id().unwrap_or(&p.base.field_id),
            PivotFieldPlacement::Filter(p) => &p.base.field_id,
        }
    }

    /// Get the stable placement ID for this placement.
    #[must_use]
    pub fn placement_id(&self) -> &PlacementId {
        match self {
            PivotFieldPlacement::Row(p) | PivotFieldPlacement::Column(p) => &p.base.placement_id,
            PivotFieldPlacement::Value(p) => &p.base.placement_id,
            PivotFieldPlacement::Filter(p) => &p.base.placement_id,
        }
    }

    /// Get the source field ID if this placement is field-backed.
    #[must_use]
    pub fn source_field_id(&self) -> Option<&FieldId> {
        match self {
            PivotFieldPlacement::Row(p) | PivotFieldPlacement::Column(p) => Some(&p.base.field_id),
            PivotFieldPlacement::Value(p) => p.field_id(),
            PivotFieldPlacement::Filter(p) => Some(&p.base.field_id),
        }
    }

    /// Get the position within this area.
    #[must_use]
    pub fn position(&self) -> usize {
        match self {
            PivotFieldPlacement::Row(p) | PivotFieldPlacement::Column(p) => p.base.position,
            PivotFieldPlacement::Value(p) => p.base.position,
            PivotFieldPlacement::Filter(p) => p.base.position,
        }
    }

    /// Get the display name, if set.
    #[must_use]
    pub fn display_name(&self) -> Option<&str> {
        match self {
            PivotFieldPlacement::Row(p) | PivotFieldPlacement::Column(p) => {
                p.base.display_name.as_deref()
            }
            PivotFieldPlacement::Value(p) => p.base.display_name.as_deref(),
            PivotFieldPlacement::Filter(p) => p.base.display_name.as_deref(),
        }
    }

    /// Returns `true` if this placement is on the row axis.
    #[must_use]
    pub fn is_row(&self) -> bool {
        matches!(self, Self::Row(_))
    }

    /// Returns `true` if this placement is on the column axis.
    #[must_use]
    pub fn is_column(&self) -> bool {
        matches!(self, Self::Column(_))
    }

    /// Returns `true` if this placement is in the values area.
    #[must_use]
    pub fn is_value(&self) -> bool {
        matches!(self, Self::Value(_))
    }

    /// Returns `true` if this placement is in the filter area.
    #[must_use]
    pub fn is_filter(&self) -> bool {
        matches!(self, Self::Filter(_))
    }

    /// Get the inner `AxisPlacement` if this is a Row or Column placement.
    #[must_use]
    pub fn as_axis(&self) -> Option<&AxisPlacement> {
        match self {
            Self::Row(a) | Self::Column(a) => Some(a),
            _ => None,
        }
    }

    /// Get the inner `ValuePlacement` if this is a Value placement.
    #[must_use]
    pub fn as_value(&self) -> Option<&ValuePlacement> {
        match self {
            Self::Value(v) => Some(v),
            _ => None,
        }
    }

    /// Get a mutable reference to the base fields.
    pub fn base_mut(&mut self) -> &mut PlacementBase {
        match self {
            PivotFieldPlacement::Row(p) | PivotFieldPlacement::Column(p) => &mut p.base,
            PivotFieldPlacement::Value(p) => &mut p.base,
            PivotFieldPlacement::Filter(p) => &mut p.base,
        }
    }

    /// Move this placement to a different area, preserving the base fields.
    ///
    /// When moving to a Value area, defaults to [`AggregateFunction::Sum`] if no
    /// aggregate function was previously set. When moving from Value to an axis area,
    /// axis-specific fields (sort order, grouping, etc.) are reset to `None`.
    #[must_use]
    pub fn into_area(self, target: PivotFieldArea) -> Self {
        if self.area() == target {
            return self;
        }

        // Extract base and any existing aggregate function
        let (base, field_id, agg_fn, number_format, show_values_as_config) = match self {
            PivotFieldPlacement::Row(p) | PivotFieldPlacement::Column(p) => {
                let field_id = p.base.field_id.clone();
                (p.base, Some(field_id), None, None, None)
            }
            PivotFieldPlacement::Value(p) => {
                let field_id = p.field_id().cloned();
                (
                    p.base,
                    field_id,
                    Some(p.aggregate_function),
                    p.number_format,
                    p.show_values_as,
                )
            }
            PivotFieldPlacement::Filter(p) => {
                let field_id = p.base.field_id.clone();
                (p.base, Some(field_id), None, None, None)
            }
        };

        match target {
            PivotFieldArea::Row => PivotFieldPlacement::Row(AxisPlacement {
                base,
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: None,
            }),
            PivotFieldArea::Column => PivotFieldPlacement::Column(AxisPlacement {
                base,
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: None,
            }),
            PivotFieldArea::Value => PivotFieldPlacement::Value(ValuePlacement {
                base,
                source: PivotValueSource::Field {
                    field_id: field_id.unwrap_or_default(),
                },
                aggregate_function: agg_fn.unwrap_or(AggregateFunction::Sum),
                number_format,
                show_values_as: show_values_as_config,
            }),
            PivotFieldArea::Filter => PivotFieldPlacement::Filter(FilterPlacement { base }),
        }
    }

    /// Get the aggregate function (only set on Value placements).
    #[must_use]
    pub fn aggregate_function(&self) -> Option<AggregateFunction> {
        match self {
            Self::Value(v) => Some(v.aggregate_function),
            _ => None,
        }
    }

    /// Get the area of this placement.
    #[must_use]
    pub fn area(&self) -> PivotFieldArea {
        match self {
            Self::Row(_) => PivotFieldArea::Row,
            Self::Column(_) => PivotFieldArea::Column,
            Self::Value(_) => PivotFieldArea::Value,
            Self::Filter(_) => PivotFieldArea::Filter,
        }
    }
}

impl ValuePlacement {
    /// Return the source field ID for legacy callers when this value is field-backed.
    #[must_use]
    pub fn field_id(&self) -> Option<&FieldId> {
        match self.source.field_id() {
            Some(field_id) if !field_id.is_empty() => Some(field_id),
            _ if !self.base.field_id.is_empty() => Some(&self.base.field_id),
            _ => None,
        }
    }

    /// Return the source descriptor for this value placement.
    #[must_use]
    pub fn value_source(&self) -> &PivotValueSource {
        &self.source
    }
}
