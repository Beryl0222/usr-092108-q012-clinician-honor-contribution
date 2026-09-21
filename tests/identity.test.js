import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectState } from "../src/project.js";
import { resolveNomineeId, resolveInstitutionId, canonicalNominationId } from "../src/identity.js";

const { events } = JSON.parse(await readFile(new URL("../data/sample-stream.json", import.meta.url), "utf8"));
const state = projectState(events);

test("姓名异体与机构旧称归并到同一候选", () => {
  assert.equal(resolveNomineeId(state, { name: "王建國", institution_name: "仁济职工医院" }), "p-wang");
  assert.equal(resolveNomineeId(state, { name: "王见国" }), "p-wang");
  assert.equal(resolveNomineeId(state, { name: "李蘭" }), "p-li");
});

test("机构更名后可按任一历史名称解析", () => {
  assert.equal(resolveInstitutionId(state, "仁济职工医院"), "inst-01");
  assert.equal(resolveInstitutionId(state, "仁济医院"), "inst-01");
});

test("未知姓名或机构不强行归并", () => {
  assert.equal(resolveNomineeId(state, { name: "不存在的人" }), null);
  assert.equal(resolveNomineeId(state, { name: "王建国", institution_name: "不存在的医院" }), null);
});

test("重复推荐归并到同一候选的同一推荐", () => {
  assert.equal(canonicalNominationId(state, "n-dup"), "n-ind-wang");
  assert.equal(canonicalNominationId(state, "n-ind-wang"), "n-ind-wang");
});
