use super::*;

// Struct defaults
// -----------------------------------------------------------------------

#[test]
fn drawing_color_default() {
    let c = DrawingColor::default();
    match c {
        DrawingColor::SrgbClr { val, transforms } => {
            assert!(val.is_empty());
            assert!(transforms.is_empty());
        }
        _ => panic!("expected SrgbClr default"),
    }
}

#[test]
fn outline_default() {
    let o = Outline::default();
    assert!(o.width.is_none());
    assert!(o.fill.is_none());
    assert!(o.dash.is_none());
    assert!(o.compound.is_none());
    assert!(o.cap.is_none());
    assert!(o.head_end.is_none());
    assert!(o.tail_end.is_none());
    assert!(o.join.is_none());
    assert!(o.align.is_none());
}

#[test]
fn drawing_fill_default_is_no_fill() {
    assert_eq!(DrawingFill::default(), DrawingFill::NoFill);
}

#[test]
fn transform_2d_default() {
    let t = Transform2D::default();
    assert_eq!(t.off_x(), 0);
    assert_eq!(t.off_y(), 0);
    assert_eq!(t.ext_cx(), 0);
    assert_eq!(t.ext_cy(), 0);
    assert_eq!(t.rot(), StAngle::new(0));
    assert!(!t.is_flip_h());
    assert!(!t.is_flip_v());
}

#[test]
fn cell_anchor_default() {
    let a = CellAnchor::default();
    assert_eq!(a.col, 0);
    assert_eq!(a.col_off, 0);
    assert_eq!(a.row, 0);
    assert_eq!(a.row_off, 0);
}

#[test]
fn position_default() {
    let p = Position::default();
    assert_eq!(p.x, 0);
    assert_eq!(p.y, 0);
}

#[test]
fn extent_default() {
    let e = Extent::default();
    assert_eq!(e.cx, 0);
    assert_eq!(e.cy, 0);
}

#[test]
fn shape_style_default() {
    let s = ShapeStyle::default();
    assert!(s.line_ref.color.is_none());
    assert!(s.fill_ref.color.is_none());
    assert!(s.effect_ref.color.is_none());
    assert!(s.font_ref.color.is_none());
}

#[test]
fn non_visual_props_default() {
    let p = NonVisualProps::default();
    assert_eq!(p.id, StDrawingElementId::new(0));
    assert!(p.name.is_empty());
    assert!(p.descr.is_none());
    assert!(!p.hidden);
}

#[test]
fn text_body_default() {
    let tb = TextBody::default();
    assert!(tb.paragraphs.is_empty());
}

#[test]
fn text_body_properties_default() {
    let bp = TextBodyProperties::default();
    assert!(bp.rot.is_none());
    assert!(bp.anchor.is_none());
    assert!(bp.wrap.is_none());
    assert!(bp.l_ins.is_none());
    assert!(bp.t_ins.is_none());
    assert!(bp.r_ins.is_none());
    assert!(bp.b_ins.is_none());
}

#[test]
fn paragraph_default() {
    let p = Paragraph::default();
    assert!(p.runs.is_empty());
    assert!(p.props.align.is_none());
}

#[test]
fn text_run_default() {
    let r = TextRun::default();
    assert_eq!(r.text, "");
    assert!(r.props.size.is_none());
    assert!(r.props.bold.is_none());
}

#[test]
fn run_properties_default() {
    let rp = RunProperties::default();
    assert!(rp.size.is_none());
    assert!(rp.bold.is_none());
    assert!(rp.italic.is_none());
    assert!(rp.underline.is_none());
    assert!(rp.strike.is_none());
    assert!(rp.latin.is_none());
    assert!(rp.color.is_none());
}

#[test]
fn blip_fill_default() {
    let bf = BlipFill::default();
    assert!(bf.embed_id.is_none());
    assert!(bf.link_id.is_none());
    assert!(bf.compression.is_none());
}

#[test]
fn solid_fill_default() {
    let sf = SolidFill::default();
    assert_eq!(sf.color, DrawingColor::default());
}

#[test]
fn gradient_fill_default() {
    let gf = GradientFill::default();
    assert!(gf.stops.is_empty());
    assert!(gf.lin_ang.is_none());
}

#[test]
fn pattern_fill_default() {
    let pf = PatternFill::default();
    assert!(pf.preset.is_none());
    assert!(pf.fg_color.is_none());
    assert!(pf.bg_color.is_none());
}

#[test]
fn connection_equality() {
    let a = Connection {
        shape_id: 1,
        idx: 2,
    };
    let b = Connection {
        shape_id: 1,
        idx: 2,
    };
    assert_eq!(a, b);
}

// -----------------------------------------------------------------------
// Fill variant construction
// -----------------------------------------------------------------------

#[test]
fn drawing_fill_solid() {
    let fill = DrawingFill::Solid(SolidFill {
        color: DrawingColor::SrgbClr {
            val: "FF0000".to_string(),
            transforms: vec![],
        },
    });
    match fill {
        DrawingFill::Solid(s) => match &s.color {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
            _ => panic!("expected SrgbClr"),
        },
        _ => panic!("expected Solid"),
    }
}

#[test]
fn drawing_fill_gradient() {
    let fill = DrawingFill::Gradient(GradientFill {
        stops: vec![
            GradientStop {
                position: StPositiveFixedPercentageDecimal::new_unchecked(0),
                color: DrawingColor::default(),
            },
            GradientStop {
                position: StPositiveFixedPercentageDecimal::new_unchecked(100_000),
                color: DrawingColor::default(),
            },
        ],
        lin_ang: Some(StAngle::new(5_400_000)), // 90 degrees in 60000ths
        ..Default::default()
    });
    match fill {
        DrawingFill::Gradient(g) => {
            assert_eq!(g.stops.len(), 2);
            assert_eq!(
                g.stops[0].position,
                StPositiveFixedPercentageDecimal::new_unchecked(0)
            );
            assert_eq!(
                g.stops[1].position,
                StPositiveFixedPercentageDecimal::new_unchecked(100_000)
            );
            assert_eq!(g.lin_ang, Some(StAngle::new(5_400_000)));
        }
        _ => panic!("expected Gradient"),
    }
}

#[test]
fn gradient_path_type_roundtrip() {
    let variants = [
        GradientPathType::Circle,
        GradientPathType::Rect,
        GradientPathType::Shape,
    ];
    for v in variants {
        assert_eq!(
            GradientPathType::from_ooxml(v.to_ooxml()),
            Some(v),
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn gradient_fill_with_path() {
    let gf = GradientFill {
        stops: vec![],
        path: Some(GradientPathType::Circle),
        fill_to_rect: Some(RelativeRect {
            l: Some(StPercentage::new(50000)),
            t: Some(StPercentage::new(50000)),
            r: Some(StPercentage::new(50000)),
            b: Some(StPercentage::new(50000)),
        }),
        ..Default::default()
    };
    assert_eq!(gf.path, Some(GradientPathType::Circle));
    assert!(gf.fill_to_rect.is_some());
}

#[test]
fn drawing_fill_group() {
    let fill = DrawingFill::Group;
    match fill {
        DrawingFill::Group => {}
        _ => panic!("expected Group"),
    }
}

#[test]
fn drawing_fill_blip() {
    let fill = DrawingFill::Blip(BlipFill {
        embed_id: Some("rId1".to_string()),
        link_id: None,
        compression: Some(CompressionState::Print),
        source_rect: None,
        effects: vec![],
        fill_mode: None,
        dpi: None,
        rot_with_shape: None,
        ext_lst: None,
        src_rect_explicit: 0,
    });
    match fill {
        DrawingFill::Blip(b) => {
            assert_eq!(b.embed_id.as_deref(), Some("rId1"));
            assert!(b.link_id.is_none());
            assert_eq!(b.compression, Some(CompressionState::Print));
        }
        _ => panic!("expected Blip"),
    }
}

// -----------------------------------------------------------------------
// LineEndType
// -----------------------------------------------------------------------

#[test]
fn line_end_type_default_is_none() {
    assert_eq!(LineEndType::default(), LineEndType::None);
}

#[test]
fn line_end_type_roundtrip() {
    let variants = [
        LineEndType::None,
        LineEndType::Triangle,
        LineEndType::Stealth,
        LineEndType::Diamond,
        LineEndType::Oval,
        LineEndType::Arrow,
    ];
    for v in variants {
        let ooxml = v.to_ooxml();
        assert_eq!(
            LineEndType::from_ooxml(ooxml),
            Some(v),
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn line_end_type_from_ooxml_unknown_returns_none() {
    assert_eq!(LineEndType::from_ooxml(""), Option::None);
    assert_eq!(LineEndType::from_ooxml("bogus"), Option::None);
}

// -----------------------------------------------------------------------
// LineEndSize
// -----------------------------------------------------------------------

#[test]
fn line_end_size_roundtrip() {
    let variants = [LineEndSize::Small, LineEndSize::Medium, LineEndSize::Large];
    for v in variants {
        let ooxml = v.to_ooxml();
        assert_eq!(
            LineEndSize::from_ooxml(ooxml),
            Some(v),
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn line_end_size_from_ooxml_unknown_returns_none() {
    assert_eq!(LineEndSize::from_ooxml(""), None);
    assert_eq!(LineEndSize::from_ooxml("bogus"), None);
}

// -----------------------------------------------------------------------
// PenAlignment
// -----------------------------------------------------------------------

#[test]
fn pen_alignment_roundtrip() {
    let variants = [PenAlignment::Center, PenAlignment::Inset];
    for v in variants {
        let ooxml = v.to_ooxml();
        assert_eq!(
            PenAlignment::from_ooxml(ooxml),
            Some(v),
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn pen_alignment_from_ooxml_unknown_returns_none() {
    assert_eq!(PenAlignment::from_ooxml(""), None);
    assert_eq!(PenAlignment::from_ooxml("bogus"), None);
}

#[test]
fn pen_alignment_specific_ooxml_values() {
    assert_eq!(PenAlignment::Center.to_ooxml(), "ctr");
    assert_eq!(PenAlignment::Inset.to_ooxml(), "in");
}

// -----------------------------------------------------------------------
// DrawingLocking
// -----------------------------------------------------------------------

#[test]
fn drawing_locking_default_all_false() {
    let l = DrawingLocking::default();
    assert!(!l.no_crop);
    assert!(!l.no_grp);
    assert!(!l.no_select);
    assert!(!l.no_rot);
    assert!(!l.no_change_aspect);
    assert!(!l.no_move);
    assert!(!l.no_resize);
    assert!(!l.no_edit_points);
    assert!(!l.no_adjust_handles);
    assert!(!l.no_change_arrowheads);
    assert!(!l.no_change_shape_type);
}

#[test]
fn drawing_locking_used_for_connector_and_picture() {
    // DrawingLocking is the canonical type for both connector and picture locking
    let l = DrawingLocking::default();
    assert!(!l.no_crop);
    assert!(!l.no_grp);
}

// -----------------------------------------------------------------------
// LineEndProperties
// -----------------------------------------------------------------------

#[test]
fn line_end_properties_default_all_none() {
    let p = LineEndProperties::default();
    assert!(p.end_type.is_none());
    assert!(p.width.is_none());
    assert!(p.length.is_none());
}

// -----------------------------------------------------------------------
// Hyperlink
// -----------------------------------------------------------------------

#[test]
fn hyperlink_default_all_none() {
    let h = Hyperlink::default();
    assert!(h.url.is_none());
    assert!(h.r_id.is_none());
    assert!(h.action.is_none());
    assert!(h.tooltip.is_none());
    assert!(h.tgt_frame.is_none());
    assert!(h.invalid_url.is_none());
    assert!(h.history.is_none());
    assert!(h.highlight_click.is_none());
    assert!(h.end_snd.is_none());
}

// ── TextWarpPreset tests ────────────────────────────────────

#[test]
fn text_warp_preset_roundtrip_all_41() {
    let all_variants = [
        TextWarpPreset::TextNoShape,
        TextWarpPreset::TextPlain,
        TextWarpPreset::TextStop,
        TextWarpPreset::TextTriangle,
        TextWarpPreset::TextTriangleInverted,
        TextWarpPreset::TextChevron,
        TextWarpPreset::TextChevronInverted,
        TextWarpPreset::TextRingInside,
        TextWarpPreset::TextRingOutside,
        TextWarpPreset::TextArchUp,
        TextWarpPreset::TextArchDown,
        TextWarpPreset::TextCircle,
        TextWarpPreset::TextButton,
        TextWarpPreset::TextArchUpPour,
        TextWarpPreset::TextArchDownPour,
        TextWarpPreset::TextCirclePour,
        TextWarpPreset::TextButtonPour,
        TextWarpPreset::TextCurveUp,
        TextWarpPreset::TextCurveDown,
        TextWarpPreset::TextCanUp,
        TextWarpPreset::TextCanDown,
        TextWarpPreset::TextWave1,
        TextWarpPreset::TextWave2,
        TextWarpPreset::TextDoubleWave1,
        TextWarpPreset::TextWave4,
        TextWarpPreset::TextInflate,
        TextWarpPreset::TextDeflate,
        TextWarpPreset::TextInflateBottom,
        TextWarpPreset::TextDeflateBottom,
        TextWarpPreset::TextInflateTop,
        TextWarpPreset::TextDeflateTop,
        TextWarpPreset::TextDeflateInflate,
        TextWarpPreset::TextDeflateInflateDeflate,
        TextWarpPreset::TextFadeRight,
        TextWarpPreset::TextFadeLeft,
        TextWarpPreset::TextFadeUp,
        TextWarpPreset::TextFadeDown,
        TextWarpPreset::TextSlantUp,
        TextWarpPreset::TextSlantDown,
        TextWarpPreset::TextCascadeUp,
        TextWarpPreset::TextCascadeDown,
    ];
    assert_eq!(all_variants.len(), 41, "must have exactly 41 variants");
    for variant in &all_variants {
        let ooxml = variant.to_ooxml();
        let parsed = TextWarpPreset::from_ooxml(ooxml);
        assert_eq!(parsed, Some(*variant), "roundtrip failed for {ooxml}");
    }
}

#[test]
fn text_warp_preset_from_ooxml_unknown() {
    assert_eq!(TextWarpPreset::from_ooxml("textInvalid"), None);
    assert_eq!(TextWarpPreset::from_ooxml(""), None);
    // ShapePreset values must not overlap
    assert_eq!(TextWarpPreset::from_ooxml("rect"), None);
    assert_eq!(TextWarpPreset::from_ooxml("ellipse"), None);
}

#[test]
fn text_warp_preset_serde_roundtrip() {
    let variant = TextWarpPreset::TextWave1;
    let json = serde_json::to_string(&variant).unwrap();
    assert_eq!(json, "\"textWave1\"");
    let parsed: TextWarpPreset = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, variant);
}

#[test]
fn text_warp_preset_serde_all_match_ooxml() {
    let all_variants = [
        TextWarpPreset::TextNoShape,
        TextWarpPreset::TextPlain,
        TextWarpPreset::TextStop,
        TextWarpPreset::TextTriangle,
        TextWarpPreset::TextTriangleInverted,
        TextWarpPreset::TextChevron,
        TextWarpPreset::TextChevronInverted,
        TextWarpPreset::TextRingInside,
        TextWarpPreset::TextRingOutside,
        TextWarpPreset::TextArchUp,
        TextWarpPreset::TextArchDown,
        TextWarpPreset::TextCircle,
        TextWarpPreset::TextButton,
        TextWarpPreset::TextArchUpPour,
        TextWarpPreset::TextArchDownPour,
        TextWarpPreset::TextCirclePour,
        TextWarpPreset::TextButtonPour,
        TextWarpPreset::TextCurveUp,
        TextWarpPreset::TextCurveDown,
        TextWarpPreset::TextCanUp,
        TextWarpPreset::TextCanDown,
        TextWarpPreset::TextWave1,
        TextWarpPreset::TextWave2,
        TextWarpPreset::TextDoubleWave1,
        TextWarpPreset::TextWave4,
        TextWarpPreset::TextInflate,
        TextWarpPreset::TextDeflate,
        TextWarpPreset::TextInflateBottom,
        TextWarpPreset::TextDeflateBottom,
        TextWarpPreset::TextInflateTop,
        TextWarpPreset::TextDeflateTop,
        TextWarpPreset::TextDeflateInflate,
        TextWarpPreset::TextDeflateInflateDeflate,
        TextWarpPreset::TextFadeRight,
        TextWarpPreset::TextFadeLeft,
        TextWarpPreset::TextFadeUp,
        TextWarpPreset::TextFadeDown,
        TextWarpPreset::TextSlantUp,
        TextWarpPreset::TextSlantDown,
        TextWarpPreset::TextCascadeUp,
        TextWarpPreset::TextCascadeDown,
    ];
    for variant in &all_variants {
        let json = serde_json::to_string(variant).unwrap();
        // Strip quotes to get the raw serde name
        let serde_name = json.trim_matches('"');
        assert_eq!(
            serde_name,
            variant.to_ooxml(),
            "serde name must match OOXML name for {:?}",
            variant
        );
    }
}

#[test]
fn geom_guide_construction_and_eq() {
    let g1 = GeomGuide {
        name: "adj".to_string(),
        fmla: "val 12500".to_string(),
    };
    let g2 = GeomGuide {
        name: "adj".to_string(),
        fmla: "val 12500".to_string(),
    };
    let g3 = GeomGuide {
        name: "adj2".to_string(),
        fmla: "val 50000".to_string(),
    };
    assert_eq!(g1, g2);
    assert_ne!(g1, g3);
}

#[test]
fn preset_text_warp_with_adjust_values() {
    // Zero adjusts
    let w0 = PresetTextWarp {
        preset: TextWarpPreset::TextPlain,
        adjust_values: vec![],
    };
    assert!(w0.adjust_values.is_empty());

    // One adjust
    let w1 = PresetTextWarp {
        preset: TextWarpPreset::TextWave1,
        adjust_values: vec![GeomGuide {
            name: "adj".to_string(),
            fmla: "val 12500".to_string(),
        }],
    };
    assert_eq!(w1.adjust_values.len(), 1);

    // Two adjusts
    let w2 = PresetTextWarp {
        preset: TextWarpPreset::TextInflate,
        adjust_values: vec![
            GeomGuide {
                name: "adj".to_string(),
                fmla: "val 18750".to_string(),
            },
            GeomGuide {
                name: "adj2".to_string(),
                fmla: "val 50000".to_string(),
            },
        ],
    };
    assert_eq!(w2.adjust_values.len(), 2);
}

#[test]
fn text_body_properties_default_has_no_warp() {
    let props = TextBodyProperties::default();
    assert!(props.prst_tx_warp.is_none());
}

// -----------------------------------------------------------------------
// SourceRect
// -----------------------------------------------------------------------

#[test]
fn source_rect_default_is_all_zeros() {
    let r = SourceRect::default();
    assert_eq!(r.top, StPositiveFixedPercentageDecimal::new_unchecked(0));
    assert_eq!(r.bottom, StPositiveFixedPercentageDecimal::new_unchecked(0));
    assert_eq!(r.left, StPositiveFixedPercentageDecimal::new_unchecked(0));
    assert_eq!(r.right, StPositiveFixedPercentageDecimal::new_unchecked(0));
}

// -----------------------------------------------------------------------
// CompressionState HqPrint
// -----------------------------------------------------------------------

#[test]
fn compression_state_hqprint_roundtrip() {
    assert_eq!(
        CompressionState::from_ooxml("hqprint"),
        CompressionState::HqPrint
    );
    assert_eq!(CompressionState::HqPrint.to_ooxml(), "hqprint");
}

#[test]
fn compression_state_all_variants_roundtrip() {
    let variants = [
        CompressionState::None,
        CompressionState::Print,
        CompressionState::Screen,
        CompressionState::Email,
        CompressionState::HqPrint,
    ];
    for v in variants {
        assert_eq!(
            CompressionState::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

// -----------------------------------------------------------------------
// TileFlipMode
// -----------------------------------------------------------------------

#[test]
fn tile_flip_mode_default() {
    assert_eq!(TileFlipMode::default(), TileFlipMode::None);
}

#[test]
fn tile_flip_mode_roundtrip() {
    let variants = [
        TileFlipMode::None,
        TileFlipMode::X,
        TileFlipMode::Y,
        TileFlipMode::XY,
    ];
    for v in variants {
        assert_eq!(
            TileFlipMode::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

// -----------------------------------------------------------------------
// RectAlignment
// -----------------------------------------------------------------------

#[test]
fn rect_alignment_default() {
    assert_eq!(RectAlignment::default(), RectAlignment::Center);
}

#[test]
fn rect_alignment_roundtrip() {
    let variants = [
        RectAlignment::TopLeft,
        RectAlignment::Top,
        RectAlignment::TopRight,
        RectAlignment::Left,
        RectAlignment::Center,
        RectAlignment::Right,
        RectAlignment::BottomLeft,
        RectAlignment::Bottom,
        RectAlignment::BottomRight,
    ];
    for v in variants {
        assert_eq!(
            RectAlignment::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

// -----------------------------------------------------------------------
// BlackWhiteMode
// -----------------------------------------------------------------------

#[test]
fn black_white_mode_default() {
    assert_eq!(BlackWhiteMode::default(), BlackWhiteMode::Clr);
}

#[test]
fn black_white_mode_roundtrip() {
    let variants = [
        BlackWhiteMode::Clr,
        BlackWhiteMode::Auto,
        BlackWhiteMode::Gray,
        BlackWhiteMode::LtGray,
        BlackWhiteMode::InvGray,
        BlackWhiteMode::GrayWhite,
        BlackWhiteMode::BlackGray,
        BlackWhiteMode::BlackWhite,
        BlackWhiteMode::Black,
        BlackWhiteMode::White,
        BlackWhiteMode::Hidden,
    ];
    for v in variants {
        assert_eq!(
            BlackWhiteMode::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

// -----------------------------------------------------------------------
// ClientData
// -----------------------------------------------------------------------

#[test]
fn client_data_default_both_true() {
    let cd = ClientData::default();
    assert!(cd.locks_with_sheet);
    assert!(cd.prints_with_sheet);
}

// -----------------------------------------------------------------------
// EffectList
// -----------------------------------------------------------------------

#[test]
fn effect_list_default_all_none() {
    let el = EffectList::default();
    assert!(el.blur.is_none());
    assert!(el.fill_overlay.is_none());
    assert!(el.glow.is_none());
    assert!(el.inner_shadow.is_none());
    assert!(el.outer_shadow.is_none());
    assert!(el.preset_shadow.is_none());
    assert!(el.reflection.is_none());
    assert!(el.soft_edge.is_none());
}

// -----------------------------------------------------------------------
