const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { parseRecordFile, quotaFromRecords } = require('../src/quota/local-records');
const { estimateLocalQuota, contextKey, ALGORITHM } = require('../src/quota/local-estimate');
const { QUOTA_ESTIMATE_ALGORITHM } = require('../src/quota/constants');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cam-estimate-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = Date.now() - 3600000, stamp = ms => new Date(ms).toISOString();
  const context = contextKey('codex', 'synthetic-model', 'fast', 'session');
  const calibration = { algorithm: ALGORITHM, groups: { [context]: [1, 2, 3].map(n => ({ key: 'synthetic-' + n, ms: base, coefficient: 0.001 })) } };
  async function record(id, percentages = [10, 10], metadata = {}) {
    const rows = [
      { type: 'session_meta', timestamp: stamp(base), payload: { id, cwd: '/synthetic/project', ...metadata } },
      { type: 'turn_context', payload: { model: 'synthetic-model', service_tier: 'fast' } },
      ...percentages.map((used, index) => ({ type: 'event_msg', timestamp: stamp(base + index * 60000), payload: {
        type: 'token_count', info: { total_token_usage: { input_tokens: 1000 + index * 1000, output_tokens: 0, total_tokens: 1000 + index * 1000 } },
        rate_limits: { limit_id: 'codex', primary: { used_percent: used, window_minutes: 300, resets_at: Math.floor((base + 7200000) / 1000) } },
      } })),
    ];
    const file = path.join(root, id + '.jsonl');
    await fs.writeFile(file, rows.map(JSON.stringify).join('\n'));
    return parseRecordFile({ path: file });
  }
  const estimate = (records, learned) => estimateLocalQuota(quotaFromRecords(records, stamp(base)), records, { since: stamp(base), calibration: learned });
  return { record, estimate, calibration, context };
}

test('local estimates count identical independent-session deltas and deduplicate session and fork copies', async t => {
  const f = await fixture(t), one = await f.record('one'), two = await f.record('two');
  const child = await f.record('child', [10, 10], { forked_from_id: 'one' });
  const grandchild = await f.record('grandchild', [10, 10], { forked_from: 'child' });
  assert.equal(one.events[1].key, two.events[1].key);
  for (const records of [[one, two, one, child, grandchild], [grandchild, child, two, one]]) {
    const value = f.estimate(records, f.calibration);
    assert.equal(value.session.estimatedWeightedTokens, 2000);
    assert.equal(value.session.estimatedUsedPercent, 12);
  }
  assert.equal(f.estimate([one, one, child, grandchild], f.calibration).session.estimatedWeightedTokens, 1000);
});

test('calibration intervals are separate for independent sessions and reused once across forks and scans', async t => {
  const f = await fixture(t), one = await f.record('one', [10, 11, 12]), two = await f.record('two', [10, 11, 12]);
  const child = await f.record('child', [10, 11, 12], { forked_from_id: 'one' });
  const records = [child, one, two, one];
  const learned = f.estimate(records).calibration;
  assert.equal(learned.groups[f.context].length, 4);
  assert.equal(new Set(learned.groups[f.context].map(sample => sample.key)).size, 4);
  assert.equal(f.estimate([...records].reverse(), learned).calibration.groups[f.context].length, 4);
});

test('algorithm migration discards old unscoped samples and waits for current calibration', async t => {
  const f = await fixture(t), record = await f.record('one');
  const old = { ...f.calibration, algorithm: 4 };
  const unavailable = f.estimate([record], old);
  assert.equal(unavailable.estimate.available, false);
  assert.equal(unavailable.session.estimatedUsedPercent, undefined);
  assert.deepEqual(Object.keys(unavailable.calibration.groups), []);
  assert.equal(ALGORITHM, 5);
  assert.equal(QUOTA_ESTIMATE_ALGORITHM, ALGORITHM, 'main-process persisted snapshot checks use the estimator version');
  const learning = await f.record('learning', [10, 11, 12, 13]);
  const renewed = f.estimate([learning], old).calibration;
  assert.equal(renewed.algorithm, 5);
  assert.equal(renewed.groups[f.context].length, 3);
  assert.ok(renewed.groups[f.context].every(sample => !sample.key.startsWith('synthetic-')));
});

test('public cached snapshots remove old algorithm estimates while preserving measured quota', async () => {
  const source = await fs.readFile(path.join(__dirname, '../src/main.js'), 'utf8');
  const context = { QUOTA_ESTIMATE_ALGORITHM, QUOTA_MODE_ONLINE: 'online', rateWindowHasDisplayData: value => !!value };
  for (const [first, next] of [['function localStoredQuotaSnapshot(', 'async function dashboardScope('], ['function stripWindowEstimate(', 'function normalizePublicAccount(']]) {
    const start = source.indexOf(first);
    assert.ok(start >= 0 && source.indexOf(next, start) > start);
    vm.runInNewContext(source.slice(start, source.indexOf(next, start)), context);
  }
  const snapshot = { source: 'local', schemaVersion: 2, limitId: 'codex', estimate: { algorithm: 4, available: true },
    session: { usedPercent: 10, estimatedUsedPercent: 11, estimatedRemainingPercent: 89, estimatedDeltaPercent: 1, estimatedWeightedTokens: 1000, estimateSamples: 3 } };
  const normalized = context.normalizePublicQuotaSnapshot(snapshot);
  assert.equal(normalized.session.usedPercent, 10);
  assert.equal(normalized.session.estimatedUsedPercent, undefined);
  assert.equal(normalized.session.estimatedWeightedTokens, undefined);
  assert.equal(normalized.estimate.available, false);
  assert.equal(context.normalizePublicQuotaSnapshot({ ...snapshot, estimate: { algorithm: ALGORITHM, available: true } }).session.estimatedUsedPercent, 11);
});
