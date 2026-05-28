use crate::cf::types::{CFColorPointWire, CFColorScaleWire, CFValueType, CfValue};
use domain_types::domain::conditional_format as cf;

pub(super) fn convert_color_point_to_wire(pt: &cf::CFColorPoint) -> CFColorPointWire {
    // Typed OOXML preservation: collapsed `value_type: CfvoType` + `value: Option<Value>`
    // into a single typed `CFValueRef` enum. Lower each variant to the
    // compute-cf wire pair. The two Excel-2010+ extension variants
    // (`AutoMin`/`AutoMax`) don't have wire equivalents; fall back to
    // their natural base value (Min/Max) with a warn so the drift is
    // visible.
    let (value_type, value) = match &pt.value {
        cf::CFValueRef::Number { value } => {
            (CFValueType::Number, Some(CfValue::Number { value: *value }))
        }
        cf::CFValueRef::Percent { value } => (
            CFValueType::Percent,
            Some(CfValue::Number { value: *value }),
        ),
        cf::CFValueRef::Percentile { value } => (
            CFValueType::Percentile,
            Some(CfValue::Number { value: *value }),
        ),
        cf::CFValueRef::Formula { source } => (
            CFValueType::Formula,
            Some(CfValue::Formula {
                source: source.clone(),
            }),
        ),
        cf::CFValueRef::Min => (CFValueType::Min, None),
        cf::CFValueRef::Max => (CFValueType::Max, None),
        cf::CFValueRef::AutoMin => {
            tracing::warn!("CFColorPoint value=AutoMin not representable in wire, treating as Min");
            (CFValueType::Min, None)
        }
        cf::CFValueRef::AutoMax => {
            tracing::warn!("CFColorPoint value=AutoMax not representable in wire, treating as Max");
            (CFValueType::Max, None)
        }
    };
    CFColorPointWire {
        value_type,
        value,
        color: pt.color.clone(),
    }
}

pub(super) fn convert_color_scale_to_wire(cs: &cf::CFColorScale) -> CFColorScaleWire {
    CFColorScaleWire {
        min_point: convert_color_point_to_wire(&cs.min_point),
        mid_point: cs.mid_point.as_ref().map(convert_color_point_to_wire),
        max_point: convert_color_point_to_wire(&cs.max_point),
    }
}
