use domain_types::SheetData;
use domain_types::domain::pivot::ParsedPivotTable;
use std::borrow::Cow;
use std::collections::HashMap;
use value_types::CellValue;

pub(super) fn derive_missing_fields<'a>(
    pivots: &'a [ParsedPivotTable],
    sheets: &[SheetData],
    sheet_name_to_idx: &HashMap<&str, usize>,
) -> Vec<Cow<'a, ParsedPivotTable>> {
    pivots
        .iter()
        .map(|pt| {
            if !pt.config.fields.is_empty() {
                return Cow::Borrowed(pt);
            }

            let header_names = read_source_header_names(&pt.config, sheets, sheet_name_to_idx);
            if header_names.is_empty() {
                return Cow::Borrowed(pt);
            }

            let mut config = pt.config.clone();
            config.fields = header_names
                .into_iter()
                .enumerate()
                .map(|(i, name)| pivot_types::PivotField {
                    id: pivot_types::FieldId::from(name.clone()),
                    name,
                    source_column: (config.source_range.start_col() + i as u32),
                    data_type: pivot_types::DetectedDataType::String,
                    ..Default::default()
                })
                .collect();
            Cow::Owned(ParsedPivotTable {
                config,
                initial_expansion_state: pt.initial_expansion_state.clone(),
                ooxml_preservation: pt.ooxml_preservation.clone(),
            })
        })
        .collect()
}

/// Read the header row (first row of source range) to get field names.
pub(super) fn read_source_header_names(
    config: &pivot_types::PivotTableConfig,
    sheets: &[SheetData],
    sheet_name_to_idx: &HashMap<&str, usize>,
) -> Vec<String> {
    let sheet_idx = match sheet_name_to_idx.get(config.source_sheet_name.as_str()) {
        Some(&idx) => idx,
        None => return Vec::new(),
    };
    let sheet = &sheets[sheet_idx];
    let header_row = config.source_range.start_row();
    let start_col = config.source_range.start_col();
    let end_col = config.source_range.end_col();
    let num_cols = (end_col - start_col + 1) as usize;

    let mut names = vec![String::new(); num_cols];
    for cell in &sheet.cells {
        if cell.row == header_row && cell.col >= start_col && cell.col <= end_col {
            let col_offset = (cell.col - start_col) as usize;
            names[col_offset] = match &cell.value {
                CellValue::Text(s) => s.to_string(),
                CellValue::Number(n) => format!("{}", n.get()),
                _ => format!("Column{}", col_offset + 1),
            };
        }
    }

    for (i, name) in names.iter_mut().enumerate() {
        if name.is_empty() {
            *name = format!("Column{}", i + 1);
        }
    }
    names
}
