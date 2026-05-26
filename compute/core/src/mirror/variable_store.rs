//! Scope-aware variable store for named range/variable resolution.

use cell_types::{CellId, RangeId};
use formula_types::{NamedRangeDef, Scope};
use rustc_hash::{FxHashMap, FxHashSet};

/// Scope-aware variable store. Variables are organized by scope and resolved
/// via a scope chain (inner -> outer).
///
/// Each variable is assigned a deterministic synthetic `CellId` derived from
/// `(scope, lowercase_name)`. These CellIds allow variables to participate in
/// the dependency graph as first-class DAG nodes alongside regular cells.
#[derive(Debug, Clone)]
pub struct VariableStore {
    /// Scope -> (lowercase_name -> NamedRangeDef)
    scopes: FxHashMap<Scope, FxHashMap<String, NamedRangeDef>>,
    /// Variable name+scope -> synthetic CellId
    id_map: FxHashMap<(Scope, String), CellId>,
    /// Synthetic CellId -> (scope, name)
    reverse_id_map: FxHashMap<CellId, (Scope, String)>,
    /// Fast set for "is this CellId a variable?" hot-path check
    variable_ids: FxHashSet<CellId>,
}

impl Default for VariableStore {
    fn default() -> Self {
        Self::new()
    }
}

impl VariableStore {
    /// Create a new empty variable store.
    pub fn new() -> Self {
        Self {
            scopes: FxHashMap::default(),
            id_map: FxHashMap::default(),
            reverse_id_map: FxHashMap::default(),
            variable_ids: FxHashSet::default(),
        }
    }

    /// Generate a deterministic synthetic CellId for a variable.
    /// Uses FxHash of (scope, lowercase_name) to ensure the same variable
    /// always maps to the same CellId across snapshot roundtrips.
    ///
    /// The hash is widened to u128 by placing the 64-bit FxHash in the upper
    /// bits and setting a high sentinel bit pattern in the lower bits to avoid
    /// collisions with real UUID-based CellIds.
    pub fn synthetic_cell_id(scope: &Scope, name: &str) -> CellId {
        use std::hash::{Hash, Hasher};
        let mut hasher = rustc_hash::FxHasher::default();
        scope.hash(&mut hasher);
        name.to_ascii_lowercase().hash(&mut hasher);
        let h = hasher.finish();
        // Place hash in upper 64 bits. Lower 64 bits use a sentinel pattern
        // (0xFFFF_FFFF_FFFF_FF00 | variant nibble) to make collisions with
        // real UUIDs statistically impossible (UUID v4 has variant bits 10xx
        // in byte 8, our sentinel uses 0xFF there).
        let raw: u128 = ((h as u128) << 64) | 0xFFFF_FFFF_FFFF_FF00;
        CellId::from_raw(raw)
    }

    /// Resolve a variable name by walking the scope chain (inner -> outer).
    /// Returns the first match found.
    pub fn resolve(&self, name: &str, chain: &[Scope]) -> Option<&NamedRangeDef> {
        let key = name.to_ascii_lowercase();
        for scope in chain {
            if let Some(vars) = self.scopes.get(scope)
                && let Some(def) = vars.get(&key)
            {
                return Some(def);
            }
        }
        None
    }

    /// Resolve a variable name and return its synthetic CellId along with the def.
    /// Walks the scope chain just like `resolve()`.
    pub fn resolve_with_id(&self, name: &str, chain: &[Scope]) -> Option<(CellId, &NamedRangeDef)> {
        let key = name.to_ascii_lowercase();
        for scope in chain {
            if let Some(vars) = self.scopes.get(scope)
                && let Some(def) = vars.get(&key)
            {
                let cell_id = self
                    .id_map
                    .get(&(scope.clone(), key.clone()))
                    .copied()
                    .unwrap_or_else(|| Self::synthetic_cell_id(scope, &key));
                return Some((cell_id, def));
            }
        }
        None
    }

    /// Insert a variable into a specific scope.
    pub fn insert(&mut self, scope: Scope, name: String, def: NamedRangeDef) {
        let key = name.to_ascii_lowercase();
        let cell_id = Self::synthetic_cell_id(&scope, &key);
        self.id_map.insert((scope.clone(), key.clone()), cell_id);
        self.reverse_id_map
            .insert(cell_id, (scope.clone(), key.clone()));
        self.variable_ids.insert(cell_id);
        self.scopes.entry(scope).or_default().insert(key, def);
    }

    /// Remove a variable from a specific scope.
    pub fn remove(&mut self, scope: &Scope, name: &str) {
        let key = name.to_ascii_lowercase();
        if let Some(vars) = self.scopes.get_mut(scope) {
            vars.remove(&key);
        }
        let map_key = (scope.clone(), key);
        if let Some(cell_id) = self.id_map.remove(&map_key) {
            self.reverse_id_map.remove(&cell_id);
            self.variable_ids.remove(&cell_id);
        }
    }

    /// Check if a CellId belongs to a variable (hot-path, O(1)).
    #[inline]
    pub fn is_variable(&self, cell_id: &CellId) -> bool {
        self.variable_ids.contains(cell_id)
    }

    /// Get the synthetic CellId for a variable by scope and name.
    pub fn get_variable_cell_id(&self, scope: &Scope, name: &str) -> Option<CellId> {
        self.id_map
            .get(&(scope.clone(), name.to_ascii_lowercase()))
            .copied()
    }

    /// Look up a variable by its synthetic CellId. Returns (scope, name, def).
    pub fn get_variable_by_cell_id(
        &self,
        cell_id: &CellId,
    ) -> Option<(&Scope, &str, &NamedRangeDef)> {
        if let Some((scope, name)) = self.reverse_id_map.get(cell_id)
            && let Some(vars) = self.scopes.get(scope)
            && let Some(def) = vars.get(name)
        {
            return Some((scope, name.as_str(), def));
        }
        None
    }

    /// Iterate over all variables across all scopes.
    pub fn all_variables(&self) -> impl Iterator<Item = (&Scope, &String, &NamedRangeDef)> {
        self.scopes
            .iter()
            .flat_map(|(scope, vars)| vars.iter().map(move |(name, def)| (scope, name, def)))
    }

    /// Iterate over all variable synthetic CellIds.
    pub fn all_variable_ids(&self) -> impl Iterator<Item = &CellId> {
        self.variable_ids.iter()
    }

    /// Get the total number of variables across all scopes.
    pub fn len(&self) -> usize {
        self.scopes.values().map(|v| v.len()).sum()
    }

    /// Check if the store is empty.
    pub fn is_empty(&self) -> bool {
        self.scopes.values().all(|v| v.is_empty())
    }

    /// Clear `linked_range_id` on every `NamedRangeDef` that references the
    /// given `RangeId`. Called when a Data Range is deleted so that stale
    /// linkages are removed.
    pub fn clear_linked_range_id(&mut self, range_id: &RangeId) {
        for vars in self.scopes.values_mut() {
            for def in vars.values_mut() {
                if def.linked_range_id.as_ref() == Some(range_id) {
                    def.linked_range_id = None;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::{CellId, SheetId};
    use value_types::CellError;

    fn make_def(name: &str, scope: Scope) -> NamedRangeDef {
        NamedRangeDef::from_positions(
            name.to_string(),
            scope,
            CellId::from_raw(1),
            CellId::from_raw(2),
            0,
            0,
            9,
            2,
        )
    }

    #[test]
    fn test_basic_insert_resolve() {
        let mut store = VariableStore::new();
        let def = make_def("Revenue", Scope::Workbook);
        store.insert(Scope::Workbook, "Revenue".to_string(), def);

        let chain = [Scope::Workbook];
        assert!(store.resolve("revenue", &chain).is_some());
        assert!(store.resolve("REVENUE", &chain).is_some());
        assert!(store.resolve("nonexistent", &chain).is_none());
    }

    #[test]
    fn test_scope_chain_resolution() {
        let mut store = VariableStore::new();
        let sheet1 = SheetId::from_raw(1);

        // Insert workbook-scoped var
        let wb_def = make_def("Tax", Scope::Workbook);
        store.insert(Scope::Workbook, "Tax".to_string(), wb_def);

        // Insert sheet-scoped var with same name
        let sh_def = NamedRangeDef::from_positions(
            "Tax".to_string(),
            Scope::Sheet(sheet1),
            CellId::from_raw(10),
            CellId::from_raw(11),
            0,
            0,
            5,
            5,
        );
        store.insert(Scope::Sheet(sheet1), "Tax".to_string(), sh_def);

        // Sheet scope wins when it's first in chain
        let chain = [Scope::Sheet(sheet1), Scope::Workbook];
        let resolved = store.resolve("tax", &chain).unwrap();
        assert_eq!(resolved.name, "Tax");
        match &resolved.scope {
            Scope::Sheet(s) => assert_eq!(*s, sheet1),
            _ => panic!("expected sheet scope"),
        }

        // Workbook-only chain finds the workbook one
        let wb_chain = [Scope::Workbook];
        let resolved = store.resolve("tax", &wb_chain).unwrap();
        match &resolved.scope {
            Scope::Workbook => {}
            _ => panic!("expected workbook scope"),
        }
    }

    #[test]
    fn test_remove() {
        let mut store = VariableStore::new();
        let def = make_def("Revenue", Scope::Workbook);
        store.insert(Scope::Workbook, "Revenue".to_string(), def);

        assert_eq!(store.len(), 1);
        assert!(store.is_variable(&VariableStore::synthetic_cell_id(
            &Scope::Workbook,
            "revenue"
        )));

        store.remove(&Scope::Workbook, "revenue");
        assert_eq!(store.len(), 0);
        assert!(store.resolve("revenue", &[Scope::Workbook]).is_none());
        assert!(!store.is_variable(&VariableStore::synthetic_cell_id(
            &Scope::Workbook,
            "revenue"
        )));
    }

    #[test]
    fn test_all_variables_iterator() {
        let mut store = VariableStore::new();
        let sheet1 = SheetId::from_raw(1);

        store.insert(
            Scope::Workbook,
            "A".to_string(),
            make_def("A", Scope::Workbook),
        );
        store.insert(
            Scope::Sheet(sheet1),
            "B".to_string(),
            make_def("B", Scope::Sheet(sheet1)),
        );

        let all: Vec<_> = store.all_variables().collect();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_len_is_empty() {
        let mut store = VariableStore::new();
        assert!(store.is_empty());
        assert_eq!(store.len(), 0);

        store.insert(
            Scope::Workbook,
            "X".to_string(),
            make_def("X", Scope::Workbook),
        );
        assert!(!store.is_empty());
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn test_synthetic_cell_id_deterministic() {
        let id1 = VariableStore::synthetic_cell_id(&Scope::Workbook, "tax_rate");
        let id2 = VariableStore::synthetic_cell_id(&Scope::Workbook, "tax_rate");
        assert_eq!(id1, id2);

        // Case insensitive
        let id3 = VariableStore::synthetic_cell_id(&Scope::Workbook, "TAX_RATE");
        assert_eq!(id1, id3);
    }

    #[test]
    fn test_synthetic_cell_id_scope_differs() {
        let sheet1 = SheetId::from_raw(1);
        let id_wb = VariableStore::synthetic_cell_id(&Scope::Workbook, "tax");
        let id_sh = VariableStore::synthetic_cell_id(&Scope::Sheet(sheet1), "tax");
        assert_ne!(id_wb, id_sh);
    }

    #[test]
    fn test_is_variable() {
        let mut store = VariableStore::new();
        let def = make_def("Revenue", Scope::Workbook);
        store.insert(Scope::Workbook, "Revenue".to_string(), def);

        let synth_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "revenue");
        assert!(store.is_variable(&synth_id));
        assert!(!store.is_variable(&CellId::from_raw(999)));
    }

    #[test]
    fn test_get_variable_cell_id() {
        let mut store = VariableStore::new();
        let def = make_def("Revenue", Scope::Workbook);
        store.insert(Scope::Workbook, "Revenue".to_string(), def);

        let id = store
            .get_variable_cell_id(&Scope::Workbook, "revenue")
            .unwrap();
        assert_eq!(
            id,
            VariableStore::synthetic_cell_id(&Scope::Workbook, "revenue")
        );
        assert!(
            store
                .get_variable_cell_id(&Scope::Workbook, "nonexistent")
                .is_none()
        );
    }

    #[test]
    fn test_get_variable_by_cell_id() {
        let mut store = VariableStore::new();
        let def = make_def("Revenue", Scope::Workbook);
        store.insert(Scope::Workbook, "Revenue".to_string(), def);

        let synth_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "revenue");
        let (scope, name, resolved_def) = store.get_variable_by_cell_id(&synth_id).unwrap();
        assert_eq!(*scope, Scope::Workbook);
        assert_eq!(name, "revenue");
        assert_eq!(resolved_def.name, "Revenue");
    }

    #[test]
    fn test_resolve_with_id() {
        let mut store = VariableStore::new();
        let def = make_def("Revenue", Scope::Workbook);
        store.insert(Scope::Workbook, "Revenue".to_string(), def);

        let chain = [Scope::Workbook];
        let (id, resolved_def) = store.resolve_with_id("Revenue", &chain).unwrap();
        assert_eq!(
            id,
            VariableStore::synthetic_cell_id(&Scope::Workbook, "revenue")
        );
        assert_eq!(resolved_def.name, "Revenue");
    }
}
