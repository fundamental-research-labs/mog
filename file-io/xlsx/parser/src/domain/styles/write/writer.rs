//! Styles writer implementation.
//!
//! This module generates `xl/styles.xml` for XLSX files, including:
//! - Number formats (custom and built-in)
//! - Fonts
//! - Fills (solid, pattern, gradient)
//! - Borders
//! - Cell XFs (style combinations)
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::styles::{StylesWriter, FontDef, FillDef, ColorDef};
//!
//! let mut writer = StylesWriter::with_defaults();
//!
//! // Add a bold red font
//! let font_id = writer.add_font(FontDef {
//!     name: Some("Calibri".to_string()),
//!     size: Some(11.0),
//!     bold: true,
//!     color: Some(ColorDef::rgb("FFFF0000")),
//!     ..Default::default()
//! });
//!
//! // Create a style using that font
//! let style_id = writer.create_style(
//!     Some(FontDef { bold: true, ..Default::default() }),
//!     None,
//!     None,
//!     Some("#,##0.00"),
//!     None,
//! );
//!
//! let xml = writer.to_xml();
//! ```

use crate::domain::styles::types::*;

/// First ID for custom number formats (built-in formats use 0-163)
const CUSTOM_NUM_FMT_START_ID: u32 = 164;

const MC_IGNORABLE_STYLE_PREFIXES: &[&str] = &[
    "x14ac", "xr", "xr2", "xr3", "xr6", "xr9", "xr10", "x15", "x15ac", "x16r2",
];

#[derive(Debug, Clone, Default)]
pub struct StyleRootNamespaces {
    attrs: Vec<(String, String)>,
    mce_attributes: domain_types::MceAttributes,
}

impl StyleRootNamespaces {
    pub fn from_attrs(attrs: Vec<(String, String)>) -> Self {
        Self {
            attrs,
            mce_attributes: domain_types::MceAttributes::default(),
        }
    }

    pub fn from_attrs_and_mce(
        attrs: Vec<(String, String)>,
        mce_attributes: domain_types::MceAttributes,
    ) -> Self {
        Self {
            attrs,
            mce_attributes,
        }
    }

    pub(super) fn has_prefix(&self, prefix: &str) -> bool {
        self.attrs
            .iter()
            .any(|(attr_prefix, _)| attr_prefix == prefix)
    }

    pub(super) fn ignorable_prefixes(&self) -> impl Iterator<Item = &str> {
        self.attrs
            .iter()
            .map(|(prefix, _)| prefix.as_str())
            .filter(|prefix| MC_IGNORABLE_STYLE_PREFIXES.contains(prefix))
    }

    pub(super) fn mce_attributes(&self) -> &domain_types::MceAttributes {
        &self.mce_attributes
    }

    pub(super) fn prefixed_attrs(&self) -> impl Iterator<Item = (&str, &str)> {
        self.attrs
            .iter()
            .filter(|(prefix, _)| !prefix.is_empty())
            .map(|(prefix, uri)| (prefix.as_str(), uri.as_str()))
    }
}

// =============================================================================
// StylesWriter
// =============================================================================

/// Styles writer with deduplication support
///
/// This struct manages all style components (fonts, fills, borders, etc.)
/// and provides deduplication so identical styles share the same ID.
#[derive(Debug, Clone)]
pub struct StylesWriter {
    /// Custom number formats (IDs start at 164)
    pub num_fmts: Vec<NumberFormatDef>,
    /// Next available custom number format ID
    next_num_fmt_id: u32,
    /// Font definitions
    pub fonts: Vec<FontDef>,
    /// Fill definitions
    pub fills: Vec<FillDef>,
    /// Border definitions
    pub borders: Vec<BorderDef>,
    /// Cell XFs (style combinations)
    pub cell_xfs: Vec<CellXfDef>,
    /// Cell style XFs (base styles)
    pub cell_style_xfs: Vec<CellXfDef>,
    /// Named cell styles (e.g., "Normal", "Percent")
    pub cell_styles: Vec<CellStyleDef>,
    /// Differential formatting records (for conditional formatting / table styles)
    pub dxfs: Vec<DxfDef>,
    /// Custom color palette
    pub colors: Option<ColorsDef>,
    /// Table style definitions
    pub table_styles: Vec<TableStyleDef>,
    /// Default table style name
    pub default_table_style: Option<String>,
    /// Default pivot style name
    pub default_pivot_style: Option<String>,
    /// Whether to emit `x14ac:knownFonts="1"` on the `<fonts>` element.
    /// When true, the writer also adds `xmlns:x14ac`, `xmlns:mc`, and
    /// `mc:Ignorable="x14ac"` on the `<styleSheet>` root element.
    pub known_fonts: bool,
    /// Stylesheet-owned namespace declarations from the `<styleSheet>` root.
    pub root_namespaces: StyleRootNamespaces,
    /// Raw XML of <extLst>...</extLst> for round-trip fidelity (opaque passthrough)
    pub ext_lst_raw: Option<Vec<u8>>,
}

impl Default for StylesWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl StylesWriter {
    /// Create a new empty styles writer
    ///
    /// Note: For Excel compatibility, use `with_defaults()` instead,
    /// which includes required default fonts, fills, and borders.
    pub fn new() -> Self {
        Self {
            num_fmts: Vec::new(),
            next_num_fmt_id: CUSTOM_NUM_FMT_START_ID,
            fonts: Vec::new(),
            fills: Vec::new(),
            borders: Vec::new(),
            cell_xfs: Vec::new(),
            cell_style_xfs: Vec::new(),
            cell_styles: Vec::new(),
            dxfs: Vec::new(),
            colors: None,
            table_styles: Vec::new(),
            default_table_style: None,
            default_pivot_style: None,
            known_fonts: false,
            root_namespaces: StyleRootNamespaces::default(),
            ext_lst_raw: None,
        }
    }

    /// Create a styles writer with Excel-compatible defaults
    ///
    /// This includes:
    /// - Default font (Calibri 11pt)
    /// - Required fills (none, gray125)
    /// - Default border (empty)
    /// - Default cell style XF
    /// - Default cell XF
    pub fn with_defaults() -> Self {
        let mut writer = Self::new();

        // Default font (required by Excel)
        writer.fonts.push(FontDef {
            name: Some("Calibri".to_string()),
            size: Some(11.0),
            color: Some(ColorDef::Theme { id: 1, tint: None }),
            family: Some(2),
            scheme: Some(FontScheme::Minor),
            ..Default::default()
        });

        // Required fills: Excel requires at least 2 fills
        // Fill 0: none
        writer.fills.push(FillDef::Pattern {
            pattern_type: Some(PatternType::None),
            fg_color: None,
            bg_color: None,
        });
        // Fill 1: gray125 (required by Excel)
        writer.fills.push(FillDef::Pattern {
            pattern_type: Some(PatternType::Gray125),
            fg_color: None,
            bg_color: None,
        });

        // Default border (empty)
        writer.borders.push(BorderDef::default());

        // Default cell style XF
        writer.cell_style_xfs.push(CellXfDef {
            num_fmt_id: Some(0),
            font_id: Some(0),
            fill_id: Some(0),
            border_id: Some(0),
            ..Default::default()
        });

        // Default cell XF (references cell style XF 0)
        writer.cell_xfs.push(CellXfDef {
            num_fmt_id: Some(0),
            font_id: Some(0),
            fill_id: Some(0),
            border_id: Some(0),
            xf_id: Some(0),
            ..Default::default()
        });

        writer
    }

    /// Add a custom number format, returns the format ID
    ///
    /// Built-in formats (0-163) are not stored; this method is for custom formats only.
    /// The format code is deduplicated - if an identical format exists, its ID is returned.
    ///
    /// # Arguments
    /// * `format_code` - The format code string (e.g., "#,##0.00", "yyyy-mm-dd")
    ///
    /// # Returns
    /// The number format ID (>= 164 for custom formats)
    pub fn add_num_fmt(&mut self, format_code: &str) -> u32 {
        // Check for duplicate
        for fmt in &self.num_fmts {
            if fmt.format_code == format_code {
                return fmt.id;
            }
        }

        // Add new format
        let id = self.next_num_fmt_id;
        self.num_fmts.push(NumberFormatDef {
            id,
            format_code: format_code.to_string(),
        });
        self.next_num_fmt_id += 1;
        id
    }

    /// Add a font definition, returns the font ID
    ///
    /// Fonts are deduplicated - if an identical font exists, its ID is returned.
    ///
    /// # Arguments
    /// * `font` - The font definition
    ///
    /// # Returns
    /// The font ID (index into fonts array)
    pub fn add_font(&mut self, font: FontDef) -> u32 {
        // Check for duplicate
        for (i, existing) in self.fonts.iter().enumerate() {
            if existing.semantically_eq(&font) {
                return i as u32;
            }
        }

        // Add new font
        let id = self.fonts.len() as u32;
        self.fonts.push(font);
        id
    }

    /// Add a fill definition, returns the fill ID
    ///
    /// Fills are deduplicated - if an identical fill exists, its ID is returned.
    ///
    /// # Arguments
    /// * `fill` - The fill definition
    ///
    /// # Returns
    /// The fill ID (index into fills array)
    pub fn add_fill(&mut self, fill: FillDef) -> u32 {
        // Check for duplicate
        for (i, existing) in self.fills.iter().enumerate() {
            if existing.semantically_eq(&fill) {
                return i as u32;
            }
        }

        // Add new fill
        let id = self.fills.len() as u32;
        self.fills.push(fill);
        id
    }

    /// Add a border definition, returns the border ID
    ///
    /// Borders are deduplicated - if an identical border exists, its ID is returned.
    ///
    /// # Arguments
    /// * `border` - The border definition
    ///
    /// # Returns
    /// The border ID (index into borders array)
    pub fn add_border(&mut self, border: BorderDef) -> u32 {
        // Check for duplicate using semantic equality (treats Some(empty-side) == None)
        for (i, existing) in self.borders.iter().enumerate() {
            if existing.semantically_eq(&border) {
                return i as u32;
            }
        }

        // Add new border
        let id = self.borders.len() as u32;
        self.borders.push(border);
        id
    }

    /// Add a cell XF (style combination), returns the style index
    ///
    /// Cell XFs are NOT deduplicated - each call adds a new entry.
    ///
    /// # Arguments
    /// * `xf` - The cell XF definition
    ///
    /// # Returns
    /// The style index (for use in cell's `s` attribute)
    pub fn add_cell_xf(&mut self, xf: CellXfDef) -> u32 {
        let id = self.cell_xfs.len() as u32;
        self.cell_xfs.push(xf);
        id
    }

    /// Create a complete style from individual components
    ///
    /// This is a convenience method that:
    /// 1. Adds the font (if provided)
    /// 2. Adds the fill (if provided)
    /// 3. Adds the border (if provided)
    /// 4. Adds the number format (if provided)
    /// 5. Creates a cell XF combining them all
    ///
    /// # Arguments
    /// * `font` - Optional font definition
    /// * `fill` - Optional fill definition
    /// * `border` - Optional border definition
    /// * `num_fmt` - Optional number format code
    /// * `alignment` - Optional alignment definition
    ///
    /// # Returns
    /// The style index (for use in cell's `s` attribute)
    pub fn create_style(
        &mut self,
        font: Option<FontDef>,
        fill: Option<FillDef>,
        border: Option<BorderDef>,
        num_fmt: Option<&str>,
        alignment: Option<AlignmentDef>,
    ) -> u32 {
        let font_id = font.map(|f| self.add_font(f)).unwrap_or(0);
        let fill_id = fill.map(|f| self.add_fill(f)).unwrap_or(0);
        let border_id = border.map(|b| self.add_border(b)).unwrap_or(0);
        let num_fmt_id = num_fmt.map(|f| self.add_num_fmt(f)).unwrap_or(0);

        let xf = CellXfDef {
            num_fmt_id: Some(num_fmt_id),
            font_id: Some(font_id),
            fill_id: Some(fill_id),
            border_id: Some(border_id),
            xf_id: Some(0),
            alignment,
            protection: None,
            apply_number_format: if num_fmt.is_some() { Some(true) } else { None },
            apply_font: if font_id != 0 { Some(true) } else { None },
            apply_fill: if fill_id != 0 { Some(true) } else { None },
            apply_border: if border_id != 0 { Some(true) } else { None },
            apply_alignment: None, // Will be set based on alignment
            apply_protection: None,
            pivot_button: false,
            quote_prefix: false,
            ext_lst: None,
        };

        self.add_cell_xf(xf)
    }

    /// Generate the styles.xml content
    ///
    /// # Returns
    /// The XML content as bytes
    pub fn to_xml(&self) -> Vec<u8> {
        super::root::write_stylesheet(self)
    }
}
