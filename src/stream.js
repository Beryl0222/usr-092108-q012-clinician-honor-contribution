// 流程级不变量校验：在单事件信封校验之上，检查事件流中的顺序与引用约束。

import { validateEvent } from "./validator.js";
import { CONSENT_PURPOSES } from "./consent.js";

const CONTRIBUTION_KINDS = ["clinical", "specialty_building", "charity", "multi_institution"];
const REVIEWER_KINDS = ["hospital", "candidate"];
const PUBLICATION_KINDS = ["leaderboard_page", "patient_story", "media_material"];

export function validateStream(events) {
  const errors = [];
  const versions = new Map();
  const profiles = new Set();
  const institutions = new Set();
  const contributions = new Map();
  const nominations = new Set();
  const consents = new Map();
  const licenses = new Map();
  const approvals = new Map();
  const eventIds = new Set();
  let lastOccurredAt = null;

  const fail = (event, msg) => errors.push(`${event.event_id ?? "?"}：${msg}`);

  for (const event of events) {
    for (const err of validateEvent(event)) fail(event, err);

    const occurred = Date.parse(event.occurred_at);
    if (!Number.isNaN(occurred)) {
      if (lastOccurredAt !== null && occurred < lastOccurredAt) fail(event, "事件时间回退");
      lastOccurredAt = Math.max(lastOccurredAt ?? occurred, occurred);
    }

    const lastVersion = versions.get(event.aggregate_id);
    if (lastVersion !== undefined && Number.isInteger(event.version) && event.version <= lastVersion) {
      fail(event, `版本必须单调递增（上一版本 ${lastVersion}）`);
    }
    versions.set(event.aggregate_id, Math.max(lastVersion ?? 0, event.version ?? 0));

    if (event.corrects && !eventIds.has(event.corrects)) {
      fail(event, `corrects 指向未知事件：${event.corrects}`);
    }

    const p = event.payload ?? {};
    switch (event.event_type) {
      case "PROFILE_REGISTERED":
        profiles.add(event.aggregate_id);
        break;
      case "PROFILE_ALIAS_ADDED":
      case "EMPLOYMENT_RECORDED":
      case "CREDENTIAL_VERIFIED":
      case "VERIFICATION_DISCLOSED":
        if (!profiles.has(event.aggregate_id)) fail(event, `档案不存在：${event.aggregate_id}`);
        break;
      case "PROFILE_MERGED":
        if (!profiles.has(p.into_profile_id)) fail(event, `归并目标档案不存在：${p.into_profile_id}`);
        break;
      case "INSTITUTION_REGISTERED":
        institutions.add(event.aggregate_id);
        break;
      case "INSTITUTION_RENAMED":
        if (!institutions.has(event.aggregate_id)) fail(event, `机构不存在：${event.aggregate_id}`);
        break;
      case "CONTRIBUTION_ATTESTED": {
        if (!CONTRIBUTION_KINDS.includes(p.kind)) fail(event, `未知贡献类别：${p.kind}`);
        if (!p.period?.start) fail(event, "贡献必须标明时间段（period.start）");
        if (p.period?.end != null && Date.parse(p.period.end) < Date.parse(p.period.start)) {
          fail(event, "贡献时间段起止颠倒");
        }
        if (!Array.isArray(p.participants) || p.participants.length === 0) {
          fail(event, "团队成果必须标明实际参与者");
          break;
        }
        for (const participant of p.participants) {
          if (!participant.profile_id || !participant.role) fail(event, "参与者必须含 profile_id 与 role");
          if (!windowWithin(participant.window, p.period)) {
            fail(event, `参与者窗口超出贡献时间段：${participant.profile_id}`);
          }
        }
        contributions.set(event.aggregate_id, { period: p.period });
        break;
      }
      case "ATTRIBUTION_CORRECTED": {
        const contribution = contributions.get(event.aggregate_id);
        if (!contribution) {
          fail(event, `更正指向未知贡献：${event.aggregate_id}`);
          break;
        }
        // 补记参与者的窗口也必须落在项目时间段内，后来成员不能借更正继承未参与事项。
        for (const participant of p.add_participants ?? []) {
          if (!windowWithin(participant.window, contribution.period)) {
            fail(event, `补记参与者窗口超出贡献时间段：${participant.profile_id}`);
          }
        }
        break;
      }
      case "NOMINATION_SUBMITTED": {
        if (!["individual", "team"].includes(p.scope)) fail(event, `未知推荐范围：${p.scope}`);
        if (!p.award_category) fail(event, "推荐必须标明奖项类别");
        if (p.scope === "individual" && !p.nominee_profile_id && !p.nominee_name) {
          fail(event, "个人推荐必须指明候选人（nominee_profile_id 或 nominee_name）");
        }
        for (const id of p.contribution_ids ?? []) {
          if (!contributions.has(id)) fail(event, `推荐引用未知贡献：${id}`);
        }
        nominations.add(event.aggregate_id);
        break;
      }
      case "NOMINATION_MERGED":
        if (!nominations.has(p.into_nomination_id)) fail(event, `归并目标推荐不存在：${p.into_nomination_id}`);
        break;
      case "CONSENT_GRANTED":
        if (!CONSENT_PURPOSES.includes(p.purpose)) {
          fail(event, `未知同意用途：${p.purpose}`);
          break;
        }
        consents.set(consentKey(event.aggregate_id, p.purpose), "granted");
        break;
      case "CONSENT_WITHDRAWN": {
        if (!CONSENT_PURPOSES.includes(p.purpose)) {
          fail(event, `未知同意用途：${p.purpose}`);
          break;
        }
        const key = consentKey(event.aggregate_id, p.purpose);
        if (consents.get(key) !== "granted") fail(event, `撤回前该用途并无有效授权：${p.purpose}`);
        consents.set(key, "withdrawn");
        break;
      }
      case "MEDIA_LICENSE_GRANTED":
        for (const channel of p.channels ?? []) licenses.set(licenseKey(event.aggregate_id, channel), "granted");
        break;
      case "MEDIA_LICENSE_REVOKED":
        for (const channel of p.channels ?? []) licenses.set(licenseKey(event.aggregate_id, channel), "revoked");
        break;
      case "STORY_REVIEWED": {
        if (!REVIEWER_KINDS.includes(p.reviewer?.kind)) fail(event, `未知核对主体：${p.reviewer?.kind}`);
        if (!["approved", "changes_requested"].includes(p.decision)) fail(event, `未知核对结论：${p.decision}`);
        if (p.decision === "approved") {
          const key = `${event.aggregate_id}#${p.content_version}`;
          approvals.set(key, new Set([...(approvals.get(key) ?? []), p.reviewer?.kind]));
        }
        break;
      }
      case "STORY_RELEASED": {
        if (!PUBLICATION_KINDS.includes(p.kind)) fail(event, `未知公开版本类别：${p.kind}`);
        // 公开内容发布前须经推荐医院与候选人双重核对。
        const approved = approvals.get(`${event.aggregate_id}#${p.content_version}`) ?? new Set();
        for (const kind of REVIEWER_KINDS) {
          if (!approved.has(kind)) fail(event, `发布前缺少${kind === "hospital" ? "推荐医院" : "候选人"}核对`);
        }
        // 患者故事按用途授权：发布用途必须在当时已获同意。
        for (const storyRef of p.references?.story_refs ?? []) {
          if (p.purpose && consents.get(consentKey(storyRef, p.purpose)) !== "granted") {
            fail(event, `患者故事 ${storyRef} 未授权用途：${p.purpose}`);
          }
        }
        // 媒体材料按渠道许可：发布渠道必须已获许可。
        for (const material of p.references?.material_refs ?? []) {
          for (const channel of p.channels ?? []) {
            if (licenses.get(licenseKey(material, channel)) !== "granted") {
              fail(event, `媒体材料 ${material} 未许可渠道：${channel}`);
            }
          }
        }
        break;
      }
      default:
        break;
    }
    eventIds.add(event.event_id);
  }
  return errors;
}

const consentKey = (storyRef, purpose) => `${storyRef}#${purpose}`;
const licenseKey = (material, channel) => `${material}#${channel}`;

function windowWithin(window, period) {
  if (!window?.start || !period?.start) return false;
  if (Date.parse(window.start) < Date.parse(period.start)) return false;
  if (period.end != null) {
    if (window.end == null) return false;
    if (Date.parse(window.end) > Date.parse(period.end)) return false;
  }
  return true;
}
