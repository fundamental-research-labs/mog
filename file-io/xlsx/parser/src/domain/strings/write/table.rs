use super::types::{RichTextRun, SharedStringValue, StringEntry};
use std::collections::HashMap;

/// Writer for the shared strings table (xl/sharedStrings.xml).
///
/// Export derives the table from the current workbook cells for each write.
/// Imported SST slots and original cell SST indices are provenance only; they
/// must not seed this writer or influence emitted indices.
///
/// # Example
///
/// ```ignore
/// let mut sst = SharedStringsWriter::new();
///
/// // Add strings (returns index)
/// let idx1 = sst.add("Hello");  // 0
/// let idx2 = sst.add("World");  // 1
/// let idx3 = sst.add("Hello");  // 0 (reused, count incremented)
///
/// // Generate XML
/// let xml = sst.to_xml();
/// ```
#[derive(Debug, Clone, Default)]
pub struct SharedStringsWriter {
    /// All string entries (in original insertion order)
    pub(super) entries: Vec<StringEntry>,
    /// Plain text -> index map for O(1) lookup (first occurrence only)
    pub(super) index_map: HashMap<String, usize>,
    /// Next rich text index (rich text entries are always unique)
    pub(super) next_index: usize,
    pub(super) rich_index_map: HashMap<String, usize>,
    pub(super) root_ext_lst_xml: Option<Vec<u8>>,
}

impl SharedStringsWriter {
    /// Create a new empty shared strings writer.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            index_map: HashMap::new(),
            next_index: 0,
            rich_index_map: HashMap::new(),
            root_ext_lst_xml: None,
        }
    }

    /// Create a new shared strings writer with pre-allocated capacity.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            entries: Vec::with_capacity(capacity),
            index_map: HashMap::with_capacity(capacity),
            next_index: 0,
            rich_index_map: HashMap::new(),
            root_ext_lst_xml: None,
        }
    }

    /// Add a plain string and return its index.
    ///
    /// If the string already exists, increments its reference count
    /// and returns the existing index.
    ///
    /// # Arguments
    /// * `text` - The string to add
    ///
    /// # Returns
    /// The index of the string in the shared strings table
    pub fn add(&mut self, text: &str) -> usize {
        // Check if string already exists (returns first occurrence index for duplicates)
        if let Some(&idx) = self.index_map.get(text) {
            self.entries[idx].count += 1;
            return idx;
        }

        // Add new string
        let idx = self.next_index;
        self.entries.push(StringEntry {
            value: SharedStringValue::Plain(text.to_string()),
            count: 1,
            phonetic_xml: None,
        });
        self.index_map.insert(text.to_string(), idx);
        self.next_index += 1;
        idx
    }

    /// Add rich text and return its index.
    ///
    /// Rich text is always added as a new entry (no deduplication)
    /// because comparing rich text formatting would be expensive.
    ///
    /// # Arguments
    /// * `runs` - The rich text runs with formatting
    ///
    /// # Returns
    /// The index of the rich text in the shared strings table
    pub fn add_rich_text(&mut self, runs: Vec<RichTextRun>) -> usize {
        let idx = self.next_index;
        self.entries.push(StringEntry {
            value: SharedStringValue::RichText(runs),
            count: 1,
            phonetic_xml: None,
        });
        self.next_index += 1;
        idx
    }

    /// Add a cell-owned rich string, deduplicating structurally.
    pub fn add_rich_shared_string(&mut self, rich: domain_types::RichSharedString) -> usize {
        let key = serde_json::to_string(&rich)
            .expect("rich shared-string state should be JSON-serializable");
        if let Some(&idx) = self.rich_index_map.get(&key) {
            self.entries[idx].count += 1;
            return idx;
        }

        let idx = self.next_index;
        self.entries.push(StringEntry {
            value: SharedStringValue::RichSharedString(rich),
            count: 1,
            phonetic_xml: None,
        });
        self.rich_index_map.insert(key, idx);
        self.next_index += 1;
        idx
    }

    /// Get the index of a plain string (if it exists).
    ///
    /// # Arguments
    /// * `text` - The string to look up
    ///
    /// # Returns
    /// The index if the string exists, None otherwise
    pub fn get_index(&self, text: &str) -> Option<usize> {
        self.index_map.get(text).copied()
    }

    /// Get the total count of unique strings.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if the shared strings table is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Check whether any entry is actually referenced by cells.
    pub fn has_referenced_entries(&self) -> bool {
        self.total_count() > 0
    }

    pub fn has_part_content(&self) -> bool {
        self.has_referenced_entries() || self.root_ext_lst_xml.is_some()
    }

    pub fn set_root_ext_lst_xml(&mut self, ext_lst_xml: Option<Vec<u8>>) {
        self.root_ext_lst_xml = ext_lst_xml.filter(|xml| !xml.is_empty());
    }

    /// Get the total reference count (sum of all string usage counts).
    ///
    /// This is used for the `count` attribute in the `<sst>` element.
    pub fn total_count(&self) -> usize {
        self.entries.iter().map(|e| e.count).sum()
    }
}
