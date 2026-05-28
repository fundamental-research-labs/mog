use workbook_types::{ExternalCellRef, ExternalDepTarget, ExternalNameRef, ExternalRangeRef};

use super::deps::{DepEdge, DepEdges};
use super::lookup::{RefStyle, WorkbookLookup};

pub(super) fn display_body(_l: &dyn WorkbookLookup, _style: RefStyle, out: &mut String) {
    out.push_str("#REF!");
}

pub(super) fn cell_dep_edges(r: &ExternalCellRef, out: &mut DepEdges) {
    out.edges
        .push(DepEdge::External(ExternalDepTarget::Cell(r.clone())));
}

pub(super) fn range_dep_edges(r: &ExternalRangeRef, out: &mut DepEdges) {
    out.edges
        .push(DepEdge::External(ExternalDepTarget::Range(r.clone())));
}

pub(super) fn name_dep_edges(r: &ExternalNameRef, out: &mut DepEdges) {
    out.edges
        .push(DepEdge::External(ExternalDepTarget::Name(r.clone())));
}
