use super::{
    REL_CORE_PROPERTIES, REL_CUSTOM_PROPERTIES, REL_EXTENDED_PROPERTIES, REL_OFFICE_DOCUMENT,
    REL_SHARED_STRINGS, REL_STYLES, REL_THEME, REL_WORKSHEET, manager::RelationshipManager,
};

/// Create root relationships (_rels/.rels)
///
/// This creates the top-level relationships file that typically points to:
/// - The main workbook (xl/workbook.xml)
/// - Core properties (docProps/core.xml) - optional
/// - Extended properties (docProps/app.xml) - optional
///
/// # Arguments
/// * `workbook_path` - Path to the workbook, typically "xl/workbook.xml"
///
/// # Returns
/// A RelationshipManager with the root relationships
pub fn create_root_rels(workbook_path: &str) -> RelationshipManager {
    let mut rels = RelationshipManager::new();
    rels.add(REL_OFFICE_DOCUMENT, workbook_path);
    rels
}

/// Create root relationships with optional core and app properties
///
/// # Arguments
/// * `workbook_path` - Path to the workbook, typically "xl/workbook.xml"
/// * `has_core_props` - Include core properties relationship
/// * `has_app_props` - Include extended (app) properties relationship
///
/// # Returns
/// A RelationshipManager with the root relationships
pub fn create_root_rels_full(
    workbook_path: &str,
    has_core_props: bool,
    has_app_props: bool,
) -> RelationshipManager {
    create_root_rels_full_with_custom(workbook_path, has_core_props, has_app_props, false)
}

/// Create root relationships with optional custom properties support.
///
/// # Arguments
/// * `workbook_path` - Path to the workbook, typically "xl/workbook.xml"
/// * `has_core_props` - Include core properties relationship
/// * `has_app_props` - Include extended (app) properties relationship
/// * `has_custom_props` - Include custom properties relationship
///
/// # Returns
/// A RelationshipManager with the root relationships
pub fn create_root_rels_full_with_custom(
    workbook_path: &str,
    has_core_props: bool,
    has_app_props: bool,
    has_custom_props: bool,
) -> RelationshipManager {
    let mut rels = RelationshipManager::new();
    // Root rels use absolute paths (leading /)
    let wb = if workbook_path.starts_with('/') {
        workbook_path.to_string()
    } else {
        format!("/{}", workbook_path)
    };
    rels.add(REL_OFFICE_DOCUMENT, &wb);

    if has_core_props {
        rels.add(REL_CORE_PROPERTIES, "/docProps/core.xml");
    }

    if has_app_props {
        rels.add(REL_EXTENDED_PROPERTIES, "/docProps/app.xml");
    }

    if has_custom_props {
        rels.add(REL_CUSTOM_PROPERTIES, "/docProps/custom.xml");
    }

    rels
}

/// Create workbook relationships (xl/_rels/workbook.xml.rels)
///
/// # Arguments
/// * `sheet_count` - Number of worksheets
/// * `has_styles` - Include styles relationship
/// * `has_theme` - Include theme relationship
/// * `has_shared_strings` - Include shared strings relationship
///
/// # Returns
/// A RelationshipManager with the workbook relationships
pub fn create_workbook_rels(
    sheet_count: usize,
    has_styles: bool,
    has_theme: bool,
    has_shared_strings: bool,
) -> RelationshipManager {
    let mut rels = RelationshipManager::new();

    // Add worksheet relationships
    for i in 1..=sheet_count {
        rels.add(REL_WORKSHEET, &format!("worksheets/sheet{}.xml", i));
    }

    // Add optional component relationships
    if has_styles {
        rels.add(REL_STYLES, "styles.xml");
    }

    if has_theme {
        rels.add(REL_THEME, "theme/theme1.xml");
    }

    if has_shared_strings {
        rels.add(REL_SHARED_STRINGS, "sharedStrings.xml");
    }

    rels
}

/// Create a sheet relationships file (xl/worksheets/_rels/sheetN.xml.rels)
///
/// This is typically used when a worksheet has associated content like:
/// - Comments
/// - Drawings
/// - Tables
/// - Hyperlinks (external)
///
/// # Returns
/// A new empty RelationshipManager to be populated with sheet-specific relationships
pub fn create_sheet_rels() -> RelationshipManager {
    RelationshipManager::new()
}
