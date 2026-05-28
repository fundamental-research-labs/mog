//! Modern Text functions (Excel 365): TEXTBEFORE, TEXTAFTER, TEXTSPLIT

mod args;
mod before_after;
mod delimiter;
mod split;

use crate::FunctionRegistry;

use self::before_after::{FnTextAfter, FnTextBefore};
use self::split::FnTextSplit;

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnTextBefore));
    registry.register(Box::new(FnTextAfter));
    registry.register(Box::new(FnTextSplit));
}

#[cfg(test)]
mod tests;
