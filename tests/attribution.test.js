import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectState } from "../src/project.js";
import { effectiveParticipants, isCredited, affectedByCorrection, correctionNotices } from "../src/attribution.js";

const { events } = JSON.parse(await readFile(new URL("../data/sample-stream.json", import.meta.url), "utf8"));
const state = projectState(events);

test("退休成员的历史贡献保留，不因离职失效", () => {
  assert.equal(isCredited(state, "p-li", "c-yuanqian"), true);
  assert.equal(isCredited(state, "p-li", "c-yuanqian", "2020-01-01"), true);
});

test("信用判定按各自参与窗口：窗口外的时间不计", () => {
  assert.equal(isCredited(state, "p-li", "c-yuanqian", "2021-06-01"), false);
  assert.equal(isCredited(state, "p-wang", "c-yuanqian", "2021-06-01"), true);
});

test("后来成员不能继承未参与事项", () => {
  assert.equal(isCredited(state, "p-zhang", "c-yuanqian"), false);
});

test("更正不改写多年前的真实分工：原始记录保留，更正作为后继记录追加", () => {
  const original = events.find((e) => e.event_id === "evt-011");
  assert.equal(original.payload.participants.length, 2);
  const contribution = state.contributions.get("c-yuanqian");
  assert.equal(contribution.participants.length, 2);
  assert.equal(contribution.corrections.length, 1);
  assert.equal(contribution.corrections[0].corrects, "evt-011");
  assert.equal(effectiveParticipants(contribution).length, 3);
});

test("署名遗漏更正后，推荐医院立刻知道受影响的榜单页面、患者故事和媒体材料", () => {
  const throughCorrection = events.slice(0, events.findIndex((e) => e.event_id === "evt-030") + 1);
  const stateAtCorrection = projectState(throughCorrection);
  const correction = throughCorrection.at(-1);
  const affected = affectedByCorrection(stateAtCorrection, correction);
  assert.deepEqual(affected.leaderboard_pages.map((x) => x.publication_id), ["pub-leaderboard"]);
  assert.deepEqual(affected.patient_stories.map((x) => x.publication_id), ["pub-story"]);
  assert.deepEqual(affected.media_materials.map((x) => x.publication_id), ["pub-video"]);
});

test("更正同步各渠道：每个受影响公开版本生成重新发布通知", () => {
  const throughCorrection = events.slice(0, events.findIndex((e) => e.event_id === "evt-030") + 1);
  const notices = correctionNotices(projectState(throughCorrection), throughCorrection.at(-1));
  assert.equal(notices.length, 3);
  assert.ok(notices.every((n) => n.action === "reissue_with_correction" && n.correction_event === "evt-030"));
});
