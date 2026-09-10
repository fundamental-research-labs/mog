use std::cell::Cell;

mod value_types {
    #[derive(Debug, PartialEq)]
    pub enum ComputeError {
        Eval { message: String },
    }
}

#[derive(Default)]
struct Engine {
    value: String,
    revision: Cell<u32>,
}

impl Engine {
    fn read(&self) -> String {
        self.value.clone()
    }

    fn write(&mut self, value: &str) -> Result<(), value_types::ComputeError> {
        if value.is_empty() {
            return Err(value_types::ComputeError::Eval {
                message: "empty".into(),
            });
        }
        self.value = value.into();
        Ok(())
    }

    fn clear(&mut self) {
        self.value.clear();
    }

    fn touch(&self) -> u32 {
        self.revision.set(self.revision.get() + 1);
        self.revision.get()
    }
}

#[derive(Default)]
struct Dispatch {
    engine: Engine,
    fail: bool,
}

impl Dispatch {
    fn query_engine<R>(
        &self,
        f: impl FnOnce(&Engine) -> R + Send + 'static,
    ) -> Result<R, &'static str> {
        if self.fail {
            return Err("offline");
        }
        Ok(f(&self.engine))
    }

    fn call_engine<R>(
        &mut self,
        f: impl FnOnce(&mut Engine) -> R + Send + 'static,
    ) -> Result<R, &'static str> {
        if self.fail {
            return Err("offline");
        }
        Ok(f(&mut self.engine))
    }
}

#[derive(Default)]
struct Service {
    dispatch: Dispatch,
}

macro_rules! descriptor {
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = dispatch;
            type_name = Engine;
            method read read {
                params {}
                return_type = String;
            }
            method write write {
                params { [str] value: &str, }
                return_type = ();
                error_type = value_types::ComputeError;
                fallible;
            }
            method structural clear {
                params {}
                return_type = ();
            }
            method session touch {
                params {}
                return_type = u32;
            }
        }
    };
}

bridge_delegate::delegate!(
    target = Service,
    dispatch = dispatch,
    skip_default_imports = true,
    descriptor,
);

#[test]
fn generated_methods_preserve_dispatch_and_receivers() {
    let mut service = Service::default();
    service.write(&String::from("hello")).unwrap();
    let shared = &service;
    assert_eq!(shared.read(), "hello");
    assert_eq!(shared.touch(), 1);
    assert_eq!(shared.touch(), 2);
    service.clear();
    assert_eq!(service.read(), "");
}

#[test]
fn generated_methods_preserve_engine_and_dispatch_errors() {
    let mut service = Service::default();
    assert_eq!(
        service.write(""),
        Err(value_types::ComputeError::Eval {
            message: "empty".into()
        })
    );
    service.dispatch.fail = true;
    assert_eq!(
        service.write("hello"),
        Err(value_types::ComputeError::Eval {
            message: "offline".into()
        })
    );
}
