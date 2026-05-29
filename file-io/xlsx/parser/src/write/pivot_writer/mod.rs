//! Pivot table and pivot cache writing for `from_parse_output`.
//!
//! This module keeps the public writer facade and delegates focused pivot
//! writing concerns to child modules.

mod a1;
mod cache_data;
mod cache_sources;
mod config_to_def;
mod part_paths;
mod source_fields;
mod workbook_xml;

pub use workbook_xml::{build_pivot_cache_rels_xml, build_pivot_caches_xml};

use crate::domain::pivot::write::convert::pivot_table_def_to_writer;
use crate::write::pivot_writer::cache_data::build_cache;
use crate::write::pivot_writer::cache_sources::assign_cache_sources;
use crate::write::pivot_writer::config_to_def::parsed_pivot_to_def;
use crate::write::pivot_writer::part_paths::{
    pivot_cache_definition_path, pivot_cache_records_path, pivot_cache_rels_path, pivot_table_path,
    pivot_table_rels_path,
};
use crate::write::pivot_writer::source_fields::derive_missing_fields;
use domain_types::ParseOutput;
use domain_types::domain::pivot::ParsedPivotTable;
use std::collections::{HashMap, HashSet};

/// All generated pivot data ready for ZIP assembly.
pub struct PivotWriteData {
    /// (global_1based_idx, xml_bytes) for each pivotTable.
    pub pivot_table_entries: Vec<PivotTableEntry>,
    /// (global_1based_idx, definition_xml, records_xml) for each pivotCache.
    pub pivot_cache_entries: Vec<PivotCacheEntry>,
    /// Exact ZIP paths owned by generated output in this write.
    pub generated_part_paths: HashSet<String>,
}

pub struct PivotTableEntry {
    pub global_idx: usize,
    /// Sheet index (0-based) this pivot table belongs to.
    pub sheet_idx: usize,
    pub cache_id: u32,
    pub cache_relationship_id_hint: Option<String>,
    pub xml: Vec<u8>,
}

pub struct PivotCacheEntry {
    pub global_idx: usize,
    pub cache_id: u32,
    pub definition_path: String,
    pub records_path: Option<String>,
    pub workbook_relationship_id_hint: Option<String>,
    pub workbook_relationship_type: String,
    pub records_relationship_id_hint: Option<String>,
    pub records_relationship_type: Option<String>,
    pub definition_xml: Vec<u8>,
    pub records_xml: Option<Vec<u8>>,
}

/// Build all pivot table and cache XML from `ParseOutput`.
///
/// Each `ParsedPivotTable` contains a `PivotTableConfig` (unified compute +
/// OOXML config). The writer reconstructs the OOXML `PivotTableDef` from the
/// config, and regenerates pivot caches from source range cell data.
pub fn build_pivot_data(output: &ParseOutput) -> PivotWriteData {
    if output.pivot_tables.is_empty() {
        return empty_pivot_write_data();
    }

    let sheet_name_to_idx: HashMap<&str, usize> = output
        .sheets
        .iter()
        .enumerate()
        .map(|(i, s)| (s.name.as_str(), i))
        .collect();

    let pivot_tables =
        derive_missing_fields(&output.pivot_tables, &output.sheets, &sheet_name_to_idx);
    let resolved_pivots = resolve_output_sheets(&pivot_tables, &sheet_name_to_idx);

    if resolved_pivots.is_empty() {
        return empty_pivot_write_data();
    }

    let assigned_caches = assign_cache_sources(&resolved_pivots);
    debug_assert_eq!(
        resolved_pivots.len(),
        assigned_caches.pivot_cache_ids.len(),
        "cache assignment must preserve resolved pivot order",
    );

    let mut generated_part_paths = HashSet::new();
    let pivot_cache_entries = build_pivot_cache_entries(
        output,
        &sheet_name_to_idx,
        &assigned_caches.sources,
        &mut generated_part_paths,
    );
    let pivot_table_entries = build_pivot_table_entries(
        &resolved_pivots,
        &assigned_caches.pivot_cache_ids,
        &mut generated_part_paths,
    );

    PivotWriteData {
        pivot_table_entries,
        pivot_cache_entries,
        generated_part_paths,
    }
}

fn empty_pivot_write_data() -> PivotWriteData {
    PivotWriteData {
        pivot_table_entries: Vec::new(),
        pivot_cache_entries: Vec::new(),
        generated_part_paths: HashSet::new(),
    }
}

fn resolve_output_sheets<'a>(
    pivot_tables: &'a [std::borrow::Cow<'a, ParsedPivotTable>],
    sheet_name_to_idx: &HashMap<&str, usize>,
) -> Vec<(usize, &'a ParsedPivotTable)> {
    pivot_tables
        .iter()
        .filter_map(|pt| {
            let sheet_idx = sheet_name_to_idx
                .get(pt.config.output_sheet_name.as_str())
                .copied()?;
            Some((sheet_idx, pt.as_ref()))
        })
        .collect()
}

fn build_pivot_cache_entries(
    output: &ParseOutput,
    sheet_name_to_idx: &HashMap<&str, usize>,
    cache_sources: &[domain_types::PivotCacheSourceDef],
    generated_part_paths: &mut HashSet<String>,
) -> Vec<PivotCacheEntry> {
    cache_sources
        .iter()
        .enumerate()
        .map(|(idx, cache_src)| {
            let global_idx = idx + 1;
            let (definition_xml, records_xml) = build_cache(
                cache_src,
                &output.sheets,
                sheet_name_to_idx,
            );

            generated_part_paths.insert(pivot_cache_definition_path(global_idx));
            generated_part_paths.insert(pivot_cache_records_path(global_idx));
            generated_part_paths.insert(pivot_cache_rels_path(global_idx));

            PivotCacheEntry {
                global_idx,
                cache_id: cache_src.cache_id,
                definition_path: pivot_cache_definition_path(global_idx),
                records_path: Some(pivot_cache_records_path(global_idx)),
                workbook_relationship_id_hint: None,
                workbook_relationship_type:
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition"
                        .to_string(),
                records_relationship_id_hint: None,
                records_relationship_type: Some(
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords"
                        .to_string(),
                ),
                definition_xml,
                records_xml: Some(records_xml),
            }
        })
        .collect()
}

fn build_pivot_table_entries(
    resolved_pivots: &[(usize, &ParsedPivotTable)],
    pivot_cache_ids: &[u32],
    generated_part_paths: &mut HashSet<String>,
) -> Vec<PivotTableEntry> {
    resolved_pivots
        .iter()
        .zip(pivot_cache_ids.iter())
        .enumerate()
        .map(|(idx, ((sheet_idx, pt), cache_id))| {
            let global_idx = idx + 1;
            let def = parsed_pivot_to_def(pt);
            let writer = pivot_table_def_to_writer(&pt.config.name, *cache_id, &def);
            let xml = writer.to_xml();

            generated_part_paths.insert(pivot_table_path(global_idx));
            generated_part_paths.insert(pivot_table_rels_path(global_idx));

            PivotTableEntry {
                global_idx,
                sheet_idx: *sheet_idx,
                cache_id: *cache_id,
                cache_relationship_id_hint: pt
                    .ooxml_preservation
                    .relationship
                    .as_ref()
                    .and_then(|rel| rel.relationship_id.clone()),
                xml,
            }
        })
        .collect()
}
