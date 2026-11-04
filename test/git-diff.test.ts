import { it } from "node:test";
import assert from "node:assert/strict";
import { diffSequence, lineChanges } from "../src/shared/git-diff";

it("Git farkı ayrık ekleme, değişiklik ve silme aralıklarını korur", () => {
  assert.deepEqual(diffSequence(["a", "b", "c", "d", "e", "f"], ["a", "B", "c", "d", "new", "e"]), [
    { from: 1, to: 2, kind: "modified" }, { from: 4, to: 5, kind: "added" }, { from: 6, to: 6, kind: "deleted" },
  ]);
  assert.deepEqual(diffSequence(["a", "b", "c"], ["b", "c"]), [{ from: 0, to: 0, kind: "deleted" }]);
  assert.deepEqual(diffSequence(["a", "b", "c"], ["a", "c"]), [{ from: 1, to: 1, kind: "deleted" }]);
  assert.deepEqual(lineChanges("", "new"), [{ from: 0, to: 1, kind: "added" }]);
  assert.deepEqual(lineChanges("old", ""), [{ from: 0, to: 0, kind: "deleted" }]);
  assert.deepEqual(lineChanges("a\r\nb\r\n", "a\nb\n"), []);
  assert.deepEqual(lineChanges("", ""), []);
});
it("tekrarlanan satırlar ve büyük belgelerdeki tek değişiklik doğru işaretlenir", () => {
  assert.deepEqual(diffSequence(["same", "one", "same", "two", "same"], ["same", "changed", "same", "two", "same"]), [{ from: 1, to: 2, kind: "modified" }]);
  const large = Array.from({ length: 20000 }, (_, i) => String(i)), edited = [...large]; edited[15000] = "changed";
  assert.deepEqual(diffSequence(large, edited), [{ from: 15000, to: 15001, kind: "modified" }]);
  const allNew = Array.from({ length: 2000 }, (_, i) => `different ${i}`);
  assert.deepEqual(diffSequence(large, allNew), [{ from: 0, to: 2000, kind: "modified" }, { from: 2000, to: 2000, kind: "deleted" }]);
});
