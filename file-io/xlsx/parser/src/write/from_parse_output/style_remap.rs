use crate::domain::styles::types::CellXfDef;
use crate::domain::styles::write::StylesWriter;
use domain_types::{ParseOutput, WorkbookStylesheet};

use super::styles::{append_generated_cell_xf, build_styles, output_references_style_ids};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct StyleExportRemapper {
    emitted_cell_xf_ids: Vec<Option<u32>>,
}

impl StyleExportRemapper {
    #[must_use]
    pub(super) fn emitted_cell_xf_id(&self, current_style_id: u32) -> Option<u32> {
        self.emitted_cell_xf_ids
            .get(current_style_id as usize)
            .copied()
            .flatten()
    }

    #[cfg(test)]
    #[must_use]
    pub(super) fn palette_projection(count: u32) -> Self {
        Self {
            emitted_cell_xf_ids: (0..count).map(Some).collect(),
        }
    }
}

pub(super) struct StyleExportPlan {
    pub(super) writer: StylesWriter,
    pub(super) remapper: StyleExportRemapper,
}

#[must_use]
pub(super) fn build_style_export_plan(output: &ParseOutput) -> StyleExportPlan {
    let palette = if output_references_style_ids(output) {
        output.style_palette.as_slice()
    } else {
        &[]
    };

    let Some(stylesheet) = output.workbook_stylesheet.as_ref() else {
        return generated_style_export_plan(palette);
    };
    let stylesheet = stylesheet.normalized();
    if !can_replay_imported_styles(&stylesheet, palette) {
        return generated_style_export_plan(palette);
    }

    let mut writer = StylesWriter::from_workbook_stylesheet(&stylesheet);
    let emitted_cell_xf_ids = palette
        .iter()
        .enumerate()
        .map(|(index, format)| {
            let raw_is_current = stylesheet
                .cell_xf_lineage
                .get(index)
                .is_some_and(|imported| imported == format);
            if raw_is_current && raw_cell_xf_is_valid(&stylesheet, index) {
                Some(index as u32)
            } else {
                Some(append_generated_cell_xf(&mut writer, format))
            }
        })
        .collect();

    StyleExportPlan {
        writer,
        remapper: StyleExportRemapper {
            emitted_cell_xf_ids,
        },
    }
}

fn generated_style_export_plan(palette: &[domain_types::DocumentFormat]) -> StyleExportPlan {
    StyleExportPlan {
        writer: build_styles(palette),
        remapper: StyleExportRemapper {
            emitted_cell_xf_ids: (0..palette.len()).map(|index| Some(index as u32)).collect(),
        },
    }
}

fn can_replay_imported_styles(
    stylesheet: &WorkbookStylesheet,
    palette: &[domain_types::DocumentFormat],
) -> bool {
    !stylesheet.cell_xfs.is_empty()
        && stylesheet.cell_xf_lineage.len() == stylesheet.cell_xfs.len()
        && palette.len() >= stylesheet.cell_xf_lineage.len()
        // A changed Normal entry affects implicit style-0 cells and every raw
        // XF inheriting from cellStyleXfs[0]. Rebuild the table as a unit rather
        // than mixing it with stale imported bases.
        && palette.first() == stylesheet.cell_xf_lineage.first()
        && raw_cell_xf_is_valid(stylesheet, 0)
}

fn raw_cell_xf_is_valid(stylesheet: &WorkbookStylesheet, index: usize) -> bool {
    let Some(xf) = stylesheet.cell_xfs.get(index) else {
        return false;
    };
    component_references_are_valid(stylesheet, xf)
        && xf.xf_id.is_none_or(|base_id| {
            stylesheet
                .cell_style_xfs
                .get(base_id as usize)
                .is_some_and(|base| component_references_are_valid(stylesheet, base))
        })
}

fn component_references_are_valid(stylesheet: &WorkbookStylesheet, xf: &CellXfDef) -> bool {
    let number_format_is_valid = xf.num_fmt_id.unwrap_or(0) < 164
        || stylesheet
            .number_formats
            .iter()
            .any(|format| Some(format.id) == xf.num_fmt_id);
    number_format_is_valid
        && xf
            .font_id
            .unwrap_or(0)
            .try_into()
            .ok()
            .is_some_and(|id: usize| id < stylesheet.fonts.len())
        && xf
            .fill_id
            .unwrap_or(0)
            .try_into()
            .ok()
            .is_some_and(|id: usize| id < stylesheet.fills.len())
        && xf
            .border_id
            .unwrap_or(0)
            .try_into()
            .ok()
            .is_some_and(|id: usize| id < stylesheet.borders.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn palette_projection_preserves_direct_indices() {
        let remapper = StyleExportRemapper::palette_projection(2);

        assert_eq!(remapper.emitted_cell_xf_id(0), Some(0));
        assert_eq!(remapper.emitted_cell_xf_id(1), Some(1));
        assert_eq!(remapper.emitted_cell_xf_id(2), None);
    }
}
