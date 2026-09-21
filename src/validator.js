// 领域事件结构校验：信封 + 按事件类型的载荷。
// 不做跨事件的业务不变量判断（那是 archive.js 重放时的职责）。
import {
  AGGREGATE_TYPES,
  CHANNELS,
  CONSENT_PURPOSES,
  EVENT_CONTRACTS,
  EVENT_TYPES,
  FORBIDDEN_PAYLOAD_KEYS,
  PROFILE_KINDS,
  VERIFICATION_FACT_ALLOWLIST,
} from "./catalog.js";

const ENVELOPE_REQUIRED = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
];

const ENUM_FIELDS = {
  profile_kind: PROFILE_KINDS,
  track: ["individual", "team"],
  channels: CHANNELS,
  channel_targets: CHANNELS,
  channel: CHANNELS,
  purposes: CONSENT_PURPOSES,
  facts_needed: VERIFICATION_FACT_ALLOWLIST,
  result: ["confirmed", "refuted", "unverifiable"],
  reviewer_kind: ["hospital", "candidate"],
  approved: [true, false],
  scope: ["contribution", "award", "publication"],
  error_kind: ["omitted_member", "wrong_member", "role_misstated", "name_variant", "org_misstated"],
  contains_full_medical_record: [false],
  licensor_role: ["candidate", "hospital", "patient", "media_outlet"],
};

// 按 event_type 细化的字段枚举（覆盖 ENUM_FIELDS 中的多义项）
const MERGE_REASONS = ["name_variant", "org_renamed", "duplicate_nomination", "data_fix"];
const EVENT_FIELD_ENUMS = {
  TENURE_RECORDED: { status: ["active", "departed", "retired"] },
  LICENSE_VERIFIED: { status: ["valid", "expired", "revoked"] },
  CORRECTION_PROPAGATED: { status: ["pending", "synced", "failed"] },
  IDENTITY_MERGED: { reason: MERGE_REASONS },
  NOMINATION_CONSOLIDATED: { reason: MERGE_REASONS },
};

const ISO_DATE_FIELDS = new Set([
  "occurred_at",
  "effective_at",
  "started_at",
  "ended_at",
  "participated_from",
  "participated_to",
  "period_from",
  "period_to",
  "granted_at",
  "withdrawn_at",
  "granted_from",
  "granted_to",
  "revoked_at",
  "released_at",
  "taken_down_at",
  "corrected_at",
  "verified_at",
  "endorsed_at",
  "amended_at",
  "reviewed_at",
  "submitted_at",
]);

function isValidDateString(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function pushDateErrors(errors, key, value, path) {
  if (value != null && !isValidDateString(value)) {
    errors.push(`${path}.${key} 必须是可解析的日期时间字符串`);
  }
}

function findForbiddenKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => findForbiddenKeys(item, `${path}[${i}]`, errors));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_PAYLOAD_KEYS.includes(key)) {
        errors.push(`${path}.${key} 为禁止字段：系统不按病例数等自动评断医德/医术，也不接收完整病历`);
      }
      findForbiddenKeys(child, `${path}.${key}`, errors);
    }
  }
}

function validateEnumValue(errors, key, value, allowed, path) {
  if (allowed === undefined) return;
  if (!allowed.includes(value)) {
    errors.push(`${path}.${key} 的值 ${JSON.stringify(value)} 不在允许集合中`);
  }
}

function validatePayloadObject(payload, eventType, errors, path) {
  for (const [key, value] of Object.entries(payload)) {
    if (ISO_DATE_FIELDS.has(key)) {
      if (Array.isArray(value)) value.forEach((v) => pushDateErrors(errors, key, v, path));
      else pushDateErrors(errors, key, value, path);
    }
    const eventSpecific = EVENT_FIELD_ENUMS[eventType]?.[key];
    if (eventSpecific) {
      if (Array.isArray(value)) value.forEach((v) => validateEnumValue(errors, key, v, eventSpecific, path));
      else validateEnumValue(errors, key, value, eventSpecific, path);
      continue;
    }
    const allowed = ENUM_FIELDS[key];
    if (allowed) {
      if (Array.isArray(value)) value.forEach((v) => validateEnumValue(errors, key, v, allowed, path));
      else validateEnumValue(errors, key, value, allowed, path);
    }
  }

  // 嵌套结构：类别枚举
  const CATEGORY_VALUES = ["clinical", "specialty_building", "public_charity", "multi_institution"];
  const AWARD_CATEGORY_VALUES = [
    "clinical_achievement",
    "specialty_building",
    "public_service",
    "team_collaboration",
    "lifetime_achievement",
  ];
  for (const v of payload.categories ?? []) {
    if (!CATEGORY_VALUES.includes(v)) errors.push(`payload.categories 含未知类别：${v}`);
  }
  if (payload.award_category && !AWARD_CATEGORY_VALUES.includes(payload.award_category)) {
    errors.push(`payload.award_category 未知：${payload.award_category}`);
  }

  for (const [listKey, list] of [
    ["participants", payload.participants],
    ["attribution_entries", payload.attribution_entries],
    ["attribution_after", payload.attribution_after],
  ]) {
    if (!Array.isArray(list)) continue;
    list.forEach((entry, i) => {
      const p = `${path}.${listKey}[${i}]`;
      if (!entry || typeof entry !== "object") {
        errors.push(`${p} 必须是对象`);
        return;
      }
      if (!entry.profile_id) errors.push(`${p}.profile_id 为必填`);
      if (!entry.role) errors.push(`${p}.role 为必填`);
      if (entry.participated_from) pushDateErrors(errors, "participated_from", entry.participated_from, p);
      if (entry.participated_to) pushDateErrors(errors, "participated_to", entry.participated_to, p);
      if (
        entry.participated_from &&
        entry.participated_to &&
        Date.parse(entry.participated_to) < Date.parse(entry.participated_from)
      ) {
        errors.push(`${p} 参与时间窗倒置（participated_to 早于 participated_from）`);
      }
    });
  }

  if (Array.isArray(payload.facts)) {
    payload.facts.forEach((fact, i) => {
      const p = `${path}.facts[${i}]`;
      if (!fact || typeof fact !== "object") {
        errors.push(`${p} 必须是对象`);
        return;
      }
      if (!VERIFICATION_FACT_ALLOWLIST.includes(fact.fact_key)) {
        errors.push(`${p}.fact_key 超出最小核验白名单：${fact.fact_key}`);
      }
      if (!["confirmed", "refuted", "unverifiable"].includes(fact.result)) {
        errors.push(`${p}.result 取值非法：${fact.result}`);
      }
    });
  }
}

export function validateEvent(record) {
  const errors = [];
  if (!record || typeof record !== "object") return ["事件记录必须是对象"];

  for (const name of ENVELOPE_REQUIRED) {
    if (!(name in record)) errors.push(`缺少字段：${name}`);
  }
  if (errors.length) return errors;

  if (!EVENT_TYPES.includes(record.event_type)) errors.push(`未知事件类型：${record.event_type}`);
  if (!AGGREGATE_TYPES.includes(record.aggregate_type)) errors.push(`未知聚合类型：${record.aggregate_type}`);

  if (!Number.isInteger(record.version) || record.version < 1) errors.push("version 必须是正整数");
  if (!isValidDateString(record.occurred_at)) errors.push("occurred_at 必须是可解析的日期时间字符串");
  if (typeof record.event_id !== "string" || !record.event_id) errors.push("event_id 必须是非空字符串");
  if (typeof record.aggregate_id !== "string" || !record.aggregate_id) errors.push("aggregate_id 必须是非空字符串");
  if (typeof record.summary !== "string" || !record.summary) errors.push("summary 必须是非空字符串");

  const contract = EVENT_CONTRACTS[record.event_type];
  if (contract) {
    if (record.aggregate_type !== contract.aggregate) {
      errors.push(
        `事件 ${record.event_type} 的 aggregate_type 应为 ${contract.aggregate}，实际为 ${record.aggregate_type}`,
      );
    }
    const payload = record.payload;
    if (!payload || typeof payload !== "object") {
      errors.push(`${record.event_type} 必须携带 payload 对象`);
    } else {
      for (const key of contract.required) {
        if (!(key in payload) || payload[key] === null) errors.push(`payload 缺少必填字段：${key}`);
      }
      validatePayloadObject(payload, record.event_type, errors, "payload");
      findForbiddenKeys(payload, "payload", errors);
    }
  }

  findForbiddenKeys(
    Object.fromEntries(Object.entries(record).filter(([k]) => k !== "payload")),
    "event",
    errors,
  );

  return errors;
}

export function validateEventStream(events) {
  if (!Array.isArray(events)) return ["事件流必须是数组"];
  const errors = [];
  const seenEventIds = new Set();
  events.forEach((event, index) => {
    const local = validateEvent(event);
    local.forEach((msg) => errors.push(`[#${index} ${event?.event_id ?? "?"}] ${msg}`));
    if (event) {
      if (seenEventIds.has(event.event_id)) errors.push(`[#${index}] event_id 重复：${event.event_id}`);
      seenEventIds.add(event.event_id);
    }
  });
  return errors;
}
