use super::shared;
use crate::engine_types::AnnotationRecord;
use crate::snapshot::MutationResult;
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::services;
use bridge_core as bridge;
use cell_types::SheetId;
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "objects_annotations",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    #[bridge::write(scope = "cell")]
    pub fn set_cell_annotation_by_position(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        text: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::objects::set_cell_annotation_by_position(
            &mut self.stores,
            &self.mirror,
            sheet_id,
            row,
            col,
            text,
        )?;
        Ok(shared::with_empty_patches(result))
    }

    #[bridge::read(scope = "cell")]
    pub fn get_cell_annotation_by_position(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<Option<AnnotationRecord>, ComputeError> {
        services::objects::get_cell_annotation_by_position(&self.stores, sheet_id, row, col)
    }

    #[bridge::write(scope = "cell")]
    pub fn remove_cell_annotation_by_position(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::objects::remove_cell_annotation_by_position(
            &mut self.stores,
            sheet_id,
            row,
            col,
        )?;
        Ok(shared::with_empty_patches(result))
    }

    #[bridge::read(scope = "sheet")]
    pub fn list_cell_annotations(
        &self,
        sheet_id: &SheetId,
    ) -> Result<Vec<AnnotationRecord>, ComputeError> {
        services::objects::list_cell_annotations(&self.stores, sheet_id)
    }

    #[bridge::write(scope = "workbook")]
    pub fn set_table_annotation(
        &mut self,
        table_ref: &str,
        text: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::objects::set_table_annotation(
            &mut self.stores,
            &self.mirror,
            table_ref,
            text,
        )?;
        Ok(shared::with_empty_patches(result))
    }

    #[bridge::read(scope = "workbook")]
    pub fn get_table_annotation(
        &self,
        table_ref: &str,
    ) -> Result<Option<AnnotationRecord>, ComputeError> {
        services::objects::get_table_annotation(&self.stores, &self.mirror, table_ref)
    }

    #[bridge::write(scope = "workbook")]
    pub fn remove_table_annotation(
        &mut self,
        table_ref: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::objects::remove_table_annotation(&mut self.stores, &self.mirror, table_ref)?;
        Ok(shared::with_empty_patches(result))
    }

    #[bridge::read(scope = "workbook")]
    pub fn list_table_annotations(&self) -> Result<Vec<AnnotationRecord>, ComputeError> {
        services::objects::list_table_annotations(&self.stores, &self.mirror)
    }
}
