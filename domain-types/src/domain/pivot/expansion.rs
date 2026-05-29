//! Pivot expansion state types.
//!
//! Consolidated from `pivot-types/src/expansion.rs`.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::{BTreeSet, HashMap, HashSet};
use value_types::CellValue;

use super::placement::PlacementId;

/// Axis whose members are expanded or collapsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PivotExpansionAxis {
    /// Row axis.
    Row,
    /// Column axis.
    Column,
}

/// Persistent expansion key.
///
/// Legacy expansion state uses renderer-generated strings. This shape pins UI
/// expansion to a placement identity plus typed member path, making it stable
/// across label formatting changes and delimiter collisions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotExpansionKey {
    /// Axis that owns this expansion key.
    pub axis: PivotExpansionAxis,
    /// Placement whose member is expanded.
    pub placement_id: PlacementId,
    /// Typed member path from the outermost axis member to this member.
    pub member_path: Vec<CellValue>,
}

/// Tracks which headers are expanded/collapsed in the pivot table UI.
///
/// Uses `HashSet<String>` internally: presence in the set means expanded.
/// This is more natural than `HashMap<String, bool>` where the bool is always true.
///
/// # Serde Compatibility
///
/// Deserializes from BOTH formats for backward compatibility:
/// - New format: `{"expandedRows": ["key1", "key2"]}` (array/set)
/// - Legacy format: `{"expandedRows": {"key1": true, "key2": true}}` (object with bools)
///
/// Always serializes as the new array format.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PivotExpansionState {
    /// Set of expanded row header keys. Presence = expanded.
    pub expanded_rows: HashSet<String>,
    /// Set of expanded column header keys. Presence = expanded.
    pub expanded_columns: HashSet<String>,
    /// Persistent expanded row keys.
    pub expanded_row_keys: Vec<PivotExpansionKey>,
    /// Persistent expanded column keys.
    pub expanded_column_keys: Vec<PivotExpansionKey>,
}

// Custom Serialize: always write as HashSet (array)
impl Serialize for PivotExpansionState {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("PivotExpansionState", 4)?;
        state.serialize_field("expandedRows", &sorted_set(&self.expanded_rows))?;
        state.serialize_field("expandedColumns", &sorted_set(&self.expanded_columns))?;
        if !self.expanded_row_keys.is_empty() {
            state.serialize_field("expandedRowKeys", &self.expanded_row_keys)?;
        }
        if !self.expanded_column_keys.is_empty() {
            state.serialize_field("expandedColumnKeys", &self.expanded_column_keys)?;
        }
        state.end()
    }
}

fn sorted_set(set: &HashSet<String>) -> BTreeSet<&str> {
    set.iter().map(String::as_str).collect()
}

// Custom Deserialize: accept both HashSet (array) and HashMap<String, bool> (legacy)
impl<'de> Deserialize<'de> for PivotExpansionState {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        /// Helper that deserializes from either a set/array or a map with bool values.
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum SetOrMap {
            Set(HashSet<String>),
            Map(HashMap<String, bool>),
        }

        impl SetOrMap {
            fn into_set(self) -> HashSet<String> {
                match self {
                    SetOrMap::Set(s) => s,
                    SetOrMap::Map(m) => m.into_iter().filter(|(_, v)| *v).map(|(k, _)| k).collect(),
                }
            }
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Helper {
            #[serde(default)]
            expanded_rows: Option<SetOrMap>,
            #[serde(default)]
            expanded_columns: Option<SetOrMap>,
            #[serde(default)]
            expanded_row_keys: Option<Vec<PivotExpansionKey>>,
            #[serde(default)]
            expanded_column_keys: Option<Vec<PivotExpansionKey>>,
        }

        let helper = Helper::deserialize(deserializer)?;
        Ok(PivotExpansionState {
            expanded_rows: helper
                .expanded_rows
                .map(SetOrMap::into_set)
                .unwrap_or_default(),
            expanded_columns: helper
                .expanded_columns
                .map(SetOrMap::into_set)
                .unwrap_or_default(),
            expanded_row_keys: helper.expanded_row_keys.unwrap_or_default(),
            expanded_column_keys: helper.expanded_column_keys.unwrap_or_default(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expansion_state_accepts_legacy_and_persistent_keys() {
        let json = serde_json::json!({
            "expandedRows": {"East\u{0}Widget": true, "West": false},
            "expandedColumns": ["2025"],
            "expandedRowKeys": [{
                "axis": "row",
                "placementId": "row-region",
                "memberPath": ["East"]
            }]
        });

        let state: PivotExpansionState = serde_json::from_value(json).expect("expansion state");

        assert!(state.expanded_rows.contains("East\u{0}Widget"));
        assert!(!state.expanded_rows.contains("West"));
        assert!(state.expanded_columns.contains("2025"));
        assert_eq!(state.expanded_row_keys.len(), 1);
        assert_eq!(
            state.expanded_row_keys[0].placement_id.as_str(),
            "row-region"
        );
    }

    #[test]
    fn expansion_state_serializes_legacy_sets_in_stable_order() {
        let mut state = PivotExpansionState::default();
        state.expanded_rows.insert("1\x01T:vendor".to_string());
        state.expanded_rows.insert("0\x01T:addback".to_string());
        state.expanded_columns.insert("2025".to_string());
        state.expanded_columns.insert("2024".to_string());

        let json = serde_json::to_value(&state).expect("expansion state json");

        assert_eq!(
            json["expandedRows"],
            serde_json::json!(["0\u{1}T:addback", "1\u{1}T:vendor"])
        );
        assert_eq!(json["expandedColumns"], serde_json::json!(["2024", "2025"]));
    }
}
