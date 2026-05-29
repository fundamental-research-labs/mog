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
    records_relationship_id: Option<&str>,
) -> (Vec<u8>, Vec<u8>) {
    let mut cache_writer = PivotCacheWriter::new(cache_src.cache_id);
    if let Some(records_relationship_id) = records_relationship_id {
        cache_writer.records_relationship_id = records_relationship_id.to_string();
    }

    if let Some(source_name) = &cache_src.source_name {
        cache_writer.source = CacheSource {
            source_type: CacheSourceType::Worksheet,
            worksheet_source: Some(WorksheetSource {
                sheet_name: None,
                source_name: Some(source_name.clone()),
                range_ref: String::new(),
                r_id: None,
            }),
        };

        if let Some((sheet_idx, range_ref)) = resolve_named_source(sheets, source_name) {
            let sheet = &sheets[sheet_idx];
            if let Some((start_row, start_col, end_row, end_col)) = parse_range(range_ref) {
                let (fields, records) = extract_cache_data(
                    sheet,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    &cache_src.field_names,
                    &cache_src.shared_items,
                );
                for field in fields {
                    cache_writer.add_field(field);
                }
                cache_writer.set_record_count(records.len() as u32);
                let definition_xml = cache_writer.to_definition_xml();
                let records_xml = cache_writer.to_records_xml(&records);
                return (definition_xml, records_xml);
            }
        }
    } else if let (Some(sheet_name), Some(range_ref)) =
        (&cache_src.source_sheet, &cache_src.source_range)
    {
        cache_writer.source = CacheSource {
            source_type: CacheSourceType::Worksheet,
            worksheet_source: Some(WorksheetSource {
                sheet_name: Some(sheet_name.clone()),
                source_name: None,
                range_ref: range_ref.clone(),
                r_id: None,
            }),
        };

        if let Some(&sheet_idx) = sheet_name_to_idx.get(sheet_name.as_str()) {
            let sheet = &sheets[sheet_idx];
            if let Some((start_row, start_col, end_row, end_col)) = parse_range(range_ref) {
                let (fields, records) = extract_cache_data(
                    sheet,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    &cache_src.field_names,
                    &cache_src.shared_items,
                );
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

fn resolve_named_source<'a>(
    sheets: &'a [SheetData],
    source_name: &str,
) -> Option<(usize, &'a str)> {
    sheets.iter().enumerate().find_map(|(sheet_idx, sheet)| {
        sheet.tables.iter().find_map(|table| {
            (table.name == source_name || table.display_name == source_name)
                .then_some((sheet_idx, table.range_ref.as_str()))
        })
    })
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

fn seeded_shared_items(
    num_cols: usize,
    seed_shared_items: &[Vec<CellValue>],
) -> (Vec<Vec<SharedItem>>, Vec<HashMap<String, u32>>) {
    let mut field_shared_items: Vec<Vec<SharedItem>> = vec![Vec::new(); num_cols];
    let mut field_value_indices: Vec<HashMap<String, u32>> = vec![HashMap::new(); num_cols];

    for col_idx in 0..num_cols {
        if let Some(seeds) = seed_shared_items.get(col_idx) {
            for value in seeds {
                let shared_item = cell_value_to_shared_item(value);
                if let SharedItem::String(s) = &shared_item {
                    field_value_indices[col_idx]
                        .entry(s.clone())
                        .or_insert(field_shared_items[col_idx].len() as u32);
                }
                field_shared_items[col_idx].push(shared_item);
            }
        }
    }

    (field_shared_items, field_value_indices)
}

fn cell_value_to_shared_item(value: &CellValue) -> SharedItem {
    match value {
        CellValue::Text(s) => SharedItem::String(s.to_string()),
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
    cache_field_names: &[String],
    seed_shared_items: &[Vec<CellValue>],
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

    let data_start = start_row + 1;
    let data_end = end_row;
    let (mut field_shared_items, mut field_value_indices) =
        seeded_shared_items(num_cols, seed_shared_items);
    let mut records: Vec<Vec<SharedItem>> = Vec::new();

    for row in data_start..=data_end {
        let mut record = Vec::with_capacity(num_cols);
        for (col_offset, col) in (start_col..=end_col).enumerate() {
            let value = cell_map.get(&(row, col)).copied();
            let item = cell_value_to_cache_record_item(
                value.unwrap_or(&CellValue::Null),
                &mut field_shared_items[col_offset],
                &mut field_value_indices[col_offset],
            );
            record.push(item);
        }
        records.push(record);
    }

    let fields: Vec<CacheFieldDef> = (0..num_cols)
        .enumerate()
        .map(|(i, _)| CacheFieldDef {
            name: cache_field_names
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("Column{}", i + 1)),
            shared_items: std::mem::take(&mut field_shared_items[i]),
            number_format: None,
            num_fmt_id: None,
            sql_type: None,
            caption: None,
        })
        .collect();

    (fields, records)
}
