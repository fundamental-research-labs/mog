use crate::mirror::test_helpers::{make_sheet_id, mirror_with_grid, simple_snapshot};
use crate::mirror::{CellMirror, SheetMirror};
use cell_types::SheetId;

#[test]
fn test_remove_sheet() {
    let (mut mirror, sheet_id) = mirror_with_grid();
    mirror.remove_sheet(&sheet_id);

    assert!(mirror.get_sheet(&sheet_id).is_none());
    assert!(mirror.sheet_by_name("Grid").is_none());
}
#[test]
fn test_rename_sheet() {
    let (mut mirror, sheet_id) = mirror_with_grid();
    mirror.rename_sheet(&sheet_id, "Renamed");

    assert!(mirror.sheet_by_name("Grid").is_none());
    assert_eq!(mirror.sheet_by_name("renamed").unwrap(), sheet_id);
    assert_eq!(mirror.get_sheet(&sheet_id).unwrap().name, "Renamed");
}
#[test]
fn test_sheet_name_case_insensitive() {
    let (mirror, sheet_id) = mirror_with_grid();
    assert_eq!(mirror.sheet_by_name("grid"), Some(sheet_id));
    assert_eq!(mirror.sheet_by_name("GRID"), Some(sheet_id));
    assert_eq!(mirror.sheet_by_name("Grid"), Some(sheet_id));
    assert_eq!(mirror.sheet_by_name("gRiD"), Some(sheet_id));
}
#[test]
fn test_sheet_ids_iterator() {
    let snap = simple_snapshot();
    let mirror = CellMirror::from_snapshot(snap).unwrap();
    let ids: Vec<&SheetId> = mirror.sheet_ids().collect();
    assert_eq!(ids.len(), 1);
}
#[test]
fn test_remove_nonexistent_sheet() {
    let (mut mirror, _) = mirror_with_grid();
    // Should not panic
    mirror.remove_sheet(&make_sheet_id(999));
}
#[test]
fn test_rename_nonexistent_sheet() {
    let mut mirror = CellMirror::new();
    // Should not panic
    mirror.rename_sheet(&make_sheet_id(999), "NewName");
}
#[test]
fn test_sheet_name_nfc_nfd_normalization() {
    // "cafe\u{0301}" is NFD (e + combining acute), "caf\u{00e9}" is NFC (precomposed e-acute).
    // Both should resolve to the same sheet.
    let nfc_name = "caf\u{00e9}"; // NFC: é = U+00E9
    let nfd_name = "cafe\u{0301}"; // NFD: e + combining acute U+0301

    // Verify they are indeed different byte sequences
    assert_ne!(nfc_name, nfd_name);

    let sheet_id = make_sheet_id(42);
    let mut mirror = CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, nfc_name.to_string(), 10, 5);
    mirror.add_sheet_mirror(sheet_id, nfc_name.to_string(), sheet_mirror);

    // Look up with NFC name (same encoding as stored)
    assert_eq!(mirror.sheet_by_name(nfc_name), Some(sheet_id));
    // Look up with NFD name (different encoding)
    assert_eq!(mirror.sheet_by_name(nfd_name), Some(sheet_id));
    // Case-insensitive + NFC: uppercase NFD should also work
    let upper_nfd = "CAFE\u{0301}";
    assert_eq!(mirror.sheet_by_name(upper_nfd), Some(sheet_id));
}
#[test]
fn test_sheet_name_nfc_hebrew() {
    // Hebrew with nikud (vowel points) — NFC vs NFD can differ
    // U+05E9 (shin) + U+05C1 (shin dot) = NFC shin-with-dot U+FB2A
    let nfc_name = "\u{FB2A}"; // Precomposed: shin with shin dot
    let nfd_name = "\u{05E9}\u{05C1}"; // Decomposed: shin + shin dot

    let sheet_id = make_sheet_id(43);
    let mut mirror = CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, nfc_name.to_string(), 10, 5);
    mirror.add_sheet_mirror(sheet_id, nfc_name.to_string(), sheet_mirror);

    assert_eq!(mirror.sheet_by_name(nfc_name), Some(sheet_id));
    assert_eq!(mirror.sheet_by_name(nfd_name), Some(sheet_id));
}
#[test]
fn test_rename_sheet_nfc_normalization() {
    let nfc_name = "caf\u{00e9}";
    let nfd_name = "cafe\u{0301}";

    let sheet_id = make_sheet_id(44);
    let mut mirror = CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, "OldName".to_string(), 10, 5);
    mirror.add_sheet_mirror(sheet_id, "OldName".to_string(), sheet_mirror);

    // Rename to NFC name
    mirror.rename_sheet(&sheet_id, nfc_name);
    // Should be findable via NFD name
    assert_eq!(mirror.sheet_by_name(nfd_name), Some(sheet_id));
    // Old name should be gone
    assert!(mirror.sheet_by_name("OldName").is_none());
}
#[test]
fn test_remove_sheet_nfc_normalization() {
    let nfc_name = "caf\u{00e9}";
    let nfd_name = "cafe\u{0301}";

    let sheet_id = make_sheet_id(45);
    let mut mirror = CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, nfc_name.to_string(), 10, 5);
    mirror.add_sheet_mirror(sheet_id, nfc_name.to_string(), sheet_mirror);

    // Verify it exists
    assert_eq!(mirror.sheet_by_name(nfd_name), Some(sheet_id));

    // Remove it
    mirror.remove_sheet(&sheet_id);

    // Should be gone for both encodings
    assert!(mirror.sheet_by_name(nfc_name).is_none());
    assert!(mirror.sheet_by_name(nfd_name).is_none());
}
