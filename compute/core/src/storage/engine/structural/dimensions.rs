use super::super::YrsComputeEngine;
use super::super::services;
use super::super::validation;
use crate::snapshot::MutationResult;
use cell_types::SheetId;
use compute_wire::mutation::serialize_multi_viewport_patches;
use value_types::ComputeError;

impl YrsComputeEngine {
    pub(super) fn apply_set_row_height(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        height_px: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Validate in canonical units (points)
        let height_px = domain_types::units::Pixels(height_px);
        let height_pt = domain_types::units::pixels_to_points(height_px);
        validation::structure::validate_row_height(height_pt)?;
        services::structural::set_row_height(&mut self.stores, sheet_id, row, height_px)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    pub(super) fn apply_set_col_width(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
        width_px: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Validate in canonical units (char-width)
        let width_px = domain_types::units::Pixels(width_px);
        let mdw = domain_types::units::platform_mdw();
        let width_cw = domain_types::units::pixels_to_char_width(width_px, mdw);
        validation::structure::validate_col_width(width_cw)?;
        services::structural::set_col_width(&mut self.stores, sheet_id, col, width_px)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    pub(super) fn apply_set_col_widths(
        &mut self,
        sheet_id: &SheetId,
        widths: &[(u32, f64)],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mdw = domain_types::units::platform_mdw();
        let widths_px: Vec<(u32, domain_types::units::Pixels)> = widths
            .iter()
            .map(|(col, width)| (*col, domain_types::units::Pixels(*width)))
            .collect();
        for (_, width_px) in &widths_px {
            let width_cw = domain_types::units::pixels_to_char_width(*width_px, mdw);
            validation::structure::validate_col_width(width_cw)?;
        }
        services::structural::set_col_widths(&mut self.stores, sheet_id, &widths_px)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    pub(super) fn apply_set_col_width_chars(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
        width_chars: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let width_cw = domain_types::units::CharWidth(width_chars);
        validation::structure::validate_col_width(width_cw)?;
        services::structural::set_col_width_chars(&mut self.stores, sheet_id, col, width_cw)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    pub(super) fn apply_set_col_widths_chars(
        &mut self,
        sheet_id: &SheetId,
        widths: &[(u32, f64)],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let widths_cw: Vec<(u32, domain_types::units::CharWidth)> = widths
            .iter()
            .map(|(col, width)| (*col, domain_types::units::CharWidth(*width)))
            .collect();
        for (_, width_cw) in &widths_cw {
            validation::structure::validate_col_width(*width_cw)?;
        }
        services::structural::set_col_widths_chars(&mut self.stores, sheet_id, &widths_cw)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    pub(super) fn apply_hide_rows(
        &mut self,
        sheet_id: &SheetId,
        rows: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::hide_rows(&mut self.stores, sheet_id, rows)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    pub(super) fn apply_unhide_rows(
        &mut self,
        sheet_id: &SheetId,
        rows: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::unhide_rows(&mut self.stores, sheet_id, rows)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    pub(super) fn apply_hide_columns(
        &mut self,
        sheet_id: &SheetId,
        cols: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::hide_columns(&mut self.stores, sheet_id, cols)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    pub(super) fn apply_unhide_columns(
        &mut self,
        sheet_id: &SheetId,
        cols: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::unhide_columns(&mut self.stores, sheet_id, cols)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }
}
