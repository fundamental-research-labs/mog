use crate::engine_types::AnnotationRecord;
use crate::snapshot::MutationResult;
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::services;
use bridge_core as bridge;
use cell_types::SheetId;
use value_types::ComputeError;

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "objects_annotations",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
    #[bridge::write(scope = "cell")]
    pub fn set_cell_annotation_by_position(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        text: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::objects::set_cell_annotation_by_position(
                &mut engine.stores,
                &mut engine.cell_store,
                sheet_id,
                row,
                col,
                text,
            )?;
            Ok(result)
        })
    }

    #[bridge::read(scope = "cell")]
    pub fn get_cell_annotation_by_position(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<Option<AnnotationRecord>, ComputeError> {
        services::objects::get_cell_annotation_by_position(
            &self.stores,
            &self.cell_store,
            sheet_id,
            row,
            col,
        )
    }

    #[bridge::write(scope = "cell")]
    pub fn remove_cell_annotation_by_position(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::objects::remove_cell_annotation_by_position(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                row,
                col,
            )?;
            Ok(result)
        })
    }

    #[bridge::read(scope = "sheet")]
    pub fn list_cell_annotations(
        &self,
        sheet_id: &SheetId,
    ) -> Result<Vec<AnnotationRecord>, ComputeError> {
        services::objects::list_cell_annotations(&self.stores, &self.cell_store, sheet_id)
    }

    #[bridge::write(scope = "workbook")]
    pub fn set_table_annotation(
        &mut self,
        table_ref: &str,
        text: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::objects::set_table_annotation(
                &mut engine.stores,
                &engine.cell_store,
                table_ref,
                text,
            )?;
            Ok(result)
        })
    }

    #[bridge::read(scope = "workbook")]
    pub fn get_table_annotation(
        &self,
        table_ref: &str,
    ) -> Result<Option<AnnotationRecord>, ComputeError> {
        services::objects::get_table_annotation(&self.stores, &self.cell_store, table_ref)
    }

    #[bridge::write(scope = "workbook")]
    pub fn remove_table_annotation(
        &mut self,
        table_ref: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::objects::remove_table_annotation(
                &mut engine.stores,
                &engine.cell_store,
                table_ref,
            )?;
            Ok(result)
        })
    }

    #[bridge::read(scope = "workbook")]
    pub fn list_table_annotations(&self) -> Result<Vec<AnnotationRecord>, ComputeError> {
        services::objects::list_table_annotations(&self.stores, &self.cell_store)
    }
}
