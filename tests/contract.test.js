import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent } from "../src/validator.js";
import { validateStream } from "../src/stream.js";

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));

test("样例符合领域约定", async () => {
  const sample = await load("sample.json");
  assert.deepEqual(validateEvent(sample), []);
});

test("样例事件流逐条符合领域约定", async () => {
  const { events } = await load("sample-stream.json");
  for (const event of events) {
    assert.deepEqual(validateEvent(event), [], event.event_id);
  }
});

test("样例事件流满足流程不变量", async () => {
  const { events } = await load("sample-stream.json");
  assert.deepEqual(validateStream(events), []);
});
