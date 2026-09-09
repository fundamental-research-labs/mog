//! Numeric/date and discrete grouping metadata in pivot cache fields.
use crate::domain::pivot::reader::elements::{first_element_span, for_each_child};
use crate::infra::xml::{
    parse_bool_attr_with_default, parse_f64_attr, parse_string_attr, parse_u32_attr,
};
use ooxml_types::pivot::{PivotDiscretePr, PivotFieldGroup, PivotGroupItems, PivotRangePr};

pub(super) fn parse_field_group(xml: &[u8]) -> Option<PivotFieldGroup> {
    let span = first_element_span(xml, b"fieldGroup", 0)?;
    let tag = &xml[span.start..span.tag_end];
    let mut group = PivotFieldGroup {
        par: parse_u32_attr(tag, b"par=\""),
        base: parse_u32_attr(tag, b"base=\""),
        ..Default::default()
    };
    if span.self_closing {
        return Some(group);
    }
    let body = &xml[span.tag_end..span.end];
    if let Some(r) = first_element_span(body, b"rangePr", 0) {
        let t = &body[r.start..r.tag_end];
        group.range_pr = Some(PivotRangePr {
            auto_start: parse_bool_attr_with_default(t, b"autoStart=\"", true),
            auto_end: parse_bool_attr_with_default(t, b"autoEnd=\"", true),
            group_by: parse_string_attr(t, b"groupBy=\""),
            start_num: parse_f64_attr(t, b"startNum=\""),
            end_num: parse_f64_attr(t, b"endNum=\""),
            start_date: parse_string_attr(t, b"startDate=\""),
            end_date: parse_string_attr(t, b"endDate=\""),
            group_interval: parse_f64_attr(t, b"groupInterval=\""),
        });
    }
    if let Some(d) = first_element_span(body, b"discretePr", 0) {
        let mut discrete = PivotDiscretePr {
            count: parse_u32_attr(&body[d.start..d.tag_end], b"count=\""),
            ..Default::default()
        };
        if !d.self_closing {
            for_each_child(&body[d.tag_end..d.end], b"x", |_, tag| {
                if let Some(v) = parse_u32_attr(tag, b"v=\"") {
                    discrete.items.push(v);
                }
            });
        }
        group.discrete_pr = Some(discrete);
    }
    if let Some(g) = first_element_span(body, b"groupItems", 0) {
        let values = if g.self_closing {
            Vec::new()
        } else {
            super::shared_items::parse_shared_items(&body[g.tag_end..g.end])
        };
        let shared = crate::domain::pivot::spec::convert_shared_items_to_ooxml(
            &values,
            &crate::domain::pivot::model::CacheField::default(),
        );
        group.group_items = Some(PivotGroupItems {
            count: parse_u32_attr(&body[g.start..g.tag_end], b"count=\""),
            items: shared.items,
            ..Default::default()
        });
    }
    Some(group)
}
