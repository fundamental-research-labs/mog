use super::presets::{cp, cp_val};
use super::test_support::*;
use super::*;
use domain_types::domain::conditional_format::{CFColorScale, CFRule, ConditionalFormat};
use ooxml_types::cond_format::CfvoType;

#[test]
fn test_data_bar_presets_count() {
    let presets = data_bar_presets();
    assert_eq!(presets.len(), 8);
    let mut ids: Vec<&str> = presets.iter().map(|p| p.id.as_str()).collect();
    let original_len = ids.len();
    ids.sort();
    ids.dedup();
    assert_eq!(original_len, ids.len());
}

#[test]
fn test_color_scale_presets_count() {
    let presets = color_scale_presets();
    assert_eq!(presets.len(), 10);
    assert_eq!(
        presets
            .iter()
            .filter(|p| p.color_scale.mid_point.is_some())
            .count(),
        6
    );
    assert_eq!(
        presets
            .iter()
            .filter(|p| p.color_scale.mid_point.is_none())
            .count(),
        4
    );
}

#[test]
fn test_icon_set_presets_count() {
    // 20 = every `IconSetType` variant except `NoIcons`.
    assert_eq!(icon_set_presets().len(), 20);
}

#[test]
fn test_icon_set_registry_count() {
    assert_eq!(ICON_SET_REGISTRY.len(), 20);
    let three_icons: Vec<_> = ICON_SET_REGISTRY
        .iter()
        .filter(|m| m.icon_count == 3)
        .collect();
    assert_eq!(three_icons.len(), 10);
    for m in &three_icons {
        assert_eq!(m.default_thresholds.len(), 3);
    }
}

#[test]
fn test_preset_lookup() {
    assert_eq!(
        get_preset_by_id("databar-blue-gradient"),
        Some(CFPresetCategory::DataBar)
    );
    assert_eq!(
        get_preset_by_id("colorscale-green-yellow-red"),
        Some(CFPresetCategory::ColorScale)
    );
    assert_eq!(
        get_preset_by_id("iconset-3arrows"),
        Some(CFPresetCategory::IconSet)
    );
    assert_eq!(get_preset_by_id("nonexistent"), None);
}

#[test]
fn test_cf_rule_serde_roundtrip() {
    let rule = make_rule("r1", 1);
    let json = serde_json::to_string(&rule).unwrap();
    let deserialized: CFRule = serde_json::from_str(&json).unwrap();
    assert_eq!(rule, deserialized);
}

#[test]
fn test_conditional_format_serde_roundtrip() {
    let sheet_id = make_sheet_id(42);
    let fmt = make_format(
        "cf1",
        &sheet_id,
        vec![rng(0, 0, 9, 3)],
        vec![make_rule("r1", 1)],
    );
    let json = serde_json::to_string(&fmt).unwrap();
    let deserialized: ConditionalFormat = serde_json::from_str(&json).unwrap();
    assert_eq!(fmt, deserialized);
}

#[test]
fn test_color_scale_rule_serde() {
    let rule = CFRule::ColorScale {
        id: "cs1".into(),
        priority: 1,
        stop_if_true: None,
        color_scale: CFColorScale {
            points: Vec::new(),
            min_point: cp(CfvoType::Min, "#63BE7B"),
            mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFEB84")),
            max_point: cp(CfvoType::Max, "#F8696B"),
        },
    };
    let json = serde_json::to_string(&rule).unwrap();
    assert!(json.contains("\"type\":\"colorScale\""));
    let deserialized: CFRule = serde_json::from_str(&json).unwrap();
    assert_eq!(rule, deserialized);
}
