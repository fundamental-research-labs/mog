use crate::cf::types::{
    CFIconSetName, CFIconSetWire, CFIconThresholdOperator, CFIconThresholdWire, CFValueType,
    CfValue,
};
use domain_types::domain::conditional_format as cf;
use ooxml_types::cond_format::CfvoType;

pub(super) fn convert_icon_set_to_wire(is: &cf::CFIconSet) -> CFIconSetWire {
    // Parse icon set name via serde from the OOXML token produced by
    // `IconSetType::to_ooxml()` - the compute-cf wire enum
    // `CFIconSetName` uses the same `"3Arrows"` / `"4Arrows"` / etc tokens.
    let icon_set_name: CFIconSetName = serde_json::from_value(serde_json::Value::String(
        is.icon_set_name.to_ooxml().to_string(),
    ))
    .unwrap_or(CFIconSetName::ThreeArrows);

    let thresholds = if !is.thresholds.is_empty() {
        is.thresholds
            .iter()
            .map(|threshold| CFIconThresholdWire {
                value_type: cfvo_type_to_wire(threshold.value_type),
                value: threshold_value_to_wire(threshold.value_type, threshold.value.as_deref()),
                operator: if threshold.gte {
                    CFIconThresholdOperator::GreaterThanOrEqual
                } else {
                    CFIconThresholdOperator::GreaterThan
                },
                custom_icon: None,
            })
            .collect()
    } else {
        default_icon_thresholds(icon_set_name)
    };

    CFIconSetWire {
        icon_set_name,
        thresholds,
        percent: is.percent,
        reverse_order: is.reverse_order.unwrap_or(false),
        show_icon_only: is.show_icon_only.unwrap_or(false),
    }
}

fn default_icon_thresholds(icon_set_name: CFIconSetName) -> Vec<CFIconThresholdWire> {
    let icon_count = icon_set_name.icon_count();
    if icon_count > 1 {
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
    }
}

fn cfvo_type_to_wire(value_type: CfvoType) -> CFValueType {
    match value_type {
        CfvoType::Min | CfvoType::AutoMin => CFValueType::Min,
        CfvoType::Max | CfvoType::AutoMax => CFValueType::Max,
        CfvoType::Percent => CFValueType::Percent,
        CfvoType::Percentile => CFValueType::Percentile,
        CfvoType::Formula => CFValueType::Formula,
        CfvoType::Num => CFValueType::Number,
    }
}

fn threshold_value_to_wire(value_type: CfvoType, value: Option<&str>) -> Option<CfValue> {
    let value = value?;
    match value_type {
        CfvoType::Formula => Some(CfValue::Formula {
            source: value.to_string(),
        }),
        CfvoType::Num | CfvoType::Percent | CfvoType::Percentile => value
            .parse::<f64>()
            .ok()
            .map(|value| CfValue::Number { value }),
        CfvoType::Min | CfvoType::Max | CfvoType::AutoMin | CfvoType::AutoMax => None,
    }
}
