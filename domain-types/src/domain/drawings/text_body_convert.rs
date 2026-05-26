//! Converters between the domain `TextBody` mirror and
//! `ooxml_types::drawings::TextBody`.
//!
//! These converters pair with `super::text_body` to give CT_TextBody a
//! lossless domain representation. Converters are split off into their own
//! file because the surface is wide and this keeps the type-definitions
//! file readable.

use ooxml_types::drawings as odraw;

use super::scene::SceneSettings;
use super::shape_3d::Shape3DSettings;
use super::text_body::*;

// ===========================================================================
// Helpers
// ===========================================================================

fn font_ref_from(f: &odraw::TextFont) -> TextFontRef {
    TextFontRef {
        typeface: f.typeface.clone(),
        panose: f.panose.clone(),
        pitch_family: f.pitch_family.map(|p| p.value() as i32),
        charset: f.charset.map(|c| c as i32),
    }
}

fn font_ref_into(f: TextFontRef) -> odraw::TextFont {
    odraw::TextFont {
        typeface: f.typeface,
        panose: f.panose,
        pitch_family: f.pitch_family.map(|p| {
            let clamped = p.clamp(0, u8::MAX as i32) as u8;
            odraw::StPitchFamily::new(clamped)
        }),
        charset: f
            .charset
            .map(|c| c.clamp(i8::MIN as i32, i8::MAX as i32) as i8),
    }
}

fn spacing_from(s: &odraw::TextSpacing) -> TextSpacing {
    match s {
        odraw::TextSpacing::Percent(p) => TextSpacing::Pct { val: *p as i32 },
        odraw::TextSpacing::Points(p) => TextSpacing::Pts { val: *p as i32 },
    }
}

fn spacing_into(s: TextSpacing) -> odraw::TextSpacing {
    match s {
        TextSpacing::Pct { val } => odraw::TextSpacing::Percent(val.max(0) as u32),
        TextSpacing::Pts { val } => odraw::TextSpacing::Points(val.max(0) as u32),
    }
}

fn tab_from(t: &odraw::TextTabStop) -> TextTabStop {
    TextTabStop {
        pos: t.position,
        algn: t.align.as_ref().map(|a| a.to_ooxml().to_string()),
    }
}

fn tab_into(t: TextTabStop) -> odraw::TextTabStop {
    odraw::TextTabStop {
        position: t.pos,
        align: t.algn.as_deref().map(odraw::TextTabAlignType::from_ooxml),
    }
}

// ===========================================================================
// ParagraphProps
// ===========================================================================

impl From<&odraw::ParagraphProperties> for TextParagraphProps {
    fn from(p: &odraw::ParagraphProperties) -> Self {
        Self {
            mar_l: p.margin_l,
            mar_r: p.margin_r,
            lvl: p.level.map(|l| l.value()),
            indent: p.indent,
            algn: p.align.as_ref().map(|a| a.to_ooxml().to_string()),
            def_tab_sz: p.def_tab_sz,
            rtl: p.rtl,
            ea_ln_brk: p.ea_ln_brk,
            latin_ln_brk: p.latin_ln_brk,
            hanging_punct: p.hanging_punct,
            font_algn: p.font_align.as_ref().map(|a| a.to_ooxml().to_string()),
            ln_spc: p.line_spacing.as_ref().map(spacing_from),
            spc_bef: p.space_before.as_ref().map(spacing_from),
            spc_aft: p.space_after.as_ref().map(spacing_from),
            bullet: p.bullet.as_ref().map(Into::into),
            tab_lst: p
                .tab_list
                .as_ref()
                .map(|ts| ts.iter().map(tab_from).collect())
                .unwrap_or_default(),
            def_r_pr: p
                .def_run_props
                .as_ref()
                .map(|r| Box::new(r.as_ref().into())),
            ext_lst: p.ext_lst.as_ref().and_then(|e| e.raw_xml.clone()),
        }
    }
}

impl From<TextParagraphProps> for odraw::ParagraphProperties {
    fn from(p: TextParagraphProps) -> Self {
        Self {
            align: p.algn.as_deref().map(odraw::TextAlign::from_ooxml),
            margin_l: p.mar_l,
            margin_r: p.mar_r,
            indent: p.indent,
            line_spacing: p.ln_spc.map(spacing_into),
            space_before: p.spc_bef.map(spacing_into),
            space_after: p.spc_aft.map(spacing_into),
            bullet: p.bullet.map(Into::into),
            def_run_props: p.def_r_pr.map(|r| Box::new((*r).into())),
            tab_list: if p.tab_lst.is_empty() {
                None
            } else {
                Some(p.tab_lst.into_iter().map(tab_into).collect())
            },
            level: p.lvl.and_then(odraw::StTextIndentLevelType::new),
            rtl: p.rtl,
            def_tab_sz: p.def_tab_sz,
            ea_ln_brk: p.ea_ln_brk,
            latin_ln_brk: p.latin_ln_brk,
            hanging_punct: p.hanging_punct,
            font_align: p
                .font_algn
                .as_deref()
                .map(odraw::TextFontAlignType::from_ooxml),
            ext_lst: p.ext_lst.map(|raw_xml| odraw::ExtensionList {
                raw_xml: Some(raw_xml),
            }),
        }
    }
}

// ===========================================================================
// BulletProps
// ===========================================================================

impl From<&odraw::BulletProperties> for BulletProps {
    fn from(b: &odraw::BulletProperties) -> Self {
        Self {
            color: b.color.as_ref().map(|c| match c {
                odraw::BulletColor::FollowText => BulletColor::Tx,
                odraw::BulletColor::Custom(dc) => BulletColor::Clr { color: dc.into() },
            }),
            size: b.size.as_ref().map(|s| match s {
                odraw::BulletSize::FollowText => BulletSize::Tx,
                odraw::BulletSize::Percent(v) => BulletSize::Pct { val: *v as i32 },
                odraw::BulletSize::Points(v) => BulletSize::Pts { val: *v as i32 },
            }),
            // OOXML models bullet font as a pair: `font_follows_text: bool`
            // for `<a:buFontTx/>`, otherwise `font: Option<TextFont>` for
            // `<a:buFont>`. Collapse onto our `BulletFont` union.
            font: if b.font_follows_text {
                Some(BulletFont::Tx)
            } else {
                b.font.as_ref().map(|f| BulletFont::Font(font_ref_from(f)))
            },
            variant: b.bullet_type.as_ref().map(|bt| match bt {
                odraw::BulletType::None => BulletVariant::None,
                odraw::BulletType::AutoNum { scheme, start_at } => BulletVariant::AutoNum {
                    auto_type: scheme.to_ooxml().to_string(),
                    start_at: *start_at,
                },
                odraw::BulletType::Char(ch) => BulletVariant::Char { ch: ch.clone() },
                // OOXML `Blip(relId)` is encoded as a pseudo `autoType`
                // named `"blip:<relId>"` — dropped to AutoNum with a
                // reserved scheme token so existing callers round-trip;
                // the raw Blip round-trip is preserved directly on
                // `<a:buBlip>` write path (writer reads from blip field).
                // For this domain mirror we expose Blip as a separate
                // variant via a companion enum in a follow-up.
                odraw::BulletType::Blip(rel_id) => BulletVariant::AutoNum {
                    auto_type: format!("blip:{rel_id}"),
                    start_at: None,
                },
            }),
        }
    }
}

impl From<BulletProps> for odraw::BulletProperties {
    fn from(b: BulletProps) -> Self {
        let (font_follows_text, font) = match b.font {
            Some(BulletFont::Tx) => (true, None),
            Some(BulletFont::Font(tf)) => (false, Some(font_ref_into(tf))),
            None => (false, None),
        };
        Self {
            color: b.color.map(|c| match c {
                BulletColor::Tx => odraw::BulletColor::FollowText,
                BulletColor::Clr { color } => odraw::BulletColor::Custom(color.into()),
            }),
            size: b.size.map(|s| match s {
                BulletSize::Tx => odraw::BulletSize::FollowText,
                BulletSize::Pct { val } => odraw::BulletSize::Percent(val.max(0) as u32),
                BulletSize::Pts { val } => odraw::BulletSize::Points(val.max(0) as u32),
            }),
            font,
            font_follows_text,
            bullet_type: b.variant.map(|v| match v {
                BulletVariant::None => odraw::BulletType::None,
                BulletVariant::AutoNum {
                    auto_type,
                    start_at,
                } => {
                    // Convention: `blip:<relId>` encodes a Blip bullet; any
                    // other string maps to a numbering scheme token.
                    if let Some(rel) = auto_type.strip_prefix("blip:") {
                        odraw::BulletType::Blip(rel.to_string())
                    } else {
                        odraw::BulletType::AutoNum {
                            scheme: odraw::TextAutonumberType::from_ooxml(&auto_type),
                            start_at,
                        }
                    }
                }
                BulletVariant::Char { ch } => odraw::BulletType::Char(ch),
            }),
        }
    }
}

// ===========================================================================
// RunProps
// ===========================================================================

impl From<&odraw::RunProperties> for TextRunProps {
    fn from(r: &odraw::RunProperties) -> Self {
        Self {
            lang: r.lang.clone(),
            alt_lang: r.alt_lang.clone(),
            sz: r.size.map(|s| s.value() as i32),
            b: r.bold,
            i: r.italic,
            u: r.underline.as_ref().map(|u| u.to_ooxml().to_string()),
            strike: r.strike.as_ref().map(|s| s.to_ooxml().to_string()),
            kern: r.kern.map(|k| k.value() as i32),
            cap: r.cap.as_ref().map(|c| c.to_ooxml().to_string()),
            spc: r.spacing.map(|s| s.value()),
            normalize_h: r.normalize_h,
            baseline: r.baseline.map(|v| v.value()),
            no_proof: r.no_proof,
            dirty: r.dirty,
            err: r.err,
            smt_clean: r.smt_clean,
            smt_id: r.smt_id,
            bmk: r.bmk.clone(),
            rtl: r.rtl,
            kumimoji: r.kumimoji,
            color: r.color.as_ref().map(Into::into),
            highlight: r.highlight.as_ref().map(Into::into),
            latin: r.latin.as_ref().map(font_ref_from),
            ea: r.ea.as_ref().map(font_ref_from),
            cs: r.cs.as_ref().map(font_ref_from),
            sym: r.sym.as_ref().map(font_ref_from),
            hlink_click: r.hlink_click.as_ref().map(Into::into),
            hlink_mouse_over: r.hlink_mouse_over.as_ref().map(Into::into),
            // Effects, fill, outline, underline line/fill: preserved
            // via raw-xml fallback until the fill/line audit lands.
            fill_raw_xml: None,
            ln_raw_xml: None,
            effect_lst_raw_xml: None,
            u_ln_raw_xml: None,
            u_fill_raw_xml: None,
            ext_lst: r.ext_lst.as_ref().and_then(|e| e.raw_xml.clone()),
        }
    }
}

impl From<TextRunProps> for odraw::RunProperties {
    fn from(r: TextRunProps) -> Self {
        use odraw::StPercentage;
        Self {
            // StTextFontSize is u32 with range 100..=400000; domain keeps
            // i32 for ergonomics. Clamp negative values to None and round-
            // trip the valid range.
            size: r.sz.and_then(|v| {
                if v < 0 {
                    None
                } else {
                    odraw::StTextFontSize::new(v as u32)
                }
            }),
            bold: r.b,
            italic: r.i,
            underline: r.u.as_deref().map(odraw::TextUnderlineType::from_ooxml),
            strike: r.strike.as_deref().map(odraw::TextStrikeType::from_ooxml),
            latin: r.latin.map(font_ref_into),
            ea: r.ea.map(font_ref_into),
            cs: r.cs.map(font_ref_into),
            sym: r.sym.map(font_ref_into),
            color: r.color.map(Into::into),
            lang: r.lang,
            alt_lang: r.alt_lang,
            kern: r.kern.and_then(|v| {
                if v < 0 {
                    None
                } else {
                    odraw::StTextNonNegativePoint::new(v as u32)
                }
            }),
            cap: r.cap.as_deref().map(odraw::TextCapsType::from_ooxml),
            // StTextPoint is an unconstrained newtype: `new(i32) -> Self`,
            // not `Option`. Use `.map` (not `and_then`).
            spacing: r.spc.map(odraw::StTextPoint::new),
            baseline: r.baseline.map(StPercentage::new),
            highlight: r.highlight.map(Into::into),
            hlink_click: r.hlink_click.map(Into::into),
            hlink_mouse_over: r.hlink_mouse_over.map(Into::into),
            text_fill: None,
            text_outline: None,
            effects: None,
            underline_line: None,
            underline_fill: None,
            kumimoji: r.kumimoji,
            normalize_h: r.normalize_h,
            no_proof: r.no_proof,
            dirty: r.dirty,
            err: r.err,
            smt_clean: r.smt_clean,
            smt_id: r.smt_id,
            bmk: r.bmk,
            rtl: r.rtl,
            ext_lst: r.ext_lst.map(|raw_xml| odraw::ExtensionList {
                raw_xml: Some(raw_xml),
            }),
        }
    }
}

// ===========================================================================
// Paragraph
// ===========================================================================

fn run_content_from(rc: &odraw::TextRunContent) -> ParagraphContent {
    match rc {
        odraw::TextRunContent::Run(r) => ParagraphContent::Run(TextRunData {
            r_pr: Some((&r.props).into()).filter(|p: &TextRunProps| *p != TextRunProps::default()),
            text: r.text.clone(),
        }),
        odraw::TextRunContent::LineBreak { props } => ParagraphContent::Break {
            r_pr: props.as_ref().map(Into::into),
        },
        odraw::TextRunContent::Field {
            id,
            field_type,
            text,
            run_props,
            para_props,
        } => ParagraphContent::Field {
            id: id.clone(),
            field_type: field_type.clone(),
            text: text.clone(),
            r_pr: run_props.as_ref().map(Into::into),
            p_pr: para_props.as_ref().map(Into::into),
        },
    }
}

fn run_content_into(rc: ParagraphContent) -> odraw::TextRunContent {
    match rc {
        ParagraphContent::Run(r) => odraw::TextRunContent::Run(odraw::TextRun {
            text: r.text,
            props: r.r_pr.map(Into::into).unwrap_or_default(),
        }),
        ParagraphContent::Break { r_pr } => odraw::TextRunContent::LineBreak {
            props: r_pr.map(Into::into),
        },
        ParagraphContent::Field {
            id,
            field_type,
            text,
            r_pr,
            p_pr,
        } => odraw::TextRunContent::Field {
            id,
            field_type,
            text,
            run_props: r_pr.map(Into::into),
            para_props: p_pr.map(Into::into),
        },
    }
}

impl From<&odraw::Paragraph> for TextParagraph {
    fn from(p: &odraw::Paragraph) -> Self {
        let empty_props = odraw::ParagraphProperties::default();
        Self {
            p_pr: (p.props != empty_props).then(|| (&p.props).into()),
            content: p.runs.iter().map(run_content_from).collect(),
            end_para_r_pr: p.end_para_rpr.as_ref().map(Into::into),
        }
    }
}

impl From<TextParagraph> for odraw::Paragraph {
    fn from(p: TextParagraph) -> Self {
        Self {
            props: p.p_pr.map(Into::into).unwrap_or_default(),
            runs: p.content.into_iter().map(run_content_into).collect(),
            end_para_rpr: p.end_para_r_pr.map(Into::into),
        }
    }
}

// ===========================================================================
// TextListStyle
// ===========================================================================

impl From<&odraw::TextListStyle> for TextListStyle {
    fn from(l: &odraw::TextListStyle) -> Self {
        let lvl = |i: usize| l.level_ppr.get(i).and_then(|o| o.as_ref()).map(Into::into);
        Self {
            def_ppr: l.def_ppr.as_ref().map(Into::into),
            lvl1_ppr: lvl(0),
            lvl2_ppr: lvl(1),
            lvl3_ppr: lvl(2),
            lvl4_ppr: lvl(3),
            lvl5_ppr: lvl(4),
            lvl6_ppr: lvl(5),
            lvl7_ppr: lvl(6),
            lvl8_ppr: lvl(7),
            lvl9_ppr: lvl(8),
        }
    }
}

impl From<TextListStyle> for odraw::TextListStyle {
    fn from(l: TextListStyle) -> Self {
        let level_ppr: [Option<odraw::ParagraphProperties>; 9] = [
            l.lvl1_ppr.map(Into::into),
            l.lvl2_ppr.map(Into::into),
            l.lvl3_ppr.map(Into::into),
            l.lvl4_ppr.map(Into::into),
            l.lvl5_ppr.map(Into::into),
            l.lvl6_ppr.map(Into::into),
            l.lvl7_ppr.map(Into::into),
            l.lvl8_ppr.map(Into::into),
            l.lvl9_ppr.map(Into::into),
        ];
        Self {
            def_ppr: l.def_ppr.map(Into::into),
            level_ppr,
        }
    }
}

// ===========================================================================
// TextBodyProps
// ===========================================================================

fn autofit_from(a: &odraw::TextAutofit) -> TextAutofit {
    match a {
        odraw::TextAutofit::NoAutofit => TextAutofit::NoAutofit,
        odraw::TextAutofit::NormalAutofit {
            font_scale,
            line_space_reduction,
        } => TextAutofit::NormAutofit {
            font_scale: font_scale.map(|v| v as i32),
            ln_spc_reduction: line_space_reduction.map(|v| v as i32),
        },
        odraw::TextAutofit::ShapeAutofit => TextAutofit::SpAutoFit,
    }
}

fn autofit_into(a: TextAutofit) -> odraw::TextAutofit {
    match a {
        TextAutofit::NoAutofit => odraw::TextAutofit::NoAutofit,
        TextAutofit::NormAutofit {
            font_scale,
            ln_spc_reduction,
        } => odraw::TextAutofit::NormalAutofit {
            font_scale: font_scale.map(|v| v.max(0) as u32),
            line_space_reduction: ln_spc_reduction.map(|v| v.max(0) as u32),
        },
        TextAutofit::SpAutoFit => odraw::TextAutofit::ShapeAutofit,
    }
}

impl From<&odraw::PresetTextWarp> for PresetTextWarp {
    fn from(p: &odraw::PresetTextWarp) -> Self {
        Self {
            preset: p.preset.to_ooxml().to_string(),
            adjust_values: p
                .adjust_values
                .iter()
                .map(|g| GeomGuide {
                    name: g.name.clone(),
                    fmla: g.fmla.clone(),
                })
                .collect(),
        }
    }
}

impl From<PresetTextWarp> for odraw::PresetTextWarp {
    fn from(p: PresetTextWarp) -> Self {
        Self {
            preset: odraw::TextWarpPreset::from_ooxml(&p.preset)
                .unwrap_or(odraw::TextWarpPreset::TextNoShape),
            adjust_values: p
                .adjust_values
                .into_iter()
                .map(|g| odraw::GeomGuide {
                    name: g.name,
                    fmla: g.fmla,
                })
                .collect(),
        }
    }
}

impl From<&odraw::TextBodyProperties> for TextBodyProps {
    fn from(b: &odraw::TextBodyProperties) -> Self {
        Self {
            rot: b.rot.map(|a| a.value()),
            anchor: b.anchor.as_ref().map(|a| a.to_ooxml().to_string()),
            anchor_ctr: b.anchor_ctr,
            wrap: b.wrap.as_ref().map(|w| w.to_ooxml().to_string()),
            l_ins: b.l_ins,
            t_ins: b.t_ins,
            r_ins: b.r_ins,
            b_ins: b.b_ins,
            num_col: b.num_col,
            spc_col: b.spc_col,
            rtl_col: b.rtl_col,
            spc_first_last_para: b.spc_first_last_para,
            vert: b.vert.as_ref().map(|v| v.to_ooxml().to_string()),
            vert_overflow: b.vert_overflow.as_ref().map(|v| v.to_ooxml().to_string()),
            horz_overflow: b.horz_overflow.as_ref().map(|v| v.to_ooxml().to_string()),
            upright: b.upright,
            compat_ln_spc: b.compat_ln_spc,
            force_aa: b.force_aa,
            from_word_art: b.from_word_art,
            autofit: b.autofit.as_ref().map(autofit_from),
            prst_tx_warp: b.prst_tx_warp.as_ref().map(Into::into),
            scene3d: b.scene3d.as_ref().map(SceneSettings::from),
            sp3d: b.sp3d.as_ref().map(Shape3DSettings::from),
            flat_tx_z: b.flat_tx.and_then(|f| f.z.map(|c| c.value())),
            ext_lst: b.ext_lst.as_ref().and_then(|e| e.raw_xml.clone()),
        }
    }
}

impl From<TextBodyProps> for odraw::TextBodyProperties {
    fn from(b: TextBodyProps) -> Self {
        Self {
            rot: b.rot.map(odraw::StAngle::new),
            anchor: b.anchor.as_deref().map(odraw::TextAnchor::from_ooxml),
            wrap: b.wrap.as_deref().map(odraw::TextWrap::from_ooxml),
            l_ins: b.l_ins,
            t_ins: b.t_ins,
            r_ins: b.r_ins,
            b_ins: b.b_ins,
            vert: b.vert.as_deref().map(odraw::TextVerticalType::from_ooxml),
            vert_overflow: b
                .vert_overflow
                .as_deref()
                .map(odraw::TextVertOverflow::from_ooxml),
            horz_overflow: b
                .horz_overflow
                .as_deref()
                .map(odraw::TextHorzOverflow::from_ooxml),
            anchor_ctr: b.anchor_ctr,
            rtl_col: b.rtl_col,
            spc_first_last_para: b.spc_first_last_para,
            num_col: b.num_col,
            spc_col: b.spc_col,
            upright: b.upright,
            compat_ln_spc: b.compat_ln_spc,
            force_aa: b.force_aa,
            from_word_art: b.from_word_art,
            autofit: b.autofit.map(autofit_into),
            ext_lst: b.ext_lst.map(|raw_xml| odraw::ExtensionList {
                raw_xml: Some(raw_xml),
            }),
            prst_tx_warp: b.prst_tx_warp.map(Into::into),
            scene3d: b.scene3d.map(Into::into),
            sp3d: b.sp3d.map(Into::into),
            flat_tx: b.flat_tx_z.map(|z| odraw::FlatText {
                z: Some(odraw::StCoordinate::new(z)),
            }),
        }
    }
}

// ===========================================================================
// TextBody root
// ===========================================================================

impl From<&odraw::TextBody> for TextBody {
    fn from(t: &odraw::TextBody) -> Self {
        Self {
            body_pr: (&t.body_props).into(),
            lst_style: t.list_style.as_ref().map(Into::into),
            paragraphs: t.paragraphs.iter().map(Into::into).collect(),
        }
    }
}

impl From<TextBody> for odraw::TextBody {
    fn from(t: TextBody) -> Self {
        Self {
            body_props: t.body_pr.into(),
            list_style: t.lst_style.map(Into::into),
            paragraphs: t.paragraphs.into_iter().map(Into::into).collect(),
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_round_trip() {
        let original = odraw::TextBody::default();
        let dom: TextBody = (&original).into();
        let round: odraw::TextBody = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn body_props_round_trip_full() {
        let original = odraw::TextBodyProperties {
            rot: Some(odraw::StAngle::new(5_400_000)),
            anchor: Some(odraw::TextAnchor::Center),
            wrap: Some(odraw::TextWrap::Square),
            l_ins: Some(91440),
            t_ins: Some(45720),
            r_ins: Some(91440),
            b_ins: Some(45720),
            vert: Some(odraw::TextVerticalType::Horizontal),
            anchor_ctr: Some(true),
            spc_first_last_para: Some(true),
            num_col: Some(2),
            spc_col: Some(12700),
            upright: Some(false),
            compat_ln_spc: Some(true),
            force_aa: Some(false),
            from_word_art: Some(true),
            autofit: Some(odraw::TextAutofit::NormalAutofit {
                font_scale: Some(90_000),
                line_space_reduction: Some(20_000),
            }),
            ..Default::default()
        };
        let dom: TextBodyProps = (&original).into();
        let round: odraw::TextBodyProperties = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn paragraph_round_trip_with_runs() {
        let original = odraw::Paragraph {
            props: odraw::ParagraphProperties {
                align: Some(odraw::TextAlign::Center),
                level: odraw::StTextIndentLevelType::new(1),
                margin_l: Some(228_600),
                ..Default::default()
            },
            runs: vec![
                odraw::TextRunContent::Run(odraw::TextRun {
                    text: "Hello ".into(),
                    props: odraw::RunProperties {
                        size: odraw::StTextFontSize::new(1400),
                        bold: Some(true),
                        italic: Some(false),
                        lang: Some("en-US".into()),
                        latin: Some(odraw::TextFont {
                            typeface: "Calibri".into(),
                            panose: None,
                            pitch_family: Some(odraw::StPitchFamily::new(34)),
                            charset: Some(0),
                        }),
                        ..Default::default()
                    },
                }),
                odraw::TextRunContent::LineBreak { props: None },
                odraw::TextRunContent::Run(odraw::TextRun {
                    text: "world".into(),
                    props: odraw::RunProperties {
                        underline: Some(odraw::TextUnderlineType::Single),
                        ..Default::default()
                    },
                }),
            ],
            end_para_rpr: Some(odraw::RunProperties {
                lang: Some("en-US".into()),
                dirty: Some(false),
                ..Default::default()
            }),
        };
        let dom: TextParagraph = (&original).into();
        let round: odraw::Paragraph = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn list_style_level_mapping_round_trip() {
        let original = odraw::TextListStyle {
            def_ppr: Some(odraw::ParagraphProperties {
                align: Some(odraw::TextAlign::Left),
                ..Default::default()
            }),
            level_ppr: [
                Some(odraw::ParagraphProperties {
                    margin_l: Some(100_000),
                    ..Default::default()
                }),
                None,
                Some(odraw::ParagraphProperties {
                    margin_l: Some(300_000),
                    ..Default::default()
                }),
                None,
                None,
                None,
                None,
                None,
                Some(odraw::ParagraphProperties {
                    margin_l: Some(900_000),
                    ..Default::default()
                }),
            ],
        };
        let dom: TextListStyle = (&original).into();
        let round: odraw::TextListStyle = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn field_paragraph_content_round_trip() {
        let original = odraw::Paragraph {
            props: odraw::ParagraphProperties::default(),
            runs: vec![odraw::TextRunContent::Field {
                id: "{11111111-2222-3333-4444-555555555555}".into(),
                field_type: Some("slidenum".into()),
                text: Some("4".into()),
                run_props: Some(odraw::RunProperties {
                    lang: Some("en-US".into()),
                    ..Default::default()
                }),
                para_props: None,
            }],
            end_para_rpr: None,
        };
        let dom: TextParagraph = (&original).into();
        let round: odraw::Paragraph = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn bullet_round_trip_char() {
        let original = odraw::BulletProperties {
            color: Some(odraw::BulletColor::Custom(odraw::DrawingColor::SrgbClr {
                val: "FF0000".into(),
                transforms: vec![],
            })),
            size: Some(odraw::BulletSize::Percent(75_000)),
            font: None,
            font_follows_text: true,
            bullet_type: Some(odraw::BulletType::Char("•".into())),
        };
        let dom: BulletProps = (&original).into();
        let round: odraw::BulletProperties = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn bullet_round_trip_autonum() {
        let original = odraw::BulletProperties {
            color: Some(odraw::BulletColor::FollowText),
            size: Some(odraw::BulletSize::FollowText),
            font: Some(odraw::TextFont {
                typeface: "Arial".into(),
                panose: None,
                pitch_family: None,
                charset: None,
            }),
            font_follows_text: false,
            bullet_type: Some(odraw::BulletType::AutoNum {
                scheme: odraw::TextAutonumberType::ArabicPeriod,
                start_at: Some(3),
            }),
        };
        let dom: BulletProps = (&original).into();
        let round: odraw::BulletProperties = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn run_props_preserves_font_references() {
        let original = odraw::RunProperties {
            size: odraw::StTextFontSize::new(1100),
            bold: Some(true),
            italic: Some(true),
            latin: Some(odraw::TextFont {
                typeface: "Calibri".into(),
                panose: Some("020F0502020204030204".into()),
                pitch_family: Some(odraw::StPitchFamily::new(34)),
                charset: Some(0),
            }),
            ea: Some(odraw::TextFont {
                typeface: "宋体".into(),
                ..Default::default()
            }),
            color: Some(odraw::DrawingColor::SchemeClr {
                val: odraw::SchemeColor::Accent1,
                transforms: vec![],
            }),
            lang: Some("en-US".into()),
            alt_lang: Some("zh-CN".into()),
            dirty: Some(false),
            ..Default::default()
        };
        let dom: TextRunProps = (&original).into();
        let round: odraw::RunProperties = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn full_text_body_round_trip() {
        let original = odraw::TextBody {
            body_props: odraw::TextBodyProperties {
                anchor: Some(odraw::TextAnchor::Center),
                wrap: Some(odraw::TextWrap::Square),
                autofit: Some(odraw::TextAutofit::ShapeAutofit),
                ..Default::default()
            },
            list_style: Some(odraw::TextListStyle {
                def_ppr: Some(odraw::ParagraphProperties::default()),
                ..Default::default()
            }),
            paragraphs: vec![odraw::Paragraph {
                props: odraw::ParagraphProperties {
                    align: Some(odraw::TextAlign::Left),
                    ..Default::default()
                },
                runs: vec![odraw::TextRunContent::Run(odraw::TextRun {
                    text: "Hi".into(),
                    props: odraw::RunProperties {
                        size: odraw::StTextFontSize::new(1100),
                        ..Default::default()
                    },
                })],
                end_para_rpr: None,
            }],
        };
        let dom: TextBody = (&original).into();
        let round: odraw::TextBody = dom.into();
        assert_eq!(original, round);
    }
}
