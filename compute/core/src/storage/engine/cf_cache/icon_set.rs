use crate::cf::types::{
    CFIconSetName, CFIconSetWire, CFIconThresholdOperator, CFIconThresholdWire, CFValueType,
    CfValue,
};
use domain_types::domain::conditional_format as cf;

pub(super) fn convert_icon_set_to_wire(is: &cf::CFIconSet) -> CFIconSetWire {
    // Parse icon set name via serde from the OOXML token produced by
    // `IconSetType::to_ooxml()` - the compute-cf wire enum
    // `CFIconSetName` uses the same `"3Arrows"` / `"4Arrows"` / etc tokens.
    let icon_set_name: CFIconSetName = serde_json::from_value(serde_json::Value::String(
        is.icon_set_name.to_ooxml().to_string(),
    ))
    .unwrap_or(CFIconSetName::ThreeArrows);

    // Build default thresholds from the registry
    let icon_count = icon_set_name.icon_count();
    let thresholds = if icon_count > 1 {
        // Generate evenly-spaced percentage thresholds (excluding the first icon at 0%)
        // e.g., 3 icons -> thresholds at [33, 67], 4 icons -> [25, 50, 75]
        (1..icon_count)
            .map(|i| {
                let pct = (i as f64 / icon_count as f64 * 100.0).round();
                CFIconThresholdWire {
                    value_type: CFValueType::Percent,
                    // Synthesized numeric threshold - no reason to stringify
                    // it on the way out (typed formula boundary).
                    value: Some(CfValue::Number { value: pct }),
                    operator: CFIconThresholdOperator::GreaterThanOrEqual,
                    custom_icon: None,
                }
            })
            .collect()
    } else {
        vec![]
    };

    CFIconSetWire {
        icon_set_name,
        thresholds,
        reverse_order: is.reverse_order.unwrap_or(false),
        show_icon_only: is.show_icon_only.unwrap_or(false),
    }
}
