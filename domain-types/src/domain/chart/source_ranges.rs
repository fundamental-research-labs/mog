use super::{ChartSeriesData, ChartSeriesXRoleData, ChartType, PieSliceData, PointFormatData};

const DEFAULT_PIE_SLICE_EXPLOSION: u32 = 25;

pub fn infer_common_category_range(series: &[ChartSeriesData]) -> Option<String> {
    let mut common: Option<&str> = None;
    for item in series {
        let categories = item.categories.as_deref()?.trim();
        if categories.is_empty() {
            return None;
        }
        match common {
            Some(existing) if existing != categories => return None,
            Some(_) => {}
            None => common = Some(categories),
        }
    }
    common.map(ToOwned::to_owned)
}

pub fn infer_series_name_range(series: &[ChartSeriesData]) -> Option<String> {
    if series.is_empty() {
        return None;
    }

    let refs = series
        .iter()
        .map(|item| parse_single_cell_ref(item.name_ref.as_deref()?.trim()))
        .collect::<Option<Vec<_>>>()?;
    rectangular_ref_for_cells(&refs)
}

pub fn apply_explicit_chart_source_ranges(
    series: &mut [ChartSeriesData],
    category_range: Option<&str>,
    series_range: Option<&str>,
) {
    if let Some(category_range) = category_range
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        for item in series.iter_mut() {
            item.categories = Some(category_range.to_string());
        }
    }

    let Some(parsed_series_range) = series_range
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(ParsedA1Range::parse)
    else {
        return;
    };
    let Some(name_refs) = parsed_series_range.cell_refs_for_count(series.len()) else {
        return;
    };
    for (item, name_ref) in series.iter_mut().zip(name_refs) {
        item.name_ref = Some(name_ref);
    }
}

pub fn synthesize_chart_series_from_data_range(
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

pub fn chart_series_from_runtime_inputs(
    chart_type: &ChartType,
    series: Option<Vec<ChartSeriesData>>,
    data_range: Option<&str>,
    category_range: Option<&str>,
    series_range: Option<&str>,
    pie_slice: Option<&PieSliceData>,
) -> Vec<ChartSeriesData> {
    let mut series = series.unwrap_or_default();
    let Some(pie_slice) = pie_slice.filter(|_| chart_type_supports_pie_slice(chart_type)) else {
        return series;
    };

    if series.is_empty() {
        series = data_range
            .and_then(|data_range| synthesize_chart_series_from_data_range(chart_type, data_range))
            .unwrap_or_default();
        apply_explicit_chart_source_ranges(&mut series, category_range, series_range);
    }
    apply_pie_slice_to_chart_series(series.as_mut_slice(), pie_slice);
    series
}

pub fn pie_slice_from_chart_series(
    chart_type: &ChartType,
    series: &[ChartSeriesData],
) -> Option<PieSliceData> {
    if !chart_type_supports_pie_slice(chart_type) {
        return None;
    }
    let first = series.first()?;
    let exploded_indices = first
        .points
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|point| point.explosion.is_some())
        .map(|point| point.idx)
        .collect::<Vec<_>>();
    if first.explosion.is_none() && exploded_indices.is_empty() {
        return None;
    }
    let point_explosion = first
        .points
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .find_map(|point| point.explosion);

    Some(PieSliceData {
        explosion: first.explosion,
        exploded_indices: (!exploded_indices.is_empty()).then_some(exploded_indices),
        explode_offset: first.explosion.or(point_explosion),
        explode_all: first.explosion.map(|_| true),
    })
}

fn chart_type_supports_pie_slice(chart_type: &ChartType) -> bool {
    matches!(
        chart_type,
        ChartType::Pie | ChartType::Pie3D | ChartType::Doughnut | ChartType::OfPie
    )
}

fn apply_pie_slice_to_chart_series(series: &mut [ChartSeriesData], pie_slice: &PieSliceData) {
    let Some(first) = series.first_mut() else {
        return;
    };
    let series_explosion = if pie_slice.exploded_indices.is_none()
        || pie_slice.explode_all == Some(true)
        || pie_slice.explosion.is_some()
    {
        pie_slice.explode_offset.or(pie_slice.explosion)
    } else {
        None
    };
    if first.explosion.is_none()
        && (pie_slice.explode_all == Some(true) || series_explosion.is_some())
    {
        first.explosion = Some(series_explosion.unwrap_or(DEFAULT_PIE_SLICE_EXPLOSION));
    }

    let Some(indices) = pie_slice.exploded_indices.as_ref() else {
        return;
    };
    let point_explosion = pie_slice
        .explode_offset
        .or(pie_slice.explosion)
        .unwrap_or(DEFAULT_PIE_SLICE_EXPLOSION);
    let points = first.points.get_or_insert_with(Vec::new);
    for idx in indices {
        match points.iter_mut().find(|point| point.idx == *idx) {
            Some(point) => {
                if point.explosion.is_none() {
                    point.explosion = Some(point_explosion);
                }
            }
            None => points.push(PointFormatData {
                idx: *idx,
                explosion: Some(point_explosion),
                ..Default::default()
            }),
        }
    }
    points.sort_by_key(|point| point.idx);
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
    ChartSeriesData {
        name_ref,
        values,
        categories,
        idx: Some(idx),
        order: Some(idx),
        ..Default::default()
    }
}

fn rectangular_ref_for_cells(refs: &[ParsedCellRef]) -> Option<String> {
    let first = refs.first()?;
    if refs.iter().any(|item| item.sheet != first.sheet) {
        return None;
    }

    let min_row = refs.iter().map(|item| item.row).min()?;
    let max_row = refs.iter().map(|item| item.row).max()?;
    let min_col = refs.iter().map(|item| item.col).min()?;
    let max_col = refs.iter().map(|item| item.col).max()?;
    let row_count = max_row - min_row + 1;
    let col_count = max_col - min_col + 1;
    if row_count * col_count != refs.len() as u32 {
        return None;
    }

    let body = if min_row == max_row && min_col == max_col {
        cell_ref(min_col, min_row)
    } else {
        format!(
            "{}:{}",
            cell_ref(min_col, min_row),
            cell_ref(max_col, max_row)
        )
    };
    Some(match &first.sheet {
        Some(sheet) => format!("{}!{body}", quote_sheet_name(sheet)),
        None => body,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedCellRef {
    sheet: Option<String>,
    col: u32,
    row: u32,
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
        let (sheet_prefix, body) = split_chart_sheet_prefix(trimmed);
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
        let cell = format!("{}{}", col_to_a1(col), row + 1);
        self.qualify(&cell)
    }

    fn sub_range(&self, start_col: u32, start_row: u32, end_col: u32, end_row: u32) -> String {
        let range = format!(
            "{}{}:{}{}",
            col_to_a1(start_col),
            start_row + 1,
            col_to_a1(end_col),
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

    fn cell_refs_for_count(&self, count: usize) -> Option<Vec<String>> {
        if count == 0 {
            return None;
        }
        if self.start_row == self.end_row {
            let width = (self.end_col - self.start_col + 1) as usize;
            if width != count {
                return None;
            }
            return Some(
                (self.start_col..=self.end_col)
                    .map(|col| self.cell_ref(col, self.start_row))
                    .collect(),
            );
        }
        if self.start_col == self.end_col {
            let height = (self.end_row - self.start_row + 1) as usize;
            if height != count {
                return None;
            }
            return Some(
                (self.start_row..=self.end_row)
                    .map(|row| self.cell_ref(self.start_col, row))
                    .collect(),
            );
        }
        None
    }
}

fn split_chart_sheet_prefix(input: &str) -> (Option<&str>, &str) {
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

fn parse_single_cell_ref(input: &str) -> Option<ParsedCellRef> {
    if input.is_empty() || input.contains(':') || input.starts_with('=') {
        return None;
    }
    let (sheet, body) = split_sheet_ref(input)?;
    let (col, row) = parse_cell_ref(body)?;
    Some(ParsedCellRef { sheet, col, row })
}

fn split_sheet_ref(input: &str) -> Option<(Option<String>, &str)> {
    if let Some(rest) = input.strip_prefix('\'') {
        let mut sheet = String::new();
        let mut chars = rest.char_indices().peekable();
        while let Some((idx, ch)) = chars.next() {
            if ch == '\'' {
                if matches!(chars.peek(), Some((_, '\''))) {
                    sheet.push('\'');
                    chars.next();
                    continue;
                }
                let body = rest.get(idx + 1..)?.strip_prefix('!')?;
                return Some((Some(sheet), body));
            }
            sheet.push(ch);
        }
        return None;
    }

    match input.rsplit_once('!') {
        Some((sheet, body)) if !sheet.is_empty() && !body.is_empty() => {
            Some((Some(sheet.to_string()), body))
        }
        Some(_) => None,
        None => Some((None, input)),
    }
}

fn parse_cell_ref(input: &str) -> Option<(u32, u32)> {
    let mut letters = String::new();
    let mut digits = String::new();
    for ch in input.chars().filter(|ch| *ch != '$') {
        if ch.is_ascii_alphabetic() && digits.is_empty() {
            letters.push(ch.to_ascii_uppercase());
        } else if ch.is_ascii_digit() {
            digits.push(ch);
        } else {
            return None;
        }
    }
    if letters.is_empty() || digits.is_empty() {
        return None;
    }
    let row = digits.parse::<u32>().ok()?.checked_sub(1)?;
    Some((a1_col_to_index(&letters)?, row))
}

fn a1_col_to_index(letters: &str) -> Option<u32> {
    let mut col = 0u32;
    for ch in letters.bytes() {
        if !ch.is_ascii_uppercase() {
            return None;
        }
        col = col.checked_mul(26)?.checked_add((ch - b'A' + 1) as u32)?;
    }
    col.checked_sub(1)
}

fn cell_ref(col: u32, row: u32) -> String {
    format!("{}{}", col_to_a1(col), row + 1)
}

fn col_to_a1(mut col: u32) -> String {
    let mut out = String::new();
    loop {
        let rem = (col % 26) as u8;
        out.insert(0, (b'A' + rem) as char);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    out
}

fn quote_sheet_name(sheet: &str) -> String {
    if sheet
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        sheet.to_string()
    } else {
        format!("'{}'", sheet.replace('\'', "''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn series(name_ref: Option<&str>, categories: Option<&str>) -> ChartSeriesData {
        ChartSeriesData {
            name_ref: name_ref.map(ToOwned::to_owned),
            categories: categories.map(ToOwned::to_owned),
            ..Default::default()
        }
    }

    #[test]
    fn common_category_range_requires_all_series_to_match() {
        let matching = vec![
            series(Some("B1"), Some("A2:A5")),
            series(Some("C1"), Some("A2:A5")),
        ];
        assert_eq!(
            infer_common_category_range(&matching).as_deref(),
            Some("A2:A5")
        );

        let mixed = vec![
            series(Some("B1"), Some("A2:A5")),
            series(Some("C1"), Some("A3:A6")),
        ];
        assert_eq!(infer_common_category_range(&mixed), None);
    }

    #[test]
    fn series_name_range_combines_contiguous_header_cells() {
        let series = vec![
            series(Some("B1"), Some("A2:A5")),
            series(Some("C1"), Some("A2:A5")),
            series(Some("D1"), Some("A2:A5")),
        ];
        assert_eq!(infer_series_name_range(&series).as_deref(), Some("B1:D1"));
    }

    #[test]
    fn series_name_range_preserves_external_sheet_prefix() {
        let series = vec![
            series(Some("'Q1 Data'!$B$1"), Some("A2:A5")),
            series(Some("'Q1 Data'!$C$1"), Some("A2:A5")),
        ];
        assert_eq!(
            infer_series_name_range(&series).as_deref(),
            Some("'Q1 Data'!B1:C1")
        );
    }

    #[test]
    fn runtime_pie_slice_synthesizes_data_series_with_explosion() {
        let series = chart_series_from_runtime_inputs(
            &ChartType::Pie,
            None,
            Some("Data!A1:B5"),
            Some("Data!A2:A5"),
            Some("Data!B1:B1"),
            Some(&PieSliceData {
                explosion: Some(42),
                exploded_indices: Some(vec![2]),
                explode_offset: Some(42),
                explode_all: Some(true),
            }),
        );

        assert_eq!(series.len(), 1);
        assert_eq!(series[0].name_ref.as_deref(), Some("Data!B1"));
        assert_eq!(series[0].categories.as_deref(), Some("Data!A2:A5"));
        assert_eq!(series[0].values.as_deref(), Some("Data!B2:B5"));
        assert_eq!(series[0].explosion, Some(42));
        assert_eq!(
            series[0]
                .points
                .as_deref()
                .and_then(|points| points.first())
                .map(|point| (point.idx, point.explosion)),
            Some((2, Some(42)))
        );
    }

    #[test]
    fn runtime_pie_slice_explode_offset_overrides_exploded_type_default() {
        let series = chart_series_from_runtime_inputs(
            &ChartType::Pie,
            None,
            Some("Data!A1:B5"),
            None,
            None,
            Some(&PieSliceData {
                explosion: Some(25),
                exploded_indices: None,
                explode_offset: Some(42),
                explode_all: None,
            }),
        );

        assert_eq!(series[0].explosion, Some(42));
    }

    #[test]
    fn runtime_pie_slice_does_not_override_explicit_series_explosion() {
        let series = chart_series_from_runtime_inputs(
            &ChartType::Pie,
            Some(vec![ChartSeriesData {
                explosion: Some(42),
                points: Some(vec![PointFormatData {
                    idx: 2,
                    explosion: Some(42),
                    ..Default::default()
                }]),
                ..Default::default()
            }]),
            None,
            None,
            None,
            Some(&PieSliceData {
                explosion: Some(25),
                exploded_indices: Some(vec![2, 3]),
                explode_offset: Some(25),
                explode_all: Some(true),
            }),
        );

        assert_eq!(series[0].explosion, Some(42));
        let points = series[0].points.as_deref().unwrap_or(&[]);
        assert_eq!(
            points
                .iter()
                .find(|point| point.idx == 2)
                .and_then(|point| point.explosion),
            Some(42)
        );
        assert_eq!(
            points
                .iter()
                .find(|point| point.idx == 3)
                .and_then(|point| point.explosion),
            Some(25)
        );
    }

    #[test]
    fn runtime_pie_slice_exploded_indices_do_not_create_series_explosion() {
        let series = chart_series_from_runtime_inputs(
            &ChartType::Pie,
            None,
            Some("Data!A1:B5"),
            None,
            None,
            Some(&PieSliceData {
                explosion: None,
                exploded_indices: Some(vec![2]),
                explode_offset: Some(25),
                explode_all: None,
            }),
        );

        assert_eq!(series[0].explosion, None);
        assert_eq!(
            series[0]
                .points
                .as_deref()
                .and_then(|points| points.first())
                .map(|point| (point.idx, point.explosion)),
            Some((2, Some(25)))
        );
    }

    #[test]
    fn pie_slice_projection_uses_imported_series_explosion_carriers() {
        let pie_slice = pie_slice_from_chart_series(
            &ChartType::Pie,
            &[ChartSeriesData {
                explosion: Some(42),
                points: Some(vec![PointFormatData {
                    idx: 2,
                    explosion: Some(42),
                    ..Default::default()
                }]),
                ..Default::default()
            }],
        )
        .expect("pie slice should project from series explosion");

        assert_eq!(pie_slice.explosion, Some(42));
        assert_eq!(pie_slice.explode_all, Some(true));
        assert_eq!(pie_slice.explode_offset, Some(42));
        assert_eq!(pie_slice.exploded_indices.as_deref(), Some(&[2][..]));
    }
}
