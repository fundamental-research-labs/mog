//! Group 7: Viewport registry CRUD.

use super::super::*;
use super::helpers::*;
use crate::snapshot::SheetSnapshot;

// -------------------------------------------------------------------
// Test 23: register_viewport and get_registered_viewports
// -------------------------------------------------------------------

#[test]
fn test_register_viewport_appears_in_registry() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 50, 20);

    let viewports = engine.get_registered_viewports();
    assert_eq!(viewports.len(), 1);

    let (id, sheet_hex, sr, sc, er, ec) = &viewports[0];
    assert_eq!(id, "main");
    assert_eq!(*sheet_hex, sid.to_uuid_string());
    assert_eq!((*sr, *sc, *er, *ec), (0, 0, 50, 20));
}

// -------------------------------------------------------------------
// Test 24: update_viewport_bounds changes bounds
// -------------------------------------------------------------------

#[test]
fn test_update_viewport_bounds() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 50, 20);

    // Update bounds
    engine.update_viewport_bounds("main", 10, 5, 60, 25);

    let viewports = engine.get_registered_viewports();
    assert_eq!(viewports.len(), 1);
    let (_, _, sr, sc, er, ec) = &viewports[0];
    assert_eq!((*sr, *sc, *er, *ec), (10, 5, 60, 25));
}

// -------------------------------------------------------------------
// Test 25: update_viewport_bounds no-op for unknown ID
// -------------------------------------------------------------------

#[test]
fn test_update_viewport_bounds_unknown_id() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Should not panic; just no-op
    engine.update_viewport_bounds("nonexistent", 0, 0, 50, 20);
    assert!(engine.get_registered_viewports().is_empty());
}

// -------------------------------------------------------------------
// Test 26: unregister_viewport removes entry
// -------------------------------------------------------------------

#[test]
fn test_unregister_viewport() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 50, 20);
    assert_eq!(engine.get_registered_viewports().len(), 1);

    engine.unregister_viewport("main");
    assert!(engine.get_registered_viewports().is_empty());
}

// -------------------------------------------------------------------
// Test 27: reset_sheet_viewports clears only that sheet's viewports
// -------------------------------------------------------------------

#[test]
fn test_reset_sheet_viewports_selective() {
    let snap = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440099".to_string(),
                name: "Sheet2".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            },
        ],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid1 = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let sid2 = SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440099").unwrap();

    engine.register_viewport("main", &sid1, 0, 0, 50, 20);
    engine.register_viewport("split-bottom", &sid1, 50, 0, 100, 20);
    engine.register_viewport("sheet2-main", &sid2, 0, 0, 30, 10);

    assert_eq!(engine.get_registered_viewports().len(), 3);

    // Reset only sheet1 viewports
    engine.reset_sheet_viewports(&sid1);

    let remaining = engine.get_registered_viewports();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].0, "sheet2-main");
}

// -------------------------------------------------------------------
// Test 28: get_viewport_binary uses registered viewport state
// -------------------------------------------------------------------

#[test]
fn test_get_viewport_binary_updates_registry() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    // Calling get_viewport_binary should create a synthetic registration
    let buf = engine.get_viewport_binary(&sid, 0, 0, 50, 20, false);
    assert!(!buf.is_empty());

    // The registry should now have a synthetic entry for this sheet
    let viewports = engine.get_registered_viewports();
    assert_eq!(viewports.len(), 1);
    let (id, _, sr, sc, er, ec) = &viewports[0];
    assert!(id.starts_with("__sheet_"));
    assert_eq!((*sr, *sc, *er, *ec), (0, 0, 50, 20));
}

// -------------------------------------------------------------------
// Test 29: Multiple viewports for same sheet
// -------------------------------------------------------------------

#[test]
fn test_multiple_viewports_same_sheet() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("top-pane", &sid, 0, 0, 10, 20);
    engine.register_viewport("bottom-pane", &sid, 10, 0, 50, 20);

    let viewports = engine.get_registered_viewports();
    assert_eq!(viewports.len(), 2);

    // Both should have the same sheet_id
    let sheet_ids: Vec<&String> = viewports.iter().map(|(_, s, _, _, _, _)| s).collect();
    assert!(sheet_ids.iter().all(|s| **s == sid.to_uuid_string()));
}

// -------------------------------------------------------------------
// Test 30: Register viewport replaces existing
// -------------------------------------------------------------------

#[test]
fn test_register_viewport_replaces_existing() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 50, 20);
    engine.register_viewport("main", &sid, 10, 5, 60, 25);

    let viewports = engine.get_registered_viewports();
    assert_eq!(viewports.len(), 1);
    let (_, _, sr, sc, er, ec) = &viewports[0];
    assert_eq!((*sr, *sc, *er, *ec), (10, 5, 60, 25));
}
