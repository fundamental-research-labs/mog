/// A default content type mapping for file extensions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentTypeDefault {
    /// The file extension (without the dot), e.g., "xml", "rels"
    pub extension: String,
    /// The content type MIME string
    pub content_type: String,
}

impl ContentTypeDefault {
    /// Create a new default content type mapping.
    pub fn new(extension: &str, content_type: &str) -> Self {
        Self {
            extension: extension.to_string(),
            content_type: content_type.to_string(),
        }
    }
}

/// An override content type mapping for specific paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentTypeOverride {
    /// The part name (path with leading slash), e.g., "/xl/workbook.xml"
    pub part_name: String,
    /// The content type MIME string
    pub content_type: String,
}

impl ContentTypeOverride {
    /// Create a new override content type mapping.
    pub fn new(part_name: &str, content_type: &str) -> Self {
        let part_name = if part_name.starts_with('/') {
            part_name.to_string()
        } else {
            format!("/{}", part_name)
        };

        Self {
            part_name,
            content_type: content_type.to_string(),
        }
    }
}
