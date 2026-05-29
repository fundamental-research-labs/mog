use std::collections::{BTreeSet, HashMap};

use domain_types::Comment;

use super::ole_objects::OleObjectExport;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum FormControlShapeIdDisposition {
    PreservedCurrent,
    AllocatedMissing,
    RewrittenDuplicate,
    RewrittenConflict,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(super) struct FormControlExportDiagnostic {
    pub(super) control_name: Option<String>,
    pub(super) imported_shape_id: Option<u32>,
    pub(super) resolved_shape_id: u32,
    pub(super) disposition: FormControlShapeIdDisposition,
}

#[derive(Debug, Clone)]
pub(super) struct FormControlExportPlan {
    pub(super) controls: Vec<crate::domain::controls::types::FormControl>,
    pub(super) diagnostics: Vec<FormControlExportDiagnostic>,
}

pub(super) fn build_form_control_export_plan(
    controls: &[crate::domain::controls::types::FormControl],
    comments: &[Comment],
    ole_objects: &[OleObjectExport],
) -> FormControlExportPlan {
    let mut conflicting_shape_ids = comment_shape_ids(comments);
    conflicting_shape_ids.extend(
        ole_objects
            .iter()
            .map(|entry| entry.object.shape_id)
            .filter(|shape_id| *shape_id != 0),
    );

    let imported_counts = imported_shape_id_counts(controls);
    let mut reserved_shape_ids = conflicting_shape_ids.clone();
    reserved_shape_ids.extend(imported_counts.keys().copied());
    let mut assigned_shape_ids = BTreeSet::new();
    let mut next_allocated_shape_id = 1025;
    let mut planned_controls = Vec::with_capacity(controls.len());
    let mut diagnostics = Vec::new();

    for control in controls {
        let imported_shape_id = control.shape_id.filter(|shape_id| *shape_id != 0);
        let (resolved_shape_id, disposition) = match imported_shape_id {
            Some(shape_id)
                if imported_counts.get(&shape_id) == Some(&1)
                    && !conflicting_shape_ids.contains(&shape_id)
                    && !assigned_shape_ids.contains(&shape_id) =>
            {
                (shape_id, FormControlShapeIdDisposition::PreservedCurrent)
            }
            Some(shape_id) if imported_counts.get(&shape_id).copied().unwrap_or(0) > 1 => (
                allocate_shape_id(
                    &reserved_shape_ids,
                    &mut assigned_shape_ids,
                    &mut next_allocated_shape_id,
                ),
                FormControlShapeIdDisposition::RewrittenDuplicate,
            ),
            Some(_) => (
                allocate_shape_id(
                    &reserved_shape_ids,
                    &mut assigned_shape_ids,
                    &mut next_allocated_shape_id,
                ),
                FormControlShapeIdDisposition::RewrittenConflict,
            ),
            None => (
                allocate_shape_id(
                    &reserved_shape_ids,
                    &mut assigned_shape_ids,
                    &mut next_allocated_shape_id,
                ),
                FormControlShapeIdDisposition::AllocatedMissing,
            ),
        };

        let mut planned_control = control.clone();
        planned_control.shape_id = Some(resolved_shape_id);
        assigned_shape_ids.insert(resolved_shape_id);

        if disposition != FormControlShapeIdDisposition::PreservedCurrent {
            diagnostics.push(FormControlExportDiagnostic {
                control_name: planned_control.properties.name.clone(),
                imported_shape_id,
                resolved_shape_id,
                disposition,
            });
        }

        planned_controls.push(planned_control);
    }

    FormControlExportPlan {
        controls: planned_controls,
        diagnostics,
    }
}

fn imported_shape_id_counts(
    controls: &[crate::domain::controls::types::FormControl],
) -> HashMap<u32, usize> {
    let mut counts = HashMap::new();
    for shape_id in controls.iter().filter_map(|control| control.shape_id) {
        if shape_id != 0 {
            *counts.entry(shape_id).or_insert(0) += 1;
        }
    }
    counts
}

fn comment_shape_ids(comments: &[Comment]) -> BTreeSet<u32> {
    let mut shape_ids = BTreeSet::new();

    for (idx, comment) in comments
        .iter()
        .filter(|comment| comment.parent_id.is_none())
        .enumerate()
    {
        shape_ids.insert(1025 + idx as u32);
        if let Some(shape_id) = comment.shape_id.filter(|shape_id| *shape_id != 0) {
            shape_ids.insert(shape_id);
        }
    }

    shape_ids
}

fn allocate_shape_id(
    reserved_shape_ids: &BTreeSet<u32>,
    assigned_shape_ids: &mut BTreeSet<u32>,
    next_allocated_shape_id: &mut u32,
) -> u32 {
    while reserved_shape_ids.contains(next_allocated_shape_id)
        || assigned_shape_ids.contains(next_allocated_shape_id)
    {
        *next_allocated_shape_id += 1;
    }

    let shape_id = *next_allocated_shape_id;
    *next_allocated_shape_id += 1;
    shape_id
}
