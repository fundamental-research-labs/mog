use crate::domain::styles::write::StylesWriter;
use domain_types::ParseOutput;

use super::styles::{build_styles, output_references_style_ids};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CellStyleSource {
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
            CellStyleSource::Palette { count } => {
                (current_style_id < count).then_some(current_style_id)
            }
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
    let palette = if output_references_style_ids(output) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn palette_style_ids_remap_after_default_xf() {
        let remapper = StyleExportRemapper::palette_projection(2);

        assert_eq!(remapper.emitted_cell_xf_id(0), Some(0));
        assert_eq!(remapper.emitted_cell_xf_id(1), Some(1));
        assert_eq!(remapper.emitted_cell_xf_id(2), None);
    }
}
