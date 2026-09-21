import assert from "node:assert/strict";
import test from "node:test";

import { replay } from "../src/archive.js";
import { ev, P, personEvents } from "./helpers.js";

const codes = (archive) => archive.violations.map((v) => v.code);

// 给团队建立成员关系：林全程、苏 2014—2018、赵 2021 年后才加入
function teamSetup() {
  return [
    ...personEvents(),
    ev("TEAM_MEMBERSHIP_RECORDED", "nominee_profile", P.team, {
      team_profile_id: P.team, member_profile_id: P.lin, participated_from: "2013-01-01T00:00:00+08:00", role: "领队",
    }),
    ev("TEAM_MEMBERSHIP_RECORDED", "nominee_profile", P.team, {
      team_profile_id: P.team, member_profile_id: P.su,
      participated_from: "2014-03-01T00:00:00+08:00", participated_to: "2018-11-30T23:59:59+08:00", role: "跨院搭档",
    }),
    ev("TEAM_MEMBERSHIP_RECORDED", "nominee_profile", P.team, {
      team_profile_id: P.team, member_profile_id: P.zhao, participated_from: "2021-03-01T00:00:00+08:00", role: "青年队员",
    }),
  ];
}

const period = { from: "2014-01-01T00:00:00+08:00", to: "2018-12-31T23:59:59+08:00" };

function teamAward(participants, awardId = "aw-1") {
  return ev("AWARD_GRANTED", "award", awardId, {
    award_id: awardId, profile_id: P.team, track: "team", award_category: "team_collaboration",
    period_from: period.from, period_to: period.to, participants,
  });
}

test("后来加入的成员不能署名未参与的团队成果", () => {
  const archive = replay([
    ...teamSetup(),
    teamAward([
      { profile_id: P.lin, role: "领队", participated_from: period.from, participated_to: period.to },
      { profile_id: P.zhao, role: "队员", participated_from: period.from, participated_to: period.to },
    ]),
  ]);
  assert.ok(codes(archive).includes("team_award_unverified_member"), JSON.stringify(archive.violations));
});

test("实际在时间窗内参与的跨院成员署名合法（退休/离职/跨院不丢贡献）", () => {
  const archive = replay([
    ...teamSetup(),
    teamAward([
      { profile_id: P.lin, role: "领队", participated_from: period.from, participated_to: period.to },
      { profile_id: P.su, role: "跨院搭档", participated_from: "2014-03-01T00:00:00+08:00", participated_to: "2018-11-30T23:59:59+08:00" },
    ]),
  ]);
  assert.deepEqual(archive.violations, []);
});

test("参与者自报时间窗与成果时段不重叠会被标记", () => {
  const archive = replay([
    ...teamSetup(),
    ev("CONTRIBUTION_ATTESTED", "contribution_record", "c1", {
      contribution_id: "c1", title: "t", categories: ["clinical"],
      period_from: period.from, period_to: period.to,
      participants: [{ profile_id: P.zhao, role: "r", participated_from: "2022-01-01T00:00:00+08:00", participated_to: "2023-01-01T00:00:00+08:00" }],
    }),
  ]);
  assert.ok(codes(archive).includes("participant_outside_window"));
});

test("更正只能补真实参与者：把后来成员塞进历史署名会被拒", () => {
  const archive = replay([
    ...teamSetup(),
    teamAward([{ profile_id: P.lin, role: "领队", participated_from: period.from, participated_to: period.to }]),
    ev("ATTRIBUTION_CORRECTED", "public_story", "corr-bad", {
      correction_id: "corr-bad", scope: "award", error_kind: "omitted_member", target_id: "aw-1",
      original_event_id: "test-evt-award", corrected_at: "2026-06-01T00:00:00+08:00",
      attribution_after: [
        { profile_id: P.lin, role: "领队", participated_from: period.from, participated_to: period.to },
        { profile_id: P.zhao, role: "队员", participated_from: period.from, participated_to: period.to },
      ],
    }),
  ]);
  assert.ok(codes(archive).includes("team_award_unverified_member"));
});

test("更正不改写历史：原署名保留，current 指向更正后名单并附更正链", () => {
  const archive = replay([
    ...teamSetup(),
    teamAward([
      { profile_id: P.lin, role: "领队", participated_from: period.from, participated_to: period.to },
    ]),
    ev("ATTRIBUTION_CORRECTED", "public_story", "corr-ok", {
      correction_id: "corr-ok", scope: "award", error_kind: "omitted_member", target_id: "aw-1",
      original_event_id: "test-evt-award", corrected_at: "2026-06-01T00:00:00+08:00",
      attribution_after: [
        { profile_id: P.lin, role: "领队", participated_from: period.from, participated_to: period.to },
        { profile_id: P.su, role: "跨院搭档", participated_from: "2014-03-01T00:00:00+08:00", participated_to: "2018-11-30T23:59:59+08:00" },
      ],
    }),
  ]);
  assert.deepEqual(archive.violations, []);
  const eff = archive.effectiveAttribution("award", "aw-1");
  assert.equal(eff.original.length, 1);
  assert.equal(eff.current.length, 2);
  assert.equal(eff.corrected_by, "corr-ok");
  assert.ok(eff.current.some((x) => x.profile_id === P.su));
});

test("身份归并：姓名异体与重复推荐落到同一候选", () => {
  const linTypo = "p-lin-typo";
  const archive = replay([
    ...personEvents(),
    ev("PROFILE_REGISTERED", "nominee_profile", linTypo, {
      profile_id: linTypo, profile_kind: "individual", canonical_name: "林惠文",
    }),
    ev("IDENTITY_MERGED", "nominee_profile", P.lin, {
      canonical_profile_id: P.lin, merged_profile_id: linTypo, reason: "name_variant",
    }),
    ev("NOMINATION_SUBMITTED", "nomination", "n1", {
      nomination_id: "n1", profile_id: P.lin, track: "individual",
      award_category: "clinical_achievement", recommending_org_id: P.org,
    }),
    ev("NOMINATION_SUBMITTED", "nomination", "n2", {
      nomination_id: "n2", profile_id: linTypo, track: "individual",
      award_category: "clinical_achievement", recommending_org_id: P.org,
    }),
    ev("NOMINATION_CONSOLIDATED", "nomination", "n1", {
      kept_nomination_id: "n1", merged_nomination_ids: ["n2"], reason: "duplicate_nomination",
    }),
  ]);
  assert.deepEqual(archive.violations, []);
  assert.equal(archive.canonicalProfileId(linTypo), P.lin);
  const dups = archive.duplicateNominations(linTypo);
  assert.deepEqual(dups.map((d) => d.nomination_id).sort(), ["n1", "n2"]);
  assert.equal(dups.find((d) => d.nomination_id === "n2").status, "consolidated");
  assert.deepEqual(archive.nomineeView(linTypo).name_variants, ["林惠文"]);
});

test("不能将候选归并到自身，也不能重复归并", () => {
  const archive = replay([
    ...personEvents(),
    ev("IDENTITY_MERGED", "nominee_profile", P.lin, {
      canonical_profile_id: P.lin, merged_profile_id: P.lin, reason: "data_fix",
    }),
  ]);
  assert.ok(codes(archive).includes("identity_merge_self"));
});

// —— 患者同意：按用途分别授予/撤回 ——

function consentStory() {
  return [
    ...personEvents(),
    ev("CONSENT_GRANTED", "consent_grant", "cs1", {
      consent_id: "cs1", patient_pseudonym: "患者甲",
      purposes: ["review", "ceremony", "long_term_publicity"],
      granted_at: "2026-04-01T00:00:00+08:00", statement_version: "v3", story_id: "s1",
    }),
    ev("MEDIA_LICENSE_GRANTED", "media_license", "ml1", {
      license_id: "ml1", licensor_role: "hospital",
      channels: ["honor_roll_page", "media_kit", "ceremony"],
      material_refs: ["m1"], granted_from: "2026-04-01T00:00:00+08:00",
    }),
  ];
}

function prepareStory(events, storyId, channels, overrides = {}) {
  events.push(
    ev("PUBLICATION_PREPARED", "public_story", storyId, {
      story_id: storyId, version: 1, nomination_id: "n1", channel_targets: channels,
      attribution_entries: [{ profile_id: P.lin, role: "领队" }],
      consent_ids: ["cs1"], media_license_ids: ["ml1"],
      contribution_ids: ["c1"], award_ids: ["aw-1"], patient_story_included: true,
      ...overrides,
    }),
    ev("PUBLICATION_APPROVED", "public_story", storyId, {
      story_id: storyId, version: 1, reviewer_kind: "hospital", approved: true,
    }),
    ev("PUBLICATION_APPROVED", "public_story", storyId, {
      story_id: storyId, version: 1, reviewer_kind: "candidate", approved: true,
    }),
  );
}

test("发布必须经医院与候选人双端核对", () => {
  const events = consentStory();
  events.push(
    ev("PUBLICATION_PREPARED", "public_story", "s1", {
      story_id: "s1", version: 1, nomination_id: "n1", channel_targets: ["honor_roll_page"],
      attribution_entries: [{ profile_id: P.lin, role: "领队" }],
      consent_ids: ["cs1"], media_license_ids: ["ml1"], patient_story_included: false,
    }),
    // 仅医院核对，缺候选人核对
    ev("PUBLICATION_APPROVED", "public_story", "s1", {
      story_id: "s1", version: 1, reviewer_kind: "hospital", approved: true,
    }),
    ev("STORY_RELEASED", "public_story", "s1", {
      story_id: "s1", version: 1, channels: ["honor_roll_page"], released_at: "2026-05-01T00:00:00+08:00",
    }),
  );
  assert.ok(codes(replay(events)).includes("release_without_dual_approval"));
});

test("长期宣传渠道发布需要 long_term_publicity 授权；盛典只需 ceremony", () => {
  const events = consentStory();
  // 撤回长期宣传
  events.push(
    ev("CONSENT_WITHDRAWN", "consent_grant", "cs1", {
      consent_id: "cs1", purposes: ["long_term_publicity"], withdrawn_at: "2026-04-10T00:00:00+08:00",
    }),
  );
  prepareStory(events, "s-long", ["honor_roll_page"]);
  prepareStory(events, "s-gala", ["ceremony"]);
  events.push(
    ev("STORY_RELEASED", "public_story", "s-long", {
      story_id: "s-long", version: 1, channels: ["honor_roll_page"], released_at: "2026-05-01T00:00:00+08:00",
    }),
    ev("STORY_RELEASED", "public_story", "s-gala", {
      story_id: "s-gala", version: 1, channels: ["ceremony"], released_at: "2026-05-01T00:00:00+08:00",
    }),
  );
  const found = codes(replay(events));
  assert.ok(found.includes("release_without_consent"), "长期宣传渠道缺授权应被标记");
  assert.ok(!found.some((c) => c.includes("consent") && c.includes("ceremony")), "盛典不应受长期宣传撤回影响");
});

test("撤回未授予的用途会被标记", () => {
  const events = [
    ...personEvents(),
    ev("CONSENT_GRANTED", "consent_grant", "cs2", {
      consent_id: "cs2", patient_pseudonym: "乙", purposes: ["review"],
      granted_at: "2026-04-01T00:00:00+08:00", statement_version: "v1",
    }),
    ev("CONSENT_WITHDRAWN", "consent_grant", "cs2", {
      consent_id: "cs2", purposes: ["ceremony"], withdrawn_at: "2026-05-01T00:00:00+08:00",
    }),
  ];
  assert.ok(codes(replay(events)).includes("consent_withdrawal_invalid"));
});

test("撤回长期宣传后，受影响面是撤回时点在播的长期渠道，不含盛典", () => {
  const events = consentStory();
  prepareStory(events, "s-long", ["honor_roll_page", "patient_story", "media_kit"]);
  prepareStory(events, "s-gala", ["ceremony"]);
  events.push(
    ev("STORY_RELEASED", "public_story", "s-long", {
      story_id: "s-long", version: 1, channels: ["honor_roll_page", "patient_story", "media_kit"], released_at: "2026-05-01T00:00:00+08:00",
    }),
    ev("STORY_RELEASED", "public_story", "s-gala", {
      story_id: "s-gala", version: 1, channels: ["ceremony"], released_at: "2026-05-01T00:00:00+08:00",
    }),
    ev("CONSENT_WITHDRAWN", "consent_grant", "cs1", {
      consent_id: "cs1", purposes: ["long_term_publicity"], withdrawn_at: "2026-08-01T00:00:00+08:00",
    }),
  );
  const archive = replay(events);
  const affected = archive.channelsAffectedByConsentWithdrawal("cs1").map((x) => x.channel).sort();
  assert.deepEqual(affected, ["honor_roll_page", "media_kit", "patient_story"]);
});

// 完整基底：人员+团队关系+患者同意+医院媒体许可
function fullSetup() {
  const events = consentStory();
  events.push(
    ev("TEAM_MEMBERSHIP_RECORDED", "nominee_profile", P.team, {
      team_profile_id: P.team, member_profile_id: P.lin, participated_from: "2013-01-01T00:00:00+08:00", role: "领队",
    }),
    ev("TEAM_MEMBERSHIP_RECORDED", "nominee_profile", P.team, {
      team_profile_id: P.team, member_profile_id: P.su,
      participated_from: "2014-03-01T00:00:00+08:00", participated_to: "2018-11-30T23:59:59+08:00", role: "跨院搭档",
    }),
    ev("TEAM_MEMBERSHIP_RECORDED", "nominee_profile", P.team, {
      team_profile_id: P.team, member_profile_id: P.zhao, participated_from: "2021-03-01T00:00:00+08:00", role: "青年队员",
    }),
  );
  return events;
}

test("错署名更正的影响面与同步状态：未同步渠道显示 pending", () => {
  const events = fullSetup();
  events.push(
    teamAward([{ profile_id: P.lin, role: "领队", participated_from: period.from, participated_to: period.to }]),
  );
  prepareStory(events, "s-long", ["honor_roll_page", "patient_story", "media_kit"]);
  events.push(
    ev("STORY_RELEASED", "public_story", "s-long", {
      story_id: "s-long", version: 1, channels: ["honor_roll_page", "patient_story", "media_kit"], released_at: "2026-05-01T00:00:00+08:00",
    }),
    ev("ATTRIBUTION_CORRECTED", "public_story", "corr1", {
      correction_id: "corr1", scope: "award", error_kind: "omitted_member", target_id: "aw-1",
      original_event_id: "award-event", corrected_at: "2026-06-01T00:00:00+08:00",
      attribution_after: [
        { profile_id: P.lin, role: "领队", participated_from: period.from, participated_to: period.to },
        { profile_id: P.su, role: "跨院搭档", participated_from: "2014-03-01T00:00:00+08:00", participated_to: "2018-11-30T23:59:59+08:00" },
      ],
    }),
    // 只同步榜单页，其余渠道 pending
    ev("CORRECTION_PROPAGATED", "public_story", "corr1", {
      correction_id: "corr1", story_id: "s-long", channel: "honor_roll_page",
      status: "synced", synced_at: "2026-06-01T01:00:00+08:00",
    }),
  );
  const archive = replay(events);
  assert.deepEqual(archive.violations, []);
  const affected = archive.channelsAffectedByCorrection("corr1");
  assert.equal(affected.length, 3);
  const statusByChannel = Object.fromEntries(affected.map((x) => [x.channel, x.sync_status]));
  assert.equal(statusByChannel.honor_roll_page, "synced");
  assert.equal(statusByChannel.patient_story, "pending");
  assert.equal(statusByChannel.media_kit, "pending");
});

test("已下架渠道在更晚的更正时点不计入即时影响面", () => {
  const events = fullSetup();
  events.push(
    teamAward([{ profile_id: P.lin, role: "领队", participated_from: period.from, participated_to: period.to }]),
  );
  prepareStory(events, "s-long", ["honor_roll_page", "patient_story"]);
  events.push(
    ev("STORY_RELEASED", "public_story", "s-long", {
      story_id: "s-long", version: 1, channels: ["honor_roll_page", "patient_story"], released_at: "2026-05-01T00:00:00+08:00",
    }),
    ev("STORY_CHANNEL_TAKEN_DOWN", "public_story", "s-long", {
      story_id: "s-long", channel: "patient_story", taken_down_at: "2026-05-10T00:00:00+08:00", reason: "患者撤回",
    }),
    ev("ATTRIBUTION_CORRECTED", "public_story", "corr2", {
      correction_id: "corr2", scope: "award", error_kind: "omitted_member", target_id: "aw-1",
      original_event_id: "award-event", corrected_at: "2026-06-01T00:00:00+08:00",
      attribution_after: [
        { profile_id: P.lin, role: "领队", participated_from: period.from, participated_to: period.to },
        { profile_id: P.su, role: "跨院搭档", participated_from: "2014-03-01T00:00:00+08:00", participated_to: "2018-11-30T23:59:59+08:00" },
      ],
    }),
  );
  const archive = replay(events);
  assert.deepEqual(archive.violations, []);
  const channels = archive.channelsAffectedByCorrection("corr2").map((x) => x.channel);
  assert.deepEqual(channels, ["honor_roll_page"]);
});

test("外部核验：超额披露与完整病历被标记，最小证据包通过", () => {
  const events = [
    ...personEvents(),
    ev("VERIFICATION_REQUESTED", "verification_packet", "vr1", {
      request_id: "vr1", requested_by: "组委会", target_profile_id: P.lin,
      facts_needed: ["license_status"],
    }),
    ev("VERIFICATION_PACKET_ISSUED", "verification_packet", "vp1", {
      packet_id: "vp1", request_id: "vr1", target_profile_id: P.lin,
      contains_full_medical_record: false,
      facts: [
        { fact_key: "license_status", result: "confirmed" },
        { fact_key: "charity_record_exists", result: "confirmed" }, // 未被请求
      ],
    }),
  ];
  const found = codes(replay(events));
  assert.ok(found.includes("verification_overdisclosure"));

  const minimal = replay([
    ...personEvents(),
    ev("VERIFICATION_REQUESTED", "verification_packet", "vr2", {
      request_id: "vr2", requested_by: "组委会", target_profile_id: P.lin,
      facts_needed: ["license_status", "award_was_granted"],
    }),
    ev("VERIFICATION_PACKET_ISSUED", "verification_packet", "vp2", {
      packet_id: "vp2", request_id: "vr2", target_profile_id: P.lin,
      contains_full_medical_record: false,
      facts: [
        { fact_key: "license_status", result: "confirmed", evidence_ref: "ref://脱敏回执" },
        { fact_key: "award_was_granted", result: "confirmed", evidence_ref: "ref://颁奖决定" },
      ],
    }),
  ]);
  assert.deepEqual(minimal.violations, []);
  const view = minimal.verificationView("vp2");
  assert.equal(view.contains_full_medical_record, false);
  assert.deepEqual(view.facts.map((f) => f.fact_key), ["license_status", "award_was_granted"]);
});

test("媒体许可撤销后再在该渠道发布会被标记", () => {
  const events = consentStory();
  prepareStory(events, "s1", ["media_kit"]);
  events.push(
    ev("MEDIA_LICENSE_REVOKED", "media_license", "ml1", {
      license_id: "ml1", channels: ["media_kit"], revoked_at: "2026-04-20T00:00:00+08:00",
    }),
    ev("STORY_RELEASED", "public_story", "s1", {
      story_id: "s1", version: 1, channels: ["media_kit"], released_at: "2026-05-01T00:00:00+08:00",
    }),
  );
  assert.ok(codes(replay(events)).includes("release_with_revoked_license"));
});
