//! Document properties types (ECMA-376 OPC Part 2 — Core Properties;
//! ECMA-376 Part 1, Section 22.2 — Extended Properties;
//! ECMA-376 Part 1, Section 22.3 — Custom Properties).
//!
//! Types modelling the contents of `docProps/core.xml`, `docProps/app.xml`,
//! and `docProps/custom.xml`. These three parts carry metadata about the
//! workbook (or document) and are defined by a mix of OPC, Dublin Core,
//! and SpreadsheetML specifications.

// =============================================================================
// CoreProperties — CT_CoreProperties (OPC Part 2)
// =============================================================================

/// Core document properties from `docProps/core.xml` (OPC Part 2, CT_CoreProperties).
///
/// These properties combine Dublin Core elements (`dc:`, `dcterms:`) with
/// OPC-specific elements (`cp:`) to describe the document's authorship,
/// dates, and classification.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct CoreProperties {
    // -- Dublin Core elements (dc:) ------------------------------------------
    /// Document author (`dc:creator`).
    pub creator: Option<String>,
    /// Document description or abstract (`dc:description`).
    pub description: Option<String>,
    /// Unique identifier for the document (`dc:identifier`).
    pub identifier: Option<String>,
    /// Language of the document (`dc:language`).
    pub language: Option<String>,
    /// Subject or topic of the document (`dc:subject`).
    pub subject: Option<String>,
    /// Document title (`dc:title`).
    pub title: Option<String>,

    // -- Dublin Core terms (dcterms:) ----------------------------------------
    /// Creation date in W3CDTF format (`dcterms:created`, `xsi:type="dcterms:W3CDTF"`).
    pub created: Option<String>,
    /// Last modified date in W3CDTF format (`dcterms:modified`, `xsi:type="dcterms:W3CDTF"`).
    pub modified: Option<String>,

    // -- OPC core properties (cp:) -------------------------------------------
    /// Category of the document (`cp:category`).
    pub category: Option<String>,
    /// Content status, e.g. "Draft", "Final" (`cp:contentStatus`).
    pub content_status: Option<String>,
    /// MIME content type (`cp:contentType`).
    pub content_type: Option<String>,
    /// Keywords associated with the document (`cp:keywords`).
    pub keywords: Option<String>,
    /// Last person to modify the document (`cp:lastModifiedBy`).
    pub last_modified_by: Option<String>,
    /// Date the document was last printed, ISO 8601 (`cp:lastPrinted`).
    pub last_printed: Option<String>,
    /// Revision number (`cp:revision`).
    pub revision: Option<String>,
    /// Version number (`cp:version`).
    pub version: Option<String>,
}

// =============================================================================
// HeadingPair — CT_VectorVariant helper
// =============================================================================

/// A single heading pair from `<HeadingPairs>` (CT_VectorVariant).
///
/// Each pair maps a category name (e.g. "Worksheets", "Named Ranges", "Charts")
/// to the count of items belonging to that category in `TitlesOfParts`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadingPair {
    /// Category name (e.g. "Worksheets", "Named Ranges").
    pub name: String,
    /// Number of items in this category within TitlesOfParts.
    pub count: u32,
}

// =============================================================================
// ExtendedProperties — CT_Properties (ECMA-376 Part 1, Section 22.2)
// =============================================================================

/// Extended document properties from `docProps/app.xml` (ECMA-376 Part 1, Section 22.2).
///
/// The full XSD (`CT_Properties`) defines many fields; this struct models the
/// subset relevant to spreadsheet round-tripping.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct ExtendedProperties {
    /// Total editing time in minutes (`<TotalTime>`).
    pub total_time: Option<String>,
    /// Application that created the document (`<Application>`).
    pub application: Option<String>,
    /// Application version string (`<AppVersion>`).
    pub app_version: Option<String>,
    /// Document security flags (`<DocSecurity>`). 0 = none.
    pub doc_security: Option<u32>,
    /// Company name (`<Company>`).
    pub company: Option<String>,
    /// Manager name (`<Manager>`).
    pub manager: Option<String>,
    /// Template name (`<Template>`).
    pub template: Option<String>,
    /// Whether document thumbnails are cropped (`<ScaleCrop>`).
    pub scale_crop: Option<bool>,
    /// Whether hyperlinks are up to date (`<LinksUpToDate>`).
    pub links_up_to_date: Option<bool>,
    /// Whether the document is shared (`<SharedDoc>`).
    pub shared_doc: Option<bool>,
    /// Whether hyperlinks have changed (`<HyperlinksChanged>`).
    pub hyperlinks_changed: Option<bool>,
    /// Base URI for relative hyperlinks (`<HyperlinkBase>`).
    pub hyperlink_base: Option<String>,
    /// Structured heading pairs from `<HeadingPairs>` (CT_VectorVariant).
    ///
    /// Each pair maps a category name to a count of items in `titles_of_parts`.
    pub heading_pairs: Vec<HeadingPair>,
    /// Flat list of part titles from `<TitlesOfParts>` (CT_VectorLpstr).
    ///
    /// The order corresponds to the heading pairs: the first N titles belong to
    /// the first heading pair, the next M to the second, etc.
    pub titles_of_parts: Vec<String>,
}

// =============================================================================
// CustomPropertyValue — property value variant
// =============================================================================

/// Typed value for a custom document property (CT_Property value choices).
///
/// Maps to the VT (variant type) namespace elements within each `<property>`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", content = "value")]
#[serde(rename_all = "camelCase")]
pub enum CustomPropertyValue {
    /// `vt:lpwstr` — string value.
    Lpwstr(String),
    /// `vt:i4` — 32-bit signed integer.
    I4(i32),
    /// `vt:r8` — 64-bit floating-point value.
    R8(f64),
    /// `vt:bool` — boolean value.
    Bool(bool),
    /// `vt:filetime` — date/time in ISO 8601 format.
    Filetime(String),
}

// =============================================================================
// CustomProperty — CT_Property
// =============================================================================

/// A single custom property from `docProps/custom.xml` (CT_Property).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProperty {
    /// Format ID (typically `{D5CDD505-2E9C-101B-9397-08002B2CF9AE}`).
    pub fmtid: String,
    /// Property ID (integer, typically starting from 2).
    pub pid: u32,
    /// Property name.
    pub name: String,
    /// Property value.
    pub value: CustomPropertyValue,
}

// =============================================================================
// CustomProperties — CT_CustomProperties
// =============================================================================

/// Custom document properties from `docProps/custom.xml` (ECMA-376 Part 1, Section 22.3).
///
/// Contains zero or more user-defined properties with typed values.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct CustomProperties {
    /// List of custom properties (`<property>` elements).
    pub properties: Vec<CustomProperty>,
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_properties_default() {
        let props = CoreProperties::default();
        assert_eq!(props.creator, None);
        assert_eq!(props.title, None);
        assert_eq!(props.created, None);
        assert_eq!(props.modified, None);
        assert_eq!(props.last_modified_by, None);
        assert_eq!(props.revision, None);
    }

    #[test]
    fn extended_properties_default() {
        let props = ExtendedProperties::default();
        assert_eq!(props.application, None);
        assert_eq!(props.app_version, None);
        assert_eq!(props.doc_security, None);
        assert!(props.heading_pairs.is_empty());
        assert!(props.titles_of_parts.is_empty());
    }

    #[test]
    fn custom_properties_default() {
        let props = CustomProperties::default();
        assert!(props.properties.is_empty());
    }

    #[test]
    fn core_properties_serde_roundtrip() {
        let props = CoreProperties {
            creator: Some("Alice".into()),
            title: Some("Budget 2026".into()),
            created: Some("2026-01-15T10:30:00Z".into()),
            modified: Some("2026-03-17T08:00:00Z".into()),
            last_modified_by: Some("Bob".into()),
            revision: Some("3".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&props).unwrap();
        let deser: CoreProperties = serde_json::from_str(&json).unwrap();
        assert_eq!(props, deser);
    }

    #[test]
    fn extended_properties_serde_roundtrip() {
        let props = ExtendedProperties {
            application: Some("Microsoft Excel".into()),
            app_version: Some("16.0300".into()),
            doc_security: Some(0),
            company: Some("Acme Corp".into()),
            scale_crop: Some(false),
            links_up_to_date: Some(false),
            shared_doc: Some(false),
            hyperlinks_changed: Some(false),
            heading_pairs: vec![
                HeadingPair {
                    name: "Worksheets".into(),
                    count: 3,
                },
                HeadingPair {
                    name: "Named Ranges".into(),
                    count: 1,
                },
            ],
            titles_of_parts: vec![
                "Sheet1".into(),
                "Sheet2".into(),
                "Sheet3".into(),
                "TotalRevenue".into(),
            ],
            ..Default::default()
        };
        let json = serde_json::to_string(&props).unwrap();
        let deser: ExtendedProperties = serde_json::from_str(&json).unwrap();
        assert_eq!(props, deser);
    }

    #[test]
    fn custom_properties_serde_roundtrip() {
        let props = CustomProperties {
            properties: vec![
                CustomProperty {
                    fmtid: "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".into(),
                    pid: 2,
                    name: "Department".into(),
                    value: CustomPropertyValue::Lpwstr("Finance".into()),
                },
                CustomProperty {
                    fmtid: "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".into(),
                    pid: 3,
                    name: "Reviewed".into(),
                    value: CustomPropertyValue::Bool(true),
                },
                CustomProperty {
                    fmtid: "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".into(),
                    pid: 4,
                    name: "Score".into(),
                    value: CustomPropertyValue::R8(95.5),
                },
                CustomProperty {
                    fmtid: "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".into(),
                    pid: 5,
                    name: "Count".into(),
                    value: CustomPropertyValue::I4(42),
                },
                CustomProperty {
                    fmtid: "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}".into(),
                    pid: 6,
                    name: "LastAudit".into(),
                    value: CustomPropertyValue::Filetime("2026-01-01T00:00:00Z".into()),
                },
            ],
        };
        let json = serde_json::to_string(&props).unwrap();
        let deser: CustomProperties = serde_json::from_str(&json).unwrap();
        assert_eq!(props, deser);
    }

    #[test]
    fn custom_property_value_serde_tag() {
        // Verify the tagged enum serialization format.
        let val = CustomPropertyValue::Lpwstr("hello".into());
        let json = serde_json::to_string(&val).unwrap();
        assert!(json.contains("\"type\""));
        assert!(json.contains("\"lpwstr\""));
        assert!(json.contains("\"value\""));
        assert!(json.contains("\"hello\""));
    }

    #[test]
    fn heading_pair_serde_roundtrip() {
        let pair = HeadingPair {
            name: "Charts".into(),
            count: 5,
        };
        let json = serde_json::to_string(&pair).unwrap();
        let deser: HeadingPair = serde_json::from_str(&json).unwrap();
        assert_eq!(pair, deser);
    }
}
