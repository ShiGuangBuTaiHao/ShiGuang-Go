# 时光围棋 v1.0.0

发布日期：2026 年 10 月 14 日

## 发行内容

本次发布 v1.0.0 源码及 Windows x64 完整安装包，统一前端、Rust、Tauri 和应用界面的版本号。

完整安装包文件名为 `ShiGuang-Go_1.0.0_windows-x64-full-setup.exe`，大小为 1,060,459,499 字节。包含 KataGo、分析模型、Human SL 模型、GNU Go、TensorRT/CUDA 本地运行资源及离线 WebView2 安装器。安装包基于原 `v1.0.0` 标签提交 `7dba4b75e04cb8e3d41478262700f15037df25dc`，不包含之后的工作区改动。

下载后先核对 `SHA256SUMS.txt`，运行安装器；安装和设备要求见附件 `INSTALLATION.md`。完整包提供已捆绑的本地资源，不表示适用于全部硬件或无需显卡驱动。

发行页保留 3 个附件：安装包、`SHA256SUMS.txt` 和 `INSTALLATION.md`。普通用户只需下载安装包；底部两个 `Source code` 为源码压缩包，不用于安装软件。

安装包 SHA-256：`c68180f563c74bebdbfab5776132381bbe73b3d54cdc6256c4e625bfac866fbd`。

## 发行注意事项

- 当前已验证设备为 RTX 4060 Laptop GPU，驱动 610.47；TensorRT 构建资源仅包含 `sm89`，其他 GPU 架构未验证。
- 安装包不安装 NVIDIA 显卡驱动，首次 AI 启动可能需要生成推理缓存。
- 安装包未进行数字签名，Windows 可能显示发布者未知或安全提示。
- 依项目所有者明确要求发布现有安装包；TensorRT/CUDA、Visual C++ 运行库的完整再分发依据、图片分发条件及项目级许可证仍未全部确认。本发行不代表这些问题已经完成审核。
- 补充许可资料不再作为发行附件列出，保留于[源码仓库许可资料包](https://github.com/ShiGuangBuTaiHao/ShiGuang-Go/blob/main/release/v1.0.0/THIRD-PARTY-LICENSES.zip)；安装包未重新构建纳入这些后续文件。其他核对资料也保留在源码仓库：[第三方资源说明](https://github.com/ShiGuangBuTaiHao/ShiGuang-Go/blob/main/THIRD_PARTY_ASSETS.md)、[原构建许可核对记录](https://github.com/ShiGuangBuTaiHao/ShiGuang-Go/blob/main/release/v1.0.0/license-review.json)、[资源清单](https://github.com/ShiGuangBuTaiHao/ShiGuang-Go/blob/main/release/v1.0.0/resource-manifest.json)。精简附件不表示许可问题已经解决。

## 主要功能

- 支持人机对局、本地双人对局和局域网对局，以及棋力、规则、让子和用时设置。
- 完善局域网心跳、命令去重、Windows 房间发现、错误恢复和创建/加入房间弹窗。
- 研究工作台支持变化树、摆子、标记、备注、主线调整、撤销重做和本地草稿恢复。
- SGF 导入导出保留分支、摆子、标记、备注、未知属性和精确贴目。
- KataGo 支持自定义初始局面、指定执子方、9/13/19 路分析及候选变化预览。
- 棋谱库支持 SQLite 本地保存、搜索筛选、收藏标签、分类集合、复盘状态和批量操作。
- 支持棋谱回收站、备份恢复，以及本地和局域网对局保存棋谱。
- GNU Go 提供本地对局形势估计、死子识别、数子就绪检查、终局裁判和取消恢复。
- 统一对局侧栏和设置组件，引擎不可用时仍可进入主界面并重试。
- Windows WiX 安装器使用中文语言配置。

## 验证结果

- 前端生产构建通过。
- JavaScript 测试：39 项通过。
- Rust 测试：33 项通过，2 项真实 KataGo 集成测试默认跳过。
- 功能批次提交均经过独立快照构建验证。
- 打包程序的 13 项本机界面检查通过；隔离发行构建资源后确认使用包内 KataGo。
- 当前设备真实引擎分析通过；未完成干净电脑的安装、升级和卸载验证。

## 已知限制

- 当前重点验证环境为 Windows x64，其他平台尚未作为稳定目标发布。
- AI 对局与分析需要可用的 KataGo 本地运行时；TensorRT 配置需要兼容的 NVIDIA GPU、驱动和运行库。
- GNU Go 裁判不支持 AGA 规则，数子就绪检查是保守判断，并非局面完全定型的数学证明。
- 应用界面以中文为主，尚未提供正式的中英文切换。
- 尚未完成安装包在干净电脑上的完整验证。
