//! Sheet metadata domain types.
//!
//! Canonical types for all sheet metadata sub-concerns. These were previously
//! duplicated in `compute-core::domain_types::sheets` — that module is now deleted
//! and all imports point here.

use serde::{Deserialize, Serialize};

use super::protection::SheetProtection;

// ── Frozen Panes ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenPanes {
    pub rows: u32,
    pub cols: u32,
}

// ── Scroll Position ───────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetScrollPosition {
    pub top_row: u32,
    pub left_col: u32,
}

// ── View Options ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetViewOptions {
    pub show_gridlines: bool,
    pub show_row_headers: bool,
    pub show_column_headers: bool,
    pub right_to_left: bool,
    pub show_formulas: bool,
    pub show_zeros: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_scale: Option<u32>,
}

// ── Print Range ───────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRange {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

// ── Print Titles ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintTitles {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_rows: Option<(u32, u32)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_cols: Option<(u32, u32)>,
}

// ── Split View ────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SplitDirection {
    Horizontal,
    Vertical,
    Both,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitViewConfig {
    pub direction: SplitDirection,
    pub horizontal_position: u32,
    pub vertical_position: u32,
}

// ── Sheet Protection Options (runtime view) ───────────────────────
// Positive semantics: each field means "user CAN do this".
// Contrast with ooxml-types where flags mean "PROHIBIT this".

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetProtectionOptions {
    #[serde(default = "default_true")]
    pub select_locked_cells: bool,
    #[serde(default = "default_true")]
    pub select_unlocked_cells: bool,
    #[serde(default)]
    pub insert_rows: bool,
    #[serde(default)]
    pub insert_columns: bool,
    #[serde(default)]
    pub insert_hyperlinks: bool,
    #[serde(default)]
    pub delete_rows: bool,
    #[serde(default)]
    pub delete_columns: bool,
    #[serde(default)]
    pub format_cells: bool,
    #[serde(default)]
    pub format_columns: bool,
    #[serde(default)]
    pub format_rows: bool,
    #[serde(default)]
    pub sort: bool,
    #[serde(default)]
    pub use_auto_filter: bool,
    #[serde(default)]
    pub use_pivot_table_reports: bool,
    #[serde(default)]
    pub edit_objects: bool,
    #[serde(default)]
    pub edit_scenarios: bool,
}

fn default_true() -> bool {
    true
}

impl Default for SheetProtectionOptions {
    fn default() -> Self {
        Self {
            select_locked_cells: true,
            select_unlocked_cells: true,
            insert_rows: false,
            insert_columns: false,
            insert_hyperlinks: false,
            delete_rows: false,
            delete_columns: false,
            format_cells: false,
            format_columns: false,
            format_rows: false,
            sort: false,
            use_auto_filter: false,
            use_pivot_table_reports: false,
            edit_objects: false,
            edit_scenarios: false,
        }
    }
}

/// Convert from the full CRDT-stored SheetProtection to the runtime permission view.
/// Maps domain-types field names to SheetProtectionOptions field names.
impl From<&SheetProtection> for SheetProtectionOptions {
    fn from(p: &SheetProtection) -> Self {
        Self {
            select_locked_cells: p.select_locked,
            select_unlocked_cells: p.select_unlocked,
            insert_rows: p.insert_rows,
            insert_columns: p.insert_columns,
            insert_hyperlinks: p.insert_hyperlinks,
            delete_rows: p.delete_rows,
            delete_columns: p.delete_columns,
            format_cells: p.format_cells,
            format_columns: p.format_columns,
            format_rows: p.format_rows,
            sort: p.sort,
            use_auto_filter: p.auto_filter,
            use_pivot_table_reports: p.pivot_tables,
            edit_objects: p.objects,
            edit_scenarios: p.scenarios,
        }
    }
}

// ── Sheet Settings (composite) ────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetSettings {
    pub show_gridlines: bool,
    pub show_row_headers: bool,
    pub show_column_headers: bool,
    pub is_protected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protection_password_hash: Option<String>,
    pub show_zero_values: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gridline_color: Option<String>,
    pub right_to_left: bool,
    pub show_formulas: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_scale: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protection_options: Option<SheetProtectionOptions>,
    pub default_row_height: f64,
    pub default_col_width: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_properties: Option<String>,
}

impl Default for SheetSettings {
    fn default() -> Self {
        Self {
            show_gridlines: true,
            show_row_headers: true,
            show_column_headers: true,
            is_protected: false,
            protection_password_hash: None,
            show_zero_values: true,
            gridline_color: None,
            right_to_left: false,
            show_formulas: false,
            zoom_scale: None,
            protection_options: None,
            default_row_height: 20.0,
            default_col_width: 64.0,
            custom_properties: None,
        }
    }
}

// ── Sheet Meta (bridge query result) ──────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetMeta {
    pub id: String,
    pub name: String,
    pub default_row_height: f64,
    pub default_col_width: f64,
    pub frozen_rows: u32,
    pub frozen_cols: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_color: Option<String>,
    pub hidden: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_round_trip_frozen_panes() {
        let v = FrozenPanes { rows: 2, cols: 3 };
        let json = serde_json::to_string(&v).unwrap();
        let v2: FrozenPanes = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_round_trip_scroll_position() {
        let v = SheetScrollPosition {
            top_row: 10,
            left_col: 5,
        };
        let json = serde_json::to_string(&v).unwrap();
        let v2: SheetScrollPosition = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_round_trip_view_options() {
        let v = SheetViewOptions {
            show_gridlines: false,
            show_row_headers: true,
            show_column_headers: false,
            right_to_left: true,
            show_formulas: true,
            show_zeros: false,
            zoom_scale: Some(150),
        };
        let json = serde_json::to_string(&v).unwrap();
        let v2: SheetViewOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_round_trip_print_range() {
        let v = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 99,
            end_col: 25,
        };
        let json = serde_json::to_string(&v).unwrap();
        let v2: PrintRange = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_round_trip_print_titles() {
        let v = PrintTitles {
            repeat_rows: Some((0, 2)),
            repeat_cols: None,
        };
        let json = serde_json::to_string(&v).unwrap();
        let v2: PrintTitles = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_round_trip_split_view_config() {
        let v = SplitViewConfig {
            direction: SplitDirection::Both,
            horizontal_position: 5,
            vertical_position: 3,
        };
        let json = serde_json::to_string(&v).unwrap();
        let v2: SplitViewConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_round_trip_split_direction() {
        for dir in [
            SplitDirection::Horizontal,
            SplitDirection::Vertical,
            SplitDirection::Both,
        ] {
            let json = serde_json::to_string(&dir).unwrap();
            let dir2: SplitDirection = serde_json::from_str(&json).unwrap();
            assert_eq!(dir, dir2);
        }
    }

    #[test]
    fn serde_round_trip_protection_options() {
        let v = SheetProtectionOptions {
            select_locked_cells: true,
            select_unlocked_cells: true,
            insert_rows: true,
            insert_columns: false,
            insert_hyperlinks: true,
            delete_rows: false,
            delete_columns: true,
            format_cells: true,
            format_columns: false,
            format_rows: true,
            sort: false,
            use_auto_filter: true,
            use_pivot_table_reports: false,
            edit_objects: true,
            edit_scenarios: false,
        };
        let json = serde_json::to_string(&v).unwrap();
        let v2: SheetProtectionOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_round_trip_sheet_settings() {
        let v = SheetSettings::default();
        let json = serde_json::to_string(&v).unwrap();
        let v2: SheetSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn serde_round_trip_sheet_meta() {
        let v = SheetMeta {
            id: "abc123".to_string(),
            name: "Sheet1".to_string(),
            default_row_height: 20.0,
            default_col_width: 64.0,
            frozen_rows: 1,
            frozen_cols: 2,
            tab_color: Some("#FF0000".to_string()),
            hidden: false,
        };
        let json = serde_json::to_string(&v).unwrap();
        let v2: SheetMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn from_sheet_protection_to_options() {
        let prot = SheetProtection {
            is_protected: true,
            password_hash: Some("hash".to_string()),
            hash_value: Some("modern_hash".to_string()),
            algorithm_name: Some("SHA-512".to_string()),
            salt_value: Some("salt".to_string()),
            spin_count: Some(100000),
            select_locked: true,
            select_unlocked: false,
            format_cells: true,
            format_columns: false,
            format_rows: true,
            insert_columns: false,
            insert_rows: true,
            insert_hyperlinks: true,
            delete_columns: false,
            delete_rows: true,
            sort: true,
            auto_filter: false,
            pivot_tables: true,
            objects: false,
            scenarios: true,
        };
        let opts = SheetProtectionOptions::from(&prot);
        assert_eq!(opts.select_locked_cells, true);
        assert_eq!(opts.select_unlocked_cells, false);
        assert_eq!(opts.format_cells, true);
        assert_eq!(opts.format_columns, false);
        assert_eq!(opts.format_rows, true);
        assert_eq!(opts.insert_columns, false);
        assert_eq!(opts.insert_rows, true);
        assert_eq!(opts.insert_hyperlinks, true);
        assert_eq!(opts.delete_columns, false);
        assert_eq!(opts.delete_rows, true);
        assert_eq!(opts.sort, true);
        assert_eq!(opts.use_auto_filter, false);
        assert_eq!(opts.use_pivot_table_reports, true);
        assert_eq!(opts.edit_objects, false);
        assert_eq!(opts.edit_scenarios, true);
    }
}
