use std::collections::BTreeSet;

use crate::domain::drawings::write::{
    CellAnchor, ClientData, DrawingAnchor, DrawingObject, DrawingWriter, OneCellAnchor,
    TwoCellAnchor,
};

/// Convert workbook-level drawing features back into sheet drawing anchors.
///
/// Slicers and timelines are domain features, but their visible controls live in
/// the same `xdr:wsDr` anchor sequence as charts, pictures, and shapes.
pub fn build_feature_drawing_anchors(
    timeline_anchors: &[ooxml_types::timelines::TimelineAnchor],
    slicer_anchors: &[ooxml_types::slicers::SlicerAnchor],
) -> Vec<(Option<usize>, DrawingAnchor)> {
    let mut anchors = Vec::with_capacity(timeline_anchors.len() + slicer_anchors.len());

    for anchor in timeline_anchors {
        anchors.push((
            anchor.drawing.anchor_index,
            DrawingAnchor::OneCell(
                OneCellAnchor {
                    from: CellAnchor {
                        col: anchor.from.col,
                        col_off: anchor.from.col_off,
                        row: anchor.from.row,
                        row_off: anchor.from.row_off,
                    },
                    extent: anchor.extent.clone().unwrap_or_default(),
                    client_data: ClientData::default(),
                    mc_alternate_content: None,
                },
                DrawingObject::Timeline {
                    original_id: anchor.object_id,
                    name: anchor.timeline_name.clone(),
                    macro_name: anchor.macro_name.clone(),
                    nv_ext_lst: anchor.nv_ext_lst.clone(),
                },
            ),
        ));
    }

    for anchor in slicer_anchors {
        let object = DrawingObject::Slicer {
            original_id: anchor.object_id,
            name: anchor.slicer_name.clone(),
            r_id: String::new(),
            macro_name: anchor.macro_name.clone(),
            nv_ext_lst: anchor.nv_ext_lst.clone(),
        };

        let drawing_anchor =
            if anchor.anchor_mode == Some(ooxml_types::slicers::SlicerAnchorMode::OneCell) {
                DrawingAnchor::OneCell(
                    OneCellAnchor {
                        from: CellAnchor {
                            col: anchor.from.col,
                            col_off: anchor.from.col_off,
                            row: anchor.from.row,
                            row_off: anchor.from.row_off,
                        },
                        extent: anchor.extent.clone().unwrap_or_default(),
                        client_data: ClientData::default(),
                        mc_alternate_content: None,
                    },
                    object,
                )
            } else {
                DrawingAnchor::TwoCell(
                    TwoCellAnchor {
                        from: CellAnchor {
                            col: anchor.from.col,
                            col_off: anchor.from.col_off,
                            row: anchor.from.row,
                            row_off: anchor.from.row_off,
                        },
                        to: CellAnchor {
                            col: anchor.to.col,
                            col_off: anchor.to.col_off,
                            row: anchor.to.row,
                            row_off: anchor.to.row_off,
                        },
                        edit_as: None,
                        client_data: ClientData::default(),
                        mc_alternate_content: None,
                    },
                    object,
                )
            };
        anchors.push((anchor.drawing.anchor_index, drawing_anchor));
    }

    anchors
}

/// Add all sheet drawing anchors to the writer in domain layer order.
///
/// Indexed anchors use their imported/domain drawing ordinal. Unindexed anchors
/// fill the remaining free slots in their caller-provided order, matching the
/// existing chart/floating-object behavior.
pub fn add_ordered_anchors<I>(writer: &mut DrawingWriter, anchor_groups: I)
where
    I: IntoIterator<Item = Vec<(Option<usize>, DrawingAnchor)>>,
{
    let groups: Vec<Vec<(Option<usize>, DrawingAnchor)>> = anchor_groups.into_iter().collect();
    let total = groups.iter().map(Vec::len).sum();
    let mut occupied = BTreeSet::new();
    let mut unindexed_count = 0usize;

    for group in &groups {
        for (idx, _) in group {
            if let Some(i) = idx {
                occupied.insert(*i);
            } else {
                unindexed_count += 1;
            }
        }
    }

    let mut free_indices: Vec<usize> = (0..total).filter(|i| !occupied.contains(i)).collect();
    while free_indices.len() < unindexed_count {
        let next = free_indices.last().map_or(total, |&i| i + 1);
        free_indices.push(next);
    }

    let mut free_idx_iter = free_indices.into_iter();
    let mut all_anchors = Vec::with_capacity(total);
    for group in groups {
        for (idx, anchor) in group {
            let i = idx.unwrap_or_else(|| free_idx_iter.next().unwrap_or(usize::MAX));
            all_anchors.push((i, anchor));
        }
    }
    all_anchors.sort_by_key(|&(idx, _)| idx);

    for (_, anchor) in all_anchors {
        writer.add_anchor(anchor);
    }
}
