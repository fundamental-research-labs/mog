//! Custom Table Styles — Pure computation for custom table style CRUD operations.
//!
//! Ported from `spreadsheet-model/src/tables/custom-styles.ts`.
//!
//! Custom table styles are workbook-level (not sheet-level). These functions
//! operate on a collection of styles (a `Vec<CustomTableStyleConfig>` or a
//! `HashMap<String, CustomTableStyleConfig>`) rather than on Yjs directly.
//!
//! Every function is PURE and STATELESS. CRUD operations return new collections.
//! The storage layer is responsible for persisting changes.
//!
//! **NOTE**: `StripePattern`, `TableElementStyle`, `CustomTableStyleConfig` canonical
//! definitions now live in `domain_types::domain::custom_table_style`.
//! This module re-exports them for backward compatibility.

use std::collections::HashMap;

use crate::error::TableError;

// Re-export canonical type definitions from domain-types
pub use domain_types::domain::custom_table_style::{
    CustomTableStyleConfig, StripePattern, TableElementStyle,
};

/// Partial updates for a custom table style.
#[derive(Debug, Clone, Default)]
pub struct CustomTableStyleUpdate {
    pub name: Option<String>,
    pub header_row: Option<TableElementStyle>,
    pub total_row: Option<TableElementStyle>,
    pub first_column: Option<TableElementStyle>,
    pub last_column: Option<TableElementStyle>,
    pub row_stripes: Option<StripePattern>,
    pub column_stripes: Option<StripePattern>,
    pub whole_table: Option<TableElementStyle>,
}

// ============================================================================
// Query Operations (Read)
// ============================================================================

/// Get a custom table style by ID.
pub fn get_custom_table_style<'a>(
    styles: &'a HashMap<String, CustomTableStyleConfig>,
    style_id: &str,
) -> Option<&'a CustomTableStyleConfig> {
    styles.get(style_id)
}

/// Get a custom table style by name (case-insensitive).
pub fn get_custom_table_style_by_name<'a>(
    styles: &'a HashMap<String, CustomTableStyleConfig>,
    name: &str,
) -> Option<&'a CustomTableStyleConfig> {
    let lower_name = name.to_lowercase();
    styles
        .values()
        .find(|s| s.name.to_lowercase() == lower_name)
}

/// Get all custom table styles, sorted by name.
pub fn get_all_custom_table_styles(
    styles: &HashMap<String, CustomTableStyleConfig>,
) -> Vec<&CustomTableStyleConfig> {
    let mut result: Vec<&CustomTableStyleConfig> = styles.values().collect();
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

/// Check if a custom table style name is available.
///
/// Returns true if no other style (excluding `exclude_id`) has the same name
/// (case-insensitive).
pub fn is_table_style_name_available(
    styles: &HashMap<String, CustomTableStyleConfig>,
    name: &str,
    exclude_id: Option<&str>,
) -> bool {
    let lower_name = name.to_lowercase();
    for (id, style) in styles {
        if let Some(eid) = exclude_id
            && id == eid
        {
            continue;
        }
        if style.name.to_lowercase() == lower_name {
            return false;
        }
    }
    true
}

/// Check if a custom table style exists by ID.
pub fn custom_table_style_exists(
    styles: &HashMap<String, CustomTableStyleConfig>,
    style_id: &str,
) -> bool {
    styles.contains_key(style_id)
}

/// Get the count of custom table styles.
pub fn get_custom_table_style_count(styles: &HashMap<String, CustomTableStyleConfig>) -> usize {
    styles.len()
}

// ============================================================================
// Mutation Operations (pure — return new collections)
// ============================================================================

/// Create a new custom table style.
///
/// Returns `Err` if the name is already taken. On success, returns the new
/// style and the updated collection.
pub fn create_custom_table_style(
    styles: &HashMap<String, CustomTableStyleConfig>,
    id: &str,
    name: &str,
    now: f64,
    config: Option<CustomTableStyleUpdate>,
) -> Result<
    (
        CustomTableStyleConfig,
        HashMap<String, CustomTableStyleConfig>,
    ),
    TableError,
> {
    if !is_table_style_name_available(styles, name, None) {
        return Err(TableError::DuplicateStyleName(name.to_string()));
    }

    let cfg = config.unwrap_or_default();
    let style = CustomTableStyleConfig {
        id: id.to_string(),
        name: name.to_string(),
        created_at: now,
        updated_at: now,
        header_row: cfg.header_row.unwrap_or_default(),
        total_row: cfg.total_row.unwrap_or_default(),
        first_column: cfg.first_column.unwrap_or_default(),
        last_column: cfg.last_column.unwrap_or_default(),
        row_stripes: cfg.row_stripes.unwrap_or_default(),
        column_stripes: cfg.column_stripes.unwrap_or_default(),
        whole_table: cfg.whole_table.unwrap_or_default(),
    };

    let mut new_styles = styles.clone();
    new_styles.insert(id.to_string(), style.clone());
    Ok((style, new_styles))
}

/// Update an existing custom table style.
///
/// Returns `Err` if the style is not found or the new name conflicts.
pub fn update_custom_table_style(
    styles: &HashMap<String, CustomTableStyleConfig>,
    style_id: &str,
    updates: CustomTableStyleUpdate,
    now: f64,
) -> Result<HashMap<String, CustomTableStyleConfig>, TableError> {
    let existing = styles
        .get(style_id)
        .ok_or_else(|| TableError::StyleNotFound(style_id.to_string()))?;

    // Check name uniqueness if name is being changed
    if let Some(ref new_name) = updates.name
        && new_name != &existing.name
        && !is_table_style_name_available(styles, new_name, Some(style_id))
    {
        return Err(TableError::DuplicateStyleName(new_name.to_string()));
    }

    let updated = CustomTableStyleConfig {
        id: existing.id.clone(),
        name: updates.name.unwrap_or_else(|| existing.name.clone()),
        created_at: existing.created_at,
        updated_at: now,
        header_row: updates
            .header_row
            .unwrap_or_else(|| existing.header_row.clone()),
        total_row: updates
            .total_row
            .unwrap_or_else(|| existing.total_row.clone()),
        first_column: updates
            .first_column
            .unwrap_or_else(|| existing.first_column.clone()),
        last_column: updates
            .last_column
            .unwrap_or_else(|| existing.last_column.clone()),
        row_stripes: updates
            .row_stripes
            .unwrap_or_else(|| existing.row_stripes.clone()),
        column_stripes: updates
            .column_stripes
            .unwrap_or_else(|| existing.column_stripes.clone()),
        whole_table: updates
            .whole_table
            .unwrap_or_else(|| existing.whole_table.clone()),
    };

    let mut new_styles = styles.clone();
    new_styles.insert(style_id.to_string(), updated);
    Ok(new_styles)
}

/// Duplicate an existing custom table style.
///
/// If `new_name` is not provided, generates "Copy of {original}".
/// Auto-deduplicates name by appending " (N)".
pub fn duplicate_custom_table_style(
    styles: &HashMap<String, CustomTableStyleConfig>,
    source_style_id: &str,
    new_id: &str,
    new_name: Option<&str>,
    now: f64,
) -> Result<
    (
        CustomTableStyleConfig,
        HashMap<String, CustomTableStyleConfig>,
    ),
    TableError,
> {
    let source = styles
        .get(source_style_id)
        .ok_or_else(|| TableError::StyleNotFound(source_style_id.to_string()))?;

    // Generate name if not provided
    let base_name = new_name
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Copy of {}", source.name));

    // Ensure name is unique
    let mut name = base_name.clone();
    let mut counter = 1u32;
    while !is_table_style_name_available(styles, &name, None) {
        counter += 1;
        name = format!("{} ({})", base_name, counter);
    }

    let config = CustomTableStyleUpdate {
        header_row: Some(source.header_row.clone()),
        total_row: Some(source.total_row.clone()),
        first_column: Some(source.first_column.clone()),
        last_column: Some(source.last_column.clone()),
        row_stripes: Some(source.row_stripes.clone()),
        column_stripes: Some(source.column_stripes.clone()),
        whole_table: Some(source.whole_table.clone()),
        ..Default::default()
    };

    create_custom_table_style(styles, new_id, &name, now, Some(config))
}

/// Delete a custom table style.
///
/// Returns the updated collection, or None if the style was not found.
pub fn delete_custom_table_style(
    styles: &HashMap<String, CustomTableStyleConfig>,
    style_id: &str,
) -> Option<HashMap<String, CustomTableStyleConfig>> {
    if !styles.contains_key(style_id) {
        return None;
    }
    let mut new_styles = styles.clone();
    new_styles.remove(style_id);
    Some(new_styles)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_styles() -> HashMap<String, CustomTableStyleConfig> {
        let mut map = HashMap::new();
        map.insert(
            "ts-1".to_string(),
            CustomTableStyleConfig {
                id: "ts-1".to_string(),
                name: "MyStyle".to_string(),
                created_at: 1000.0,
                updated_at: 1000.0,
                header_row: TableElementStyle {
                    fill: Some("#4472C4".to_string()),
                    ..Default::default()
                },
                total_row: TableElementStyle::default(),
                first_column: TableElementStyle::default(),
                last_column: TableElementStyle::default(),
                row_stripes: StripePattern::default(),
                column_stripes: StripePattern::default(),
                whole_table: TableElementStyle::default(),
            },
        );
        map.insert(
            "ts-2".to_string(),
            CustomTableStyleConfig {
                id: "ts-2".to_string(),
                name: "AnotherStyle".to_string(),
                created_at: 2000.0,
                updated_at: 2000.0,
                header_row: TableElementStyle::default(),
                total_row: TableElementStyle::default(),
                first_column: TableElementStyle::default(),
                last_column: TableElementStyle::default(),
                row_stripes: StripePattern::default(),
                column_stripes: StripePattern::default(),
                whole_table: TableElementStyle::default(),
            },
        );
        map
    }

    // ---- Query ----

    #[test]
    fn get_by_id() {
        let styles = make_styles();
        let s = get_custom_table_style(&styles, "ts-1").unwrap();
        assert_eq!(s.name, "MyStyle");
    }

    #[test]
    fn get_by_id_not_found() {
        let styles = make_styles();
        assert!(get_custom_table_style(&styles, "nope").is_none());
    }

    #[test]
    fn get_by_name() {
        let styles = make_styles();
        let s = get_custom_table_style_by_name(&styles, "mystyle").unwrap();
        assert_eq!(s.id, "ts-1");
    }

    #[test]
    fn get_by_name_not_found() {
        let styles = make_styles();
        assert!(get_custom_table_style_by_name(&styles, "Missing").is_none());
    }

    #[test]
    fn get_all_sorted() {
        let styles = make_styles();
        let all = get_all_custom_table_styles(&styles);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "AnotherStyle");
        assert_eq!(all[1].name, "MyStyle");
    }

    #[test]
    fn name_available() {
        let styles = make_styles();
        assert!(is_table_style_name_available(&styles, "NewStyle", None));
        assert!(!is_table_style_name_available(&styles, "MyStyle", None));
        assert!(!is_table_style_name_available(&styles, "mystyle", None));
    }

    #[test]
    fn name_available_exclude_self() {
        let styles = make_styles();
        assert!(is_table_style_name_available(
            &styles,
            "MyStyle",
            Some("ts-1")
        ));
    }

    #[test]
    fn exists() {
        let styles = make_styles();
        assert!(custom_table_style_exists(&styles, "ts-1"));
        assert!(!custom_table_style_exists(&styles, "nope"));
    }

    #[test]
    fn count() {
        let styles = make_styles();
        assert_eq!(get_custom_table_style_count(&styles), 2);
    }

    // ---- Create ----

    #[test]
    fn create_ok() {
        let styles = make_styles();
        let (created, new_styles) =
            create_custom_table_style(&styles, "ts-3", "Fresh", 3000.0, None).unwrap();
        assert_eq!(created.name, "Fresh");
        assert_eq!(created.id, "ts-3");
        assert_eq!(new_styles.len(), 3);
    }

    #[test]
    fn create_duplicate_name() {
        let styles = make_styles();
        let result = create_custom_table_style(&styles, "ts-3", "MyStyle", 3000.0, None);
        assert!(result.is_err());
    }

    // ---- Update ----

    #[test]
    fn update_name() {
        let styles = make_styles();
        let new_styles = update_custom_table_style(
            &styles,
            "ts-1",
            CustomTableStyleUpdate {
                name: Some("Renamed".to_string()),
                ..Default::default()
            },
            4000.0,
        )
        .unwrap();
        assert_eq!(new_styles["ts-1"].name, "Renamed");
        assert_eq!(new_styles["ts-1"].updated_at, 4000.0);
        assert_eq!(new_styles["ts-1"].created_at, 1000.0);
    }

    #[test]
    fn update_not_found() {
        let styles = make_styles();
        let result =
            update_custom_table_style(&styles, "nope", CustomTableStyleUpdate::default(), 4000.0);
        assert!(result.is_err());
    }

    #[test]
    fn update_duplicate_name() {
        let styles = make_styles();
        let result = update_custom_table_style(
            &styles,
            "ts-1",
            CustomTableStyleUpdate {
                name: Some("AnotherStyle".to_string()),
                ..Default::default()
            },
            4000.0,
        );
        assert!(result.is_err());
    }

    // ---- Duplicate ----

    #[test]
    fn duplicate_ok() {
        let styles = make_styles();
        let (dup, new_styles) =
            duplicate_custom_table_style(&styles, "ts-1", "ts-3", None, 5000.0).unwrap();
        assert_eq!(dup.name, "Copy of MyStyle");
        assert_eq!(dup.header_row.fill, Some("#4472C4".to_string()));
        assert_eq!(new_styles.len(), 3);
    }

    #[test]
    fn duplicate_custom_name() {
        let styles = make_styles();
        let (dup, _) =
            duplicate_custom_table_style(&styles, "ts-1", "ts-3", Some("Custom"), 5000.0).unwrap();
        assert_eq!(dup.name, "Custom");
    }

    #[test]
    fn duplicate_auto_dedup_name() {
        let styles = make_styles();
        // First duplicate
        let (_, styles) =
            duplicate_custom_table_style(&styles, "ts-1", "ts-3", Some("MyStyle"), 5000.0).unwrap();
        // "MyStyle" is taken, should become "MyStyle (2)"
        assert!(styles.values().any(|s| s.name == "MyStyle (2)"));
    }

    #[test]
    fn duplicate_not_found() {
        let styles = make_styles();
        let result = duplicate_custom_table_style(&styles, "nope", "ts-3", None, 5000.0);
        assert!(result.is_err());
    }

    // ---- Delete ----

    #[test]
    fn delete_ok() {
        let styles = make_styles();
        let new_styles = delete_custom_table_style(&styles, "ts-1").unwrap();
        assert_eq!(new_styles.len(), 1);
        assert!(!new_styles.contains_key("ts-1"));
    }

    #[test]
    fn delete_not_found() {
        let styles = make_styles();
        assert!(delete_custom_table_style(&styles, "nope").is_none());
    }

    // ---- Serde ----

    #[test]
    fn round_trip_custom_style() {
        let style = CustomTableStyleConfig {
            id: "ts-1".to_string(),
            name: "Test".to_string(),
            created_at: 1000.0,
            updated_at: 2000.0,
            header_row: TableElementStyle {
                fill: Some("#FF0000".to_string()),
                font_bold: Some(true),
                ..Default::default()
            },
            total_row: TableElementStyle::default(),
            first_column: TableElementStyle::default(),
            last_column: TableElementStyle::default(),
            row_stripes: StripePattern {
                stripe_size: 2,
                stripe1_fill: Some("#FFFFFF".to_string()),
                stripe2_fill: Some("#EEEEEE".to_string()),
            },
            column_stripes: StripePattern::default(),
            whole_table: TableElementStyle::default(),
        };
        let json = serde_json::to_string(&style).unwrap();
        let back: CustomTableStyleConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(style, back);
    }
}
