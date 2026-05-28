use super::*;

#[test]
fn test_relationship_new() {
    let rel = Relationship::new("rId1", REL_WORKSHEET, "worksheets/sheet1.xml");

    assert_eq!(rel.id, "rId1");
    assert_eq!(rel.rel_type, REL_WORKSHEET);
    assert_eq!(rel.target, "worksheets/sheet1.xml");
    assert_eq!(rel.target_mode, None);
    assert!(!rel.is_external());
}

#[test]
fn test_relationship_external() {
    let rel = Relationship::external("rId1", REL_HYPERLINK, "https://example.com");

    assert_eq!(rel.id, "rId1");
    assert_eq!(rel.rel_type, REL_HYPERLINK);
    assert_eq!(rel.target, "https://example.com");
    assert_eq!(rel.target_mode, Some("External".to_string()));
    assert!(rel.is_external());
}

#[test]
fn test_relationship_is_external_is_exact() {
    let mut rel = Relationship::new("rId1", REL_HYPERLINK, "https://example.com");
    rel.target_mode = Some("external".to_string());
    assert!(!rel.is_external());

    rel.target_mode = Some("Internal".to_string());
    assert!(!rel.is_external());
}

#[test]
fn test_manager_new_and_default() {
    let mgr = RelationshipManager::new();
    assert!(mgr.is_empty());
    assert_eq!(mgr.len(), 0);
    assert_eq!(mgr.relationships().len(), 0);

    let mut default_mgr = RelationshipManager::default();
    assert_eq!(
        default_mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml"),
        "rId1"
    );
}

#[test]
fn test_manager_add() {
    let mut mgr = RelationshipManager::new();

    let id1 = mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml");
    let id2 = mgr.add(REL_WORKSHEET, "worksheets/sheet2.xml");
    let id3 = mgr.add(REL_STYLES, "styles.xml");

    assert_eq!(id1, "rId1");
    assert_eq!(id2, "rId2");
    assert_eq!(id3, "rId3");
    assert_eq!(mgr.len(), 3);
    assert!(!mgr.is_empty());
}

#[test]
fn test_manager_add_external() {
    let mut mgr = RelationshipManager::new();

    let id1 = mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml");
    let id2 = mgr.add_external(REL_HYPERLINK, "https://example.com");

    assert_eq!(id1, "rId1");
    assert_eq!(id2, "rId2");
    assert_eq!(mgr.len(), 2);

    let rel = mgr.get_by_id("rId2").unwrap();
    assert!(rel.is_external());
}

#[test]
fn test_add_with_target_mode_preserves_modes_through_xml() {
    let mut mgr = RelationshipManager::new();

    mgr.add_with_target_mode(REL_HYPERLINK, "#Sheet1!A1", None);
    mgr.add_with_target_mode(
        REL_HYPERLINK,
        "https://example.com",
        Some("External".to_string()),
    );
    mgr.add_with_target_mode(
        REL_HYPERLINK,
        "custom-target",
        Some("CustomMode".to_string()),
    );

    assert_eq!(mgr.get_by_id("rId1").unwrap().target_mode, None);
    assert_eq!(
        mgr.get_by_id("rId2").unwrap().target_mode,
        Some("External".to_string())
    );
    assert_eq!(
        mgr.get_by_id("rId3").unwrap().target_mode,
        Some("CustomMode".to_string())
    );

    let xml = String::from_utf8(mgr.to_xml()).unwrap();
    assert!(xml.contains("Id=\"rId1\" Type="));
    assert!(!relationship_fragment(&xml, "rId1").contains("TargetMode="));
    assert!(relationship_fragment(&xml, "rId2").contains("TargetMode=\"External\""));
    assert!(relationship_fragment(&xml, "rId3").contains("TargetMode=\"CustomMode\""));
}

#[test]
fn test_manager_get_find_has_and_add_if_missing() {
    let mut mgr = RelationshipManager::new();
    mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml");
    mgr.add(REL_STYLES, "styles.xml");

    assert_eq!(
        mgr.get_by_id("rId1").unwrap().target,
        "worksheets/sheet1.xml"
    );
    assert_eq!(mgr.get_by_id("rId2").unwrap().target, "styles.xml");
    assert!(mgr.get_by_id("rId999").is_none());
    assert_eq!(
        mgr.find_by_target("worksheets/sheet1.xml"),
        Some("rId1".to_string())
    );
    assert_eq!(mgr.find_by_target("missing.xml"), None);
    assert!(mgr.has_rel_type(REL_STYLES));
    assert!(!mgr.has_rel_type(REL_THEME));

    let existing = mgr.add_if_missing(REL_WORKSHEET, "worksheets/sheet2.xml");
    assert_eq!(existing, "rId1");
    assert_eq!(mgr.len(), 2);

    let added = mgr.add_if_missing(REL_THEME, "theme/theme1.xml");
    assert_eq!(added, "rId3");
    assert_eq!(mgr.len(), 3);
}

#[test]
fn test_add_with_id_preserves_id_and_bumps_next_id() {
    let mut mgr = RelationshipManager::new();
    mgr.add_with_id("rId7", REL_WORKSHEET, "worksheets/sheet1.xml");
    mgr.add_with_id("custom-id", REL_STYLES, "styles.xml");

    assert_eq!(
        mgr.get_by_id("rId7").unwrap().target,
        "worksheets/sheet1.xml"
    );
    assert_eq!(mgr.get_by_id("custom-id").unwrap().target, "styles.xml");
    assert_eq!(mgr.add(REL_THEME, "theme/theme1.xml"), "rId8");
}

#[test]
fn test_explicit_nonnumeric_ids_do_not_bump_next_id() {
    let mut mgr = RelationshipManager::new();
    mgr.add_with_id("custom-id", REL_WORKSHEET, "worksheets/sheet1.xml");
    mgr.add_external_with_id("rIdX", REL_HYPERLINK, "https://example.com");

    assert_eq!(mgr.relationships()[0].id, "custom-id");
    assert_eq!(mgr.relationships()[1].id, "rIdX");
    assert_eq!(mgr.add(REL_STYLES, "styles.xml"), "rId1");
}

#[test]
fn test_add_external_with_id_preserves_id_and_bumps_next_id() {
    let mut mgr = RelationshipManager::new();
    mgr.add_external_with_id("rId4", REL_HYPERLINK, "https://example.com");

    let rel = mgr.get_by_id("rId4").unwrap();
    assert_eq!(rel.target, "https://example.com");
    assert!(rel.is_external());
    assert_eq!(mgr.add(REL_STYLES, "styles.xml"), "rId5");
}

#[test]
fn test_set_with_id_updates_existing_clears_mode_preserves_position_and_bumps() {
    let mut mgr = RelationshipManager::new();
    mgr.add_with_target_mode(
        REL_HYPERLINK,
        "https://example.com",
        Some("External".to_string()),
    );
    mgr.add(REL_STYLES, "styles.xml");

    mgr.set_with_id("rId9", REL_HYPERLINK, "https://example.com");

    let rels = mgr.relationships();
    assert_eq!(rels.len(), 2);
    assert_eq!(rels[0].id, "rId9");
    assert_eq!(rels[0].rel_type, REL_HYPERLINK);
    assert_eq!(rels[0].target, "https://example.com");
    assert_eq!(rels[0].target_mode, None);
    assert_eq!(rels[1].id, "rId2");
    assert_eq!(mgr.add(REL_THEME, "theme/theme1.xml"), "rId10");
}

#[test]
fn test_set_with_id_appends_when_missing() {
    let mut mgr = RelationshipManager::new();
    mgr.add(REL_STYLES, "styles.xml");

    mgr.set_with_id("rId4", REL_THEME, "theme/theme1.xml");

    assert_eq!(mgr.len(), 2);
    assert_eq!(mgr.relationships()[1].id, "rId4");
    assert_eq!(mgr.relationships()[1].rel_type, REL_THEME);
    assert_eq!(mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml"), "rId5");
}

#[test]
fn test_manager_empty_to_xml() {
    let mgr = RelationshipManager::new();
    let xml = mgr.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"));
    assert!(xml_str.contains(
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
    ));
    assert!(xml_str.contains("</Relationships>"));
    assert!(!xml_str.contains("<Relationship "));
}

#[test]
fn test_manager_to_xml_single_multiple_and_external() {
    let mut mgr = RelationshipManager::new();
    mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml");
    mgr.add(REL_WORKSHEET, "worksheets/sheet2.xml");
    mgr.add_external(REL_HYPERLINK, "https://example.com");

    let xml = mgr.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("Id=\"rId1\""));
    assert!(xml_str.contains("Id=\"rId2\""));
    assert!(xml_str.contains("Id=\"rId3\""));
    assert!(xml_str.contains(&format!("Type=\"{}\"", REL_WORKSHEET)));
    assert!(xml_str.contains(&format!("Type=\"{}\"", REL_HYPERLINK)));
    assert!(xml_str.contains("Target=\"worksheets/sheet1.xml\""));
    assert!(xml_str.contains("Target=\"worksheets/sheet2.xml\""));
    assert!(xml_str.contains("Target=\"https://example.com\""));
    assert!(xml_str.contains("TargetMode=\"External\""));
}

#[test]
fn test_xml_preserves_insertion_order_and_target_modes() {
    let mut mgr = RelationshipManager::new();
    mgr.add(REL_WORKSHEET, "worksheets/sheet1.xml");
    mgr.add_external(REL_HYPERLINK, "https://example.com");
    mgr.add_with_target_mode(
        REL_HYPERLINK,
        "custom-target",
        Some("CustomMode".to_string()),
    );

    let xml = String::from_utf8(mgr.to_xml()).unwrap();
    let first = xml.find("Id=\"rId1\"").unwrap();
    let second = xml.find("Id=\"rId2\"").unwrap();
    let third = xml.find("Id=\"rId3\"").unwrap();

    assert!(first < second);
    assert!(second < third);
    assert!(relationship_fragment(&xml, "rId1").contains("Target=\"worksheets/sheet1.xml\""));
    assert!(!relationship_fragment(&xml, "rId1").contains("TargetMode="));
    assert!(relationship_fragment(&xml, "rId2").contains("TargetMode=\"External\""));
    assert!(relationship_fragment(&xml, "rId3").contains("TargetMode=\"CustomMode\""));
}

#[test]
fn test_manager_to_xml_escaping() {
    let mut mgr = RelationshipManager::new();
    mgr.add_external(
        REL_HYPERLINK,
        "https://example.com?foo=1&bar=<two>\"quote\"'apos'",
    );

    let xml = mgr.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains(
        "Target=\"https://example.com?foo=1&amp;bar=&lt;two&gt;&quot;quote&quot;&apos;apos&apos;\""
    ));
}

#[test]
fn test_create_root_rels() {
    let rels = create_root_rels("xl/workbook.xml");

    assert_eq!(rels.len(), 1);

    let rel = rels.get_by_id("rId1").unwrap();
    assert_eq!(rel.rel_type, REL_OFFICE_DOCUMENT);
    assert_eq!(rel.target, "xl/workbook.xml");
}

#[test]
fn test_create_root_rels_full() {
    let rels = create_root_rels_full("xl/workbook.xml", true, true);

    assert_eq!(rels.len(), 3);

    let rel1 = rels.get_by_id("rId1").unwrap();
    assert_eq!(rel1.rel_type, REL_OFFICE_DOCUMENT);
    assert_eq!(rel1.target, "/xl/workbook.xml");

    let rel2 = rels.get_by_id("rId2").unwrap();
    assert_eq!(rel2.rel_type, REL_CORE_PROPERTIES);
    assert_eq!(rel2.target, "/docProps/core.xml");

    let rel3 = rels.get_by_id("rId3").unwrap();
    assert_eq!(rel3.rel_type, REL_EXTENDED_PROPERTIES);
    assert_eq!(rel3.target, "/docProps/app.xml");
}

#[test]
fn test_create_root_rels_full_partial_and_custom() {
    let rels = create_root_rels_full_with_custom("xl/workbook.xml", true, false, true);

    assert_eq!(rels.len(), 3);
    assert_eq!(rels.get_by_id("rId1").unwrap().target, "/xl/workbook.xml");
    assert_eq!(
        rels.get_by_id("rId2").unwrap().rel_type,
        REL_CORE_PROPERTIES
    );
    assert_eq!(rels.get_by_id("rId2").unwrap().target, "/docProps/core.xml");
    assert_eq!(
        rels.get_by_id("rId3").unwrap().rel_type,
        REL_CUSTOM_PROPERTIES
    );
    assert_eq!(
        rels.get_by_id("rId3").unwrap().target,
        "/docProps/custom.xml"
    );
}

#[test]
fn test_create_workbook_rels_minimal_and_multiple_sheets() {
    let rels = create_workbook_rels(3, false, false, false);

    assert_eq!(rels.len(), 3);

    assert_eq!(
        rels.get_by_id("rId1").unwrap().target,
        "worksheets/sheet1.xml"
    );
    assert_eq!(
        rels.get_by_id("rId2").unwrap().target,
        "worksheets/sheet2.xml"
    );
    assert_eq!(
        rels.get_by_id("rId3").unwrap().target,
        "worksheets/sheet3.xml"
    );
}

#[test]
fn test_create_workbook_rels_full() {
    let rels = create_workbook_rels(2, true, true, true);

    assert_eq!(rels.len(), 5);

    assert_eq!(rels.get_by_id("rId1").unwrap().rel_type, REL_WORKSHEET);
    assert_eq!(rels.get_by_id("rId2").unwrap().rel_type, REL_WORKSHEET);
    assert_eq!(rels.get_by_id("rId3").unwrap().rel_type, REL_STYLES);
    assert_eq!(rels.get_by_id("rId3").unwrap().target, "styles.xml");
    assert_eq!(rels.get_by_id("rId4").unwrap().rel_type, REL_THEME);
    assert_eq!(rels.get_by_id("rId4").unwrap().target, "theme/theme1.xml");
    assert_eq!(rels.get_by_id("rId5").unwrap().rel_type, REL_SHARED_STRINGS);
    assert_eq!(rels.get_by_id("rId5").unwrap().target, "sharedStrings.xml");
}

#[test]
fn test_create_sheet_rels() {
    let rels = create_sheet_rels();
    assert!(rels.is_empty());
}

#[test]
fn test_relationship_type_constants() {
    assert!(REL_WORKSHEET.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_STYLES.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_THEME.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_SHARED_STRINGS.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_OFFICE_DOCUMENT.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_CORE_PROPERTIES.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_DRAWING.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_COMMENTS.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_TABLE.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_CHART.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_HYPERLINK.starts_with("http://schemas.openxmlformats.org/"));
    assert!(REL_PIVOT_CACHE.starts_with("http://schemas.openxmlformats.org/"));
}

#[test]
fn test_relationships_namespace() {
    assert_eq!(
        RELATIONSHIPS_NS,
        "http://schemas.openxmlformats.org/package/2006/relationships"
    );
}

#[test]
fn test_realistic_workbook_rels_xml() {
    let rels = create_workbook_rels(2, true, true, true);
    let xml = rels.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"));
    assert!(xml_str.contains(&format!("xmlns=\"{}\"", RELATIONSHIPS_NS)));
    assert!(xml_str.contains("worksheets/sheet1.xml"));
    assert!(xml_str.contains("worksheets/sheet2.xml"));
    assert!(xml_str.contains("styles.xml"));
    assert!(xml_str.contains("theme/theme1.xml"));
    assert!(xml_str.contains("sharedStrings.xml"));
    assert_eq!(xml_str.matches("<Relationship ").count(), 5);
}

#[test]
fn test_realistic_root_rels_xml() {
    let rels = create_root_rels_full("xl/workbook.xml", true, true);
    let xml = rels.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("/xl/workbook.xml"));
    assert!(xml_str.contains("/docProps/core.xml"));
    assert!(xml_str.contains("/docProps/app.xml"));
    assert!(xml_str.contains(REL_OFFICE_DOCUMENT));
    assert!(xml_str.contains(REL_CORE_PROPERTIES));
    assert!(xml_str.contains(REL_EXTENDED_PROPERTIES));
}

#[test]
fn test_sheet_rels_with_hyperlinks_and_comments() {
    let mut rels = create_sheet_rels();
    rels.add_external(REL_HYPERLINK, "https://google.com");
    rels.add_external(REL_HYPERLINK, "https://github.com");
    rels.add(REL_COMMENTS, "../comments1.xml");
    rels.add(REL_VML_DRAWING, "../drawings/vmlDrawing1.vml");

    let xml = rels.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert_eq!(rels.len(), 4);
    assert!(xml_str.contains("https://google.com"));
    assert!(xml_str.contains("https://github.com"));
    assert!(xml_str.contains("TargetMode=\"External\""));
    assert!(xml_str.contains("../comments1.xml"));
    assert!(xml_str.contains("../drawings/vmlDrawing1.vml"));
    assert_eq!(xml_str.matches("TargetMode=\"External\"").count(), 2);
}

#[test]
fn test_from_original_preserves_non_sequential_ids() {
    let original = vec![
        original_rel("rId1", REL_STYLES, "styles.xml", None),
        original_rel("rId2", REL_THEME, "theme/theme1.xml", None),
        original_rel("rId3", REL_WORKSHEET, "worksheets/sheet1.xml", None),
        original_rel("rId4", REL_WORKSHEET, "worksheets/sheet2.xml", None),
    ];

    let mgr = RelationshipManager::from_original(&original);

    assert_eq!(mgr.len(), 4);
    assert_eq!(mgr.get_by_id("rId1").unwrap().rel_type, REL_STYLES);
    assert_eq!(mgr.get_by_id("rId2").unwrap().rel_type, REL_THEME);
    assert_eq!(mgr.get_by_id("rId3").unwrap().rel_type, REL_WORKSHEET);
    assert_eq!(
        mgr.get_by_id("rId3").unwrap().target,
        "worksheets/sheet1.xml"
    );
    assert_eq!(mgr.get_by_id("rId4").unwrap().rel_type, REL_WORKSHEET);
}

#[test]
fn test_from_original_preserves_gaps_in_ids() {
    let original = vec![
        original_rel("rId1", REL_WORKSHEET, "worksheets/sheet1.xml", None),
        original_rel("rId5", REL_STYLES, "styles.xml", None),
        original_rel("rId10", REL_SHARED_STRINGS, "sharedStrings.xml", None),
    ];

    let mut mgr = RelationshipManager::from_original(&original);

    assert_eq!(mgr.len(), 3);
    assert_eq!(
        mgr.get_by_id("rId1").unwrap().target,
        "worksheets/sheet1.xml"
    );
    assert_eq!(mgr.get_by_id("rId5").unwrap().target, "styles.xml");
    assert_eq!(mgr.get_by_id("rId10").unwrap().target, "sharedStrings.xml");
    assert_eq!(mgr.add(REL_WORKSHEET, "worksheets/sheet2.xml"), "rId11");
}

#[test]
fn test_from_original_xml_matches_original_ids() {
    let original = vec![
        original_rel("rId5", REL_WORKSHEET, "worksheets/sheet1.xml", None),
        original_rel("rId3", REL_STYLES, "styles.xml", None),
    ];

    let mgr = RelationshipManager::from_original(&original);
    let xml = mgr.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("Id=\"rId5\""));
    assert!(xml_str.contains("Id=\"rId3\""));
    assert!(!xml_str.contains("Id=\"rId1\""));
    assert!(!xml_str.contains("Id=\"rId2\""));
}

#[test]
fn test_from_original_preserves_external_target_mode() {
    let original = vec![original_rel(
        "rId7",
        REL_HYPERLINK,
        "https://example.com",
        Some("External"),
    )];

    let mgr = RelationshipManager::from_original(&original);
    let rel = mgr.get_by_id("rId7").unwrap();

    assert_eq!(rel.target_mode, Some("External".to_string()));

    let xml = String::from_utf8(mgr.to_xml()).unwrap();
    assert!(xml.contains("TargetMode=\"External\""));
}

#[test]
fn test_from_original_order_preserved() {
    let original = vec![
        original_rel("rId3", REL_STYLES, "styles.xml", None),
        original_rel("rId1", REL_WORKSHEET, "worksheets/sheet1.xml", None),
    ];

    let mgr = RelationshipManager::from_original(&original);
    let rels = mgr.relationships();

    assert_eq!(rels[0].id, "rId3");
    assert_eq!(rels[0].rel_type, REL_STYLES);
    assert_eq!(rels[1].id, "rId1");
    assert_eq!(rels[1].rel_type, REL_WORKSHEET);
}

#[test]
fn test_from_relationships_mixed_ids_allocates_after_max_numeric_id() {
    let relationships = vec![
        Relationship::new("custom-id", REL_STYLES, "styles.xml"),
        Relationship::new("rId4", REL_WORKSHEET, "worksheets/sheet1.xml"),
        Relationship::new("rIdX", REL_THEME, "theme/theme1.xml"),
        Relationship::new("rId12", REL_SHARED_STRINGS, "sharedStrings.xml"),
    ];

    let mut mgr = RelationshipManager::from_relationships(relationships);

    assert_eq!(mgr.relationships()[0].id, "custom-id");
    assert_eq!(mgr.relationships()[1].id, "rId4");
    assert_eq!(mgr.relationships()[2].id, "rIdX");
    assert_eq!(mgr.relationships()[3].id, "rId12");
    assert_eq!(mgr.add(REL_WORKSHEET, "worksheets/sheet2.xml"), "rId13");
}

fn relationship_fragment<'a>(xml: &'a str, id: &str) -> &'a str {
    let start = xml.find(&format!("Id=\"{}\"", id)).unwrap();
    let rest = &xml[start..];
    let end = rest.find("/>").unwrap() + 2;
    &rest[..end]
}

fn original_rel(
    id: &str,
    rel_type: &str,
    target: &str,
    target_mode: Option<&str>,
) -> ooxml_types::shared::OpcRelationship {
    ooxml_types::shared::OpcRelationship {
        id: id.into(),
        rel_type: rel_type.into(),
        target: target.into(),
        target_mode: target_mode.map(String::from),
    }
}
