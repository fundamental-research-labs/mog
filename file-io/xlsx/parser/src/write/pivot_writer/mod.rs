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

pub use workbook_xml::{
    build_pivot_cache_rels_xml, build_pivot_caches_xml, build_x14_pivot_caches_ext_xml,
    build_x15_timeline_cache_pivot_caches_ext_xml,
};

use crate::domain::pivot::write::convert::pivot_table_def_to_writer;
use crate::write::pivot_writer::cache_data::build_cache;
use crate::write::pivot_writer::cache_sources::assign_cache_sources;
use crate::write::pivot_writer::config_to_def::parsed_pivot_to_def;
use crate::write::pivot_writer::part_paths::{
    pivot_cache_definition_path, pivot_cache_records_path, pivot_table_path,
};
use crate::write::pivot_writer::source_fields::derive_missing_fields;
use domain_types::ParseOutput;
use domain_types::domain::pivot::ParsedPivotTable;
use domain_types::domain::pivot::PivotCacheWorkbookRefScope;
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
    pub path: String,
    pub rels_path: String,
    /// Sheet index (0-based) this pivot table belongs to.
    pub sheet_idx: usize,
    pub cache_id: u32,
    pub cache_relationship_id_hint: Option<String>,
    pub xml: Vec<u8>,
}

pub struct PivotCacheEntry {
    pub global_idx: usize,
    pub cache_id: u32,
    pub workbook_ref_scope: PivotCacheWorkbookRefScope,
    pub definition_path: String,
    pub records_path: Option<String>,
    pub workbook_relationship_id_hint: Option<String>,
    pub workbook_relationship_type: String,
    pub records_relationship_id_hint: Option<String>,
    pub records_relationship_type: Option<String>,
    pub external_source_relationship_id_hint: Option<String>,
    pub external_source_relationship_type: Option<String>,
    pub external_source_relationship_target: Option<String>,
    pub external_source_relationship_target_mode: Option<String>,
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

    let assigned_caches = assign_cache_sources(&resolved_pivots, &output.pivot_cache_sources);
    debug_assert_eq!(
        resolved_pivots.len(),
        assigned_caches.pivot_cache_ids.len(),
        "cache assignment must preserve resolved pivot order",
    );

    let mut generated_part_paths = HashSet::new();
    let cache_sources =
        cache_sources_for_export(&assigned_caches.sources, &output.pivot_cache_sources);
    let pivot_cache_entries = build_pivot_cache_entries(
        output,
        &sheet_name_to_idx,
        &cache_sources,
        &mut generated_part_paths,
    );
    let emitted_cache_ids: HashSet<u32> = pivot_cache_entries
        .iter()
        .map(|entry| entry.cache_id)
        .collect();
    let mut resolved_pivots_with_emitted_caches = Vec::new();
    let mut emitted_pivot_cache_ids = Vec::new();
    for ((sheet_idx, pivot), cache_id) in resolved_pivots
        .iter()
        .copied()
        .zip(assigned_caches.pivot_cache_ids.iter().copied())
    {
        if emitted_cache_ids.contains(&cache_id) {
            resolved_pivots_with_emitted_caches.push((sheet_idx, pivot));
            emitted_pivot_cache_ids.push(cache_id);
        }
    }
    let pivot_table_entries = build_pivot_table_entries(
        &resolved_pivots_with_emitted_caches,
        &emitted_pivot_cache_ids,
        &mut generated_part_paths,
    );

    PivotWriteData {
        pivot_table_entries,
        pivot_cache_entries,
        generated_part_paths,
    }
}

fn cache_sources_for_export(
    assigned_sources: &[domain_types::PivotCacheSourceDef],
    live_sources: &[domain_types::PivotCacheSourceDef],
) -> Vec<domain_types::PivotCacheSourceDef> {
    let mut cache_sources = assigned_sources.to_vec();
    let mut seen_cache_ids: HashSet<u32> =
        cache_sources.iter().map(|source| source.cache_id).collect();
    for source in live_sources {
        if source.workbook_ref_scope == PivotCacheWorkbookRefScope::WorkbookPivotCaches {
            continue;
        }
        if seen_cache_ids.insert(source.cache_id) {
            cache_sources.push(source.clone());
        }
    }
    cache_sources
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
    let mut reserved_paths = reserved_pivot_cache_paths(output);
    let mut selected_paths = HashSet::new();
    cache_sources
        .iter()
        .enumerate()
        .filter_map(|(idx, cache_src)| {
            let global_idx = idx + 1;
            let fidelity = output
                .package_fidelity
                .as_ref()
                .into_iter()
                .flat_map(|fidelity| fidelity.pivot_cache_packages.iter())
                .find(|package| package_matches_cache_source(package, cache_src));
            let records_relationship_id_hint = fidelity
                .and_then(|package| package.records_relationship_id.clone());
            let external_relationship_id_for_xml = cache_src
                .external_worksheet
                .as_ref()
                .map(|source| {
                    source
                        .relationship_id_hint
                        .clone()
                        .unwrap_or_else(|| "rId1".to_string())
                });
            let records_relationship_id_for_xml =
                pivot_records_relationship_id_for_xml(
                    records_relationship_id_hint.as_deref(),
                    external_relationship_id_for_xml.as_deref(),
                );
            let (definition_xml, records_xml) = build_cache(
                cache_src,
                &output.sheets,
                sheet_name_to_idx,
                output
                    .pivot_cache_records
                    .get(&cache_src.cache_id)
                    .map(Vec::as_slice),
                Some(records_relationship_id_for_xml.as_str()),
                external_relationship_id_for_xml.as_deref(),
            )?;
            let definition_path = fidelity
                .and_then(|package| {
                    select_imported_path(&package.definition_path, &mut selected_paths)
                })
                .unwrap_or_else(|| {
                    allocate_generated_path(
                        global_idx,
                        &reserved_paths,
                        &mut selected_paths,
                        pivot_cache_definition_path,
                    )
                });
            reserved_paths.insert(definition_path.clone());
            let records_path = fidelity
                .and_then(|package| {
                    package
                        .records_path
                        .as_deref()
                        .and_then(|path| select_imported_path(path, &mut selected_paths))
                })
                .unwrap_or_else(|| {
                    allocate_generated_path(
                        global_idx,
                        &reserved_paths,
                        &mut selected_paths,
                        pivot_cache_records_path,
                    )
                });
            reserved_paths.insert(records_path.clone());
            let rels_path = pivot_cache_rels_path_for_definition(&definition_path);
            selected_paths.insert(rels_path.clone());

            generated_part_paths.insert(definition_path.clone());
            generated_part_paths.insert(records_path.clone());
            generated_part_paths.insert(rels_path);

            Some(PivotCacheEntry {
                global_idx,
                cache_id: cache_src.cache_id,
                workbook_ref_scope: cache_src.workbook_ref_scope,
                definition_path,
                records_path: Some(records_path),
                workbook_relationship_id_hint: fidelity
                    .map(|package| package.workbook_relationship_id.clone()),
                workbook_relationship_type: fidelity
                    .map(|package| package.workbook_relationship_type.clone())
                    .unwrap_or_else(|| {
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition"
                            .to_string()
                    }),
                records_relationship_id_hint: Some(records_relationship_id_for_xml),
                records_relationship_type: fidelity
                    .and_then(|package| package.records_relationship_type.clone())
                    .or_else(|| {
                        Some(
                            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords"
                                .to_string(),
                        )
                    }),
                external_source_relationship_id_hint: external_relationship_id_for_xml,
                external_source_relationship_type: cache_src
                    .external_worksheet
                    .as_ref()
                    .map(|source| source.relationship_type.clone()),
                external_source_relationship_target: cache_src
                    .external_worksheet
                    .as_ref()
                    .map(|source| source.target.clone()),
                external_source_relationship_target_mode: cache_src
                    .external_worksheet
                    .as_ref()
                    .and_then(|source| source.target_mode.clone()),
                definition_xml,
                records_xml: Some(records_xml),
            })
        })
        .collect()
}

fn pivot_records_relationship_id_for_xml(
    records_relationship_id_hint: Option<&str>,
    external_relationship_id_hint: Option<&str>,
) -> String {
    if let Some(records_relationship_id_hint) = records_relationship_id_hint {
        return records_relationship_id_hint.to_string();
    }
    if external_relationship_id_hint == Some("rId1") {
        "rId2".to_string()
    } else {
        "rId1".to_string()
    }
}

fn build_pivot_table_entries(
    resolved_pivots: &[(usize, &ParsedPivotTable)],
    pivot_cache_ids: &[u32],
    generated_part_paths: &mut HashSet<String>,
) -> Vec<PivotTableEntry> {
    let mut reserved_paths: HashSet<String> = resolved_pivots
        .iter()
        .filter_map(|(_, pt)| {
            pt.ooxml_preservation
                .relationship
                .as_ref()
                .and_then(|rel| rel.part_path.as_deref())
                .map(part_paths::normalize_part_path)
        })
        .collect();
    let mut selected_paths = HashSet::new();
    resolved_pivots
        .iter()
        .zip(pivot_cache_ids.iter())
        .enumerate()
        .map(|(idx, ((sheet_idx, pt), cache_id))| {
            let global_idx = idx + 1;
            let imported_path = pt
                .ooxml_preservation
                .relationship
                .as_ref()
                .and_then(|rel| rel.part_path.as_deref());
            let path = imported_path
                .and_then(|path| select_imported_path(path, &mut selected_paths))
                .unwrap_or_else(|| {
                    allocate_generated_path(
                        global_idx,
                        &reserved_paths,
                        &mut selected_paths,
                        pivot_table_path,
                    )
                });
            reserved_paths.insert(path.clone());
            let rels_path = pivot_table_rels_path_for_table(&path);
            let def = parsed_pivot_to_def(pt);
            let writer = pivot_table_def_to_writer(&pt.config.name, *cache_id, &def);
            let xml = writer.to_xml();

            generated_part_paths.insert(path.clone());
            generated_part_paths.insert(rels_path.clone());

            PivotTableEntry {
                global_idx,
                path,
                rels_path,
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

fn package_matches_cache_source(
    package: &domain_types::PivotCachePackageFidelity,
    cache_src: &domain_types::PivotCacheSourceDef,
) -> bool {
    package.cache_id == cache_src.cache_id
        && package.source_sheet.as_ref() == cache_src.source_sheet.as_ref()
        && package.source_range.as_ref() == cache_src.source_range.as_ref()
        && package.external_source_relationship_target.as_ref()
            == cache_src
                .external_worksheet
                .as_ref()
                .map(|source| &source.target)
}

fn reserved_pivot_cache_paths(output: &ParseOutput) -> HashSet<String> {
    let mut paths = HashSet::new();
    for package in output
        .package_fidelity
        .as_ref()
        .into_iter()
        .flat_map(|fidelity| fidelity.pivot_cache_packages.iter())
    {
        paths.insert(part_paths::normalize_part_path(&package.definition_path));
        paths.insert(pivot_cache_rels_path_for_definition(
            &package.definition_path,
        ));
        if let Some(records_path) = &package.records_path {
            paths.insert(part_paths::normalize_part_path(records_path));
        }
    }
    paths
}

fn select_imported_path(path: &str, selected_paths: &mut HashSet<String>) -> Option<String> {
    let path = part_paths::normalize_part_path(path);
    if selected_paths.insert(path.clone()) {
        Some(path)
    } else {
        None
    }
}

fn allocate_generated_path(
    first_idx: usize,
    reserved_paths: &HashSet<String>,
    selected_paths: &mut HashSet<String>,
    path_for_idx: fn(usize) -> String,
) -> String {
    let mut idx = first_idx;
    loop {
        let path = path_for_idx(idx);
        if !reserved_paths.contains(&path) && selected_paths.insert(path.clone()) {
            return path;
        }
        idx += 1;
    }
}

fn pivot_cache_rels_path_for_definition(definition_path: &str) -> String {
    let (dir, file) = definition_path
        .rsplit_once('/')
        .unwrap_or(("xl/pivotCache", definition_path));
    part_paths::normalize_part_path(&format!("{dir}/_rels/{file}.rels"))
}

fn pivot_table_rels_path_for_table(table_path: &str) -> String {
    let (dir, file) = table_path
        .rsplit_once('/')
        .unwrap_or(("xl/pivotTables", table_path));
    part_paths::normalize_part_path(&format!("{dir}/_rels/{file}.rels"))
}
