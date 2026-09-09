use crate::storage::workbook::WorkbookMetadata;
use domain_types::domain::slicer::{NamedSlicerStyle, SlicerCustomStyle};
use value_types::ComputeError;

pub fn set_default_table_style_id(metadata: &mut WorkbookMetadata, style_id: Option<&str>) {
    metadata.settings.default_table_style_id = style_id.map(str::to_owned);
}
pub fn get_default_table_style_id(metadata: &WorkbookMetadata) -> Option<String> {
    metadata.settings.default_table_style_id.clone()
}

pub fn set_default_slicer_style(metadata: &mut WorkbookMetadata, style_id: Option<&str>) {
    metadata.default_slicer_style = style_id.map(str::to_owned);
}
pub fn get_default_slicer_style(metadata: &WorkbookMetadata) -> Option<String> {
    metadata.default_slicer_style.clone()
}

pub fn set_default_pivot_table_style(metadata: &mut WorkbookMetadata, style_id: Option<&str>) {
    metadata.default_pivot_table_style = style_id.map(str::to_owned);
}
pub fn get_default_pivot_table_style(metadata: &WorkbookMetadata) -> Option<String> {
    metadata.default_pivot_table_style.clone()
}

pub(crate) fn unique_style_name(metadata: &WorkbookMetadata, base: &str) -> String {
    if !metadata.named_slicer_styles.contains_key(base) {
        return base.to_owned();
    }
    for suffix in 1u64.. {
        let name = format!("{base}{suffix}");
        if !metadata.named_slicer_styles.contains_key(&name) {
            return name;
        }
    }
    unreachable!("style registry exhausted")
}

pub fn add_named_slicer_style(
    metadata: &mut WorkbookMetadata,
    name: &str,
    style: SlicerCustomStyle,
    make_unique: bool,
) -> Result<String, ComputeError> {
    let name = if make_unique {
        unique_style_name(metadata, name)
    } else {
        if metadata.named_slicer_styles.contains_key(name) {
            return Err(ComputeError::InvalidInput {
                message: format!("Slicer style '{name}' already exists"),
            });
        }
        name.to_owned()
    };
    metadata.named_slicer_styles.insert(
        name.clone(),
        NamedSlicerStyle {
            name: name.clone(),
            read_only: false,
            style,
        },
    );
    Ok(name)
}

pub fn get_named_slicer_style(metadata: &WorkbookMetadata, name: &str) -> Option<NamedSlicerStyle> {
    metadata.named_slicer_styles.get(name).cloned()
}

pub fn delete_named_slicer_style(
    metadata: &mut WorkbookMetadata,
    name: &str,
) -> Result<(), ComputeError> {
    let style =
        metadata
            .named_slicer_styles
            .get(name)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!("Named slicer style not found: {name}"),
            })?;
    if style.read_only {
        return Err(ComputeError::InvalidInput {
            message: format!("Cannot delete read-only slicer style: {name}"),
        });
    }
    metadata.named_slicer_styles.remove(name);
    Ok(())
}

pub fn duplicate_named_slicer_style(
    metadata: &mut WorkbookMetadata,
    name: &str,
) -> Result<String, ComputeError> {
    let style = metadata
        .named_slicer_styles
        .get(name)
        .ok_or_else(|| ComputeError::InvalidInput {
            message: format!("Named slicer style not found: {name}"),
        })?
        .style
        .clone();
    add_named_slicer_style(metadata, &format!("{name} Copy"), style, true)
}

pub fn get_named_slicer_style_count(metadata: &WorkbookMetadata) -> u32 {
    metadata.named_slicer_styles.len() as u32
}

pub fn list_named_slicer_styles(metadata: &WorkbookMetadata) -> Vec<NamedSlicerStyle> {
    metadata.named_slicer_styles.values().cloned().collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::workbook::WorkbookMetadata;

    #[test]
    fn test_default_table_style_id() {
        let mut metadata = WorkbookMetadata::default();

        // Default: none
        assert!(get_default_table_style_id(&metadata).is_none());

        // Set a style
        set_default_table_style_id(&mut metadata, Some("dark1"));
        assert_eq!(
            get_default_table_style_id(&metadata),
            Some("dark1".to_string())
        );

        // Clear the style
        set_default_table_style_id(&mut metadata, None);
        assert!(get_default_table_style_id(&metadata).is_none());
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
        let mut metadata = WorkbookMetadata::default();
        let style = make_slicer_style("#FF0000");

        let name =
            add_named_slicer_style(&mut metadata, "MyRedStyle", style.clone(), false).unwrap();
        assert_eq!(name, "MyRedStyle");

        let retrieved =
            get_named_slicer_style(&metadata, "MyRedStyle").expect("style should exist");
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
        let mut metadata = WorkbookMetadata::default();

        let name1 = add_named_slicer_style(
            &mut metadata,
            "Corporate",
            make_slicer_style("#111111"),
            true,
        )
        .unwrap();
        assert_eq!(name1, "Corporate", "first add should use the name as-is");

        let name2 = add_named_slicer_style(
            &mut metadata,
            "Corporate",
            make_slicer_style("#222222"),
            true,
        )
        .unwrap();
        assert_eq!(name2, "Corporate1", "second add should get suffix 1");

        let name3 = add_named_slicer_style(
            &mut metadata,
            "Corporate",
            make_slicer_style("#333333"),
            true,
        )
        .unwrap();
        assert_eq!(name3, "Corporate2", "third add should get suffix 2");

        // All three should be independently retrievable.
        assert!(get_named_slicer_style(&metadata, "Corporate").is_some());
        assert!(get_named_slicer_style(&metadata, "Corporate1").is_some());
        assert!(get_named_slicer_style(&metadata, "Corporate2").is_some());
    }

    // -------------------------------------------------------------------
    // Test 26: Delete non-read-only style succeeds
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_delete_non_readonly() {
        let mut metadata = WorkbookMetadata::default();

        add_named_slicer_style(
            &mut metadata,
            "Deletable",
            make_slicer_style("#AABBCC"),
            false,
        )
        .unwrap();
        assert!(get_named_slicer_style(&metadata, "Deletable").is_some());

        delete_named_slicer_style(&mut metadata, "Deletable")
            .expect("delete should succeed for non-read-only style");

        assert!(
            get_named_slicer_style(&metadata, "Deletable").is_none(),
            "style should be gone after deletion"
        );
    }

    // -------------------------------------------------------------------
    // Test 27: Delete read-only style fails
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_delete_readonly_fails() {
        let mut metadata = WorkbookMetadata::default();

        // Seed a read-only built-in style in the native registry.
        let read_only_style = NamedSlicerStyle {
            name: "BuiltIn".to_string(),
            read_only: true,
            style: make_slicer_style("#000000"),
        };
        metadata
            .named_slicer_styles
            .insert("BuiltIn".to_owned(), read_only_style);

        // Verify it exists and is read-only.
        let retrieved = get_named_slicer_style(&metadata, "BuiltIn").unwrap();
        assert!(retrieved.read_only);

        // Attempt to delete should fail.
        let result = delete_named_slicer_style(&mut metadata, "BuiltIn");
        assert!(result.is_err(), "deleting a read-only style should fail");
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("read-only"),
            "error message should mention read-only, got: {err_msg}"
        );

        // Style should still exist.
        assert!(get_named_slicer_style(&metadata, "BuiltIn").is_some());
    }

    // -------------------------------------------------------------------
    // Test 28: Delete non-existent style fails
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_delete_nonexistent_fails() {
        let mut metadata = WorkbookMetadata::default();

        let result = delete_named_slicer_style(&mut metadata, "DoesNotExist");
        assert!(result.is_err(), "deleting non-existent style should fail");
    }

    // -------------------------------------------------------------------
    // Test 29: Duplicate creates copy with new name
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_duplicate() {
        let mut metadata = WorkbookMetadata::default();
        let original_style = make_slicer_style("#ABCDEF");

        add_named_slicer_style(&mut metadata, "Original", original_style.clone(), false).unwrap();

        let copy_name = duplicate_named_slicer_style(&mut metadata, "Original")
            .expect("duplicate should succeed");
        assert_eq!(copy_name, "Original Copy");

        let copy = get_named_slicer_style(&metadata, &copy_name).unwrap();
        assert_eq!(copy.name, "Original Copy");
        assert!(!copy.read_only);
        assert_eq!(
            copy.style, original_style,
            "duplicated style properties should match original"
        );

        // Original should still exist and be unchanged.
        let original = get_named_slicer_style(&metadata, "Original").unwrap();
        assert_eq!(original.style, original_style);
    }

    // -------------------------------------------------------------------
    // Test 30: Duplicate with name conflict appends suffix
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_duplicate_name_conflict() {
        let mut metadata = WorkbookMetadata::default();

        add_named_slicer_style(&mut metadata, "Base", make_slicer_style("#111111"), false).unwrap();

        // Pre-create "Base Copy" to force a conflict.
        add_named_slicer_style(
            &mut metadata,
            "Base Copy",
            make_slicer_style("#222222"),
            false,
        )
        .unwrap();

        let dup_name = duplicate_named_slicer_style(&mut metadata, "Base").unwrap();
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
        let mut metadata = WorkbookMetadata::default();

        // Initially zero.
        assert_eq!(get_named_slicer_style_count(&metadata), 0);

        add_named_slicer_style(&mut metadata, "S1", make_slicer_style("#AA0000"), false).unwrap();
        assert_eq!(get_named_slicer_style_count(&metadata), 1);

        add_named_slicer_style(&mut metadata, "S2", make_slicer_style("#00AA00"), false).unwrap();
        add_named_slicer_style(&mut metadata, "S3", make_slicer_style("#0000AA"), false).unwrap();
        assert_eq!(get_named_slicer_style_count(&metadata), 3);

        // Delete one, count should decrease.
        delete_named_slicer_style(&mut metadata, "S2").unwrap();
        assert_eq!(get_named_slicer_style_count(&metadata), 2);
    }

    // -------------------------------------------------------------------
    // Test 32: List returns all styles
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_list_all() {
        let mut metadata = WorkbookMetadata::default();

        // Initially empty.
        let styles = list_named_slicer_styles(&metadata);
        assert!(styles.is_empty());

        add_named_slicer_style(&mut metadata, "Alpha", make_slicer_style("#A00000"), false)
            .unwrap();
        add_named_slicer_style(&mut metadata, "Beta", make_slicer_style("#00B000"), false).unwrap();
        add_named_slicer_style(&mut metadata, "Gamma", make_slicer_style("#0000C0"), false)
            .unwrap();

        let styles = list_named_slicer_styles(&metadata);
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
        let metadata = WorkbookMetadata::default();
        assert!(get_named_slicer_style(&metadata, "NoSuchStyle").is_none());
    }

    // -------------------------------------------------------------------
    // Test 34: Add with make_unique=false errors on duplicate name
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_add_duplicate_without_make_unique_fails() {
        let mut metadata = WorkbookMetadata::default();

        add_named_slicer_style(
            &mut metadata,
            "Existing",
            make_slicer_style("#FF0000"),
            false,
        )
        .unwrap();

        // Second add with same name and make_unique=false should error.
        let result = add_named_slicer_style(
            &mut metadata,
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
        let retrieved = get_named_slicer_style(&metadata, "Existing").unwrap();
        assert_eq!(
            retrieved.style.header_background_color,
            Some("#FF0000".to_string()),
            "original style should not have been overwritten"
        );
    }
}
