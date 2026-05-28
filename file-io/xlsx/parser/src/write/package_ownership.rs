//! Round-6 package graph ownership contract.
//!
//! This matrix is the writer-side authority for deciding whether an OOXML
//! package cluster is modeled by Mog or can remain an unknown opaque extension.

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PackageFeatureOwner {
    CoreWorkbook,
    WorksheetTables,
    ConnectionsAndQueryTables,
    OleObjects,
    RichData,
    PivotTables,
    SlicersAndTimelines,
    ChartAuxiliary,
    ExternalLinks,
    DocumentProperties,
    DrawingObjects,
    Comments,
    ThreadedComments,
    Controls,
    PrintSettings,
    Hyperlinks,
    Media,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PackageOwnershipContract {
    pub owner: PackageFeatureOwner,
    pub owner_domain: &'static str,
    pub parts: &'static [&'static str],
    pub relationships: &'static [&'static str],
    pub content_types: &'static [&'static str],
    pub relationship_id_hints: &'static [&'static str],
    pub dirty_invalidation_triggers: &'static [&'static str],
    pub opaque_policy: &'static str,
}

pub const PACKAGE_OWNERSHIP_MATRIX: &[PackageOwnershipContract] = &[
    PackageOwnershipContract {
        owner: PackageFeatureOwner::CoreWorkbook,
        owner_domain: "workbook",
        parts: &[
            "xl/workbook.xml",
            "xl/worksheets/sheet*.xml",
            "xl/styles.xml",
            "xl/theme/theme1.xml",
            "xl/sharedStrings.xml",
            "xl/metadata.xml",
            "xl/persons/person.xml",
        ],
        relationships: &[
            "officeDocument",
            "worksheet",
            "styles",
            "theme",
            "sharedStrings",
            "sheetMetadata",
            "person",
        ],
        content_types: &[
            "workbook",
            "worksheet",
            "styles",
            "theme",
            "sharedStrings",
            "sheetMetadata",
            "person",
        ],
        relationship_id_hints: &["sheet order", "workbook relationship allocation"],
        dirty_invalidation_triggers: &[
            "sheet add/delete/reorder",
            "style registry mutation",
            "theme mutation",
            "cell text mutation",
            "metadata mutation",
            "threaded comment person mutation",
        ],
        opaque_policy: "modeled core parts are regenerated from typed workbook/sheet state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::WorksheetTables,
        owner_domain: "tables",
        parts: &["xl/tables/table*.xml"],
        relationships: &["worksheet -> table"],
        content_types: &["table"],
        relationship_id_hints: &["table relationship id when imported"],
        dirty_invalidation_triggers: &["table create/update/delete", "table range mutation"],
        opaque_policy: "table package parts require typed SheetData.tables state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::ConnectionsAndQueryTables,
        owner_domain: "connections/queryTables",
        parts: &[
            "xl/connections.xml",
            "xl/queryTables/queryTable*.xml",
            "xl/tables/table*.xml connectionId/queryTableFieldId",
        ],
        relationships: &["workbook -> connections", "table -> queryTable"],
        content_types: &["connections", "queryTable"],
        relationship_id_hints: &["connection id", "query table relationship id"],
        dirty_invalidation_triggers: &[
            "connection create/update/delete",
            "query table definition mutation",
            "table connection binding mutation",
        ],
        opaque_policy:
            "known connection/query-table clusters must be emitted only from typed owner state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::OleObjects,
        owner_domain: "ole",
        parts: &["xl/embeddings/oleObject*.bin", "worksheet <oleObjects>"],
        relationships: &["worksheet -> oleObject"],
        content_types: &["oleObject binary default"],
        relationship_id_hints: &["OLE r:id from worksheet objectPr/oleObject"],
        dirty_invalidation_triggers: &["OLE object add/delete/update", "embedded binary mutation"],
        opaque_policy: "OLE package parts require typed worksheet OleObject state and binary data",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::RichData,
        owner_domain: "richData",
        parts: &[
            "xl/richData/rdrichvalue*.xml",
            "xl/richData/rdRichValueTypes.xml",
            "xl/richData/richValueRel.xml",
            "xl/metadata.xml value metadata",
        ],
        relationships: &["workbook -> richData", "richData -> richValueRel"],
        content_types: &["richData", "richValueTypes", "richValueRel"],
        relationship_id_hints: &["metadata vm index", "rich value relationship id"],
        dirty_invalidation_triggers: &["rich data value mutation", "cell vm metadata mutation"],
        opaque_policy: "richData clusters require typed WorkbookRichData and metadata references",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::PivotTables,
        owner_domain: "pivot",
        parts: &[
            "xl/pivotTables/pivotTable*.xml",
            "xl/pivotCache/pivotCacheDefinition*.xml",
            "xl/pivotCache/pivotCacheRecords*.xml",
        ],
        relationships: &[
            "worksheet -> pivotTable",
            "workbook -> pivotCacheDefinition",
            "pivotTable -> pivotCacheDefinition",
            "pivotCacheDefinition -> pivotCacheRecords",
        ],
        content_types: &["pivotTable", "pivotCacheDefinition", "pivotCacheRecords"],
        relationship_id_hints: &["worksheet pivot r:id", "pivot table cache rId1"],
        dirty_invalidation_triggers: &[
            "pivot definition mutation",
            "pivot source range mutation",
            "pivot cache record mutation",
        ],
        opaque_policy: "pivot package parts require typed ParsedPivotTable/cache state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::SlicersAndTimelines,
        owner_domain: "slicers/timelines",
        parts: &[
            "xl/slicers/slicer*.xml",
            "xl/slicerCaches/slicerCache*.xml",
            "xl/timelines/timeline*.xml",
            "xl/timelineCaches/timelineCache*.xml",
            "worksheet slicer drawing anchors",
        ],
        relationships: &[
            "worksheet -> slicer",
            "workbook -> slicerCache",
            "drawing -> slicer",
            "worksheet/workbook -> timeline",
        ],
        content_types: &["slicer", "slicerCache", "timeline", "timelineCache"],
        relationship_id_hints: &["slicer relationship id", "cache relationship id"],
        dirty_invalidation_triggers: &[
            "slicer create/update/delete",
            "slicer cache mutation",
            "timeline create/update/delete",
            "bound table/pivot mutation",
        ],
        opaque_policy: "slicer/timeline clusters require typed slicer/cache owner state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::ChartAuxiliary,
        owner_domain: "chart auxiliary",
        parts: &[
            "xl/charts/style*.xml",
            "xl/charts/colors*.xml",
            "xl/drawings/userShapeDrawing*.xml",
        ],
        relationships: &[
            "chart -> chartStyle",
            "chart -> chartColorStyle",
            "chart -> chartUserShapes",
        ],
        content_types: &["chartStyle", "chartColorStyle", "drawing"],
        relationship_id_hints: &["chart-owned auxiliary r:id"],
        dirty_invalidation_triggers: &[
            "chart style/color mutation",
            "chart user-shapes mutation",
            "chart definition replacement",
        ],
        opaque_policy: "chart auxiliary parts require typed chart auxiliary data",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::ExternalLinks,
        owner_domain: "external links",
        parts: &["xl/externalLinks/externalLink*.xml"],
        relationships: &[
            "workbook -> externalLink",
            "externalLink -> externalLinkPath/longPath/missing/startup/library",
        ],
        content_types: &["externalLink"],
        relationship_id_hints: &["workbook externalLink r:id", "externalLink owned path r:id"],
        dirty_invalidation_triggers: &[
            "external link add/update/delete",
            "defined name/formula external reference mutation",
        ],
        opaque_policy: "external link package parts require typed ExternalLink state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::DocumentProperties,
        owner_domain: "docProps",
        parts: &[
            "docProps/core.xml",
            "docProps/app.xml",
            "docProps/custom.xml",
            "docMetadata/LabelInfo.xml",
        ],
        relationships: &[
            "root -> core-properties",
            "root -> extended-properties",
            "root -> custom-properties",
        ],
        content_types: &[
            "core properties",
            "extended properties",
            "custom properties",
            "label info",
        ],
        relationship_id_hints: &["root docProps r:id allocation"],
        dirty_invalidation_triggers: &[
            "document properties mutation",
            "extended properties mutation",
            "custom properties mutation",
            "sensitivity label mutation",
        ],
        opaque_policy: "docProps parts require typed properties owner state",
    },
];

pub fn ownership_contract(owner: PackageFeatureOwner) -> &'static PackageOwnershipContract {
    PACKAGE_OWNERSHIP_MATRIX
        .iter()
        .find(|contract| contract.owner == owner)
        .expect("package ownership matrix must cover every PackageFeatureOwner")
}

pub fn modeled_owner_for_part(path: &str) -> Option<PackageFeatureOwner> {
    let path = path.trim_start_matches('/');
    if matches!(
        path,
        "xl/workbook.xml"
            | "xl/styles.xml"
            | "xl/theme/theme1.xml"
            | "xl/sharedStrings.xml"
            | "xl/metadata.xml"
            | "xl/persons/person.xml"
    ) || (path.starts_with("xl/worksheets/sheet") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::CoreWorkbook)
    } else if path.starts_with("xl/tables/table") && path.ends_with(".xml") {
        Some(PackageFeatureOwner::WorksheetTables)
    } else if path == "xl/connections.xml"
        || (path.starts_with("xl/queryTables/queryTable") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::ConnectionsAndQueryTables)
    } else if path.starts_with("xl/embeddings/oleObject") && path.ends_with(".bin") {
        Some(PackageFeatureOwner::OleObjects)
    } else if path.starts_with("xl/richData/") {
        Some(PackageFeatureOwner::RichData)
    } else if (path.starts_with("xl/pivotTables/pivotTable") && path.ends_with(".xml"))
        || (path.starts_with("xl/pivotCache/pivotCacheDefinition") && path.ends_with(".xml"))
        || (path.starts_with("xl/pivotCache/pivotCacheRecords") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::PivotTables)
    } else if (path.starts_with("xl/slicers/slicer") && path.ends_with(".xml"))
        || (path.starts_with("xl/slicerCaches/slicerCache") && path.ends_with(".xml"))
        || (path.starts_with("xl/timelines/timeline") && path.ends_with(".xml"))
        || (path.starts_with("xl/timelineCaches/timelineCache") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::SlicersAndTimelines)
    } else if (path.starts_with("xl/charts/style") && path.ends_with(".xml"))
        || (path.starts_with("xl/charts/color") && path.ends_with(".xml"))
        || (path.starts_with("xl/drawings/userShapeDrawing") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::ChartAuxiliary)
    } else if path.starts_with("xl/externalLinks/externalLink") && path.ends_with(".xml") {
        Some(PackageFeatureOwner::ExternalLinks)
    } else if (path.starts_with("xl/comments") && path.ends_with(".xml"))
        || (path.starts_with("xl/drawings/vmlDrawing") && path.ends_with(".vml"))
    {
        Some(PackageFeatureOwner::Comments)
    } else if path.starts_with("xl/threadedComments/threadedComment") && path.ends_with(".xml") {
        Some(PackageFeatureOwner::ThreadedComments)
    } else if matches!(
        path,
        "docProps/core.xml"
            | "docProps/app.xml"
            | "docProps/custom.xml"
            | "docMetadata/LabelInfo.xml"
    ) {
        Some(PackageFeatureOwner::DocumentProperties)
    } else {
        None
    }
}

pub fn modeled_feature_part_must_not_be_opaque(path: &str) -> bool {
    modeled_owner_for_part(path).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_6_feature_ownership_matrix_is_complete() {
        for owner in [
            PackageFeatureOwner::ConnectionsAndQueryTables,
            PackageFeatureOwner::OleObjects,
            PackageFeatureOwner::RichData,
            PackageFeatureOwner::PivotTables,
            PackageFeatureOwner::SlicersAndTimelines,
            PackageFeatureOwner::ChartAuxiliary,
            PackageFeatureOwner::ExternalLinks,
            PackageFeatureOwner::DocumentProperties,
        ] {
            let contract = ownership_contract(owner);
            assert!(!contract.owner_domain.is_empty());
            assert!(!contract.parts.is_empty());
            assert!(!contract.relationships.is_empty());
            assert!(!contract.content_types.is_empty());
            assert!(!contract.relationship_id_hints.is_empty());
            assert!(!contract.dirty_invalidation_triggers.is_empty());
            assert!(contract.opaque_policy.contains("typed"));
        }
    }

    #[test]
    fn modeled_feature_package_parts_are_not_opaque_candidates() {
        for (path, owner) in [
            (
                "xl/queryTables/queryTable1.xml",
                PackageFeatureOwner::ConnectionsAndQueryTables,
            ),
            (
                "xl/embeddings/oleObject1.bin",
                PackageFeatureOwner::OleObjects,
            ),
            ("xl/richData/rdrichvalue.xml", PackageFeatureOwner::RichData),
            (
                "xl/pivotTables/pivotTable1.xml",
                PackageFeatureOwner::PivotTables,
            ),
            (
                "xl/slicerCaches/slicerCache1.xml",
                PackageFeatureOwner::SlicersAndTimelines,
            ),
            ("xl/charts/style1.xml", PackageFeatureOwner::ChartAuxiliary),
            (
                "xl/externalLinks/externalLink1.xml",
                PackageFeatureOwner::ExternalLinks,
            ),
            (
                "docProps/custom.xml",
                PackageFeatureOwner::DocumentProperties,
            ),
        ] {
            assert_eq!(modeled_owner_for_part(path), Some(owner));
            assert!(modeled_feature_part_must_not_be_opaque(path));
        }
    }

    #[test]
    fn unknown_owner_clusters_can_remain_opaque_candidates() {
        assert_eq!(
            modeled_owner_for_part("xl/vendorExtensions/vendor1.xml"),
            None
        );
        assert!(!modeled_feature_part_must_not_be_opaque(
            "xl/vendorExtensions/vendor1.xml"
        ));
    }
}
