# Upstream attribution

This application is a derivative of [GboyCode/CodexAuth](https://github.com/GboyCode/CodexAuth), version 0.1.16, under the MIT license. Its copyright and complete license are retained in the root LICENSE. The inherited Electron backend, credential encryption, quota parsing, portable import/export and floating widget are from that project. This derivative changes branding, primary UI, login orchestration and Windows account switching. It does not use the upstream update channel.

[Mintimate/codex-auth-switch](https://github.com/Mintimate/codex-auth-switch), version 1.1.3, was consulted for the device-login and account-management workflow. Its Rust implementation is not copied into this application.

New browser login invokes the installed official Codex CLI. See [official authentication documentation](https://learn.chatgpt.com/docs/auth). Codex and OpenAI trademarks belong to their owners. This is an unofficial local tool.

AITracker (https://github.com/estelwalks/aitracker, inspected at 172846b19f117ef6d478a1f20a6669a4634c4062) was consulted for the user-facing idea of a session-distillation workbench and memory library. This project's implementation, UI and prompts were written independently; no AITracker source code, prompts or assets are included. AITracker's custom GPL-3.0-based license with additional restrictions does not replace this project's existing MIT license.

OpenAI Codex memory pipeline documentation (https://github.com/openai/codex/blob/c11ed24c2a1416fcae816af9127f350817371b2f/codex-rs/memories/README.md), reviewed 2026-09-22, informed the extraction/consolidation design. This application independently implements its prompts, schemas, chunking and source validation; it does not embed Codex memory internals.

Skills management was implemented independently after reviewing the user-facing workflows of [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager/tree/6ae02e39d9efea0faf75e643b8205f97833a593d) (MIT) and [SanjiFlip/skills-hub](https://github.com/SanjiFlip/skills-hub/tree/905d5b25d91239470ad0ebbf2c3c7f88ab303800) (MIT), and the AITracker project noted above. No source, prompts or visual assets from those references were copied for this module.

The Skills marketplace links to public GitHub repositories and downloads user-selected packages only. Each package retains its files and any repository-root license found at preview time; its license and external dependencies are separate from this application's MIT license. Skill activation uses Codex's versioned config API and `skills.config` path rules; see [official skill configuration](https://learn.chatgpt.com/docs/build-skills).

The Skills metadata parser uses [yaml 2.9.1](https://github.com/eemeli/yaml), licensed under ISC; its package license is retained in bundled dependencies.

The public repository snapshot fallback uses [yauzl 3.4.0](https://github.com/thejoshwolfe/yauzl), licensed under MIT. Its package license is retained in bundled dependencies. Repository snapshots come directly from GitHub codeload at a fixed commit, with Git blob hashes checked during installation.
