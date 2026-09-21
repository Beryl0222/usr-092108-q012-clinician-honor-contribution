// 身份归并：姓名异体、机构更名、重复推荐、材料补正都指向同一候选。

export function resolveInstitutionId(state, name) {
  for (const inst of state.institutions.values()) {
    if (inst.current_name === name || inst.names.includes(name)) return inst.id;
  }
  return null;
}

export function canonicalProfileId(state, profileId) {
  let current = state.profiles.get(profileId);
  const seen = new Set();
  while (current?.merged_into && !seen.has(current.id)) {
    seen.add(current.id);
    current = state.profiles.get(current.merged_into);
  }
  return current?.id ?? null;
}

export function resolveNomineeId(state, { name, institution_name } = {}) {
  const institutionId = institution_name ? resolveInstitutionId(state, institution_name) : null;
  if (institution_name && !institutionId) return null;
  for (const profile of state.profiles.values()) {
    const nameMatch = profile.canonical_name === name || profile.variants.has(name);
    if (!nameMatch) continue;
    if (institutionId && !profile.employments.some((e) => e.institution_id === institutionId)) continue;
    return canonicalProfileId(state, profile.id);
  }
  return null;
}

export function canonicalNominationId(state, nominationId) {
  let current = state.nominations.get(nominationId);
  const seen = new Set();
  while (current?.merged_into && !seen.has(current.id)) {
    seen.add(current.id);
    current = state.nominations.get(current.merged_into);
  }
  return current?.id ?? null;
}
