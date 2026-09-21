import assert from "node:assert/strict";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

const base = {
  event_id: "t-1",
  event_type: "PROFILE_REGISTERED",
  aggregate_type: "nominee_profile",
  aggregate_id: "p-1",
  occurred_at: "2026-09-01T09:00:00+08:00",
  version: 1,
  summary: "测试事件",
};

test("缺少必填字段", () => {
  const { summary, ...rest } = base;
  assert.deepEqual(validateEvent(rest), ["缺少字段：summary"]);
});

test("version 必须是正整数", () => {
  assert.ok(validateEvent({ ...base, version: 0 }).includes("version 必须是正整数"));
  assert.ok(validateEvent({ ...base, version: 1.5 }).includes("version 必须是正整数"));
});

test("未知事件类型与聚合类型被拒绝", () => {
  assert.ok(validateEvent({ ...base, event_type: "SCORE_COMPUTED" }).some((e) => e.includes("未知事件类型")));
  assert.ok(validateEvent({ ...base, aggregate_type: "ranking" }).some((e) => e.includes("未知聚合类型")));
});

test("occurred_at 必须可解析", () => {
  assert.ok(validateEvent({ ...base, occurred_at: "不是时间" }).includes("occurred_at 必须是可解析的时间"));
});

test("系统不按病例数自动判断医德医术：派生评分字段被拒绝", () => {
  const withScore = { ...base, payload: { metrics: { ethics_score: 5 } } };
  assert.ok(validateEvent(withScore).some((e) => e.includes("不允许由指标自动评判医德医术")));
  const nested = { ...base, payload: { items: [{ skill_score: 3 }] } };
  assert.ok(validateEvent(nested).some((e) => e.includes("payload.items[0].skill_score")));
});
