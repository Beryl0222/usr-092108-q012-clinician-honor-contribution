// 将事件流折叠为当前状态。事件本身不可变：更正、撤回、归并都以后继事件追加，
// 这里只是按时间顺序重放，任何历史记录都不会被原地改写。

export function projectState(events) {
  const state = {
    profiles: new Map(),
    institutions: new Map(),
    contributions: new Map(),
    nominations: new Map(),
    consents: new Map(),
    licenses: new Map(),
    publications: new Map(),
    disclosures: [],
  };
  for (const event of events) applyEvent(state, event);
  return state;
}

function applyEvent(state, event) {
  const p = event.payload ?? {};
  switch (event.event_type) {
    case "PROFILE_REGISTERED":
      state.profiles.set(event.aggregate_id, {
        id: event.aggregate_id,
        canonical_name: p.canonical_name,
        variants: new Set(p.name_variants ?? []),
        credentials: p.credentials ?? [],
        credential_assertions: [],
        employments: (p.employments ?? []).map((e) => ({ ...e })),
        merged_into: null,
      });
      break;
    case "PROFILE_ALIAS_ADDED":
      state.profiles.get(event.aggregate_id)?.variants.add(p.variant);
      break;
    case "PROFILE_MERGED": {
      const profile = state.profiles.get(event.aggregate_id);
      if (profile) profile.merged_into = p.into_profile_id;
      break;
    }
    case "EMPLOYMENT_RECORDED":
      // 材料补正以后继记录追加，原任职记录保留。
      state.profiles.get(event.aggregate_id)?.employments.push({
        institution_id: p.institution_id,
        title: p.title,
        started_at: p.started_at,
        ended_at: p.ended_at ?? null,
        corrects: event.corrects ?? null,
      });
      break;
    case "CREDENTIAL_VERIFIED":
      state.profiles.get(event.aggregate_id)?.credential_assertions.push({
        credential_ref: p.credential_ref,
        verifier: p.verifier,
        assertion: p.assertion,
        verified_at: event.occurred_at,
      });
      break;
    case "INSTITUTION_REGISTERED":
      state.institutions.set(event.aggregate_id, {
        id: event.aggregate_id,
        current_name: p.name,
        names: [p.name],
        renames: [],
      });
      break;
    case "INSTITUTION_RENAMED": {
      const inst = state.institutions.get(event.aggregate_id);
      if (inst) {
        inst.renames.push({ former_name: p.former_name, current_name: p.current_name, effective_at: p.effective_at });
        for (const name of [p.former_name, p.current_name]) {
          if (name && !inst.names.includes(name)) inst.names.push(name);
        }
        inst.current_name = p.current_name;
      }
      break;
    }
    case "CONTRIBUTION_ATTESTED":
      state.contributions.set(event.aggregate_id, {
        id: event.aggregate_id,
        title: p.title,
        kind: p.kind,
        period: p.period,
        participants: (p.participants ?? []).map((x) => ({ ...x })),
        evidence: p.evidence ?? [],
        peer_attestations: p.peer_attestations ?? [],
        corrections: [],
      });
      break;
    case "ATTRIBUTION_CORRECTED":
      // 署名更正只追加更正记录，原始分工记录保持原样。
      state.contributions.get(event.aggregate_id)?.corrections.push({
        event_id: event.event_id,
        occurred_at: event.occurred_at,
        add_participants: p.add_participants ?? [],
        remove_participants: p.remove_participants ?? [],
        reason: p.reason,
        corrects: event.corrects ?? null,
      });
      break;
    case "NOMINATION_SUBMITTED":
      state.nominations.set(event.aggregate_id, {
        id: event.aggregate_id,
        award_category: p.award_category,
        scope: p.scope,
        nominee_profile_id: p.nominee_profile_id ?? null,
        nominee_name: p.nominee_name ?? null,
        nominee_institution_name: p.nominee_institution_name ?? null,
        contribution_ids: p.contribution_ids ?? [],
        recommending_institution_id: p.recommending_institution_id ?? null,
        opinion: p.opinion ?? null,
        merged_into: null,
        resolved_profile_id: null,
      });
      break;
    case "NOMINATION_MERGED": {
      const nomination = state.nominations.get(event.aggregate_id);
      if (nomination) {
        nomination.merged_into = p.into_nomination_id;
        nomination.resolved_profile_id = p.resolved_profile_id ?? null;
      }
      break;
    }
    case "CONSENT_GRANTED":
    case "CONSENT_WITHDRAWN": {
      const story = state.consents.get(event.aggregate_id) ?? { purposes: new Map() };
      const entry = story.purposes.get(p.purpose) ?? { status: "none", history: [] };
      entry.status = event.event_type === "CONSENT_GRANTED" ? "granted" : "withdrawn";
      entry.history.push({ status: entry.status, at: event.occurred_at, event_id: event.event_id });
      story.purposes.set(p.purpose, entry);
      state.consents.set(event.aggregate_id, story);
      break;
    }
    case "MEDIA_LICENSE_GRANTED":
    case "MEDIA_LICENSE_REVOKED": {
      const material = state.licenses.get(event.aggregate_id) ?? new Map();
      for (const channel of p.channels ?? []) {
        const entry = material.get(channel) ?? { status: "none", history: [] };
        entry.status = event.event_type === "MEDIA_LICENSE_GRANTED" ? "granted" : "revoked";
        entry.history.push({ status: entry.status, at: event.occurred_at, event_id: event.event_id });
        material.set(channel, entry);
      }
      state.licenses.set(event.aggregate_id, material);
      break;
    }
    case "STORY_REVIEWED":
      publication(state, event.aggregate_id).reviews.push({
        content_version: p.content_version,
        reviewer_kind: p.reviewer?.kind,
        reviewer_id: p.reviewer?.id,
        decision: p.decision,
        at: event.occurred_at,
      });
      break;
    case "STORY_RELEASED": {
      const pub = publication(state, event.aggregate_id);
      pub.kind = p.kind;
      pub.releases.push({
        content_version: p.content_version,
        channels: p.channels ?? [],
        purpose: p.purpose ?? null,
        references: p.references ?? {},
        supersedes: p.supersedes ?? null,
        corrects: event.corrects ?? null,
        at: event.occurred_at,
      });
      break;
    }
    case "VERIFICATION_DISCLOSED":
      state.disclosures.push({
        event_id: event.event_id,
        profile_id: event.aggregate_id,
        request_id: p.request_id,
        verifier: p.verifier,
        checks: p.checks ?? [],
        disclosed_fields: p.disclosed_fields ?? [],
        at: event.occurred_at,
      });
      break;
    default:
      break;
  }
}

function publication(state, id) {
  if (!state.publications.has(id)) {
    state.publications.set(id, { id, kind: null, reviews: [], releases: [] });
  }
  return state.publications.get(id);
}
