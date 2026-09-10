use domain_types::CellFormat;
use snapshot_types::CellProperties;

// Value-presence bits occupy the low thirteen positions; booleans need no field.
const FORMAT: u32 = 1 << 0;
const PROVENANCE: u32 = 1 << 1;
const VALIDATION: u32 = 1 << 2;
const CONNECTION: u32 = 1 << 3;
const STYLE: u32 = 1 << 4;
const CELL_METADATA: u32 = 1 << 5;
const VALUE_METADATA: u32 = 1 << 6;
const DATE_LEXICAL: u32 = 1 << 7;
const RESULT_TYPE: u32 = 1 << 8;
const CACHE_PROVENANCE: u32 = 1 << 9;
const SST_INDEX: u32 = 1 << 10;
const ORIGINAL_VALUE: u32 = 1 << 11;
const RICH_ERROR: u32 = 1 << 12;
const PHONETIC: u32 = 1 << 13;
const EMPTY_CACHE: u32 = 1 << 14;
const ARRAY_FORMULA: u32 = 1 << 15;
const CSE_ANCHOR: u32 = 1 << 16;
const FORMULA_CACHE: u32 =
    VALUE_METADATA | RICH_ERROR | RESULT_TYPE | CACHE_PROVENANCE | EMPTY_CACHE;

/// Only present values allocate storage. The mask also holds boolean properties,
/// which need no payload entry. Imported style-only cells keep the enum shortcut.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StoredDetailedProperties {
    presence: u32,
    fields: Box<[StoredProperty]>,
}

#[derive(Debug, Clone, PartialEq)]
enum StoredProperty {
    Format(Box<CellFormat>),
    Provenance(String),
    Validation(String),
    Connection(String),
    Style(u32),
    CellMetadata(u32),
    ValueMetadata(u32),
    DateLexical(String),
    ResultType(u8),
    CacheProvenance(Box<domain_types::FormulaCacheProvenance>),
    SstIndex(u32),
    OriginalValue(String),
    RichError(domain_types::ImportedRichError),
}

impl StoredProperty {
    fn mask(&self) -> u32 {
        match self {
            Self::Format(_) => FORMAT,
            Self::Provenance(_) => PROVENANCE,
            Self::Validation(_) => VALIDATION,
            Self::Connection(_) => CONNECTION,
            Self::Style(_) => STYLE,
            Self::CellMetadata(_) => CELL_METADATA,
            Self::ValueMetadata(_) => VALUE_METADATA,
            Self::DateLexical(_) => DATE_LEXICAL,
            Self::ResultType(_) => RESULT_TYPE,
            Self::CacheProvenance(_) => CACHE_PROVENANCE,
            Self::SstIndex(_) => SST_INDEX,
            Self::OriginalValue(_) => ORIGINAL_VALUE,
            Self::RichError(_) => RICH_ERROR,
        }
    }
}

impl StoredDetailedProperties {
    pub(super) fn from_properties(props: CellProperties) -> Self {
        let fields = [
            props.format.map(|v| StoredProperty::Format(Box::new(v))),
            props.provenance.map(StoredProperty::Provenance),
            props.validation.map(StoredProperty::Validation),
            props.connection_id.map(StoredProperty::Connection),
            props.style_id.map(StoredProperty::Style),
            props.cell_metadata_index.map(StoredProperty::CellMetadata),
            props.vm.map(StoredProperty::ValueMetadata),
            props.date_lexical_value.map(StoredProperty::DateLexical),
            props.formula_result_type.map(StoredProperty::ResultType),
            (!props.formula_cache_provenance.is_absent_or_unknown())
                .then(|| StoredProperty::CacheProvenance(Box::new(props.formula_cache_provenance))),
            props.original_sst_index.map(StoredProperty::SstIndex),
            props.original_value.map(StoredProperty::OriginalValue),
            props.imported_rich_error.map(StoredProperty::RichError),
        ];
        let mut presence = if props.phonetic { PHONETIC } else { 0 }
            | if props.has_empty_cached_value {
                EMPTY_CACHE
            } else {
                0
            }
            | if props.is_array_formula {
                ARRAY_FORMULA
            } else {
                0
            }
            | if props.is_cse_anchor { CSE_ANCHOR } else { 0 };
        let mut stored = Vec::with_capacity(fields.iter().flatten().count());
        for field in fields.into_iter().flatten() {
            presence |= field.mask();
            stored.push(field);
        }
        Self {
            presence,
            fields: stored.into_boxed_slice(),
        }
    }

    pub(super) fn properties(&self) -> CellProperties {
        let mut props = CellProperties {
            phonetic: self.presence & PHONETIC != 0,
            has_empty_cached_value: self.presence & EMPTY_CACHE != 0,
            is_array_formula: self.presence & ARRAY_FORMULA != 0,
            is_cse_anchor: self.presence & CSE_ANCHOR != 0,
            ..Default::default()
        };
        for field in &self.fields {
            match field {
                StoredProperty::Format(v) => props.format = Some(*v.clone()),
                StoredProperty::Provenance(v) => props.provenance = Some(v.clone()),
                StoredProperty::Validation(v) => props.validation = Some(v.clone()),
                StoredProperty::Connection(v) => props.connection_id = Some(v.clone()),
                StoredProperty::Style(v) => props.style_id = Some(*v),
                StoredProperty::CellMetadata(v) => props.cell_metadata_index = Some(*v),
                StoredProperty::ValueMetadata(v) => props.vm = Some(*v),
                StoredProperty::DateLexical(v) => props.date_lexical_value = Some(v.clone()),
                StoredProperty::ResultType(v) => props.formula_result_type = Some(*v),
                StoredProperty::CacheProvenance(v) => props.formula_cache_provenance = *v.clone(),
                StoredProperty::SstIndex(v) => props.original_sst_index = Some(*v),
                StoredProperty::OriginalValue(v) => props.original_value = Some(v.clone()),
                StoredProperty::RichError(v) => props.imported_rich_error = Some(*v),
            }
        }
        props
    }

    fn field(&self, mask: u32) -> Option<&StoredProperty> {
        if self.presence & mask == 0 {
            return None;
        }
        // Values are packed in ascending mask order; count preceding fields.
        self.fields
            .get((self.presence & (mask - 1)).count_ones() as usize)
    }

    pub(super) fn style_id(&self) -> Option<u32> {
        match self.field(STYLE) {
            Some(StoredProperty::Style(id)) => Some(*id),
            _ => None,
        }
    }

    pub(super) fn format(&self) -> Option<&CellFormat> {
        match self.field(FORMAT) {
            Some(StoredProperty::Format(format)) => Some(format),
            _ => None,
        }
    }

    pub(super) fn has_format(&self) -> bool {
        self.presence & (STYLE | FORMAT) != 0
    }

    pub(super) fn has_formula_cache(&self) -> bool {
        self.presence & FORMULA_CACHE != 0
    }

    pub(super) fn is_empty(&self) -> bool {
        self.presence == 0
    }

    pub(super) fn clear_formula_cache(&mut self) {
        if self.presence & FORMULA_CACHE == 0 {
            return;
        }
        self.presence &= !FORMULA_CACHE;
        let mut fields = std::mem::take(&mut self.fields).into_vec();
        fields.retain(|field| field.mask() & FORMULA_CACHE == 0);
        self.fields = fields.into_boxed_slice();
    }
}

#[cfg(test)]
mod packed_property_tests {
    use super::*;

    #[test]
    fn all_properties_roundtrip_and_cache_clear_preserves_other_fields() {
        let mut props = CellProperties {
            format: Some(CellFormat {
                bold: Some(true),
                ..Default::default()
            }),
            provenance: Some("source".into()),
            validation: Some("validation".into()),
            connection_id: Some("connection".into()),
            style_id: Some(7),
            cell_metadata_index: Some(11),
            vm: Some(13),
            phonetic: true,
            date_lexical_value: Some("2026-01-02".into()),
            formula_result_type: Some(2),
            has_empty_cached_value: true,
            formula_cache_provenance: domain_types::FormulaCacheProvenance {
                state: domain_types::FormulaCacheState::ImportedCurrent,
                cached_value_lexeme: Some("3".into()),
                ..Default::default()
            },
            original_sst_index: Some(17),
            original_value: Some("original".into()),
            imported_rich_error: Some(domain_types::ImportedRichError {
                vm: 13,
                semantic: value_types::CellError::Calc,
                fallback: value_types::CellError::Value,
            }),
            is_array_formula: true,
            is_cse_anchor: true,
        };
        let mut stored = StoredDetailedProperties::from_properties(props.clone());
        assert_eq!(stored.presence, (1 << 17) - 1);
        assert_eq!(stored.properties(), props);
        assert_eq!(stored.format(), props.format.as_ref());
        assert_eq!(stored.style_id(), props.style_id);
        let previous = stored.clone();
        stored.clear_formula_cache();
        props.formula_result_type = None;
        props.vm = None;
        props.imported_rich_error = None;
        props.has_empty_cached_value = false;
        props.formula_cache_provenance = Default::default();
        assert_eq!(stored.properties(), props);
        assert_eq!(stored.style_id(), props.style_id);
        assert_eq!(stored.format(), props.format.as_ref());
        assert!(previous.properties().has_empty_cached_value);
        let cleared = stored.clone();
        stored.clear_formula_cache();
        assert_eq!(stored, cleared);
    }

    #[test]
    fn boolean_only_and_sparse_metadata_records_retain_values_with_small_headers() {
        let props = CellProperties {
            phonetic: true,
            is_array_formula: true,
            is_cse_anchor: true,
            has_empty_cached_value: true,
            ..Default::default()
        };
        let stored = StoredDetailedProperties::from_properties(props.clone());
        assert_eq!(stored.properties(), props);
        assert_eq!(std::mem::size_of_val(&*stored.fields), 0);
        assert!(std::mem::size_of_val(&stored) <= 24);
        let props = CellProperties {
            original_value: Some("value".into()),
            original_sst_index: Some(0),
            ..Default::default()
        };
        let stored = StoredDetailedProperties::from_properties(props.clone());
        assert_eq!(stored.properties(), props);
        assert!(std::mem::size_of_val(&stored) + std::mem::size_of_val(&*stored.fields) <= 88);
    }
}
