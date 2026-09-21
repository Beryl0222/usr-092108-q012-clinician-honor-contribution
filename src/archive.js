// 医者荣誉贡献档案：追加式事件重放与查询。
//
// 设计原则：
// - 事件不可变；重放只产出投影。更正由后继事件表达，原署名永久可查。
// - 团队成果只认“时间段 × 实际参与者”。后来加入、离职、退休、跨院合作
//   都按各自时间窗保留，任何人不能继承自己未参与的事项。
// - 患者授权按用途（评审/盛典/长期宣传）独立生效、独立撤回。
// - 外部核验只能看到白名单事实，且证据包显式声明不含完整病历。
import { CHANNEL_REQUIRED_PURPOSES, CHANNELS, VERIFICATION_FACT_ALLOWLIST } from "./catalog.js";

const parse = (value) => (value == null ? null : Date.parse(value));
const overlaps = (aFrom, aTo, bFrom, bTo) => {
  // 半开区间在日期粒度上判重叠；端点相等视为相接，也算覆盖同一点
  const start = Math.max(parse(aFrom), parse(bFrom));
  const end = Math.min(parse(aTo ?? "9999-12-31T23:59:59Z"), parse(bTo ?? "9999-12-31T23:59:59Z"));
  return start <= end;
};

class Archive {
  constructor(events = []) {
    this.violations = [];
    this.orgs = new Map();
    this.profiles = new Map();
    this.contributions = new Map();
    this.nominations = new Map();
    this.awards = new Map();
    this.consents = new Map();
    this.mediaLicenses = new Map();
    this.publications = new Map();
    this.corrections = new Map();
    this.verificationRequests = new Map();
    this.verificationPackets = new Map();

    for (const event of events) this.#apply(event);
  }

  #flag(code, event, message, related) {
    this.violations.push({ code, event_id: event?.event_id ?? null, message, related: related ?? null });
  }

  #requireProfile(profileId, event) {
    if (!this.profiles.has(profileId)) {
      this.#flag("unknown_profile", event, `引用了未登记的候选：${profileId}`);
      return null;
    }
    return this.profiles.get(profileId);
  }

  // 身份归并：沿 merged_into 链找到规范档案
  canonicalProfileId(profileId) {
    let current = profileId;
    const seen = new Set();
    while (current) {
      if (seen.has(current)) return current; // 成环时停在当前，环本身在建档时已记录违规
      seen.add(current);
      const profile = this.profiles.get(current);
      if (!profile || !profile.merged_into) return current;
      current = profile.merged_into;
    }
    return current;
  }

  #apply(event) {
    const p = event.payload ?? {};
    switch (event.event_type) {
      case "ORG_REGISTERED":
        this.orgs.set(p.org_id, { org_id: p.org_id, org_name: p.org_name, rename_history: [] });
        break;
      case "ORG_RENAMED": {
        const org = this.orgs.get(p.org_id);
        if (!org) return this.#flag("unknown_org", event, `机构未登记即更名：${p.org_id}`);
        org.rename_history.push({ previous_name: p.previous_name, new_name: p.new_name, effective_at: p.effective_at });
        org.org_name = p.new_name; // 当前名随事件推进；历史名在 rename_history 与任职快照中保留
        break;
      }
      case "PROFILE_REGISTERED":
        if (this.profiles.has(p.profile_id)) this.#flag("duplicate_profile", event, `候选重复建档：${p.profile_id}`);
        this.profiles.set(p.profile_id, {
          profile_id: p.profile_id,
          profile_kind: p.profile_kind,
          canonical_name: p.canonical_name,
          name_variants: new Set(p.name_variants ?? []),
          member_profile_ids: new Set(p.member_profile_ids ?? []),
          merged_into: null,
          merge_reason: null,
          tenures: [],
          licenses: [],
          memberships: [],
        });
        break;
      case "IDENTITY_MERGED": {
        if (p.canonical_profile_id === p.merged_profile_id) {
          return this.#flag("identity_merge_self", event, "不能将候选归并到自身");
        }
        const canonical = this.#requireProfile(p.canonical_profile_id, event);
        const merged = this.#requireProfile(p.merged_profile_id, event);
        if (!canonical || !merged) break;
        if (canonical.merged_into) {
          this.#flag("identity_merge_chain", event, `归并目标本身已被归并：${p.canonical_profile_id}`);
        }
        if (merged.merged_into) {
          this.#flag("identity_remerge", event, `候选已归并过：${p.merged_profile_id}`, merged.merged_into);
        }
        merged.merged_into = p.canonical_profile_id;
        merged.merge_reason = p.reason;
        for (const variant of merged.name_variants) canonical.name_variants.add(variant);
        canonical.name_variants.add(merged.canonical_name);
        break;
      }
      case "TENURE_RECORDED": {
        const profile = this.#requireProfile(p.person_profile_id, event);
        if (!profile) break;
        profile.tenures.push({
          org_id: p.org_id,
          org_name_snapshot: p.org_name_snapshot, // 记录当时的机构名，更名不回改
          started_at: p.started_at,
          ended_at: p.ended_at ?? null,
          status: p.status,
          role_title: p.role_title ?? null,
        });
        break;
      }
      case "TEAM_MEMBERSHIP_RECORDED": {
        const team = this.#requireProfile(p.team_profile_id, event);
        const member = this.#requireProfile(p.member_profile_id, event);
        if (!team || !member) break;
        if (team.profile_kind !== "team") this.#flag("membership_on_non_team", event, `成员关系挂在非团队候选上：${p.team_profile_id}`);
        team.memberships.push({
          member_profile_id: p.member_profile_id,
          participated_from: p.participated_from,
          participated_to: p.participated_to ?? null,
          role: p.role ?? null,
        });
        team.member_profile_ids.add(p.member_profile_id);
        break;
      }
      case "LICENSE_VERIFIED": {
        const profile = this.#requireProfile(p.person_profile_id, event);
        if (!profile) break;
        profile.licenses.push({
          license_no_masked: p.license_no_masked,
          specialty: p.specialty,
          status: p.status,
          verified_by: p.verified_by,
          verified_at: p.verified_at ?? null,
        });
        break;
      }
      case "CONTRIBUTION_ATTESTED": {
        this.contributions.set(p.contribution_id, {
          contribution_id: p.contribution_id,
          title: p.title,
          categories: [...p.categories],
          period_from: p.period_from,
          period_to: p.period_to,
          participants: p.participants.map((x) => ({ ...x })),
          org_ids: [...(p.org_ids ?? [])],
          evidence_refs: [...(p.evidence_refs ?? [])],
          endorsements: [],
        });
        this.#checkParticipantWindows(event, p.contribution_id, p.participants, p.period_from, p.period_to, null);
        break;
      }
      case "PEER_ENDORSED": {
        const contribution = this.contributions.get(p.contribution_id);
        if (!contribution) return this.#flag("unknown_contribution", event, `同行证明指向不存在的贡献：${p.contribution_id}`);
        contribution.endorsements.push({
          endorser_name: p.endorser_name,
          endorser_org_id: p.endorser_org_id,
          statement_ref: p.statement_ref,
          endorsed_at: p.endorsed_at ?? null,
        });
        break;
      }
      case "NOMINATION_SUBMITTED": {
        this.#requireProfile(p.profile_id, event);
        this.nominations.set(p.nomination_id, {
          nomination_id: p.nomination_id,
          profile_id: p.profile_id,
          track: p.track,
          award_category: p.award_category,
          recommending_org_id: p.recommending_org_id,
          contribution_ids: [...(p.contribution_ids ?? [])],
          recommendation_statement_ref: p.recommendation_statement_ref ?? null,
          status: "submitted",
          amendments: [],
          merged_nomination_ids: [],
        });
        break;
      }
      case "NOMINATION_AMENDED": {
        const nomination = this.nominations.get(p.nomination_id);
        if (!nomination) return this.#flag("unknown_nomination", event, `补正指向不存在的推荐：${p.nomination_id}`);
        nomination.status = "amended";
        nomination.amendments.push({ note: p.amendment_note, changed_fields: [...(p.changed_fields ?? [])], at: p.amended_at ?? null });
        break;
      }
      case "NOMINATION_CONSOLIDATED": {
        const kept = this.nominations.get(p.kept_nomination_id);
        if (!kept) return this.#flag("unknown_nomination", event, `归并保留的推荐不存在：${p.kept_nomination_id}`);
        for (const mergedId of p.merged_nomination_ids) {
          const merged = this.nominations.get(mergedId);
          if (!merged) {
            this.#flag("unknown_nomination", event, `被归并的推荐不存在：${mergedId}`);
            continue;
          }
          merged.status = "consolidated";
          merged.merged_into = p.kept_nomination_id;
          kept.merged_nomination_ids.push(mergedId);
        }
        kept.consolidation_reason = p.reason;
        break;
      }
      case "AWARD_GRANTED": {
        this.#requireProfile(p.profile_id, event);
        this.awards.set(p.award_id, {
          award_id: p.award_id,
          profile_id: p.profile_id,
          track: p.track,
          award_category: p.award_category,
          period_from: p.period_from,
          period_to: p.period_to,
          participants: p.participants.map((x) => ({ ...x })),
          contribution_ids: [...(p.contribution_ids ?? [])],
        });
        this.#checkParticipantWindows(event, p.award_id, p.participants, p.period_from, p.period_to, p.track === "team" ? p.profile_id : null);
        break;
      }
      case "CONSENT_GRANTED": {
        const existing = this.consents.get(p.consent_id);
        if (existing) return this.#flag("duplicate_consent", event, `同意标识重复：${p.consent_id}`);
        this.consents.set(p.consent_id, {
          consent_id: p.consent_id,
          patient_pseudonym: p.patient_pseudonym,
          statement_version: p.statement_version,
          story_id: p.story_id ?? null,
          granted: new Set(p.purposes),
          withdrawn: new Set(),
          history: [{ kind: "granted", purposes: [...p.purposes], at: p.granted_at }],
        });
        break;
      }
      case "CONSENT_WITHDRAWN": {
        const consent = this.consents.get(p.consent_id);
        if (!consent) return this.#flag("unknown_consent", event, `撤回指向不存在的授权：${p.consent_id}`);
        for (const purpose of p.purposes) {
          if (!consent.granted.has(purpose) || consent.withdrawn.has(purpose)) {
            this.#flag("consent_withdrawal_invalid", event, `用途 ${purpose} 未处于有效授权状态，无法撤回`);
          }
          consent.withdrawn.add(purpose);
        }
        consent.history.push({ kind: "withdrawn", purposes: [...p.purposes], at: p.withdrawn_at, reason: p.reason ?? null });
        break;
      }
      case "MEDIA_LICENSE_GRANTED": {
        this.mediaLicenses.set(p.license_id, {
          license_id: p.license_id,
          licensor_role: p.licensor_role,
          channels: new Set(p.channels),
          material_refs: [...(p.material_refs ?? [])],
          granted_from: p.granted_from,
          granted_to: p.granted_to ?? null,
          revoked: new Set(),
        });
        break;
      }
      case "MEDIA_LICENSE_REVOKED": {
        const license = this.mediaLicenses.get(p.license_id);
        if (!license) return this.#flag("unknown_media_license", event, `许可不存在：${p.license_id}`);
        for (const channel of p.channels) {
          if (!license.channels.has(channel)) this.#flag("media_revoke_outside_scope", event, `渠道 ${channel} 从未被该许可覆盖`);
          license.revoked.add(channel);
        }
        break;
      }
      case "PUBLICATION_PREPARED": {
        let story = this.publications.get(p.story_id);
        if (!story) {
          story = { story_id: p.story_id, nomination_id: p.nomination_id, versions: new Map(), latest_version: 0 };
          this.publications.set(p.story_id, story);
        }
        if (story.versions.has(p.version)) this.#flag("duplicate_story_version", event, `公开版本号重复：${p.story_id} v${p.version}`);
        story.versions.set(p.version, {
          version: p.version,
          channel_targets: new Set(p.channel_targets),
          attribution_entries: p.attribution_entries.map((x) => ({ ...x })),
          consent_ids: [...(p.consent_ids ?? [])],
          media_license_ids: [...(p.media_license_ids ?? [])],
          contribution_ids: [...(p.contribution_ids ?? [])],
          award_ids: [...(p.award_ids ?? [])],
          patient_story_included: p.patient_story_included ?? false,
          approvals: [],
          released_channels: new Set(),
          release_log: [], // { channel, released_at }：渠道可能先发布、再下架、再随新版发布
          released_at: null,
          takedowns: new Map(),
        });
        story.latest_version = Math.max(story.latest_version, p.version);
        break;
      }
      case "PUBLICATION_APPROVED": {
        const version = this.#storyVersion(event, p.story_id, p.version);
        if (!version) break;
        const prior = version.approvals.find((a) => a.reviewer_kind === p.reviewer_kind);
        if (prior) this.#flag("duplicate_approval", event, `${p.reviewer_kind} 对同一版本重复核对：${p.story_id} v${p.version}`);
        version.approvals.push({ reviewer_kind: p.reviewer_kind, approved: p.approved, note: p.review_note ?? null, at: p.reviewed_at ?? null });
        break;
      }
      case "STORY_RELEASED": {
        const version = this.#storyVersion(event, p.story_id, p.version);
        if (!version) break;
        const approvedKinds = new Set(version.approvals.filter((a) => a.approved).map((a) => a.reviewer_kind));
        for (const channel of p.channels) {
          if (!version.channel_targets.has(channel)) {
            this.#flag("release_outside_targets", event, `渠道 ${channel} 不在该版本的发布目标中`);
          }
          if (!approvedKinds.has("hospital") || !approvedKinds.has("candidate")) {
            this.#flag("release_without_dual_approval", event, `渠道 ${channel} 在医院与候选人共同核对前发布`);
          }
          if (version.patient_story_included) {
            for (const purpose of CHANNEL_REQUIRED_PURPOSES[channel] ?? []) {
              if (!this.#consentActiveForVersion(version, purpose, p.released_at)) {
                this.#flag("release_without_consent", event, `渠道 ${channel} 发布时缺少用途 ${purpose} 的患者授权`);
              }
            }
          }
          for (const licenseId of version.media_license_ids) {
            const license = this.mediaLicenses.get(licenseId);
            if (!license) {
              this.#flag("release_with_unknown_license", event, `引用了不存在的媒体许可：${licenseId}`);
              continue;
            }
            if (license.channels.has(channel) && license.revoked.has(channel)) {
              this.#flag("release_with_revoked_license", event, `渠道 ${channel} 的媒体许可已撤销：${licenseId}`);
            }
          }
          version.released_channels.add(channel);
          version.release_log.push({ kind: "release", channel, at: p.released_at });
        }
        version.released_at = p.released_at;
        break;
      }
      case "STORY_CHANNEL_TAKEN_DOWN": {
        const story = this.publications.get(p.story_id);
        if (!story) return this.#flag("unknown_story", event, `下架指向不存在的公开版本：${p.story_id}`);
        // 下架针对的是“当时在播”的版本（可能不是最新版本号）。
        const liveVersion = [...story.versions.values()].find((v) => this.#versionLiveAt(v, p.taken_down_at).has(p.channel));
        if (!liveVersion) {
          return this.#flag("takedown_not_live", event, `渠道 ${p.channel} 在 ${p.taken_down_at} 并非在播：${p.story_id}`);
        }
        liveVersion.release_log.push({ kind: "takedown", channel: p.channel, at: p.taken_down_at });
        liveVersion.takedowns.set(p.channel, { at: p.taken_down_at, reason: p.reason });
        liveVersion.released_channels.delete(p.channel);
        break;
      }
      case "ATTRIBUTION_CORRECTED":
        this.corrections.set(p.correction_id, {
          correction_id: p.correction_id,
          scope: p.scope,
          error_kind: p.error_kind,
          target_id: p.target_id ?? null,
          original_event_id: p.original_event_id,
          attribution_after: p.attribution_after.map((x) => ({ ...x })),
          corrected_at: p.corrected_at,
          note: p.note ?? null,
          propagations: [],
        });
        this.#checkCorrection(event, p);
        break;
      case "CORRECTION_PROPAGATED": {
        const correction = this.corrections.get(p.correction_id);
        if (!correction) return this.#flag("unknown_correction", event, `同步指向不存在的更正：${p.correction_id}`);
        correction.propagations.push({
          story_id: p.story_id,
          channel: p.channel,
          status: p.status,
          synced_at: p.synced_at ?? null,
          detail: p.detail ?? null,
        });
        break;
      }
      case "VERIFICATION_REQUESTED":
        this.verificationRequests.set(p.request_id, {
          request_id: p.request_id,
          requested_by: p.requested_by,
          target_profile_id: p.target_profile_id ?? null,
          facts_needed: new Set(p.facts_needed),
          reason: p.reason ?? null,
        });
        break;
      case "VERIFICATION_PACKET_ISSUED": {
        const request = this.verificationRequests.get(p.request_id);
        if (!request) return this.#flag("unknown_verification_request", event, `证据包对应不存在的核验请求：${p.request_id}`);
        for (const fact of p.facts) {
          if (!VERIFICATION_FACT_ALLOWLIST.includes(fact.fact_key)) {
            this.#flag("verification_fact_not_allowlisted", event, `证据超出最小核验白名单：${fact.fact_key}`);
          }
          if (!request.facts_needed.has(fact.fact_key)) {
            this.#flag("verification_overdisclosure", event, `提供了未被请求的事实：${fact.fact_key}（外部核验只给必要证据）`);
          }
        }
        if (p.contains_full_medical_record !== false) {
          this.#flag("medical_record_in_packet", event, "证据包不得包含完整病历");
        }
        this.verificationPackets.set(p.packet_id, {
          packet_id: p.packet_id,
          request_id: p.request_id,
          target_profile_id: p.target_profile_id,
          facts: p.facts.map((f) => ({ ...f })),
          contains_full_medical_record: p.contains_full_medical_record,
          verifications: [],
        });
        break;
      }
      case "FACT_VERIFIED": {
        const packet = this.verificationPackets.get(p.packet_id);
        if (!packet) return this.#flag("unknown_packet", event, `核验结果指向不存在的证据包：${p.packet_id}`);
        if (!packet.facts.some((f) => f.fact_key === p.fact_key)) {
          this.#flag("verification_result_without_fact", event, `核验了证据包中不存在的事实：${p.fact_key}`);
        }
        packet.verifications.push({ fact_key: p.fact_key, result: p.result, verified_at: p.verified_at ?? null });
        break;
      }
      default:
        this.#flag("unhandled_event", event, `重放器未处理事件类型：${event.event_type}`);
    }
  }

  #storyVersion(event, storyId, versionNo) {
    const story = this.publications.get(storyId);
    const version = story?.versions.get(versionNo);
    if (!version) this.#flag("unknown_story", event, `公开版本不存在：${storyId} v${versionNo}`);
    return version ?? null;
  }

  // 判定参与者的时间窗是否覆盖成果时段。
  // teamProfileId 非空时（团队奖项），还必须能在团队成员关系中找到重叠窗口——
  // 这是“后来成员不能继承未参与事项”的硬性落点。
  #checkParticipantWindows(event, targetId, participants, periodFrom, periodTo, teamProfileId) {
    for (const entry of participants) {
      if (entry.participated_from && !overlaps(entry.participated_from, entry.participated_to, periodFrom, periodTo)) {
        this.#flag(
          "participant_outside_window",
          event,
          `${targetId} 的参与者 ${entry.profile_id}（${entry.role}）时间窗与成果时段不重叠`,
        );
      }
      if (teamProfileId) {
        const canonical = this.canonicalProfileId(entry.profile_id);
        const team = this.profiles.get(teamProfileId);
        const membership = team?.memberships.find(
          (m) => this.canonicalProfileId(m.member_profile_id) === canonical && overlaps(m.participated_from, m.participated_to, periodFrom, periodTo),
        );
        if (!membership) {
          this.#flag(
            "team_award_unverified_member",
            event,
            `团队奖项 ${targetId} 的参与者 ${entry.profile_id} 在 ${periodFrom}~${periodTo} 没有团队参与记录，不能因后来加入而署名`,
          );
        }
      }
    }
  }

  #checkCorrection(event, p) {
    // 更正不能凭空创造：更正后的署名仍须通过原始成果的时间窗检验，
    // 且原事件必须存在（更正追加在其后，绝不删除或改写原记录）。
    let period = null;
    let teamProfileId = null;
    if (p.scope === "contribution") {
      const target = this.contributions.get(p.target_id);
      if (!target) return this.#flag("correction_unknown_target", event, `更正指向不存在的贡献：${p.target_id}`);
      period = [target.period_from, target.period_to];
    } else if (p.scope === "award") {
      const target = this.awards.get(p.target_id);
      if (!target) return this.#flag("correction_unknown_target", event, `更正指向不存在的奖项：${p.target_id}`);
      period = [target.period_from, target.period_to];
      teamProfileId = target.track === "team" ? target.profile_id : null;
    } else {
      const story = this.publications.get(p.target_id);
      if (!story) return this.#flag("correction_unknown_target", event, `更正指向不存在的公开版本：${p.target_id}`);
    }
    if (period) this.#checkParticipantWindows(event, p.target_id ?? p.correction_id, p.attribution_after, period[0], period[1], teamProfileId);
  }

  #consentActiveForVersion(version, purpose, at) {
    const when = parse(at);
    for (const consentId of version.consent_ids) {
      const consent = this.consents.get(consentId);
      if (!consent) continue;
      if (consent.granted.has(purpose) && !consent.withdrawn.has(purpose)) {
        if (parse(consent.history[0].at) <= when) return true;
      }
    }
    return false;
  }

  // 某版本在指定时点（含）前，哪些渠道处于在播：重放 release/takedown 日志。
  #versionLiveAt(version, at) {
    const when = parse(at);
    const live = new Set();
    for (const entry of [...version.release_log].sort((a, b) => parse(a.at) - parse(b.at))) {
      if (parse(entry.at) > when) break;
      if (entry.kind === "release") live.add(entry.channel);
      else live.delete(entry.channel);
    }
    return live;
  }

  #storyReferencesTarget(story, scope, targetId) {
    for (const version of story.versions.values()) {
      if (scope === "contribution" && version.contribution_ids.includes(targetId)) return true;
      if (scope === "award" && version.award_ids.includes(targetId)) return true;
    }
    if (scope === "publication" && story.story_id === targetId) return true;
    return false;
  }

  // —— 查询面 ——

  // 错署名更正发生后，推荐医院立刻需要知道：在“更正时点”哪些榜单页、患者故事、
  // 媒体材料（及盛典归档）在播且引用了受影响成果、各渠道同步到哪一步。
  // 已下架/被新版取代的渠道不计入即时影响面，但传播记录仍完整保留。
  channelsAffectedByCorrection(correctionId) {
    const correction = this.corrections.get(correctionId);
    if (!correction) return [];
    const affected = [];
    for (const story of this.publications.values()) {
      if (!this.#storyReferencesTarget(story, correction.scope, correction.target_id)) continue;
      for (const version of story.versions.values()) {
        for (const channel of this.#versionLiveAt(version, correction.corrected_at)) {
          const propagation = correction.propagations
            .filter((pr) => pr.story_id === story.story_id && pr.channel === channel)
            .sort((a, b) => parse(b.synced_at ?? "") - parse(a.synced_at ?? ""))[0];
          affected.push({
            story_id: story.story_id,
            version: version.version,
            channel,
            sync_status: propagation?.status ?? "pending",
            synced_at: propagation?.synced_at ?? null,
          });
        }
      }
    }
    return affected;
  }

  // 患者撤回某种传播用途后，在“撤回时点”仍承载该叙事的在播渠道，需立即下架或替换。
  // 按用途分别判定：只撤回长期宣传，不影响评审与盛典。
  channelsAffectedByConsentWithdrawal(consentId) {
    const consent = this.consents.get(consentId);
    if (!consent) return [];
    const withdrawals = consent.history.filter((h) => h.kind === "withdrawn").sort((a, b) => parse(a.at) - parse(b.at));
    if (!withdrawals.length) return [];
    const withdrawnAt = withdrawals.at(-1).at;
    const affected = [];
    for (const story of this.publications.values()) {
      for (const version of story.versions.values()) {
        if (!version.patient_story_included || !version.consent_ids.includes(consentId)) continue;
        for (const channel of this.#versionLiveAt(version, withdrawnAt)) {
          const required = CHANNEL_REQUIRED_PURPOSES[channel] ?? [];
          const blocking = required.filter((purpose) => consent.withdrawn.has(purpose));
          if (blocking.length) {
            affected.push({ story_id: story.story_id, version: version.version, channel, withdrawn_purposes: blocking });
          }
        }
      }
    }
    return affected;
  }

  // 某贡献/奖项的有效署名：原署名 + 是否已有后继更正（两者都保留，不覆盖历史）。
  effectiveAttribution(scope, targetId) {
    const target = scope === "contribution" ? this.contributions.get(targetId) : this.awards.get(targetId);
    if (!target) return null;
    const corrections = [...this.corrections.values()]
      .filter((c) => c.scope === scope && c.target_id === targetId)
      .sort((a, b) => parse(a.corrected_at) - parse(b.corrected_at));
    const latest = corrections.at(-1) ?? null;
    return {
      scope,
      target_id: targetId,
      period: { from: target.period_from, to: target.period_to },
      original: target.participants.map((x) => ({ ...x })),
      current: (latest?.attribution_after ?? target.participants).map((x) => ({ ...x })),
      corrected_by: latest?.correction_id ?? null,
      correction_history: corrections.map((c) => ({
        correction_id: c.correction_id,
        error_kind: c.error_kind,
        corrected_at: c.corrected_at,
        note: c.note,
      })),
    };
  }

  // 候选汇总视图：身份归并、任职时间线、团队参与窗、贡献、推荐与奖项。
  nomineeView(profileId) {
    const canonicalId = this.canonicalProfileId(profileId);
    const canonical = this.profiles.get(canonicalId);
    if (!canonical) return null;

    const aliases = [...this.profiles.values()]
      .filter((p) => this.canonicalProfileId(p.profile_id) === canonicalId && p.profile_id !== canonicalId)
      .map((p) => ({ profile_id: p.profile_id, name: p.canonical_name, reason: p.merge_reason }));

    const same = (id) => this.canonicalProfileId(id) === canonicalId;
    const personParticipation = (entries) =>
      entries
        .filter((e) => same(e.profile_id))
        .map((e) => ({ profile_id: this.canonicalProfileId(e.profile_id), role: e.role, window: { from: e.participated_from ?? null, to: e.participated_to ?? null } }));

    const teams = canonical.profile_kind === "team"
      ? canonical.memberships.map((m) => ({
          member_profile_id: this.canonicalProfileId(m.member_profile_id),
          role: m.role,
          window: { from: m.participated_from, to: m.participated_to },
        }))
      : [...this.profiles.values()]
          .filter((p) => p.profile_kind === "team")
          .flatMap((team) =>
            team.memberships
              .filter((m) => same(m.member_profile_id))
              .map((m) => ({ team_profile_id: team.profile_id, role: m.role, window: { from: m.participated_from, to: m.participated_to } })),
          );

    return {
      canonical_profile_id: canonicalId,
      canonical_name: canonical.canonical_name,
      profile_kind: canonical.profile_kind,
      name_variants: [...canonical.name_variants],
      aliases,
      tenures: canonical.tenures.map((t) => ({ ...t })),
      current_licenses: canonical.licenses.filter((l) => l.status === "valid"),
      team_participation: teams,
      contributions: [...this.contributions.values()]
        .filter((c) => c.participants.some((e) => same(e.profile_id)))
        .map((c) => ({
          contribution_id: c.contribution_id,
          title: c.title,
          categories: c.categories,
          period: { from: c.period_from, to: c.period_to },
          my_participation: personParticipation(c.participants),
        })),
      nominations: [...this.nominations.values()]
        .filter((n) => same(n.profile_id))
        .map((n) => ({
          nomination_id: n.nomination_id,
          track: n.track,
          award_category: n.award_category,
          status: n.status,
          recommending_org_id: n.recommending_org_id,
          amendments: n.amendments.length,
          merged_nomination_ids: n.merged_nomination_ids,
        })),
      awards: [...this.awards.values()]
        .filter((a) => same(a.profile_id) || a.participants.some((e) => same(e.profile_id)))
        .map((a) => ({
          award_id: a.award_id,
          award_category: a.award_category,
          period: { from: a.period_from, to: a.period_to },
          my_participation: personParticipation(a.participants),
        })),
    };
  }

  // 机构视图：现名 + 更名链 + 在该机构各段任职（保留离职/退休者的原贡献段）。
  orgView(orgId) {
    const org = this.orgs.get(orgId);
    if (!org) return null;
    const tenures = [];
    for (const profile of this.profiles.values()) {
      for (const t of profile.tenures) {
        if (t.org_id === orgId) {
          tenures.push({
            profile_id: this.canonicalProfileId(profile.profile_id),
            name: profile.canonical_name,
            org_name_at_then: t.org_name_snapshot,
            role_title: t.role_title,
            started_at: t.started_at,
            ended_at: t.ended_at,
            status: t.status,
          });
        }
      }
    }
    return { org_id: org.org_id, current_name: org.org_name, rename_history: org.rename_history, tenures };
  }

  // 公开版本视图：版本、医院/候选人核对、在播渠道、待同步更正。
  publicationView(storyId) {
    const story = this.publications.get(storyId);
    if (!story) return null;
    const pendingCorrections = [...this.corrections.values()]
      .filter((c) => this.#storyReferencesTarget(story, c.scope, c.target_id))
      .map((c) => ({ correction_id: c.correction_id, error_kind: c.error_kind, scope: c.scope, target_id: c.target_id }));
    return {
      story_id: story.story_id,
      nomination_id: story.nomination_id,
      latest_version: story.latest_version,
      versions: [...story.versions.values()].map((v) => ({
        version: v.version,
        channel_targets: [...v.channel_targets],
        approvals: v.approvals.map((a) => ({ ...a })),
        live_channels: [...v.released_channels],
        takedowns: [...v.takedowns.entries()].map(([channel, x]) => ({ channel, ...x })),
      })),
      pending_corrections: pendingCorrections,
    };
  }

  // 外部核验视图：只回白名单事实与结论，供主办方在不接触完整病历的情况下验证关键事实。
  verificationView(packetId) {
    const packet = this.verificationPackets.get(packetId);
    if (!packet) return null;
    return {
      packet_id: packet.packet_id,
      request_id: packet.request_id,
      target_profile_id: packet.target_profile_id,
      contains_full_medical_record: false,
      facts: packet.facts.map((f) => ({ fact_key: f.fact_key, result: f.result, evidence_ref: f.evidence_ref ?? null })),
    };
  }

  // 同一规范候选下的重复推荐（归并前后都能查）。
  duplicateNominations(profileId) {
    const canonicalId = this.canonicalProfileId(profileId);
    return [...this.nominations.values()]
      .filter((n) => this.canonicalProfileId(n.profile_id) === canonicalId)
      .map((n) => ({
        nomination_id: n.nomination_id,
        award_category: n.award_category,
        track: n.track,
        status: n.status,
        recommending_org_id: n.recommending_org_id,
        merged_into: n.merged_into ?? null,
      }));
  }
}

export function replay(events) {
  return new Archive(events);
}

export { CHANNELS };
