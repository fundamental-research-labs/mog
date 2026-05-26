//! Text body parsing for drawings.
//!
//! This module handles parsing of text body elements (txBody) including
//! paragraphs, text runs, and text properties.

use crate::infra::scanner::{find_closing_tag, find_element_end, find_gt_simd, find_tag_simd};

use super::helpers::{
    decode_xml_entities_string, extract_attr_value_in_element, parse_i32, parse_i64, parse_u32,
};
use super::transforms::{parse_color, parse_fill, parse_outline};
use super::types::{
    BulletColor, BulletProperties, BulletSize, BulletType, DrawingColor, ExtensionList, Fill,
    Hyperlink, Paragraph, ParagraphProperties, RunProperties, SolidFill, TextAlign, TextAnchor,
    TextAutofit, TextBody, TextBodyProperties, TextCapsType, TextFont, TextFontAlignType,
    TextHorzOverflow, TextListStyle, TextRun, TextRunContent, TextSpacing, TextStrikeType,
    TextTabAlignType, TextTabStop, TextUnderlineType, TextVertOverflow, TextVerticalType, TextWrap,
    UnderlineFill, UnderlineLine,
};
use ooxml_types::drawings::{
    StAngle, StPercentage, StPitchFamily, StTextFontSize, StTextIndentLevelType,
    StTextNonNegativePoint, StTextPoint, TextAutonumberType,
};

/// Parse text body
pub fn parse_text_body(xml: &[u8]) -> Option<TextBody> {
    let mut body = TextBody::default();

    // Parse body properties
    if let Some(bp_start) = find_tag_simd(xml, b"bodyPr", 0) {
        body.body_props = parse_body_props(&xml[bp_start..]);
    }

    // Parse list style
    if let Some(ls_start) = find_tag_simd(xml, b"lstStyle", 0) {
        body.list_style = parse_list_style(&xml[ls_start..]);
    }

    // Parse paragraphs
    // Note: find_tag_simd already validates tag boundaries (handles both <p> and <a:p>)
    let mut pos = 0;
    while let Some(p_start) = find_tag_simd(xml, b"p", pos) {
        if let Some(para) = parse_paragraph(&xml[p_start..]) {
            body.paragraphs.push(para);
        }
        pos = p_start + 1;
    }

    Some(body)
}

/// Parse body properties
fn parse_body_props(xml: &[u8]) -> TextBodyProperties {
    let mut props = TextBodyProperties::default();

    props.rot = extract_attr_value_in_element(xml, b"rot=\"")
        .and_then(|v| parse_i32(v))
        .map(StAngle::new);

    props.anchor =
        extract_attr_value_in_element(xml, b"anchor=\"").and_then(|v| parse_text_anchor(v));

    props.wrap = extract_attr_value_in_element(xml, b"wrap=\"").and_then(|v| parse_text_wrap(v));

    props.l_ins = extract_attr_value_in_element(xml, b"lIns=\"").and_then(|v| parse_i64(v));

    props.t_ins = extract_attr_value_in_element(xml, b"tIns=\"").and_then(|v| parse_i64(v));

    props.r_ins = extract_attr_value_in_element(xml, b"rIns=\"").and_then(|v| parse_i64(v));

    props.b_ins = extract_attr_value_in_element(xml, b"bIns=\"").and_then(|v| parse_i64(v));

    // New attributes
    props.vert = extract_attr_value_in_element(xml, b"vert=\"").and_then(|v| {
        let s = std::str::from_utf8(v).ok()?;
        let parsed = TextVerticalType::from_ooxml(s);
        if parsed != TextVerticalType::Horizontal || s == "horz" {
            Some(parsed)
        } else {
            None
        }
    });

    props.vert_overflow = extract_attr_value_in_element(xml, b"vertOverflow=\"").and_then(|v| {
        let s = std::str::from_utf8(v).ok()?;
        let parsed = TextVertOverflow::from_ooxml(s);
        if parsed != TextVertOverflow::Overflow || s == "overflow" {
            Some(parsed)
        } else {
            None
        }
    });

    props.horz_overflow = extract_attr_value_in_element(xml, b"horzOverflow=\"").and_then(|v| {
        let s = std::str::from_utf8(v).ok()?;
        let parsed = TextHorzOverflow::from_ooxml(s);
        if parsed != TextHorzOverflow::Overflow || s == "overflow" {
            Some(parsed)
        } else {
            None
        }
    });

    props.anchor_ctr =
        extract_attr_value_in_element(xml, b"anchorCtr=\"").map(|v| v == b"1" || v == b"true");

    props.rtl_col =
        extract_attr_value_in_element(xml, b"rtlCol=\"").map(|v| v == b"1" || v == b"true");

    props.spc_first_last_para = extract_attr_value_in_element(xml, b"spcFirstLastPara=\"")
        .map(|v| v == b"1" || v == b"true");

    props.num_col = extract_attr_value_in_element(xml, b"numCol=\"").and_then(|v| parse_u32(v));

    props.spc_col = extract_attr_value_in_element(xml, b"spcCol=\"").and_then(|v| parse_i64(v));

    props.upright =
        extract_attr_value_in_element(xml, b"upright=\"").map(|v| v == b"1" || v == b"true");

    props.compat_ln_spc =
        extract_attr_value_in_element(xml, b"compatLnSpc=\"").map(|v| v == b"1" || v == b"true");

    props.force_aa =
        extract_attr_value_in_element(xml, b"forceAA=\"").map(|v| v == b"1" || v == b"true");

    props.from_word_art =
        extract_attr_value_in_element(xml, b"fromWordArt=\"").map(|v| v == b"1" || v == b"true");

    // Parse autofit child elements
    if find_tag_simd(xml, b"spAutoFit", 0).is_some() {
        props.autofit = Some(TextAutofit::ShapeAutofit);
    } else if let Some(norm_start) = find_tag_simd(xml, b"normAutofit", 0) {
        let norm_xml = &xml[norm_start..];
        let font_scale =
            extract_attr_value_in_element(norm_xml, b"fontScale=\"").and_then(|v| parse_u32(v));
        let line_space_reduction = extract_attr_value_in_element(norm_xml, b"lnSpcReduction=\"")
            .and_then(|v| parse_u32(v));
        props.autofit = Some(TextAutofit::NormalAutofit {
            font_scale,
            line_space_reduction,
        });
    } else if find_tag_simd(xml, b"noAutofit", 0).is_some() {
        props.autofit = Some(TextAutofit::NoAutofit);
    }

    // Parse prstTxWarp child element
    if let Some(warp_start) = find_tag_simd(xml, b"prstTxWarp", 0) {
        let warp_xml = &xml[warp_start..];
        if let Some(prst_val) = extract_attr_value_in_element(warp_xml, b"prst=\"") {
            if let Some(preset) = ooxml_types::drawings::TextWarpPreset::from_ooxml(
                std::str::from_utf8(prst_val).unwrap_or(""),
            ) {
                let mut adjust_values = Vec::new();
                // Parse avLst child and its gd elements
                if let Some(avlst_start) = find_tag_simd(warp_xml, b"avLst", 0) {
                    let avlst_xml = &warp_xml[avlst_start..];
                    let mut gd_pos = 0;
                    while let Some(gd_start) = find_tag_simd(avlst_xml, b"gd", gd_pos) {
                        let gd_xml = &avlst_xml[gd_start..];
                        if let (Some(name_val), Some(fmla_val)) = (
                            extract_attr_value_in_element(gd_xml, b"name=\""),
                            extract_attr_value_in_element(gd_xml, b"fmla=\""),
                        ) {
                            adjust_values.push(ooxml_types::drawings::GeomGuide {
                                name: String::from_utf8_lossy(name_val).into_owned(),
                                fmla: String::from_utf8_lossy(fmla_val).into_owned(),
                            });
                        }
                        gd_pos = gd_start + 1;
                    }
                }
                props.prst_tx_warp = Some(ooxml_types::drawings::PresetTextWarp {
                    preset,
                    adjust_values,
                });
            }
        }
    }

    // Parse extLst (opaque XML capture)
    if let Some(ext_start) = find_tag_simd(xml, b"extLst", 0) {
        props.ext_lst = parse_ext_lst(&xml[ext_start..]);
    }

    props
}

/// Parse a paragraph
fn parse_paragraph(xml: &[u8]) -> Option<Paragraph> {
    let end = find_closing_tag(xml, b"p", 0)?;
    let element = &xml[..end];

    let mut para = Paragraph::default();

    // Parse paragraph properties
    if let Some(ppr_start) = find_tag_simd(element, b"pPr", 0) {
        para.props = parse_para_props(&element[ppr_start..]);
    }

    // Single-pass: scan for <a:r>, <a:br>, <a:fld>, and <a:endParaRPr> in document order.
    // This preserves the original ordering of runs, line breaks, and fields.
    // Each element is properly scoped to its closing tag to prevent attribute bleed-through.
    let mut pos = 0;
    while pos < element.len() {
        // Find the next '<' to inspect the tag name
        let lt = match crate::infra::scanner::find_lt_simd(element, pos) {
            Some(p) => p,
            None => break,
        };

        // Quick check: skip closing tags
        if lt + 1 < element.len() && element[lt + 1] == b'/' {
            pos = lt + 1;
            continue;
        }

        // Determine the tag name (after optional namespace prefix)
        let tag_start = lt + 1;
        let mut name_end = tag_start;
        while name_end < element.len()
            && !matches!(
                element[name_end],
                b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/'
            )
        {
            name_end += 1;
        }
        let full_tag = &element[tag_start..name_end];

        // Extract local name (after colon for namespaced tags)
        let local_name = if let Some(colon_pos) = full_tag.iter().position(|&b| b == b':') {
            &full_tag[colon_pos + 1..]
        } else {
            full_tag
        };

        match local_name {
            b"r" => {
                // Text run: scope to </a:r> and parse
                if let Some(run) = parse_text_run(&element[lt..]) {
                    para.runs.push(TextRunContent::Run(run));
                }
                // Advance past the closing tag
                if let Some(close) = find_closing_tag(element, b"r", lt) {
                    pos = close;
                } else {
                    pos = lt + 1;
                }
            }
            b"br" => {
                // Line break: scope to </a:br> (or self-closing) and parse rPr within that scope
                let br_end = find_closing_tag(element, b"br", lt)
                    .or_else(|| find_element_end(element, lt).map(|e| e + 1))
                    .unwrap_or(element.len());
                let br_xml = &element[lt..br_end];
                let br_props = if let Some(rpr_start) = find_tag_simd(br_xml, b"rPr", 0) {
                    let rpr_end = find_closing_tag(br_xml, b"rPr", rpr_start)
                        .or_else(|| find_element_end(br_xml, rpr_start).map(|e| e + 1))
                        .unwrap_or(br_xml.len());
                    Some(parse_run_props(&br_xml[rpr_start..rpr_end]))
                } else {
                    None
                };
                para.runs
                    .push(TextRunContent::LineBreak { props: br_props });
                pos = br_end;
            }
            b"fld" => {
                // Field: scope to </a:fld> and parse within that scope
                let fld_end = find_closing_tag(element, b"fld", lt).unwrap_or(element.len());
                let fld_xml = &element[lt..fld_end];
                let id = extract_attr_value_in_element(fld_xml, b"id=\"")
                    .map(|v| String::from_utf8_lossy(v).into_owned())
                    .unwrap_or_default();
                let field_type = extract_attr_value_in_element(fld_xml, b"type=\"")
                    .map(|v| String::from_utf8_lossy(v).into_owned());
                let para_props = if let Some(ppr_start) = find_tag_simd(fld_xml, b"pPr", 0) {
                    let ppr_end =
                        find_closing_tag(fld_xml, b"pPr", ppr_start).unwrap_or(fld_xml.len());
                    Some(parse_para_props(&fld_xml[ppr_start..ppr_end]))
                } else {
                    None
                };
                let run_props = if let Some(rpr_start) = find_tag_simd(fld_xml, b"rPr", 0) {
                    let rpr_end = find_closing_tag(fld_xml, b"rPr", rpr_start)
                        .or_else(|| find_element_end(fld_xml, rpr_start).map(|e| e + 1))
                        .unwrap_or(fld_xml.len());
                    Some(parse_run_props(&fld_xml[rpr_start..rpr_end]))
                } else {
                    None
                };
                let text = if let Some(t_start) = find_tag_simd(fld_xml, b"t", 0) {
                    if let Some(t_end) = find_closing_tag(fld_xml, b"t", t_start) {
                        let mut text_start = t_start;
                        while text_start < t_end && fld_xml[text_start] != b'>' {
                            text_start += 1;
                        }
                        text_start += 1;
                        if text_start < t_end {
                            let raw =
                                String::from_utf8_lossy(&fld_xml[text_start..t_end]).into_owned();
                            Some(decode_xml_entities_string(&raw))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };
                para.runs.push(TextRunContent::Field {
                    id,
                    field_type,
                    text,
                    run_props,
                    para_props,
                });
                pos = fld_end;
            }
            b"endParaRPr" => {
                // End-paragraph run properties: scope to closing tag
                let epr_end = find_closing_tag(element, b"endParaRPr", lt)
                    .or_else(|| find_element_end(element, lt).map(|e| e + 1))
                    .unwrap_or(element.len());
                para.end_para_rpr = Some(parse_run_props(&element[lt..epr_end]));
                pos = epr_end;
            }
            _ => {
                pos = lt + 1;
            }
        }
    }

    Some(para)
}

/// Parse paragraph properties
fn parse_para_props(xml: &[u8]) -> ParagraphProperties {
    let mut props = ParagraphProperties::default();

    props.align = extract_attr_value_in_element(xml, b"algn=\"").and_then(|v| parse_text_align(v));

    props.margin_l = extract_attr_value_in_element(xml, b"marL=\"").and_then(|v| parse_i64(v));

    props.margin_r = extract_attr_value_in_element(xml, b"marR=\"").and_then(|v| parse_i64(v));

    props.indent = extract_attr_value_in_element(xml, b"indent=\"").and_then(|v| parse_i64(v));

    props.level = extract_attr_value_in_element(xml, b"lvl=\"")
        .and_then(|v| parse_u32(v))
        .map(StTextIndentLevelType::new_clamped);

    props.rtl = extract_attr_value_in_element(xml, b"rtl=\"").map(|v| v == b"1" || v == b"true");

    props.def_tab_sz =
        extract_attr_value_in_element(xml, b"defTabSz=\"").and_then(|v| parse_i64(v));

    props.ea_ln_brk =
        extract_attr_value_in_element(xml, b"eaLnBrk=\"").map(|v| v == b"1" || v == b"true");

    props.latin_ln_brk =
        extract_attr_value_in_element(xml, b"latinLnBrk=\"").map(|v| v == b"1" || v == b"true");

    props.hanging_punct =
        extract_attr_value_in_element(xml, b"hangingPunct=\"").map(|v| v == b"1" || v == b"true");

    props.font_align = extract_attr_value_in_element(xml, b"fontAlgn=\"").and_then(|v| {
        let s = std::str::from_utf8(v).ok()?;
        let parsed = TextFontAlignType::from_ooxml(s);
        if parsed != TextFontAlignType::Auto || s == "auto" {
            Some(parsed)
        } else {
            None
        }
    });

    // Parse line spacing
    if let Some(ls_start) = find_tag_simd(xml, b"lnSpc", 0) {
        let ls_xml = &xml[ls_start..];
        let ls_end = find_closing_tag(ls_xml, b"lnSpc", 0).unwrap_or(ls_xml.len());
        props.line_spacing = parse_text_spacing(&ls_xml[..ls_end]);
    }

    // Parse space before
    if let Some(sb_start) = find_tag_simd(xml, b"spcBef", 0) {
        let sb_xml = &xml[sb_start..];
        let sb_end = find_closing_tag(sb_xml, b"spcBef", 0).unwrap_or(sb_xml.len());
        props.space_before = parse_text_spacing(&sb_xml[..sb_end]);
    }

    // Parse space after
    if let Some(sa_start) = find_tag_simd(xml, b"spcAft", 0) {
        let sa_xml = &xml[sa_start..];
        let sa_end = find_closing_tag(sa_xml, b"spcAft", 0).unwrap_or(sa_xml.len());
        props.space_after = parse_text_spacing(&sa_xml[..sa_end]);
    }

    // Parse bullet properties
    props.bullet = parse_bullet_props(xml);

    // Parse default run properties
    if let Some(drp_start) = find_tag_simd(xml, b"defRPr", 0) {
        // Bound the slice to the defRPr element to avoid picking up attributes
        // from sibling/subsequent elements (e.g., rPr in text runs).
        let drp_xml = &xml[drp_start..];
        let drp_end = find_closing_tag(drp_xml, b"defRPr", 0)
            .or_else(|| find_element_end(drp_xml, 0).map(|e| e + 1))
            .unwrap_or(drp_xml.len());
        props.def_run_props = Some(Box::new(parse_run_props(&drp_xml[..drp_end])));
    }

    // Parse tab stops
    if let Some(tl_start) = find_tag_simd(xml, b"tabLst", 0) {
        let tl_xml = &xml[tl_start..];
        let mut tabs = Vec::new();
        let mut tab_pos = 0;
        while let Some(tab_start) = find_tag_simd(tl_xml, b"tab", tab_pos) {
            let tab_xml = &tl_xml[tab_start..];
            let position =
                extract_attr_value_in_element(tab_xml, b"pos=\"").and_then(|v| parse_i64(v));
            let align = extract_attr_value_in_element(tab_xml, b"algn=\"").and_then(|v| {
                let s = std::str::from_utf8(v).ok()?;
                let parsed = TextTabAlignType::from_ooxml(s);
                if parsed != TextTabAlignType::Left || s == "l" {
                    Some(parsed)
                } else {
                    None
                }
            });
            tabs.push(TextTabStop { position, align });
            tab_pos = tab_start + 1;
        }
        // Store tab list even if empty, to preserve <a:tabLst/> for round-trip
        props.tab_list = Some(tabs);
    }

    // Parse extLst
    if let Some(ext_start) = find_tag_simd(xml, b"extLst", 0) {
        props.ext_lst = parse_ext_lst(&xml[ext_start..]);
    }

    props
}

/// Parse a text run
fn parse_text_run(xml: &[u8]) -> Option<TextRun> {
    let end = find_closing_tag(xml, b"r", 0)?;
    let element = &xml[..end];

    let mut run = TextRun::default();

    // Parse run properties
    if let Some(rpr_start) = find_tag_simd(element, b"rPr", 0) {
        run.props = parse_run_props(&element[rpr_start..]);
    }

    // Parse text content
    if let Some(t_start) = find_tag_simd(element, b"t", 0) {
        if let Some(t_end) = find_closing_tag(element, b"t", t_start) {
            // Find the actual text start (after the >)
            let mut text_start = t_start;
            while text_start < t_end && element[text_start] != b'>' {
                text_start += 1;
            }
            text_start += 1; // Skip the >

            if text_start < t_end {
                let text = String::from_utf8_lossy(&element[text_start..t_end]).into_owned();
                run.text = decode_xml_entities_string(&text);
            }
        }
    }

    Some(run)
}

/// Parse run properties
fn parse_run_props(xml: &[u8]) -> RunProperties {
    let mut props = RunProperties::default();

    props.size = extract_attr_value_in_element(xml, b"sz=\"")
        .and_then(|v| parse_u32(v))
        .map(StTextFontSize::new_clamped);

    props.bold = extract_attr_value_in_element(xml, b"b=\"").map(|v| v == b"1" || v == b"true");

    props.italic = extract_attr_value_in_element(xml, b"i=\"").map(|v| v == b"1" || v == b"true");

    props.underline = extract_attr_value_in_element(xml, b"u=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(TextUnderlineType::from_ooxml);

    props.strike = extract_attr_value_in_element(xml, b"strike=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(TextStrikeType::from_ooxml);

    props.kern = extract_attr_value_in_element(xml, b"kern=\"")
        .and_then(|v| parse_u32(v))
        .map(StTextNonNegativePoint::new_clamped);

    props.cap = extract_attr_value_in_element(xml, b"cap=\"").and_then(|v| {
        let s = std::str::from_utf8(v).ok()?;
        let parsed = TextCapsType::from_ooxml(s);
        if parsed != TextCapsType::None || s == "none" {
            Some(parsed)
        } else {
            None
        }
    });

    props.spacing = extract_attr_value_in_element(xml, b"spc=\"")
        .and_then(|v| parse_i32(v))
        .map(StTextPoint::new);

    props.baseline = extract_attr_value_in_element(xml, b"baseline=\"")
        .and_then(|v| parse_i32(v))
        .map(StPercentage::new);

    props.lang = extract_attr_value_in_element(xml, b"lang=\"")
        .map(|v| String::from_utf8_lossy(v).into_owned());

    props.alt_lang = extract_attr_value_in_element(xml, b"altLang=\"")
        .map(|v| String::from_utf8_lossy(v).into_owned());

    props.kumimoji =
        extract_attr_value_in_element(xml, b"kumimoji=\"").map(|v| v == b"1" || v == b"true");

    props.normalize_h =
        extract_attr_value_in_element(xml, b"normalizeH=\"").map(|v| v == b"1" || v == b"true");

    props.no_proof =
        extract_attr_value_in_element(xml, b"noProof=\"").map(|v| v == b"1" || v == b"true");

    props.dirty =
        extract_attr_value_in_element(xml, b"dirty=\"").map(|v| v == b"1" || v == b"true");

    props.err = extract_attr_value_in_element(xml, b"err=\"").map(|v| v == b"1" || v == b"true");

    props.smt_clean =
        extract_attr_value_in_element(xml, b"smtClean=\"").map(|v| v == b"1" || v == b"true");

    props.smt_id = extract_attr_value_in_element(xml, b"smtId=\"").and_then(|v| parse_u32(v));

    props.bmk = extract_attr_value_in_element(xml, b"bmk=\"")
        .map(|v| String::from_utf8_lossy(v).into_owned());

    // Parse font - latin
    props.latin = parse_text_font(xml, b"latin");

    // Parse font - East Asian
    props.ea = parse_text_font(xml, b"ea");

    // Parse font - Complex Script
    props.cs = parse_text_font(xml, b"cs");

    // Parse font - Symbol
    props.sym = parse_text_font(xml, b"sym");

    // Parse color (solidFill child)
    if let Some(solid_start) = find_tag_simd(xml, b"solidFill", 0) {
        let c = parse_color(&xml[solid_start..]);
        props.color = Some(c);
    }

    // Parse effectLst / effectDag (EG_EffectProperties)
    if let Some(eff_start) = find_tag_simd(xml, b"effectLst", 0) {
        props.effects = super::transforms::parse_effect_list(&xml[eff_start..])
            .map(ooxml_types::drawings::EffectProperties::EffectList);
    }

    // Parse highlight color
    if let Some(hl_start) = find_tag_simd(xml, b"highlight", 0) {
        let c = parse_color(&xml[hl_start..]);
        // Only set highlight if the parsed color has meaningful data (not empty default)
        let is_empty = matches!(&c, DrawingColor::SrgbClr { val, .. } if val.is_empty());
        if !is_empty {
            props.highlight = Some(c);
        }
    }

    // Parse hyperlink click
    if let Some(hlink_start) = find_tag_simd(xml, b"hlinkClick", 0) {
        props.hlink_click = Some(parse_hyperlink(&xml[hlink_start..]));
    }

    // Parse hyperlink mouse over
    if let Some(hlink_start) = find_tag_simd(xml, b"hlinkMouseOver", 0) {
        props.hlink_mouse_over = Some(parse_hyperlink(&xml[hlink_start..]));
    }

    // Parse text outline (<a:ln>)
    if let Some(ln_start) = find_tag_simd(xml, b"ln", 0) {
        if let Some(outline) = parse_outline(&xml[ln_start..]) {
            props.text_outline = Some(outline);
        }
    }

    // Parse text fill (fill group: noFill, solidFill, gradFill, pattFill).
    // In CT_TextCharacterProperties, fill comes AFTER <a:ln>, so search after </a:ln>
    // to avoid picking up fill elements that belong to the text outline.
    let fill_search_start = find_tag_simd(xml, b"ln", 0)
        .and_then(|ln_start| find_closing_tag(xml, b"ln", ln_start))
        .map(|close| {
            // Skip past the closing tag ">" character
            find_gt_simd(xml, close).map_or(close, |gt| gt + 1)
        })
        .unwrap_or(0);
    let fill_range = &xml[fill_search_start..];
    if find_tag_simd(fill_range, b"noFill", 0).is_some() {
        props.text_fill = Some(Fill::NoFill);
    } else if let Some(solid_start) = find_tag_simd(fill_range, b"solidFill", 0) {
        // solidFill contributes to both color (above) and text_fill
        let c = parse_color(&fill_range[solid_start..]);
        props.text_fill = Some(Fill::Solid(SolidFill { color: c }));
    } else if find_tag_simd(fill_range, b"gradFill", 0).is_some()
        || find_tag_simd(fill_range, b"pattFill", 0).is_some()
    {
        if let Some(fill) = parse_fill(fill_range) {
            props.text_fill = Some(fill);
        }
    }

    // Parse underline line choice
    if find_tag_simd(xml, b"uLnTx", 0).is_some() {
        props.underline_line = Some(UnderlineLine::FollowText);
    } else if let Some(uln_start) = find_tag_simd(xml, b"uLn", 0) {
        if let Some(outline) = parse_outline(&xml[uln_start..]) {
            props.underline_line = Some(UnderlineLine::Custom(outline));
        }
    }

    // Parse underline fill choice
    if find_tag_simd(xml, b"uFillTx", 0).is_some() {
        props.underline_fill = Some(UnderlineFill::FollowText);
    } else if let Some(ufill_start) = find_tag_simd(xml, b"uFill", 0) {
        if let Some(fill) = parse_fill(&xml[ufill_start..]) {
            props.underline_fill = Some(UnderlineFill::Custom(fill));
        }
    }

    // Parse rtl child element (<a:rtl val="..."/>)
    if let Some(rtl_start) = find_tag_simd(xml, b"rtl", 0) {
        let rtl_xml = &xml[rtl_start..];
        props.rtl = extract_attr_value_in_element(rtl_xml, b"val=\"")
            .map(|v| v == b"1" || v == b"true")
            .or(Some(true)); // presence without val= implies true
    }

    // Parse extLst
    if let Some(ext_start) = find_tag_simd(xml, b"extLst", 0) {
        props.ext_lst = parse_ext_lst(&xml[ext_start..]);
    }

    props
}

// =========================================================================
// Helper functions
// =========================================================================

/// Parse a TextFont from a tag like `<a:latin>`, `<a:ea>`, `<a:cs>`, `<a:sym>`.
fn parse_text_font(xml: &[u8], tag: &[u8]) -> Option<TextFont> {
    let start = find_tag_simd(xml, tag, 0)?;
    // Scope to just this element (self-closing or with closing tag) to avoid
    // attribute bleed-through from subsequent sibling font elements.
    let el_end = find_element_end(&xml[start..], 0)
        .map(|e| start + e + 1)
        .unwrap_or(xml.len());
    let el = &xml[start..el_end];
    let typeface = extract_attr_value_in_element(el, b"typeface=\"")
        .map(|v| String::from_utf8_lossy(v).into_owned())?;
    let panose = extract_attr_value_in_element(el, b"panose=\"")
        .map(|v| String::from_utf8_lossy(v).into_owned());
    let pitch_family = extract_attr_value_in_element(el, b"pitchFamily=\"")
        .and_then(|v| std::str::from_utf8(v).ok()?.parse::<u8>().ok())
        .map(StPitchFamily::new);
    let charset = extract_attr_value_in_element(el, b"charset=\"")
        .and_then(|v| std::str::from_utf8(v).ok()?.parse().ok());
    Some(TextFont {
        typeface,
        panose,
        pitch_family,
        charset,
    })
}

/// Parse hyperlink info from an `<a:hlinkClick>` or `<a:hlinkMouseOver>` element.
fn parse_hyperlink(xml: &[u8]) -> Hyperlink {
    Hyperlink {
        r_id: extract_attr_value_in_element(xml, b"r:id=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned()),
        tooltip: extract_attr_value_in_element(xml, b"tooltip=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned()),
        action: extract_attr_value_in_element(xml, b"action=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned()),
        ..Default::default() // url and other CT_Hyperlink fields resolved later
    }
}

/// Parse text spacing from an element containing `<a:spcPct>` or `<a:spcPts>`.
fn parse_text_spacing(xml: &[u8]) -> Option<TextSpacing> {
    if let Some(pct_start) = find_tag_simd(xml, b"spcPct", 0) {
        let val = extract_attr_value_in_element(&xml[pct_start..], b"val=\"")
            .and_then(|v| parse_u32(v))?;
        return Some(TextSpacing::Percent(val));
    }
    if let Some(pts_start) = find_tag_simd(xml, b"spcPts", 0) {
        let val = extract_attr_value_in_element(&xml[pts_start..], b"val=\"")
            .and_then(|v| parse_u32(v))?;
        return Some(TextSpacing::Points(val));
    }
    None
}

/// Parse bullet properties from paragraph properties XML.
fn parse_bullet_props(xml: &[u8]) -> Option<BulletProperties> {
    let mut bullet = BulletProperties::default();
    let mut found = false;

    // Bullet color
    if find_tag_simd(xml, b"buClrTx", 0).is_some() {
        bullet.color = Some(BulletColor::FollowText);
        found = true;
    } else if let Some(bc_start) = find_tag_simd(xml, b"buClr", 0) {
        let c = parse_color(&xml[bc_start..]);
        let is_empty = matches!(&c, DrawingColor::SrgbClr { val, .. } if val.is_empty());
        if !is_empty {
            bullet.color = Some(BulletColor::Custom(c));
            found = true;
        }
    }

    // Bullet size
    if find_tag_simd(xml, b"buSzTx", 0).is_some() {
        bullet.size = Some(BulletSize::FollowText);
        found = true;
    } else if let Some(bsp_start) = find_tag_simd(xml, b"buSzPct", 0) {
        if let Some(val) =
            extract_attr_value_in_element(&xml[bsp_start..], b"val=\"").and_then(|v| parse_u32(v))
        {
            bullet.size = Some(BulletSize::Percent(val));
            found = true;
        }
    } else if let Some(bspts_start) = find_tag_simd(xml, b"buSzPts", 0) {
        if let Some(val) =
            extract_attr_value_in_element(&xml[bspts_start..], b"val=\"").and_then(|v| parse_u32(v))
        {
            bullet.size = Some(BulletSize::Points(val));
            found = true;
        }
    }

    // Bullet font
    if find_tag_simd(xml, b"buFontTx", 0).is_some() {
        bullet.font_follows_text = true;
        found = true;
    } else if let Some(bf_start) = find_tag_simd(xml, b"buFont", 0) {
        if let Some(typeface) = extract_attr_value_in_element(&xml[bf_start..], b"typeface=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned())
        {
            let panose = extract_attr_value_in_element(&xml[bf_start..], b"panose=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned());
            let pitch_family = extract_attr_value_in_element(&xml[bf_start..], b"pitchFamily=\"")
                .and_then(|v| std::str::from_utf8(v).ok()?.parse::<u8>().ok())
                .map(StPitchFamily::new);
            let charset = extract_attr_value_in_element(&xml[bf_start..], b"charset=\"")
                .and_then(|v| std::str::from_utf8(v).ok()?.parse().ok());
            bullet.font = Some(TextFont {
                typeface,
                panose,
                pitch_family,
                charset,
            });
            found = true;
        }
    }

    // Bullet type
    if find_tag_simd(xml, b"buNone", 0).is_some() {
        bullet.bullet_type = Some(BulletType::None);
        found = true;
    } else if let Some(bc_start) = find_tag_simd(xml, b"buChar", 0) {
        if let Some(ch) = extract_attr_value_in_element(&xml[bc_start..], b"char=\"")
            .map(|v| String::from_utf8_lossy(v).into_owned())
        {
            bullet.bullet_type = Some(BulletType::Char(ch));
            found = true;
        }
    } else if let Some(ba_start) = find_tag_simd(xml, b"buAutoNum", 0) {
        let ba_xml = &xml[ba_start..];
        if let Some(type_val) = extract_attr_value_in_element(ba_xml, b"type=\"") {
            let s = std::str::from_utf8(type_val).unwrap_or("");
            let scheme = TextAutonumberType::from_ooxml(s);
            let start_at =
                extract_attr_value_in_element(ba_xml, b"startAt=\"").and_then(|v| parse_u32(v));
            bullet.bullet_type = Some(BulletType::AutoNum { scheme, start_at });
            found = true;
        }
    } else if let Some(bb_start) = find_tag_simd(xml, b"buBlip", 0) {
        // Blip bullet - extract relationship ID from the child blip element
        let bb_xml = &xml[bb_start..];
        if let Some(blip_start) = find_tag_simd(bb_xml, b"blip", 0) {
            if let Some(rid) = extract_attr_value_in_element(&bb_xml[blip_start..], b"r:embed=\"")
                .map(|v| String::from_utf8_lossy(v).into_owned())
            {
                bullet.bullet_type = Some(BulletType::Blip(rid));
                found = true;
            }
        }
    }

    if found { Some(bullet) } else { None }
}

/// Parse a CT_TextListStyle element.
fn parse_list_style(xml: &[u8]) -> Option<TextListStyle> {
    let mut style = TextListStyle::default();

    // Parse default paragraph properties — bound slice to defPPr element
    // to prevent picking up child elements from subsequent lvl*pPr siblings.
    if let Some(def_start) = find_tag_simd(xml, b"defPPr", 0) {
        let def_xml = &xml[def_start..];
        let def_end = find_closing_tag(def_xml, b"defPPr", 0)
            .or_else(|| find_element_end(def_xml, 0).map(|e| e + 1))
            .unwrap_or(def_xml.len());
        style.def_ppr = Some(parse_para_props(&def_xml[..def_end]));
    }

    // Parse level paragraph properties (lvl1pPr through lvl9pPr) — bound each
    // slice to its closing tag to avoid leaking into sibling level elements.
    for level in 1..=9u8 {
        let tag = format!("lvl{}pPr", level);
        if let Some(lvl_start) = find_tag_simd(xml, tag.as_bytes(), 0) {
            let lvl_xml = &xml[lvl_start..];
            let lvl_end = find_closing_tag(lvl_xml, tag.as_bytes(), 0)
                .or_else(|| find_element_end(lvl_xml, 0).map(|e| e + 1))
                .unwrap_or(lvl_xml.len());
            style.level_ppr[level as usize - 1] = Some(parse_para_props(&lvl_xml[..lvl_end]));
        }
    }

    // Always return Some if the lstStyle tag was found (even if empty),
    // so that the writer can faithfully reproduce <a:lstStyle/>.
    Some(style)
}

/// Parse an extension list, capturing the raw XML for roundtrip.
fn parse_ext_lst(xml: &[u8]) -> Option<ExtensionList> {
    // find_closing_tag returns the position of '<' in the closing tag.
    // We need to include the closing tag in the captured XML.
    if let Some(close_lt) = find_closing_tag(xml, b"extLst", 0) {
        // Find the '>' after </a:extLst or </extLst
        let mut end = close_lt;
        while end < xml.len() && xml[end] != b'>' {
            end += 1;
        }
        if end < xml.len() {
            end += 1; // Include the '>'
        }
        let raw = String::from_utf8_lossy(&xml[..end]).into_owned();
        Some(ExtensionList { raw_xml: Some(raw) })
    } else {
        // Self-closing extLst (e.g., <a:extLst/>)
        // Just capture up to the end of the self-closing tag
        let mut end = 0;
        while end < xml.len() && xml[end] != b'>' {
            end += 1;
        }
        if end < xml.len() {
            end += 1;
            let raw = String::from_utf8_lossy(&xml[..end]).into_owned();
            Some(ExtensionList { raw_xml: Some(raw) })
        } else {
            None
        }
    }
}

// =========================================================================
// Enum parsing helpers
// =========================================================================

/// Parse text anchor, delegating to `TextAnchor::from_ooxml()`.
pub fn parse_text_anchor(bytes: &[u8]) -> Option<TextAnchor> {
    let s = std::str::from_utf8(bytes).ok()?;
    let parsed = TextAnchor::from_ooxml(s);
    // from_ooxml defaults to Top for unknown inputs; we return None instead.
    if parsed != TextAnchor::Top || s == "t" {
        Some(parsed)
    } else {
        None
    }
}

/// Parse text wrap, delegating to `TextWrap::from_ooxml()`.
pub fn parse_text_wrap(bytes: &[u8]) -> Option<TextWrap> {
    let s = std::str::from_utf8(bytes).ok()?;
    let parsed = TextWrap::from_ooxml(s);
    // from_ooxml defaults to None for unknown inputs; distinguish from valid "none".
    if s == "none" || s == "square" {
        Some(parsed)
    } else {
        None
    }
}

/// Parse text alignment, delegating to `TextAlign::from_ooxml()`.
pub fn parse_text_align(bytes: &[u8]) -> Option<TextAlign> {
    let s = std::str::from_utf8(bytes).ok()?;
    let parsed = TextAlign::from_ooxml(s);
    // from_ooxml defaults to Left for unknown inputs; we return None instead.
    if parsed != TextAlign::Left || s == "l" {
        Some(parsed)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::drawings::{
        StPercentage, StTextFontSize, StTextNonNegativePoint, StTextPoint,
    };

    #[test]
    fn parse_prst_tx_warp_with_one_guide() {
        let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textWave1\"><a:avLst><a:gd name=\"adj\" fmla=\"val 12500\"/></a:avLst></a:prstTxWarp></a:bodyPr>";
        let props = parse_body_props(xml);
        let warp = props.prst_tx_warp.unwrap();
        assert_eq!(
            warp.preset,
            ooxml_types::drawings::TextWarpPreset::TextWave1
        );
        assert_eq!(warp.adjust_values.len(), 1);
        assert_eq!(warp.adjust_values[0].name, "adj");
        assert_eq!(warp.adjust_values[0].fmla, "val 12500");
    }

    #[test]
    fn parse_prst_tx_warp_arch_up_large_value() {
        let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textArchUp\"><a:avLst><a:gd name=\"adj\" fmla=\"val 10800000\"/></a:avLst></a:prstTxWarp></a:bodyPr>";
        let props = parse_body_props(xml);
        let warp = props.prst_tx_warp.unwrap();
        assert_eq!(
            warp.preset,
            ooxml_types::drawings::TextWarpPreset::TextArchUp
        );
        assert_eq!(warp.adjust_values[0].fmla, "val 10800000");
    }

    #[test]
    fn parse_prst_tx_warp_self_closing_no_avlst() {
        let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textPlain\"/></a:bodyPr>";
        let props = parse_body_props(xml);
        let warp = props.prst_tx_warp.unwrap();
        assert_eq!(
            warp.preset,
            ooxml_types::drawings::TextWarpPreset::TextPlain
        );
        assert!(warp.adjust_values.is_empty());
    }

    #[test]
    fn parse_prst_tx_warp_empty_avlst() {
        let xml =
            b"<a:bodyPr><a:prstTxWarp prst=\"textCurveUp\"><a:avLst/></a:prstTxWarp></a:bodyPr>";
        let props = parse_body_props(xml);
        let warp = props.prst_tx_warp.unwrap();
        assert_eq!(
            warp.preset,
            ooxml_types::drawings::TextWarpPreset::TextCurveUp
        );
        assert!(warp.adjust_values.is_empty());
    }

    #[test]
    fn parse_prst_tx_warp_two_guides() {
        let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textInflate\"><a:avLst><a:gd name=\"adj\" fmla=\"val 18750\"/><a:gd name=\"adj2\" fmla=\"val 50000\"/></a:avLst></a:prstTxWarp></a:bodyPr>";
        let props = parse_body_props(xml);
        let warp = props.prst_tx_warp.unwrap();
        assert_eq!(warp.adjust_values.len(), 2);
        assert_eq!(warp.adjust_values[0].name, "adj");
        assert_eq!(warp.adjust_values[1].name, "adj2");
    }

    #[test]
    fn parse_no_prst_tx_warp() {
        let xml = b"<a:bodyPr wrap=\"square\"/>";
        let props = parse_body_props(xml);
        assert!(props.prst_tx_warp.is_none());
    }

    #[test]
    fn parse_prst_tx_warp_unknown_preset() {
        let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textUnknownXYZ\"/></a:bodyPr>";
        let props = parse_body_props(xml);
        assert!(props.prst_tx_warp.is_none());
    }

    #[test]
    fn parse_all_41_presets() {
        let all_presets = [
            "textNoShape",
            "textPlain",
            "textStop",
            "textTriangle",
            "textTriangleInverted",
            "textChevron",
            "textChevronInverted",
            "textRingInside",
            "textRingOutside",
            "textArchUp",
            "textArchDown",
            "textCircle",
            "textButton",
            "textArchUpPour",
            "textArchDownPour",
            "textCirclePour",
            "textButtonPour",
            "textCurveUp",
            "textCurveDown",
            "textCanUp",
            "textCanDown",
            "textWave1",
            "textWave2",
            "textDoubleWave1",
            "textWave4",
            "textInflate",
            "textDeflate",
            "textInflateBottom",
            "textDeflateBottom",
            "textInflateTop",
            "textDeflateTop",
            "textDeflateInflate",
            "textDeflateInflateDeflate",
            "textFadeRight",
            "textFadeLeft",
            "textFadeUp",
            "textFadeDown",
            "textSlantUp",
            "textSlantDown",
            "textCascadeUp",
            "textCascadeDown",
        ];
        for preset_name in &all_presets {
            let xml = format!(
                "<a:bodyPr><a:prstTxWarp prst=\"{}\"/></a:bodyPr>",
                preset_name
            );
            let props = parse_body_props(xml.as_bytes());
            let warp = props
                .prst_tx_warp
                .unwrap_or_else(|| panic!("Failed to parse preset: {}", preset_name));
            assert_eq!(
                warp.preset.to_ooxml(),
                *preset_name,
                "Roundtrip failed for {}",
                preset_name
            );
        }
    }

    // ── Roundtrip validation tests ────────────────────────────────

    /// Helper: given a PresetTextWarp, produce the XML a writer would emit and verify parse roundtrip
    fn roundtrip_warp(warp: &ooxml_types::drawings::PresetTextWarp) {
        // Build XML similar to what the writer emits
        let mut xml = String::new();
        xml.push_str("<a:bodyPr wrap=\"square\" rtlCol=\"0\">");
        xml.push_str(&format!(
            "<a:prstTxWarp prst=\"{}\"",
            warp.preset.to_ooxml()
        ));
        if warp.adjust_values.is_empty() {
            xml.push_str("/>");
        } else {
            xml.push_str("><a:avLst>");
            for gd in &warp.adjust_values {
                xml.push_str(&format!(
                    "<a:gd name=\"{}\" fmla=\"{}\"/>",
                    gd.name, gd.fmla
                ));
            }
            xml.push_str("</a:avLst></a:prstTxWarp>");
        }
        xml.push_str("</a:bodyPr>");

        // Parse it back
        let props = parse_body_props(xml.as_bytes());
        let parsed = props
            .prst_tx_warp
            .expect("prst_tx_warp should be Some after roundtrip");
        assert_eq!(
            parsed.preset,
            warp.preset,
            "preset mismatch for {}",
            warp.preset.to_ooxml()
        );
        assert_eq!(
            parsed.adjust_values.len(),
            warp.adjust_values.len(),
            "adjust count mismatch"
        );
        for (i, (expected, actual)) in warp
            .adjust_values
            .iter()
            .zip(parsed.adjust_values.iter())
            .enumerate()
        {
            assert_eq!(actual.name, expected.name, "guide[{}] name mismatch", i);
            assert_eq!(actual.fmla, expected.fmla, "guide[{}] fmla mismatch", i);
        }
    }

    #[test]
    fn roundtrip_all_41_presets_no_adjusts() {
        use ooxml_types::drawings::{PresetTextWarp, TextWarpPreset};
        let all = [
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
        assert_eq!(all.len(), 41);
        for preset in &all {
            let warp = PresetTextWarp {
                preset: *preset,
                adjust_values: vec![],
            };
            roundtrip_warp(&warp);
        }
    }

    #[test]
    fn roundtrip_single_adjust() {
        use ooxml_types::drawings::{GeomGuide, PresetTextWarp, TextWarpPreset};
        let warp = PresetTextWarp {
            preset: TextWarpPreset::TextWave1,
            adjust_values: vec![GeomGuide {
                name: "adj".to_string(),
                fmla: "val 12500".to_string(),
            }],
        };
        roundtrip_warp(&warp);
    }

    #[test]
    fn roundtrip_two_adjusts() {
        use ooxml_types::drawings::{GeomGuide, PresetTextWarp, TextWarpPreset};
        let warp = PresetTextWarp {
            preset: TextWarpPreset::TextArchUpPour,
            adjust_values: vec![
                GeomGuide {
                    name: "adj".to_string(),
                    fmla: "val 10800000".to_string(),
                },
                GeomGuide {
                    name: "adj2".to_string(),
                    fmla: "val 50000".to_string(),
                },
            ],
        };
        roundtrip_warp(&warp);
    }

    #[test]
    fn roundtrip_zero_adjusts_explicit() {
        use ooxml_types::drawings::{PresetTextWarp, TextWarpPreset};
        let warp = PresetTextWarp {
            preset: TextWarpPreset::TextPlain,
            adjust_values: vec![],
        };
        roundtrip_warp(&warp);
    }

    #[test]
    fn roundtrip_complex_formula() {
        use ooxml_types::drawings::{GeomGuide, PresetTextWarp, TextWarpPreset};
        let warp = PresetTextWarp {
            preset: TextWarpPreset::TextInflate,
            adjust_values: vec![GeomGuide {
                name: "adj".to_string(),
                fmla: "val 25000".to_string(),
            }],
        };
        roundtrip_warp(&warp);
    }

    #[test]
    fn roundtrip_text_no_shape() {
        use ooxml_types::drawings::{PresetTextWarp, TextWarpPreset};
        let warp = PresetTextWarp {
            preset: TextWarpPreset::TextNoShape,
            adjust_values: vec![],
        };
        roundtrip_warp(&warp);
    }

    #[test]
    fn roundtrip_longest_name() {
        use ooxml_types::drawings::{PresetTextWarp, TextWarpPreset};
        let warp = PresetTextWarp {
            preset: TextWarpPreset::TextDeflateInflateDeflate,
            adjust_values: vec![],
        };
        roundtrip_warp(&warp);
    }

    #[test]
    fn roundtrip_none_warp() {
        // No prstTxWarp element → None
        let xml = b"<a:bodyPr wrap=\"square\" rtlCol=\"0\"/>";
        let props = parse_body_props(xml);
        assert!(props.prst_tx_warp.is_none());
    }

    #[test]
    fn roundtrip_warp_with_other_body_props() {
        // bodyPr with rot, wrap, insets AND prstTxWarp
        let xml = b"<a:bodyPr rot=\"5400000\" wrap=\"square\" lIns=\"91440\" tIns=\"45720\" rIns=\"91440\" bIns=\"45720\"><a:prstTxWarp prst=\"textArchUp\"><a:avLst><a:gd name=\"adj\" fmla=\"val 10800000\"/></a:avLst></a:prstTxWarp></a:bodyPr>";
        let props = parse_body_props(xml);
        // Verify other props are preserved
        assert_eq!(props.rot, Some(StAngle::new(5400000)));
        assert_eq!(props.wrap, Some(super::TextWrap::Square));
        assert_eq!(props.l_ins, Some(91440));
        // Verify warp is preserved
        let warp = props.prst_tx_warp.unwrap();
        assert_eq!(
            warp.preset,
            ooxml_types::drawings::TextWarpPreset::TextArchUp
        );
        assert_eq!(warp.adjust_values.len(), 1);
    }

    // ── Body properties expansion tests ───────────────────────────

    #[test]
    fn parse_body_props_vert_type() {
        let xml = b"<a:bodyPr vert=\"vert270\"/>";
        let props = parse_body_props(xml);
        assert_eq!(props.vert, Some(TextVerticalType::Vertical270));
    }

    #[test]
    fn parse_body_props_overflow_modes() {
        let xml = b"<a:bodyPr vertOverflow=\"clip\" horzOverflow=\"clip\"/>";
        let props = parse_body_props(xml);
        assert_eq!(props.vert_overflow, Some(TextVertOverflow::Clip));
        assert_eq!(props.horz_overflow, Some(TextHorzOverflow::Clip));
    }

    #[test]
    fn parse_body_props_anchor_ctr() {
        let xml = b"<a:bodyPr anchorCtr=\"1\"/>";
        let props = parse_body_props(xml);
        assert_eq!(props.anchor_ctr, Some(true));
    }

    #[test]
    fn parse_body_props_multi_column() {
        let xml = b"<a:bodyPr numCol=\"3\" spcCol=\"91440\"/>";
        let props = parse_body_props(xml);
        assert_eq!(props.num_col, Some(3));
        assert_eq!(props.spc_col, Some(91440));
    }

    #[test]
    fn parse_body_props_bool_attrs() {
        let xml = b"<a:bodyPr rtlCol=\"1\" spcFirstLastPara=\"true\" upright=\"1\" compatLnSpc=\"true\" forceAA=\"1\" fromWordArt=\"true\"/>";
        let props = parse_body_props(xml);
        assert_eq!(props.rtl_col, Some(true));
        assert_eq!(props.spc_first_last_para, Some(true));
        assert_eq!(props.upright, Some(true));
        assert_eq!(props.compat_ln_spc, Some(true));
        assert_eq!(props.force_aa, Some(true));
        assert_eq!(props.from_word_art, Some(true));
    }

    #[test]
    fn parse_body_props_autofit_no_autofit() {
        let xml = b"<a:bodyPr><a:noAutofit/></a:bodyPr>";
        let props = parse_body_props(xml);
        assert_eq!(props.autofit, Some(TextAutofit::NoAutofit));
    }

    #[test]
    fn parse_body_props_autofit_normal() {
        let xml =
            b"<a:bodyPr><a:normAutofit fontScale=\"90000\" lnSpcReduction=\"10000\"/></a:bodyPr>";
        let props = parse_body_props(xml);
        assert_eq!(
            props.autofit,
            Some(TextAutofit::NormalAutofit {
                font_scale: Some(90000),
                line_space_reduction: Some(10000),
            })
        );
    }

    #[test]
    fn parse_body_props_autofit_shape() {
        let xml = b"<a:bodyPr><a:spAutoFit/></a:bodyPr>";
        let props = parse_body_props(xml);
        assert_eq!(props.autofit, Some(TextAutofit::ShapeAutofit));
    }

    #[test]
    fn parse_body_props_all_vert_types() {
        let cases = [
            ("horz", TextVerticalType::Horizontal),
            ("vert", TextVerticalType::Vertical),
            ("vert270", TextVerticalType::Vertical270),
            ("wordArtVert", TextVerticalType::WordArtVert),
            ("eaVert", TextVerticalType::EastAsianVert),
            ("mongolianVert", TextVerticalType::MongolianVert),
            ("wordArtVertRtl", TextVerticalType::WordArtVertRtl),
        ];
        for (val, expected) in &cases {
            let xml = format!("<a:bodyPr vert=\"{}\"/>", val);
            let props = parse_body_props(xml.as_bytes());
            assert_eq!(props.vert, Some(*expected), "Failed for vert=\"{}\"", val);
        }
    }

    // ── Run properties expansion tests ────────────────────────────

    #[test]
    fn parse_run_props_kerning() {
        let xml = b"<a:rPr kern=\"1200\"/>";
        let props = parse_run_props(xml);
        assert_eq!(
            props.kern,
            Some(StTextNonNegativePoint::new_unchecked(1200))
        );
    }

    #[test]
    fn parse_run_props_caps() {
        let xml = b"<a:rPr cap=\"all\"/>";
        let props = parse_run_props(xml);
        assert_eq!(props.cap, Some(TextCapsType::All));
    }

    #[test]
    fn parse_run_props_spacing_baseline() {
        let xml = b"<a:rPr spc=\"200\" baseline=\"30000\"/>";
        let props = parse_run_props(xml);
        assert_eq!(props.spacing, Some(StTextPoint::new(200)));
        assert_eq!(props.baseline, Some(StPercentage::new(30000)));
    }

    #[test]
    fn parse_run_props_lang() {
        let xml = b"<a:rPr lang=\"en-US\" altLang=\"ja-JP\"/>";
        let props = parse_run_props(xml);
        assert_eq!(props.lang, Some("en-US".to_string()));
        assert_eq!(props.alt_lang, Some("ja-JP".to_string()));
    }

    #[test]
    fn parse_run_props_fonts_all() {
        let xml = br#"<a:rPr><a:latin typeface="Calibri" panose="020F0502020204030204"/><a:ea typeface="MS Gothic"/><a:cs typeface="Arial" charset="0"/><a:sym typeface="Symbol"/></a:rPr>"#;
        let props = parse_run_props(xml);
        let latin = props.latin.unwrap();
        assert_eq!(latin.typeface, "Calibri");
        assert_eq!(latin.panose, Some("020F0502020204030204".to_string()));
        let ea = props.ea.unwrap();
        assert_eq!(ea.typeface, "MS Gothic");
        let cs = props.cs.unwrap();
        assert_eq!(cs.typeface, "Arial");
        assert_eq!(cs.charset, Some(0));
        let sym = props.sym.unwrap();
        assert_eq!(sym.typeface, "Symbol");
    }

    #[test]
    fn parse_run_props_hyperlink() {
        let xml = br#"<a:rPr><a:hlinkClick r:id="rId1" tooltip="Click me"/></a:rPr>"#;
        let props = parse_run_props(xml);
        let hlink = props.hlink_click.unwrap();
        assert_eq!(hlink.r_id, Some("rId1".to_string()));
        assert_eq!(hlink.tooltip, Some("Click me".to_string()));
    }

    #[test]
    fn parse_run_props_hyperlink_mouse_over() {
        let xml =
            br#"<a:rPr><a:hlinkMouseOver r:id="rId2" action="ppaction://hlinksldjump"/></a:rPr>"#;
        let props = parse_run_props(xml);
        let hlink = props.hlink_mouse_over.unwrap();
        assert_eq!(hlink.r_id, Some("rId2".to_string()));
        assert_eq!(hlink.action, Some("ppaction://hlinksldjump".to_string()));
    }

    #[test]
    fn parse_run_props_bool_flags() {
        let xml = b"<a:rPr kumimoji=\"1\" normalizeH=\"true\" noProof=\"1\" dirty=\"0\" err=\"1\" smtClean=\"true\" smtId=\"42\" bmk=\"bookmark1\"/>";
        let props = parse_run_props(xml);
        assert_eq!(props.kumimoji, Some(true));
        assert_eq!(props.normalize_h, Some(true));
        assert_eq!(props.no_proof, Some(true));
        assert_eq!(props.dirty, Some(false));
        assert_eq!(props.err, Some(true));
        assert_eq!(props.smt_clean, Some(true));
        assert_eq!(props.smt_id, Some(42));
        assert_eq!(props.bmk, Some("bookmark1".to_string()));
    }

    #[test]
    fn parse_run_props_underline_types() {
        let cases = [
            ("sng", TextUnderlineType::Single),
            ("dbl", TextUnderlineType::Double),
            ("heavy", TextUnderlineType::Heavy),
            ("dotted", TextUnderlineType::Dotted),
            ("dash", TextUnderlineType::Dash),
            ("wavyHeavy", TextUnderlineType::WavyHeavy),
        ];
        for (val, expected) in &cases {
            let xml = format!("<a:rPr u=\"{}\"/>", val);
            let props = parse_run_props(xml.as_bytes());
            assert_eq!(props.underline, Some(*expected), "Failed for u=\"{}\"", val);
        }
    }

    #[test]
    fn parse_run_props_strike_types() {
        let xml_single = b"<a:rPr strike=\"sngStrike\"/>";
        let props_single = parse_run_props(xml_single);
        assert_eq!(props_single.strike, Some(TextStrikeType::SingleStrike));

        let xml_double = b"<a:rPr strike=\"dblStrike\"/>";
        let props_double = parse_run_props(xml_double);
        assert_eq!(props_double.strike, Some(TextStrikeType::DoubleStrike));
    }

    #[test]
    fn parse_run_props_highlight() {
        let xml = br#"<a:rPr><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr>"#;
        let props = parse_run_props(xml);
        let hl = props.highlight.unwrap();
        match &hl {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FFFF00"),
            other => panic!("Expected SrgbClr, got {other:?}"),
        }
    }

    #[test]
    fn parse_run_props_underline_line_follow_text() {
        let xml = b"<a:rPr><a:uLnTx/></a:rPr>";
        let props = parse_run_props(xml);
        assert!(matches!(
            props.underline_line,
            Some(UnderlineLine::FollowText)
        ));
    }

    #[test]
    fn parse_run_props_underline_fill_follow_text() {
        let xml = b"<a:rPr><a:uFillTx/></a:rPr>";
        let props = parse_run_props(xml);
        assert!(matches!(
            props.underline_fill,
            Some(UnderlineFill::FollowText)
        ));
    }

    // ── Paragraph properties expansion tests ─────────────────────

    #[test]
    fn parse_para_props_all_alignments() {
        let cases = [
            ("l", TextAlign::Left),
            ("ctr", TextAlign::Center),
            ("r", TextAlign::Right),
            ("just", TextAlign::Justify),
            ("justLow", TextAlign::JustifyLow),
            ("dist", TextAlign::Distributed),
            ("thaiDist", TextAlign::ThaiDistributed),
        ];
        for (val, expected) in &cases {
            let xml = format!("<a:pPr algn=\"{}\"/>", val);
            let props = parse_para_props(xml.as_bytes());
            assert_eq!(props.align, Some(*expected), "Failed for algn=\"{}\"", val);
        }
    }

    #[test]
    fn parse_para_props_level_rtl() {
        let xml = b"<a:pPr lvl=\"2\" rtl=\"1\"/>";
        let props = parse_para_props(xml);
        assert_eq!(props.level, Some(StTextIndentLevelType::new_clamped(2)));
        assert_eq!(props.rtl, Some(true));
    }

    #[test]
    fn parse_para_props_line_spacing_percent() {
        let xml = b"<a:pPr><a:lnSpc><a:spcPct val=\"150000\"/></a:lnSpc></a:pPr>";
        let props = parse_para_props(xml);
        assert_eq!(props.line_spacing, Some(TextSpacing::Percent(150000)));
    }

    #[test]
    fn parse_para_props_line_spacing_points() {
        let xml = b"<a:pPr><a:lnSpc><a:spcPts val=\"1200\"/></a:lnSpc></a:pPr>";
        let props = parse_para_props(xml);
        assert_eq!(props.line_spacing, Some(TextSpacing::Points(1200)));
    }

    #[test]
    fn parse_para_props_space_before_after() {
        let xml = b"<a:pPr><a:spcBef><a:spcPts val=\"600\"/></a:spcBef><a:spcAft><a:spcPct val=\"50000\"/></a:spcAft></a:pPr>";
        let props = parse_para_props(xml);
        assert_eq!(props.space_before, Some(TextSpacing::Points(600)));
        assert_eq!(props.space_after, Some(TextSpacing::Percent(50000)));
    }

    #[test]
    fn parse_para_props_bullet_char() {
        let xml = br#"<a:pPr><a:buChar char="&#x2022;"/></a:pPr>"#;
        let props = parse_para_props(xml);
        let bullet = props.bullet.unwrap();
        assert!(matches!(bullet.bullet_type, Some(BulletType::Char(_))));
    }

    #[test]
    fn parse_para_props_bullet_auto_num() {
        let xml = br#"<a:pPr><a:buAutoNum type="arabicPeriod" startAt="5"/></a:pPr>"#;
        let props = parse_para_props(xml);
        let bullet = props.bullet.unwrap();
        match bullet.bullet_type {
            Some(BulletType::AutoNum { scheme, start_at }) => {
                assert_eq!(scheme, TextAutonumberType::ArabicPeriod);
                assert_eq!(start_at, Some(5));
            }
            _ => panic!("Expected AutoNum bullet"),
        }
    }

    #[test]
    fn parse_para_props_bullet_none() {
        let xml = b"<a:pPr><a:buNone/></a:pPr>";
        let props = parse_para_props(xml);
        let bullet = props.bullet.unwrap();
        assert!(matches!(bullet.bullet_type, Some(BulletType::None)));
    }

    #[test]
    fn parse_para_props_bullet_color_size() {
        let xml = br#"<a:pPr><a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buSzPct val="75000"/></a:pPr>"#;
        let props = parse_para_props(xml);
        let bullet = props.bullet.unwrap();
        match &bullet.color {
            Some(BulletColor::Custom(c)) => match c {
                DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
                other => panic!("Expected SrgbClr, got {other:?}"),
            },
            _ => panic!("Expected custom bullet color"),
        }
        assert_eq!(bullet.size, Some(BulletSize::Percent(75000)));
    }

    #[test]
    fn parse_para_props_bullet_follow_text() {
        let xml = b"<a:pPr><a:buClrTx/><a:buSzTx/></a:pPr>";
        let props = parse_para_props(xml);
        let bullet = props.bullet.unwrap();
        assert!(matches!(bullet.color, Some(BulletColor::FollowText)));
        assert!(matches!(bullet.size, Some(BulletSize::FollowText)));
    }

    #[test]
    fn parse_para_props_def_run_props() {
        let xml = b"<a:pPr><a:defRPr sz=\"1400\" b=\"1\"/></a:pPr>";
        let props = parse_para_props(xml);
        let drp = props.def_run_props.unwrap();
        assert_eq!(drp.size, Some(StTextFontSize::new_unchecked(1400)));
        assert_eq!(drp.bold, Some(true));
    }

    #[test]
    fn parse_para_props_tab_stops() {
        let xml = br#"<a:pPr><a:tabLst><a:tab pos="914400" algn="ctr"/><a:tab pos="1828800" algn="r"/></a:tabLst></a:pPr>"#;
        let props = parse_para_props(xml);
        let tabs = props.tab_list.unwrap();
        assert_eq!(tabs.len(), 2);
        assert_eq!(tabs[0].position, Some(914400));
        assert_eq!(tabs[0].align, Some(TextTabAlignType::Center));
        assert_eq!(tabs[1].position, Some(1828800));
        assert_eq!(tabs[1].align, Some(TextTabAlignType::Right));
    }

    #[test]
    fn parse_para_props_font_align() {
        let xml = b"<a:pPr fontAlgn=\"ctr\"/>";
        let props = parse_para_props(xml);
        assert_eq!(props.font_align, Some(TextFontAlignType::Center));
    }

    #[test]
    fn parse_para_props_ea_ln_brk() {
        let xml = b"<a:pPr eaLnBrk=\"1\" latinLnBrk=\"0\" hangingPunct=\"1\"/>";
        let props = parse_para_props(xml);
        assert_eq!(props.ea_ln_brk, Some(true));
        assert_eq!(props.latin_ln_brk, Some(false));
        assert_eq!(props.hanging_punct, Some(true));
    }

    #[test]
    fn parse_para_props_def_tab_sz() {
        let xml = b"<a:pPr defTabSz=\"914400\"/>";
        let props = parse_para_props(xml);
        assert_eq!(props.def_tab_sz, Some(914400));
    }

    // ── Paragraph content expansion tests ────────────────────────

    #[test]
    fn parse_paragraph_line_break() {
        let xml = b"<a:p><a:br><a:rPr sz=\"1200\"/></a:br></a:p>";
        let para = parse_paragraph(xml).unwrap();
        assert_eq!(para.runs.len(), 1);
        match &para.runs[0] {
            TextRunContent::LineBreak { props } => {
                assert_eq!(
                    props.as_ref().unwrap().size,
                    Some(StTextFontSize::new_unchecked(1200))
                );
            }
            _ => panic!("Expected LineBreak"),
        }
    }

    #[test]
    fn parse_paragraph_field() {
        let xml = br#"<a:p><a:fld id="{B5C1F7C2-1234-5678-ABCD-123456789ABC}" type="slidenum"><a:rPr lang="en-US"/><a:t>42</a:t></a:fld></a:p>"#;
        let para = parse_paragraph(xml).unwrap();
        let found_field = para
            .runs
            .iter()
            .any(|r| matches!(r, TextRunContent::Field { .. }));
        assert!(found_field, "Expected a Field run");
        for run in &para.runs {
            if let TextRunContent::Field {
                id,
                field_type,
                text,
                run_props,
                ..
            } = run
            {
                assert_eq!(id, "{B5C1F7C2-1234-5678-ABCD-123456789ABC}");
                assert_eq!(field_type.as_deref(), Some("slidenum"));
                assert_eq!(text.as_deref(), Some("42"));
                assert!(run_props.is_some());
            }
        }
    }

    #[test]
    fn parse_paragraph_end_para_rpr() {
        let xml = b"<a:p><a:endParaRPr lang=\"en-US\" sz=\"1100\"/></a:p>";
        let para = parse_paragraph(xml).unwrap();
        let epr = para.end_para_rpr.unwrap();
        assert_eq!(epr.lang, Some("en-US".to_string()));
        assert_eq!(epr.size, Some(StTextFontSize::new_unchecked(1100)));
    }

    // ── List style tests ─────────────────────────────────────────

    #[test]
    fn parse_list_style_basic() {
        let xml = br#"<a:lstStyle><a:defPPr algn="ctr"><a:defRPr sz="1200"/></a:defPPr><a:lvl1pPr algn="l"/><a:lvl2pPr algn="r"/></a:lstStyle>"#;
        let style = parse_list_style(xml).unwrap();
        let def = style.def_ppr.unwrap();
        assert_eq!(def.align, Some(TextAlign::Center));
        let drp = def.def_run_props.unwrap();
        assert_eq!(drp.size, Some(StTextFontSize::new_unchecked(1200)));
        let lvl1 = style.level_ppr[0].as_ref().unwrap();
        assert_eq!(lvl1.align, Some(TextAlign::Left));
        let lvl2 = style.level_ppr[1].as_ref().unwrap();
        assert_eq!(lvl2.align, Some(TextAlign::Right));
        assert!(style.level_ppr[2].is_none());
    }

    #[test]
    fn parse_list_style_empty() {
        let xml = b"<a:lstStyle/>";
        let style = parse_list_style(xml);
        // Empty lstStyle is still Some (preserves the element for round-trip)
        assert!(style.is_some());
        let s = style.unwrap();
        assert!(s.def_ppr.is_none());
        assert!(s.level_ppr.iter().all(|l| l.is_none()));
    }

    // ── Text body integration tests ──────────────────────────────

    #[test]
    fn parse_text_body_with_list_style() {
        let xml = br#"<a:txBody><a:bodyPr wrap="square"/><a:lstStyle><a:lvl1pPr algn="ctr"/></a:lstStyle><a:p><a:r><a:t>Hello</a:t></a:r></a:p></a:txBody>"#;
        let body = parse_text_body(xml).unwrap();
        assert!(body.list_style.is_some());
        let style = body.list_style.unwrap();
        assert_eq!(
            style.level_ppr[0].as_ref().unwrap().align,
            Some(TextAlign::Center)
        );
        assert_eq!(body.paragraphs.len(), 1);
    }

    // ── Edge case tests ──────────────────────────────────────────

    #[test]
    fn parse_run_props_empty_element() {
        let xml = b"<a:rPr/>";
        let props = parse_run_props(xml);
        assert!(props.size.is_none());
        assert!(props.bold.is_none());
        assert!(props.latin.is_none());
        assert!(props.color.is_none());
    }

    #[test]
    fn parse_para_props_empty_element() {
        let xml = b"<a:pPr/>";
        let props = parse_para_props(xml);
        assert!(props.align.is_none());
        assert!(props.bullet.is_none());
        assert!(props.line_spacing.is_none());
    }

    #[test]
    fn parse_body_props_empty_element() {
        let xml = b"<a:bodyPr/>";
        let props = parse_body_props(xml);
        assert!(props.rot.is_none());
        assert!(props.vert.is_none());
        assert!(props.autofit.is_none());
    }

    #[test]
    fn parse_paragraph_empty() {
        let xml = b"<a:p></a:p>";
        let para = parse_paragraph(xml).unwrap();
        assert!(para.runs.is_empty());
        assert!(para.end_para_rpr.is_none());
    }

    #[test]
    fn parse_run_props_text_fill_solid() {
        let xml = br#"<a:rPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr>"#;
        let props = parse_run_props(xml);
        // color should be set from solidFill
        match props.color.as_ref().unwrap() {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
            other => panic!("Expected SrgbClr, got {other:?}"),
        }
        // text_fill should also be set
        match &props.text_fill {
            Some(Fill::Solid(sf)) => match &sf.color {
                DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
                other => panic!("Expected SrgbClr, got {other:?}"),
            },
            _ => panic!("Expected solid text fill"),
        }
    }

    #[test]
    fn parse_run_props_no_fill() {
        let xml = b"<a:rPr><a:noFill/></a:rPr>";
        let props = parse_run_props(xml);
        assert!(matches!(props.text_fill, Some(Fill::NoFill)));
    }

    #[test]
    fn parse_bullet_size_points() {
        let xml = b"<a:pPr><a:buSzPts val=\"1600\"/><a:buChar char=\"-\"/></a:pPr>";
        let props = parse_para_props(xml);
        let bullet = props.bullet.unwrap();
        assert_eq!(bullet.size, Some(BulletSize::Points(1600)));
    }

    #[test]
    fn parse_bullet_font() {
        let xml = br#"<a:pPr><a:buFont typeface="Wingdings"/><a:buChar char="q"/></a:pPr>"#;
        let props = parse_para_props(xml);
        let bullet = props.bullet.unwrap();
        let font = bullet.font.unwrap();
        assert_eq!(font.typeface, "Wingdings");
    }
}
