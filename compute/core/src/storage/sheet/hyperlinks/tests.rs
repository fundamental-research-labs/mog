use super::keys::*;
use super::*;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::{KEY_FORMULA, KEY_GRID_INDEX, KEY_VALUE};
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::hyperlink::HyperlinkTargetKind;
use std::sync::Arc;
use yrs::{Any, Map, MapPrelim, Origin, Out, Transact};

use crate::storage::infra::grid_helpers::get_cells_map;

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a YrsStorage with one sheet plus a fresh `GridIndex` that serves
/// as the authoritative identity store for that sheet.
fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");

    let grid = GridIndex::new(sheet_id, 100, 26, Arc::new(cell_types::IdAllocator::new()));

    (storage, sheet_id, grid)
}

/// Seed a cell with a value at a position, registering identity in `grid`.
fn seed_cell(
    storage: &YrsStorage,
    grid: &mut GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
    value: Any,
) -> String {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_id = grid.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
        let cell_prelim = MapPrelim::from([(KEY_VALUE, value)]);
        cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
    }

    cell_hex.to_string()
}

/// Seed a cell with a value and a formula at a position.
fn seed_cell_with_formula(
    storage: &YrsStorage,
    grid: &mut GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
    value: Any,
    formula: &str,
) -> String {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_id = grid.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
        let cell_prelim = MapPrelim::from([
            (KEY_VALUE, value),
            (KEY_FORMULA, Any::String(Arc::from(formula))),
        ]);
        cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
    }

    cell_hex.to_string()
}

fn seed_hyperlink_cell(
    storage: &YrsStorage,
    grid: &mut GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
    entries: Vec<(&'static str, Any)>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_id = grid.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
        cells_map.insert(
            &mut txn,
            &*cell_hex,
            MapPrelim::from([(KEY_VALUE, Any::Null)]),
        );
        if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &cell_hex) {
            for (key, value) in entries {
                cell_map.insert(&mut txn, key, value);
            }
        }
    }
}

/// Check if a cell exists in the cells map.
fn cell_exists(storage: &YrsStorage, sheet_id: SheetId, cell_hex: &str) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
        matches!(cells_map.get(&txn, cell_hex), Some(Out::YMap(_)))
    } else {
        false
    }
}

/// Check if a position has a registered CellId in the GridIndex.
fn pos_exists_in_grid(grid: &GridIndex, row: u32, col: u32) -> bool {
    grid.cell_id_at(row, col).is_some()
}

// -------------------------------------------------------------------
// Test 1: set_hyperlink on existing cell
// -------------------------------------------------------------------

#[test]
fn test_set_hyperlink_on_existing_cell() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    // Seed a cell with a value at (0, 0)
    let cell_hex = seed_cell(&storage, &mut grid, sheet_id, 0, 0, Any::Number(42.0));

    // Set hyperlink
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "https://example.com",
    );

    // Verify the hyperlink was set
    let url = get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0);
    assert_eq!(url, Some("https://example.com".to_string()));

    // Verify cell still has its value
    let sheet_hex_str = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex_str).unwrap();
    let cell_map = match cells_map.get(&txn, &*cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell should exist"),
    };
    assert!(matches!(
        cell_map.get(&txn, KEY_VALUE),
        Some(Out::Any(Any::Number(n))) if n == 42.0
    ));
}

// -------------------------------------------------------------------
// Test 2: set_hyperlink on empty position (creates marker cell)
// -------------------------------------------------------------------

#[test]
fn test_set_hyperlink_on_empty_position() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    // No cell at (5, 3)
    assert!(get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 5, 3).is_none());

    // Set hyperlink on empty position
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        5,
        3,
        "https://marker.test",
    );

    // Hyperlink should be readable
    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 5, 3),
        Some("https://marker.test".to_string())
    );

    // Grid index should have the new cell
    assert!(pos_exists_in_grid(&grid, 5, 3));

    // The cell should have value=null (marker cell)
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let cell_id = grid.cell_id_at(5, 3).unwrap();
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    let cell_map = match cells_map.get(&txn, &*cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("marker cell should exist"),
    };
    assert!(matches!(
        cell_map.get(&txn, KEY_VALUE),
        Some(Out::Any(Any::Null))
    ));
}

// -------------------------------------------------------------------
// Test 3: get_hyperlink returns URL
// -------------------------------------------------------------------

#[test]
fn test_get_hyperlink_returns_url() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    seed_cell(
        &storage,
        &mut grid,
        sheet_id,
        2,
        1,
        Any::String(Arc::from("text")),
    );
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        2,
        1,
        "mailto:test@example.com",
    );

    let result = get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 2, 1);
    assert_eq!(result, Some("mailto:test@example.com".to_string()));
}

// -------------------------------------------------------------------
// Test 4: get_hyperlink on empty cell returns None
// -------------------------------------------------------------------

#[test]
fn test_get_hyperlink_on_empty_cell_returns_none() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    // No cell at (10, 10)
    assert!(
        get_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &grid,
            10,
            10
        )
        .is_none()
    );

    // Cell with value but no hyperlink
    seed_cell(&storage, &mut grid, sheet_id, 0, 0, Any::Number(99.0));
    assert!(get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0).is_none());
}

// -------------------------------------------------------------------
// Test 5: remove_hyperlink preserves cell with value
// -------------------------------------------------------------------

#[test]
fn test_remove_hyperlink_preserves_cell_with_value() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    // Seed a cell with actual value
    let cell_hex = seed_cell(&storage, &mut grid, sheet_id, 0, 0, Any::Number(42.0));

    // Add hyperlink then remove it
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "https://example.com",
    );
    assert!(get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0).is_some());

    remove_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
    );

    // Hyperlink gone
    assert!(get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0).is_none());

    // Cell still exists with its value
    assert!(cell_exists(&storage, sheet_id, &cell_hex));

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    let cell_map = match cells_map.get(&txn, &*cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell should still exist"),
    };
    assert!(matches!(
        cell_map.get(&txn, KEY_VALUE),
        Some(Out::Any(Any::Number(n))) if n == 42.0
    ));
}

// -------------------------------------------------------------------
// Test 6: remove_hyperlink deletes empty cell
// -------------------------------------------------------------------

#[test]
fn test_remove_hyperlink_deletes_empty_cell() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    // Set hyperlink on empty position (creates marker cell)
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        3,
        3,
        "https://tobedeleted.com",
    );
    assert!(get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 3, 3).is_some());
    assert!(pos_exists_in_grid(&grid, 3, 3));

    // Remove hyperlink -- cell should be deleted entirely
    remove_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        3,
        3,
    );

    assert!(get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 3, 3).is_none());

    // Grid index entry should be cleaned up
    assert!(!pos_exists_in_grid(&grid, 3, 3));
}

// -------------------------------------------------------------------
// Test 7: set/get/remove round-trip
// -------------------------------------------------------------------

#[test]
fn test_hyperlink_roundtrip() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    // Initially no hyperlink
    assert!(get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0).is_none());

    // Set
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "https://roundtrip.test",
    );
    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
        Some("https://roundtrip.test".to_string())
    );

    // Remove
    remove_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
    );
    assert!(get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0).is_none());
}

#[test]
fn test_get_all_hyperlinks_preserves_relationship_backed_fragment_metadata() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        0,
        0,
        vec![
            (KEY_VALUE, Any::Null),
            (KEY_HYPERLINK, Any::String(Arc::from("#Sheet2!A1"))),
            (
                KEY_HYPERLINK_TARGET_KIND,
                Any::String(Arc::from("relationship")),
            ),
            (
                KEY_HYPERLINK_TARGET_MODE,
                Any::String(Arc::from("External")),
            ),
        ],
    );

    let links = get_all_hyperlinks(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid);

    assert_eq!(links.len(), 1);
    assert_eq!(links[0].target.as_deref(), Some("#Sheet2!A1"));
    assert_eq!(links[0].location, None);
    assert_eq!(
        links[0].target_kind,
        Some(HyperlinkTargetKind::Relationship)
    );
    assert_eq!(links[0].target_mode.as_deref(), Some("External"));
}

#[test]
fn test_get_all_hyperlinks_old_fragment_storage_remains_inline_location() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        0,
        0,
        vec![
            (KEY_VALUE, Any::Null),
            (KEY_HYPERLINK, Any::String(Arc::from("#Sheet2!A1"))),
        ],
    );

    let links = get_all_hyperlinks(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid);

    assert_eq!(links.len(), 1);
    assert_eq!(links[0].target, None);
    assert_eq!(links[0].location.as_deref(), Some("Sheet2!A1"));
    assert_eq!(
        links[0].target_kind,
        Some(HyperlinkTargetKind::InlineLocation)
    );
}

// -------------------------------------------------------------------
// Test 8: multiple hyperlinks on different cells
// -------------------------------------------------------------------

#[test]
fn test_multiple_hyperlinks_different_cells() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "https://a.com",
    );
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        1,
        1,
        "https://b.com",
    );
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        2,
        2,
        "https://c.com",
    );

    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
        Some("https://a.com".to_string())
    );
    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 1, 1),
        Some("https://b.com".to_string())
    );
    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 2, 2),
        Some("https://c.com".to_string())
    );

    // Remove one, others unaffected
    remove_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        1,
        1,
    );
    assert!(get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 1, 1).is_none());
    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
        Some("https://a.com".to_string())
    );
    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 2, 2),
        Some("https://c.com".to_string())
    );
}

// -------------------------------------------------------------------
// Test 9: overwrite hyperlink URL
// -------------------------------------------------------------------

#[test]
fn test_overwrite_hyperlink_url() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "https://old.com",
    );
    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
        Some("https://old.com".to_string())
    );

    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "https://new.com",
    );
    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
        Some("https://new.com".to_string())
    );
}

// -------------------------------------------------------------------
// Test 10: remove_hyperlink on cell with no hyperlink is no-op
// -------------------------------------------------------------------

#[test]
fn test_remove_hyperlink_no_hyperlink_is_noop() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    // Seed cell with value but no hyperlink
    let cell_hex = seed_cell(&storage, &mut grid, sheet_id, 0, 0, Any::Number(10.0));

    // Remove should be a no-op (cell still has value)
    remove_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
    );

    // Cell should still exist
    assert!(cell_exists(&storage, sheet_id, &cell_hex));
}

// -------------------------------------------------------------------
// Test 11: remove_hyperlink on nonexistent position is no-op
// -------------------------------------------------------------------

#[test]
fn test_remove_hyperlink_nonexistent_position_is_noop() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    // Should not panic
    remove_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        99,
        99,
    );
}

// -------------------------------------------------------------------
// Test 12: remove_hyperlink preserves cell with formula
// -------------------------------------------------------------------

#[test]
fn test_remove_hyperlink_preserves_cell_with_formula() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    // Seed a cell with a formula
    let cell_hex = seed_cell_with_formula(
        &storage,
        &mut grid,
        sheet_id,
        0,
        0,
        Any::Number(100.0),
        "=SUM(A1:A10)",
    );

    // Add and remove hyperlink
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "https://formula.test",
    );
    remove_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
    );

    // Cell should still exist (has formula)
    assert!(cell_exists(&storage, sheet_id, &cell_hex));

    // Verify formula is preserved
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    let cell_map = match cells_map.get(&txn, &*cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell should exist"),
    };
    assert!(matches!(
        cell_map.get(&txn, KEY_FORMULA),
        Some(Out::Any(Any::String(s))) if &*s == "=SUM(A1:A10)"
    ));
}

// -------------------------------------------------------------------
// Test 13: set_hyperlink with various URL schemes
// -------------------------------------------------------------------

#[test]
fn test_hyperlink_various_url_schemes() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    let urls = [
        "https://example.com",
        "http://plain.example.com",
        "mailto:user@example.com",
        "ftp://files.example.com/doc.pdf",
        "#Sheet2!A1",
    ];

    for (i, url) in urls.iter().enumerate() {
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            i as u32,
            0,
            url,
        );
        assert_eq!(
            get_hyperlink(
                storage.doc(),
                &storage.sheets_ref(),
                &sheet_id,
                &grid,
                i as u32,
                0
            ),
            Some(url.to_string()),
            "URL scheme '{}' should round-trip",
            url
        );
    }
}

// -------------------------------------------------------------------
// Test 14: overwrite hyperlink on marker cell then remove deletes cell
// -------------------------------------------------------------------

#[test]
fn test_overwrite_then_remove_marker_cell() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    // Create marker cell with hyperlink
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        7,
        7,
        "https://first.com",
    );
    assert!(pos_exists_in_grid(&grid, 7, 7));

    // Overwrite
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        7,
        7,
        "https://second.com",
    );
    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 7, 7),
        Some("https://second.com".to_string())
    );

    // Remove -- should delete marker cell
    remove_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        7,
        7,
    );
    assert!(get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 7, 7).is_none());
    assert!(!pos_exists_in_grid(&grid, 7, 7));
}

#[test]
fn test_get_hyperlink_full_returns_all_cell_metadata() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        0,
        0,
        vec![
            (KEY_HYPERLINK, Any::String(Arc::from("https://example.com"))),
            (KEY_HYPERLINK_LOCATION, Any::String(Arc::from("Sheet2!A1"))),
            (KEY_HYPERLINK_DISPLAY, Any::String(Arc::from("Example"))),
            (KEY_HYPERLINK_TOOLTIP, Any::String(Arc::from("Open link"))),
            (KEY_HYPERLINK_UID, Any::String(Arc::from("{uid-1}"))),
            (
                KEY_HYPERLINK_TARGET_KIND,
                Any::String(Arc::from("relationship")),
            ),
            (
                KEY_HYPERLINK_TARGET_MODE,
                Any::String(Arc::from("External")),
            ),
        ],
    );

    let link = get_hyperlink_full(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0)
        .expect("hyperlink metadata should decode");

    assert_eq!(link.cell_ref, "");
    assert_eq!(link.target.as_deref(), Some("https://example.com"));
    assert_eq!(link.location.as_deref(), Some("Sheet2!A1"));
    assert_eq!(link.display.as_deref(), Some("Example"));
    assert_eq!(link.tooltip.as_deref(), Some("Open link"));
    assert_eq!(link.uid.as_deref(), Some("{uid-1}"));
    assert_eq!(link.target_kind, Some(HyperlinkTargetKind::Relationship));
    assert_eq!(link.target_mode.as_deref(), Some("External"));
}

#[test]
fn test_get_all_hyperlinks_location_key_overrides_hash_location() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        0,
        0,
        vec![
            (KEY_HYPERLINK, Any::String(Arc::from("#Old!A1"))),
            (KEY_HYPERLINK_LOCATION, Any::String(Arc::from("New!B2"))),
        ],
    );

    let links = get_all_hyperlinks(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid);

    assert_eq!(links.len(), 1);
    assert_eq!(links[0].target, None);
    assert_eq!(links[0].location.as_deref(), Some("New!B2"));
}

#[test]
fn test_get_all_hyperlinks_uid_only_marker_has_no_target_or_location() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        0,
        0,
        vec![
            (KEY_HYPERLINK, Any::String(Arc::from(""))),
            (KEY_HYPERLINK_UID, Any::String(Arc::from("{uid-only}"))),
        ],
    );

    let links = get_all_hyperlinks(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid);

    assert_eq!(links.len(), 1);
    assert_eq!(links[0].target, None);
    assert_eq!(links[0].location, None);
    assert_eq!(links[0].uid.as_deref(), Some("{uid-only}"));
    assert_eq!(links[0].target_kind, None);
}

#[test]
fn test_get_all_hyperlinks_uses_range_ref_and_document_order() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        4,
        0,
        vec![
            (KEY_HYPERLINK, Any::String(Arc::from("https://last.test"))),
            (KEY_HYPERLINK_RANGE_REF, Any::String(Arc::from("A5:B6"))),
        ],
    );
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        0,
        0,
        vec![
            (KEY_HYPERLINK, Any::String(Arc::from("https://second.test"))),
            (KEY_HYPERLINK_ORDER, Any::Number(2.0)),
        ],
    );
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        1,
        0,
        vec![
            (KEY_HYPERLINK, Any::String(Arc::from("https://first.test"))),
            (KEY_HYPERLINK_ORDER, Any::Number(1.0)),
        ],
    );

    let links = get_all_hyperlinks(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid);

    assert_eq!(links.len(), 3);
    assert_eq!(links[0].target.as_deref(), Some("https://first.test"));
    assert_eq!(links[1].target.as_deref(), Some("https://second.test"));
    assert_eq!(links[2].cell_ref, "A5:B6");
}

#[test]
fn test_get_all_hyperlinks_unordered_links_sort_by_cell_ref() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        2,
        0,
        vec![(KEY_HYPERLINK, Any::String(Arc::from("https://a3.test")))],
    );
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        0,
        0,
        vec![(KEY_HYPERLINK, Any::String(Arc::from("https://a1.test")))],
    );

    let links = get_all_hyperlinks(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid);

    assert_eq!(links.len(), 2);
    assert_eq!(links[0].cell_ref, "A1");
    assert_eq!(links[1].cell_ref, "A3");
}

#[test]
fn test_get_all_hyperlinks_unknown_target_kind_uses_explicit_kind_fallback() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        0,
        0,
        vec![
            (KEY_HYPERLINK, Any::String(Arc::from("#Sheet2!A1"))),
            (
                KEY_HYPERLINK_TARGET_KIND,
                Any::String(Arc::from("unknownKind")),
            ),
        ],
    );

    let links = get_all_hyperlinks(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid);

    assert_eq!(links.len(), 1);
    assert_eq!(links[0].target.as_deref(), Some("#Sheet2!A1"));
    assert_eq!(links[0].location, None);
    assert_eq!(links[0].target_kind, None);
}

#[test]
fn test_remove_hyperlink_deletes_marker_cell_with_stale_range_metadata() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_hyperlink_cell(
        &storage,
        &mut grid,
        sheet_id,
        0,
        0,
        vec![
            (KEY_HYPERLINK, Any::String(Arc::from("https://stale.test"))),
            (KEY_HYPERLINK_RANGE_REF, Any::String(Arc::from("A1:B2"))),
            (KEY_HYPERLINK_ORDER, Any::Number(4.0)),
        ],
    );
    let cell_id = grid.cell_id_at(0, 0).unwrap();
    let cell_hex = id_to_hex(cell_id.as_u128());

    remove_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
    );

    assert!(!cell_exists(&storage, sheet_id, &cell_hex));
    assert!(!pos_exists_in_grid(&grid, 0, 0));
}

#[test]
fn test_set_hyperlink_marker_cell_mirrors_identity_to_yrs_grid_index() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        5,
        3,
        "https://identity.test",
    );

    let cell_id = grid.cell_id_at(5, 3).unwrap();
    let cell_hex = id_to_hex(cell_id.as_u128());
    let row_hex = grid.row_id_hex(5).unwrap();
    let col_hex = grid.col_id_hex(3).unwrap();
    let pos_key = format!("{}:{}", row_hex, col_hex);
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let sheet_map = match storage.sheets_ref().get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("sheet should exist"),
    };
    let grid_index = match sheet_map.get(&txn, KEY_GRID_INDEX) {
        Some(Out::YMap(m)) => m,
        _ => panic!("grid index should exist"),
    };
    let pos_to_id = match grid_index.get(&txn, "posToId") {
        Some(Out::YMap(m)) => m,
        _ => panic!("posToId should exist"),
    };
    let id_to_pos = match grid_index.get(&txn, "idToPos") {
        Some(Out::YMap(m)) => m,
        _ => panic!("idToPos should exist"),
    };

    assert!(matches!(
        pos_to_id.get(&txn, pos_key.as_str()),
        Some(Out::Any(Any::String(s))) if s.as_ref() == cell_hex.as_str()
    ));
    assert!(matches!(
        id_to_pos.get(&txn, &cell_hex),
        Some(Out::Any(Any::String(s))) if s.as_ref() == pos_key.as_str()
    ));
}
