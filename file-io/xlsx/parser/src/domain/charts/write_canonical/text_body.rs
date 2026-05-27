use crate::write::xml_writer::XmlWriter;

use ooxml_types::charts::TextBody;
use ooxml_types::drawings::{
    DrawingFill, Paragraph, RunProperties, TextBodyProperties, TextListStyle, TextRunContent,
    TextSpacing,
};

use super::shape_props::{
    emit_drawing_color, emit_effect_properties, emit_fill, emit_line_dash, emit_line_fill,
    emit_outline,
};
use super::util::write_raw_xml_if_relationship_safe;

pub(crate) fn emit_text_body(w: &mut XmlWriter, tb: &TextBody, tag: &str) {
    w.start_element(tag).end_attrs();

    // bodyPr
    emit_body_props(w, &tb.body_props);

    // lstStyle — only emit if actually present in the original
    if let Some(ref ls) = tb.list_style {
        emit_list_style(w, ls);
    }

    // paragraphs
    for para in &tb.paragraphs {
        emit_paragraph(w, para);
    }

    w.end_element(tag);
}

fn emit_body_props(w: &mut XmlWriter, bp: &TextBodyProperties) {
    w.start_element("a:bodyPr");
    if let Some(rot) = bp.rot {
        w.attr_num("rot", rot.value());
    }
    if let Some(spc) = bp.spc_first_last_para {
        w.attr("spcFirstLastPara", if spc { "1" } else { "0" });
    }
    if let Some(ref vo) = bp.vert_overflow {
        w.attr("vertOverflow", vo.to_ooxml());
    }
    if let Some(ref ho) = bp.horz_overflow {
        w.attr("horzOverflow", ho.to_ooxml());
    }
    if let Some(ref vert) = bp.vert {
        w.attr("vert", vert.to_ooxml());
    }
    if let Some(ref wrap) = bp.wrap {
        w.attr("wrap", wrap.to_ooxml());
    }
    if let Some(l) = bp.l_ins {
        w.attr_num("lIns", l);
    }
    if let Some(t) = bp.t_ins {
        w.attr_num("tIns", t);
    }
    if let Some(r) = bp.r_ins {
        w.attr_num("rIns", r);
    }
    if let Some(b) = bp.b_ins {
        w.attr_num("bIns", b);
    }
    if let Some(nc) = bp.num_col {
        w.attr_num("numCol", nc);
    }
    if let Some(sc) = bp.spc_col {
        w.attr_num("spcCol", sc);
    }
    if let Some(rtl) = bp.rtl_col {
        w.attr("rtlCol", if rtl { "1" } else { "0" });
    }
    if let Some(fwa) = bp.from_word_art {
        w.attr("fromWordArt", if fwa { "1" } else { "0" });
    }
    if let Some(ref anchor) = bp.anchor {
        w.attr("anchor", anchor.to_ooxml());
    }
    if let Some(ac) = bp.anchor_ctr {
        w.attr("anchorCtr", if ac { "1" } else { "0" });
    }
    if let Some(faa) = bp.force_aa {
        w.attr("forceAA", if faa { "1" } else { "0" });
    }
    if let Some(up) = bp.upright {
        w.attr("upright", if up { "1" } else { "0" });
    }
    if let Some(cls) = bp.compat_ln_spc {
        w.attr("compatLnSpc", if cls { "1" } else { "0" });
    }

    let has_children = bp.autofit.is_some() || bp.prst_tx_warp.is_some() || bp.ext_lst.is_some();
    if has_children {
        w.end_attrs();

        // prstTxWarp
        if let Some(ref warp) = bp.prst_tx_warp {
            w.start_element("a:prstTxWarp")
                .attr("prst", warp.preset.to_ooxml());
            if warp.adjust_values.is_empty() {
                w.self_close();
            } else {
                w.end_attrs();
                w.start_element("a:avLst").end_attrs();
                for gd in &warp.adjust_values {
                    w.start_element("a:gd")
                        .attr("name", &gd.name)
                        .attr("fmla", &gd.fmla)
                        .self_close();
                }
                w.end_element("a:avLst");
                w.end_element("a:prstTxWarp");
            }
        }

        // autofit
        if let Some(ref autofit) = bp.autofit {
            emit_autofit(w, autofit);
        }

        // extLst
        if let Some(ref ext) = bp.ext_lst {
            emit_drawing_ext_lst(w, ext);
        }

        w.end_element("a:bodyPr");
    } else {
        w.self_close();
    }
}

fn emit_autofit(w: &mut XmlWriter, autofit: &ooxml_types::drawings::TextAutofit) {
    use ooxml_types::drawings::TextAutofit;
    match autofit {
        TextAutofit::NoAutofit => {
            w.start_element("a:noAutofit").self_close();
        }
        TextAutofit::NormalAutofit {
            font_scale,
            line_space_reduction,
        } => {
            w.start_element("a:normAutofit");
            if let Some(fs) = font_scale {
                w.attr_num("fontScale", *fs);
            }
            if let Some(lsr) = line_space_reduction {
                w.attr_num("lnSpcReduction", *lsr);
            }
            w.self_close();
        }
        TextAutofit::ShapeAutofit => {
            w.start_element("a:spAutoFit").self_close();
        }
    }
}

fn emit_drawing_ext_lst(w: &mut XmlWriter, ext: &ooxml_types::drawings::ExtensionList) {
    if let Some(ref raw) = ext.raw_xml {
        w.start_element("a:extLst").end_attrs();
        write_raw_xml_if_relationship_safe(w, raw);
        w.end_element("a:extLst");
    }
}

fn emit_list_style(w: &mut XmlWriter, ls: &TextListStyle) {
    // Check if the list style has any content
    let has_content = ls.def_ppr.is_some() || ls.level_ppr.iter().any(|l| l.is_some());

    if !has_content {
        w.start_element("a:lstStyle").self_close();
        return;
    }

    w.start_element("a:lstStyle").end_attrs();

    if let Some(ref def) = ls.def_ppr {
        w.start_element("a:defPPr").end_attrs();
        emit_paragraph_props_children(w, def);
        w.end_element("a:defPPr");
    }

    let level_tags = [
        "a:lvl1pPr",
        "a:lvl2pPr",
        "a:lvl3pPr",
        "a:lvl4pPr",
        "a:lvl5pPr",
        "a:lvl6pPr",
        "a:lvl7pPr",
        "a:lvl8pPr",
        "a:lvl9pPr",
    ];
    for (i, tag) in level_tags.iter().enumerate() {
        if let Some(ref ppr) = ls.level_ppr[i] {
            w.start_element(tag);
            emit_paragraph_props_attrs(w, ppr);
            w.end_attrs();
            emit_paragraph_props_children(w, ppr);
            w.end_element(tag);
        }
    }

    w.end_element("a:lstStyle");
}

fn emit_paragraph(w: &mut XmlWriter, para: &Paragraph) {
    w.start_element("a:p").end_attrs();

    let ppr = &para.props;
    let has_ppr = ppr.align.is_some()
        || ppr.margin_l.is_some()
        || ppr.margin_r.is_some()
        || ppr.indent.is_some()
        || ppr.level.is_some()
        || ppr.def_tab_sz.is_some()
        || ppr.rtl.is_some()
        || ppr.ea_ln_brk.is_some()
        || ppr.font_align.is_some()
        || ppr.latin_ln_brk.is_some()
        || ppr.hanging_punct.is_some()
        || ppr.line_spacing.is_some()
        || ppr.space_before.is_some()
        || ppr.space_after.is_some()
        || ppr.bullet.is_some()
        || ppr.def_run_props.is_some()
        || ppr.tab_list.is_some()
        || ppr.ext_lst.is_some();

    if has_ppr {
        w.start_element("a:pPr");
        emit_paragraph_props_attrs(w, ppr);
        w.end_attrs();
        emit_paragraph_props_children(w, ppr);
        w.end_element("a:pPr");
    }

    for run_content in &para.runs {
        match run_content {
            TextRunContent::Run(run) => {
                w.start_element("a:r").end_attrs();
                emit_run_properties(w, "a:rPr", &run.props);
                w.element_with_text("a:t", &run.text);
                w.end_element("a:r");
            }
            TextRunContent::LineBreak { props } => {
                if let Some(rpr) = props {
                    w.start_element("a:br").end_attrs();
                    emit_run_properties(w, "a:rPr", rpr);
                    w.end_element("a:br");
                } else {
                    w.start_element("a:br").self_close();
                }
            }
            TextRunContent::Field {
                id,
                field_type,
                text,
                run_props,
                ..
            } => {
                w.start_element("a:fld").attr("id", id);
                if let Some(ft) = field_type {
                    w.attr("type", ft);
                }
                w.end_attrs();
                if let Some(rpr) = run_props {
                    emit_run_properties(w, "a:rPr", rpr);
                }
                if let Some(t) = text {
                    w.element_with_text("a:t", t);
                }
                w.end_element("a:fld");
            }
        }
    }

    if let Some(ref end_rpr) = para.end_para_rpr {
        emit_run_properties(w, "a:endParaRPr", end_rpr);
    }

    w.end_element("a:p");
}

fn emit_paragraph_props_attrs(w: &mut XmlWriter, ppr: &ooxml_types::drawings::ParagraphProperties) {
    if let Some(ml) = ppr.margin_l {
        w.attr_num("marL", ml);
    }
    if let Some(mr) = ppr.margin_r {
        w.attr_num("marR", mr);
    }
    if let Some(lvl) = ppr.level {
        w.attr_num("lvl", lvl.value());
    }
    if let Some(indent) = ppr.indent {
        w.attr_num("indent", indent);
    }
    if let Some(ref algn) = ppr.align {
        w.attr("algn", algn.to_ooxml());
    }
    if let Some(dts) = ppr.def_tab_sz {
        w.attr_num("defTabSz", dts);
    }
    if let Some(rtl) = ppr.rtl {
        w.attr("rtl", if rtl { "1" } else { "0" });
    }
    if let Some(ea) = ppr.ea_ln_brk {
        w.attr("eaLnBrk", if ea { "1" } else { "0" });
    }
    if let Some(ref fa) = ppr.font_align {
        w.attr("fontAlgn", fa.to_ooxml());
    }
    if let Some(llb) = ppr.latin_ln_brk {
        w.attr("latinLnBrk", if llb { "1" } else { "0" });
    }
    if let Some(hp) = ppr.hanging_punct {
        w.attr("hangingPunct", if hp { "1" } else { "0" });
    }
}

fn emit_paragraph_props_children(
    w: &mut XmlWriter,
    ppr: &ooxml_types::drawings::ParagraphProperties,
) {
    if let Some(ref sp) = ppr.line_spacing {
        emit_text_spacing(w, "a:lnSpc", sp);
    }
    if let Some(ref sp) = ppr.space_before {
        emit_text_spacing(w, "a:spcBef", sp);
    }
    if let Some(ref sp) = ppr.space_after {
        emit_text_spacing(w, "a:spcAft", sp);
    }
    if let Some(ref bullet) = ppr.bullet {
        emit_bullet_properties(w, bullet);
    }
    if let Some(ref tabs) = ppr.tab_list {
        if tabs.is_empty() {
            w.start_element("a:tabLst").self_close();
        } else {
            w.start_element("a:tabLst").end_attrs();
            for tab in tabs {
                w.start_element("a:tab");
                if let Some(pos) = tab.position {
                    w.attr_num("pos", pos);
                }
                if let Some(ref algn) = tab.align {
                    w.attr("algn", algn.to_ooxml());
                }
                w.self_close();
            }
            w.end_element("a:tabLst");
        }
    }
    if let Some(ref drp) = ppr.def_run_props {
        emit_run_properties(w, "a:defRPr", drp);
    }
    if let Some(ref ext) = ppr.ext_lst {
        emit_drawing_ext_lst(w, ext);
    }
}

fn emit_text_spacing(w: &mut XmlWriter, wrapper_tag: &str, spacing: &TextSpacing) {
    w.start_element(wrapper_tag).end_attrs();
    match spacing {
        TextSpacing::Percent(val) => {
            w.start_element("a:spcPct")
                .attr_num("val", *val)
                .self_close();
        }
        TextSpacing::Points(val) => {
            w.start_element("a:spcPts")
                .attr_num("val", *val)
                .self_close();
        }
    }
    w.end_element(wrapper_tag);
}

fn emit_bullet_properties(w: &mut XmlWriter, bullet: &ooxml_types::drawings::BulletProperties) {
    use ooxml_types::drawings::{BulletColor, BulletSize, BulletType};

    if let Some(ref bc) = bullet.color {
        match bc {
            BulletColor::FollowText => {
                w.start_element("a:buClrTx").self_close();
            }
            BulletColor::Custom(color) => {
                w.start_element("a:buClr").end_attrs();
                emit_drawing_color(w, color);
                w.end_element("a:buClr");
            }
        }
    }
    if let Some(ref bs) = bullet.size {
        match bs {
            BulletSize::FollowText => {
                w.start_element("a:buSzTx").self_close();
            }
            BulletSize::Percent(val) => {
                w.start_element("a:buSzPct")
                    .attr_num("val", *val)
                    .self_close();
            }
            BulletSize::Points(val) => {
                w.start_element("a:buSzPts")
                    .attr_num("val", *val)
                    .self_close();
            }
        }
    }
    if let Some(ref font) = bullet.font {
        emit_text_font(w, "a:buFont", font);
    }
    if let Some(ref bt) = bullet.bullet_type {
        match bt {
            BulletType::None => {
                w.start_element("a:buNone").self_close();
            }
            BulletType::Char(ch) => {
                w.start_element("a:buChar").attr("char", ch).self_close();
            }
            BulletType::AutoNum { scheme, start_at } => {
                w.start_element("a:buAutoNum")
                    .attr("type", scheme.to_ooxml());
                if let Some(sa) = start_at {
                    w.attr_num("startAt", *sa);
                }
                w.self_close();
            }
            BulletType::Blip(_) => {
                // Bullet images require chart-owned relationships; omit until
                // those relationship IDs are resolved by the package graph.
            }
        }
    }
}

fn emit_run_properties(w: &mut XmlWriter, tag: &str, rp: &RunProperties) {
    w.start_element(tag);

    // Attributes
    if let Some(kumi) = rp.kumimoji {
        w.attr("kumimoji", if kumi { "1" } else { "0" });
    }
    if let Some(ref lang) = rp.lang {
        w.attr("lang", lang);
    }
    if let Some(ref alt_lang) = rp.alt_lang {
        w.attr("altLang", alt_lang);
    }
    if let Some(sz) = rp.size {
        w.attr_num("sz", sz.value());
    }
    if let Some(b) = rp.bold {
        w.attr("b", if b { "1" } else { "0" });
    }
    if let Some(i) = rp.italic {
        w.attr("i", if i { "1" } else { "0" });
    }
    if let Some(ref u) = rp.underline {
        w.attr("u", u.to_ooxml());
    }
    if let Some(ref strike) = rp.strike {
        w.attr("strike", strike.to_ooxml());
    }
    if let Some(kern) = rp.kern {
        w.attr_num("kern", kern.value());
    }
    if let Some(ref cap) = rp.cap {
        w.attr("cap", cap.to_ooxml());
    }
    if let Some(spc) = rp.spacing {
        w.attr_num("spc", spc.value());
    }
    if let Some(nh) = rp.normalize_h {
        w.attr("normalizeH", if nh { "1" } else { "0" });
    }
    if let Some(bl) = rp.baseline {
        w.attr_num("baseline", bl.value());
    }
    if let Some(np) = rp.no_proof {
        w.attr("noProof", if np { "1" } else { "0" });
    }
    if let Some(d) = rp.dirty {
        w.attr("dirty", if d { "1" } else { "0" });
    }
    if let Some(e) = rp.err {
        w.attr("err", if e { "1" } else { "0" });
    }
    if let Some(sc) = rp.smt_clean {
        w.attr("smtClean", if sc { "1" } else { "0" });
    }
    if let Some(si) = rp.smt_id {
        w.attr_num("smtId", si);
    }
    if let Some(ref bmk) = rp.bmk {
        w.attr("bmk", bmk);
    }

    let has_children = rp.text_outline.is_some()
        || rp.text_fill.is_some()
        || rp.effects.is_some()
        || rp.highlight.is_some()
        || rp.underline_line.is_some()
        || rp.underline_fill.is_some()
        || rp.latin.is_some()
        || rp.ea.is_some()
        || rp.cs.is_some()
        || rp.sym.is_some()
        || rp.hlink_click.is_some()
        || rp.hlink_mouse_over.is_some()
        || rp.color.is_some()
        || rp.rtl.is_some()
        || rp.ext_lst.is_some();

    if !has_children {
        w.self_close();
        return;
    }
    w.end_attrs();

    // text outline
    if let Some(ref ln) = rp.text_outline {
        emit_outline(w, ln);
    }

    // text fill
    if let Some(ref fill) = rp.text_fill {
        emit_fill(w, fill);
    }

    // effects (effectLst / effectDag)
    if let Some(ref effects) = rp.effects {
        emit_effect_properties(w, effects);
    }

    // highlight
    if let Some(ref hl) = rp.highlight {
        w.start_element("a:highlight").end_attrs();
        emit_drawing_color(w, hl);
        w.end_element("a:highlight");
    }

    // underline line
    if let Some(ref ul) = rp.underline_line {
        use ooxml_types::drawings::UnderlineLine;
        match ul {
            UnderlineLine::FollowText => {
                w.start_element("a:uLnTx").self_close();
            }
            UnderlineLine::Custom(outline) => {
                w.start_element("a:uLn");
                if let Some(width) = outline.width {
                    w.attr_num("w", width);
                }
                if let Some(ref cap) = outline.cap {
                    w.attr("cap", cap.to_ooxml());
                }
                if let Some(ref compound) = outline.compound {
                    w.attr("cmpd", compound.to_ooxml());
                }
                w.end_attrs();
                if let Some(ref fill) = outline.fill {
                    emit_line_fill(w, fill);
                }
                if let Some(ref dash) = outline.dash {
                    emit_line_dash(w, dash);
                }
                w.end_element("a:uLn");
            }
        }
    }

    // underline fill
    if let Some(ref uf) = rp.underline_fill {
        use ooxml_types::drawings::UnderlineFill;
        match uf {
            UnderlineFill::FollowText => {
                w.start_element("a:uFillTx").self_close();
            }
            UnderlineFill::Custom(fill) => {
                w.start_element("a:uFill").end_attrs();
                emit_fill(w, fill);
                w.end_element("a:uFill");
            }
        }
    }

    // solid fill for text colour — skip if text_fill already emitted a solidFill
    // to avoid duplicating the same <a:solidFill> element.
    let text_fill_is_solid = matches!(&rp.text_fill, Some(DrawingFill::Solid(_)));
    if !text_fill_is_solid {
        if let Some(ref color) = rp.color {
            w.start_element("a:solidFill").end_attrs();
            emit_drawing_color(w, color);
            w.end_element("a:solidFill");
        }
    }

    // fonts
    if let Some(ref f) = rp.latin {
        emit_text_font(w, "a:latin", f);
    }
    if let Some(ref f) = rp.ea {
        emit_text_font(w, "a:ea", f);
    }
    if let Some(ref f) = rp.cs {
        emit_text_font(w, "a:cs", f);
    }
    if let Some(ref f) = rp.sym {
        emit_text_font(w, "a:sym", f);
    }

    // hyperlinks
    if let Some(ref hlink) = rp.hlink_click {
        emit_hyperlink(w, "a:hlinkClick", hlink);
    }
    if let Some(ref hlink) = rp.hlink_mouse_over {
        emit_hyperlink(w, "a:hlinkMouseOver", hlink);
    }

    // rtl
    if let Some(rtl) = rp.rtl {
        w.start_element("a:rtl")
            .attr("val", if rtl { "1" } else { "0" })
            .self_close();
    }

    // extLst
    if let Some(ref ext) = rp.ext_lst {
        emit_drawing_ext_lst(w, ext);
    }

    w.end_element(tag);
}

fn emit_text_font(w: &mut XmlWriter, tag: &str, font: &ooxml_types::drawings::TextFont) {
    w.start_element(tag).attr("typeface", &font.typeface);
    // Theme references (typeface starting with '+', e.g. "+mn-ea", "+mn-lt")
    // must be written with only the typeface attribute — concrete font
    // properties (panose, pitchFamily, charset) are theme-resolved values
    // that should not appear alongside theme references.
    if !font.typeface.starts_with('+') {
        if let Some(ref p) = font.panose {
            w.attr("panose", p);
        }
        if let Some(pf) = font.pitch_family {
            w.attr_num("pitchFamily", pf.value());
        }
        if let Some(cs) = font.charset {
            w.attr_num("charset", cs);
        }
    }
    w.self_close();
}

fn emit_hyperlink(w: &mut XmlWriter, tag: &str, hlink: &ooxml_types::drawings::Hyperlink) {
    w.start_element(tag);
    // DrawingML hyperlink r:ids require chart-owned relationships; preserve
    // non-relationship metadata only until chart rel registration exists.
    if let Some(ref action) = hlink.action {
        w.attr("action", action);
    }
    if let Some(ref tooltip) = hlink.tooltip {
        w.attr("tooltip", tooltip);
    }
    if let Some(ref tgt_frame) = hlink.tgt_frame {
        w.attr("tgtFrame", tgt_frame);
    }
    if let Some(ref invalid_url) = hlink.invalid_url {
        w.attr("invalidUrl", invalid_url);
    }
    if let Some(false) = hlink.history {
        w.attr("history", "0");
    }
    if let Some(true) = hlink.highlight_click {
        w.attr("highlightClick", "1");
    }
    if let Some(true) = hlink.end_snd {
        w.attr("endSnd", "1");
    }
    if let Some(ref ext) = hlink.ext_lst {
        w.end_attrs();
        write_raw_xml_if_relationship_safe(w, ext);
        w.end_element(tag);
    } else {
        w.self_close();
    }
}
