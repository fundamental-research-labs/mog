use super::*;

fn archive_for_empty_modeled_workbook() -> crate::XlsxArchive<'static> {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let leaked = Box::leak(bytes.into_boxed_slice());
    crate::XlsxArchive::new(leaked).expect("exported XLSX should be readable")
}

#[test]
fn package_graph_ownership_matrix_covers_round_6_feature_plans() {
    use crate::write::package_ownership::{
        PackageFeatureOwner, modeled_feature_part_must_not_be_opaque, ownership_contract,
    };

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
        assert!(!contract.parts.is_empty());
        assert!(!contract.relationships.is_empty());
        assert!(!contract.content_types.is_empty());
        assert!(!contract.relationship_id_hints.is_empty());
        assert!(!contract.dirty_invalidation_triggers.is_empty());
    }

    for modeled_part in [
        "xl/connections.xml",
        "xl/queryTables/queryTable1.xml",
        "xl/embeddings/oleObject1.bin",
        "xl/richData/rdrichvalue.xml",
        "xl/pivotTables/pivotTable1.xml",
        "xl/slicerCaches/slicerCache1.xml",
        "xl/charts/style1.xml",
        "xl/externalLinks/externalLink1.xml",
        "docProps/custom.xml",
    ] {
        assert!(modeled_feature_part_must_not_be_opaque(modeled_part));
    }
}

#[test]
fn modeled_feature_package_subgraphs_require_typed_owner_state() {
    let archive = archive_for_empty_modeled_workbook();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    for absent_part in [
        "xl/connections.xml",
        "xl/queryTables/queryTable1.xml",
        "xl/embeddings/oleObject1.bin",
        "xl/richData/rdrichvalue.xml",
        "xl/pivotTables/pivotTable1.xml",
        "xl/pivotCache/pivotCacheDefinition1.xml",
        "xl/pivotCache/pivotCacheRecords1.xml",
        "xl/slicers/slicer1.xml",
        "xl/slicerCaches/slicerCache1.xml",
        "xl/charts/style1.xml",
        "xl/externalLinks/externalLink1.xml",
        "docProps/core.xml",
        "docProps/app.xml",
        "docProps/custom.xml",
        "docMetadata/LabelInfo.xml",
    ] {
        assert!(!archive.contains(absent_part), "{absent_part} must require typed owner state");
        assert!(
            !content_types.contains(absent_part),
            "{absent_part} content type must require typed owner state"
        );
    }

    for absent_relationship in [
        "relationships/connections",
        "relationships/externalLink",
        "relationships/pivotCacheDefinition",
        "relationships/slicerCache",
        "relationships/core-properties",
        "relationships/extended-properties",
        "relationships/custom-properties",
    ] {
        assert!(
            !workbook_rels.contains(absent_relationship),
            "{absent_relationship} must require typed owner state"
        );
    }

    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
