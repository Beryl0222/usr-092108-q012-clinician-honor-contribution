export const EVENT_TYPES = [
  "PROFILE_REGISTERED",
  "PROFILE_ALIAS_ADDED",
  "PROFILE_MERGED",
  "EMPLOYMENT_RECORDED",
  "CREDENTIAL_VERIFIED",
  "INSTITUTION_REGISTERED",
  "INSTITUTION_RENAMED",
  "CONTRIBUTION_ATTESTED",
  "NOMINATION_SUBMITTED",
  "NOMINATION_MERGED",
  "CONSENT_GRANTED",
  "CONSENT_WITHDRAWN",
  "MEDIA_LICENSE_GRANTED",
  "MEDIA_LICENSE_REVOKED",
  "STORY_REVIEWED",
  "STORY_RELEASED",
  "ATTRIBUTION_CORRECTED",
  "VERIFICATION_DISCLOSED",
];

export const AGGREGATE_TYPES = [
  "nominee_profile",
  "institution",
  "contribution_record",
  "nomination",
  "consent_grant",
  "media_license",
  "publication",
];

// 系统不依据病例数等指标自动评判医德或医术；出现此类派生评分字段即拒绝接收。
const AUTO_JUDGEMENT_FIELDS = new Set([
  "ethics_score",
  "skill_score",
  "morality_rating",
  "virtue_rating",
  "case_count_score",
  "auto_judgement",
]);

const REQUIRED = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

export function validateEvent(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return ["事件必须是对象"];
  }
  const errors = REQUIRED.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);
  if ("event_type" in record && !EVENT_TYPES.includes(record.event_type)) {
    errors.push(`未知事件类型：${record.event_type}`);
  }
  if ("aggregate_type" in record && !AGGREGATE_TYPES.includes(record.aggregate_type)) {
    errors.push(`未知聚合类型：${record.aggregate_type}`);
  }
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if ("occurred_at" in record && Number.isNaN(Date.parse(record.occurred_at))) {
    errors.push("occurred_at 必须是可解析的时间");
  }
  if ("payload" in record && (record.payload === null || typeof record.payload !== "object" || Array.isArray(record.payload))) {
    errors.push("payload 必须是对象");
  }
  for (const hit of findAutoJudgementFields(record.payload)) {
    errors.push(`不允许由指标自动评判医德医术：${hit}`);
  }
  return errors;
}

function findAutoJudgementFields(node, path = "payload") {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((item, index) => findAutoJudgementFields(item, `${path}[${index}]`));
  return Object.entries(node).flatMap(([key, value]) => [
    ...(AUTO_JUDGEMENT_FIELDS.has(key) ? [`${path}.${key}`] : []),
    ...findAutoJudgementFields(value, `${path}.${key}`),
  ]);
}
