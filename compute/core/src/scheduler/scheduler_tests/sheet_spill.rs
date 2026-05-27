use super::*;

// -----------------------------------------------------------------------
// Regression: sheet_order maintained on add/remove (stress-many-sheets)
// -----------------------------------------------------------------------

#[test]
fn test_add_sheet_extends_sheet_order() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Initial snapshot has exactly one sheet (sid(1)).
    assert_eq!(core.sheet_order.len(), 1);
    let initial_pos = *core.sheet_order.get(&sid(1)).expect("Sheet1 in order");

    let new_sheet = SheetSnapshot {
        id: "00000000-0000-0000-0000-000000000002".to_string(),
        name: "Sheet2".to_string(),
        rows: 10,
        cols: 5,
        cells: vec![],
        ranges: vec![],
    };
    core.add_sheet(&mut mirror, new_sheet).unwrap();

    assert_eq!(
        core.sheet_order.len(),
        2,
        "sheet_order must grow when add_sheet is called"
    );
    let new_pos = *core
        .sheet_order
        .get(&sid(2))
        .expect("Sheet2 must be tracked in sheet_order");
    assert!(
        new_pos > initial_pos,
        "newly added sheet must take a position after existing sheets (got new={} old={})",
        new_pos,
        initial_pos,
    );
}

// -----------------------------------------------------------------------
// Regression: merge-fallback spill blockers drain on unmerge
// (spill-into-merged-cell)
// -----------------------------------------------------------------------

#[test]
fn test_drain_spill_blockers_for_region_unblocks_merge_fallback() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let source_id = cid(0x10); // A1 (row 0, col 0) registered by basic_snapshot

    // Simulate the merge-fallback path: when check_conflict() can't find
    // any concrete cell entity inside the merge region, it records the
    // spill *source* itself as the blocker. The source's position is
    // outside the merge region (here A1 at 0,0, while the "merge" is at
    // row 5..=7).
    core.spill_blockers.insert(source_id, source_id);

    // Drain blockers for a merge region that does NOT contain A1.
    // The classic in_region check would NOT match (A1 is at (0,0),
    // region is (5,0)..=(7,0)), so without the merge-fallback clause
    // this entry would stay stuck forever and the formula would remain
    // permanently #SPILL!.
    let unblocked = core.drain_spill_blockers_for_region(&mirror, &sheet_id, 5, 0, 7, 0);

    assert_eq!(
        unblocked,
        vec![source_id],
        "merge-fallback blocker (blocker_id == source_id) on the same sheet \
         must be drained when any merge on that sheet is removed",
    );
    assert!(
        !core.spill_blockers.contains_key(&source_id),
        "drained blocker must be removed from the map",
    );
}

#[test]
fn test_drain_spill_blockers_for_region_keeps_merge_fallback_other_sheet() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id_a = sid(1);

    // Add a second sheet with one cell so we can place a merge-fallback
    // entry whose source lives on Sheet2 but unmerge is on Sheet1.
    let new_sheet = SheetSnapshot {
        id: "00000000-0000-0000-0000-000000000002".to_string(),
        name: "Sheet2".to_string(),
        rows: 10,
        cols: 5,
        cells: vec![CellData {
            cell_id: "00000000-0000-0000-0000-000000000030".to_string(),
            row: 0,
            col: 0,
            value: CellValue::number(1.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        }],
        ranges: vec![],
    };
    core.add_sheet(&mut mirror, new_sheet).unwrap();

    let source_other = cid(0x30); // Lives on Sheet2
    core.spill_blockers.insert(source_other, source_other);

    // Drain merges on Sheet1 — must NOT drain the Sheet2 fallback entry.
    let unblocked = core.drain_spill_blockers_for_region(&mirror, &sheet_id_a, 0, 0, 99, 99);

    assert!(
        unblocked.is_empty(),
        "merge-fallback entries on a different sheet must not be drained",
    );
    assert!(
        core.spill_blockers.contains_key(&source_other),
        "Sheet2 fallback entry must remain after Sheet1 unmerge",
    );
}

#[test]
fn test_remove_sheet_clears_sheet_order_entry() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Add a second sheet so removing leaves one behind.
    let new_sheet = SheetSnapshot {
        id: "00000000-0000-0000-0000-000000000002".to_string(),
        name: "Sheet2".to_string(),
        rows: 10,
        cols: 5,
        cells: vec![],
        ranges: vec![],
    };
    core.add_sheet(&mut mirror, new_sheet).unwrap();
    assert_eq!(core.sheet_order.len(), 2);

    core.remove_sheet(&mut mirror, &sid(2)).unwrap();

    assert_eq!(
        core.sheet_order.len(),
        1,
        "sheet_order must shrink when remove_sheet is called"
    );
    assert!(
        !core.sheet_order.contains_key(&sid(2)),
        "removed sheet must not linger in sheet_order"
    );
}
