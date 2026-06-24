//! Workbook-level metadata: named ranges, tables, and dense cache access.

use cell_types::SheetId;
use domain_types::domain::table::TableCatalogEntry as CanonicalTable;
use formula_types::{NamedRangeDef, Scope, TableDef};
use snapshot_types::{DataTableRegionDef, PivotTableDef};

use super::cell_mirror::CellMirror;
use super::dense::DenseColumnCache;

impl CellMirror {
    // -----------------------------------------------------------------------
    // Named Ranges / Variables
    // -----------------------------------------------------------------------

    /// Set (or replace) a named range definition.
    ///
    /// For backward compatibility, this inserts into the variable store using
    /// the scope from the definition itself.
    pub fn set_named_range(&mut self, name: String, def: NamedRangeDef) {
        let scope = def.scope.clone();
        self.variables.insert(scope, name, def);
    }

    /// Remove a named range by name and scope (case-insensitive).
    pub fn remove_named_range_scoped(&mut self, scope: &Scope, name: &str) {
        self.variables.remove(scope, name);
    }

    /// Remove a named range by name (case-insensitive), searching all scopes.
    ///
    /// For backward compatibility with callers that don't know the scope.
    /// Removes the first match found (workbook scope checked first).
    pub fn remove_named_range(&mut self, name: &str) {
        let key = name.to_ascii_lowercase();
        // Collect matching scopes first to avoid borrow conflict
        let scopes: Vec<Scope> = self
            .variables
            .all_variables()
            .filter(|(_, var_name, _)| var_name.as_str() == key)
            .map(|(scope, _, _)| scope.clone())
            .collect();
        for scope in scopes {
            self.variables.remove(&scope, name);
        }
    }

    /// Get a named range definition (case-insensitive).
    ///
    /// For backward compatibility, searches workbook scope first, then all scopes.
    pub fn get_named_range(&self, name: &str) -> Option<&NamedRangeDef> {
        // Search workbook scope as default for backward compat
        let chain = [Scope::Workbook];
        if let Some(def) = self.variables.resolve(name, &chain) {
            return Some(def);
        }
        // Fall back to searching all scopes
        let key = name.to_ascii_lowercase();
        for (_scope, var_name, def) in self.variables.all_variables() {
            if *var_name == key {
                return Some(def);
            }
        }
        None
    }

    /// Resolve a variable by walking the scope chain (inner -> outer).
    pub fn resolve_variable(&self, name: &str, chain: &[Scope]) -> Option<&NamedRangeDef> {
        self.variables.resolve(name, chain)
    }

    pub fn all_named_ranges_for_diagnostics(
        &self,
    ) -> impl Iterator<Item = (&Scope, &String, &NamedRangeDef)> {
        self.variables.all_variables()
    }

    // ── Tables ─────────────────────────────────────────────────────────

    /// Set (or replace) a canonical table (stable-ID first, name as lookup).
    /// Also updates the formula engine's TableDef cache.
    pub fn set_table(&mut self, table: CanonicalTable) {
        let table_def = crate::storage::table_format::table_to_table_def(&table);

        // Update canonical table
        if let Some(existing) = self
            .tables
            .iter_mut()
            .find(|t| t.id == table.id || t.name.eq_ignore_ascii_case(&table.name))
        {
            *existing = table;
        } else {
            self.tables.push(table);
        }

        // Update formula engine cache
        if let Some(existing) = self
            .table_defs
            .iter_mut()
            .find(|t| t.name.eq_ignore_ascii_case(&table_def.name))
        {
            *existing = table_def;
        } else {
            self.table_defs.push(table_def);
        }
    }

    /// Remove a table by name (case-insensitive). Removes both canonical and TableDef.
    pub fn remove_table(&mut self, name: &str) {
        self.tables.retain(|t| !t.name.eq_ignore_ascii_case(name));
        self.table_defs
            .retain(|t| !t.name.eq_ignore_ascii_case(name));
    }

    /// Get a canonical table by name (case-insensitive).
    pub fn get_table(&self, name: &str) -> Option<&CanonicalTable> {
        self.tables
            .iter()
            .find(|t| t.name.eq_ignore_ascii_case(name))
    }

    /// Get a canonical table by stable ID.
    pub fn get_table_by_id(&self, table_id: &str) -> Option<&CanonicalTable> {
        self.tables.iter().find(|t| t.id == table_id)
    }

    /// Get all canonical tables.
    pub fn all_tables(&self) -> &[CanonicalTable] {
        &self.tables
    }

    /// Get a table def for the formula engine by name (case-insensitive).
    pub fn get_table_def(&self, name: &str) -> Option<&TableDef> {
        self.table_defs
            .iter()
            .find(|t| t.name.eq_ignore_ascii_case(name))
    }

    /// Get all table defs for the formula engine.
    pub fn all_table_defs(&self) -> &[TableDef] {
        &self.table_defs
    }

    // -----------------------------------------------------------------------
    // Pivot Tables
    // -----------------------------------------------------------------------

    /// Find a pivot table that contains the given cell position.
    ///
    /// Used by GETPIVOTDATA to locate which pivot table a cell reference points into.
    pub fn find_pivot_table_at(
        &self,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<&PivotTableDef> {
        let sheet_uuid = sheet.to_uuid_string();
        self.pivot_tables.iter().find(|pt| {
            pt.sheet == sheet_uuid
                && !pt.is_empty_rendered_region()
                && row >= pt.start_row
                && row <= pt.end_row
                && col >= pt.start_col
                && col <= pt.end_col
        })
    }

    /// Get all pivot table definitions.
    pub fn all_pivot_tables(&self) -> &[PivotTableDef] {
        &self.pivot_tables
    }

    /// Register or update a pivot table definition (for GETPIVOTDATA).
    ///
    /// If a def with the same stable pivot identity already exists, it is replaced.
    /// Otherwise, the new def is appended.
    pub fn upsert_pivot_table_def(&mut self, def: PivotTableDef) {
        if let Some(existing) = self
            .pivot_tables
            .iter_mut()
            .find(|pt| pt.same_identity(&def))
        {
            *existing = def;
        } else {
            self.pivot_tables.push(def);
        }
    }

    pub fn find_pivot_table_def(
        &self,
        pivot_id: &str,
        fallback_name: &str,
        sheet_uuid: &str,
    ) -> Option<&PivotTableDef> {
        self.pivot_tables
            .iter()
            .find(|pt| pt.matches_identity(pivot_id, fallback_name, sheet_uuid))
    }

    /// Remove a pivot table definition by name and sheet.
    ///
    /// Returns `true` if a def was found and removed.
    pub fn remove_pivot_table_def(&mut self, name: &str, sheet_uuid: &str) -> bool {
        let before = self.pivot_tables.len();
        self.pivot_tables
            .retain(|pt| !(pt.name == name && pt.sheet == sheet_uuid));
        self.pivot_tables.len() < before
    }

    /// Remove all pivot table definitions for a given sheet.
    pub fn remove_pivot_table_defs_for_sheet(&mut self, sheet_uuid: &str) {
        self.pivot_tables.retain(|pt| pt.sheet != sheet_uuid);
    }

    // -----------------------------------------------------------------------
    // Data Table Regions
    // -----------------------------------------------------------------------

    /// Find the data table region that contains the given cell position.
    ///
    /// Used by TABLE formula evaluation to locate which data table region
    /// a cell reference points into.
    pub fn find_data_table_at(
        &self,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<&DataTableRegionDef> {
        let sheet_uuid = sheet.to_uuid_string();
        self.data_table_regions.iter().find(|dt| {
            dt.sheet == sheet_uuid
                && row >= dt.start_row
                && row <= dt.end_row
                && col >= dt.start_col
                && col <= dt.end_col
        })
    }

    /// Get all data table region definitions.
    pub fn all_data_table_regions(&self) -> &[DataTableRegionDef] {
        &self.data_table_regions
    }

    /// Insert or replace a data table region definition.
    pub fn upsert_data_table_region(&mut self, def: DataTableRegionDef) {
        if let Some(existing) = self.data_table_regions.iter_mut().find(|region| {
            region.sheet == def.sheet
                && region.start_row == def.start_row
                && region.start_col == def.start_col
                && region.end_row == def.end_row
                && region.end_col == def.end_col
        }) {
            *existing = def;
        } else {
            self.data_table_regions.push(def);
        }
    }

    // -----------------------------------------------------------------------
    // Dense Column Cache
    // -----------------------------------------------------------------------

    /// Get a shared reference to the dense column cache.
    pub fn dense_cache(&self) -> &DenseColumnCache {
        &self.dense_cache
    }

    /// Get a mutable reference to the dense column cache.
    pub fn dense_cache_mut(&mut self) -> &mut DenseColumnCache {
        &mut self.dense_cache
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::types::SheetMirror;
    use snapshot_types::PivotTableDef;

    fn pivot_def(name: &str, sheet: &SheetId, start_row: u32, start_col: u32) -> PivotTableDef {
        PivotTableDef {
            id: name.to_string(),
            name: name.to_string(),
            sheet: sheet.to_uuid_string(),
            start_row,
            start_col,
            end_row: start_row + 2,
            end_col: start_col + 2,
            rendered_rows: Some(3),
            rendered_cols: Some(3),
            first_data_row: 1,
            first_data_col: 1,
            data_field_names: vec!["Sum of Sales".to_string()],
            cache_field_names: vec!["Region".to_string(), "Sales".to_string()],
            row_field_indices: vec![0],
            col_field_indices: vec![],
            data_on_rows: false,
            style: None,
            show_row_grand_totals: None,
            show_column_grand_totals: None,
        }
    }

    #[test]
    fn find_pivot_table_at_uses_imported_uuid_sheet_identity() {
        let sheet_id = SheetId::from_raw(11);
        let mut mirror = CellMirror::new();
        mirror.add_sheet_mirror(
            sheet_id,
            "Imported".to_string(),
            SheetMirror::new(sheet_id, "Imported".to_string(), 20, 20),
        );
        mirror.upsert_pivot_table_def(pivot_def("ImportedPivot", &sheet_id, 4, 3));

        let found = mirror
            .find_pivot_table_at(&sheet_id, 5, 4)
            .expect("imported UUID-backed pivot should be found");

        assert_eq!(found.name, "ImportedPivot");
        assert_eq!(found.sheet, sheet_id.to_uuid_string());
    }

    #[test]
    fn find_pivot_table_at_distinguishes_same_name_by_output_sheet_uuid() {
        let sheet_a = SheetId::from_raw(21);
        let sheet_b = SheetId::from_raw(22);
        let mut mirror = CellMirror::new();
        mirror.add_sheet_mirror(
            sheet_a,
            "RuntimeA".to_string(),
            SheetMirror::new(sheet_a, "RuntimeA".to_string(), 20, 20),
        );
        mirror.add_sheet_mirror(
            sheet_b,
            "RuntimeB".to_string(),
            SheetMirror::new(sheet_b, "RuntimeB".to_string(), 20, 20),
        );
        mirror.upsert_pivot_table_def(pivot_def("Pivot1", &sheet_a, 0, 0));
        mirror.upsert_pivot_table_def(pivot_def("Pivot1", &sheet_b, 8, 8));
        let sheet_a_uuid = sheet_a.to_uuid_string();
        let sheet_b_uuid = sheet_b.to_uuid_string();

        assert_eq!(
            mirror
                .find_pivot_table_at(&sheet_a, 1, 1)
                .map(|pt| pt.sheet.as_str()),
            Some(sheet_a_uuid.as_str())
        );
        assert_eq!(
            mirror
                .find_pivot_table_at(&sheet_b, 9, 9)
                .map(|pt| pt.sheet.as_str()),
            Some(sheet_b_uuid.as_str())
        );
        assert!(mirror.find_pivot_table_at(&sheet_a, 9, 9).is_none());
    }

    #[test]
    fn pivot_defs_with_same_display_name_on_same_sheet_keep_stable_identities() {
        let sheet_id = SheetId::from_raw(23);
        let mut mirror = CellMirror::new();
        mirror.add_sheet_mirror(
            sheet_id,
            "Runtime".to_string(),
            SheetMirror::new(sheet_id, "Runtime".to_string(), 20, 20),
        );

        let mut first = pivot_def("Revenue", &sheet_id, 0, 0);
        first.id = "pivot-a".to_string();
        let mut second = pivot_def("Revenue", &sheet_id, 8, 8);
        second.id = "pivot-b".to_string();

        mirror.upsert_pivot_table_def(first);
        mirror.upsert_pivot_table_def(second);

        let sheet_uuid = sheet_id.to_uuid_string();
        assert_eq!(mirror.all_pivot_tables().len(), 2);
        assert_eq!(
            mirror
                .find_pivot_table_def("pivot-a", "Revenue", &sheet_uuid)
                .map(|pt| pt.start_row),
            Some(0)
        );
        assert_eq!(
            mirror
                .find_pivot_table_def("pivot-b", "Revenue", &sheet_uuid)
                .map(|pt| pt.start_row),
            Some(8)
        );
    }
}
