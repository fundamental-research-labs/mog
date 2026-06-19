use crate::domain::pivot::write::cache_writer::PivotCacheWriter;
use crate::domain::pivot::write::types::{
    CacheFieldDef, CacheSource, CacheSourceType, SharedItem, WorksheetSource,
};
use crate::write::pivot_writer::a1::parse_range;
use domain_types::domain::pivot::PivotCacheSourceKind;
use domain_types::{PivotCacheSourceDef, SheetData};
use std::collections::HashMap;
use value_types::CellValue;

const EXCEL_MAX_ROW_INDEX: u32 = 1_048_575;

/// Build pivot cache definition + records XML by reading source range cells.
pub(super) fn build_cache(
    cache_src: &PivotCacheSourceDef,
    sheets: &[SheetData],
    sheet_name_to_idx: &HashMap<&str, usize>,
    snapshot_records: Option<&[Vec<CellValue>]>,
    records_relationship_id: Option<&str>,
    external_source_relationship_id: Option<&str>,
) -> Option<(Vec<u8>, Vec<u8>)> {
    let mut cache_writer = PivotCacheWriter::new(cache_src.cache_id);
    if let Some(records_relationship_id) = records_relationship_id {
        cache_writer.records_relationship_id = records_relationship_id.to_string();
    }

    if cache_src.source_kind == PivotCacheSourceKind::ExternalWorksheet {
        cache_writer.source = CacheSource {
            source_type: CacheSourceType::Worksheet,
            worksheet_source: Some(WorksheetSource {
                sheet_name: cache_src.source_sheet.clone(),
                source_name: cache_src.source_name.clone(),
                range_ref: cache_src.source_range.clone().unwrap_or_default(),
                r_id: external_source_relationship_id.map(ToOwned::to_owned),
            }),
        };

        let (fields, records) = snapshot_records
            .map(|rows| cache_from_snapshot(cache_src, rows))
            .unwrap_or_else(|| (fields_from_source(cache_src, None), Vec::new()));
        for field in fields {
            cache_writer.add_field(field);
        }
        cache_writer.set_record_count(records.len() as u32);
        let definition_xml = cache_writer.to_definition_xml();
        let records_xml = cache_writer.to_records_xml(&records);
        return Some((definition_xml, records_xml));
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

        if let Some(rows) = snapshot_records {
            let (fields, records) = cache_from_snapshot(cache_src, rows);
            return Some(finish_cache(&mut cache_writer, fields, records));
        }

        if let Some((sheet_idx, range_ref)) = resolve_named_source(sheets, source_name) {
            let sheet = &sheets[sheet_idx];
            if let Some((start_row, start_col, end_row, mut end_col)) =
                resolve_extraction_range(sheet, range_ref)
            {
                if !cache_src.field_names.is_empty() {
                    let schema_end_col = start_col
                        .saturating_add(cache_src.field_names.len() as u32)
                        .saturating_sub(1);
                    end_col = end_col.min(schema_end_col);
                }
                let (fields, records) = extract_cache_data(
                    sheet,
                    CacheExtractionRange {
                        start_row,
                        start_col,
                        end_row,
                        end_col,
                        schema_num_cols: (!cache_src.field_names.is_empty())
                            .then_some(cache_src.field_names.len()),
                    },
                    &cache_src.field_names,
                    &cache_src.shared_items,
                );
                return Some(finish_cache(&mut cache_writer, fields, records));
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

        if let Some(rows) = snapshot_records {
            let (fields, records) = cache_from_snapshot(cache_src, rows);
            return Some(finish_cache(&mut cache_writer, fields, records));
        }

        if let Some(&sheet_idx) = sheet_name_to_idx.get(sheet_name.as_str()) {
            let sheet = &sheets[sheet_idx];
            if let Some((start_row, start_col, end_row, end_col)) =
                resolve_extraction_range(sheet, range_ref)
            {
                let (fields, records) = extract_cache_data(
                    sheet,
                    CacheExtractionRange {
                        start_row,
                        start_col,
                        end_row,
                        end_col,
                        schema_num_cols: None,
                    },
                    &cache_src.field_names,
                    &cache_src.shared_items,
                );
                return Some(finish_cache(&mut cache_writer, fields, records));
            }
        }
    }

    let snapshot_records = snapshot_records?;
    let (fields, records) = cache_from_snapshot(cache_src, snapshot_records);
    Some(finish_cache(&mut cache_writer, fields, records))
}

fn finish_cache(
    cache_writer: &mut PivotCacheWriter,
    fields: Vec<CacheFieldDef>,
    records: Vec<Vec<SharedItem>>,
) -> (Vec<u8>, Vec<u8>) {
    for field in fields {
        cache_writer.add_field(field);
    }
    cache_writer.set_record_count(records.len() as u32);
    let definition_xml = cache_writer.to_definition_xml();
    let records_xml = cache_writer.to_records_xml(&records);
    (definition_xml, records_xml)
}

fn resolve_extraction_range(sheet: &SheetData, range_ref: &str) -> Option<(u32, u32, u32, u32)> {
    if let Some((start_row, start_col, end_row, end_col)) = parse_range(range_ref) {
        let end_row = if start_row == 0 && end_row >= EXCEL_MAX_ROW_INDEX {
            sheet_data_last_row_in_columns(sheet, start_col, end_col)
        } else {
            end_row
        };
        return Some((start_row, start_col, end_row, end_col));
    }

    let (start_col, end_col) = parse_whole_column_range(range_ref)?;
    Some((
        0,
        start_col,
        sheet_data_last_row_in_columns(sheet, start_col, end_col),
        end_col,
    ))
}

fn sheet_data_last_row_in_columns(sheet: &SheetData, start_col: u32, end_col: u32) -> u32 {
    sheet
        .cells
        .iter()
        .filter(|cell| cell.col >= start_col && cell.col <= end_col)
        .map(|cell| cell.row)
        .max()
        .unwrap_or(0)
}

fn parse_whole_column_range(range_ref: &str) -> Option<(u32, u32)> {
    let range = range_ref.replace('$', "");
    let (start, end) = range.split_once(':')?;
    let start_col = parse_col_ref(start)?;
    let end_col = parse_col_ref(end)?;
    (start_col <= end_col).then_some((start_col, end_col))
}

fn parse_col_ref(col_ref: &str) -> Option<u32> {
    if col_ref.is_empty() || !col_ref.bytes().all(|b| b.is_ascii_alphabetic()) {
        return None;
    }
    let mut col: u32 = 0;
    for byte in col_ref.bytes() {
        col = col
            .saturating_mul(26)
            .saturating_add((byte.to_ascii_uppercase() - b'A') as u32 + 1);
    }
    (col > 0).then_some(col - 1)
}

fn fields_from_source(
    cache_src: &PivotCacheSourceDef,
    snapshot_width: Option<usize>,
) -> Vec<CacheFieldDef> {
    let num_cols = cache_src
        .field_names
        .len()
        .max(cache_src.shared_items.len())
        .max(snapshot_width.unwrap_or_default());
    let mut seeded = seeded_shared_items(num_cols, &cache_src.shared_items);
    (0..num_cols)
        .map(|i| CacheFieldDef {
            name: cache_src
                .field_names
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("Column{}", i + 1)),
            shared_items: std::mem::take(&mut seeded.shared_items[i]),
            number_format: None,
            num_fmt_id: None,
            sql_type: None,
            caption: None,
        })
        .collect()
}

fn cache_from_snapshot(
    cache_src: &PivotCacheSourceDef,
    rows: &[Vec<CellValue>],
) -> (Vec<CacheFieldDef>, Vec<Vec<SharedItem>>) {
    let num_cols = rows
        .iter()
        .map(Vec::len)
        .max()
        .unwrap_or_default()
        .max(cache_src.field_names.len())
        .max(cache_src.shared_items.len());
    let mut seeded = seeded_shared_items(num_cols, &cache_src.shared_items);
    let records = rows
        .iter()
        .map(|row| {
            row.iter()
                .enumerate()
                .map(|(col_idx, value)| {
                    cell_value_to_cache_record_item(
                        value,
                        &mut seeded.shared_items[col_idx],
                        &mut seeded.value_indices[col_idx],
                        seeded.missing_indices[col_idx],
                    )
                })
                .collect()
        })
        .collect();
    let fields = (0..num_cols)
        .map(|i| CacheFieldDef {
            name: cache_src
                .field_names
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("Column{}", i + 1)),
            shared_items: std::mem::take(&mut seeded.shared_items[i]),
            number_format: None,
            num_fmt_id: None,
            sql_type: None,
            caption: None,
        })
        .collect();
    (fields, records)
}

fn resolve_named_source<'a>(
    sheets: &'a [SheetData],
    source_name: &str,
) -> Option<(usize, &'a str)> {
    let exact = sheets.iter().enumerate().find_map(|(sheet_idx, sheet)| {
        sheet.tables.iter().find_map(|table| {
            (table.name == source_name || table.display_name == source_name)
                .then_some((sheet_idx, table.range_ref.as_str()))
        })
    });
    if exact.is_some() {
        return exact;
    }

    let mut prefix_matches = sheets.iter().enumerate().flat_map(|(sheet_idx, sheet)| {
        sheet.tables.iter().filter_map(move |table| {
            (table.name.starts_with(source_name) || table.display_name.starts_with(source_name))
                .then_some((sheet_idx, table.range_ref.as_str()))
        })
    });
    let first = prefix_matches.next()?;
    prefix_matches.next().is_none().then_some(first)
}

fn cell_value_to_cache_record_item(
    value: &CellValue,
    shared_items: &mut Vec<SharedItem>,
    value_indices: &mut HashMap<String, u32>,
    missing_index: Option<u32>,
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
        CellValue::Null => missing_index
            .map(SharedItem::Index)
            .unwrap_or(SharedItem::Missing),
        CellValue::Number(n) => SharedItem::Number(n.get()),
        CellValue::Boolean(b) => SharedItem::Boolean(*b),
        CellValue::Error(err, _) => SharedItem::Error(err.as_str().to_string()),
        _ => SharedItem::Missing,
    }
}

struct SeededSharedItems {
    shared_items: Vec<Vec<SharedItem>>,
    value_indices: Vec<HashMap<String, u32>>,
    missing_indices: Vec<Option<u32>>,
}

fn seeded_shared_items(num_cols: usize, seed_shared_items: &[Vec<CellValue>]) -> SeededSharedItems {
    let mut seeded = SeededSharedItems {
        shared_items: vec![Vec::new(); num_cols],
        value_indices: vec![HashMap::new(); num_cols],
        missing_indices: vec![None; num_cols],
    };

    for col_idx in 0..num_cols {
        if let Some(seeds) = seed_shared_items.get(col_idx) {
            for value in seeds {
                let shared_item = cell_value_to_shared_item(value);
                let item_idx = seeded.shared_items[col_idx].len() as u32;
                if let SharedItem::String(s) = &shared_item {
                    seeded.value_indices[col_idx]
                        .entry(s.clone())
                        .or_insert(item_idx);
                } else if matches!(shared_item, SharedItem::Missing) {
                    seeded.missing_indices[col_idx].get_or_insert(item_idx);
                }
                seeded.shared_items[col_idx].push(shared_item);
            }
        }
    }

    seeded
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
#[derive(Clone, Copy)]
struct CacheExtractionRange {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    schema_num_cols: Option<usize>,
}

fn extract_cache_data(
    sheet: &SheetData,
    range: CacheExtractionRange,
    cache_field_names: &[String],
    seed_shared_items: &[Vec<CellValue>],
) -> (Vec<CacheFieldDef>, Vec<Vec<SharedItem>>) {
    let source_num_cols = (range.end_col - range.start_col + 1) as usize;
    let num_cols = range.schema_num_cols.unwrap_or_else(|| {
        source_num_cols
            .max(cache_field_names.len())
            .max(seed_shared_items.len())
    });

    let mut cell_map: HashMap<(u32, u32), &CellValue> = HashMap::new();
    for cell in &sheet.cells {
        if cell.row >= range.start_row
            && cell.row <= range.end_row
            && cell.col >= range.start_col
            && cell.col <= range.end_col
        {
            cell_map.insert((cell.row, cell.col), &cell.value);
        }
    }

    let data_start = range.start_row + 1;
    let data_end = range.end_row;
    let mut seeded = seeded_shared_items(num_cols, seed_shared_items);
    let mut records: Vec<Vec<SharedItem>> = Vec::new();

    for row in data_start..=data_end {
        let mut record = Vec::with_capacity(num_cols);
        for col_offset in 0..num_cols {
            let col = range.start_col + col_offset as u32;
            let value = (col_offset < source_num_cols)
                .then(|| cell_map.get(&(row, col)).copied())
                .flatten();
            let item = cell_value_to_cache_record_item(
                value.unwrap_or(&CellValue::Null),
                &mut seeded.shared_items[col_offset],
                &mut seeded.value_indices[col_offset],
                seeded.missing_indices[col_offset],
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
            shared_items: std::mem::take(&mut seeded.shared_items[i]),
            number_format: None,
            num_fmt_id: None,
            sql_type: None,
            caption: None,
        })
        .collect();

    (fields, records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use value_types::FiniteF64;

    fn text_cell(row: u32, col: u32, value: &str) -> domain_types::CellData {
        domain_types::CellData {
            row,
            col,
            value: CellValue::Text(Arc::from(value)),
            ..Default::default()
        }
    }

    #[test]
    fn whole_column_source_uses_live_sheet_extent_not_dimension_extent() {
        let sheet = SheetData {
            name: "Data".to_string(),
            rows: 10_000,
            cols: 2,
            cells: vec![
                text_cell(0, 0, "Region"),
                text_cell(0, 1, "Amount"),
                text_cell(1, 0, "West"),
                domain_types::CellData {
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::new(42.0).unwrap()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let cache_src = PivotCacheSourceDef {
            cache_id: 1,
            source_kind: PivotCacheSourceKind::LocalWorksheet,
            source_sheet: Some("Data".to_string()),
            source_range: Some("A:B".to_string()),
            field_names: vec!["Region".to_string(), "Amount".to_string()],
            ..Default::default()
        };
        let sheet_name_to_idx = HashMap::from([("Data", 0usize)]);

        let (definition_xml, records_xml) = build_cache(
            &cache_src,
            &[sheet],
            &sheet_name_to_idx,
            None,
            Some("rId1"),
            None,
        )
        .expect("whole-column cache should resolve from live sheet state");
        let definition = String::from_utf8(definition_xml).unwrap();
        let records = String::from_utf8(records_xml).unwrap();

        assert!(definition.contains("recordCount=\"1\""));
        assert!(definition.contains("<s v=\"West\"/>"));
        assert_eq!(records.matches("<r>").count(), 1);
    }

    #[test]
    fn whole_column_source_ignores_live_cells_outside_source_columns() {
        let sheet = SheetData {
            name: "Data".to_string(),
            rows: 10_000,
            cols: 8,
            cells: vec![
                text_cell(0, 0, "Region"),
                text_cell(0, 1, "Amount"),
                text_cell(1, 0, "West"),
                domain_types::CellData {
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::new(42.0).unwrap()),
                    ..Default::default()
                },
                text_cell(9_999, 7, "unrelated"),
            ],
            ..Default::default()
        };
        let cache_src = PivotCacheSourceDef {
            cache_id: 1,
            source_kind: PivotCacheSourceKind::LocalWorksheet,
            source_sheet: Some("Data".to_string()),
            source_range: Some("A:B".to_string()),
            field_names: vec!["Region".to_string(), "Amount".to_string()],
            ..Default::default()
        };
        let sheet_name_to_idx = HashMap::from([("Data", 0usize)]);

        let (definition_xml, records_xml) = build_cache(
            &cache_src,
            &[sheet],
            &sheet_name_to_idx,
            None,
            Some("rId1"),
            None,
        )
        .expect("whole-column cache should use the source columns' live extent");
        let definition = String::from_utf8(definition_xml).unwrap();
        let records = String::from_utf8(records_xml).unwrap();

        assert!(definition.contains("recordCount=\"1\""));
        assert_eq!(records.matches("<r>").count(), 1);
    }

    #[test]
    fn full_height_range_source_ignores_live_cells_outside_source_columns() {
        let sheet = SheetData {
            name: "Data".to_string(),
            rows: 1_048_576,
            cols: 8,
            cells: vec![
                text_cell(0, 0, "Region"),
                text_cell(0, 1, "Amount"),
                text_cell(1, 0, "West"),
                domain_types::CellData {
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::new(42.0).unwrap()),
                    ..Default::default()
                },
                text_cell(1_048_575, 7, "unrelated"),
            ],
            ..Default::default()
        };
        let cache_src = PivotCacheSourceDef {
            cache_id: 1,
            source_kind: PivotCacheSourceKind::LocalWorksheet,
            source_sheet: Some("Data".to_string()),
            source_range: Some("A1:B1048576".to_string()),
            field_names: vec!["Region".to_string(), "Amount".to_string()],
            ..Default::default()
        };
        let sheet_name_to_idx = HashMap::from([("Data", 0usize)]);

        let (definition_xml, records_xml) = build_cache(
            &cache_src,
            &[sheet],
            &sheet_name_to_idx,
            None,
            Some("rId1"),
            None,
        )
        .expect("full-height cache should use the source columns' live extent");
        let definition = String::from_utf8(definition_xml).unwrap();
        let records = String::from_utf8(records_xml).unwrap();

        assert!(definition.contains("recordCount=\"1\""));
        assert_eq!(records.matches("<r>").count(), 1);
    }

    #[test]
    fn unresolved_local_source_does_not_emit_fake_empty_cache() {
        let cache_src = PivotCacheSourceDef {
            cache_id: 1,
            source_kind: PivotCacheSourceKind::LocalWorksheet,
            source_sheet: Some("Missing".to_string()),
            source_range: Some("not-a-range".to_string()),
            field_names: vec!["Region".to_string()],
            shared_items: vec![vec![CellValue::Text(Arc::from("West"))]],
            ..Default::default()
        };

        assert!(build_cache(&cache_src, &[], &HashMap::new(), None, Some("rId1"), None).is_none());
    }

    #[test]
    fn unresolved_local_source_uses_imported_typed_cache_records() {
        let cache_src = PivotCacheSourceDef {
            cache_id: 1,
            source_kind: PivotCacheSourceKind::LocalWorksheet,
            source_sheet: Some("Missing".to_string()),
            source_range: Some("A:B".to_string()),
            field_names: vec!["Region".to_string(), "Amount".to_string()],
            shared_items: vec![vec![CellValue::Text(Arc::from("West"))], vec![]],
            ..Default::default()
        };
        let snapshot_records = vec![vec![
            CellValue::Text(Arc::from("West")),
            CellValue::Number(FiniteF64::new(42.0).unwrap()),
        ]];

        let (definition_xml, records_xml) = build_cache(
            &cache_src,
            &[],
            &HashMap::new(),
            Some(&snapshot_records),
            Some("rId1"),
            None,
        )
        .expect("imported typed cache records should be exported when source is absent");
        let definition = String::from_utf8(definition_xml).unwrap();
        let records = String::from_utf8(records_xml).unwrap();

        assert!(definition.contains("recordCount=\"1\""));
        assert!(definition.contains(r#"<worksheetSource ref="A:B" sheet="Missing"/>"#));
        assert!(records.contains(r#"<x v="0"/>"#));
        assert!(records.contains(r#"<n v="42"/>"#));
    }

    #[test]
    fn imported_snapshot_records_preserve_row_widths() {
        let cache_src = PivotCacheSourceDef {
            cache_id: 1,
            source_kind: PivotCacheSourceKind::LocalWorksheet,
            source_sheet: Some("Missing".to_string()),
            source_range: Some("A:C".to_string()),
            field_names: vec![
                "Region".to_string(),
                "Amount".to_string(),
                "Trailing".to_string(),
            ],
            ..Default::default()
        };
        let snapshot_records = vec![
            vec![
                CellValue::Text(Arc::from("West")),
                CellValue::Number(FiniteF64::new(42.0).unwrap()),
            ],
            vec![
                CellValue::Text(Arc::from("East")),
                CellValue::Number(FiniteF64::new(7.0).unwrap()),
                CellValue::Null,
            ],
        ];

        let (definition_xml, records_xml) = build_cache(
            &cache_src,
            &[],
            &HashMap::new(),
            Some(&snapshot_records),
            Some("rId1"),
            None,
        )
        .expect("imported typed cache records should preserve sparse row shapes");
        let definition = String::from_utf8(definition_xml).unwrap();
        let records = String::from_utf8(records_xml).unwrap();

        assert!(definition.contains(r#"count="3""#));
        assert!(records.contains(r#"<r><x v="0"/><n v="42"/></r>"#));
        assert!(records.contains(r#"<r><x v="1"/><n v="7"/><m/></r>"#));
    }

    #[test]
    fn imported_snapshot_records_reuse_seeded_missing_shared_item() {
        let cache_src = PivotCacheSourceDef {
            cache_id: 1,
            source_kind: PivotCacheSourceKind::LocalWorksheet,
            source_sheet: Some("Missing".to_string()),
            source_range: Some("A:A".to_string()),
            field_names: vec!["Category".to_string()],
            shared_items: vec![vec![CellValue::Null]],
            ..Default::default()
        };
        let snapshot_records = vec![vec![CellValue::Null]];

        let (definition_xml, records_xml) = build_cache(
            &cache_src,
            &[],
            &HashMap::new(),
            Some(&snapshot_records),
            Some("rId1"),
            None,
        )
        .expect("imported typed cache records should preserve missing shared-item identity");
        let definition = String::from_utf8(definition_xml).unwrap();
        let records = String::from_utf8(records_xml).unwrap();

        assert!(
            definition.contains(r#"<sharedItems count="1" containsBlank="1"><m/></sharedItems>"#)
        );
        assert!(records.contains(r#"<x v="0"/>"#));
        assert!(!records.contains(r#"<m/>"#));
    }
}
