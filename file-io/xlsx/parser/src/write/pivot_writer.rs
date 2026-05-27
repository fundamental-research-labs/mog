//! Pivot table and pivot cache writing for `from_parse_output`.
//!
//! This module handles:
//! - Converting domain-types pivot definitions → writer XML
//! - Regenerating pivot cache data from source range cells
//! - Building all necessary rels, content types, and ZIP entries
//!
//! UTF-8 boundary guard: the single `&s[..n]` slice in this file truncates a
//! relationship-ID string at an ASCII-only delimiter. Char-boundary
//! by construction. File-scope allow documented here.
//!
//! Typed OOXML preservation: C: OOXML round-trip attributes live directly on
//! `PivotTableConfig` / `PivotField` — no `PivotOoxmlPreserved` sidecar.

#![allow(clippy::string_slice)]

use crate::domain::pivot::write::cache_writer::PivotCacheWriter;
use crate::domain::pivot::write::convert::pivot_table_def_to_writer;
use crate::domain::pivot::write::types::{
    CacheFieldDef, CacheSource, CacheSourceType, SharedItem, WorksheetSource,
};
use domain_types::domain::pivot::ParsedPivotTable;
use domain_types::{ParseOutput, PivotCacheSourceDef, RoundTripContext, SheetData};
use std::collections::{HashMap, HashSet};
use value_types::CellValue;

/// All generated pivot data ready for ZIP assembly.
pub struct PivotWriteData {
    /// (global_1based_idx, xml_bytes) for each pivotTable.
    pub pivot_table_entries: Vec<PivotTableEntry>,
    /// (global_1based_idx, definition_xml, records_xml) for each pivotCache.
    pub pivot_cache_entries: Vec<PivotCacheEntry>,
    /// Clean imported pivot table relationships replayed from the typed package sidecar.
    pub preserved_pivot_table_entries: Vec<PreservedPivotTableEntry>,
    /// Clean imported workbook pivot cache entries replayed from the typed package sidecar.
    pub preserved_workbook_cache_entries: Vec<PreservedWorkbookCacheEntry>,
    /// Whether `RoundTripContext.pivot_package` was present and should be authoritative
    /// for pivot preservation decisions.
    pub has_typed_package_contract: bool,
    /// Exact ZIP paths owned by generated output in this write.
    pub generated_part_paths: HashSet<String>,
    /// Exact ZIP paths proven to belong to clean imported or orphan pivot package parts.
    pub preserved_part_paths: HashSet<String>,
    /// Exact content type part names proven to belong to clean imported or orphan parts.
    pub preserved_content_type_part_names: HashSet<String>,
}

pub struct PivotTableEntry {
    pub global_idx: usize,
    /// Sheet index (0-based) this pivot table belongs to.
    pub sheet_idx: usize,
    pub cache_id: u32,
    pub xml: Vec<u8>,
}

pub struct PivotCacheEntry {
    pub global_idx: usize,
    pub cache_id: u32,
    pub definition_xml: Vec<u8>,
    pub records_xml: Vec<u8>,
}

pub struct PreservedPivotTableEntry {
    pub sheet_idx: usize,
    pub relationship_id: String,
    pub relationship_target: String,
}

pub struct PreservedWorkbookCacheEntry {
    pub cache_id: u32,
    pub relationship_id: String,
    pub relationship_target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum CacheIdentity {
    Explicit(u32),
    Source {
        source_sheet_name: String,
        source_range: String,
        field_names: Vec<String>,
    },
}

/// Build all pivot table and cache XML from `ParseOutput`.
///
/// Each `ParsedPivotTable` contains a `PivotTableConfig` (unified compute +
/// OOXML round-trip config; typed OOXML preservation). The writer reconstructs the OOXML
/// `PivotTableDef` from the config, and regenerates pivot caches from source
/// range cell data.
pub fn build_pivot_data(
    output: &ParseOutput,
    round_trip_ctx: Option<&RoundTripContext>,
) -> PivotWriteData {
    let package = round_trip_ctx
        .map(|ctx| &ctx.pivot_package)
        .filter(|package| !package.is_empty())
        .filter(|package| clean_pivot_package_is_closed(package));
    let has_typed_package_contract = package.is_some();
    let preserved_pivot_table_entries = package
        .map(|package| {
            package
                .pivot_tables
                .iter()
                .filter(|table| {
                    table.ownership == domain_types::PivotPackageOwnership::CleanImported
                })
                .map(|table| PreservedPivotTableEntry {
                    sheet_idx: table.sheet_index,
                    relationship_id: table.sheet_relationship_id.clone(),
                    relationship_target: table.sheet_relationship_target.clone(),
                })
                .collect()
        })
        .unwrap_or_default();
    let preserved_workbook_cache_entries: Vec<PreservedWorkbookCacheEntry> = package
        .map(|package| {
            package
                .workbook_cache_entries
                .iter()
                .filter(|entry| {
                    entry.ownership == domain_types::PivotPackageOwnership::CleanImported
                })
                .map(|entry| PreservedWorkbookCacheEntry {
                    cache_id: entry.cache_id,
                    relationship_id: entry.relationship_id.clone(),
                    relationship_target: entry.relationship_target.clone(),
                })
                .collect()
        })
        .unwrap_or_default();
    let preserved_part_paths = preserved_pivot_part_paths(round_trip_ctx);
    let preserved_content_type_part_names = package
        .map(|package| {
            package
                .content_type_overrides
                .iter()
                .filter(|ct| ct.ownership == domain_types::PivotPackageOwnership::CleanImported)
                .map(|ct| normalize_content_type_part_name(&ct.part_name))
                .collect()
        })
        .unwrap_or_default();

    if output.pivot_tables.is_empty() {
        return PivotWriteData {
            pivot_table_entries: Vec::new(),
            pivot_cache_entries: Vec::new(),
            preserved_pivot_table_entries,
            preserved_workbook_cache_entries,
            has_typed_package_contract,
            generated_part_paths: HashSet::new(),
            preserved_part_paths,
            preserved_content_type_part_names,
        };
    }

    // Build sheet name → index lookup.
    let sheet_name_to_idx: HashMap<&str, usize> = output
        .sheets
        .iter()
        .enumerate()
        .map(|(i, s)| (s.name.as_str(), i))
        .collect();

    // Pre-process: for API-created pivots with empty `fields`, auto-derive
    // fields from the source range header row. OOXML requires one <pivotField>
    // per cache field, and both the cache and pivot table generation depend on
    // config.fields being populated.
    let pivot_tables: Vec<std::borrow::Cow<'_, ParsedPivotTable>> = output
        .pivot_tables
        .iter()
        .filter(|pt| !is_clean_imported_pivot(pt, round_trip_ctx))
        .map(|pt| {
            if !pt.config.fields.is_empty() {
                return std::borrow::Cow::Borrowed(pt);
            }
            // Derive fields from the source range header row.
            let header_names =
                read_source_header_names(&pt.config, &output.sheets, &sheet_name_to_idx);
            if header_names.is_empty() {
                return std::borrow::Cow::Borrowed(pt);
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
            std::borrow::Cow::Owned(ParsedPivotTable {
                config,
                initial_expansion_state: pt.initial_expansion_state.clone(),
            })
        })
        .collect();

    // Resolve output sheets up front. An unresolved output sheet means there is no
    // deterministic worksheet relationship target, so skip that pivot table.
    let resolved_pivots: Vec<(usize, &ParsedPivotTable)> = pivot_tables
        .iter()
        .filter_map(|pt| {
            let sheet_idx = sheet_name_to_idx
                .get(pt.config.output_sheet_name.as_str())
                .copied()?;
            Some((sheet_idx, pt.as_ref()))
        })
        .collect();

    if resolved_pivots.is_empty() {
        return PivotWriteData {
            pivot_table_entries: Vec::new(),
            pivot_cache_entries: Vec::new(),
            preserved_pivot_table_entries,
            preserved_workbook_cache_entries,
            has_typed_package_contract,
            generated_part_paths: HashSet::new(),
            preserved_part_paths,
            preserved_content_type_part_names,
        };
    }

    // Build cache sources from ParsedPivotTable data.
    // Pivots share a generated cache only with the same explicit cache id or
    // the same canonical source contract. Missing cache ids are not all cache 0.
    let mut cache_sources: Vec<PivotCacheSourceDef> = Vec::new();
    let mut seen_cache_identities: HashMap<CacheIdentity, u32> = HashMap::new();
    let mut pivot_cache_ids: Vec<u32> = Vec::with_capacity(resolved_pivots.len());
    let mut next_generated_cache_id = resolved_pivots
        .iter()
        .filter_map(|(_, pt)| pt.config.cache_id)
        .max()
        .unwrap_or(0)
        .saturating_add(1);

    for (_, pt) in &resolved_pivots {
        // Build a PivotCacheSourceDef from the config
        let config = &pt.config;
        let source_range_str = format!(
            "{}{}:{}{}",
            col_to_letters(config.source_range.start_col()),
            config.source_range.start_row() + 1,
            col_to_letters(config.source_range.end_col()),
            config.source_range.end_row() + 1,
        );
        let field_names: Vec<String> = config.fields.iter().map(|f| f.name.clone()).collect();
        let identity = match config.cache_id {
            Some(cache_id) => CacheIdentity::Explicit(cache_id),
            None => CacheIdentity::Source {
                source_sheet_name: config.source_sheet_name.clone(),
                source_range: source_range_str.clone(),
                field_names: field_names.clone(),
            },
        };

        let cache_id = if let Some(cache_id) = seen_cache_identities.get(&identity) {
            *cache_id
        } else {
            let cache_id = match config.cache_id {
                Some(cache_id) => cache_id,
                None => {
                    let id = next_generated_cache_id;
                    next_generated_cache_id = next_generated_cache_id.saturating_add(1);
                    id
                }
            };
            seen_cache_identities.insert(identity, cache_id);
            cache_sources.push(PivotCacheSourceDef {
                cache_id,
                source_sheet: Some(config.source_sheet_name.clone()),
                source_range: Some(source_range_str),
                field_names,
                shared_items: Vec::new(),
            });
            cache_id
        };
        pivot_cache_ids.push(cache_id);
    }

    // 1. Generate pivot caches from source range data.
    let mut pivot_cache_entries = Vec::new();
    let mut generated_part_paths = HashSet::new();
    let mut next_cache_global_idx = 1usize;
    for cache_src in &cache_sources {
        let global_idx = next_available_cache_idx(next_cache_global_idx, &preserved_part_paths);
        next_cache_global_idx = global_idx + 1;

        let (definition_xml, records_xml) =
            build_cache_from_source(cache_src, &output.sheets, &sheet_name_to_idx);

        generated_part_paths.insert(normalize_part_path(&format!(
            "xl/pivotCache/pivotCacheDefinition{}.xml",
            global_idx
        )));
        generated_part_paths.insert(normalize_part_path(&format!(
            "xl/pivotCache/pivotCacheRecords{}.xml",
            global_idx
        )));
        generated_part_paths.insert(normalize_part_path(&format!(
            "xl/pivotCache/_rels/pivotCacheDefinition{}.xml.rels",
            global_idx
        )));

        pivot_cache_entries.push(PivotCacheEntry {
            global_idx,
            cache_id: cache_src.cache_id,
            definition_xml,
            records_xml,
        });
    }

    // 2. Generate pivot table XML from ParsedPivotTable.
    //    We reconstruct a PivotTableDef from the unified config for the writer.
    let mut pivot_table_entries = Vec::new();
    let mut next_table_global_idx = 1usize;
    for ((sheet_idx, pt), cache_id) in resolved_pivots.iter().zip(pivot_cache_ids.iter()) {
        let global_idx = next_available_table_idx(next_table_global_idx, &preserved_part_paths);
        next_table_global_idx = global_idx + 1;

        // Convert ParsedPivotTable → PivotTableDef for the writer.
        let def = parsed_pivot_to_def(pt);
        let writer = pivot_table_def_to_writer(&pt.config.name, *cache_id, &def);
        let xml = writer.to_xml();

        generated_part_paths.insert(normalize_part_path(&format!(
            "xl/pivotTables/pivotTable{}.xml",
            global_idx
        )));
        generated_part_paths.insert(normalize_part_path(&format!(
            "xl/pivotTables/_rels/pivotTable{}.xml.rels",
            global_idx
        )));

        pivot_table_entries.push(PivotTableEntry {
            global_idx,
            sheet_idx: *sheet_idx,
            cache_id: *cache_id,
            xml,
        });
    }

    PivotWriteData {
        pivot_table_entries,
        pivot_cache_entries,
        preserved_pivot_table_entries,
        preserved_workbook_cache_entries,
        has_typed_package_contract,
        generated_part_paths,
        preserved_part_paths,
        preserved_content_type_part_names,
    }
}

fn normalize_part_path(path: &str) -> String {
    path.trim_start_matches('/').to_string()
}

fn normalize_content_type_part_name(path: &str) -> String {
    format!("/{}", normalize_part_path(path))
}

fn preserved_pivot_part_paths(round_trip_ctx: Option<&RoundTripContext>) -> HashSet<String> {
    let Some(package) = round_trip_ctx
        .map(|ctx| &ctx.pivot_package)
        .filter(|package| !package.is_empty())
        .filter(|package| clean_pivot_package_is_closed(package))
    else {
        return HashSet::new();
    };

    let mut paths = HashSet::new();
    for cache in &package.cache_definitions {
        if cache.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        paths.insert(normalize_part_path(&cache.definition_path));
        if let Some(path) = &cache.definition_rels_path {
            paths.insert(normalize_part_path(path));
        }
        if let Some(path) = &cache.records_path {
            paths.insert(normalize_part_path(path));
        }
    }
    for table in &package.pivot_tables {
        if table.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        paths.insert(normalize_part_path(&table.table_path));
        if let Some(path) = &table.table_rels_path {
            paths.insert(normalize_part_path(path));
        }
    }
    for orphan in &package.orphan_parts {
        if orphan.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        paths.insert(normalize_part_path(&orphan.part.path));
    }
    paths
}

fn clean_pivot_package_is_closed(package: &domain_types::PivotPackageRoundTrip) -> bool {
    let mut part_paths = HashSet::new();
    for cache in &package.cache_definitions {
        if cache.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        part_paths.insert(normalize_part_path(&cache.definition_path));
        if let Some(path) = &cache.definition_rels_path {
            part_paths.insert(normalize_part_path(path));
        }
        if let Some(path) = &cache.records_path {
            part_paths.insert(normalize_part_path(path));
        }
    }
    for table in &package.pivot_tables {
        if table.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        part_paths.insert(normalize_part_path(&table.table_path));
        if let Some(path) = &table.table_rels_path {
            part_paths.insert(normalize_part_path(path));
        }
    }
    for orphan in &package.orphan_parts {
        if orphan.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        part_paths.insert(normalize_part_path(&orphan.part.path));
    }

    package
        .workbook_cache_entries
        .iter()
        .filter(|entry| entry.ownership == domain_types::PivotPackageOwnership::CleanImported)
        .all(|entry| {
            part_paths.contains(&normalize_workbook_child_target(&entry.relationship_target))
        })
        && package
            .pivot_tables
            .iter()
            .filter(|table| table.ownership == domain_types::PivotPackageOwnership::CleanImported)
            .all(|table| {
                let sheet_target = crate::infra::opc::resolve_relationship_target(
                    Some(&format!("xl/worksheets/sheet{}.xml", table.sheet_index + 1)),
                    &table.sheet_relationship_target,
                )
                .map(|path| normalize_part_path(&path))
                .ok();
                sheet_target
                    .as_ref()
                    .is_some_and(|path| part_paths.contains(path))
                    && pivot_relationships_are_closed(
                        &table.table_path,
                        &table.raw_relationships,
                        &part_paths,
                    )
            })
        && package
            .cache_definitions
            .iter()
            .filter(|cache| cache.ownership == domain_types::PivotPackageOwnership::CleanImported)
            .all(|cache| {
                pivot_relationships_are_closed(
                    &cache.definition_path,
                    &cache.raw_relationships,
                    &part_paths,
                )
            })
}

fn normalize_workbook_child_target(target: &str) -> String {
    let normalized = normalize_part_path(target);
    if normalized.starts_with("xl/") {
        normalized
    } else {
        format!("xl/{normalized}")
    }
}

fn pivot_relationships_are_closed(
    owner_path: &str,
    relationships: &[domain_types::OpcRelationship],
    part_paths: &HashSet<String>,
) -> bool {
    relationships.iter().all(|rel| {
        if rel.target_mode.as_deref() == Some("External") {
            return true;
        }
        crate::infra::opc::resolve_relationship_target(Some(owner_path), &rel.target)
            .map(|path| part_paths.contains(&normalize_part_path(&path)))
            .unwrap_or(false)
    })
}

fn is_clean_imported_pivot(
    pt: &ParsedPivotTable,
    round_trip_ctx: Option<&RoundTripContext>,
) -> bool {
    let Some(package) = round_trip_ctx
        .map(|ctx| &ctx.pivot_package)
        .filter(|package| !package.is_empty())
    else {
        return false;
    };
    package.pivot_tables.iter().any(|table| {
        table.ownership == domain_types::PivotPackageOwnership::CleanImported
            && table.referenced_cache_id == pt.config.cache_id.unwrap_or_default()
            && table.sheet_name == pt.config.output_sheet_name
            && table
                .pivot_name
                .as_deref()
                .map(|name| name == pt.config.name.as_str())
                .unwrap_or(true)
    })
}

fn next_available_cache_idx(start: usize, reserved_paths: &HashSet<String>) -> usize {
    let mut idx = start;
    while reserved_paths.contains(&normalize_part_path(&format!(
        "xl/pivotCache/pivotCacheDefinition{}.xml",
        idx
    ))) || reserved_paths.contains(&normalize_part_path(&format!(
        "xl/pivotCache/pivotCacheRecords{}.xml",
        idx
    ))) {
        idx += 1;
    }
    idx
}

fn next_available_table_idx(start: usize, reserved_paths: &HashSet<String>) -> usize {
    let mut idx = start;
    while reserved_paths.contains(&normalize_part_path(&format!(
        "xl/pivotTables/pivotTable{}.xml",
        idx
    ))) {
        idx += 1;
    }
    idx
}

/// Read the header row (first row of source range) to get field names.
///
/// Used when `config.fields` is empty (API-created pivots) to auto-derive
/// field metadata from the source data.
fn read_source_header_names(
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

    // Build a quick lookup for the header row cells.
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
    // Fill in any gaps with default names.
    for (i, name) in names.iter_mut().enumerate() {
        if name.is_empty() {
            *name = format!("Column{}", i + 1);
        }
    }
    names
}

/// Convert a `ParsedPivotTable` into the legacy `PivotTableDef` that the writer expects.
///
/// This bridges the gap until the writer is updated to consume `PivotTableConfig` directly
///. For now, we reconstruct the OOXML-oriented definition.
fn parsed_pivot_to_def(pt: &ParsedPivotTable) -> domain_types::PivotTableDef {
    use domain_types::domain::pivot::*;

    let config = &pt.config;
    let engine_config = match pivot_types::PivotEngineConfig::try_from(config.clone()) {
        Ok(config) => config,
        Err(_) => return domain_types::PivotTableDef::default(),
    };

    // Build PivotFieldDef for each field
    let fields: Vec<PivotFieldDef> = config
        .fields
        .iter()
        .map(|field| {
            // Determine axis from placements
            let axis = engine_config
                .placements
                .iter()
                .find(|p| p.field_id().as_str() == field.id.as_str())
                .and_then(|p| match p {
                    pivot_types::PivotFieldPlacement::Row(_) => Some(PivotAxis::Row),
                    pivot_types::PivotFieldPlacement::Column(_) => Some(PivotAxis::Col),
                    pivot_types::PivotFieldPlacement::Filter(_) => Some(PivotAxis::Page),
                    pivot_types::PivotFieldPlacement::Value(_) => None,
                    _ => None,
                });

            let is_data_field = engine_config.placements.iter().any(|p| {
                p.field_id().as_str() == field.id.as_str()
                    && matches!(p, pivot_types::PivotFieldPlacement::Value(_))
            });

            let (compact, outline) = config
                .layout
                .as_ref()
                .and_then(|l| l.layout_form.as_ref())
                .map(|form| match form {
                    pivot_types::LayoutForm::Compact => (true, true),
                    pivot_types::LayoutForm::Outline => (false, true),
                    pivot_types::LayoutForm::Tabular => (false, false),
                    _ => (true, true),
                })
                .unwrap_or((true, true));

            // Read OOXML round-trip attributes directly off the field
            // (typed OOXML preservation: formerly on `PivotOoxmlPreserved.field_settings`).
            PivotFieldDef {
                name: Some(field.name.clone()),
                axis,
                data_field: is_data_field,
                compact,
                outline,
                show_all: field.show_all.unwrap_or(false),
                sort_type: None,
                auto_sort_data_field: None,
                subtotal_top: field.subtotal_top.unwrap_or(true),
                default_subtotal: field.default_subtotal.unwrap_or(axis.is_some()),
                subtotals: field.subtotals.clone(),
                items: field.items.clone(),
            }
        })
        .collect();

    // Build row_fields indices
    let row_fields: Vec<i32> = engine_config
        .row_placements()
        .iter()
        .filter_map(|p| {
            engine_config
                .fields
                .iter()
                .position(|f| f.id.as_str() == p.field_id().as_str())
                .map(|i| i as i32)
        })
        .collect();

    let col_fields: Vec<i32> = engine_config
        .column_placements()
        .iter()
        .filter_map(|p| {
            engine_config
                .fields
                .iter()
                .position(|f| f.id.as_str() == p.field_id().as_str())
                .map(|i| i as i32)
        })
        .collect();

    let mut col_fields = col_fields;
    let mut row_fields = row_fields;
    let data_on_rows = engine_config.value_placements().len() > 1 && col_fields.is_empty();
    if engine_config.value_placements().len() > 1 {
        if data_on_rows {
            row_fields.push(-2);
        } else {
            col_fields.push(-2);
        }
    }

    // Build page_fields
    let page_fields: Vec<PivotPageFieldDef> = engine_config
        .get_placements_for_area(pivot_types::PivotFieldArea::Filter)
        .iter()
        .filter_map(|p| {
            engine_config
                .fields
                .iter()
                .position(|f| f.id.as_str() == p.field_id().as_str())
                .map(|i| PivotPageFieldDef {
                    field_index: i as i32,
                    item: None,
                    hierarchy: None,
                    name: None,
                    caption: None,
                })
        })
        .collect();

    // Build data_fields — source num_fmt_id / base_field / base_item from the
    // field itself (typed OOXML preservation: these live on PivotField directly).
    let data_fields: Vec<PivotDataFieldDef> = engine_config
        .value_placements()
        .iter()
        .filter_map(|p| {
            let field_idx = engine_config
                .fields
                .iter()
                .position(|f| f.id.as_str() == p.field_id().as_str())?;
            let agg = p
                .aggregate_function()
                .unwrap_or(pivot_types::AggregateFunction::Sum);
            let func = map_agg_function(agg);
            let field = &config.fields[field_idx];
            let field_name = &field.name;
            let name = p
                .display_name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("{} of {}", func_label(&func), field_name));
            Some(PivotDataFieldDef {
                name,
                field_index: field_idx as u32,
                function: func,
                num_fmt_id: field.num_fmt_id,
                base_field: field.base_field,
                base_item: field.base_item,
            })
        })
        .collect();

    // Layout properties
    let layout = config.layout.as_ref();
    let row_grand_totals = layout.and_then(|l| l.show_row_grand_totals).unwrap_or(true);
    let col_grand_totals = layout
        .and_then(|l| l.show_column_grand_totals)
        .unwrap_or(true);
    let data_caption = layout
        .and_then(|l| l.data_caption.clone())
        .unwrap_or_else(|| "Values".to_string());

    // OOXML location — prefer the round-tripped attributes on the config,
    // fall back to derived values for API-created pivots (typed OOXML preservation).
    let start_row = config.output_location.row;
    let start_col = config.output_location.col;
    let num_row_fields = row_fields.len() as u32;
    let num_data_fields = data_fields.len().max(1) as u32;
    let location_str = config.ref_range.clone().unwrap_or_else(|| {
        let est_rows = 3u32;
        let est_cols = num_row_fields + num_data_fields;
        format!(
            "{}{}:{}{}",
            col_to_letters(start_col),
            start_row + 1,
            col_to_letters(start_col + est_cols.saturating_sub(1)),
            start_row + est_rows,
        )
    });

    let first_header_row = 1;
    let first_data_row = config
        .first_data_row
        .unwrap_or(if col_fields.is_empty() { 1 } else { 2 });
    let first_data_col = config
        .first_data_col
        .unwrap_or_else(|| num_row_fields.max(1));

    // Style
    let style = config.style.as_ref().map(|s| PivotStyleDef {
        name: s
            .style_name
            .clone()
            .unwrap_or_else(|| "PivotStyleLight16".to_string()),
        show_row_headers: true,
        show_col_headers: true,
        show_row_stripes: s.show_row_stripes.unwrap_or(false),
        show_col_stripes: s.show_column_stripes.unwrap_or(false),
        show_last_column: true,
    });

    // Use OOXML row/col items folded onto the config (typed OOXML preservation).
    let row_items = config.row_items.clone();
    let col_items = config.col_items.clone();

    PivotTableDef {
        data_on_rows,
        data_caption,
        location: PivotLocationDef {
            ref_range: location_str,
            first_header_row,
            first_data_row,
            first_data_col,
            rows_per_page: None,
            cols_per_page: None,
        },
        fields,
        row_fields,
        col_fields,
        page_fields,
        data_fields,
        row_items,
        col_items,
        style,
        grand_total_caption: layout.and_then(|l| l.grand_total_caption.clone()),
        row_header_caption: layout.and_then(|l| l.row_header_caption.clone()),
        col_header_caption: layout.and_then(|l| l.col_header_caption.clone()),
        row_grand_totals,
        col_grand_totals,
        grid_drop_zones: layout.and_then(|l| l.grid_drop_zones).unwrap_or(false),
        error_caption: layout.and_then(|l| l.error_caption.clone()),
        show_error: layout.and_then(|l| l.show_error).unwrap_or(false),
        missing_caption: layout.and_then(|l| l.missing_caption.clone()),
        show_missing: layout.and_then(|l| l.show_missing).unwrap_or(true),
    }
}

/// Map `pivot_types::AggregateFunction` → `domain_types::PivotFieldFunction`.
fn map_agg_function(
    agg: pivot_types::AggregateFunction,
) -> domain_types::domain::pivot::PivotFieldFunction {
    use domain_types::domain::pivot::PivotFieldFunction;
    match agg {
        pivot_types::AggregateFunction::Sum => PivotFieldFunction::Sum,
        pivot_types::AggregateFunction::Count
        | pivot_types::AggregateFunction::CountA
        | pivot_types::AggregateFunction::CountUnique => PivotFieldFunction::Count,
        pivot_types::AggregateFunction::Average => PivotFieldFunction::Average,
        pivot_types::AggregateFunction::Max => PivotFieldFunction::Max,
        pivot_types::AggregateFunction::Min => PivotFieldFunction::Min,
        pivot_types::AggregateFunction::Product => PivotFieldFunction::Product,
        pivot_types::AggregateFunction::StdDev => PivotFieldFunction::StdDev,
        pivot_types::AggregateFunction::StdDevP => PivotFieldFunction::StdDevP,
        pivot_types::AggregateFunction::Var => PivotFieldFunction::Var,
        pivot_types::AggregateFunction::VarP => PivotFieldFunction::VarP,
        _ => PivotFieldFunction::Sum,
    }
}

/// Human-readable label for a PivotFieldFunction.
fn func_label(func: &domain_types::domain::pivot::PivotFieldFunction) -> &'static str {
    use domain_types::domain::pivot::PivotFieldFunction;
    match func {
        PivotFieldFunction::Sum => "Sum",
        PivotFieldFunction::Count => "Count",
        PivotFieldFunction::Average => "Average",
        PivotFieldFunction::Max => "Max",
        PivotFieldFunction::Min => "Min",
        PivotFieldFunction::Product => "Product",
        PivotFieldFunction::CountNums => "Count",
        PivotFieldFunction::StdDev => "StdDev",
        PivotFieldFunction::StdDevP => "StdDevP",
        PivotFieldFunction::Var => "Var",
        PivotFieldFunction::VarP => "VarP",
    }
}

/// Convert column index (0-based) to Excel column letters.
fn col_to_letters(col: u32) -> String {
    let mut s = String::new();
    let mut c = col;
    loop {
        s.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }
    s
}

/// Build pivot cache definition + records XML by reading source range cells.
fn build_cache_from_source(
    cache_src: &PivotCacheSourceDef,
    sheets: &[SheetData],
    sheet_name_to_idx: &HashMap<&str, usize>,
) -> (Vec<u8>, Vec<u8>) {
    let mut cache_writer = PivotCacheWriter::new(cache_src.cache_id);

    // Set source reference.
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

        // Try to read source data from the sheet.
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

    // Fallback: use field names from cache source metadata, empty records.
    for field_name in &cache_src.field_names {
        cache_writer.add_field(CacheFieldDef::new(field_name));
    }
    cache_writer.set_record_count(0);
    let definition_xml = cache_writer.to_definition_xml();
    let records_xml = cache_writer.to_records_xml(&[]);
    (definition_xml, records_xml)
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

    // Build a (row, col) → CellValue lookup for the source range.
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

    // First row = header (field names).
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

    // Data rows = everything after header.
    let data_start = header_row + 1;
    let data_end = end_row;

    // Per-field: collect unique values (shared items) and build index maps.
    let mut field_shared_items: Vec<Vec<SharedItem>> = vec![Vec::new(); num_cols];
    let mut field_value_indices: Vec<HashMap<String, u32>> = vec![HashMap::new(); num_cols];

    // Records: each row → Vec<SharedItem> (using Index references for strings).
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

    // Build CacheFieldDefs with shared items.
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

/// Parse a range reference like "A1:D100" or "$A$1:$D$100" into (start_row, start_col, end_row, end_col).
/// Returns 0-based row/col indices.
fn parse_range(range_ref: &str) -> Option<(u32, u32, u32, u32)> {
    let range = range_ref.replace('$', "");
    let parts: Vec<&str> = range.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let (start_col, start_row) = parse_cell_ref(parts[0])?;
    let (end_col, end_row) = parse_cell_ref(parts[1])?;
    Some((start_row, start_col, end_row, end_col))
}

/// Parse a cell reference like "A1" into (col_0based, row_0based).
fn parse_cell_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let bytes = cell_ref.as_bytes();
    let mut col: u32 = 0;
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        col = col * 26 + (bytes[i].to_ascii_uppercase() - b'A') as u32 + 1;
        i += 1;
    }
    if col == 0 || i >= bytes.len() {
        return None;
    }
    let row: u32 = cell_ref[i..].parse().ok()?;
    Some((col - 1, row - 1)) // Convert to 0-based
}

/// Build the `<pivotCaches>` XML fragment for workbook.xml.
pub fn build_pivot_caches_xml(cache_entries: &[(u32, String)]) -> String {
    if cache_entries.is_empty() {
        return String::new();
    }
    let mut xml = "<pivotCaches>".to_string();
    for (cache_id, r_id) in cache_entries {
        xml.push_str(&format!(
            "<pivotCache cacheId=\"{}\" r:id=\"{}\"/>",
            cache_id, r_id,
        ));
    }
    xml.push_str("</pivotCaches>");
    xml
}

/// Build a rels file for a pivot cache definition → records relationship.
pub fn build_pivot_cache_rels_xml(records_path: &str) -> Vec<u8> {
    use crate::write::relationships::RelationshipManager;
    let mut rels = RelationshipManager::new();
    rels.add(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords",
        records_path,
    );
    rels.to_xml()
}
