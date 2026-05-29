//! Package-level pivot relationship discovery.

use crate::domain::pivot::convert::{
    build_full_pivot_cache_for_converter, parsed_pivot_to_config, resolve_cache_records,
};
use crate::domain::pivot::parse::parse_pivot_table;
use crate::domain::pivot::spec::{pivot_cache_records_to_ooxml, pivot_cache_to_ooxml};
use crate::domain::workbook::read::parse_all_rels;
use crate::infra::opc::{
    OoxmlRelationshipType, PackageOwner, WorkbookRelationships, WorksheetRelationships,
    parse_owned_relationships,
};
use domain_types::domain::pivot::PivotCacheWorkbookRefScope;
use domain_types::domain::pivot::PivotTableRelationshipPreservation;

pub type PivotCacheMap =
    std::collections::HashMap<u32, crate::domain::pivot::types::ParsedPivotCache>;
pub type PivotCachePathList = Vec<(u32, String, Option<String>)>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PivotCacheRecordsPathSource {
    Relationship,
    Fallback,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PivotCacheRecordsLink {
    pub rels_path: Option<String>,
    pub relationship_id: Option<String>,
    pub relationship_type: Option<String>,
    pub relationship_target: Option<String>,
    pub records_path: Option<String>,
    pub source: PivotCacheRecordsPathSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PivotCachePackageLink {
    pub cache_id: u32,
    pub workbook_ref_scope: PivotCacheWorkbookRefScope,
    pub workbook_relationship_id: String,
    pub workbook_relationship_target: String,
    pub definition_path: String,
    pub records: PivotCacheRecordsLink,
}

impl PivotCachePackageLink {
    pub fn records_path(&self) -> Option<String> {
        self.records.records_path.clone()
    }
}

#[derive(Debug, Clone)]
pub struct PivotCachePackage {
    pub link: PivotCachePackageLink,
    pub parsed_cache: crate::domain::pivot::types::ParsedPivotCache,
}

#[derive(Debug, Clone, Default)]
pub struct PivotPackageDiscovery {
    pub caches: PivotCacheMap,
    pub packages: Vec<PivotCachePackage>,
    pub links: Vec<PivotCachePackageLink>,
    pub fidelity: Vec<domain_types::PivotCachePackageFidelity>,
}

impl PivotPackageDiscovery {
    pub fn cache_paths(&self) -> PivotCachePathList {
        self.links
            .iter()
            .map(|link| {
                (
                    link.cache_id,
                    link.definition_path.clone(),
                    link.records_path(),
                )
            })
            .collect()
    }
}

/// Parse all pivot cache package parts and their OPC relationship metadata.
pub fn parse_pivot_cache_packages(archive: &crate::zip::XlsxArchive) -> PivotPackageDiscovery {
    let mut discovery = PivotPackageDiscovery::default();

    let workbook_xml = match archive.read_file("xl/workbook.xml") {
        Ok(xml) => xml,
        Err(_) => return discovery,
    };
    let wb_rels_xml = match archive.read_file("xl/_rels/workbook.xml.rels") {
        Ok(xml) => xml,
        Err(_) => return discovery,
    };

    let workbook_relationships = parse_owned_relationships(PackageOwner::Workbook, &wb_rels_xml);
    let workbook_relationships = WorkbookRelationships::new(&workbook_relationships);
    let rels_map: std::collections::HashMap<String, (String, String, String)> =
        workbook_relationships
            .pivot_cache_definitions()
            .into_iter()
            .filter_map(|rel| {
                rel.target.path().map(|path| {
                    (
                        rel.id.clone(),
                        (
                            rel.rel_type_uri.clone(),
                            rel.target.raw().to_string(),
                            workbook_pivot_cache_definition_path(rel.target.raw(), path),
                        ),
                    )
                })
            })
            .collect();

    for cache_ref in extract_pivot_cache_refs(&workbook_xml) {
        let cache_id = cache_ref.cache_id;
        let r_id = cache_ref.relationship_id;
        let Some((workbook_relationship_type, workbook_relationship_target, def_path)) =
            rels_map.get(&r_id).cloned()
        else {
            continue;
        };
        let Ok(cache_xml) = archive.read_file(&def_path) else {
            continue;
        };

        let definition = pivot_cache_to_ooxml(&cache_xml);
        let records = resolve_cache_records_link(archive, &def_path);
        let definition_rels_xml = records
            .rels_path
            .as_deref()
            .and_then(|path| archive.read_file(path).ok());
        let external_source_relationship =
            external_worksheet_source_relationship(definition_rels_xml.as_deref(), &definition);

        let mut cache_records = ooxml_types::pivot::PivotCacheRecords::default();
        let mut raw_records_xml = None;
        if let Some(ref rp) = records.records_path {
            if let Ok(records_bytes) = archive.read_file(rp) {
                cache_records = pivot_cache_records_to_ooxml(&records_bytes);
                raw_records_xml = Some(records_bytes);
            }
        }

        let parsed_cache = crate::domain::pivot::types::ParsedPivotCache {
            definition,
            records: cache_records,
        };
        let link = PivotCachePackageLink {
            cache_id,
            workbook_ref_scope: cache_ref.scope,
            workbook_relationship_id: r_id,
            workbook_relationship_target,
            definition_path: def_path,
            records,
        };

        discovery.caches.insert(cache_id, parsed_cache.clone());
        discovery.links.push(link.clone());
        discovery
            .fidelity
            .push(domain_types::PivotCachePackageFidelity {
                cache_id,
                workbook_ref_scope: link.workbook_ref_scope,
                definition_path: link.definition_path.clone(),
                records_path: link.records.records_path.clone(),
                definition_xml: cache_xml,
                records_xml: raw_records_xml,
                definition_rels_xml,
                workbook_relationship_id: link.workbook_relationship_id.clone(),
                workbook_relationship_type,
                workbook_relationship_target: link.workbook_relationship_target.clone(),
                records_relationship_id: link.records.relationship_id.clone(),
                records_relationship_type: link.records.relationship_type.clone(),
                records_relationship_target: link.records.relationship_target.clone(),
                source_sheet: parsed_cache
                    .definition
                    .cache_source
                    .worksheet_source
                    .as_ref()
                    .and_then(|source| source.sheet.clone()),
                source_range: parsed_cache
                    .definition
                    .cache_source
                    .worksheet_source
                    .as_ref()
                    .and_then(|source| source.r#ref.clone()),
                external_source_relationship_id: external_source_relationship
                    .as_ref()
                    .map(|rel| rel.id.clone()),
                external_source_relationship_type: external_source_relationship
                    .as_ref()
                    .map(|rel| rel.rel_type.clone()),
                external_source_relationship_target: external_source_relationship
                    .as_ref()
                    .map(|rel| rel.target.clone()),
                external_source_relationship_target_mode: external_source_relationship
                    .as_ref()
                    .and_then(|rel| rel.target_mode.clone()),
            });
        discovery
            .packages
            .push(PivotCachePackage { link, parsed_cache });
    }

    discovery
}

fn external_worksheet_source_relationship(
    definition_rels_xml: Option<&[u8]>,
    definition: &ooxml_types::pivot::PivotCacheDefinition,
) -> Option<ooxml_types::shared::OpcRelationship> {
    let r_id = definition
        .cache_source
        .worksheet_source
        .as_ref()
        .and_then(|source| source.r_id.as_deref())?;
    parse_all_rels(definition_rels_xml?)
        .into_iter()
        .find(|rel| rel.id == r_id)
}

fn workbook_pivot_cache_definition_path(raw_target: &str, resolved_path: &str) -> String {
    if raw_target.starts_with("xl/") {
        raw_target.to_string()
    } else {
        resolved_path.to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PivotCachePathEntry {
    pub cache_id: u32,
    pub definition_path: String,
    pub records_path: Option<String>,
}

/// Parse all pivot caches from the workbook package.
pub fn parse_all_pivot_caches(archive: &crate::zip::XlsxArchive) -> PivotCacheMap {
    parse_pivot_cache_packages(archive).caches
}

pub fn parse_pivot_tables_for_sheet_v2(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
    sheet_name: &str,
    pivot_caches: &std::collections::HashMap<u32, crate::domain::pivot::types::ParsedPivotCache>,
) -> Vec<domain_types::domain::pivot::ParsedPivotTable> {
    let mut results = Vec::new();

    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let pivot_paths = if let Ok(rels_xml) = archive.read_file(&rels_path) {
        extract_pivot_table_paths_for_sheet(sheet_num, &rels_xml)
    } else {
        Vec::new()
    };

    for full_path in &pivot_paths {
        if let Ok(pivot_xml) = archive.read_file(full_path) {
            let mut pt = parse_pivot_table(&pivot_xml);
            pt.ooxml_preservation.relationship =
                discover_pivot_table_cache_relationship(archive, full_path, pt.cache_id);
            let cache = pivot_caches
                .get(&pt.cache_id)
                .map(|pc| build_full_pivot_cache_for_converter(pc, pt.cache_id));
            if let Some(ref cache) = cache {
                let cache_records = resolve_cache_records(pivot_caches.get(&pt.cache_id));
                if let Some(parsed) = parsed_pivot_to_config(&pt, cache, sheet_name, &cache_records)
                {
                    results.push(parsed);
                }
            }
        }
    }

    results
}

fn discover_pivot_table_cache_relationship(
    archive: &crate::zip::XlsxArchive,
    part_path: &str,
    _cache_id: u32,
) -> Option<PivotTableRelationshipPreservation> {
    let (dir, file) = part_path.rsplit_once('/')?;
    let rels_path = format!("{}/_rels/{}.rels", dir, file);
    let Ok(rels_xml) = archive.read_file(&rels_path) else {
        return Some(PivotTableRelationshipPreservation {
            part_path: Some(part_path.to_string()),
            rels_path: Some(rels_path),
            consistency: Some("missingRelationshipPart".to_string()),
            ..Default::default()
        });
    };

    let relationships = parse_owned_relationships(
        PackageOwner::PivotTable {
            path: part_path.to_string(),
        },
        &rels_xml,
    );
    let Some(rel) = relationships
        .iter()
        .find(|rel| rel.rel_type == OoxmlRelationshipType::PivotCacheDefinition)
    else {
        return Some(PivotTableRelationshipPreservation {
            part_path: Some(part_path.to_string()),
            rels_path: Some(rels_path),
            consistency: Some("missingCacheDefinitionRelationship".to_string()),
            ..Default::default()
        });
    };

    Some(PivotTableRelationshipPreservation {
        part_path: Some(part_path.to_string()),
        rels_path: Some(rels_path),
        relationship_id: Some(rel.id.clone()),
        relationship_target: Some(rel.target.raw().to_string()),
        resolved_cache_definition_path: rel.target.path().map(ToOwned::to_owned),
        consistency: Some("relationshipDiscovered".to_string()),
    })
}

fn resolve_cache_records_link(
    archive: &crate::zip::XlsxArchive,
    def_path: &str,
) -> PivotCacheRecordsLink {
    let cache_dir = def_path
        .rsplit_once('/')
        .map(|(d, _)| d)
        .unwrap_or("xl/pivotCache");
    let cache_filename = def_path.rsplit('/').next().unwrap_or("");
    let cache_rels_path = format!("{}/_rels/{}.rels", cache_dir, cache_filename);
    if let Ok(cache_rels_xml) = archive.read_file(&cache_rels_path) {
        let cache_relationships = parse_owned_relationships(
            PackageOwner::PivotCache {
                path: def_path.to_string(),
            },
            &cache_rels_xml,
        );
        let record_rel = cache_relationships
            .iter()
            .find(|rel| rel.rel_type == OoxmlRelationshipType::PivotCacheRecords);
        if let Some(rel) = record_rel {
            PivotCacheRecordsLink {
                rels_path: Some(cache_rels_path),
                relationship_id: Some(rel.id.clone()),
                relationship_type: Some(rel.rel_type_uri.clone()),
                relationship_target: Some(rel.target.raw().to_string()),
                records_path: rel.target.path().map(ToOwned::to_owned),
                source: PivotCacheRecordsPathSource::Relationship,
            }
        } else {
            PivotCacheRecordsLink {
                rels_path: Some(cache_rels_path),
                relationship_id: None,
                relationship_type: None,
                relationship_target: None,
                records_path: None,
                source: PivotCacheRecordsPathSource::Missing,
            }
        }
    } else {
        let records_guess = def_path.replace("pivotCacheDefinition", "pivotCacheRecords");
        if archive.read_file(&records_guess).is_ok() {
            PivotCacheRecordsLink {
                rels_path: None,
                relationship_id: None,
                relationship_type: None,
                relationship_target: None,
                records_path: Some(records_guess),
                source: PivotCacheRecordsPathSource::Fallback,
            }
        } else {
            PivotCacheRecordsLink {
                rels_path: None,
                relationship_id: None,
                relationship_type: None,
                relationship_target: None,
                records_path: None,
                source: PivotCacheRecordsPathSource::Missing,
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn extract_pivot_cache_entries(workbook_xml: &[u8]) -> Vec<(u32, String)> {
    extract_pivot_cache_refs(workbook_xml)
        .into_iter()
        .map(|cache_ref| (cache_ref.cache_id, cache_ref.relationship_id))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PivotCacheWorkbookRef {
    pub cache_id: u32,
    pub relationship_id: String,
    pub scope: PivotCacheWorkbookRefScope,
}

pub(crate) fn extract_pivot_cache_refs(workbook_xml: &[u8]) -> Vec<PivotCacheWorkbookRef> {
    use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
    let mut entries = Vec::new();

    let mut pos = 0;
    while let Some(container_start) = find_tag_simd(workbook_xml, b"pivotCaches", pos) {
        let container_end = find_gt_simd(workbook_xml, container_start)
            .map(|p| p + 1)
            .unwrap_or(workbook_xml.len());
        let container_elem = &workbook_xml[container_start..container_end];
        if !is_pivot_caches_element(container_elem) {
            pos = container_start + 1;
            continue;
        }
        let scope = if element_prefix(container_elem) == Some(b"x14" as &[u8]) {
            PivotCacheWorkbookRefScope::X14PivotCaches
        } else {
            PivotCacheWorkbookRefScope::WorkbookPivotCaches
        };
        let section_end = find_closing_tag(workbook_xml, b"pivotCaches", container_start)
            .unwrap_or(workbook_xml.len());
        collect_pivot_cache_refs_in_section(
            &workbook_xml[container_start..section_end],
            scope,
            &mut entries,
        );
        pos = section_end.saturating_add(1);
    }

    pos = 0;
    while let Some(container_start) = find_tag_simd(workbook_xml, b"timelineCachePivotCaches", pos)
    {
        let container_end = find_gt_simd(workbook_xml, container_start)
            .map(|p| p + 1)
            .unwrap_or(workbook_xml.len());
        let container_elem = &workbook_xml[container_start..container_end];
        if !element_local_name_is(container_elem, b"timelineCachePivotCaches") {
            pos = container_start + 1;
            continue;
        }
        let section_end =
            find_closing_tag(workbook_xml, b"timelineCachePivotCaches", container_start)
                .unwrap_or(workbook_xml.len());
        collect_pivot_cache_refs_in_section(
            &workbook_xml[container_start..section_end],
            PivotCacheWorkbookRefScope::X15TimelineCachePivotCaches,
            &mut entries,
        );
        pos = section_end.saturating_add(1);
    }

    entries
}

fn collect_pivot_cache_refs_in_section(
    section: &[u8],
    scope: PivotCacheWorkbookRefScope,
    entries: &mut Vec<PivotCacheWorkbookRef>,
) {
    use crate::infra::scanner::{
        extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd,
    };

    let mut pos = 0;
    while let Some(pc_start) = find_tag_simd(section, b"pivotCache", pos) {
        let pc_end = find_gt_simd(section, pc_start)
            .map(|p| p + 1)
            .unwrap_or(section.len());
        let pc_elem = &section[pc_start..pc_end];
        if !is_pivot_cache_element(pc_elem) {
            pos = pc_start + 1;
            continue;
        }

        let cache_id = find_attr_simd(pc_elem, b"cacheId=\"", 0).and_then(|p| {
            let vs = p + 9;
            extract_quoted_value(pc_elem, vs).and_then(|(s, e)| {
                std::str::from_utf8(&pc_elem[s..e])
                    .ok()?
                    .parse::<u32>()
                    .ok()
            })
        });
        let relationship_id = find_attr_simd(pc_elem, b"r:id=\"", 0).and_then(|p| {
            let vs = p + 6;
            extract_quoted_value(pc_elem, vs)
                .and_then(|(s, e)| std::str::from_utf8(&pc_elem[s..e]).ok().map(str::to_string))
        });

        if let (Some(cache_id), Some(relationship_id)) = (cache_id, relationship_id) {
            entries.push(PivotCacheWorkbookRef {
                cache_id,
                relationship_id,
                scope,
            });
        }

        pos = pc_start + 1;
    }
}

fn is_pivot_cache_element(element: &[u8]) -> bool {
    element_local_name_is(element, b"pivotCache")
}

fn is_pivot_caches_element(element: &[u8]) -> bool {
    element_local_name_is(element, b"pivotCaches")
}

fn element_local_name_is(element: &[u8], expected: &[u8]) -> bool {
    element_local_name(element) == Some(expected)
}

fn element_prefix(element: &[u8]) -> Option<&[u8]> {
    let name = element_name(element)?;
    name.iter().position(|b| *b == b':').map(|idx| &name[..idx])
}

fn element_local_name(element: &[u8]) -> Option<&[u8]> {
    let name = element_name(element)?;
    Some(
        name.iter()
            .rposition(|b| *b == b':')
            .map(|idx| &name[idx + 1..])
            .unwrap_or(name),
    )
}

fn element_name(element: &[u8]) -> Option<&[u8]> {
    let Some(open) = element.iter().position(|b| *b == b'<') else {
        return None;
    };
    let mut name_start = open + 1;
    if element.get(name_start) == Some(&b'/') {
        name_start += 1;
    }
    let mut name_end = name_start;
    while let Some(b) = element.get(name_end) {
        if b.is_ascii_whitespace() || matches!(*b, b'/' | b'>') {
            break;
        }
        name_end += 1;
    }
    Some(&element[name_start..name_end])
}

pub(crate) fn extract_pivot_table_paths_for_sheet(
    sheet_num: usize,
    rels_xml: &[u8],
) -> Vec<String> {
    let relationships = parse_owned_relationships(
        PackageOwner::Worksheet {
            sheet_index: sheet_num,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        },
        rels_xml,
    );
    WorksheetRelationships::new(&relationships)
        .pivot_tables()
        .into_iter()
        .filter_map(|rel| rel.target.path().map(ToOwned::to_owned))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pivot_cache_definition_xml(sheet: &str) -> Vec<u8> {
        format!(
            r#"<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" recordCount="1">
                <cacheSource type="worksheet"><worksheetSource ref="A1:B2" sheet="{sheet}"/></cacheSource>
                <cacheFields count="1">
                    <cacheField name="Region"><sharedItems count="1"><s v="West"/></sharedItems></cacheField>
                </cacheFields>
            </pivotCacheDefinition>"#
        )
        .into_bytes()
    }

    fn pivot_cache_records_xml(value: &str) -> Vec<u8> {
        format!(
            r#"<pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1">
                <r><s v="{value}"/></r>
            </pivotCacheRecords>"#
        )
        .into_bytes()
    }

    fn archive_with(files: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut writer = crate::write::ZipWriter::new();
        for (path, bytes) in files {
            writer.add_file(path, bytes.clone());
        }
        writer.finish().expect("fixture archive should write")
    }

    #[test]
    fn workbook_pivot_cache_entries_extract_cache_id_and_relationship() {
        let xml = br#"<workbook><pivotCaches>
            <pivotCache cacheId="4" r:id="rId7"/>
            <pivotCache cacheId="9" r:id="rId8"/>
        </pivotCaches></workbook>"#;
        assert_eq!(
            extract_pivot_cache_entries(xml),
            vec![(4, "rId7".to_string()), (9, "rId8".to_string())]
        );
    }

    #[test]
    fn workbook_pivot_cache_entries_extract_extension_cache_refs() {
        let xml = br#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
            xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main">
            <pivotCaches>
                <pivotCache cacheId="181" r:id="rId33"/>
                <pivotCache cacheId="182" r:id="rId34"/>
            </pivotCaches>
            <extLst>
                <ext><x14:pivotCaches>
                    <x14:pivotCache cacheId="184" r:id="rId35"/>
                    <x14:pivotCache cacheId="183" r:id="rId36"/>
                </x14:pivotCaches></ext>
                <ext><x15:timelineCachePivotCaches>
                    <x15:pivotCache cacheId="185" r:id="rId40"/>
                </x15:timelineCachePivotCaches></ext>
            </extLst>
        </workbook>"#;
        assert_eq!(
            extract_pivot_cache_entries(xml),
            vec![
                (181, "rId33".to_string()),
                (182, "rId34".to_string()),
                (184, "rId35".to_string()),
                (183, "rId36".to_string()),
                (185, "rId40".to_string()),
            ]
        );
        assert_eq!(
            extract_pivot_cache_refs(xml)
                .into_iter()
                .map(|cache_ref| (cache_ref.cache_id, cache_ref.scope))
                .collect::<Vec<_>>(),
            vec![
                (181, PivotCacheWorkbookRefScope::WorkbookPivotCaches),
                (182, PivotCacheWorkbookRefScope::WorkbookPivotCaches),
                (184, PivotCacheWorkbookRefScope::X14PivotCaches),
                (183, PivotCacheWorkbookRefScope::X14PivotCaches),
                (185, PivotCacheWorkbookRefScope::X15TimelineCachePivotCaches),
            ]
        );
    }

    #[test]
    fn worksheet_relationships_extract_pivot_table_paths() {
        let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/>
        </Relationships>"#;
        assert_eq!(
            extract_pivot_table_paths_for_sheet(1, rels),
            vec!["xl/pivotTables/pivotTable1.xml".to_string()]
        );
    }

    #[test]
    fn package_discovery_tracks_workbook_and_cache_record_relationships() {
        let bytes = archive_with(&[
            (
                "xl/workbook.xml",
                br#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><pivotCaches><pivotCache cacheId="4" r:id="rId7"/></pivotCaches></workbook>"#
                    .to_vec(),
            ),
            (
                "xl/_rels/workbook.xml.rels",
                br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition4.xml"/></Relationships>"#
                    .to_vec(),
            ),
            (
                "xl/pivotCache/pivotCacheDefinition4.xml",
                pivot_cache_definition_xml("Data"),
            ),
            (
                "xl/pivotCache/_rels/pivotCacheDefinition4.xml.rels",
                br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords" Target="pivotCacheRecords4.xml"/></Relationships>"#
                    .to_vec(),
            ),
            (
                "xl/pivotCache/pivotCacheRecords4.xml",
                pivot_cache_records_xml("0"),
            ),
        ]);
        let archive = crate::zip::XlsxArchive::new(&bytes).expect("fixture archive should open");

        let discovery = parse_pivot_cache_packages(&archive);

        assert_eq!(discovery.caches.len(), 1);
        assert_eq!(discovery.links.len(), 1);
        let link = &discovery.links[0];
        assert_eq!(link.cache_id, 4);
        assert_eq!(link.workbook_relationship_id, "rId7");
        assert_eq!(
            link.workbook_relationship_target,
            "pivotCache/pivotCacheDefinition4.xml"
        );
        assert_eq!(
            link.definition_path,
            "xl/pivotCache/pivotCacheDefinition4.xml"
        );
        assert_eq!(
            link.records,
            PivotCacheRecordsLink {
                rels_path: Some("xl/pivotCache/_rels/pivotCacheDefinition4.xml.rels".to_string()),
                relationship_id: Some("rId1".to_string()),
                relationship_type: Some(
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords"
                        .to_string(),
                ),
                relationship_target: Some("pivotCacheRecords4.xml".to_string()),
                records_path: Some("xl/pivotCache/pivotCacheRecords4.xml".to_string()),
                source: PivotCacheRecordsPathSource::Relationship,
            }
        );
        assert_eq!(
            discovery.caches[&4]
                .definition
                .cache_source
                .worksheet_source
                .as_ref()
                .and_then(|source| source.sheet.as_deref()),
            Some("Data")
        );
        assert_eq!(discovery.caches[&4].records.records.len(), 1);
        assert_eq!(
            discovery.cache_paths(),
            vec![(
                4,
                "xl/pivotCache/pivotCacheDefinition4.xml".to_string(),
                Some("xl/pivotCache/pivotCacheRecords4.xml".to_string())
            )]
        );
    }

    #[test]
    fn package_discovery_falls_back_to_matching_cache_records_path() {
        let bytes = archive_with(&[
            (
                "xl/workbook.xml",
                br#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><pivotCaches><pivotCache cacheId="9" r:id="rId9"/></pivotCaches></workbook>"#
                    .to_vec(),
            ),
            (
                "xl/_rels/workbook.xml.rels",
                br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition9.xml"/></Relationships>"#
                    .to_vec(),
            ),
            (
                "xl/pivotCache/pivotCacheDefinition9.xml",
                pivot_cache_definition_xml("Data"),
            ),
            (
                "xl/pivotCache/pivotCacheRecords9.xml",
                pivot_cache_records_xml("0"),
            ),
        ]);
        let archive = crate::zip::XlsxArchive::new(&bytes).expect("fixture archive should open");

        let discovery = parse_pivot_cache_packages(&archive);

        assert_eq!(discovery.links.len(), 1);
        assert_eq!(
            discovery.links[0].records,
            PivotCacheRecordsLink {
                rels_path: None,
                relationship_id: None,
                relationship_type: None,
                relationship_target: None,
                records_path: Some("xl/pivotCache/pivotCacheRecords9.xml".to_string()),
                source: PivotCacheRecordsPathSource::Fallback,
            }
        );
    }

    #[test]
    fn workbook_relationship_targets_resolve_absolute_xl_prefixed_and_workbook_relative_paths() {
        let cases = [
            (
                "/xl/pivotCache/pivotCacheDefinition4.xml",
                "xl/pivotCache/pivotCacheDefinition4.xml",
            ),
            (
                "xl/pivotCache/pivotCacheDefinition4.xml",
                "xl/pivotCache/pivotCacheDefinition4.xml",
            ),
            (
                "pivotCache/pivotCacheDefinition4.xml",
                "xl/pivotCache/pivotCacheDefinition4.xml",
            ),
        ];

        for (target, expected_path) in cases {
            let rels = format!(
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="{target}"/></Relationships>"#
            );
            let bytes = archive_with(&[
                (
                    "xl/workbook.xml",
                    br#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><pivotCaches><pivotCache cacheId="4" r:id="rId7"/></pivotCaches></workbook>"#
                        .to_vec(),
                ),
                ("xl/_rels/workbook.xml.rels", rels.into_bytes()),
                (expected_path, pivot_cache_definition_xml("Data")),
                (
                    "xl/pivotCache/pivotCacheRecords4.xml",
                    pivot_cache_records_xml("0"),
                ),
            ]);
            let archive =
                crate::zip::XlsxArchive::new(&bytes).expect("fixture archive should open");

            let discovery = parse_pivot_cache_packages(&archive);

            assert_eq!(discovery.links.len(), 1);
            assert_eq!(discovery.links[0].workbook_relationship_target, target);
            assert_eq!(discovery.links[0].definition_path, expected_path);
        }
    }

    #[test]
    fn worksheet_relationship_targets_resolve_parent_absolute_and_local_paths() {
        let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/>
            <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="/xl/pivotTables/pivotTable2.xml"/>
            <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="pivotTable3.xml"/>
        </Relationships>"#;

        assert_eq!(
            extract_pivot_table_paths_for_sheet(1, rels),
            vec![
                "xl/pivotTables/pivotTable1.xml".to_string(),
                "xl/pivotTables/pivotTable2.xml".to_string(),
                "xl/worksheets/pivotTable3.xml".to_string(),
            ]
        );
    }

    #[test]
    fn cache_definition_relationships_select_pivot_records_after_non_pivot_relationships() {
        let bytes = archive_with(&[
            (
                "xl/workbook.xml",
                br#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><pivotCaches><pivotCache cacheId="4" r:id="rId7"/></pivotCaches></workbook>"#
                    .to_vec(),
            ),
            (
                "xl/_rels/workbook.xml.rels",
                br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition4.xml"/></Relationships>"#
                    .to_vec(),
            ),
            (
                "xl/pivotCache/pivotCacheDefinition4.xml",
                pivot_cache_definition_xml("Data"),
            ),
            (
                "xl/pivotCache/_rels/pivotCacheDefinition4.xml.rels",
                br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                    <Relationship Id="rId0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
                    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords" Target="pivotCacheRecords4.xml"/>
                </Relationships>"#
                    .to_vec(),
            ),
            (
                "xl/pivotCache/pivotCacheRecords4.xml",
                pivot_cache_records_xml("0"),
            ),
        ]);
        let archive = crate::zip::XlsxArchive::new(&bytes).expect("fixture archive should open");

        let discovery = parse_pivot_cache_packages(&archive);

        assert_eq!(discovery.links.len(), 1);
        assert_eq!(
            discovery.links[0].records.relationship_id,
            Some("rId1".to_string())
        );
        assert_eq!(
            discovery.links[0].records.records_path,
            Some("xl/pivotCache/pivotCacheRecords4.xml".to_string())
        );
        assert_eq!(
            discovery.links[0].records.source,
            PivotCacheRecordsPathSource::Relationship
        );
    }

    #[test]
    fn cache_definition_rels_without_pivot_records_reports_missing_without_fallback() {
        let bytes = archive_with(&[
            (
                "xl/workbook.xml",
                br#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><pivotCaches><pivotCache cacheId="4" r:id="rId7"/></pivotCaches></workbook>"#
                    .to_vec(),
            ),
            (
                "xl/_rels/workbook.xml.rels",
                br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition4.xml"/></Relationships>"#
                    .to_vec(),
            ),
            (
                "xl/pivotCache/pivotCacheDefinition4.xml",
                pivot_cache_definition_xml("Data"),
            ),
            (
                "xl/pivotCache/_rels/pivotCacheDefinition4.xml.rels",
                br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                    <Relationship Id="rId0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
                </Relationships>"#
                    .to_vec(),
            ),
            (
                "xl/pivotCache/pivotCacheRecords4.xml",
                pivot_cache_records_xml("0"),
            ),
        ]);
        let archive = crate::zip::XlsxArchive::new(&bytes).expect("fixture archive should open");

        let discovery = parse_pivot_cache_packages(&archive);

        assert_eq!(discovery.links.len(), 1);
        assert_eq!(
            discovery.links[0].records,
            PivotCacheRecordsLink {
                rels_path: Some("xl/pivotCache/_rels/pivotCacheDefinition4.xml.rels".to_string()),
                relationship_id: None,
                relationship_type: None,
                relationship_target: None,
                records_path: None,
                source: PivotCacheRecordsPathSource::Missing,
            }
        );
    }
}
