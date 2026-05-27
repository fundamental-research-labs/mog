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

use super::types::*;
use crate::write::xml_writer::XmlWriter;

/// Spreadsheet ML namespace
const SPREADSHEET_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/// First ID for custom number formats (built-in formats use 0-163)
const CUSTOM_NUM_FMT_START_ID: u32 = 164;

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
    /// Tier 2: Captured namespace declarations for round-trip fidelity
    pub preserved_namespaces: Option<crate::roundtrip::namespaces::NamespaceMap>,
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
            preserved_namespaces: None,
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
        let mut w = XmlWriter::new();

        w.write_declaration();

        // Build mc:Ignorable from Tier 1 + Tier 2 prefixes (before opening element, so we can
        // emit xmlns:mc right after xmlns — matching Excel's namespace declaration ordering)
        use crate::write::mc_builder::McIgnorableBuilder;
        let mut mc_builder = McIgnorableBuilder::new();
        if self.known_fonts {
            mc_builder.add("x14ac");
        }
        if let Some(ref ns) = self.preserved_namespaces {
            mc_builder.add_from_namespace_map(ns);
        }

        // <styleSheet>
        w.start_element("styleSheet").attr("xmlns", SPREADSHEET_NS);

        // Build mc:Ignorable value and emit xmlns:mc + mc:Ignorable together
        let ignorable_value = mc_builder.build();
        let preserved_has_mc = self
            .preserved_namespaces
            .as_ref()
            .map_or(false, |ns| ns.has_prefix("mc"));

        // Determine if preserved_namespaces already covers x14ac (to avoid duplicate declaration)
        let preserved_has_x14ac = self
            .preserved_namespaces
            .as_ref()
            .map_or(false, |ns| ns.has_prefix("x14ac"));

        // In fresh-write mode (no preserved namespaces), emit xmlns:mc
        // mc:Ignorable is deferred to after all namespace declarations (matching Excel's ordering)
        if !mc_builder.is_empty() && !preserved_has_mc {
            w.attr(
                "xmlns:mc",
                "http://schemas.openxmlformats.org/markup-compatibility/2006",
            );
        }

        // Tier 1: Emit x14ac namespace for knownFonts
        // Only emit via Tier 1 if not already covered by preserved_namespaces
        if self.known_fonts && !preserved_has_x14ac {
            w.attr(
                "xmlns:x14ac",
                "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac",
            );
        }

        // Tier 2: Emit captured extension namespace declarations
        if let Some(ref ns) = self.preserved_namespaces {
            for decl in ns.all() {
                if let Some(ref prefix) = decl.prefix {
                    if prefix == "mc" {
                        // Emit xmlns:mc + mc:Ignorable at the preserved position
                        if !mc_builder.is_empty() {
                            w.attr(
                                "xmlns:mc",
                                "http://schemas.openxmlformats.org/markup-compatibility/2006",
                            );
                            if let Some(ref ignorable) = ignorable_value {
                                w.attr("mc:Ignorable", ignorable);
                            }
                        }
                        continue;
                    }
                    // Skip x14ac if emitted via Tier 1
                    if prefix == "x14ac" && self.known_fonts && !preserved_has_x14ac {
                        continue;
                    }
                    // Skip default namespace (already emitted as xmlns)
                    w.attr(&format!("xmlns:{}", prefix), &decl.uri);
                }
            }
        }

        // Emit mc:Ignorable at end only in fresh-write mode (no preserved namespaces).
        // In round-trip mode, mc:Ignorable was emitted inline with xmlns:mc above.
        if !preserved_has_mc {
            if let Some(ref ignorable) = ignorable_value {
                w.attr("mc:Ignorable", ignorable);
            }
        }

        w.end_attrs();

        // <numFmts>
        if !self.num_fmts.is_empty() {
            self.write_num_fmts(&mut w);
        }

        // <fonts>
        self.write_fonts(&mut w);

        // <fills>
        self.write_fills(&mut w);

        // <borders>
        self.write_borders(&mut w);

        // <cellStyleXfs>
        self.write_cell_style_xfs(&mut w);

        // <cellXfs>
        self.write_cell_xfs(&mut w);

        // <cellStyles> — always emit (Excel requires at least the "Normal" style)
        self.write_cell_styles(&mut w);

        // <dxfs> — always emit (Excel expects this element even when empty)
        self.write_dxfs(&mut w);

        // <tableStyles> — always emit (Excel expects this element even when empty)
        self.write_table_styles(&mut w);

        // <colors> (comes after tableStyles per OOXML spec order)
        if let Some(ref colors) = self.colors {
            if !colors.indexed_colors.is_empty() || !colors.mru_colors.is_empty() {
                self.write_colors(&mut w, colors);
            }
        }

        // <extLst> — opaque passthrough for round-trip fidelity
        if let Some(ref ext_lst) = self.ext_lst_raw {
            let raw = String::from_utf8_lossy(ext_lst);
            if !crate::infra::xml::raw_xml_contains_relationship_attr(&raw) {
                w.raw(ext_lst);
            }
        }

        w.end_element("styleSheet");

        w.finish()
    }

    // =========================================================================
    // Private XML writing helpers
    // =========================================================================

    fn write_num_fmts(&self, w: &mut XmlWriter) {
        w.start_element("numFmts")
            .attr_num("count", self.num_fmts.len())
            .end_attrs();

        for fmt in &self.num_fmts {
            w.start_element("numFmt")
                .attr_num("numFmtId", fmt.id)
                .attr("formatCode", &fmt.format_code)
                .self_close();
        }

        w.end_element("numFmts");
    }

    fn write_fonts(&self, w: &mut XmlWriter) {
        w.start_element("fonts").attr_num("count", self.fonts.len());

        if self.known_fonts {
            w.attr("x14ac:knownFonts", "1");
        }

        w.end_attrs();

        for font in &self.fonts {
            self.write_font(w, font);
        }

        w.end_element("fonts");
    }

    fn write_font(&self, w: &mut XmlWriter, font: &FontDef) {
        self.write_font_inner(w, font, false);
    }

    /// Write a font element. When `preserve_defaults` is true (used in DXFs),
    /// emit default-value elements like `<u val="none"/>` and `<vertAlign val="baseline"/>`
    /// because they represent explicit overrides of the base style.
    fn write_font_inner(&self, w: &mut XmlWriter, font: &FontDef, preserve_defaults: bool) {
        w.start_element("font").end_attrs();

        // Bold — emit when explicitly present in original (preserves round-trip fidelity)
        match font.bold {
            Some(true) => {
                w.start_element("b").self_close();
            }
            Some(false) => {
                w.start_element("b").attr("val", "0").self_close();
            }
            None => {}
        }

        // Italic — emit when explicitly present in original
        match font.italic {
            Some(true) => {
                w.start_element("i").self_close();
            }
            Some(false) => {
                w.start_element("i").attr("val", "0").self_close();
            }
            None => {}
        }

        // Strikethrough — emit when explicitly present in original
        match font.strikethrough {
            Some(true) => {
                w.start_element("strike").self_close();
            }
            Some(false) => {
                w.start_element("strike").attr("val", "0").self_close();
            }
            None => {}
        }

        // Condense (East Asian) — OOXML CT_Font order: condense before outline
        match font.condense {
            Some(true) => {
                w.start_element("condense").self_close();
            }
            Some(false) => {
                w.start_element("condense").attr("val", "0").self_close();
            }
            None => {}
        }

        // Extend (East Asian)
        match font.extend {
            Some(true) => {
                w.start_element("extend").self_close();
            }
            Some(false) => {
                w.start_element("extend").attr("val", "0").self_close();
            }
            None => {}
        }

        // Outline — OOXML CT_Font order: after condense/extend
        match font.outline {
            Some(true) => {
                w.start_element("outline").self_close();
            }
            Some(false) => {
                w.start_element("outline").attr("val", "0").self_close();
            }
            None => {}
        }

        // Shadow
        match font.shadow {
            Some(true) => {
                w.start_element("shadow").self_close();
            }
            Some(false) => {
                w.start_element("shadow").attr("val", "0").self_close();
            }
            None => {}
        }

        // Underline — in DXFs, emit even "none" as an explicit override
        if let Some(underline) = font.underline {
            if preserve_defaults || underline != UnderlineStyle::None {
                let elem = w.start_element("u");
                // "single" is the default — emit bare <u/> to match Excel's output
                if underline != UnderlineStyle::Single {
                    elem.attr("val", underline.to_ooxml());
                }
                elem.self_close();
            }
        }

        // Vertical alignment — in DXFs, emit even "baseline" as an explicit override
        if let Some(vert_align) = font.vert_align {
            if preserve_defaults || vert_align != VerticalAlignRun::Baseline {
                w.start_element("vertAlign")
                    .attr("val", vert_align.to_ooxml())
                    .self_close();
            }
        }

        // Size
        if let Some(size) = font.size {
            if size > 0.0 {
                w.start_element("sz").attr_num("val", size).self_close();
            }
        }

        // Color
        if let Some(ref color) = font.color {
            self.write_color(w, "color", color);
        }

        // Name
        if let Some(ref name) = font.name {
            if !name.is_empty() {
                w.start_element("name").attr("val", name).self_close();
            }
        }

        // Family
        if let Some(family) = font.family {
            w.start_element("family")
                .attr_num("val", family)
                .self_close();
        }

        // Charset
        if let Some(charset) = font.charset {
            w.start_element("charset")
                .attr_num("val", charset)
                .self_close();
        }

        // Scheme — always emit when present (including "none") to preserve round-trip fidelity
        if let Some(scheme) = font.scheme {
            w.start_element("scheme")
                .attr("val", scheme.to_ooxml())
                .self_close();
        }

        w.end_element("font");
    }

    fn write_color(&self, w: &mut XmlWriter, element_name: &str, color: &ColorDef) {
        w.start_element(element_name);

        match color {
            ColorDef::Indexed { id, tint } => {
                w.attr_num("indexed", *id);
                if let Some(t) = tint {
                    w.attr("tint", t);
                }
            }
            ColorDef::Rgb { val, tint } => {
                w.attr("rgb", val);
                if let Some(t) = tint {
                    w.attr("tint", t);
                }
            }
            ColorDef::Theme { id, tint } => {
                w.attr_num("theme", *id);
                if let Some(t) = tint {
                    w.attr("tint", t);
                }
            }
            ColorDef::Auto { tint } => {
                w.attr("auto", "1");
                if let Some(t) = tint {
                    w.attr("tint", t);
                }
            }
        }

        w.self_close();
    }

    fn write_fills(&self, w: &mut XmlWriter) {
        w.start_element("fills")
            .attr_num("count", self.fills.len())
            .end_attrs();

        for fill in &self.fills {
            self.write_fill(w, fill);
        }

        w.end_element("fills");
    }

    fn write_fill(&self, w: &mut XmlWriter, fill: &FillDef) {
        w.start_element("fill").end_attrs();

        match fill {
            FillDef::None => {
                w.start_element("patternFill")
                    .attr("patternType", "none")
                    .self_close();
            }
            FillDef::Solid { fg_color } => {
                w.start_element("patternFill")
                    .attr("patternType", "solid")
                    .end_attrs();
                self.write_color(w, "fgColor", fg_color);
                w.end_element("patternFill");
            }
            FillDef::Pattern {
                pattern_type,
                fg_color,
                bg_color,
            } => {
                let has_children = fg_color.is_some() || bg_color.is_some();
                // Emit patternType when explicitly present in original.
                // None = attribute was absent, Some(X) = attribute was present.
                w.start_element("patternFill");
                if let Some(pt) = pattern_type {
                    w.attr("patternType", pt.to_ooxml());
                }

                if has_children {
                    w.end_attrs();

                    if let Some(fg) = fg_color {
                        self.write_color(w, "fgColor", fg);
                    }
                    if let Some(bg) = bg_color {
                        self.write_color(w, "bgColor", bg);
                    }

                    w.end_element("patternFill");
                } else {
                    w.self_close();
                }
            }
            FillDef::Gradient {
                gradient_type,
                degree,
                stops,
                left,
                right,
                top,
                bottom,
            } => {
                w.start_element("gradientFill")
                    .attr("type", gradient_type.to_ooxml());

                if let Some(d) = degree {
                    w.attr_num("degree", *d);
                }
                if let Some(l) = left {
                    w.attr_num("left", *l);
                }
                if let Some(r) = right {
                    w.attr_num("right", *r);
                }
                if let Some(t) = top {
                    w.attr_num("top", *t);
                }
                if let Some(b) = bottom {
                    w.attr_num("bottom", *b);
                }

                w.end_attrs();

                for stop in stops {
                    w.start_element("stop")
                        .attr_num("position", stop.position)
                        .end_attrs();
                    self.write_color(w, "color", &stop.color);
                    w.end_element("stop");
                }

                w.end_element("gradientFill");
            }
        }

        w.end_element("fill");
    }

    fn write_borders(&self, w: &mut XmlWriter) {
        w.start_element("borders")
            .attr_num("count", self.borders.len())
            .end_attrs();

        for border in &self.borders {
            self.write_border(w, border);
        }

        w.end_element("borders");
    }

    fn write_border(&self, w: &mut XmlWriter, border: &BorderDef) {
        w.start_element("border");

        match border.diagonal_up {
            Some(true) => {
                w.attr("diagonalUp", "1");
            }
            Some(false) => {
                w.attr("diagonalUp", "0");
            }
            None => {}
        }
        match border.diagonal_down {
            Some(true) => {
                w.attr("diagonalDown", "1");
            }
            Some(false) => {
                w.attr("diagonalDown", "0");
            }
            None => {}
        }
        // Default is true per OOXML; omit when absent or true.
        if let Some(false) = border.outline {
            w.attr("outline", "0");
        }

        w.end_attrs();

        // Write each border side — only emit if present in the parsed data.
        // Omitting absent sides (rather than writing empty <top/>) matches Excel behavior
        // for borders that only define some sides.
        if border.left.is_some() {
            self.write_border_side(w, "left", &border.left);
        }
        if border.right.is_some() {
            self.write_border_side(w, "right", &border.right);
        }
        if border.top.is_some() {
            self.write_border_side(w, "top", &border.top);
        }
        if border.bottom.is_some() {
            self.write_border_side(w, "bottom", &border.bottom);
        }
        if border.diagonal.is_some() {
            self.write_border_side(w, "diagonal", &border.diagonal);
        }

        // BiDi borders
        if border.start.is_some() {
            self.write_border_side(w, "start", &border.start);
        }
        if border.end.is_some() {
            self.write_border_side(w, "end", &border.end);
        }

        // Table-style interior borders
        if border.vertical.is_some() {
            self.write_border_side(w, "vertical", &border.vertical);
        }
        if border.horizontal.is_some() {
            self.write_border_side(w, "horizontal", &border.horizontal);
        }

        w.end_element("border");
    }

    fn write_border_side(
        &self,
        w: &mut XmlWriter,
        element_name: &str,
        side: &Option<BorderSideDef>,
    ) {
        match side {
            Some(BorderSideDef { style, color })
                if *style != BorderStyle::None || color.is_some() =>
            {
                w.start_element(element_name);
                if *style != BorderStyle::None {
                    w.attr("style", style.to_ooxml());
                }
                w.end_attrs();

                if let Some(c) = color {
                    self.write_color(w, "color", c);
                }

                w.end_element(element_name);
            }
            _ => {
                // Empty border side
                w.start_element(element_name).self_close();
            }
        }
    }

    fn write_cell_style_xfs(&self, w: &mut XmlWriter) {
        w.start_element("cellStyleXfs")
            .attr_num("count", self.cell_style_xfs.len())
            .end_attrs();

        for xf in &self.cell_style_xfs {
            self.write_xf(w, xf, false);
        }

        w.end_element("cellStyleXfs");
    }

    fn write_cell_xfs(&self, w: &mut XmlWriter) {
        w.start_element("cellXfs")
            .attr_num("count", self.cell_xfs.len())
            .end_attrs();

        for xf in &self.cell_xfs {
            self.write_xf(w, xf, true);
        }

        w.end_element("cellXfs");
    }

    fn write_xf(&self, w: &mut XmlWriter, xf: &CellXfDef, is_cell_xf: bool) {
        w.start_element("xf");
        if let Some(id) = xf.num_fmt_id {
            w.attr_num("numFmtId", id);
        }
        if let Some(id) = xf.font_id {
            w.attr_num("fontId", id);
        }
        if let Some(id) = xf.fill_id {
            w.attr_num("fillId", id);
        }
        if let Some(id) = xf.border_id {
            w.attr_num("borderId", id);
        }

        if is_cell_xf {
            if let Some(xf_id) = xf.xf_id {
                w.attr_num("xfId", xf_id);
            }
        }

        // ECMA-376 canonical attribute order after xfId:
        // quotePrefix, pivotButton, then apply* flags
        if xf.quote_prefix {
            w.attr("quotePrefix", "1");
        }
        if xf.pivot_button {
            w.attr("pivotButton", "1");
        }

        // Apply flags
        match xf.apply_number_format {
            Some(true) => {
                w.attr("applyNumberFormat", "1");
            }
            Some(false) => {
                w.attr("applyNumberFormat", "0");
            }
            None => {}
        }
        match xf.apply_font {
            Some(true) => {
                w.attr("applyFont", "1");
            }
            Some(false) => {
                w.attr("applyFont", "0");
            }
            None => {}
        }
        match xf.apply_fill {
            Some(true) => {
                w.attr("applyFill", "1");
            }
            Some(false) => {
                w.attr("applyFill", "0");
            }
            None => {}
        }
        match xf.apply_border {
            Some(true) => {
                w.attr("applyBorder", "1");
            }
            Some(false) => {
                w.attr("applyBorder", "0");
            }
            None => {}
        }
        match xf.apply_alignment {
            Some(true) => {
                w.attr("applyAlignment", "1");
            }
            Some(false) => {
                w.attr("applyAlignment", "0");
            }
            None => {} // Don't infer — preserve original absence
        }
        match xf.apply_protection {
            Some(true) => {
                w.attr("applyProtection", "1");
            }
            Some(false) => {
                w.attr("applyProtection", "0");
            }
            None => {} // Don't infer — preserve original absence
        }

        // Check if we need child elements
        let has_alignment = xf.alignment.is_some();
        let has_protection = xf.protection.is_some();
        let has_ext_lst = xf
            .ext_lst
            .as_ref()
            .and_then(|e| e.raw_xml.as_ref())
            .is_some();

        if has_alignment || has_protection || has_ext_lst {
            w.end_attrs();

            // <alignment>
            if let Some(ref align) = xf.alignment {
                self.write_alignment(w, align);
            }

            // <protection>
            if let Some(ref prot) = xf.protection {
                self.write_protection(w, prot);
            }

            // <extLst> — raw XML passthrough for round-trip fidelity
            if let Some(ref ext_lst) = xf.ext_lst {
                if let Some(ref raw) = ext_lst.raw_xml {
                    if !crate::infra::xml::raw_xml_contains_relationship_attr(raw) {
                        w.raw(raw.as_bytes());
                    }
                }
            }

            w.end_element("xf");
        } else {
            w.self_close();
        }
    }

    fn write_alignment(&self, w: &mut XmlWriter, align: &AlignmentDef) {
        self.write_alignment_inner(w, align, false);
    }

    fn write_alignment_inner(
        &self,
        w: &mut XmlWriter,
        align: &AlignmentDef,
        preserve_defaults: bool,
    ) {
        w.start_element("alignment");

        // OOXML CT_CellAlignment attribute order
        if let Some(h) = align.horizontal {
            w.attr("horizontal", h.to_ooxml());
        }
        if let Some(v) = align.vertical {
            w.attr("vertical", v.to_ooxml());
        }
        if let Some(rotation) = align.text_rotation {
            w.attr_num("textRotation", rotation);
        }
        match align.wrap_text {
            Some(true) => {
                w.attr("wrapText", "1");
            }
            Some(false) if preserve_defaults => {
                w.attr("wrapText", "0");
            }
            _ => {}
        }
        if let Some(indent) = align.indent {
            w.attr_num("indent", indent);
        }
        if let Some(relative_indent) = align.relative_indent {
            w.attr_num("relativeIndent", relative_indent);
        }
        match align.justify_last_line {
            Some(true) => {
                w.attr("justifyLastLine", "1");
            }
            Some(false) if preserve_defaults => {
                w.attr("justifyLastLine", "0");
            }
            _ => {}
        }
        match align.shrink_to_fit {
            Some(true) => {
                w.attr("shrinkToFit", "1");
            }
            Some(false) if preserve_defaults => {
                w.attr("shrinkToFit", "0");
            }
            _ => {}
        }
        if let Some(reading_order) = align.reading_order {
            w.attr_num("readingOrder", reading_order);
        }
        match align.auto_indent {
            Some(true) => {
                w.attr("autoIndent", "1");
            }
            Some(false) if preserve_defaults => {
                w.attr("autoIndent", "0");
            }
            _ => {}
        }

        w.self_close();
    }

    fn write_protection(&self, w: &mut XmlWriter, prot: &ProtectionDef) {
        w.start_element("protection");

        match prot.locked {
            Some(true) => {
                w.attr("locked", "1");
            }
            Some(false) => {
                w.attr("locked", "0");
            }
            None => {}
        }
        match prot.hidden {
            Some(true) => {
                w.attr("hidden", "1");
            }
            Some(false) => {
                w.attr("hidden", "0");
            }
            None => {}
        }

        w.self_close();
    }

    fn write_cell_styles(&self, w: &mut XmlWriter) {
        if self.cell_styles.is_empty() {
            // Emit default "Normal" cell style (builtinId 0 = Normal)
            w.start_element("cellStyles")
                .attr_num("count", 1u32)
                .end_attrs();

            w.start_element("cellStyle")
                .attr("name", "Normal")
                .attr_num("xfId", 0u32)
                .attr_num("builtinId", 0u32)
                .self_close();

            w.end_element("cellStyles");
            return;
        }

        w.start_element("cellStyles")
            .attr_num("count", self.cell_styles.len())
            .end_attrs();

        for cs in &self.cell_styles {
            w.start_element("cellStyle")
                .attr_xstring("name", cs.effective_name())
                .attr_num("xfId", cs.xf_id);

            if let Some(id) = cs.builtin_id {
                w.attr_num("builtinId", id);
            }
            if cs.effective_custom_builtin() {
                w.attr("customBuiltin", "1");
            }
            if let Some(level) = cs.i_level {
                w.attr_num("iLevel", level);
            }
            if cs.hidden == Some(true) {
                w.attr("hidden", "1");
            }
            if let Some(ref uid) = cs.xr_uid {
                w.attr("xr:uid", uid);
            }

            w.self_close();
        }

        w.end_element("cellStyles");
    }

    fn write_dxfs(&self, w: &mut XmlWriter) {
        w.start_element("dxfs").attr_num("count", self.dxfs.len());

        if self.dxfs.is_empty() {
            w.self_close();
            return;
        }

        w.end_attrs();

        for dxf in &self.dxfs {
            w.start_element("dxf").end_attrs();

            if let Some(ref font) = dxf.font {
                self.write_font_inner(w, font, true);
            }
            if let Some(ref num_fmt) = dxf.num_fmt {
                w.start_element("numFmt")
                    .attr_num("numFmtId", num_fmt.id)
                    .attr("formatCode", &num_fmt.format_code)
                    .self_close();
            }
            if let Some(ref fill) = dxf.fill {
                self.write_fill(w, fill);
            }
            // OOXML CT_Dxf order: alignment before border
            if let Some(ref align) = dxf.alignment {
                self.write_alignment_inner(w, align, true);
            }
            if let Some(ref border) = dxf.border {
                self.write_border(w, border);
            }
            if let Some(ref prot) = dxf.protection {
                self.write_protection(w, prot);
            }

            w.end_element("dxf");
        }

        w.end_element("dxfs");
    }

    fn write_colors(&self, w: &mut XmlWriter, colors: &ColorsDef) {
        w.start_element("colors").end_attrs();

        if !colors.indexed_colors.is_empty() {
            w.start_element("indexedColors").end_attrs();
            for rgb in &colors.indexed_colors {
                w.start_element("rgbColor").attr("rgb", rgb).self_close();
            }
            w.end_element("indexedColors");
        }

        if !colors.mru_colors.is_empty() {
            w.start_element("mruColors").end_attrs();
            for color in &colors.mru_colors {
                self.write_color(w, "color", color);
            }
            w.end_element("mruColors");
        }

        w.end_element("colors");
    }

    fn write_table_styles(&self, w: &mut XmlWriter) {
        w.start_element("tableStyles")
            .attr_num("count", self.table_styles.len());

        // Always emit default style names (Excel expects these)
        w.attr(
            "defaultTableStyle",
            self.default_table_style
                .as_deref()
                .unwrap_or("TableStyleMedium2"),
        );
        w.attr(
            "defaultPivotStyle",
            self.default_pivot_style
                .as_deref()
                .unwrap_or("PivotStyleLight16"),
        );

        if self.table_styles.is_empty() {
            w.self_close();
            return;
        }

        w.end_attrs();

        for ts in &self.table_styles {
            w.start_element("tableStyle").attr("name", &ts.name);

            match ts.pivot {
                Some(true) => {
                    w.attr("pivot", "1");
                }
                Some(false) => {
                    w.attr("pivot", "0");
                }
                None => {}
            }
            match ts.table {
                Some(false) => {
                    w.attr("table", "0");
                }
                Some(true) => {
                    w.attr("table", "1");
                }
                None => {}
            }
            if let Some(count) = ts.count {
                w.attr_num("count", count);
            }
            if let Some(ref uid) = ts.xr_uid {
                w.attr("xr9:uid", uid);
            }

            w.end_attrs();

            for el in &ts.elements {
                w.start_element("tableStyleElement")
                    .attr("type", el.style_type.to_ooxml());

                if let Some(dxf_id) = el.dxf_id {
                    w.attr_num("dxfId", dxf_id);
                }

                if let Some(size) = el.size {
                    w.attr_num("size", size);
                }

                w.self_close();
            }

            w.end_element("tableStyle");
        }

        w.end_element("tableStyles");
    }
}
