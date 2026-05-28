use std::collections::BTreeMap;

use super::{
    CONTENT_TYPE_CTRL_PROP, CT_CHART, CT_CHART_COLOR_STYLE, CT_CHART_EX, CT_CHART_STYLE,
    CT_COMMENTS, CT_CONNECTIONS, CT_CORE_PROPERTIES, CT_CUSTOM_PROPERTIES,
    CT_DOC_METADATA_LABEL_INFO, CT_DRAWING, CT_EXTENDED_PROPERTIES, CT_METADATA, CT_OLE_OBJECT,
    CT_PIVOT_CACHE, CT_PIVOT_CACHE_RECORDS, CT_PIVOT_TABLE, CT_QUERY_TABLE, CT_SHARED_STRINGS,
    CT_SLICER, CT_SLICER_CACHE, CT_STYLES, CT_TABLE, CT_THEME, CT_THREADED_COMMENTS, CT_WORKBOOK,
    CT_WORKSHEET, CT_WORKSHEET_CUSTOM_PROPERTY, PackageIntegrityIssue, PackagePart,
    PackagePartKind, REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CONNECTIONS, REL_CORE_PROPERTIES,
    REL_CTRL_PROP, REL_CUSTOM_PROPERTIES, REL_DRAWING, REL_EXTENDED_PROPERTIES, REL_EXTERNAL_LINK,
    REL_IMAGE, REL_METADATA, REL_OFFICE_DOCUMENT, REL_OLE_OBJECT, REL_PERSON, REL_PIVOT_CACHE,
    REL_PIVOT_CACHE_DEFINITION, REL_PIVOT_CACHE_RECORDS, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS,
    REL_QUERY_TABLE, REL_SHARED_STRINGS, REL_SLICER, REL_SLICER_CACHE, REL_STYLES, REL_TABLE,
    REL_THEME, REL_THREADED_COMMENT, REL_VML_DRAWING, REL_WORKSHEET, REL_WORKSHEET_CUSTOM_PROPERTY,
    ResolvedPackageRelationship, owner_part_path_from_rels_path, relationship_target_part_path,
};
use crate::infra::opc::OoxmlRelationshipType;

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
        | Rel::PivotTable
        | Rel::Hyperlink
        | Rel::PrinterSettings
        | Rel::CtrlProp
        | Rel::CustomProperty
        | Rel::OleObject
        | Rel::Slicer
        | Rel::Timeline => owner == RelationshipOwnerKind::Worksheet,
        Rel::Image => matches!(
            owner,
            RelationshipOwnerKind::Drawing
                | RelationshipOwnerKind::Chart
                | RelationshipOwnerKind::VmlDrawing
        ),
        Rel::Chart
        | Rel::ChartEx
        | Rel::DiagramData
        | Rel::DiagramLayout
        | Rel::DiagramColors
        | Rel::DiagramQuickStyle
        | Rel::DiagramDrawing => owner == RelationshipOwnerKind::Drawing,
        Rel::ChartStyle | Rel::ChartColorStyle => owner == RelationshipOwnerKind::Chart,
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
        | Rel::XlLongLibrary => owner == RelationshipOwnerKind::ExternalLink,
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
        | Rel::Person
        | Rel::VbaProject => "workbook relationships",
        Rel::ExternalLink => "workbook or chart relationships",
        Rel::PivotCacheDefinition => "workbook or pivot table relationships",
        Rel::Comments
        | Rel::ThreadedComments
        | Rel::VmlDrawing
        | Rel::Drawing
        | Rel::Table
        | Rel::PivotTable
        | Rel::Hyperlink
        | Rel::PrinterSettings
        | Rel::CtrlProp
        | Rel::CustomProperty
        | Rel::OleObject
        | Rel::Slicer
        | Rel::Timeline => "worksheet relationships",
        Rel::Image => "drawing, chart, or VML drawing relationships",
        Rel::Chart
        | Rel::ChartEx
        | Rel::DiagramData
        | Rel::DiagramLayout
        | Rel::DiagramColors
        | Rel::DiagramQuickStyle
        | Rel::DiagramDrawing => "drawing relationships",
        Rel::ChartStyle | Rel::ChartColorStyle => "chart relationships",
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
        | Rel::XlLongLibrary => "external link relationships",
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
    let Some(required) = required_owner_relationship_for_modeled_part(&part.path) else {
        return;
    };
    let found = relationships.iter().any(|rel| {
        required
            .rels_path
            .as_deref()
            .is_none_or(|rels_path| rel.owner_rels_path == rels_path)
            && rel.relationship_type == required.relationship_type
            && rel.target_mode.as_deref() != Some("External")
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

fn required_owner_relationship_for_modeled_part(path: &str) -> Option<RequiredRelationship> {
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
    if path == "xl/theme/theme1.xml" {
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
        let idx = path
            .trim_start_matches("xl/pivotCache/pivotCacheRecords")
            .trim_end_matches(".xml");
        return Some(RequiredRelationship {
            rels_path: Some(format!(
                "xl/pivotCache/_rels/pivotCacheDefinition{idx}.xml.rels"
            )),
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
    } else if path == "xl/theme/theme1.xml" {
        Some(CT_THEME)
    } else if path == "docProps/core.xml" {
        Some(CT_CORE_PROPERTIES)
    } else if path == "docProps/app.xml" {
        Some(CT_EXTENDED_PROPERTIES)
    } else if path == "docProps/custom.xml" {
        Some(CT_CUSTOM_PROPERTIES)
    } else if path == "xl/metadata.xml" {
        Some(CT_METADATA)
    } else if path.starts_with("xl/tables/table") && path.ends_with(".xml") {
        Some(CT_TABLE)
    } else if path == "xl/connections.xml" {
        Some(CT_CONNECTIONS)
    } else if path.starts_with("xl/queryTables/queryTable") && path.ends_with(".xml") {
        Some(CT_QUERY_TABLE)
    } else if path.starts_with("xl/slicers/slicer") && path.ends_with(".xml") {
        Some(CT_SLICER)
    } else if path.starts_with("xl/slicerCaches/slicerCache") && path.ends_with(".xml") {
        Some(CT_SLICER_CACHE)
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
    if path.starts_with("xl/tables/table") && path.ends_with(".xml") {
        Some(REL_TABLE)
    } else if path.starts_with("xl/slicers/slicer") && path.ends_with(".xml") {
        Some(REL_SLICER)
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
