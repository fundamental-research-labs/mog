//! Round-trip context, diagnostics, theme conversion, and named ranges.

use domain_types::{
    BlobPart, NamedRange, OpaquePackageOwner, OpaquePackageOwnership, OpaquePackagePart,
    OpaquePackageRelationship, OpaquePackageSubgraph, OpaqueRelationshipTarget,
    OpcRelationship as DtOpcRelationship, ParseDiagnostics, ParseError as DtParseError,
    ParseStats as DtParseStats, PivotCacheDefinitionPackage, PivotCacheSourceKind,
    PivotOrphanPackagePart, PivotPackageContentType, PivotPackageOwnership, PivotPackageRoundTrip,
    PivotTablePackage, PivotWorkbookCacheEntry, RoundTripContext, SheetRoundTripContext,
    ThemeColor, ThemeColorSource, ThemeData,
};
use std::collections::{HashMap, HashSet};

use crate::infra::opc::{OoxmlRelationshipType, REL_VML_DRAWING, resolve_relationship_target};
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

fn relationship_type_is(rel_type: &str, expected: OoxmlRelationshipType) -> bool {
    OoxmlRelationshipType::from_uri(rel_type) == expected
}

fn resolve_internal_rel(owner_part: Option<&str>, target: &str) -> Option<String> {
    resolve_relationship_target(owner_part, target)
        .ok()
        .map(|path| normalize_part_path(&path))
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
        && result.workbook_relationships.iter().all(|rel| {
            !relationship_type_is(&rel.rel_type, OoxmlRelationshipType::PivotCacheDefinition)
        })
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
            relationship_type_is(&rel.rel_type, OoxmlRelationshipType::PivotCacheDefinition)
                && resolve_internal_rel(Some("xl/workbook.xml"), &rel.target).as_deref()
                    == Some(definition_path.as_str())
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
            relationship_type_is(&rel.rel_type, OoxmlRelationshipType::PivotCacheRecords)
        });
        let records_relationship_id = records_relationship.map(|rel| rel.id.clone());
        let records_relationship_target = records_relationship.map(|rel| rel.target.clone());
        let records_path = records_path
            .as_ref()
            .map(|path| normalize_part_path(path))
            .or_else(|| {
                records_relationship
                    .and_then(|rel| resolve_internal_rel(Some(&definition_path), &rel.target))
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
            .filter(|rel| relationship_type_is(&rel.rel_type, OoxmlRelationshipType::PivotTable))
        {
            let owner_part = format!("xl/worksheets/sheet{}.xml", sheet_index + 1);
            let Some(table_path) = resolve_internal_rel(Some(&owner_part), &rel.target) else {
                continue;
            };
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

fn build_opaque_package_subgraphs(
    custom_xml_parts: &[BlobPart],
    web_extension_parts: &[BlobPart],
    binary_blobs: &[BlobPart],
    content_type_overrides: &[(String, String)],
    sheet_contexts: &[SheetRoundTripContext],
    sheet_data: &[domain_types::SheetData],
    package_relationships: (
        &[ooxml_types::shared::OpcRelationship],
        &[ooxml_types::shared::OpcRelationship],
    ),
) -> Vec<OpaquePackageSubgraph> {
    let (root_relationships, workbook_relationships) = package_relationships;
    let mut subgraphs = Vec::new();
    subgraphs.extend(build_web_extension_opaque_subgraphs(
        web_extension_parts,
        root_relationships,
    ));
    subgraphs.extend(build_custom_xml_opaque_subgraphs(
        custom_xml_parts,
        workbook_relationships,
    ));
    subgraphs.extend(build_worksheet_drawing_opaque_subgraphs(
        binary_blobs,
        sheet_contexts,
        sheet_data,
    ));
    subgraphs.extend(build_header_footer_vml_opaque_subgraphs(
        binary_blobs,
        sheet_contexts,
        sheet_data,
    ));
    subgraphs.extend(build_worksheet_custom_property_opaque_subgraphs(
        binary_blobs,
        content_type_overrides,
        sheet_contexts,
    ));
    subgraphs.extend(build_worksheet_printer_settings_opaque_subgraphs(
        binary_blobs,
        sheet_contexts,
        sheet_data,
    ));
    subgraphs
}

const REL_WORKSHEET_CUSTOM_PROPERTY: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customProperty";
const CT_WORKSHEET_CUSTOM_PROPERTY: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.customProperty+xml";
const CT_VML_DRAWING: &str = "application/vnd.openxmlformats-officedocument.vmlDrawing";

fn build_header_footer_vml_opaque_subgraphs(
    binary_blobs: &[BlobPart],
    sheet_contexts: &[SheetRoundTripContext],
    sheet_data: &[domain_types::SheetData],
) -> Vec<OpaquePackageSubgraph> {
    let binary_blobs_by_path: HashMap<_, _> = binary_blobs
        .iter()
        .map(|part| (normalize_package_path(&part.path), part))
        .collect();
    let mut subgraphs = Vec::new();

    for (sheet_idx, sheet_rt) in sheet_contexts.iter().enumerate() {
        if sheet_data
            .get(sheet_idx)
            .is_none_or(|sheet| sheet.hf_images.is_empty())
        {
            continue;
        }
        let comment_vml_path = comment_vml_path(sheet_idx, sheet_rt);
        for vml_part in &sheet_rt.raw_vml_drawings {
            if comment_vml_path.as_deref() == Some(vml_part.path.as_str()) {
                continue;
            }
            let rels_path = vml_part.rels.as_ref().map(|rels| rels.path.as_str());
            let rels_data = vml_part.rels.as_ref().map(|rels| rels.data.as_slice());
            let Some(parsed) = crate::domain::print::hf_images::parse_hf_vml_context(
                &vml_part.path,
                &vml_part.data,
                rels_path,
                rels_data,
            ) else {
                continue;
            };

            let mut parts = vec![OpaquePackagePart {
                part: BlobPart {
                    path: normalize_package_path(&vml_part.path),
                    data: vml_part.data.clone(),
                },
                content_type: None,
                default_extension: Some(("vml".to_string(), CT_VML_DRAWING.to_string())),
                ownership: OpaquePackageOwnership::CleanImported,
            }];
            let mut relationships = Vec::new();
            for (relationship_id, target) in parsed.image_targets {
                let Some(target_path) = normalize_hf_image_target(&vml_part.path, &target) else {
                    continue;
                };
                let Some(blob) = binary_blobs_by_path.get(&target_path) else {
                    continue;
                };
                if !parts
                    .iter()
                    .any(|part| normalize_package_path(&part.part.path) == target_path)
                {
                    parts.push(binary_opaque_part(blob));
                }
                relationships.push(OpaquePackageRelationship {
                    owner: OpaquePackageOwner::Part {
                        path: normalize_package_path(&vml_part.path),
                    },
                    relationship_type:
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
                            .to_string(),
                    target: OpaqueRelationshipTarget::InternalPart { path: target_path },
                    relationship_id_hint: Some(relationship_id),
                });
            }

            subgraphs.push(OpaquePackageSubgraph {
                owner: OpaquePackageOwner::Part {
                    path: normalize_package_path(&vml_part.path),
                },
                owner_relationship: OpaquePackageRelationship {
                    owner: OpaquePackageOwner::Part {
                        path: normalize_package_path(&vml_part.path),
                    },
                    relationship_type: String::new(),
                    target: OpaqueRelationshipTarget::InternalPath {
                        target: String::new(),
                    },
                    relationship_id_hint: None,
                },
                parts,
                relationships,
                ownership: OpaquePackageOwnership::OrphanCleanPackageData,
            });
        }
    }

    subgraphs
        .into_iter()
        .filter(closed_opaque_subgraph)
        .collect()
}

fn comment_vml_path(sheet_idx: usize, sheet_rt: &SheetRoundTripContext) -> Option<String> {
    let legacy_drawing_r_id = sheet_rt.legacy_drawing_r_id.as_ref()?;
    let owner_path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
    sheet_rt
        .sheet_opc_rels
        .iter()
        .find(|rel| {
            &rel.id == legacy_drawing_r_id
                && rel.rel_type == REL_VML_DRAWING
                && rel.target_mode.as_deref() != Some("External")
        })
        .and_then(|rel| {
            crate::infra::opc::resolve_relationship_target(Some(&owner_path), &rel.target).ok()
        })
        .map(|path| normalize_package_path(&path))
}

fn normalize_hf_image_target(vml_path: &str, target: &str) -> Option<String> {
    if target.starts_with("data:") {
        return None;
    }
    if target.trim_start_matches('/').starts_with("xl/") {
        return Some(normalize_package_path(target));
    }
    crate::infra::opc::resolve_relationship_target(Some(vml_path), target)
        .ok()
        .map(|path| normalize_package_path(&path))
}

fn build_worksheet_custom_property_opaque_subgraphs(
    binary_blobs: &[BlobPart],
    content_type_overrides: &[(String, String)],
    sheet_contexts: &[SheetRoundTripContext],
) -> Vec<OpaquePackageSubgraph> {
    let binary_blobs_by_path: HashMap<_, _> = binary_blobs
        .iter()
        .map(|part| (normalize_package_path(&part.path), part))
        .collect();
    let clean_custom_property_paths: HashSet<_> = content_type_overrides
        .iter()
        .filter(|(_, content_type)| *content_type == CT_WORKSHEET_CUSTOM_PROPERTY)
        .map(|(path, _)| normalize_package_path(path))
        .collect();

    let mut subgraphs = Vec::new();
    for (sheet_idx, sheet_rt) in sheet_contexts.iter().enumerate() {
        let owner_path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
        let owner = OpaquePackageOwner::Worksheet {
            index: sheet_idx,
            path: owner_path.clone(),
        };
        let relationship_ids = sheet_rt
            .custom_properties_xml
            .as_deref()
            .map(custom_property_relationship_ids)
            .unwrap_or_default();
        for relationship_id in relationship_ids {
            let Some(rel) = sheet_rt.sheet_opc_rels.iter().find(|rel| {
                rel.id == relationship_id && rel.rel_type == REL_WORKSHEET_CUSTOM_PROPERTY
            }) else {
                continue;
            };
            if rel
                .target_mode
                .as_deref()
                .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
            {
                continue;
            }
            let Some(path) =
                crate::infra::opc::resolve_relationship_target(Some(&owner_path), &rel.target)
                    .ok()
                    .map(|path| normalize_package_path(&path))
            else {
                continue;
            };
            if !clean_custom_property_paths.contains(&path) {
                continue;
            }
            let Some(blob) = binary_blobs_by_path.get(&path) else {
                continue;
            };
            subgraphs.push(OpaquePackageSubgraph {
                owner: owner.clone(),
                owner_relationship: OpaquePackageRelationship {
                    owner: owner.clone(),
                    relationship_type: REL_WORKSHEET_CUSTOM_PROPERTY.to_string(),
                    target: OpaqueRelationshipTarget::InternalPart { path: path.clone() },
                    relationship_id_hint: Some(relationship_id),
                },
                parts: vec![OpaquePackagePart {
                    part: BlobPart {
                        path,
                        data: blob.data.clone(),
                    },
                    content_type: Some(CT_WORKSHEET_CUSTOM_PROPERTY.to_string()),
                    default_extension: None,
                    ownership: OpaquePackageOwnership::CleanImported,
                }],
                relationships: Vec::new(),
                ownership: OpaquePackageOwnership::CleanImported,
            });
        }
    }
    subgraphs
        .into_iter()
        .filter(closed_opaque_subgraph)
        .collect()
}

fn custom_property_relationship_ids(xml: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = xml.as_bytes();
    while let Some(pos) = find_subslice(rest, b"customPr") {
        rest = &rest[pos + b"customPr".len()..];
        let Some(tag_end) = memchr::memchr(b'>', rest) else {
            break;
        };
        let tag = &rest[..tag_end];
        if let Some(id) = crate::infra::xml::parse_string_attr(tag, b"r:id") {
            ids.push(id);
        }
        rest = &rest[tag_end..];
    }
    ids
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn build_worksheet_printer_settings_opaque_subgraphs(
    binary_blobs: &[BlobPart],
    sheet_contexts: &[SheetRoundTripContext],
    sheet_data: &[domain_types::SheetData],
) -> Vec<OpaquePackageSubgraph> {
    let binary_blobs_by_path: HashMap<_, _> = binary_blobs
        .iter()
        .map(|part| (normalize_package_path(&part.path), part))
        .collect();

    sheet_contexts
        .iter()
        .enumerate()
        .filter_map(|(sheet_idx, sheet_rt)| {
            let r_id = sheet_data
                .get(sheet_idx)?
                .print_settings
                .as_ref()?
                .r_id
                .as_ref()?;
            let owner_path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
            let rel = sheet_rt.sheet_opc_rels.iter().find(|rel| {
                &rel.id == r_id
                    && rel.rel_type == crate::write::REL_PRINTER_SETTINGS
                    && rel.target_mode.as_deref() != Some("External")
            })?;
            let path =
                crate::infra::opc::resolve_relationship_target(Some(&owner_path), &rel.target)
                    .ok()
                    .map(|path| normalize_package_path(&path))?;
            let blob = binary_blobs_by_path.get(&path)?;
            Some(OpaquePackageSubgraph {
                owner: OpaquePackageOwner::Part { path: path.clone() },
                owner_relationship: OpaquePackageRelationship {
                    owner: OpaquePackageOwner::Part { path: path.clone() },
                    relationship_type: String::new(),
                    target: OpaqueRelationshipTarget::InternalPath {
                        target: String::new(),
                    },
                    relationship_id_hint: None,
                },
                parts: vec![OpaquePackagePart {
                    part: BlobPart {
                        path,
                        data: blob.data.clone(),
                    },
                    content_type: None,
                    default_extension: Some((
                        "bin".to_string(),
                        crate::write::CT_PRINTER_SETTINGS.to_string(),
                    )),
                    ownership: OpaquePackageOwnership::OrphanCleanPackageData,
                }],
                relationships: Vec::new(),
                ownership: OpaquePackageOwnership::OrphanCleanPackageData,
            })
        })
        .filter(closed_opaque_subgraph)
        .collect()
}

fn build_worksheet_drawing_opaque_subgraphs(
    binary_blobs: &[BlobPart],
    sheet_contexts: &[SheetRoundTripContext],
    sheet_data: &[domain_types::SheetData],
) -> Vec<OpaquePackageSubgraph> {
    let binary_blobs_by_path: HashMap<_, _> = binary_blobs
        .iter()
        .map(|part| (normalize_package_path(&part.path), part))
        .collect();

    sheet_contexts
        .iter()
        .enumerate()
        .filter(|(sheet_idx, _)| {
            sheet_data
                .get(*sheet_idx)
                .is_none_or(|sheet| sheet.charts.is_empty() && sheet.floating_objects.is_empty())
        })
        .filter_map(|(sheet_idx, sheet_rt)| {
            let imported_drawing = sheet_rt.imported_drawing.as_ref()?;
            let drawing_path = normalize_package_path(&imported_drawing.path);
            let owner = OpaquePackageOwner::Worksheet {
                index: sheet_idx,
                path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
            };
            let owner_relationship_id_hint =
                worksheet_drawing_relationship_id_hint(sheet_idx, sheet_rt, &drawing_path)?;

            let mut parts = vec![OpaquePackagePart {
                part: BlobPart {
                    path: drawing_path.clone(),
                    data: imported_drawing.data.clone(),
                },
                content_type: Some(crate::write::CT_DRAWING.to_string()),
                default_extension: None,
                ownership: OpaquePackageOwnership::CleanImported,
            }];

            if let Some(rels) = imported_drawing.rels.as_ref() {
                for rel in crate::domain::workbook::read::parse_all_rels(&rels.data) {
                    if rel.target_mode.as_deref() == Some("External") {
                        continue;
                    }
                    let resolved = crate::infra::opc::resolve_relationship_target(
                        Some(&drawing_path),
                        &rel.target,
                    )
                    .ok()
                    .map(|path| normalize_package_path(&path))?;
                    if parts
                        .iter()
                        .any(|part| normalize_package_path(&part.part.path) == resolved)
                    {
                        continue;
                    }
                    let blob = binary_blobs_by_path.get(&resolved)?;
                    parts.push(binary_opaque_part(blob));
                }
            }

            let mut sidecar_parts = parts
                .iter()
                .map(|part| part.part.clone())
                .collect::<Vec<_>>();
            sidecar_parts.extend(imported_drawing.rels.iter().cloned());
            let relationships = relationships_from_legacy_sidecars(&sidecar_parts)?;

            Some(OpaquePackageSubgraph {
                owner: owner.clone(),
                owner_relationship: OpaquePackageRelationship {
                    owner,
                    relationship_type: crate::write::REL_DRAWING.to_string(),
                    target: OpaqueRelationshipTarget::InternalPart { path: drawing_path },
                    relationship_id_hint: Some(owner_relationship_id_hint),
                },
                parts,
                relationships,
                ownership: OpaquePackageOwnership::CleanImported,
            })
        })
        .filter(closed_opaque_subgraph)
        .collect()
}

fn worksheet_drawing_relationship_id_hint(
    sheet_idx: usize,
    sheet_rt: &SheetRoundTripContext,
    drawing_path: &str,
) -> Option<String> {
    let owner_path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
    sheet_rt
        .sheet_opc_rels
        .iter()
        .find(|rel| {
            rel.rel_type == crate::write::REL_DRAWING
                && rel.target_mode.as_deref() != Some("External")
                && crate::infra::opc::resolve_relationship_target(Some(&owner_path), &rel.target)
                    .map(|resolved| normalize_package_path(&resolved) == drawing_path)
                    .unwrap_or(false)
        })
        .map(|rel| rel.id.clone())
}

fn build_web_extension_opaque_subgraphs(
    parts: &[BlobPart],
    root_relationships: &[ooxml_types::shared::OpcRelationship],
) -> Vec<OpaquePackageSubgraph> {
    let Some(taskpanes) = parts
        .iter()
        .find(|part| normalize_package_path(&part.path) == "xl/webextensions/taskpanes.xml")
    else {
        return Vec::new();
    };
    let Some(relationships) = relationships_from_legacy_sidecars(parts) else {
        return Vec::new();
    };

    vec![OpaquePackageSubgraph {
        owner: OpaquePackageOwner::Root,
        owner_relationship: OpaquePackageRelationship {
            owner: OpaquePackageOwner::Root,
            relationship_type: crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES
                .to_string(),
            target: OpaqueRelationshipTarget::InternalPart {
                path: taskpanes.path.clone(),
            },
            relationship_id_hint: relationship_hint(
                root_relationships,
                crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES,
                "/xl/webextensions/taskpanes.xml",
            ),
        },
        parts: parts
            .iter()
            .filter(|part| !is_relationship_part(&part.path))
            .map(|part| {
                let path = normalize_package_path(&part.path);
                let content_type = if path.ends_with("taskpanes.xml") {
                    Some(
                        crate::domain::web_extensions::read::CT_WEB_EXTENSION_TASKPANES.to_string(),
                    )
                } else if path.ends_with(".xml") && !path.contains("/_rels/") {
                    Some(crate::domain::web_extensions::read::CT_WEB_EXTENSION.to_string())
                } else {
                    None
                };
                opaque_part(part, content_type)
            })
            .collect(),
        relationships,
        ownership: OpaquePackageOwnership::CleanImported,
    }]
}

fn build_custom_xml_opaque_subgraphs(
    parts: &[BlobPart],
    workbook_relationships: &[ooxml_types::shared::OpcRelationship],
) -> Vec<OpaquePackageSubgraph> {
    const REL_CUSTOM_XML: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";

    parts
        .iter()
        .filter(|part| {
            let path = normalize_package_path(&part.path);
            path.starts_with("customXml/item")
                && path.ends_with(".xml")
                && !path.contains("itemProps")
                && !path.contains("/_rels/")
        })
        .filter_map(|item| {
            let item_parts = parts
                .iter()
                .filter(|part| custom_xml_part_belongs_to_item(&item.path, &part.path))
                .cloned()
                .collect::<Vec<_>>();
            let relationships = relationships_from_legacy_sidecars(&item_parts)?;
            Some(OpaquePackageSubgraph {
                owner: OpaquePackageOwner::Workbook,
                owner_relationship: OpaquePackageRelationship {
                    owner: OpaquePackageOwner::Workbook,
                    relationship_type: REL_CUSTOM_XML.to_string(),
                    target: OpaqueRelationshipTarget::InternalPart {
                        path: item.path.clone(),
                    },
                    relationship_id_hint: relationship_hint(
                        workbook_relationships,
                        REL_CUSTOM_XML,
                        &format!("../{}", normalize_package_path(&item.path)),
                    ),
                },
                parts: item_parts
                    .iter()
                    .filter(|part| !is_relationship_part(&part.path))
                    .map(|part| {
                        let path = normalize_package_path(&part.path);
                        let content_type = if path.contains("itemProps")
                            && path.ends_with(".xml")
                            && !path.contains("/_rels/")
                        {
                            Some(
                                "application/vnd.openxmlformats-officedocument.customXmlProperties+xml"
                                    .to_string(),
                            )
                        } else {
                            None
                        };
                        opaque_part(part, content_type)
                    })
                    .collect(),
                relationships,
                ownership: OpaquePackageOwnership::CleanImported,
            })
        })
        .collect()
}

fn opaque_part(part: &BlobPart, content_type: Option<String>) -> OpaquePackagePart {
    let path = normalize_package_path(&part.path);
    OpaquePackagePart {
        part: BlobPart {
            path: path.clone(),
            data: part.data.clone(),
        },
        content_type,
        default_extension: if path.ends_with(".rels") {
            Some((
                "rels".to_string(),
                "application/vnd.openxmlformats-package.relationships+xml".to_string(),
            ))
        } else if path.ends_with(".xml") {
            Some(("xml".to_string(), "application/xml".to_string()))
        } else {
            None
        },
        ownership: OpaquePackageOwnership::CleanImported,
    }
}

fn binary_opaque_part(part: &BlobPart) -> OpaquePackagePart {
    let path = normalize_package_path(&part.path);
    OpaquePackagePart {
        part: BlobPart {
            path: path.clone(),
            data: part.data.clone(),
        },
        content_type: Some(
            crate::roundtrip::binary_passthrough::infer_content_type(&path).to_string(),
        ),
        default_extension: default_extension_for_path(&path),
        ownership: OpaquePackageOwnership::CleanImported,
    }
}

fn relationship_hint(
    relationships: &[ooxml_types::shared::OpcRelationship],
    relationship_type: &str,
    target: &str,
) -> Option<String> {
    relationships
        .iter()
        .find(|rel| rel.rel_type == relationship_type && rel.target == target)
        .map(|rel| rel.id.clone())
}

fn custom_xml_part_belongs_to_item(item_path: &str, candidate_path: &str) -> bool {
    let item_path = normalize_package_path(item_path);
    let candidate_path = normalize_package_path(candidate_path);
    if candidate_path == item_path {
        return true;
    }
    let Some(item_name) = item_path.rsplit('/').next() else {
        return false;
    };
    let Some(item_number) = item_name
        .strip_prefix("item")
        .and_then(|name| name.strip_suffix(".xml"))
    else {
        return false;
    };
    candidate_path == format!("customXml/_rels/{item_name}.rels")
        || candidate_path == format!("customXml/itemProps{item_number}.xml")
}

fn relationships_from_legacy_sidecars(
    parts: &[BlobPart],
) -> Option<Vec<OpaquePackageRelationship>> {
    let part_paths: HashSet<_> = parts
        .iter()
        .filter(|part| !is_relationship_part(&part.path))
        .map(|part| normalize_package_path(&part.path))
        .collect();
    let mut relationships = Vec::new();
    for part in parts.iter().filter(|part| is_relationship_part(&part.path)) {
        let owner_path = relationship_owner_path(&part.path)?;
        for rel in crate::domain::workbook::read::parse_all_rels(&part.data) {
            let target = if rel.target_mode.as_deref() == Some("External") {
                OpaqueRelationshipTarget::External { target: rel.target }
            } else {
                let resolved =
                    crate::infra::opc::resolve_relationship_target(Some(&owner_path), &rel.target)
                        .ok()?;
                let resolved = normalize_package_path(&resolved);
                if !part_paths.contains(&resolved) {
                    return None;
                }
                OpaqueRelationshipTarget::InternalPart { path: resolved }
            };
            relationships.push(OpaquePackageRelationship {
                owner: OpaquePackageOwner::Part {
                    path: owner_path.clone(),
                },
                relationship_type: rel.rel_type,
                target,
                relationship_id_hint: Some(rel.id),
            });
        }
    }
    Some(relationships)
}

fn closed_opaque_subgraph(subgraph: &OpaquePackageSubgraph) -> bool {
    let part_paths: HashSet<_> = subgraph
        .parts
        .iter()
        .map(|part| normalize_package_path(&part.part.path))
        .collect();
    if let OpaqueRelationshipTarget::InternalPart { path } = &subgraph.owner_relationship.target
        && !part_paths.contains(&normalize_package_path(path))
    {
        return false;
    }
    subgraph.relationships.iter().all(|relationship| {
        if let OpaqueRelationshipTarget::InternalPart { path } = &relationship.target {
            part_paths.contains(&normalize_package_path(path))
        } else {
            true
        }
    })
}

fn default_extension_for_path(path: &str) -> Option<(String, String)> {
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    let content_type = crate::roundtrip::binary_passthrough::infer_content_type(path);
    Some((extension, content_type.to_string()))
}

fn is_relationship_part(path: &str) -> bool {
    let path = normalize_package_path(path);
    path.contains("/_rels/") && path.ends_with(".rels")
}

fn relationship_owner_path(rels_path: &str) -> Option<String> {
    let rels_path = normalize_package_path(rels_path);
    let (dir, file) = rels_path.rsplit_once('/')?;
    let owner_file = file.strip_suffix(".rels")?;
    let owner_dir = dir.strip_suffix("/_rels")?;
    Some(if owner_dir.is_empty() {
        owner_file.to_string()
    } else {
        format!("{owner_dir}/{owner_file}")
    })
}

fn normalize_package_path(path: &str) -> String {
    path.trim_start_matches('/').replace('\\', "/")
}

pub(super) fn build_round_trip_context(
    result: &FullParseResult,
    sheet_data: &[domain_types::SheetData],
    sheet_contexts: Vec<SheetRoundTripContext>,
) -> RoundTripContext {
    let custom_xml_parts: Vec<BlobPart> = result
        .custom_xml_parts
        .iter()
        .map(|(path, data)| BlobPart {
            path: path.clone(),
            data: data.clone(),
        })
        .collect();
    let web_extension_parts: Vec<BlobPart> = result
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
        .unwrap_or_default();
    let binary_blobs: Vec<BlobPart> = result
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
        .unwrap_or_default();
    let opaque_package_subgraphs = build_opaque_package_subgraphs(
        &custom_xml_parts,
        &web_extension_parts,
        &binary_blobs,
        &result.content_type_overrides,
        &sheet_contexts,
        sheet_data,
        (&result.root_relationships, &result.workbook_relationships),
    );

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
        custom_xml_parts,
        web_extension_parts,
        opaque_package_subgraphs,
        binary_blobs,
        // Pivots are modeled through ParseOutput.pivot_tables/pivot_caches and
        // compute workbook pivot storage. New imports must not emit a pivot
        // roundtrip package sidecar; the field remains deserialize-only for
        // legacy documents.
        pivot_package: PivotPackageRoundTrip::default(),
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
        skipped_named_ranges: vec![],
        original_named_ranges_order: vec![],
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
