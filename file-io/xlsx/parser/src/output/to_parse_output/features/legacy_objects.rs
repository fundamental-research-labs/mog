use super::*;
use domain_types::{
    ImportDiagnosticRef, ImportEditability, ImportFeatureKind, ImportObjectStatus,
    ImportRecoverability, ImportRenderability, ImportSource,
};

// =============================================================================
// Domain conversions: Form controls
// =============================================================================

/// Convert parser `FormControlOutput` items into unified `FloatingObject` items.
pub(crate) fn convert_form_controls(controls: &[FormControlOutput]) -> Vec<FloatingObject> {
    controls
        .iter()
        .enumerate()
        .map(|(idx, fc)| {
            let anchor = FloatingObjectAnchor {
                anchor_row: fc.from_row,
                anchor_col: fc.from_col,
                anchor_row_offset: fc.from_row_offset,
                anchor_col_offset: fc.from_col_offset,
                anchor_mode: AnchorMode::TwoCell,
                absolute_x: None,
                absolute_y: None,
                end_row: Some(fc.to_row),
                end_col: Some(fc.to_col),
                end_row_offset: Some(fc.to_row_offset),
                end_col_offset: Some(fc.to_col_offset),
                extent_cx: None,
                extent_cy: None,
            };
            // Build typed ooxml props for round-trip
            let ooxml = FormControlOoxmlProps {
                shape_id: fc.shape_id,
                alt_text: fc.alt_text.clone(),
                fmla_group: fc.fmla_group.clone(),
                fmla_txbx: fc.fmla_txbx.clone(),
                checked: fc.checked.clone(),
                val: fc.val,
                sel: fc.sel,
                min: fc.min,
                max: fc.max,
                inc: fc.inc,
                page: fc.page,
                drop_lines: fc.drop_lines,
                drop_style: fc.drop_style.clone(),
                dx: fc.dx,
                horiz: fc.horiz,
                colored: fc.colored,
                no_three_d: fc.no_three_d,
                no_three_d2: fc.no_three_d2,
                first_button: fc.first_button,
                lock_text: fc.lock_text,
                sel_type: fc.sel_type.clone(),
                multi_sel: fc.multi_sel.clone(),
                text_h_align: fc.text_h_align.clone(),
                text_v_align: fc.text_v_align.clone(),
                edit_val: fc.edit_val.clone(),
                multi_line: fc.multi_line,
                vertical_bar: fc.vertical_bar,
                password_edit: fc.password_edit,
                just_last_x: fc.just_last_x,
                width_min: fc.width_min,
                items: fc.items.clone(),
                macro_name: fc.macro_name.clone(),
                anchor_source: fc.anchor_source.clone(),
                move_with_cells: fc.move_with_cells,
                size_with_cells: fc.size_with_cells,
                vml_extras: fc.vml_extras.clone(),
                control_pr_attrs: fc.control_pr_attrs.clone(),
                control_pr: fc.control_pr.clone(),
                vml_shape: Some(fc.vml_shape.clone()),
            };
            let object_id = format!("form-control-shape-{}", fc.shape_id);
            let import_status = Some(form_control_import_status(fc, &object_id));
            FloatingObject {
                common: FloatingObjectCommon {
                    id: format!("fobj-fc-{}", idx),
                    sheet_id: String::new(),
                    anchor,
                    width: 0.0,
                    height: 0.0,
                    z_index: idx as i32,
                    rotation: 0.0,
                    flip_h: false,
                    flip_v: false,
                    locked: false,
                    visible: true,
                    printable: true,
                    opacity: 1.0,
                    name: fc.name.clone().unwrap_or_default(),
                    created_at: 0,
                    updated_at: 0,
                    group_id: None,
                    anchor_cell_id: None,
                    to_anchor_cell_id: None,
                    lock_aspect_ratio: None,
                    alt_text_title: None,
                    display_name: None,
                    import_status,
                },
                data: FloatingObjectData::FormControl(FormControlData {
                    control_type: fc.object_type.clone(),
                    cell_link: fc.fmla_link.clone(),
                    input_range: fc.fmla_range.clone(),
                    ooxml: Some(ooxml),
                }),
            }
        })
        .collect()
}

// =============================================================================
// Domain conversions: OLE objects
// =============================================================================

/// Convert parser `OleObjectOutput` items into unified `FloatingObject` items.
pub(crate) fn convert_ole_objects(
    objects: &[OleObjectOutput],
    binary_parts: &HashMap<String, Vec<u8>>,
    media_data_urls: &HashMap<String, String>,
) -> Vec<FloatingObject> {
    objects
        .iter()
        .enumerate()
        .map(|(idx, o)| {
            // Build anchor from objectPr anchor if available
            let anchor = o
                .object_pr
                .as_ref()
                .and_then(|pr| pr.anchor.as_ref())
                .map(|a| FloatingObjectAnchor {
                    anchor_row: a.from.row,
                    anchor_col: a.from.col,
                    anchor_row_offset: a.from.row_off,
                    anchor_col_offset: a.from.col_off,
                    anchor_mode: AnchorMode::TwoCell,
                    absolute_x: None,
                    absolute_y: None,
                    end_row: Some(a.to.row),
                    end_col: Some(a.to.col),
                    end_row_offset: Some(a.to.row_off),
                    end_col_offset: Some(a.to.col_off),
                    extent_cx: None,
                    extent_cy: None,
                })
                .unwrap_or(FloatingObjectAnchor {
                    anchor_row: 0,
                    anchor_col: 0,
                    anchor_row_offset: 0,
                    anchor_col_offset: 0,
                    anchor_mode: AnchorMode::TwoCell,
                    absolute_x: None,
                    absolute_y: None,
                    end_row: None,
                    end_col: None,
                    end_row_offset: None,
                    end_col_offset: None,
                    extent_cx: None,
                    extent_cy: None,
                });
            // Build typed ooxml props for round-trip
            let embedding = o.data_path.as_ref().and_then(|path| {
                resolve_binary_part(binary_parts, path).map(|bytes| OleObjectPackageIdentity {
                    path: path.clone(),
                    kind: o
                        .embedding_kind
                        .clone()
                        .unwrap_or_else(|| "oleObject".to_string()),
                    content_type: o.embedding_content_type.clone(),
                    relationship_id: o.r_id.clone(),
                    bytes,
                })
            });
            let preview = o.preview_image_path.as_ref().and_then(|path| {
                resolve_binary_part(binary_parts, path).map(|bytes| OleObjectPreviewIdentity {
                    path: path.clone(),
                    relationship_id: o.preview_image_rel_id.clone(),
                    bytes,
                })
            });
            let object_id = format!("ole-shape-{}", o.shape_id);
            let import_status = Some(ole_object_import_status(
                o, &object_id, &embedding, &preview,
            ));
            let ooxml = OleObjectOoxmlProps {
                shape_id: o.shape_id,
                r_id: o.r_id.clone(),
                data_path: o.data_path.clone(),
                name: o.name.clone(),
                link: o.link.clone(),
                dv_aspect: o.dv_aspect.clone(),
                prog_id: o.prog_id.clone(),
                ole_update: o.ole_update.clone(),
                auto_load: o.auto_load,
                preview_image_rel_id: o.preview_image_rel_id.clone(),
                preview_image_path: o.preview_image_path.clone(),
                embedding,
                preview,
                vml_drawing_path: None,
                vml_relationship_id: None,
                object_pr: o.object_pr.clone(),
            };
            FloatingObject {
                common: FloatingObjectCommon {
                    id: format!("fobj-ole-{}", idx),
                    sheet_id: String::new(),
                    anchor,
                    width: 0.0,
                    height: 0.0,
                    z_index: idx as i32,
                    rotation: 0.0,
                    flip_h: false,
                    flip_v: false,
                    locked: false,
                    visible: true,
                    printable: true,
                    opacity: 1.0,
                    name: o.name.clone().unwrap_or_default(),
                    created_at: 0,
                    updated_at: 0,
                    group_id: None,
                    anchor_cell_id: None,
                    to_anchor_cell_id: None,
                    lock_aspect_ratio: None,
                    alt_text_title: None,
                    display_name: None,
                    import_status,
                },
                data: FloatingObjectData::OleObject(OleObjectData {
                    prog_id: o.prog_id.clone(),
                    dv_aspect: o.dv_aspect.clone(),
                    is_linked: o.link.is_some(),
                    is_embedded: o.data_path.is_some(),
                    preview_image_src: o
                        .preview_image_path
                        .as_ref()
                        .and_then(|path| resolve_media_data_url(media_data_urls, path)),
                    alt_text: None,
                    ooxml: Some(ooxml),
                }),
            }
        })
        .collect()
}

fn form_control_import_status(fc: &FormControlOutput, object_id: &str) -> ImportObjectStatus {
    let mut diagnostics = Vec::new();
    if fc.macro_name.is_some() {
        diagnostics.push(ImportDiagnosticRef {
            id: Some("form-control-macro-disabled".to_string()),
            feature_kind: Some(ImportFeatureKind::FormControl),
            object_id: Some(object_id.to_string()),
            object_name: fc.name.clone(),
            ..ImportDiagnosticRef::default()
        });
    }

    let reference = ImportDiagnosticRef {
        id: Some(object_id.to_string()),
        feature_kind: Some(ImportFeatureKind::FormControl),
        object_id: Some(object_id.to_string()),
        object_name: fc.name.clone(),
        related_parts: form_control_related_parts(fc),
        ..ImportDiagnosticRef::default()
    };

    ImportObjectStatus {
        source: ImportSource::Xlsx,
        feature_kind: ImportFeatureKind::FormControl,
        recoverability: if fc.macro_name.is_some() {
            ImportRecoverability::SecurityDisabled
        } else {
            ImportRecoverability::PreservedNotEditable
        },
        renderability: ImportRenderability::Renderable,
        editability: ImportEditability::NotEditable,
        diagnostics,
        reference: Some(reference),
    }
}

fn form_control_related_parts(fc: &FormControlOutput) -> Vec<String> {
    let mut related_parts = Vec::new();
    if fc.anchor_source == "Modern" {
        related_parts.push("worksheet controls".to_string());
    }
    if !fc.control_pr_attrs.is_empty() {
        related_parts.push("ctrlProp".to_string());
    }
    if fc.anchor_source == "Vml"
        || fc.vml_shape.style.is_some()
        || fc.vml_shape.textbox_content.is_some()
    {
        related_parts.push("VML shape".to_string());
    }
    related_parts
}

fn ole_object_import_status(
    o: &OleObjectOutput,
    object_id: &str,
    embedding: &Option<OleObjectPackageIdentity>,
    preview: &Option<OleObjectPreviewIdentity>,
) -> ImportObjectStatus {
    let has_link = o.link.is_some();
    let has_embedding = embedding.is_some();
    let missing_embedding = o.data_path.is_some() && !has_embedding;

    let mut diagnostics = Vec::new();
    if has_link {
        diagnostics.push(ImportDiagnosticRef {
            id: Some("ole-linked-object-disabled".to_string()),
            feature_kind: Some(ImportFeatureKind::OleObject),
            object_id: Some(object_id.to_string()),
            object_name: o.name.clone(),
            relationship_id: o.r_id.clone(),
            relationship_target: o.link.clone(),
            ..ImportDiagnosticRef::default()
        });
    }
    if missing_embedding {
        diagnostics.push(ImportDiagnosticRef {
            id: Some("ole-embedding-bytes-missing".to_string()),
            feature_kind: Some(ImportFeatureKind::OleObject),
            object_id: Some(object_id.to_string()),
            object_name: o.name.clone(),
            relationship_id: o.r_id.clone(),
            relationship_target: o.data_path.clone(),
            ..ImportDiagnosticRef::default()
        });
    }

    let reference = ImportDiagnosticRef {
        id: Some(object_id.to_string()),
        part: o.data_path.clone(),
        relationship_id: o.r_id.clone(),
        relationship_target: o.link.clone().or_else(|| o.data_path.clone()),
        feature_kind: Some(ImportFeatureKind::OleObject),
        object_id: Some(object_id.to_string()),
        object_name: o.name.clone(),
        related_parts: ole_related_parts(o, embedding, preview),
        ..ImportDiagnosticRef::default()
    };

    ImportObjectStatus {
        source: ImportSource::Xlsx,
        feature_kind: ImportFeatureKind::OleObject,
        recoverability: if missing_embedding {
            ImportRecoverability::PartiallySupported
        } else if has_link {
            ImportRecoverability::SecurityDisabled
        } else {
            ImportRecoverability::UnsupportedPreserved
        },
        renderability: if preview.is_some() {
            ImportRenderability::Renderable
        } else {
            ImportRenderability::Placeholder
        },
        editability: ImportEditability::NotEditable,
        diagnostics,
        reference: Some(reference),
    }
}

fn ole_related_parts(
    o: &OleObjectOutput,
    embedding: &Option<OleObjectPackageIdentity>,
    preview: &Option<OleObjectPreviewIdentity>,
) -> Vec<String> {
    let mut related_parts = Vec::new();
    if let Some(embedding) = embedding {
        related_parts.push(embedding.path.clone());
    } else if let Some(path) = &o.data_path {
        related_parts.push(path.clone());
    }
    if let Some(preview) = preview {
        related_parts.push(preview.path.clone());
    } else if let Some(path) = &o.preview_image_path {
        related_parts.push(path.clone());
    }
    if let Some(link) = &o.link {
        related_parts.push(link.clone());
    }
    related_parts
}

fn resolve_binary_part(binary_parts: &HashMap<String, Vec<u8>>, target: &str) -> Option<Vec<u8>> {
    if let Some(bytes) = binary_parts.get(target) {
        return Some(bytes.clone());
    }

    let normalized = target.replace('\\', "/");
    if let Some(bytes) = binary_parts.get(&normalized) {
        return Some(bytes.clone());
    }

    if let Some(stripped) = normalized.strip_prefix("../") {
        let workbook_relative = format!("xl/{stripped}");
        if let Some(bytes) = binary_parts.get(&workbook_relative) {
            return Some(bytes.clone());
        }
    }

    if normalized.starts_with("media/") || normalized.starts_with("embeddings/") {
        let workbook_relative = format!("xl/{normalized}");
        if let Some(bytes) = binary_parts.get(&workbook_relative) {
            return Some(bytes.clone());
        }
    }

    normalized
        .rsplit('/')
        .next()
        .and_then(|file_name| binary_parts.get(file_name).cloned())
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

// =============================================================================
// Domain conversions: Connectors
// =============================================================================

/// Convert parser `ConnectorOutput` items into unified `FloatingObject` items.
pub(crate) fn convert_connectors(connectors: &[ConnectorOutput]) -> Vec<FloatingObject> {
    connectors
        .iter()
        .enumerate()
        .map(|(idx, c)| {
            let has_end = c.end_row.is_some() && c.end_col.is_some();
            let anchor = FloatingObjectAnchor {
                anchor_row: c.anchor_row.unwrap_or(0),
                anchor_col: c.anchor_col.unwrap_or(0),
                anchor_row_offset: c.anchor_row_offset,
                anchor_col_offset: c.anchor_col_offset,
                anchor_mode: if has_end {
                    AnchorMode::TwoCell
                } else {
                    AnchorMode::OneCell
                },
                absolute_x: None,
                absolute_y: None,
                end_row: c.end_row,
                end_col: c.end_col,
                end_row_offset: c.end_row_offset,
                end_col_offset: c.end_col_offset,
                extent_cx: None,
                extent_cy: None,
            };
            // Convert EMU to pixels (÷9525) for width/height
            let width = c.width.map(|w| (w / 9525) as f64).unwrap_or(0.0);
            let height = c.height.map(|h| (h / 9525) as f64).unwrap_or(0.0);
            let start_connection = c.start_connection.as_ref().map(|e| ConnectorBinding {
                shape_id: e.shape_id.to_string(),
                site_index: e.idx as i32,
            });
            let end_connection = c.end_connection.as_ref().map(|e| ConnectorBinding {
                shape_id: e.shape_id.to_string(),
                site_index: e.idx as i32,
            });
            let ooxml: Option<ConnectorOoxmlProps> = c
                .raw_json
                .as_ref()
                .and_then(|j| {
                    serde_json::from_str::<ooxml_types::drawings::SpreadsheetConnector>(j).ok()
                })
                .map(|connector| ConnectorOoxmlProps {
                    connector,
                    anchor_index: None,
                    extent_emu_cx: c.width,
                    extent_emu_cy: c.height,
                    edit_as: None,
                    client_data_locks_with_sheet: None,
                    client_data_prints_with_sheet: None,
                    mc_alternate_content_raw_xml: None,
                });
            FloatingObject {
                common: FloatingObjectCommon {
                    id: format!("fobj-conn-{}", idx),
                    sheet_id: String::new(),
                    anchor,
                    width,
                    height,
                    z_index: idx as i32,
                    rotation: 0.0,
                    flip_h: false,
                    flip_v: false,
                    locked: false,
                    visible: true,
                    printable: true,
                    opacity: 1.0,
                    name: c.name.clone().unwrap_or_default(),
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
                data: FloatingObjectData::Connector(ConnectorData {
                    shape_type: c
                        .preset_geometry
                        .clone()
                        .unwrap_or_else(|| "line".to_string()),
                    fill: None,
                    outline: None,
                    start_connection,
                    end_connection,
                    adjustments: None,
                    ooxml,
                }),
            }
        })
        .collect()
}
