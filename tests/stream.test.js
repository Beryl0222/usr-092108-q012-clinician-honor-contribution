import assert from "node:assert/strict";
import test from "node:test";

import { validateStream } from "../src/stream.js";

let seq = 0;
const ev = (type, aggregateType, aggregateId, payload, extra = {}) => ({
  event_id: `t-${++seq}`,
  event_type: type,
  aggregate_type: aggregateType,
  aggregate_id: aggregateId,
  occurred_at: `2026-01-01T00:${String(seq).padStart(2, "0")}:00+08:00`,
  version: extra.version ?? 1,
  summary: "测试事件",
  ...(payload ? { payload } : {}),
  ...extra,
});

const contribution = ev("CONTRIBUTION_ATTESTED", "contribution_record", "c-1", {
  title: "测试项目",
  kind: "clinical",
  period: { start: "2020-01-01", end: "2021-12-31" },
  participants: [{ profile_id: "p-1", role: "负责医者", window: { start: "2020-01-01", end: "2021-12-31" } }],
});

test("公开版本发布前必须经推荐医院与候选人双重核对", () => {
  const events = [
    ev("STORY_REVIEWED", "publication", "pub-1", { content_version: 1, reviewer: { kind: "hospital", id: "h-1" }, decision: "approved" }),
    ev("STORY_RELEASED", "publication", "pub-1", { kind: "leaderboard_page", content_version: 1, channels: ["官网"], references: {} }, { version: 2 }),
  ];
  assert.ok(validateStream(events).some((e) => e.includes("候选人核对")));
});

test("患者故事发布用途须已获患者同意", () => {
  const events = [
    ev("CONSENT_GRANTED", "consent_grant", "s-1", { purpose: "review" }),
    ev("STORY_REVIEWED", "publication", "pub-1", { content_version: 1, reviewer: { kind: "hospital", id: "h-1" }, decision: "approved" }),
    ev("STORY_REVIEWED", "publication", "pub-1", { content_version: 1, reviewer: { kind: "candidate", id: "p-1" }, decision: "approved" }, { version: 2 }),
    ev("STORY_RELEASED", "publication", "pub-1", {
      kind: "patient_story",
      content_version: 1,
      channels: ["官网"],
      purpose: "long_term_publicity",
      references: { story_refs: ["s-1"] },
    }, { version: 3 }),
  ];
  assert.ok(validateStream(events).some((e) => e.includes("未授权用途：long_term_publicity")));
});

test("撤回前该用途必须存在有效授权", () => {
  const events = [ev("CONSENT_WITHDRAWN", "consent_grant", "s-1", { purpose: "ceremony" })];
  assert.ok(validateStream(events).some((e) => e.includes("并无有效授权")));
});

test("参与者窗口不得超出贡献时间段", () => {
  const bad = ev("CONTRIBUTION_ATTESTED", "contribution_record", "c-2", {
    title: "越界项目",
    kind: "charity",
    period: { start: "2020-01-01", end: "2020-12-31" },
    participants: [{ profile_id: "p-9", role: "志愿者", window: { start: "2020-06-01", end: "2021-01-01" } }],
  });
  assert.ok(validateStream([bad]).some((e) => e.includes("参与者窗口超出贡献时间段")));
});

test("后来成员不能借更正继承未参与事项", () => {
  const correction = ev("ATTRIBUTION_CORRECTED", "contribution_record", "c-1", {
    add_participants: [{ profile_id: "p-late", role: "成员", window: { start: "2022-01-01", end: "2022-12-31" } }],
    reason: "试图补记项目结束后才加入的成员",
  }, { version: 2, corrects: contribution.event_id });
  assert.ok(validateStream([contribution, correction]).some((e) => e.includes("补记参与者窗口超出贡献时间段")));
});

test("媒体材料发布渠道须已获许可", () => {
  const events = [
    ev("MEDIA_LICENSE_GRANTED", "media_license", "m-1", { channels: ["盛典现场"] }),
    ev("STORY_REVIEWED", "publication", "pub-1", { content_version: 1, reviewer: { kind: "hospital", id: "h-1" }, decision: "approved" }),
    ev("STORY_REVIEWED", "publication", "pub-1", { content_version: 1, reviewer: { kind: "candidate", id: "p-1" }, decision: "approved" }, { version: 2 }),
    ev("STORY_RELEASED", "publication", "pub-1", {
      kind: "media_material",
      content_version: 1,
      channels: ["商业广告"],
      references: { material_refs: ["m-1"] },
    }, { version: 3 }),
  ];
  assert.ok(validateStream(events).some((e) => e.includes("未许可渠道：商业广告")));
});

test("版本必须单调递增，更正必须指向已知事件", () => {
  const dup = ev("PROFILE_ALIAS_ADDED", "nominee_profile", "p-1", { variant: "某" }, { version: 1 });
  const dangling = ev("PROFILE_ALIAS_ADDED", "nominee_profile", "p-1", { variant: "某二" }, { version: 2, corrects: "evt-不存在" });
  const errors = validateStream([dup, dangling]);
  assert.ok(errors.some((e) => e.includes("corrects 指向未知事件")));
  const back = { ...dangling, event_id: "t-back", corrects: undefined, version: 1 };
  assert.ok(validateStream([dup, back]).some((e) => e.includes("版本必须单调递增")));
});
