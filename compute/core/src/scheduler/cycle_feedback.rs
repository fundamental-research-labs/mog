use super::*;

impl ComputeCore {
    /// Build the cell list used by the iterative fixed-point solver.
    ///
    /// Include non-cycle formulas that bridge one circular component into
    /// another. Example: `F23 = E24` is not circular, but it is downstream of the
    /// period-1 cycle and a precedent of the period-2 cycle.
    pub(super) fn iteration_cells_for_cycles(
        &self,
        cycle_cells: &[CellId],
        cycle_cell_set: &FxHashSet<CellId>,
        downstream_candidates: &[CellId],
    ) -> Vec<CellId> {
        if downstream_candidates.is_empty() {
            return cycle_cells.to_vec();
        }

        let candidate_set: FxHashSet<CellId> = downstream_candidates.iter().copied().collect();
        let mut feedback_set = FxHashSet::default();
        let mut stack = Vec::new();

        for &cycle_cell in cycle_cells {
            for precedent in self.graph.get_precedent_cells(&cycle_cell) {
                if !cycle_cell_set.contains(precedent) && candidate_set.contains(precedent) {
                    stack.push(*precedent);
                }
            }
        }

        while let Some(cell_id) = stack.pop() {
            if !feedback_set.insert(cell_id) {
                continue;
            }
            for precedent in self.graph.get_precedent_cells(&cell_id) {
                if !cycle_cell_set.contains(precedent) && candidate_set.contains(precedent) {
                    stack.push(*precedent);
                }
            }
        }

        if feedback_set.is_empty() {
            return cycle_cells.to_vec();
        }

        let mut seen = FxHashSet::default();
        let mut iteration_cells = Vec::with_capacity(cycle_cells.len() + feedback_set.len());
        for &cell_id in cycle_cells {
            if seen.insert(cell_id) {
                iteration_cells.push(cell_id);
            }
        }
        for &cell_id in downstream_candidates {
            if feedback_set.contains(&cell_id) && seen.insert(cell_id) {
                iteration_cells.push(cell_id);
            }
        }
        iteration_cells
    }

    pub(super) fn replace_final_changes_for_cells(
        &self,
        mirror: &CellMirror,
        changed_cells: &mut Vec<CellChange>,
        cell_ids: &[CellId],
        skip_cells: &FxHashSet<CellId>,
    ) {
        let final_ids: FxHashSet<String> = cell_ids
            .iter()
            .filter(|cell_id| !skip_cells.contains(cell_id))
            .map(CellId::to_uuid_string)
            .collect();

        if final_ids.is_empty() {
            return;
        }

        changed_cells.retain(|change| !final_ids.contains(&change.cell_id));
        for &cell_id in cell_ids {
            if skip_cells.contains(&cell_id) {
                continue;
            }
            let final_value = mirror
                .get_cell_value(&cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            if let Some((_sid, change)) = self.make_cell_change(mirror, &cell_id, &final_value) {
                changed_cells.push(change);
            }
        }
    }
}
