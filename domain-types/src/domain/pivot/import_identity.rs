use super::ooxml::ParsedPivotTable;

const IMPORTED_PIVOT_NAMESPACE: uuid::Uuid =
    uuid::Uuid::from_u128(0x7069766f745f696d706f72745f6d6f67);

#[derive(Debug, Clone, Copy)]
pub struct ImportedPivotOoxmlIdentityParts<'a> {
    pub output_worksheet_part_path: Option<&'a str>,
    pub output_worksheet_relationship_id: Option<&'a str>,
    pub definition_part_path: Option<&'a str>,
    pub pivot_cache_relationship_id: Option<&'a str>,
    pub cache_id: Option<u32>,
}

pub fn imported_pivot_ooxml_identity(parts: ImportedPivotOoxmlIdentityParts<'_>) -> Option<String> {
    let output_worksheet_part_path = parts.output_worksheet_part_path?;
    let output_worksheet_relationship_id = parts.output_worksheet_relationship_id?;
    let definition_part_path = parts.definition_part_path?;

    Some(format!(
        "ooxml:outputWorksheetPartPath={};worksheetRelationshipId={};definitionPartPath={};pivotCacheRelationshipId={};cacheId={}",
        output_worksheet_part_path,
        output_worksheet_relationship_id,
        definition_part_path,
        parts.pivot_cache_relationship_id.unwrap_or_default(),
        parts.cache_id.unwrap_or_default(),
    ))
}

pub fn import_identity_for_parsed_pivot(pivot_spec_key: &str, parsed: &ParsedPivotTable) -> String {
    let preservation = &parsed.ooxml_preservation;
    let relationship = preservation.relationship.as_ref();
    let definition_part_path = preservation
        .definition_part_path
        .as_deref()
        .or_else(|| relationship.and_then(|rel| rel.part_path.as_deref()));

    if let Some(identity) = imported_pivot_ooxml_identity(ImportedPivotOoxmlIdentityParts {
        output_worksheet_part_path: preservation.output_worksheet_part_path.as_deref(),
        output_worksheet_relationship_id: preservation.output_worksheet_relationship_id.as_deref(),
        definition_part_path,
        pivot_cache_relationship_id: relationship.and_then(|rel| rel.relationship_id.as_deref()),
        cache_id: parsed.config.cache_id,
    }) {
        return identity;
    }

    format!(
        "legacy:pivotSpecKey={};name={};outputSheet={};cacheId={};refRange={}",
        pivot_spec_key,
        parsed.config.name,
        parsed.config.output_sheet_name,
        parsed.config.cache_id.unwrap_or_default(),
        parsed.config.ref_range.as_deref().unwrap_or_default(),
    )
}

pub fn native_imported_pivot_id(import_identity: &str) -> String {
    let uuid = uuid::Uuid::new_v5(&IMPORTED_PIVOT_NAMESPACE, import_identity.as_bytes());
    format!("pivot-imported-{}", uuid.simple())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ooxml_identity_matches_import_contract() {
        let identity = imported_pivot_ooxml_identity(ImportedPivotOoxmlIdentityParts {
            output_worksheet_part_path: Some("xl/worksheets/sheet2.xml"),
            output_worksheet_relationship_id: Some("rIdPT1"),
            definition_part_path: Some("xl/pivotTables/pivotTable1.xml"),
            pivot_cache_relationship_id: Some("rId1"),
            cache_id: Some(1),
        })
        .expect("identity");

        assert_eq!(
            identity,
            "ooxml:outputWorksheetPartPath=xl/worksheets/sheet2.xml;worksheetRelationshipId=rIdPT1;definitionPartPath=xl/pivotTables/pivotTable1.xml;pivotCacheRelationshipId=rId1;cacheId=1"
        );
    }

    #[test]
    fn native_id_is_deterministic_uuid_v5() {
        let identity = "ooxml:outputWorksheetPartPath=xl/worksheets/sheet2.xml;worksheetRelationshipId=rIdPT1;definitionPartPath=xl/pivotTables/pivotTable1.xml;pivotCacheRelationshipId=rId1;cacheId=1";

        assert_eq!(
            native_imported_pivot_id(identity),
            native_imported_pivot_id(identity)
        );
        assert!(native_imported_pivot_id(identity).starts_with("pivot-imported-"));
        assert_eq!(
            native_imported_pivot_id(identity).len(),
            "pivot-imported-".len() + 32
        );
    }
}
