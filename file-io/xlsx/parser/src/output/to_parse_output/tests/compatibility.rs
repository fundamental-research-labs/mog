use super::super::{
    append_import_compatibility_acknowledgements, count_ooxml_smartart_diagrams,
    count_ooxml_wordart_text_effects,
};
use super::helpers::{
    group_shape_anchor, smartart_parts, wordart_shape_anchor, wordart_shape_content,
};
use crate::domain::drawings::Drawing;
use crate::output::results::FullParsedSheet;
use domain_types::domain::drawings::{DrawingContent, GroupShapeData};

#[test]
fn compatibility_acknowledgements_count_ooxml_smartart_diagrams() {
    let sheets = vec![
        FullParsedSheet {
            smartart_diagrams: vec![smartart_parts(0), smartart_parts(1)],
            ..FullParsedSheet::default()
        },
        FullParsedSheet {
            smartart_diagrams: vec![smartart_parts(2)],
            ..FullParsedSheet::default()
        },
    ];

    assert_eq!(count_ooxml_smartart_diagrams(&sheets), 3);
}

#[test]
fn compatibility_acknowledgements_count_ooxml_wordart_text_effects() {
    let sheets = vec![FullParsedSheet {
        parsed_drawing: Some(Drawing {
            anchors: vec![
                wordart_shape_anchor(true),
                wordart_shape_anchor(false),
                wordart_shape_anchor(true),
                group_shape_anchor(vec![
                    wordart_shape_content(true),
                    wordart_shape_content(false),
                    DrawingContent::GroupShape(GroupShapeData {
                        children: vec![wordart_shape_content(true)],
                        ..GroupShapeData::default()
                    }),
                ]),
            ],
            ..Drawing::default()
        }),
        ..FullParsedSheet::default()
    }];

    assert_eq!(count_ooxml_wordart_text_effects(&sheets), 4);
}

#[test]
fn compatibility_acknowledgements_add_user_facing_messages() {
    let sheets = vec![FullParsedSheet {
        smartart_diagrams: vec![smartart_parts(0), smartart_parts(1), smartart_parts(2)],
        parsed_drawing: Some(Drawing {
            anchors: vec![wordart_shape_anchor(true), wordart_shape_anchor(true)],
            ..Drawing::default()
        }),
        ..FullParsedSheet::default()
    }];
    let mut diagnostics = domain_types::ParseDiagnostics::default();

    append_import_compatibility_acknowledgements(&sheets, &mut diagnostics);
    let messages: Vec<_> = diagnostics
        .import_report
        .expect("import report")
        .diagnostics
        .into_iter()
        .map(|diagnostic| diagnostic.message)
        .collect();

    assert!(messages.contains(&"Detected 3 diagrams from OOXML SmartArt. Diagram source metadata was preserved; editable Mog diagrams are not materialized yet.".to_string()));
    assert!(messages.contains(&"Loaded 2 text-effect objects from OOXML WordArt.".to_string()));
}
