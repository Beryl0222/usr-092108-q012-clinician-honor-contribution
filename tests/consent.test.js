import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectState } from "../src/project.js";
import { consentStatus, isUseAuthorized, affectedByWithdrawal } from "../src/consent.js";

const { events } = JSON.parse(await readFile(new URL("../data/sample-stream.json", import.meta.url), "utf8"));
const state = projectState(events);

test("患者可分别撤回某种传播用途，其余用途保留", () => {
  assert.deepEqual(consentStatus(state, "story-s1"), {
    review: "granted",
    ceremony: "granted",
    long_term_publicity: "withdrawn",
  });
  assert.equal(isUseAuthorized(state, "story-s1", "ceremony"), true);
  assert.equal(isUseAuthorized(state, "story-s1", "long_term_publicity"), false);
});

test("撤回长期宣传后，仅该用途的公开版本需要下线", () => {
  const affected = affectedByWithdrawal(state, "story-s1", "long_term_publicity");
  assert.deepEqual(affected.map((x) => x.publication_id), ["pub-story"]);
  assert.deepEqual(affectedByWithdrawal(state, "story-s1", "ceremony"), []);
});
