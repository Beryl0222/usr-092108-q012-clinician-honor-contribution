import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent, validateEventStream } from "../src/validator.js";
import { replay } from "../src/archive.js";

const sampleEvents = JSON.parse(
  await readFile(new URL("../data/sample.json", import.meta.url), "utf8"),
);

test("样例事件流每条都符合领域约定", () => {
  assert.deepEqual(validateEventStream(sampleEvents), []);
});

test("样例事件流重放无不变量违规", () => {
  const archive = replay(sampleEvents);
  assert.deepEqual(archive.violations, []);
});

test("缺少信封字段仍被基础校验捕获", () => {
  const errors = validateEvent({ event_type: "PROFILE_REGISTERED" });
  assert.ok(errors.some((m) => m.includes("event_id")));
  assert.ok(errors.some((m) => m.includes("occurred_at")));
});

test("载荷缺少必填字段被拒绝", () => {
  const bad = {
    event_id: "x1",
    event_type: "PROFILE_REGISTERED",
    aggregate_type: "nominee_profile",
    aggregate_id: "p1",
    occurred_at: "2026-09-01T00:00:00+08:00",
    version: 1,
    summary: "缺 payload 字段",
    payload: { profile_id: "p1" },
  };
  const errors = validateEvent(bad);
  assert.ok(errors.some((m) => m.includes("profile_kind")));
  assert.ok(errors.some((m) => m.includes("canonical_name")));
});

test("事件类型与聚合类型必须匹配", () => {
  const bad = {
    event_id: "x2",
    event_type: "CONSENT_GRANTED",
    aggregate_type: "nominee_profile",
    aggregate_id: "c1",
    occurred_at: "2026-09-01T00:00:00+08:00",
    version: 1,
    summary: "聚合类型错配",
    payload: {
      consent_id: "c1",
      patient_pseudonym: "甲",
      purposes: ["review"],
      granted_at: "2026-09-01T00:00:00+08:00",
      statement_version: "v1",
    },
  };
  assert.ok(validateEvent(bad).some((m) => m.includes("aggregate_type 应为")));
});

test("禁止按病例数自动评断医德医术，也禁止完整病历", () => {
  const bad = {
    event_id: "x3",
    event_type: "CONTRIBUTION_ATTESTED",
    aggregate_type: "contribution_record",
    aggregate_id: "c9",
    occurred_at: "2026-09-01T00:00:00+08:00",
    version: 1,
    summary: "夹带自动评分",
    payload: {
      contribution_id: "c9",
      title: "t",
      categories: ["clinical"],
      period_from: "2020-01-01T00:00:00+08:00",
      period_to: "2020-12-31T23:59:59+08:00",
      participants: [{ profile_id: "p-lin", role: "r" }],
      ethics_score: 98,
      evidence_refs: [],
    },
  };
  assert.ok(validateEvent(bad).some((m) => m.includes("禁止字段")));

  const packet = {
    event_id: "x4",
    event_type: "VERIFICATION_PACKET_ISSUED",
    aggregate_type: "verification_packet",
    aggregate_id: "vp1",
    occurred_at: "2026-09-01T00:00:00+08:00",
    version: 1,
    summary: "夹带病历",
    payload: {
      packet_id: "vp1",
      request_id: "r1",
      target_profile_id: "p-lin",
      contains_full_medical_record: false,
      facts: [{ fact_key: "license_status", result: "confirmed", full_medical_record: "..." }],
    },
  };
  assert.ok(validateEvent(packet).some((m) => m.includes("禁止字段")));
});

test("参与者时间窗倒置被结构校验拒绝", () => {
  const bad = {
    event_id: "x5",
    event_type: "CONTRIBUTION_ATTESTED",
    aggregate_type: "contribution_record",
    aggregate_id: "c10",
    occurred_at: "2026-09-01T00:00:00+08:00",
    version: 1,
    summary: "时间窗倒置",
    payload: {
      contribution_id: "c10",
      title: "t",
      categories: ["clinical"],
      period_from: "2020-01-01T00:00:00+08:00",
      period_to: "2019-01-01T00:00:00+08:00",
      participants: [
        {
          profile_id: "p-lin",
          role: "r",
          participated_from: "2020-06-01T00:00:00+08:00",
          participated_to: "2019-01-01T00:00:00+08:00",
        },
      ],
    },
  };
  assert.ok(validateEvent(bad).some((m) => m.includes("时间窗倒置")));
});

test("重复 event_id 被事件流校验发现", () => {
  const one = sampleEvents[0];
  const errors = validateEventStream([one, { ...one }]);
  assert.ok(errors.some((m) => m.includes("event_id 重复")));
});

test("核验事实白名单之外的键被拒绝", () => {
  const bad = {
    event_id: "x6",
    event_type: "VERIFICATION_REQUESTED",
    aggregate_type: "verification_packet",
    aggregate_id: "r9",
    occurred_at: "2026-09-01T00:00:00+08:00",
    version: 1,
    summary: "索取病情",
    payload: { request_id: "r9", requested_by: "某方", facts_needed: ["full_diagnosis_detail"] },
  };
  assert.ok(validateEvent(bad).some((m) => m.includes("facts_needed")));
});
