// 患者同意按传播用途分别授予、分别撤回：评审、盛典、长期宣传互不影响。

export const CONSENT_PURPOSES = ["review", "ceremony", "long_term_publicity"];

export function consentStatus(state, storyRef) {
  const entry = state.consents.get(storyRef);
  const status = {};
  for (const purpose of CONSENT_PURPOSES) {
    status[purpose] = entry?.purposes.get(purpose)?.status ?? "none";
  }
  return status;
}

export function isUseAuthorized(state, storyRef, purpose) {
  return state.consents.get(storyRef)?.purposes.get(purpose)?.status === "granted";
}

// 某种用途被撤回后，仍在以该用途传播此患者故事的公开版本需要下线。
export function affectedByWithdrawal(state, storyRef, purpose) {
  const affected = [];
  for (const pub of state.publications.values()) {
    const latest = pub.releases.at(-1);
    if (!latest || latest.purpose !== purpose) continue;
    if (!(latest.references?.story_refs ?? []).includes(storyRef)) continue;
    affected.push({
      publication_id: pub.id,
      kind: pub.kind,
      channels: latest.channels,
      content_version: latest.content_version,
    });
  }
  return affected;
}
