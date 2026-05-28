use super::types::Relationship;

/// Manages a collection of relationships for a .rels file
///
/// # Example
///
/// ```ignore
/// use xlsx_parser::write::relationships::{RelationshipManager, REL_WORKSHEET, REL_STYLES};
///
/// let mut rels = RelationshipManager::new();
/// let sheet_id = rels.add(REL_WORKSHEET, "worksheets/sheet1.xml");
/// let styles_id = rels.add(REL_STYLES, "styles.xml");
///
/// let xml = rels.to_xml();
/// // xml contains the .rels file content
/// ```
#[derive(Debug, Clone)]
pub struct RelationshipManager {
    /// Collection of relationships
    relationships: Vec<Relationship>,
    /// Counter for generating unique IDs
    next_id: u32,
}

impl Default for RelationshipManager {
    fn default() -> Self {
        Self::new()
    }
}

impl RelationshipManager {
    /// Create a new empty relationship manager
    pub fn new() -> Self {
        Self {
            relationships: Vec::new(),
            next_id: 1,
        }
    }

    /// Add a relationship and return its ID (rId1, rId2, etc.)
    ///
    /// # Arguments
    /// * `rel_type` - The relationship type URI (use REL_* constants)
    /// * `target` - The relative path to the target file
    ///
    /// # Returns
    /// The generated relationship ID (e.g., "rId1")
    pub fn add(&mut self, rel_type: &str, target: &str) -> String {
        let id = self.next_relationship_id();

        self.relationships
            .push(Relationship::new(id.clone(), rel_type, target));

        id
    }

    /// Add a relationship with an explicit target mode.
    pub fn add_with_target_mode(
        &mut self,
        rel_type: &str,
        target: &str,
        target_mode: Option<String>,
    ) -> String {
        let id = self.next_relationship_id();

        self.relationships.push(Relationship {
            id: id.clone(),
            rel_type: rel_type.to_string(),
            target: target.to_string(),
            target_mode,
        });

        id
    }

    /// Add a relationship with a specific ID (for round-trip fidelity).
    ///
    /// Also bumps `next_id` past the given ID to prevent future `add()` calls
    /// from generating a conflicting ID.
    pub fn add_with_id(&mut self, id: &str, rel_type: &str, target: &str) {
        self.bump_next_id_from(id);
        self.relationships
            .push(Relationship::new(id.to_string(), rel_type, target));
    }

    /// Find an existing relationship by target path.
    /// Returns the relationship ID if found, or `None` if no relationship targets this path.
    pub fn find_by_target(&self, target: &str) -> Option<String> {
        self.relationships
            .iter()
            .find(|r| r.target == target)
            .map(|r| r.id.clone())
    }

    /// Replace any relationship for the same type+target with the provided ID,
    /// or add it if it does not already exist.
    pub fn set_with_id(&mut self, id: &str, rel_type: &str, target: &str) {
        self.bump_next_id_from(id);
        if let Some(existing) = self
            .relationships
            .iter_mut()
            .find(|r| r.rel_type == rel_type && r.target == target)
        {
            existing.id = id.to_string();
            existing.target_mode = None;
            return;
        }
        self.add_with_id(id, rel_type, target);
    }

    /// Add an external relationship (e.g., for hyperlinks)
    ///
    /// # Arguments
    /// * `rel_type` - The relationship type URI
    /// * `target` - The external URL or path
    ///
    /// # Returns
    /// The generated relationship ID (e.g., "rId1")
    pub fn add_external(&mut self, rel_type: &str, target: &str) -> String {
        let id = self.next_relationship_id();

        self.relationships
            .push(Relationship::external(id.clone(), rel_type, target));

        id
    }

    /// Add an external relationship with a specific ID.
    pub fn add_external_with_id(&mut self, id: &str, rel_type: &str, target: &str) {
        self.bump_next_id_from(id);
        self.relationships
            .push(Relationship::external(id.to_string(), rel_type, target));
    }

    /// Get all relationships
    pub fn relationships(&self) -> &[Relationship] {
        &self.relationships
    }

    /// Check if any relationships exist
    pub fn is_empty(&self) -> bool {
        self.relationships.is_empty()
    }

    /// Get the number of relationships
    pub fn len(&self) -> usize {
        self.relationships.len()
    }

    /// Get a relationship by its ID
    pub fn get_by_id(&self, id: &str) -> Option<&Relationship> {
        self.relationships.iter().find(|r| r.id == id)
    }

    /// Check if a relationship with the given type already exists.
    pub fn has_rel_type(&self, rel_type: &str) -> bool {
        self.relationships.iter().any(|r| r.rel_type == rel_type)
    }

    /// Add a relationship only if no relationship with the same type exists.
    /// Returns the ID of the existing or newly added relationship.
    pub fn add_if_missing(&mut self, rel_type: &str, target: &str) -> String {
        if let Some(existing) = self.relationships.iter().find(|r| r.rel_type == rel_type) {
            return existing.id.clone();
        }
        self.add(rel_type, target)
    }

    /// Create a RelationshipManager from resolved relationship records.
    pub fn from_relationships(relationships: Vec<Relationship>) -> Self {
        let next_id = relationships
            .iter()
            .filter_map(|r| numeric_relationship_id(&r.id))
            .max()
            .map_or(1, |max_id| max_id + 1);

        Self {
            relationships,
            next_id,
        }
    }

    /// Create a RelationshipManager from original OPC relationships.
    ///
    /// This replays stored relationships with their original IDs, types, targets,
    /// and order - used during round-trip writing to preserve fidelity.
    pub fn from_original(rels: &[ooxml_types::shared::OpcRelationship]) -> Self {
        let relationships: Vec<Relationship> = rels
            .iter()
            .map(|r| Relationship {
                id: r.id.clone(),
                rel_type: r.rel_type.clone(),
                target: r.target.clone(),
                target_mode: r.target_mode.clone(),
            })
            .collect();

        Self::from_relationships(relationships)
    }

    fn next_relationship_id(&mut self) -> String {
        let id = format!("rId{}", self.next_id);
        self.next_id += 1;
        id
    }

    fn bump_next_id_from(&mut self, id: &str) {
        if let Some(num) = numeric_relationship_id(id) {
            if num >= self.next_id {
                self.next_id = num + 1;
            }
        }
    }
}

fn numeric_relationship_id(id: &str) -> Option<u32> {
    id.strip_prefix("rId")?.parse::<u32>().ok()
}
