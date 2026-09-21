# 医者荣誉贡献档案 · 领域不变量

本文件是业务规则的权威表述。`src/archive.js` 在重放事件时把违反这些规则的情形记入
`violations`（追加式记录，不阻止载入），`tests/domain.test.js` 对每条关键规则都有正反用例。

事件契约（字段、枚举、必填项）见 `domain.schema.json` 与 `src/catalog.js`；本文件只讲
**关系与规则**。

---

## 1. 事件只追加，纠错只追加后继记录

- 事件一旦接收，其 `event_id`、`occurred_at`、`version` 与载荷不得原地改写或删除。
- 署名错误、分工表述错误一律用 `ATTRIBUTION_CORRECTED` 表达，并附 `original_event_id`
  指向被更正的原事件；原署名永久可查，`effectiveAttribution` 同时返回 `original` 与
  `current` 及完整更正链。
- 更正后名单必须重新通过时间窗与实际参与校验（见第 3 节）——纠错不能创造历史。
- 更正不“改写团队多年前的真实分工”：它只把**本就实际存在但被遗漏**的参与补登，
  补登依据是当时的证据（签认表、协作协议、同行证明），不是事后追认。

## 2. 身份归并：姓名异体、机构更名、重复推荐、材料补正

- `IDENTITY_MERGED` 把异体档案沿 `merged_into` 指向规范候选；异体姓名并入
  `name_variants`。禁止归并到自身、禁止重复归并。
- 机构更名用 `ORG_RENAMED` 记录更名链；任职记录保存**任职当时**的机构名快照
  （`org_name_snapshot`），机构以后更名不回改历史。
- 重复推荐用 `NOMINATION_CONSOLIDATED` 归并到保留推荐；被归并推荐状态置
  `consolidated`，仍可通过 `duplicateNominations` 查到。
- 所有对候选的引用在查询时按规范候选解析（`canonicalProfileId` 沿归并链上溯）。

## 3. 团队成果 = 时间段 × 实际参与者；后来者不继承

- 每个贡献/奖项都带成果时段 `period_from`~`period_to`，每位参与者带自己的参与窗。
- 参与窗与成果时段不重叠 → `participant_outside_window`。
- **团队奖项**还要求每位署名者在团队成员关系中存在与成果时段重叠的记录，否则
  `team_award_unverified_member`。这是“后来成员不能继承未参与事项”的硬性落点：
  - 2021 年才加入的成员，不能出现在 2014—2018 年成果的署名里（即使团队因此获奖）。
  - 更正补登同样受此约束：不能借“纠错”把后来成员塞进历史名单。
- **离职、退休、跨院合作保留原贡献**：参与窗在离职/退休/合作结束时闭合，但该窗内的
  署名、奖项、贡献照常成立。跨院合作方在贡献的 `org_ids` 与成员关系中显式体现。

## 4. 不按病例数自动判断医德或医术

- 系统只登记事实与证明（资质、任职、角色、同行证明、公益记录、推荐意见）。
- 禁止字段：`ethics_score`、`virtue_score`、`skill_score`、`auto_rating`、
  `case_volume_ranking`、`full_medical_record`、`medical_record_detail`，
  在载荷任意嵌套层级出现都被结构校验拒绝。
- 是否获奖、荣誉类别由评审程序决定，事件流只记录 `AWARD_GRANTED` 的结果与其事实依据。

## 5. 患者叙事授权按用途独立

- 三种用途相互独立：`review`（评审）、`ceremony`（盛典）、`long_term_publicity`
  （长期宣传）。一次授予可含多种用途，撤回也按用途分别进行。
- 渠道与所需用途的对应（`CHANNEL_REQUIRED_PURPOSES`）：
  - 榜单页 / 患者故事 / 媒体材料 → 需要 `long_term_publicity`；
  - 盛典 → 需要 `ceremony`。
- 撤回长期宣传**不影响**评审已完成的使用，也不自动撤销盛典授权。
- 撤回只能针对当前处于有效授予状态的用途（否则 `consent_withdrawal_invalid`）。
- 撤回发生后，`channelsAffectedByConsentWithdrawal` 给出**撤回时点**仍承载该叙事的
  在播渠道，供立即下架或更换无叙事版本。
- 媒体许可（`MEDIA_LICENSE_*`）与患者同意是两条独立线索，许可方可按渠道撤销；
  撤销后再在该渠道发布 → `release_with_revoked_license`。

## 6. 公开版本：医院与候选人共同核对

- 公开材料以版本（`PUBLICATION_PREPARED` 的 `version`）为单位，渠道目标、署名、
  关联同意与许可、是否含患者叙事逐版本固定。
- 发布前必须有 `hospital` 与 `candidate` 两方对**同一版本**的通过记录
  （`PUBLICATION_APPROVED`），否则每个渠道发布都记 `release_without_dual_approval`。
- 含患者叙事的版本发布时，逐渠道校验当时所需用途仍处有效授权；否则
  `release_without_consent`。
- 发布只能面向该版本声明的 `channel_targets`。
- 下架（`STORY_CHANNEL_TAKEN_DOWN`）针对“当时在播”的版本；下架后该渠道可由更新版本
  重新发布。发布/下架保留时间线日志，支持任意时点的在播判定。

## 7. 错署名更正的影响面与逐渠道同步

- `channelsAffectedByCorrection` 在**更正时点**扫描所有引用该贡献/奖项、且当时在播的
  榜单页、患者故事、媒体材料（及盛典归档），返回每条的版本、渠道与同步状态。
- 同步状态来自 `CORRECTION_PROPAGATED`：`pending` / `synced` / `failed`；无记录视为
  `pending`，便于推荐医院一眼看到还有哪些渠道未更正。
- 已在更正前下架或已被新版取代的渠道不计入“即时影响面”，但更正与传播历史完整保留。
- 盛典现场材料通常已归档，其同步可以是“追加书面勘误”，不回改现场记录。

## 8. 外部核验：最小必要、无完整病历

- 可被外部核验的事实键是封闭白名单（`VERIFICATION_FACT_ALLOWLIST`）：执业资质状态、
  执业专科、任职时间段、团队参与时间窗、奖项是否授予、公益记录是否存在。
- 请求（`VERIFICATION_REQUESTED`）先声明所需事实；证据包
  （`VERIFICATION_PACKET_ISSUED`）只能回应被请求的键——多给记
  `verification_overdisclosure`，键不在白名单记 `verification_fact_not_allowlisted`。
- 证据包必须显式 `contains_full_medical_record: false`（其他值被 schema 与重放双重
  拒绝）。主办方据此在不接触完整病历的前提下验证关键事实；证据以脱敏回执、
  “仅名单与日期”的清单、文件编号引用等形式给出。

## 9. 违规的处理方式

`violations` 是重放产物而非异常：历史数据可能在规则建立前已写入，系统照实载入并标出，
由业务侧决定补正（补登成员关系、追加更正、下架等）。结构校验（`validateEvent`）则在
写入边界拒绝格式不合法、枚举越界、含禁止字段的事件。
