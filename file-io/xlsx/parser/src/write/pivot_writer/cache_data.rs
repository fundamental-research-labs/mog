use crate::domain::pivot::write::cache_writer::PivotCacheWriter;
use crate::domain::pivot::write::types::{
    CacheFieldDef, CacheSource, CacheSourceType, SharedItem, WorksheetSource,
};
use crate::write::pivot_writer::a1::parse_range;
use domain_types::{PivotCacheSourceDef, SheetData};
use std::collections::HashMap;
use value_types::CellValue;

/// Build pivot cache definition + records XML by reading source range cells.
pub(super) fn build_cache(
    cache_src: &PivotCacheSourceDef,
    sheets: &[SheetData],
    sheet_name_to_idx: &HashMap<&str, usize>,
    imported_records: Option<&Vec<Vec<CellValue>>>,
) -> (Vec<u8>, Vec<u8>) {
    let mut cache_writer = PivotCacheWriter::new(cache_src.cache_id);

    if let (Some(sheet_name), Some(range_ref)) = (&cache_src.source_sheet, &cache_src.source_range)
    {
        cache_writer.source = CacheSource {
            source_type: CacheSourceType::Worksheet,
            worksheet_source: Some(WorksheetSource {
                sheet_name: Some(sheet_name.clone()),
                range_ref: range_ref.clone(),
                r_id: None,
            }),
        };

        if let Some(records) = imported_records
            && source_records_match(sheets, sheet_name_to_idx, sheet_name, range_ref, records)
        {
            let (fields, write_records) =
                imported_cache_records_to_write_data(&cache_src.field_names, records);
            for field in fields {
                cache_writer.add_field(field);
            }
            cache_writer.set_record_count(write_records.len() as u32);
            let definition_xml = cache_writer.to_definition_xml();
            let records_xml = cache_writer.to_records_xml(&write_records);
            return (definition_xml, records_xml);
        }

        if let Some(&sheet_idx) = sheet_name_to_idx.get(sheet_name.as_str()) {
            let sheet = &sheets[sheet_idx];
            if let Some((start_row, start_col, end_row, end_col)) = parse_range(range_ref) {
                let (fields, records) =
                    extract_cache_data(sheet, start_row, start_col, end_row, end_col);
                for field in fields {
                    cache_writer.add_field(field);
                }
                cache_writer.set_record_count(records.len() as u32);
                let definition_xml = cache_writer.to_definition_xml();
                let records_xml = cache_writer.to_records_xml(&records);
                return (definition_xml, records_xml);
            }
        }
    }

    for field_name in &cache_src.field_names {
        cache_writer.add_field(CacheFieldDef::new(field_name));
    }
    cache_writer.set_record_count(0);
    let definition_xml = cache_writer.to_definition_xml();
    let records_xml = cache_writer.to_records_xml(&[]);
    (definition_xml, records_xml)
}

fn source_records_match(
    sheets: &[SheetData],
    sheet_name_to_idx: &HashMap<&str, usize>,
    sheet_name: &str,
    range_ref: &str,
    imported_records: &[Vec<CellValue>],
) -> bool {
    let Some(&sheet_idx) = sheet_name_to_idx.get(sheet_name) else {
        return false;
    };
    let Some((start_row, start_col, end_row, end_col)) = parse_range(range_ref) else {
        return false;
    };
    let sheet = &sheets[sheet_idx];
    let source_records =
        extract_source_record_values(sheet, start_row, start_col, end_row, end_col);
    source_records == imported_records
}

fn imported_cache_records_to_write_data(
    field_names: &[String],
    records: &[Vec<CellValue>],
) -> (Vec<CacheFieldDef>, Vec<Vec<SharedItem>>) {
    let num_cols = field_names
        .len()
        .max(records.iter().map(Vec::len).max().unwrap_or(0));
    let mut field_shared_items: Vec<Vec<SharedItem>> = vec![Vec::new(); num_cols];
    let mut field_value_indices: Vec<HashMap<String, u32>> = vec![HashMap::new(); num_cols];
    let mut write_records = Vec::with_capacity(records.len());

    for row in records {
        let mut write_row = Vec::with_capacity(num_cols);
        for col_idx in 0..num_cols {
            let value = row.get(col_idx).unwrap_or(&CellValue::Null);
            write_row.push(cell_value_to_cache_record_item(
                value,
                &mut field_shared_items[col_idx],
                &mut field_value_indices[col_idx],
            ));
        }
        write_records.push(write_row);
    }

    let fields = (0..num_cols)
        .map(|idx| {
            let mut field =
                CacheFieldDef::new(field_names.get(idx).map(String::as_str).unwrap_or("Column"));
            field.shared_items = field_shared_items[idx].clone();
            field
        })
        .collect();

    (fields, write_records)
}

fn cell_value_to_cache_record_item(
    value: &CellValue,
    shared_items: &mut Vec<SharedItem>,
    value_indices: &mut HashMap<String, u32>,
) -> SharedItem {
    match value {
        CellValue::Text(s) => {
            let key = s.to_string();
            let idx = if let Some(&existing) = value_indices.get(&key) {
                existing
            } else {
                let idx = shared_items.len() as u32;
                shared_items.push(SharedItem::String(key.clone()));
                value_indices.insert(key, idx);
                idx
            };
            SharedItem::Index(idx)
        }
        CellValue::Number(n) => SharedItem::Number(n.get()),
        CellValue::Boolean(b) => SharedItem::Boolean(*b),
        CellValue::Error(err, _) => SharedItem::Error(err.as_str().to_string()),
        _ => SharedItem::Missing,
    }
}

/// Extract cache field definitions and record rows from sheet cell data.
fn extract_cache_data(
    sheet: &SheetData,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> (Vec<CacheFieldDef>, Vec<Vec<SharedItem>>) {
    let num_cols = (end_col - start_col + 1) as usize;

    let mut cell_map: HashMap<(u32, u32), &CellValue> = HashMap::new();
    for cell in &sheet.cells {
        if cell.row >= start_row
            && cell.row <= end_row
            && cell.col >= start_col
            && cell.col <= end_col
        {
            cell_map.insert((cell.row, cell.col), &cell.value);
        }
    }

    let header_row = start_row;
    let mut field_names = Vec::with_capacity(num_cols);
    for col in start_col..=end_col {
        let name = cell_map
            .get(&(header_row, col))
            .map(|v| match v {
                CellValue::Text(s) => s.to_string(),
                CellValue::Number(n) => format!("{}", n.get()),
                _ => format!("Column{}", col - start_col + 1),
            })
            .unwrap_or_else(|| format!("Column{}", col - start_col + 1));
        field_names.push(name);
    }

    let data_start = header_row + 1;
    let data_end = end_row;
    let mut field_shared_items: Vec<Vec<SharedItem>> = vec![Vec::new(); num_cols];
    let mut field_value_indices: Vec<HashMap<String, u32>> = vec![HashMap::new(); num_cols];
    let mut records: Vec<Vec<SharedItem>> = Vec::new();

    for row in data_start..=data_end {
        let mut record = Vec::with_capacity(num_cols);
        for (col_offset, col) in (start_col..=end_col).enumerate() {
            let value = cell_map.get(&(row, col)).copied();
            let item = match value {
                Some(CellValue::Text(s)) => {
                    let key = s.to_string();
                    let idx = if let Some(&existing) = field_value_indices[col_offset].get(&key) {
                        existing
                    } else {
                        let idx = field_shared_items[col_offset].len() as u32;
                        field_shared_items[col_offset].push(SharedItem::String(key.clone()));
                        field_value_indices[col_offset].insert(key, idx);
                        idx
                    };
                    SharedItem::Index(idx)
                }
                Some(CellValue::Number(n)) => SharedItem::Number(n.get()),
                Some(CellValue::Boolean(b)) => SharedItem::Boolean(*b),
                Some(CellValue::Error(..)) => SharedItem::Error("#VALUE!".to_string()),
                _ => SharedItem::Missing,
            };
            record.push(item);
        }
        records.push(record);
    }

    let fields: Vec<CacheFieldDef> = field_names
        .into_iter()
        .enumerate()
        .map(|(i, name)| CacheFieldDef {
            name,
            shared_items: std::mem::take(&mut field_shared_items[i]),
            number_format: None,
            num_fmt_id: None,
            sql_type: None,
            caption: None,
        })
        .collect();

    (fields, records)
}

fn extract_source_record_values(
    sheet: &SheetData,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<Vec<CellValue>> {
    let mut cell_map: HashMap<(u32, u32), &CellValue> = HashMap::new();
    for cell in &sheet.cells {
        if cell.row >= start_row
            && cell.row <= end_row
            && cell.col >= start_col
            && cell.col <= end_col
        {
            cell_map.insert((cell.row, cell.col), &cell.value);
        }
    }

    let data_start = start_row.saturating_add(1);
    (data_start..=end_row)
        .map(|row| {
            (start_col..=end_col)
                .map(|col| {
                    cell_map
                        .get(&(row, col))
                        .copied()
                        .cloned()
                        .unwrap_or_default()
                })
                .collect()
        })
        .collect()
}
