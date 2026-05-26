use std::cell::Cell;

#[derive(Clone)]
pub struct AsyncCloneNotSyncService {
    value: Cell<u8>,
}

impl AsyncCloneNotSyncService {
    pub fn new() -> Self {
        Self {
            value: Cell::new(7),
        }
    }

    pub async fn get(&self) -> u32 {
        self.value.get().into()
    }
}

#[macro_export]
macro_rules! __bridge_descriptor_AsyncCloneNotSyncService_ops {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = ops;
            service = AsyncCloneNotSyncService;
            key_type = str;
            key_param = "service_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params {}
                return_type = u32;
                async;
            }
        }
    };
}

bridge_tauri::generate!(crate::__bridge_descriptor_AsyncCloneNotSyncService_ops);

fn assert_send_sync<T: Send + Sync>() {}

fn assert_send_future<F: std::future::Future + Send>(future: F) -> F {
    future
}

fn state<T>() -> tauri::State<'static, T> {
    panic!("compile-only fixture")
}

fn main() {
    assert_send_sync::<AsyncCloneNotSyncServiceRegistry>();
    let _future = assert_send_future(async_clone_not_sync_service_get(
        state(),
        "service".to_string(),
    ));
}
