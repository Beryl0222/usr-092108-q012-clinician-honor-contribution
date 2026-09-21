import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectState } from "../src/project.js";
import { discloseForVerification } from "../src/disclosure.js";

const { events } = JSON.parse(await readFile(new URL("../data/sample-stream.json", import.meta.url), "utf8"));
const state = projectState(events);

test("主办方不接触完整病历也能验证关键事实", () => {
  const view = discloseForVerification(state, {
    verifier: "项目组委会资格组",
    profile_id: "p-wang",
    checks: ["credential", "participation"],
    contribution_id: "c-yuanqian",
  });
  assert.equal(view.checks.credential.verified, true);
  assert.equal(view.checks.participation.credited, true);
  assert.equal(view.checks.participation.role, "项目负责医者");
});

test("外部核验只提供必要证据：不含病历、证据原件与患者信息", () => {
  const view = discloseForVerification(state, {
    verifier: "项目组委会资格组",
    profile_id: "p-wang",
    checks: ["credential", "employment", "participation"],
    contribution_id: "c-yuanqian",
  });
  const text = JSON.stringify(view);
  assert.ok(!/license_no|evidence|medical|patient|ptn-0417|arch-20/.test(text));
});

test("未参与者如实返回未参与，不为核验凑数", () => {
  const view = discloseForVerification(state, {
    verifier: "项目组委会资格组",
    profile_id: "p-zhang",
    checks: ["participation"],
    contribution_id: "c-yuanqian",
  });
  assert.equal(view.checks.participation.credited, false);
});
