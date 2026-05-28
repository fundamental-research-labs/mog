use super::*;

use crate::topo::{kahn_sort, tarjan_scc};

#[test]
fn test_tarjan_no_cycles() {
    // A -> B -> C (no cycles), all SCCs should be singletons
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![2]);
    adj.insert(2, vec![3]);
    let nodes: FxHashSet<u32> = [1, 2, 3].into_iter().collect();

    let sccs = tarjan_scc(&adj, &nodes);
    assert_eq!(sccs.len(), 3, "Three singleton SCCs expected");
    for scc in &sccs {
        assert_eq!(scc.len(), 1, "Each SCC should be a singleton");
    }
}

#[test]
fn test_tarjan_simple_2_cycle() {
    // A <-> B (cycle)
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![2]);
    adj.insert(2, vec![1]);
    let nodes: FxHashSet<u32> = [1, 2].into_iter().collect();

    let sccs = tarjan_scc(&adj, &nodes);
    // Should have exactly one SCC of size 2
    let big_sccs: Vec<_> = sccs.iter().filter(|s| s.len() >= 2).collect();
    assert_eq!(big_sccs.len(), 1, "One SCC of size 2");
    let scc_set: FxHashSet<u32> = big_sccs[0].iter().copied().collect();
    assert!(scc_set.contains(&1));
    assert!(scc_set.contains(&2));
}

#[test]
fn test_tarjan_self_loop() {
    // A -> A (self-loop)
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![1]);
    let nodes: FxHashSet<u32> = [1].into_iter().collect();

    let sccs = tarjan_scc(&adj, &nodes);
    assert_eq!(sccs.len(), 1);
    assert_eq!(sccs[0].len(), 1);
    assert_eq!(sccs[0][0], 1);
}

#[test]
fn test_tarjan_two_disjoint_cycles() {
    // A <-> B, C <-> D (two disjoint cycles)
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![2]);
    adj.insert(2, vec![1]);
    adj.insert(3, vec![4]);
    adj.insert(4, vec![3]);
    let nodes: FxHashSet<u32> = [1, 2, 3, 4].into_iter().collect();

    let sccs = tarjan_scc(&adj, &nodes);
    let big_sccs: Vec<_> = sccs.iter().filter(|s| s.len() >= 2).collect();
    assert_eq!(big_sccs.len(), 2, "Two disjoint SCCs");
}

#[test]
fn test_tarjan_chain_with_cycle() {
    // A <-> B (cycle), A -> C (downstream singleton)
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![2, 3]);
    adj.insert(2, vec![1]);
    let nodes: FxHashSet<u32> = [1, 2, 3].into_iter().collect();

    let sccs = tarjan_scc(&adj, &nodes);
    let big_sccs: Vec<_> = sccs.iter().filter(|s| s.len() >= 2).collect();
    assert_eq!(big_sccs.len(), 1, "One cycle SCC");
    let singletons: Vec<_> = sccs.iter().filter(|s| s.len() == 1).collect();
    assert!(!singletons.is_empty(), "At least one singleton (node 3)");
}

// ─────────────────────────────────────────────────────────────────
// Unit tests: kahn_sort
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_kahn_sort_basic() {
    // Resolved: {1, 2}. Downstream: 3 depends on 1 and 2.
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![3]);
    adj.insert(2, vec![3]);
    let nodes: FxHashSet<u32> = [1, 2, 3].into_iter().collect();
    let resolved: FxHashSet<u32> = [1, 2].into_iter().collect();

    let levels = kahn_sort(&adj, &nodes, &resolved);
    let all: Vec<u32> = levels.into_iter().flatten().collect();
    assert_eq!(all, vec![3]);
}

#[test]
fn test_kahn_sort_chain() {
    // Resolved: {1}. Downstream: 2 depends on 1, 3 depends on 2.
    let mut adj: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    adj.insert(1, vec![2]);
    adj.insert(2, vec![3]);
    let nodes: FxHashSet<u32> = [1, 2, 3].into_iter().collect();
    let resolved: FxHashSet<u32> = [1].into_iter().collect();

    let levels = kahn_sort(&adj, &nodes, &resolved);
    let all: Vec<u32> = levels.into_iter().flatten().collect();
    assert_eq!(all.len(), 2);
    let pos_2 = all.iter().position(|&x| x == 2).unwrap();
    let pos_3 = all.iter().position(|&x| x == 3).unwrap();
    assert!(pos_2 < pos_3, "2 should come before 3");
}
