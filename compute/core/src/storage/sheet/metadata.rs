//! Typed worksheet metadata, independent of cell and axis storage.

use domain_types::domain::sheet::{PrintRange, PrintTitles, SplitViewConfig};
use domain_types::{SheetDimensions, SheetPaneConfig, SheetView, TrailingColRange};

#[derive(Debug, Clone)]
pub(crate) struct SheetMetadata {
    pub floating_objects: super::floating_objects::FloatingObjectState,
    pub sparklines: super::sparklines::SparklineState,
    pub pivots: std::collections::BTreeMap<String, domain_types::domain::pivot::PivotTableConfig>,
    pub column_schemas:
        rustc_hash::FxHashMap<cell_types::ColId, domain_types::domain::validation::ColumnSchema>,
    pub validations: super::schemas::ValidationState,
    pub conditional_formats: std::collections::BTreeMap<
        String,
        domain_types::domain::conditional_format::ConditionalFormat,
    >,
    pub data_bindings:
        std::collections::BTreeMap<String, crate::engine_types::bindings::SheetDataBinding>,
    pub comments: Vec<super::comments::StoredComment>,
    pub cell_annotations: rustc_hash::FxHashMap<
        cell_types::CellId,
        crate::engine_types::AnnotationRecord<cell_types::CellId>,
    >,
    pub legacy_comment_authors: Vec<String>,
    pub comment_package: Option<domain_types::SheetCommentPackageInfo>,
    pub drawing_package: Option<domain_types::SheetDrawingPackageInfo>,
    pub filters: std::collections::BTreeMap<String, domain_types::domain::filter::FilterState>,
    pub filter_bindings:
        std::collections::BTreeMap<String, domain_types::domain::filter::FilterMetadataBinding>,
    pub auto_filter: Option<domain_types::domain::filter::AutoFilter>,
    pub sort_state: Option<domain_types::domain::filter::SortState>,
    pub cell_properties:
        rustc_hash::FxHashMap<cell_types::CellId, crate::storage::properties::StoredCellProperties>,
    pub hyperlinks: Vec<super::hyperlinks::StoredHyperlink>,
    pub merges: Vec<super::merges::StoredMerge>,
    pub dimensions: super::dimensions::DimensionState,
    pub grouping: super::grouping::GroupingState,
    pub name: String,
    pub original_sheet_id: Option<u32>,
    pub uid: Option<String>,
    pub visibility: domain_types::SheetState,
    pub enable_calculation: bool,
    pub view: SheetViewState,
    pub extra_views: Vec<SheetView>,
    pub views_ext_lst_xml: Option<String>,
    pub split_config: Option<SplitViewConfig>,
    pub format: SheetFormatMetadata,
    pub properties: Option<ooxml_types::worksheet::SheetProperties>,
    pub protection: Option<domain_types::domain::protection::SheetProtection>,
    pub gridline_color: Option<String>,
    pub custom_properties: Option<String>,
    pub print_settings: Option<domain_types::domain::print::PrintSettings>,
    pub page_breaks: Option<domain_types::domain::print::PageBreaks>,
    pub hf_images: Vec<domain_types::domain::print::HeaderFooterImageInfo>,
    pub print_areas: Vec<PrintRange>,
    pub print_titles: PrintTitles,
    pub semantic_containers: domain_types::WorksheetSemanticContainers,
    pub root_namespaces: domain_types::XmlNamespaceDeclarations,
    pub ext_lst_xml: Option<String>,
    pub dimension_ref: Option<String>,
    pub calc_properties: Option<ooxml_types::worksheet::SheetCalcPr>,
}

impl Default for SheetMetadata {
    fn default() -> Self {
        Self {
            floating_objects: Default::default(),
            pivots: Default::default(),
            sparklines: Default::default(),
            comments: Vec::new(),
            cell_annotations: Default::default(),
            legacy_comment_authors: Vec::new(),
            comment_package: None,
            drawing_package: None,
            filters: Default::default(),
            filter_bindings: Default::default(),
            auto_filter: None,
            sort_state: None,
            column_schemas: Default::default(),
            validations: Default::default(),
            conditional_formats: Default::default(),
            data_bindings: Default::default(),
            cell_properties: Default::default(),
            hyperlinks: Vec::new(),
            merges: Vec::new(),
            dimensions: Default::default(),
            grouping: Default::default(),
            name: String::new(),
            original_sheet_id: None,
            uid: None,
            visibility: domain_types::SheetState::Visible,
            enable_calculation: true,
            view: SheetView::default().into(),
            extra_views: Vec::new(),
            views_ext_lst_xml: None,
            split_config: None,
            format: SheetFormatMetadata::default(),
            properties: None,
            protection: None,
            gridline_color: None,
            custom_properties: None,
            print_settings: None,
            page_breaks: None,
            hf_images: Vec::new(),
            print_areas: Vec::new(),
            print_titles: PrintTitles {
                repeat_rows: None,
                repeat_cols: None,
            },
            semantic_containers: Default::default(),
            root_namespaces: Default::default(),
            ext_lst_xml: None,
            dimension_ref: None,
            calc_properties: None,
        }
    }
}

/// Runtime has independent row/column headers; OOXML combines them on export.
#[derive(Debug, Clone)]
pub(crate) struct SheetViewState {
    pub show_gridlines: bool,
    pub show_row_headers: bool,
    pub show_column_headers: bool,
    pub show_zeros: bool,
    pub show_outline_symbols: bool,
    pub show_formulas: bool,
    pub right_to_left: bool,
    pub show_ruler: bool,
    pub show_white_space: bool,
    pub default_grid_color: bool,
    pub window_protection: bool,
    pub color_id: Option<u32>,
    pub zoom_scale: Option<u32>,
    pub zoom_scale_normal: Option<u32>,
    pub view: Option<String>,
    pub zoom_scale_page_layout_view: Option<u32>,
    pub zoom_scale_sheet_layout_view: Option<u32>,
    pub workbook_view_id: u32,
    pub scroll_row: u32,
    pub scroll_col: u32,
    pub has_explicit_top_left_cell: bool,
    pub tab_selected: bool,
    pub active_cell: Option<String>,
    pub sqref: Option<String>,
    pub pane: Option<SheetPaneConfig>,
    pub selections: Vec<ooxml_types::worksheet::Selection>,
    pub pivot_selection: Vec<ooxml_types::worksheet::PivotSelection>,
    pub ext_lst_xml: Option<String>,
}

impl From<SheetView> for SheetViewState {
    fn from(view: SheetView) -> Self {
        Self {
            show_gridlines: view.show_gridlines,
            show_row_headers: view.show_row_col_headers,
            show_column_headers: view.show_row_col_headers,
            show_zeros: view.show_zeros,
            show_outline_symbols: view.show_outline_symbols,
            show_formulas: view.show_formulas,
            right_to_left: view.right_to_left,
            show_ruler: view.show_ruler,
            show_white_space: view.show_white_space,
            default_grid_color: view.default_grid_color,
            window_protection: view.window_protection,
            color_id: view.color_id,
            zoom_scale: view.zoom_scale,
            zoom_scale_normal: view.zoom_scale_normal,
            view: view.view,
            zoom_scale_page_layout_view: view.zoom_scale_page_layout_view,
            zoom_scale_sheet_layout_view: view.zoom_scale_sheet_layout_view,
            workbook_view_id: view.workbook_view_id,
            scroll_row: view.scroll_row,
            scroll_col: view.scroll_col,
            has_explicit_top_left_cell: view.has_explicit_top_left_cell,
            tab_selected: view.tab_selected,
            active_cell: view.active_cell,
            sqref: view.sqref,
            pane: view.pane,
            selections: view.selections,
            pivot_selection: view.pivot_selection,
            ext_lst_xml: view.ext_lst_xml,
        }
    }
}

impl SheetViewState {
    pub fn to_domain(&self) -> SheetView {
        SheetView {
            show_gridlines: self.show_gridlines.clone(),
            show_row_col_headers: self.show_row_headers && self.show_column_headers,
            show_zeros: self.show_zeros.clone(),
            show_outline_symbols: self.show_outline_symbols.clone(),
            show_formulas: self.show_formulas.clone(),
            right_to_left: self.right_to_left.clone(),
            show_ruler: self.show_ruler.clone(),
            show_white_space: self.show_white_space.clone(),
            default_grid_color: self.default_grid_color.clone(),
            window_protection: self.window_protection.clone(),
            color_id: self.color_id.clone(),
            zoom_scale: self.zoom_scale.clone(),
            zoom_scale_normal: self.zoom_scale_normal.clone(),
            view: self.view.clone(),
            zoom_scale_page_layout_view: self.zoom_scale_page_layout_view.clone(),
            zoom_scale_sheet_layout_view: self.zoom_scale_sheet_layout_view.clone(),
            workbook_view_id: self.workbook_view_id.clone(),
            scroll_row: self.scroll_row.clone(),
            scroll_col: self.scroll_col.clone(),
            has_explicit_top_left_cell: self.has_explicit_top_left_cell.clone(),
            tab_selected: self.tab_selected.clone(),
            active_cell: self.active_cell.clone(),
            sqref: self.sqref.clone(),
            pane: self.pane.clone(),
            selections: self.selections.clone(),
            pivot_selection: self.pivot_selection.clone(),
            ext_lst_xml: self.ext_lst_xml.clone(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SheetFormatMetadata {
    pub default_row_height: Option<f64>,
    pub default_col_width: Option<f64>,
    pub default_row_descent: Option<f64>,
    pub base_col_width: Option<u32>,
    pub custom_height: bool,
    pub zero_height: bool,
    pub thick_top: bool,
    pub thick_bottom: bool,
    pub outline_level_row: Option<u8>,
    pub outline_level_col: Option<u8>,
    pub trailing_col_ranges: Vec<TrailingColRange>,
}

impl SheetFormatMetadata {
    /// The sheet's effective default column width in character units.
    ///
    /// `defaultColWidth` wins, then `baseColWidth`, then the workbook default.
    /// Every consumer of the sheet default must go through this; reading
    /// `default_col_width` directly drops `baseColWidth`-only sheets back to
    /// the workbook default and disagrees with the grid layout index.
    pub(crate) fn effective_default_col_width(&self) -> domain_types::units::CharWidth {
        domain_types::units::effective_default_column_width(
            self.default_col_width,
            self.base_col_width,
        )
        .width
    }
}

impl From<&SheetDimensions> for SheetFormatMetadata {
    fn from(dimensions: &SheetDimensions) -> Self {
        Self {
            default_row_height: dimensions.default_row_height.clone(),
            default_col_width: dimensions.default_col_width.clone(),
            default_row_descent: dimensions.default_row_descent.clone(),
            base_col_width: dimensions.base_col_width.clone(),
            custom_height: dimensions.custom_height.clone(),
            zero_height: dimensions.zero_height.clone(),
            thick_top: dimensions.thick_top.clone(),
            thick_bottom: dimensions.thick_bottom.clone(),
            outline_level_row: dimensions.outline_level_row.clone(),
            outline_level_col: dimensions.outline_level_col.clone(),
            trailing_col_ranges: dimensions.trailing_col_ranges.clone(),
        }
    }
}

impl SheetMetadata {
    pub fn from_import(
        sheet: &domain_types::SheetData,
        sheet_id: cell_types::SheetId,
        row_axis: &cell_types::AxisIdentityStore<cell_types::RowId>,
        col_axis: &cell_types::AxisIdentityStore<cell_types::ColId>,
        merges: Vec<super::merges::StoredMerge>,
        auto_filter: Option<domain_types::domain::filter::FilterState>,
    ) -> Self {
        let mut view: SheetViewState = sheet.view.clone().into();
        if view.pane.is_none()
            && let Some(frozen) = sheet.frozen_pane.as_ref()
        {
            if frozen.rows > 0 || frozen.cols > 0 {
                view.pane = Some(SheetPaneConfig {
                    state: domain_types::SheetPaneState::Frozen,
                    x_split: frozen.cols as f64, y_split: frozen.rows as f64,
                    top_left_cell: frozen.top_left_cell.as_ref()
                        .filter(|value| crate::import::parse_output_to_snapshot::view_lowering::classify_top_left_cell(value).is_some()).cloned(),
                    active_pane: None,
                });
            }
        }
        let config = domain_types::domain::grouping::outline_groups_to_grouping_config(
            &sheet.outline_groups,
            &sheet_id.to_uuid_string(),
            sheet.outline_properties.as_ref(),
        );
        let mut properties = sheet.sheet_properties.clone();
        if let Some(outline) = sheet.outline_properties.as_ref() {
            properties.get_or_insert_with(Default::default).outline_pr = Some(outline.clone());
        }
        Self {
            sparklines: super::sparklines::SparklineState::from_import(sheet_id, &sheet.sparklines, &sheet.sparkline_groups),
            legacy_comment_authors: sheet.legacy_comment_authors.clone(),
            comment_package: sheet.comment_package.clone(),
            drawing_package: sheet.drawing_package.clone(),
            filters: auto_filter.into_iter().map(|filter| (filter.id.clone(), filter)).collect(),
            auto_filter: sheet.auto_filter.clone(), sort_state: sheet.sort_state.clone(),
            validations: super::schemas::ValidationState::from_import(sheet),
            conditional_formats: super::cf_store::imported_formats(&sheet.conditional_formats, sheet_id),
            merges,
            dimensions: super::dimensions::DimensionState::from_import(sheet, |row| row_axis.identity_at(sheet_id, row), |col| col_axis.identity_at(sheet_id, col)),
            grouping: super::grouping::GroupingState::from_config(config),
            name: sheet.name.clone(), original_sheet_id: sheet.sheet_id, uid: sheet.uid.clone(),
            visibility: sheet.visibility.clone(), view, extra_views: sheet.extra_sheet_views.clone(),
            views_ext_lst_xml: sheet.sheet_views_ext_lst_xml.clone(), format: (&sheet.dimensions).into(),
            properties, protection: sheet.protection.clone(),
            print_settings: sheet.print_settings.clone(), page_breaks: sheet.page_breaks.clone(),
            hf_images: sheet.hf_images.clone(), semantic_containers: sheet.worksheet_semantic_containers.clone(),
            root_namespaces: sheet.worksheet_root_namespaces.clone(),
            ext_lst_xml: sheet.worksheet_ext_lst_xml.as_deref()
                .and_then(xlsx_parser::write::from_parse_output::strip_modeled_x14_data_validations_from_ext_lst)
                .filter(|xml| !xml.is_empty()),
            dimension_ref: sheet.worksheet_dimension_ref.clone(), calc_properties: sheet.sheet_calc_pr.clone(),
            ..Default::default()
        }
    }
}
