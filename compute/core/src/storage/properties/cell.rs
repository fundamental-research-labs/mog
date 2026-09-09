use super::merge::{merge_formats, normalize_format_patch};
use crate::border_patch::BorderPatchField;
use crate::engine_types::formatting::CellProperties;
use crate::storage::WorkbookStorage;
use cell_types::{CellId, SheetId};
use compute_document::hex::{id_to_hex, parse_cell_id};
use domain_types::{CellBorders, CellFormat};
use rustc_hash::FxHashMap;

/// Imported style-only cells retain a palette index without allocating metadata
/// or a full format. Other authored properties are allocated only when present.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum StoredCellProperties {
    ImportedStyle(u32),
    Detailed(Box<StoredDetailedProperties>),
}

/// Imported cache metadata does not allocate the large optional format DTO.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StoredDetailedProperties {
    format: Option<Box<CellFormat>>,
    provenance: Option<String>,
    validation: Option<String>,
    connection_id: Option<String>,
    style_id: Option<u32>,
    cell_metadata_index: Option<u32>,
    vm: Option<u32>,
    phonetic: bool,
    date_lexical_value: Option<String>,
    formula_result_type: Option<u8>,
    has_empty_cached_value: bool,
    formula_cache_provenance: Option<Box<domain_types::FormulaCacheProvenance>>,
    original_sst_index: Option<u32>,
    original_value: Option<String>,
    is_array_formula: bool,
    is_cse_anchor: bool,
}
impl StoredDetailedProperties {
    fn from_properties(props: CellProperties) -> Self {
        Self {
            format: props.format.map(Box::new),
            provenance: props.provenance,
            validation: props.validation,
            connection_id: props.connection_id,
            style_id: props.style_id,
            cell_metadata_index: props.cell_metadata_index,
            vm: props.vm,
            phonetic: props.phonetic,
            date_lexical_value: props.date_lexical_value,
            formula_result_type: props.formula_result_type,
            has_empty_cached_value: props.has_empty_cached_value,
            formula_cache_provenance: (!props.formula_cache_provenance.is_absent_or_unknown())
                .then(|| Box::new(props.formula_cache_provenance)),
            original_sst_index: props.original_sst_index,
            original_value: props.original_value,
            is_array_formula: props.is_array_formula,
            is_cse_anchor: props.is_cse_anchor,
        }
    }
    fn properties(&self) -> CellProperties {
        CellProperties {
            format: self.format.as_deref().cloned(),
            provenance: self.provenance.clone(),
            validation: self.validation.clone(),
            connection_id: self.connection_id.clone(),
            style_id: self.style_id.clone(),
            cell_metadata_index: self.cell_metadata_index.clone(),
            vm: self.vm.clone(),
            phonetic: self.phonetic.clone(),
            date_lexical_value: self.date_lexical_value.clone(),
            formula_result_type: self.formula_result_type.clone(),
            has_empty_cached_value: self.has_empty_cached_value.clone(),
            formula_cache_provenance: self
                .formula_cache_provenance
                .as_deref()
                .cloned()
                .unwrap_or_default(),
            original_sst_index: self.original_sst_index.clone(),
            original_value: self.original_value.clone(),
            is_array_formula: self.is_array_formula.clone(),
            is_cse_anchor: self.is_cse_anchor.clone(),
        }
    }
    fn metadata_is_empty(&self) -> bool {
        self.provenance.is_none()
            && self.validation.is_none()
            && self.connection_id.is_none()
            && self.style_id.is_none()
            && self.cell_metadata_index.is_none()
            && self.vm.is_none()
            && !self.phonetic
            && self.date_lexical_value.is_none()
            && self.formula_result_type.is_none()
            && !self.has_empty_cached_value
            && self.formula_cache_provenance.is_none()
            && self.original_sst_index.is_none()
            && self.original_value.is_none()
            && !self.is_array_formula
            && !self.is_cse_anchor
    }
}

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

    fn format<'a>(&'a self, palette: &'a [CellFormat]) -> Option<(&'a CellFormat, bool)> {
        match self {
            Self::ImportedStyle(id) => palette.get(*id as usize).map(|format| (format, true)),
            Self::Detailed(props) => props
                .style_id
                .and_then(|id| palette.get(id as usize))
                .or(props.format.as_deref())
                .map(|format| (format, props.style_id.is_some())),
        }
    }

    pub(crate) fn has_format(&self) -> bool {
        match self {
            Self::ImportedStyle(_) => true,
            Self::Detailed(props) => props.style_id.is_some() || props.format.is_some(),
        }
    }
}

pub fn get_properties(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Option<CellProperties> {
    Some(
        storage
            .sheet_metadata
            .get(sheet_id)?
            .cell_properties
            .get(&parse_cell_id(cell_id)?)?
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

pub fn set_properties(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
    props: &CellProperties,
) {
    let Some(id) = parse_cell_id(cell_id) else {
        return;
    };
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

pub fn clear_properties(storage: &mut WorkbookStorage, sheet_id: &SheetId, cell_id: &str) {
    let Some(id) = parse_cell_id(cell_id) else {
        return;
    };
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

pub fn clear_formula_cache_metadata(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
) {
    let Some(id) = parse_cell_id(cell_id) else {
        return;
    };
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
                        props.formula_result_type.is_some()
                            || props.has_empty_cached_value
                            || props.formula_cache_provenance.is_some()
                            || (props.format.is_none() && props.metadata_is_empty())
                    }
                })
            {
                crate::storage::engine::history::metadata::capture_cell_properties(
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
        props.formula_result_type = None;
        props.has_empty_cached_value = false;
        props.formula_cache_provenance = Default::default();
        if props.format.is_none() && props.metadata_is_empty() {
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

pub fn get_cell_format(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Option<CellFormat> {
    get_properties(storage, sheet_id, cell_id)?.format
}

pub fn set_cell_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
    format: &CellFormat,
) {
    let mut props = get_properties(storage, sheet_id, cell_id).unwrap_or_default();
    props.format = Some(props.format.as_ref().map_or_else(
        || normalize_format_patch(format),
        |existing| merge_formats(existing, format),
    ));
    props.style_id = None;
    set_properties(storage, sheet_id, cell_id, &props);
}

pub fn patch_cell_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
    format: &CellFormat,
    clear_fields: &[String],
) -> Result<(), value_types::ComputeError> {
    patch_cell_formats(storage, sheet_id, &[cell_id], format, clear_fields)
}

pub fn replace_cell_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
    format: &CellFormat,
) {
    let mut props = get_properties(storage, sheet_id, cell_id).unwrap_or_default();
    props.format = Some(normalize_format_patch(format));
    props.style_id = None;
    set_properties(storage, sheet_id, cell_id, &props);
}

pub fn clear_cell_format(storage: &mut WorkbookStorage, sheet_id: &SheetId, cell_id: &str) {
    if let Some(mut props) = get_properties(storage, sheet_id, cell_id) {
        props.format = None;
        props.style_id = None;
        set_properties(storage, sheet_id, cell_id, &props);
    }
}

pub fn set_cell_formats(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[&str],
    format: &CellFormat,
) {
    for id in cell_ids {
        set_cell_format(storage, sheet_id, id, format);
    }
}

pub fn patch_cell_formats(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[&str],
    format: &CellFormat,
    clear_fields: &[String],
) -> Result<(), value_types::ComputeError> {
    // Validate every patch before writing any part of the batch.
    let patched: Vec<_> = cell_ids
        .iter()
        .map(|id| {
            let mut props = get_properties(storage, sheet_id, id).unwrap_or_default();
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
        set_properties(storage, sheet_id, id, &props);
    }
    Ok(())
}

pub fn patch_cell_borders(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[&str],
    borders: &CellBorders,
    clear_fields: &[BorderPatchField],
) -> Result<(), value_types::ComputeError> {
    for id in cell_ids {
        let mut props = get_properties(storage, sheet_id, id).unwrap_or_default();
        let mut format = props.format.take().unwrap_or_default();
        format.borders = super::apply_borders_patch(format.borders.as_ref(), borders, clear_fields);
        props.format = (format != CellFormat::default()).then_some(format);
        props.style_id = None;
        set_properties(storage, sheet_id, id, &props);
    }
    Ok(())
}

pub fn clear_cell_formats(storage: &mut WorkbookStorage, sheet_id: &SheetId, cell_ids: &[&str]) {
    for id in cell_ids {
        clear_cell_format(storage, sheet_id, id);
    }
}
