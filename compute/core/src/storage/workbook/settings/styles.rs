use std::sync::Arc;

use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::slicer::{NamedSlicerStyle, SlicerCustomStyle};
use value_types::ComputeError;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::storage::infra::yrs_helpers::read_string;

use super::map::{ensure_settings_map, get_settings_map};

pub fn set_default_table_style_id(doc: &Doc, workbook: &MapRef, style_id: Option<&str>) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    match style_id {
        Some(id) => {
            settings_map.insert(&mut txn, "defaultTableStyleId", Any::String(Arc::from(id)));
        }
        None => {
            settings_map.remove(&mut txn, "defaultTableStyleId");
        }
    }
}

/// Get the default table style ID for new tables.
pub fn get_default_table_style_id(doc: &Doc, workbook: &MapRef) -> Option<String> {
    let txn = doc.transact();
    let settings_map = get_settings_map(workbook, &txn)?;
    read_string(&settings_map, &txn, "defaultTableStyleId")
}

/// Set the default slicer style for new slicers.
/// Pass `None` to clear the default (will use 'light1').
pub fn set_default_slicer_style(doc: &Doc, workbook: &MapRef, style_id: Option<&str>) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    match style_id {
        Some(id) => {
            settings_map.insert(&mut txn, "defaultSlicerStyle", Any::String(Arc::from(id)));
        }
        None => {
            settings_map.remove(&mut txn, "defaultSlicerStyle");
        }
    }
}

/// Get the default slicer style for new slicers.
pub fn get_default_slicer_style(doc: &Doc, workbook: &MapRef) -> Option<String> {
    let txn = doc.transact();
    let settings_map = get_settings_map(workbook, &txn)?;
    read_string(&settings_map, &txn, "defaultSlicerStyle")
}

/// Set the default pivot table style for new pivot tables.
/// Pass `None` to clear the default (will use 'PivotStyleLight16').
pub fn set_default_pivot_table_style(doc: &Doc, workbook: &MapRef, style_id: Option<&str>) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    match style_id {
        Some(id) => {
            settings_map.insert(
                &mut txn,
                "defaultPivotTableStyle",
                Any::String(Arc::from(id)),
            );
        }
        None => {
            settings_map.remove(&mut txn, "defaultPivotTableStyle");
        }
    }
}

/// Get the default pivot table style for new pivot tables.
pub fn get_default_pivot_table_style(doc: &Doc, workbook: &MapRef) -> Option<String> {
    let txn = doc.transact();
    let settings_map = get_settings_map(workbook, &txn)?;
    read_string(&settings_map, &txn, "defaultPivotTableStyle")
}

// ---------------------------------------------------------------------------
// Named Slicer Style Registry
// ---------------------------------------------------------------------------

/// Key within the settings map that holds the named slicer styles sub-map.
const KEY_NAMED_SLICER_STYLES: &str = "namedSlicerStyles";

/// Ensure the named slicer styles sub-map exists, creating it if necessary.
fn ensure_named_slicer_styles_map(
    settings_map: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
) -> MapRef {
    match settings_map.get(txn, KEY_NAMED_SLICER_STYLES) {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            settings_map.insert(txn, KEY_NAMED_SLICER_STYLES, empty)
        }
    }
}

/// Get the named slicer styles sub-map (read-only).
fn get_named_slicer_styles_map<T: yrs::ReadTxn>(settings_map: &MapRef, txn: &T) -> Option<MapRef> {
    match settings_map.get(txn, KEY_NAMED_SLICER_STYLES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Generate a unique name by appending a numeric suffix if needed.
fn make_unique_style_name<T: yrs::ReadTxn>(
    styles_map: &MapRef,
    txn: &T,
    base_name: &str,
) -> String {
    if styles_map.get(txn, base_name).is_none() {
        return base_name.to_string();
    }
    let mut suffix = 1u32;
    loop {
        let candidate = format!("{base_name}{suffix}");
        if styles_map.get(txn, candidate.as_str()).is_none() {
            return candidate;
        }
        suffix += 1;
    }
}

/// Add a named slicer style to the workbook registry.
///
/// If `make_unique` is `true` and a style with the given name already exists,
/// a numeric suffix is appended to make the name unique. When `make_unique` is
/// `false`, an error is returned if a style with the given name already exists.
/// Returns the final name used.
pub fn add_named_slicer_style(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
    style: SlicerCustomStyle,
    make_unique: bool,
) -> Result<String, ComputeError> {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);
    let styles_map = ensure_named_slicer_styles_map(&settings_map, &mut txn);

    let final_name = if make_unique {
        make_unique_style_name(&styles_map, &txn, name)
    } else {
        // Reject if a style with this name already exists.
        if styles_map.get(&txn, name).is_some() {
            return Err(ComputeError::InvalidInput {
                message: format!("Slicer style '{name}' already exists"),
            });
        }
        name.to_string()
    };

    let named_style = NamedSlicerStyle {
        name: final_name.clone(),
        read_only: false,
        style,
    };
    let json_str = serde_json::to_string(&named_style).map_err(|e| ComputeError::InvalidInput {
        message: format!("Failed to serialize slicer style: {e}"),
    })?;
    styles_map.insert(
        &mut txn,
        final_name.as_str(),
        Any::String(Arc::from(json_str.as_str())),
    );
    Ok(final_name)
}

/// Get a named slicer style by name.
///
/// Returns `Ok(Some(style))` if found, `Ok(None)` if no entry exists for that
/// name, or `Err` if the stored data is corrupted and cannot be deserialized.
pub fn get_named_slicer_style(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
) -> Result<Option<NamedSlicerStyle>, ComputeError> {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return Ok(None),
    };
    let styles_map = match get_named_slicer_styles_map(&settings_map, &txn) {
        Some(m) => m,
        None => return Ok(None),
    };
    match styles_map.get(&txn, name) {
        Some(Out::Any(Any::String(s))) => match serde_json::from_str::<NamedSlicerStyle>(&s) {
            Ok(style) => Ok(Some(style)),
            Err(e) => {
                tracing::warn!("Failed to deserialize named slicer style '{name}': {e}");
                Err(ComputeError::InvalidInput {
                    message: format!("Corrupted slicer style data for '{name}': {e}"),
                })
            }
        },
        _ => Ok(None),
    }
}

/// Delete a named slicer style. Fails if the style is read-only or not found.
///
/// All checks and the removal are performed within a single mutable
/// transaction to avoid TOCTOU races.
pub fn delete_named_slicer_style(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
) -> Result<(), ComputeError> {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    // Navigate to the styles map. A TransactionMut implements ReadTxn, so we
    // can use `get_settings_map` (read-only lookup) within the mutable txn.
    let settings_map =
        get_settings_map(workbook, &txn).ok_or_else(|| ComputeError::InvalidInput {
            message: format!("Named slicer style not found: {name}"),
        })?;
    let styles_map = get_named_slicer_styles_map(&settings_map, &txn).ok_or_else(|| {
        ComputeError::InvalidInput {
            message: format!("Named slicer style not found: {name}"),
        }
    })?;

    // Check existence and read_only status.
    let existing = match styles_map.get(&txn, name) {
        Some(Out::Any(Any::String(s))) => match serde_json::from_str::<NamedSlicerStyle>(&s) {
            Ok(style) => Some(style),
            Err(e) => {
                tracing::warn!("Failed to deserialize named slicer style '{name}': {e}");
                return Err(ComputeError::InvalidInput {
                    message: format!("Corrupted slicer style data for '{name}': {e}"),
                });
            }
        },
        _ => None,
    };

    match existing {
        None => {
            return Err(ComputeError::InvalidInput {
                message: format!("Named slicer style not found: {name}"),
            });
        }
        Some(style) if style.read_only => {
            return Err(ComputeError::InvalidInput {
                message: format!("Cannot delete read-only slicer style: {name}"),
            });
        }
        _ => {}
    }

    // Perform the deletion within the same transaction.
    styles_map.remove(&mut txn, name);
    Ok(())
}

/// Duplicate a named slicer style, creating a copy with a unique name.
///
/// The new name is formed as "{original} Copy", with a numeric suffix if that
/// name is already taken. The read + write are performed in a single mutable
/// transaction to avoid TOCTOU races. Returns the new style's name.
pub fn duplicate_named_slicer_style(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
) -> Result<String, ComputeError> {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);
    let styles_map = ensure_named_slicer_styles_map(&settings_map, &mut txn);

    // Read the original style within this transaction.
    let original = match styles_map.get(&txn, name) {
        Some(Out::Any(Any::String(s))) => {
            serde_json::from_str::<NamedSlicerStyle>(&s).map_err(|e| {
                tracing::warn!("Failed to deserialize named slicer style '{name}': {e}");
                ComputeError::InvalidInput {
                    message: format!("Corrupted slicer style data for '{name}': {e}"),
                }
            })?
        }
        _ => {
            return Err(ComputeError::InvalidInput {
                message: format!("Named slicer style not found: {name}"),
            });
        }
    };

    // Generate unique name and insert, all within the same transaction.
    let base_copy_name = format!("{name} Copy");
    let final_name = make_unique_style_name(&styles_map, &txn, &base_copy_name);

    let new_style = NamedSlicerStyle {
        name: final_name.clone(),
        read_only: false,
        style: original.style,
    };
    let json_str = serde_json::to_string(&new_style).map_err(|e| ComputeError::InvalidInput {
        message: format!("Failed to serialize slicer style: {e}"),
    })?;
    styles_map.insert(
        &mut txn,
        final_name.as_str(),
        Any::String(Arc::from(json_str.as_str())),
    );
    Ok(final_name)
}

/// Get the count of named slicer styles in the registry.
pub fn get_named_slicer_style_count(doc: &Doc, workbook: &MapRef) -> u32 {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return 0,
    };
    let styles_map = match get_named_slicer_styles_map(&settings_map, &txn) {
        Some(m) => m,
        None => return 0,
    };
    styles_map.len(&txn)
}

/// List all named slicer styles in the registry.
pub fn list_named_slicer_styles(doc: &Doc, workbook: &MapRef) -> Vec<NamedSlicerStyle> {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return Vec::new(),
    };
    let styles_map = match get_named_slicer_styles_map(&settings_map, &txn) {
        Some(m) => m,
        None => return Vec::new(),
    };

    let mut result = Vec::new();
    for (key, value) in styles_map.iter(&txn) {
        if let Out::Any(Any::String(s)) = value {
            match serde_json::from_str::<NamedSlicerStyle>(&s) {
                Ok(style) => result.push(style),
                Err(e) => {
                    tracing::warn!("Skipping corrupted named slicer style '{key}': {e}");
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;

    #[test]
    fn test_default_table_style_id() {
        let storage = YrsStorage::new();

        // Default: none
        assert!(get_default_table_style_id(storage.doc(), storage.workbook_map()).is_none());

        // Set a style
        set_default_table_style_id(storage.doc(), storage.workbook_map(), Some("dark1"));
        assert_eq!(
            get_default_table_style_id(storage.doc(), storage.workbook_map()),
            Some("dark1".to_string())
        );

        // Clear the style
        set_default_table_style_id(storage.doc(), storage.workbook_map(), None);
        assert!(get_default_table_style_id(storage.doc(), storage.workbook_map()).is_none());
    }

    // -------------------------------------------------------------------
    // Test 14: get_setting returns correct value
    // -------------------------------------------------------------------
    fn make_slicer_style(header_bg: &str) -> SlicerCustomStyle {
        SlicerCustomStyle {
            header_background_color: Some(header_bg.to_string()),
            header_text_color: Some("#FFFFFF".to_string()),
            header_font_size: Some(14.0),
            selected_background_color: Some("#0000FF".to_string()),
            selected_text_color: Some("#FFFFFF".to_string()),
            available_background_color: Some("#EEEEEE".to_string()),
            available_text_color: Some("#000000".to_string()),
            unavailable_background_color: None,
            unavailable_text_color: None,
            border_color: Some("#CCCCCC".to_string()),
            border_width: Some(1.0),
            item_border_radius: Some(4.0),
        }
    }

    // -------------------------------------------------------------------
    // Test 24: Add and get a named slicer style
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_add_and_get() {
        let storage = YrsStorage::new();
        let style = make_slicer_style("#FF0000");

        let name = add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "MyRedStyle",
            style.clone(),
            false,
        )
        .unwrap();
        assert_eq!(name, "MyRedStyle");

        let retrieved = get_named_slicer_style(storage.doc(), storage.workbook_map(), "MyRedStyle")
            .unwrap()
            .expect("style should exist");
        assert_eq!(retrieved.name, "MyRedStyle");
        assert!(!retrieved.read_only);
        assert_eq!(
            retrieved.style.header_background_color,
            Some("#FF0000".to_string())
        );
        assert_eq!(
            retrieved.style.header_text_color,
            Some("#FFFFFF".to_string())
        );
        assert_eq!(retrieved.style.header_font_size, Some(14.0));
        assert_eq!(
            retrieved.style.selected_background_color,
            Some("#0000FF".to_string())
        );
        assert_eq!(retrieved.style.border_width, Some(1.0));
        assert_eq!(retrieved.style.item_border_radius, Some(4.0));
        assert_eq!(retrieved.style, style);
    }

    // -------------------------------------------------------------------
    // Test 25: make_unique_name generates unique suffix on conflict
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_make_unique_name() {
        let storage = YrsStorage::new();

        let name1 = add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Corporate",
            make_slicer_style("#111111"),
            true,
        )
        .unwrap();
        assert_eq!(name1, "Corporate", "first add should use the name as-is");

        let name2 = add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Corporate",
            make_slicer_style("#222222"),
            true,
        )
        .unwrap();
        assert_eq!(name2, "Corporate1", "second add should get suffix 1");

        let name3 = add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Corporate",
            make_slicer_style("#333333"),
            true,
        )
        .unwrap();
        assert_eq!(name3, "Corporate2", "third add should get suffix 2");

        // All three should be independently retrievable.
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "Corporate")
                .unwrap()
                .is_some()
        );
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "Corporate1")
                .unwrap()
                .is_some()
        );
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "Corporate2")
                .unwrap()
                .is_some()
        );
    }

    // -------------------------------------------------------------------
    // Test 26: Delete non-read-only style succeeds
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_delete_non_readonly() {
        let storage = YrsStorage::new();

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Deletable",
            make_slicer_style("#AABBCC"),
            false,
        )
        .unwrap();
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "Deletable")
                .unwrap()
                .is_some()
        );

        delete_named_slicer_style(storage.doc(), storage.workbook_map(), "Deletable")
            .expect("delete should succeed for non-read-only style");

        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "Deletable")
                .unwrap()
                .is_none(),
            "style should be gone after deletion"
        );
    }

    // -------------------------------------------------------------------
    // Test 27: Delete read-only style fails
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_delete_readonly_fails() {
        let storage = YrsStorage::new();

        // Manually insert a read-only style by writing directly to the Yrs map.
        let read_only_style = NamedSlicerStyle {
            name: "BuiltIn".to_string(),
            read_only: true,
            style: make_slicer_style("#000000"),
        };
        {
            let mut txn = storage
                .doc()
                .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            let settings_map = ensure_settings_map(storage.workbook_map(), &mut txn);
            let styles_map = ensure_named_slicer_styles_map(&settings_map, &mut txn);
            let json_str = serde_json::to_string(&read_only_style).unwrap();
            styles_map.insert(
                &mut txn,
                "BuiltIn",
                Any::String(Arc::from(json_str.as_str())),
            );
        }

        // Verify it exists and is read-only.
        let retrieved = get_named_slicer_style(storage.doc(), storage.workbook_map(), "BuiltIn")
            .unwrap()
            .unwrap();
        assert!(retrieved.read_only);

        // Attempt to delete should fail.
        let result = delete_named_slicer_style(storage.doc(), storage.workbook_map(), "BuiltIn");
        assert!(result.is_err(), "deleting a read-only style should fail");
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("read-only"),
            "error message should mention read-only, got: {err_msg}"
        );

        // Style should still exist.
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "BuiltIn")
                .unwrap()
                .is_some()
        );
    }

    // -------------------------------------------------------------------
    // Test 28: Delete non-existent style fails
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_delete_nonexistent_fails() {
        let storage = YrsStorage::new();

        let result =
            delete_named_slicer_style(storage.doc(), storage.workbook_map(), "DoesNotExist");
        assert!(result.is_err(), "deleting non-existent style should fail");
    }

    // -------------------------------------------------------------------
    // Test 29: Duplicate creates copy with new name
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_duplicate() {
        let storage = YrsStorage::new();
        let original_style = make_slicer_style("#ABCDEF");

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Original",
            original_style.clone(),
            false,
        )
        .unwrap();

        let copy_name =
            duplicate_named_slicer_style(storage.doc(), storage.workbook_map(), "Original")
                .expect("duplicate should succeed");
        assert_eq!(copy_name, "Original Copy");

        let copy = get_named_slicer_style(storage.doc(), storage.workbook_map(), &copy_name)
            .unwrap()
            .unwrap();
        assert_eq!(copy.name, "Original Copy");
        assert!(!copy.read_only);
        assert_eq!(
            copy.style, original_style,
            "duplicated style properties should match original"
        );

        // Original should still exist and be unchanged.
        let original = get_named_slicer_style(storage.doc(), storage.workbook_map(), "Original")
            .unwrap()
            .unwrap();
        assert_eq!(original.style, original_style);
    }

    // -------------------------------------------------------------------
    // Test 30: Duplicate with name conflict appends suffix
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_duplicate_name_conflict() {
        let storage = YrsStorage::new();

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Base",
            make_slicer_style("#111111"),
            false,
        )
        .unwrap();

        // Pre-create "Base Copy" to force a conflict.
        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Base Copy",
            make_slicer_style("#222222"),
            false,
        )
        .unwrap();

        let dup_name =
            duplicate_named_slicer_style(storage.doc(), storage.workbook_map(), "Base").unwrap();
        assert_eq!(
            dup_name, "Base Copy1",
            "duplicate should append suffix when 'Base Copy' already exists"
        );
    }

    // -------------------------------------------------------------------
    // Test 31: Count reflects current registry size
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_count() {
        let storage = YrsStorage::new();

        // Initially zero.
        assert_eq!(
            get_named_slicer_style_count(storage.doc(), storage.workbook_map()),
            0
        );

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "S1",
            make_slicer_style("#AA0000"),
            false,
        )
        .unwrap();
        assert_eq!(
            get_named_slicer_style_count(storage.doc(), storage.workbook_map()),
            1
        );

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "S2",
            make_slicer_style("#00AA00"),
            false,
        )
        .unwrap();
        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "S3",
            make_slicer_style("#0000AA"),
            false,
        )
        .unwrap();
        assert_eq!(
            get_named_slicer_style_count(storage.doc(), storage.workbook_map()),
            3
        );

        // Delete one, count should decrease.
        delete_named_slicer_style(storage.doc(), storage.workbook_map(), "S2").unwrap();
        assert_eq!(
            get_named_slicer_style_count(storage.doc(), storage.workbook_map()),
            2
        );
    }

    // -------------------------------------------------------------------
    // Test 32: List returns all styles
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_list_all() {
        let storage = YrsStorage::new();

        // Initially empty.
        let styles = list_named_slicer_styles(storage.doc(), storage.workbook_map());
        assert!(styles.is_empty());

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Alpha",
            make_slicer_style("#A00000"),
            false,
        )
        .unwrap();
        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Beta",
            make_slicer_style("#00B000"),
            false,
        )
        .unwrap();
        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Gamma",
            make_slicer_style("#0000C0"),
            false,
        )
        .unwrap();

        let styles = list_named_slicer_styles(storage.doc(), storage.workbook_map());
        assert_eq!(styles.len(), 3);

        let mut names: Vec<String> = styles.iter().map(|s| s.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["Alpha", "Beta", "Gamma"]);

        // Verify each style has the correct header_background_color.
        let alpha = styles.iter().find(|s| s.name == "Alpha").unwrap();
        assert_eq!(
            alpha.style.header_background_color,
            Some("#A00000".to_string())
        );
        let beta = styles.iter().find(|s| s.name == "Beta").unwrap();
        assert_eq!(
            beta.style.header_background_color,
            Some("#00B000".to_string())
        );
        let gamma = styles.iter().find(|s| s.name == "Gamma").unwrap();
        assert_eq!(
            gamma.style.header_background_color,
            Some("#0000C0".to_string())
        );
    }

    // -------------------------------------------------------------------
    // Test 33: Get non-existent style returns None
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_get_nonexistent() {
        let storage = YrsStorage::new();
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "NoSuchStyle")
                .unwrap()
                .is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 34: Add with make_unique=false errors on duplicate name
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_add_duplicate_without_make_unique_fails() {
        let storage = YrsStorage::new();

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Existing",
            make_slicer_style("#FF0000"),
            false,
        )
        .unwrap();

        // Second add with same name and make_unique=false should error.
        let result = add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Existing",
            make_slicer_style("#00FF00"),
            false,
        );
        assert!(
            result.is_err(),
            "adding duplicate name with make_unique=false should fail"
        );
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("already exists"),
            "error should mention 'already exists', got: {err_msg}"
        );

        // Original style should be unchanged.
        let retrieved = get_named_slicer_style(storage.doc(), storage.workbook_map(), "Existing")
            .unwrap()
            .unwrap();
        assert_eq!(
            retrieved.style.header_background_color,
            Some("#FF0000".to_string()),
            "original style should not have been overwritten"
        );
    }
}
