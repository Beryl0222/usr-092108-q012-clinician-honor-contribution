# 医者荣誉贡献档案

本仓库保存全国致敬项目的领域资料与最小事件约定：把执业资质、任职时间、项目角色、同行证明、公益记录、奖项类别、推荐意见、患者同意、媒体许可和公开版本组织成可核验关系，供业务团队在统一语义上继续建设。

## 已有内容

- `contracts/domain.schema.json`：领域事件信封（标识、类型、聚合、时间、版本、摘要，以及可选的 `payload` / `corrects` / `actor`）。
- `src/validator.js`：单事件信封校验；拒绝由指标派生的医德医术评分字段。
- `src/stream.js`：流程级不变量校验（版本单调、引用存在、双重核对、用途授权、渠道许可、参与窗口）。
- `src/project.js`：把事件流折叠为当前状态；事件不可变，更正只追加后继记录。
- `src/identity.js` / `consent.js` / `attribution.js` / `disclosure.js`：身份归并、分用途同意、署名与影响分析、最小必要核验。
- `data/sample.json`：单条信封样例；`data/sample-stream.json`：覆盖全流程的叙事事件流。
- `tests/`：验证样例与约定一致，并覆盖各关键不变量。

## 领域对象

| 聚合 | 含义 | 关键内容 |
| --- | --- | --- |
| `nominee_profile` | 候选人档案 | 规范姓名、姓名异体、执业资质与核验断言、任职时间（含补正链）、归并去向 |
| `institution` | 机构 | 现用名与历史名称（更名记录） |
| `contribution_record` | 贡献记录 | 类别（临床 / 专科建设 / 公益 / 多机构合作）、时间段、实际参与者及各自窗口、证据断言、同行证明、署名更正链 |
| `nomination` | 推荐 | 个人或团队、奖项类别、推荐意见、推荐机构、重复推荐归并 |
| `consent_grant` | 患者同意 | 按用途（评审 / 盛典 / 长期宣传）分别授予与撤回 |
| `media_license` | 媒体许可 | 素材按渠道的许可与撤销 |
| `publication` | 公开版本 | 榜单页面 / 患者故事 / 媒体材料，逐版本记录核对、渠道、用途与引用 |

## 关键不变量

1. **事件不可变**：标识、发生时间和版本不原地改写；更正、撤回、归并都是后继事件（`corrects` 指向原事件），历史分工记录保持原样。
2. **不按病例数自动判断医德或医术**：校验器拒绝 `ethics_score`、`skill_score` 等派生评分字段；结论只能来自同行证明与核验断言。
3. **团队成果标明时间段与实际参与者**：参与者窗口必须落在项目时间段内；离职、退休、跨院合作的历史贡献保留。
4. **贡献不可继承**：信用判定只看实际参与记录，后来成员（包括借更正补记窗口超出项目期者）不能继承未参与事项。
5. **归并到同一候选**：姓名异体、机构更名、重复推荐、材料补正都解析到同一候选，不新建档案。
6. **患者同意分用途**：评审、盛典、长期宣传分别授予、分别撤回，互不影响。
7. **公开内容双重核对**：发布前须经推荐医院与候选人核对；患者故事发布用途须当时已获同意；媒体材料发布渠道须已获许可。
8. **最小必要核验**：主办方不接触完整病历，只获得验证关键事实所需的断言。

## 关键查询

- `projectState(events)`：重放事件流得到当前状态。
- `resolveNomineeId` / `resolveInstitutionId` / `canonicalNominationId`：异体、更名、重复推荐的归并解析。
- `isCredited(state, profileId, contributionId, at?)` / `effectiveParticipants(contribution)`：参与信用判定。
- `affectedByCorrection` / `correctionNotices`：署名遗漏更正后，推荐医院立刻定位受影响的榜单页面、患者故事、媒体材料，并按渠道生成重新发布通知。
- `consentStatus` / `isUseAuthorized` / `affectedByWithdrawal`：分用途同意状态与撤回影响。
- `discloseForVerification(state, request)`：对外核验的最小必要视图。

## 本地检查

```bash
node --test
```
