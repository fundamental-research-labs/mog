//! Sparse dimension records keyed by stable native axis identities.
use crate::identity::GridIndex;
use cell_types::{ColId, RowId};
use domain_types::units::{CharWidth, Points};
use domain_types::{ColDimension, RowDimension, RowXmlHints, SheetData};
use rustc_hash::{FxHashMap, FxHashSet};

/// Imported formats retain their exact workbook XF lineage until edited.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum StoredAxisFormat {
    ImportedStyle(u32),
    Detailed(Box<domain_types::CellFormat>),
}
impl StoredAxisFormat {
    pub fn resolve<'a>(
        &'a self,
        palette: &'a [domain_types::CellFormat],
    ) -> Option<&'a domain_types::CellFormat> {
        match self {
            Self::ImportedStyle(index) => palette.get(*index as usize),
            Self::Detailed(format) => Some(format),
        }
    }
    pub fn xlsx_style_id(&self) -> Option<u32> {
        match self {
            Self::ImportedStyle(index) => Some(*index),
            Self::Detailed(_) => None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct DimensionState {
    pub rows: FxHashMap<RowId, RowMetadata>,
    pub columns: FxHashMap<ColId, ColumnMetadata>,
    pub manual_hidden_rows: FxHashSet<RowId>,
    pub filter_hidden_rows: FxHashMap<String, FxHashSet<RowId>>,
    pub hidden_columns: FxHashSet<ColId>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct RowMetadata {
    pub format: Option<StoredAxisFormat>,
    pub height: Option<Points>,
    pub height_str: Option<String>,
    pub custom_height: bool,
    pub explicit_hidden: bool,
    pub custom_format: bool,
    pub outline_level: Option<u8>,
    pub explicit_outline_level_zero: bool,
    pub collapsed: Option<bool>,
    pub thick_top: bool,
    pub thick_bot: bool,
    pub descent: Option<f64>,
    pub phonetic: bool,
    pub xml_hints: RowXmlHints,
}

impl RowMetadata {
    fn from_domain(source: &RowDimension) -> Self {
        Self {
            format: None,
            height: Some(Points(source.height)),
            height_str: source.height_str.clone(),
            custom_height: source.custom_height.clone(),
            explicit_hidden: source.explicit_hidden.clone(),
            custom_format: source.custom_format.clone(),
            outline_level: source.outline_level.clone(),
            explicit_outline_level_zero: source.explicit_outline_level_zero.clone(),
            collapsed: source.collapsed.clone(),
            thick_top: source.thick_top.clone(),
            thick_bot: source.thick_bot.clone(),
            descent: source.descent.clone(),
            phonetic: source.phonetic.clone(),
            xml_hints: source.xml_hints.clone(),
        }
    }

    pub fn to_domain(&self, row: u32, _default: Points, hidden: bool) -> RowDimension {
        RowDimension {
            row,
            // Zero is the transport sentinel for an omitted OOXML height;
            // display defaults are resolved by the runtime dimension queries.
            height: self.height.unwrap_or(Points(0.0)).0,
            hidden,
            height_str: self.height_str.clone(),
            custom_height: self.custom_height.clone(),
            explicit_hidden: self.explicit_hidden.clone(),
            custom_format: self.custom_format.clone(),
            outline_level: self.outline_level.clone(),
            explicit_outline_level_zero: self.explicit_outline_level_zero.clone(),
            collapsed: self.collapsed.clone(),
            thick_top: self.thick_top.clone(),
            thick_bot: self.thick_bot.clone(),
            descent: self.descent.clone(),
            phonetic: self.phonetic.clone(),
            xml_hints: self.xml_hints.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct ColumnMetadata {
    pub format: Option<StoredAxisFormat>,
    pub width: Option<CharWidth>,
    pub width_str: Option<String>,
    pub width_present: Option<bool>,
    pub custom_width: bool,
    pub custom_width_attr: Option<bool>,
    pub hidden_attr: Option<bool>,
    pub best_fit: bool,
    pub best_fit_attr: Option<bool>,
    pub outline_level: Option<u8>,
    pub collapsed: bool,
    pub collapsed_attr: Option<bool>,
    pub phonetic: bool,
    pub phonetic_attr: Option<bool>,
}

impl ColumnMetadata {
    fn from_domain(source: &ColDimension) -> Self {
        Self {
            format: None,
            width: Some(CharWidth(source.width)),
            width_str: source.width_str.clone(),
            width_present: source.width_present.clone(),
            custom_width: source.custom_width.clone(),
            custom_width_attr: source.custom_width_attr.clone(),
            hidden_attr: source.hidden_attr.clone(),
            best_fit: source.best_fit.clone(),
            best_fit_attr: source.best_fit_attr.clone(),
            outline_level: source.outline_level.clone(),
            collapsed: source.collapsed.clone(),
            collapsed_attr: source.collapsed_attr.clone(),
            phonetic: source.phonetic.clone(),
            phonetic_attr: source.phonetic_attr.clone(),
        }
    }

    pub fn to_domain(&self, col: u32, default: CharWidth, hidden: bool) -> ColDimension {
        ColDimension {
            col,
            width: self.width.unwrap_or(default).0,
            hidden,
            width_str: self.width_str.clone(),
            width_present: self.width_present.clone(),
            custom_width: self.custom_width.clone(),
            custom_width_attr: self.custom_width_attr.clone(),
            hidden_attr: self.hidden_attr.clone(),
            best_fit: self.best_fit.clone(),
            best_fit_attr: self.best_fit_attr.clone(),
            outline_level: self.outline_level.clone(),
            collapsed: self.collapsed.clone(),
            collapsed_attr: self.collapsed_attr.clone(),
            phonetic: self.phonetic.clone(),
            phonetic_attr: self.phonetic_attr.clone(),
        }
    }
}

impl DimensionState {
    pub fn from_import(
        sheet: &SheetData,
        row_id_at: impl Fn(u32) -> Option<RowId>,
        col_id_at: impl Fn(u32) -> Option<ColId>,
    ) -> Self {
        let mut state = Self::default();
        let structural_rows: FxHashSet<u32> = sheet
            .outline_groups
            .iter()
            .filter(|group| group.is_row && (group.collapsed || group.hidden))
            .flat_map(|group| group.start..=group.end)
            .collect();
        let structural_columns: FxHashSet<u32> = sheet
            .outline_groups
            .iter()
            .filter(|group| !group.is_row && (group.collapsed || group.hidden))
            .flat_map(|group| group.start..=group.end)
            .collect();
        for source in &sheet.dimensions.row_heights {
            let Some(id) = row_id_at(source.row) else {
                continue;
            };
            let mut row = RowMetadata::from_domain(source);
            // Hidden/outline/descent/spans records need not author a height.
            // Preserve explicitly authored default heights as well as custom ones.
            if !source.custom_height && source.height <= 0.0 && source.height_str.is_none() {
                row.height = None;
            }
            state.rows.insert(id, row);
            if source.hidden && !structural_rows.contains(&source.row) {
                state.manual_hidden_rows.insert(id);
            }
        }
        for source in &sheet.dimensions.col_widths {
            let Some(id) = col_id_at(source.col) else {
                continue;
            };
            let mut column = ColumnMetadata::from_domain(source);
            if source.width_present == Some(false) {
                column.width = None;
            }
            state.columns.insert(id, column);
            if source.hidden && !structural_columns.contains(&source.col) {
                state.hidden_columns.insert(id);
            }
        }
        for style in &sheet.row_styles {
            if let Some(id) = row_id_at(style.row) {
                state.rows.entry(id).or_default().format =
                    Some(StoredAxisFormat::ImportedStyle(style.style_id));
            }
        }
        for style in &sheet.col_styles {
            if let Some(id) = col_id_at(style.col) {
                state.columns.entry(id).or_default().format =
                    Some(StoredAxisFormat::ImportedStyle(style.style_id));
            }
        }
        state
    }

    pub fn row_hidden(&self, id: &RowId) -> bool {
        self.manual_hidden_rows.contains(id)
            || self
                .filter_hidden_rows
                .values()
                .any(|rows| rows.contains(id))
    }

    pub fn retain_axes(&mut self, grid: &GridIndex) {
        self.rows.retain(|id, _| grid.row_index(id).is_some());
        self.columns.retain(|id, _| grid.col_index(id).is_some());
        self.manual_hidden_rows
            .retain(|id| grid.row_index(id).is_some());
        self.filter_hidden_rows.retain(|_, rows| {
            rows.retain(|id| grid.row_index(id).is_some());
            !rows.is_empty()
        });
        self.hidden_columns
            .retain(|id| grid.col_index(id).is_some());
    }

    pub fn remap_axes(
        &mut self,
        rows: impl Fn(RowId) -> Option<RowId>,
        columns: impl Fn(ColId) -> Option<ColId>,
    ) {
        self.rows = std::mem::take(&mut self.rows)
            .into_iter()
            .filter_map(|(id, value)| Some((rows(id)?, value)))
            .collect();
        self.columns = std::mem::take(&mut self.columns)
            .into_iter()
            .filter_map(|(id, value)| Some((columns(id)?, value)))
            .collect();
        self.manual_hidden_rows = self
            .manual_hidden_rows
            .iter()
            .filter_map(|id| rows(*id))
            .collect();
        for hidden in self.filter_hidden_rows.values_mut() {
            *hidden = hidden.iter().filter_map(|id| rows(*id)).collect();
        }
        self.hidden_columns = self
            .hidden_columns
            .iter()
            .filter_map(|id| columns(*id))
            .collect();
    }
}
