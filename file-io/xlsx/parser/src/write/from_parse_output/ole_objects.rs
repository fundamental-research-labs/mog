use domain_types::domain::drawings::{OleAnchorPoint, OleObjectAnchor, OleObjectProperties};
use domain_types::domain::floating_object::{
    AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectData, OleObjectOoxmlProps,
};
use ooxml_types::ole::{CellAnchorPoint, DvAspect, ObjectAnchor, ObjectProperties, OleUpdate};

use crate::domain::controls::types::{AnchorSource, ControlAnchor, OleObject};
use crate::write::OleWriter;

#[derive(Debug, Clone)]
pub(super) struct OleObjectExport {
    pub(super) object: OleObject,
    pub(super) embedding_path: String,
    pub(super) embedding_bytes: Vec<u8>,
    pub(super) embedding_content_type: String,
    pub(super) embedding_relationship_type: String,
    pub(super) embedding_relationship_id_hint: Option<String>,
    pub(super) preview_path: Option<String>,
    pub(super) preview_bytes: Option<Vec<u8>>,
    pub(super) preview_relationship_id_hint: Option<String>,
}

pub(super) fn convert_unified_ole_objects(
    floating_objects: &[FloatingObject],
) -> Vec<OleObjectExport> {
    floating_objects
        .iter()
        .filter_map(convert_unified_ole_object)
        .collect()
}

pub(super) fn write_worksheet_ole_objects(
    ole_objects: &[OleObjectExport],
    relationship_ids: &[String],
) -> Vec<u8> {
    let objects = ole_objects
        .iter()
        .map(|entry| entry.object.clone())
        .collect();
    OleWriter::new(objects).write_ole_objects(relationship_ids)
}

fn convert_unified_ole_object(obj: &FloatingObject) -> Option<OleObjectExport> {
    let FloatingObjectData::OleObject(data) = &obj.data else {
        return None;
    };
    let ooxml = data.ooxml.as_ref()?;
    let embedding = ooxml.embedding.as_ref()?;
    if embedding.path.is_empty() || embedding.bytes.is_empty() {
        return None;
    }

    let shape_id = if ooxml.shape_id == 0 {
        fallback_shape_id(obj)
    } else {
        ooxml.shape_id
    };
    let mut ole = OleObject::new(
        first_non_empty(&data.prog_id, &ooxml.prog_id).to_string(),
        shape_id,
    );
    ole.data_path = Some(embedding.path.clone());
    ole.embedding_kind = if embedding.kind.is_empty() {
        Some("oleObject".to_string())
    } else {
        Some(embedding.kind.clone())
    };
    ole.embedding_content_type = embedding.content_type.clone();
    ole.r_id = embedding
        .relationship_id
        .clone()
        .or_else(|| ooxml.r_id.clone());
    ole.link_path = ooxml.link.clone();
    ole.name = ooxml
        .name
        .clone()
        .or_else(|| (!obj.common.name.is_empty()).then(|| obj.common.name.clone()));
    ole.anchor = object_anchor_from_floating_object(obj, ooxml);
    ole.dv_aspect = DvAspect::from_ooxml(first_non_empty(&data.dv_aspect, &ooxml.dv_aspect));
    ole.ole_update = OleUpdate::from_ooxml(&ooxml.ole_update);
    ole.auto_load = ooxml.auto_load;
    ole.preview_image_rel_id = ooxml
        .preview
        .as_ref()
        .and_then(|preview| preview.relationship_id.clone())
        .or_else(|| ooxml.preview_image_rel_id.clone());
    ole.preview_image_path = ooxml
        .preview
        .as_ref()
        .map(|preview| preview.path.clone())
        .or_else(|| ooxml.preview_image_path.clone());
    ole.object_pr = ooxml.object_pr.as_ref().map(convert_object_properties);

    Some(OleObjectExport {
        object: ole,
        embedding_path: embedding.path.clone(),
        embedding_bytes: embedding.bytes.clone(),
        embedding_content_type: embedding.content_type.clone().unwrap_or_else(|| {
            crate::infra::imported_parts::infer_content_type(&embedding.path).to_string()
        }),
        embedding_relationship_type: embedding_relationship_type(&embedding.kind).to_string(),
        embedding_relationship_id_hint: embedding
            .relationship_id
            .clone()
            .or_else(|| ooxml.r_id.clone()),
        preview_path: ooxml.preview.as_ref().map(|preview| preview.path.clone()),
        preview_bytes: ooxml.preview.as_ref().map(|preview| preview.bytes.clone()),
        preview_relationship_id_hint: ooxml
            .preview
            .as_ref()
            .and_then(|preview| preview.relationship_id.clone())
            .or_else(|| ooxml.preview_image_rel_id.clone()),
    })
}

fn embedding_relationship_type(kind: &str) -> &'static str {
    if kind == "embeddedPackage" {
        crate::infra::opc::REL_EMBEDDED_PACKAGE
    } else {
        crate::infra::opc::REL_OLE_OBJECT
    }
}

fn first_non_empty<'a>(primary: &'a str, fallback: &'a str) -> &'a str {
    if primary.is_empty() {
        fallback
    } else {
        primary
    }
}

fn fallback_shape_id(obj: &FloatingObject) -> u32 {
    obj.common
        .z_index
        .max(0)
        .try_into()
        .ok()
        .and_then(|idx: u32| 1025u32.checked_add(idx))
        .unwrap_or(1025)
}

fn object_anchor_from_floating_object(
    obj: &FloatingObject,
    ooxml: &OleObjectOoxmlProps,
) -> ControlAnchor {
    if let Some(anchor) = ooxml
        .object_pr
        .as_ref()
        .and_then(|props| props.anchor.as_ref())
    {
        return control_anchor_from_ole_anchor(anchor);
    }

    control_anchor_from_floating_anchor(&obj.common.anchor)
}

fn control_anchor_from_ole_anchor(anchor: &OleObjectAnchor) -> ControlAnchor {
    ControlAnchor {
        from_col: anchor.from.col,
        from_row: anchor.from.row,
        to_col: anchor.to.col,
        to_row: anchor.to.row,
        from_col_offset: anchor.from.col_off,
        from_row_offset: anchor.from.row_off,
        to_col_offset: anchor.to.col_off,
        to_row_offset: anchor.to.row_off,
        anchor_source: AnchorSource::Modern,
    }
}

fn control_anchor_from_floating_anchor(anchor: &FloatingObjectAnchor) -> ControlAnchor {
    let to_col = anchor
        .end_col
        .unwrap_or_else(|| anchor.anchor_col.saturating_add(1));
    let to_row = anchor
        .end_row
        .unwrap_or_else(|| anchor.anchor_row.saturating_add(1));
    ControlAnchor {
        from_col: anchor.anchor_col,
        from_row: anchor.anchor_row,
        to_col,
        to_row,
        from_col_offset: anchor.anchor_col_offset,
        from_row_offset: anchor.anchor_row_offset,
        to_col_offset: anchor.end_col_offset.unwrap_or(0),
        to_row_offset: anchor.end_row_offset.unwrap_or(0),
        anchor_source: match anchor.anchor_mode {
            AnchorMode::OneCell | AnchorMode::TwoCell | AnchorMode::Absolute => {
                AnchorSource::Modern
            }
        },
    }
}

fn convert_object_properties(props: &OleObjectProperties) -> ObjectProperties {
    ObjectProperties {
        default_size: props.default_size,
        print: props.print,
        disabled: props.disabled,
        locked: props.locked,
        auto_fill: props.auto_fill,
        auto_line: props.auto_line,
        auto_pict: props.auto_pict,
        r#macro: props.r#macro.clone(),
        alt_text: props.alt_text.clone(),
        dde: props.dde,
        ui_object: props.ui_object,
        r_id: props.r_id.clone(),
        anchor: props.anchor.as_ref().map(convert_object_anchor),
    }
}

fn convert_object_anchor(anchor: &OleObjectAnchor) -> ObjectAnchor {
    ObjectAnchor {
        move_with_cells: anchor.move_with_cells,
        size_with_cells: anchor.size_with_cells,
        from: convert_anchor_point(&anchor.from),
        to: convert_anchor_point(&anchor.to),
    }
}

fn convert_anchor_point(point: &OleAnchorPoint) -> CellAnchorPoint {
    CellAnchorPoint {
        col: point.col,
        col_offset: point.col_off,
        row: point.row,
        row_offset: point.row_off,
    }
}
