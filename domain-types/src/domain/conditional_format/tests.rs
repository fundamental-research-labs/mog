use super::*;
use ooxml_types::cond_format::{CfOperator, CfTimePeriod, CfvoType, IconSetType};
use ooxml_types::styles::{BorderStyle, UnderlineStyle};
use serde::{Deserialize, Serialize};

fn roundtrip_json<T>(val: &T)
where
    T: Serialize + for<'de> Deserialize<'de> + PartialEq + std::fmt::Debug,
{
    let json = serde_json::to_string(val).unwrap();
    let back: T = serde_json::from_str(&json).unwrap();
    assert_eq!(val, &back);
}

fn normalize_and_parse(json: serde_json::Value) -> CFRule {
    let mut v = json;
    normalize_cf_rule_input(&mut v);
    serde_json::from_value::<CFRule>(v).expect("normalized JSON must deserialize to CFRule")
}

mod normalization;
mod public_rule_set;
mod rule_api;
mod serde_roundtrip;
mod token_parsing;
mod wire_compat;
