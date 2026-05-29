use std::collections::{BTreeMap, HashSet};

use super::{
    CONTENT_TYPE_CTRL_PROP, CT_CHART, CT_CHART_COLOR_STYLE, CT_CHART_EX, CT_CHART_STYLE,
    CT_COMMENTS, CT_CONNECTIONS, CT_CORE_PROPERTIES, CT_CUSTOM_PROPERTIES,
    CT_DOC_METADATA_LABEL_INFO, CT_DRAWING, CT_EXTENDED_PROPERTIES, CT_METADATA, CT_OLE_OBJECT,
    CT_PIVOT_CACHE, CT_PIVOT_CACHE_RECORDS, CT_PIVOT_TABLE, CT_QUERY_TABLE, CT_SHARED_STRINGS,
    CT_SLICER, CT_SLICER_CACHE, CT_STYLES, CT_TABLE, CT_TABLE_SINGLE_CELLS, CT_THEME,
    CT_THREADED_COMMENTS, CT_TIMELINE, CT_TIMELINE_CACHE, CT_VOLATILE_DEPENDENCIES, CT_WORKBOOK,
    CT_WORKSHEET, CT_WORKSHEET_CUSTOM_PROPERTY, PackageIntegrityIssue, PackagePart,
    PackagePartKind, REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CONNECTIONS, REL_CORE_PROPERTIES,
    REL_CTRL_PROP, REL_CUSTOM_PROPERTIES, REL_DRAWING, REL_EXTENDED_PROPERTIES, REL_EXTERNAL_LINK,
    REL_IMAGE, REL_METADATA, REL_OFFICE_DOCUMENT, REL_OLE_OBJECT, REL_PERSON, REL_PIVOT_CACHE,
    REL_PIVOT_CACHE_RECORDS, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS, REL_QUERY_TABLE,
    REL_SHARED_STRINGS, REL_SLICER, REL_SLICER_CACHE, REL_STYLES, REL_TABLE,
    REL_TABLE_SINGLE_CELLS, REL_THEME, REL_THREADED_COMMENT, REL_VML_DRAWING, REL_WORKSHEET,
    REL_WORKSHEET_CUSTOM_PROPERTY, ResolvedPackageRelationship, is_external_target_mode,
    owner_part_path_from_rels_path, owner_rels_path, relationship_target_part_path,
};
use crate::infra::opc::OoxmlRelationshipType;
use quick_xml::events::Event;
use quick_xml::reader::Reader;

const OFFICE_RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

pub(super) fn validate_required_content_type(
    part: &PackagePart,
    errors: &mut Vec<PackageIntegrityIssue>,
) {
    if !matches!(part.kind, PackagePartKind::Modeled) {
        return;
    }
    let Some(expected) = required_content_type_for_modeled_part(&part.path) else {
        return;
    };
    if part.content_type.as_deref() != Some(expected) {
        errors.push(PackageIntegrityIssue::MissingRequiredContentType {
            part_path: part.path.clone(),
            expected_content_type: expected.to_string(),
        });
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RelationshipOwnerKind {
    Root,
    Workbook,
    Worksheet,
    Drawing,
    Chart,
    VmlDrawing,
    RichData,
    PivotTable,
    PivotCache,
    ExternalLink,
    OtherModeled,
}

pub(super) fn validate_known_relationship_owner(
    rel: &ResolvedPackageRelationship,
    parts: &BTreeMap<String, PackagePart>,
    errors: &mut Vec<PackageIntegrityIssue>,
) {
    let Some(owner_kind) = relationship_owner_kind(&rel.owner_rels_path, parts) else {
        return;
    };
    let rel_type = OoxmlRelationshipType::from_uri(&rel.relationship_type);
    if relationship_type_allowed_for_owner(owner_kind, &rel_type) {
        return;
    }
    errors.push(PackageIntegrityIssue::InvalidRelationshipOwner {
        rels_path: rel.owner_rels_path.clone(),
        relationship_type: rel.relationship_type.clone(),
        expected_owner: expected_owner_description(&rel_type).to_string(),
    });
}

pub(super) fn validate_relationship_target_semantic_kind(
    rel: &ResolvedPackageRelationship,
    target_path: &str,
    parts: &BTreeMap<String, PackagePart>,
    errors: &mut Vec<PackageIntegrityIssue>,
) {
    let Some(owner_kind) = relationship_owner_kind(&rel.owner_rels_path, parts) else {
        return;
    };
    let expected_kind = match (
        owner_kind,
        OoxmlRelationshipType::from_uri(&rel.relationship_type),
    ) {
        (RelationshipOwnerKind::Worksheet, OoxmlRelationshipType::Drawing) => {
            Some(domain_types::XlsxPackagePartKind::WorksheetDrawing)
        }
        (RelationshipOwnerKind::Chart, OoxmlRelationshipType::ChartUserShapes) => {
            Some(domain_types::XlsxPackagePartKind::ChartUserShapes)
        }
        (RelationshipOwnerKind::Drawing, OoxmlRelationshipType::Chart) => {
            Some(domain_types::XlsxPackagePartKind::Chart)
        }
        (RelationshipOwnerKind::Drawing, OoxmlRelationshipType::ChartEx) => {
            Some(domain_types::XlsxPackagePartKind::ChartEx)
        }
        (RelationshipOwnerKind::Drawing, OoxmlRelationshipType::Image)
        | (RelationshipOwnerKind::Chart, OoxmlRelationshipType::Image)
        | (RelationshipOwnerKind::VmlDrawing, OoxmlRelationshipType::Image) => {
            Some(domain_types::XlsxPackagePartKind::Media)
        }
        (RelationshipOwnerKind::Worksheet, OoxmlRelationshipType::Comments) => {
            Some(domain_types::XlsxPackagePartKind::Comments)
        }
        (RelationshipOwnerKind::Worksheet, OoxmlRelationshipType::ThreadedComments) => {
            Some(domain_types::XlsxPackagePartKind::ThreadedComments)
        }
        (RelationshipOwnerKind::Worksheet, OoxmlRelationshipType::VmlDrawing) => {
            Some(domain_types::XlsxPackagePartKind::VmlDrawing)
        }
        (RelationshipOwnerKind::Worksheet, OoxmlRelationshipType::Table) => {
            Some(domain_types::XlsxPackagePartKind::Table)
        }
        (RelationshipOwnerKind::Worksheet, OoxmlRelationshipType::PivotTable) => {
            Some(domain_types::XlsxPackagePartKind::PivotTable)
        }
        _ => None,
    };
    let Some(expected_kind) = expected_kind else {
        return;
    };
    let actual_kind = parts.get(target_path).and_then(|part| part.semantic_kind);
    if actual_kind == Some(expected_kind) {
        return;
    }
    errors.push(PackageIntegrityIssue::InvalidRelationshipTargetKind {
        rels_path: rel.owner_rels_path.clone(),
        relationship_type: rel.relationship_type.clone(),
        target_path: target_path.to_string(),
        actual_kind: actual_kind
            .map(|kind| format!("{kind:?}"))
            .unwrap_or_else(|| "Unclassified".to_string()),
        expected_kind: format!("{expected_kind:?}"),
    });
}

pub(super) fn validate_opaque_part_relationship_references(
    part: &PackagePart,
    relationships: &[ResolvedPackageRelationship],
    errors: &mut Vec<PackageIntegrityIssue>,
) {
    if !matches!(part.kind, PackagePartKind::Opaque) {
        return;
    }
    if !opaque_part_may_contain_xml_relationship_references(part) {
        return;
    }
    let Some(bytes) = part.bytes.as_deref() else {
        errors.push(PackageIntegrityIssue::MissingOpaquePartBytes {
            part_path: part.path.clone(),
        });
        return;
    };
    let Some(referenced_ids) = xml_relationship_reference_ids(bytes) else {
        return;
    };
    if referenced_ids.is_empty() {
        return;
    }

    let owner_rels = owner_rels_path(&super::PackageOwner::Part {
        path: part.path.clone(),
    });
    let defined_ids: HashSet<&str> = relationships
        .iter()
        .filter(|relationship| relationship.owner_rels_path == owner_rels)
        .map(|relationship| relationship.id.as_str())
        .collect();

    for relationship_id in referenced_ids {
        if !defined_ids.contains(relationship_id.as_str()) {
            errors.push(PackageIntegrityIssue::MissingOpaqueRelationshipReference {
                part_path: part.path.clone(),
                rels_path: owner_rels.clone(),
                relationship_id,
            });
        }
    }
}

fn opaque_part_may_contain_xml_relationship_references(part: &PackagePart) -> bool {
    let path = part.path.to_ascii_lowercase();
    if path.ends_with(".xml") || path.ends_with(".vml") {
        return true;
    }
    part.content_type.as_deref().is_some_and(|content_type| {
        let content_type = content_type.to_ascii_lowercase();
        content_type.contains("xml") || content_type.contains("vml")
    })
}

fn xml_relationship_reference_ids(bytes: &[u8]) -> Option<HashSet<String>> {
    let mut ids = HashSet::new();
    let mut relationship_prefixes = HashSet::from(["r".to_string()]);
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    reader.config_mut().expand_empty_elements = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(start)) | Ok(Event::Empty(start)) => {
                let attrs: Vec<(Vec<u8>, String)> = start
                    .attributes()
                    .flatten()
                    .filter_map(|attr| {
                        let key = attr.key.as_ref().to_vec();
                        let value = attr.unescape_value().ok()?.into_owned();
                        Some((key, value))
                    })
                    .collect();

                for (key, value) in &attrs {
                    if let Some(prefix) = relationship_namespace_prefix(key, value) {
                        relationship_prefixes.insert(prefix);
                    }
                }
                for (key, value) in attrs {
                    if is_relationship_reference_attr(&key, &relationship_prefixes) {
                        ids.insert(value);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(
                Event::End(_)
                | Event::Text(_)
                | Event::CData(_)
                | Event::Comment(_)
                | Event::Decl(_)
                | Event::PI(_)
                | Event::DocType(_),
            ) => {}
            Err(_) => return None,
        }
        buf.clear();
    }

    Some(ids)
}

fn relationship_namespace_prefix(key: &[u8], value: &str) -> Option<String> {
    if value != OFFICE_RELATIONSHIPS_NS {
        return None;
    }
    key.strip_prefix(b"xmlns:")
        .and_then(|prefix| std::str::from_utf8(prefix).ok())
        .filter(|prefix| !prefix.is_empty())
        .map(ToOwned::to_owned)
}

fn is_relationship_reference_attr(key: &[u8], relationship_prefixes: &HashSet<String>) -> bool {
    let Some(separator) = key.iter().position(|byte| *byte == b':') else {
        return false;
    };
    let (prefix, local_name_with_separator) = key.split_at(separator);
    let local_name = &local_name_with_separator[1..];
    let Ok(prefix) = std::str::from_utf8(prefix) else {
        return false;
    };
    relationship_prefixes.contains(prefix)
        && matches!(
            local_name,
            b"id" | b"embed" | b"link" | b"dm" | b"lo" | b"qs" | b"cs"
        )
}

fn relationship_owner_kind(
    rels_path: &str,
    parts: &BTreeMap<String, PackagePart>,
) -> Option<RelationshipOwnerKind> {
    let owner_part = owner_part_path_from_rels_path(rels_path)?;
    let Some(path) = owner_part else {
        return Some(RelationshipOwnerKind::Root);
    };
    let part = parts.get(&path)?;
    if !matches!(part.kind, PackagePartKind::Modeled) {
        return None;
    }
    if path == "xl/workbook.xml" {
        Some(RelationshipOwnerKind::Workbook)
    } else if path.starts_with("xl/worksheets/") && path.ends_with(".xml") {
        Some(RelationshipOwnerKind::Worksheet)
    } else if path.starts_with("xl/drawings/") && path.ends_with(".vml") {
        Some(RelationshipOwnerKind::VmlDrawing)
    } else if path.starts_with("xl/drawings/") && path.ends_with(".xml") {
        Some(RelationshipOwnerKind::Drawing)
    } else if path.starts_with("xl/charts/") && path.ends_with(".xml") {
        Some(RelationshipOwnerKind::Chart)
    } else if path.starts_with("xl/richData/") && path.ends_with(".xml") {
        Some(RelationshipOwnerKind::RichData)
    } else if path.starts_with("xl/pivotTables/") && path.ends_with(".xml") {
        Some(RelationshipOwnerKind::PivotTable)
    } else if path.starts_with("xl/pivotCache/pivotCacheDefinition") && path.ends_with(".xml") {
        Some(RelationshipOwnerKind::PivotCache)
    } else if path.starts_with("xl/externalLinks/") && path.ends_with(".xml") {
        Some(RelationshipOwnerKind::ExternalLink)
    } else {
        Some(RelationshipOwnerKind::OtherModeled)
    }
}

fn relationship_type_allowed_for_owner(
    owner: RelationshipOwnerKind,
    rel_type: &OoxmlRelationshipType,
) -> bool {
    use OoxmlRelationshipType as Rel;
    match rel_type {
        Rel::Unknown(_) => true,
        Rel::OfficeDocument
        | Rel::CoreProperties
        | Rel::ExtendedProperties
        | Rel::CustomProperties => owner == RelationshipOwnerKind::Root,
        Rel::Worksheet
        | Rel::Styles
        | Rel::Theme
        | Rel::SharedStrings
        | Rel::CalcChain
        | Rel::SlicerCache
        | Rel::TimelineCache
        | Rel::Metadata
        | Rel::VolatileDependencies
        | Rel::Person
        | Rel::VbaProject => owner == RelationshipOwnerKind::Workbook,
        Rel::ExternalLink => {
            matches!(
                owner,
                RelationshipOwnerKind::Workbook | RelationshipOwnerKind::Chart
            )
        }
        Rel::PivotCacheDefinition => {
            matches!(
                owner,
                RelationshipOwnerKind::Workbook | RelationshipOwnerKind::PivotTable
            )
        }
        Rel::Comments
        | Rel::ThreadedComments
        | Rel::VmlDrawing
        | Rel::Drawing
        | Rel::Table
        | Rel::TableSingleCells
        | Rel::PivotTable
        | Rel::PrinterSettings
        | Rel::CtrlProp
        | Rel::CustomProperty
        | Rel::OleObject
        | Rel::EmbeddedPackage
        | Rel::ActiveXControl
        | Rel::Slicer
        | Rel::Timeline => owner == RelationshipOwnerKind::Worksheet,
        Rel::Hyperlink => matches!(
            owner,
            RelationshipOwnerKind::Worksheet | RelationshipOwnerKind::Drawing
        ),
        Rel::ActiveXControlBinary => true,
        Rel::Image => matches!(
            owner,
            RelationshipOwnerKind::Drawing
                | RelationshipOwnerKind::Chart
                | RelationshipOwnerKind::VmlDrawing
                | RelationshipOwnerKind::RichData
        ),
        Rel::Chart
        | Rel::ChartEx
        | Rel::DiagramData
        | Rel::DiagramLayout
        | Rel::DiagramColors
        | Rel::DiagramQuickStyle
        | Rel::DiagramDrawing => owner == RelationshipOwnerKind::Drawing,
        Rel::ChartStyle | Rel::ChartColorStyle | Rel::ChartUserShapes => {
            owner == RelationshipOwnerKind::Chart
        }
        Rel::PivotCacheRecords => owner == RelationshipOwnerKind::PivotCache,
        Rel::ExternalLinkPath
        | Rel::ExternalLinkLongPath
        | Rel::XlPathMissing
        | Rel::XlLongPathMissing
        | Rel::XlStartup
        | Rel::XlAlternateStartup
        | Rel::XlLibrary
        | Rel::XlLongStartup
        | Rel::XlLongAlternateStartup
        | Rel::XlLongLibrary => {
            owner == RelationshipOwnerKind::ExternalLink
                || owner == RelationshipOwnerKind::PivotCache
        }
    }
}

fn expected_owner_description(rel_type: &OoxmlRelationshipType) -> &'static str {
    use OoxmlRelationshipType as Rel;
    match rel_type {
        Rel::OfficeDocument
        | Rel::CoreProperties
        | Rel::ExtendedProperties
        | Rel::CustomProperties => "root package relationships",
        Rel::Worksheet
        | Rel::Styles
        | Rel::Theme
        | Rel::SharedStrings
        | Rel::CalcChain
        | Rel::SlicerCache
        | Rel::TimelineCache
        | Rel::Metadata
        | Rel::VolatileDependencies
        | Rel::Person
        | Rel::VbaProject => "workbook relationships",
        Rel::ExternalLink => "workbook or chart relationships",
        Rel::PivotCacheDefinition => "workbook or pivot table relationships",
        Rel::Comments
        | Rel::ThreadedComments
        | Rel::VmlDrawing
        | Rel::Drawing
        | Rel::Table
        | Rel::TableSingleCells
        | Rel::PivotTable
        | Rel::PrinterSettings
        | Rel::CtrlProp
        | Rel::CustomProperty
        | Rel::OleObject
        | Rel::EmbeddedPackage
        | Rel::ActiveXControl
        | Rel::Slicer
        | Rel::Timeline => "worksheet relationships",
        Rel::Hyperlink => "worksheet or drawing relationships",
        Rel::ActiveXControlBinary => "ActiveX control relationships",
        Rel::Image => "drawing, chart, VML drawing, or rich data relationships",
        Rel::Chart
        | Rel::ChartEx
        | Rel::DiagramData
        | Rel::DiagramLayout
        | Rel::DiagramColors
        | Rel::DiagramQuickStyle
        | Rel::DiagramDrawing => "drawing relationships",
        Rel::ChartStyle | Rel::ChartColorStyle | Rel::ChartUserShapes => "chart relationships",
        Rel::PivotCacheRecords => "pivot cache relationships",
        Rel::ExternalLinkPath
        | Rel::ExternalLinkLongPath
        | Rel::XlPathMissing
        | Rel::XlLongPathMissing
        | Rel::XlStartup
        | Rel::XlAlternateStartup
        | Rel::XlLibrary
        | Rel::XlLongStartup
        | Rel::XlLongAlternateStartup
        | Rel::XlLongLibrary => "external link or pivot cache relationships",
        Rel::Unknown(_) => "unknown relationship owner",
    }
}

pub(super) fn validate_modeled_part_owner_relationship(
    part: &PackagePart,
    relationships: &[ResolvedPackageRelationship],
    errors: &mut Vec<PackageIntegrityIssue>,
) {
    if !matches!(part.kind, PackagePartKind::Modeled) {
        return;
    }
    let Some(required) = required_owner_relationship_for_modeled_part(part) else {
        return;
    };
    let found = relationships.iter().any(|rel| {
        required
            .rels_path
            .as_deref()
            .is_none_or(|rels_path| rel.owner_rels_path == rels_path)
            && (rel.relationship_type == required.relationship_type
                || (required.relationship_type == REL_THEME
                    && crate::infra::opc::is_theme_relationship_type(&rel.relationship_type))
                || OoxmlRelationshipType::from_uri(&rel.relationship_type)
                    == OoxmlRelationshipType::from_uri(required.relationship_type))
            && !is_external_target_mode(rel.target_mode.as_deref())
            && relationship_target_part_path(&rel.owner_rels_path, &rel.target)
                .ok()
                .flatten()
                .as_deref()
                == Some(part.path.as_str())
    });
    if !found {
        errors.push(PackageIntegrityIssue::MissingRequiredRelationship {
            rels_path: required.rels_path.unwrap_or_else(|| "*".to_string()),
            relationship_type: required.relationship_type.to_string(),
            target_path: part.path.clone(),
        });
    }
}

struct RequiredRelationship {
    rels_path: Option<String>,
    relationship_type: &'static str,
}

fn required_owner_relationship_for_modeled_part(
    part: &PackagePart,
) -> Option<RequiredRelationship> {
    let path = part.path.as_str();
    let workbook_rels = "xl/_rels/workbook.xml.rels";

    if path == "xl/workbook.xml" {
        return Some(RequiredRelationship {
            rels_path: Some("_rels/.rels".to_string()),
            relationship_type: REL_OFFICE_DOCUMENT,
        });
    }
    if path == "docProps/core.xml" {
        return Some(RequiredRelationship {
            rels_path: Some("_rels/.rels".to_string()),
            relationship_type: REL_CORE_PROPERTIES,
        });
    }
    if path == "docProps/app.xml" {
        return Some(RequiredRelationship {
            rels_path: Some("_rels/.rels".to_string()),
            relationship_type: REL_EXTENDED_PROPERTIES,
        });
    }
    if path == "docProps/custom.xml" {
        return Some(RequiredRelationship {
            rels_path: Some("_rels/.rels".to_string()),
            relationship_type: REL_CUSTOM_PROPERTIES,
        });
    }
    if path.starts_with("xl/worksheets/sheet") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_WORKSHEET,
        });
    }
    if path == "xl/sharedStrings.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_SHARED_STRINGS,
        });
    }
    if path == "xl/styles.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_STYLES,
        });
    }
    if path.starts_with("xl/theme/") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_THEME,
        });
    }
    if path == "xl/metadata.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_METADATA,
        });
    }
    if path == "xl/persons/person.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_PERSON,
        });
    }
    if path.starts_with("xl/externalLinks/externalLink") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_EXTERNAL_LINK,
        });
    }
    if path == "xl/connections.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_CONNECTIONS,
        });
    }
    if path == "xl/volatileDependencies.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: crate::infra::opc::REL_VOLATILE_DEPENDENCIES,
        });
    }
    if path.starts_with("xl/pivotCache/pivotCacheDefinition") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_PIVOT_CACHE,
        });
    }
    if path.starts_with("xl/slicerCaches/slicerCache") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_SLICER_CACHE,
        });
    }
    if path.starts_with("xl/timelineCaches/timelineCache") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: crate::infra::opc::REL_TIMELINE_CACHE,
        });
    }
    if part.semantic_kind == Some(domain_types::XlsxPackagePartKind::ChartUserShapes) {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: crate::infra::opc::REL_CHART_USER_SHAPES,
        });
    }
    if let Some(relationship_type) = relationship_type_for_worksheet_child(path) {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type,
        });
    }
    if path.starts_with("xl/charts/chartEx") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: REL_CHART_EX,
        });
    }
    if path.starts_with("xl/charts/chart") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: REL_CHART,
        });
    }
    if path.starts_with("xl/charts/style") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: "http://schemas.microsoft.com/office/2011/relationships/chartStyle",
        });
    }
    if path.starts_with("xl/charts/color") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle",
        });
    }
    if path.starts_with("xl/media/") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: REL_IMAGE,
        });
    }
    if path.starts_with("xl/queryTables/queryTable") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: REL_QUERY_TABLE,
        });
    }
    if path.starts_with("xl/pivotCache/pivotCacheRecords") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: REL_PIVOT_CACHE_RECORDS,
        });
    }

    None
}

fn required_content_type_for_modeled_part(path: &str) -> Option<&'static str> {
    if path == "xl/workbook.xml" {
        Some(CT_WORKBOOK)
    } else if path.starts_with("xl/worksheets/sheet") && path.ends_with(".xml") {
        Some(CT_WORKSHEET)
    } else if path == "xl/sharedStrings.xml" {
        Some(CT_SHARED_STRINGS)
    } else if path == "xl/styles.xml" {
        Some(CT_STYLES)
    } else if path.starts_with("xl/theme/") && path.ends_with(".xml") {
        Some(CT_THEME)
    } else if path == "docProps/core.xml" {
        Some(CT_CORE_PROPERTIES)
    } else if path == "docProps/app.xml" {
        Some(CT_EXTENDED_PROPERTIES)
    } else if path == "docProps/custom.xml" {
        Some(CT_CUSTOM_PROPERTIES)
    } else if path == "xl/metadata.xml" {
        Some(CT_METADATA)
    } else if path.starts_with("xl/tables/tableSingleCells") && path.ends_with(".xml") {
        Some(CT_TABLE_SINGLE_CELLS)
    } else if path.starts_with("xl/tables/table") && path.ends_with(".xml") {
        Some(CT_TABLE)
    } else if path == "xl/connections.xml" {
        Some(CT_CONNECTIONS)
    } else if path == "xl/volatileDependencies.xml" {
        Some(CT_VOLATILE_DEPENDENCIES)
    } else if path.starts_with("xl/queryTables/queryTable") && path.ends_with(".xml") {
        Some(CT_QUERY_TABLE)
    } else if path.starts_with("xl/slicers/slicer") && path.ends_with(".xml") {
        Some(CT_SLICER)
    } else if path.starts_with("xl/slicerCaches/slicerCache") && path.ends_with(".xml") {
        Some(CT_SLICER_CACHE)
    } else if path.starts_with("xl/timelines/timeline") && path.ends_with(".xml") {
        Some(CT_TIMELINE)
    } else if path.starts_with("xl/timelineCaches/timelineCache") && path.ends_with(".xml") {
        Some(CT_TIMELINE_CACHE)
    } else if path.starts_with("xl/comments") && path.ends_with(".xml") {
        Some(CT_COMMENTS)
    } else if path.starts_with("xl/threadedComments/threadedComment") && path.ends_with(".xml") {
        Some(CT_THREADED_COMMENTS)
    } else if path.starts_with("xl/customProperty/") && path.ends_with(".xml") {
        Some(CT_WORKSHEET_CUSTOM_PROPERTY)
    } else if path.starts_with("xl/drawings/drawing") && path.ends_with(".xml") {
        Some(CT_DRAWING)
    } else if path.starts_with("xl/charts/chartEx") && path.ends_with(".xml") {
        Some(CT_CHART_EX)
    } else if path.starts_with("xl/charts/chart") && path.ends_with(".xml") {
        Some(CT_CHART)
    } else if path.starts_with("xl/charts/style") && path.ends_with(".xml") {
        Some(CT_CHART_STYLE)
    } else if path.starts_with("xl/charts/color") && path.ends_with(".xml") {
        Some(CT_CHART_COLOR_STYLE)
    } else if path.starts_with("xl/ctrlProps/ctrlProp") && path.ends_with(".xml") {
        Some(CONTENT_TYPE_CTRL_PROP)
    } else if path.starts_with("xl/embeddings/") && path.ends_with(".bin") {
        Some(CT_OLE_OBJECT)
    } else if path.starts_with("xl/pivotTables/pivotTable") && path.ends_with(".xml") {
        Some(CT_PIVOT_TABLE)
    } else if path.starts_with("xl/pivotCache/pivotCacheDefinition") && path.ends_with(".xml") {
        Some(CT_PIVOT_CACHE)
    } else if path.starts_with("xl/pivotCache/pivotCacheRecords") && path.ends_with(".xml") {
        Some(CT_PIVOT_CACHE_RECORDS)
    } else if path == "docMetadata/LabelInfo.xml" {
        Some(CT_DOC_METADATA_LABEL_INFO)
    } else {
        None
    }
}

fn relationship_type_for_worksheet_child(path: &str) -> Option<&'static str> {
    if path.starts_with("xl/tables/tableSingleCells") && path.ends_with(".xml") {
        Some(REL_TABLE_SINGLE_CELLS)
    } else if path.starts_with("xl/tables/table") && path.ends_with(".xml") {
        Some(REL_TABLE)
    } else if path.starts_with("xl/slicers/slicer") && path.ends_with(".xml") {
        Some(REL_SLICER)
    } else if path.starts_with("xl/timelines/timeline") && path.ends_with(".xml") {
        Some(crate::infra::opc::REL_TIMELINE)
    } else if path.starts_with("xl/comments") && path.ends_with(".xml") {
        Some(REL_COMMENTS)
    } else if path.starts_with("xl/threadedComments/threadedComment") && path.ends_with(".xml") {
        Some(REL_THREADED_COMMENT)
    } else if path.starts_with("xl/customProperty/") && path.ends_with(".xml") {
        Some(REL_WORKSHEET_CUSTOM_PROPERTY)
    } else if path.starts_with("xl/drawings/drawing") && path.ends_with(".xml") {
        Some(REL_DRAWING)
    } else if path.starts_with("xl/ctrlProps/ctrlProp") && path.ends_with(".xml") {
        Some(REL_CTRL_PROP)
    } else if path.starts_with("xl/pivotTables/pivotTable") && path.ends_with(".xml") {
        Some(REL_PIVOT_TABLE)
    } else if path.starts_with("xl/printerSettings/printerSettings") && path.ends_with(".bin") {
        Some(REL_PRINTER_SETTINGS)
    } else if path.starts_with("xl/drawings/vmlDrawing") && path.ends_with(".vml") {
        Some(REL_VML_DRAWING)
    } else if path.starts_with("xl/embeddings/") && path.ends_with(".bin") {
        Some(REL_OLE_OBJECT)
    } else {
        None
    }
}
