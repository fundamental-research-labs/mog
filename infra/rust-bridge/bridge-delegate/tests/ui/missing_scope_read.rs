//! Gated `read` method without `scope = "..."` must fail to compile.

// Minimal stubs — just enough for the macro to parse through to its
// validation pass. The compile error fires before any of these are used.

pub struct StubService;

mod dispatch_stub {
    pub struct FakeDispatch;
    impl FakeDispatch {
        pub fn call_engine<T, F: FnOnce(&mut ()) -> T>(&self, _f: F) -> Result<T, ()> {
            unimplemented!()
        }
        pub fn query_engine<T, F: FnOnce(&()) -> T>(&self, _f: F) -> Result<T, ()> {
            unimplemented!()
        }
    }
}

pub type FakeEngine = ();
pub type SheetId = u32;
pub type CellAddr = u32;

#[macro_export]
macro_rules! __desc_missing_scope_read {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method read get_cell {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, }
                return_type = u32;
            }
        }
    };
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method read get_cell {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, }
                return_type = u32;
            }
        }
    };
}

bridge_delegate::delegate!(
    target = StubService,
    dispatch = dispatch,
    gated = true,
    skip_default_imports = true,
    crate::__desc_missing_scope_read,
);

fn main() {}
