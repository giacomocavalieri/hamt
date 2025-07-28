pub type Suite

@external(javascript, "./hamt_dev.ffi.mjs", "new_suite")
pub fn new() -> Suite

@external(javascript, "./hamt_dev.ffi.mjs", "add")
pub fn add(suite: Suite, name: String, runner: fn() -> a) -> Suite

@external(javascript, "./hamt_dev.ffi.mjs", "run")
pub fn run(suite: Suite) -> Nil
