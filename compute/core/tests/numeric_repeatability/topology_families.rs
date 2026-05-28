use compute_core::storage::engine::YrsComputeEngine;

use crate::edit::{op_inverse_pair, sheet_id};
use crate::runner::{EDIT_DELTA, FamilyResult};
use crate::seeds::seeds;
use crate::topologies::{
    chain_snapshot, diamond_snapshot, fanin_snapshot, mmult_like_snapshot, sumproduct_snapshot,
};

#[test]
fn class_iii_chain() {
    let mut result = FamilyResult::new("chain");
    let sid = sheet_id();
    for seed in seeds() {
        let (snapshot, dependent) = chain_snapshot(seed.value);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed.value, EDIT_DELTA, dependent);
        result.record(format!("chain_{}", seed.slug), outcome);
    }
    result.report();
}

#[test]
fn class_iii_fanin() {
    let mut result = FamilyResult::new("fanin");
    let sid = sheet_id();
    for seed in seeds() {
        let (snapshot, dependent) = fanin_snapshot(seed.value);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed.value, EDIT_DELTA, dependent);
        result.record(format!("fanin_{}", seed.slug), outcome);
    }
    result.report();
}

#[test]
fn class_iii_diamond() {
    let mut result = FamilyResult::new("diamond");
    let sid = sheet_id();
    for seed in seeds() {
        let (snapshot, dependent) = diamond_snapshot(seed.value);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed.value, EDIT_DELTA, dependent);
        result.record(format!("diamond_{}", seed.slug), outcome);
    }
    result.report();
}

#[test]
fn class_iii_mmult() {
    let mut result = FamilyResult::new("mmult");
    let sid = sheet_id();
    let seed = 0.4_f64;
    let (snapshot, dependent) = mmult_like_snapshot(seed);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed, EDIT_DELTA, dependent);
    result.record("mmult_like_3x3_at_0_4".to_string(), outcome);
    result.report();
}

#[test]
fn class_iii_sumproduct() {
    let mut result = FamilyResult::new("sumproduct");
    let sid = sheet_id();
    for seed in seeds() {
        let (snapshot, dependent) = sumproduct_snapshot(seed.value);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed.value, EDIT_DELTA, dependent);
        result.record(format!("sumproduct_{}", seed.slug), outcome);
    }
    result.report();
}
