import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AGGREGATE_TYPES, EVENT_CONTRACTS, EVENT_TYPES } from "../src/catalog.js";

const schema = JSON.parse(
  await readFile(new URL("../contracts/domain.schema.json", import.meta.url), "utf8"),
);

test("schema 事件枚举与目录一致", () => {
  assert.deepEqual([...schema.properties.event_type.enum].sort(), [...EVENT_TYPES].sort());
});

test("schema 聚合枚举与目录一致", () => {
  assert.deepEqual([...schema.properties.aggregate_type.enum].sort(), [...AGGREGATE_TYPES].sort());
});

test("每种事件在 schema 中都有对应载荷定义，且聚合类型一致", () => {
  for (const eventType of EVENT_TYPES) {
    assert.ok(schema.$defs[`ev_${eventType}`], `schema 缺少定义 ev_${eventType}`);
  }
  // 抽取 schema 中每类事件的 const 聚合类型并比对
  for (const [eventType, contract] of Object.entries(EVENT_CONTRACTS)) {
    const defText = JSON.stringify(schema.$defs[`ev_${eventType}`]);
    assert.ok(
      defText.includes(`"const":"${contract.aggregate}"`),
      `ev_${eventType} 的聚合 const 与目录不一致`,
    );
  }
});

test("schema 的 oneOf 覆盖全部事件且无多余定义", () => {
  const refs = schema.oneOf.map((x) => x.$ref);
  assert.equal(refs.length, EVENT_TYPES.length);
  for (const eventType of EVENT_TYPES) {
    assert.ok(refs.includes(`#/$defs/ev_${eventType}`));
  }
});
