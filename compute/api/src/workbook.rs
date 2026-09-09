//! Workbook facade — the main entry point for interacting with a spreadsheet.
//!
//! A `Workbook` wraps the actor [`Dispatch`] and provides high-level methods
//! for sheet discovery, cell access via [`Sheet`] handles, and domain sub-APIs.

use cell_types::SheetId;
use snapshot_types::{RecalcResult, WorkbookSnapshot};

use crate::Sheet;
use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;

// Domain sub-APIs
pub mod history;
pub mod names;
pub mod protection;
pub mod scenarios;
pub mod settings;
pub mod sheets;
pub mod styles;

/// A handle to an open workbook backed by the compute engine.
///
/// `Workbook` is cheap to clone — clones share the same underlying engine
/// (via the actor channel on native, or `Rc<RefCell>` on WASM).
pub struct Workbook {
    pub(crate) dispatch: Dispatch,
}

impl Clone for Workbook {
    fn clone(&self) -> Self {
        Workbook {
            dispatch: self.dispatch.clone(),
        }
    }
}

impl Workbook {
    // -----------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------

    /// Create a `Workbook` from a [`WorkbookSnapshot`].
    ///
    /// This initialises the compute engine, evaluates all formulas, and
    /// returns the workbook handle together with the initial [`RecalcResult`].
    pub fn from_snapshot(
        snapshot: WorkbookSnapshot,
    ) -> Result<(Self, RecalcResult), ComputeApiError> {
        use compute_core::storage::engine::ComputeEngine;

        let (engine, recalc) = ComputeEngine::from_snapshot(snapshot)?;

        #[cfg(feature = "native")]
        let dispatch = Dispatch::spawn(engine)?;

        #[cfg(not(feature = "native"))]
        let dispatch = Dispatch::new(engine);

        Ok((Workbook { dispatch }, recalc))
    }

    /// Create a blank workbook with a single `Sheet1` worksheet.
    pub fn blank() -> Result<(Self, RecalcResult), ComputeApiError> {
        Self::from_snapshot(WorkbookSnapshot {
            sheets: vec![crate::SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
                id: "00000000-0000-0000-0000-000000000001".to_string(),
                name: "Sheet1".to_string(),
                rows: 1_000,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            }],
            ..Default::default()
        })
    }

    /// Load a workbook from an xlsx file on disk, preserving imported formula caches.
    ///
    /// Call [`Self::recalculate`] explicitly to evaluate formulas before exporting.
    pub fn from_xlsx_path(path: &str) -> Result<(Self, RecalcResult), ComputeApiError> {
        let data = std::fs::read(path)
            .map_err(|e| ComputeApiError::InvalidOperation(format!("read {path}: {e}")))?;
        use compute_core::storage::engine::ComputeEngine;
        let (engine, recalc) = ComputeEngine::from_xlsx_bytes(&data)?;

        #[cfg(feature = "native")]
        let dispatch = Dispatch::spawn(engine)?;

        #[cfg(not(feature = "native"))]
        let dispatch = Dispatch::new(engine);

        Ok((Workbook { dispatch }, recalc))
    }

    /// Evaluate formulas using the current workbook's calculation settings.
    ///
    /// An imported XLSX has pending calculation even when it contains cached
    /// results. Volatile formulas use the current execution environment; their
    /// results are not expected to equal a previously saved workbook's caches.
    pub fn recalculate(&self) -> Result<RecalcResult, ComputeApiError> {
        Ok(self.dispatch.call_engine(|e| {
            e.recalculate_with_options(&snapshot_types::RecalcOptions::default())
        })??)
    }

    /// Export the workbook as xlsx bytes without initiating recalculation.
    pub fn to_xlsx_bytes(&self) -> Result<Vec<u8>, ComputeApiError> {
        Ok(self.dispatch.call_engine(|e| e.export_to_xlsx_bytes())??)
    }

    /// Export the workbook to an xlsx file on disk.
    pub fn to_xlsx_path(&self, path: &str) -> Result<(), ComputeApiError> {
        let bytes = self.to_xlsx_bytes()?;
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                ComputeApiError::InvalidOperation(format!("create {parent:?}: {e}"))
            })?;
        }
        std::fs::write(path, bytes)
            .map_err(|e| ComputeApiError::InvalidOperation(format!("write {path}: {e}")))
    }

    // -----------------------------------------------------------------
    // Sheet access
    // -----------------------------------------------------------------

    /// Get a [`Sheet`] handle by its [`SheetId`].
    pub fn sheet(&self, id: &SheetId) -> Result<Sheet, ComputeApiError> {
        let sid = *id;
        let name = self
            .dispatch
            .query_engine(move |e| e.get_sheet_name(&sid))?;
        if name.is_none() {
            return Err(ComputeApiError::SheetNotFound {
                id: id.to_uuid_string(),
            });
        }
        Ok(Sheet::new(self.dispatch.clone(), *id))
    }

    /// Get a [`Sheet`] handle by name (case-sensitive match).
    pub fn sheet_by_name(&self, name: &str) -> Result<Sheet, ComputeApiError> {
        let ids = self.dispatch.query_engine(|e| e.get_sheet_order())?;
        for hex_id in &ids {
            let sheet_id = SheetId::from_uuid_str(hex_id).map_err(|_| {
                ComputeApiError::InvalidOperation(format!("invalid sheet id from engine: {hex_id}"))
            })?;
            let sid = sheet_id;
            if let Some(sheet_name) = self
                .dispatch
                .query_engine(move |e| e.get_sheet_name(&sid))?
                && sheet_name == name
            {
                return Ok(Sheet::new(self.dispatch.clone(), sheet_id));
            }
        }
        Err(ComputeApiError::SheetNotFound {
            id: name.to_string(),
        })
    }

    /// Get a [`Sheet`] handle by its zero-based index in the workbook tab order.
    pub fn sheet_by_index(&self, index: usize) -> Result<Sheet, ComputeApiError> {
        let ids = self.dispatch.query_engine(|e| e.get_sheet_order())?;
        let hex_id = ids
            .get(index)
            .ok_or_else(|| ComputeApiError::SheetNotFound {
                id: format!("index {index}"),
            })?;
        let sheet_id = SheetId::from_uuid_str(hex_id).map_err(|_| {
            ComputeApiError::InvalidOperation(format!("invalid sheet id from engine: {hex_id}"))
        })?;
        Ok(Sheet::new(self.dispatch.clone(), sheet_id))
    }

    // -----------------------------------------------------------------
    // Sheet enumeration
    // -----------------------------------------------------------------

    /// Return the names of all sheets in workbook tab order.
    pub fn sheet_names(&self) -> Result<Vec<String>, ComputeApiError> {
        let ids = self.dispatch.query_engine(|e| e.get_sheet_order())?;
        let mut names = Vec::with_capacity(ids.len());
        for hex_id in &ids {
            let sheet_id = SheetId::from_uuid_str(hex_id).map_err(|_| {
                ComputeApiError::InvalidOperation(format!("invalid sheet id from engine: {hex_id}"))
            })?;
            let sid = sheet_id;
            if let Some(name) = self
                .dispatch
                .query_engine(move |e| e.get_sheet_name(&sid))?
            {
                names.push(name);
            }
        }
        Ok(names)
    }

    /// Return the number of sheets in the workbook.
    pub fn sheet_count(&self) -> Result<usize, ComputeApiError> {
        self.dispatch.query_engine(|e| e.get_sheet_order().len())
    }

    // -----------------------------------------------------------------
    // Cross-sheet aggregation
    // -----------------------------------------------------------------

    /// Get all tables across all sheets in the workbook.
    pub fn get_all_tables(
        &self,
    ) -> Result<Vec<compute_core::storage::engine::search::WorkbookTable>, ComputeApiError> {
        self.dispatch.query_engine(|e| e.get_all_tables_workbook())
    }

    /// Get all comments across all sheets in the workbook.
    pub fn get_all_comments(
        &self,
    ) -> Result<Vec<compute_core::storage::engine::search::WorkbookComment>, ComputeApiError> {
        self.dispatch
            .query_engine(|e| e.get_all_comments_workbook())
    }

    /// Get all pivot tables across all sheets in the workbook.
    pub fn get_all_pivot_tables(
        &self,
    ) -> Result<Vec<compute_core::storage::engine::search::WorkbookPivotTable>, ComputeApiError>
    {
        self.dispatch
            .query_engine(|e| e.get_all_pivot_tables_workbook())
    }

    // -----------------------------------------------------------------
    // Domain sub-APIs
    // -----------------------------------------------------------------

    /// Sheet CRUD operations (add, remove, rename, reorder, copy, hide/show).
    pub fn sheets(&self) -> sheets::WorkbookSheets {
        sheets::WorkbookSheets::new(self.dispatch.clone())
    }

    /// Undo/redo operations.
    pub fn history(&self) -> history::WorkbookHistory {
        history::WorkbookHistory::new(self.dispatch.clone())
    }

    /// Named ranges CRUD.
    pub fn names(&self) -> names::WorkbookNames {
        names::WorkbookNames::new(self.dispatch.clone())
    }

    /// Workbook-level protection.
    pub fn protection(&self) -> protection::WorkbookProtection {
        protection::WorkbookProtection::new(self.dispatch.clone())
    }

    /// What-if scenario analysis.
    pub fn scenarios(&self) -> scenarios::WorkbookScenarios {
        scenarios::WorkbookScenarios::new(self.dispatch.clone())
    }

    /// Custom table styles.
    pub fn styles(&self) -> styles::WorkbookStyles {
        styles::WorkbookStyles::new(self.dispatch.clone())
    }

    /// Workbook settings (calculation mode, culture, etc.).
    pub fn settings(&self) -> settings::WorkbookSettings {
        settings::WorkbookSettings::new(self.dispatch.clone())
    }
}
