pub type Hamt(k, v)

@external(javascript, "./hamt.ffi.mjs", "empty")
pub fn new() -> Hamt(k, v)

@external(javascript, "./hamt.ffi.mjs", "set")
pub fn insert(hamt: Hamt(k, v), key: k, value: v) -> Hamt(k, v)

@external(javascript, "./hamt.ffi.mjs", "get")
pub fn get(hamt: Hamt(k, v), key: k) -> Result(value, Nil)

@external(javascript, "./hamt.ffi.mjs", "remove")
pub fn remove(hamt: Hamt(k, v), key: k) -> Hamt(k, v)

@external(javascript, "./hamt.ffi.mjs", "size")
pub fn size(hamt: Hamt(k, v)) -> Int

@external(javascript, "./hamt.ffi.mjs", "to_string")
pub fn to_string(hamt: Hamt(k, v)) -> String
