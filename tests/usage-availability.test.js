const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseRecordFile, aggregateUsage } = require("../src/quota/local-records");
const { usageCsv } = require("../src/usage-export");

const fields = ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"];
const available = (...known) => Object.fromEntries(fields.map((field) => [field, known.includes(field)]));
const complete = { input_tokens: 80, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 100 };

async function parse(t, usages, options = {}) {
  const prefix = path.join(os.tmpdir(), "codex-usage-availability-");
  const directory = await fs.mkdtemp(prefix);
  t.after(async () => {
    assert.equal(path.dirname(directory), path.dirname(prefix));
    assert.ok(path.basename(directory).startsWith(path.basename(prefix)));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const timestamp = options.timestamp ?? "2026-09-22T02:00:00.000Z";
  const entries = [
    { type: "session_meta", timestamp, payload: { id: options.id ?? "fixture", cwd: "/synthetic/project", timestamp, ...(options.fork ? { forked_from_id: "parent" } : {}) } },
    { type: "turn_context", payload: { model: options.model ?? "fixture-model" } },
    ...usages.map((usage, index) => ({ type: "event_msg", timestamp: new Date(Date.parse(timestamp) + index * 60000).toISOString(),
      payload: { type: "token_count", info: { total_token_usage: usage } } })),
  ];
  const filename = path.join(directory, "fixture.jsonl");
  await fs.writeFile(filename, entries.map((entry) => JSON.stringify(entry)).join("\n"));
  return parseRecordFile({ path: filename });
}

function assertAggregates(usage, expected) {
  for (const row of [usage, ...usage.daily, ...usage.models, ...usage.projects, ...usage.recentSessions]) {
    assert.deepEqual(row.tokenAvailability, expected);
  }
}

test("raw total-only logs retain unknown components through parsing, aggregation and CSV", async (t) => {
  const record = await parse(t, [{ total_tokens: 100 }]);
  const expected = available("totalTokens");
  assert.equal(record.segments.length, 1);
  assert.deepEqual(record.segments[0].tokenAvailability, expected);
  assert.deepEqual(record.segments[0].tokenUsage, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 100 });
  const event = record.events[0];
  assert.equal(event.key, crypto.createHash("sha256").update(JSON.stringify([event.timestamp, null, event.tokenUsage])).digest("hex"));
  const summary = aggregateUsage([record]);
  assertAggregates(summary, expected);
  const csv = usageCsv(summary, new Date(2026, 8, 22));
  assert.ok(csv.includes('"本机近7天总计","","","1","","","","","100"'));
  assert.ok(csv.includes('"本机每日","2026-09-22","","1","","","","","100"'));
  assert.ok(csv.includes('"本机近7天模型","","fixture-model","1","","","","","100"'));
});

test("explicit zero components remain known and export as zero while absent components stay blank", async (t) => {
  const zero = await parse(t, [{ input_tokens: 0, cached_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0, total_tokens: 100 }]);
  const missing = await parse(t, [{ output_tokens: 100, total_tokens: 100 }]);
  assert.deepEqual(zero.segments[0].tokenUsage, missing.segments[0].tokenUsage);
  assert.deepEqual(zero.segments[0].tokenAvailability, available(...fields));
  assert.deepEqual(missing.segments[0].tokenAvailability, available("outputTokens", "totalTokens"));
  const csv = usageCsv(aggregateUsage([zero]), new Date(2026, 8, 22));
  assert.ok(csv.includes('"本机近7天总计","","","1","0","0","100","0","100"'));
});

test("camelCase and nested details are recognized and total requires both known components to derive", async (t) => {
  const nested = await parse(t, [{ inputTokens: 200, outputTokens: 30, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } }]);
  assert.deepEqual(nested.segments[0].tokenAvailability, available(...fields));
  assert.equal(nested.segments[0].tokenUsage.totalTokens, 230);
  const partial = await parse(t, [{ input_tokens: 100 }]);
  assert.equal(partial.segments[0].tokenUsage.totalTokens, 100, "existing normalization stays unchanged");
  assert.deepEqual(partial.segments[0].tokenAvailability, available("inputTokens"));
  const invalidTotal = await parse(t, [{ input_tokens: 10, output_tokens: 20, total_tokens: "invalid" }]);
  assert.equal(invalidTotal.segments[0].tokenUsage.totalTokens, 0);
  assert.deepEqual(invalidTotal.segments[0].tokenAvailability, available("inputTokens", "outputTokens"));
});

test("invalid raw values do not gain availability from numeric normalization", async (t) => {
  for (const value of [null, "", " ", "invalid", -1, false, {}, []]) {
    const record = await parse(t, [{ input_tokens: value, output_tokens: 100, total_tokens: 100 }]);
    assert.equal(record.segments[0].tokenAvailability.inputTokens, false, JSON.stringify(value));
  }
  const numericStrings = await parse(t, [{ input_tokens: "0", output_tokens: "100", total_tokens: "100" }]);
  assert.deepEqual(numericStrings.segments[0].tokenAvailability, available("inputTokens", "outputTokens", "totalTokens"));
});

test("cached input requires a known input bound and cannot be known after normalization clips it", async (t) => {
  for (const raw of [{ cached_input_tokens: 8, total_tokens: 100 }, { input_tokens: 5, cached_input_tokens: 8, total_tokens: 100 }]) {
    const record = await parse(t, [raw]);
    assert.equal(record.segments[0].tokenAvailability.cachedInputTokens, false);
    const csv = usageCsv(aggregateUsage([record]), new Date(2026, 8, 22));
    assert.ok(csv.includes(raw.input_tokens === undefined
      ? '"本机近7天总计","","","1","","","","","100"'
      : '"本机近7天总计","","","1","5","","","","100"'));
  }
});

test("mixed known and missing segments use AND availability in every aggregate", async (t) => {
  const known = await parse(t, [complete], { id: "known" });
  const partial = await parse(t, [{ total_tokens: 100 }], { id: "partial", timestamp: "2026-09-22T02:05:00.000Z" });
  const summary = aggregateUsage([known, partial]);
  assert.equal(summary.tokenUsage.totalTokens, 200);
  for (const row of [summary, ...summary.daily, ...summary.models, ...summary.projects]) {
    assert.deepEqual(row.tokenAvailability, available("totalTokens"));
  }
  assert.deepEqual(summary.recentSessions.find((row) => row.id === "known").tokenAvailability, available(...fields));
  assert.deepEqual(summary.recentSessions.find((row) => row.id === "partial").tokenAvailability, available("totalTokens"));
});

test("delta availability requires valid fields at both cumulative boundaries", async (t) => {
  const record = await parse(t, [
    { total_tokens: 100 },
    { input_tokens: 120, output_tokens: 30, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 150 },
    { input_tokens: 150, output_tokens: 40, total_tokens: 190 },
    { total_tokens: 210 },
  ]);
  assert.equal(record.segments.length, 4);
  assert.deepEqual(record.segments[1].tokenAvailability, available("totalTokens"));
  assert.deepEqual(record.segments[2].tokenAvailability, available("inputTokens", "outputTokens", "totalTokens"));
  assert.deepEqual(record.segments[3].tokenAvailability, available("totalTokens"));
  assert.deepEqual(record.segments.map((segment) => segment.tokenUsage.totalTokens), [100, 50, 40, 20]);
  const filtered = aggregateUsage([{ ...record, segments: record.segments.slice(0, 3) }], { since: record.segments[2].timestamp });
  assertAggregates(filtered, available("inputTokens", "outputTokens", "totalTokens"));
});

test("fork baselines and counter resets retain their existing segment rules and availability boundaries", async (t) => {
  const fork = await parse(t, [{ total_tokens: 100 }, { ...complete, input_tokens: 180, total_tokens: 200 }], { fork: true });
  assert.equal(fork.missingBaselines, 1);
  assert.equal(fork.segments.length, 1);
  assert.equal(fork.segments[0].tokenUsage.totalTokens, 100);
  assert.deepEqual(fork.segments[0].tokenAvailability, available("totalTokens"));
  const reset = await parse(t, [complete, { total_tokens: 10 }, { ...complete, total_tokens: 110 }]);
  assert.equal(reset.counterResets, 1);
  assert.equal(reset.segments.length, 2);
  assert.deepEqual(reset.segments[1].tokenAvailability, available("totalTokens"));
});

test("individual cumulative counter decreases stay unknown instead of claiming a measured zero delta", async (t) => {
  const record = await parse(t, [
    { input_tokens: 80, cached_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 10, total_tokens: 100 },
    { input_tokens: 70, cached_input_tokens: 5, output_tokens: 50, reasoning_output_tokens: 5, total_tokens: 120 },
  ]);
  assert.equal(record.counterResets, 0);
  assert.deepEqual(record.segments[1].tokenUsage, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 30, reasoningOutputTokens: 0, totalTokens: 20 });
  assert.deepEqual(record.segments[1].tokenAvailability, available("outputTokens", "totalTokens"));
  const summary = aggregateUsage([record], { since: record.segments[1].timestamp });
  assertAggregates(summary, available("outputTokens", "totalTokens"));
  assert.ok(usageCsv(summary, new Date(2026, 8, 22)).includes('"本机近7天总计","","","1","","","30","","20"'));
});

test("legacy segments without metadata are unknown while empty aggregates are known zero", async (t) => {
  const record = await parse(t, [complete]);
  delete record.segments[0].tokenAvailability;
  assertAggregates(aggregateUsage([record]), available());
  const empty = aggregateUsage([]);
  assert.deepEqual(empty.tokenAvailability, available(...fields));
  assert.equal(empty.tokenUsage.totalTokens, 0);
  const filtered = aggregateUsage([record], { since: "2026-09-23T00:00:00.000Z" });
  assert.deepEqual(filtered.tokenAvailability, available(...fields));
});
