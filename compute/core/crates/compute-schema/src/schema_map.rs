//! Schema map — per-column schema storage for post-recalc validation.
//!
//! Maintains a mapping from (sheet_id, column_index) to ColumnSchema,
//! with versioning to prevent stale updates from overwriting newer data.

use std::collections::HashMap;

use cell_types::SheetId;

use super::types::ColumnSchema;

/// Key for schema map: identifies a column in a specific sheet.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SchemaKey {
    pub sheet_id: SheetId,
    pub column: u32,
}

/// Schema map with version tracking.
///
/// The version counter prevents race conditions where a stale schema update
/// from TypeScript arrives after a newer one. Each update from TS includes
/// a version number; Rust rejects updates with version <= current.
#[derive(Debug, Clone)]
pub struct SchemaMap {
    schemas: HashMap<SchemaKey, ColumnSchema>,
    version: u64,
}

impl SchemaMap {
    /// Create an empty schema map.
    pub fn new() -> Self {
        Self {
            schemas: HashMap::new(),
            version: 0,
        }
    }

    /// Current version.
    pub fn version(&self) -> u64 {
        self.version
    }

    /// Number of schemas stored.
    pub fn len(&self) -> usize {
        self.schemas.len()
    }

    /// Whether the map is empty.
    pub fn is_empty(&self) -> bool {
        self.schemas.is_empty()
    }

    /// Load a full schema map (replaces all existing schemas).
    /// Used during compute_init.
    pub fn load(&mut self, schemas: HashMap<SchemaKey, ColumnSchema>, version: u64) {
        self.schemas = schemas;
        self.version = version;
    }

    /// Update a single column schema. Returns false if version is stale.
    pub fn update(&mut self, key: SchemaKey, schema: ColumnSchema, version: u64) -> bool {
        if version <= self.version {
            return false; // Stale update
        }
        self.schemas.insert(key, schema);
        self.version = version;
        true
    }

    /// Remove a column schema. Returns false if version is stale.
    pub fn remove(&mut self, key: &SchemaKey, version: u64) -> bool {
        if version <= self.version {
            return false;
        }
        self.schemas.remove(key);
        self.version = version;
        true
    }

    /// Get the schema for a specific column.
    pub fn get(&self, key: &SchemaKey) -> Option<&ColumnSchema> {
        self.schemas.get(key)
    }

    /// Get the schema for a column by sheet_id and column index.
    pub fn get_column_schema(&self, sheet_id: SheetId, column: u32) -> Option<&ColumnSchema> {
        self.schemas.get(&SchemaKey { sheet_id, column })
    }

    /// Iterate over all schemas.
    pub fn iter(&self) -> impl Iterator<Item = (&SchemaKey, &ColumnSchema)> {
        self.schemas.iter()
    }

    /// Get all schemas for a specific sheet.
    pub fn schemas_for_sheet(&self, sheet_id: SheetId) -> Vec<(&SchemaKey, &ColumnSchema)> {
        self.schemas
            .iter()
            .filter(|(k, _)| k.sheet_id == sheet_id)
            .collect()
    }
}

impl Default for SchemaMap {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SchemaType;

    fn make_schema(name: &str, schema_type: SchemaType) -> ColumnSchema {
        ColumnSchema {
            id: name.to_string(),
            name: name.to_string(),
            schema_type,
            constraints: None,
            distribution: None,
            description: None,
        }
    }

    #[test]
    fn new_schema_map_is_empty() {
        let map = SchemaMap::new();
        assert!(map.is_empty());
        assert_eq!(map.len(), 0);
        assert_eq!(map.version(), 0);
    }

    #[test]
    fn load_replaces_all() {
        let mut map = SchemaMap::new();
        let key = SchemaKey {
            sheet_id: SheetId::from_raw(1),
            column: 0,
        };
        map.update(key.clone(), make_schema("col1", SchemaType::Number), 1);

        let mut new_schemas = HashMap::new();
        let key2 = SchemaKey {
            sheet_id: SheetId::from_raw(1),
            column: 1,
        };
        new_schemas.insert(key2.clone(), make_schema("col2", SchemaType::String));
        map.load(new_schemas, 5);

        assert_eq!(map.len(), 1);
        assert!(map.get(&key).is_none());
        assert!(map.get(&key2).is_some());
        assert_eq!(map.version(), 5);
    }

    #[test]
    fn update_increments_version() {
        let mut map = SchemaMap::new();
        let key = SchemaKey {
            sheet_id: SheetId::from_raw(1),
            column: 0,
        };
        assert!(map.update(key.clone(), make_schema("col1", SchemaType::Number), 1));
        assert_eq!(map.version(), 1);
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn stale_update_rejected() {
        let mut map = SchemaMap::new();
        let key = SchemaKey {
            sheet_id: SheetId::from_raw(1),
            column: 0,
        };
        map.update(key.clone(), make_schema("col1", SchemaType::Number), 5);
        assert!(!map.update(key.clone(), make_schema("col1_old", SchemaType::String), 3));
        assert_eq!(map.get(&key).unwrap().schema_type, SchemaType::Number);
    }

    #[test]
    fn equal_version_update_rejected() {
        let mut map = SchemaMap::new();
        let key = SchemaKey {
            sheet_id: SheetId::from_raw(1),
            column: 0,
        };
        map.update(key.clone(), make_schema("col1", SchemaType::Number), 5);
        assert!(!map.update(key.clone(), make_schema("col1_same", SchemaType::String), 5));
        assert_eq!(map.get(&key).unwrap().schema_type, SchemaType::Number);
    }

    #[test]
    fn remove_works() {
        let mut map = SchemaMap::new();
        let key = SchemaKey {
            sheet_id: SheetId::from_raw(1),
            column: 0,
        };
        map.update(key.clone(), make_schema("col1", SchemaType::Number), 1);
        assert!(map.remove(&key, 2));
        assert!(map.get(&key).is_none());
        assert_eq!(map.len(), 0);
    }

    #[test]
    fn stale_remove_rejected() {
        let mut map = SchemaMap::new();
        let key = SchemaKey {
            sheet_id: SheetId::from_raw(1),
            column: 0,
        };
        map.update(key.clone(), make_schema("col1", SchemaType::Number), 5);
        assert!(!map.remove(&key, 3));
        assert!(map.get(&key).is_some());
    }

    #[test]
    fn get_column_schema() {
        let mut map = SchemaMap::new();
        let sid = SheetId::from_raw(42);
        map.update(
            SchemaKey {
                sheet_id: sid,
                column: 3,
            },
            make_schema("revenue", SchemaType::Currency),
            1,
        );
        assert!(map.get_column_schema(sid, 3).is_some());
        assert_eq!(
            map.get_column_schema(sid, 3).unwrap().schema_type,
            SchemaType::Currency
        );
        assert!(map.get_column_schema(sid, 0).is_none());
    }

    #[test]
    fn schemas_for_sheet() {
        let mut map = SchemaMap::new();
        let s1 = SheetId::from_raw(1);
        let s2 = SheetId::from_raw(2);
        map.update(
            SchemaKey {
                sheet_id: s1,
                column: 0,
            },
            make_schema("a", SchemaType::Number),
            1,
        );
        map.update(
            SchemaKey {
                sheet_id: s1,
                column: 1,
            },
            make_schema("b", SchemaType::String),
            2,
        );
        map.update(
            SchemaKey {
                sheet_id: s2,
                column: 0,
            },
            make_schema("c", SchemaType::Date),
            3,
        );
        assert_eq!(map.schemas_for_sheet(s1).len(), 2);
        assert_eq!(map.schemas_for_sheet(s2).len(), 1);
    }

    #[test]
    fn default_trait() {
        let map = SchemaMap::default();
        assert!(map.is_empty());
        assert_eq!(map.version(), 0);
    }
}
