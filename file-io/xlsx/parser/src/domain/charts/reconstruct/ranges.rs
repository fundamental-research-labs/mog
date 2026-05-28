//! Data-range to series synthesis for reconstructed charts.

use domain_types::chart::{ChartSeriesData, ChartSpec};

pub(super) fn series_for_export(spec: &ChartSpec) -> Vec<ChartSeriesData> {
    if !spec.series.is_empty() {
        return spec.series.clone();
    }

    spec.data_range
        .as_deref()
        .and_then(synthesize_series_from_data_range)
        .unwrap_or_default()
}

pub(super) fn synthesize_series_from_data_range(data_range: &str) -> Option<Vec<ChartSeriesData>> {
    let parsed = ParsedA1Range::parse(data_range)?;
    if parsed.start_row > parsed.end_row || parsed.start_col > parsed.end_col {
        return None;
    }
    if parsed.start_row == parsed.end_row && parsed.start_col == parsed.end_col {
        return None;
    }

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
        series.push(chart_series_data(
            name,
            categories.clone(),
            Some(parsed.sub_range(col, first_value_row, col, parsed.end_row)),
            order as u32,
        ));
    }

    Some(series)
}

pub(super) fn chart_series_data(
    name: Option<String>,
    categories: Option<String>,
    values: Option<String>,
    idx: u32,
) -> ChartSeriesData {
    ChartSeriesData {
        name,
        r#type: None,
        color: None,
        values,
        categories,
        bubble_size: None,
        smooth: None,
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
        show_shadow: None,
        show_connector_lines: None,
        leader_line_format: None,
        show_leader_lines: None,
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
