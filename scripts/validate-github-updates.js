const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Keep the existing validation entry point on the same maintained test suite.
const result = spawnSync(process.execPath, ["--test", path.join(__dirname, "../tests/github-updates.test.js")], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
