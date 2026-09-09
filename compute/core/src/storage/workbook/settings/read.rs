use crate::snapshot::{WorkbookProtectionOptions, WorkbookSettings};
use crate::storage::workbook::WorkbookMetadata;

pub fn get_settings(metadata: &WorkbookMetadata) -> WorkbookSettings {
    let mut settings = metadata.settings.clone();
    settings.date1904 = metadata.properties.as_ref().is_some_and(|p| p.date1904);
    if let Some(protection) = &metadata.protection {
        settings.workbook_protection_password_hash = protection
            .workbook_hash_value
            .clone()
            .or_else(|| protection.workbook_password.clone());
        settings.workbook_protection_options = Some(WorkbookProtectionOptions {
            structure: protection.lock_structure,
        });
    }
    settings
}

/// Serialize a typed setting at the public JSON boundary.
pub fn get_setting(metadata: &WorkbookMetadata, key: &str) -> Option<serde_json::Value> {
    match key {
        "defaultSlicerStyle" => metadata
            .default_slicer_style
            .as_ref()
            .map(|s| s.clone().into()),
        "defaultPivotTableStyle" => metadata
            .default_pivot_table_style
            .as_ref()
            .map(|s| s.clone().into()),
        _ => serde_json::to_value(get_settings(metadata))
            .ok()?
            .get(key)
            .cloned(),
    }
}
