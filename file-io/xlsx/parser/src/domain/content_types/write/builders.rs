use super::constants::*;
use super::manager::ContentTypesManager;

impl ContentTypesManager {
    /// Add the workbook override (`/xl/workbook.xml`).
    pub fn add_workbook(&mut self) -> &mut Self {
        self.add_override("/xl/workbook.xml", CT_WORKBOOK)
    }

    /// Add a worksheet override.
    ///
    /// # Arguments
    /// * `index` - The 1-based sheet index (sheet1, sheet2, etc.)
    pub fn add_worksheet(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/worksheets/sheet{}.xml", index);
        self.add_override(&path, CT_WORKSHEET)
    }

    /// Add the styles override (`/xl/styles.xml`).
    pub fn add_styles(&mut self) -> &mut Self {
        self.add_override("/xl/styles.xml", CT_STYLES)
    }

    /// Add the shared strings override (`/xl/sharedStrings.xml`).
    pub fn add_shared_strings(&mut self) -> &mut Self {
        self.add_override("/xl/sharedStrings.xml", CT_SHARED_STRINGS)
    }

    /// Add the theme override (`/xl/theme/theme1.xml`).
    pub fn add_theme(&mut self) -> &mut Self {
        self.add_override("/xl/theme/theme1.xml", CT_THEME)
    }

    /// Add a table override.
    ///
    /// # Arguments
    /// * `index` - The 1-based table index (table1, table2, etc.)
    pub fn add_table(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/tables/table{}.xml", index);
        self.add_override(&path, CT_TABLE)
    }

    /// Add a chart override.
    ///
    /// # Arguments
    /// * `index` - The 1-based chart index (chart1, chart2, etc.)
    pub fn add_chart(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/charts/chart{}.xml", index);
        self.add_override(&path, CT_CHART)
    }

    pub fn add_chart_ex(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/charts/chartEx{}.xml", index);
        self.add_override(&path, CT_CHART_EX)
    }

    /// Add a chart style override by explicit ZIP path.
    pub fn add_chart_style(&mut self, path: &str) -> &mut Self {
        let abs_path = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{}", path)
        };
        self.add_override(&abs_path, CT_CHART_STYLE)
    }

    /// Add a chart color style override by explicit ZIP path.
    pub fn add_chart_color_style(&mut self, path: &str) -> &mut Self {
        let abs_path = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{}", path)
        };
        self.add_override(&abs_path, CT_CHART_COLOR_STYLE)
    }

    /// Add a drawing override.
    ///
    /// # Arguments
    /// * `index` - The 1-based drawing index (drawing1, drawing2, etc.)
    pub fn add_drawing(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/drawings/drawing{}.xml", index);
        self.add_override(&path, CT_DRAWING)
    }

    /// Add a comments override for a specific sheet.
    ///
    /// # Arguments
    /// * `sheet_index` - The 1-based sheet index
    pub fn add_comments(&mut self, sheet_index: usize) -> &mut Self {
        let path = format!("/xl/comments{}.xml", sheet_index);
        self.add_override(&path, CT_COMMENTS)
    }

    /// Add a comments content type override with an explicit ZIP path.
    ///
    /// Used when the original file's comment numbering doesn't match the
    /// sequential sheet index (e.g. `comments6.xml` for sheet 7).
    pub fn add_comments_path(&mut self, zip_path: &str) -> &mut Self {
        let path = if zip_path.starts_with('/') {
            zip_path.to_string()
        } else {
            format!("/{}", zip_path)
        };
        self.add_override(&path, CT_COMMENTS)
    }

    /// Add core properties override (`/docProps/core.xml`).
    pub fn add_core_properties(&mut self) -> &mut Self {
        self.add_override("/docProps/core.xml", CT_CORE_PROPERTIES)
    }

    /// Add extended properties override (`/docProps/app.xml`).
    pub fn add_extended_properties(&mut self) -> &mut Self {
        self.add_override("/docProps/app.xml", CT_EXTENDED_PROPERTIES)
    }

    /// Add metadata override (`/xl/metadata.xml`).
    pub fn add_metadata(&mut self) -> &mut Self {
        self.add_override("/xl/metadata.xml", CT_METADATA)
    }

    /// Add calculation chain override (`/xl/calcChain.xml`).
    pub fn add_calc_chain(&mut self) -> &mut Self {
        self.add_override("/xl/calcChain.xml", CT_CALC_CHAIN)
    }

    /// Add custom properties override (`/docProps/custom.xml`).
    pub fn add_custom_properties(&mut self) -> &mut Self {
        self.add_override("/docProps/custom.xml", CT_CUSTOM_PROPERTIES)
    }

    /// Add docMetadata/LabelInfo.xml override (classification labels).
    pub fn add_doc_metadata_label_info(&mut self) -> &mut Self {
        self.add_override(
            "/docMetadata/LabelInfo.xml",
            "application/vnd.ms-office.classificationlabels+xml",
        )
    }

    /// Add a pivot table override.
    ///
    /// # Arguments
    /// * `index` - The 1-based pivot table index
    pub fn add_pivot_table(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/pivotTables/pivotTable{}.xml", index);
        self.add_override(&path, CT_PIVOT_TABLE)
    }

    /// Add a pivot cache definition override.
    ///
    /// # Arguments
    /// * `index` - The 1-based pivot cache index
    pub fn add_pivot_cache(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/pivotCache/pivotCacheDefinition{}.xml", index);
        self.add_override(&path, CT_PIVOT_CACHE)
    }

    /// Add a PNG image default.
    pub fn add_png_default(&mut self) -> &mut Self {
        self.add_default("png", CT_PNG)
    }

    /// Add a JPEG image default.
    pub fn add_jpeg_default(&mut self) -> &mut Self {
        self.add_default("jpeg", CT_JPEG);
        self.add_default("jpg", CT_JPEG)
    }

    /// Add a GIF image default.
    pub fn add_gif_default(&mut self) -> &mut Self {
        self.add_default("gif", CT_GIF)
    }

    /// Add VBA project default.
    pub fn add_vba_default(&mut self) -> &mut Self {
        self.add_default("bin", CT_VBA)
    }

    /// Add a slicer override.
    ///
    /// # Arguments
    /// * `index` - The 1-based slicer index (slicer1, slicer2, etc.)
    pub fn add_slicer(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/slicers/slicer{}.xml", index);
        self.add_override(&path, CT_SLICER)
    }

    /// Add a slicer cache override.
    ///
    /// # Arguments
    /// * `index` - The 1-based slicer cache index (slicerCache1, slicerCache2, etc.)
    pub fn add_slicer_cache(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/slicerCaches/slicerCache{}.xml", index);
        self.add_override(&path, CT_SLICER_CACHE)
    }

    /// Add a SmartArt diagram data override.
    ///
    /// # Arguments
    /// * `index` - The 1-based diagram data index (data1, data2, etc.)
    pub fn add_diagram_data(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/diagrams/data{}.xml", index);
        self.add_override(&path, CT_DIAGRAM_DATA)
    }

    /// Add a SmartArt diagram layout override.
    ///
    /// # Arguments
    /// * `index` - The 1-based diagram layout index (layout1, layout2, etc.)
    pub fn add_diagram_layout(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/diagrams/layout{}.xml", index);
        self.add_override(&path, CT_DIAGRAM_LAYOUT)
    }

    /// Add a SmartArt diagram colors override.
    ///
    /// # Arguments
    /// * `index` - The 1-based diagram colors index (colors1, colors2, etc.)
    pub fn add_diagram_colors(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/diagrams/colors{}.xml", index);
        self.add_override(&path, CT_DIAGRAM_COLORS)
    }

    /// Add a SmartArt diagram style override.
    ///
    /// # Arguments
    /// * `index` - The 1-based diagram style index (quickStyles1, quickStyles2, etc.)
    pub fn add_diagram_style(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/diagrams/quickStyles{}.xml", index);
        self.add_override(&path, CT_DIAGRAM_STYLE)
    }

    /// Add a SmartArt diagram drawing override (MS extension).
    ///
    /// # Arguments
    /// * `index` - The 1-based diagram drawing index (drawing1, drawing2, etc.)
    pub fn add_diagram_drawing(&mut self, index: usize) -> &mut Self {
        let path = format!("/xl/diagrams/drawing{}.xml", index);
        self.add_override(&path, CT_DIAGRAM_DRAWING)
    }
}
