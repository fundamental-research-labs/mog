//! Write imported cache field metadata without inferring types from cell values.

use crate::write::xml_writer::XmlWriter;
use ooxml_types::pivot::{PivotCacheField, SharedItem};

pub(super) fn write_cache_field_with_preservation(
    field: &PivotCacheField,
    w: &mut XmlWriter,
    preservation: Option<&domain_types::domain::pivot::PivotFieldOoxmlPreservation>,
) {
    w.start_element("cacheField").attr("name", &field.name);
    if let Some(preservation) = preservation {
        for attr in &preservation.attributes {
            w.attr(&attr.name, &attr.value);
        }
    }
    for (name, value) in [
        ("caption", field.caption.as_deref()),
        ("formula", field.formula.as_deref()),
        ("propertyName", field.property_name.as_deref()),
    ] {
        if let Some(value) = value {
            w.attr(name, value);
        }
    }
    if let Some(value) = field.num_fmt_id {
        w.attr_num("numFmtId", value);
    }
    if let Some(value) = field.sql_type {
        w.attr_num("sqlType", value);
    }
    if let Some(value) = field.hierarchy {
        w.attr_num("hierarchy", value);
    }
    if let Some(value) = field.level {
        w.attr_num("level", value);
    }
    if let Some(value) = field.mapping_count {
        w.attr_num("mappingCount", value);
    }
    if let Some(value) = field.unique_list {
        w.attr_bool("uniqueList", value);
    }
    w.attr_bool("databaseField", field.database_field)
        .attr_bool("memberPropertyField", field.member_property_field)
        .attr_bool("serverField", field.server_field)
        .end_attrs();

    if let Some(items) = &field.shared_items {
        w.start_element("sharedItems")
            .attr_bool("containsSemiMixedTypes", items.contains_semi_mixed_types)
            .attr_bool("containsNonDate", items.contains_non_date)
            .attr_bool("containsDate", items.contains_date)
            .attr_bool("containsString", items.contains_string)
            .attr_bool("containsBlank", items.contains_blank)
            .attr_bool("containsMixedTypes", items.contains_mixed_types)
            .attr_bool("containsNumber", items.contains_number)
            .attr_bool("containsInteger", items.contains_integer)
            .attr_bool("longText", items.long_text);
        if let Some(count) = items.count {
            w.attr_num("count", count);
        }
        if let Some(value) = items.min_value {
            w.attr_num("minValue", value);
        }
        if let Some(value) = items.max_value {
            w.attr_num("maxValue", value);
        }
        if let Some(value) = &items.min_date {
            w.attr("minDate", value);
        }
        if let Some(value) = &items.max_date {
            w.attr("maxDate", value);
        }
        if items.items.is_empty() {
            w.self_close();
        } else {
            w.end_attrs();
            for item in &items.items {
                let item = match item {
                    SharedItem::Missing => super::types::SharedItem::Missing,
                    SharedItem::Number(v) => super::types::SharedItem::Number(*v),
                    SharedItem::Boolean(v) => super::types::SharedItem::Boolean(*v),
                    SharedItem::Error(v) => super::types::SharedItem::Error(v.clone()),
                    SharedItem::String(v) => super::types::SharedItem::String(v.clone()),
                    SharedItem::DateTime(v) => super::types::SharedItem::DateTime(v.clone()),
                };
                item.write_xml(w);
            }
            w.end_element("sharedItems");
        }
    }
    if let Some(group) = &field.field_group {
        write_field_group(group, w);
    }
    if let Some(preservation) = preservation {
        for child in &preservation.children {
            w.raw_str(&child.xml);
        }
    }
    w.end_element("cacheField");
}

/// Refresh value-dependent metadata while retaining field formatting separately.
pub(crate) fn infer_shared_items(
    values: &[super::types::SharedItem],
) -> ooxml_types::pivot::SharedItems {
    use super::types::SharedItem as V;
    let mut items = ooxml_types::pivot::SharedItems {
        count: Some(values.len() as u32),
        contains_string: false,
        contains_non_date: false,
        contains_semi_mixed_types: false,
        ..Default::default()
    };
    let mut types = [false; 6];
    for value in values {
        let item = match value {
            V::Number(v) => {
                types[0] = true;
                items.min_value = Some(items.min_value.map_or(*v, |old| old.min(*v)));
                items.max_value = Some(items.max_value.map_or(*v, |old| old.max(*v)));
                SharedItem::Number(*v)
            }
            V::String(v) => {
                types[1] = true;
                items.long_text |= v.chars().count() > 255;
                SharedItem::String(v.clone())
            }
            V::Boolean(v) => {
                types[2] = true;
                SharedItem::Boolean(*v)
            }
            V::Error(v) => {
                types[3] = true;
                SharedItem::Error(v.clone())
            }
            V::Missing => {
                types[4] = true;
                SharedItem::Missing
            }
            V::DateTime(v) => {
                types[5] = true;
                if items.min_date.as_ref().is_none_or(|old| v < old) {
                    items.min_date = Some(v.clone());
                }
                if items.max_date.as_ref().is_none_or(|old| v > old) {
                    items.max_date = Some(v.clone());
                }
                SharedItem::DateTime(v.clone())
            }
            V::Index(_) => continue,
        };
        items.items.push(item);
    }
    items.contains_number = types[0];
    // Office classifies booleans and errors as strings for these type flags.
    // Blanks may accompany a homogeneous field without making it mixed.
    items.contains_string = types[1] || types[2] || types[3];
    items.contains_blank = types[4];
    items.contains_date = types[5];
    items.contains_non_date = types[..5].iter().any(|v| *v);
    items.contains_integer = types[0]
        && values
            .iter()
            .all(|v| !matches!(v, V::Number(n) if n.fract() != 0.0));
    items.contains_mixed_types = [types[0], items.contains_string, types[5]]
        .iter()
        .filter(|v| **v)
        .count()
        > 1;
    items.contains_semi_mixed_types = types[1..5].iter().any(|v| *v);
    // Numeric and date bounds cannot coexist on one sharedItems element.
    // A mixed date/number field has no single grouping domain to summarize.
    if items.contains_number && items.contains_date {
        items.min_value = None;
        items.max_value = None;
        items.min_date = None;
        items.max_date = None;
    }
    items.count = Some(items.items.len() as u32);
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::write::types::SharedItem as V;

    #[test]
    fn inferred_flags_follow_office_type_categories() {
        let string_like = infer_shared_items(&[
            V::String("label".into()),
            V::Boolean(true),
            V::Error("#N/A".into()),
            V::Missing,
        ]);
        assert!(string_like.contains_string);
        assert!(string_like.contains_semi_mixed_types);
        assert!(string_like.contains_blank);
        assert!(!string_like.contains_mixed_types);
        for item in [V::Boolean(false), V::Error("#VALUE!".into())] {
            let items = infer_shared_items(&[item]);
            assert!(items.contains_string);
            assert!(!items.contains_mixed_types);
        }
        let number_and_blank = infer_shared_items(&[V::Number(2.0), V::Missing]);
        assert!(number_and_blank.contains_integer);
        assert!(!number_and_blank.contains_mixed_types);
        let number_and_text = infer_shared_items(&[V::Number(2.0), V::String("2".into())]);
        assert!(number_and_text.contains_mixed_types);
    }

    #[test]
    fn inferred_bounds_remain_exclusive_for_mixed_dates_and_numbers() {
        let date = "2024-01-01T00:00:00".to_string();
        let mixed = infer_shared_items(&[V::Number(2.5), V::DateTime(date.clone())]);
        assert!(mixed.contains_mixed_types);
        assert!(mixed.contains_date);
        assert!(mixed.contains_number);
        assert!(!mixed.contains_integer);
        assert_eq!((mixed.min_value, mixed.max_value), (None, None));
        assert_eq!((mixed.min_date, mixed.max_date), (None, None));

        let numbers = infer_shared_items(&[V::Number(3.0), V::Number(-2.5)]);
        assert_eq!(
            (numbers.min_value, numbers.max_value),
            (Some(-2.5), Some(3.0))
        );
        assert!(!numbers.contains_integer);
        let dates = infer_shared_items(&[V::DateTime(date.clone()), V::Missing]);
        assert_eq!(dates.min_date, Some(date.clone()));
        assert_eq!(dates.max_date, Some(date));
        assert!(!dates.contains_mixed_types);
    }

    #[test]
    fn inferred_long_text_and_count_describe_serialized_shared_values() {
        assert!(!infer_shared_items(&[V::String("x".repeat(255))]).long_text);
        assert!(infer_shared_items(&[V::String("x".repeat(256))]).long_text);
        let items = infer_shared_items(&[V::Index(0), V::String("value".into())]);
        assert_eq!(items.count, Some(1));
        assert_eq!(items.items, vec![SharedItem::String("value".into())]);
    }
}

fn write_field_group(group: &ooxml_types::pivot::PivotFieldGroup, w: &mut XmlWriter) {
    w.start_element("fieldGroup");
    if let Some(v) = group.par {
        w.attr_num("par", v);
    }
    if let Some(v) = group.base {
        w.attr_num("base", v);
    }
    if group.range_pr.is_none() && group.discrete_pr.is_none() && group.group_items.is_none() {
        w.self_close();
        return;
    }
    w.end_attrs();
    if let Some(range) = &group.range_pr {
        w.start_element("rangePr")
            .attr_bool("autoStart", range.auto_start)
            .attr_bool("autoEnd", range.auto_end);
        for (key, value) in [
            ("groupBy", &range.group_by),
            ("startDate", &range.start_date),
            ("endDate", &range.end_date),
        ] {
            if let Some(v) = value {
                w.attr(key, v);
            }
        }
        for (key, value) in [
            ("startNum", range.start_num),
            ("endNum", range.end_num),
            ("groupInterval", range.group_interval),
        ] {
            if let Some(v) = value {
                w.attr_num(key, v);
            }
        }
        w.self_close();
    }
    if let Some(discrete) = &group.discrete_pr {
        w.start_element("discretePr")
            .attr_num("count", discrete.items.len())
            .end_attrs();
        for value in &discrete.items {
            w.start_element("x").attr_num("v", value).self_close();
        }
        w.end_element("discretePr");
    }
    if let Some(items) = &group.group_items {
        w.start_element("groupItems")
            .attr_num("count", items.items.len())
            .end_attrs();
        for item in &items.items {
            let item = match item {
                SharedItem::Missing => super::types::SharedItem::Missing,
                SharedItem::Number(v) => super::types::SharedItem::Number(*v),
                SharedItem::Boolean(v) => super::types::SharedItem::Boolean(*v),
                SharedItem::Error(v) => super::types::SharedItem::Error(v.clone()),
                SharedItem::String(v) => super::types::SharedItem::String(v.clone()),
                SharedItem::DateTime(v) => super::types::SharedItem::DateTime(v.clone()),
            };
            item.write_xml(w);
        }
        w.end_element("groupItems");
    }
    w.end_element("fieldGroup");
}
