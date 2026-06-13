//! Data-range to series synthesis for reconstructed charts.

use domain_types::chart::{ChartSeriesData, ChartSeriesXRoleData, ChartSpec, ChartType};

pub(super) fn series_for_export(spec: &ChartSpec) -> Vec<ChartSeriesData> {
    if !spec.series.is_empty() {
        return spec.series.clone();
    }

    spec.data_range
        .as_deref()
        .and_then(|data_range| {
            synthesize_series_from_data_range_for_chart_type(&spec.chart_type, data_range)
        })
        .unwrap_or_default()
}

fn synthesize_series_from_data_range_for_chart_type(
    chart_type: &ChartType,
    data_range: &str,
) -> Option<Vec<ChartSeriesData>> {
    let parsed = ParsedA1Range::parse(data_range)?;
    if parsed.start_row > parsed.end_row || parsed.start_col > parsed.end_col {
        return None;
    }
    if parsed.start_row == parsed.end_row && parsed.start_col == parsed.end_col {
        return None;
    }

    if matches!(chart_type, ChartType::Bubble) {
        return synthesize_bubble_series_from_parsed_range(&parsed);
    }
    if matches!(chart_type, ChartType::Scatter) {
        return synthesize_xy_series_from_parsed_range(&parsed);
    }
    if is_single_category_value_chart(chart_type) {
        return synthesize_single_category_value_series_from_parsed_range(&parsed);
    }

    synthesize_category_value_series_from_parsed_range(&parsed)
}

fn is_single_category_value_chart(chart_type: &ChartType) -> bool {
    matches!(
        chart_type,
        ChartType::Pie | ChartType::Pie3D | ChartType::Doughnut | ChartType::OfPie
    )
}

fn synthesize_category_value_series_from_parsed_range(
    parsed: &ParsedA1Range,
) -> Option<Vec<ChartSeriesData>> {
    let has_header_row = parsed.start_row < parsed.end_row;
    let has_category_col = parsed.start_col < parsed.end_col;
    let first_value_col = if has_category_col {
        parsed.start_col + 1
    } else {
        parsed.start_col
    };
    let first_value_row = if has_header_row {
        parsed.start_row + 1
    } else {
        parsed.start_row
    };

    if first_value_col > parsed.end_col || first_value_row > parsed.end_row {
        return None;
    }

    let categories = if has_category_col {
        Some(parsed.sub_range(
            parsed.start_col,
            first_value_row,
            parsed.start_col,
            parsed.end_row,
        ))
    } else {
        None
    };

    let mut series = Vec::new();
    for (order, col) in (first_value_col..=parsed.end_col).enumerate() {
        let name = if has_header_row {
            Some(parsed.cell_ref(col, parsed.start_row))
        } else {
            None
        };
        series.push(chart_series_data_from_refs(
            name,
            categories.clone(),
            Some(parsed.sub_range(col, first_value_row, col, parsed.end_row)),
            order as u32,
        ));
    }

    Some(series)
}

fn synthesize_single_category_value_series_from_parsed_range(
    parsed: &ParsedA1Range,
) -> Option<Vec<ChartSeriesData>> {
    let has_header_row = parsed.start_row < parsed.end_row;
    let has_category_col = parsed.start_col < parsed.end_col;
    let value_col = if has_category_col {
        parsed.start_col + 1
    } else {
        parsed.start_col
    };
    let first_value_row = if has_header_row {
        parsed.start_row + 1
    } else {
        parsed.start_row
    };

    if value_col > parsed.end_col || first_value_row > parsed.end_row {
        return None;
    }

    let categories = if has_category_col {
        Some(parsed.sub_range(
            parsed.start_col,
            first_value_row,
            parsed.start_col,
            parsed.end_row,
        ))
    } else {
        None
    };
    let name = if has_header_row {
        Some(parsed.cell_ref(value_col, parsed.start_row))
    } else {
        None
    };

    Some(vec![chart_series_data_from_refs(
        name,
        categories,
        Some(parsed.sub_range(value_col, first_value_row, value_col, parsed.end_row)),
        0,
    )])
}

fn synthesize_xy_series_from_parsed_range(parsed: &ParsedA1Range) -> Option<Vec<ChartSeriesData>> {
    if parsed.start_col + 1 > parsed.end_col || parsed.start_row >= parsed.end_row {
        return None;
    }

    let first_value_row = parsed.start_row + 1;
    let x_values = parsed.sub_range(
        parsed.start_col,
        first_value_row,
        parsed.start_col,
        parsed.end_row,
    );

    let mut series = Vec::new();
    for (order, y_col) in (parsed.start_col + 1..=parsed.end_col).enumerate() {
        let mut sd = chart_series_data_from_refs(
            Some(parsed.cell_ref(y_col, parsed.start_row)),
            Some(x_values.clone()),
            Some(parsed.sub_range(y_col, first_value_row, y_col, parsed.end_row)),
            order as u32,
        );
        sd.x_role = Some(ChartSeriesXRoleData::Quantitative);
        series.push(sd);
    }

    Some(series)
}

fn synthesize_bubble_series_from_parsed_range(
    parsed: &ParsedA1Range,
) -> Option<Vec<ChartSeriesData>> {
    if parsed.start_col + 2 > parsed.end_col || parsed.start_row >= parsed.end_row {
        return None;
    }

    let first_value_row = parsed.start_row + 1;
    let mut series = Vec::new();
    let mut order = 0;
    let mut col = parsed.start_col;
    while col + 2 <= parsed.end_col {
        let mut sd = chart_series_data_from_refs(
            Some(parsed.cell_ref(col + 1, parsed.start_row)),
            Some(parsed.sub_range(col, first_value_row, col, parsed.end_row)),
            Some(parsed.sub_range(col + 1, first_value_row, col + 1, parsed.end_row)),
            order,
        );
        sd.x_role = Some(ChartSeriesXRoleData::Quantitative);
        sd.bubble_size = Some(parsed.sub_range(col + 2, first_value_row, col + 2, parsed.end_row));
        series.push(sd);
        order += 1;
        col += 3;
    }

    (!series.is_empty()).then_some(series)
}

fn chart_series_data_from_refs(
    name_ref: Option<String>,
    categories: Option<String>,
    values: Option<String>,
    idx: u32,
) -> ChartSeriesData {
    let mut series = chart_series_data(None, categories, values, idx);
    series.name_ref = name_ref;
    series
}

pub(super) fn chart_series_data(
    name: Option<String>,
    categories: Option<String>,
    values: Option<String>,
    idx: u32,
) -> ChartSeriesData {
    ChartSeriesData {
        name,
        name_ref: None,
        r#type: None,
        color: None,
        stock_role: None,
        values,
        value_cache: None,
        value_source_kind: None,
        categories,
        x_role: None,
        category_cache: None,
        category_source_kind: None,
        category_levels: None,
        category_label_format: None,
        bubble_size: None,
        bubble_size_cache: None,
        bubble_size_source_kind: None,
        smooth: None,
        show_lines: None,
        explosion: None,
        invert_if_negative: None,
        y_axis_index: None,
        show_markers: None,
        marker_size: None,
        marker_style: None,
        line_width: None,
        points: None,
        data_labels: None,
        trendlines: None,
        error_bars: None,
        x_error_bars: None,
        y_error_bars: None,
        idx: Some(idx),
        order: Some(idx),
        format: None,
        bar_shape: None,
        invert_color: None,
        marker_background_color: None,
        marker_foreground_color: None,
        filtered: None,
        source_series_index: None,
        source_series_key: None,
        visible_order: None,
        pivot_series_key: None,
        pivot_data_field_index: None,
        projection_authority: None,
        projection_diagnostics: Vec::new(),
        show_shadow: None,
        show_connector_lines: None,
        leader_line_format: None,
        show_leader_lines: None,
        bin_options: None,
        boxwhisker_options: None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedA1Range {
    sheet_prefix: Option<String>,
    start_col: u32,
    start_row: u32,
    end_col: u32,
    end_row: u32,
}

impl ParsedA1Range {
    fn parse(input: &str) -> Option<Self> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return None;
        }
        let (sheet_prefix, body) = split_sheet_prefix(trimmed);
        let mut parts = body.split(':');
        let start = parts.next()?;
        let end = parts.next().unwrap_or(start);
        if parts.next().is_some() {
            return None;
        }
        let (start_col, start_row) = parse_a1_cell(start)?;
        let (end_col, end_row) = parse_a1_cell(end)?;
        Some(Self {
            sheet_prefix: sheet_prefix.map(str::to_string),
            start_col: start_col.min(end_col),
            start_row: start_row.min(end_row),
            end_col: start_col.max(end_col),
            end_row: start_row.max(end_row),
        })
    }

    fn cell_ref(&self, col: u32, row: u32) -> String {
        let cell = format!("{}{}", col_to_name(col), row + 1);
        self.qualify(&cell)
    }

    fn sub_range(&self, start_col: u32, start_row: u32, end_col: u32, end_row: u32) -> String {
        let range = format!(
            "{}{}:{}{}",
            col_to_name(start_col),
            start_row + 1,
            col_to_name(end_col),
            end_row + 1
        );
        self.qualify(&range)
    }

    fn qualify(&self, reference: &str) -> String {
        match &self.sheet_prefix {
            Some(prefix) => format!("{prefix}!{reference}"),
            None => reference.to_string(),
        }
    }
}

fn split_sheet_prefix(input: &str) -> (Option<&str>, &str) {
    let mut in_quote = false;
    let mut chars = input.char_indices().peekable();
    while let Some((idx, ch)) = chars.next() {
        match ch {
            '\'' => {
                if in_quote && matches!(chars.peek(), Some((_, '\''))) {
                    chars.next();
                } else {
                    in_quote = !in_quote;
                }
            }
            '!' if !in_quote => {
                let (sheet, reference) = input.split_at(idx);
                return (
                    Some(sheet),
                    reference.strip_prefix('!').unwrap_or(reference),
                );
            }
            _ => {}
        }
    }
    (None, input)
}

fn parse_a1_cell(input: &str) -> Option<(u32, u32)> {
    let mut col: u32 = 0;
    let mut row: u32 = 0;
    let mut saw_col = false;
    let mut saw_row = false;

    for ch in input.chars().filter(|ch| *ch != '$') {
        if ch.is_ascii_alphabetic() && !saw_row {
            saw_col = true;
            col = col
                .checked_mul(26)?
                .checked_add((ch.to_ascii_uppercase() as u8 - b'A' + 1) as u32)?;
        } else if ch.is_ascii_digit() {
            saw_row = true;
            row = row.checked_mul(10)?.checked_add(ch.to_digit(10)?)?;
        } else {
            return None;
        }
    }

    if !saw_col || !saw_row || row == 0 {
        return None;
    }

    Some((col - 1, row - 1))
}

fn col_to_name(mut col: u32) -> String {
    let mut chars = Vec::new();
    loop {
        let rem = (col % 26) as u8;
        chars.push((b'A' + rem) as char);
        col /= 26;
        if col == 0 {
            break;
        }
        col -= 1;
    }
    chars.iter().rev().collect()
}
