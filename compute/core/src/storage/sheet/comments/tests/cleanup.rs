use super::super::*;
use super::helpers::*;

#[test]
fn test_validate_and_clean_orphaned_comments() {
    let (mut storage, sheet_id) = storage_with_sheet();
    let grid = native_grid_with_cell(sheet_id, "00000000000000000000000000000001");
    add_comment(
        &mut storage,
        &sheet_id,
        "00000000000000000000000000000001",
        simple_runs("Valid comment"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    add_comment(
        &mut storage,
        &sheet_id,
        "orphaned-cell",
        simple_runs("Orphaned comment"),
        "Bob",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(get_comment_count(&storage, &sheet_id), 2);
    let removed = validate_and_clean_comments(&mut storage, &sheet_id, &grid);
    assert_eq!(removed, 1);
    assert_eq!(get_comment_count(&storage, &sheet_id), 1);
    assert!(has_comments(
        &storage,
        &sheet_id,
        "00000000000000000000000000000001"
    ));
    assert!(!has_comments(&storage, &sheet_id, "orphaned-cell"));
}

#[test]
fn test_validate_and_clean_no_orphans() {
    let (mut storage, sheet_id) = storage_with_sheet();
    let grid = native_grid_with_cell(sheet_id, "00000000000000000000000000000001");
    add_comment(
        &mut storage,
        &sheet_id,
        "00000000000000000000000000000001",
        simple_runs("Valid"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let removed = validate_and_clean_comments(&mut storage, &sheet_id, &grid);
    assert_eq!(removed, 0);
    assert_eq!(get_comment_count(&storage, &sheet_id), 1);
}

#[test]
fn test_validate_and_clean_preserves_cell_from_grid_index() {
    let (mut storage, sheet_id) = storage_with_sheet();
    let grid = native_grid_with_cell(sheet_id, "00000000000000000000000000000001");
    add_comment(
        &mut storage,
        &sheet_id,
        "00000000000000000000000000000001",
        simple_runs("Valid through grid index"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    add_comment(
        &mut storage,
        &sheet_id,
        "orphaned-cell",
        simple_runs("Orphan"),
        "Bob",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let removed = validate_and_clean_comments(&mut storage, &sheet_id, &grid);
    assert_eq!(removed, 1);
    assert!(has_comments(
        &storage,
        &sheet_id,
        "00000000000000000000000000000001"
    ));
    assert!(!has_comments(&storage, &sheet_id, "orphaned-cell"));
}
