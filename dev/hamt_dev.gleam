import gleam/dict
import gleam/list
import hamt
import suite

pub fn main() {
  let size = 100_000
  let big_hamt = create_hamt(list.range(1, size))
  let big_dict = create_dict(list.range(1, size))

  suite.new()
  |> suite.add("find_hamt", fn() { hamt.get(big_hamt, 10) })
  |> suite.add("find_dict", fn() { dict.get(big_dict, 10) })
  //|> suite.add("create_dict 10", fn() { create_dict(list.range(1, 10)) })
  //|> suite.add("create_hamt 10", fn() { create_hamt(list.range(1, 10)) })
  //|> suite.add("create_dict 100", fn() { create_dict(list.range(1, 100)) })
  //|> suite.add("create_hamt 100", fn() { create_hamt(list.range(1, 100)) })
  //|> suite.add("create_dict 1000", fn() { create_dict(list.range(1, 1000)) })
  //|> suite.add("create_hamt 1000", fn() { create_hamt(list.range(1, 1000)) })
  //|> suite.add("create_dict 10K", fn() { create_dict(list.range(1, 10_000)) })
  //|> suite.add("create_hamt 10K", fn() { create_hamt(list.range(1, 10_000)) })
  //|> suite.add("create_dict 100K", fn() { create_dict(list.range(1, 100_000)) })
  //|> suite.add("create_hamt 100K", fn() { create_hamt(list.range(1, 100_000)) })
  |> suite.run
}

fn create_dict(list: List(Int)) {
  list.fold(over: list, from: dict.new(), with: fn(dict, item) {
    dict.insert(dict, item, item)
  })
}

fn create_hamt(list: List(Int)) {
  list.fold(over: list, from: hamt.new(), with: fn(dict, item) {
    hamt.insert(dict, item, item)
  })
}
