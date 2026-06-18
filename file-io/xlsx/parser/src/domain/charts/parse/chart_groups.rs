//! Chart type group detection and combo chart grouping.

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_lt_simd,
    find_start_tag_end_quoted, find_tag_simd, StartTagEnd,
};

use super::super::xml_helpers::{find_pos_after_last_ser, parse_ax_ids};
use super::super::*;
use super::attrs;
use super::config;

pub(super) type ParsedChartTypeAndSeries = (
    ChartType,
    bool,
    Vec<ChartSeries>,
    Option<ChartTypeConfig>,
    Option<DataLabelOptions>,
    Vec<u32>,
    Option<String>,
    Vec<ooxml_types::charts::ChartGroup>,
);

/// Parse chart type and series from plot area.
/// Returns: (chart_type, is_3d, series, config, d_lbls, ax_ids_from_chart_type, raw_chart_type_attr, chart_groups)
///
/// For combo charts (multiple chart type elements in plotArea), `chart_groups` contains
/// individually-parsed ChartGroup entries preserving per-group config, series, dLbls, and axIds.
/// The flat `series` field is the union of all groups' series for backwards compatibility.
pub(super) fn parse_chart_type_and_series(xml: &[u8]) -> ParsedChartTypeAndSeries {
    use ooxml_types::charts as oc;

    // List of chart type tags to check
    let chart_types: &[(&[u8], ChartType, bool)] = &[
        (b"barChart", ChartType::Bar, false),
        (b"bar3DChart", ChartType::Bar3D, true),
        (b"lineChart", ChartType::Line, false),
        (b"line3DChart", ChartType::Line3D, true),
        (b"pieChart", ChartType::Pie, false),
        (b"pie3DChart", ChartType::Pie3D, true),
        (b"doughnutChart", ChartType::Doughnut, false),
        (b"areaChart", ChartType::Area, false),
        (b"area3DChart", ChartType::Area3D, true),
        (b"scatterChart", ChartType::Scatter, false),
        (b"bubbleChart", ChartType::Bubble, false),
        (b"radarChart", ChartType::Radar, false),
        (b"surfaceChart", ChartType::Surface, false),
        (b"surface3DChart", ChartType::Surface3D, true),
        (b"stockChart", ChartType::Stock, false),
        (b"ofPieChart", ChartType::OfPie, false),
    ];

    // Scan for ALL occurrences of every chart type tag, recording byte offset.
    // This handles both multiple different types (areaChart + lineChart) and
    // duplicate types (lineChart + lineChart).
    let mut found_occurrences: Vec<(&[u8], ChartType, bool, usize)> = Vec::new();
    for (tag, chart_type, is_3d) in chart_types {
        let mut pos = 0;
        while let Some(start) = find_tag_simd(xml, tag, pos) {
            found_occurrences.push((tag, *chart_type, *is_3d, start));
            let end = find_closing_tag(xml, tag, start).unwrap_or(xml.len());
            pos = end;
        }
    }
    // Sort by byte offset to preserve original XML element order
    found_occurrences.sort_by_key(|&(_, _, _, start)| start);

    // If multiple chart type elements found, it's a combo chart
    if found_occurrences.len() > 1 {
        let mut all_series = Vec::new();
        let mut all_ax_ids = Vec::new();
        let mut groups = Vec::new();

        for (tag, chart_type, _, start) in &found_occurrences {
            let type_end = find_closing_tag(xml, tag, *start).unwrap_or(xml.len());
            let type_bytes = &xml[*start..type_end];

            let final_type = if *chart_type == ChartType::Bar {
                check_bar_direction(type_bytes)
            } else {
                *chart_type
            };

            let series = parse_all_series(type_bytes);
            let config = config::parse_chart_type_config(*chart_type, type_bytes);
            let ax_ids = parse_ax_ids(type_bytes);
            let raw_attr = attrs::parse_string_attr(&xml[*start..], b"chartType=\"");

            // Chart-group-level dLbls comes AFTER all <c:ser> elements in the
            // schema.  We must skip past all series to avoid matching a
            // series-level <c:dLbls> nested inside <c:ser>.
            let after_last_ser = find_pos_after_last_ser(type_bytes);
            let d_lbls =
                if let Some(dlbls_start) = find_tag_simd(type_bytes, b"dLbls", after_last_ser) {
                    let dlbls_end = find_complete_element_end(type_bytes, b"dLbls", dlbls_start);
                    Some(parse_data_labels(&type_bytes[dlbls_start..dlbls_end]))
                } else {
                    None
                };

            all_series.extend(series.clone());
            for id in &ax_ids {
                if !all_ax_ids.contains(id) {
                    all_ax_ids.push(*id);
                }
            }

            groups.push(oc::ChartGroup {
                chart_type: final_type,
                config: config.unwrap_or(ChartTypeConfig::Combo),
                series,
                d_lbls,
                ax_id: ax_ids,
                raw_chart_type_attr: raw_attr,
                raw_chart_element_name: None,
                raw_chart_group_xml: None,
            });
        }

        return (
            ChartType::Combo,
            false,
            all_series,
            Some(ChartTypeConfig::Combo),
            None,
            all_ax_ids,
            None,
            groups,
        );
    }

    // Single chart type or no chart type found
    if let Some((tag, chart_type, is_3d, start)) = found_occurrences.first() {
        let type_end = find_closing_tag(xml, tag, *start).unwrap_or(xml.len());
        let type_bytes = &xml[*start..type_end];

        // Adjust for bar direction
        let final_type = if *chart_type == ChartType::Bar {
            check_bar_direction(type_bytes)
        } else {
            *chart_type
        };

        // Parse series
        let series = parse_all_series(type_bytes);

        // Parse chart-type config
        let config = config::parse_chart_type_config(*chart_type, type_bytes);

        // Parse chart-level dLbls (must skip past all <c:ser> to avoid
        // matching series-level dLbls nested inside a <c:ser>).
        let after_last_ser = find_pos_after_last_ser(type_bytes);
        let chart_dlbls =
            if let Some(dlbls_start) = find_tag_simd(type_bytes, b"dLbls", after_last_ser) {
                let dlbls_end = find_complete_element_end(type_bytes, b"dLbls", dlbls_start);
                Some(parse_data_labels(&type_bytes[dlbls_start..dlbls_end]))
            } else {
                None
            };

        let chart_ax_ids = parse_ax_ids(type_bytes);
        let raw_chart_type_attr = attrs::parse_string_attr(&xml[*start..], b"chartType=\"");
        return (
            final_type,
            *is_3d,
            series,
            config,
            chart_dlbls,
            chart_ax_ids,
            raw_chart_type_attr,
            Vec::new(),
        );
    }

    if let Some(unknown) = find_unknown_standard_chart_group(xml, chart_types) {
        let type_bytes = &xml[unknown.start..unknown.end];
        let series = parse_all_series(type_bytes);
        let chart_dlbls = if let Some(dlbls_start) =
            find_tag_simd(type_bytes, b"dLbls", find_pos_after_last_ser(type_bytes))
        {
            let dlbls_end = find_complete_element_end(type_bytes, b"dLbls", dlbls_start);
            Some(parse_data_labels(&type_bytes[dlbls_start..dlbls_end]))
        } else {
            None
        };
        let chart_ax_ids = parse_ax_ids(type_bytes);
        let raw_chart_type_attr = attrs::parse_string_attr(type_bytes, b"chartType=\"");

        return (
            ChartType::Unknown,
            false,
            series.clone(),
            Some(ChartTypeConfig::Combo),
            chart_dlbls.clone(),
            chart_ax_ids.clone(),
            raw_chart_type_attr.clone(),
            vec![oc::ChartGroup {
                chart_type: ChartType::Unknown,
                config: ChartTypeConfig::Combo,
                series,
                d_lbls: chart_dlbls,
                ax_id: chart_ax_ids,
                raw_chart_type_attr,
                raw_chart_element_name: Some(unknown.element_name),
                raw_chart_group_xml: Some(String::from_utf8_lossy(type_bytes).into_owned()),
            }],
        );
    }

    (
        ChartType::Unknown,
        false,
        Vec::new(),
        None,
        None,
        Vec::new(),
        None,
        Vec::new(),
    )
}

fn find_complete_element_end(xml: &[u8], tag: &[u8], start: usize) -> usize {
    find_closing_tag(xml, tag, start)
        .and_then(|close_start| find_gt_simd(xml, close_start).map(|end| end + 1))
        .unwrap_or(xml.len())
}

struct UnknownChartGroup {
    element_name: String,
    start: usize,
    end: usize,
}

fn find_unknown_standard_chart_group(
    xml: &[u8],
    known_chart_types: &[(&[u8], ChartType, bool)],
) -> Option<UnknownChartGroup> {
    let mut pos = 0;
    let mut depth = 0usize;

    while let Some(lt) = find_lt_simd(xml, pos) {
        let &next = xml.get(lt + 1)?;
        if matches!(next, b'!' | b'?') {
            pos = find_gt_simd(xml, lt).map_or(xml.len(), |gt| gt + 1);
            continue;
        }

        let closing = next == b'/';
        let name_start = lt + if closing { 2 } else { 1 };
        let mut name_end = name_start;
        while name_end < xml.len() {
            let b = xml[name_end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                break;
            }
            name_end += 1;
        }
        let name = &xml[name_start..name_end];
        let local_name = local_xml_name(name);
        let start_tag_end = match find_start_tag_end_quoted(xml, lt) {
            StartTagEnd::Found(gt) => gt,
            StartTagEnd::UnterminatedQuote { fallback_gt, .. } => fallback_gt.unwrap_or(lt),
            StartTagEnd::Missing => lt,
        };

        if closing {
            depth = depth.saturating_sub(1);
            pos = start_tag_end.saturating_add(1);
            continue;
        }

        let self_closing = start_tag_end > lt && xml[start_tag_end.saturating_sub(1)] == b'/';
        if depth == 1 && is_unknown_chart_group_name(local_name, known_chart_types) {
            let end = if self_closing {
                start_tag_end + 1
            } else {
                let close_lt = find_closing_tag(xml, local_name, lt)?;
                find_gt_simd(xml, close_lt).map_or(close_lt, |gt| gt + 1)
            };
            return Some(UnknownChartGroup {
                element_name: String::from_utf8_lossy(local_name).into_owned(),
                start: lt,
                end,
            });
        }

        if !self_closing {
            depth = depth.saturating_add(1);
        }
        pos = start_tag_end.saturating_add(1);
    }

    None
}

fn local_xml_name(name: &[u8]) -> &[u8] {
    name.iter()
        .rposition(|b| *b == b':')
        .map_or(name, |idx| &name[idx + 1..])
}

fn is_unknown_chart_group_name(
    local_name: &[u8],
    known_chart_types: &[(&[u8], ChartType, bool)],
) -> bool {
    local_name.ends_with(b"Chart")
        && known_chart_types
            .iter()
            .all(|(known_name, _, _)| *known_name != local_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_direct_chart_group_preserves_raw_element_identity() {
        let xml = br#"
            <c:plotArea>
              <c:fooChart>
                <c:ser><c:idx val="0"/><c:order val="0"/></c:ser>
                <c:axId val="1"/><c:axId val="2"/>
              </c:fooChart>
              <c:catAx><c:axId val="1"/></c:catAx>
              <c:valAx><c:axId val="2"/></c:valAx>
            </c:plotArea>
        "#;

        let (chart_type, _, series, config, _, axis_ids, _, groups) =
            parse_chart_type_and_series(xml);

        assert_eq!(chart_type, ChartType::Unknown);
        assert!(matches!(config, Some(ChartTypeConfig::Combo)));
        assert_eq!(series.len(), 1);
        assert_eq!(axis_ids, vec![1, 2]);
        assert_eq!(groups.len(), 1);
        assert_eq!(
            groups[0].raw_chart_element_name.as_deref(),
            Some("fooChart")
        );
        assert!(groups[0]
            .raw_chart_group_xml
            .as_deref()
            .is_some_and(|raw| raw.contains("<c:fooChart>")));
    }

    #[test]
    fn known_chart_group_raw_chart_type_attr_is_not_unknown_family_identity() {
        let xml = br#"
            <c:plotArea>
              <c:barChart chartType="googleCombo">
                <c:barDir val="col"/>
                <c:axId val="1"/><c:axId val="2"/>
              </c:barChart>
            </c:plotArea>
        "#;

        let (chart_type, _, _, _, _, _, raw_attr, groups) = parse_chart_type_and_series(xml);

        assert_eq!(chart_type, ChartType::Bar);
        assert_eq!(raw_attr.as_deref(), Some("googleCombo"));
        assert!(groups.is_empty());
    }

    #[test]
    fn chart_group_data_labels_preserve_direct_shape_properties() {
        let xml = br#"
            <c:plotArea>
              <c:areaChart>
                <c:ser><c:idx val="0"/><c:order val="0"/></c:ser>
                <c:dLbls>
                  <c:spPr>
                    <a:ln><a:noFill/></a:ln>
                  </c:spPr>
                </c:dLbls>
              </c:areaChart>
            </c:plotArea>
        "#;

        let (_, _, _, _, labels, _, _, _) = parse_chart_type_and_series(xml);

        assert!(matches!(
            labels
                .as_ref()
                .and_then(|labels| labels.sp_pr.as_ref())
                .and_then(|sp_pr| sp_pr.ln.as_ref())
                .and_then(|line| line.fill.as_ref()),
            Some(ooxml_types::drawings::LineFill::NoFill)
        ));
    }
}

/// Check bar chart direction to determine if it's actually a column chart.
fn check_bar_direction(xml: &[u8]) -> ChartType {
    if let Some(bar_dir_start) = find_tag_simd(xml, b"barDir", 0) {
        if let Some(val_pos) = find_attr_simd(xml, b"val=\"", bar_dir_start) {
            let value_start = val_pos + 5; // Skip `val="`
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = &xml[start..end];
                if val == b"col" {
                    return ChartType::Bar; // Vertical bars = Column chart style
                } else if val == b"bar" {
                    return ChartType::Bar; // Horizontal bars
                }
            }
        }
    }
    ChartType::Bar
}
