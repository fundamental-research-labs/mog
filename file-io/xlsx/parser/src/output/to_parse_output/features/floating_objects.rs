use super::*;

// =============================================================================
// Domain conversions: Floating objects (from parsed drawings)
// =============================================================================

/// EMUs per pixel at 96 DPI (standard screen resolution).
const EMUS_PER_PIXEL: i64 = 9525;
const EMUS_PER_POINT: f64 = 12_700.0;
const DEFAULT_OUTLINE_WIDTH_PT: f64 = 0.75;
const STANDARD_CHART_GRAPHIC_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const CHART_EX_GRAPHIC_URI: &str = "http://schemas.microsoft.com/office/drawing/2014/chartex";

fn is_chart_graphic_frame(gf: &ooxml_types::drawings::SpreadsheetGraphicFrame) -> bool {
    gf.graphic_xml.as_deref().is_some_and(|xml| {
        xml.contains(STANDARD_CHART_GRAPHIC_URI) || xml.contains(CHART_EX_GRAPHIC_URI)
    })
}

fn normalize_hex_color(value: &str) -> Option<String> {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() != 6 || !hex.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    Some(format!("#{hex}").to_uppercase())
}

fn alpha_transparency(transforms: &[ooxml_types::drawings::ColorTransform]) -> Option<f64> {
    let mut alpha = 100_000.0;
    let mut touched = false;

    for transform in transforms {
        match transform {
            ooxml_types::drawings::ColorTransform::Alpha { val } => {
                alpha = *val as f64;
                touched = true;
            }
            ooxml_types::drawings::ColorTransform::AlphaMod { val } => {
                alpha *= *val as f64 / 100_000.0;
                touched = true;
            }
            ooxml_types::drawings::ColorTransform::AlphaOff { val } => {
                alpha += *val as f64;
                touched = true;
            }
            _ => {}
        }
    }

    touched.then(|| (1.0 - (alpha / 100_000.0).clamp(0.0, 1.0)).clamp(0.0, 1.0))
}

fn preset_color_hex(val: ooxml_types::drawings::PresetColorVal) -> Option<&'static str> {
    use ooxml_types::drawings::PresetColorVal;

    match val {
        PresetColorVal::Black => Some("#000000"),
        PresetColorVal::White => Some("#FFFFFF"),
        PresetColorVal::Red => Some("#FF0000"),
        PresetColorVal::Green => Some("#008000"),
        PresetColorVal::Blue => Some("#0000FF"),
        PresetColorVal::Yellow => Some("#FFFF00"),
        PresetColorVal::Cyan | PresetColorVal::Aqua => Some("#00FFFF"),
        PresetColorVal::Magenta | PresetColorVal::Fuchsia => Some("#FF00FF"),
        _ => None,
    }
}

fn scheme_color_hex(val: ooxml_types::drawings::SchemeColor) -> Option<&'static str> {
    use ooxml_types::drawings::SchemeColor;

    match val {
        SchemeColor::Dk1 | SchemeColor::Tx1 => Some("#000000"),
        SchemeColor::Lt1 | SchemeColor::Bg1 => Some("#FFFFFF"),
        SchemeColor::Dk2 | SchemeColor::Tx2 => Some("#1F497D"),
        SchemeColor::Lt2 | SchemeColor::Bg2 => Some("#EEECE1"),
        SchemeColor::Accent1 => Some("#4472C4"),
        SchemeColor::Accent2 => Some("#ED7D31"),
        SchemeColor::Accent3 => Some("#A5A5A5"),
        SchemeColor::Accent4 => Some("#FFC000"),
        SchemeColor::Accent5 => Some("#5B9BD5"),
        SchemeColor::Accent6 => Some("#70AD47"),
        SchemeColor::Hlink => Some("#0563C1"),
        SchemeColor::FolHlink => Some("#954F72"),
        SchemeColor::PhClr => None,
    }
}

fn resolve_drawing_color(
    color: &ooxml_types::drawings::DrawingColor,
) -> Option<(String, Option<f64>)> {
    use ooxml_types::drawings::DrawingColor;

    match color {
        DrawingColor::SrgbClr { val, transforms } => Some((
            normalize_hex_color(val)?,
            alpha_transparency(transforms.as_slice()),
        )),
        DrawingColor::SysClr {
            last_clr: Some(last_clr),
            transforms,
            ..
        } => Some((
            normalize_hex_color(last_clr)?,
            alpha_transparency(transforms.as_slice()),
        )),
        DrawingColor::PrstClr { val, transforms } => Some((
            preset_color_hex(*val)?.to_string(),
            alpha_transparency(transforms.as_slice()),
        )),
        DrawingColor::SchemeClr { val, transforms } => Some((
            scheme_color_hex(*val)?.to_string(),
            alpha_transparency(transforms.as_slice()),
        )),
        _ => None,
    }
}

fn project_drawing_fill(
    fill: &ooxml_types::drawings::DrawingFill,
) -> Option<domain_types::domain::floating_object::ObjectFill> {
    use domain_types::domain::floating_object::{FillType, ObjectFill};
    use ooxml_types::drawings::DrawingFill;

    match fill {
        DrawingFill::NoFill => Some(ObjectFill {
            fill_type: FillType::None,
            ..ObjectFill::default()
        }),
        DrawingFill::Solid(solid) => {
            let (color, transparency) = resolve_drawing_color(&solid.color)?;
            Some(ObjectFill {
                fill_type: FillType::Solid,
                color: Some(color),
                transparency,
                ..ObjectFill::default()
            })
        }
        _ => None,
    }
}

fn project_line_fill(
    fill: &ooxml_types::drawings::LineFill,
) -> Option<(
    domain_types::domain::floating_object::OutlineStyle,
    String,
    Option<f64>,
    bool,
)> {
    use domain_types::domain::floating_object::OutlineStyle;
    use ooxml_types::drawings::LineFill;

    match fill {
        LineFill::NoFill => Some((OutlineStyle::None, String::new(), None, false)),
        LineFill::Solid(solid) => {
            let (color, transparency) = resolve_drawing_color(&solid.color)?;
            Some((OutlineStyle::Solid, color, transparency, true))
        }
        _ => None,
    }
}

fn project_line_dash(
    dash: &ooxml_types::drawings::LineDash,
) -> (
    domain_types::domain::floating_object::OutlineStyle,
    Option<domain_types::domain::text_effects::LineDash>,
) {
    use domain_types::domain::floating_object::OutlineStyle;
    use domain_types::domain::text_effects::LineDash as DomainLineDash;
    use ooxml_types::drawings::{DashStyle, LineDash};

    let preset = match dash {
        LineDash::Preset(preset) => preset,
        LineDash::Custom(_) => return (OutlineStyle::Dashed, None),
    };

    match preset {
        DashStyle::Solid => (OutlineStyle::Solid, Some(DomainLineDash::Solid)),
        DashStyle::Dot | DashStyle::SystemDot => (OutlineStyle::Dotted, Some(DomainLineDash::Dot)),
        DashStyle::Dash | DashStyle::SystemDash => {
            (OutlineStyle::Dashed, Some(DomainLineDash::Dash))
        }
        DashStyle::DashDot | DashStyle::SystemDashDot => {
            (OutlineStyle::Dashed, Some(DomainLineDash::DashDot))
        }
        DashStyle::LongDash => (OutlineStyle::Dashed, Some(DomainLineDash::LgDash)),
        DashStyle::LongDashDot => (OutlineStyle::Dashed, Some(DomainLineDash::LgDashDot)),
        DashStyle::LongDashDotDot => (OutlineStyle::Dashed, Some(DomainLineDash::LgDashDotDot)),
        DashStyle::SystemDashDotDot => (OutlineStyle::Dashed, Some(DomainLineDash::SysDashDotDot)),
    }
}

fn project_compound_line(
    compound: ooxml_types::drawings::CompoundLine,
) -> domain_types::domain::floating_object::CompoundLineStyle {
    use domain_types::domain::floating_object::CompoundLineStyle;
    use ooxml_types::drawings::CompoundLine;

    match compound {
        CompoundLine::Single => CompoundLineStyle::Single,
        CompoundLine::Double => CompoundLineStyle::Double,
        CompoundLine::ThickThin => CompoundLineStyle::ThickThin,
        CompoundLine::ThinThick => CompoundLineStyle::ThinThick,
        CompoundLine::Triple => CompoundLineStyle::Triple,
    }
}

fn project_shape_outline(
    outline: &ooxml_types::drawings::Outline,
) -> Option<domain_types::domain::floating_object::ShapeOutline> {
    use domain_types::domain::floating_object::{OutlineStyle, ShapeOutline};

    let (mut style, color, transparency, visible) = match outline.fill.as_ref() {
        Some(fill) => project_line_fill(fill)?,
        None => (OutlineStyle::Solid, String::from("#000000"), None, true),
    };

    let dash = outline.dash.as_ref().and_then(|dash| {
        let (dash_style, dash) = project_line_dash(dash);
        if style != OutlineStyle::None {
            style = dash_style;
        }
        dash
    });

    Some(ShapeOutline {
        style,
        color,
        width: outline
            .width
            .map(|width| width as f64 / EMUS_PER_POINT)
            .unwrap_or(DEFAULT_OUTLINE_WIDTH_PT),
        dash,
        transparency,
        compound: outline.compound.map(project_compound_line),
        visible: Some(visible),
        ..ShapeOutline::default()
    })
}

fn resolve_media_data_url(
    media_data_urls: &HashMap<String, String>,
    target: &str,
) -> Option<String> {
    if let Some(data_url) = media_data_urls.get(target) {
        return Some(data_url.clone());
    }

    let normalized = target.replace('\\', "/");
    if let Some(data_url) = media_data_urls.get(&normalized) {
        return Some(data_url.clone());
    }

    if let Some(stripped) = normalized.strip_prefix("../") {
        let workbook_relative = format!("xl/{stripped}");
        if let Some(data_url) = media_data_urls.get(&workbook_relative) {
            return Some(data_url.clone());
        }
    }

    if normalized.starts_with("media/") {
        let workbook_relative = format!("xl/{normalized}");
        if let Some(data_url) = media_data_urls.get(&workbook_relative) {
            return Some(data_url.clone());
        }
    }

    normalized
        .rsplit('/')
        .next()
        .and_then(|file_name| media_data_urls.get(file_name).cloned())
}

/// Convert parsed drawing anchors into unified `FloatingObject` items.
///
/// Extracts pictures and shapes from the parser's structured `Drawing` type.
/// Charts, connectors, SmartArt, and graphic frames are handled by their own
/// dedicated conversion paths and are skipped here to avoid double-counting.
pub(crate) fn convert_floating_objects(
    drawing: Option<&Drawing>,
    media_data_urls: &HashMap<String, String>,
) -> Vec<FloatingObject> {
    let drawing = match drawing {
        Some(d) => d,
        None => return Vec::new(),
    };

    let mut objects = Vec::new();

    for (idx, anchor) in drawing.anchors.iter().enumerate() {
        let (fobj_anchor, extent_emu, content, client_data, anchor_edit_as) = match anchor {
            DrawingAnchor::TwoCell(tc) => {
                let a = FloatingObjectAnchor {
                    anchor_row: tc.from.row,
                    anchor_col: tc.from.col,
                    anchor_row_offset: tc.from.row_off,
                    anchor_col_offset: tc.from.col_off,
                    anchor_mode: tc
                        .edit_as
                        .as_ref()
                        .map(|e| match e.to_ooxml() {
                            "oneCell" => AnchorMode::OneCell,
                            "absolute" => AnchorMode::Absolute,
                            _ => AnchorMode::TwoCell,
                        })
                        .unwrap_or(AnchorMode::TwoCell),
                    absolute_x: None,
                    absolute_y: None,
                    end_row: Some(tc.to.row),
                    end_col: Some(tc.to.col),
                    end_row_offset: Some(tc.to.row_off),
                    end_col_offset: Some(tc.to.col_off),
                    extent_cx: None,
                    extent_cy: None,
                };
                let ea = tc.edit_as.as_ref().map(|e| e.to_ooxml().to_string());
                (a, None, &tc.content, &tc.client_data, ea)
            }
            DrawingAnchor::OneCell(oc) => {
                let a = FloatingObjectAnchor {
                    anchor_row: oc.from.row,
                    anchor_col: oc.from.col,
                    anchor_row_offset: oc.from.row_off,
                    anchor_col_offset: oc.from.col_off,
                    anchor_mode: AnchorMode::OneCell,
                    absolute_x: None,
                    absolute_y: None,
                    end_row: None,
                    end_col: None,
                    end_row_offset: None,
                    end_col_offset: None,
                    extent_cx: Some(oc.extent.cx),
                    extent_cy: Some(oc.extent.cy),
                };
                (
                    a,
                    Some((oc.extent.cx, oc.extent.cy)),
                    &oc.content,
                    &oc.client_data,
                    None,
                )
            }
            DrawingAnchor::Absolute(abs) => {
                let a = FloatingObjectAnchor {
                    anchor_row: 0,
                    anchor_col: 0,
                    anchor_row_offset: 0,
                    anchor_col_offset: 0,
                    anchor_mode: AnchorMode::Absolute,
                    absolute_x: Some(abs.pos.x),
                    absolute_y: Some(abs.pos.y),
                    end_row: None,
                    end_col: None,
                    end_row_offset: None,
                    end_col_offset: None,
                    extent_cx: Some(abs.extent.cx),
                    extent_cy: Some(abs.extent.cy),
                };
                (
                    a,
                    Some((abs.extent.cx, abs.extent.cy)),
                    &abs.content,
                    &abs.client_data,
                    Some("absolute".to_string()),
                )
            }
        };

        // Collect anchor-level bookkeeping that applies to all object types.
        let mc_alt_raw = if let DrawingAnchor::TwoCell(tc) = anchor {
            tc.mc_alternate_content
                .as_ref()
                .map(|mc| mc.raw_xml.clone())
        } else {
            None
        };
        let cd_locks = if !client_data.locks_with_sheet {
            Some(false)
        } else {
            None
        };
        let cd_prints = if !client_data.prints_with_sheet {
            Some(false)
        } else {
            None
        };

        // Build per-type data and extract common metadata from drawing content.
        let (data, name, rotation, flip_h, flip_v, locked, visible) = match content {
            DrawingContent::Picture(pic) => {
                let nv = &pic.nv_pic_pr.c_nv_pr;
                let xfrm = pic.sp_pr.xfrm.as_ref();
                let rot = xfrm
                    .and_then(|t| t.rotation)
                    .map(|a| a.value() as f64 / 60_000.0)
                    .unwrap_or(0.0);
                let fh = xfrm.and_then(|t| t.flip_h).unwrap_or(false);
                let fv = xfrm.and_then(|t| t.flip_v).unwrap_or(false);
                // Extract image relationship info
                let image_path = pic.blip_fill.embed_id.as_deref().and_then(|embed_id| {
                    drawing
                        .opc_rels
                        .iter()
                        .find(|r| r.id == embed_id)
                        .map(|r| r.target.clone())
                });
                let relationships = picture_relationships(pic, &drawing.opc_rels);

                // Build typed ooxml props — no more JSON blob!
                let ooxml_props = PictureOoxmlProps {
                    picture: pic.clone(),
                    anchor_index: Some(idx as i32),
                    extent_emu_cx: extent_emu.map(|(cx, _)| cx),
                    extent_emu_cy: extent_emu.map(|(_, cy)| cy),
                    edit_as: anchor_edit_as.clone(),
                    client_data_locks_with_sheet: cd_locks,
                    client_data_prints_with_sheet: cd_prints,
                    mc_alternate_content_raw_xml: mc_alt_raw.clone(),
                    image_path: image_path.clone(),
                    relationships,
                };

                let src = image_path
                    .as_deref()
                    .and_then(|path| resolve_media_data_url(media_data_urls, path))
                    .unwrap_or_else(|| image_path.clone().unwrap_or_default());
                let data = FloatingObjectData::Picture(PictureData {
                    src,
                    original_width: None,
                    original_height: None,
                    crop: None,
                    adjustments: None,
                    border: None,
                    color_type: None,
                    ooxml: Some(ooxml_props),
                });
                (
                    data,
                    Some(nv.name.clone()),
                    rot,
                    fh,
                    fv,
                    pic.nv_pic_pr.locks.no_move,
                    !nv.hidden,
                )
            }
            DrawingContent::Shape(shp) => {
                let nv = &shp.nv_sp_pr.c_nv_pr;
                let xfrm = shp.sp_pr.xfrm.as_ref();
                let rot = xfrm
                    .and_then(|t| t.rotation)
                    .map(|a| a.value() as f64 / 60_000.0)
                    .unwrap_or(0.0);
                let fh = xfrm.and_then(|t| t.flip_h).unwrap_or(false);
                let fv = xfrm.and_then(|t| t.flip_v).unwrap_or(false);

                // Build typed ooxml props — no more JSON blob!
                let shape_ooxml = ShapeOoxmlProps {
                    shape: shp.clone(),
                    anchor_index: Some(idx as i32),
                    extent_emu_cx: extent_emu.map(|(cx, _)| cx),
                    extent_emu_cy: extent_emu.map(|(_, cy)| cy),
                    edit_as: anchor_edit_as.clone(),
                    client_data_locks_with_sheet: cd_locks,
                    client_data_prints_with_sheet: cd_prints,
                    mc_alternate_content_raw_xml: mc_alt_raw.clone(),
                    group_shape: None,
                };

                // Extract preset type for shape_type field
                let preset_type = shp
                    .sp_pr
                    .geometry
                    .as_ref()
                    .and_then(|g| match g {
                        ooxml_types::drawings::ShapeGeometry::Preset(pg) => {
                            Some(pg.prst.to_ooxml().to_string())
                        }
                        _ => None,
                    })
                    .unwrap_or_else(|| "rect".to_string());

                // Determine if this is a textbox
                let is_textbox = shp.nv_sp_pr.tx_box;
                let projected_fill = shp.sp_pr.fill.as_ref().and_then(project_drawing_fill);
                let projected_outline = shp.sp_pr.ln.as_ref().and_then(project_shape_outline);

                let text_content = shp.tx_body.as_ref().and_then(|tb| {
                    let text: String = tb
                        .paragraphs
                        .iter()
                        .map(|p| {
                            p.runs
                                .iter()
                                .filter_map(|r| match r {
                                    ooxml_types::drawings::TextRunContent::Run(run) => {
                                        Some(run.text.as_str())
                                    }
                                    _ => None,
                                })
                                .collect::<Vec<_>>()
                                .join("")
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    if text.is_empty() { None } else { Some(text) }
                });

                let data = if is_textbox {
                    FloatingObjectData::Textbox(
                        domain_types::domain::floating_object::TextboxData {
                            text: text_content.map(|c| {
                                domain_types::domain::floating_object::ShapeText {
                                    content: c,
                                    format: None,
                                    runs: None,
                                    vertical_align: None,
                                    horizontal_align: None,
                                    margins: None,
                                    auto_size: None,
                                    orientation: None,
                                    reading_order: None,
                                    horizontal_overflow: None,
                                    vertical_overflow: None,
                                    text_body: None,
                                }
                            }),
                            fill: projected_fill,
                            border: projected_outline,
                            text_effects: None,
                            ooxml: Some(shape_ooxml),
                        },
                    )
                } else {
                    FloatingObjectData::Shape(ShapeData {
                        shape_type: preset_type,
                        fill: projected_fill,
                        outline: projected_outline,
                        text: text_content.map(|t| {
                            domain_types::domain::floating_object::ShapeText {
                                content: t,
                                format: None,
                                runs: None,
                                vertical_align: None,
                                horizontal_align: None,
                                margins: None,
                                auto_size: None,
                                orientation: None,
                                reading_order: None,
                                horizontal_overflow: None,
                                vertical_overflow: None,
                                text_body: None,
                            }
                        }),
                        shadow: None,
                        adjustments: None,
                        scene_3d: None,
                        sp_3d: None,
                        ooxml: Some(shape_ooxml),
                    })
                };
                (
                    data,
                    Some(nv.name.clone()),
                    rot,
                    fh,
                    fv,
                    shp.nv_sp_pr.c_nv_sp_pr.no_move,
                    !nv.hidden,
                )
            }
            DrawingContent::GroupShape(grp) => {
                // Carry the full CT_GroupShape payload so children and
                // properties survive the round-trip through the unified
                // FloatingObject model. Typed replacement for the former
                // `group_json: Option<serde_json::Value>` blob.
                let group_ooxml = ShapeOoxmlProps {
                    shape: ooxml_types::drawings::SpreadsheetShape::default(),
                    anchor_index: Some(idx as i32),
                    extent_emu_cx: extent_emu.map(|(cx, _)| cx),
                    extent_emu_cy: extent_emu.map(|(_, cy)| cy),
                    edit_as: anchor_edit_as.clone(),
                    client_data_locks_with_sheet: cd_locks,
                    client_data_prints_with_sheet: cd_prints,
                    mc_alternate_content_raw_xml: mc_alt_raw.clone(),
                    group_shape: Some(grp.clone()),
                };
                let data = FloatingObjectData::Shape(ShapeData {
                    shape_type: "group".to_string(),
                    fill: None,
                    outline: None,
                    text: None,
                    shadow: None,
                    adjustments: None,
                    scene_3d: None,
                    sp_3d: None,
                    ooxml: Some(group_ooxml),
                });
                (data, None, 0.0, false, false, false, true)
            }
            DrawingContent::ContentPart(content_part) => {
                let relationships = drawing
                    .opc_rels
                    .iter()
                    .filter(|rel| rel.id == content_part.r_id)
                    .cloned()
                    .collect();
                let data = FloatingObjectData::Drawing(
                    domain_types::domain::floating_object::DrawingData {
                        ooxml: Some(
                            domain_types::domain::floating_object::DrawingObjectOoxmlProps {
                                object:
                                    domain_types::domain::floating_object::DrawingObjectOoxml::ContentPart {
                                        content_part:
                                        content_part.clone(),
                                    },
                                anchor_index: Some(idx as i32),
                                extent_emu_cx: extent_emu.map(|(cx, _)| cx),
                                extent_emu_cy: extent_emu.map(|(_, cy)| cy),
                                edit_as: anchor_edit_as.clone(),
                                client_data_locks_with_sheet: cd_locks,
                                client_data_prints_with_sheet: cd_prints,
                                relationships,
                            },
                        ),
                        ..Default::default()
                    },
                );
                (data, None, 0.0, false, false, false, true)
            }
            DrawingContent::GraphicFrame(gf) => {
                if is_chart_graphic_frame(gf) {
                    continue;
                }
                let relationship_ids = gf
                    .graphic_xml
                    .as_deref()
                    .map(crate::domain::drawings::relationship_ids_in_raw)
                    .unwrap_or_default();
                let relationships = drawing
                    .opc_rels
                    .iter()
                    .filter(|rel| relationship_ids.contains(&rel.id))
                    .cloned()
                    .collect();
                let nv = &gf.nv_graphic_frame_pr.c_nv_pr;
                let data = FloatingObjectData::Drawing(
                    domain_types::domain::floating_object::DrawingData {
                        ooxml: Some(
                            domain_types::domain::floating_object::DrawingObjectOoxmlProps {
                                object:
                                    domain_types::domain::floating_object::DrawingObjectOoxml::GraphicFrame {
                                        graphic_frame:
                                        gf.clone(),
                                    },
                                anchor_index: Some(idx as i32),
                                extent_emu_cx: extent_emu.map(|(cx, _)| cx),
                                extent_emu_cy: extent_emu.map(|(_, cy)| cy),
                                edit_as: anchor_edit_as.clone(),
                                client_data_locks_with_sheet: cd_locks,
                                client_data_prints_with_sheet: cd_prints,
                                relationships,
                            },
                        ),
                        ..Default::default()
                    },
                );
                (
                    data,
                    Some(nv.name.clone()),
                    gf.xfrm
                        .rotation
                        .map(|a| a.value() as f64 / 60_000.0)
                        .unwrap_or(0.0),
                    gf.xfrm.flip_h.unwrap_or(false),
                    gf.xfrm.flip_v.unwrap_or(false),
                    false,
                    !nv.hidden,
                )
            }
            // Charts, connectors, graphic frames, SmartArt, and unknown content
            // are handled by their own dedicated conversions.
            _ => continue,
        };

        let (width, height) = match extent_emu {
            Some((cx, cy)) => (
                (cx as f64 / EMUS_PER_PIXEL as f64).max(0.0),
                (cy as f64 / EMUS_PER_PIXEL as f64).max(0.0),
            ),
            None => (0.0, 0.0),
        };

        objects.push(FloatingObject {
            common: FloatingObjectCommon {
                id: format!("fobj-{}", idx),
                sheet_id: String::new(),
                anchor: fobj_anchor,
                width,
                height,
                z_index: idx as i32,
                rotation,
                flip_h,
                flip_v,
                locked,
                visible,
                printable: true,
                opacity: 1.0,
                name: name.filter(|n| !n.is_empty()).unwrap_or_default(),
                created_at: 0,
                updated_at: 0,
                group_id: None,
                anchor_cell_id: None,
                to_anchor_cell_id: None,
                lock_aspect_ratio: None,
                alt_text_title: None,
                display_name: None,
                import_status: None,
            },
            data,
        });
    }

    objects
}

fn picture_relationships(
    pic: &crate::domain::drawings::SpreadsheetPicture,
    drawing_relationships: &[ooxml_types::shared::OpcRelationship],
) -> Vec<ooxml_types::shared::OpcRelationship> {
    let mut ids = std::collections::BTreeSet::new();
    if let Some(id) = pic.blip_fill.embed_id.as_deref() {
        ids.insert(id.to_string());
    }
    if let Some(id) = pic.blip_fill.link_id.as_deref() {
        ids.insert(id.to_string());
    }
    if let Some(id) = pic
        .nv_pic_pr
        .c_nv_pr
        .hlink_click
        .as_ref()
        .and_then(|hlink| hlink.r_id.as_deref())
    {
        ids.insert(id.to_string());
    }
    if let Some(id) = pic
        .nv_pic_pr
        .c_nv_pr
        .hlink_hover
        .as_ref()
        .and_then(|hlink| hlink.r_id.as_deref())
    {
        ids.insert(id.to_string());
    }

    drawing_relationships
        .iter()
        .filter(|relationship| ids.contains(&relationship.id))
        .cloned()
        .collect()
}
