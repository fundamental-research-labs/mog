use crate::styles::{DEFAULT_STYLE_ID, get_all_built_in_styles, get_built_in_style};

#[test]
fn built_in_styles_count_is_67() {
    let styles = get_all_built_in_styles();
    assert_eq!(styles.len(), 67);
}

#[test]
fn includes_all_light_styles_1_to_28() {
    for i in 1..=28 {
        let id = format!("TableStyleLight{}", i);
        assert!(get_built_in_style(&id).is_some(), "Missing style: {}", id);
    }
}

#[test]
fn includes_all_medium_styles_1_to_28() {
    for i in 1..=28 {
        let id = format!("TableStyleMedium{}", i);
        assert!(get_built_in_style(&id).is_some(), "Missing style: {}", id);
    }
}

#[test]
fn includes_all_dark_styles_1_to_11() {
    for i in 1..=11 {
        let id = format!("TableStyleDark{}", i);
        assert!(get_built_in_style(&id).is_some(), "Missing style: {}", id);
    }
}

#[test]
fn all_style_ids_are_unique() {
    let styles = get_all_built_in_styles();
    let mut ids: Vec<&str> = styles.iter().map(|s| s.id.as_str()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), styles.len());
}

#[test]
fn default_style_id_is_medium2() {
    assert_eq!(DEFAULT_STYLE_ID, "TableStyleMedium2");
}
