//! Differential format reconstruction for modeled conditional formats.

use std::collections::{HashMap, HashSet};

use domain_types::{CFRule, CFStyle, ParseOutput};

use crate::domain::styles::types::{
    BorderDef, BorderSideDef, BorderStyle, ColorDef, DxfDef, FillDef, FontDef, NumberFormatDef,
    PatternType, UnderlineStyle,
};

use super::styles::hex_to_color_def;

pub(super) fn remap_for_export(output: &ParseOutput) -> (ParseOutput, Vec<DxfDef>) {
    let registry = output
        .workbook_stylesheet
        .as_ref()
        .map(|stylesheet| stylesheet.dxf_registry.as_slice())
        .unwrap_or(&[]);
    if registry.is_empty() {
        return (output.clone(), Vec::new());
    }

    let mut reachable = HashSet::new();
    collect_reachable_ids(output, &mut reachable);

    let mut id_to_export_id = HashMap::<u32, u32>::new();
    let mut dxfs = Vec::new();
    for entry in registry
        .iter()
        .filter(|entry| reachable.contains(&entry.id))
    {
        id_to_export_id.insert(entry.id, dxfs.len() as u32);
        dxfs.push(entry.to_ooxml());
    }

    let mut remapped = output.clone();
    remap_output_dxf_ids(&mut remapped, &id_to_export_id);
    (remapped, dxfs)
}

pub(super) fn collect(output: &ParseOutput) -> Vec<DxfDef> {
    let max_dxf_id = output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.conditional_formats.iter())
        .flat_map(|cf| cf.rules.iter())
        .filter_map(rule_style)
        .filter_map(|style| style.dxf_id)
        .max();

    let Some(max_dxf_id) = max_dxf_id else {
        return Vec::new();
    };

    let mut dxfs = vec![DxfDef::default(); max_dxf_id as usize + 1];
    let mut populated = vec![false; max_dxf_id as usize + 1];

    for style in output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.conditional_formats.iter())
        .flat_map(|cf| cf.rules.iter())
        .filter_map(rule_style)
    {
        let Some(dxf_id) = style.dxf_id else {
            continue;
        };
        let idx = dxf_id as usize;
        if populated[idx] {
            continue;
        }
        dxfs[idx] = cf_style_to_dxf(style);
        populated[idx] = true;
    }

    dxfs
}

fn collect_reachable_ids(output: &ParseOutput, reachable: &mut HashSet<u32>) {
    for sheet in &output.sheets {
        for cf in &sheet.conditional_formats {
            for style in cf.rules.iter().filter_map(rule_style) {
                if let Some(dxf_id) = style.dxf_id {
                    reachable.insert(dxf_id);
                }
            }
        }

        if let Some(auto_filter) = &sheet.auto_filter {
            for column in &auto_filter.columns {
                if let Some(domain_types::OoxmlFilterType::Color {
                    dxf_id: Some(dxf_id),
                    ..
                }) = &column.filter_type
                {
                    reachable.insert(*dxf_id);
                }
            }
            if let Some(sort) = &auto_filter.sort {
                collect_sort_reachable(&sort.conditions, reachable);
            }
        }

        if let Some(sort) = &sheet.sort_state {
            collect_sort_reachable(&sort.conditions, reachable);
        }

        for table in &sheet.tables {
            for dxf_id in [
                table.header_row_dxf_id,
                table.data_dxf_id,
                table.totals_row_dxf_id,
                table.header_row_border_dxf_id,
                table.table_border_dxf_id,
                table.totals_row_border_dxf_id,
            ]
            .into_iter()
            .flatten()
            {
                reachable.insert(dxf_id);
            }
            for column in &table.columns {
                for dxf_id in [
                    column.header_row_dxf_id,
                    column.data_dxf_id,
                    column.totals_row_dxf_id,
                ]
                .into_iter()
                .flatten()
                {
                    reachable.insert(dxf_id);
                }
            }
            for column in &table.filter_columns {
                if let domain_types::FilterSpec::Color {
                    dxf_id: Some(dxf_id),
                    ..
                } = &column.filter
                {
                    reachable.insert(*dxf_id);
                }
            }
            if let Some(sort) = &table.sort_state {
                for condition in &sort.conditions {
                    if let Some(dxf_id) = condition.dxf_id {
                        reachable.insert(dxf_id);
                    }
                }
            }
        }
    }

    for style in &output.custom_table_styles {
        for element in &style.elements {
            if let Some(dxf_id) = element.dxf_id {
                reachable.insert(dxf_id);
            }
        }
    }
}

fn collect_sort_reachable(
    conditions: &[domain_types::SortCondition],
    reachable: &mut HashSet<u32>,
) {
    for condition in conditions {
        if let Some(dxf_id) = condition.dxf_id {
            reachable.insert(dxf_id);
        }
    }
}

fn remap_output_dxf_ids(output: &mut ParseOutput, id_to_export_id: &HashMap<u32, u32>) {
    for sheet in &mut output.sheets {
        for cf in &mut sheet.conditional_formats {
            for style in cf.rules.iter_mut().filter_map(rule_style_mut) {
                remap_id(&mut style.dxf_id, id_to_export_id);
            }
        }

        if let Some(auto_filter) = &mut sheet.auto_filter {
            for column in &mut auto_filter.columns {
                if let Some(domain_types::OoxmlFilterType::Color { dxf_id, .. }) =
                    &mut column.filter_type
                {
                    remap_id(dxf_id, id_to_export_id);
                }
            }
            if let Some(sort) = &mut auto_filter.sort {
                for condition in &mut sort.conditions {
                    remap_id(&mut condition.dxf_id, id_to_export_id);
                }
            }
        }

        if let Some(sort) = &mut sheet.sort_state {
            for condition in &mut sort.conditions {
                remap_id(&mut condition.dxf_id, id_to_export_id);
            }
        }

        for table in &mut sheet.tables {
            for dxf_id in [
                &mut table.header_row_dxf_id,
                &mut table.data_dxf_id,
                &mut table.totals_row_dxf_id,
                &mut table.header_row_border_dxf_id,
                &mut table.table_border_dxf_id,
                &mut table.totals_row_border_dxf_id,
            ] {
                remap_id(dxf_id, id_to_export_id);
            }
            for column in &mut table.columns {
                for dxf_id in [
                    &mut column.header_row_dxf_id,
                    &mut column.data_dxf_id,
                    &mut column.totals_row_dxf_id,
                ] {
                    remap_id(dxf_id, id_to_export_id);
                }
            }
            for column in &mut table.filter_columns {
                if let domain_types::FilterSpec::Color { dxf_id, .. } = &mut column.filter {
                    remap_id(dxf_id, id_to_export_id);
                }
            }
            if let Some(sort) = &mut table.sort_state {
                for condition in &mut sort.conditions {
                    remap_id(&mut condition.dxf_id, id_to_export_id);
                }
            }
        }
    }

    for style in &mut output.custom_table_styles {
        for element in &mut style.elements {
            remap_id(&mut element.dxf_id, id_to_export_id);
        }
    }
}

fn remap_id(id: &mut Option<u32>, id_to_export_id: &HashMap<u32, u32>) {
    if let Some(current) = *id {
        *id = id_to_export_id.get(&current).copied();
    }
}

fn rule_style(rule: &CFRule) -> Option<&CFStyle> {
    match rule {
        CFRule::CellValue { style, .. }
        | CFRule::Formula { style, .. }
        | CFRule::Top10 { style, .. }
        | CFRule::AboveAverage { style, .. }
        | CFRule::DuplicateValues { style, .. }
        | CFRule::ContainsText { style, .. }
        | CFRule::ContainsBlanks { style, .. }
        | CFRule::ContainsErrors { style, .. }
        | CFRule::TimePeriod { style, .. } => Some(style),
        CFRule::ColorScale { .. } | CFRule::DataBar { .. } | CFRule::IconSet { .. } => None,
    }
}

fn rule_style_mut(rule: &mut CFRule) -> Option<&mut CFStyle> {
    match rule {
        CFRule::CellValue { style, .. }
        | CFRule::Formula { style, .. }
        | CFRule::Top10 { style, .. }
        | CFRule::AboveAverage { style, .. }
        | CFRule::DuplicateValues { style, .. }
        | CFRule::ContainsText { style, .. }
        | CFRule::ContainsBlanks { style, .. }
        | CFRule::ContainsErrors { style, .. }
        | CFRule::TimePeriod { style, .. } => Some(style),
        CFRule::ColorScale { .. } | CFRule::DataBar { .. } | CFRule::IconSet { .. } => None,
    }
}

fn cf_style_to_dxf(style: &CFStyle) -> DxfDef {
    DxfDef {
        font: font(style),
        num_fmt: style
            .number_format
            .as_ref()
            .map(|format_code| NumberFormatDef {
                id: 0,
                format_code: format_code.clone(),
            }),
        fill: style
            .background_color
            .as_ref()
            .map(|color| FillDef::Pattern {
                pattern_type: Some(PatternType::Solid),
                fg_color: Some(hex_to_color_def(color)),
                bg_color: Some(hex_to_color_def(color)),
            }),
        border: border(style),
        alignment: None,
        protection: None,
        ..Default::default()
    }
}

fn font(style: &CFStyle) -> Option<FontDef> {
    if style.font_color.is_none()
        && style.bold.is_none()
        && style.italic.is_none()
        && style.underline_type.is_none()
        && style.underline_legacy.is_none()
        && style.strikethrough.is_none()
    {
        return None;
    }

    Some(FontDef {
        color: style.font_color.as_deref().map(hex_to_color_def),
        bold: style.bold,
        italic: style.italic,
        underline: style.underline_type.or_else(|| {
            style
                .underline_legacy
                .and_then(|v| v.then_some(UnderlineStyle::Single))
        }),
        strikethrough: style.strikethrough,
        ..Default::default()
    })
}

fn border(style: &CFStyle) -> Option<BorderDef> {
    let unified_style = style
        .border_style
        .or_else(|| style.border_color.as_ref().map(|_| BorderStyle::Thin));
    let unified_color = style.border_color.as_deref().map(hex_to_color_def);

    let left = border_side(
        style.border_left_style.as_deref(),
        style.border_left_color.as_deref(),
        unified_style,
        unified_color.as_ref(),
    );
    let right = border_side(
        style.border_right_style.as_deref(),
        style.border_right_color.as_deref(),
        unified_style,
        unified_color.as_ref(),
    );
    let top = border_side(
        style.border_top_style.as_deref(),
        style.border_top_color.as_deref(),
        unified_style,
        unified_color.as_ref(),
    );
    let bottom = border_side(
        style.border_bottom_style.as_deref(),
        style.border_bottom_color.as_deref(),
        unified_style,
        unified_color.as_ref(),
    );

    if left.is_none() && right.is_none() && top.is_none() && bottom.is_none() {
        return None;
    }

    Some(BorderDef {
        left,
        right,
        top,
        bottom,
        ..Default::default()
    })
}

fn border_side(
    side_style: Option<&str>,
    side_color: Option<&str>,
    unified_style: Option<BorderStyle>,
    unified_color: Option<&ColorDef>,
) -> Option<BorderSideDef> {
    let style = side_style
        .and_then(BorderStyle::from_ooxml_token)
        .or(unified_style);
    let color = side_color
        .map(hex_to_color_def)
        .or_else(|| unified_color.cloned());

    if style.is_none() && color.is_none() {
        return None;
    }

    Some(BorderSideDef {
        style: style.unwrap_or(BorderStyle::Thin),
        color,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry_entry(id: u32) -> domain_types::DxfDef {
        domain_types::DxfDef {
            id,
            font: Some(FontDef {
                bold: Some(id % 2 == 0),
                color: Some(ColorDef::Rgb {
                    val: format!("FF{id:06X}"),
                    tint: None,
                }),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn remap_for_export_covers_all_table_and_filter_dxf_consumers() {
        let reachable_ids = [
            10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150,
        ];
        let mut output = ParseOutput {
            workbook_stylesheet: Some(domain_types::WorkbookStylesheet {
                dxf_registry: std::iter::once(999)
                    .chain(reachable_ids.iter().copied())
                    .map(registry_entry)
                    .collect(),
                ..Default::default()
            }),
            sheets: vec![domain_types::SheetData {
                name: "Sheet1".to_string(),
                conditional_formats: vec![domain_types::ConditionalFormat {
                    id: "cf-1".to_string(),
                    sheet_id: "sheet-1".to_string(),
                    pivot: None,
                    ranges: vec![cell_types::SheetRange::single(0, 0)],
                    range_identities: None,
                    rules: vec![CFRule::CellValue {
                        id: "rule-1".to_string(),
                        priority: 1,
                        stop_if_true: None,
                        operator: ooxml_types::cond_format::CfOperator::GreaterThan,
                        value1: serde_json::json!(1),
                        value2: None,
                        style: CFStyle {
                            dxf_id: Some(10),
                            ..Default::default()
                        },
                        text: None,
                    }],
                }],
                auto_filter: Some(domain_types::AutoFilter {
                    range_ref: "A1:B5".to_string(),
                    columns: vec![domain_types::FilterColumn {
                        col_index: 0,
                        filter_type: Some(domain_types::OoxmlFilterType::Color {
                            dxf_id: Some(20),
                            cell_color: true,
                        }),
                        ..Default::default()
                    }],
                    sort: Some(domain_types::SortState {
                        range_ref: "A1:B5".to_string(),
                        conditions: vec![domain_types::SortCondition {
                            range_ref: "A1:A5".to_string(),
                            dxf_id: Some(30),
                            ..Default::default()
                        }],
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                sort_state: Some(domain_types::SortState {
                    range_ref: "A1:B5".to_string(),
                    conditions: vec![domain_types::SortCondition {
                        range_ref: "B1:B5".to_string(),
                        dxf_id: Some(40),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                tables: vec![domain_types::TableSpec {
                    name: "Table1".to_string(),
                    display_name: "Table1".to_string(),
                    range_ref: "A1:B5".to_string(),
                    header_row_dxf_id: Some(50),
                    data_dxf_id: Some(60),
                    totals_row_dxf_id: Some(70),
                    header_row_border_dxf_id: Some(80),
                    table_border_dxf_id: Some(90),
                    totals_row_border_dxf_id: Some(100),
                    columns: vec![domain_types::TableColumnSpec {
                        name: "A".to_string(),
                        header_row_dxf_id: Some(110),
                        data_dxf_id: Some(120),
                        totals_row_dxf_id: Some(130),
                        ..Default::default()
                    }],
                    filter_columns: vec![domain_types::FilterColumnSpec {
                        col_id: 0,
                        hidden_button: false,
                        show_button: true,
                        filter: domain_types::FilterSpec::Color {
                            dxf_id: Some(140),
                            cell_color: true,
                        },
                        ext_lst_raw: None,
                    }],
                    sort_state: Some(domain_types::TableSortState {
                        ref_range: "A1:B5".to_string(),
                        column_sort: false,
                        case_sensitive: false,
                        sort_method: domain_types::SortMethod::None,
                        conditions: vec![domain_types::TableSortCondition {
                            ref_range: "A1:A5".to_string(),
                            descending: false,
                            sort_by: domain_types::SortConditionBy::CellColor,
                            custom_list: None,
                            dxf_id: Some(150),
                            icon_set: None,
                            icon_id: None,
                        }],
                        ext_lst_raw: None,
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            custom_table_styles: vec![ooxml_types::styles::TableStyleDef {
                name: "CustomTableStyle".to_string(),
                pivot: Some(false),
                table: Some(true),
                count: Some(1),
                elements: vec![ooxml_types::styles::TableStyleElementDef {
                    style_type: ooxml_types::styles::TableStyleType::WholeTable,
                    dxf_id: Some(150),
                    size: None,
                }],
                xr_uid: None,
            }],
            ..Default::default()
        };

        let (remapped, dxfs) = remap_for_export(&output);

        assert_eq!(dxfs.len(), reachable_ids.len());
        assert_eq!(dxfs[0], registry_entry(10).to_ooxml());
        assert_eq!(dxfs.last(), Some(&registry_entry(150).to_ooxml()));
        let sheet = &remapped.sheets[0];
        assert_eq!(
            rule_style(&sheet.conditional_formats[0].rules[0]).and_then(|style| style.dxf_id),
            Some(0)
        );
        assert_eq!(
            sheet.auto_filter.as_ref().and_then(|filter| {
                filter
                    .columns
                    .first()
                    .and_then(|column| match &column.filter_type {
                        Some(domain_types::OoxmlFilterType::Color { dxf_id, .. }) => *dxf_id,
                        _ => None,
                    })
            }),
            Some(1)
        );
        assert_eq!(
            sheet.auto_filter.as_ref().and_then(|filter| {
                filter
                    .sort
                    .as_ref()
                    .and_then(|sort| sort.conditions.first())
                    .and_then(|condition| condition.dxf_id)
            }),
            Some(2)
        );
        assert_eq!(
            sheet
                .sort_state
                .as_ref()
                .and_then(|sort| sort.conditions.first())
                .and_then(|condition| condition.dxf_id),
            Some(3)
        );

        let table = &sheet.tables[0];
        assert_eq!(table.header_row_dxf_id, Some(4));
        assert_eq!(table.data_dxf_id, Some(5));
        assert_eq!(table.totals_row_dxf_id, Some(6));
        assert_eq!(table.header_row_border_dxf_id, Some(7));
        assert_eq!(table.table_border_dxf_id, Some(8));
        assert_eq!(table.totals_row_border_dxf_id, Some(9));
        assert_eq!(table.columns[0].header_row_dxf_id, Some(10));
        assert_eq!(table.columns[0].data_dxf_id, Some(11));
        assert_eq!(table.columns[0].totals_row_dxf_id, Some(12));
        assert!(matches!(
            table.filter_columns[0].filter,
            domain_types::FilterSpec::Color {
                dxf_id: Some(13),
                ..
            }
        ));
        assert_eq!(
            table
                .sort_state
                .as_ref()
                .and_then(|sort| sort.conditions.first())
                .and_then(|condition| condition.dxf_id),
            Some(14)
        );
        assert_eq!(remapped.custom_table_styles[0].elements[0].dxf_id, Some(14));

        output.sheets[0].tables[0].data_dxf_id = Some(999);
        let (remapped_with_preceding_reachable, dxfs_with_preceding) = remap_for_export(&output);
        assert_eq!(dxfs_with_preceding[0], registry_entry(999).to_ooxml());
        assert_eq!(
            remapped_with_preceding_reachable.sheets[0].tables[0].data_dxf_id,
            Some(0)
        );
    }
}
