#[derive(Clone)]
pub struct AsyncService {
    value: u32,
}

impl AsyncService {
    pub fn new() -> Self {
        Self { value: 7 }
    }

    pub async fn get(&self) -> u32 {
        self.value
    }
}

#[macro_export]
macro_rules! __bridge_descriptor_AsyncService_ops {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = ops;
            service = AsyncService;
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

bridge_tauri::generate!(crate::__bridge_descriptor_AsyncService_ops);

fn assert_send_sync<T: Send + Sync>() {}

fn assert_send_future<F: std::future::Future + Send>(future: F) -> F {
    future
}

fn main() {
    assert_send_sync::<AsyncServiceRegistry>();
    let registry = AsyncServiceRegistry::new();
    let _future = assert_send_future(async_service_get(
        tauri::State::new(&registry),
        "service".to_string(),
    ));
}
