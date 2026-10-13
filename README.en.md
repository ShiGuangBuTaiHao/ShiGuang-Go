# ShiGuang-Go | 时光围棋

[中文](README.md) | [English](README.en.md)

> A local AI Go desktop application for Windows. The current version is `1.0.0`.

A Windows x64 full installer is available on the [GitHub v1.0.0 release page](https://github.com/ShiGuangBuTaiHao/ShiGuang-Go/releases/tag/v1.0.0). See the [v1.0.0 release notes](RELEASE_NOTES.md) in Chinese and verify the published checksum and hardware requirements before installation. Testing currently focuses on an RTX 4060 Laptop GPU (`sm89`); the installer is unsigned, and license review and clean-machine installation testing remain incomplete.

## Product Overview

ShiGuang-Go is a desktop Go application focused on local execution, low latency, and a calm board experience. The UI is built with Vue 3 and TypeScript. Tauri 2 and Rust connect the desktop application to a local KataGo engine, so games and analysis do not need to be sent to a cloud service.

The project is designed for:

- Playing against KataGo at different human-style strength levels.
- Playing a local two-player game on one computer.
- Playing with another computer over the same LAN.
- Inspecting win rate, score lead, candidate moves, and AI territory predictions.
- Learning how Vue, Tauri, Rust, Go rules, and a local AI engine fit together.

## Feature Status

| Feature | Status | Notes |
| --- | --- | --- |
| Human vs AI | Implemented | KataGo Human SL from `20k` to `1k` and `1d` to `9d`, 29 levels total. |
| Local two-player game | Implemented | Two players alternate moves on the same computer. |
| LAN games | Implemented | Create, discover, or join rooms with an optional password and reconnect support. |
| Rule settings | Implemented | Chinese, Japanese/Korean, and AGA rules. |
| Handicap settings | Implemented | Even game, reverse komi/handicap start, and 2 to 9 stones. |
| Time settings | Implemented | Blitz, standard, slow, custom, and untimed presets. |
| Basic game actions | Implemented | Captures, suicide prevention, ko, undo, redo, pass, resign, and restart. |
| AI analysis | Implemented | Win rate, score lead, candidate moves, and on-demand recommendations. |
| AI territory prediction | Implemented | Local games use GNU Go estimates; research and LAN games use KataGo ownership. |
| Final adjudication | Implemented | GNU Go checks scoring readiness, identifies dead stones, and proposes a final result for local games. Cancelling resumes play. |
| Move numbers | Implemented | Shows move order on stones. |
| Research board | Implemented | Setup editing, variation trees, marks, notes, undo/redo, SGF import/export, and KataGo analysis. |
| Game library | Implemented | Local SQLite storage, search and filters, favorites, tags, collections, batch operations, trash, and backups. |

## Language Support

The application UI is currently primarily Chinese. The repository documentation is available in Chinese and English so that both audiences can browse the project comfortably.

Application-level language switching is not complete yet. To add it, the recommended next step is to introduce Vue I18n and move UI labels, errors, and settings into `src/locales/zh-CN.ts` and `src/locales/en-US.ts`. Many strings are currently written directly in Vue templates and Rust error messages.

## User Guide

### 1. First launch

The desktop app probes the KataGo runtime and warms up the engine on startup. Wait until the engine status is ready before entering an AI game.

The browser development mode is suitable for previewing the UI, but browsers do not provide the Tauri native commands required by KataGo and LAN games. Use `npm run desktop:dev` for the complete desktop experience.

### 2. Start an AI game

1. Choose **Human vs AI** on the home screen.
2. Choose Black, White, or a random color.
3. Choose the rule set, handicap, and time control.
4. Choose a KataGo strength level.
5. Start the game.

The Human SL model is used to produce human-style moves. Recommendations use a separate high-strength model and are requested on demand, so the app does not continuously consume GPU resources in the background.

### 3. Start a local two-player game

Choose **Local Game** on the home screen. Two players can alternate moves and use the standard game controls, including timing, undo, redo, pass, resign, and restart.

### 4. Start a LAN game

Both computers must be on the same local network and run the desktop application.

Host workflow:

1. Open **LAN Game**.
2. Configure the host color, rules, handicap, and time control.
3. Optionally set a room password.
4. Create the room and share the displayed LAN address, port, and password.

Join workflow:

1. Open **LAN Game**.
2. Scan for rooms or enter the host IP address and port manually.
3. Enter the password and join.

The default TCP port starts at `19888`. If it is occupied, the application tries subsequent ports. UDP `19889` is used for room discovery. Allow the application through Windows Firewall when prompted.

### 5. Use AI analysis

On-demand analysis can display:

- Black and White win rates.
- KataGo's estimated score lead.
- Candidate moves and variations.
- AI-predicted territory.
- Optional move numbers on stones.

After a move, undo, redo, or restart, previous analysis becomes stale and must be requested again. Analysis is performed locally and the game is not uploaded.

### 6. Research board and game library

The research board supports moves, setup editing, marks, notes, variation navigation, main-line promotion, undo/redo, draft restoration, and KataGo analysis. Import SGF files, preview AI variations, add them to the tree, and export SGF or save to the library.

The game library supports imports, saving, search and filters, favorites, tags, collections, review status, batch operations, trash, and backups. Local and LAN games can be archived and opened for research.

## Development Requirements

For full desktop development, use Windows 10/11 x64 with:

- Node.js 20 or newer.
- npm 11 or newer, with dependencies pinned by `package-lock.json`.
- Rust stable; see `rust-version` in `src-tauri/Cargo.toml`.
- Visual Studio C++ Build Tools and the Windows SDK.
- WebView2 Runtime.
- A compatible NVIDIA driver, CUDA/TensorRT runtime, and NVIDIA GPU for the TensorRT KataGo build.

The frontend can be previewed without an NVIDIA GPU, but engine warmup, AI games, and analysis require a working local KataGo runtime.

## Running Locally

### Install dependencies

```bash
npm install
```

The project uses npm. npm installs dependencies from `package-lock.json`.

### Browser development mode

```bash
npm run dev
```

Open `http://127.0.0.1:5173/`. This mode is for frontend development and does not provide the full Tauri engine integration.

### Tauri desktop development mode

```bash
npm run desktop:dev
```

This starts Vite and the Tauri desktop window. It is the recommended mode for testing KataGo, LAN games, and desktop interactions.

### Build

```bash
# Build the Vue frontend
npm run build

# Build the Windows desktop application and installers
npm run desktop:build
```

Build output is written under `src-tauri/target/release/`. `dist/`, `target/`, and `target-lan/` are generated files and should not be committed.

## KataGo Runtime Assets

KataGo assets are large and some files are covered by third-party project or model licenses. The application looks under `src-tauri/resources/` for the runtime, configuration, and models:

```text
src-tauri/resources/
├─ katago/
│  ├─ katago.exe
│  ├─ model.bin.gz
│  ├─ analysis.cfg
│  └─ TensorRT / CUDA / Windows DLLs
├─ katago-estimate/
│  ├─ analysis_example.cfg or analysis.cfg
│  ├─ model files
│  └─ optional standalone runtime files
└─ katago-human/
   └─ b18c384nbt-humanv0.bin.gz
```

Runtime discovery is implemented in `src-tauri/src/katago.rs`. The application first checks whether the executable can actually start, then selects a model and analysis configuration. Missing `katago.exe`, model files, configuration, TensorRT/CUDA DLLs, or GPU drivers will cause an engine startup error.

The current `.gitignore` excludes large files in the standard `katago/` directory, while the Human SL model and some profile files still need an explicit publishing decision. GitHub rejects regular Git files larger than 100 MB.

Recommended distribution strategy:

1. Keep configurations and setup instructions in the source repository.
2. Store large models with Git LFS or publish them in GitHub Releases / trusted object storage.
3. Document the model version, source, SHA-256 checksum, and license.
4. Never commit local logs, TensorRT caches, build directories, or debug screenshots.

With Git LFS:

```bash
git lfs install
git lfs track "src-tauri/resources/katago-human/*.bin.gz"
git lfs track "src-tauri/resources/katago/*.bin.gz"
git add .gitattributes
```

Confirm the model's source and license before publishing it in a public repository.

## Project Structure

```text
ShiGuang-Go/
├─ public/                         Static images, board themes, and home assets
├─ src/
│  ├─ assets/                      Vue static assets
│  ├─ components/
│  │  ├─ analysis/                 Win-rate chart and AI analysis panels
│  │  ├─ board/                    Canvas board and board rendering
│  │  ├─ game/                     Player headers, controls, and settings dialogs
│  │  └─ ui/                       Shared UI components such as dropdowns
│  ├─ domain/                      Go rules, scoring, game setup, themes, and sessions
│  ├─ router/                      Vue Router configuration
│  ├─ services/                    KataGo and LAN service calls
│  ├─ stores/                      Pinia stores for game and LAN state
│  ├─ types/                       TypeScript domain types
│  └─ views/                       Home, game, LAN, research, library, and settings views
├─ src-tauri/
│  ├─ src/lib.rs                   Tauri entry point and command registration
│  ├─ src/katago.rs                KataGo processes, JSON Analysis Engine, and GTP
│  ├─ src/lan.rs                   LAN rooms, discovery, communication, and reconnects
│  ├─ resources/                   KataGo runtime, models, and configuration
│  ├─ capabilities/                Tauri permissions
│  ├─ icons/                       Application icons
│  └─ tauri.conf.json              Desktop window, resource, and bundle configuration
├─ index.html                      Vite entry point
├─ package.json                    Frontend dependencies and scripts
├─ package-lock.json               npm dependency lockfile
├─ vite.config.ts                  Vite configuration
├─ tsconfig*.json                  TypeScript configuration
└─ README*.md                      Chinese and English project documentation
```

## Architecture

```text
Vue 3 / TypeScript / Pinia
              │
              ├─ services/katago.ts ── Tauri invoke ──┐
              └─ services/lan.ts    ── Tauri invoke ──┤
                                                       ▼
                                     Rust / Tauri 2 backend
                                      ├─ KataGo JSON/GTP
                                      └─ TCP/UDP LAN service
                                                       │
                                                       ▼
                                      Local models and runtime assets
```

- The Vue frontend owns the board UI and most interactions.
- Rules, scoring, captures, and game state are concentrated in `src/domain/`.
- Rust manages KataGo child processes. The frontend invokes analysis, final scoring, and engine status through Tauri commands.
- Rust maintains TCP rooms and UDP discovery for LAN games, while Vue handles setup and board presentation.
- Settings, the last AI strength, and board themes are stored locally.

## Verification Commands

Before committing, run at least:

```bash
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Tests that require real KataGo assets cannot pass without a local engine. The project does not yet have complete frontend linting, end-to-end tests, or a CI workflow.

## Known Limitations and Roadmap

- GNU Go adjudication supports Chinese and Japanese/Korean rules, not AGA rules. Scoring readiness is a conservative heuristic, not a proof of a settled position.
- Add a formal Chinese/English language switch inside the application.
- Define a clean distribution path for KataGo models and the TensorRT runtime.
- Expand the supported platform matrix beyond the currently focused Windows environment.
- The Windows x64 full installer is published on GitHub. Gitee mirrors the source and download link but does not yet have a release page. GitHub Actions and clean-machine validation remain planned work.

## Contributing

1. Fork the repository and create a feature branch.
2. Keep commits focused and update the documentation for user-visible features.
3. Run `npm run build` and the relevant Rust checks before submitting.
4. Open a Pull Request with the change summary, test steps, and known limitations.

Suggested commit prefixes:

```text
feat: add SGF import
fix: handle disconnected LAN room
docs: update bilingual README
```

## Privacy and Security

- Games and analysis are processed locally by default.
- LAN networking is used only after the user creates or joins a room.
- Do not commit API keys, personal IP records, debug logs, or local configuration files.
- LAN room passwords are intended for trusted networks and are not a replacement for strong authentication or encrypted transport.

## License and Third-Party Notices

The repository does not currently contain a root `LICENSE` file. Before publishing, choose and add a project license, and review the redistribution terms for KataGo, models, TensorRT/CUDA DLLs, fonts, images, and icons.

A public repository does not automatically grant permission to redistribute every runtime asset. Before release, add a third-party notice listing each external component's source, version, license, download URL, and checksum.

## GitHub Release Checklist

- [ ] Create the GitHub repository without auto-generating a README, `.gitignore`, or license that could conflict with local files.
- [ ] Confirm that `.gitignore` excludes `node_modules/`, `dist/`, `target*/`, screenshot directories, logs, TensorRT caches, and large models.
- [ ] Check `git ls-files` and the Git history for secrets, personal paths, debug data, or models that should not be public.
- [ ] Choose a project license and add a root `LICENSE` file.
- [ ] Complete `THIRD_PARTY_ASSETS.md` and confirm licenses for KataGo, models, DLLs, images, fonts, and icons.
- [ ] Choose Git LFS, GitHub Releases, or a separate download URL for models, and record SHA-256 checksums.
- [ ] Add a repository description, Topics, screenshots, and Releases in GitHub.
- [ ] Configure GitHub Actions to run at least the frontend build and Rust tests.
- [ ] Validate the complete flow on a clean computer: install dependencies, prepare models, launch the desktop app, and create a LAN room.
- [ ] For an in-app Chinese/English switch, add Vue I18n and keep all new copy in both locale resource files.

## Related Projects

- [KataGo](https://github.com/lightvector/KataGo)
- [Tauri](https://tauri.app/)
- [Vue](https://vuejs.org/)
- [Vite](https://vite.dev/)
- [Pinia](https://pinia.vuejs.org/)
