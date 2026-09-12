# Upstream attribution

This application is a derivative of [GboyCode/CodexAuth](https://github.com/GboyCode/CodexAuth), version 0.1.16, under the MIT license. Its copyright and complete license are retained in the root LICENSE. The inherited Electron backend, credential encryption, quota parsing, portable import/export and floating widget are from that project. This derivative changes branding, primary UI, login orchestration and Windows account switching. It does not use the upstream update channel.

[Mintimate/codex-auth-switch](https://github.com/Mintimate/codex-auth-switch), version 1.1.3, was consulted for the device-login and account-management workflow. Its Rust implementation is not copied into this application.

New browser login invokes the installed official Codex CLI. See [official authentication documentation](https://learn.chatgpt.com/docs/auth). Codex and OpenAI trademarks belong to their owners. This is an unofficial local tool.
