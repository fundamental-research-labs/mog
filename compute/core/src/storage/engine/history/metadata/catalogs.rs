//! Entry-sized inverses for authoritative catalogs held by the native mirror.

use domain_types::domain::table::TableCatalogEntry;
use snapshot_types::{DataTableRegionDef, PivotTableDef};

use super::*;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum CatalogKey {
    Table(String),
    Pivot {
        sheet: String,
        id: String,
    },
    LegacyPivot {
        sheet: String,
        name: String,
    },
    DataTable {
        sheet: String,
        bounds: (u32, u32, u32, u32),
    },
}

impl CatalogKey {
    pub(crate) fn pivot(def: &PivotTableDef) -> Self {
        if def.id.is_empty() {
            Self::LegacyPivot {
                sheet: def.sheet.clone(),
                name: def.name.clone(),
            }
        } else {
            Self::Pivot {
                sheet: def.sheet.clone(),
                id: def.id.clone(),
            }
        }
    }

    pub(crate) fn data_table(def: &DataTableRegionDef) -> Self {
        Self::DataTable {
            sheet: def.sheet.clone(),
            bounds: (def.start_row, def.start_col, def.end_row, def.end_col),
        }
    }

    pub(crate) fn matches_pivot(&self, def: &PivotTableDef) -> bool {
        match self {
            Self::Pivot { sheet, id } => def.sheet == *sheet && def.id == *id,
            Self::LegacyPivot { sheet, name } => {
                def.id.is_empty() && def.sheet == *sheet && def.name == *name
            }
            _ => false,
        }
    }

    pub(crate) fn matches_data_table(&self, def: &DataTableRegionDef) -> bool {
        matches!(self, Self::DataTable { sheet, bounds }
            if def.sheet == *sheet && (def.start_row, def.start_col, def.end_row, def.end_col) == *bounds)
    }
}

type CatalogRead<T> = for<'a> fn(&'a CellMirror) -> &'a [T];
type CatalogSwap<T> =
    fn(&mut CellMirror, &CatalogKey, &mut Option<(VectorPosition<CatalogKey>, T)>);
type CatalogEmit<T> = fn(&T, crate::snapshot::ChangeKind, &mut HistoryEffects);

#[derive(Debug)]
struct CatalogPatch<T> {
    key: CatalogKey,
    old: Option<(VectorPosition<CatalogKey>, T)>,
    read: CatalogRead<T>,
    identity: fn(&T) -> CatalogKey,
    swap_value: CatalogSwap<T>,
    emit: CatalogEmit<T>,
}

impl<T: Debug + PartialEq + Send + Sync + 'static> MetadataSwap for CatalogPatch<T> {
    fn is_changed(&self, _: &WorkbookStorage, mirror: &CellMirror) -> bool {
        (self.read)(mirror)
            .iter()
            .find(|value| (self.identity)(value) == self.key)
            != self.old.as_ref().map(|(_, value)| value)
    }

    fn swap(
        &mut self,
        _: &mut WorkbookStorage,
        mirror: &mut CellMirror,
        effects: &mut HistoryEffects,
    ) {
        (self.swap_value)(mirror, &self.key, &mut self.old);
        if let Some(value) = (self.read)(mirror)
            .iter()
            .find(|value| (self.identity)(value) == self.key)
        {
            (self.emit)(value, crate::snapshot::ChangeKind::Set, effects);
        } else if let Some((_, value)) = &self.old {
            (self.emit)(value, crate::snapshot::ChangeKind::Removed, effects);
        }
        effects.recalc = true;
    }
}

fn capture_catalog<T: Debug + Clone + PartialEq + Send + Sync + 'static>(
    mirror: &CellMirror,
    key: CatalogKey,
    read: CatalogRead<T>,
    identity: fn(&T) -> CatalogKey,
    swap_value: CatalogSwap<T>,
    emit: CatalogEmit<T>,
) {
    if !mirror.history.is_active() {
        return;
    }
    mirror.history.record_once(
        HistoryKey::Metadata(MetadataKey::Catalog(key.clone())),
        || {
            HistoryPatch::Metadata(MetadataPatch(Box::new(CatalogPatch {
                old: read(mirror)
                    .iter()
                    .enumerate()
                    .find(|(_, value)| identity(value) == key)
                    .map(|(index, value)| {
                        (
                            VectorPosition::capture(read(mirror), index, identity),
                            value.clone(),
                        )
                    }),
                key,
                read,
                identity,
                swap_value,
                emit,
            })))
        },
    );
}

pub(crate) fn capture_table(mirror: &CellMirror, id: &str) {
    if !mirror.history.is_active() {
        return;
    }
    capture_catalog(
        mirror,
        CatalogKey::Table(id.to_owned()),
        CellMirror::all_tables,
        |table| CatalogKey::Table(table.id.clone()),
        |mirror, key, old| {
            let CatalogKey::Table(id) = key else {
                unreachable!()
            };
            mirror.history_swap_table(id, old);
        },
        |table: &TableCatalogEntry, kind, effects| {
            effects.tables = true;
            if let Ok(sheet) = SheetId::from_uuid_str(&table.sheet_id) {
                effects.sheets.insert(sheet);
            }
            effects
                .result
                .table_changes
                .retain(|change| change.table_id.as_deref() != Some(&table.id));
            effects
                .result
                .table_changes
                .push(crate::snapshot::TableChange {
                    table_id: Some(table.id.clone()),
                    name: table.name.clone(),
                    sheet_id: table.sheet_id.clone(),
                    kind,
                });
        },
    );
}

pub(crate) fn capture_pivot_def(mirror: &CellMirror, def: &PivotTableDef) {
    if !mirror.history.is_active() {
        return;
    }
    capture_catalog(
        mirror,
        CatalogKey::pivot(def),
        CellMirror::all_pivot_tables,
        CatalogKey::pivot,
        CellMirror::history_swap_pivot_def,
        |def: &PivotTableDef, kind, effects| {
            if let Ok(sheet) = SheetId::from_uuid_str(&def.sheet) {
                effects.sheets.insert(sheet);
            }
            let pivot_id = if def.id.is_empty() {
                &def.name
            } else {
                &def.id
            };
            effects
                .result
                .pivot_changes
                .retain(|change| change.sheet_id != def.sheet || change.pivot_id != *pivot_id);
            effects
                .result
                .pivot_changes
                .push(crate::snapshot::PivotTableChange {
                    sheet_id: def.sheet.clone(),
                    pivot_id: pivot_id.clone(),
                    kind,
                });
        },
    );
}

pub(crate) fn capture_data_table(mirror: &CellMirror, def: &DataTableRegionDef) {
    if !mirror.history.is_active() {
        return;
    }
    capture_catalog(
        mirror,
        CatalogKey::data_table(def),
        CellMirror::all_data_table_regions,
        CatalogKey::data_table,
        CellMirror::history_swap_data_table,
        |def: &DataTableRegionDef, _, effects| {
            if let Ok(sheet) = SheetId::from_uuid_str(&def.sheet) {
                effects.sheets.insert(sheet);
            }
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_history_restores_order_after_prior_touches_and_bulk_removal() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        mirror.bind_history_capture(storage.history.share());
        let sheet = SheetId::from_raw(123).to_uuid_string();
        for (row, name) in ["First", "Second", "Third"].into_iter().enumerate() {
            mirror.upsert_pivot_table_def(PivotTableDef {
                id: name.into(),
                name: name.into(),
                sheet: sheet.clone(),
                start_row: row as u32 * 5,
                start_col: 0,
                end_row: row as u32 * 5 + 2,
                end_col: 2,
                rendered_rows: Some(3),
                rendered_cols: Some(3),
                first_data_row: 1,
                first_data_col: 1,
                data_field_names: vec!["Sales".into()],
                cache_field_names: vec!["Region".into(), "Sales".into()],
                row_field_indices: vec![0],
                col_field_indices: vec![],
                data_on_rows: false,
                style: None,
                show_row_grand_totals: None,
                show_column_grand_totals: None,
            });
        }
        let original = mirror.all_pivot_tables().to_vec();
        storage.history.begin();
        for mut def in original.clone() {
            def.show_row_grand_totals = Some(false);
            mirror.upsert_pivot_table_def(def);
        }
        mirror.remove_pivot_table_defs_for_sheet(&sheet);
        let mut patches: Vec<_> = storage
            .history
            .finish()
            .into_iter()
            .map(|patch| {
                let HistoryPatch::Metadata(patch) = patch else {
                    panic!("only catalog entries changed")
                };
                patch
            })
            .collect();
        assert_eq!(patches.len(), 3);
        assert!(mirror.all_pivot_tables().is_empty());
        for _ in 0..3 {
            for patch in patches.iter_mut().rev() {
                patch.swap(&mut storage, &mut mirror, &mut HistoryEffects::default());
            }
            assert_eq!(mirror.all_pivot_tables(), original);
            for patch in &mut patches {
                patch.swap(&mut storage, &mut mirror, &mut HistoryEffects::default());
            }
            assert!(mirror.all_pivot_tables().is_empty());
        }
    }
}
