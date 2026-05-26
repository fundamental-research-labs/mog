//! Drawing types (ECMA-376 DrawingML).
//!
//! Unified from xlsx-parser read (`drawings/types.rs`) and write (`write/drawings/types.rs`)
//! sides. This module defines the canonical enum types with `from_ooxml` / `to_ooxml`
//! converters so both sides share one vocabulary.
//!
//! # OOXML Drawing Structure
//!
//! Drawing files are located at `xl/drawings/drawingN.xml` and contain:
//! - `<xdr:twoCellAnchor>` - Objects anchored between two cells
//! - `<xdr:oneCellAnchor>` - Objects anchored to one cell with extent
//! - `<xdr:absoluteAnchor>` - Objects with absolute positioning

mod color;
mod effects;
mod fill;
mod geometry;
mod line;
mod preset;
mod primitives;
mod properties;
mod spreadsheet;
mod style;
mod table;
mod text;
mod three_d;
mod transform;

pub use color::*;
pub use effects::*;
pub use fill::*;
pub use geometry::*;
pub use line::*;
pub use preset::*;
pub use primitives::*;
pub use properties::*;
pub use spreadsheet::*;
pub use style::*;
pub use table::*;
pub use text::*;
pub use three_d::*;
pub use transform::*;

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // EMU Constants
    // -----------------------------------------------------------------------

    #[test]
    fn emu_constants() {
        assert_eq!(EMUS_PER_INCH, 914_400);
        assert_eq!(EMUS_PER_CM, 360_000);
        assert_eq!(EMUS_PER_POINT, 12_700);
    }

    // -----------------------------------------------------------------------
    // EditAs
    // -----------------------------------------------------------------------

    #[test]
    fn edit_as_default_is_two_cell() {
        assert_eq!(EditAs::default(), EditAs::TwoCell);
    }

    #[test]
    fn edit_as_roundtrip() {
        let variants = [EditAs::TwoCell, EditAs::OneCell, EditAs::Absolute];
        for v in variants {
            assert_eq!(
                EditAs::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn edit_as_from_ooxml_known() {
        assert_eq!(EditAs::from_ooxml("twoCell"), EditAs::TwoCell);
        assert_eq!(EditAs::from_ooxml("oneCell"), EditAs::OneCell);
        assert_eq!(EditAs::from_ooxml("absolute"), EditAs::Absolute);
    }

    #[test]
    fn edit_as_from_ooxml_unknown_defaults_to_two_cell() {
        assert_eq!(EditAs::from_ooxml(""), EditAs::TwoCell);
        assert_eq!(EditAs::from_ooxml("bogus"), EditAs::TwoCell);
    }

    // -----------------------------------------------------------------------
    // ShapePreset
    // -----------------------------------------------------------------------

    #[test]
    fn shape_preset_default_is_rect() {
        assert_eq!(ShapePreset::default(), ShapePreset::Rect);
    }

    #[test]
    fn shape_preset_roundtrip_all_186_variants() {
        let variants = ShapePreset::all_variants();
        assert_eq!(variants.len(), SHAPE_PRESET_COUNT);
        for &v in variants {
            let ooxml = v.to_ooxml();
            let parsed = ShapePreset::from_ooxml(ooxml);
            assert_eq!(
                parsed,
                Some(v),
                "roundtrip failed for {v:?} (ooxml={ooxml})"
            );
        }
    }

    #[test]
    fn shape_preset_from_ooxml_unknown_returns_none() {
        assert_eq!(ShapePreset::from_ooxml(""), None);
        assert_eq!(ShapePreset::from_ooxml("bogus"), None);
    }

    #[test]
    fn shape_preset_plus_and_math_plus() {
        // "plus" (cross shape) and "mathPlus" (math operator) are distinct shapes.
        assert_eq!(ShapePreset::from_ooxml("plus"), Some(ShapePreset::Plus));
        assert_eq!(
            ShapePreset::from_ooxml("mathPlus"),
            Some(ShapePreset::MathPlus)
        );
        assert_eq!(ShapePreset::Plus.to_ooxml(), "plus");
        assert_eq!(ShapePreset::MathPlus.to_ooxml(), "mathPlus");
    }

    #[test]
    fn shape_preset_flowchart_data_alias() {
        // Historical: "flowChartData" maps to FlowChartInputOutput.
        assert_eq!(
            ShapePreset::from_ooxml("flowChartData"),
            Some(ShapePreset::FlowChartInputOutput)
        );
        // Canonical name roundtrips correctly.
        assert_eq!(
            ShapePreset::FlowChartInputOutput.to_ooxml(),
            "flowChartInputOutput"
        );
    }

    #[test]
    fn shape_preset_specific_ooxml_values() {
        // Verify specific OOXML strings that differ from variant names.
        assert_eq!(ShapePreset::RightTriangle.to_ooxml(), "rtTriangle");
        assert_eq!(ShapePreset::Lightning.to_ooxml(), "lightningBolt");
        assert_eq!(ShapePreset::Brace.to_ooxml(), "bracePair");
        assert_eq!(ShapePreset::Bracket.to_ooxml(), "bracketPair");
        assert_eq!(ShapePreset::UTurnArrow.to_ooxml(), "uturnArrow");
    }

    #[test]
    fn shape_preset_serde_roundtrip() {
        // Verify serde serialization matches OOXML names.
        for &v in ShapePreset::all_variants() {
            let json = serde_json::to_string(&v).unwrap();
            // JSON string includes quotes, strip them to get raw name.
            let serde_name = json.trim_matches('"');
            let ooxml_name = v.to_ooxml();
            assert_eq!(
                serde_name, ooxml_name,
                "serde name mismatch for {v:?}: serde={serde_name}, ooxml={ooxml_name}"
            );
            // Deserialize back.
            let deserialized: ShapePreset = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, v, "serde roundtrip failed for {v:?}");
        }
    }

    #[test]
    fn shape_preset_spec_xml_roundtrip() {
        // Read the OOXML spec XML and verify all shape names are covered.
        let spec_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../spec/ecma-376/part1/presetShapeDefinitions.xml"
        );
        let spec_path = std::path::Path::new(spec_path);
        if !spec_path.exists() {
            eprintln!(
                "skipping shape preset spec coverage check; internal ECMA-376 corpus is absent"
            );
            return;
        }
        let xml = std::fs::read_to_string(spec_path)
            .expect("presetShapeDefinitions.xml should be readable");

        // Extract top-level element names: lines matching `<someName ` or `<someName>`
        // that are direct children of <presetShapeDefinitons>.
        let mut spec_names: Vec<&str> = Vec::new();
        for line in xml.lines() {
            let trimmed = line.trim();
            // Top-level shape elements start with `<` followed by a lowercase letter,
            // and are indented exactly 2 spaces (direct children of root).
            if line.starts_with("  <") && !line.starts_with("  </") && !line.starts_with("  <?") {
                if let Some(name) = trimmed.strip_prefix('<') {
                    // Extract the element name (up to space, >, or /)
                    let end = name
                        .find(|c: char| c == ' ' || c == '>' || c == '/')
                        .unwrap_or(name.len());
                    let name = &name[..end];
                    // Only lowercase-starting names (skip XML processing instructions etc.)
                    if name.starts_with(|c: char| c.is_ascii_lowercase()) {
                        spec_names.push(name);
                    }
                }
            }
        }

        // Deduplicate (upDownArrow appears twice in the spec XML).
        spec_names.sort();
        spec_names.dedup();

        assert_eq!(
            spec_names.len(),
            186,
            "Expected 186 unique shape names in spec XML, got {}",
            spec_names.len()
        );

        // Verify every spec name roundtrips through from_ooxml/to_ooxml.
        for name in &spec_names {
            let variant = ShapePreset::from_ooxml(name)
                .unwrap_or_else(|| panic!("from_ooxml({name:?}) returned None — missing variant"));
            let back = variant.to_ooxml();
            assert_eq!(back, *name, "to_ooxml() mismatch for {name}: got {back}");
        }
    }

    // -----------------------------------------------------------------------
    // DashStyle
    // -----------------------------------------------------------------------

    #[test]
    fn dash_style_default_is_solid() {
        assert_eq!(DashStyle::default(), DashStyle::Solid);
    }

    #[test]
    fn dash_style_roundtrip() {
        let variants = [
            DashStyle::Solid,
            DashStyle::Dot,
            DashStyle::Dash,
            DashStyle::DashDot,
            DashStyle::LongDash,
            DashStyle::LongDashDot,
            DashStyle::LongDashDotDot,
            DashStyle::SystemDash,
            DashStyle::SystemDot,
            DashStyle::SystemDashDot,
            DashStyle::SystemDashDotDot,
        ];
        for v in variants {
            assert_eq!(
                DashStyle::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn dash_style_from_ooxml_unknown_defaults_to_solid() {
        assert_eq!(DashStyle::from_ooxml(""), DashStyle::Solid);
        assert_eq!(DashStyle::from_ooxml("bogus"), DashStyle::Solid);
    }

    #[test]
    fn dash_style_specific_ooxml_values() {
        assert_eq!(DashStyle::LongDash.to_ooxml(), "lgDash");
        assert_eq!(DashStyle::LongDashDot.to_ooxml(), "lgDashDot");
        assert_eq!(DashStyle::LongDashDotDot.to_ooxml(), "lgDashDotDot");
        assert_eq!(DashStyle::SystemDash.to_ooxml(), "sysDash");
        assert_eq!(DashStyle::SystemDot.to_ooxml(), "sysDot");
        assert_eq!(DashStyle::SystemDashDot.to_ooxml(), "sysDashDot");
        assert_eq!(DashStyle::SystemDashDotDot.to_ooxml(), "sysDashDotDot");
    }

    // -----------------------------------------------------------------------
    // CompoundLine
    // -----------------------------------------------------------------------

    #[test]
    fn compound_line_default_is_single() {
        assert_eq!(CompoundLine::default(), CompoundLine::Single);
    }

    #[test]
    fn compound_line_roundtrip() {
        let variants = [
            CompoundLine::Single,
            CompoundLine::Double,
            CompoundLine::ThickThin,
            CompoundLine::ThinThick,
            CompoundLine::Triple,
        ];
        for v in variants {
            assert_eq!(
                CompoundLine::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn compound_line_from_ooxml_unknown_defaults_to_single() {
        assert_eq!(CompoundLine::from_ooxml(""), CompoundLine::Single);
        assert_eq!(CompoundLine::from_ooxml("bogus"), CompoundLine::Single);
    }

    #[test]
    fn compound_line_specific_ooxml_values() {
        assert_eq!(CompoundLine::Single.to_ooxml(), "sng");
        assert_eq!(CompoundLine::Double.to_ooxml(), "dbl");
        assert_eq!(CompoundLine::Triple.to_ooxml(), "tri");
    }

    // -----------------------------------------------------------------------
    // LineCap
    // -----------------------------------------------------------------------

    #[test]
    fn line_cap_default_is_flat() {
        assert_eq!(LineCap::default(), LineCap::Flat);
    }

    #[test]
    fn line_cap_roundtrip() {
        let variants = [LineCap::Flat, LineCap::Square, LineCap::Round];
        for v in variants {
            assert_eq!(
                LineCap::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn line_cap_from_ooxml_unknown_defaults_to_flat() {
        assert_eq!(LineCap::from_ooxml(""), LineCap::Flat);
        assert_eq!(LineCap::from_ooxml("bogus"), LineCap::Flat);
    }

    #[test]
    fn line_cap_specific_ooxml_values() {
        assert_eq!(LineCap::Square.to_ooxml(), "sq");
        assert_eq!(LineCap::Round.to_ooxml(), "rnd");
    }

    // -----------------------------------------------------------------------
    // CompressionState
    // -----------------------------------------------------------------------

    #[test]
    fn compression_state_default_is_none() {
        assert_eq!(CompressionState::default(), CompressionState::None);
    }

    #[test]
    fn compression_state_roundtrip() {
        let variants = [
            CompressionState::None,
            CompressionState::Print,
            CompressionState::Screen,
            CompressionState::Email,
        ];
        for v in variants {
            assert_eq!(
                CompressionState::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn compression_state_from_ooxml_unknown_defaults_to_none() {
        assert_eq!(CompressionState::from_ooxml(""), CompressionState::None);
        assert_eq!(
            CompressionState::from_ooxml("bogus"),
            CompressionState::None
        );
    }

    // -----------------------------------------------------------------------
    // TextAnchor
    // -----------------------------------------------------------------------

    #[test]
    fn text_anchor_default_is_top() {
        assert_eq!(TextAnchor::default(), TextAnchor::Top);
    }

    #[test]
    fn text_anchor_roundtrip() {
        let variants = [
            TextAnchor::Top,
            TextAnchor::Center,
            TextAnchor::Bottom,
            TextAnchor::Justified,
            TextAnchor::Distributed,
        ];
        for v in variants {
            assert_eq!(
                TextAnchor::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_anchor_from_ooxml_unknown_defaults_to_top() {
        assert_eq!(TextAnchor::from_ooxml(""), TextAnchor::Top);
        assert_eq!(TextAnchor::from_ooxml("bogus"), TextAnchor::Top);
    }

    #[test]
    fn text_anchor_specific_ooxml_values() {
        assert_eq!(TextAnchor::Top.to_ooxml(), "t");
        assert_eq!(TextAnchor::Center.to_ooxml(), "ctr");
        assert_eq!(TextAnchor::Bottom.to_ooxml(), "b");
        assert_eq!(TextAnchor::Justified.to_ooxml(), "just");
        assert_eq!(TextAnchor::Distributed.to_ooxml(), "dist");
    }

    // -----------------------------------------------------------------------
    // TextWrap
    // -----------------------------------------------------------------------

    #[test]
    fn text_wrap_default_is_none() {
        assert_eq!(TextWrap::default(), TextWrap::None);
    }

    #[test]
    fn text_wrap_roundtrip() {
        let variants = [TextWrap::None, TextWrap::Square];
        for v in variants {
            assert_eq!(
                TextWrap::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_wrap_from_ooxml_unknown_defaults_to_none() {
        assert_eq!(TextWrap::from_ooxml(""), TextWrap::None);
        assert_eq!(TextWrap::from_ooxml("tight"), TextWrap::None);
    }

    // -----------------------------------------------------------------------
    // TextAlign
    // -----------------------------------------------------------------------

    #[test]
    fn text_align_default_is_left() {
        assert_eq!(TextAlign::default(), TextAlign::Left);
    }

    #[test]
    fn text_align_roundtrip() {
        let variants = [
            TextAlign::Left,
            TextAlign::Center,
            TextAlign::Right,
            TextAlign::Justify,
            TextAlign::JustifyLow,
            TextAlign::Distributed,
            TextAlign::ThaiDistributed,
        ];
        for v in variants {
            assert_eq!(
                TextAlign::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_align_from_ooxml_unknown_defaults_to_left() {
        assert_eq!(TextAlign::from_ooxml(""), TextAlign::Left);
        assert_eq!(TextAlign::from_ooxml("bogus"), TextAlign::Left);
    }

    #[test]
    fn text_align_specific_ooxml_values() {
        assert_eq!(TextAlign::Left.to_ooxml(), "l");
        assert_eq!(TextAlign::Center.to_ooxml(), "ctr");
        assert_eq!(TextAlign::Right.to_ooxml(), "r");
        assert_eq!(TextAlign::Justify.to_ooxml(), "just");
        assert_eq!(TextAlign::JustifyLow.to_ooxml(), "justLow");
        assert_eq!(TextAlign::Distributed.to_ooxml(), "dist");
        assert_eq!(TextAlign::ThaiDistributed.to_ooxml(), "thaiDist");
    }

    // -----------------------------------------------------------------------
    // SchemeColor
    // -----------------------------------------------------------------------

    #[test]
    fn scheme_color_default_is_dk1() {
        assert_eq!(SchemeColor::default(), SchemeColor::Dk1);
    }

    #[test]
    fn scheme_color_roundtrip() {
        let variants = [
            SchemeColor::Dk1,
            SchemeColor::Lt1,
            SchemeColor::Dk2,
            SchemeColor::Lt2,
            SchemeColor::Accent1,
            SchemeColor::Accent2,
            SchemeColor::Accent3,
            SchemeColor::Accent4,
            SchemeColor::Accent5,
            SchemeColor::Accent6,
            SchemeColor::Hlink,
            SchemeColor::FolHlink,
        ];
        for v in variants {
            let ooxml = v.to_ooxml();
            assert_eq!(
                SchemeColor::from_ooxml(ooxml),
                Some(v),
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn scheme_color_from_ooxml_unknown_returns_none() {
        assert_eq!(SchemeColor::from_ooxml(""), None);
        assert_eq!(SchemeColor::from_ooxml("bogus"), None);
    }

    #[test]
    fn scheme_color_theme_index_roundtrip() {
        for idx in 0..12 {
            let color = SchemeColor::from_theme_index(idx).unwrap();
            assert_eq!(color.to_theme_index(), idx);
        }
        assert_eq!(SchemeColor::from_theme_index(12), None);
        assert_eq!(SchemeColor::from_theme_index(u32::MAX), None);
    }

    #[test]
    fn scheme_color_theme_index_values() {
        assert_eq!(SchemeColor::Dk1.to_theme_index(), 0);
        assert_eq!(SchemeColor::Lt1.to_theme_index(), 1);
        assert_eq!(SchemeColor::Accent1.to_theme_index(), 4);
        assert_eq!(SchemeColor::FolHlink.to_theme_index(), 11);
    }

    // -----------------------------------------------------------------------
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
    // TextUnderlineType
    // -----------------------------------------------------------------------

    #[test]
    fn text_underline_type_default_is_none() {
        assert_eq!(TextUnderlineType::default(), TextUnderlineType::None);
    }

    #[test]
    fn text_underline_type_roundtrip() {
        let variants = [
            TextUnderlineType::None,
            TextUnderlineType::Words,
            TextUnderlineType::Single,
            TextUnderlineType::Double,
            TextUnderlineType::Heavy,
            TextUnderlineType::Dotted,
            TextUnderlineType::DottedHeavy,
            TextUnderlineType::Dash,
            TextUnderlineType::DashHeavy,
            TextUnderlineType::DashLong,
            TextUnderlineType::DashLongHeavy,
            TextUnderlineType::DotDash,
            TextUnderlineType::DotDashHeavy,
            TextUnderlineType::DotDotDash,
            TextUnderlineType::DotDotDashHeavy,
            TextUnderlineType::Wavy,
            TextUnderlineType::WavyHeavy,
            TextUnderlineType::WavyDouble,
        ];
        for v in variants {
            assert_eq!(
                TextUnderlineType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_underline_type_from_ooxml_unknown_defaults_to_none() {
        assert_eq!(TextUnderlineType::from_ooxml(""), TextUnderlineType::None);
        assert_eq!(
            TextUnderlineType::from_ooxml("bogus"),
            TextUnderlineType::None
        );
    }

    #[test]
    fn text_underline_type_specific_ooxml_values() {
        assert_eq!(TextUnderlineType::Single.to_ooxml(), "sng");
        assert_eq!(TextUnderlineType::Double.to_ooxml(), "dbl");
        assert_eq!(TextUnderlineType::WavyDouble.to_ooxml(), "wavyDbl");
    }

    // -----------------------------------------------------------------------
    // TextStrikeType
    // -----------------------------------------------------------------------

    #[test]
    fn text_strike_type_default_is_no_strike() {
        assert_eq!(TextStrikeType::default(), TextStrikeType::NoStrike);
    }

    #[test]
    fn text_strike_type_roundtrip() {
        let variants = [
            TextStrikeType::NoStrike,
            TextStrikeType::SingleStrike,
            TextStrikeType::DoubleStrike,
        ];
        for v in variants {
            assert_eq!(
                TextStrikeType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_strike_type_from_ooxml_unknown_defaults_to_no_strike() {
        assert_eq!(TextStrikeType::from_ooxml(""), TextStrikeType::NoStrike);
        assert_eq!(
            TextStrikeType::from_ooxml("bogus"),
            TextStrikeType::NoStrike
        );
    }

    #[test]
    fn text_strike_type_specific_ooxml_values() {
        assert_eq!(TextStrikeType::SingleStrike.to_ooxml(), "sngStrike");
        assert_eq!(TextStrikeType::DoubleStrike.to_ooxml(), "dblStrike");
    }

    // -----------------------------------------------------------------------
    // TextCapsType
    // -----------------------------------------------------------------------

    #[test]
    fn text_caps_type_default_is_none() {
        assert_eq!(TextCapsType::default(), TextCapsType::None);
    }

    #[test]
    fn text_caps_type_roundtrip() {
        let variants = [TextCapsType::None, TextCapsType::Small, TextCapsType::All];
        for v in variants {
            assert_eq!(
                TextCapsType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_caps_type_from_ooxml_unknown_defaults_to_none() {
        assert_eq!(TextCapsType::from_ooxml(""), TextCapsType::None);
        assert_eq!(TextCapsType::from_ooxml("bogus"), TextCapsType::None);
    }

    // -----------------------------------------------------------------------
    // TextVerticalType
    // -----------------------------------------------------------------------

    #[test]
    fn text_vertical_type_default_is_horizontal() {
        assert_eq!(TextVerticalType::default(), TextVerticalType::Horizontal);
    }

    #[test]
    fn text_vertical_type_roundtrip() {
        let variants = [
            TextVerticalType::Horizontal,
            TextVerticalType::Vertical,
            TextVerticalType::Vertical270,
            TextVerticalType::WordArtVert,
            TextVerticalType::EastAsianVert,
            TextVerticalType::MongolianVert,
            TextVerticalType::WordArtVertRtl,
        ];
        for v in variants {
            assert_eq!(
                TextVerticalType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_vertical_type_from_ooxml_unknown_defaults_to_horizontal() {
        assert_eq!(
            TextVerticalType::from_ooxml(""),
            TextVerticalType::Horizontal
        );
        assert_eq!(
            TextVerticalType::from_ooxml("bogus"),
            TextVerticalType::Horizontal
        );
    }

    #[test]
    fn text_vertical_type_specific_ooxml_values() {
        assert_eq!(TextVerticalType::Horizontal.to_ooxml(), "horz");
        assert_eq!(TextVerticalType::EastAsianVert.to_ooxml(), "eaVert");
        assert_eq!(
            TextVerticalType::WordArtVertRtl.to_ooxml(),
            "wordArtVertRtl"
        );
    }

    // -----------------------------------------------------------------------
    // TextVertOverflow
    // -----------------------------------------------------------------------

    #[test]
    fn text_vert_overflow_default_is_overflow() {
        assert_eq!(TextVertOverflow::default(), TextVertOverflow::Overflow);
    }

    #[test]
    fn text_vert_overflow_roundtrip() {
        let variants = [
            TextVertOverflow::Overflow,
            TextVertOverflow::Ellipsis,
            TextVertOverflow::Clip,
        ];
        for v in variants {
            assert_eq!(
                TextVertOverflow::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_vert_overflow_from_ooxml_unknown_defaults_to_overflow() {
        assert_eq!(TextVertOverflow::from_ooxml(""), TextVertOverflow::Overflow);
        assert_eq!(
            TextVertOverflow::from_ooxml("bogus"),
            TextVertOverflow::Overflow
        );
    }

    // -----------------------------------------------------------------------
    // TextHorzOverflow
    // -----------------------------------------------------------------------

    #[test]
    fn text_horz_overflow_default_is_overflow() {
        assert_eq!(TextHorzOverflow::default(), TextHorzOverflow::Overflow);
    }

    #[test]
    fn text_horz_overflow_roundtrip() {
        let variants = [TextHorzOverflow::Overflow, TextHorzOverflow::Clip];
        for v in variants {
            assert_eq!(
                TextHorzOverflow::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_horz_overflow_from_ooxml_unknown_defaults_to_overflow() {
        assert_eq!(TextHorzOverflow::from_ooxml(""), TextHorzOverflow::Overflow);
        assert_eq!(
            TextHorzOverflow::from_ooxml("bogus"),
            TextHorzOverflow::Overflow
        );
    }

    // -----------------------------------------------------------------------
    // TextAutofit
    // -----------------------------------------------------------------------

    #[test]
    fn text_autofit_default_is_no_autofit() {
        assert_eq!(TextAutofit::default(), TextAutofit::NoAutofit);
    }

    #[test]
    fn text_autofit_normal_with_fields() {
        let af = TextAutofit::NormalAutofit {
            font_scale: Some(75000),
            line_space_reduction: Some(20000),
        };
        match af {
            TextAutofit::NormalAutofit {
                font_scale,
                line_space_reduction,
            } => {
                assert_eq!(font_scale, Some(75000));
                assert_eq!(line_space_reduction, Some(20000));
            }
            _ => panic!("expected NormalAutofit"),
        }
    }

    // -----------------------------------------------------------------------
    // TextFontAlignType
    // -----------------------------------------------------------------------

    #[test]
    fn text_font_align_type_default_is_auto() {
        assert_eq!(TextFontAlignType::default(), TextFontAlignType::Auto);
    }

    #[test]
    fn text_font_align_type_roundtrip() {
        let variants = [
            TextFontAlignType::Auto,
            TextFontAlignType::Top,
            TextFontAlignType::Center,
            TextFontAlignType::Baseline,
            TextFontAlignType::Bottom,
        ];
        for v in variants {
            assert_eq!(
                TextFontAlignType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_font_align_type_from_ooxml_unknown_defaults_to_auto() {
        assert_eq!(TextFontAlignType::from_ooxml(""), TextFontAlignType::Auto);
        assert_eq!(
            TextFontAlignType::from_ooxml("bogus"),
            TextFontAlignType::Auto
        );
    }

    #[test]
    fn text_font_align_type_specific_ooxml_values() {
        assert_eq!(TextFontAlignType::Top.to_ooxml(), "t");
        assert_eq!(TextFontAlignType::Center.to_ooxml(), "ctr");
        assert_eq!(TextFontAlignType::Baseline.to_ooxml(), "base");
        assert_eq!(TextFontAlignType::Bottom.to_ooxml(), "b");
    }

    // -----------------------------------------------------------------------
    // TextAutonumberType
    // -----------------------------------------------------------------------

    #[test]
    fn text_autonumber_type_default_is_arabic_period() {
        assert_eq!(
            TextAutonumberType::default(),
            TextAutonumberType::ArabicPeriod
        );
    }

    #[test]
    fn text_autonumber_type_roundtrip() {
        let variants = [
            TextAutonumberType::AlphaLcParenBoth,
            TextAutonumberType::AlphaUcParenBoth,
            TextAutonumberType::AlphaLcParenR,
            TextAutonumberType::AlphaUcParenR,
            TextAutonumberType::AlphaLcPeriod,
            TextAutonumberType::AlphaUcPeriod,
            TextAutonumberType::ArabicParenBoth,
            TextAutonumberType::ArabicParenR,
            TextAutonumberType::ArabicPeriod,
            TextAutonumberType::ArabicPlain,
            TextAutonumberType::RomanLcParenBoth,
            TextAutonumberType::RomanUcParenBoth,
            TextAutonumberType::RomanLcParenR,
            TextAutonumberType::RomanUcParenR,
            TextAutonumberType::RomanLcPeriod,
            TextAutonumberType::RomanUcPeriod,
            TextAutonumberType::CircleNumDbPlain,
            TextAutonumberType::CircleNumWdBlackPlain,
            TextAutonumberType::CircleNumWdWhitePlain,
            TextAutonumberType::ArabicDbPeriod,
            TextAutonumberType::ArabicDbPlain,
            TextAutonumberType::Ea1ChsPeriod,
            TextAutonumberType::Ea1ChsPlain,
            TextAutonumberType::Ea1ChtPeriod,
            TextAutonumberType::Ea1ChtPlain,
            TextAutonumberType::Ea1JpnChsDbPeriod,
            TextAutonumberType::Ea1JpnKorPlain,
            TextAutonumberType::Ea1JpnKorPeriod,
            TextAutonumberType::Arabic1Minus,
            TextAutonumberType::Arabic2Minus,
            TextAutonumberType::Hebrew2Minus,
            TextAutonumberType::ThaiAlphaPeriod,
            TextAutonumberType::ThaiAlphaParenR,
            TextAutonumberType::ThaiAlphaParenBoth,
            TextAutonumberType::ThaiNumPeriod,
            TextAutonumberType::ThaiNumParenR,
            TextAutonumberType::ThaiNumParenBoth,
            TextAutonumberType::HindiAlphaPeriod,
            TextAutonumberType::HindiNumPeriod,
            TextAutonumberType::HindiNumParenR,
            TextAutonumberType::HindiAlpha1Period,
        ];
        for v in variants {
            assert_eq!(
                TextAutonumberType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_autonumber_type_from_ooxml_unknown_defaults_to_arabic_period() {
        assert_eq!(
            TextAutonumberType::from_ooxml(""),
            TextAutonumberType::ArabicPeriod
        );
        assert_eq!(
            TextAutonumberType::from_ooxml("bogus"),
            TextAutonumberType::ArabicPeriod
        );
    }

    // -----------------------------------------------------------------------
    // TextTabAlignType
    // -----------------------------------------------------------------------

    #[test]
    fn text_tab_align_type_default_is_left() {
        assert_eq!(TextTabAlignType::default(), TextTabAlignType::Left);
    }

    #[test]
    fn text_tab_align_type_roundtrip() {
        let variants = [
            TextTabAlignType::Left,
            TextTabAlignType::Center,
            TextTabAlignType::Right,
            TextTabAlignType::Decimal,
        ];
        for v in variants {
            assert_eq!(
                TextTabAlignType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn text_tab_align_type_from_ooxml_unknown_defaults_to_left() {
        assert_eq!(TextTabAlignType::from_ooxml(""), TextTabAlignType::Left);
        assert_eq!(
            TextTabAlignType::from_ooxml("bogus"),
            TextTabAlignType::Left
        );
    }

    #[test]
    fn text_tab_align_type_specific_ooxml_values() {
        assert_eq!(TextTabAlignType::Left.to_ooxml(), "l");
        assert_eq!(TextTabAlignType::Center.to_ooxml(), "ctr");
        assert_eq!(TextTabAlignType::Right.to_ooxml(), "r");
        assert_eq!(TextTabAlignType::Decimal.to_ooxml(), "dec");
    }

    // -----------------------------------------------------------------------
    // TextFont
    // -----------------------------------------------------------------------

    #[test]
    fn text_font_default() {
        let f = TextFont::default();
        assert_eq!(f.typeface, "");
        assert!(f.panose.is_none());
        assert!(f.pitch_family.is_none());
        assert!(f.charset.is_none());
    }

    // -----------------------------------------------------------------------
    // TextSpacing
    // -----------------------------------------------------------------------

    #[test]
    fn text_spacing_percent() {
        let s = TextSpacing::Percent(100_000);
        match s {
            TextSpacing::Percent(v) => assert_eq!(v, 100_000),
            _ => panic!("expected Percent"),
        }
    }

    #[test]
    fn text_spacing_points() {
        let s = TextSpacing::Points(1200);
        match s {
            TextSpacing::Points(v) => assert_eq!(v, 1200),
            _ => panic!("expected Points"),
        }
    }

    // -----------------------------------------------------------------------
    // TextTabStop
    // -----------------------------------------------------------------------

    #[test]
    fn text_tab_stop_default() {
        let t = TextTabStop::default();
        assert!(t.position.is_none());
        assert!(t.align.is_none());
    }

    // -----------------------------------------------------------------------
    // BulletProperties
    // -----------------------------------------------------------------------

    #[test]
    fn bullet_properties_default() {
        let b = BulletProperties::default();
        assert!(b.color.is_none());
        assert!(b.size.is_none());
        assert!(b.font.is_none());
        assert!(b.bullet_type.is_none());
    }

    #[test]
    fn bullet_type_char() {
        let bt = BulletType::Char("\u{2022}".to_string());
        match bt {
            BulletType::Char(c) => assert_eq!(c, "\u{2022}"),
            _ => panic!("expected Char"),
        }
    }

    #[test]
    fn bullet_type_auto_num() {
        let bt = BulletType::AutoNum {
            scheme: TextAutonumberType::ArabicPeriod,
            start_at: Some(1),
        };
        match bt {
            BulletType::AutoNum { scheme, start_at } => {
                assert_eq!(scheme, TextAutonumberType::ArabicPeriod);
                assert_eq!(start_at, Some(1));
            }
            _ => panic!("expected AutoNum"),
        }
    }

    // -----------------------------------------------------------------------
    // Hyperlink defaults
    // -----------------------------------------------------------------------

    #[test]
    fn hyperlink_defaults() {
        let h = Hyperlink::default();
        assert!(h.url.is_none());
        assert!(h.tooltip.is_none());
        assert!(h.action.is_none());
        assert!(h.r_id.is_none());
        // Additional Hyperlink fields also default to None
        assert!(h.tgt_frame.is_none());
        assert!(h.invalid_url.is_none());
        assert!(h.history.is_none());
        assert!(h.highlight_click.is_none());
        assert!(h.end_snd.is_none());
    }

    // -----------------------------------------------------------------------
    // ExtensionList
    // -----------------------------------------------------------------------

    #[test]
    fn extension_list_default() {
        let e = ExtensionList::default();
        assert!(e.raw_xml.is_none());
    }

    // -----------------------------------------------------------------------
    // UnderlineLine and UnderlineFill
    // -----------------------------------------------------------------------

    #[test]
    fn underline_line_follow_text() {
        let ul = UnderlineLine::FollowText;
        assert_eq!(ul, UnderlineLine::FollowText);
    }

    #[test]
    fn underline_fill_follow_text() {
        let uf = UnderlineFill::FollowText;
        assert_eq!(uf, UnderlineFill::FollowText);
    }

    // -----------------------------------------------------------------------
    // TextRunContent
    // -----------------------------------------------------------------------

    #[test]
    fn text_run_content_run() {
        let content = TextRunContent::Run(TextRun {
            text: "hello".to_string(),
            props: RunProperties::default(),
        });
        match content {
            TextRunContent::Run(r) => assert_eq!(r.text, "hello"),
            _ => panic!("expected Run"),
        }
    }

    #[test]
    fn text_run_content_line_break() {
        let content = TextRunContent::LineBreak { props: None };
        match content {
            TextRunContent::LineBreak { props } => assert!(props.is_none()),
            _ => panic!("expected LineBreak"),
        }
    }

    #[test]
    fn text_run_content_field() {
        let content = TextRunContent::Field {
            id: "{12345}".to_string(),
            field_type: Some("slidenum".to_string()),
            text: Some("1".to_string()),
            run_props: None,
            para_props: None,
        };
        match content {
            TextRunContent::Field {
                id,
                field_type,
                text,
                run_props,
                ..
            } => {
                assert_eq!(id, "{12345}");
                assert_eq!(field_type.as_deref(), Some("slidenum"));
                assert_eq!(text.as_deref(), Some("1"));
                assert!(run_props.is_none());
            }
            _ => panic!("expected Field"),
        }
    }

    // -----------------------------------------------------------------------
    // TextListStyle
    // -----------------------------------------------------------------------

    #[test]
    fn text_list_style_default() {
        let ls = TextListStyle::default();
        assert!(ls.def_ppr.is_none());
        for level in &ls.level_ppr {
            assert!(level.is_none());
        }
    }

    // -----------------------------------------------------------------------
    // PresetCameraType
    // -----------------------------------------------------------------------

    #[test]
    fn preset_camera_type_roundtrip() {
        let variants = [
            PresetCameraType::LegacyObliqueTopLeft,
            PresetCameraType::LegacyObliqueTop,
            PresetCameraType::LegacyObliqueTopRight,
            PresetCameraType::LegacyObliqueFront,
            PresetCameraType::LegacyObliqueLeft,
            PresetCameraType::LegacyObliqueRight,
            PresetCameraType::LegacyPerspectiveTopLeft,
            PresetCameraType::LegacyPerspectiveTop,
            PresetCameraType::LegacyPerspectiveTopRight,
            PresetCameraType::LegacyPerspectiveFront,
            PresetCameraType::LegacyPerspectiveLeft,
            PresetCameraType::LegacyPerspectiveRight,
            PresetCameraType::OrthographicFront,
            PresetCameraType::IsometricTopUp,
            PresetCameraType::IsometricTopDown,
            PresetCameraType::IsometricBottomUp,
            PresetCameraType::IsometricBottomDown,
            PresetCameraType::IsometricLeftUp,
            PresetCameraType::IsometricLeftDown,
            PresetCameraType::IsometricRightUp,
            PresetCameraType::IsometricRightDown,
            PresetCameraType::IsometricOffAxis1Left,
            PresetCameraType::IsometricOffAxis1Right,
            PresetCameraType::IsometricOffAxis1Top,
            PresetCameraType::IsometricOffAxis2Left,
            PresetCameraType::IsometricOffAxis2Right,
            PresetCameraType::IsometricOffAxis2Top,
            PresetCameraType::IsometricOffAxis3Left,
            PresetCameraType::IsometricOffAxis3Right,
            PresetCameraType::IsometricOffAxis3Bottom,
            PresetCameraType::IsometricOffAxis4Left,
            PresetCameraType::IsometricOffAxis4Right,
            PresetCameraType::IsometricOffAxis4Bottom,
            PresetCameraType::ObliqueTopLeft,
            PresetCameraType::ObliqueTop,
            PresetCameraType::ObliqueTopRight,
            PresetCameraType::ObliqueLeft,
            PresetCameraType::ObliqueRight,
            PresetCameraType::ObliqueBottomLeft,
            PresetCameraType::ObliqueBottom,
            PresetCameraType::ObliqueBottomRight,
            PresetCameraType::PerspectiveFront,
            PresetCameraType::PerspectiveLeft,
            PresetCameraType::PerspectiveRight,
            PresetCameraType::PerspectiveAbove,
            PresetCameraType::PerspectiveAboveLeftFacing,
            PresetCameraType::PerspectiveAboveRightFacing,
            PresetCameraType::PerspectiveContrastingLeftFacing,
            PresetCameraType::PerspectiveContrastingRightFacing,
            PresetCameraType::PerspectiveHeroicLeftFacing,
            PresetCameraType::PerspectiveHeroicRightFacing,
            PresetCameraType::PerspectiveHeroicExtremeLeftFacing,
            PresetCameraType::PerspectiveHeroicExtremeRightFacing,
            PresetCameraType::PerspectiveBelow,
            PresetCameraType::PerspectiveRelaxed,
            PresetCameraType::PerspectiveRelaxedModerately,
        ];
        for v in variants {
            assert_eq!(
                PresetCameraType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn preset_camera_type_unknown_defaults() {
        assert_eq!(
            PresetCameraType::from_ooxml("bogus"),
            PresetCameraType::OrthographicFront
        );
    }

    // -----------------------------------------------------------------------
    // LightRigType
    // -----------------------------------------------------------------------

    #[test]
    fn light_rig_type_roundtrip() {
        let variants = [
            LightRigType::Balanced,
            LightRigType::BrightRoom,
            LightRigType::Chilly,
            LightRigType::Contrasting,
            LightRigType::Flat,
            LightRigType::Flood,
            LightRigType::Freezing,
            LightRigType::Glow,
            LightRigType::Harsh,
            LightRigType::LegacyFlat1,
            LightRigType::LegacyFlat2,
            LightRigType::LegacyFlat3,
            LightRigType::LegacyFlat4,
            LightRigType::LegacyHarsh1,
            LightRigType::LegacyHarsh2,
            LightRigType::LegacyHarsh3,
            LightRigType::LegacyHarsh4,
            LightRigType::LegacyNormal1,
            LightRigType::LegacyNormal2,
            LightRigType::LegacyNormal3,
            LightRigType::LegacyNormal4,
            LightRigType::Morning,
            LightRigType::Soft,
            LightRigType::Sunrise,
            LightRigType::Sunset,
            LightRigType::ThreePt,
            LightRigType::TwoPt,
        ];
        for v in variants {
            assert_eq!(
                LightRigType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn light_rig_type_unknown_defaults() {
        assert_eq!(LightRigType::from_ooxml("bogus"), LightRigType::ThreePt);
    }

    // -----------------------------------------------------------------------
    // LightRigDirection
    // -----------------------------------------------------------------------

    #[test]
    fn light_rig_direction_roundtrip() {
        let variants = [
            LightRigDirection::Top,
            LightRigDirection::TopLeft,
            LightRigDirection::TopRight,
            LightRigDirection::Left,
            LightRigDirection::Right,
            LightRigDirection::Bottom,
            LightRigDirection::BottomLeft,
            LightRigDirection::BottomRight,
        ];
        for v in variants {
            assert_eq!(
                LightRigDirection::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn light_rig_direction_unknown_defaults() {
        assert_eq!(
            LightRigDirection::from_ooxml("bogus"),
            LightRigDirection::Top
        );
    }

    // -----------------------------------------------------------------------
    // BevelPresetType
    // -----------------------------------------------------------------------

    #[test]
    fn bevel_preset_type_roundtrip() {
        let variants = [
            BevelPresetType::RelaxedInset,
            BevelPresetType::Circle,
            BevelPresetType::Slope,
            BevelPresetType::Cross,
            BevelPresetType::Angle,
            BevelPresetType::SoftRound,
            BevelPresetType::Convex,
            BevelPresetType::CoolSlant,
            BevelPresetType::Divot,
            BevelPresetType::Riblet,
            BevelPresetType::HardEdge,
            BevelPresetType::ArtDeco,
        ];
        for v in variants {
            assert_eq!(
                BevelPresetType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn bevel_preset_type_unknown_defaults() {
        assert_eq!(
            BevelPresetType::from_ooxml("bogus"),
            BevelPresetType::Circle
        );
    }

    // -----------------------------------------------------------------------
    // PresetMaterialType
    // -----------------------------------------------------------------------

    #[test]
    fn preset_material_type_roundtrip() {
        let variants = [
            PresetMaterialType::DkEdge,
            PresetMaterialType::Flat,
            PresetMaterialType::LegacyMatte,
            PresetMaterialType::LegacyMetal,
            PresetMaterialType::LegacyPlastic,
            PresetMaterialType::LegacyWireframe,
            PresetMaterialType::Matte,
            PresetMaterialType::Metal,
            PresetMaterialType::Plastic,
            PresetMaterialType::Powder,
            PresetMaterialType::SoftEdge,
            PresetMaterialType::SoftMetal,
            PresetMaterialType::TranslucentPowder,
            PresetMaterialType::WarmMatte,
        ];
        for v in variants {
            assert_eq!(
                PresetMaterialType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    #[test]
    fn preset_material_type_unknown_defaults() {
        assert_eq!(
            PresetMaterialType::from_ooxml("bogus"),
            PresetMaterialType::WarmMatte
        );
    }

    // -----------------------------------------------------------------------
    // 3D Structs
    // -----------------------------------------------------------------------

    #[test]
    fn rotation_3d_basic() {
        let rot = Rotation3D {
            lat: StPositiveFixedAngle::new_unchecked(0),
            lon: StPositiveFixedAngle::new_unchecked(0),
            rev: StPositiveFixedAngle::new_unchecked(0),
        };
        assert_eq!(rot.lat, StPositiveFixedAngle::new_unchecked(0));
        assert_eq!(rot.lon, StPositiveFixedAngle::new_unchecked(0));
        assert_eq!(rot.rev, StPositiveFixedAngle::new_unchecked(0));
    }

    #[test]
    fn camera_basic() {
        let cam = Camera {
            prst: PresetCameraType::OrthographicFront,
            fov: Some(StFovAngle::new_unchecked(4_500_000)),
            zoom: None,
            rot: Some(Rotation3D {
                lat: StPositiveFixedAngle::new_unchecked(100),
                lon: StPositiveFixedAngle::new_unchecked(200),
                rev: StPositiveFixedAngle::new_unchecked(300),
            }),
        };
        assert_eq!(cam.prst, PresetCameraType::OrthographicFront);
        assert_eq!(cam.fov, Some(StFovAngle::new_unchecked(4_500_000)));
        assert!(cam.rot.is_some());
    }

    #[test]
    fn light_rig_basic() {
        let rig = LightRig {
            rig: LightRigType::ThreePt,
            dir: LightRigDirection::Top,
            rot: None,
        };
        assert_eq!(rig.rig, LightRigType::ThreePt);
        assert_eq!(rig.dir, LightRigDirection::Top);
        assert!(rig.rot.is_none());
    }

    #[test]
    fn scene_3d_basic() {
        let scene = Scene3D {
            camera: Camera {
                prst: PresetCameraType::OrthographicFront,
                fov: None,
                zoom: None,
                rot: None,
            },
            light_rig: LightRig {
                rig: LightRigType::ThreePt,
                dir: LightRigDirection::Top,
                rot: None,
            },
            backdrop: None,
            ext_lst: None,
        };
        assert_eq!(scene.camera.prst, PresetCameraType::OrthographicFront);
        assert_eq!(scene.light_rig.rig, LightRigType::ThreePt);
    }

    #[test]
    fn bevel_basic() {
        let bevel = Bevel {
            w: Some(StPositiveCoordinate::new_unchecked(76_200)),
            h: Some(StPositiveCoordinate::new_unchecked(50_800)),
            prst: Some(BevelPresetType::Circle),
        };
        assert_eq!(bevel.w, Some(StPositiveCoordinate::new_unchecked(76_200)));
        assert_eq!(bevel.h, Some(StPositiveCoordinate::new_unchecked(50_800)));
        assert_eq!(bevel.prst, Some(BevelPresetType::Circle));
    }

    #[test]
    fn shape_3d_basic() {
        let shape = Shape3D {
            bevel_t: Some(Bevel {
                w: Some(StPositiveCoordinate::new_unchecked(76_200)),
                h: Some(StPositiveCoordinate::new_unchecked(50_800)),
                prst: None,
            }),
            bevel_b: None,
            extrusion_h: Some(StPositiveCoordinate::new_unchecked(25_400)),
            extrusion_clr: Some(DrawingColor::SrgbClr {
                val: "FF0000".to_string(),
                transforms: vec![],
            }),
            contour_w: Some(StPositiveCoordinate::new_unchecked(12_700)),
            contour_clr: None,
            prst_material: Some(PresetMaterialType::Plastic),
            z: None,
            ext_lst: None,
        };
        assert!(shape.bevel_t.is_some());
        assert!(shape.bevel_b.is_none());
        assert_eq!(
            shape.extrusion_h,
            Some(StPositiveCoordinate::new_unchecked(25_400))
        );
        assert_eq!(shape.prst_material, Some(PresetMaterialType::Plastic));
    }

    // -----------------------------------------------------------------------
    // Geometry types
    // -----------------------------------------------------------------------

    #[test]
    fn custom_geometry_empty() {
        let geom = CustomGeometry {
            av_list: vec![],
            gd_list: vec![],
            ah_list: vec![],
            cxn_list: vec![],
            rect: None,
            path_list: vec![],
        };
        assert!(geom.path_list.is_empty());
    }

    #[test]
    fn path_command_roundtrip() {
        let path = Path2D {
            w: Some(1000),
            h: Some(1000),
            fill: Some(PathFillMode::Norm),
            stroke: Some(true),
            extrusion_ok: None,
            commands: vec![
                PathCommand::MoveTo {
                    x: "0".to_string(),
                    y: "0".to_string(),
                },
                PathCommand::LineTo {
                    x: "1000".to_string(),
                    y: "0".to_string(),
                },
                PathCommand::CubicBezTo {
                    x1: "1000".to_string(),
                    y1: "0".to_string(),
                    x2: "1000".to_string(),
                    y2: "1000".to_string(),
                    x: "500".to_string(),
                    y: "1000".to_string(),
                },
                PathCommand::Close,
            ],
        };
        assert_eq!(path.commands.len(), 4);
        let json = serde_json::to_string(&path).unwrap();
        let deserialized: Path2D = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, path);
    }

    #[test]
    fn shape_geometry_preset() {
        let geom = ShapeGeometry::Preset(PresetGeometry {
            prst: ShapePreset::RoundRect,
            av_list: vec![GeomGuide {
                name: "adj".to_string(),
                fmla: "val 16667".to_string(),
            }],
        });
        match geom {
            ShapeGeometry::Preset(p) => {
                assert_eq!(p.prst, ShapePreset::RoundRect);
                assert_eq!(p.av_list.len(), 1);
            }
            _ => panic!("expected Preset"),
        }
    }

    #[test]
    fn path_fill_mode_roundtrip() {
        let variants = [
            PathFillMode::None,
            PathFillMode::Norm,
            PathFillMode::Lighten,
            PathFillMode::LightenLess,
            PathFillMode::Darken,
            PathFillMode::DarkenLess,
        ];
        for v in variants {
            assert_eq!(
                PathFillMode::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {v:?}"
            );
        }
    }

    // -----------------------------------------------------------------------
    // ShapeProperties / GroupShapeProperties
    // -----------------------------------------------------------------------

    #[test]
    fn shape_properties_default() {
        let sp = ShapeProperties::default();
        assert!(sp.xfrm.is_none());
        assert!(sp.geometry.is_none());
        assert!(sp.fill.is_none());
        assert!(sp.ln.is_none());
        assert!(sp.effects.is_none());
        assert!(sp.scene3d.is_none());
        assert!(sp.sp3d.is_none());
        assert!(sp.bw_mode.is_none());
    }

    #[test]
    fn group_shape_properties_default() {
        let gsp = GroupShapeProperties::default();
        assert!(gsp.xfrm.is_none());
        assert!(gsp.fill.is_none());
        assert!(gsp.effects.is_none());
        assert!(gsp.scene3d.is_none());
        assert!(gsp.bw_mode.is_none());
        assert!(gsp.ext_lst.is_none());
    }

    #[test]
    fn drawing_color_scheme_with_transforms_serde_roundtrip() {
        let color = DrawingColor::SchemeClr {
            val: SchemeColor::Accent1,
            transforms: vec![
                ColorTransform::Tint { val: 40000 },
                ColorTransform::SatMod { val: 120000 },
            ],
        };
        let json = serde_json::to_string(&color).unwrap();
        let deserialized: DrawingColor = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, color);
    }

    #[test]
    fn drawing_color_srgb_no_transforms_serde_roundtrip() {
        let color = DrawingColor::SrgbClr {
            val: "FF0000".to_string(),
            transforms: vec![],
        };
        let json = serde_json::to_string(&color).unwrap();
        let deserialized: DrawingColor = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, color);
        // Verify transforms field is omitted when empty
        assert!(!json.contains("transforms"));
    }

    #[test]
    fn color_transform_from_ooxml_roundtrip() {
        let cases = [
            ("tint", Some(40000), "tint"),
            ("shade", Some(60000), "shade"),
            ("lumMod", Some(75000), "lumMod"),
            ("lumOff", Some(25000), "lumOff"),
            ("satMod", Some(120000), "satMod"),
            ("alpha", Some(50000), "alpha"),
            ("comp", None, "comp"),
            ("inv", None, "inv"),
            ("gray", None, "gray"),
            ("gamma", None, "gamma"),
            ("invGamma", None, "invGamma"),
        ];
        for (name, val, expected_name) in cases {
            let ct = ColorTransform::from_ooxml(name, val)
                .unwrap_or_else(|| panic!("from_ooxml({name}) returned None"));
            assert_eq!(
                ct.to_ooxml_name(),
                expected_name,
                "to_ooxml_name mismatch for {name}"
            );
            if let Some(v) = val {
                assert_eq!(ct.val(), Some(v), "val mismatch for {name}");
            }
        }
    }
}
