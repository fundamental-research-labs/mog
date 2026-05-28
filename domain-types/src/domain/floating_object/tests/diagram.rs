use crate::domain::floating_object::DiagramData;
use crate::domain::smartart::{SmartArtCategory, SmartArtDefinition};

#[test]
fn test_diagram_definition_roundtrip() {
    let diagram = DiagramData {
        definition: SmartArtDefinition {
            original_id: Some(42),
            dm_rel_id: Some("rId1".to_string()),
            lo_rel_id: Some("rId2".to_string()),
            qs_rel_id: None,
            cs_rel_id: None,
            data_xml: Some("<dgm:dataModel/>".to_string()),
            layout_xml: None,
            colors_xml: None,
            style_xml: None,
            drawing_xml: None,
        },
        category: Some(SmartArtCategory::Hierarchy),
    };
    let json = serde_json::to_string(&diagram).unwrap();
    let restored: DiagramData = serde_json::from_str(&json).unwrap();
    assert_eq!(diagram, restored);
    assert_eq!(restored.definition.dm_rel_id.as_deref(), Some("rId1"));
    assert_eq!(restored.definition.original_id, Some(42));
    assert_eq!(restored.category, Some(SmartArtCategory::Hierarchy));
}

#[test]
fn test_diagram_data_roundtrip_with_category() {
    let json = r#"{"definition": {"dmRelId": "rId1", "loRelId": "rId2", "dataXml": "<dgm:dataModel/>"}, "category": "hierarchy"}"#;
    let diagram: DiagramData = serde_json::from_str(json).unwrap();

    assert_eq!(diagram.category, Some(SmartArtCategory::Hierarchy),);
    assert_eq!(diagram.definition.dm_rel_id.as_deref(), Some("rId1"));
    assert_eq!(diagram.definition.lo_rel_id.as_deref(), Some("rId2"));
    assert_eq!(
        diagram.definition.data_xml.as_deref(),
        Some("<dgm:dataModel/>"),
    );
    assert_eq!(diagram.definition.qs_rel_id, None);
    assert_eq!(diagram.definition.original_id, None);
}

#[test]
fn test_smartart_definition_default_serializes_empty() {
    let def = SmartArtDefinition::default();
    let json = serde_json::to_string(&def).unwrap();
    assert_eq!(json, "{}");
}
