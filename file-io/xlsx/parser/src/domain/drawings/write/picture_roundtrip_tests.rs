//! Roundtrip validation tests for pictures.
//!
//! Each test follows the pattern:
//! 1. Build an `ImageProps` (write-side)
//! 2. Serialize to XML via `DrawingWriter`
//! 3. Re-parse the XML via `parse_drawing` (read-side)
//! 4. Convert back via `picture_to_image_props` (read → write)
//! 5. Assert that all supported properties survive the trip
//!
//! Known limitations documented inline:
//! - The writer assigns its own `id` to `cNvPr`, so the numeric ID will differ.
//! - Theme/scheme colors in shape fills become `DrawingColor::Srgb` after write,
//!   so they do NOT roundtrip back to their original theme index.

#[cfg(test)]
mod tests {
    use crate::domain::drawings::write::DrawingWriter;
    use crate::domain::drawings::write::convert::picture_to_image_props;
    use crate::domain::drawings::write::types::{
        CellAnchor, ClientData, DrawingAnchor, DrawingObject, ImageProps, PresetGeometry,
        TwoCellAnchor,
    };
    use crate::domain::drawings::{Anchor, DrawingContent, SpreadsheetPicture, parse_drawing};
    use ooxml_types::drawings::{
        BlackWhiteMode, BlipEffect, CompressionState, DrawingLocking, EditAs, EffectList,
        EffectProperties, FillMode, Glow, Hyperlink, OuterShadow, RectAlignment, ShapePreset,
        SourceRect, StAngle, StCoordinate, StPercentage, StPositiveCoordinate,
        StPositiveFixedPercentageDecimal, TileFill, TileFlipMode,
    };

    // =========================================================================
    // Helpers
    // =========================================================================

    /// Default anchors used for all roundtrip tests (values don't affect
    /// picture properties, just needed to build a valid drawing).
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

    /// Build a minimal `ImageProps` with only name and r_id set.
    fn minimal_image() -> ImageProps {
        ImageProps {
            name: "Image 1".into(),
            r_id: "rId1".into(),
            ..Default::default()
        }
    }

    /// Extract the first `SpreadsheetPicture` from a parsed `Drawing`.
    fn extract_picture(xml: &[u8]) -> SpreadsheetPicture {
        let drawing = parse_drawing(xml);
        for anchor in &drawing.anchors {
            let content = match anchor {
                Anchor::TwoCell(a) => &a.content,
                Anchor::OneCell(a) => &a.content,
                Anchor::Absolute(a) => &a.content,
            };
            if let DrawingContent::Picture(p) = content {
                return p.clone();
            }
        }
        panic!("No picture found in parsed drawing XML");
    }

    /// Roundtrip an `ImageProps`:
    ///   write → XML bytes → parse_drawing → extract picture → convert → second `ImageProps`
    ///
    /// Returns `(original_props, roundtripped_props)`.
    fn roundtrip(props: ImageProps) -> (ImageProps, ImageProps) {
        let (from, to) = default_anchors();

        // 1. Serialize
        let mut writer = DrawingWriter::new();
        writer.add_picture(from, to, props.clone());
        let xml_bytes = writer.to_xml();

        // 2. Parse the full drawing and extract the picture
        let picture = extract_picture(&xml_bytes);

        // 3. Convert back to write-side props
        let rt_props = picture_to_image_props(&picture);

        (props, rt_props)
    }

    // =========================================================================
    // Minimal roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_minimal_picture() {
        let props = minimal_image();
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.name, "Image 1");
        assert_eq!(rt.r_id, "rId1");
        assert!(rt.description.is_none());
        assert!(rt.source_rect.is_none());
        assert!(rt.blip_effects.is_empty());
        // Default writer emits <a:stretch><a:fillRect/></a:stretch>, which parses back as
        // Stretch with an all-zeros SourceRect.
        match &rt.fill_mode {
            None => {}
            Some(FillMode::Stretch { fill_rect }) => {
                // Either None or all-zeros is acceptable for the default case
                if let Some(fr) = fill_rect {
                    assert_eq!(fr.top, StPositiveFixedPercentageDecimal::new_unchecked(0));
                    assert_eq!(
                        fr.bottom,
                        StPositiveFixedPercentageDecimal::new_unchecked(0)
                    );
                    assert_eq!(fr.left, StPositiveFixedPercentageDecimal::new_unchecked(0));
                    assert_eq!(fr.right, StPositiveFixedPercentageDecimal::new_unchecked(0));
                }
            }
            other => panic!("expected None or Stretch, got {:?}", other),
        }
        assert!(rt.compression.is_none() || rt.compression == Some(CompressionState::None));
        assert!(!rt.hidden);
        assert!(rt.hlink_click.is_none());
        assert!(rt.hlink_hover.is_none());
        assert!(rt.effects.is_none());
        assert!(rt.macro_name.is_none());
    }

    // =========================================================================
    // Crop (source_rect) roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_crop() {
        let mut props = minimal_image();
        props.source_rect = Some(SourceRect {
            top: StPositiveFixedPercentageDecimal::new_unchecked(10000),
            bottom: StPositiveFixedPercentageDecimal::new_unchecked(20000),
            left: StPositiveFixedPercentageDecimal::new_unchecked(5000),
            right: StPositiveFixedPercentageDecimal::new_unchecked(15000),
        });
        let (_orig, rt) = roundtrip(props);

        let rect = rt.source_rect.expect("source_rect missing");
        assert_eq!(
            rect.top,
            StPositiveFixedPercentageDecimal::new_unchecked(10000)
        );
        assert_eq!(
            rect.bottom,
            StPositiveFixedPercentageDecimal::new_unchecked(20000)
        );
        assert_eq!(
            rect.left,
            StPositiveFixedPercentageDecimal::new_unchecked(5000)
        );
        assert_eq!(
            rect.right,
            StPositiveFixedPercentageDecimal::new_unchecked(15000)
        );
    }

    // =========================================================================
    // Transform roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_transform() {
        let mut props = minimal_image();
        props.offset_x = 914400;
        props.offset_y = 457200;
        props.extent_cx = 1828800;
        props.extent_cy = 914400;
        props.rotation = Some(5400000);
        props.flip_h = true;
        props.flip_v = true;
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.offset_x, 914400);
        assert_eq!(rt.offset_y, 457200);
        assert_eq!(rt.extent_cx, 1828800);
        assert_eq!(rt.extent_cy, 914400);
        assert_eq!(rt.rotation, Some(5400000));
        assert!(rt.flip_h);
        assert!(rt.flip_v);
    }

    #[test]
    fn roundtrip_transform_no_flip() {
        let mut props = minimal_image();
        props.offset_x = 100000;
        props.offset_y = 200000;
        props.extent_cx = 300000;
        props.extent_cy = 400000;
        props.flip_h = false;
        props.flip_v = false;
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.offset_x, 100000);
        assert_eq!(rt.offset_y, 200000);
        assert_eq!(rt.extent_cx, 300000);
        assert_eq!(rt.extent_cy, 400000);
        assert!(!rt.flip_h);
        assert!(!rt.flip_v);
    }

    // =========================================================================
    // Blip effect roundtrips
    // =========================================================================

    #[test]
    fn roundtrip_opacity() {
        let mut props = minimal_image();
        props.blip_effects = vec![BlipEffect::AlphaModFix { amt: 50000 }];
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.blip_effects.len(), 1);
        match &rt.blip_effects[0] {
            BlipEffect::AlphaModFix { amt } => assert_eq!(*amt, 50000),
            other => panic!("expected AlphaModFix, got {:?}", other),
        }
    }

    #[test]
    fn roundtrip_brightness_contrast() {
        let mut props = minimal_image();
        props.blip_effects = vec![BlipEffect::Luminance {
            bright: -20000,
            contrast: 40000,
        }];
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.blip_effects.len(), 1);
        match &rt.blip_effects[0] {
            BlipEffect::Luminance { bright, contrast } => {
                assert_eq!(*bright, -20000);
                assert_eq!(*contrast, 40000);
            }
            other => panic!("expected Luminance, got {:?}", other),
        }
    }

    #[test]
    fn roundtrip_grayscale() {
        let mut props = minimal_image();
        props.blip_effects = vec![BlipEffect::Grayscale];
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.blip_effects.len(), 1);
        assert!(
            matches!(&rt.blip_effects[0], BlipEffect::Grayscale),
            "expected Grayscale, got {:?}",
            rt.blip_effects[0]
        );
    }

    #[test]
    fn roundtrip_multiple_blip_effects() {
        let mut props = minimal_image();
        props.blip_effects = vec![
            BlipEffect::AlphaModFix { amt: 75000 },
            BlipEffect::Luminance {
                bright: -10000,
                contrast: 20000,
            },
            BlipEffect::Grayscale,
        ];
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.blip_effects.len(), 3);
        assert!(matches!(
            &rt.blip_effects[0],
            BlipEffect::AlphaModFix { amt: 75000 }
        ));
        assert!(matches!(
            &rt.blip_effects[1],
            BlipEffect::Luminance {
                bright: -10000,
                contrast: 20000,
            }
        ));
        assert!(matches!(&rt.blip_effects[2], BlipEffect::Grayscale));
    }

    // =========================================================================
    // Compression roundtrip (all 5 variants)
    // =========================================================================

    #[test]
    fn roundtrip_compression_all_variants() {
        for comp in [
            CompressionState::None,
            CompressionState::Email,
            CompressionState::Screen,
            CompressionState::Print,
            CompressionState::HqPrint,
        ] {
            let mut props = minimal_image();
            props.compression = Some(comp);
            let (_orig, rt) = roundtrip(props);
            assert_eq!(
                rt.compression,
                Some(comp),
                "compression {comp:?} did not roundtrip"
            );
        }
    }

    // =========================================================================
    // Picture locks roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_picture_locks() {
        let mut props = minimal_image();
        props.locks = DrawingLocking {
            no_crop: true,
            no_change_aspect: true,
            no_move: true,
            ..Default::default()
        };
        let (_orig, rt) = roundtrip(props);

        assert!(rt.locks.no_crop);
        assert!(rt.locks.no_change_aspect);
        assert!(rt.locks.no_move);
        assert!(!rt.locks.no_select);
        assert!(!rt.locks.no_rot);
        assert!(!rt.locks.no_resize);
    }

    #[test]
    fn roundtrip_picture_locks_all_true() {
        let mut props = minimal_image();
        props.locks = DrawingLocking {
            no_crop: true,
            no_text_edit: true,
            no_change_aspect: true,
            no_grp: true,
            no_select: true,
            no_rot: true,
            no_move: true,
            no_resize: true,
            no_edit_points: true,
            no_adjust_handles: true,
            no_change_arrowheads: true,
            no_change_shape_type: true,
            ext_lst: None,
        };
        let (_orig, rt) = roundtrip(props);

        assert!(rt.locks.no_crop);
        assert!(rt.locks.no_change_aspect);
        assert!(rt.locks.no_grp);
        assert!(rt.locks.no_select);
        assert!(rt.locks.no_rot);
        assert!(rt.locks.no_move);
        assert!(rt.locks.no_resize);
        assert!(rt.locks.no_edit_points);
        assert!(rt.locks.no_adjust_handles);
        assert!(rt.locks.no_change_arrowheads);
        assert!(rt.locks.no_change_shape_type);
    }

    // =========================================================================
    // Effect list roundtrip (outer shadow, glow)
    // =========================================================================

    #[test]
    fn roundtrip_effect_list_outer_shadow() {
        let mut props = minimal_image();
        props.effects = Some(EffectProperties::EffectList(EffectList {
            outer_shadow: Some(OuterShadow {
                blur_rad: StPositiveCoordinate::new_unchecked(50800),
                dist: StPositiveCoordinate::new_unchecked(38100),
                dir: StAngle::new(5400000),
                ..Default::default()
            }),
            ..Default::default()
        }));
        let (_orig, rt) = roundtrip(props);

        let ep = rt.effects.expect("effects missing");
        let el = match ep {
            EffectProperties::EffectList(l) => l,
            _ => panic!("expected EffectList"),
        };
        let os = el.outer_shadow.expect("outer_shadow missing");
        assert_eq!(os.blur_rad, StPositiveCoordinate::new_unchecked(50800));
        assert_eq!(os.dist, StPositiveCoordinate::new_unchecked(38100));
        assert_eq!(os.dir, StAngle::new(5400000));
    }

    #[test]
    fn roundtrip_effect_list_glow() {
        let mut props = minimal_image();
        props.effects = Some(EffectProperties::EffectList(EffectList {
            glow: Some(Glow {
                rad: StPositiveCoordinate::new_unchecked(63500),
                color: None,
            }),
            ..Default::default()
        }));
        let (_orig, rt) = roundtrip(props);

        let ep = rt.effects.expect("effects missing");
        let el = match ep {
            EffectProperties::EffectList(l) => l,
            _ => panic!("expected EffectList"),
        };
        let glow = el.glow.expect("glow missing");
        assert_eq!(glow.rad, StPositiveCoordinate::new_unchecked(63500));
    }

    // =========================================================================
    // Fill mode roundtrips (tile, stretch)
    // =========================================================================

    #[test]
    fn roundtrip_tile_fill() {
        let mut props = minimal_image();
        props.fill_mode = Some(FillMode::Tile(TileFill {
            tx: Some(StCoordinate::new(0)),
            ty: Some(StCoordinate::new(0)),
            sx: Some(StPercentage::new(100000)),
            sy: Some(StPercentage::new(100000)),
            flip: TileFlipMode::XY,
            align: Some(RectAlignment::Center),
        }));
        let (_orig, rt) = roundtrip(props);

        match rt.fill_mode {
            Some(FillMode::Tile(tile)) => {
                assert_eq!(tile.sx, Some(StPercentage::new(100000)));
                assert_eq!(tile.sy, Some(StPercentage::new(100000)));
                assert_eq!(tile.flip, TileFlipMode::XY);
                assert_eq!(tile.align, Some(RectAlignment::Center));
            }
            other => panic!("expected Tile fill, got {:?}", other),
        }
    }

    #[test]
    fn roundtrip_stretch_with_fill_rect() {
        let mut props = minimal_image();
        props.fill_mode = Some(FillMode::Stretch {
            fill_rect: Some(SourceRect {
                top: StPositiveFixedPercentageDecimal::new_unchecked(5000),
                bottom: StPositiveFixedPercentageDecimal::new_unchecked(5000),
                left: StPositiveFixedPercentageDecimal::new_unchecked(5000),
                right: StPositiveFixedPercentageDecimal::new_unchecked(5000),
            }),
        });
        let (_orig, rt) = roundtrip(props);

        match rt.fill_mode {
            Some(FillMode::Stretch { fill_rect }) => {
                let fr = fill_rect.expect("fill_rect missing");
                assert_eq!(
                    fr.top,
                    StPositiveFixedPercentageDecimal::new_unchecked(5000)
                );
                assert_eq!(
                    fr.bottom,
                    StPositiveFixedPercentageDecimal::new_unchecked(5000)
                );
                assert_eq!(
                    fr.left,
                    StPositiveFixedPercentageDecimal::new_unchecked(5000)
                );
                assert_eq!(
                    fr.right,
                    StPositiveFixedPercentageDecimal::new_unchecked(5000)
                );
            }
            other => panic!("expected Stretch fill, got {:?}", other),
        }
    }

    #[test]
    fn roundtrip_stretch_no_fill_rect() {
        let mut props = minimal_image();
        props.fill_mode = Some(FillMode::Stretch { fill_rect: None });
        let (_orig, rt) = roundtrip(props);

        match rt.fill_mode {
            Some(FillMode::Stretch { .. }) => {} // OK — fill_rect may be None or default
            other => panic!("expected Stretch fill, got {:?}", other),
        }
    }

    // =========================================================================
    // Hyperlink roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_hyperlink_click() {
        let mut props = minimal_image();
        props.hlink_click = Some(Hyperlink {
            r_id: Some("rId5".into()),
            tooltip: Some("Click me".into()),
            action: Some("ppaction://hlinksldjump".into()),
            ..Default::default()
        });
        let (_orig, rt) = roundtrip(props);

        let hlink = rt.hlink_click.expect("hlink_click missing");
        assert_eq!(hlink.r_id.as_deref(), Some("rId5"));
        assert_eq!(hlink.tooltip.as_deref(), Some("Click me"));
        assert_eq!(hlink.action.as_deref(), Some("ppaction://hlinksldjump"));
    }

    #[test]
    fn roundtrip_hyperlink_hover() {
        let mut props = minimal_image();
        props.hlink_hover = Some(Hyperlink {
            r_id: Some("rId6".into()),
            tooltip: Some("Hover text".into()),
            ..Default::default()
        });
        let (_orig, rt) = roundtrip(props);

        let hlink = rt.hlink_hover.expect("hlink_hover missing");
        assert_eq!(hlink.r_id.as_deref(), Some("rId6"));
        assert_eq!(hlink.tooltip.as_deref(), Some("Hover text"));
    }

    // =========================================================================
    // Client data roundtrip (anchor-level)
    // =========================================================================

    #[test]
    fn roundtrip_client_data() {
        let from = CellAnchor {
            col: 0,
            col_off: 0,
            row: 0,
            row_off: 0,
        };
        let to = CellAnchor {
            col: 5,
            col_off: 0,
            row: 5,
            row_off: 0,
        };
        let mut writer = DrawingWriter::new();

        let anchor = TwoCellAnchor {
            from,
            to,
            edit_as: Some(EditAs::OneCell),
            client_data: ClientData {
                locks_with_sheet: false,
                prints_with_sheet: true,
            },
            ..Default::default()
        };
        writer.add_anchor(DrawingAnchor::TwoCell(
            anchor,
            DrawingObject::Picture(minimal_image()),
        ));
        let xml_bytes = writer.to_xml();

        let drawing = parse_drawing(&xml_bytes);
        if let Anchor::TwoCell(a) = &drawing.anchors[0] {
            assert!(
                !a.client_data.locks_with_sheet,
                "locks_with_sheet should be false"
            );
            assert!(
                a.client_data.prints_with_sheet,
                "prints_with_sheet should be true"
            );
        } else {
            panic!("Expected TwoCell anchor");
        }
    }

    // =========================================================================
    // Non-visual properties roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_description() {
        let mut props = minimal_image();
        props.description = Some("A beautiful sunset photo".into());
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.description.as_deref(), Some("A beautiful sunset photo"));
    }

    #[test]
    fn roundtrip_title() {
        let mut props = minimal_image();
        props.title = Some("Photo Title".into());
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.title.as_deref(), Some("Photo Title"));
    }

    #[test]
    fn roundtrip_hidden() {
        let mut props = minimal_image();
        props.hidden = true;
        let (_orig, rt) = roundtrip(props);

        assert!(rt.hidden);
    }

    // =========================================================================
    // DPI roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_dpi() {
        let mut props = minimal_image();
        props.dpi = Some(300);
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.dpi, Some(300));
    }

    // =========================================================================
    // Preset geometry roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_preset_geometry() {
        let mut props = minimal_image();
        props.preset_geometry = Some(PresetGeometry {
            prst: ShapePreset::Rect,
            av_list: vec![],
        });
        let (_orig, rt) = roundtrip(props);

        assert_eq!(
            rt.preset_geometry.as_ref().map(|pg| pg.prst),
            Some(ShapePreset::Rect)
        );
    }

    // =========================================================================
    // Black and white mode roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_bw_mode() {
        let mut props = minimal_image();
        props.bw_mode = Some(BlackWhiteMode::Auto);
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.bw_mode, Some(BlackWhiteMode::Auto));
    }

    // =========================================================================
    // Macro name roundtrip
    // =========================================================================

    #[test]
    fn roundtrip_macro_name() {
        let mut props = minimal_image();
        props.macro_name = Some("Sheet1.PictureClick".into());
        let (_orig, rt) = roundtrip(props);

        assert_eq!(rt.macro_name.as_deref(), Some("Sheet1.PictureClick"));
    }

    // =========================================================================
    // Kitchen-sink roundtrip — every supported property at once
    // =========================================================================

    #[test]
    fn roundtrip_kitchen_sink() {
        let props = ImageProps {
            original_id: None,
            name: "KitchenSink".into(),
            description: Some("Full description".into()),
            r_id: "rId1".into(),
            rotation: Some(5400000),
            offset_x: 914400,
            offset_y: 457200,
            extent_cx: 1828800,
            extent_cy: 914400,
            flip_h: true,
            flip_v: false,
            source_rect: Some(SourceRect {
                top: StPositiveFixedPercentageDecimal::new_unchecked(10000),
                bottom: StPositiveFixedPercentageDecimal::new_unchecked(20000),
                left: StPositiveFixedPercentageDecimal::new_unchecked(5000),
                right: StPositiveFixedPercentageDecimal::new_unchecked(15000),
            }),
            blip_effects: vec![
                BlipEffect::AlphaModFix { amt: 75000 },
                BlipEffect::Luminance {
                    bright: -10000,
                    contrast: 20000,
                },
                BlipEffect::Grayscale,
            ],
            fill_mode: Some(FillMode::Stretch { fill_rect: None }),
            compression: Some(CompressionState::HqPrint),
            link_id: None,
            dpi: Some(300),
            rot_with_shape: Some(true),
            blip_ext_lst: None,
            src_rect_explicit: 0xF, // all four attributes present
            locks: DrawingLocking {
                no_crop: true,
                no_change_aspect: true,
                no_move: true,
                no_resize: true,
                ..Default::default()
            },
            has_pic_locks: true,
            prefer_relative_resize: Some(false),
            title: Some("Picture Title".into()),
            hidden: true,
            hlink_click: Some(Hyperlink {
                r_id: Some("rId10".into()),
                tooltip: Some("Click".into()),
                ..Default::default()
            }),
            hlink_hover: Some(Hyperlink {
                r_id: Some("rId11".into()),
                tooltip: Some("Hover".into()),
                ..Default::default()
            }),
            nv_ext_lst: None,
            preset_geometry: Some(PresetGeometry {
                prst: ShapePreset::Rect,
                av_list: vec![],
            }),
            fill: None,
            outline: None,
            effects: Some(EffectProperties::EffectList(EffectList {
                outer_shadow: Some(OuterShadow {
                    blur_rad: StPositiveCoordinate::new_unchecked(50800),
                    dist: StPositiveCoordinate::new_unchecked(38100),
                    dir: StAngle::new(5400000),
                    ..Default::default()
                }),
                glow: Some(Glow {
                    rad: StPositiveCoordinate::new_unchecked(63500),
                    color: None,
                }),
                ..Default::default()
            })),
            bw_mode: Some(BlackWhiteMode::Auto),
            style: None,
            macro_name: Some("MyMacro".into()),
            scene3d: None,
            sp3d: None,
            sp_pr_ext_lst: None,
        };

        let (orig, rt) = roundtrip(props);

        // -- Identity --
        assert_eq!(rt.name, orig.name);
        assert_eq!(rt.description, orig.description);
        assert_eq!(rt.r_id, orig.r_id);

        // -- Transform --
        assert_eq!(rt.offset_x, orig.offset_x);
        assert_eq!(rt.offset_y, orig.offset_y);
        assert_eq!(rt.extent_cx, orig.extent_cx);
        assert_eq!(rt.extent_cy, orig.extent_cy);
        assert_eq!(rt.rotation, orig.rotation);
        assert_eq!(rt.flip_h, orig.flip_h);
        assert_eq!(rt.flip_v, orig.flip_v);

        // -- Crop --
        assert_eq!(rt.source_rect, orig.source_rect);

        // -- Blip effects --
        assert_eq!(rt.blip_effects.len(), 3);
        assert!(matches!(
            &rt.blip_effects[0],
            BlipEffect::AlphaModFix { amt: 75000 }
        ));
        assert!(matches!(
            &rt.blip_effects[1],
            BlipEffect::Luminance {
                bright: -10000,
                contrast: 20000,
            }
        ));
        assert!(matches!(&rt.blip_effects[2], BlipEffect::Grayscale));

        // -- Compression --
        assert_eq!(rt.compression, Some(CompressionState::HqPrint));

        // -- DPI --
        assert_eq!(rt.dpi, Some(300));

        // -- Locks --
        assert!(rt.locks.no_crop);
        assert!(rt.locks.no_change_aspect);
        assert!(rt.locks.no_move);
        assert!(rt.locks.no_resize);

        // -- Hidden --
        assert!(rt.hidden);

        // -- Title --
        assert_eq!(rt.title.as_deref(), Some("Picture Title"));

        // -- Hyperlinks --
        let hc = rt.hlink_click.as_ref().expect("hlink_click missing");
        assert_eq!(hc.r_id.as_deref(), Some("rId10"));
        assert_eq!(hc.tooltip.as_deref(), Some("Click"));

        let hh = rt.hlink_hover.as_ref().expect("hlink_hover missing");
        assert_eq!(hh.r_id.as_deref(), Some("rId11"));
        assert_eq!(hh.tooltip.as_deref(), Some("Hover"));

        // -- Effect list --
        let ep = rt.effects.expect("effects missing");
        let el = match ep {
            EffectProperties::EffectList(l) => l,
            _ => panic!("expected EffectList"),
        };
        assert!(el.outer_shadow.is_some());
        let os = el.outer_shadow.unwrap();
        assert_eq!(os.blur_rad, StPositiveCoordinate::new_unchecked(50800));
        assert_eq!(os.dist, StPositiveCoordinate::new_unchecked(38100));
        assert_eq!(os.dir, StAngle::new(5400000));
        assert!(el.glow.is_some());
        let glow = el.glow.unwrap();
        assert_eq!(glow.rad, StPositiveCoordinate::new_unchecked(63500));

        // -- Preset geometry --
        assert_eq!(
            rt.preset_geometry.as_ref().map(|pg| pg.prst),
            Some(ShapePreset::Rect)
        );

        // -- bwMode --
        assert_eq!(rt.bw_mode, Some(BlackWhiteMode::Auto));

        // -- Macro --
        assert_eq!(rt.macro_name.as_deref(), Some("MyMacro"));
    }
}
