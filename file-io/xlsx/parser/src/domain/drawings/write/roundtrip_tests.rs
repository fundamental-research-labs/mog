//! Roundtrip validation tests for connectors and group shapes.
//!
//! Each test follows the pattern:
//! 1. Build a write-side props struct (e.g. `ConnectorProps`, `GroupShapeProps`)
//! 2. Serialize to XML via `DrawingWriter`
//! 3. Re-parse the XML via `parse_drawing` (read-side)
//! 4. Convert back via conversion functions (read → write)
//! 5. Assert that all supported properties survive the trip
//!
//! Known limitations documented inline:
//! - The writer assigns its own `id` to `cNvPr`, so the numeric ID will differ.

#[cfg(test)]
mod tests {
    use crate::domain::drawings::write::DrawingWriter;
    use crate::domain::drawings::write::convert::connector_to_props;
    use crate::domain::drawings::write::types::{
        CellAnchor, Connection, ConnectorProps, DrawingColor, DrawingFill, Outline, PresetGeometry,
        SolidFill, StyleRef, Transform2D,
    };
    use crate::domain::drawings::{Anchor, DrawingContent, SpreadsheetConnector, parse_drawing};
    use ooxml_types::drawings::{
        CompoundLine, DashStyle, DrawingLocking, FontCollectionIndex, FontReference, Hyperlink,
        LineCap, LineDash, LineEndProperties, LineEndSize, LineEndType, LineFill, LineJoin,
        PenAlignment, ShapePreset, ShapeStyle, StAngle, StStyleMatrixColumnIndex,
    };

    // =========================================================================
    // Helpers
    // =========================================================================

    /// Helper to create a DrawingColor from an RGB hex string.
    fn rgb(hex: &str) -> DrawingColor {
        DrawingColor::SrgbClr {
            val: hex.into(),
            transforms: vec![],
        }
    }

    /// Helper to create a solid fill from an RGB hex string.
    fn solid_fill(hex: &str) -> DrawingFill {
        DrawingFill::Solid(SolidFill { color: rgb(hex) })
    }

    /// Default anchors used for all roundtrip tests (values don't affect
    /// connector properties, just needed to build a valid drawing).
    fn default_anchors() -> (CellAnchor, CellAnchor) {
        (
            CellAnchor {
                col: 0,
                col_off: 0,
                row: 0,
                row_off: 0,
            },
            CellAnchor {
                col: 5,
                col_off: 0,
                row: 5,
                row_off: 0,
            },
        )
    }

    /// Build a minimal `ConnectorProps` with only a name set.
    fn minimal_props() -> ConnectorProps {
        ConnectorProps {
            original_id: None,
            name: "TestConnector".into(),
            description: None,
            title: None,
            hidden: false,
            hlink_click: None,
            hlink_hover: None,
            nv_ext_lst: None,
            start_connection: None,
            end_connection: None,
            locks: DrawingLocking::default(),
            transform: Transform2D::default(),
            preset_geometry: None,
            fill: None,
            outline: None,
            style: None,
            macro_name: None,
        }
    }

    /// Extract the first `SpreadsheetConnector` from a parsed `Drawing`.
    fn extract_connector(xml: &[u8]) -> SpreadsheetConnector {
        let drawing = parse_drawing(xml);
        for anchor in &drawing.anchors {
            let content = match anchor {
                Anchor::TwoCell(a) => &a.content,
                Anchor::OneCell(a) => &a.content,
                Anchor::Absolute(a) => &a.content,
            };
            if let DrawingContent::Connector(c) = content {
                return c.clone();
            }
        }
        panic!("No connector found in parsed drawing XML");
    }

    /// Roundtrip a `ConnectorProps`:
    ///   write → XML bytes → parse_drawing → extract connector → convert → second `ConnectorProps`
    ///
    /// Returns `(original_props, roundtripped_props)`.
    fn roundtrip(props: ConnectorProps) -> (ConnectorProps, ConnectorProps) {
        let (from, to) = default_anchors();

        // 1. Serialize
        let mut writer = DrawingWriter::new();
        writer.add_connector(from, to, props.clone());
        let xml_bytes = writer.to_xml();

        // 2. Parse the full drawing and extract the connector
        let connector = extract_connector(&xml_bytes);

        // 3. Convert back to write-side props
        let rt_props = connector_to_props(&connector);

        (props, rt_props)
    }

    /// Helper: extract RGB hex from an Outline's fill color
    fn outline_color_rgb(outline: &Outline) -> Option<&str> {
        outline.fill.as_ref().and_then(|f| match f {
            LineFill::Solid(sf) => match &sf.color {
                DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
                _ => None,
            },
            _ => None,
        })
    }

    /// Helper: extract RGB hex from a StyleRef's color
    fn style_ref_color_rgb(sr: &StyleRef) -> Option<&str> {
        sr.color.as_ref().and_then(|c| match c {
            DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
            _ => None,
        })
    }

    // =========================================================================
    // 6c: Connection endpoint roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_connection_endpoints() {
        let mut props = minimal_props();
        props.start_connection = Some(Connection {
            shape_id: 5,
            idx: 2,
        });
        props.end_connection = Some(Connection {
            shape_id: 8,
            idx: 0,
        });

        let (orig, rt) = roundtrip(props);

        let orig_st = orig.start_connection.as_ref().unwrap();
        let rt_st = rt.start_connection.as_ref().unwrap();
        assert_eq!(rt_st.shape_id, orig_st.shape_id);
        assert_eq!(rt_st.idx, orig_st.idx);

        let orig_en = orig.end_connection.as_ref().unwrap();
        let rt_en = rt.end_connection.as_ref().unwrap();
        assert_eq!(rt_en.shape_id, orig_en.shape_id);
        assert_eq!(rt_en.idx, orig_en.idx);
    }

    // =========================================================================
    // 6d: Arrowhead roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_arrowheads() {
        let mut props = minimal_props();
        props.outline = Some(Outline {
            width: Some(12700),
            head_end: Some(LineEndProperties {
                end_type: Some(LineEndType::Triangle),
                width: Some(LineEndSize::Medium),
                length: Some(LineEndSize::Large),
            }),
            tail_end: Some(LineEndProperties {
                end_type: Some(LineEndType::Stealth),
                width: Some(LineEndSize::Small),
                length: Some(LineEndSize::Small),
            }),
            ..Default::default()
        });

        let (_orig, rt) = roundtrip(props);
        let outline = rt
            .outline
            .as_ref()
            .expect("outline missing after roundtrip");

        let head = outline.head_end.as_ref().expect("head_end missing");
        assert_eq!(head.end_type, Some(LineEndType::Triangle));
        assert_eq!(head.width, Some(LineEndSize::Medium));
        assert_eq!(head.length, Some(LineEndSize::Large));

        let tail = outline.tail_end.as_ref().expect("tail_end missing");
        assert_eq!(tail.end_type, Some(LineEndType::Stealth));
        assert_eq!(tail.width, Some(LineEndSize::Small));
        assert_eq!(tail.length, Some(LineEndSize::Small));
    }

    // =========================================================================
    // 6e: Full outline roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_full_outline() {
        let mut props = minimal_props();
        props.outline = Some(Outline {
            width: Some(25400),
            fill: Some(LineFill::Solid(SolidFill {
                color: rgb("FF0000"),
            })),
            dash: Some(LineDash::Preset(DashStyle::LongDash)),
            compound: Some(CompoundLine::Double),
            cap: Some(LineCap::Round),
            head_end: Some(LineEndProperties {
                end_type: Some(LineEndType::Diamond),
                width: Some(LineEndSize::Large),
                length: Some(LineEndSize::Large),
            }),
            tail_end: Some(LineEndProperties {
                end_type: Some(LineEndType::Arrow),
                width: Some(LineEndSize::Medium),
                length: Some(LineEndSize::Medium),
            }),
            join: Some(LineJoin::Miter {
                limit: Some(800000),
            }),
            align: None,
        });

        let (_orig, rt) = roundtrip(props);
        let outline = rt
            .outline
            .as_ref()
            .expect("outline missing after roundtrip");

        assert_eq!(outline.width, Some(25400));
        assert_eq!(outline_color_rgb(outline), Some("FF0000"));
        assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::LongDash)));
        assert_eq!(outline.compound, Some(CompoundLine::Double));
        assert_eq!(outline.cap, Some(LineCap::Round));

        match &outline.join {
            Some(LineJoin::Miter { limit }) => assert_eq!(*limit, Some(800000)),
            other => panic!("expected Miter join, got {:?}", other),
        }

        let head = outline.head_end.as_ref().expect("head_end missing");
        assert_eq!(head.end_type, Some(LineEndType::Diamond));
        assert_eq!(head.width, Some(LineEndSize::Large));
        assert_eq!(head.length, Some(LineEndSize::Large));

        let tail = outline.tail_end.as_ref().expect("tail_end missing");
        assert_eq!(tail.end_type, Some(LineEndType::Arrow));
        assert_eq!(tail.width, Some(LineEndSize::Medium));
        assert_eq!(tail.length, Some(LineEndSize::Medium));
    }

    // =========================================================================
    // 6f: Locking roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_locks() {
        let mut props = minimal_props();
        props.locks = DrawingLocking {
            no_move: true,
            no_resize: true,
            no_change_arrowheads: true,
            no_grp: false,
            no_select: false,
            no_rot: false,
            no_change_aspect: false,
            no_edit_points: false,
            no_adjust_handles: false,
            no_change_shape_type: false,
            ..Default::default()
        };

        let (_orig, rt) = roundtrip(props);

        assert!(rt.locks.no_move, "no_move should be true");
        assert!(rt.locks.no_resize, "no_resize should be true");
        assert!(
            rt.locks.no_change_arrowheads,
            "no_change_arrowheads should be true"
        );
        assert!(!rt.locks.no_grp, "no_grp should be false");
        assert!(!rt.locks.no_select, "no_select should be false");
        assert!(!rt.locks.no_rot, "no_rot should be false");
        assert!(
            !rt.locks.no_change_aspect,
            "no_change_aspect should be false"
        );
        assert!(!rt.locks.no_edit_points, "no_edit_points should be false");
        assert!(
            !rt.locks.no_adjust_handles,
            "no_adjust_handles should be false"
        );
        assert!(
            !rt.locks.no_change_shape_type,
            "no_change_shape_type should be false"
        );
    }

    #[test]
    fn roundtrip_all_locks_true() {
        let mut props = minimal_props();
        props.locks = DrawingLocking {
            no_grp: true,
            no_select: true,
            no_rot: true,
            no_change_aspect: true,
            no_move: true,
            no_resize: true,
            no_edit_points: true,
            no_adjust_handles: true,
            no_change_arrowheads: true,
            no_change_shape_type: true,
            ..Default::default()
        };

        let (_orig, rt) = roundtrip(props);

        assert!(rt.locks.no_grp);
        assert!(rt.locks.no_select);
        assert!(rt.locks.no_rot);
        assert!(rt.locks.no_change_aspect);
        assert!(rt.locks.no_move);
        assert!(rt.locks.no_resize);
        assert!(rt.locks.no_edit_points);
        assert!(rt.locks.no_adjust_handles);
        assert!(rt.locks.no_change_arrowheads);
        assert!(rt.locks.no_change_shape_type);
    }

    // =========================================================================
    // 6g: Style roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_style() {
        let mut props = minimal_props();
        props.style = Some(ShapeStyle {
            line_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(2),
                color: Some(rgb("4472C4")),
            },
            fill_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(0),
                color: None,
            },
            effect_ref: StyleRef {
                idx: StStyleMatrixColumnIndex::new(1),
                color: Some(rgb("4472C4")),
            },
            font_ref: FontReference {
                idx: FontCollectionIndex::Minor,
                color: None,
            },
        });

        let (_orig, rt) = roundtrip(props);
        let style = rt.style.as_ref().expect("style missing after roundtrip");

        assert_eq!(style.line_ref.idx, StStyleMatrixColumnIndex::new(2));
        assert_eq!(style_ref_color_rgb(&style.line_ref), Some("4472C4"));

        assert_eq!(style.fill_ref.idx, StStyleMatrixColumnIndex::new(0));
        assert!(style.fill_ref.color.is_none());

        assert_eq!(style.effect_ref.idx, StStyleMatrixColumnIndex::new(1));
        assert_eq!(style_ref_color_rgb(&style.effect_ref), Some("4472C4"));

        assert!(style.font_ref.color.is_none());
    }

    // =========================================================================
    // 6h: Regression test — connectors survive save
    // =========================================================================

    #[test]
    fn roundtrip_connectors_survive_save() {
        let mut props = minimal_props();
        props.name = "FlowArrow".into();
        props.start_connection = Some(Connection {
            shape_id: 3,
            idx: 1,
        });
        props.end_connection = Some(Connection {
            shape_id: 7,
            idx: 3,
        });
        props.outline = Some(Outline {
            width: Some(19050),
            fill: Some(LineFill::Solid(SolidFill {
                color: rgb("0070C0"),
            })),
            dash: Some(LineDash::Preset(DashStyle::Dash)),
            head_end: Some(LineEndProperties {
                end_type: Some(LineEndType::Triangle),
                width: Some(LineEndSize::Medium),
                length: Some(LineEndSize::Medium),
            }),
            tail_end: Some(LineEndProperties {
                end_type: Some(LineEndType::Arrow),
                width: Some(LineEndSize::Large),
                length: Some(LineEndSize::Large),
            }),
            join: Some(LineJoin::Round),
            ..Default::default()
        });
        props.preset_geometry = Some(PresetGeometry {
            prst: ShapePreset::BentConnector3,
            av_list: vec![],
        });

        let (orig, rt) = roundtrip(props);

        // Name
        assert_eq!(rt.name, orig.name);

        // Connections
        let rt_st = rt.start_connection.as_ref().unwrap();
        assert_eq!(rt_st.shape_id, 3);
        assert_eq!(rt_st.idx, 1);
        let rt_en = rt.end_connection.as_ref().unwrap();
        assert_eq!(rt_en.shape_id, 7);
        assert_eq!(rt_en.idx, 3);

        // Outline
        let outline = rt.outline.as_ref().unwrap();
        assert_eq!(outline.width, Some(19050));
        assert_eq!(outline_color_rgb(outline), Some("0070C0"));
        assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::Dash)));

        let head = outline.head_end.as_ref().unwrap();
        assert_eq!(head.end_type, Some(LineEndType::Triangle));
        assert_eq!(head.width, Some(LineEndSize::Medium));
        assert_eq!(head.length, Some(LineEndSize::Medium));

        let tail = outline.tail_end.as_ref().unwrap();
        assert_eq!(tail.end_type, Some(LineEndType::Arrow));
        assert_eq!(tail.width, Some(LineEndSize::Large));
        assert_eq!(tail.length, Some(LineEndSize::Large));

        match &outline.join {
            Some(LineJoin::Round) => {} // expected
            other => panic!("expected Round join, got {:?}", other),
        }

        // Preset geometry
        assert_eq!(
            rt.preset_geometry.as_ref().map(|pg| pg.prst),
            Some(ShapePreset::BentConnector3)
        );
    }

    // =========================================================================
    // 6i: Kitchen-sink roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_kitchen_sink() {
        // Every supported property set at once.
        let props = ConnectorProps {
            original_id: None,
            name: "KitchenSinkConnector".into(),
            description: Some("Full description".into()),
            title: Some("Connector Title".into()),
            hidden: true,
            hlink_click: Some(Hyperlink {
                r_id: Some("rId1".into()),
                tooltip: Some("Click here".into()),
                action: Some("ppaction://hlinksldjump".into()),
                ..Default::default()
            }),
            hlink_hover: Some(Hyperlink {
                r_id: Some("rId2".into()),
                tooltip: Some("Hover text".into()),
                action: None,
                ..Default::default()
            }),
            start_connection: Some(Connection {
                shape_id: 10,
                idx: 0,
            }),
            end_connection: Some(Connection {
                shape_id: 20,
                idx: 4,
            }),
            locks: DrawingLocking {
                no_grp: true,
                no_select: false,
                no_rot: true,
                no_change_aspect: false,
                no_move: true,
                no_resize: true,
                no_edit_points: false,
                no_adjust_handles: true,
                no_change_arrowheads: true,
                no_change_shape_type: false,
                ..Default::default()
            },
            transform: Transform2D {
                offset: Some((1000000, 2000000)),
                extent: Some((3000000, 500000)),
                rotation: Some(StAngle::new(5400000)),
                flip_h: Some(true),
                flip_v: Some(false),
            },
            preset_geometry: Some(PresetGeometry {
                prst: ShapePreset::CurvedConnector3,
                av_list: vec![],
            }),
            fill: Some(solid_fill("00FF00")),
            outline: Some(Outline {
                width: Some(38100),
                fill: Some(LineFill::Solid(SolidFill {
                    color: rgb("0000FF"),
                })),
                dash: Some(LineDash::Preset(DashStyle::LongDashDot)),
                compound: Some(CompoundLine::ThickThin),
                cap: Some(LineCap::Flat),
                head_end: Some(LineEndProperties {
                    end_type: Some(LineEndType::Oval),
                    width: Some(LineEndSize::Large),
                    length: Some(LineEndSize::Small),
                }),
                tail_end: Some(LineEndProperties {
                    end_type: Some(LineEndType::Diamond),
                    width: Some(LineEndSize::Small),
                    length: Some(LineEndSize::Large),
                }),
                join: Some(LineJoin::Bevel),
                align: Some(PenAlignment::Center),
            }),
            style: Some(ShapeStyle {
                line_ref: StyleRef {
                    idx: StStyleMatrixColumnIndex::new(3),
                    color: Some(rgb("FF5733")),
                },
                fill_ref: StyleRef {
                    idx: StStyleMatrixColumnIndex::new(1),
                    color: Some(rgb("33FF57")),
                },
                effect_ref: StyleRef {
                    idx: StStyleMatrixColumnIndex::new(2),
                    color: None,
                },
                font_ref: FontReference {
                    idx: FontCollectionIndex::Minor,
                    color: Some(rgb("5733FF")),
                },
            }),
            macro_name: Some("MyConnectorMacro".into()),
            nv_ext_lst: None,
        };

        let (orig, rt) = roundtrip(props);

        // -- Non-visual properties --
        assert_eq!(rt.name, orig.name);
        assert_eq!(rt.description, orig.description);
        assert_eq!(rt.title, orig.title);
        assert_eq!(rt.hidden, orig.hidden);

        // Hyperlinks
        let hc = rt.hlink_click.as_ref().expect("hlink_click missing");
        assert_eq!(hc.r_id.as_deref(), Some("rId1"));
        assert_eq!(hc.tooltip.as_deref(), Some("Click here"));
        assert_eq!(hc.action.as_deref(), Some("ppaction://hlinksldjump"));

        let hh = rt.hlink_hover.as_ref().expect("hlink_hover missing");
        assert_eq!(hh.r_id.as_deref(), Some("rId2"));
        assert_eq!(hh.tooltip.as_deref(), Some("Hover text"));
        assert!(hh.action.is_none());

        // -- Connections --
        let st = rt.start_connection.as_ref().unwrap();
        assert_eq!(st.shape_id, 10);
        assert_eq!(st.idx, 0);
        let en = rt.end_connection.as_ref().unwrap();
        assert_eq!(en.shape_id, 20);
        assert_eq!(en.idx, 4);

        // -- Locks --
        assert!(rt.locks.no_grp);
        assert!(!rt.locks.no_select);
        assert!(rt.locks.no_rot);
        assert!(!rt.locks.no_change_aspect);
        assert!(rt.locks.no_move);
        assert!(rt.locks.no_resize);
        assert!(!rt.locks.no_edit_points);
        assert!(rt.locks.no_adjust_handles);
        assert!(rt.locks.no_change_arrowheads);
        assert!(!rt.locks.no_change_shape_type);

        // -- Transform --
        assert_eq!(rt.transform.off_x(), 1000000);
        assert_eq!(rt.transform.off_y(), 2000000);
        assert_eq!(rt.transform.ext_cx(), 3000000);
        assert_eq!(rt.transform.ext_cy(), 500000);
        assert_eq!(rt.transform.rot(), StAngle::new(5400000));
        assert!(rt.transform.is_flip_h());
        assert!(!rt.transform.is_flip_v());

        // -- Preset geometry --
        assert_eq!(
            rt.preset_geometry.as_ref().map(|pg| pg.prst),
            Some(ShapePreset::CurvedConnector3)
        );

        // -- Fill --
        match rt.fill.as_ref().expect("fill missing") {
            DrawingFill::Solid(sf) => match &sf.color {
                DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "00FF00"),
                other => panic!("expected SrgbClr, got {:?}", other),
            },
            other => panic!("expected Solid fill, got {:?}", other),
        }

        // -- Outline --
        let outline = rt.outline.as_ref().expect("outline missing");
        assert_eq!(outline.width, Some(38100));
        assert_eq!(outline_color_rgb(outline), Some("0000FF"));
        assert_eq!(outline.dash, Some(LineDash::Preset(DashStyle::LongDashDot)));
        assert_eq!(outline.compound, Some(CompoundLine::ThickThin));
        assert_eq!(outline.cap, Some(LineCap::Flat));
        assert_eq!(outline.align, Some(PenAlignment::Center));

        match &outline.join {
            Some(LineJoin::Bevel) => {} // expected
            other => panic!("expected Bevel join, got {:?}", other),
        }

        let head = outline.head_end.as_ref().expect("head_end missing");
        assert_eq!(head.end_type, Some(LineEndType::Oval));
        assert_eq!(head.width, Some(LineEndSize::Large));
        assert_eq!(head.length, Some(LineEndSize::Small));

        let tail = outline.tail_end.as_ref().expect("tail_end missing");
        assert_eq!(tail.end_type, Some(LineEndType::Diamond));
        assert_eq!(tail.width, Some(LineEndSize::Small));
        assert_eq!(tail.length, Some(LineEndSize::Large));

        // -- Style --
        let style = rt.style.as_ref().expect("style missing");
        assert_eq!(style.line_ref.idx, StStyleMatrixColumnIndex::new(3));
        assert_eq!(style_ref_color_rgb(&style.line_ref), Some("FF5733"));

        assert_eq!(style.fill_ref.idx, StStyleMatrixColumnIndex::new(1));
        assert_eq!(style_ref_color_rgb(&style.fill_ref), Some("33FF57"));

        assert_eq!(style.effect_ref.idx, StStyleMatrixColumnIndex::new(2));
        assert!(style.effect_ref.color.is_none());

        match &style.font_ref.color {
            Some(DrawingColor::SrgbClr { val, .. }) => assert_eq!(val, "5733FF"),
            other => panic!("expected SrgbClr for font_ref color, got {:?}", other),
        }

        // -- Macro --
        assert_eq!(rt.macro_name.as_deref(), Some("MyConnectorMacro"));
    }

    // =========================================================================
    // Additional edge-case roundtrip tests
    // =========================================================================

    #[test]
    fn roundtrip_minimal_connector() {
        let props = minimal_props();
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.name, "TestConnector");
        assert!(rt.description.is_none());
        assert!(rt.title.is_none());
        assert!(!rt.hidden);
        assert!(rt.hlink_click.is_none());
        assert!(rt.hlink_hover.is_none());
        assert!(rt.start_connection.is_none());
        assert!(rt.end_connection.is_none());
        assert!(!rt.locks.no_move);
        assert!(!rt.locks.no_resize);
        assert!(rt.fill.is_none());
        assert!(rt.outline.is_none());
        assert!(rt.preset_geometry.is_none());
        assert!(rt.style.is_none());
        assert!(rt.macro_name.is_none());
    }

    #[test]
    fn roundtrip_no_fill() {
        let mut props = minimal_props();
        props.fill = Some(DrawingFill::NoFill);

        let (_orig, rt) = roundtrip(props);
        match rt.fill {
            Some(DrawingFill::NoFill) | None => {} // OK
            other => panic!("expected NoFill or None, got {:?}", other),
        }
    }

    #[test]
    fn roundtrip_solid_fill() {
        let mut props = minimal_props();
        props.fill = Some(solid_fill("ABCDEF"));

        let (_orig, rt) = roundtrip(props);
        match rt.fill.as_ref().expect("fill missing") {
            DrawingFill::Solid(sf) => match &sf.color {
                DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "ABCDEF"),
                other => panic!("expected SrgbClr, got {:?}", other),
            },
            other => panic!("expected Solid fill, got {:?}", other),
        }
    }

    #[test]
    fn roundtrip_outline_round_join() {
        let mut props = minimal_props();
        props.outline = Some(Outline {
            width: Some(12700),
            join: Some(LineJoin::Round),
            ..Default::default()
        });

        let (_orig, rt) = roundtrip(props);
        let outline = rt.outline.as_ref().expect("outline missing");
        match &outline.join {
            Some(LineJoin::Round) => {} // expected
            other => panic!("expected Round join, got {:?}", other),
        }
    }

    #[test]
    fn roundtrip_outline_bevel_join() {
        let mut props = minimal_props();
        props.outline = Some(Outline {
            width: Some(12700),
            join: Some(LineJoin::Bevel),
            ..Default::default()
        });

        let (_orig, rt) = roundtrip(props);
        let outline = rt.outline.as_ref().expect("outline missing");
        match &outline.join {
            Some(LineJoin::Bevel) => {} // expected
            other => panic!("expected Bevel join, got {:?}", other),
        }
    }

    #[test]
    fn roundtrip_outline_miter_no_limit() {
        let mut props = minimal_props();
        props.outline = Some(Outline {
            width: Some(12700),
            join: Some(LineJoin::Miter { limit: None }),
            ..Default::default()
        });

        let (_orig, rt) = roundtrip(props);
        let outline = rt.outline.as_ref().expect("outline missing");
        match &outline.join {
            Some(LineJoin::Miter { limit }) => assert!(limit.is_none()),
            other => panic!("expected Miter join with no limit, got {:?}", other),
        }
    }

    #[test]
    fn roundtrip_pen_alignment() {
        let mut props = minimal_props();
        props.outline = Some(Outline {
            width: Some(12700),
            align: Some(PenAlignment::Center),
            ..Default::default()
        });

        let (_orig, rt) = roundtrip(props);
        let outline = rt.outline.as_ref().expect("outline missing");
        assert_eq!(outline.align, Some(PenAlignment::Center));
    }

    #[test]
    fn roundtrip_preset_geometry_variants() {
        for preset in [
            ShapePreset::StraightConnector1,
            ShapePreset::BentConnector3,
            ShapePreset::CurvedConnector3,
        ] {
            let mut props = minimal_props();
            props.preset_geometry = Some(PresetGeometry {
                prst: preset,
                av_list: vec![],
            });

            let (_orig, rt) = roundtrip(props);
            assert_eq!(
                rt.preset_geometry.as_ref().map(|pg| pg.prst),
                Some(preset),
                "preset geometry {:?} did not roundtrip",
                preset,
            );
        }
    }

    #[test]
    fn roundtrip_macro_name() {
        let mut props = minimal_props();
        props.macro_name = Some("Sheet1.ConnectorClick".into());

        let (_orig, rt) = roundtrip(props);
        assert_eq!(rt.macro_name.as_deref(), Some("Sheet1.ConnectorClick"));
    }

    #[test]
    fn roundtrip_transform() {
        let mut props = minimal_props();
        props.transform = Transform2D {
            offset: Some((914400, 1828800)),
            extent: Some((2743200, 457200)),
            rotation: Some(StAngle::new(2700000)),
            flip_h: Some(false),
            flip_v: Some(true),
        };

        let (_orig, rt) = roundtrip(props);
        assert_eq!(rt.transform.off_x(), 914400);
        assert_eq!(rt.transform.off_y(), 1828800);
        assert_eq!(rt.transform.ext_cx(), 2743200);
        assert_eq!(rt.transform.ext_cy(), 457200);
        assert_eq!(rt.transform.rot(), StAngle::new(2700000));
        assert!(!rt.transform.is_flip_h());
        assert!(rt.transform.is_flip_v());
    }
}

// =============================================================================
// Group Shape Roundtrip Tests
// =============================================================================

#[cfg(test)]
mod group_shape_tests {
    use crate::domain::drawings::write::DrawingWriter;
    use crate::domain::drawings::write::convert::group_shape_to_props;
    use crate::domain::drawings::write::types::{
        BlackWhiteMode, CellAnchor, ClientData, ConnectorProps, DrawingAnchor, DrawingColor,
        DrawingFill, DrawingObject, EditAs, GroupLocking, GroupShapeProps, GroupTransform2D,
        OpaqueGraphicFrame, SolidFill, TwoCellAnchor,
    };
    use crate::domain::drawings::{Anchor, DrawingContent, parse_drawing};
    use ooxml_types::drawings::{DrawingLocking, StAngle};

    // =========================================================================
    // Helpers
    // =========================================================================

    /// Default anchors used for all roundtrip tests.
    fn default_anchors() -> (CellAnchor, CellAnchor) {
        (
            CellAnchor {
                col: 0,
                col_off: 0,
                row: 0,
                row_off: 0,
            },
            CellAnchor {
                col: 5,
                col_off: 0,
                row: 5,
                row_off: 0,
            },
        )
    }

    /// Build a minimal `GroupShapeProps` with only a name and transform set.
    fn minimal_group_props() -> GroupShapeProps {
        GroupShapeProps {
            original_id: None,
            name: "Group 1".to_string(),
            description: None,
            title: None,
            hidden: false,
            hlink_click: None,
            hlink_hover: None,
            group_locking: None,
            nv_ext_lst: None,
            transform: Some(GroupTransform2D {
                offset: Some((0, 0)),
                extent: Some((5000000, 3000000)),
                child_offset: Some((0, 0)),
                child_extent: Some((5000000, 3000000)),
                rotation: None,
                flip_h: None,
                flip_v: None,
            }),
            fill: None,
            effects: None,
            bw_mode: None,
            scene3d: None,
            ext_lst: None,
            children: vec![],
        }
    }

    /// Build a minimal `ConnectorProps` for use as a group child.
    fn minimal_connector_props() -> ConnectorProps {
        ConnectorProps {
            original_id: None,
            name: "ChildConnector".into(),
            description: None,
            title: None,
            hidden: false,
            hlink_click: None,
            hlink_hover: None,
            nv_ext_lst: None,
            start_connection: None,
            end_connection: None,
            locks: DrawingLocking::default(),
            transform: Default::default(),
            preset_geometry: None,
            fill: None,
            outline: None,
            style: None,
            macro_name: None,
        }
    }

    /// Write a `GroupShapeProps`, parse the XML back, extract the group, and
    /// convert back to write-side props.
    ///
    /// Returns `(original, roundtripped)`.
    fn roundtrip_group(props: GroupShapeProps) -> (GroupShapeProps, GroupShapeProps) {
        let original = props.clone();

        let (from, to) = default_anchors();
        let anchor = DrawingAnchor::TwoCell(
            TwoCellAnchor {
                from,
                to,
                edit_as: Some(EditAs::TwoCell),
                client_data: ClientData::default(),
                ..Default::default()
            },
            DrawingObject::GroupShape(props),
        );
        let mut writer = DrawingWriter::new();
        writer.add_anchor(anchor);
        let xml = writer.to_xml();

        // Parse back
        let drawing = parse_drawing(&xml);
        let group = match &drawing.anchors[0] {
            Anchor::TwoCell(a) => match &a.content {
                DrawingContent::GroupShape(g) => g.clone(),
                other => panic!("expected GroupShape, got {:?}", other),
            },
            other => panic!("expected TwoCell anchor, got {:?}", other),
        };

        // Convert back to write-side
        let roundtripped = group_shape_to_props(&group);

        (original, roundtripped)
    }

    // =========================================================================
    // Tests
    // =========================================================================

    #[test]
    fn roundtrip_group_basic() {
        let props = minimal_group_props();
        let (original, roundtripped) = roundtrip_group(props);

        assert_eq!(roundtripped.name, original.name);
        let xfrm = roundtripped.transform.as_ref().unwrap();
        assert_eq!(xfrm.offset, Some((0, 0)));
        assert_eq!(xfrm.extent, Some((5000000, 3000000)));
        assert_eq!(xfrm.child_offset, Some((0, 0)));
        assert_eq!(xfrm.child_extent, Some((5000000, 3000000)));
    }

    #[test]
    fn roundtrip_group_locking() {
        let mut props = minimal_group_props();
        props.group_locking = Some(GroupLocking {
            no_grp: true,
            no_ungrp: true,
            no_select: false,
            no_rot: true,
            no_change_aspect: true,
            no_move: false,
            no_resize: true,
            ext_lst: None,
        });

        let (_, roundtripped) = roundtrip_group(props);
        let locks = roundtripped.group_locking.as_ref().unwrap();
        assert!(locks.no_grp);
        assert!(locks.no_ungrp);
        assert!(!locks.no_select);
        assert!(locks.no_rot);
        assert!(locks.no_change_aspect);
        assert!(!locks.no_move);
        assert!(locks.no_resize);
    }

    #[test]
    fn roundtrip_group_transform_scaling() {
        let mut props = minimal_group_props();
        props.transform = Some(GroupTransform2D {
            offset: Some((100000, 200000)),
            extent: Some((10000000, 6000000)),
            child_offset: Some((50000, 50000)),
            child_extent: Some((5000000, 3000000)), // Different from ext = scaling
            rotation: Some(StAngle::new(5400000)),
            flip_h: Some(true),
            flip_v: Some(false),
        });

        let (_, roundtripped) = roundtrip_group(props);
        let xfrm = roundtripped.transform.as_ref().unwrap();
        assert_eq!(xfrm.offset, Some((100000, 200000)));
        assert_eq!(xfrm.extent, Some((10000000, 6000000)));
        assert_eq!(xfrm.child_offset, Some((50000, 50000)));
        assert_eq!(xfrm.child_extent, Some((5000000, 3000000)));
        assert_eq!(xfrm.rotation, Some(StAngle::new(5400000)));
        assert_eq!(xfrm.flip_h, Some(true));
        // flipV="false" is the default — writer may omit it, parser returns None
        assert!(xfrm.flip_v.is_none() || xfrm.flip_v == Some(false));
    }

    #[test]
    fn roundtrip_group_fill_and_bw_mode() {
        let mut props = minimal_group_props();
        props.fill = Some(DrawingFill::Solid(SolidFill {
            color: DrawingColor::SrgbClr {
                val: "FF0000".into(),
                transforms: vec![],
            },
        }));
        props.bw_mode = Some(BlackWhiteMode::Auto);

        let (_, roundtripped) = roundtrip_group(props);
        assert!(roundtripped.fill.is_some());
        // The fill should roundtrip as a typed solid fill with our color
        match roundtripped.fill.as_ref().unwrap() {
            DrawingFill::Solid(sf) => match &sf.color {
                DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
                other => panic!("expected SrgbClr, got {:?}", other),
            },
            other => panic!("expected Solid fill, got {:?}", other),
        }
        assert_eq!(roundtripped.bw_mode, Some(BlackWhiteMode::Auto));
    }

    #[test]
    fn roundtrip_group_with_connector_child() {
        let mut props = minimal_group_props();
        props
            .children
            .push(DrawingObject::Connector(minimal_connector_props()));

        let (_, roundtripped) = roundtrip_group(props);
        assert_eq!(roundtripped.children.len(), 1);
        match &roundtripped.children[0] {
            DrawingObject::Connector(_c) => {
                // Connector survives roundtrip inside group
            }
            other => panic!("expected Connector child, got {:?}", other),
        }
    }

    /// Test that a group with multiple children of different types roundtrips.
    #[test]
    fn roundtrip_group_multiple_children() {
        let mut props = minimal_group_props();
        props.name = "Multi-child Group".to_string();
        // Add two connectors as children
        let mut c1 = minimal_connector_props();
        c1.name = "Connector A".to_string();
        let mut c2 = minimal_connector_props();
        c2.name = "Connector B".to_string();
        props.children.push(DrawingObject::Connector(c1));
        props.children.push(DrawingObject::Connector(c2));

        let (_, roundtripped) = roundtrip_group(props);
        assert_eq!(roundtripped.name, "Multi-child Group");
        // Both connectors should survive
        let connectors: Vec<_> = roundtripped
            .children
            .iter()
            .filter_map(|c| match c {
                DrawingObject::Connector(cp) => Some(cp),
                _ => None,
            })
            .collect();
        assert_eq!(connectors.len(), 2);
    }

    #[test]
    fn roundtrip_group_with_graphic_frame() {
        let mut props = minimal_group_props();
        let gf_xml = r#"<xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="5" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>"#;
        props
            .children
            .push(DrawingObject::GraphicFrame(OpaqueGraphicFrame {
                raw_xml: gf_xml.to_string(),
            }));

        let (_, roundtripped) = roundtrip_group(props);
        assert_eq!(roundtripped.children.len(), 1);
        match &roundtripped.children[0] {
            DrawingObject::GraphicFrame(gf) => {
                assert!(gf.raw_xml.contains("Chart 1"));
            }
            other => panic!("expected GraphicFrame child, got {:?}", other),
        }
    }
}
