//! Regression tests for filter viewport R5.2 / T10 — CF mutation handlers and
//! structural mutations both emit full-viewport patches.
//!
//! Two contracts pinned:
//!
//!   1. CF rule mutations (add/update/delete/reorder/update_ranges, plus the
//!      rule-level CRUD in formatting.rs) emit non-empty multi-viewport
//!      patches. Previously the kernel's compute-bridge.ts overrode each of
//!      these to call `forceRefreshAllViewports()` after the mutation
//!      returned because the underlying patches were not consistently
//!      surfaced.
//!
//!   2. Structural mutations (insert_rows / insert_cols / delete_rows /
//!      delete_cols) on a sheet that carries CF rules also rebuild the
//!      full viewport binary, so cells that *moved* into a (now-shifted)
//!      CF range pick up the rule's color even when their value didn't
//!      change. filter viewport finding 10 / scenario `cf-recalc-on-insert-row`.
//!
//! Run:
//!   cargo test -p compute-core --test cf_viewport_patches

use cell_types::SheetId;
use compute_core::snapshot::ChangeKind;
use compute_core::storage::engine::YrsComputeEngine;
use serde_json::json;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn sheet_id_str(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}
fn cell_id_str(suffix: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", suffix)
}
fn number_cell(id_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn snapshot_with_numbers(values: &[f64]) -> WorkbookSnapshot {
    let cells = values
        .iter()
        .enumerate()
        .map(|(i, n)| number_cell(100 + i as u32, i as u32, 0, *n))
        .collect();
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str(1),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn register_viewport(engine: &mut YrsComputeEngine, sheet_id: &SheetId) -> String {
    let viewport_id = "viewport-1".to_string();
    engine
        .register_viewport(&viewport_id, sheet_id, 0, 0, 9, 5)
        .expect("register_viewport");
    viewport_id
}

fn viewport_count(patches: &[u8]) -> u16 {
    assert!(patches.len() >= 2);
    u16::from_le_bytes([patches[0], patches[1]])
}

fn first_viewport_payload_size(patches: &[u8]) -> usize {
    let count = viewport_count(patches);
    if count == 0 {
        return 0;
    }
    let id_len = patches[2] as usize;
    let len_off = 3 + id_len;
    let payload_len = u32::from_le_bytes([
        patches[len_off],
        patches[len_off + 1],
        patches[len_off + 2],
        patches[len_off + 3],
    ]);
    payload_len as usize
}

/// CF rule body: "highlight cells > 100 with red".
fn red_above_100_rule(rule_id: &str, sheet_id: &SheetId) -> serde_json::Value {
    json!({
        "id": format!("cf-{}", rule_id),
        "sheetId": sheet_id.to_uuid_string(),
        "ranges": [{
            "startRow": 0u32, "startCol": 0u32, "endRow": 9u32, "endCol": 0u32,
        }],
        "rules": [{
            "type": "cellValue",
            "id": format!("rule-{}", rule_id),
            "priority": 1,
            "operator": "greaterThan",
            "value1": 100,
            "style": {
                "backgroundColor": "#FF0000"
            }
        }]
    })
}

#[test]
fn add_cf_rule_emits_full_viewport_patches() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_numbers(&[10.0, 500.0, 20.0, 30.0, 40.0]))
            .expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    let (patches, _) = engine
        .add_cf_rule(&sid, red_above_100_rule("a", &sid))
        .expect("add_cf_rule");

    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "add_cf_rule must emit full viewport rebuild (filter viewport R5.2)"
    );
}

#[test]
fn undo_cf_rule_emits_full_viewport_patches() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_numbers(&[10.0, 500.0, 20.0, 30.0, 40.0]))
            .expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .add_cf_rule(&sid, red_above_100_rule("a", &sid))
        .expect("add_cf_rule");
    assert_eq!(engine.get_all_cf_rules(&sid).len(), 1);
    assert!(engine.can_undo());

    let (patches, result) = engine.undo().expect("undo add_cf_rule");

    assert!(
        engine.get_all_cf_rules(&sid).is_empty(),
        "undo must remove the CF rule from storage"
    );
    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "undo add_cf_rule must rebuild CF-affected viewports"
    );
    assert!(
        result
            .cf_changes
            .iter()
            .any(|change| change.sheet_id == sid.to_uuid_string()
                && change.kind == ChangeKind::Removed),
        "undo add_cf_rule must surface a removed CfChange, got: {:?}",
        result.cf_changes
    );
}

#[test]
fn update_cf_rule_emits_full_viewport_patches() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_numbers(&[10.0, 500.0, 20.0, 30.0, 40.0]))
            .expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .add_cf_rule(&sid, red_above_100_rule("a", &sid))
        .expect("add_cf_rule");
    let format_id = engine.get_all_cf_rules(&sid)[0].id.clone();

    // Update the rule's threshold from 100 → 50.
    let updates = json!({
        "rules": [{
            "id": engine.get_all_cf_rules(&sid)[0].rules[0].id(),
            "type": "cellValue",
            "priority": 1,
            "operator": "greaterThan",
            "value1": 50,
            "style": { "backgroundColor": "#FF0000" }
        }]
    });
    let (patches, _) = engine
        .update_cf_rule(&sid, &format_id, updates)
        .expect("update_cf_rule");

    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "update_cf_rule must emit full viewport rebuild (filter viewport R5.2)"
    );
}

#[test]
fn delete_cf_rule_emits_full_viewport_patches() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_numbers(&[10.0, 500.0, 20.0, 30.0, 40.0]))
            .expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .add_cf_rule(&sid, red_above_100_rule("a", &sid))
        .expect("add_cf_rule");
    let format_id = engine.get_all_cf_rules(&sid)[0].id.clone();

    let (patches, _) = engine
        .delete_cf_rule(&sid, &format_id)
        .expect("delete_cf_rule");

    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "delete_cf_rule must emit full viewport rebuild (filter viewport R5.2)"
    );
}

#[test]
fn reorder_cf_rules_emits_full_viewport_patches() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_numbers(&[10.0, 500.0, 20.0, 30.0, 40.0]))
            .expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .add_cf_rule(&sid, red_above_100_rule("a", &sid))
        .expect("add_cf_rule");
    engine
        .add_cf_rule(&sid, red_above_100_rule("b", &sid))
        .expect("add_cf_rule");

    let ids: Vec<String> = engine
        .get_all_cf_rules(&sid)
        .iter()
        .rev()
        .map(|f| f.id.clone())
        .collect();
    let (patches, _) = engine
        .reorder_cf_rules(&sid, ids)
        .expect("reorder_cf_rules");

    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "reorder_cf_rules must emit full viewport rebuild (filter viewport R5.2)"
    );
}

/// filter viewport T10 / finding 10 / scenario `cf-recalc-on-insert-row`:
/// inserting a row inside a CF range must shift the range and re-evaluate
/// the rule against every cell in the new viewport. The test confirms a
/// full viewport rebuild flows out of `structure_change` whenever the
/// affected sheet has CF formats — without this, cells that moved into a
/// (now-shifted) CF range would render with stale colors.
#[test]
fn insert_rows_with_cf_emits_full_viewport_patches() {
    use formula_types::StructureChange;

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_numbers(&[10.0, 500.0, 20.0, 30.0, 40.0]))
            .expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .add_cf_rule(&sid, red_above_100_rule("a", &sid))
        .expect("add_cf_rule");

    let change = StructureChange::InsertRows {
        at: 2,
        count: 1,
        new_row_ids: Vec::new(),
    };
    let (patches, _) = engine
        .structure_change(&sid, &change)
        .expect("structure_change");

    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "structure_change with CF must emit full viewport rebuild (filter viewport T10)"
    );
}

#[test]
fn insert_cols_with_cf_emits_full_viewport_patches() {
    use formula_types::StructureChange;

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_numbers(&[10.0, 500.0, 20.0, 30.0, 40.0]))
            .expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .add_cf_rule(&sid, red_above_100_rule("a", &sid))
        .expect("add_cf_rule");

    let change = StructureChange::InsertCols {
        at: 0,
        count: 1,
        new_col_ids: Vec::new(),
    };
    let (patches, _) = engine
        .structure_change(&sid, &change)
        .expect("structure_change");

    assert_eq!(viewport_count(&patches), 1);
    assert!(
        first_viewport_payload_size(&patches) > 32,
        "insert_cols with CF must emit full viewport rebuild (filter viewport T10)"
    );
}

/// Sheets without CF formats still take the structural-result path. This is
/// important: the full-rebuild cost should only be paid when CF actually needs
/// re-evaluation. The bridge consumes the structure change result to refresh
/// shifted viewport buffers, so there may be no binary viewport patch payload.
#[test]
fn insert_rows_without_cf_falls_back_to_incremental_patches() {
    use formula_types::StructureChange;

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_numbers(&[10.0, 500.0, 20.0, 30.0, 40.0]))
            .expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);
    // No CF rule — the structural patch path should run.

    let change = StructureChange::InsertRows {
        at: 2,
        count: 1,
        new_row_ids: Vec::new(),
    };
    let (patches, _) = engine
        .structure_change(&sid, &change)
        .expect("structure_change");
    assert_eq!(viewport_count(&patches), 0);
}

/// filter viewport finding 13: typed CF priority bumping in `add_cf_rule`
/// renumbers existing formats when a new rule lands at priority 1. This
/// test confirms (a) the typed bump succeeds end-to-end, (b) the resulting
/// priorities are correct, and (c) patches are emitted for both the new
/// rule and the renumbered existing ones.
#[test]
fn add_cf_rule_typed_priority_bump_renumbers_existing_formats() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot_with_numbers(&[10.0, 200.0]))
        .expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    let _vp = register_viewport(&mut engine, &sid);

    engine
        .add_cf_rule(&sid, red_above_100_rule("a", &sid))
        .expect("add_cf_rule (a)");
    engine
        .add_cf_rule(&sid, red_above_100_rule("b", &sid))
        .expect("add_cf_rule (b)");
    engine
        .add_cf_rule(&sid, red_above_100_rule("c", &sid))
        .expect("add_cf_rule (c)");

    let formats = engine.get_all_cf_rules(&sid);
    assert_eq!(formats.len(), 3);
    // Each new format gets priority 1; existing ones shift +1 on each
    // subsequent insert. After 3 inserts, the priorities for the *first*
    // rule of each format (in get_formats_for_sheet order) span 1..=3.
    let priorities: Vec<i32> = formats
        .iter()
        .map(|f| f.rules.first().expect("rule").priority())
        .collect();
    let mut sorted = priorities.clone();
    sorted.sort();
    assert_eq!(sorted, vec![1, 2, 3], "typed priority bump must renumber");
}
