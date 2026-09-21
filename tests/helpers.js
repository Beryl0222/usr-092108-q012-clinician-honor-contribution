// 测试用事件构造器：只给关键字段，信封自动补齐。
let seq = 0;
export function ev(eventType, aggregateType, aggregateId, payload, overrides = {}) {
  seq += 1;
  return {
    event_id: overrides.event_id ?? `test-ev-${String(seq).padStart(3, "0")}`,
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    occurred_at: overrides.occurred_at ?? "2026-09-01T09:00:00+08:00",
    version: overrides.version ?? 1,
    summary: overrides.summary ?? `测试事件 ${eventType}`,
    payload,
  };
}

export const P = {
  lin: "p-lin",
  zhao: "p-zhao",
  su: "p-su",
  team: "t-team",
  org: "org-1",
};

export function orgEvents() {
  return [ev("ORG_REGISTERED", "org_record", P.org, { org_id: P.org, org_name: "第一医院" })];
}

export function personEvents() {
  return [
    ...orgEvents(),
    ev("PROFILE_REGISTERED", "nominee_profile", P.lin, { profile_id: P.lin, profile_kind: "individual", canonical_name: "林慧文" }),
    ev("PROFILE_REGISTERED", "nominee_profile", P.zhao, { profile_id: P.zhao, profile_kind: "individual", canonical_name: "赵一鸣" }),
    ev("PROFILE_REGISTERED", "nominee_profile", P.su, { profile_id: P.su, profile_kind: "individual", canonical_name: "苏方远" }),
    ev("PROFILE_REGISTERED", "nominee_profile", P.team, { profile_id: P.team, profile_kind: "team", canonical_name: "巡诊团队" }),
    ev("TENURE_RECORDED", "nominee_profile", P.lin, {
      person_profile_id: P.lin, org_id: P.org, org_name_snapshot: "第一医院", started_at: "2010-01-01T00:00:00+08:00", status: "active",
    }),
  ];
}
