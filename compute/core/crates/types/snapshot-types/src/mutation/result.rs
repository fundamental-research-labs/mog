use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::cell_grid::{
    CommentChange, DimensionChange, MergeChange, PropertyChange, SparklineChange, VisibilityChange,
};
use super::features::{
    CfChange, FilterChange, GroupingChange, NamedRangeChange, PivotTableChange, RangeChange,
    SlicerChange, SortingChange, StructureChangeResult, TableChange,
};
use super::floating_objects::FloatingObjectChange;
use super::policy_parse::{PolicyPreservedParseOutcome, PolicyPreservedParseSummary};
use super::primitives::SheetLifecycleRuntimeHint;
use super::sheet_workbook::{
    PageBreakChange, PrintAreaChange, PrintSettingsChange, PrintTitlesChange, ScrollPositionChange,
    SheetChange, SheetSettingsChange, SplitConfigChange, WorkbookSettingsChange,
};
use crate::recalc::RecalcResult;
use value_types::CellValue;

/// Result of a mutation command — contains recalc changes plus domain-specific changes.
/// Most domain change vectors will be empty for any given mutation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    /// Cell value changes from recalculation.
    pub recalc: RecalcResult,
    /// Property/format changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub property_changes: Vec<PropertyChange>,
    /// Row/column dimension changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dimension_changes: Vec<DimensionChange>,
    /// Merge region changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub merge_changes: Vec<MergeChange>,
    /// Row/column visibility changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub visibility_changes: Vec<VisibilityChange>,
    /// Comment changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comment_changes: Vec<CommentChange>,
    /// Filter changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filter_changes: Vec<FilterChange>,
    /// Table changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub table_changes: Vec<TableChange>,
    /// Slicer changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slicer_changes: Vec<SlicerChange>,
    /// Sheet metadata changes (name, tab color, etc.).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheet_changes: Vec<SheetChange>,
    /// Runtime/session sheet lifecycle reconciliation hint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_lifecycle_runtime_hint: Option<SheetLifecycleRuntimeHint>,
    /// Sheet settings changes (protection, view options, etc.).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub settings_changes: Vec<SheetSettingsChange>,
    /// Page-break configuration changes (full snapshot per sheet).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub page_break_changes: Vec<PageBreakChange>,
    /// Print-area changes (set/removed).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub print_area_changes: Vec<PrintAreaChange>,
    /// Print-titles changes (full snapshot per sheet).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub print_titles_changes: Vec<PrintTitlesChange>,
    /// Print-settings changes (full snapshot per sheet).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub print_settings_changes: Vec<PrintSettingsChange>,
    /// Split-view config changes (set/removed).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub split_config_changes: Vec<SplitConfigChange>,
    /// Scroll-position changes (per sheet).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scroll_position_changes: Vec<ScrollPositionChange>,
    /// Workbook-level settings changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_settings_changes: Vec<WorkbookSettingsChange>,
    /// Conditional format rule changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cf_changes: Vec<CfChange>,
    /// Named range changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub named_range_changes: Vec<NamedRangeChange>,
    /// Grouping changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub grouping_changes: Vec<GroupingChange>,
    /// Sparkline changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sparkline_changes: Vec<SparklineChange>,
    /// Sorting changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sorting_changes: Vec<SortingChange>,
    /// Structural changes (insert/delete rows/cols).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub structure_changes: Vec<StructureChangeResult>,
    /// Floating object changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub floating_object_changes: Vec<FloatingObjectChange>,
    /// Floating object group changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub floating_object_group_changes: Vec<FloatingObjectChange>,
    /// Pivot table changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pivot_changes: Vec<PivotTableChange>,
    /// Range changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub range_changes: Vec<RangeChange>,
    /// Policy-preserved parse outcomes for local parse operations.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub policy_preserved_parse_outcomes: Vec<PolicyPreservedParseOutcome>,
    /// Summary for policy-preserved parse outcomes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy_preserved_parse_summary: Option<PolicyPreservedParseSummary>,
    /// Undo description for this mutation (displayed as "Undo: {description}").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_description: Option<String>,
    /// Optional domain-specific return data (serialized as JSON).
    /// Used by write methods that need to return domain objects
    /// alongside mutation metadata (e.g., create_named_range → DefinedName).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    /// Old cell values keyed by `"sheetId:cellId"` (UUID strings).
    /// Populated via read-before-write from CellMirror for direct edits and
    /// cascade recalc changes. Used by TS ChangeAccumulator to populate
    /// `DirtyCell.oldValue` for `old → new` transition display.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub old_values: HashMap<String, CellValue>,
}

impl MutationResult {
    /// Create an empty mutation result.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            recalc: RecalcResult::empty(),
            property_changes: Vec::new(),
            dimension_changes: Vec::new(),
            merge_changes: Vec::new(),
            visibility_changes: Vec::new(),
            comment_changes: Vec::new(),
            filter_changes: Vec::new(),
            table_changes: Vec::new(),
            slicer_changes: Vec::new(),
            sheet_changes: Vec::new(),
            sheet_lifecycle_runtime_hint: None,
            settings_changes: Vec::new(),
            page_break_changes: Vec::new(),
            print_area_changes: Vec::new(),
            print_titles_changes: Vec::new(),
            print_settings_changes: Vec::new(),
            split_config_changes: Vec::new(),
            scroll_position_changes: Vec::new(),
            workbook_settings_changes: Vec::new(),
            cf_changes: Vec::new(),
            named_range_changes: Vec::new(),
            grouping_changes: Vec::new(),
            sparkline_changes: Vec::new(),
            sorting_changes: Vec::new(),
            structure_changes: Vec::new(),
            floating_object_changes: Vec::new(),
            floating_object_group_changes: Vec::new(),
            pivot_changes: Vec::new(),
            range_changes: Vec::new(),
            policy_preserved_parse_outcomes: Vec::new(),
            policy_preserved_parse_summary: None,
            undo_description: None,
            data: None,
            old_values: HashMap::new(),
        }
    }

    /// Attach domain-specific return data to this mutation result.
    ///
    /// The value is eagerly serialized to `serde_json::Value`.
    ///
    /// # Errors
    ///
    /// Returns `serde_json::Error` if serialization fails.
    pub fn with_data(mut self, value: &impl serde::Serialize) -> Result<Self, serde_json::Error> {
        self.data = Some(serde_json::to_value(value)?);
        Ok(self)
    }

    /// Attach a sheet lifecycle runtime hint to this mutation result.
    #[must_use]
    pub fn with_sheet_lifecycle_runtime_hint(mut self, hint: SheetLifecycleRuntimeHint) -> Self {
        self.sheet_lifecycle_runtime_hint = Some(hint);
        self
    }

    /// Extract domain-specific return data, deserializing from JSON.
    ///
    /// Returns `None` if no data was attached or if deserialization fails.
    pub fn extract_data<T: serde::de::DeserializeOwned>(&self) -> Option<T> {
        self.data
            .as_ref()
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }

    /// Create a [`MutationResult`] from a [`RecalcResult`] (no domain changes).
    #[must_use]
    pub fn from_recalc(recalc: RecalcResult) -> Self {
        let policy_preserved_parse_outcomes = recalc.policy_preserved_parse_outcomes.clone();
        let policy_preserved_parse_summary = recalc.policy_preserved_parse_summary.clone();
        Self {
            recalc,
            policy_preserved_parse_outcomes,
            policy_preserved_parse_summary,
            ..Self::empty()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::features::{SlicerChangeKind, SlicerSourceType};
    use super::super::primitives::{Axis, ChangeKind};
    use super::super::sheet_workbook::SheetChangeField;
    use super::*;
    use crate::queries::CellPosition;
    use cell_types::SheetId;
    use value_types::CellValue;
    use value_types::FiniteF64;

    #[test]
    fn mutation_result_empty() {
        let mr = MutationResult::empty();
        assert!(mr.recalc.changed_cells.is_empty());
        assert!(mr.property_changes.is_empty());
        assert!(mr.sheet_lifecycle_runtime_hint.is_none());
        assert!(mr.dimension_changes.is_empty());
        assert!(mr.merge_changes.is_empty());
        assert!(mr.visibility_changes.is_empty());
        assert!(mr.comment_changes.is_empty());
        assert!(mr.filter_changes.is_empty());
        assert!(mr.table_changes.is_empty());
        assert!(mr.slicer_changes.is_empty());
        assert!(mr.sheet_changes.is_empty());
        assert!(mr.page_break_changes.is_empty());
        assert!(mr.print_area_changes.is_empty());
        assert!(mr.print_titles_changes.is_empty());
        assert!(mr.print_settings_changes.is_empty());
        assert!(mr.split_config_changes.is_empty());
        assert!(mr.scroll_position_changes.is_empty());
        assert!(mr.workbook_settings_changes.is_empty());
        assert!(mr.cf_changes.is_empty());
        assert!(mr.named_range_changes.is_empty());
        assert!(mr.grouping_changes.is_empty());
        assert!(mr.sparkline_changes.is_empty());
        assert!(mr.sorting_changes.is_empty());
        assert!(mr.structure_changes.is_empty());
        assert!(mr.floating_object_changes.is_empty());
        assert!(mr.floating_object_group_changes.is_empty());
        assert!(mr.pivot_changes.is_empty());
        assert!(mr.range_changes.is_empty());
        assert!(mr.undo_description.is_none());
        assert!(mr.data.is_none());
    }

    #[test]
    fn mutation_result_from_recalc() {
        use crate::recalc::CellChange;
        let recalc = RecalcResult {
            changed_cells: vec![CellChange {
                cell_id: "c1".into(),
                sheet_id: "s1".into(),
                position: Some(CellPosition { row: 0, col: 0 }),
                value: CellValue::number(5.0),
                display_text: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            }],
            projection_changes: vec![],
            errors: vec![],
            validation_annotations: vec![],
            metrics: Default::default(),
            old_values: HashMap::new(),
            policy_preserved_parse_outcomes: Vec::new(),
            policy_preserved_parse_summary: None,
        };
        let mr = MutationResult::from_recalc(recalc);
        assert_eq!(mr.recalc.changed_cells.len(), 1);
        assert!(mr.property_changes.is_empty());
        assert!(mr.undo_description.is_none());
    }

    #[test]
    fn mutation_result_serde_roundtrip() {
        use crate::recalc::CellChange;
        let mr = MutationResult {
            recalc: RecalcResult {
                changed_cells: vec![CellChange {
                    cell_id: "c1".into(),
                    sheet_id: "s1".into(),
                    position: Some(CellPosition { row: 3, col: 1 }),
                    value: CellValue::number(42.0),
                    display_text: None,
                    format_idx: None,
                    extra_flags: 0,
                    old_value: None,
                }],
                projection_changes: vec![],
                errors: vec![],
                validation_annotations: vec![],
                metrics: Default::default(),
                old_values: HashMap::new(),
                policy_preserved_parse_outcomes: Vec::new(),
                policy_preserved_parse_summary: None,
            },
            property_changes: vec![PropertyChange {
                sheet_id: "s1".into(),
                cell_id: "c1".into(),
                position: Some(CellPosition { row: 0, col: 0 }),
                kind: ChangeKind::Set,
                format: Some(serde_json::json!({"bold": true})),
            }],
            dimension_changes: vec![DimensionChange {
                sheet_id: "s1".into(),
                axis: Axis::Row,
                index: 5,
                kind: ChangeKind::Set,
                size: Some(FiniteF64::must(30.0)),
            }],
            merge_changes: vec![MergeChange {
                sheet_id: "s1".into(),
                kind: ChangeKind::Set,
                start_row: 0,
                start_col: 0,
                end_row: 1,
                end_col: 2,
            }],
            visibility_changes: vec![],
            comment_changes: vec![],
            filter_changes: vec![],
            table_changes: vec![],
            slicer_changes: vec![SlicerChange {
                sheet_id: "s1".into(),
                slicer_id: "slicer-1".into(),
                kind: SlicerChangeKind::Created,
                source_type: Some(SlicerSourceType::Table),
                source_id: Some("table-1".into()),
                updated_fields: vec![],
                selected_values: None,
                selection_change_type: None,
                data: None,
            }],
            sheet_changes: vec![SheetChange {
                sheet_id: "s1".into(),
                kind: ChangeKind::Set,
                field: SheetChangeField::Name,
                name: None,
                old_name: None,
                index: None,
                old_index: None,
                hidden: None,
                source_sheet_id: None,
                frozen_rows: None,
                old_frozen_rows: None,
                frozen_cols: None,
                old_frozen_cols: None,
                color: None,
                old_color: None,
            }],
            sheet_lifecycle_runtime_hint: None,
            settings_changes: vec![],
            page_break_changes: vec![],
            print_area_changes: vec![],
            print_titles_changes: vec![],
            print_settings_changes: vec![],
            split_config_changes: vec![],
            scroll_position_changes: vec![],
            workbook_settings_changes: vec![],
            cf_changes: vec![],
            named_range_changes: vec![NamedRangeChange {
                name: "MyRange".into(),
                kind: ChangeKind::Removed,
            }],
            grouping_changes: vec![],
            sparkline_changes: vec![],
            sorting_changes: vec![],
            structure_changes: vec![],
            floating_object_changes: vec![],
            floating_object_group_changes: vec![],
            pivot_changes: vec![],
            range_changes: vec![],
            policy_preserved_parse_outcomes: vec![],
            policy_preserved_parse_summary: None,
            undo_description: Some("Set cell format".into()),
            data: None,
            old_values: HashMap::new(),
        };
        let json = serde_json::to_string(&mr).unwrap();
        let mr2: MutationResult = serde_json::from_str(&json).unwrap();
        assert_eq!(mr2.recalc.changed_cells.len(), 1);
        assert_eq!(mr2.property_changes.len(), 1);
        assert_eq!(mr2.property_changes[0].kind, ChangeKind::Set);
        assert_eq!(mr2.dimension_changes.len(), 1);
        assert_eq!(mr2.dimension_changes[0].size, Some(FiniteF64::must(30.0)));
        assert_eq!(mr2.merge_changes.len(), 1);
        assert_eq!(mr2.merge_changes[0].end_col, 2);
        assert_eq!(mr2.sheet_changes.len(), 1);
        assert_eq!(mr2.sheet_changes[0].field, SheetChangeField::Name);
        assert_eq!(mr2.slicer_changes.len(), 1);
        assert_eq!(mr2.slicer_changes[0].kind, SlicerChangeKind::Created);
        assert_eq!(mr2.named_range_changes.len(), 1);
        assert_eq!(mr2.named_range_changes[0].kind, ChangeKind::Removed);
        assert_eq!(mr2.undo_description, Some("Set cell format".into()));
        // Empty vecs should not appear in JSON
        assert!(!json.contains("visibilityChanges"));
        assert!(!json.contains("commentChanges"));
        assert!(!json.contains("filterChanges"));
        assert!(!json.contains("tableChanges"));
        assert!(json.contains("slicerChanges"));
    }

    #[test]
    fn sheet_lifecycle_runtime_hint_serde_roundtrip() {
        let sheet_id = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        let mr = MutationResult::empty()
            .with_sheet_lifecycle_runtime_hint(SheetLifecycleRuntimeHint::focus(sheet_id));

        let json = serde_json::to_string(&mr).unwrap();
        assert!(
            json.contains("sheetLifecycleRuntimeHint"),
            "hint field must serialize in camelCase; got {json}"
        );
        assert!(
            json.contains("activeSheet"),
            "activeSheet must serialize in camelCase; got {json}"
        );

        let decoded: MutationResult = serde_json::from_str(&json).unwrap();
        let hint = decoded
            .sheet_lifecycle_runtime_hint
            .expect("hint should deserialize");
        assert_eq!(hint.active_sheet, Some(sheet_id));
        assert!(hint.reconcile_provider_state);
    }

    #[test]
    fn mutation_result_serde_defaults() {
        // Minimal JSON (only recalc) should deserialize with all vectors empty.
        let json = r#"{"recalc":{"changedCells":[],"projectionChanges":[],"errors":[]}}"#;
        let mr: MutationResult = serde_json::from_str(json).unwrap();
        assert!(mr.property_changes.is_empty());
        assert!(mr.dimension_changes.is_empty());
        assert!(mr.merge_changes.is_empty());
        assert!(mr.visibility_changes.is_empty());
        assert!(mr.comment_changes.is_empty());
        assert!(mr.filter_changes.is_empty());
        assert!(mr.table_changes.is_empty());
        assert!(mr.slicer_changes.is_empty());
        assert!(mr.sheet_changes.is_empty());
        assert!(mr.page_break_changes.is_empty());
        assert!(mr.print_area_changes.is_empty());
        assert!(mr.print_titles_changes.is_empty());
        assert!(mr.print_settings_changes.is_empty());
        assert!(mr.split_config_changes.is_empty());
        assert!(mr.scroll_position_changes.is_empty());
        assert!(mr.workbook_settings_changes.is_empty());
        assert!(mr.cf_changes.is_empty());
        assert!(mr.named_range_changes.is_empty());
        assert!(mr.grouping_changes.is_empty());
        assert!(mr.sparkline_changes.is_empty());
        assert!(mr.sorting_changes.is_empty());
        assert!(mr.structure_changes.is_empty());
        assert!(mr.floating_object_changes.is_empty());
        assert!(mr.floating_object_group_changes.is_empty());
        assert!(mr.pivot_changes.is_empty());
        assert!(mr.range_changes.is_empty());
        assert!(mr.undo_description.is_none());
    }

    #[test]
    fn change_kind_serde_roundtrip() {
        let set_json = serde_json::to_string(&ChangeKind::Set).unwrap();
        let removed_json = serde_json::to_string(&ChangeKind::Removed).unwrap();
        assert_eq!(
            serde_json::from_str::<ChangeKind>(&set_json).unwrap(),
            ChangeKind::Set
        );
        assert_eq!(
            serde_json::from_str::<ChangeKind>(&removed_json).unwrap(),
            ChangeKind::Removed
        );
    }

    #[test]
    fn filter_change_set_roundtrip() {
        let fc = FilterChange {
            sheet_id: "s1".into(),
            filter_id: "f1".into(),
            filter_kind: Some("autoFilter".into()),
            action: Some("updated".into()),
            hidden_row_count: None,
            visible_row_count: None,
            kind: ChangeKind::Set,
        };
        let json = serde_json::to_string(&fc).unwrap();
        let fc2: FilterChange = serde_json::from_str(&json).unwrap();
        assert_eq!(fc2.kind, ChangeKind::Set);
        assert_eq!(fc2.sheet_id, "s1");
    }

    #[test]
    fn filter_change_removed_roundtrip() {
        let fc = FilterChange {
            sheet_id: "s1".into(),
            filter_id: "f1".into(),
            filter_kind: Some("autoFilter".into()),
            action: Some("deleted".into()),
            hidden_row_count: None,
            visible_row_count: None,
            kind: ChangeKind::Removed,
        };
        let json = serde_json::to_string(&fc).unwrap();
        let fc2: FilterChange = serde_json::from_str(&json).unwrap();
        assert_eq!(fc2.kind, ChangeKind::Removed);
    }

    #[test]
    fn domain_change_individual_roundtrips() {
        // VisibilityChange
        let vc = VisibilityChange {
            sheet_id: "s1".into(),
            axis: Axis::Row,
            index: 10,
            hidden: true,
        };
        let json = serde_json::to_string(&vc).unwrap();
        let vc2: VisibilityChange = serde_json::from_str(&json).unwrap();
        assert_eq!(vc2.index, 10);
        assert!(vc2.hidden);

        // GroupingChange
        let gc = GroupingChange {
            sheet_id: "s1".into(),
            axis: Axis::Col,
            kind: ChangeKind::Set,
        };
        let json = serde_json::to_string(&gc).unwrap();
        let gc2: GroupingChange = serde_json::from_str(&json).unwrap();
        assert_eq!(gc2.axis, Axis::Col);

        // SparklineChange
        let sc = SparklineChange {
            sheet_id: "s1".into(),
            cell_id: "c99".into(),
            position: Some(CellPosition { row: 98, col: 0 }),
            kind: ChangeKind::Set,
        };
        let json = serde_json::to_string(&sc).unwrap();
        let sc2: SparklineChange = serde_json::from_str(&json).unwrap();
        assert_eq!(sc2.cell_id, "c99");

        // SortingChange
        let so = SortingChange {
            sheet_id: "s1".into(),
            kind: ChangeKind::Removed,
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 5,
            rows_moved: 3,
        };
        let json = serde_json::to_string(&so).unwrap();
        let so2: SortingChange = serde_json::from_str(&json).unwrap();
        assert_eq!(so2.kind, ChangeKind::Removed);

        // CommentChange
        let coc = CommentChange {
            sheet_id: "s1".into(),
            cell_id: "c5".into(),
            position: Some(CellPosition { row: 4, col: 0 }),
            kind: ChangeKind::Set,
        };
        let json = serde_json::to_string(&coc).unwrap();
        let coc2: CommentChange = serde_json::from_str(&json).unwrap();
        assert_eq!(coc2.cell_id, "c5");

        // TableChange
        let tc = TableChange {
            name: "Table1".into(),
            sheet_id: "s1".into(),
            kind: ChangeKind::Set,
        };
        let json = serde_json::to_string(&tc).unwrap();
        let tc2: TableChange = serde_json::from_str(&json).unwrap();
        assert_eq!(tc2.name, "Table1");

        // CfChange
        let cf = CfChange {
            sheet_id: "s1".into(),
            kind: ChangeKind::Removed,
            rule_id: Some("rule1".into()),
        };
        let json = serde_json::to_string(&cf).unwrap();
        let cf2: CfChange = serde_json::from_str(&json).unwrap();
        assert_eq!(cf2.rule_id, Some("rule1".into()));

        // NamedRangeChange
        let nr = NamedRangeChange {
            name: "MyRange".into(),
            kind: ChangeKind::Set,
        };
        let json = serde_json::to_string(&nr).unwrap();
        let nr2: NamedRangeChange = serde_json::from_str(&json).unwrap();
        assert_eq!(nr2.name, "MyRange");

        // PropertyChange
        let pc = PropertyChange {
            sheet_id: "s1".into(),
            cell_id: "c1".into(),
            position: Some(CellPosition { row: 0, col: 0 }),
            kind: ChangeKind::Set,
            format: Some(serde_json::json!({"bold": true})),
        };
        let json = serde_json::to_string(&pc).unwrap();
        let pc2: PropertyChange = serde_json::from_str(&json).unwrap();
        assert!(pc2.format.is_some());

        // DimensionChange
        let dc = DimensionChange {
            sheet_id: "s1".into(),
            axis: Axis::Col,
            index: 3,
            kind: ChangeKind::Set,
            size: Some(FiniteF64::must(120.0)),
        };
        let json = serde_json::to_string(&dc).unwrap();
        let dc2: DimensionChange = serde_json::from_str(&json).unwrap();
        assert_eq!(dc2.size, Some(FiniteF64::must(120.0)));

        // MergeChange
        let mc = MergeChange {
            sheet_id: "s1".into(),
            kind: ChangeKind::Removed,
            start_row: 0,
            start_col: 0,
            end_row: 2,
            end_col: 3,
        };
        let json = serde_json::to_string(&mc).unwrap();
        let mc2: MergeChange = serde_json::from_str(&json).unwrap();
        assert_eq!(mc2.end_row, 2);
        assert_eq!(mc2.kind, ChangeKind::Removed);

        // SheetChange
        let shc = SheetChange {
            sheet_id: "s1".into(),
            kind: ChangeKind::Set,
            field: SheetChangeField::TabColor,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        };
        let json = serde_json::to_string(&shc).unwrap();
        let shc2: SheetChange = serde_json::from_str(&json).unwrap();
        assert_eq!(shc2.field, SheetChangeField::TabColor);
        // Optional fields should not appear in JSON when None
        assert!(!json.contains("name"));
        assert!(!json.contains("oldName"));
        assert!(!json.contains("index"));
    }

    #[test]
    fn sheet_change_payload_roundtrip() {
        // Create with populated payload fields
        let create = SheetChange {
            sheet_id: "s1".into(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Sheet,
            name: Some("Sheet2".into()),
            old_name: None,
            index: Some(1),
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        };
        let json = serde_json::to_string(&create).unwrap();
        assert!(json.contains("\"name\":\"Sheet2\""));
        assert!(json.contains("\"index\":1"));
        assert!(!json.contains("oldName"));
        assert!(!json.contains("hidden"));
        let create2: SheetChange = serde_json::from_str(&json).unwrap();
        assert_eq!(create2.name, Some("Sheet2".into()));
        assert_eq!(create2.index, Some(1));
        assert_eq!(create2.old_name, None);

        // Rename with old_name
        let rename = SheetChange {
            sheet_id: "s1".into(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Name,
            name: Some("NewName".into()),
            old_name: Some("OldName".into()),
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        };
        let json = serde_json::to_string(&rename).unwrap();
        let rename2: SheetChange = serde_json::from_str(&json).unwrap();
        assert_eq!(rename2.name, Some("NewName".into()));
        assert_eq!(rename2.old_name, Some("OldName".into()));

        // Copy with source_sheet_id
        let copy = SheetChange {
            sheet_id: "s2".into(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Sheet,
            name: Some("Sheet1 (Copy)".into()),
            old_name: None,
            index: Some(2),
            old_index: None,
            hidden: None,
            source_sheet_id: Some("s1".into()),
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        };
        let json = serde_json::to_string(&copy).unwrap();
        let copy2: SheetChange = serde_json::from_str(&json).unwrap();
        assert_eq!(copy2.source_sheet_id, Some("s1".into()));
        assert_eq!(copy2.name, Some("Sheet1 (Copy)".into()));

        // Move with old_index and index
        let mv = SheetChange {
            sheet_id: "s1".into(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Order,
            name: None,
            old_name: None,
            index: Some(3),
            old_index: Some(0),
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        };
        let json = serde_json::to_string(&mv).unwrap();
        let mv2: SheetChange = serde_json::from_str(&json).unwrap();
        assert_eq!(mv2.index, Some(3));
        assert_eq!(mv2.old_index, Some(0));

        // Hidden
        let hide = SheetChange {
            sheet_id: "s1".into(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Hidden,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: Some(true),
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        };
        let json = serde_json::to_string(&hide).unwrap();
        let hide2: SheetChange = serde_json::from_str(&json).unwrap();
        assert_eq!(hide2.hidden, Some(true));

        // Delete with Removed kind
        let del = SheetChange {
            sheet_id: "s1".into(),
            kind: ChangeKind::Removed,
            field: SheetChangeField::Sheet,
            name: Some("DeletedSheet".into()),
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        };
        let json = serde_json::to_string(&del).unwrap();
        let del2: SheetChange = serde_json::from_str(&json).unwrap();
        assert_eq!(del2.kind, ChangeKind::Removed);
        assert_eq!(del2.name, Some("DeletedSheet".into()));
    }

    #[test]
    fn axis_serde_roundtrip() {
        assert_eq!(serde_json::to_string(&Axis::Row).unwrap(), "\"row\"");
        assert_eq!(serde_json::to_string(&Axis::Col).unwrap(), "\"col\"");
        assert_eq!(serde_json::from_str::<Axis>("\"row\"").unwrap(), Axis::Row);
        assert_eq!(serde_json::from_str::<Axis>("\"col\"").unwrap(), Axis::Col);
    }

    #[test]
    fn mutation_result_with_data() {
        let mr = MutationResult::empty().with_data(&"hello").unwrap();
        assert_eq!(mr.data, Some(serde_json::json!("hello")));
        assert_eq!(mr.extract_data::<String>(), Some("hello".to_string()));
    }

    #[test]
    fn mutation_result_with_data_struct() {
        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        struct TestDomain {
            name: String,
            count: u32,
        }

        let domain = TestDomain {
            name: "test".into(),
            count: 42,
        };
        let mr = MutationResult::empty().with_data(&domain).unwrap();
        let extracted: Option<TestDomain> = mr.extract_data();
        assert_eq!(extracted, Some(domain));
    }

    #[test]
    fn mutation_result_extract_data_none() {
        let mr = MutationResult::empty();
        assert_eq!(mr.extract_data::<String>(), None);
    }

    #[test]
    fn mutation_result_extract_data_wrong_type() {
        let mr = MutationResult::empty().with_data(&42u32).unwrap();
        // Deserializing u32 as String should return None
        assert_eq!(mr.extract_data::<String>(), None);
    }

    #[test]
    fn mutation_result_data_serde_roundtrip() {
        let mr = MutationResult::empty()
            .with_data(&vec!["a", "b", "c"])
            .unwrap();
        let json = serde_json::to_string(&mr).unwrap();
        let mr2: MutationResult = serde_json::from_str(&json).unwrap();
        assert_eq!(
            mr2.extract_data::<Vec<String>>(),
            Some(vec!["a".to_string(), "b".to_string(), "c".to_string()])
        );
    }

    #[test]
    fn mutation_result_data_skipped_when_none() {
        let mr = MutationResult::empty();
        let json = serde_json::to_string(&mr).unwrap();
        assert!(!json.contains("data"));
    }
}
