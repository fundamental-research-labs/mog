//! **NOTE**: Canonical definitions now live in `domain_types::domain::pivot::config`.
//! This module re-exports boundary DTOs and owns the typed engine config used by
//! compute-pivot.

use serde::{Deserialize, Serialize};
use value_types::FiniteF64;

use crate::field::PivotField;
use crate::filter_types::PivotFilter;
use crate::placement::PivotFieldPlacement;
use crate::placement_flat::{PivotFieldArea, PivotFieldPlacementFlat};

pub use domain_types::domain::pivot::config::validate_pivot_config_json;
pub use domain_types::domain::pivot::{
    CalculatedField, CalculatedFieldId, CellRange, LayoutForm, OutputLocation,
    PIVOT_CONFIG_SCHEMA_VERSION, PivotRenderedBounds, PivotTableConfig, PivotTableDataOptions,
    PivotTableLayout, PivotTableStyle, SubtotalLocation,
};

fn default_pivot_config_schema_version() -> u32 {
    PIVOT_CONFIG_SCHEMA_VERSION
}

/// Internal typed-placement pivot configuration used by the compute engine.
///
/// The app/bridge/storage boundary uses [`PivotTableConfig`] with flat
/// `PivotFieldPlacementFlat` records. The compute engine converts that DTO into
/// this type before validation and execution so area-specific placement fields
/// remain type-safe internally.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotEngineConfig {
    /// Version of the persisted pivot configuration schema.
    #[serde(default = "default_pivot_config_schema_version")]
    pub schema_version: u32,
    /// Unique identifier for this pivot table.
    pub id: String,
    /// Display name of the pivot table.
    pub name: String,
    /// Stable ID of the sheet containing the source data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sheet_id: Option<String>,
    /// Name of the sheet containing the source data.
    #[serde(default)]
    pub source_sheet_name: String,
    /// Range of cells in the source sheet that provide data.
    pub source_range: CellRange,
    /// Name of the sheet where the pivot table is rendered.
    pub output_sheet_name: String,
    /// Top-left cell of the pivot table output.
    pub output_location: OutputLocation,
    /// Available fields detected from the source data.
    pub fields: Vec<PivotField>,
    /// Type-safe field placements used by engine logic.
    #[serde(default)]
    pub placements: Vec<PivotFieldPlacement>,
    /// Filter configurations for individual fields.
    pub filters: Vec<PivotFilter>,
    /// Layout options.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<PivotTableLayout>,
    /// Style options.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<PivotTableStyle>,
    /// Data display options.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_options: Option<PivotTableDataOptions>,
    /// Timestamp when the pivot table was created.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<FiniteF64>,
    /// Timestamp when the pivot table was last updated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<FiniteF64>,
    /// Calculated fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculated_fields: Option<Vec<CalculatedField>>,
    /// When true, allows multiple filter criteria on a single field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_multiple_filters_per_field: Option<bool>,
    /// Controls whether the pivot table auto-formats when refreshed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_format: Option<bool>,
    /// Controls whether custom formatting is preserved on refresh.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preserve_formatting: Option<bool>,
    /// Pivot cache ID this table reads from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_id: Option<u32>,
    /// OOXML data-axis placement.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_on_rows: Option<bool>,
    /// OOXML rendered pivot range.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ref_range: Option<String>,
    /// OOXML first data row offset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_data_row: Option<u32>,
    /// OOXML first header row offset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_header_row: Option<u32>,
    /// OOXML first data column offset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_data_col: Option<u32>,
    /// OOXML row page count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_per_page: Option<u32>,
    /// OOXML column page count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols_per_page: Option<u32>,
    /// Row items array for OOXML layout reconstruction.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub row_items: Vec<domain_types::domain::pivot::PivotRowColItem>,
    /// Column items array for OOXML layout reconstruction.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub col_items: Vec<domain_types::domain::pivot::PivotRowColItem>,
}

impl TryFrom<PivotTableConfig> for PivotEngineConfig {
    type Error = String;

    fn try_from(config: PivotTableConfig) -> Result<Self, Self::Error> {
        Ok(Self {
            schema_version: config.schema_version,
            id: config.id,
            name: config.name,
            source_sheet_id: config.source_sheet_id,
            source_sheet_name: config.source_sheet_name,
            source_range: config.source_range,
            output_sheet_name: config.output_sheet_name,
            output_location: config.output_location,
            fields: config.fields,
            placements: config
                .placements
                .into_iter()
                .map(PivotFieldPlacement::from)
                .collect(),
            filters: config.filters,
            layout: config.layout,
            style: config.style,
            data_options: config.data_options,
            created_at: config
                .created_at
                .map(FiniteF64::try_from)
                .transpose()
                .map_err(|_| "created_at must be finite".to_string())?,
            updated_at: config
                .updated_at
                .map(FiniteF64::try_from)
                .transpose()
                .map_err(|_| "updated_at must be finite".to_string())?,
            calculated_fields: config.calculated_fields,
            allow_multiple_filters_per_field: config.allow_multiple_filters_per_field,
            auto_format: config.auto_format,
            preserve_formatting: config.preserve_formatting,
            cache_id: config.cache_id,
            data_on_rows: config.data_on_rows,
            ref_range: config.ref_range,
            first_data_row: config.first_data_row,
            first_header_row: config.first_header_row,
            first_data_col: config.first_data_col,
            rows_per_page: config.rows_per_page,
            cols_per_page: config.cols_per_page,
            row_items: config.row_items,
            col_items: config.col_items,
        })
    }
}

impl From<PivotEngineConfig> for PivotTableConfig {
    fn from(config: PivotEngineConfig) -> Self {
        Self {
            schema_version: config.schema_version,
            id: config.id,
            name: config.name,
            source_sheet_id: config.source_sheet_id,
            source_sheet_name: config.source_sheet_name,
            source_range: config.source_range,
            output_sheet_name: config.output_sheet_name,
            output_location: config.output_location,
            fields: config.fields,
            placements: config
                .placements
                .into_iter()
                .map(PivotFieldPlacementFlat::from)
                .collect(),
            filters: config.filters,
            layout: config.layout,
            style: config.style,
            data_options: config.data_options,
            created_at: config.created_at.map(f64::from),
            updated_at: config.updated_at.map(f64::from),
            calculated_fields: config.calculated_fields,
            allow_multiple_filters_per_field: config.allow_multiple_filters_per_field,
            auto_format: config.auto_format,
            preserve_formatting: config.preserve_formatting,
            cache_id: config.cache_id,
            data_on_rows: config.data_on_rows,
            ref_range: config.ref_range,
            first_data_row: config.first_data_row,
            first_header_row: config.first_header_row,
            first_data_col: config.first_data_col,
            rows_per_page: config.rows_per_page,
            cols_per_page: config.cols_per_page,
            row_items: config.row_items,
            col_items: config.col_items,
        }
    }
}

impl PivotEngineConfig {
    /// Get all placements for a specific area, sorted by position.
    #[must_use]
    pub fn get_placements_for_area(&self, area: PivotFieldArea) -> Vec<&PivotFieldPlacement> {
        let mut placements: Vec<&PivotFieldPlacement> = self
            .placements
            .iter()
            .filter(|p| {
                matches!(
                    (area, p),
                    (PivotFieldArea::Row, PivotFieldPlacement::Row(_))
                        | (PivotFieldArea::Column, PivotFieldPlacement::Column(_))
                        | (PivotFieldArea::Value, PivotFieldPlacement::Value(_))
                        | (PivotFieldArea::Filter, PivotFieldPlacement::Filter(_))
                )
            })
            .collect();
        placements.sort_by_key(|p| p.position());
        placements
    }

    /// Get a field by ID.
    #[must_use]
    pub fn get_field(&self, field_id: &str) -> Option<&PivotField> {
        self.fields.iter().find(|f| f.id.as_str() == field_id)
    }

    /// Get value field placements, sorted by position.
    #[must_use]
    pub fn value_placements(&self) -> Vec<&PivotFieldPlacement> {
        self.get_placements_for_area(PivotFieldArea::Value)
    }

    /// Get row field placements, sorted by position.
    #[must_use]
    pub fn row_placements(&self) -> Vec<&PivotFieldPlacement> {
        self.get_placements_for_area(PivotFieldArea::Row)
    }

    /// Get column field placements, sorted by position.
    #[must_use]
    pub fn column_placements(&self) -> Vec<&PivotFieldPlacement> {
        self.get_placements_for_area(PivotFieldArea::Column)
    }

    /// Convert flat placements to typed placements.
    pub fn from_flat_placements(flat: Vec<PivotFieldPlacementFlat>) -> Vec<PivotFieldPlacement> {
        flat.into_iter().map(PivotFieldPlacement::from).collect()
    }

    /// Convert typed placements back to flat format for boundary serialization.
    pub fn to_flat_placements(typed: &[PivotFieldPlacement]) -> Vec<PivotFieldPlacementFlat> {
        typed
            .iter()
            .cloned()
            .map(PivotFieldPlacementFlat::from)
            .collect()
    }

    /// Move a field placement to a target area and position, recalculating all indices.
    pub fn reorder_placement(
        &mut self,
        field_index: usize,
        target_area: PivotFieldArea,
        position: usize,
    ) -> bool {
        if field_index >= self.placements.len() {
            return false;
        }

        let mut placement = self.placements.remove(field_index);
        placement = placement.into_area(target_area);
        placement.base_mut().position = position;
        self.placements.push(placement);
        Self::reindex_placements(&mut self.placements);

        true
    }

    fn reindex_placements(placements: &mut [PivotFieldPlacement]) {
        for area in &[
            PivotFieldArea::Row,
            PivotFieldArea::Column,
            PivotFieldArea::Value,
            PivotFieldArea::Filter,
        ] {
            let mut area_indices: Vec<usize> = placements
                .iter()
                .enumerate()
                .filter(|(_, p)| p.area() == *area)
                .map(|(i, _)| i)
                .collect();

            area_indices.sort_by_key(|&i| placements[i].position());

            for (new_pos, &idx) in area_indices.iter().enumerate() {
                placements[idx].base_mut().position = new_pos;
            }
        }
    }
}
