use super::*;

const IMPORTED_CHART_EX_TITLE: &str = "Imported ChartEx Title";

fn imported_rich_title_chart_ex(original_number: usize, family_marker: &str) -> ChartSpec {
    let mut chart_ex = make_chart(ChartType::Waterfall, "");
    chart_ex.title = Some(IMPORTED_CHART_EX_TITLE.to_string());
    chart_ex.data_range = None;
    chart_ex.is_chart_ex = true;
    chart_ex.position.anchor_row = original_number as u32;
    chart_ex.position.anchor_col = 2;
    chart_ex.position.end_row = Some(original_number as u32 + 12);
    chart_ex.position.end_col = Some(8);
    chart_ex.cnv_pr_name = Some(format!("{family_marker} ChartEx"));
    chart_ex.cnv_pr_id = Some(original_number as u32);
    chart_ex.chart_frame = Some(
        domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps {
            relationship_id: Some(format!("rIdChart{original_number}")),
            relationship_target: Some(format!("../charts/chartEx{original_number}.xml")),
            ..Default::default()
        },
    );

    let original_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><!--CHARTEX-FAMILY-{family_marker}--><cx:chart><cx:title><cx:tx><cx:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Imported </a:t></a:r><a:r><a:t>ChartEx Title</a:t></a:r></a:p></cx:rich></cx:tx></cx:title><cx:plotArea><cx:plotAreaRegion/></cx:plotArea></cx:chart><cx:printSettings><!--PRINT-{family_marker}--><cx:pageMargins l="0.7" r="0.7"/></cx:printSettings></cx:chartSpace>"#
    )
    .into_bytes();
    let chart_space = crate::domain::charts::chart_ex::read::parse_chart_ex(&original_xml);
    chart_ex.definition = Some(domain_types::ChartDefinition::ChartEx(chart_space));

    let style_target = format!("style{original_number}.xml");
    let color_target = format!("color{original_number}.xml");
    let style_path = format!("xl/charts/{style_target}");
    let color_path = format!("xl/charts/{color_target}");
    let relationships = vec![
        domain_types::chart::ChartRelationshipData {
            r_id: format!("rIdStyle{original_number}"),
            relationship_type: Some(crate::infra::opc::REL_CHART_STYLE.to_string()),
            target: Some(style_target.clone()),
            target_mode: None,
        },
        domain_types::chart::ChartRelationshipData {
            r_id: format!("rIdColor{original_number}"),
            relationship_type: Some(crate::infra::opc::REL_CHART_COLOR_STYLE.to_string()),
            target: Some(color_target.clone()),
            target_mode: None,
        },
    ];
    let auxiliary_files = vec![
        (
            style_path,
            format!(
                r#"<c:styleSheet xmlns:c="http://schemas.microsoft.com/office/drawing/2012/chartStyle"><!--STYLE-{family_marker}--></c:styleSheet>"#
            )
            .into_bytes(),
        ),
        (
            color_path,
            format!(
                r#"<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle"><!--COLOR-{family_marker}--></cs:colorStyle>"#
            )
            .into_bytes(),
        ),
    ];
    chart_ex.chart_relationships = relationships.clone();
    chart_ex.chart_auxiliary_files = auxiliary_files.clone();
    chart_ex.chart_ex_replay = Some(domain_types::chart::ChartExReplayData {
        original_path: format!("xl/charts/chartEx{original_number}.xml"),
        original_xml,
        original_position: chart_ex.position.clone(),
        projection_fingerprint: None,
        rels_path: Some(format!(
            "xl/charts/_rels/chartEx{original_number}.xml.rels"
        )),
        rels_xml: Some(
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyle{original_number}" Type="{}" Target="{style_target}"/><Relationship Id="rIdColor{original_number}" Type="{}" Target="{color_target}"/></Relationships>"#,
                crate::infra::opc::REL_CHART_STYLE,
                crate::infra::opc::REL_CHART_COLOR_STYLE
            )
            .into_bytes(),
        ),
        relationships,
        auxiliary_files,
    });
    let projection_fingerprint = chart_replay::standard_chart_projection_fingerprint(&chart_ex);
    chart_ex
        .chart_ex_replay
        .as_mut()
        .expect("test fixture has replay data")
        .projection_fingerprint = Some(projection_fingerprint);
    chart_ex
}

#[test]
fn imported_chart_ex_rich_title_keeps_opaque_package_replay_current() {
    let chart_ex = imported_rich_title_chart_ex(44, "rich-title");
    assert!(chart_replay::chart_ex_allows_opaque_replay(
        &chart_ex,
        "xl/charts/chartEx44.xml"
    ));
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        charts: vec![chart_ex],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx44.xml").unwrap()).unwrap();
    let rels_xml = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chartEx44.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(chart_xml.contains("CHARTEX-FAMILY-rich-title"));
    assert!(chart_xml.contains("Imported "));
    assert!(chart_xml.contains("ChartEx Title"));
    assert!(chart_xml.contains("PRINT-rich-title"));
    assert!(rels_xml.contains(r#"Target="style44.xml""#));
    assert!(rels_xml.contains(r#"Target="color44.xml""#));
    assert!(archive.contains("xl/charts/style44.xml"));
    assert!(archive.contains("xl/charts/color44.xml"));
    assert!(!archive.contains("xl/charts/chartEx1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn chart_ex_raw_anchor_replay_remaps_provisional_relationship_id() {
    let chart_ex = chart_ex_with_raw_anchor(7);
    let raw_xml =
        chart_replay::chart_ex_raw_anchor_replay_xml(&chart_ex, "xl/charts/chartEx7.xml", "rId2")
            .expect("raw anchor should replay with remapped relationship id");

    assert!(raw_xml.contains("RAW-CHARTEX-ANCHOR"));
    assert!(raw_xml.contains(r#"r:id="rId2""#));
    assert!(!raw_xml.contains(r#"r:id="rId1""#));
    assert!(chart_replay::chart_ex_allows_raw_anchor_replay(
        &chart_ex,
        "xl/charts/chartEx7.xml",
        "rId2"
    ));
}

#[test]
fn chart_ex_raw_anchor_replay_rejects_stale_frame_relationship_id() {
    let mut chart_ex = chart_ex_with_raw_anchor(7);
    chart_ex
        .chart_frame
        .as_mut()
        .expect("test fixture has chart frame")
        .relationship_id = Some("rIdStale".to_string());

    assert!(
        chart_replay::chart_ex_raw_anchor_replay_xml(
            &chart_ex,
            "xl/charts/chartEx7.xml",
            "rIdStale",
        )
        .is_none()
    );
}
