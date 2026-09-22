const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createUpdateChecker, compareVersions, installerName, selectRelease } = require("../src/github-updates");

const RELEASES_URL = "https://github.com/SanjiFlip/codex-auth-manager/releases";
const API_URL = "https://api.github.com/repos/SanjiFlip/codex-auth-manager/releases";

function fixture(tag = "v0.6.1", patch = {}) {
  const version = tag.replace(/^v/, "");
  return { tag_name: tag, draft: false, prerelease: true,
    assets: [["win32", "x64"], ["darwin", "arm64"], ["darwin", "x64"]].map(([platform, arch]) => {
      const name = installerName(version, platform, arch);
      return { name, state: "uploaded", size: 123456, browser_download_url: `${RELEASES_URL}/download/${tag}/${name}` };
    }), ...patch };
}

function transport(responses) {
  const calls = [], timers = new Map();
  let nextTimer = 0;
  const sandbox = { module: { exports: {} }, Buffer,
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      assert.equal(name, "node:https");
      return { get(url, options, callback) {
        const response = responses[calls.length];
        assert.ok(response, "unexpected additional request");
        calls.push({ url, headers: options.headers });
        if (response.failure === "throw") throw Error("synchronous network failure");
        const req = new EventEmitter();
        req.destroy = () => {};
        queueMicrotask(() => {
          if (response.failure === "network") return req.emit("error", Error("offline"));
          if (response.failure === "timeout") return [...timers.values()].at(-1)();
          const res = new EventEmitter();
          res.statusCode = response.status ?? 200;
          res.headers = response.headers ?? {};
          res.resume = () => {};
          res.destroy = () => {};
          callback(res);
          if (res.statusCode !== 200) return;
          if (response.failure === "read") return res.emit("error", Error("read failure"));
          if (response.failure === "aborted") return res.emit("aborted");
          const body = response.body ?? JSON.stringify(response.releases ?? [fixture()]);
          res.emit("data", Buffer.from(body));
          res.emit("end");
        });
        return req;
      } };
    } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/github-updates.js"), "utf8"), sandbox);
  return { check: sandbox.module.exports.requestLatestRelease, calls, timers };
}

test("version ordering follows SemVer including prerelease identifiers and build metadata", () => {
  const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0"];
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
    assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1);
  }
  assert.equal(compareVersions("v0.6.10", "0.6.9"), 1);
  assert.equal(compareVersions("v1.2.3+build.2", "1.2.3+build.9"), 0);
  assert.equal(compareVersions("1.0.0-9007199254740993", "1.0.0-9007199254740992"), 1);
  assert.equal(compareVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1);
  for (const value of [null, "1.2", "01.2.3", "1.02.3", "1.2.3-01", "1.2.3-beta..1", "1.2.3+", "../1.2.3", "1.2.3/evil", "1.2.3\n"]) {
    assert.throws(() => compareVersions(value, "1.2.3"), /版本号/);
  }
});

test("selects the greatest published SemVer including previews regardless of API ordering", () => {
  const releases = [fixture("v0.6.0", { prerelease: false }), fixture("v99.0.0", { draft: true }),
    fixture("v0.6.1"), fixture("v0.7.0-beta.2"), fixture("v0.7.0-beta.10"),
    fixture("v88.0.0", { prerelease: "false" }), fixture("v77.0.0", { draft: undefined }),
    fixture("../../unsafe"), null];
  const selected = selectRelease(releases, "0.6.1", "win32", "x64");
  assert.equal(selected.latestVersion, "0.7.0-beta.10");
  assert.equal(selected.prerelease, true);
  assert.equal(selected.comparison, 1);
  assert.equal(selected.releaseUrl, `${RELEASES_URL}/tag/v0.7.0-beta.10`);
  assert.equal(selectRelease([fixture("v1.0.0-beta"), fixture("v1.0.0", { prerelease: false })], "1.0.0", "win32", "x64").latestVersion, "1.0.0");
  assert.equal(selectRelease([fixture("v1.0.0"), fixture("v1.0.0+stable", { prerelease: false })], "1.0.0", "win32", "x64").prerelease, false);
  for (const invalid of [[], [fixture("v9.0.0", { draft: true })], [fixture("not-semver")]]) {
    assert.throws(() => selectRelease(invalid, "0.6.1", "win32", "x64"), /暂无/);
  }
  for (const invalid of [null, fixture("v1.0.0", { draft: true }), fixture("v1.0.0", { prerelease: undefined })]) {
    assert.throws(() => selectRelease(invalid, "0.6.1", "win32", "x64"), /有效发布/);
  }
});

test("matches this project's Windows and Mac assets and reports equal or newer local builds", () => {
  for (const [platform, arch, expected] of [
    ["win32", "x64", "Codex-Auth-Manager-Setup-0.6.1-x64.exe"],
    ["darwin", "arm64", "Codex-Auth-Manager-0.6.1-arm64.dmg"],
    ["darwin", "x64", "Codex-Auth-Manager-0.6.1-x64.dmg"],
  ]) {
    const result = selectRelease(fixture(), "0.6.0", platform, arch);
    assert.equal(result.installer.name, expected);
    assert.equal(result.installer.url, `${RELEASES_URL}/download/v0.6.1/${expected}`);
    assert.equal(result.comparison, 1);
  }
  assert.equal(selectRelease(fixture(), "0.6.1", "win32", "x64").comparison, 0);
  assert.equal(selectRelease(fixture(), "0.6.2", "win32", "x64").comparison, -1);
});

test("missing platform assets preserve the newest release without falling back to an older version", () => {
  const newest = fixture("v0.7.0", { assets: [] });
  const result = selectRelease([fixture(), newest], "0.6.0", "win32", "x64");
  assert.equal(result.latestVersion, "0.7.0");
  assert.equal(result.installer, null);
  assert.equal(result.releaseUrl, `${RELEASES_URL}/tag/v0.7.0`);
  for (const assets of [null, [null], "invalid", [{ name: null, browser_download_url: null, state: "uploaded", size: 1 }]]) {
    assert.equal(selectRelease(fixture("v0.6.1", { assets }), "0.6.0", "win32", "x64").installer, null);
  }
  for (const [platform, arch] of [["linux", "x64"], ["win32", "arm64"], ["darwin", "ia32"]]) {
    assert.equal(selectRelease(fixture(), "0.6.0", platform, arch).installer, null);
  }
});

test("untrusted asset URLs, names, states and sizes cannot become download links", () => {
  const validUrl = fixture().assets[0].browser_download_url;
  for (const patch of [
    { browser_download_url: "https://example.test/malware.exe" },
    { browser_download_url: validUrl.replace("github.com", "github.com.evil.test") },
    { browser_download_url: validUrl.replace("SanjiFlip/codex-auth-manager", "GboyCode/CodexAuth") },
    { browser_download_url: validUrl.replace("v0.6.1", "v0.6.0") },
    { browser_download_url: validUrl + "?redirect=malware" },
    { browser_download_url: validUrl.replace("https:", "http:") },
    { browser_download_url: "file:///fixture.exe" }, { browser_download_url: "javascript:alert(1)" },
    { name: "CodexAuthSwitch-Setup-0.6.1.exe" }, { state: "new" },
    { size: 0 }, { size: -1 }, { size: 1.5 }, { size: "123" }, { size: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    const release = fixture();
    Object.assign(release.assets[0], patch);
    const result = selectRelease(release, "0.6.0", "win32", "x64");
    assert.equal(result.installer, null, JSON.stringify(patch));
  }
  const result = selectRelease(fixture("v0.6.1", { html_url: "https://evil.test/" }), "0.6.0", "win32", "x64");
  assert.equal(result.releaseUrl, `${RELEASES_URL}/tag/v0.6.1`);
});

test("coalesces requests, caches successes for one minute and refreshes after a clock rollback", async () => {
  let calls = 0, time = 1000, resolve;
  const checker = createUpdateChecker({ currentVersion: "0.6.0", platform: "win32", arch: "x64", now: () => time,
    request: () => { calls++; return new Promise((done) => { resolve = done; }); } });
  const first = checker.check(), second = checker.check();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve(fixture());
  const result = await first;
  assert.equal(result.checkedAt, 1000);
  assert.equal(await checker.check(), result);
  time += 59999;
  assert.equal(await checker.check(), result);
  time += 1;
  const refresh = checker.check();
  await Promise.resolve();
  assert.equal(calls, 2);
  resolve(fixture("v0.6.2"));
  assert.equal((await refresh).latestVersion, "0.6.2");
  time -= 1;
  const rollback = checker.check();
  await Promise.resolve();
  assert.equal(calls, 3);
  resolve(fixture("v0.6.2"));
  await rollback;
});

test("failed requests and invalid releases are immediately retryable, including after cache expiry", async () => {
  let calls = 0, time = 1000;
  const checker = createUpdateChecker({ currentVersion: "0.6.0", now: () => time, request: () => {
    calls++;
    if (calls === 1 || calls === 4) throw Error("offline");
    if (calls === 2) return fixture("unsafe-tag");
    return fixture();
  } });
  await assert.rejects(checker.check(), /offline/);
  await assert.rejects(checker.check(), /版本号/);
  await checker.check();
  assert.equal(calls, 3);
  time += 60000;
  const failed = checker.check();
  assert.equal(checker.check(), failed);
  await assert.rejects(failed, /offline/);
  assert.equal((await checker.check()).latestVersion, "0.6.1");
  assert.equal(calls, 5);
});

test("transport queries only the fixed public repository and checks additional release pages", async () => {
  const client = transport([
    { releases: Array.from({ length: 100 }, () => fixture("v0.6.0")), headers: { link: '<https://evil.test/>; rel="next"' } },
    { releases: [fixture("v0.7.0-beta.1"), fixture("v99.0.0", { draft: true })] },
  ]);
  assert.equal((await client.check()).tag_name, "v0.7.0-beta.1");
  assert.deepEqual(client.calls.map((call) => call.url), [`${API_URL}?per_page=100&page=1`, `${API_URL}?per_page=100&page=2`]);
  for (const { headers } of client.calls) {
    assert.deepEqual(Object.keys(headers).sort(), ["Accept", "User-Agent"]);
    assert.equal(headers["User-Agent"], "Codex-Auth-Manager");
  }
  assert.equal(client.timers.size, 0);
});

test("transport rejects malformed, incomplete or excessive lists instead of claiming a latest version", async () => {
  for (const response of [{ body: "{" }, { body: "{}" }, { body: "null" }, { releases: Array(101).fill(fixture()) }]) {
    const client = transport([response]);
    await assert.rejects(client.check(), /无效/);
    assert.equal(client.timers.size, 0);
  }
  await assert.rejects(transport([{ releases: [] }]).check(), /暂无/);
  const fullPage = { releases: Array(100).fill(fixture()) };
  const capped = transport(Array(10).fill(fullPage));
  await assert.rejects(capped.check(), /无法完整检查/);
  assert.equal(capped.calls.length, 10);
  await assert.rejects(transport([fullPage, { failure: "network" }]).check(), /无法连接/);
});

test("transport reports HTTP, redirect, network, timeout, stream and response-size failures", async () => {
  for (const [response, expected] of [
    [{ status: 403 }, /限制/], [{ status: 429 }, /限制/], [{ status: 404 }, /暂无/],
    [{ status: 302, headers: { location: "https://evil.test/" } }, /HTTP 302/], [{ status: 500 }, /HTTP 500/],
    [{ failure: "network" }, /无法连接/], [{ failure: "throw" }, /无法连接/], [{ failure: "timeout" }, /超时/],
    [{ failure: "read" }, /读取/], [{ failure: "aborted" }, /读取/],
    [{ body: "x".repeat(1024 * 1024 + 1) }, /过大/],
  ]) {
    const client = transport([response]);
    await assert.rejects(client.check(), expected);
    assert.equal(client.calls.length, 1);
    assert.equal(client.timers.size, 0);
  }
});
