import gleam/dict
import gleam/list
import gleeunit
import hamt
import qcheck

pub fn main() -> Nil {
  gleeunit.main()
}

pub fn size_test() {
  assert 0 == hamt.size(hamt.new())
  assert 1 == hamt.size(from_list([#("a", 1)]))
  assert 2 == hamt.size(from_list([#(1, "a"), #(2, "b")]))
  assert 2 == hamt.size(from_list([#(1, "a"), #(2, "b"), #(2, "c")]))
  assert 3 == hamt.size(from_list([#(1, "a"), #(2, "b"), #(3, "c")]))
}

pub fn get_test() {
  let dict = from_list([#(1, "a"), #(2, "b"), #(3, "c")])
  assert Error(Nil) == hamt.get(dict, 0)
  assert Ok("a") == hamt.get(dict, 1)
  assert Ok("b") == hamt.get(dict, 2)
  assert Ok("c") == hamt.get(dict, 3)
  assert Error(Nil) == hamt.get(dict, 4)
  assert Error(Nil) == hamt.get(dict, 4)
}

// --- PROPERTIES --------------------------------------------------------------

pub fn hamt(
  keys: qcheck.Generator(k),
  values: qcheck.Generator(v),
) -> qcheck.Generator(hamt.Hamt(k, v)) {
  qcheck.generic_dict(keys, values, qcheck.bounded_int(0, 100))
  |> qcheck.map(from_dict)
}

pub fn insert_and_get_property_test() {
  let hamt = hamt(qcheck.uniform_int(), qcheck.uniform_int())
  use hamt <- qcheck.run(qcheck.default_config(), hamt)

  assert Ok(11)
    == hamt
    |> hamt.remove(1)
    |> hamt.insert(1, 11)
    |> hamt.get(1)
}

// --- HELPERS TO BUILD HAMTS --------------------------------------------------

fn from_list(list: List(#(k, v))) -> hamt.Hamt(k, v) {
  list.fold(list, hamt.new(), fn(hamt, item) {
    let #(key, value) = item
    hamt.insert(hamt, key, value)
  })
}

fn from_dict(dict: dict.Dict(k, v)) -> hamt.Hamt(k, v) {
  from_list(dict.to_list(dict))
}
