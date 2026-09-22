const https = require("node:https");

const RELEASES_URL = "https://github.com/SanjiFlip/codex-auth-manager/releases";
const API_URL = "https://api.github.com/repos/SanjiFlip/codex-auth-manager/releases";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const PAGE_SIZE = 100;
const MAX_RELEASE_PAGES = 10;

function parseVersion(value) {
  const match = typeof value === "string" && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) throw new Error("无法识别版本号。");
  const prerelease = match[4] ? match[4].split(".") : [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0")) {
    throw new Error("无法识别版本号。");
  }
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const a = left.prerelease[i], b = right.prerelease[i];
    if (a === b) continue;
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    const aNumeric = /^\d+$/.test(a), bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return BigInt(a) > BigInt(b) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

function installerName(version, platform, arch) {
  if (platform === "win32" && arch === "x64") return `Codex-Auth-Manager-Setup-${version}-x64.exe`;
  if (platform === "darwin" && ["x64", "arm64"].includes(arch)) return `Codex-Auth-Manager-${version}-${arch}.dmg`;
  return null;
}

// Fixed public endpoint: no cookies, account identifiers, credentials or caller-supplied URLs.
function requestReleasePage(page) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      error ? reject(error) : resolve(result);
    };
    const deadline = setTimeout(() => {
      finish(new Error("检查更新超时，请稍后重试。"));
      req.destroy();
    }, 15000);
    let req;
    try {
      req = https.get(`${API_URL}?per_page=${PAGE_SIZE}&page=${page}`, {
        headers: { "User-Agent": "Codex-Auth-Manager", Accept: "application/vnd.github+json" },
      }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          const message = [403, 429].includes(res.statusCode)
            ? "GitHub 暂时限制了请求，请稍后重试。"
            : res.statusCode === 404 ? "GitHub 暂无可用的发布版本。"
              : `GitHub 更新检查失败（HTTP ${res.statusCode}）。`;
          finish(new Error(message));
          return;
        }
        const chunks = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            finish(new Error("GitHub 更新响应过大，请稍后重试。"));
            res.destroy();
          } else chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { finish(new Error("GitHub 返回了无效的更新信息。")); }
        });
        res.on("error", () => finish(new Error("读取 GitHub 更新信息失败，请稍后重试。")));
        res.on("aborted", () => finish(new Error("读取 GitHub 更新信息失败，请稍后重试。")));
      });
      req.on("error", () => finish(new Error("无法连接 GitHub，请检查网络后重试。")));
    } catch {
      finish(new Error("无法连接 GitHub，请检查网络后重试。"));
    }
  });
}

function latestPublishedRelease(releases) {
  let latest = null;
  for (const release of releases) {
    if (!release || release.draft !== false || typeof release.prerelease !== "boolean") continue;
    try { parseVersion(release.tag_name); } catch { continue; }
    const comparison = latest ? compareVersions(release.tag_name, latest.tag_name) : 1;
    if (comparison > 0 || (comparison === 0 && latest.prerelease && !release.prerelease)) latest = release;
  }
  if (!latest) throw new Error("GitHub 暂无可用的发布版本。");
  return latest;
}

// The releases/latest endpoint excludes prereleases, which this project publishes.
// Construct every page URL locally instead of trusting response links or redirects.
async function requestLatestRelease() {
  const releases = [];
  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    const batch = await requestReleasePage(page);
    if (!Array.isArray(batch) || batch.length > PAGE_SIZE) throw new Error("GitHub 返回了无效的更新信息。");
    releases.push(...batch);
    if (batch.length < PAGE_SIZE) return latestPublishedRelease(releases);
  }
  throw new Error("GitHub 发布版本过多，无法完整检查，请打开发布页面查看。");
}

function selectRelease(release, currentVersion, platform, arch) {
  if (Array.isArray(release)) release = latestPublishedRelease(release);
  if (!release || release.draft !== false || typeof release.prerelease !== "boolean") throw new Error("GitHub 返回的不是有效发布版本。");
  parseVersion(release.tag_name);
  const latestVersion = release.tag_name.replace(/^v/, "");
  const comparison = compareVersions(latestVersion, currentVersion);
  const releaseUrl = `${RELEASES_URL}/tag/${release.tag_name}`;
  const expectedName = installerName(latestVersion, platform, arch);
  const expectedUrl = expectedName ? `${RELEASES_URL}/download/${release.tag_name}/${expectedName}` : null;
  // Match exact repository, tag and filename; never open an arbitrary URL from the response.
  const asset = Array.isArray(release.assets) && release.assets.find((item) =>
    expectedName && item && item.name === expectedName && item.browser_download_url === expectedUrl &&
    item.state === "uploaded" && Number.isSafeInteger(item.size) && item.size > 0);
  return {
    currentVersion, latestVersion, comparison, releaseUrl, prerelease: release.prerelease,
    installer: asset ? { name: expectedName, url: expectedUrl, size: asset.size } : null,
  };
}

function createUpdateChecker({ currentVersion, platform = process.platform, arch = process.arch,
  request = requestLatestRelease, now = Date.now }) {
  let cached = null, checkedAt = 0, pending = null;
  return {
    check() {
      const age = now() - checkedAt;
      if (cached && age >= 0 && age < 60000) return Promise.resolve(cached);
      if (pending) return pending;
      pending = Promise.resolve().then(request).then((release) => {
        const result = selectRelease(release, currentVersion, platform, arch);
        checkedAt = now();
        cached = { ...result, checkedAt };
        return cached;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}

module.exports = { createUpdateChecker, compareVersions, installerName, selectRelease, requestLatestRelease };
