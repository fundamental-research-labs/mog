use super::constants::{CT_RELATIONSHIPS, CT_XML};
use super::types::{ContentTypeDefault, ContentTypeOverride};

/// Manager for building `[Content_Types].xml` files.
///
/// This struct provides a builder-style API for creating the content types
/// manifest required by XLSX files.
///
/// # Example
///
/// ```
/// use xlsx_parser::write::{ContentTypesManager, CT_WORKBOOK};
///
/// let mut ct = ContentTypesManager::with_xlsx_defaults();
/// ct.add_workbook()
///   .add_worksheet(1)
///   .add_worksheet(2)
///   .add_styles()
///   .add_shared_strings();
///
/// let xml = ct.to_xml();
/// ```
#[derive(Debug, Clone, Default)]
pub struct ContentTypesManager {
    /// Default mappings (extension -> content type)
    defaults: Vec<ContentTypeDefault>,
    /// Override mappings (path -> content type)
    overrides: Vec<ContentTypeOverride>,
}

impl ContentTypesManager {
    /// Create a new empty ContentTypesManager.
    pub fn new() -> Self {
        Self {
            defaults: Vec::new(),
            overrides: Vec::new(),
        }
    }

    /// Create a ContentTypesManager with standard XLSX defaults.
    ///
    /// This adds the default mappings for:
    /// - `.rels` files -> relationships content type
    /// - `.xml` files -> generic XML content type
    pub fn with_xlsx_defaults() -> Self {
        let mut ct = Self::new();
        ct.add_default("rels", CT_RELATIONSHIPS);
        ct.add_default("xml", CT_XML);
        ct
    }

    /// Add a default mapping for a file extension.
    ///
    /// # Arguments
    /// * `extension` - The file extension (without the dot)
    /// * `content_type` - The content type MIME string
    pub fn add_default(&mut self, extension: &str, content_type: &str) -> &mut Self {
        if !self.defaults.iter().any(|d| d.extension == extension) {
            self.defaults
                .push(ContentTypeDefault::new(extension, content_type));
        }
        self
    }

    /// Prefer an imported content type for an already-required default row.
    ///
    /// This is intentionally update-only: callers must first derive the current
    /// package's required defaults from emitted graph parts. Imported defaults
    /// that do not correspond to a current required row are ignored.
    pub fn prefer_existing_default_content_type(
        &mut self,
        extension: &str,
        content_type: &str,
    ) -> &mut Self {
        if let Some(default) = self
            .defaults
            .iter_mut()
            .find(|default| default.extension.eq_ignore_ascii_case(extension))
        {
            default.content_type = content_type.to_string();
        }
        self
    }

    /// Add an override mapping for a specific path.
    ///
    /// # Arguments
    /// * `part_name` - The path (will be prefixed with '/' if not present)
    /// * `content_type` - The content type MIME string
    pub fn add_override(&mut self, part_name: &str, content_type: &str) -> &mut Self {
        let normalized = normalize_part_name(part_name);
        if !self.overrides.iter().any(|o| o.part_name == normalized) {
            self.overrides
                .push(ContentTypeOverride::new(&normalized, content_type));
        }
        self
    }

    /// Get the number of default entries.
    pub fn default_count(&self) -> usize {
        self.defaults.len()
    }

    /// Get the number of override entries.
    pub fn override_count(&self) -> usize {
        self.overrides.len()
    }

    /// Check if a default exists for an extension.
    pub fn has_default(&self, extension: &str) -> bool {
        self.defaults.iter().any(|d| d.extension == extension)
    }

    /// Check if an override exists for a path.
    pub fn has_override(&self, part_name: &str) -> bool {
        let normalized = normalize_part_name(part_name);
        self.overrides.iter().any(|o| o.part_name == normalized)
    }

    /// Get all default entries.
    pub fn defaults(&self) -> &[ContentTypeDefault] {
        &self.defaults
    }

    /// Get all override entries.
    pub fn overrides(&self) -> &[ContentTypeOverride] {
        &self.overrides
    }
}

fn normalize_part_name(part_name: &str) -> String {
    if part_name.starts_with('/') {
        part_name.to_string()
    } else {
        format!("/{}", part_name)
    }
}
