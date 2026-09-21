#!/usr/bin/env node
// 推荐医院视角的即时影响面报告（基于 data/sample.json）。
// 演示：错署名更正要同步哪些渠道、患者撤回某用途后哪些在播材料受影响、
// 有效署名（原名单 vs 更正后）、以及外部最小核验视图。
import { readFile } from "node:fs/promises";

import { replay } from "../src/archive.js";
import { validateEventStream } from "../src/validator.js";

const events = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));

const schemaErrors = validateEventStream(events);
if (schemaErrors.length) {
  console.error("样例存在结构错误：");
  for (const e of schemaErrors) console.error(" -", e);
  process.exit(1);
}

const archive = replay(events);

const line = (ch) => ({
  honor_roll_page: "榜单页  ",
  patient_story: "患者故事",
  media_kit: "媒体材料",
  ceremony: "盛典归档",
}[ch] ?? ch);

console.log("=== 1. 错署名更正 corr-2026-001 的即时影响面（更正时点在播渠道）===");
for (const x of archive.channelsAffectedByCorrection("corr-2026-001")) {
  console.log(`  ${line(x.channel)}  故事 ${x.story_id} v${x.version}  同步：${x.sync_status}（${x.synced_at ?? "—"}）`);
}

console.log("\n=== 2. 患者撤回“长期宣传”时点受影响的在播渠道 ===");
const withdrawn = archive.channelsAffectedByConsentWithdrawal("consent-ali-2026");
for (const x of withdrawn) {
  console.log(`  ${line(x.channel)}  故事 ${x.story_id} v${x.version}  撤回用途：${x.withdrawn_purposes.join("、")}`);
}

console.log("\n=== 3. 奖项有效署名（原名单保留，现名单为后继更正结果）===");
const eff = archive.effectiveAttribution("award", "award-2026-team-07");
console.log(`  原始署名（${eff.original.length} 人）：${eff.original.map((p) => `${p.profile_id}/${p.role}`).join("，")}`);
console.log(`  现行署名（${eff.current.length} 人）：${eff.current.map((p) => `${p.profile_id}/${p.role}`).join("，")}`);
console.log(`  更正链：${eff.correction_history.map((c) => `${c.correction_id}(${c.error_kind} @ ${c.corrected_at})`).join(" → ") || "无"}`);

console.log("\n=== 4. 不继承检查：赵一鸣（2021 加入）与 2014—2018 团队奖项 ===");
const zhao = archive.nomineeView("p-zhao");
console.log(`  奖项数：${zhao.awards.length}；仅参与之后的贡献：${zhao.contributions.map((c) => c.contribution_id).join("、") || "无"}`);

console.log("\n=== 5. 身份归并：异体姓名与重复推荐 ===");
const lin = archive.nomineeView("p-lin-typo");
console.log(`  规范候选：${lin.canonical_profile_id}（${lin.canonical_name}），异体：${lin.name_variants.join("、")}`);
console.log(`  同候选推荐：${archive.duplicateNominations("p-lin").map((n) => `${n.nomination_id}[${n.status}]`).join("，")}`);

console.log("\n=== 6. 外部核验最小证据包（不含完整病历）===");
const view = archive.verificationView("vp-2026-009");
console.log(`  contains_full_medical_record = ${view.contains_full_medical_record}`);
for (const f of view.facts) console.log(`  ${f.fact_key.padEnd(28)} ${f.result}  ← ${f.evidence_ref}`);

console.log("\n=== 7. 重放不变量违规 ===");
console.log(archive.violations.length ? archive.violations.map((v) => `  [${v.code}] ${v.message}`).join("\n") : "  无");
