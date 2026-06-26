use super::super::chart_ex_projection::{
    chart_ex_import_status, chart_type_from_chart_ex_layout_id,
};
use super::*;
use ooxml_types::chart_ex::ChartExLayoutId;

#[test]
fn chart_ex_layout_ids_map_to_public_chart_types_without_prefixes() {
    for (layout_id, expected) in [
        (
            ChartExLayoutId::Waterfall,
            domain_types::ChartType::Waterfall,
        ),
        (ChartExLayoutId::Treemap, domain_types::ChartType::Treemap),
        (ChartExLayoutId::Sunburst, domain_types::ChartType::Sunburst),
        (ChartExLayoutId::Funnel, domain_types::ChartType::Funnel),
        (
            ChartExLayoutId::RegionMap,
            domain_types::ChartType::RegionMap,
        ),
        (
            ChartExLayoutId::Histogram,
            domain_types::ChartType::Histogram,
        ),
        (ChartExLayoutId::Pareto, domain_types::ChartType::Pareto),
        (
            ChartExLayoutId::BoxWhisker,
            domain_types::ChartType::Boxplot,
        ),
    ] {
        let chart_type = chart_type_from_chart_ex_layout_id(&layout_id);
        assert_eq!(chart_type, expected);
        assert!(!chart_type.as_str().starts_with("chartEx:"));
    }
}

#[test]
fn chart_ex_unknown_layout_ids_remain_unsupported_chart_types() {
    assert_eq!(
        chart_type_from_chart_ex_layout_id(&ChartExLayoutId::ClusteredBar),
        domain_types::ChartType::Unknown("clusteredBar".to_string())
    );
    assert_eq!(
        chart_type_from_chart_ex_layout_id(&ChartExLayoutId::Other("futureLayout".to_string())),
        domain_types::ChartType::Unknown("futureLayout".to_string())
    );
}

#[test]
fn chart_ex_status_distinguishes_preserved_not_renderable_from_unknown_family() {
    let not_renderable = chart_ex_import_status(
        &domain_types::ChartType::RegionMap,
        &[],
        None,
        "xl/charts/chartEx1.xml",
        Some("Map"),
    )
    .expect("region maps are preserved but not renderable yet");
    assert_eq!(
        not_renderable.recoverability,
        domain_types::ImportRecoverability::PreservedNotRenderable
    );
    assert_eq!(
        not_renderable.renderability,
        domain_types::ImportRenderability::NotRenderable
    );
    assert_eq!(
        not_renderable.diagnostics[0].code,
        Some(domain_types::ImportDiagnosticCode::UnsupportedFeature)
    );

    let unknown = chart_ex_import_status(
        &domain_types::ChartType::Unknown("futureLayout".to_string()),
        &[],
        None,
        "xl/charts/chartEx2.xml",
        None,
    )
    .expect("unknown ChartEx layouts are unsupported");
    assert_eq!(
        unknown.diagnostics[0].code,
        Some(domain_types::ImportDiagnosticCode::UnsupportedChartType)
    );
}

#[test]
fn standard_chart_relationship_closure_allows_referenced_external_data() {
    let chart_space = ooxml_types::charts::ChartSpace {
        external_data: Some(ooxml_types::charts::ExternalData {
            r_id: "rIdExternalData".to_string(),
            auto_update: Some(false),
        }),
        ..Default::default()
    };
    let relationships = vec![domain_types::chart::ChartRelationshipData {
        r_id: "rIdExternalData".to_string(),
        relationship_type: Some(crate::infra::opc::REL_EXTERNAL_LINK.to_string()),
        target: Some("externalLinks/externalLink1.xml".to_string()),
        target_mode: Some("External".to_string()),
    }];

    let closure = standard_chart_relationship_closure(
        Some("xl/charts/chart1.xml"),
        &chart_space,
        &relationships,
        &[],
        Some("Revenue"),
    );

    assert!(closure.current);
    assert!(closure.diagnostics.is_empty());
}

#[test]
fn standard_chart_relationship_closure_reports_unsupported_relationships() {
    let chart_space = ooxml_types::charts::ChartSpace {
        user_shapes: Some("rIdUserShapes".to_string()),
        ..Default::default()
    };
    let relationships = vec![
        domain_types::chart::ChartRelationshipData {
            r_id: "rIdUserShapes".to_string(),
            relationship_type: Some(crate::infra::opc::REL_CHART_USER_SHAPES.to_string()),
            target: Some("../drawings/userShapeDrawing1.xml".to_string()),
            target_mode: None,
        },
        domain_types::chart::ChartRelationshipData {
            r_id: "rIdVendor".to_string(),
            relationship_type: Some("http://example.com/vendorChartSidecar".to_string()),
            target: Some("vendor1.xml".to_string()),
            target_mode: None,
        },
    ];

    let closure = standard_chart_relationship_closure(
        Some("xl/charts/chart1.xml"),
        &chart_space,
        &relationships,
        &[],
        Some("Revenue"),
    );
    let codes = closure
        .diagnostics
        .iter()
        .filter_map(|diagnostic| diagnostic.code.clone())
        .collect::<Vec<_>>();

    assert!(!closure.current);
    assert!(codes.contains(&domain_types::ImportDiagnosticCode::MissingRelationshipTarget));
    assert!(codes.contains(&domain_types::ImportDiagnosticCode::UnsupportedFeature));
}

#[test]
fn standard_chart_source_replay_rejects_unqualified_local_refs() {
    let readiness = chart_xml_source_replay_readiness(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:f>A4:A10</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>B4:B10</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"#,
    );

    assert!(!readiness.current);
    assert!(
        readiness
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("unqualified local source references")),
        "{readiness:?}"
    );
}

#[test]
fn standard_chart_source_replay_allows_sheet_qualified_refs_without_caches() {
    let readiness = chart_xml_source_replay_readiness(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:f>Data!A4:A10</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Data!B4:B10</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"#,
    );

    assert!(readiness.current, "{readiness:?}");
}

#[test]
fn standard_chart_source_replay_allows_export_ready_xml_without_modeled_cache_projection() {
    let readiness = chart_xml_source_replay_readiness(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:f>Data!A4:A10</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Data!B4:B10</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>100</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"#,
    );

    assert!(readiness.current, "{readiness:?}");
}

#[test]
fn standard_chart_source_replay_does_not_treat_named_ranges_as_local_a1_refs() {
    let readiness = chart_xml_source_replay_readiness(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:f>QuarterLabels</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>RevenueValues</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>100</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"#,
    );

    assert!(readiness.current, "{readiness:?}");
}

#[test]
fn standard_chart_pivot_fmts_emit_import_diagnostic_for_style_semantics() {
    let chart_space = ooxml_types::charts::ChartSpace {
        chart: ooxml_types::charts::Chart {
            pivot_fmts: vec![ooxml_types::charts::PivotFmt {
                idx: 2,
                sp_pr: Some(Default::default()),
                ..Default::default()
            }],
            ..Default::default()
        },
        ..Default::default()
    };

    let diagnostics = standard_chart_pivot_format_diagnostics(
        &chart_space,
        Some("xl/charts/chart1.xml"),
        Some("Revenue"),
    );

    assert_eq!(diagnostics.len(), 1);
    let diagnostic = &diagnostics[0];
    assert_eq!(
        diagnostic.code,
        Some(domain_types::ImportDiagnosticCode::UnsupportedFeature)
    );
    assert!(
        diagnostic
            .message
            .as_deref()
            .is_some_and(|message| message.contains("c:pivotFmts"))
    );
    assert_eq!(diagnostic.object_id.as_deref(), Some("pivotFmts"));
}
