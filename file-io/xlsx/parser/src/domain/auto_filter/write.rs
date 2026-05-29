//! XML writer for AutoFilter domain type.
//!
//! Typed OOXML preservation: extended this writer to be lossless over CT_AutoFilter:
//! `<colorFilter>` preserves `dxfId` and `cellColor`, `<iconFilter>` is
//! emitted for `OoxmlFilterType::Icon`, `<filters>` carries
//! `calendarType` + `<dateGroupItem>` children, `<top10>` carries
//! `filterVal`, `<dynamicFilter>` carries `val` / `maxVal` / `valIso` /
//! `maxValIso`, and `<filterColumn>` carries `hiddenButton` /
//! `showButton` attributes.

use crate::write::xml_writer::XmlWriter;
use domain_types::{AutoFilter, DateTimeGrouping, OoxmlFilterType};

/// Serialize an `AutoFilter` into an OOXML XML fragment.
pub fn write_auto_filter_xml(filter: &AutoFilter) -> String {
    write_auto_filter_xml_with_strict(filter, false)
}

/// Serialize an `AutoFilter`, optionally suppressing Transitional-only attrs.
pub fn write_auto_filter_xml_with_strict(filter: &AutoFilter, strict: bool) -> String {
    let mut w = XmlWriter::new();
    w.start_element("autoFilter").attr("ref", &filter.range_ref);
    if let Some(uid) = &filter.xr_uid {
        w.attr("xr:uid", uid);
    }

    let has_children =
        !filter.columns.is_empty() || filter.sort.is_some() || filter.ext_lst_raw.is_some();
    if !has_children {
        w.self_close();
        return String::from_utf8(w.finish()).unwrap_or_default();
    }
    w.end_attrs();

    // Filter columns
    for fc in &filter.columns {
        w.start_element("filterColumn")
            .attr_num("colId", fc.col_index);
        if fc.hidden_button {
            w.attr("hiddenButton", "1");
        }
        if !fc.show_button {
            // Default is true; only emit when suppressed.
            w.attr("showButton", "0");
        }
        let has_ext = fc.ext_lst_raw.is_some();
        let Some(filter_type) = &fc.filter_type else {
            if let Some(raw) = &fc.ext_lst_raw {
                w.end_attrs();
                w.raw_str(raw);
                w.end_element("filterColumn");
            } else {
                w.self_close();
            }
            continue;
        };
        w.end_attrs();

        write_filter_type_xml(&mut w, filter_type, strict);

        // CT_FilterColumn is a choice. This path only replays a source-owned
        // extLst alongside a known child when the imported owner carried both.
        if has_ext {
            if let Some(raw) = &fc.ext_lst_raw {
                w.raw_str(raw);
            }
        }

        w.end_element("filterColumn");
    }

    // Sort state
    if let Some(ref sort) = filter.sort {
        write_sort_state_inner(&mut w, sort);
    }

    if let Some(raw) = &filter.ext_lst_raw {
        w.raw_str(raw);
    }

    w.end_element("autoFilter");
    String::from_utf8(w.finish()).unwrap_or_default()
}

fn write_filter_type_xml(w: &mut XmlWriter, filter_type: &OoxmlFilterType, strict: bool) {
    match filter_type {
        OoxmlFilterType::Values {
            values,
            blanks,
            calendar_type,
            date_group_items,
        } => {
            w.start_element("filters");
            if *blanks {
                w.attr("blank", "1");
            }
            if let Some(ct) = calendar_type {
                w.attr("calendarType", ct.to_ooxml_token());
            }
            w.end_attrs();
            for val in values {
                w.start_element("filter").attr("val", val).self_close();
            }
            for dgi in date_group_items {
                w.start_element("dateGroupItem")
                    .attr("year", &dgi.year.to_string());
                if let Some(m) = dgi.month {
                    w.attr("month", &m.to_string());
                }
                if let Some(d) = dgi.day {
                    w.attr("day", &d.to_string());
                }
                if let Some(h) = dgi.hour {
                    w.attr("hour", &h.to_string());
                }
                if let Some(min) = dgi.minute {
                    w.attr("minute", &min.to_string());
                }
                if let Some(s) = dgi.second {
                    w.attr("second", &s.to_string());
                }
                // dateTimeGrouping is required per XSD.
                w.attr("dateTimeGrouping", dgi.date_time_grouping.to_ooxml_token());
                w.self_close();
            }
            w.end_element("filters");
        }
        OoxmlFilterType::Top10 {
            top,
            percent,
            value,
            filter_val,
        } => {
            w.start_element("top10");
            if !top {
                w.attr("top", "0");
            }
            if *percent {
                w.attr("percent", "1");
            }
            w.attr("val", &format_f64_auto(*value));
            if let Some(fv) = filter_val {
                w.attr("filterVal", &format_f64_auto(*fv));
            }
            w.self_close();
        }
        OoxmlFilterType::Custom {
            conditions,
            and_logic,
        } => {
            w.start_element("customFilters");
            if *and_logic {
                w.attr("and", "1");
            }
            w.end_attrs();
            for cond in conditions {
                let val_str = cell_value_to_filter_string(&cond.value);
                w.start_element("customFilter")
                    .attr("operator", &cond.operator)
                    .attr("val", &val_str)
                    .self_close();
            }
            w.end_element("customFilters");
        }
        OoxmlFilterType::Dynamic {
            dynamic_type,
            value,
            max_value,
            value_iso,
            max_value_iso,
        } => {
            w.start_element("dynamicFilter").attr("type", dynamic_type);
            if let Some(v) = value {
                w.attr("val", &format_f64_auto(*v));
            }
            if !strict {
                if let Some(mv) = max_value {
                    w.attr("maxVal", &format_f64_auto(*mv));
                }
            }
            if let Some(v) = value_iso {
                w.attr("valIso", v);
            }
            if let Some(mv) = max_value_iso {
                w.attr("maxValIso", mv);
            }
            w.self_close();
        }
        OoxmlFilterType::Color { dxf_id, cell_color } => {
            // Typed OOXML preservation: now carries the real dxfId rather than
            // hard-coding "0" and ignoring the runtime color token.
            // When no dxfId is available, the attribute is omitted
            // (still OOXML-valid per the schema).
            w.start_element("colorFilter");
            if let Some(id) = dxf_id {
                w.attr("dxfId", &id.to_string());
            }
            // `cellColor` defaults to true; only emit when false.
            if !cell_color {
                w.attr("cellColor", "0");
            }
            w.self_close();
        }
        OoxmlFilterType::Icon { icon_set, icon_id } => {
            w.start_element("iconFilter");
            if let Some(set) = icon_set {
                w.attr("iconSet", set);
            }
            w.attr("iconId", &icon_id.to_string());
            w.self_close();
        }
    }
}

// Silence the unused-import warning when only some paths use DateTimeGrouping.
#[allow(dead_code)]
fn _dtg_tag(d: DateTimeGrouping) -> &'static str {
    d.to_ooxml_token()
}

/// Serialize a standalone `<sortState>` (worksheet-level, not nested in
/// `<autoFilter>`) into an OOXML XML fragment.
///
/// Typed OOXML preservation: worksheet-level sort was previously
/// round-tripped via a raw worksheet XML sidecar. Writer now
/// reconstructs from the typed `SheetData.sort_state`.
pub fn write_sort_state_xml(sort: &domain_types::SortState) -> String {
    let mut w = XmlWriter::new();
    write_sort_state_inner(&mut w, sort);
    String::from_utf8(w.finish()).unwrap_or_default()
}

/// Shared serializer for `<sortState>` — emits the element (with children)
/// into the provided writer. Used by both the auto-filter nested form and the
/// standalone worksheet-level form.
fn write_sort_state_inner(w: &mut XmlWriter, sort: &domain_types::SortState) {
    w.start_element("sortState").attr("ref", &sort.range_ref);
    for (prefix, uri) in &sort.namespace_attrs {
        if prefix.is_empty() {
            w.attr("xmlns", uri);
        } else {
            w.attr(&format!("xmlns:{prefix}"), uri);
        }
    }
    if sort.column_sort {
        w.attr("columnSort", "1");
    }
    if sort.case_sensitive {
        w.attr("caseSensitive", "1");
    }
    if sort.sort_method != domain_types::SortMethod::None {
        w.attr("sortMethod", sort.sort_method.to_ooxml_token());
    }

    if sort.conditions.is_empty() && sort.ext_lst_raw.is_none() {
        // Emit the self-closing form `<sortState .../>` when there are no
        // child conditions. Matches how the CT_SortState XSD permits an
        // element with just attributes.
        w.self_close();
        return;
    }
    w.end_attrs();

    for cond in &sort.conditions {
        w.start_element("sortCondition");
        if cond.descending {
            w.attr("descending", "1");
        }
        if cond.sort_by != domain_types::SortConditionBy::Value {
            w.attr("sortBy", cond.sort_by.to_ooxml_token());
        }
        w.attr("ref", &cond.range_ref);
        if let Some(ref custom_list) = cond.custom_list {
            w.attr("customList", custom_list);
        }
        if let Some(dxf_id) = cond.dxf_id {
            w.attr("dxfId", &dxf_id.to_string());
        }
        if let Some(icon_set) = cond.icon_set {
            w.attr("iconSet", icon_set.to_ooxml());
        }
        if let Some(icon_id) = cond.icon_id {
            w.attr("iconId", &icon_id.to_string());
        }
        w.self_close();
    }

    if let Some(raw) = &sort.ext_lst_raw {
        w.raw_str(raw);
    }

    w.end_element("sortState");
}

/// Format an f64 for XML, stripping unnecessary trailing zeros.
fn format_f64_auto(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON && value.abs() < i64::MAX as f64 {
        format!("{}", value as i64)
    } else {
        format!("{}", value)
    }
}

/// Render a `CellValue` filter operand as the OOXML `<customFilter val="..."/>`
/// attribute string. Typed OOXML preservation: replaced the former `serde_json::Value`-blob
/// operand with typed `CellValue`.
fn cell_value_to_filter_string(v: &value_types::CellValue) -> String {
    match v {
        value_types::CellValue::Text(s) => s.to_string(),
        value_types::CellValue::Number(n) => format_f64_auto(n.get()),
        value_types::CellValue::Boolean(b) => {
            if *b {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::{FilterColumn, SortCondition, SortConditionBy, SortMethod, SortState};

    // ─ Typed OOXML preservation: worksheet-level sort-state writer ─

    #[test]
    fn test_write_childless_filter_column_self_closes_without_filters_child() {
        let af = AutoFilter {
            range_ref: "A1:D20".to_string(),
            columns: vec![FilterColumn {
                col_index: 1,
                hidden_button: true,
                show_button: false,
                filter_type: None,
                ext_lst_raw: None,
            }],
            sort: None,
            xr_uid: None,
            ext_lst_raw: None,
        };
        let xml = write_auto_filter_xml(&af);

        assert!(xml.contains(r#"<filterColumn colId="1" hiddenButton="1" showButton="0"/>"#));
        assert!(!xml.contains("<filters"));
    }

    #[test]
    fn test_write_explicit_empty_values_filter_keeps_filters_child() {
        let af = AutoFilter {
            range_ref: "A1:D20".to_string(),
            columns: vec![FilterColumn {
                col_index: 0,
                filter_type: Some(OoxmlFilterType::Values {
                    values: Vec::new(),
                    blanks: false,
                    calendar_type: None,
                    date_group_items: Vec::new(),
                }),
                ..Default::default()
            }],
            sort: None,
            xr_uid: None,
            ext_lst_raw: None,
        };
        let xml = write_auto_filter_xml(&af);

        assert!(xml.contains(r#"<filterColumn colId="0"><filters></filters></filterColumn>"#));
    }

    #[test]
    fn test_write_sort_state_self_closing_when_no_children() {
        let ss = SortState {
            range_ref: "A1:D20".to_string(),
            ..Default::default()
        };
        let xml = write_sort_state_xml(&ss);
        assert!(xml.starts_with(r#"<sortState ref="A1:D20""#));
        assert!(xml.ends_with("/>"));
    }

    #[test]
    fn test_write_sort_state_with_all_attrs_and_one_condition() {
        let ss = SortState {
            range_ref: "A1:D20".to_string(),
            column_sort: true,
            case_sensitive: true,
            sort_method: SortMethod::PinYin,
            conditions: vec![SortCondition {
                range_ref: "A1:A20".to_string(),
                descending: true,
                sort_by: SortConditionBy::CellColor,
                custom_list: Some("H,M,L".to_string()),
                dxf_id: Some(2),
                icon_set: None,
                icon_id: None,
            }],
            ..Default::default()
        };
        let xml = write_sort_state_xml(&ss);
        assert!(xml.contains(r#"ref="A1:D20""#));
        assert!(xml.contains(r#"columnSort="1""#));
        assert!(xml.contains(r#"caseSensitive="1""#));
        assert!(xml.contains(r#"sortMethod="pinYin""#));
        assert!(xml.contains(r#"<sortCondition"#));
        assert!(xml.contains(r#"descending="1""#));
        assert!(xml.contains(r#"sortBy="cellColor""#));
        assert!(xml.contains(r#"dxfId="2""#));
        assert!(xml.contains(r#"customList="H,M,L""#));
        assert!(xml.contains(r#"</sortState>"#));
    }

    #[test]
    fn test_write_sort_state_icon_condition() {
        let ss = SortState {
            range_ref: "B2:B10".to_string(),
            conditions: vec![SortCondition {
                range_ref: "B2:B10".to_string(),
                sort_by: SortConditionBy::Icon,
                icon_set: Some(ooxml_types::cond_format::IconSetType::ThreeTrafficLights1),
                icon_id: Some(1),
                ..Default::default()
            }],
            ..Default::default()
        };
        let xml = write_sort_state_xml(&ss);
        assert!(xml.contains(r#"sortBy="icon""#));
        assert!(xml.contains(r#"iconSet="3TrafficLights1""#));
        assert!(xml.contains(r#"iconId="1""#));
    }

    #[test]
    fn test_write_sort_state_roundtrip_via_parse() {
        // End-to-end: write produces XML that the standalone parser can
        // re-read and produce the same typed SortState.
        use crate::domain::worksheet::read::parse_standalone_sort_state;

        let original = SortState {
            range_ref: "A1:C10".to_string(),
            column_sort: false,
            case_sensitive: true,
            sort_method: SortMethod::Stroke,
            conditions: vec![
                SortCondition {
                    range_ref: "A1:A10".to_string(),
                    descending: true,
                    sort_by: SortConditionBy::Value,
                    custom_list: None,
                    dxf_id: None,
                    icon_set: None,
                    icon_id: None,
                },
                SortCondition {
                    range_ref: "B1:B10".to_string(),
                    descending: false,
                    sort_by: SortConditionBy::FontColor,
                    custom_list: None,
                    dxf_id: Some(5),
                    icon_set: None,
                    icon_id: None,
                },
            ],
            ..Default::default()
        };
        let xml = write_sort_state_xml(&original);
        let reparsed = parse_standalone_sort_state(xml.as_bytes()).expect("parse");
        assert_eq!(reparsed, original);
    }
}
