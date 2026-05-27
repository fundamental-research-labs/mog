use super::fixtures::*;

#[test]
fn test_drain_clears_buffer() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let observer = new_observer(&sheets, &workbook);

    insert_cell(&doc, &sheets, &sheet_hex, make_cell_id(600), 1.0, None);
    assert_eq!(observer.pending_count(), 1);

    let changes = observer.drain_changes();
    assert_eq!(changes.len(), 1);

    assert!(!observer.has_changes());
    assert_eq!(observer.pending_count(), 0);
    assert!(observer.drain_changes().is_empty());
}

#[test]
fn test_debug_format() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    let observer = new_observer(&sheets, &workbook);

    let debug = format!("{:?}", observer);
    assert!(debug.contains("DocumentObserver"));
    assert!(debug.contains("pending_changes: 0"));

    insert_cell(&doc, &sheets, &sheet_hex, make_cell_id(1000), 1.0, None);
    let debug = format!("{:?}", observer);
    assert!(debug.contains("pending_changes: 1"));
}

#[test]
fn test_set_suppressed_true_makes_is_suppressed_true() {
    let (_doc, sheets, workbook) = setup_doc();
    let observer = new_observer(&sheets, &workbook);

    observer.set_suppressed(true);
    assert!(observer.is_suppressed());
}

#[test]
fn test_set_suppressed_false_makes_is_suppressed_false() {
    let (_doc, sheets, workbook) = setup_doc();
    let observer = new_observer(&sheets, &workbook);

    observer.set_suppressed(true);
    observer.set_suppressed(false);
    assert!(!observer.is_suppressed());
}

#[test]
fn test_nested_suppression() {
    let (_doc, sheets, workbook) = setup_doc();
    let observer = new_observer(&sheets, &workbook);

    observer.set_suppressed(true);
    observer.set_suppressed(true);
    assert!(observer.is_suppressed(), "still suppressed after two trues");

    observer.set_suppressed(false);
    assert!(
        observer.is_suppressed(),
        "still suppressed after one false (need two)"
    );

    observer.set_suppressed(false);
    assert!(
        !observer.is_suppressed(),
        "unsuppressed after matching two falses"
    );
}

#[test]
fn test_changes_during_suppression_not_recorded() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(100);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    let observer = new_observer(&sheets, &workbook);

    observer.set_suppressed(true);

    // Insert a cell while suppressed — should NOT be recorded.
    let cell_id = make_cell_id(200);
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 42.0, None);

    let changes = observer.drain_all_changes();
    assert!(
        changes.cells.is_empty(),
        "no cell changes should be recorded while suppressed"
    );

    observer.set_suppressed(false);
}

#[test]
fn test_changes_after_unsuppression_are_recorded() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(101);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
    let observer = new_observer(&sheets, &workbook);

    // Suppress and unsuppress.
    observer.set_suppressed(true);
    observer.set_suppressed(false);

    // Insert a cell after unsuppression — should be recorded.
    let cell_id = make_cell_id(201);
    insert_cell(&doc, &sheets, &sheet_hex, cell_id, 99.0, None);

    let changes = observer.drain_all_changes();
    assert!(
        !changes.cells.is_empty(),
        "cell changes should be recorded after unsuppression"
    );
}
