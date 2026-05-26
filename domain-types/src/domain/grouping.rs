//! Grouping (outline) domain types.
//!
//! Canonical shared types for row/column grouping. These are the single source
//! of truth — imported by both the XLSX I/O layer and the compute-core runtime.
//! Pure data contracts — no Yrs, no storage internals.

use serde::{Deserialize, Serialize};

use crate::domain::outline::OutlineGroup;

// ── Group axis ─────────────────────────────────────────────────────

/// Group axis: row or column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GroupAxis {
    /// Row groups.
    Row,
    /// Column groups.
    Column,
}

// ── Subtotal function ──────────────────────────────────────────────

/// Subtotal aggregate function types.
/// Maps to SUBTOTAL function codes in Excel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubtotalFunction {
    /// Sum of values.
    Sum,
    /// Count of values.
    Count,
    /// Average of values.
    Average,
    /// Maximum value.
    Max,
    /// Minimum value.
    Min,
    /// Product of values.
    Product,
    /// Count of numeric values.
    CountNums,
    /// Standard deviation (sample).
    StdDev,
    /// Standard deviation (population).
    StdDevP,
    /// Variance (sample).
    Var,
    /// Variance (population).
    VarP,
}

impl SubtotalFunction {
    /// SUBTOTAL function code that includes hidden values.
    pub fn visible_code(self) -> u32 {
        match self {
            Self::Average => 1,
            Self::Count => 2,
            Self::CountNums => 3,
            Self::Max => 4,
            Self::Min => 5,
            Self::Product => 6,
            Self::StdDev => 7,
            Self::StdDevP => 8,
            Self::Sum => 9,
            Self::Var => 10,
            Self::VarP => 11,
        }
    }

    /// SUBTOTAL function code that ignores hidden values (101+).
    pub fn hidden_code(self) -> u32 {
        self.visible_code() + 100
    }

    /// Display name for the function.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Sum => "Sum",
            Self::Count => "Count",
            Self::Average => "Average",
            Self::Max => "Max",
            Self::Min => "Min",
            Self::Product => "Product",
            Self::CountNums => "Count Numbers",
            Self::StdDev => "StdDev",
            Self::StdDevP => "StdDevP",
            Self::Var => "Var",
            Self::VarP => "VarP",
        }
    }
}

// ── Group definition ───────────────────────────────────────────────

/// A row or column group definition (runtime model).
/// Groups can be nested up to 8 levels deep (matching Excel).
///
/// In the Rust port we use position-based `start`/`end` directly.
/// The TS RowId/ColId identity model is a CRDT layer concern handled by Yjs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDefinition {
    /// Unique group identifier.
    pub id: String,
    /// Sheet containing the group (hex string of SheetId).
    pub sheet_id: String,
    /// Group axis (row or column).
    pub axis: GroupAxis,
    /// Start index (inclusive, 0-indexed).
    pub start: u32,
    /// End index (inclusive, 0-indexed).
    pub end: u32,
    /// Outline level (1-8, where 1 is outermost).
    pub level: u32,
    /// Whether this group is currently collapsed.
    pub collapsed: bool,
    /// Parent group ID for nested groups (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// OOXML round-trip: whether the row/col was hidden by this group.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    /// OOXML round-trip: collapsed attribute was on a group member, not end+1.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub collapsed_on_member: bool,
}

// ── Per-sheet config ───────────────────────────────────────────────

/// Per-sheet grouping configuration (source of truth in Y.Map).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetGroupingConfig {
    /// All row groups in this sheet.
    pub row_groups: Vec<GroupDefinition>,
    /// All column groups in this sheet.
    pub column_groups: Vec<GroupDefinition>,
    /// Whether summary rows appear below detail rows (default: true).
    pub summary_rows_below: bool,
    /// Whether summary columns appear to the right of detail (default: true).
    pub summary_columns_right: bool,
    /// Whether outline symbols (+/-) are visible in the gutter (default: true).
    pub show_outline_symbols: bool,
    /// Whether outline level buttons (1,2,3...) are visible (default: true).
    pub show_outline_level_buttons: bool,
}

impl Default for SheetGroupingConfig {
    fn default() -> Self {
        Self {
            row_groups: Vec::new(),
            column_groups: Vec::new(),
            summary_rows_below: true,
            summary_columns_right: true,
            show_outline_symbols: true,
            show_outline_level_buttons: true,
        }
    }
}

// ── Computed outline state ─────────────────────────────────────────

/// Computed outline level for a single row or column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineLevel {
    /// Row or column index.
    pub index: u32,
    /// Current outline level.
    pub level: u32,
    /// Whether visible.
    pub visible: bool,
    /// Whether this is a summary row/column.
    pub is_summary: bool,
    /// IDs of groups containing this row/column.
    pub group_ids: Vec<String>,
}

// ── Outline settings update ────────────────────────────────────────

/// Partial update for outline display settings.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineSettingsUpdate {
    /// Update summary rows below setting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary_rows_below: Option<bool>,
    /// Update summary columns right setting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary_columns_right: Option<bool>,
    /// Update show outline symbols setting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_outline_symbols: Option<bool>,
    /// Update show outline level buttons setting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_outline_level_buttons: Option<bool>,
}

// ── Subtotal types ─────────────────────────────────────────────────

/// Options for the Subtotals feature.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtotalOptions {
    /// Column index to group by.
    pub group_by_column: u32,
    /// Column indices to calculate subtotals for.
    pub subtotal_columns: Vec<u32>,
    /// Subtotal function to use.
    pub function: SubtotalFunction,
    /// Whether the first row in the target range is a header row.
    #[serde(default)]
    pub has_headers: bool,
    /// Whether to replace existing subtotals.
    #[serde(default = "default_true")]
    pub replace_existing: bool,
    /// Whether summary rows appear below data.
    #[serde(default = "default_true")]
    pub summary_below_data: bool,
}

/// Result of creating subtotals.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtotalResult {
    /// Number of groups created.
    pub groups_created: u32,
    /// Number of subtotal rows inserted.
    pub subtotal_rows_inserted: u32,
    /// Range affected by the subtotal operation.
    pub affected_range: cell_types::SheetRange,
}

// ── OutlineGroup <-> GroupDefinition conversions ──────────────────

/// Convert parsed XLSX outline groups + outline properties into a runtime SheetGroupingConfig.
///
/// This is the import transform: enriches flat OOXML `OutlineGroup`s with IDs,
/// sheet context, axis enum, and parent relationships.
pub fn outline_groups_to_grouping_config(
    groups: &[OutlineGroup],
    sheet_id: &str,
    outline_pr: Option<&ooxml_types::worksheet::OutlineProperties>,
) -> SheetGroupingConfig {
    let mut row_groups = Vec::new();
    let mut col_groups = Vec::new();

    // Split by axis and convert
    for (counter, g) in (0_u32..).zip(groups.iter()) {
        let axis = if g.is_row {
            GroupAxis::Row
        } else {
            GroupAxis::Column
        };
        let id = format!("group-{counter}");
        let def = GroupDefinition {
            id,
            sheet_id: sheet_id.to_string(),
            axis,
            start: g.start,
            end: g.end,
            level: g.level,
            collapsed: g.collapsed,
            parent_id: None, // computed below
            hidden: g.hidden,
            collapsed_on_member: g.collapsed_on_member,
        };
        if g.is_row {
            row_groups.push(def);
        } else {
            col_groups.push(def);
        }
    }

    // Compute parent_id for each axis
    compute_parent_ids(&mut row_groups);
    compute_parent_ids(&mut col_groups);

    let (summary_rows_below, summary_columns_right, show_outline_symbols) = match outline_pr {
        Some(pr) => (pr.summary_below, pr.summary_right, pr.show_outline_symbols),
        None => (true, true, true),
    };

    SheetGroupingConfig {
        row_groups,
        column_groups: col_groups,
        summary_rows_below,
        summary_columns_right,
        show_outline_symbols,
        show_outline_level_buttons: true, // no OOXML source, runtime-only
    }
}

/// Compute parent_id for a sorted list of groups on one axis.
/// A group's parent is the innermost enclosing group at level - 1.
fn compute_parent_ids(groups: &mut [GroupDefinition]) {
    // Sort by start, then reverse end (wider first), then level
    groups.sort_by(|a, b| {
        a.start
            .cmp(&b.start)
            .then(b.end.cmp(&a.end))
            .then(a.level.cmp(&b.level))
    });

    // For each group, find innermost enclosing group at level-1
    let ids_and_ranges: Vec<(String, u32, u32, u32)> = groups
        .iter()
        .map(|g| (g.id.clone(), g.start, g.end, g.level))
        .collect();

    for group in groups.iter_mut() {
        let (start, end, level) = (group.start, group.end, group.level);
        if level <= 1 {
            continue;
        }
        // Find innermost enclosing group at level - 1
        let mut best_parent: Option<&str> = None;
        let mut best_span = u32::MAX;
        for (id, ps, pe, pl) in &ids_and_ranges {
            if *pl == level - 1 && *ps <= start && *pe >= end {
                let span = pe - ps;
                if span < best_span {
                    best_span = span;
                    best_parent = Some(id.as_str());
                }
            }
        }
        group.parent_id = best_parent.map(str::to_string);
    }
}

/// Convert a runtime SheetGroupingConfig back to XLSX outline groups + outline properties.
///
/// This is the export transform: reverses the import enrichment.
pub fn grouping_config_to_outline_groups(
    config: &SheetGroupingConfig,
) -> (Vec<OutlineGroup>, ooxml_types::worksheet::OutlineProperties) {
    let mut groups = Vec::new();

    for g in &config.row_groups {
        groups.push(OutlineGroup {
            is_row: true,
            start: g.start,
            end: g.end,
            level: g.level,
            collapsed: g.collapsed,
            hidden: g.hidden,
            collapsed_on_member: g.collapsed_on_member,
        });
    }

    for g in &config.column_groups {
        groups.push(OutlineGroup {
            is_row: false,
            start: g.start,
            end: g.end,
            level: g.level,
            collapsed: g.collapsed,
            hidden: g.hidden,
            collapsed_on_member: g.collapsed_on_member,
        });
    }

    let outline_pr = ooxml_types::worksheet::OutlineProperties {
        apply_styles: false,
        summary_below: config.summary_rows_below,
        summary_right: config.summary_columns_right,
        show_outline_symbols: config.show_outline_symbols,
    };

    (groups, outline_pr)
}

/// Serde helper for `true` default values.
fn default_true() -> bool {
    true
}
