use yrs::{Doc, Map, MapPrelim, Transact};

use super::*;
use crate::domain::floating_object::{FloatingObject, FloatingObjectCommon, FloatingObjectData};

fn yrs_roundtrip(obj: &FloatingObject) -> FloatingObject {
    let doc = Doc::new();
    let root = doc.get_or_insert_map("test");
    {
        let mut txn = doc.transact_mut();
        let entries = to_yrs_prelim(obj);
        let prelim: MapPrelim = entries.into_iter().collect();
        root.insert(&mut txn, "item", prelim);
    }
    let txn = doc.transact();
    let map_ref = root
        .get(&txn, "item")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    from_yrs_map(&map_ref, &txn).expect("floating object should hydrate")
}

#[test]
fn chart_ooxml_sidecar_preserves_imported_chart_replay_through_yrs() {
    let chart_xml = b"<cx:chartSpace/>".to_vec();
    let rels_xml = b"<Relationships/>".to_vec();
    let style_xml = b"<c:styleSheet/>".to_vec();
    let relationship = serde_json::json!({
        "rId": "rIdStyle1",
        "relationshipType": "http://schemas.microsoft.com/office/2011/relationships/chartStyle",
        "target": "style1.xml"
    });

    let obj = FloatingObject {
        common: FloatingObjectCommon {
            id: "chart-ex-1".to_string(),
            sheet_id: "sheet-1".to_string(),
            name: "Imported ChartEx".to_string(),
            ..Default::default()
        },
        data: FloatingObjectData::Chart(
            serde_json::from_value(serde_json::json!({
                "chartType": "waterfall",
                "ooxml": {
                    "drawingFrame": {
                        "relationshipId": "rId7",
                        "relationshipTarget": "../charts/chartEx1.xml",
                        "rawAlternateContent": "<mc:AlternateContent/>"
                    },
                    "chartRelationships": [relationship.clone()],
                    "chartAuxiliaryFiles": [["xl/charts/style1.xml", style_xml.clone()]],
                    "standardChartProvenance": {
                        "originalPath": "xl/charts/chartEx1.xml",
                        "relsPath": "xl/charts/_rels/chartEx1.xml.rels",
                        "projectionSchemaVersion": 6,
                        "projectionFingerprint": "abc123",
                        "relationships": [relationship.clone()],
                        "auxiliaryPaths": ["xl/charts/style1.xml"]
                    },
                    "standardChartExportAuthority": {
                        "schemaVersion": 6,
                        "validity": "current",
                        "chartPartRevision": 0,
                        "packageOwner": "xl/charts/chartEx1.xml",
                        "relationshipClosureCurrent": true,
                        "projectionFingerprint": "abc123"
                    },
                    "chartExReplay": {
                        "originalPath": "xl/charts/chartEx1.xml",
                        "originalXml": chart_xml.clone(),
                        "originalPosition": {
                            "anchorRow": 0,
                            "anchorCol": 0,
                            "anchorRowOffset": 0,
                            "anchorColOffset": 0,
                            "endRow": 12,
                            "endCol": 8,
                            "endRowOffset": 0,
                            "endColOffset": 0
                        },
                        "projectionFingerprint": "abc123",
                        "relsPath": "xl/charts/_rels/chartEx1.xml.rels",
                        "relsXml": rels_xml.clone(),
                        "relationships": [relationship],
                        "auxiliaryFiles": [["xl/charts/style1.xml", style_xml.clone()]]
                    },
                    "isChartEx": true
                }
            }))
            .expect("valid chart data"),
        ),
    };

    let restored = yrs_roundtrip(&obj);
    let restored_chart = match &restored.data {
        FloatingObjectData::Chart(chart) => chart,
        other => panic!("expected chart object, got {other:?}"),
    };
    let ooxml = restored_chart.ooxml.as_ref().expect("chart OOXML sidecar");
    let frame = ooxml.drawing_frame.as_ref().expect("drawing frame sidecar");
    assert_eq!(frame.relationship_id.as_deref(), Some("rId7"));
    assert_eq!(
        frame.relationship_target.as_deref(),
        Some("../charts/chartEx1.xml")
    );
    assert_eq!(
        frame.raw_alternate_content.as_deref(),
        Some("<mc:AlternateContent/>")
    );
    assert_eq!(
        ooxml
            .standard_chart_provenance
            .as_ref()
            .and_then(|provenance| provenance.original_path.as_deref()),
        Some("xl/charts/chartEx1.xml")
    );
    assert_eq!(
        ooxml
            .standard_chart_export_authority
            .as_ref()
            .and_then(|authority| authority.package_owner.as_deref()),
        Some("xl/charts/chartEx1.xml")
    );
    assert_eq!(
        ooxml
            .chart_relationships
            .first()
            .and_then(|relationship| relationship.target.as_deref()),
        Some("style1.xml")
    );
    assert_eq!(
        ooxml
            .chart_auxiliary_files
            .first()
            .map(|(path, bytes)| (path.as_str(), bytes.as_slice())),
        Some(("xl/charts/style1.xml", style_xml.as_slice()))
    );

    let replay = ooxml.chart_ex_replay.as_ref().expect("ChartEx replay");
    assert_eq!(replay.original_path, "xl/charts/chartEx1.xml");
    assert_eq!(replay.original_xml, chart_xml);
    assert_eq!(replay.rels_xml.as_deref(), Some(rels_xml.as_slice()));
    assert_eq!(
        replay
            .relationships
            .first()
            .and_then(|relationship| relationship.target.as_deref()),
        Some("style1.xml")
    );
    assert_eq!(
        replay
            .auxiliary_files
            .first()
            .map(|(path, bytes)| (path.as_str(), bytes.as_slice())),
        Some(("xl/charts/style1.xml", style_xml.as_slice()))
    );
}
