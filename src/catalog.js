// 医者荣誉贡献档案：事件类型、聚合类型与枚举的单一事实源。
// schema、校验器与测试都从这里取枚举，避免多处漂移。

export const AGGREGATE_TYPES = [
  "org_record", // 机构（含更名历史）
  "nominee_profile", // 候选：医者个人或团队
  "contribution_record", // 贡献事实：临床、专科建设、公益、多机构合作
  "nomination", // 推荐（个人/团队两条通道）
  "award", // 授予的奖项与实际获奖者
  "consent_grant", // 患者叙事授权（按用途分别授予/撤回）
  "media_license", // 媒体材料许可
  "public_story", // 公开版本及其在各渠道的发布
  "verification_packet", // 面向外部核验的最小证据包
];

// 渠道：错署名更正要逐渠道同步
export const CHANNELS = [
  "honor_roll_page", // 榜单页面
  "patient_story", // 患者故事
  "media_kit", // 媒体材料
  "ceremony", // 盛典现场材料
];

// 患者叙事的三类用途，授权范围彼此独立，可分别撤回
export const CONSENT_PURPOSES = [
  "review", // 评审
  "ceremony", // 盛典
  "long_term_publicity", // 长期宣传
];

// 渠道发布时，若内容含可识别患者的叙事，所需的患者授权用途
export const CHANNEL_REQUIRED_PURPOSES = {
  honor_roll_page: ["long_term_publicity"],
  patient_story: ["long_term_publicity"],
  media_kit: ["long_term_publicity"],
  ceremony: ["ceremony"],
};

export const PROFILE_KINDS = ["individual", "team"];
export const NOMINATION_TRACKS = ["individual", "team"];

export const CONTRIBUTION_CATEGORIES = [
  "clinical", // 临床
  "specialty_building", // 专科建设
  "public_charity", // 公益
  "multi_institution", // 多机构合作
];

export const TENURE_STATUS = ["active", "departed", "retired"]; // 在职 / 离职 / 退休

export const AWARD_CATEGORIES = [
  "clinical_achievement", // 临床成就
  "specialty_building", // 专科建设
  "public_service", // 公益服务
  "team_collaboration", // 团队协作
  "lifetime_achievement", // 终身荣誉
];

export const IDENTITY_MERGE_REASONS = [
  "name_variant", // 姓名异体（曾用名、简写、同音误录）
  "org_renamed", // 机构更名导致的重复建档
  "duplicate_nomination", // 重复推荐
  "data_fix", // 其他材料补正类归并
];

export const NOMINATION_STATUS = [
  "submitted",
  "amended", // 材料补正
  "consolidated", // 已与重复推荐归并
  "accepted",
  "rejected",
];

export const ATTRIBUTION_ERROR_KINDS = [
  "omitted_member", // 署名遗漏
  "wrong_member", // 错列未参与者
  "role_misstated", // 角色/分工表述错误
  "name_variant", // 姓名异体未归一
  "org_misstated", // 机构表述错误
];

export const CORRECTION_SCOPES = ["contribution", "award", "publication"];

export const PROPAGATION_STATUS = ["pending", "synced", "failed"];

export const REVIEWER_KINDS = ["hospital", "candidate"];

// 外部核验可索取的事实键白名单：只放验证关键事实所必需的项
export const VERIFICATION_FACT_ALLOWLIST = [
  "license_status", // 执业资质是否有效
  "license_specialty", // 执业专科类别
  "tenure_at_org", // 某时间段是否在某机构任职
  "team_participation_window", // 是否在某时间段实际参与团队项目
  "award_was_granted", // 奖项是否真实授予
  "charity_record_exists", // 公益记录是否存在（不含病情）
];

// 任何事件载荷中都禁止出现的字段：
// 系统只记录事实，不按病例数等自动评断医德/医术，也不接收完整病历。
export const FORBIDDEN_PAYLOAD_KEYS = [
  "ethics_score",
  "virtue_score", // 医德评分
  "skill_score", // 医术评分
  "auto_rating",
  "case_volume_ranking", // 按病例数生成的排名
  "full_medical_record",
  "medical_record_detail",
];

// 事件定义：event_type -> { aggregate_type, payload 必填字段 }
// payload 为事件对象下的嵌套对象；信封字段见 schema。
export const EVENT_CONTRACTS = {
  // 机构与候选身份
  ORG_REGISTERED: { aggregate: "org_record", required: ["org_id", "org_name"] },
  ORG_RENAMED: {
    aggregate: "org_record",
    required: ["org_id", "previous_name", "new_name", "effective_at"],
  },
  PROFILE_REGISTERED: {
    aggregate: "nominee_profile",
    required: ["profile_id", "profile_kind", "canonical_name"],
  },
  IDENTITY_MERGED: {
    aggregate: "nominee_profile",
    required: ["canonical_profile_id", "merged_profile_id", "reason"],
  },
  TENURE_RECORDED: {
    aggregate: "nominee_profile",
    required: ["person_profile_id", "org_id", "org_name_snapshot", "started_at", "status"],
  },
  TEAM_MEMBERSHIP_RECORDED: {
    aggregate: "nominee_profile",
    required: ["team_profile_id", "member_profile_id", "participated_from"],
  },
  LICENSE_VERIFIED: {
    aggregate: "nominee_profile",
    required: ["person_profile_id", "license_no_masked", "specialty", "status", "verified_by"],
  },

  // 贡献与证明
  CONTRIBUTION_ATTESTED: {
    aggregate: "contribution_record",
    required: ["contribution_id", "title", "categories", "period_from", "period_to", "participants"],
  },
  PEER_ENDORSED: {
    aggregate: "contribution_record",
    required: ["contribution_id", "endorser_name", "endorser_org_id", "statement_ref"],
  },

  // 推荐与评审
  NOMINATION_SUBMITTED: {
    aggregate: "nomination",
    required: ["nomination_id", "profile_id", "track", "award_category", "recommending_org_id"],
  },
  NOMINATION_AMENDED: {
    aggregate: "nomination",
    required: ["nomination_id", "amendment_note"],
  },
  NOMINATION_CONSOLIDATED: {
    aggregate: "nomination",
    required: ["kept_nomination_id", "merged_nomination_ids", "reason"],
  },
  AWARD_GRANTED: {
    aggregate: "award",
    required: ["award_id", "profile_id", "track", "award_category", "period_from", "period_to", "participants"],
  },

  // 患者同意与媒体许可
  CONSENT_GRANTED: {
    aggregate: "consent_grant",
    required: ["consent_id", "patient_pseudonym", "purposes", "granted_at", "statement_version"],
  },
  CONSENT_WITHDRAWN: {
    aggregate: "consent_grant",
    required: ["consent_id", "purposes", "withdrawn_at"],
  },
  MEDIA_LICENSE_GRANTED: {
    aggregate: "media_license",
    required: ["license_id", "licensor_role", "channels", "material_refs", "granted_from"],
  },
  MEDIA_LICENSE_REVOKED: {
    aggregate: "media_license",
    required: ["license_id", "channels", "revoked_at"],
  },

  // 公开版本：核对、发布、下架
  PUBLICATION_PREPARED: {
    aggregate: "public_story",
    required: ["story_id", "version", "nomination_id", "channel_targets", "attribution_entries"],
  },
  PUBLICATION_APPROVED: {
    aggregate: "public_story",
    required: ["story_id", "version", "reviewer_kind", "approved"],
  },
  STORY_RELEASED: {
    aggregate: "public_story",
    required: ["story_id", "version", "channels", "released_at"],
  },
  STORY_CHANNEL_TAKEN_DOWN: {
    aggregate: "public_story",
    required: ["story_id", "channel", "taken_down_at", "reason"],
  },

  // 错署名：后继更正与逐渠道同步（不原地改写历史事件）
  ATTRIBUTION_CORRECTED: {
    aggregate: "public_story",
    required: [
      "correction_id",
      "scope",
      "error_kind",
      "original_event_id",
      "corrected_at",
      "attribution_after",
    ],
  },
  CORRECTION_PROPAGATED: {
    aggregate: "public_story",
    required: ["correction_id", "story_id", "channel", "status"],
  },

  // 外部核验：最小必要证据，不含完整病历
  VERIFICATION_REQUESTED: {
    aggregate: "verification_packet",
    required: ["request_id", "requested_by", "facts_needed"],
  },
  VERIFICATION_PACKET_ISSUED: {
    aggregate: "verification_packet",
    required: ["packet_id", "request_id", "target_profile_id", "facts", "contains_full_medical_record"],
  },
  FACT_VERIFIED: {
    aggregate: "verification_packet",
    required: ["packet_id", "fact_key", "result"],
  },
};

export const EVENT_TYPES = Object.keys(EVENT_CONTRACTS);

export const MEDIA_LICENSOR_ROLES = ["candidate", "hospital", "patient", "media_outlet"];
