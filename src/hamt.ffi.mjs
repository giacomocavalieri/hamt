import { isEqual, Ok, Error } from "./gleam.mjs";

/**
 * An Hash Array Mapped Trie!
 *
 * This implementation is based on:
 * - The paper "Ideal Hash Tries" by Phil Bagwell
 *   https://lampwww.epfl.ch/papers/idealhashtrees.pdf
 * - The JS implementation of HAMT by Matt Bierner
 *   https://github.com/mattbierner/hamt/tree/master
 */

/** TYPE DEFINITIONS **********************************************************/

const COLLISION = 2;
const PACKED = 3;
const ARRAY = 4;
const EMPTY_NODE = null;

/**
 * @template K, V
 * @typedef {Object} Dict
 * @property {number} size
 * @property {Node<K, V>} root
 */

/**
 * @template K, V
 * @typedef {LeafNode<K, V> | CollisionNode<K, V> | PackedNode<K, V> | ArrayNode<K, V> | EMPTY_NODE} Node
 */

/**
 * A terminating node with just a single key-value pair.
 *
 * @template K, V
 * @typedef {Object} LeafNode
 * @property {number} hash
 * @property {K} key
 * @property {V} value
 */

/**
 * A terminating node where all values have a key that produces the same hash.
 *
 * @template K, V
 * @typedef {Object} CollisionNode
 * @property {COLLISION} type
 * @property {number} hash
 * @property {Array<[K, V]>} pairs
 */

/**
 * An intermediate node where we store a sparse set of children.
 * Why do we need this? Each intermediate node can hold 2^BUCKET_SIZE children.
 * If we were to create an array for each we would end up wasting a lot of
 * memory for mostly empty intermediate nodes!
 *
 * So in order to reduce memory usage we have this new kind of intermediate node
 * that uses a bitmap to pack its children. It works like this:
 *
 * ...
 *
 * @template K, V
 * @typedef {Object} PackedNode
 * @property {PACKED} type
 * @property {number} bitmap
 * @property {Array<Node<K, V>>} children
 */

/**
 * This is an intermediate node where we store the tree's children. Unlike a
 * `PackedNode` this node has enough children to warrant having the full
 * 2^BUCKET_SIZE array instead of trying to pack the children to save on wasted
 * space.
 *
 * So the way this works is we take the relevant fragment of the hash (of
 * FRAGMENT_SIZE bits) and use that number to see which path we should follow:
 *
 *     0101101010... <- the 32 bit hash
 *     ┬────
 *     ╰─ We take the 5 bit fragment we care about (based on the depth of the
 *        node we're currently in) and use that to index into the `children`
 *        array and pick the node to go down to.
 *        With this hash we would access `children[11]`!
 *
 * @template K, V
 * @typedef {Object} ArrayNode
 * @property {ARRAY} type
 * @property {number} size
 * @property {Array<Node<K, V>>} children
 */

/** BUILDERS ******************************************************************/

/**
 * @template K, V
 * @param {number} hash
 * @param {K} key
 * @param {V} value
 * @returns {LeafNode<K, V>}
 */
function leafNode(hash, key, value) {
  return {
    hash,
    key,
    value,
  };
}

/**
 * @template K, V
 * @param {number} hash
 * @param {Array<{key: K, value: V}>} pairs
 * @returns {CollisionNode<K, V>}
 */
function collisionNode(hash, pairs) {
  return {
    type: COLLISION,
    hash,
    pairs,
  };
}

/**
 * @template K, V
 * @param {number} bitmap
 * @param {Array<Node<K, V>>} children
 * @returns {PackedNode<K, V>}
 */
function packedNode(bitmap, children) {
  return {
    type: PACKED,
    bitmap,
    children,
  };
}

/**
 * @template K, V
 * @param {number} size
 * @param {Array<Node<K, V>>} children
 * @returns {ArrayNode<K, V>}
 */
function arrayNode(size, children) {
  return {
    type: ARRAY,
    size,
    children,
  };
}

/** BIT OPERATIONS ************************************************************/

const FRAGMENT_SIZE = 5;

const BUCKET_SIZE = Math.pow(2, FRAGMENT_SIZE);

/**
 * This is a mask of `FRAGMENT_SIZE` bits all set to 1.
 */
const MASK = BUCKET_SIZE - 1;

const MAX_CHILDREN_IN_PACKED_NODE = BUCKET_SIZE / 2;

const MIN_CHILDREN_IN_ARRAY_NODE = BUCKET_SIZE / 4;

/**
 * Hamming weight/population count on 32 bit integers.
 * This is the number of bits set to 1 in the given bitmap.
 *
 * @param {number} bitmap
 * @returns number
 */
function popCount(bitmap) {
  // This is pure magic, I have no idea how it works, I've just copied it from
  // the paper referenced at the top!
  //
  // Beware this only works on 32 bit integers!! It's totally fine for our
  // implementation as the bitmaps are always 32 bit integers.
  bitmap -= (bitmap >> 1) & 0x55555555;
  bitmap = (bitmap & 0x33333333) + ((bitmap >> 2) & 0x33333333);
  bitmap = (bitmap + (bitmap >> 4)) & 0x0f0f0f0f;
  bitmap += bitmap >> 8;
  bitmap += bitmap >> 16;
  return bitmap & 0x7f;
}

/**
 * Takes the last `FRAGMENT_SIZE` bits of the given hash after shifting it to
 * the right by the given `shift`.
 *
 * @param {number} shift
 * @param {number} hash
 * @returns {number}
 */
function hashFragment(shift, hash) {
  return (hash >>> shift) & MASK;
}

/**
 * Creates a mask that selects the index at the given position.
 * Least significant bit is at index 0.
 * For example `toMask(3) === 0b1000`, `toMask(4) === 0b10000`.
 *
 * @param {number} fragment
 * @returns number
 */
function toMask(fragment) {
  return 1 << fragment;
}

/** PUBLIC DICT API ***********************************************************/

export function empty() {
  return { root: EMPTY_NODE, size: 0 };
}

export function size(dict) {
  return dict.size;
}

/**
 * @template K, V
 * @param {Dict<K, V>} dict
 * @param {K} key
 * @param {V} value
 * @returns {Dict<K, V>}
 */
export function set(dict, key, value) {
  let new_size = dict.size;
  let new_root = alter(0, dict.root, key, getHash(key), (arg) => {
    if (arg === NO_VALUE) {
      new_size += 1;
    }
    return [INSERT, value];
  });

  return { root: new_root, size: new_size };
}

/**
 * @template K, V
 * @param {Dict<K, V>} dict
 * @param {K} key
 * @returns {Dict<K, V>}
 */
export function remove(dict, key) {
  let new_size = dict.size;
  const new_root = alter(0, dict.root, key, getHash(key), (arg) => {
    if (arg !== NO_VALUE) {
      new_size -= 1;
    }
    return REMOVE;
  });

  return { root: new_root, size: new_size };
}

export function to_string(tree) {
  let to_print = [[0, tree.root]];
  let pretty = "";

  while (to_print.length != 0) {
    let [nesting, node] = to_print.pop();
    let nested = (message) => {
      return " ".repeat(nesting) + message;
    };

    if (node === EMPTY_NODE) {
      continue;
    } else if (node.type === COLLISION) {
      pretty += nested("-leaf(" + node.pairs.length + ")");
    } else if (node.type === ARRAY) {
      pretty += nested("-array(" + node.size + ")");
      for (let child of node.children) {
        if (child !== undefined) {
          to_print.push([nesting + 2, child]);
        }
      }
    } else if (node.type === PACKED) {
      pretty += nested("-packed(" + node.children.length + ")");
      for (let child of node.children) {
        to_print.push([nesting + 2, child]);
      }
    } else {
      pretty += nested(`-leaf(k: ${node.key}, v: ${node.value})`);
    }

    pretty += "\n";
  }

  return pretty;
}

/**
 * @template K, V
 * @param {Dict<K, V>} dict
 * @param {K} key
 * @returns {boolean}
 */
export function hasKey(dict, key) {
  return find(dict.root, key) !== NOT_FOUND;
}

/**
 * @template K, V
 * @param {Dict<K, V>} dict
 * @param {K} key
 * @returns {any}
 */
export function get(dict, key) {
  let result = find(dict.root, key);
  return result === NOT_FOUND ? new Error() : new Ok(result.value);
}

/** INTERNAL IMPLEMENTATION ***************************************************/

const NO_VALUE = null;
const VALUE = null;

const INSERT = null;
const REMOVE = null;

/**
 * @template K, V
 * @param {Node<K, V>} node
 * @param {K} key
 * @param {number} keyHash
 * @param {(arg: NO_VALUE | [VALUE, V]) => [INSERT, V] | REMOVE} alterValue
 * @returns {Node<K, V>}
 */
function alter(shift, node, key, keyHash, alterValue) {
  // If we've reached an empty node then there's no value matching the key we
  // want to change. So we call the alter_value function passing it null, it
  // might still decide to create a new node we have to insert!
  if (node === EMPTY_NODE) {
    const op = alterValue(NO_VALUE);
    return op === REMOVE ? EMPTY_NODE : leafNode(keyHash, key, op[1]);
  } else if (node.type === COLLISION) {
    return alterCollisionNode(shift, node, keyHash, key, alterValue);
  } else if (node.type === ARRAY) {
    return alterArrayNode(shift, node, keyHash, key, alterValue);
  } else if (node.type === PACKED) {
    let newNode = alterPackedNode(shift, node, keyHash, key, alterValue);
    return newNode;
  } else {
    return alterLeafNode(shift, node, keyHash, key, alterValue);
  }
}

/**
 * @template K, V
 * @param {number} shift
 * @param {LeafNode<K, V>} node
 * @param {number} keyHash
 * @param {K} key
 * @param {(arg: NO_VALUE | [VALUE, V]) => [INSERT, V] | REMOVE} alterValue
 * @returns {Node<K, V>}
 */
function alterLeafNode(shift, node, keyHash, key, alterValue) {
  // If we've reached a leaf we can be in one of two cases:
  if (isEqual(key, node.key)) {
    // - If the key matches, that means we have to update the value of the node,
    //   remember though that if the `alter_value` might decide to remove the
    //   node alltogether!
    const op = alterValue([VALUE, node.value]);
    return op === REMOVE ? EMPTY_NODE : leafNode(node.hash, node.key, op[1]);
  } else {
    // - If the keys don't match the key we're looking for is not in the trie,
    //   we still call the alter_value function because it might want to insert
    //   a node and in that case we'll have to merge the two leaves!
    const op = alterValue(NO_VALUE);
    return op === REMOVE ? node : mergeLeaves(shift, node.hash, node, keyHash, leafNode(keyHash, key, op[1]));
  }
}

/**
 * @template K, V
 * @param {number} shift
 * @param {CollisionNode<K, V>} node
 * @param {number} keyHash
 * @param {K} key
 * @param {(arg: NO_VALUE | [VALUE, V]) => [INSERT, V] | REMOVE} alterValue
 * @returns {Node<K, V>}
 */
function alterCollisionNode(shift, node, keyHash, key, alterValue) {
  if (keyHash !== node.hash) {
    // If the key hash is different then the key we're looking for certainly is
    // not in this collision node. We still run the `alterValue` function as it
    // might want us to insert a new value here!
    const op = alterValue(NO_VALUE);
    return op === REMOVE ? node : mergeLeaves(shift, node.hash, node, keyHash, leafNode(keyHash, key, op[1]));
  }

  // We look for a value with the given key in the pairs of the conflicting
  // node.
  let value = NO_VALUE;
  let valueIndex = null;
  for (let i = 0; i < node.pairs.length; i++) {
    let [conflictingKey, conflictingValue] = node.pairs[i];
    if (isEqual(key, conflictingKey)) {
      value = [VALUE, conflictingValue];
      valueIndex = i;
      break;
    }
  }

  // If there's no value with the given key we still want to run the
  // `alterValue` function as it might require us to add a new node!
  const op = alterValue(value);
  if (value === NO_VALUE) {
    return op === REMOVE ? node : mergeLeaves(shift, node.hash, node, keyHash, leafNode(keyHash, key, op[1]));
  } else {
    // If there's an element with the given key, then we have to update it
    // according to the `alterValue`'s function return:
    if (op === REMOVE) {
      const newPairs = node.pairs.toSpliced(valueIndex, 1);
      if (newPairs.length === 1) {
        let onlyChild = newPairs[0];
        return leafNode(node.hash, onlyChild[0], onlyChild[1]);
      } else {
        return collisionNode(node.hash, newPairs);
      }
    } else {
      const pair = { key, value: op[1] };
      return collisionNode(node.hash, cloneAndSet(node.pairs, valueIndex, pair));
    }
  }
}

/**
 * @template K, V
 * @param {number} shift
 * @param {PackedNode<K, V>} node
 * @param {number} keyHash
 * @param {K} key
 * @param {(arg: NO_VALUE | [VALUE, V]) => [INSERT, V] | REMOVE} alterValue
 * @returns {Node<K, V>}
 */
function alterPackedNode(shift, node, keyHash, key, alterValue) {
  const fragment = hashFragment(shift, keyHash);
  let mask = toMask(fragment);
  let childIndex = popCount(node.bitmap & (mask - 1));

  if ((node.bitmap & mask) !== 0) {
    // If there's a child at the given index we have to follow and alter it...
    const child = node.children[childIndex];
    const newChild = alter(shift + FRAGMENT_SIZE, child, key, keyHash, alterValue);

    // ...then, based on the change we can update this intermediate node.
    if (newChild === EMPTY_NODE) {
      // - If the child node was emptied we have to remove it from the map. If
      //   this was the last child of this intermediate node we have to remove
      //   it as well!
      if (node.bitmap === mask) {
        return EMPTY_NODE;
      } else {
        return packedNode(node.bitmap ^ mask, node.children.toSpliced(childIndex, 1));
      }
    } else if (newChild === child) {
      // - If the node was not updated we can return this node directly and not
      //   allocate a new one, this ensures maximum sharing!
      return node;
    } else {
      // - Otherwise we need to allocate a new intermediate node with the
      //   updated child.
      return packedNode(node.bitmap, cloneAndSet(node.children, childIndex, newChild));
    }
  } else {
    // If there's no child then we have to still run the `alterValue` function
    // as it might want us to add a new key value pair here.
    const op = alterValue(NO_VALUE);
    if (op === REMOVE) return node;

    // We have to add a new child to this node. In case we are over a given
    // threshold we will turn this node into an array node: instead of being
    // packed and indexed using a bitmap it will have an entire 32 element
    // array. This trades a bit of space but makes all the lookup operations
    // more efficient in return as we can directly index into the array and not
    // have to go through the bitmap first!
    if (node.children.length >= MAX_CHILDREN_IN_PACKED_NODE) {
      const children = new Array(32);
      children[fragment] = leafNode(keyHash, key, op[1]);
      let j = 0;
      let bitmap = node.bitmap;
      for (let i = 0; i < 32; i++) {
        if ((bitmap & 1) !== 0) {
          children[i] = node.children[j++];
        }
        bitmap = bitmap >>> 1;
      }
      return arrayNode(node.children.length + 1, children);
    } else {
      // If we still have space to add children to this packed node, then we
      // just do that.
      const newChild = leafNode(keyHash, key, op[1]);
      const newChildren = cloneAndInsert(node.children, childIndex, newChild);
      return packedNode(node.bitmap | mask, newChildren);
    }
  }
}

/**
 * @template K, V
 * @param {number} shift
 * @param {PackedNode<K, V>} node
 * @param {number} keyHash
 * @param {K} key
 * @param {(arg: NO_VALUE | [VALUE, V]) => [INSERT, V] | REMOVE} alterValue
 * @returns {Node<K, V>}
 */
function alterArrayNode(shift, node, keyHash, key, alterValue) {
  const childIndex = hashFragment(shift, keyHash);
  const child = node.children[childIndex];

  if (child === undefined) {
    // There's no node at the given index, if the alter function is telling us
    // to add a node then we can simply add it!
    const op = alterValue(NO_VALUE);
    if (op === REMOVE) {
      return node;
    } else {
      let newChild = leafNode(keyHash, key, op[1]);
      let newChildren = cloneAndSet(node.children, childIndex, newChild);
      return arrayNode(node.size + 1, newChildren);
    }
  } else {
    // There already is a node at the given index, so we have to alter it!
    let newChild = alter(shift + FRAGMENT_SIZE, child, key, keyHash, alterValue);
    if (newChild === child) {
      // If the node hasn't changed we just return the node as it is.
      return node;
    } else {
      if (newChild === EMPTY_NODE) {
        if (node.size === 1) {
          // The node was emptied!
          return EMPTY_NODE;
        } else {
          // The node lost a child!
          // TODO)) If under threshold it should go back to being a packed node!
          let newChildren = cloneAndSet(node.children, childIndex, undefined);
          return arrayNode(node.size, newChildren);
        }
      } else {
        let newChildren = cloneAndSet(node.children, childIndex, newChild);
        return arrayNode(node.size, newChildren);
      }

      todo;
    }
  }
}

function cloneAndSet(array, index, value) {
  const length = array.length;
  const newArray = new Array(length);
  for (let i = 0; i < length; i++) {
    newArray[i] = array[i];
  }
  newArray[index] = value;
  return newArray;
}

function cloneAndInsert(array, index, value) {
  const length = array.length;
  const newArray = new Array(length + 1);
  let i = 0;
  let g = 0;
  while (i < index) {
    newArray[g++] = array[i++];
  }
  newArray[g++] = value;
  while (i < length) {
    newArray[g++] = array[i++];
  }
  return newArray;
}

/**
 * @template K, V
 * @param {number} shift
 * @param {number} hash
 * @param {LeafNode<K, V> | CollisionNode<K, V>} node
 * @param {number} otherHash
 * @param {LeafNode<K, V> | CollisionNode<K, V>} other
 * @returns {Node<K, V>}
 */
function mergeLeaves(shift, hash, node, otherHash, other) {
  // If the leaves share the same hash then we've found a collision!
  // We need to merge the two leaves into a collision node.
  if (hash === otherHash) {
    if (node?.type === COLLISION && other?.type === COLLISION) {
      return collisionNode(hash, [...node.pairs, ...other.pairs]);
    } else if (other?.type === COLLISION) {
      return collisionNode(hash, [...other.pairs, { key: node.key, value: node.value }]);
    } else if (node?.type === COLLISION) {
      return collisionNode(hash, [...node.pairs, { key: other.key, value: other.value }]);
    } else {
      return collisionNode(hash, [
        { key: other.key, value: other.value },
        { key: node.key, value: node.value },
      ]);
    }
  } else {
    // Otherwise we need to create a series of intermediate nodes!
    return mergeLeavesLoop(shift, hash, node, otherHash, other);
  }
}

function mergeLeavesLoop(shift, hash, node, otherHash, otherNode) {
  // Otherwise we have to create a new intermediate packed node.
  // We take the fragments of the hashes and check:
  // - if they're different then both are going to be two children of this node
  // - otherwise we need to keep creating intermediate nodes until we've
  //   consumed all the shared prefix in hashes
  const fragment = hashFragment(shift, hash);
  const otherFragment = hashFragment(shift, otherHash);
  const bitmap = toMask(fragment) | toMask(otherFragment);

  if (fragment == otherFragment) {
    const child = mergeLeavesLoop(shift + FRAGMENT_SIZE, hash, node, otherHash, otherNode);
    return packedNode(bitmap, [child]);
  } else if (fragment < otherFragment) {
    return packedNode(bitmap, [node, otherNode]);
  } else {
    return packedNode(bitmap, [otherNode, node]);
  }
}

const NOT_FOUND = null;

/**
 * @template K, V
 * @param {Node<K, V>} node
 * @param {K} key
 * @returns {{ value: V } | NOT_FOUND}
 */
function find(node, key) {
  // Let's have a look at how lookups work. Let's quickly recall the shape of a
  // HAMT: we have leaf nodes (with a single value) and conflict nodes (with
  // multiple items) to hold key value pairs added to the trie.
  // Intermediate nodes can be packed or "regular" nodes telling us where to go
  // to find the key-value pair we care about. How do they do that? By looking
  // at the hash of the key! That is inspected in groups of `FRAGMENT_SIZE` bits
  // at a time to decide where a key-value pair should be stored.
  //
  // At each intermediate node of the tree (no matter if packed or not), we look
  // at the next `FRAGMENT_SIZE` bits of the key's hash starting from the least
  // significant bits and use that number to decide which path to follow:
  //
  // Let's have a look at an example: we have a 10 bit hash and look at
  // fragments of 5 bits. Starting from the root:
  //
  //                [•|•|...|•]       0111010100
  //                /  |      \            ───── we look at the first 5 bits and that is going to tell us which
  //               /   |       \                 path to follow. (For this high level overview we don't care _how_ we
  //              ┊    |        ┊                use the fragment to pick a child, but it will become clear later in
  //                   |                         the code!)
  //                   |
  //               [•|...|•]          0111010100
  //               /   |   \          ───── After getting to the selecond level (say we decided to go down the
  //              ┊    |    ┊               second path) we'll have to look at the next fragment of 5 bits.
  //                   |                    Once again that will tell us where to go...
  //                [(k, v)]                ...until we reach a leaf or an empty node!
  //

  // This is used to keep track how many bits of the key we've already looked at
  // moving down the tree.
  let shift = 0;
  const keyHash = getHash(key);

  while (true) {
    if (node === EMPTY_NODE) {
      // If we've reached an empty node without finding anything then we're done
      // and just return null.
      return NOT_FOUND;
    } else if (node.type === ARRAY) {
      // Array nodes are indexed by the hash fragment of `FRAGMENT_SIZE` bits
      // starting at the given offset. We use it know which branch we should go
      // down to.
      const fragment = hashFragment(shift, keyHash);
      node = node.children[fragment];
      if (node === undefined || node === EMPTY_NODE) {
        return NOT_FOUND;
      } else if (node.type === undefined && isEqual(key, node.key)) {
        return { value: node.value };
      } else {
        shift += FRAGMENT_SIZE;
      }
    } else if (node.type === PACKED) {
      // A node indexed by a bitmap: we have to move down the tree until we find
      // a leaf node. So how do we decide where to go based on the fragment of
      // the key hash?
      //
      // Since the node is packed we can't just use the fragment as an index
      // into the children array because it might have less than 32 items!
      // What we do instead is we use the fragment to _index into the bitmap._
      // A bit is set in the bitmap if it does have a child we can follow, then
      // the index where we can find that child is given by the number

      // If the bitmap has a set bit that means there's a child to go down to!
      // Otherwise, it means that the key we're looking for is certainly not
      // in the tree.
      // We take the bit at the index specified by the fragment.
      const mask = 1 << hashFragment(shift, keyHash);
      if ((node.bitmap & mask) === 0) {
        // If the bit is not set in the bitmap it means there's no key-value pair
        // for the key we're looking for, in that case we just return `null` as
        // there's no relevant child to go down to.
        return NOT_FOUND;
      }
      // Otherwise the index of the child is given by the number of bits that are
      // less significant than the indexed one and are set to 1.
      //
      // `mask - 1` is creating a bitmask of all 1s that is getting all the bits
      // to the right of the indexed one.
      const childIndex = popCount(node.bitmap & (mask - 1));
      node = node.children[childIndex];
      if (node === EMPTY_NODE) {
        return NOT_FOUND;
      } else if (node.type === undefined && isEqual(key, node.key)) {
        return { value: node.value };
      } else {
        shift += FRAGMENT_SIZE;
      }
    } else if (node.type === COLLISION) {
      // If we get to a collision node we first check that the hashes match: if
      // they do not, then we're sure the key cannot possibly be in the tree.
      // Otherwise we'll have to check all colliding pairs until we find one
      // with the key we're looking for.
      if (keyHash !== node.hash) return NOT_FOUND;
      for (let i = 0; i < node.pairs.length; i++) {
        const [conflictingKey, value] = node.pairs[i];
        if (isEqual(key, conflictingKey)) return { value };
      }
      return NOT_FOUND;
    } else {
      // If we're at a leaf node then we've found our possible value, it's a
      // match if the keys are the same.
      //
      // Notice how we actually have to compare the keys just once, when we get
      // to a leaf node. That's pretty neat as that might be an expensive
      // operation and most misses are detected early and rarely require a key
      // comparison.
      return isEqual(key, node.key) ? { value: node.value } : NOT_FOUND;
    }
  }
}

/** HASHING *******************************************************************/

const referenceMap = /* @__PURE__ */ new WeakMap();
const tempDataView = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(8));
let referenceUid = 0;

/**
 * Hash the object by reference using a weak map and incrementing uid.
 *
 * @param {any} object
 * @returns {number}
 */
function hashByReference(object) {
  const known = referenceMap.get(object);
  if (known !== undefined) {
    return known;
  }
  const hash = referenceUid++;
  if (referenceUid === 0x7fffffff) {
    referenceUid = 0;
  }
  referenceMap.set(object, hash);
  return hash;
}

/**
 * Merge two hashes in an order sensitive way.
 *
 * @param {number} one
 * @param {number} other
 * @returns {number}
 */
function hashMerge(one, other) {
  return (one ^ (other + 0x9e3779b9 + (one << 6) + (one >> 2))) | 0;
}

/**
 * Standard string hash popularised by Java.
 *
 * @param {string} string
 * @returns {number}
 */
function hashString(string) {
  let hash = 0;
  const len = string.length;
  for (let i = 0; i < len; i++) {
    hash = (Math.imul(31, hash) + string.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Hash a number by converting to two integers and doing some jumbling.
 *
 * @param {number} number
 * @returns {number}
 */
function hashNumber(number) {
  tempDataView.setFloat64(0, number);
  const i = tempDataView.getInt32(0);
  const j = tempDataView.getInt32(4);
  return Math.imul(0x45d9f3b, (i >> 16) ^ i) ^ j;
}

/**
 * Hash a BigInt by converting it to a string and hashing that.
 *
 * @param {BigInt} number
 * @returns {number}
 */
function hashBigInt(number) {
  return hashString(number.toString());
}

/**
 * Hash any js object.
 *
 * @param {any} object
 * @returns {number}
 */
function hashObject(object) {
  const proto = Object.getPrototypeOf(object);
  if (proto !== null && typeof proto.hashCode === "function") {
    try {
      const code = object.hashCode(object);
      if (typeof code === "number") {
        return code;
      }
    } catch {}
  }
  if (object instanceof Promise || object instanceof WeakSet || object instanceof WeakMap) {
    return hashByReference(object);
  }
  if (object instanceof Date) {
    return hashNumber(object.getTime());
  }

  let hash = 0;
  if (object instanceof ArrayBuffer) {
    object = new Uint8Array(object);
  }
  if (Array.isArray(object) || object instanceof Uint8Array) {
    for (let i = 0; i < object.length; i++) {
      hash = (Math.imul(31, hash) + getHash(object[i])) | 0;
    }
  } else if (object instanceof Set) {
    object.forEach((value) => {
      hash = (hash + getHash(value)) | 0;
    });
  } else if (object instanceof Map) {
    object.forEach((value, key) => {
      hash = (hash + hashMerge(getHash(value), getHash(key))) | 0;
    });
  } else {
    const keys = Object.keys(object);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = object[key];
      hash = (hash + hashMerge(getHash(value), hashString(key))) | 0;
    }
  }
  return hash;
}

/**
 * Hash any js value.
 *
 * @param {any} value
 * @returns {number}
 */
function getHash(value) {
  if (value === null) return 0x42108422;
  if (value === undefined) return 0x42108423;
  if (value === true) return 0x42108421;
  if (value === false) return 0x42108420;
  switch (typeof value) {
    case "number":
      return hashNumber(value);
    case "string":
      return hashString(value);
    case "bigint":
      return hashBigInt(value);
    case "object":
      return hashObject(value);
    case "symbol":
      return hashByReference(value);
    case "function":
      return hashByReference(value);
    default:
      return 0; // should be unreachable
  }
}
