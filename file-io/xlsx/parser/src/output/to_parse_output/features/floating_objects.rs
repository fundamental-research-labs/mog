use super::*;

// =============================================================================
// Domain conversions: Floating objects (from parsed drawings)
// =============================================================================

/// EMUs per pixel at 96 DPI (standard screen resolution).
const EMUS_PER_PIXEL: i64 = 9525;

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
            DrawingAnchor::Absolute(_) => {
                continue;
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
                let embed_id = pic.blip_fill.embed_id.as_deref().unwrap_or("rId1");
                let image_path = drawing
                    .opc_rels
                    .iter()
                    .find(|r| r.id == embed_id)
                    .map(|r| r.target.clone());

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
                            fill: None,
                            border: None,
                            text_effects: None,
                            ooxml: Some(shape_ooxml),
                        },
                    )
                } else {
                    FloatingObjectData::Shape(ShapeData {
                        shape_type: preset_type,
                        fill: None,
                        outline: None,
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
