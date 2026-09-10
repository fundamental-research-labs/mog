use super::merge::{merge_formats, normalize_format_patch};
use crate::border_patch::BorderPatchField;
use crate::engine_types::formatting::CellProperties;
use crate::storage::WorkbookStorage;
use cell_types::{CellId, SheetId};
use compute_document::hex::id_to_hex;
use domain_types::{CellBorders, CellFormat};
use rustc_hash::FxHashMap;

/// Imported style-only cells retain a palette index without allocating metadata
/// or a full format. Other authored properties are allocated only when present.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum StoredCellProperties {
    ImportedStyle(u32),
    Detailed(Box<StoredDetailedProperties>),
}

mod packed;
pub(crate) use packed::StoredDetailedProperties;

impl StoredCellProperties {
    /// Rebase an inverse onto a later session-only format patch without retaining
    /// a second copy of the current cell properties or its imported palette.
    pub(crate) fn rebase_format(
        old: &mut Option<Self>,
        palette: &[CellFormat],
        patch: &CellFormat,
    ) {
        let mut props = old
            .as_ref()
            .map(|value| value.properties(palette))
            .unwrap_or_default();
        let format =
            super::apply_format_patch(&props.format.clone().unwrap_or_default(), patch, &[])
                .expect("format patch without clear fields is valid");
        props.format = (format != CellFormat::default()).then_some(format);
        props.style_id = None;
        *old = Self::from_properties(props);
    }

    pub(crate) fn from_properties(mut props: CellProperties) -> Option<Self> {
        if props.format.is_none() && props.metadata_is_empty() {
            return None;
        }
        if let Some(style_id) = props.style_id {
            if props.format.is_none() {
                props.style_id = None;
                if props.metadata_is_empty() {
                    return Some(Self::ImportedStyle(style_id));
                }
                props.style_id = Some(style_id);
            }
        }
        Some(Self::Detailed(Box::new(
            StoredDetailedProperties::from_properties(props),
        )))
    }

    fn properties(&self, palette: &[CellFormat]) -> CellProperties {
        let mut props = match self {
            Self::ImportedStyle(style_id) => CellProperties {
                style_id: Some(*style_id),
                ..Default::default()
            },
            Self::Detailed(props) => props.properties(),
        };
        if let Some(style) = props.style_id.and_then(|id| palette.get(id as usize)) {
            props.format = Some(style.clone());
        }
        props
    }

    pub(crate) fn format<'a>(
        &'a self,
        palette: &'a [CellFormat],
    ) -> Option<(&'a CellFormat, bool)> {
        match self {
            Self::ImportedStyle(id) => palette.get(*id as usize).map(|format| (format, true)),
            Self::Detailed(props) => props
                .style_id()
                .and_then(|id| palette.get(id as usize))
                .or(props.format())
                .map(|format| (format, props.style_id().is_some())),
        }
    }

    pub(crate) fn has_format(&self) -> bool {
        match self {
            Self::ImportedStyle(_) => true,
            Self::Detailed(props) => props.has_format(),
        }
    }
}

pub fn get_properties_by_id(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &CellId,
) -> Option<CellProperties> {
    Some(
        storage
            .sheet_metadata
            .get(sheet_id)?
            .cell_properties
            .get(cell_id)?
            .properties(&storage.metadata.style_palette),
    )
}

pub fn get_all_properties(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> std::collections::HashMap<CellId, CellProperties> {
    storage
        .sheet_metadata
        .get(sheet_id)
        .into_iter()
        .flat_map(|sheet| sheet.cell_properties.iter())
        .map(|(id, props)| (*id, props.properties(&storage.metadata.style_palette)))
        .collect()
}

pub(crate) struct PreloadedCellFormatLayers {
    formats: Vec<CellFormat>,
    format_ids: FxHashMap<CellId, u32>,
}

impl PreloadedCellFormatLayers {
    pub(crate) fn get(&self, cell_id: &CellId) -> Option<&CellFormat> {
        self.formats.get(*self.format_ids.get(cell_id)? as usize)
    }
}

pub(crate) fn get_cell_format_layers_for_ids(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[CellId],
) -> PreloadedCellFormatLayers {
    let mut result = PreloadedCellFormatLayers {
        formats: Vec::new(),
        format_ids: FxHashMap::default(),
    };
    let Some(sheet) = storage.sheet_metadata.get(sheet_id) else {
        return result;
    };
    let mut interned = FxHashMap::<CellFormat, u32>::default();
    let mut imported = FxHashMap::<u32, u32>::default();
    for id in cell_ids {
        let Some(props) = sheet.cell_properties.get(id) else {
            continue;
        };
        if let StoredCellProperties::ImportedStyle(style) = props {
            if let Some(format_id) = imported.get(style) {
                result.format_ids.insert(*id, *format_id);
                continue;
            }
        }
        let Some((format, is_imported)) = props.format(&storage.metadata.style_palette) else {
            continue;
        };
        let mut format = format.clone();
        if is_imported {
            super::cascade::materialize_imported_cell_xf_defaults(&mut format);
        }
        let next_id =
            u32::try_from(result.formats.len()).expect("cell format palette exceeds u32::MAX");
        let format_id = *interned.entry(format.clone()).or_insert_with(|| {
            result.formats.push(format);
            next_id
        });
        result.format_ids.insert(*id, format_id);
        if let StoredCellProperties::ImportedStyle(style) = props {
            imported.insert(*style, format_id);
        }
    }
    result
}

pub fn set_properties_by_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &CellId,
    props: &CellProperties,
) {
    let id = *cell_id;
    crate::storage::engine::history::metadata::capture_cell_properties(storage, *sheet_id, id);
    let Some(sheet) = storage.sheet_metadata.get_mut(sheet_id) else {
        return;
    };
    let mut props = props.clone();
    props.format = props.format.as_ref().map(normalize_format_patch);
    match StoredCellProperties::from_properties(props) {
        Some(props) => {
            sheet.cell_properties.insert(id, props);
        }
        None => {
            sheet.cell_properties.remove(&id);
        }
    }
}

pub fn clear_properties_by_id(storage: &mut WorkbookStorage, sheet_id: &SheetId, cell_id: &CellId) {
    let id = *cell_id;
    if !storage
        .sheet_metadata
        .get(sheet_id)
        .is_some_and(|sheet| sheet.cell_properties.contains_key(&id))
    {
        return;
    }
    crate::storage::engine::history::metadata::capture_cell_properties(storage, *sheet_id, id);
    if let Some(sheet) = storage.sheet_metadata.get_mut(sheet_id) {
        sheet.cell_properties.remove(&id);
    }
}

pub fn clear_formula_cache_metadata_by_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &CellId,
) {
    let id = *cell_id;
    clear_formula_cache_metadata_for_cell_ids(storage, sheet_id, &[id]);
}

pub fn clear_formula_cache_metadata_for_cell_ids(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[CellId],
) {
    if storage.history.is_active() {
        for &id in cell_ids {
            if storage
                .sheet_metadata
                .get(sheet_id)
                .and_then(|sheet| sheet.cell_properties.get(&id))
                .is_some_and(|entry| match entry {
                    StoredCellProperties::ImportedStyle(_) => false,
                    StoredCellProperties::Detailed(props) => {
                        props.has_formula_cache() || props.is_empty()
                    }
                })
            {
                crate::storage::engine::history::metadata::capture_cell_properties_cache_metadata(
                    storage, *sheet_id, id,
                );
            }
        }
    }
    let Some(sheet) = storage.sheet_metadata.get_mut(sheet_id) else {
        return;
    };
    for id in cell_ids {
        let Some(StoredCellProperties::Detailed(props)) = sheet.cell_properties.get_mut(id) else {
            continue;
        };
        props.clear_formula_cache();
        if props.is_empty() {
            sheet.cell_properties.remove(id);
        }
    }
}

pub fn iter_all_properties(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> Vec<(String, CellProperties)> {
    get_all_properties(storage, sheet_id)
        .into_iter()
        .map(|(id, props)| (id_to_hex(id.as_u128()).to_string(), props))
        .collect()
}

pub fn iter_formatted_property_cell_ids(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> Vec<String> {
    storage
        .sheet_metadata
        .get(sheet_id)
        .into_iter()
        .flat_map(|sheet| sheet.cell_properties.iter())
        .filter(|(_, props)| props.has_format())
        .map(|(id, _)| id_to_hex(id.as_u128()).to_string())
        .collect()
}

pub fn get_cell_format_by_id(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &CellId,
) -> Option<CellFormat> {
    get_properties_by_id(storage, sheet_id, cell_id)?.format
}

pub fn set_cell_format_by_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &CellId,
    format: &CellFormat,
) {
    let mut props = get_properties_by_id(storage, sheet_id, cell_id).unwrap_or_default();
    props.format = Some(props.format.as_ref().map_or_else(
        || normalize_format_patch(format),
        |existing| merge_formats(existing, format),
    ));
    props.style_id = None;
    set_properties_by_id(storage, sheet_id, cell_id, &props);
}

pub fn patch_cell_format_by_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &CellId,
    format: &CellFormat,
    clear_fields: &[String],
) -> Result<(), value_types::ComputeError> {
    patch_cell_formats_by_id(storage, sheet_id, &[*cell_id], format, clear_fields)
}

pub fn replace_cell_format_by_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &CellId,
    format: &CellFormat,
) {
    let mut props = get_properties_by_id(storage, sheet_id, cell_id).unwrap_or_default();
    props.format = Some(normalize_format_patch(format));
    props.style_id = None;
    set_properties_by_id(storage, sheet_id, cell_id, &props);
}

pub fn clear_cell_format_by_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &CellId,
) {
    if let Some(mut props) = get_properties_by_id(storage, sheet_id, cell_id) {
        props.format = None;
        props.style_id = None;
        set_properties_by_id(storage, sheet_id, cell_id, &props);
    }
}

pub fn set_cell_formats_by_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[CellId],
    format: &CellFormat,
) {
    for id in cell_ids {
        set_cell_format_by_id(storage, sheet_id, id, format);
    }
}

pub fn patch_cell_formats_by_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[CellId],
    format: &CellFormat,
    clear_fields: &[String],
) -> Result<(), value_types::ComputeError> {
    // Validate every patch before writing any part of the batch.
    let patched: Vec<_> = cell_ids
        .iter()
        .map(|id| {
            let mut props = get_properties_by_id(storage, sheet_id, id).unwrap_or_default();
            let patched = super::apply_format_patch(
                &props.format.clone().unwrap_or_default(),
                format,
                clear_fields,
            )?;
            props.format = (patched != CellFormat::default()).then_some(patched);
            props.style_id = None;
            Ok(props)
        })
        .collect::<Result<_, value_types::ComputeError>>()?;
    for (id, props) in cell_ids.iter().zip(patched) {
        set_properties_by_id(storage, sheet_id, id, &props);
    }
    Ok(())
}

pub fn patch_cell_borders_by_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[CellId],
    borders: &CellBorders,
    clear_fields: &[BorderPatchField],
) -> Result<(), value_types::ComputeError> {
    for id in cell_ids {
        let mut props = get_properties_by_id(storage, sheet_id, id).unwrap_or_default();
        let mut format = props.format.take().unwrap_or_default();
        format.borders = super::apply_borders_patch(format.borders.as_ref(), borders, clear_fields);
        props.format = (format != CellFormat::default()).then_some(format);
        props.style_id = None;
        set_properties_by_id(storage, sheet_id, id, &props);
    }
    Ok(())
}

pub fn clear_cell_formats_by_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[CellId],
) {
    for id in cell_ids {
        clear_cell_format_by_id(storage, sheet_id, id);
    }
}
