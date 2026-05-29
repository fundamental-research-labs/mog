//! Text body and rich text serialization for DrawingML XML.
//!
//! Handles paragraphs, run properties, bullet formatting, text spacing,
//! body properties, list styles, and autofit settings.

use crate::write::xml_writer::XmlWriter;

use ooxml_types::drawings::{LineDash, LineFill};

use super::super::types::{
    BulletColor, BulletProperties, BulletSize, BulletType, ExtensionList, Hyperlink, Paragraph,
    ParagraphProperties, RunProperties, TextAutofit, TextBody, TextBodyProperties, TextFont,
    TextListStyle, TextRun, TextRunContent, TextSpacing, UnderlineFill, UnderlineLine,
};

use super::DrawingWriter;

impl DrawingWriter {
    /// Write a simple text body (used by shapes, backward compat)
    pub(super) fn write_text_body(
        &self,
        w: &mut XmlWriter,
        text: &str,
        wrap: bool,
        prst_tx_warp: Option<&ooxml_types::drawings::PresetTextWarp>,
    ) {
        w.start_element("xdr:txBody").end_attrs();
        {
            // Body properties
            w.start_element("a:bodyPr")
                .attr("wrap", if wrap { "square" } else { "none" })
                .attr("rtlCol", "0");

            if let Some(warp) = prst_tx_warp {
                w.end_attrs();

                // Emit prstTxWarp child element inside bodyPr
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

                w.end_element("a:bodyPr");
            } else {
                w.self_close();
            }

            // List style (empty)
            w.start_element("a:lstStyle").self_close();

            // Paragraph
            w.start_element("a:p").end_attrs();
            {
                // Run with text
                w.start_element("a:r").end_attrs();
                {
                    w.start_element("a:rPr").attr("lang", "en-US").self_close();
                    w.element_with_text("a:t", text);
                }
                w.end_element("a:r");
            }
            w.end_element("a:p");
        }
        w.end_element("xdr:txBody");
    }

    // ========================================================================
    // Rich text body serialization
    // ========================================================================

    /// Write a full rich text body from the shared `TextBody` type.
    pub(super) fn write_text_body_full(&self, w: &mut XmlWriter, text_body: &TextBody) {
        w.start_element("xdr:txBody").end_attrs();

        // Body properties
        self.write_body_props(w, &text_body.body_props);

        // List style
        if let Some(ref ls) = text_body.list_style {
            self.write_list_style(w, ls);
        }

        // Paragraphs
        for para in &text_body.paragraphs {
            self.write_paragraph(w, para);
        }

        w.end_element("xdr:txBody");
    }

    /// Write `<a:bodyPr>` with all TextBodyProperties attributes.
    pub(super) fn write_body_props(&self, w: &mut XmlWriter, bp: &TextBodyProperties) {
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

        // Check if we have child elements
        let has_children =
            bp.autofit.is_some() || bp.prst_tx_warp.is_some() || bp.ext_lst.is_some();
        if has_children {
            w.end_attrs();

            // Preset text warp
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

            // Autofit
            if let Some(ref autofit) = bp.autofit {
                self.write_autofit(w, autofit);
            }

            // Extension list
            if let Some(ref ext) = bp.ext_lst {
                self.write_ext_lst(w, ext);
            }

            w.end_element("a:bodyPr");
        } else {
            w.self_close();
        }
    }

    /// Write autofit element.
    pub(super) fn write_autofit(&self, w: &mut XmlWriter, autofit: &TextAutofit) {
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

    /// Write an extension list verbatim.
    pub(super) fn write_ext_lst(&self, w: &mut XmlWriter, ext: &ExtensionList) {
        if let Some(ref raw) = ext.raw_xml {
            w.start_element("a:extLst").end_attrs();
            self.write_raw_xml(w, raw);
            w.end_element("a:extLst");
        }
    }

    /// Write `<a:lstStyle>` with level overrides.
    pub(super) fn write_list_style(&self, w: &mut XmlWriter, ls: &TextListStyle) {
        if ls.def_ppr.is_none() && ls.level_ppr.iter().all(Option::is_none) {
            w.start_element("a:lstStyle").self_close();
            return;
        }

        w.start_element("a:lstStyle").end_attrs();

        if let Some(ref def) = ls.def_ppr {
            w.start_element("a:defPPr");
            self.write_paragraph_props_attrs(w, def);
            w.end_attrs();
            self.write_paragraph_props_children(w, def);
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
                self.write_paragraph_props_attrs(w, ppr);
                w.end_attrs();
                self.write_paragraph_props_children(w, ppr);
                w.end_element(tag);
            }
        }

        w.end_element("a:lstStyle");
    }

    /// Write a paragraph `<a:p>`.
    pub(super) fn write_paragraph(&self, w: &mut XmlWriter, para: &Paragraph) {
        w.start_element("a:p").end_attrs();

        // Paragraph properties
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
            self.write_paragraph_props_attrs(w, ppr);
            w.end_attrs();
            self.write_paragraph_props_children(w, ppr);
            w.end_element("a:pPr");
        }

        // Runs
        for run_content in &para.runs {
            match run_content {
                TextRunContent::Run(run) => self.write_text_run(w, run),
                TextRunContent::LineBreak { props } => self.write_line_break(w, props.as_ref()),
                TextRunContent::Field {
                    id,
                    field_type,
                    text,
                    run_props,
                    para_props,
                } => self.write_field(
                    w,
                    id,
                    field_type.as_deref(),
                    text.as_deref(),
                    run_props.as_ref(),
                    para_props.as_ref(),
                ),
            }
        }

        // End paragraph run properties
        if let Some(ref end_rpr) = para.end_para_rpr {
            self.write_run_props(w, "a:endParaRPr", end_rpr);
        }

        w.end_element("a:p");
    }

    /// Write paragraph property attributes onto the current element.
    pub(super) fn write_paragraph_props_attrs(&self, w: &mut XmlWriter, ppr: &ParagraphProperties) {
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

    /// Write paragraph property child elements (spacing, bullets, defRPr, tabs, extLst).
    pub(super) fn write_paragraph_props_children(
        &self,
        w: &mut XmlWriter,
        ppr: &ParagraphProperties,
    ) {
        // Line spacing
        if let Some(ref sp) = ppr.line_spacing {
            self.write_text_spacing(w, "a:lnSpc", sp);
        }
        // Space before
        if let Some(ref sp) = ppr.space_before {
            self.write_text_spacing(w, "a:spcBef", sp);
        }
        // Space after
        if let Some(ref sp) = ppr.space_after {
            self.write_text_spacing(w, "a:spcAft", sp);
        }
        // Bullet properties
        if let Some(ref bullet) = ppr.bullet {
            self.write_bullet_properties(w, bullet);
        }
        // Tab stops — emit even when empty (presence of <a:tabLst/> is semantically meaningful)
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
        // Default run properties
        if let Some(ref drp) = ppr.def_run_props {
            self.write_run_props(w, "a:defRPr", drp);
        }
        // Extension list
        if let Some(ref ext) = ppr.ext_lst {
            self.write_ext_lst(w, ext);
        }
    }

    /// Write a text run `<a:r>`.
    pub(super) fn write_text_run(&self, w: &mut XmlWriter, run: &TextRun) {
        w.start_element("a:r").end_attrs();
        self.write_run_props(w, "a:rPr", &run.props);
        w.element_with_text("a:t", &run.text);
        w.end_element("a:r");
    }

    /// Write a line break `<a:br>`.
    pub(super) fn write_line_break(&self, w: &mut XmlWriter, props: Option<&RunProperties>) {
        if let Some(rpr) = props {
            w.start_element("a:br").end_attrs();
            self.write_run_props(w, "a:rPr", rpr);
            w.end_element("a:br");
        } else {
            w.start_element("a:br").self_close();
        }
    }

    /// Write a field `<a:fld>`.
    pub(super) fn write_field(
        &self,
        w: &mut XmlWriter,
        id: &str,
        field_type: Option<&str>,
        text: Option<&str>,
        run_props: Option<&RunProperties>,
        para_props: Option<&ParagraphProperties>,
    ) {
        w.start_element("a:fld").attr("id", id);
        if let Some(ft) = field_type {
            w.attr("type", ft);
        }
        w.end_attrs();

        if let Some(ppr) = para_props {
            w.start_element("a:pPr");
            self.write_paragraph_props_attrs(w, ppr);
            w.end_attrs();
            self.write_paragraph_props_children(w, ppr);
            w.end_element("a:pPr");
        }
        if let Some(rpr) = run_props {
            self.write_run_props(w, "a:rPr", rpr);
        }
        if let Some(t) = text {
            w.element_with_text("a:t", t);
        }

        w.end_element("a:fld");
    }

    /// Write run properties (`<a:rPr>` or `<a:endParaRPr>` or `<a:defRPr>`).
    pub(super) fn write_run_props(&self, w: &mut XmlWriter, tag: &str, rp: &RunProperties) {
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

        // Check if we need child elements
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

        // Text outline
        if let Some(ref ln) = rp.text_outline {
            self.write_ooxml_outline(w, ln);
        }

        // Text fill
        if let Some(ref fill) = rp.text_fill {
            self.write_ooxml_fill(w, fill);
        }

        // Effects (effectLst / effectDag)
        if let Some(ref effects) = rp.effects {
            self.write_effect_properties(w, effects);
        }

        // Highlight
        if let Some(ref hl) = rp.highlight {
            w.start_element("a:highlight").end_attrs();
            self.write_drawing_color(w, hl);
            w.end_element("a:highlight");
        }

        // Underline line
        if let Some(ref ul) = rp.underline_line {
            match ul {
                UnderlineLine::FollowText => {
                    w.start_element("a:uLnTx").self_close();
                }
                UnderlineLine::Custom(outline) => {
                    // Write as <a:uLn> with the outline properties
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
                        match fill {
                            LineFill::Solid(sf) => {
                                w.start_element("a:solidFill").end_attrs();
                                self.write_drawing_color(w, &sf.color);
                                w.end_element("a:solidFill");
                            }
                            LineFill::NoFill => {
                                w.start_element("a:noFill").self_close();
                            }
                            LineFill::Gradient(_) | LineFill::Pattern(_) => {}
                        }
                    }
                    if let Some(ref dash) = outline.dash {
                        match dash {
                            LineDash::Preset(ds) => {
                                w.start_element("a:prstDash")
                                    .attr("val", ds.to_ooxml())
                                    .self_close();
                            }
                            LineDash::Custom(stops) => {
                                w.start_element("a:custDash").end_attrs();
                                for stop in stops {
                                    w.start_element("a:ds")
                                        .attr_num("d", stop.d)
                                        .attr_num("sp", stop.sp)
                                        .self_close();
                                }
                                w.end_element("a:custDash");
                            }
                        }
                    }
                    w.end_element("a:uLn");
                }
            }
        }

        // Underline fill
        if let Some(ref uf) = rp.underline_fill {
            match uf {
                UnderlineFill::FollowText => {
                    w.start_element("a:uFillTx").self_close();
                }
                UnderlineFill::Custom(fill) => {
                    w.start_element("a:uFill").end_attrs();
                    self.write_ooxml_fill(w, fill);
                    w.end_element("a:uFill");
                }
            }
        }

        // Solid fill for text colour — only emit when text_fill is not set
        // (text_fill already covers the fill group; writing color too produces a duplicate solidFill)
        if rp.text_fill.is_none() {
            if let Some(ref color) = rp.color {
                w.start_element("a:solidFill").end_attrs();
                self.write_drawing_color(w, color);
                w.end_element("a:solidFill");
            }
        }

        // Fonts
        if let Some(ref f) = rp.latin {
            Self::write_text_font(w, "a:latin", f);
        }
        if let Some(ref f) = rp.ea {
            Self::write_text_font(w, "a:ea", f);
        }
        if let Some(ref f) = rp.cs {
            Self::write_text_font(w, "a:cs", f);
        }
        if let Some(ref f) = rp.sym {
            Self::write_text_font(w, "a:sym", f);
        }

        // Hyperlinks
        if let Some(ref hlink) = rp.hlink_click {
            self.write_hlink_info(w, "a:hlinkClick", hlink);
        }
        if let Some(ref hlink) = rp.hlink_mouse_over {
            self.write_hlink_info(w, "a:hlinkMouseOver", hlink);
        }

        // RTL as child element
        if let Some(rtl) = rp.rtl {
            w.start_element("a:rtl")
                .attr("val", if rtl { "1" } else { "0" })
                .self_close();
        }

        // Extension list
        if let Some(ref ext) = rp.ext_lst {
            self.write_ext_lst(w, ext);
        }

        w.end_element(tag);
    }

    /// Write a CT_TextFont element.
    pub(super) fn write_text_font(w: &mut XmlWriter, tag: &str, font: &TextFont) {
        w.start_element(tag).attr("typeface", &font.typeface);
        if let Some(ref p) = font.panose {
            w.attr("panose", p);
        }
        if let Some(pf) = font.pitch_family {
            w.attr_num("pitchFamily", pf.value());
        }
        if let Some(cs) = font.charset {
            w.attr_num("charset", cs);
        }
        w.self_close();
    }

    /// Write a hyperlink info element for text runs (CT_Hyperlink).
    pub(super) fn write_hlink_info(&self, w: &mut XmlWriter, tag: &str, hlink: &Hyperlink) {
        w.start_element(tag);
        if let Some(ref r_id) = hlink.r_id {
            if self.can_write_relationship_id(r_id) {
                w.attr("r:id", r_id);
            }
        }
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
        if let Some(history) = hlink.history {
            if !history {
                w.attr("history", "0");
            }
        }
        if let Some(true) = hlink.highlight_click {
            w.attr("highlightClick", "1");
        }
        if let Some(true) = hlink.end_snd {
            w.attr("endSnd", "1");
        }
        if let Some(ref ext) = hlink.ext_lst {
            w.end_attrs();
            self.write_raw_xml(w, ext);
            w.end_element(tag);
        } else {
            w.self_close();
        }
    }

    /// Write a TextSpacing inside a wrapper element.
    pub(super) fn write_text_spacing(
        &self,
        w: &mut XmlWriter,
        wrapper_tag: &str,
        spacing: &TextSpacing,
    ) {
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

    /// Write bullet properties.
    pub(super) fn write_bullet_properties(&self, w: &mut XmlWriter, bullet: &BulletProperties) {
        // Bullet colour
        if let Some(ref bc) = bullet.color {
            match bc {
                BulletColor::FollowText => {
                    w.start_element("a:buClrTx").self_close();
                }
                BulletColor::Custom(color) => {
                    w.start_element("a:buClr").end_attrs();
                    self.write_drawing_color(w, color);
                    w.end_element("a:buClr");
                }
            }
        }

        // Bullet size
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

        // Bullet font
        if bullet.font_follows_text {
            w.start_element("a:buFontTx").self_close();
        } else if let Some(ref font) = bullet.font {
            Self::write_text_font(w, "a:buFont", font);
        }

        // Bullet type
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
                BulletType::Blip(r_id) => {
                    if !self.suppress_unregistered_relationships {
                        w.start_element("a:buBlip").end_attrs();
                        w.start_element("a:blip").attr("r:embed", r_id).self_close();
                        w.end_element("a:buBlip");
                    }
                }
            }
        }
    }
}
