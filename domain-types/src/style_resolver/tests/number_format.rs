use std::collections::HashMap;

use super::super::number_format::resolve_number_format;

#[test]
fn builtin_number_format_resolution() {
    let empty = HashMap::new();
    assert_eq!(resolve_number_format(0, &empty).as_deref(), Some("General"));
    assert_eq!(resolve_number_format(1, &empty).as_deref(), Some("0"));
    assert_eq!(
        resolve_number_format(14, &empty).as_deref(),
        Some("m/d/yyyy")
    );
    assert_eq!(resolve_number_format(49, &empty).as_deref(), Some("@"));
    assert!(resolve_number_format(999, &empty).is_none());
}

#[test]
fn custom_number_format_resolution() {
    let mut custom = HashMap::new();
    custom.insert(164, "0.000%".to_string());
    assert_eq!(
        resolve_number_format(164, &custom).as_deref(),
        Some("0.000%")
    );
    // Built-in still takes priority
    assert_eq!(
        resolve_number_format(0, &custom).as_deref(),
        Some("General")
    );
}
