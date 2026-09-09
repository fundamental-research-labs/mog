use crate::storage::workbook::WorkbookMetadata;

pub fn get_custom_setting(metadata: &WorkbookMetadata, key: &str) -> Option<String> {
    metadata
        .settings
        .custom_settings
        .as_ref()?
        .get(key)?
        .as_str()
        .map(str::to_owned)
}

/// Set a custom string setting, or remove it when `value` is `None`.
pub fn set_custom_setting(metadata: &mut WorkbookMetadata, key: &str, value: Option<&str>) {
    match value {
        Some(value) => {
            metadata
                .settings
                .custom_settings
                .get_or_insert_with(Default::default)
                .insert(key.to_owned(), serde_json::Value::String(value.to_owned()));
        }
        None => {
            if let Some(settings) = &mut metadata.settings.custom_settings {
                settings.remove(key);
                if settings.is_empty() {
                    metadata.settings.custom_settings = None;
                }
            }
        }
    }
}

pub fn list_custom_settings(metadata: &WorkbookMetadata) -> Vec<(String, String)> {
    let mut result: Vec<_> = metadata
        .settings
        .custom_settings
        .iter()
        .flat_map(|settings| settings.iter())
        .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.to_owned())))
        .collect();
    result.sort_unstable();
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::workbook::WorkbookMetadata;

    #[test]
    fn test_custom_settings_set_list_delete() {
        let mut metadata = WorkbookMetadata::default();

        assert_eq!(get_custom_setting(&metadata, "a"), None);
        assert!(list_custom_settings(&metadata).is_empty());

        set_custom_setting(&mut metadata, "a", Some("one"));
        set_custom_setting(&mut metadata, "b", Some("two"));
        assert_eq!(get_custom_setting(&metadata, "a"), Some("one".to_string()));

        let mut listed = list_custom_settings(&metadata);
        listed.sort();
        assert_eq!(
            listed,
            vec![
                ("a".to_string(), "one".to_string()),
                ("b".to_string(), "two".to_string())
            ]
        );

        set_custom_setting(&mut metadata, "a", None);
        assert_eq!(get_custom_setting(&metadata, "a"), None);
    }
}
