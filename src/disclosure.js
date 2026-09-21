// 对外核验的最小必要披露：主办方不接触完整病历，只拿到验证关键事实所需的断言。

import { effectiveParticipants } from "./attribution.js";

export function discloseForVerification(state, request) {
  const { verifier, profile_id, checks = [], contribution_id } = request;
  const profile = state.profiles.get(profile_id);
  if (!profile) return { verifier, profile_id, found: false };
  const result = { verifier, profile_id, found: true, checks: {} };
  if (checks.includes("credential")) {
    result.checks.credential = {
      verified: profile.credential_assertions.length > 0,
      assertions: profile.credential_assertions.map((a) => ({
        assertion: a.assertion,
        verifier: a.verifier,
        verified_at: a.verified_at,
      })),
    };
  }
  if (checks.includes("employment")) {
    result.checks.employment = profile.employments.map((e) => ({
      institution_id: e.institution_id,
      title: e.title,
      started_at: e.started_at,
      ended_at: e.ended_at ?? null,
    }));
  }
  if (checks.includes("participation")) {
    const contribution = contribution_id ? state.contributions.get(contribution_id) : null;
    const participant = contribution
      ? effectiveParticipants(contribution).find((p) => p.profile_id === profile_id)
      : null;
    result.checks.participation = participant
      ? { contribution_id, credited: true, role: participant.role, window: participant.window }
      : { contribution_id: contribution_id ?? null, credited: false };
  }
  return result;
}
