//! Database functions: DAVERAGE, DCOUNT, DCOUNTA, DGET, DMAX, DMIN,
//! DPRODUCT, DSTDEV, DSTDEVP, DSUM, DVAR, DVARP

mod aggregate;
mod collect;
mod criteria;
mod functions;
mod model;
mod parse;

use self::functions::{
    FnDaverage, FnDcount, FnDcounta, FnDget, FnDmax, FnDmin, FnDproduct, FnDstdev, FnDstdevp,
    FnDsum, FnDvar, FnDvarp,
};
use crate::FunctionRegistry;

#[cfg(test)]
mod tests;

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnDsum));
    registry.register(Box::new(FnDaverage));
    registry.register(Box::new(FnDcount));
    registry.register(Box::new(FnDcounta));
    registry.register(Box::new(FnDget));
    registry.register(Box::new(FnDmax));
    registry.register(Box::new(FnDmin));
    registry.register(Box::new(FnDproduct));
    registry.register(Box::new(FnDstdev));
    registry.register(Box::new(FnDstdevp));
    registry.register(Box::new(FnDvar));
    registry.register(Box::new(FnDvarp));
}
