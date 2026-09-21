// 团队贡献署名：成果标明时间段与实际参与者；离职、退休、跨院合作的历史贡献保留；
// 贡献只来自实际参与，后来成员不能继承未参与事项；错署名以后继更正同步各渠道。

export function effectiveParticipants(contribution) {
  const removed = new Set();
  const added = new Map();
  for (const correction of contribution.corrections) {
    for (const r of correction.remove_participants) {
      removed.add(r.profile_id);
      added.delete(r.profile_id);
    }
    for (const a of correction.add_participants) {
      added.set(a.profile_id, a);
      removed.delete(a.profile_id);
    }
  }
  return [
    ...contribution.participants.filter((p) => !removed.has(p.profile_id) && !added.has(p.profile_id)),
    ...added.values(),
  ];
}

// 信用判定只看参与者名单与各自窗口，与现任团队身份无关；不传 at 表示任意时段参与过。
export function isCredited(state, profileId, contributionId, at) {
  const contribution = state.contributions.get(contributionId);
  if (!contribution) return false;
  return effectiveParticipants(contribution).some(
    (p) => p.profile_id === profileId && (at === undefined || withinWindow(p.window, at)),
  );
}

function withinWindow(window, at) {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  if (Date.parse(window.start) > t) return false;
  if (window.end != null && Date.parse(window.end) < t) return false;
  return true;
}

const KIND_BUCKETS = {
  leaderboard_page: "leaderboard_pages",
  patient_story: "patient_stories",
  media_material: "media_materials",
};

// 署名遗漏更正后，推荐医院立刻据此定位受影响的榜单页面、患者故事和媒体材料。
export function affectedByCorrection(state, correctionEvent) {
  const contributionId = correctionEvent.aggregate_id;
  const involved = new Set(
    [...(correctionEvent.payload?.add_participants ?? []), ...(correctionEvent.payload?.remove_participants ?? [])].map(
      (x) => x.profile_id,
    ),
  );
  const affected = { contribution_id: contributionId, leaderboard_pages: [], patient_stories: [], media_materials: [] };
  for (const pub of state.publications.values()) {
    const latest = pub.releases.at(-1);
    if (!latest) continue;
    const refs = latest.references ?? {};
    const touches =
      (refs.contribution_ids ?? []).includes(contributionId) ||
      (refs.nominee_ids ?? []).some((id) => involved.has(id));
    const bucket = KIND_BUCKETS[pub.kind];
    if (!touches || !bucket) continue;
    affected[bucket].push({
      publication_id: pub.id,
      channels: latest.channels,
      content_version: latest.content_version,
      released_at: latest.at,
    });
  }
  return affected;
}

// 面向各渠道的更正同步通知：以新版本重新发布，而不是改写已发布的历史版本。
export function correctionNotices(state, correctionEvent) {
  const affected = affectedByCorrection(state, correctionEvent);
  const notices = [];
  for (const [kind, bucket] of Object.entries(KIND_BUCKETS)) {
    for (const item of affected[bucket]) {
      notices.push({
        publication_id: item.publication_id,
        kind,
        channels: item.channels,
        action: "reissue_with_correction",
        correction_event: correctionEvent.event_id,
      });
    }
  }
  return notices;
}
