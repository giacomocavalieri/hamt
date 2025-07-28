import { Suite, V8OptimizeOnNextCallPlugin } from "bench-node";

export function new_suite() {
  return new Suite({
    plugins: [new V8OptimizeOnNextCallPlugin()],
  });
}

export function add(suite, name, run) {
  suite.add(name, { minSamples: 30 }, run);
  return suite;
}

export function run(suite) {
  suite.run();
}
