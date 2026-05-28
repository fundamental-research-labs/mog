use domain_types::SheetData;

use crate::write::sheet::SheetWriter;

pub(super) fn apply_visible_row_hints_for_export(writer: &mut SheetWriter, sheet_data: &SheetData) {
    for row_dim in &sheet_data.dimensions.row_heights {
        if row_dim.explicit_hidden && !row_dim.hidden {
            writer.set_row_hidden(row_dim.row, false);
        }
    }
}
