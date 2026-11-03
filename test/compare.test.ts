import assert from "node:assert/strict";
import test from "node:test";
import { compareStates } from "../src/compare.ts";
import type { LocalFile, RemoteFile, RemoteState } from "../src/types.ts";

function local(files: Record<string, string>): Map<string, LocalFile> {
  return new Map(
    Object.entries(files).map(([path, sha]) => [
      path,
      { path, sha, mtime: 0, size: 0 },
    ])
  );
}

function remoteFile(path: string, sha: string): RemoteFile {
  return { path, sha, size: 0, mode: "100644", type: "blob" };
}

function remote(
  tree: Record<string, string>,
  base: Record<string, string> = {}
): RemoteState {
  return {
    headSha: "head",
    treeSha: "tree",
    tree: new Map(
      Object.entries(tree).map(([path, sha]) => [path, remoteFile(path, sha)])
    ),
    baseTree: new Map(
      Object.entries(base).map(([path, sha]) => [path, remoteFile(path, sha)])
    ),
  };
}

test("remote only add -> pull", () => {
  const result = compareStates(local({}), remote({ "a.md": "r" }));
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.pull.map((p) => p.path), ["a.md"]);
  assert.equal(result.push.length, 0);
});

test("local only add -> push", () => {
  const result = compareStates(local({ "a.md": "l" }), remote({}));
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.pull.length, 0);
  assert.deepEqual(result.push.map((p) => p.path), ["a.md"]);
});

test("remote modified, local unchanged -> pull", () => {
  const result = compareStates(
    local({ "a.md": "b" }),
    remote({ "a.md": "r" }, { "a.md": "b" })
  );
  assert.deepEqual(result.pull.map((p) => p.path), ["a.md"]);
  assert.equal(result.push.length, 0);
});

test("local modified, remote unchanged -> push", () => {
  const result = compareStates(
    local({ "a.md": "l" }),
    remote({ "a.md": "b" }, { "a.md": "b" })
  );
  assert.deepEqual(result.push.map((p) => p.path), ["a.md"]);
  assert.equal(result.pull.length, 0);
});

test("both modified -> conflict", () => {
  const result = compareStates(
    local({ "a.md": "l" }),
    remote({ "a.md": "r" }, { "a.md": "b" })
  );
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.pull.length, 0);
  assert.equal(result.push.length, 0);
});

test("remote deleted, local unchanged -> pull delete", () => {
  const result = compareStates(
    local({ "a.md": "b" }),
    remote({}, { "a.md": "b" })
  );
  assert.deepEqual(result.pull, [{ path: "a.md" }]);
  assert.equal(result.conflicts.length, 0);
});

test("local deleted, remote unchanged -> push delete", () => {
  const result = compareStates(
    local({}),
    remote({ "a.md": "b" }, { "a.md": "b" })
  );
  assert.deepEqual(result.push, [{ path: "a.md" }]);
  assert.equal(result.conflicts.length, 0);
});

test("both deleted -> no action", () => {
  const result = compareStates(local({}), remote({}, { "a.md": "b" }));
  assert.equal(result.pull.length, 0);
  assert.equal(result.push.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test("first sync, same content -> no action", () => {
  const result = compareStates(local({ "a.md": "same" }), remote({ "a.md": "same" }));
  assert.equal(result.pull.length, 0);
  assert.equal(result.push.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test("first sync, different content -> conflict", () => {
  const result = compareStates(local({ "a.md": "l" }), remote({ "a.md": "r" }));
  assert.equal(result.conflicts.length, 1);
});

test("local deleted + remote modified -> conflict", () => {
  const result = compareStates(
    local({}),
    remote({ "a.md": "r" }, { "a.md": "b" })
  );
  assert.equal(result.conflicts.length, 1);
});

test("local modified + remote deleted -> conflict", () => {
  const result = compareStates(
    local({ "a.md": "l" }),
    remote({}, { "a.md": "b" })
  );
  assert.equal(result.conflicts.length, 1);
});

test("both made the same change -> no action", () => {
  const result = compareStates(
    local({ "a.md": "x" }),
    remote({ "a.md": "x" }, { "a.md": "b" })
  );
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.pull.length, 0);
  assert.equal(result.push.length, 0);
});
