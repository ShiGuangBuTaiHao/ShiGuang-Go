# ShiGuang-Go | 时光围棋

[中文](README.md) | [English](README.en.md)

> 一个面向 Windows 桌面端的本地 AI 围棋应用。当前版本为 `1.0.0`。

本次为源码发行，更新内容见 [v1.0.0 发行说明](RELEASE_NOTES.md)。安装包及大型引擎运行资源未随本次发行提供。

## 产品介绍

时光围棋是一款以本地运行、低延迟和专注棋盘体验为目标的桌面围棋应用。它使用 Vue 3 和 TypeScript 构建界面，使用 Tauri 2 和 Rust 连接本地 KataGo 引擎，不依赖云端账号，也不会把棋局发送到远程服务器。

项目适合以下场景：

- 与 KataGo 进行不同棋力的人机对局。
- 两个人在同一台电脑上进行双人对局。
- 在同一个局域网内创建房间，与另一台电脑对局。
- 在棋盘上查看胜率、目差、推荐落点和 AI 预测形势。
- 作为一个 Vue、Tauri、Rust、围棋规则和本地 AI 引擎整合的学习项目。

## 功能概览

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 人机对局 | 已实现 | 使用 KataGo Human SL 模型，支持 `20k` 至 `1k`、`1d` 至 `9d` 共 29 档棋力。 |
| 双人对局 | 已实现 | 两位玩家在同一台电脑轮流落子。 |
| 局域网对局 | 已实现 | 支持创建房间、扫描房间、手动输入 IP 和端口、可选房间密码及断线恢复。 |
| 规则设置 | 已实现 | 支持中国规则、日韩规则和 AGA 规则。 |
| 让子设置 | 已实现 | 支持分先、让先以及 2 至 9 子。 |
| 用时设置 | 已实现 | 快棋、普通、慢棋、自定义和不计时。 |
| 基础棋局操作 | 已实现 | 落子、提子、禁自杀、打劫、悔棋、重做、停一手、认输和重新开始。 |
| AI 分析 | 已实现 | 查看胜率、目差、候选变化和推荐落点，分析按需触发。 |
| AI 预测形势 | 已实现 | 本地对局使用 GNU Go 估计形势；研究盘和局域网对局使用 KataGo ownership。 |
| 终局裁判 | 已实现 | 本地对局通过 GNU Go 检查数子条件、识别死子并确认结果，支持取消后继续对局。 |
| 手数显示 | 已实现 | 在棋子上显示落子顺序。 |
| 研究盘 | 已实现 | 支持自由摆子、变化树、标记备注、撤销重做、SGF 导入导出和 KataGo 分析。 |
| 棋谱库 | 已实现 | 支持 SQLite 本地保存、搜索筛选、收藏标签、分类集合、批量操作、回收站及备份恢复。 |

## 界面语言

当前应用界面主要是中文；仓库文档提供中文和英文两份版本，方便中英文用户阅读项目说明。

如果要让应用本身支持中英文切换，建议后续引入 Vue I18n，并把界面文案、错误信息和设置标签集中到 `src/locales/zh-CN.ts` 与 `src/locales/en-US.ts`。目前代码中仍有较多直接写在 Vue 模板和 Rust 错误信息里的中文，因此应用级国际化还没有完成。

## 使用教程

### 1. 首次启动

启动桌面端后，应用会先探测 KataGo 运行时并执行预热。等待引擎状态变为就绪后，再进入人机对局。

如果只运行浏览器开发模式，页面可以预览，但浏览器不具备 Tauri 的原生能力，因此 KataGo 引擎和局域网功能不能完整工作。需要完整体验时请使用 `npm run desktop:dev`。

### 2. 开始人机对局

1. 在首页选择“人机对局”。
2. 选择执黑、执白或猜先。
3. 选择规则、让子方式和用时方案。
4. 选择 KataGo 的棋力等级。
5. 点击“开始对局”。

AI 棋力使用 Human SL 模型模拟人类落子倾向。推荐落点使用独立的高强度普通模型分析，不会在后台持续占用 GPU；需要时点击分析按钮获取结果。

### 3. 进行双人对局

在首页选择“双人对局”即可开始本地双人棋局。棋局支持基本围棋规则、计时、悔棋、重做、停一手、认输和重新开始。

### 4. 进行局域网对局

两台电脑需要位于同一个局域网中，并且都运行桌面端应用。

主机操作：

1. 进入“局域网对局”。
2. 设置主机执棋颜色、规则、让子和用时。
3. 可选设置房间密码。
4. 创建房间后，把界面显示的局域网 IP、端口和密码告诉另一位玩家。

加入者操作：

1. 进入“局域网对局”。
2. 点击扫描房间，或手动输入主机 IP 和端口。
3. 输入房间密码并加入。

默认 TCP 端口从 `19888` 开始，如果端口被占用，程序会自动尝试后续端口；房间发现使用 UDP `19889`。Windows 防火墙弹窗出现时，需要允许应用进行局域网通信。

### 5. 使用 AI 分析

在棋局中可以按需请求分析，界面会显示：

- 当前局面的黑白胜率。
- KataGo 估计的目差。
- 候选落点和变化。
- AI 预测的棋盘势力。
- 可选的棋子落子手数。

落子、悔棋、重做或重新开始后，旧的分析结果会失效，需要重新获取。分析使用本地 KataGo，不会上传棋局。

### 6. 研究盘和棋谱库

研究盘支持落子、摆子、标记、备注、变化树导航、主线调整、撤销重做、草稿恢复和 KataGo 分析。可导入 SGF，预览 AI 候选变化并加入研究，再导出 SGF 或保存到棋谱库。

棋谱库支持导入、保存、搜索筛选、收藏标签、分类集合、复盘状态、批量操作、回收站及备份恢复。本地和局域网对局均可保存棋谱，并从棋谱库进入研究。

## 开发环境

完整桌面端开发建议使用 Windows 10/11 x64，并准备以下工具：

- Node.js 20 或更高版本。
- npm 11 或更高版本，项目使用 `package-lock.json` 管理依赖。
- Rust stable，最低版本见 `src-tauri/Cargo.toml` 中的 `rust-version`。
- Visual Studio C++ Build Tools 和 Windows SDK。
- WebView2 Runtime。
- 运行 KataGo TensorRT 版本时，需要兼容的 NVIDIA 驱动、CUDA/TensorRT 动态库和可用的 NVIDIA GPU。

前端页面可以在没有 NVIDIA GPU 的情况下进行部分预览，但完整的人机、AI 分析和引擎预热需要可用的 KataGo 本地运行时。

## 本地运行

### 安装依赖

```bash
npm install
```

项目使用 npm，npm 会根据 `package-lock.json` 安装依赖。

### 浏览器开发模式

```bash
npm run dev
```

打开 `http://127.0.0.1:5173/`。此模式用于开发前端界面，不能提供完整的 Tauri 原生引擎能力。

### Tauri 桌面开发模式

```bash
npm run desktop:dev
```

该命令会启动 Vite 和 Tauri 桌面窗口，是测试 KataGo、局域网和桌面交互的推荐方式。

### 构建

```bash
# 构建 Vue 前端
npm run build

# 构建 Windows 桌面应用及安装包
npm run desktop:build
```

构建产物默认位于 `src-tauri/target/release/` 下。`dist/`、`target/` 和 `target-lan/` 都是构建产物，不应提交到 Git。

## KataGo 运行资源

KataGo 资源体积较大，并且部分文件受到第三方项目和模型许可约束。程序会从 `src-tauri/resources/` 中寻找运行时、配置和模型：

```text
src-tauri/resources/
├─ katago/
│  ├─ katago.exe
│  ├─ model.bin.gz
│  ├─ analysis.cfg
│  └─ TensorRT / CUDA / Windows DLL
├─ katago-estimate/
│  ├─ analysis_example.cfg 或 analysis.cfg
│  ├─ 模型文件
│  └─ 可选的独立运行时文件
└─ katago-human/
   └─ b18c384nbt-humanv0.bin.gz
```

运行时选择逻辑在 `src-tauri/src/katago.rs` 中：程序会先探测可执行文件是否真正能够启动，再选择模型和分析配置。缺少 `katago.exe`、模型、配置文件、TensorRT/CUDA DLL 或显卡驱动时，启动页会显示引擎错误。

当前仓库的 `.gitignore` 会排除标准 `katago/` 目录中的大型运行文件，但 Human SL 模型和部分配置档仍需要在上传前单独确认。GitHub 普通 Git 文件限制为 100 MB，不能把超过限制的模型直接提交。

推荐的资源发布方案：

1. 源代码仓库只保留配置、说明和下载脚本。
2. 大模型使用 Git LFS，或放到 GitHub Release / 可信的对象存储中。
3. 在 README 中写明模型版本、来源、SHA-256 校验值和许可证。
4. 不要把本地日志、TensorRT cache、构建目录和调试截图提交到仓库。

如果使用 Git LFS，可以这样配置模型文件：

```bash
git lfs install
git lfs track "src-tauri/resources/katago-human/*.bin.gz"
git lfs track "src-tauri/resources/katago/*.bin.gz"
git add .gitattributes
```

请先确认模型来源和许可证，再决定是否把模型发布到公共仓库。

## 项目目录

```text
ShiGuang-Go/
├─ public/                         静态图片、棋盘主题和首页资源
├─ src/
│  ├─ assets/                      Vue 静态资源
│  ├─ components/
│  │  ├─ analysis/                 胜率图和 AI 分析面板
│  │  ├─ board/                    棋盘 Canvas 与棋盘显示
│  │  ├─ game/                     对局头部、控制面板和设置弹窗
│  │  └─ ui/                       下拉菜单等通用界面组件
│  ├─ domain/                      围棋规则、计分、局面、主题和对局设置
│  ├─ router/                      Vue Router 路由
│  ├─ services/                    KataGo 与局域网服务调用
│  ├─ stores/                      Pinia 状态，包括棋局和局域网状态
│  ├─ types/                       TypeScript 领域类型
│  └─ views/                       首页、对局、局域网、研究、棋谱库和设置页面
├─ src-tauri/
│  ├─ src/lib.rs                   Tauri 应用入口和命令注册
│  ├─ src/katago.rs                KataGo 进程、JSON Analysis Engine 和 GTP
│  ├─ src/lan.rs                   局域网房间、发现、通信和断线处理
│  ├─ resources/                   KataGo 运行时、模型和配置
│  ├─ capabilities/                Tauri 权限配置
│  ├─ icons/                       应用图标
│  └─ tauri.conf.json              桌面窗口、资源和打包配置
├─ index.html                      Vite 入口
├─ package.json                    前端依赖和开发命令
├─ package-lock.json               npm 依赖锁定文件
├─ vite.config.ts                  Vite 配置
├─ tsconfig*.json                  TypeScript 配置
└─ README*.md                      中英文项目说明
```

## 技术架构

```text
Vue 3 / TypeScript / Pinia
              │
              ├─ services/katago.ts ── Tauri invoke ──┐
              └─ services/lan.ts    ── Tauri invoke ──┤
                                                       ▼
                                     Rust / Tauri 2 后端
                                      ├─ KataGo JSON/GTP
                                      └─ TCP/UDP 局域网服务
                                                       │
                                                       ▼
                                      本地模型和运行时资源
```

- 棋盘和大部分交互逻辑在 Vue 前端完成。
- 规则、计分、提子和局面状态集中在 `src/domain/`。
- KataGo 子进程由 Rust 管理，前端通过 Tauri command 请求分析、终局计分和引擎状态。
- 局域网对局由 Rust 维护 TCP 房间和 UDP 房间发现，前端负责设置和棋盘展示。
- 设置、最近一次人机棋力和棋盘主题使用本地存储保存。

## 验证命令

提交代码前建议至少执行：

```bash
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

需要真实 KataGo 资源的测试不会在缺少本地引擎时自动通过。当前项目还没有完整的前端 lint、端到端测试和 CI 工作流，这些属于发布前的待补项目。

## 已知限制与后续计划

- GNU Go 裁判支持中国规则和日韩规则，不支持 AGA 规则；数子就绪检查是保守判断，并非局面已完全定型的数学证明。
- 应用界面尚未接入正式的中英文语言切换。
- KataGo 大模型和 TensorRT 运行时的分发方式还需要进一步整理。
- 当前重点验证环境是 Windows，跨平台构建尚未作为稳定目标发布。
- 本次为源码发行，后续仍需补充 GitHub Actions、安装包和干净环境验证。

## 贡献代码

1. Fork 本仓库并创建功能分支。
2. 保持提交范围单一，并为用户可见功能补充文档。
3. 提交前运行 `npm run build` 和相关 Rust 检查。
4. 创建 Pull Request，说明改动内容、测试方式和已知限制。

建议的提交格式：

```text
feat: add SGF import
fix: handle disconnected LAN room
docs: update bilingual README
```

## 隐私与安全

- 默认情况下，棋局和分析在本地处理。
- 局域网模式只会在用户选择加入或创建房间后进行网络通信。
- 不要提交 API 密钥、个人 IP 记录、调试日志或本地配置文件。
- 局域网房间密码只适合在可信网络中使用，不能替代正式的身份认证和加密传输。

## 许可证与第三方声明

本项目当前还没有确定根目录 `LICENSE` 文件。公开发布前需要选择并添加项目许可证，同时逐项确认 KataGo、模型、TensorRT/CUDA DLL、字体、图片和图标的再分发许可。

不要因为仓库是 Public 就默认所有运行资源都可以自由分发。建议在发布前新增一份第三方声明，记录每个外部组件的来源、版本、许可证、下载地址和校验值。

## GitHub 发布前检查

- [ ] 创建 GitHub 仓库时不要自动生成 README、`.gitignore` 或 License，避免与本地文件冲突。
- [ ] 确认 `.gitignore` 已排除 `node_modules/`、`dist/`、`target*/`、截图目录、日志、TensorRT cache 和大型模型。
- [ ] 检查 `git ls-files` 和 Git 历史中没有密钥、个人路径、调试数据或不应公开的模型。
- [ ] 决定项目许可证，并在根目录添加 `LICENSE`。
- [ ] 补全 `THIRD_PARTY_ASSETS.md`，确认 KataGo、模型、DLL、图片、字体和图标的许可证。
- [ ] 为模型选择 Git LFS、GitHub Release 或独立下载地址，并记录 SHA-256。
- [ ] 在 GitHub 仓库设置中补充项目简介、Topics、截图和 Releases。
- [ ] 配置 GitHub Actions，至少自动执行前端构建和 Rust 测试。
- [ ] 在一台干净电脑上验证“安装依赖、准备模型、启动桌面端、创建局域网房间”的完整流程。
- [ ] 如果要支持应用内中英文切换，先接入 Vue I18n，再把新增文案纳入两种语言资源文件。

## 相关项目

- [KataGo](https://github.com/lightvector/KataGo)
- [Tauri](https://tauri.app/)
- [Vue](https://vuejs.org/)
- [Vite](https://vite.dev/)
- [Pinia](https://pinia.vuejs.org/)
