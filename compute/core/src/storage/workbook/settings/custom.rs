use std::sync::Arc;

use compute_document::undo::ORIGIN_UI_STATE;
use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use super::map::{
    ensure_optional_string_sub_map, ensure_settings_map, get_optional_string_sub_map,
    get_settings_map,
};

pub fn get_custom_setting(doc: &Doc, workbook: &MapRef, key: &str) -> Option<String> {
    let txn = doc.transact();
    let settings_map = get_settings_map(workbook, &txn)?;
    if let Some(Out::YMap(custom_map)) = settings_map.get(&txn, "customSettings")
        && let Some(Out::Any(Any::String(v))) = custom_map.get(&txn, key)
    {
        return Some(v.to_string());
    }
    None
}

/// Set a custom setting value. Pass `None` to delete the key.
pub fn set_custom_setting(doc: &Doc, workbook: &MapRef, key: &str, value: Option<&str>) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_UI_STATE));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    let custom_map = ensure_optional_string_sub_map(&settings_map, &mut txn, "customSettings");

    match value {
        Some(v) => {
            custom_map.insert(&mut txn, key, Any::String(Arc::from(v)));
        }
        None => {
            custom_map.remove(&mut txn, key);
        }
    }
}

/// List all custom settings as key-value pairs.
pub fn list_custom_settings(doc: &Doc, workbook: &MapRef) -> Vec<(String, String)> {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return Vec::new(),
    };
    let custom_map = match get_optional_string_sub_map(&settings_map, &txn, "customSettings") {
        Some(m) => m,
        _ => return Vec::new(),
    };

    let mut result = Vec::new();
    for (key, value) in custom_map.iter(&txn) {
        if let Out::Any(Any::String(v)) = value {
            result.push((key.to_string(), v.to_string()));
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;

    #[test]
    fn test_custom_settings_set_list_delete() {
        let storage = YrsStorage::new();

        assert_eq!(
            get_custom_setting(storage.doc(), storage.workbook_map(), "a"),
            None
        );
        assert!(list_custom_settings(storage.doc(), storage.workbook_map()).is_empty());

        set_custom_setting(storage.doc(), storage.workbook_map(), "a", Some("one"));
        set_custom_setting(storage.doc(), storage.workbook_map(), "b", Some("two"));
        assert_eq!(
            get_custom_setting(storage.doc(), storage.workbook_map(), "a"),
            Some("one".to_string())
        );

        let mut listed = list_custom_settings(storage.doc(), storage.workbook_map());
        listed.sort();
        assert_eq!(
            listed,
            vec![
                ("a".to_string(), "one".to_string()),
                ("b".to_string(), "two".to_string())
            ]
        );

        set_custom_setting(storage.doc(), storage.workbook_map(), "a", None);
        assert_eq!(
            get_custom_setting(storage.doc(), storage.workbook_map(), "a"),
            None
        );
    }
}
