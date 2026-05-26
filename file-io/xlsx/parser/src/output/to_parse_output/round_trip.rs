//! Round-trip context, diagnostics, theme conversion, and named ranges.

use domain_types::{
    BlobPart, NamedRange, OpcRelationship as DtOpcRelationship, ParseDiagnostics,
    ParseError as DtParseError, ParseStats as DtParseStats, PivotCacheDefinitionPackage,
    PivotCacheSourceKind, PivotOrphanPackagePart, PivotPackageContentType, PivotPackageOwnership,
    PivotPackageRoundTrip, PivotTablePackage, PivotWorkbookCacheEntry, RoundTripContext,
    SheetRoundTripContext, ThemeColor, ThemeColorSource, ThemeData,
};
use std::collections::HashSet;

use crate::output::results::FullParseResult;

use super::normalize_rgb_color;

// =============================================================================
// SST helpers
// =============================================================================

/// Parse the `count` attribute from the `<sst>` element in raw SST XML.
fn parse_sst_count(xml: &[u8]) -> Option<usize> {
    // Find <sst element
    let sst_pos = xml.windows(4).position(|w| w == b"<sst")?;
    let sst_end_offset = xml[sst_pos..].iter().position(|&b| b == b'>')?;
    let sst_tag = &xml[sst_pos..sst_pos + sst_end_offset];

    // Find count=" (but not uniqueCount=")
    // We need to match ` count="` or the start of tag `count="`
    let mut search_pos = 0;
    loop {
        let attr_name = b"count=\"";
        let offset = sst_tag[search_pos..]
            .windows(attr_name.len())
            .position(|w| w == attr_name)?;
        let abs_pos = search_pos + offset;
        // Make sure it's not "uniqueCount" — check the character before
        if abs_pos == 0 || !sst_tag[abs_pos - 1].is_ascii_alphanumeric() {
            let value_start = abs_pos + attr_name.len();
            let value_end = value_start + sst_tag[value_start..].iter().position(|&b| b == b'"')?;
            let value_str = std::str::from_utf8(&sst_tag[value_start..value_end]).ok()?;
            return value_str.parse().ok();
        }
        search_pos = abs_pos + 1;
    }
}

// =============================================================================
// Chart .rels conversion
// =============================================================================

// =============================================================================
// Named ranges
// =============================================================================

pub(super) fn convert_named_ranges(result: &FullParseResult) -> Vec<NamedRange> {
    result
        .defined_names
        .iter()
        .map(|dn| NamedRange {
            name: dn.name.clone(),
            refers_to: dn.refers_to.clone(),
            local_sheet_id: dn.local_sheet_id,
            hidden: dn.hidden,
            comment: dn.comment.clone(),
            custom_menu: dn.custom_menu.clone(),
            description: dn.description.clone(),
            help: dn.help.clone(),
            status_bar: dn.status_bar.clone(),
            xlm: dn.xlm,
            function: dn.function,
            vb_procedure: dn.vb_procedure,
            publish_to_server: dn.publish_to_server,
            workbook_parameter: dn.workbook_parameter,
            xml_space_preserve: dn.xml_space_preserve,
        })
        .collect()
}

// =============================================================================
// Theme
// =============================================================================

pub(super) fn convert_theme(result: &FullParseResult) -> Option<ThemeData> {
    // We need at least one typed theme field to produce ThemeData.
    let has_colors = result.theme_color_scheme.is_some();
    let has_fonts = result.theme_font_scheme.is_some();
    let has_name = result.theme_name.is_some();

    if !has_colors && !has_fonts && !has_name {
        return None;
    }

    // ECMA-376 color scheme index order (matches get_by_index).
    let color_slot_names: &[(u8, &str)] = &[
        (0, "dk1"),
        (1, "lt1"),
        (2, "dk2"),
        (3, "lt2"),
        (4, "accent1"),
        (5, "accent2"),
        (6, "accent3"),
        (7, "accent4"),
        (8, "accent5"),
        (9, "accent6"),
        (10, "hlink"),
        (11, "folHlink"),
    ];

    let colors = if let Some(cs) = result.theme_color_scheme.as_ref() {
        color_slot_names
            .iter()
            .filter_map(|&(idx, name)| {
                let hex = cs.resolve_hex(idx)?;
                let color = normalize_rgb_color(&hex);

                // Check for sysClr source info for round-trip fidelity.
                let source = cs.get_by_index(idx).and_then(|dc| {
                    use ooxml_types::drawings::DrawingColor;
                    match dc {
                        DrawingColor::SysClr { val, last_clr, .. } => {
                            Some(ThemeColorSource::SysClr {
                                val: val.to_ooxml().to_string(),
                                last_clr: last_clr.clone().unwrap_or_default(),
                            })
                        }
                        _ => None, // srgbClr is the default — omit source
                    }
                });

                Some(ThemeColor {
                    name: name.to_string(),
                    color,
                    source,
                })
            })
            .collect()
    } else {
        Vec::new()
    };

    let major_font = result
        .theme_font_scheme
        .as_ref()
        .map(|fs| fs.major_font.latin.typeface.clone());
    let minor_font = result
        .theme_font_scheme
        .as_ref()
        .map(|fs| fs.minor_font.latin.typeface.clone());

    let name = result.theme_name.clone();

    Some(ThemeData {
        colors,
        major_font,
        minor_font,
        name,
    })
}

// =============================================================================
// Round-trip context
// =============================================================================

fn normalize_part_path(path: &str) -> String {
    path.trim_start_matches('/').to_string()
}

fn content_type_part_name(path: &str) -> String {
    format!("/{}", normalize_part_path(path))
}

fn is_pivot_package_path(path: &str) -> bool {
    let path = normalize_part_path(path);
    path.starts_with("xl/pivotTables/") || path.starts_with("xl/pivotCache/")
}

fn pivot_blob<'a>(blobs: &'a [(String, Vec<u8>)], path: &str) -> Option<&'a Vec<u8>> {
    let normalized = normalize_part_path(path);
    blobs
        .iter()
        .find(|(blob_path, _)| normalize_part_path(blob_path) == normalized)
        .map(|(_, data)| data)
}

fn content_type_for_path(result: &FullParseResult, path: &str) -> Option<String> {
    let part_name = content_type_part_name(path);
    result
        .content_type_overrides
        .iter()
        .find(|(name, _)| *name == part_name)
        .map(|(_, content_type)| content_type.clone())
}

fn cache_definition_rels_path(definition_path: &str) -> String {
    let cache_dir = definition_path
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or("xl/pivotCache");
    let cache_filename = definition_path.rsplit('/').next().unwrap_or("");
    format!("{}/_rels/{}.rels", cache_dir, cache_filename)
}

fn pivot_table_rels_path(table_path: &str) -> String {
    let table_dir = table_path
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or("xl/pivotTables");
    let table_filename = table_path.rsplit('/').next().unwrap_or("");
    format!("{}/_rels/{}.rels", table_dir, table_filename)
}

fn resolve_workbook_rel_path(rel_path: &str) -> String {
    if rel_path.starts_with('/') {
        rel_path.trim_start_matches('/').to_string()
    } else {
        format!("xl/{}", rel_path)
    }
}

fn resolve_cache_rel_path(cache_definition_path: &str, rel_path: &str) -> String {
    if rel_path.starts_with('/') {
        rel_path.trim_start_matches('/').to_string()
    } else if rel_path.starts_with("xl/") {
        rel_path.to_string()
    } else {
        let cache_dir = cache_definition_path
            .rsplit_once('/')
            .map(|(dir, _)| dir)
            .unwrap_or("xl/pivotCache");
        format!("{}/{}", cache_dir, rel_path)
    }
}

fn resolve_sheet_rel_path(rel_path: &str) -> String {
    if rel_path.starts_with('/') {
        rel_path.trim_start_matches('/').to_string()
    } else if let Some(stripped) = rel_path.strip_prefix("../") {
        format!("xl/{}", stripped)
    } else {
        format!("xl/worksheets/{}", rel_path)
    }
}

fn to_dt_rels(rels_xml: &[u8]) -> Vec<DtOpcRelationship> {
    crate::domain::workbook::read::parse_all_rels(rels_xml)
        .into_iter()
        .map(|r| DtOpcRelationship {
            id: r.id,
            rel_type: r.rel_type,
            target: r.target,
            target_mode: r.target_mode,
        })
        .collect()
}

fn pivot_source_kind(kind: ooxml_types::pivot::PivotSourceType) -> PivotCacheSourceKind {
    match kind {
        ooxml_types::pivot::PivotSourceType::Worksheet => PivotCacheSourceKind::Worksheet,
        ooxml_types::pivot::PivotSourceType::External => PivotCacheSourceKind::External,
        ooxml_types::pivot::PivotSourceType::Consolidation => PivotCacheSourceKind::Consolidation,
        ooxml_types::pivot::PivotSourceType::Scenario => PivotCacheSourceKind::Scenario,
    }
}

fn build_pivot_package_round_trip(result: &FullParseResult) -> PivotPackageRoundTrip {
    let pivot_blobs: Vec<(String, Vec<u8>)> = result
        .extensions
        .as_ref()
        .map(|ext| {
            ext.binary_passthrough
                .entries()
                .iter()
                .filter(|(path, _)| is_pivot_package_path(path))
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    if pivot_blobs.is_empty()
        && result.pivot_cache_paths.is_empty()
        && result
            .workbook_relationships
            .iter()
            .all(|rel| !rel.rel_type.ends_with("/pivotCacheDefinition"))
    {
        return PivotPackageRoundTrip::default();
    }

    let mut claimed_paths: HashSet<String> = HashSet::new();
    let mut workbook_cache_entries = Vec::new();
    let mut cache_definitions = Vec::new();

    for (order, (cache_id, definition_path, records_path)) in
        result.pivot_cache_paths.iter().enumerate()
    {
        let definition_path = normalize_part_path(definition_path);
        let workbook_rel = result.workbook_relationships.iter().find(|rel| {
            rel.rel_type.ends_with("/pivotCacheDefinition")
                && resolve_workbook_rel_path(&rel.target) == definition_path
        });

        if let Some(rel) = workbook_rel {
            workbook_cache_entries.push(PivotWorkbookCacheEntry {
                cache_id: *cache_id,
                relationship_id: rel.id.clone(),
                relationship_target: rel.target.clone(),
                definition_path: definition_path.clone(),
                order,
                ownership: PivotPackageOwnership::CleanImported,
            });
        }

        claimed_paths.insert(definition_path.clone());

        let definition_rels_path = cache_definition_rels_path(&definition_path);
        let raw_relationships = pivot_blob(&pivot_blobs, &definition_rels_path)
            .map(|bytes| {
                claimed_paths.insert(definition_rels_path.clone());
                to_dt_rels(bytes)
            })
            .unwrap_or_default();

        let records_relationship = raw_relationships.iter().find(|rel| {
            rel.rel_type.ends_with("/pivotCacheRecords") || rel.target.contains("pivotCacheRecords")
        });
        let records_relationship_id = records_relationship.map(|rel| rel.id.clone());
        let records_relationship_target = records_relationship.map(|rel| rel.target.clone());
        let records_path = records_path
            .as_ref()
            .map(|path| normalize_part_path(path))
            .or_else(|| {
                records_relationship
                    .map(|rel| resolve_cache_rel_path(&definition_path, &rel.target))
            });
        if let Some(path) = &records_path {
            claimed_paths.insert(path.clone());
        }

        if let Some(parsed_cache) = result.pivot_caches.get(cache_id) {
            let raw_definition_xml = parsed_cache
                .raw_definition_xml
                .clone()
                .or_else(|| pivot_blob(&pivot_blobs, &definition_path).cloned())
                .unwrap_or_default();
            let raw_records_xml = parsed_cache.raw_records_xml.clone().or_else(|| {
                records_path
                    .as_ref()
                    .and_then(|path| pivot_blob(&pivot_blobs, path).cloned())
            });

            cache_definitions.push(PivotCacheDefinitionPackage {
                cache_id: *cache_id,
                definition_path,
                definition_rels_path: if raw_relationships.is_empty() {
                    None
                } else {
                    Some(definition_rels_path)
                },
                source_kind: pivot_source_kind(parsed_cache.definition.cache_source.r#type),
                raw_definition_xml,
                raw_relationships,
                records_relationship_id,
                records_relationship_target,
                records_path,
                raw_records_xml,
                ownership: PivotPackageOwnership::CleanImported,
            });
        }
    }

    let mut pivot_tables = Vec::new();
    let mut table_order = 0usize;
    for (sheet_index, sheet) in result.sheets.iter().enumerate() {
        for rel in sheet
            .sheet_opc_rels
            .iter()
            .filter(|rel| rel.rel_type.ends_with("/pivotTable"))
        {
            let table_path = resolve_sheet_rel_path(&rel.target);
            let Some(raw_table_xml) = pivot_blob(&pivot_blobs, &table_path).cloned() else {
                continue;
            };
            claimed_paths.insert(table_path.clone());

            let parsed_table = crate::domain::pivot::read::parse_pivot_table(&raw_table_xml);
            let table_rels_path = pivot_table_rels_path(&table_path);
            let raw_relationships = pivot_blob(&pivot_blobs, &table_rels_path)
                .map(|bytes| {
                    claimed_paths.insert(table_rels_path.clone());
                    to_dt_rels(bytes)
                })
                .unwrap_or_default();

            pivot_tables.push(PivotTablePackage {
                sheet_index,
                sheet_name: sheet.name.clone(),
                sheet_relationship_id: rel.id.clone(),
                sheet_relationship_target: rel.target.clone(),
                table_path,
                table_rels_path: if raw_relationships.is_empty() {
                    None
                } else {
                    Some(table_rels_path)
                },
                pivot_name: if parsed_table.name.is_empty() {
                    None
                } else {
                    Some(parsed_table.name)
                },
                raw_table_xml,
                raw_relationships,
                referenced_cache_id: parsed_table.cache_id,
                order: table_order,
                ownership: PivotPackageOwnership::CleanImported,
            });
            table_order += 1;
        }
    }

    let content_type_overrides: Vec<PivotPackageContentType> = result
        .content_type_overrides
        .iter()
        .filter(|(part_name, _)| is_pivot_package_path(part_name))
        .map(|(part_name, content_type)| PivotPackageContentType {
            part_name: part_name.clone(),
            content_type: content_type.clone(),
            ownership: PivotPackageOwnership::CleanImported,
        })
        .collect();

    let orphan_parts = pivot_blobs
        .iter()
        .filter(|(path, _)| !claimed_paths.contains(&normalize_part_path(path)))
        .map(|(path, data)| PivotOrphanPackagePart {
            part: BlobPart {
                path: path.clone(),
                data: data.clone(),
            },
            content_type: content_type_for_path(result, path),
            ownership: PivotPackageOwnership::CleanImported,
        })
        .collect();

    PivotPackageRoundTrip {
        workbook_cache_entries,
        cache_definitions,
        pivot_tables,
        content_type_overrides,
        orphan_parts,
    }
}

pub(super) fn build_round_trip_context(
    result: &FullParseResult,
    sheet_contexts: Vec<SheetRoundTripContext>,
) -> RoundTripContext {
    let workbook_views = result
        .workbook_views
        .iter()
        .cloned()
        .map(domain_types::domain::workbook::WorkbookView::from)
        .collect();

    RoundTripContext {
        sheets: sheet_contexts,
        content_type_defaults: result.content_type_defaults.clone(),
        content_type_overrides: result.content_type_overrides.clone(),
        root_relationships: result
            .root_relationships
            .iter()
            .map(|r| DtOpcRelationship {
                id: r.id.clone(),
                rel_type: r.rel_type.clone(),
                target: r.target.clone(),
                target_mode: r.target_mode.clone(),
            })
            .collect(),
        workbook_relationships: result
            .workbook_relationships
            .iter()
            .map(|r| DtOpcRelationship {
                id: r.id.clone(),
                rel_type: r.rel_type.clone(),
                target: r.target.clone(),
                target_mode: r.target_mode.clone(),
            })
            .collect(),
        sheet_workbook_r_ids: result.sheet_workbook_r_ids.clone(),
        parsed_stylesheet: result.parsed_stylesheet.clone(),
        styles_ext_lst_xml: result.styles_ext_lst_xml.clone(),
        styles_namespace_attrs: result
            .extensions
            .as_ref()
            .map(|ext| {
                ext.styles_namespaces
                    .all()
                    .iter()
                    .map(|decl| {
                        let prefix = decl.prefix.clone().unwrap_or_default();
                        (prefix, decl.uri.clone())
                    })
                    .collect()
            })
            .unwrap_or_default(),
        original_sst_count: result
            .raw_shared_strings_xml
            .as_ref()
            .and_then(|xml| parse_sst_count(xml)),
        shared_strings_list: result.shared_strings.clone(),
        shared_strings_rich_runs: result.shared_strings_rich_runs.clone(),
        shared_strings_phonetic_xml: result.shared_strings_phonetic_xml.clone(),
        raw_shared_strings_xml: result.raw_shared_strings_xml.clone(),
        raw_doc_props_core_xml: result.raw_doc_props_core_xml.clone(),
        raw_doc_props_app_xml: result.raw_doc_props_app_xml.clone(),
        raw_doc_props_custom_xml: result.raw_doc_props_custom_xml.clone(),
        raw_metadata_xml: result.raw_metadata_xml.clone(),
        raw_persons_xml: result.raw_persons_xml.clone(),
        external_links: result.external_links.clone(),
        custom_xml_parts: result
            .custom_xml_parts
            .iter()
            .map(|(path, data)| BlobPart {
                path: path.clone(),
                data: data.clone(),
            })
            .collect(),
        web_extension_parts: result
            .extensions
            .as_ref()
            .map(|ext| {
                ext.binary_passthrough
                    .entries()
                    .iter()
                    .filter(|(path, _)| path.starts_with("xl/webextensions/"))
                    .map(|(path, data)| BlobPart {
                        path: path.clone(),
                        data: data.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        binary_blobs: result
            .extensions
            .as_ref()
            .map(|ext| {
                ext.binary_passthrough
                    .entries()
                    .iter()
                    .filter(|(path, _)| !path.starts_with("xl/webextensions/"))
                    .map(|(path, data)| BlobPart {
                        path: path.clone(),
                        data: data.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        pivot_package: build_pivot_package_round_trip(result),
        workbook_views,
        extensions: None, // Not serializable — use workbook_namespace_attrs + workbook_preserved_elements instead

        // Workbook-level namespace + preserved element preservation
        workbook_namespace_attrs: result
            .extensions
            .as_ref()
            .map(|ext| {
                ext.workbook_namespaces
                    .all()
                    .iter()
                    .map(|decl| {
                        let prefix = decl.prefix.clone().unwrap_or_default();
                        (prefix, decl.uri.clone())
                    })
                    .collect()
            })
            .unwrap_or_default(),
        workbook_preserved_elements: result
            .extensions
            .as_ref()
            .map(|ext| ext.workbook_preserved.to_position_pairs())
            .unwrap_or_default(),

        // Theme preservation — pass through the full parsed theme components
        // so the writer can reconstruct theme1.xml losslessly.
        theme_name: result.theme_name.clone(),
        theme_color_scheme: result.theme_color_scheme.clone(),
        theme_font_scheme: result.theme_font_scheme.clone(),
        theme_format_scheme: result.theme_format_scheme.clone(),
        theme_object_defaults_xml: result.theme_object_defaults_xml.clone(),
        theme_extra_clr_scheme_lst_xml: result.theme_extra_clr_scheme_lst_xml.clone(),
        theme_ext_lst_xml: result.theme_ext_lst_xml.clone(),
        doc_metadata_label_info: result.raw_doc_metadata_label_info.clone(),
        calc_id: result.calc_id,
        skipped_named_ranges: vec![], // populated later by compute-core during import
        original_named_ranges_order: vec![], // populated later by compute-core during import
        iterative_calc_settings: Some({
            let mut cp = domain_types::domain::workbook::CalculationProperties {
                iterate: result.iterative_calc,
                iterate_count: result.max_iterations.unwrap_or(100),
                iterate_delta: result.max_change.unwrap_or(0.001),
                calc_id: result.calc_id,
                has_explicit_iterate_count: result.max_iterations.is_some(),
                has_explicit_iterate_delta: result.max_change.is_some(),
                ..Default::default()
            };
            if let Some(ref cps) = result.calc_pr_settings {
                cp.full_precision = cps.full_precision.unwrap_or(true);
                cp.calc_completed = cps.calc_completed.unwrap_or(true);
                cp.calc_on_save = cps.calc_on_save.unwrap_or(true);
                cp.concurrent_calc = cps.concurrent_calc.unwrap_or(true);
                cp.concurrent_manual_count = cps.concurrent_manual_count;
                cp.force_full_calc = cps.force_full_calc.unwrap_or(false);
                cp.calc_mode = match cps.calc_mode.as_deref() {
                    Some("manual") => domain_types::domain::workbook::CalcMode::Manual,
                    Some("autoNoTable") => domain_types::domain::workbook::CalcMode::AutoNoTable,
                    _ => domain_types::domain::workbook::CalcMode::Auto,
                };
            }
            cp
        }),
    }
}

// =============================================================================
// Diagnostics
// =============================================================================

pub(super) fn build_diagnostics(result: &FullParseResult) -> ParseDiagnostics {
    let errors: Vec<DtParseError> = result
        .errors
        .iter()
        .map(|e| DtParseError {
            code: e.code,
            severity: e.severity.clone(),
            message: e.message.clone(),
            part: e.part.clone(),
            row: e.row,
            col: e.col,
        })
        .collect();

    let stats = DtParseStats {
        total_cells: result.stats.total_cells,
        total_sheets: result.stats.total_sheets,
        parse_time_us: result.stats.parse_time_us as u64,
    };

    // Collect force-recalc cells across all sheets, preserving sheet identity.
    let mut force_recalc_cells = std::collections::HashSet::new();
    for (sheet_idx, sheet) in result.sheets.iter().enumerate() {
        for cell in &sheet.cells {
            if cell.force_recalc {
                force_recalc_cells.insert((sheet_idx as u32, cell.row, cell.col));
            }
        }
    }

    ParseDiagnostics {
        errors,
        stats,
        force_recalc_cells,
        import_report: None,
    }
}
