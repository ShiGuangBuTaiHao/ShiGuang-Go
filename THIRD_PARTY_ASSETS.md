# 第三方资源与许可证清单

本文件用于在公开发布前记录项目使用的第三方代码、运行时、模型、图片、字体和图标。请为每一项补充准确版本、来源、许可证和校验值。仓库是 Public 并不代表所有资源都可以自由再分发。

## 使用说明

发布前逐项确认：

- 资源是否允许公开仓库分发。
- 是否需要在应用、安装包或仓库中附带版权声明。
- 是否需要提供源代码、许可证全文或下载地址。
- 是否存在 100 MB 文件限制、Git LFS 或单独 Release 的要求。
- 模型和二进制文件是否需要记录 SHA-256。

## 当前资源

| 资源 | 项目位置或依赖 | 当前用途 | 版本 / 来源 | 许可证 | 发布状态 |
| --- | --- | --- | --- | --- | --- |
| KataGo executable | `src-tauri/resources/katago*/katago.exe` | 本地围棋分析和终局计分 | 待补充 | 待确认 | 不应在确认前直接公开分发 |
| KataGo analysis model | `src-tauri/resources/katago*/*.bin.gz` | 胜率、候选点和终局分析 | 待补充 | 待确认 | 建议 Git LFS 或 GitHub Release |
| KataGo Human SL model | `src-tauri/resources/katago-human/` | 人类风格棋力 | 待补充 | 待确认 | 建议单独发布并记录校验值 |
| TensorRT / CUDA DLL | `src-tauri/resources/katago/` | GPU 推理运行时 | 待补充 | 待确认 | 需要确认 NVIDIA 再分发条款 |
| Windows runtime DLL | `src-tauri/resources/katago*/` | Windows 程序运行依赖 | 待补充 | 待确认 | 需要确认各 DLL 来源和许可 |
| Board and home images | `public/` | 首页、棋盘和功能入口视觉资源 | AI 生成（用户说明，平台待补充） | 待核对生成平台的适用条款 | 已记录生成来源说明，尚未完成许可核对 |
| Board SVG assets | `public/board-themes/` | 棋子和棋盘主题 | 项目资源 / 待补充 | 待确认 | 逐项确认来源 |
| Vue | `package.json` | 前端框架 | 以 lockfile 为准 | 待确认 | 依赖许可需保留 |
| Tauri | `package.json`, `src-tauri/Cargo.toml` | 桌面容器和原生桥接 | 以 lockfile 为准 | 待确认 | 依赖许可需保留 |
| ECharts | `package.json` | 胜率图表 | 以 lockfile 为准 | 待确认 | 依赖许可需保留 |
| lucide-vue-next | `package.json` | 界面图标 | 以 lockfile 为准 | 待确认 | 依赖许可需保留 |

## 图片来源补充

2026 年 10 月 14 日，项目所有者说明项目图片由 AI 生成。当前已记录该说明，尚未确认生成平台、模型、生成时间及对应文件范围，因此暂不将图片标记为许可核对完成。

后续补充生成平台与适用条款，并确认是否使用第三方参考图片。该说明不自动涵盖 SVG、字体、图标及其他依赖资源，也不代替项目自身发行许可证的选择。

## 推荐记录格式

每个大型模型或二进制资源至少记录：

```text
名称：
版本：
官方下载地址：
实际下载地址：
文件名：
文件大小：
SHA-256：
许可证：
是否允许再分发：
备注：
```

## 发布前检查

- [ ] 根目录已添加项目许可证文件，例如 `LICENSE`。
- [ ] KataGo 源码、可执行文件、模型和配置的许可证已核对。
- [ ] TensorRT、CUDA、Windows DLL 的来源和再分发条款已核对。
- [ ] `public/` 下的图片、字体、SVG 和图标都有明确来源。
- [ ] 大于 100 MB 的文件已移出普通 Git，或通过 Git LFS / Release 分发。
- [ ] README 中已写清楚模型下载和安装方法。
- [ ] 已检查 Git 历史，确认没有提交密钥、个人路径、日志或本地调试数据。

