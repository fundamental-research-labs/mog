//! Initialize native metadata from the cell snapshot transport.

use crate::snapshot::WorkbookSnapshot;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use value_types::ComputeError;

impl WorkbookStorage {
    pub fn populate_snapshot_metadata(
        &mut self,
        snapshot: WorkbookSnapshot,
    ) -> Result<(), ComputeError> {
        let sheet_ids = snapshot
            .sheets
            .iter()
            .map(|sheet| SheetId::from_uuid_str(&sheet.id))
            .collect::<Result<Vec<_>, _>>()?;
        let mut cell_metadata = crate::storage::CellMetadataMap::default();
        for sheet in &snapshot.sheets {
            for cell in &sheet.cells {
                if let Some(array_ref) = &cell.array_ref {
                    let id = cell_types::CellId::from_uuid_str(&cell.cell_id)?;
                    cell_metadata.entry(id).or_default().array_ref = Some(array_ref.clone());
                }
            }
        }
        self.cell_metadata = cell_metadata;
        self.sheet_metadata = snapshot
            .sheets
            .iter()
            .zip(&sheet_ids)
            .map(|(sheet, id)| {
                (
                    *id,
                    crate::storage::sheet::SheetMetadata {
                        name: sheet.name.clone(),
                        ..Default::default()
                    },
                )
            })
            .collect();
        self.metadata.sheet_order = sheet_ids;
        self.metadata.settings.calculation_settings =
            Some(snapshot.calculation_settings.unwrap_or_else(|| {
                crate::snapshot::CalculationSettings {
                    enable_iterative_calculation: snapshot.iterative_calc,
                    max_iterations: snapshot.max_iterations,
                    max_change: snapshot.max_change,
                    ..Default::default()
                }
            }));
        Ok(())
    }
}
