use crate::domain::styles::write::{StyleRootNamespaces, StylesWriter};
use domain_types::{ParseOutput, WorkbookStylesheet};

use super::styles::build_styles;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CellStyleSource {
    WorkbookCellXfs { count: u32 },
    Palette { count: u32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct StyleExportRemapper {
    source: CellStyleSource,
}

impl StyleExportRemapper {
    #[must_use]
    pub(super) fn emitted_cell_xf_id(&self, current_style_id: u32) -> Option<u32> {
        match self.source {
            CellStyleSource::WorkbookCellXfs { count } => (current_style_id < count)
                .then_some(current_style_id),
            CellStyleSource::Palette { count } => (current_style_id < count)
                .then_some(current_style_id + 1),
        }
    }

    #[cfg(test)]
    #[must_use]
    pub(super) fn palette_projection(count: u32) -> Self {
        Self {
            source: CellStyleSource::Palette { count },
        }
    }
}

pub(super) struct StyleExportPlan {
    pub(super) writer: StylesWriter,
    pub(super) remapper: StyleExportRemapper,
}

#[must_use]
pub(super) fn build_style_export_plan(output: &ParseOutput) -> StyleExportPlan {
    if let Some(stylesheet) = current_workbook_stylesheet(output) {
        let cell_xfs_count = stylesheet.cell_xfs.len() as u32;
        return StyleExportPlan {
            writer: styles_writer_from_workbook_stylesheet(stylesheet),
            remapper: StyleExportRemapper {
                source: CellStyleSource::WorkbookCellXfs {
                    count: cell_xfs_count,
                },
            },
        };
    }

    let palette = if output_references_cell_style_ids(output) {
        output.style_palette.as_slice()
    } else {
        &[]
    };

    StyleExportPlan {
        writer: build_styles(palette),
        remapper: StyleExportRemapper {
            source: CellStyleSource::Palette {
                count: palette.len() as u32,
            },
        },
    }
}

fn current_workbook_stylesheet(output: &ParseOutput) -> Option<WorkbookStylesheet> {
    let stylesheet = output.workbook_stylesheet.as_ref()?.normalized();
    if stylesheet.cell_xfs.is_empty() || !output_references_cell_style_ids(output) {
        return None;
    }
    Some(stylesheet)
}

fn output_references_cell_style_ids(output: &ParseOutput) -> bool {
    output.sheets.iter().any(|sheet| {
        sheet.cells.iter().any(|cell| cell.style_id.is_some())
            || !sheet.authored_style_runs.is_empty()
            || !sheet.row_styles.is_empty()
            || !sheet.col_styles.is_empty()
            || sheet
                .dimensions
                .trailing_col_ranges
                .iter()
                .any(|range| range.style_id.is_some())
    })
}

fn styles_writer_from_workbook_stylesheet(stylesheet: WorkbookStylesheet) -> StylesWriter {
    let mut writer = StylesWriter::with_defaults();
    writer.num_fmts = stylesheet.number_formats;
    writer.fonts = stylesheet.fonts;
    writer.fills = stylesheet.fills;
    writer.borders = stylesheet.borders;
    writer.cell_style_xfs = stylesheet.cell_style_xfs;
    writer.cell_xfs = stylesheet.cell_xfs;
    writer.cell_styles = stylesheet.named_cell_styles;
    writer.dxfs = if stylesheet.differential_formats.is_empty() {
        stylesheet.dxf_registry.iter().map(|dxf| dxf.to_ooxml()).collect()
    } else {
        stylesheet.differential_formats
    };
    writer.colors = stylesheet.indexed_colors;
    writer.table_styles = stylesheet.table_styles;
    writer.default_table_style = stylesheet.default_table_style;
    writer.default_pivot_style = stylesheet.default_pivot_style;
    writer.known_fonts = stylesheet.known_fonts;
    writer.root_namespaces = StyleRootNamespaces::from_attrs(stylesheet.root_namespace_attrs);
    writer.ext_lst_raw = stylesheet.ext_lst_xml;

    if writer.fonts.is_empty()
        || writer.fills.is_empty()
        || writer.borders.is_empty()
        || writer.cell_style_xfs.is_empty()
        || writer.cell_xfs.is_empty()
    {
        let defaults = StylesWriter::with_defaults();
        if writer.fonts.is_empty() {
            writer.fonts = defaults.fonts;
        }
        if writer.fills.is_empty() {
            writer.fills = defaults.fills;
        }
        if writer.borders.is_empty() {
            writer.borders = defaults.borders;
        }
        if writer.cell_style_xfs.is_empty() {
            writer.cell_style_xfs = defaults.cell_style_xfs;
        }
        if writer.cell_xfs.is_empty() {
            writer.cell_xfs = defaults.cell_xfs;
        }
    }

    writer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn palette_style_ids_remap_after_default_xf() {
        let remapper = StyleExportRemapper::palette_projection(2);

        assert_eq!(remapper.emitted_cell_xf_id(0), Some(1));
        assert_eq!(remapper.emitted_cell_xf_id(1), Some(2));
        assert_eq!(remapper.emitted_cell_xf_id(2), None);
    }

    #[test]
    fn workbook_cell_xf_ids_are_already_current_style_ids() {
        let remapper = StyleExportRemapper {
            source: CellStyleSource::WorkbookCellXfs { count: 3 },
        };

        assert_eq!(remapper.emitted_cell_xf_id(0), Some(0));
        assert_eq!(remapper.emitted_cell_xf_id(2), Some(2));
        assert_eq!(remapper.emitted_cell_xf_id(3), None);
    }
}
