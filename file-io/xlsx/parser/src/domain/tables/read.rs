//! Table parsing functions for XLSX files.
//!
//! This module contains functions for parsing Excel Table definitions
//! from XLSX archives, reading relationship files to discover tables
//! and converting them to output structures.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices XML
//! tag / attribute content at byte offsets produced by ASCII-only XML
//! syntax (`<`, `>`, `/`, `"`, `=`). Char-boundary by construction.
//! File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::domain::tables;
use crate::infra::opc::{PackageOwner, WorksheetRelationships, parse_owned_relationships};
use crate::output::results::{
    ParsedCellRange, ParsedTable, ParsedTableColumn, ParsedTableSortCondition, ParsedTableSortState,
};
use crate::zip::XlsxArchive;

#[derive(Debug, Clone)]
struct TableRelationshipRef {
    id: String,
    target: String,
    path: String,
}

/// Parse tables for a sheet, returning both the structured `ParsedTable` list and
/// raw XML bytes keyed by their archive path (for round-trip passthrough).
///
/// Returns `(tables, raw_xml_passthroughs)` where `raw_xml_passthroughs` is a
/// `Vec<(zip_path, xml_bytes)>` used to preserve the original table XML verbatim
/// during the write phase.
pub fn parse_tables_for_sheet(
    archive: &XlsxArchive,
    sheet_num: usize,
) -> (Vec<ParsedTable>, Vec<(String, Vec<u8>)>) {
    let mut tables_vec = Vec::new();
    let mut raw_passthroughs: Vec<(String, Vec<u8>)> = Vec::new();

    // Read the relationship file for this sheet
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let mut table_relationships = if let Ok(rels_xml) = archive.read_file(&rels_path) {
        extract_table_relationships_for_sheet(sheet_num, &rels_xml)
    } else {
        Vec::new()
    };

    // Sort by numeric table index to ensure deterministic ordering regardless
    // of how the .rels XML orders the Relationship elements. Without this,
    // tables get written to wrong file paths when the rels order differs from
    // the natural table numbering (e.g., rels lists table9 before table3).
    table_relationships.sort_by_key(|rel| extract_table_number(&rel.path).unwrap_or(u32::MAX));

    // Parse each referenced table
    for table_rel in &table_relationships {
        let table_rel_path = &table_rel.path;
        if let Ok(table_xml) = archive.read_file(table_rel_path) {
            // Store raw bytes for round-trip passthrough before parsing
            raw_passthroughs.push((table_rel_path.clone(), table_xml.clone()));

            // Also capture the table's own .rels file if it exists.
            // e.g., xl/tables/table1.xml -> xl/tables/_rels/table1.xml.rels
            // These connect tables to external data sources (query tables, etc.).
            if let Some(slash_pos) = table_rel_path.rfind('/') {
                let dir = &table_rel_path[..slash_pos];
                let filename = &table_rel_path[slash_pos + 1..];
                let table_rels_path = format!("{}/_rels/{}.rels", dir, filename);
                if let Ok(table_rels_xml) = archive.read_file(&table_rels_path) {
                    raw_passthroughs.push((table_rels_path, table_rels_xml));
                }
            }

            if let Some(table) = tables::Table::parse(&table_xml) {
                if let Some(mut parsed) = convert_table_to_parsed(&table) {
                    parsed.worksheet_relationship_id_hint = Some(table_rel.id.clone());
                    parsed.table_part_path_hint = Some(table_rel.path.clone());
                    parsed.worksheet_relationship_target_hint = Some(table_rel.target.clone());
                    parsed.query_table =
                        crate::domain::connections::query_table_relationship_for_table(
                            archive,
                            table_rel_path,
                        )
                        .and_then(|(relationship_id, path)| {
                            crate::domain::connections::parse_query_table_for_path(
                                archive,
                                &path,
                                Some(relationship_id),
                            )
                        });
                    tables_vec.push(parsed);
                }
            }
        }
    }

    (tables_vec, raw_passthroughs)
}

fn extract_table_relationships_for_sheet(
    sheet_num: usize,
    rels_xml: &[u8],
) -> Vec<TableRelationshipRef> {
    let relationships = parse_owned_relationships(
        PackageOwner::Worksheet {
            sheet_index: sheet_num,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        },
        rels_xml,
    );
    WorksheetRelationships::new(&relationships)
        .tables()
        .into_iter()
        .filter_map(|rel| {
            rel.target.path().map(|path| TableRelationshipRef {
                id: rel.id.clone(),
                target: rel.target.raw().to_string(),
                path: path.to_string(),
            })
        })
        .collect()
}

/// Extract table relationship targets from a .rels XML file using exact OOXML
/// relationship classification.
#[cfg(test)]
fn extract_table_targets(rels_xml: &[u8]) -> Vec<String> {
    let relationships = parse_owned_relationships(
        PackageOwner::Worksheet {
            sheet_index: 0,
            path: "xl/worksheets/sheet1.xml".to_string(),
        },
        rels_xml,
    );
    WorksheetRelationships::new(&relationships)
        .tables()
        .into_iter()
        .map(|rel| rel.target.raw().to_string())
        .collect()
}

/// Extract the numeric table index from a table path like `../tables/table5.xml` → 5.
fn extract_table_number(path: &str) -> Option<u32> {
    let filename = path.rsplit('/').next()?;
    let stem = filename.strip_suffix(".xml")?;
    let num_str = stem.strip_prefix("table")?;
    num_str.parse().ok()
}

/// Resolve a relative table path from a worksheet .rels file to an absolute
/// archive path.
///
/// Handles paths like:
/// - `../tables/table1.xml` -> `xl/tables/table1.xml`
/// - `tables/table1.xml` -> `xl/worksheets/tables/table1.xml`
/// - `/xl/tables/table1.xml` -> `xl/tables/table1.xml`
#[cfg(test)]
pub(crate) fn resolve_table_path(rel_path: &str) -> String {
    if rel_path.starts_with('/') {
        // Absolute path from archive root
        rel_path.trim_start_matches('/').to_string()
    } else if let Some(stripped) = rel_path.strip_prefix("../") {
        // Relative path going up from xl/worksheets/ to xl/
        format!("xl/{}", stripped)
    } else {
        // Relative to xl/worksheets/
        format!("xl/worksheets/{}", rel_path)
    }
}

/// Convert a parsed `tables::Table` into a `ParsedTable` with range coordinates.
fn convert_table_to_parsed(table: &tables::Table) -> Option<ParsedTable> {
    use ooxml_types::tables::TableType;
    // Typed range refs: `table.ref_range` is typed (`Option<RangeRef>`). Extract
    // corners directly from the `CellRef::Positional` forms — no re-parse.
    // The downstream `ParsedTable.ref_range: String` field is still a raw
    // string (it flows through `results.rs`, outside W4.c scope), so
    // canonicalize via `RangeRef::to_a1_string`.
    let rr = table.ref_range.as_ref()?;
    let (start_row, start_col) = match rr.start {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    let (end_row, end_col) = match rr.end {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    let ref_range_str = rr.to_a1_string();

    Some(ParsedTable {
        id: table.id,
        name: table.name.clone(),
        display_name: table.display_name.clone(),
        ref_range: ref_range_str,
        range: ParsedCellRange {
            start_row,
            start_col,
            end_row,
            end_col,
        },
        columns: table
            .columns
            .iter()
            .map(|c| {
                use ooxml_types::tables::TotalsRowFunction;
                ParsedTableColumn {
                    id: c.id,
                    name: c.name.clone(),
                    header_row_dxf_id: c.header_row_dxf_id,
                    data_dxf_id: c.data_dxf_id,
                    totals_row_dxf_id: c.totals_row_dxf_id,
                    header_row_cell_style: c.header_row_cell_style.clone(),
                    data_cell_style: c.data_cell_style.clone(),
                    totals_row_cell_style: c.totals_row_cell_style.clone(),
                    calculated_column_formula: c
                        .calculated_column_formula
                        .as_ref()
                        .map(|f| f.text.clone()),
                    calculated_column_formula_array: c
                        .calculated_column_formula
                        .as_ref()
                        .map_or(false, |f| f.array),
                    totals_row_formula: c.totals_row_formula.as_ref().map(|f| f.text.clone()),
                    totals_row_formula_array: c
                        .totals_row_formula
                        .as_ref()
                        .map_or(false, |f| f.array),
                    totals_row_label: c.totals_row_label.clone(),
                    totals_row_function: if c.totals_row_function != TotalsRowFunction::None {
                        Some(c.totals_row_function.as_str().to_string())
                    } else {
                        None
                    },
                    unique_name: c.unique_name.clone(),
                    query_table_field_id: c.query_table_field_id,
                    xml_column_pr: c.xml_column_pr.clone(),
                    xr3_uid: c.xr3_uid.clone(),
                }
            })
            .collect(),
        has_headers: table.has_header(),
        has_totals: table.has_totals(),
        style_name: table.table_style_info.as_ref().and_then(|s| s.name.clone()),
        show_first_column: table
            .table_style_info
            .as_ref()
            .map_or(false, |s| s.show_first_column),
        show_last_column: table
            .table_style_info
            .as_ref()
            .map_or(false, |s| s.show_last_column),
        show_row_stripes: table
            .table_style_info
            .as_ref()
            .map_or(false, |s| s.show_row_stripes),
        show_column_stripes: table
            .table_style_info
            .as_ref()
            .map_or(false, |s| s.show_column_stripes),
        header_row_dxf_id: table.header_row_dxf_id,
        data_dxf_id: table.data_dxf_id,
        totals_row_dxf_id: table.totals_row_dxf_id,
        header_row_border_dxf_id: table.header_row_border_dxf_id,
        table_border_dxf_id: table.table_border_dxf_id,
        totals_row_border_dxf_id: table.totals_row_border_dxf_id,
        header_row_cell_style: table.header_row_cell_style.clone(),
        data_cell_style: table.data_cell_style.clone(),
        totals_row_cell_style: table.totals_row_cell_style.clone(),
        auto_filter_ref: table.auto_filter.as_ref().map(|af| af.ref_range.clone()),
        auto_filter_xr_uid: table.auto_filter.as_ref().and_then(|af| af.xr_uid.clone()),
        auto_filter_ext_lst_raw: table
            .auto_filter
            .as_ref()
            .and_then(|af| af.ext_lst_raw.clone()),
        table_type: if table.table_type != TableType::Worksheet {
            Some(table.table_type.to_ooxml().to_string())
        } else {
            None
        },
        totals_row_shown: table.totals_row_shown,
        connection_id: table.connection_id,
        comment: table.comment.clone(),
        insert_row: table.insert_row,
        insert_row_shift: table.insert_row_shift,
        published: table.published,
        xr_uid: table.xr_uid.clone(),
        sort_state: convert_table_sort_state(table),
        filter_columns: convert_filter_columns(table),
        query_table: None,
        worksheet_relationship_id_hint: None,
        table_part_path_hint: None,
        worksheet_relationship_target_hint: None,
    })
}

/// Convert parser filter columns to domain FilterColumnSpec types.
fn convert_filter_columns(table: &tables::Table) -> Vec<domain_types::FilterColumnSpec> {
    let af = match &table.auto_filter {
        Some(af) if !af.filter_columns.is_empty() => af,
        _ => return Vec::new(),
    };
    af.filter_columns
        .iter()
        .filter_map(|fc| {
            let filter = if let Some(ref f) = fc.filters {
                domain_types::FilterSpec::Values {
                    blank: f.blank,
                    values: f.values.clone(),
                    calendar_type: f.calendar_type,
                    date_group_items: f.date_group_items.clone(),
                }
            } else if let Some(ref cf) = fc.custom_filters {
                domain_types::FilterSpec::Custom {
                    and: cf.and,
                    filters: cf
                        .filters
                        .iter()
                        .map(|f| domain_types::CustomFilterSpec {
                            operator: f.operator.to_ooxml().to_string(),
                            val: f.val.clone(),
                        })
                        .collect(),
                }
            } else if let Some(ref t) = fc.top10 {
                domain_types::FilterSpec::Top10 {
                    top: t.top,
                    percent: t.percent,
                    val: t.val,
                    filter_val: t.filter_val,
                }
            } else if let Some(ref df) = fc.dynamic_filter {
                domain_types::FilterSpec::Dynamic {
                    kind: df.filter_type.to_ooxml().to_string(),
                    val: df.val,
                    max_val: df.max_val,
                    val_iso: df.val_iso.clone(),
                    max_val_iso: df.max_val_iso.clone(),
                }
            } else if let Some(ref cf) = fc.color_filter {
                domain_types::FilterSpec::Color {
                    dxf_id: cf.dxf_id,
                    cell_color: cf.cell_color,
                }
            } else if let Some(ref icon) = fc.icon_filter {
                domain_types::FilterSpec::Icon {
                    icon_set: icon.icon_set.to_ooxml().to_string(),
                    icon_id: icon.icon_id,
                }
            } else {
                return None;
            };
            Some(domain_types::FilterColumnSpec {
                col_id: fc.col_id,
                hidden_button: fc.hidden_button,
                show_button: fc.show_button,
                filter,
                ext_lst_raw: fc.ext_lst_raw.clone(),
            })
        })
        .collect()
}

/// Extract sort state from a table (from table-level sortState or autoFilter's sortState).
fn convert_table_sort_state(table: &tables::Table) -> Option<ParsedTableSortState> {
    // Prefer table-level sort_state; fall back to autoFilter's sort_state
    let ss = table.sort_state.as_ref().or_else(|| {
        table
            .auto_filter
            .as_ref()
            .and_then(|af| af.sort_state.as_ref())
    })?;

    Some(ParsedTableSortState {
        ref_range: ss.ref_range.clone(),
        column_sort: ss.column_sort,
        case_sensitive: ss.case_sensitive,
        sort_method: ss.sort_method,
        conditions: ss
            .sort_conditions
            .iter()
            .map(|sc| ParsedTableSortCondition {
                ref_range: sc.ref_range.clone(),
                descending: sc.descending,
                sort_by: match sc.sort_by {
                    ooxml_types::tables::SortBy::Value => domain_types::SortConditionBy::Value,
                    ooxml_types::tables::SortBy::CellColor => {
                        domain_types::SortConditionBy::CellColor
                    }
                    ooxml_types::tables::SortBy::FontColor => {
                        domain_types::SortConditionBy::FontColor
                    }
                    ooxml_types::tables::SortBy::Icon => domain_types::SortConditionBy::Icon,
                },
                custom_list: sc.custom_list.clone(),
                dxf_id: sc.dxf_id,
                icon_set: sc.icon_set,
                icon_id: sc.icon_id,
            })
            .collect(),
        ext_lst_raw: ss.ext_lst_raw.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // Table .rels parsing tests
    // =========================================================================

    #[test]
    fn test_extract_table_targets_single() {
        let rels_xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>
</Relationships>"#;
        let targets = extract_table_targets(rels_xml);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0], "../tables/table1.xml");
    }

    #[test]
    fn test_extract_table_targets_multiple() {
        let rels_xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/printerSettings" Target="../printerSettings/printerSettings1.bin"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table2.xml"/>
</Relationships>"#;
        let targets = extract_table_targets(rels_xml);
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0], "../tables/table1.xml");
        assert_eq!(targets[1], "../tables/table2.xml");
    }

    #[test]
    fn test_extract_table_targets_no_tables() {
        let rels_xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/printerSettings" Target="../printerSettings/printerSettings1.bin"/>
</Relationships>"#;
        let targets = extract_table_targets(rels_xml);
        assert!(targets.is_empty());
    }

    #[test]
    fn test_extract_table_targets_rejects_near_miss_relationship_type() {
        let rels_xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://example.invalid/relationships/custom-table" Target="../tables/table1.xml"/>
</Relationships>"#;
        let targets = extract_table_targets(rels_xml);
        assert!(targets.is_empty());
    }

    #[test]
    fn test_resolve_table_path_relative() {
        assert_eq!(
            resolve_table_path("../tables/table1.xml"),
            "xl/tables/table1.xml"
        );
    }

    #[test]
    fn test_resolve_table_path_absolute() {
        assert_eq!(
            resolve_table_path("/xl/tables/table5.xml"),
            "xl/tables/table5.xml"
        );
    }

    #[test]
    fn test_resolve_table_path_direct_relative() {
        assert_eq!(
            resolve_table_path("tables/table3.xml"),
            "xl/worksheets/tables/table3.xml"
        );
    }

    #[test]
    fn test_convert_table_to_parsed() {
        let table = tables::Table {
            id: 1,
            name: "Table1".to_string(),
            display_name: "MyTable".to_string(),
            // Typed range refs: typed ref_range.
            ref_range: compute_parser::parse_a1_range("B2:F20"),
            columns: vec![
                tables::TableColumn {
                    id: 1,
                    name: "Col1".to_string(),
                    ..Default::default()
                },
                tables::TableColumn {
                    id: 2,
                    name: "Col2".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let parsed = convert_table_to_parsed(&table).unwrap();
        assert_eq!(parsed.id, 1);
        assert_eq!(parsed.name, "Table1");
        assert_eq!(parsed.display_name, "MyTable");
        assert_eq!(parsed.ref_range, "B2:F20");
        assert_eq!(parsed.range.start_row, 1); // B2 -> row 1 (0-based)
        assert_eq!(parsed.range.start_col, 1); // B2 -> col 1 (0-based)
        assert_eq!(parsed.range.end_row, 19); // F20 -> row 19 (0-based)
        assert_eq!(parsed.range.end_col, 5); // F20 -> col 5 (0-based)
        assert_eq!(parsed.columns.len(), 2);
        assert_eq!(parsed.columns[0].id, 1);
        assert_eq!(parsed.columns[0].name, "Col1");
        assert_eq!(parsed.columns[1].id, 2);
        assert_eq!(parsed.columns[1].name, "Col2");
    }
}
