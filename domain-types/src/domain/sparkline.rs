//! Unified sparkline type hierarchy.
//!
//! These types are the single source of truth for sparkline data across:
//! - XLSX parser output (file-io)
//! - CRDT storage (yrs_schema serialization)
//! - Compute engine (compute-core runtime)
//!
//! Design decisions:
//! - Typed enums replace strings (SparklineType, AxisBound, EmptyCellDisplay)
//! - Decomposed numeric references replace A1 strings (SparklineCellAddress, SparklineDataRange)
//! - Sub-structs group related fields (SparklineVisualSettings, SparklineAxisSettings)
//! - SparklineGroup preserved as first-class type (XLSX sparklines are inherently grouped)

use serde::{Deserialize, Serialize};

// ============================================================================
// Enums
// ============================================================================

/// The type of sparkline chart.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum SparklineType {
    #[default]
    Line,
    Column,
    WinLoss,
}

/// How to display empty cells in sparkline data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum EmptyCellDisplay {
    #[default]
    Gaps,
    Zero,
    Connect,
}

/// Axis bound label variants.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AxisBoundLabel {
    Auto,
    Same,
}

/// Axis bound: auto, same (shared across group), or a numeric value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AxisBound {
    Label(AxisBoundLabel),
    Value(f64),
}

impl Default for AxisBound {
    fn default() -> Self {
        Self::Label(AxisBoundLabel::Auto)
    }
}

// ============================================================================
// Component structs
// ============================================================================

/// Cell address for sparkline placement (sheet + row + col).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineCellAddress {
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
}

/// Data range for sparkline data source (start/end row/col, 0-based inclusive).
/// Defined here so domain-types has no dependency on compute-core's cell-types crate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineDataRange {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

/// Visual settings for a sparkline.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineVisualSettings {
    #[serde(default)]
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negative_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_negative_points: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_markers: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marker_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_high_point: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub high_point_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_low_point: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub low_point_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_first_point: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_point_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_last_point: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_point_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_weight: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_gap: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bar_gap: Option<f64>,
}

/// Axis settings for a sparkline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct SparklineAxisSettings {
    #[serde(default)]
    pub min_value: AxisBound,
    #[serde(default)]
    pub max_value: AxisBound,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_axis: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis_color: Option<String>,
    #[serde(default)]
    pub display_empty_cells: EmptyCellDisplay,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_to_left: Option<bool>,
}

// ============================================================================
// Main types
// ============================================================================

/// A sparkline definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sparkline {
    pub id: String,
    pub sheet_id: String,
    pub cell: SparklineCellAddress,
    pub data_range: SparklineDataRange,
    #[serde(rename = "type")]
    pub sparkline_type: SparklineType,
    #[serde(default)]
    pub data_in_rows: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(default)]
    pub visual: SparklineVisualSettings,
    #[serde(default)]
    pub axis: SparklineAxisSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

/// A sparkline group definition.
/// XLSX sparklines are inherently grouped — visual/axis settings are shared at group level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineGroup {
    pub id: String,
    pub sheet_id: String,
    pub sparkline_ids: Vec<String>,
    #[serde(rename = "type")]
    pub sparkline_type: SparklineType,
    #[serde(default)]
    pub visual: SparklineVisualSettings,
    #[serde(default)]
    pub axis: SparklineAxisSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

/// Partial update payload for sparklines.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell: Option<SparklineCellAddress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_range: Option<SparklineDataRange>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    pub sparkline_type: Option<SparklineType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_in_rows: Option<bool>,
    /// `Some(None)` = clear group, `Some(Some(id))` = set group, `None` = no change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visual: Option<SparklineVisualSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis: Option<SparklineAxisSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

impl Sparkline {
    /// Apply a partial update, overwriting only the fields that are `Some`.
    pub fn apply_update(&mut self, update: &SparklineUpdate) {
        if let Some(cell) = &update.cell {
            self.cell = cell.clone();
        }
        if let Some(data_range) = &update.data_range {
            self.data_range = data_range.clone();
        }
        if let Some(sparkline_type) = &update.sparkline_type {
            self.sparkline_type = sparkline_type.clone();
        }
        if let Some(data_in_rows) = update.data_in_rows {
            self.data_in_rows = data_in_rows;
        }
        if let Some(group_id) = &update.group_id {
            self.group_id = group_id.clone();
        }
        if let Some(visual) = &update.visual {
            self.visual = visual.clone();
        }
        if let Some(axis) = &update.axis {
            self.axis = axis.clone();
        }
        if let Some(updated_at) = update.updated_at {
            self.updated_at = Some(updated_at);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_sparkline() -> Sparkline {
        Sparkline {
            id: "spark-1".to_string(),
            sheet_id: "sheet-abc".to_string(),
            cell: SparklineCellAddress {
                sheet_id: "sheet-abc".to_string(),
                row: 0,
                col: 1,
            },
            data_range: SparklineDataRange {
                start_row: 0,
                start_col: 0,
                end_row: 9,
                end_col: 0,
            },
            sparkline_type: SparklineType::Line,
            data_in_rows: false,
            group_id: Some("group-1".to_string()),
            visual: SparklineVisualSettings {
                color: "#376092".to_string(),
                negative_color: Some("#D00000".to_string()),
                show_negative_points: Some(true),
                show_markers: Some(true),
                marker_color: None,
                show_high_point: Some(true),
                high_point_color: Some("#00B050".to_string()),
                show_low_point: Some(true),
                low_point_color: Some("#FF0000".to_string()),
                show_first_point: None,
                first_point_color: None,
                show_last_point: None,
                last_point_color: None,
                line_weight: Some(0.75),
                column_gap: None,
                bar_gap: None,
            },
            axis: SparklineAxisSettings {
                min_value: AxisBound::Label(AxisBoundLabel::Auto),
                max_value: AxisBound::Value(100.0),
                show_axis: Some(true),
                axis_color: Some("#000000".to_string()),
                display_empty_cells: EmptyCellDisplay::Gaps,
                right_to_left: None,
            },
            created_at: Some(1700000000),
            updated_at: None,
        }
    }

    #[test]
    fn test_sparkline_serde_roundtrip() {
        let spark = sample_sparkline();
        let json = serde_json::to_string(&spark).unwrap();
        let deserialized: Sparkline = serde_json::from_str(&json).unwrap();
        assert_eq!(spark, deserialized);
    }

    #[test]
    fn test_sparkline_json_has_type_key() {
        let spark = sample_sparkline();
        let value: serde_json::Value = serde_json::to_value(&spark).unwrap();
        assert_eq!(value["type"], "line");
        assert!(value.get("sparklineType").is_none()); // renamed to "type"
    }

    #[test]
    fn test_sparkline_group_serde_roundtrip() {
        let group = SparklineGroup {
            id: "group-1".to_string(),
            sheet_id: "sheet-abc".to_string(),
            sparkline_ids: vec!["spark-1".to_string(), "spark-2".to_string()],
            sparkline_type: SparklineType::Column,
            visual: SparklineVisualSettings::default(),
            axis: SparklineAxisSettings::default(),
            created_at: None,
            updated_at: None,
        };
        let json = serde_json::to_string(&group).unwrap();
        let deserialized: SparklineGroup = serde_json::from_str(&json).unwrap();
        assert_eq!(group, deserialized);
    }

    #[test]
    fn test_sparkline_update_apply() {
        let mut spark = sample_sparkline();
        let update = SparklineUpdate {
            sparkline_type: Some(SparklineType::Column),
            data_in_rows: Some(true),
            group_id: Some(None), // clear group
            updated_at: Some(1700000001),
            ..Default::default()
        };
        spark.apply_update(&update);
        assert_eq!(spark.sparkline_type, SparklineType::Column);
        assert!(spark.data_in_rows);
        assert_eq!(spark.group_id, None);
        assert_eq!(spark.updated_at, Some(1700000001));
        // Unchanged fields
        assert_eq!(spark.id, "spark-1");
        assert_eq!(spark.visual.color, "#376092");
    }

    #[test]
    fn test_axis_bound_serde() {
        // Label variant
        let auto = AxisBound::Label(AxisBoundLabel::Auto);
        let json = serde_json::to_string(&auto).unwrap();
        assert_eq!(json, "\"auto\"");
        let deserialized: AxisBound = serde_json::from_str(&json).unwrap();
        assert_eq!(auto, deserialized);

        // Value variant
        let val = AxisBound::Value(42.5);
        let json = serde_json::to_string(&val).unwrap();
        assert_eq!(json, "42.5");
        let deserialized: AxisBound = serde_json::from_str(&json).unwrap();
        assert_eq!(val, deserialized);
    }

    #[test]
    fn test_sparkline_type_all_variants() {
        for (variant, expected) in [
            (SparklineType::Line, "\"line\""),
            (SparklineType::Column, "\"column\""),
            (SparklineType::WinLoss, "\"winLoss\""),
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, expected);
            let deserialized: SparklineType = serde_json::from_str(&json).unwrap();
            assert_eq!(variant, deserialized);
        }
    }

    #[test]
    fn test_empty_cell_display_all_variants() {
        for (variant, expected) in [
            (EmptyCellDisplay::Gaps, "\"gaps\""),
            (EmptyCellDisplay::Zero, "\"zero\""),
            (EmptyCellDisplay::Connect, "\"connect\""),
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, expected);
            let deserialized: EmptyCellDisplay = serde_json::from_str(&json).unwrap();
            assert_eq!(variant, deserialized);
        }
    }

    #[test]
    fn test_optional_fields_skipped_when_none() {
        let spark = Sparkline {
            id: "s1".to_string(),
            sheet_id: "sh1".to_string(),
            cell: SparklineCellAddress {
                sheet_id: "sh1".to_string(),
                row: 0,
                col: 0,
            },
            data_range: SparklineDataRange {
                start_row: 0,
                start_col: 0,
                end_row: 0,
                end_col: 0,
            },
            sparkline_type: SparklineType::Line,
            data_in_rows: false,
            group_id: None,
            visual: SparklineVisualSettings::default(),
            axis: SparklineAxisSettings::default(),
            created_at: None,
            updated_at: None,
        };
        let value: serde_json::Value = serde_json::to_value(&spark).unwrap();
        assert!(value.get("groupId").is_none());
        assert!(value.get("createdAt").is_none());
        assert!(value.get("updatedAt").is_none());
    }
}
