use super::*;
use workbook_types::{
    ExternalA1Cell, ExternalAbsFlags, ExternalAddressKey, ExternalRefKey, LinkId,
};

fn external_key(link_raw: u128, row: u32, col: u32) -> ExternalRefKey {
    ExternalRefKey {
        link_id: LinkId::from_raw(link_raw),
        sheet: None,
        address: ExternalAddressKey::A1 {
            r#ref: ExternalA1Cell { row, col },
            abs: ExternalAbsFlags::default(),
        },
    }
}

#[test]
fn external_dependencies_are_indexed_separately_from_local_precedents() {
    let mut graph = DependencyGraph::new();
    let formula = CellId::from_raw(10);
    let local = CellId::from_raw(20);
    let key = external_key(1, 0, 0);

    graph.set_precedents(&formula, vec![DepTarget::Cell(local)]);
    graph.set_external_precedents(&formula, vec![key.clone()]);

    assert_eq!(graph.get_precedents(&formula), &[DepTarget::Cell(local)]);
    assert_eq!(
        graph.get_external_precedents(&formula),
        std::slice::from_ref(&key)
    );
    assert_eq!(
        graph
            .get_external_dependents(&key)
            .copied()
            .collect::<Vec<_>>(),
        vec![formula]
    );
}
