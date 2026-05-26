#[test]
fn registry_thread_safety_contracts() {
    let t = trybuild::TestCases::new();

    t.pass("tests/ui/send_sync_service_pass.rs");
    t.pass("tests/ui/async_clone_service_pass.rs");

    t.compile_fail("tests/ui/not_send_service_fail.rs");
    t.compile_fail("tests/ui/not_sync_service_fail.rs");
    t.compile_fail("tests/ui/async_not_clone_service_fail.rs");
    t.compile_fail("tests/ui/async_clone_not_send_service_fail.rs");
    t.compile_fail("tests/ui/async_clone_not_sync_service_fail.rs");
}
