use domain_types::yrs_schema::sparkline as yrs_sparkline;
use yrs::{Map, MapPrelim, MapRef, Out};

use super::{Sparkline, SparklineGroup};

pub(super) fn write_sparkline(
    parent: &MapRef,
    txn: &mut yrs::TransactionMut,
    key: &str,
    sparkline: &Sparkline,
) {
    let entries = yrs_sparkline::to_yrs_prelim(sparkline);
    let prelim: MapPrelim = entries.into_iter().collect();
    parent.insert(txn, key, prelim);
}

pub(super) fn read_sparkline_from_out<T: yrs::ReadTxn>(out: &Out, txn: &T) -> Option<Sparkline> {
    match out {
        Out::YMap(map) => yrs_sparkline::from_yrs_map(map, txn),
        _ => None,
    }
}

pub(super) fn write_group(
    parent: &MapRef,
    txn: &mut yrs::TransactionMut,
    key: &str,
    group: &SparklineGroup,
) {
    let entries = yrs_sparkline::group_to_yrs_prelim(group);
    let prelim: MapPrelim = entries.into_iter().collect();
    parent.insert(txn, key, prelim);
}

pub(super) fn read_group_from_out<T: yrs::ReadTxn>(out: &Out, txn: &T) -> Option<SparklineGroup> {
    match out {
        Out::YMap(map) => yrs_sparkline::group_from_yrs_map(map, txn),
        _ => None,
    }
}
