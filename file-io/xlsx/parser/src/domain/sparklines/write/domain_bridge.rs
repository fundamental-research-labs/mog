//! Bridge from domain sparkline models to worksheet extension XML.

use crate::infra::a1::to_a1;
use domain_types::domain::sparkline::{
    AxisBound, AxisBoundLabel, EmptyCellDisplay, Sparkline as DomainSparkline,
    SparklineAxisSettings, SparklineGroup as DomainSparklineGroup,
    SparklineType as DomainSparklineType, SparklineVisualSettings,
};

use super::constants::{SPARKLINE_EXT_URI, X14_NS, XM_NS};
use super::format::{format_sheet_qualified_ref, hex_to_argb, sparkline_xml_escape};

/// Convert a `SparklineDataRange` to an A1-style range string (e.g. "A1:E1").
pub(super) fn data_range_to_a1(r: &domain_types::domain::sparkline::SparklineDataRange) -> String {
    let start = to_a1(r.start_row, r.start_col);
    let end = to_a1(r.end_row, r.end_col);
    if start == end {
        start
    } else {
        format!("{}:{}", start, end)
    }
}

fn data_range_to_formula_ref(
    fallback_sheet_name: &str,
    r: &domain_types::domain::sparkline::SparklineDataRange,
) -> String {
    let data_range_a1 = data_range_to_a1(r);
    let source_sheet_name = r
        .source_sheet_name
        .as_deref()
        .unwrap_or(fallback_sheet_name);
    format_sheet_qualified_ref(source_sheet_name, &data_range_a1)
}

/// Convert a `SparklineType` enum to its OOXML string representation.
pub(super) fn domain_sparkline_type_str(t: &DomainSparklineType) -> &'static str {
    match t {
        DomainSparklineType::Line => "line",
        DomainSparklineType::Column => "column",
        DomainSparklineType::WinLoss => "stacked",
    }
}

/// Extract the OOXML `minAxisType`/`maxAxisType` attribute value from an `AxisBound`.
pub(super) fn axis_bound_type_str(b: &AxisBound) -> Option<&'static str> {
    match b {
        AxisBound::Value(_) => Some("custom"),
        AxisBound::Label(AxisBoundLabel::Same) => Some("group"),
        AxisBound::Label(AxisBoundLabel::Auto) => None, // auto is default, omit
    }
}

/// Extract the numeric value from an `AxisBound::Value`.
pub(super) fn axis_bound_value(b: &AxisBound) -> Option<f64> {
    match b {
        AxisBound::Value(v) => Some(*v),
        _ => None,
    }
}

pub(super) fn domain_empty_cell_display_str(display: &EmptyCellDisplay) -> &'static str {
    match display {
        EmptyCellDisplay::Gaps => "gap",
        EmptyCellDisplay::Zero => "zero",
        EmptyCellDisplay::Connect => "span",
    }
}

pub(super) fn append_domain_group_xml(
    xml: &mut String,
    sheet_name: &str,
    sparkline_type: &DomainSparklineType,
    visual: &SparklineVisualSettings,
    axis: &SparklineAxisSettings,
    members: &[&DomainSparkline],
) {
    xml.push_str("<x14:sparklineGroup");

    let type_str = domain_sparkline_type_str(sparkline_type);
    if type_str != "line" {
        xml.push_str(&format!(" type=\"{}\"", type_str));
    }
    xml.push_str(&format!(
        " displayEmptyCellsAs=\"{}\"",
        domain_empty_cell_display_str(&axis.display_empty_cells)
    ));

    if let Some(weight) = visual.line_weight {
        xml.push_str(&format!(" lineWeight=\"{}\"", weight));
    }
    if visual.show_markers.unwrap_or(false) {
        xml.push_str(" markers=\"1\"");
    }
    if sparkline_flag_enabled(visual.show_high_point, visual.high_point_color.is_some()) {
        xml.push_str(" high=\"1\"");
    }
    if sparkline_flag_enabled(visual.show_low_point, visual.low_point_color.is_some()) {
        xml.push_str(" low=\"1\"");
    }
    if sparkline_flag_enabled(visual.show_first_point, visual.first_point_color.is_some()) {
        xml.push_str(" first=\"1\"");
    }
    if sparkline_flag_enabled(visual.show_last_point, visual.last_point_color.is_some()) {
        xml.push_str(" last=\"1\"");
    }
    if sparkline_flag_enabled(visual.show_negative_points, visual.negative_color.is_some()) {
        xml.push_str(" negative=\"1\"");
    }
    if axis.show_axis.unwrap_or(false) {
        xml.push_str(" displayXAxis=\"1\"");
    }
    if axis.right_to_left.unwrap_or(false) {
        xml.push_str(" rightToLeft=\"1\"");
    }
    if let Some(min_type) = axis_bound_type_str(&axis.min_value) {
        xml.push_str(&format!(" minAxisType=\"{}\"", min_type));
    }
    if let Some(max_type) = axis_bound_type_str(&axis.max_value) {
        xml.push_str(&format!(" maxAxisType=\"{}\"", max_type));
    }
    if let Some(min_val) = axis_bound_value(&axis.min_value) {
        xml.push_str(&format!(" manualMin=\"{}\"", min_val));
    }
    if let Some(max_val) = axis_bound_value(&axis.max_value) {
        xml.push_str(&format!(" manualMax=\"{}\"", max_val));
    }

    xml.push('>');

    if !visual.color.is_empty() {
        append_domain_color_element(xml, "colorSeries", &visual.color);
    }
    if let Some(ref c) = visual.negative_color {
        append_domain_color_element(xml, "colorNegative", c);
    }
    if let Some(ref c) = axis.axis_color {
        append_domain_color_element(xml, "colorAxis", c);
    }
    if let Some(ref c) = visual.marker_color {
        append_domain_color_element(xml, "colorMarkers", c);
    }
    if let Some(ref c) = visual.first_point_color {
        append_domain_color_element(xml, "colorFirst", c);
    }
    if let Some(ref c) = visual.last_point_color {
        append_domain_color_element(xml, "colorLast", c);
    }
    if let Some(ref c) = visual.high_point_color {
        append_domain_color_element(xml, "colorHigh", c);
    }
    if let Some(ref c) = visual.low_point_color {
        append_domain_color_element(xml, "colorLow", c);
    }

    if !members.is_empty() {
        xml.push_str("<x14:sparklines>");
        for sp in members {
            xml.push_str("<x14:sparkline>");
            let qualified_range = data_range_to_formula_ref(sheet_name, &sp.data_range);
            xml.push_str(&format!(
                "<xm:f>{}</xm:f>",
                sparkline_xml_escape(&qualified_range)
            ));
            let cell_ref = to_a1(sp.cell.row, sp.cell.col);
            xml.push_str(&format!(
                "<xm:sqref>{}</xm:sqref>",
                sparkline_xml_escape(&cell_ref)
            ));
            xml.push_str("</x14:sparkline>");
        }
        xml.push_str("</x14:sparklines>");
    }

    xml.push_str("</x14:sparklineGroup>");
}

fn append_domain_color_element(xml: &mut String, element_name: &str, color: &str) {
    if let Some((theme, tint)) = parse_theme_color_ref(color) {
        xml.push_str(&format!("<x14:{element_name} theme=\"{theme}\""));
        if let Some(tint) = tint {
            xml.push_str(&format!(" tint=\"{tint}\""));
        }
        xml.push_str("/>");
    } else {
        xml.push_str(&format!(
            "<x14:{element_name} rgb=\"{}\"/>",
            hex_to_argb(color)
        ));
    }
}

fn sparkline_flag_enabled(explicit: Option<bool>, has_color: bool) -> bool {
    explicit.unwrap_or(has_color)
}

fn parse_theme_color_ref(color: &str) -> Option<(u32, Option<f64>)> {
    let rest = color.strip_prefix("theme:")?;
    let mut parts = rest.split(':');
    let theme_part = parts.next()?;
    let theme = theme_part
        .parse::<u32>()
        .ok()
        .or_else(|| theme_slot_to_index(theme_part))?;
    let tint = match parts.next() {
        Some(raw) if !raw.is_empty() => Some(raw.parse::<f64>().ok()?),
        _ => None,
    };
    parts.next().is_none().then_some((theme, tint))
}

fn theme_slot_to_index(slot: &str) -> Option<u32> {
    match slot {
        "light1" | "lt1" => Some(0),
        "dark1" | "dk1" => Some(1),
        "light2" | "lt2" => Some(2),
        "dark2" | "dk2" => Some(3),
        "accent1" => Some(4),
        "accent2" => Some(5),
        "accent3" => Some(6),
        "accent4" => Some(7),
        "accent5" => Some(8),
        "accent6" => Some(9),
        "hyperlink" | "hlink" => Some(10),
        "followedHyperlink" | "folHlink" | "fol_hlink" => Some(11),
        _ => None,
    }
}

pub(super) fn append_sparkline_ext_lst_open(xml: &mut String) {
    xml.push_str("<extLst>");
    xml.push_str(&format!(
        "<ext uri=\"{}\" xmlns:x14=\"{}\">",
        SPARKLINE_EXT_URI, X14_NS
    ));
    xml.push_str(&format!("<x14:sparklineGroups xmlns:xm=\"{}\">", XM_NS));
}

pub(super) fn append_sparkline_ext_lst_close(xml: &mut String) {
    xml.push_str("</x14:sparklineGroups>");
    xml.push_str("</ext>");
    xml.push_str("</extLst>");
}

/// Build the `<extLst>` XML containing sparkline groups for a worksheet,
/// consuming the unified `domain_types::Sparkline` representation.
///
/// Sparklines are grouped by `group_id`; sparklines without a group_id each get
/// their own singleton group. The first sparkline in each group determines
/// the group-level display settings (type, colors, markers, axis config).
pub fn sparklines_xml_from_domain(
    sheet_name: &str,
    sparklines: &[domain_types::domain::sparkline::Sparkline],
) -> String {
    // Group sparklines by group_id, preserving insertion order via Vec of (key, members).
    // Ungrouped sparklines each get a unique synthetic key.
    let mut group_order: Vec<String> = Vec::new();
    let mut group_map: std::collections::HashMap<
        String,
        Vec<&domain_types::domain::sparkline::Sparkline>,
    > = std::collections::HashMap::new();
    for sp in sparklines {
        let cell_ref = to_a1(sp.cell.row, sp.cell.col);
        let key = sp
            .group_id
            .clone()
            .unwrap_or_else(|| format!("__solo_{}", cell_ref));
        if !group_map.contains_key(&key) {
            group_order.push(key.clone());
        }
        group_map.entry(key).or_default().push(sp);
    }

    let mut xml = String::new();
    append_sparkline_ext_lst_open(&mut xml);

    for key in &group_order {
        let group = &group_map[key];
        // First sparkline in group determines group-level attributes.
        let leader = group[0];

        // NOTE: `data_in_rows` is intentionally not written to the XML output.
        // The OOXML `x14:sparklineGroup` element has no `dataInRows` attribute;
        // the data orientation (row vs column) is fully determined by the shape
        // of the data_range reference itself (e.g. "A1:A5" is a column range,
        // "A1:E1" is a row range).  The field exists only as parser metadata.

        // Build sparklineGroup opening tag with attributes.
        xml.push_str("<x14:sparklineGroup");

        // Type (omit for "line" since it's the default)
        let type_str = domain_sparkline_type_str(&leader.sparkline_type);
        if type_str != "line" {
            xml.push_str(&format!(" type=\"{}\"", type_str));
        }

        xml.push_str(" displayEmptyCellsAs=\"gap\"");

        // Line weight (only meaningful for line sparklines)
        if let Some(weight) = leader.visual.line_weight {
            xml.push_str(&format!(" lineWeight=\"{}\"", weight));
        }

        // Boolean display flags — inferred from visual settings
        if leader.visual.show_markers.unwrap_or(false) {
            xml.push_str(" markers=\"1\"");
        }
        if sparkline_flag_enabled(
            leader.visual.show_high_point,
            leader.visual.high_point_color.is_some(),
        ) {
            xml.push_str(" high=\"1\"");
        }
        if sparkline_flag_enabled(
            leader.visual.show_low_point,
            leader.visual.low_point_color.is_some(),
        ) {
            xml.push_str(" low=\"1\"");
        }
        if sparkline_flag_enabled(
            leader.visual.show_first_point,
            leader.visual.first_point_color.is_some(),
        ) {
            xml.push_str(" first=\"1\"");
        }
        if sparkline_flag_enabled(
            leader.visual.show_last_point,
            leader.visual.last_point_color.is_some(),
        ) {
            xml.push_str(" last=\"1\"");
        }
        if sparkline_flag_enabled(
            leader.visual.show_negative_points,
            leader.visual.negative_color.is_some(),
        ) {
            xml.push_str(" negative=\"1\"");
        }
        if leader.axis.right_to_left.unwrap_or(false) {
            xml.push_str(" rightToLeft=\"1\"");
        }

        // Axis type attributes
        if let Some(min_type) = axis_bound_type_str(&leader.axis.min_value) {
            xml.push_str(&format!(" minAxisType=\"{}\"", min_type));
        }
        if let Some(max_type) = axis_bound_type_str(&leader.axis.max_value) {
            xml.push_str(&format!(" maxAxisType=\"{}\"", max_type));
        }

        // Custom axis values
        if let Some(min_val) = axis_bound_value(&leader.axis.min_value) {
            xml.push_str(&format!(" manualMin=\"{}\"", min_val));
        }
        if let Some(max_val) = axis_bound_value(&leader.axis.max_value) {
            xml.push_str(&format!(" manualMax=\"{}\"", max_val));
        }

        xml.push('>');

        // Color elements — use ARGB format
        // Series color is always present in unified type
        if !leader.visual.color.is_empty() {
            append_domain_color_element(&mut xml, "colorSeries", &leader.visual.color);
        }
        if let Some(ref c) = leader.visual.negative_color {
            append_domain_color_element(&mut xml, "colorNegative", c);
        }
        // Axis color is always black
        xml.push_str("<x14:colorAxis rgb=\"FF000000\"/>");
        if let Some(ref c) = leader.visual.marker_color {
            append_domain_color_element(&mut xml, "colorMarkers", c);
        }
        if let Some(ref c) = leader.visual.first_point_color {
            append_domain_color_element(&mut xml, "colorFirst", c);
        }
        if let Some(ref c) = leader.visual.last_point_color {
            append_domain_color_element(&mut xml, "colorLast", c);
        }
        if let Some(ref c) = leader.visual.high_point_color {
            append_domain_color_element(&mut xml, "colorHigh", c);
        }
        if let Some(ref c) = leader.visual.low_point_color {
            append_domain_color_element(&mut xml, "colorLow", c);
        }

        // Sparkline entries
        xml.push_str("<x14:sparklines>");
        for sp in group {
            xml.push_str("<x14:sparkline>");
            // Data range — preserve imported source sheet when present.
            let qualified_range = data_range_to_formula_ref(sheet_name, &sp.data_range);
            xml.push_str(&format!(
                "<xm:f>{}</xm:f>",
                sparkline_xml_escape(&qualified_range)
            ));
            let cell_ref = to_a1(sp.cell.row, sp.cell.col);
            xml.push_str(&format!(
                "<xm:sqref>{}</xm:sqref>",
                sparkline_xml_escape(&cell_ref)
            ));
            xml.push_str("</x14:sparkline>");
        }
        xml.push_str("</x14:sparklines>");

        xml.push_str("</x14:sparklineGroup>");
    }

    append_sparkline_ext_lst_close(&mut xml);

    xml
}

/// Build the `<extLst>` XML containing sparkline groups from first-class group state.
///
/// `sparkline_groups` is authoritative for grouped settings and membership.
/// Flat sparklines still provide the individual cell locations and data ranges.
/// Ungrouped flat sparklines are emitted as singleton groups after modeled groups.
pub fn sparkline_groups_xml_from_domain(
    sheet_name: &str,
    sparklines: &[DomainSparkline],
    sparkline_groups: &[DomainSparklineGroup],
) -> String {
    let sparklines_by_id: std::collections::HashMap<&str, &DomainSparkline> = sparklines
        .iter()
        .map(|sparkline| (sparkline.id.as_str(), sparkline))
        .collect();
    let mut emitted_sparkline_ids = std::collections::HashSet::new();

    let mut xml = String::new();
    append_sparkline_ext_lst_open(&mut xml);

    for group in sparkline_groups {
        let mut members: Vec<&DomainSparkline> = group
            .sparkline_ids
            .iter()
            .filter_map(|id| sparklines_by_id.get(id.as_str()).copied())
            .collect();

        if members.is_empty() && group.sparkline_ids.is_empty() {
            members = sparklines
                .iter()
                .filter(|sp| sp.group_id.as_deref() == Some(group.id.as_str()))
                .collect();
        }

        append_domain_group_xml(
            &mut xml,
            sheet_name,
            &group.sparkline_type,
            &group.visual,
            &group.axis,
            &members,
        );
        emitted_sparkline_ids.extend(members.iter().map(|sp| sp.id.clone()));
    }

    for sp in sparklines {
        if sp.group_id.is_none() && !emitted_sparkline_ids.contains(&sp.id) {
            append_domain_group_xml(
                &mut xml,
                sheet_name,
                &sp.sparkline_type,
                &sp.visual,
                &sp.axis,
                &[sp],
            );
        }
    }

    append_sparkline_ext_lst_close(&mut xml);
    xml
}
