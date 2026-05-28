#[path = "gated_codegen/support.rs"]
mod support;

pub use support::{
    AccessLevel, AccessTarget, CellAddr, CellRange, FakeDispatch, FakeEngine, PlainService,
    Principal, PrincipalPool, SheetAccessMatrix, SheetId, StubService, new_service,
};
pub use support::{compute_security, compute_wire, value_types};

#[path = "gated_codegen/descriptors.rs"]
mod descriptors;

bridge_delegate::delegate!(
    target = StubService,
    dispatch = dispatch,
    gated = true,
    skip_default_imports = true,
    crate::__bridge_descriptor_stub_gated,
);

macro_rules! __assert_reemitted_shape {
    (
        bridge_version = 1;
        group = stub;
        type_name = StubService;
        method read get_cell_value {
            params { [prim] sheet: $_s1:ty, [prim] addr: $_a1:ty, }
            return_type = u32;
            error_type = $_e1:path;
            fallible;
        }
        method read get_range {
            params { [prim] sheet: $_s2:ty, [prim] range: $_r2:ty, }
            return_type = Vec<u32>;
            error_type = $_e2:path;
            fallible;
        }
        method read get_viewport {
            params { [prim] sheet: $_s3:ty, [prim] bounds: u32, }
            return_type = Vec<u8>;
            error_type = $_e3:path;
            fallible;
        }
        method read list_sheets {
            params { }
            return_type = Vec<u32>;
            error_type = $_e4:path;
            fallible;
        }
        method read sheet_row_count {
            params { [prim] sheet: $_s_src:ty, }
            return_type = u32;
            error_type = $_esrc:path;
            fallible;
        }
        method write set_cell {
            params { [prim] sheet: $_s5:ty, [prim] addr: $_a5:ty, [prim] v: u32, }
            return_type = ();
            error_type = $_e5:path;
            fallible;
        }
        method write insert_rows {
            params { [prim] sheet: $_s6:ty, [prim] at: u32, [prim] n: u32, }
            return_type = ();
            error_type = $_e6:path;
            fallible;
        }
        method write add_policy {
            params { [prim] policy: u32, }
            return_type = u64;
            error_type = $_e7:path;
            fallible;
        }
    ) => {
        #[test]
        fn reemitted_descriptor_has_expected_shape() {}
    };
}

__bridge_descriptor_StubService_stub!(__assert_reemitted_shape);
