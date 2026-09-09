//! Native floating objects, groups, and authored drawing order.

use crate::engine_types::floating_objects::SerializedFloatingObjectGroup;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::floating_object::FloatingObject;
use std::collections::BTreeMap;
use value_types::ComputeError;

#[derive(Debug, Clone, Default)]
pub(crate) struct FloatingObjectState {
    pub(crate) objects: BTreeMap<String, Box<FloatingObject>>,
    pub(crate) groups: BTreeMap<String, SerializedFloatingObjectGroup>,
    pub(crate) order: Vec<String>,
}

impl FloatingObjectState {
    /// Copy object ownership and every internal identity edge to a new sheet.
    pub(crate) fn remap_for_copy(
        &mut self,
        sheet: SheetId,
        cells: &rustc_hash::FxHashMap<cell_types::CellId, cell_types::CellId>,
        allocator: &cell_types::IdAllocator,
    ) {
        use domain_types::domain::floating_object::FloatingObjectData;
        let object_ids: BTreeMap<_, _> = self
            .objects
            .keys()
            .map(|id| (id.clone(), super::ids::generate_object_id(allocator)))
            .collect();
        let group_ids: BTreeMap<_, _> = self
            .groups
            .keys()
            .map(|id| (id.clone(), super::ids::generate_group_id(allocator)))
            .collect();
        let remap_cell = |text: &mut String| {
            let id = compute_document::hex::hex_to_id(text)
                .map(cell_types::CellId::from_raw)
                .or_else(|| cell_types::CellId::from_uuid_str(text).ok());
            if let Some(new) = id.and_then(|id| cells.get(&id)) {
                *text = compute_document::hex::id_to_hex(new.as_u128()).to_string();
            }
        };
        self.objects = std::mem::take(&mut self.objects)
            .into_iter()
            .map(|(old, mut object)| {
                object.common.id = object_ids[&old].clone();
                object.common.sheet_id = sheet.to_uuid_string();
                for reference in [
                    &mut object.common.anchor_cell_id,
                    &mut object.common.to_anchor_cell_id,
                ]
                .into_iter()
                .flatten()
                {
                    remap_cell(reference);
                }
                if let Some(id) = object
                    .common
                    .group_id
                    .as_mut()
                    .and_then(|id| group_ids.get(id).cloned())
                {
                    object.common.group_id = Some(id);
                }
                match &mut object.data {
                    FloatingObjectData::Connector(data) => {
                        for connection in [&mut data.start_connection, &mut data.end_connection]
                            .into_iter()
                            .flatten()
                        {
                            if let Some(id) = object_ids.get(&connection.shape_id) {
                                connection.shape_id = id.clone();
                            }
                        }
                    }
                    FloatingObjectData::Chart(data) => {
                        for range in [
                            &mut data.data_range_identity,
                            &mut data.series_range_identity,
                            &mut data.category_range_identity,
                        ]
                        .into_iter()
                        .flatten()
                        {
                            remap_cell(&mut range.top_left_cell_id);
                            remap_cell(&mut range.bottom_right_cell_id);
                        }
                    }
                    FloatingObjectData::FormControl(data) => {
                        for reference in [&mut data.cell_link, &mut data.input_range]
                            .into_iter()
                            .flatten()
                        {
                            remap_control_reference(reference, &remap_cell);
                        }
                        if let Some(control) = data
                            .ooxml
                            .as_mut()
                            .and_then(|props| props.control_pr.as_mut())
                        {
                            for reference in
                                [&mut control.linked_cell, &mut control.list_fill_range]
                                    .into_iter()
                                    .flatten()
                            {
                                remap_control_reference(reference, &remap_cell);
                            }
                        }
                    }
                    _ => {}
                }
                (object.common.id.clone(), object)
            })
            .collect();
        self.groups = std::mem::take(&mut self.groups)
            .into_iter()
            .map(|(old, mut group)| {
                group.id = group_ids[&old].clone();
                group.sheet_id = sheet.to_uuid_string();
                for child in &mut group.children {
                    if let Some(id) = object_ids.get(child).or_else(|| group_ids.get(child)) {
                        *child = id.clone();
                    }
                }
                (group.id.clone(), group)
            })
            .collect();
        self.order = std::mem::take(&mut self.order)
            .into_iter()
            .filter_map(|id| object_ids.get(&id).cloned())
            .collect();
    }

    pub(crate) fn insert(&mut self, object: FloatingObject) {
        let id = object.common.id.clone();
        if !self.objects.contains_key(&id) {
            self.order.push(id.clone());
        }
        self.objects.insert(id, Box::new(object));
    }
    pub(crate) fn remove(&mut self, id: &str) -> bool {
        if self.objects.remove(id).is_none() {
            return false;
        }
        self.order.retain(|entry| entry != id);
        for group in self.groups.values_mut() {
            group.children.retain(|entry| entry != id);
        }
        true
    }
}

pub(super) fn state<'a>(
    storage: &'a WorkbookStorage,
    sheet: &SheetId,
) -> Option<&'a FloatingObjectState> {
    Some(&storage.sheet_metadata.get(sheet)?.floating_objects)
}
pub(super) fn state_mut<'a>(
    storage: &'a mut WorkbookStorage,
    sheet: &SheetId,
) -> Option<&'a mut FloatingObjectState> {
    Some(&mut storage.sheet_metadata.get_mut(sheet)?.floating_objects)
}
pub(super) fn required_state_mut<'a>(
    storage: &'a mut WorkbookStorage,
    sheet: &SheetId,
) -> Result<&'a mut FloatingObjectState, ComputeError> {
    state_mut(storage, sheet).ok_or_else(|| ComputeError::SheetNotFound {
        sheet_id: sheet.to_uuid_string(),
    })
}

/// Normalize legacy flat anchor fields only at the public JSON boundary.
pub(super) fn normalize_object_json(value: &mut serde_json::Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let mut anchor = object
        .remove("anchor")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    for key in [
        "anchorRow",
        "anchorCol",
        "anchorRowOffsetEmu",
        "anchorColOffsetEmu",
        "anchorRowOffset",
        "anchorColOffset",
        "anchorMode",
        "absoluteXEmu",
        "absoluteYEmu",
        "absoluteX",
        "absoluteY",
        "endRow",
        "endCol",
        "endRowOffsetEmu",
        "endColOffsetEmu",
        "endRowOffset",
        "endColOffset",
        "extentCxEmu",
        "extentCyEmu",
        "extentCx",
        "extentCy",
    ] {
        if let Some(value) = object.remove(key) {
            anchor.entry(key.to_owned()).or_insert(value);
        }
    }
    for (legacy, canonical) in [
        ("anchorRowOffset", "anchorRowOffsetEmu"),
        ("anchorColOffset", "anchorColOffsetEmu"),
        ("endRowOffset", "endRowOffsetEmu"),
        ("endColOffset", "endColOffsetEmu"),
        ("extentCx", "extentCxEmu"),
        ("extentCy", "extentCyEmu"),
        ("absoluteX", "absoluteXEmu"),
        ("absoluteY", "absoluteYEmu"),
    ] {
        if let Some(value) = anchor.remove(legacy) {
            anchor.entry(canonical.to_owned()).or_insert(value);
        }
    }
    for (pixels, emu) in [
        ("xOffset", "anchorColOffsetEmu"),
        ("yOffset", "anchorRowOffsetEmu"),
        ("x", "absoluteXEmu"),
        ("y", "absoluteYEmu"),
    ] {
        if let Some(value) = object.remove(pixels).and_then(|value| value.as_f64()) {
            anchor
                .entry(emu.to_owned())
                .or_insert_with(|| serde_json::json!(super::units::px_to_emu(value)));
        }
    }
    if !anchor.is_empty() {
        object.insert("anchor".into(), serde_json::Value::Object(anchor));
    }
    if object.get("type").and_then(|value| value.as_str()) == Some("connector") {
        for key in ["startConnection", "endConnection"] {
            if let Some(serde_json::Value::Object(connection)) = object.get_mut(key) {
                if let Some(value) = connection.get_mut("shapeId") {
                    if value.is_number() {
                        *value = serde_json::Value::String(value.to_string());
                    }
                }
            }
        }
    }
    if object.get("type").and_then(|value| value.as_str()) == Some("chart") {
        object
            .entry("chartType")
            .or_insert_with(|| serde_json::json!("bar"));
    }
}

pub(super) fn object_from_json(
    sheet: &SheetId,
    id: &str,
    json: &serde_json::Value,
) -> Result<FloatingObject, ComputeError> {
    let mut json = json.clone();
    normalize_object_json(&mut json);
    let mut object: FloatingObject =
        serde_json::from_value(json).map_err(|error| ComputeError::InvalidInput {
            message: error.to_string(),
        })?;
    object.common.id = id.to_owned();
    object.common.sheet_id = sheet.to_uuid_string();
    Ok(object)
}

pub(super) fn merge_json_fields(
    target: &mut serde_json::Value,
    update: &serde_json::Value,
) -> bool {
    let (Some(target), Some(update)) = (target.as_object_mut(), update.as_object()) else {
        return false;
    };
    for (key, value) in update {
        if key == "anchor" && value.is_object() {
            let nested = target
                .entry(key.clone())
                .or_insert_with(|| serde_json::json!({}));
            merge_json_fields(nested, value);
        } else {
            target.insert(key.clone(), value.clone());
        }
    }
    true
}

fn remap_control_reference(reference: &mut String, remap: &impl Fn(&mut String)) {
    if let Ok(mut range) = serde_json::from_str::<serde_json::Value>(reference) {
        let Some(fields) = range.as_object_mut() else {
            return;
        };
        for key in ["id", "startId", "endId"] {
            if let Some(serde_json::Value::String(id)) = fields.get_mut(key) {
                remap(id);
            }
        }
        *reference = range.to_string();
    } else {
        remap(reference);
    }
}
