//! Sparkline mutation contract tests.

use super::super::*;
use super::helpers::*;
use crate::snapshot::ChangeKind;
use crate::storage::sheet::sparklines::{
    EmptyCellDisplay, Sparkline, SparklineAxisSettings, SparklineCellAddress, SparklineDataRange,
    SparklineGroup, SparklineType, SparklineUpdate, SparklineVisualSettings,
};
use compute_wire::constants::{MUTATION_HEADER_SIZE, OFF_FLAGS, PATCH_STRIDE};
use compute_wire::flags::HAS_SPARKLINE;

fn sparkline(id: &str, row: u32, col: u32) -> Sparkline {
    let sid = sheet_id().to_uuid_string();
    Sparkline {
        id: id.to_string(),
        sheet_id: sid.clone(),
        cell: SparklineCellAddress {
            sheet_id: sid.clone(),
            row,
            col,
        },
        data_range: SparklineDataRange {
            source_sheet_name: None,
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 1,
        },
        sparkline_type: SparklineType::Line,
        data_in_rows: true,
        group_id: None,
        visual: SparklineVisualSettings::default(),
        axis: SparklineAxisSettings {
            display_empty_cells: EmptyCellDisplay::Gaps,
            ..SparklineAxisSettings::default()
        },
        created_at: None,
        updated_at: None,
    }
}

fn group(id: &str, sparkline_ids: Vec<&str>) -> SparklineGroup {
    SparklineGroup {
        id: id.to_string(),
        sheet_id: sheet_id().to_uuid_string(),
        sparkline_ids: sparkline_ids.into_iter().map(str::to_string).collect(),
        sparkline_type: SparklineType::Line,
        visual: SparklineVisualSettings::default(),
        axis: SparklineAxisSettings::default(),
        created_at: None,
        updated_at: None,
    }
}

fn patch_flags(mutation_bytes: &[u8]) -> Vec<((u32, u32), u16)> {
    let patch_count = u32::from_le_bytes([
        mutation_bytes[0],
        mutation_bytes[1],
        mutation_bytes[2],
        mutation_bytes[3],
    ]) as usize;
    let sheet_id_len = u16::from_le_bytes([mutation_bytes[8], mutation_bytes[9]]) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;

    (0..patch_count)
        .map(|i| {
            let patch_off = patches_start + i * PATCH_STRIDE;
            let row = u32::from_le_bytes([
                mutation_bytes[patch_off],
                mutation_bytes[patch_off + 1],
                mutation_bytes[patch_off + 2],
                mutation_bytes[patch_off + 3],
            ]);
            let col = u32::from_le_bytes([
                mutation_bytes[patch_off + 4],
                mutation_bytes[patch_off + 5],
                mutation_bytes[patch_off + 6],
                mutation_bytes[patch_off + 7],
            ]);
            let flags_off = patch_off + 8 + OFF_FLAGS;
            let flags =
                u16::from_le_bytes([mutation_bytes[flags_off], mutation_bytes[flags_off + 1]]);
            ((row, col), flags)
        })
        .collect()
}

fn flag_for_position(patches: &[u8], row: u32, col: u32) -> u16 {
    let mutation = extract_first_viewport_mutation(patches).expect("viewport patch");
    patch_flags(&mutation)
        .into_iter()
        .find_map(|(pos, flags)| (pos == (row, col)).then_some(flags))
        .unwrap_or_else(|| panic!("missing patch for ({row}, {col})"))
}

#[test]
fn add_sparkline_emits_change_and_has_sparkline_patch() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .register_viewport("main", &sid, 0, 0, 10, 10)
        .unwrap();

    let (patches, result) = engine
        .add_sparkline(&sid, sparkline("spark-1", 2, 3))
        .expect("add sparkline");

    assert_eq!(result.sparkline_changes.len(), 1);
    let change = &result.sparkline_changes[0];
    assert_eq!(change.sheet_id, sid.to_uuid_string());
    assert_eq!(
        change.position.as_ref().map(|pos| (pos.row, pos.col)),
        Some((2, 3))
    );
    assert_eq!(change.kind, ChangeKind::Set);
    assert_ne!(flag_for_position(&patches, 2, 3) & HAS_SPARKLINE, 0);
}

#[test]
fn update_sparkline_move_emits_removed_and_set_changes_with_patches() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .register_viewport("main", &sid, 0, 0, 10, 10)
        .unwrap();
    engine
        .add_sparkline(&sid, sparkline("spark-1", 1, 1))
        .expect("add sparkline");

    let (patches, result) = engine
        .update_sparkline(
            &sid,
            "spark-1",
            SparklineUpdate {
                cell: Some(SparklineCellAddress {
                    sheet_id: sid.to_uuid_string(),
                    row: 4,
                    col: 5,
                }),
                ..SparklineUpdate::default()
            },
        )
        .expect("update sparkline");

    let changes: Vec<_> = result
        .sparkline_changes
        .iter()
        .map(|change| {
            (
                change.position.as_ref().map(|pos| (pos.row, pos.col)),
                change.kind,
            )
        })
        .collect();
    assert!(changes.contains(&(Some((1, 1)), ChangeKind::Removed)));
    assert!(changes.contains(&(Some((4, 5)), ChangeKind::Set)));
    assert_eq!(flag_for_position(&patches, 1, 1) & HAS_SPARKLINE, 0);
    assert_ne!(flag_for_position(&patches, 4, 5) & HAS_SPARKLINE, 0);
}

#[test]
fn delete_sparkline_emits_removed_change_and_clears_patch_flag() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .register_viewport("main", &sid, 0, 0, 10, 10)
        .unwrap();
    engine
        .add_sparkline(&sid, sparkline("spark-1", 2, 2))
        .expect("add sparkline");

    let (patches, result) = engine
        .delete_sparkline(&sid, "spark-1")
        .expect("delete sparkline");

    assert_eq!(result.sparkline_changes.len(), 1);
    let change = &result.sparkline_changes[0];
    assert_eq!(
        change.position.as_ref().map(|pos| (pos.row, pos.col)),
        Some((2, 2))
    );
    assert_eq!(change.kind, ChangeKind::Removed);
    assert_eq!(flag_for_position(&patches, 2, 2) & HAS_SPARKLINE, 0);
}

#[test]
fn group_and_clear_sparkline_mutations_emit_member_changes() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .register_viewport("main", &sid, 0, 0, 10, 10)
        .unwrap();
    engine
        .add_sparkline(&sid, sparkline("spark-1", 1, 1))
        .expect("add first");
    engine
        .add_sparkline(&sid, sparkline("spark-2", 3, 3))
        .expect("add second");

    let (patches, result) = engine
        .add_sparkline_group(&sid, group("group-1", vec!["spark-1", "spark-2"]))
        .expect("add group");
    assert_eq!(result.sparkline_changes.len(), 2);
    assert!(
        result
            .sparkline_changes
            .iter()
            .all(|change| change.kind == ChangeKind::Set)
    );
    assert_ne!(flag_for_position(&patches, 1, 1) & HAS_SPARKLINE, 0);
    assert_ne!(flag_for_position(&patches, 3, 3) & HAS_SPARKLINE, 0);

    let (_patches, result) = engine
        .delete_sparkline_group(&sid, "group-1", false)
        .expect("ungroup");
    assert_eq!(result.sparkline_changes.len(), 2);
    assert!(
        result
            .sparkline_changes
            .iter()
            .all(|change| change.kind == ChangeKind::Set)
    );

    let (_patches, result) = engine
        .clear_sparklines_in_range(&sid, 0, 0, 2, 2)
        .expect("clear range");
    assert_eq!(result.sparkline_changes.len(), 1);
    assert_eq!(
        result.sparkline_changes[0]
            .position
            .as_ref()
            .map(|pos| (pos.row, pos.col)),
        Some((1, 1))
    );
    assert_eq!(result.sparkline_changes[0].kind, ChangeKind::Removed);

    let (_patches, result) = engine
        .clear_sparklines_for_sheet(&sid)
        .expect("clear sheet");
    assert_eq!(result.sparkline_changes.len(), 1);
    assert_eq!(
        result.sparkline_changes[0]
            .position
            .as_ref()
            .map(|pos| (pos.row, pos.col)),
        Some((3, 3))
    );
    assert_eq!(result.sparkline_changes[0].kind, ChangeKind::Removed);
}
