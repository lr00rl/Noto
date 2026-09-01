# G005 插件平台交接文档

更新时间：2026-08-31

状态：可继续实施，但 G005 尚未完成，也尚未获得本轮 2A 的最终独立代码审查和验证放行。

本文档是给下一位接手者的独立入口。它只描述当前仓库、已验证事实、明确边界和下一步，不要求读取此前会话记录才能继续工作。

## 1. 执行摘要

Noto 正在从一个 Typora 风格的桌面 Markdown 编辑器，演进为以插件为第一等能力的跨平台笔记软件。当前产品实现位于 `ElectronApp/`，技术栈已经确定为 TypeScript、Electron、React、Milkdown 和 ProseMirror。不要把工作迁回 Swift/AppKit 或 WebEditor 旧实现。

G001 至 G004 已完成并有各自质量门禁。G005 是插件生命周期与能力约束目标，当前状态为 `in_progress`。G005 的第一生产纵切已经通过。下一段正在进行的是 G005 Slice 2A：本地第三方实验插件包和隔离运行时的可执行探针。

当前可确认的边界如下：

| 范围 | 当前结论 | 可否当作完成 |
| --- | --- | --- |
| G001 Electron、Milkdown、受限插件边界 | 已完成 | 可以，见第一代门禁 |
| G002 无损 Markdown 投影 | 已完成 | 可以 |
| G003 文件真相、冲突和恢复 | 已完成 | 可以 |
| G004 日常 WYSIWYM 编辑体验 | 已完成 | 可以 |
| G005 第一生产纵切 | 已通过独立门禁 | 只能代表首切片，不是 G005 完成 |
| G005 Slice 2A 运行时探针 | 代码和自证已存在 | 不能，缺少修复后的独立审查和验证 |
| G005 Slice 2A 本地包安装和持久化 | 已有批准计划 | 尚未实施 |
| Typora 私有 API 原样兼容 | 延期 | 不要提前做 |
| 移动端、Web/PWA、云同步 | 延期 | 不要提前做 |

最近的 Slice 2A 修复覆盖了运行时自行关闭和心跳滥用两条失败路径。清理后工作树的自证结果为：`pnpm typecheck` 通过，Vitest 为 38 个文件、388 个测试通过，打包运行时自证连续三次通过。三次 PID 组分别是 `83286/83301/83302`、`84234/84235/84236`、`84822/84828/84829`，每组依次为 editor、runtime A、runtime B。此结果来自当前工作树和 `ElectronApp/test-results/g005-runtime-spike/run-1`、`run-2`、`run-3`，不是重新生成的质量门禁。

因此，接手后不得宣称 Slice 2A 为 `CLEAR`、`APPROVE` 或 G005 已完成。此前的独立审查在修复前后被中断或受容量限制影响，仍需在当前修复版本上重新执行独立代码审查、独立验证和打包端到端验证。

## 2. 用户不可退让的产品约束

以下要求来自项目方向，优先级高于实现便利性。

1. 编辑体验必须保持 Typora 式的所见即所得或所见即得。默认是单一、安静、排版漂亮的写作画布，而不是常驻 Markdown 源码、卡片仪表盘或插件管理后台。
2. 美观不是后续装饰。任何编辑器、插件中心、权限界面或错误态都必须和主编辑体验一致，并在 1440、900、375 三个宽度运行检查。
3. 插件是第一等能力，必须从架构第一天开始提供足够自由的扩展空间，同时通过能力代理、版本、生命周期、隔离和可撤销资源所有权保证宿主安全。
4. 当前内核选择固定为 TypeScript、Electron、React、Milkdown、ProseMirror。除非重开架构决策，不替换为 AppKit、Tauri 或单纯 Web 页面。
5. `typora-plugin-lite` 是用户长期维护的清洁室需求参考。可以学习它实际需要的能力和生命周期模式，不得复制 Typora 应用、私有 DOM、私有 API、字符串、主题、资源或闭源实现。
6. Typora 私有 API 的原样兼容层可以延期。当前目标是 Noto 自己稳定、最小、显式版本化的插件 ABI。
7. 移动端、Web/PWA、云同步可以延期。不得为这些未来目标弱化桌面本地安全边界。
8. 不新增依赖，除非用户明确授权并完成依赖评估。已有依赖已锁定在 `ElectronApp/package.json` 和 `ElectronApp/pnpm-lock.yaml`。

## 3. 工作区、工具链和启动位置

仓库根目录：`/Users/cdcd/roobli/lr00rl/Noto`

产品根目录：`/Users/cdcd/roobli/lr00rl/Noto/ElectronApp`

用户维护的清洁室参考：`/Users/cdcd/roobli/lr00rl/typora-plugin-lite`

Node 可执行文件：`/Users/cdcd/.nvm/versions/node/v22.19.0/bin/node`

Node 要求：`>=22.12.0 <23`。包管理器为 `pnpm@11.18.0`。

所有 Electron 命令必须从 `ElectronApp/` 执行。若当前 shell 没有正确 Node 22，使用：

```sh
export PATH="/Users/cdcd/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/cdcd/roobli/lr00rl/Noto/ElectronApp
node --version
pnpm --version
```

预期 Node 主版本为 22。不要在本机新建 Python 虚拟环境，也不需要 Python 参与本目标。

## 4. 当前 Git 工作树安全线

根仓库当前是脏工作树。`ElectronApp/` 当前也是根仓库的未跟踪目录，里面既有已完成交付，也有正在进行的 G005 代码和证据。不要因为它显示为 `?? ElectronApp/` 就删除、清理、重置或覆盖。

当前已修改的非 Electron 路径：

```text
DESIGN.md
Sources/NotoApp/Documents/DocumentSession.swift
Sources/NotoApp/Editor/EditorBridge.swift
Sources/NotoApp/Editor/EditorViewController.swift
Sources/NotoApp/Noto.entitlements
Tests/NotoAppTests/BootstrapConfigurationTests.swift
Tests/NotoAppTests/DocumentSessionTests.swift
Tests/NotoAppTests/EditorBridgeTests.swift
WebEditor/dist/editor.css
WebEditor/dist/editor.js
WebEditor/package.json
WebEditor/pnpm-lock.yaml
WebEditor/src/editor.css
WebEditor/src/editor.ts
WebEditor/tests/web-editor.test.mjs
WebEditor/tsconfig.json
WebEditor/src/markdown-projection-extension.ts
WebEditor/src/markdown-projection.ts
WebEditor/tests/fixtures/
WebEditor/tests/markdown-projection.test.mjs
docs/architecture/webkit-sandbox-entitlements.md
.claude/
.omc/
```

当前交接文档会新增 `docs/handoff/G005_PLUGIN_PLATFORM_HANDOFF.md`。除非明确负责这些目录，否则不要编辑、格式化、回退、移动或删除上面的路径。

安全规则：

- 不运行 `git reset --hard`、`git checkout -- .`、`git clean -fd`、递归删除，或针对仓库根目录的清理命令。
- 不假设现有 `out/`、`.vite/`、`test-results/` 可以直接删除。它们是当前验收证据的一部分，先完成本交接所述独立复核再决定保留策略。
- 新修改只落在明确负责的 `ElectronApp/`、`docs/handoff/` 或新的、隔离的测试夹具中。
- 每个实现切片开始前和结束后运行 `git status --short`，确认没有误触上述路径。

## 5. 已完成目标和可追溯证据

超目标清单：[` .omx/ultragoal/goals.json`](../../.omx/ultragoal/goals.json)。审计流水：[` .omx/ultragoal/ledger.jsonl`](../../.omx/ultragoal/ledger.jsonl)。链接文字前的空格仅为展示，实际文件路径没有空格。

### 5.1 G001：Electron Milkdown 插件探针

状态：`complete`。

目标：在生产模式 Electron 中建立受限 main、preload、renderer、utility process 边界，完成 React/Milkdown 单画布、Markdown 打开编辑保存、一个可信渲染器插件、一个受能力约束的文件服务插件，以及打包视觉检查。

主要证据：

- [`ElectronApp/artifacts/final-quality-gate.json`](../../ElectronApp/artifacts/final-quality-gate.json)
- [` .omx/handoff/g001-implementation-result.md`](../../.omx/handoff/g001-implementation-result.md)
- [` .omx/handoff/g001-final-code-review-verdict.md`](../../.omx/handoff/g001-final-code-review-verdict.md)
- [` .omx/handoff/g001-final-design-review-verdict.md`](../../.omx/handoff/g001-final-design-review-verdict.md)

### 5.2 G002：无损 Markdown 投影核心

状态：`complete`。

目标：Noto 自有的 Markdown envelope、源片段、语义块、opaque node 和变更块序列化管线。

主要证据：

- [`ElectronApp/artifacts/g002-quality-gate.json`](../../ElectronApp/artifacts/g002-quality-gate.json)
- [` .omx/handoff/g002-code-review-verdict.md`](../../.omx/handoff/g002-code-review-verdict.md)
- [` .omx/handoff/g002-architecture-review-verdict.md`](../../.omx/handoff/g002-architecture-review-verdict.md)

### 5.3 G003：文件真相、冲突和恢复

状态：`complete`。

目标：文件指纹、接受身份、原子替换、外部变更、精确失败、journal 恢复和临时文件清理。

主要证据：

- [`ElectronApp/artifacts/g003-quality-gate.json`](../../ElectronApp/artifacts/g003-quality-gate.json)
- [` .omx/handoff/g003-code-review-verdict.md`](../../.omx/handoff/g003-code-review-verdict.md)
- [` .omx/handoff/g003-architecture-review-verdict.md`](../../.omx/handoff/g003-architecture-review-verdict.md)
- [` .omx/handoff/g003-design-review-verdict.md`](../../.omx/handoff/g003-design-review-verdict.md)

### 5.4 G004：日常 WYSIWYM 编辑行为

状态：`complete`。

目标：稳定的 Milkdown/ProseMirror 编辑、活动单元标记显隐、选择映射、命令、撤销重做、中文输入法、粘贴、拖放、opaque block，以及仅在显式源码模式中启用 CodeMirror。

主要证据：

- [`ElectronApp/artifacts/g004-visual-repair-quality-gate.json`](../../ElectronApp/artifacts/g004-visual-repair-quality-gate.json)
- [` .omx/handoff/g004-visual-repair-result.md`](../../.omx/handoff/g004-visual-repair-result.md)
- [` .omx/handoff/g004-code-review-verdict.md`](../../.omx/handoff/g004-code-review-verdict.md)
- [` .omx/handoff/g004-design-review-verdict.md`](../../.omx/handoff/g004-design-review-verdict.md)

### 5.5 G005：首个生产插件纵切

状态：已通过首切片质量门禁，但 G005 总体仍是 `in_progress`。

首切片已验证内容：

- Main 进程是完整插件目录和本地状态的唯一权威。
- 默认禁用。启用后先进入 `enabled-idle`，只能由明确触发器激活。
- 生命周期具有 generation、AbortSignal、清理重试、持久化 CAS 和跨进程目录对账。
- Renderer 插件资源通过 lease 管理，renderer 侧发生销毁时主进程保持正确清理真相。
- 文件服务插件只通过能力 broker 获得范围化读取授权。
- 设置变更先持久化，再对存活运行时应用。
- 热键重复、旧 generation、过期上下文、未知 capability 和跨插件污染均必须拒绝。
- manifest 使用受限 SemVer 2.0 校验，日志诊断受限且脱敏。

首切片独立质量门禁：

- `pnpm compat:node22`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：36 文件、379 测试通过。
- 指定打包回归：15 个 Playwright 测试通过。
- G004 打包回归重复运行：9/9 和 30/30 通过。
- release package surface、fuse 检查和直接 release smoke：通过。
- 独立代码审查：`CLEAR`，0 blocker、0 high、0 medium、0 low。
- 独立设计审查：`APPROVE`，0 blocker、0 high、0 medium。
- 无障碍审查：`CLEAR`。

首切片证据入口：

- [`ElectronApp/artifacts/g005-first-vertical-slice-quality-gate.json`](../../ElectronApp/artifacts/g005-first-vertical-slice-quality-gate.json)
- [` .omx/handoff/g005-first-vertical-slice-result.md`](../../.omx/handoff/g005-first-vertical-slice-result.md)
- [` .omx/handoff/g005-first-vertical-slice-code-review-verdict.md`](../../.omx/handoff/g005-first-vertical-slice-code-review-verdict.md)
- [` .omx/handoff/g005-first-vertical-slice-verification-verdict.md`](../../.omx/handoff/g005-first-vertical-slice-verification-verdict.md)
- [` .omx/handoff/g005-first-vertical-slice-design-review-verdict.md`](../../.omx/handoff/g005-first-vertical-slice-design-review-verdict.md)
- [` .omx/handoff/g005-first-vertical-slice-a11y-verdict.md`](../../.omx/handoff/g005-first-vertical-slice-a11y-verdict.md)

这些结果仅覆盖第一纵切。不要因为首切片通过就跳过 2A 的新运行时风险审查。

## 6. G005 第一纵切架构和数据流

第一纵切的可维护基线如下。后续实现必须沿着此方向扩展，不要把目录真相移回 renderer。

```text
React / Milkdown 编辑器和 Plugin Center
        |
        | 受验证的 window.notoDesktop API
        v
preload
        |
        | 窄 IPC 合约，校验输入和来源
        v
main PluginRegistry -------------------- LocalPluginStateStore
        |                                        |
        | manifest、desiredEnabled、generation  | userData/plugins/local-state.json
        |
        +---- RendererLeaseBridge ----> RendererPluginClient
        |                                 |
        |                                 v
        |                          RendererPluginHost
        |
        +---- ServiceHost ----> utility process fs-service
        |                           |
        v                           v
CapabilityBroker                范围化文件读取
```

核心所有权：

| 资源或事实 | 唯一权威 | 说明 |
| --- | --- | --- |
| 插件目录、状态、desiredEnabled、generation | `PluginRegistry` | main 进程完整目录，不是 renderer 缓存 |
| 本地持久化状态 | `LocalPluginStateStore` | 当前路径 `<userData>/plugins/local-state.json` |
| renderer 资源 lease | `RendererLeaseBridge` | 维护请求、确认、超时和销毁信息 |
| renderer 本地资源 | `RendererPluginClient` 和 `RendererPluginHost` | 只持有 lease 对应的本地资源 |
| 文件读取授权 | `CapabilityBroker` | 读取路径必须在授权根内，绑定 registry/service generation |
| 服务进程生命周期 | `ServiceHost` | 绑定插件 generation，不允许旧运行时调用 |
| 用户可见快照 | `PluginLifecycleSnapshot` | 从 main 发布，renderer 只显示 |

关键状态：

```text
discovered -> enabled-idle -> activating -> active
    |             |              |          |
    v             v              v          v
disabled <--------- disabling <---- deactivating
    \_______________________________________/
                       失败可见为 failed
```

启用不等于激活。只有启动、命令、热键或其他 manifest 声明的显式触发器才能创建 generation。禁用时先撤销能力并停止资源，再持久化意图，任何清理失败都必须形成失败状态并可重试。

## 7. 当前 G005 Slice 2A 计划

权威计划：[` .omx/plans/g005-local-third-party-runtime-spike-2a.md`](../../.omx/plans/g005-local-third-party-runtime-spike-2a.md)。它取代了过宽的早期执行尝试，但不删除旧计划：[` .omx/plans/g005-local-third-party-packages-sandbox-sdk.md`](../../.omx/plans/g005-local-third-party-packages-sandbox-sdk.md)。

Slice 2 的分段顺序固定如下：

| 子切片 | 目标 | 当前状态 |
| --- | --- | --- |
| 2A | 本地无签名实验包、不可变导入、无权限 probation、独立 sandbox runtime、命令、布尔设置、受限私有状态、通用 Plugin Center 列表 | 运行时 Gate 1 代码已存在，独立复核待做 |
| 2B | Noto 编辑器读写 transaction ABI，`title-shift` 与 `md-padding` owner plugin | 未开始 |
| 2C | 更新、probation replacement、持久 active receipt CAS、回滚 | 未开始 |
| 2D | 可选签名连续性和通用已安装插件文件读取 | 未开始 |

2A 不是公开插件规范。它使用 `packageSchemaVersion: 0` 和 `apiVersion: 0`，Noto 在公开 v1 冻结前可以迁移或拒绝。不得把 v0 格式包装成稳定兼容承诺。

### 7.1 2A 功能范围

2A 只允许两个独立的本地目录包在 macOS 打包应用中安装和试运行。导入流程必须是：

```text
selected source
-> bounded pre-scan
-> race-detecting copy to Noto-owned staging
-> verify staging envelope
-> exclusive promote to package digest path
-> verify promoted envelope
-> install review
-> no-authority probation from promoted package
-> durable installed receipt commit
-> installed-disabled
```

源目录永不执行。已提升包也不能被假定为可信，运行前必须重新读取、重新验证并把唯一的 `plugin.mjs` 字节放入受限内存缓冲区。运行时只提供该缓冲区，不在 runtime generation 中重新打开插件文件。

目录结构固定：

```text
<name>.noto-plugin/
├── noto-package.json
├── manifest.json
├── integrity.json
└── dist/plugin.mjs
```

只允许这四个常规文件。不可接受 assets、archive、native module、worker、source map、二级模块或任何相对/外部模块导入。

安装目录固定：

```text
<userData>/plugins/experimental-v0/
├── pkg/<plugin-id>/<package-digest>/
├── installed/<plugin-id>.json
├── journal/<operation-id>.json
├── staging/<operation-id>/
└── state/<plugin-id>.json
```

2A 不含更新、回滚、卸载或垃圾回收。它们属于 2C。不得为了方便先实现这些跨切片能力。

### 7.2 2A 包和 ABI 约束

本地实验 ID 只能匹配 `local.<publisher>.<name>`，各段为小写 ASCII 字母数字，段内可使用点或连字符。`dev.lr00rl.noto.*` 和所有 bundled ID 保留，不能由本地包安装。

`noto-package.json` 必须只有如下语义字段：

```ts
{
  packageSchemaVersion: 0,
  pluginId: string,
  version: string,
  apiVersion: 0,
  entrypoint: 'dist/plugin.mjs',
  minimumHostVersion: string,
  platforms: Array<{ os: 'darwin' | 'win32' | 'linux'; arch: 'arm64' | 'x64' }>,
  stateSchemaVersion: 0
}
```

`manifest.json` 沿用 Noto 插件 manifest 的受限部分。2A 的 runtime 是 `sandboxed-plugin`。只允许：

- `commands`
- `settings.state`
- `ui.notice`

包不能声明 `trusted-renderer`、`isolated-service`、editor extension、filesystem、editor、shell、network、clipboard 或 remote-control 能力。settings 最多一个布尔值。

`integrity.json` 只验证 `noto-package.json`、`manifest.json`、`dist/plugin.mjs` 三个文件。包总大小不超过 2 MiB，入口不超过 1 MiB，每个控制 JSON 不超过 64 KiB，逻辑路径深度不超过 2。

所有逻辑路径只用 ASCII 字母数字、`.`、`_`、`-`、`/`。拒绝前导 `/`、驱动器、UNC、反斜杠、控制字符、Unicode、空段、`.`、`..`、末尾点或空格、Windows 保留名和 case-fold 冲突。

### 7.3 2A 安全和生命周期预算

probation 只能加载入口、完成握手、返回 ready/health、注册已由 manifest 宣布的命令、热键和设置。probation 不能调用命令、展示 notice、读写 state 或接触 editor、文件、shell、网络、clipboard、DOM、原始 IPC、Node。

预算：

| 项目 | 上限 |
| --- | --- |
| load/ready | 5 秒 |
| commands | 32 |
| hotkeys | 32 |
| settings | 1 个布尔值 |
| 握手和注册 envelope | 64 KiB |
| 心跳间隔 | 2 秒 |
| 连续失联宽限 | 5 秒 |
| 优雅 abort 确认 | 1 秒 |
| 强制销毁 | 3 秒 |

运行时的每个外部 IPC 都必须校验 sender、record、runtime generation、nonce、序号和状态。任何已销毁 sender、旧 generation、重复/过快 heartbeat、跨插件消息、无记录调用都不能重建状态或污染其他记录。

### 7.4 2A 平台范围

macOS 是 2A 的唯一可执行第三方包证明平台。Windows 和 Linux 只运行共享逻辑路径与 schema fixture。由于 Windows reparse/junction、主机路径和耐久性证明尚未完成，Windows/Linux 导入和激活必须返回 `unsupportedOnPlatform`。

不要把 macOS 运行时的成功外推为跨平台第三方安装已完成。

## 8. Gate 1：隔离运行时探针的当前状态

Gate 1 是 2A 的前置门。只有它经过独立复核，包存储、导入和 UI 才能继续实施。

已实现探针要求：

- 打包 macOS 应用启动 editor renderer、插件 runtime A、插件 runtime B。
- 使用 `webContents.getOSProcessId()` 确认三个 OS PID 两两不同。
- 插件 runtime 不可获得 Node/global/process/require/raw IPC。
- 外部 fetch、相对 fetch、external/relative/data/blob/query/fragment module import 均被阻止。
- popup、navigation、download、worker、`eval`、`Function` 均被阻止。
- AbortSignal 仅是 runtime realm 内对象，abort 必须通过 ABI 消息观察。
- ready timeout、进程 crash、heartbeat 丢失、destroyed sender、abort acknowledgement timeout、ledger exhaustion、self-close、heartbeat 过速都可观察且不会遗留 live runtime、PID、window、webContents 或 cleanup pending。

当前自证文件：

- [`ElectronApp/test-results/g005-runtime-spike/run-1/runtime-smoke.json`](../../ElectronApp/test-results/g005-runtime-spike/run-1/runtime-smoke.json)
- [`ElectronApp/test-results/g005-runtime-spike/run-2/runtime-smoke.json`](../../ElectronApp/test-results/g005-runtime-spike/run-2/runtime-smoke.json)
- [`ElectronApp/test-results/g005-runtime-spike/run-3/runtime-smoke.json`](../../ElectronApp/test-results/g005-runtime-spike/run-3/runtime-smoke.json)
- [`ElectronApp/test-results/g005-runtime-spike/run-1/logs/main.ndjson`](../../ElectronApp/test-results/g005-runtime-spike/run-1/logs/main.ndjson)
- [`ElectronApp/test-results/g005-runtime-spike/run-2/logs/main.ndjson`](../../ElectronApp/test-results/g005-runtime-spike/run-2/logs/main.ndjson)
- [`ElectronApp/test-results/g005-runtime-spike/run-3/logs/main.ndjson`](../../ElectronApp/test-results/g005-runtime-spike/run-3/logs/main.ndjson)

三次 `runtime-smoke.json` 的共同有效信号是：

```json
{
  "pairwiseDistinct": true,
  "failures": {
    "readyTimeout": true,
    "crashObserved": true,
    "heartbeatLossObserved": true,
    "destroyedSenderRejected": true,
    "abortAckTimeoutClosed": true,
    "ledgerExhaustionIsolated": true,
    "selfCloseCleaned": true,
    "heartbeatRateLimited": true
  },
  "residue": { "liveRuntimes": 0 }
}
```

解释：这里的 `true` 表示该失败测试被成功观察和隔离，不是运行时失败。host 最终计数需要保持 records、pidRegistry、cleanupPending、pluginBrowserWindows、pluginWebContents 全为 0。

最新自证声明如下，必须由接手者复跑而不是只引用：

- TypeScript：通过。
- Vitest：38 文件、388 测试通过。
- 打包 Gate 1 自证：连续三次通过。
- 新增或修复的行为：self-close 清理完整，heartbeat rate limit 只针对发送者，不能污染其他 runtime。
- 三次结束时 records、PID registry、plugin windows、plugin webContents 和 cleanup pending 均为 0，11/11 cleanup receipts 完整。
- 独立 code review、独立 verifier、修复后最终 quality gate：仍待完成。

## 9. 运行时探针的实现路径

以下文件是 2A Gate 1 的直接实现面。先阅读这些文件，再决定是否需要修复。

| 路径 | 职责 |
| --- | --- |
| [`ElectronApp/src/main/plugins/experimental-plugin-runtime-host.ts`](../../ElectronApp/src/main/plugins/experimental-plugin-runtime-host.ts) | 创建、追踪、握手、终止每个 sandbox runtime |
| [`ElectronApp/src/main/plugins/experimental-runtime-smoke.ts`](../../ElectronApp/src/main/plugins/experimental-runtime-smoke.ts) | Gate 1 probe 定义和自证编排 |
| [`ElectronApp/src/main/plugins/experimental-runtime-ledger.ts`](../../ElectronApp/src/main/plugins/experimental-runtime-ledger.ts) | 有界请求、nonce、序列和事件 ledger |
| [`ElectronApp/src/main/plugins/experimental-runtime-cleanup.ts`](../../ElectronApp/src/main/plugins/experimental-runtime-cleanup.ts) | 所有权释放、protocol/session 清理和收据 |
| [`ElectronApp/src/main/plugins/experimental-plugin-pid-registry.ts`](../../ElectronApp/src/main/plugins/experimental-plugin-pid-registry.ts) | webContents 到 OS PID 的登记和移除 |
| [`ElectronApp/src/main/protocol/register-experimental-plugin-protocol.ts`](../../ElectronApp/src/main/protocol/register-experimental-plugin-protocol.ts) | runtime 模块协议和精确入口字节服务 |
| [`ElectronApp/src/preload/plugin-preload.ts`](../../ElectronApp/src/preload/plugin-preload.ts) | sandbox runtime 暴露的极小 API |
| [`ElectronApp/src/renderer/plugin-runtime/bootstrap.ts`](../../ElectronApp/src/renderer/plugin-runtime/bootstrap.ts) | runtime 启动、消息桥接和 hostile API 约束 |
| [`ElectronApp/src/renderer/plugin-runtime/index.html`](../../ElectronApp/src/renderer/plugin-runtime/index.html) | runtime 文档入口 |
| [`ElectronApp/tests/unit/experimental-runtime-v0.test.ts`](../../ElectronApp/tests/unit/experimental-runtime-v0.test.ts) | runtime 逻辑和拒绝路径单测 |
| [`ElectronApp/tests/unit/experimental-runtime-ownership.test.ts`](../../ElectronApp/tests/unit/experimental-runtime-ownership.test.ts) | 清理所有权、close、crash、timeout 单测 |
| [`ElectronApp/tests/e2e/g005-runtime-spike-packaged.spec.ts`](../../ElectronApp/tests/e2e/g005-runtime-spike-packaged.spec.ts) | 打包应用的 Gate 1 证明 |

重要：不得把 runtime 测试的 fixture ID 写入生产分支。测试必须生成或改名有效的 `local.*` ID，证明生产代码不依赖固定 fixture 名称。

## 10. ElectronApp 源码和测试路径索引

### 10.1 Main 进程

```text
ElectronApp/src/main/
├── main.ts
├── files/
│   └── document-store.ts
├── file-truth/v1/
│   ├── file-truth-store.ts
│   ├── node-platform.ts
│   └── register-file-truth-handlers.ts
├── ipc/
│   ├── register-handlers.ts
│   └── trusted-renderer.ts
├── plugins/
│   ├── bundled-plugin-discovery.ts
│   ├── capability-broker.ts
│   ├── experimental-plugin-pid-registry.ts
│   ├── experimental-plugin-runtime-host.ts
│   ├── experimental-runtime-cleanup.ts
│   ├── experimental-runtime-ledger.ts
│   ├── experimental-runtime-smoke.ts
│   ├── local-plugin-state-store.ts
│   ├── plugin-registry.ts
│   ├── renderer-lease-bridge.ts
│   ├── service-host.ts
│   └── service-request-ledger.ts
├── protocol/
│   ├── register-app-protocol.ts
│   └── register-experimental-plugin-protocol.ts
├── windows/
│   ├── classify-renderer-console-message.ts
│   └── create-editor-window.ts
└── logger.ts
```

`main.ts` 负责应用组装、userData state 路径、窗口创建、registry hydrate、runtime 事件和退出清理。`register-handlers.ts` 是 IPC 入口，只能接受经 `trusted-renderer.ts` 校验的 sender。

### 10.2 Preload 和受限运行时

```text
ElectronApp/src/preload/
├── preload.ts
└── plugin-preload.ts
```

`preload.ts` 面向主 editor renderer，导出只读、冻结的 `window.notoDesktop`。`plugin-preload.ts` 面向 sandboxed local plugin runtime，绝不暴露 Electron 原始 API、Node 或任意 IPC 通道。

### 10.3 Renderer

```text
ElectronApp/src/renderer/
├── App.tsx
├── FileTruthApp.tsx
├── desktop-api.d.ts
├── editor/
│   ├── MilkdownEditor.tsx
│   ├── markdown-v2-transaction-bridge.ts
│   └── source-fidelity-adapter.ts
├── plugin-runtime/
│   ├── bootstrap.ts
│   └── index.html
├── plugins/
│   ├── PluginCenter.tsx
│   ├── RendererPluginClient.ts
│   ├── RendererPluginHost.ts
│   ├── plugin-center-state.ts
│   ├── plugin-snapshot-stream.ts
│   └── renderer-proof/
│       ├── index.ts
│       └── plugin.ts
└── styles/
    └── app.css
```

保持编辑器单画布为默认视觉中心。插件中心是辅助表面，不能拥有插件真实状态，也不能把编辑器改造成多卡片后台。

### 10.4 Shared 合约

```text
ElectronApp/src/shared/
├── errors.ts
├── source-fidelity.ts
├── file-truth/v1/
│   ├── contracts.ts
│   └── validate.ts
├── ipc/
│   ├── contracts.ts
│   └── validate.ts
├── markdown/v2/
│   ├── contracts.ts
│   └── core.ts
└── plugins/
    ├── catalog.ts
    ├── experimental-runtime-v0.ts
    ├── lifecycle.ts
    ├── manifest.ts
    ├── proof-manifests.ts
    ├── protocol.ts
    └── state.ts
```

所有跨进程消息先在 `shared/ipc/validate.ts` 或对应封闭 validator 中解析。不要在 renderer/main 各自复制 schema。

### 10.5 服务和资源

```text
ElectronApp/
├── src/service/fs-service.ts
└── resources/
    ├── plugins/
    │   ├── filesystem-proof/manifest.json
    │   └── renderer-proof/manifest.json
    └── provenance/
        ├── ROOB_TOKENS.md
        ├── THIRD_PARTY_INVENTORY.json
        └── THIRD_PARTY_NOTICES.md
```

目前的两个 proof plugin 是 bundled plugin，不是 2A 第三方本地包。不要混淆其 trust tier。

### 10.6 测试

```text
ElectronApp/tests/
├── compatibility-probe.ts
├── e2e/
│   ├── g001-packaged.spec.ts
│   ├── g003-packaged.spec.ts
│   ├── g004-packaged.spec.ts
│   ├── g005-packaged.spec.ts
│   ├── g005-runtime-spike-packaged.spec.ts
│   └── plugin-lifecycle-helpers.ts
├── fixtures/
│   ├── g001-fidelity.md
│   ├── g003-file-truth.md
│   ├── g004-daily-editing.md
│   └── g002-v1/
├── helpers/
│   └── g001-byte-oracle.ts
└── unit/
    ├── experimental-runtime-v0.test.ts
    ├── experimental-runtime-ownership.test.ts
    ├── g005-production-cutover.test.ts
    ├── plugin-registry.test.ts
    ├── capability-broker.test.ts
    ├── renderer-lease-bridge.test.ts
    ├── renderer-plugin-client.test.ts
    ├── service-host.test.ts
    └── 其余 G001 至 G004 回归测试
```

运行时探针涉及资源清理和 process identity，不能只依赖单测。打包 Playwright 是其最小可信验证。

## 11. 构建、打包和输出路径

配置入口：

| 路径 | 用途 |
| --- | --- |
| [`ElectronApp/package.json`](../../ElectronApp/package.json) | scripts、依赖、Node/pnpm 要求 |
| [`ElectronApp/forge.config.ts`](../../ElectronApp/forge.config.ts) | Electron Forge、asar、extraResource、fuse 和 renderer 目标 |
| [`ElectronApp/playwright.config.ts`](../../ElectronApp/playwright.config.ts) | Playwright 的单 worker、90 秒全局 timeout、trace 保留策略 |
| [`ElectronApp/vite.main.config.mts`](../../ElectronApp/vite.main.config.mts) | main 构建 |
| [`ElectronApp/vite.preload.config.mts`](../../ElectronApp/vite.preload.config.mts) | editor preload 构建 |
| [`ElectronApp/vite.plugin-preload.config.mts`](../../ElectronApp/vite.plugin-preload.config.mts) | plugin preload 构建 |
| [`ElectronApp/vite.service.config.mts`](../../ElectronApp/vite.service.config.mts) | utility-process 服务构建 |
| [`ElectronApp/vite.plugin-runtime.config.mts`](../../ElectronApp/vite.plugin-runtime.config.mts) | sandbox runtime renderer 构建 |
| [`ElectronApp/vite.renderer.config.mts`](../../ElectronApp/vite.renderer.config.mts) | 主 renderer 构建 |
| [`ElectronApp/scripts/package-variant.mjs`](../../ElectronApp/scripts/package-variant.mjs) | e2e/release 变种打包入口 |

重要打包事实：

- `forge.config.ts` 强制 `NTO_PACKAGE_VARIANT` 只能是 `e2e` 或 `release`。
- `package:e2e` 输出到 `ElectronApp/out/e2e/Noto-darwin-arm64/Noto.app`。
- `package:release` 输出到 `ElectronApp/out/release/Noto-darwin-arm64/Noto.app`。
- `fs-service.js` 是 asar unpack 的唯一服务入口。
- bunded plugins 与 provenance 作为 extra resources 打入包。
- release fuse 必须保持 `RunAsNode=false`、`NodeOptionsEnvironmentVariable=false`、`EmbeddedAsarIntegrityValidation=true`、`OnlyLoadAppFromAsar=true`。
- e2e 变种可开启 `EnableNodeCliInspectArguments`，release 不可。

构建中间产物：

```text
ElectronApp/.vite/build/
├── main.js
├── preload.js
├── plugin-preload.js
└── fs-service.js

ElectronApp/.vite/renderer/
├── main_window/
└── plugin_runtime/
```

测试输出：

```text
ElectronApp/test-results/
├── g005-packaged/
├── g005-runtime-spike/run-1/
├── g005-runtime-spike/run-2/
├── g005-runtime-spike/run-3/
├── plugin-center-review-final-v2/
├── plugin-center-review-final-v3/
└── playwright/
```

不要提交或删除打包输出的决定留给负责人。在独立复核前，它们是可读证据，不是源代码。

## 12. 可直接执行的验证命令

以下命令均应从 `ElectronApp/` 运行，且必须先确认 Node 22。它们是当前 `package.json` 中的实际命令。

### 12.1 快速静态和单测基线

```sh
export PATH="/Users/cdcd/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/cdcd/roobli/lr00rl/Noto/ElectronApp
pnpm compat:node22
pnpm typecheck
pnpm test
```

期望：兼容探针、类型检查和全部 Vitest 均为零失败。记录本次测试文件和测试数量，不复用旧计数作为新结果。

### 12.2 仅重跑 Gate 1 打包探针

```sh
export PATH="/Users/cdcd/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/cdcd/roobli/lr00rl/Noto/ElectronApp
pnpm package:e2e
pnpm exec playwright test tests/e2e/g005-runtime-spike-packaged.spec.ts
```

在每次运行后检查新的 `ElectronApp/test-results/g005-runtime-spike/run-*`，确认三个 PID 两两不同、全部 hostile probes 为 true、所有 failure probes 被观察、最终残留为零。

### 12.3 首切片和既有编辑器回归

```sh
export PATH="/Users/cdcd/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/cdcd/roobli/lr00rl/Noto/ElectronApp
pnpm package:e2e
pnpm exec playwright test \
  tests/e2e/g001-packaged.spec.ts \
  tests/e2e/g003-packaged.spec.ts \
  tests/e2e/g004-packaged.spec.ts \
  tests/e2e/g005-packaged.spec.ts \
  tests/e2e/g005-runtime-spike-packaged.spec.ts
```

### 12.4 Release 变种检查

```sh
export PATH="/Users/cdcd/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/cdcd/roobli/lr00rl/Noto/ElectronApp
pnpm package:release
pnpm exec electron-fuses read --app out/release/Noto-darwin-arm64/Noto.app
```

不要在没有更改 fuse 或打包配置时把 release 打包当成 Gate 1 的替代。Gate 1 的进程隔离证据来自 e2e 变种和运行时测试。

### 12.5 视觉和交互复核

```sh
export PATH="/Users/cdcd/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/cdcd/roobli/lr00rl/Noto/ElectronApp
pnpm package:e2e
pnpm exec playwright test tests/e2e/g004-packaged.spec.ts tests/e2e/g005-packaged.spec.ts
```

在 1440x900、900x700、375x900 查看编辑器和 Plugin Center 的 ready、disabled、enabled-idle、running、权限拒绝、service crash、长名称和 error 状态。现有截图起点在 `ElectronApp/test-results/plugin-center-review-final-v2/` 与 `ElectronApp/test-results/plugin-center-review-final-v3/`。

## 13. 证据目录和阅读顺序

新接手者的最小阅读顺序：

1. 本文档。
2. [` .omx/ultragoal/goals.json`](../../.omx/ultragoal/goals.json) 中 G005 条目。
3. [` .omx/plans/g005-local-third-party-runtime-spike-2a.md`](../../.omx/plans/g005-local-third-party-runtime-spike-2a.md)。
4. [`ElectronApp/artifacts/g005-first-vertical-slice-quality-gate.json`](../../ElectronApp/artifacts/g005-first-vertical-slice-quality-gate.json)。
5. `experimental-plugin-runtime-host.ts`、`experimental-runtime-cleanup.ts`、`experimental-runtime-ledger.ts`、`g005-runtime-spike-packaged.spec.ts`。
6. 最新三份 `runtime-smoke.json` 和对应 `main.ndjson`。
7. 修复后重新生成的独立 code review/verifier 输出。

首切片文件：

```text
ElectronApp/artifacts/g005-first-vertical-slice-quality-gate.json
.omx/handoff/g005-first-vertical-slice-result.md
.omx/handoff/g005-first-vertical-slice-code-review-verdict.md
.omx/handoff/g005-first-vertical-slice-verification-verdict.md
.omx/handoff/g005-first-vertical-slice-design-review-verdict.md
.omx/handoff/g005-first-vertical-slice-a11y-verdict.md
```

当前 2A 自证文件：

```text
ElectronApp/test-results/g005-runtime-spike/run-1/runtime-smoke.json
ElectronApp/test-results/g005-runtime-spike/run-1/logs/main.ndjson
ElectronApp/test-results/g005-runtime-spike/run-2/runtime-smoke.json
ElectronApp/test-results/g005-runtime-spike/run-2/logs/main.ndjson
ElectronApp/test-results/g005-runtime-spike/run-3/runtime-smoke.json
ElectronApp/test-results/g005-runtime-spike/run-3/logs/main.ndjson
```

不要将可能包含运行环境路径、随机 ID 或临时用户数据的原始日志复制到公开文档。交接文档只记录可复现的结构和结果。

## 14. 已知警告、限制和非阻塞噪声

### 14.1 必须保留为未完成的事项

- G005 Slice 2A 的自关闭和心跳修复尚无修复后的独立 code review verdict。
- Slice 2A 尚无修复后的独立 verifier verdict。
- Slice 2A 尚无新的 final quality gate JSON。
- 本地第三方包导入、不可变存储、receipt、journal 和 Plugin Center 安装流程尚未实施。
- 2A 仅是 macOS 可执行证明。Windows/Linux 安装必须仍为 `unsupportedOnPlatform`。
- 2A runtime 没有 editor、filesystem、shell、network、clipboard、DOM、raw IPC、remote-control 能力。

### 14.2 已知日志噪声

早期 runtime probe 日志中可以出现 `noto:v1:open-initial` 的 `DOCUMENT_NOT_OPEN`。它由探针启动时没有打开文档造成，不能被当作插件 runtime 越权或 Gate 1 成功信号。独立复核时应确认该日志与测试预期一致，且没有 renderer console error、unhandled rejection、未清理 runtime 或能力越权日志。

### 14.3 测试执行限制

- Playwright 配置为单 worker，不能为提升速度并行化，因为 runtime PID、窗口和用户数据证据需要隔离。
- e2e timeout 为 90 秒，expect timeout 为 10 秒。超时不是可忽略通过，必须判断是产品卡住、环境异常还是测试等待错误。
- 打包 Mac 应用包含随机测试目录和 OS PID。不要把这些值作为稳定快照断言。
- `out/` 和 `.vite/` 从构建生成，但当前也承载复查包。清理前确认没有正在运行的 app 或测试。

### 14.4 设计限制

- 默认编辑面不能常驻呈现 raw Markdown。
- Plugin Center 只显示 main-authoritative snapshots，不能直接操纵 RendererPluginHost。
- 错误必须显式、可读、与实际失败一致，不得显示“成功”掩盖已丢失 operation 或未释放资源。
- 任何新增插件页面都需在 light/dark 和三种宽度检查，不可以安全测试通过替代视觉验收。

## 15. 即刻下一步，顺序不可颠倒

1. 读取当前 `git status --short`，确认本交接之外的脏文件仍被保护。
2. 用 Node 22 对当前工作树运行 `pnpm compat:node22`、`pnpm typecheck`、`pnpm test`。保存新的原始输出和文件/测试计数。
3. 重新打包 e2e 变种并至少连续运行三次 `g005-runtime-spike-packaged.spec.ts`。每次保存 `runtime-smoke.json`、主进程 NDJSON 和失败时 trace。
4. 对当前修复版本做独立代码审查，重点审查 self-close、heartbeat rate limit、destroyed sender、cleanup receipt、ledger 上限和跨 runtime 污染。审查者不得修改被审查代码。
5. 对当前修复版本做独立验证，检查测试是否实际覆盖了执行探针的 hostile path，而不是只检查 JSON 字段存在。
6. 只有步骤 2 到 5 全部通过后，生成新的 Slice 2A Gate 1 quality gate，明确它的 scope 为 runtime spike，不把它升级成 G005 completion。
7. Gate 1 放行后，严格按 `g005-local-third-party-runtime-spike-2a.md` 实施包导入和不可变 store。先写 parser、path、integrity、race copy、receipt、journal 的 unit/property tests，再写实现。
8. 完成 import/review/probation/receipt 后，增加打包 Plugin Center 安装 e2e 和视觉检查。再次独立审查。
9. 只有 2A 的所有验收项完成后，才开始 2B。不要在 2A 尚未收口时预先写编辑 transaction ABI。

## 16. Stop 和 No-Go 条件

以下任意条件出现时，停止向 2A 包安装和更高权限插件能力推进，记录失败证据并修复当前层。

| 条件 | 处理 |
| --- | --- |
| editor PID 与两个 plugin runtime PID 不能两两不同 | Gate 1 no-go，禁止导入系统继续 |
| plugin runtime 可访问 Node、Electron、原始 IPC、DOM、网络、模块绕过、popup、navigation、download、worker、eval 或 Function | Gate 1 no-go |
| self-close、crash、ready timeout、abort timeout、heartbeat loss 后遗留 record、PID、window、webContents、cleanup pending | Gate 1 no-go |
| 旧 sender、旧 generation 或重复/超速 heartbeat 可改变当前 runtime 状态 | Gate 1 no-go |
| 任一测试产生 silent success、丢失 sub-operation 或未暴露不确定 durability | no-go，先修失败语义 |
| 本地 source 可在 staging/verify 后被替换而仍执行 | 停止 import 实施，先修 race 检测 |
| 2A 包能获得未声明 capability | 停止，修 manifest 和 broker 约束 |
| Windows/Linux 被误报为可执行第三方安装 | no-go，恢复 `unsupportedOnPlatform` |
| UI 退化为 raw source、管理后台或无法在窄屏使用 | 停止 UI 扩展，先完成设计修复 |
| 任何不相关的 Swift/WebEditor 用户更改被触碰 | 立即停止，隔离变更并恢复边界，不要覆盖用户工作 |

## 17. 2B、2C、2D 和更后续能力

### 17.1 Slice 2B

2B 才引入 Noto editor read/transaction ABI，并以两个最小 owner plugin 验证：

- `title-shift`：标题层级上升/下降。
- `md-padding`：CJK 与半角字符间的 Markdown spacing。

所有编辑变更必须走 Noto 的 transaction 边界、版本和撤销模型。不得给插件直接 ProseMirror、Milkdown DOM 或任意 Markdown 字符串写权限。

### 17.2 Slice 2C

2C 增加更新、probation replacement、durable active receipt CAS 和回滚。它必须能区分未发布、已确认发布、发布不确定和不匹配。任何 post-rename 不确定性不得向 UI 报告成功。

### 17.3 Slice 2D

2D 可选加入签名连续性和通用已安装插件 filesystem read。Ed25519、publisher continuity、公共 trust root、自动公开分发不是 2A 的需求。

### 17.4 G005 更后面

文件写入、shell、network、remote-control、扩展诊断、crash recovery 和更多 editor/UI extension 都属于 G005 后续部分。每一种新 authority 都必须有单独 capability family、明确用户授权、generation binding、取消、超时、日志和拒绝路径测试。

## 18. typora-plugin-lite 清洁室需求映射

参考根目录：`/Users/cdcd/roobli/lr00rl/typora-plugin-lite`。

该项目代表真实用户插件诉求和已有使用习惯。它不提供可以直接搬运的 Typora 私有实现。Noto 应从功能与约束层面建立等价或更清晰的公开能力模型。

### 18.1 代表性插件和 Noto 需求映射

| typora-plugin-lite 代表 | 参考路径 | Noto 需求 | 进入切片 |
| --- | --- | --- | --- |
| Title Shift | `plugins/title-shift/manifest.json` | 选择范围内 heading transaction command、热键、undo 可逆 | 2B |
| Markdown Padding | `plugins/md-padding/manifest.json` | 文档变换 ABI、CJK 文本规则、避免破坏 opaque/source fidelity | 2B |
| Remote Control | `plugins/remote-control/manifest.json` | loopback RPC、命令、进程和 shell，但须逐项 capability 与用户授权 | G005 后续 |
| Sidenote | `plugins/sidenote/manifest.json` | 受限 inline/block decoration、布局不破坏写作画布 | editor/UI extension 后续 |
| Tree Guides | `plugins/tree-guides/manifest.json` | 文件树 decoration 和当前文件状态 | 文件浏览 surface 后续 |
| Wider | `plugins/wider/manifest.json` | 写作宽度状态、无障碍、与 sidenote 共存 | 编辑体验后续 |
| Fence Enhance / Code Viewer | `plugins/fence-enhance/`、`plugins/code-viewer/` | 代码块 node view 和受限渲染扩展 | G004 后续扩展 |
| Fuzzy Search / Recent Files | `plugins/fuzzy-search/`、`plugins/recent-files/` | command palette、索引、文件访问授权 | 后续 |
| Todo / Timeline / Drawio | `plugins/todo-manager/`、`plugins/timeline/`、`plugins/drawio/` | 标准 Markdown 优先的扩展块，opaque fallback，避免专有格式锁定 | 后续 |

### 18.2 必读参考路径

```text
/Users/cdcd/roobli/lr00rl/typora-plugin-lite/docs/plans/architecture.md
/Users/cdcd/roobli/lr00rl/typora-plugin-lite/docs/typora-capability-inventory.md
/Users/cdcd/roobli/lr00rl/typora-plugin-lite/docs/typora-api-types.md
/Users/cdcd/roobli/lr00rl/typora-plugin-lite/docs/remote-control-api.md
/Users/cdcd/roobli/lr00rl/typora-plugin-lite/packages/core/src/plugin/
/Users/cdcd/roobli/lr00rl/typora-plugin-lite/packages/core/src/editor/
/Users/cdcd/roobli/lr00rl/typora-plugin-lite/packages/core/src/platform/
/Users/cdcd/roobli/lr00rl/typora-plugin-lite/packages/core/src/hotkey/
/Users/cdcd/roobli/lr00rl/typora-plugin-lite/plugins/
```

从参考中保留的需求模式：lazy loading、manifest 声明触发器、命令与热键注册、资源自动清理、平台抽象、设置持久化、标准 Markdown 优先、可见错误和 UI 可用性。

明确不复制的内容：Typora `bridge`、`reqnode`、全局 editor object、Typora DOM class、私有源代码、私有协议、主题/资源/字符串、对 Typora 具体版本的反射探测。Noto 只定义自身的 stable contracts。

## 19. 清理完成记录和后续保留规则

已完成一次受限清理：删除 41 个过期 debug/probe/release-smoke 目录、14 个浏览器 user-data 目录和 `ElectronApp/out/.package-staging/`，释放约 83 MiB。删除是不可恢复的，但这些目录均为可再生的构建或测试输出，不是源代码或最终交接证据。

清理后已重新执行 `pnpm typecheck` 和 `pnpm test`，结果为通过，Vitest 为 38 个文件、388 个测试。此次清理没有删除 G005 Gate 1 的三个运行时自证目录、最终 `out/` 包、`artifacts/` 或计划和审计文件。

### 保留

- `ElectronApp/src/`、`ElectronApp/tests/`、`ElectronApp/resources/`、配置文件和 lockfile。
- `ElectronApp/artifacts/g005-first-vertical-slice-quality-gate.json` 及 G001 至 G004 质量门禁。
- `ElectronApp/test-results/g005-runtime-spike/run-1`、`run-2`、`run-3`，直到修复后独立审查完成并替换为新的最终 Gate 1 证据。
- `.omx/ultragoal/goals.json`、`.omx/ultragoal/ledger.jsonl`、G005 计划和首切片 verdict。
- 本文档和最终要放在 `docs/` 的其他人工可读交接文档。
- 用户的 Swift、WebEditor、`DESIGN.md`、`.claude/`、`.omc/` 脏工作，除非这些路径的拥有者明确批准清理。

### 若以后继续清理，先盘点再删除

- `ElectronApp/.vite/` 的生成文件，可在确认新的干净构建可复现后重建。
- `ElectronApp/test-results/` 中与 G005 无关且已由对应质量门禁替代的临时缓存、浏览器用户数据、diagnostic 目录。
- `.omx/reports/team-commit-hygiene/` 和 `.omx/logs/` 中运行时工具生成的历史噪声。保留目标和计划审计，移除前先确认不会破坏交接证据链接。

### 不可作为“没用”清理的对象

- 任何尚未独立复核的 G005 runtime probe 证据。
- 任何正在引用的 package output 或截图。
- `pnpm-lock.yaml`、provenance 文件、manifest、fixture。
- 用户未说明归属的未跟踪文件。

清理完成后应更新此小节或新增简短 cleanup log，列出精确删除路径、是否可从构建重建、以及保留证据的位置。

## 20. 接手验收清单

### 20.1 接手前

- [ ] 已确认工作目录为 `/Users/cdcd/roobli/lr00rl/Noto/ElectronApp`。
- [ ] 已确认 Node 22 和 pnpm 版本。
- [ ] 已阅读 G005 状态、2A 计划、首切片 quality gate 和本文档。
- [ ] 已记录当前 `git status --short`，没有将未跟踪 `ElectronApp/` 误认为可删除目录。
- [ ] 已确认不触碰 Swift/WebEditor/`DESIGN.md`/用户未跟踪文件。

### 20.2 Gate 1 修复后独立复核

- [ ] `pnpm compat:node22` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm test` 通过，并记录新计数。
- [ ] e2e package 可重新生成。
- [ ] `g005-runtime-spike-packaged.spec.ts` 连续三次通过。
- [ ] 每次有 editor、runtime A、runtime B 三个两两不同的 OS PID。
- [ ] hostile runtime probes 全部拒绝。
- [ ] ready timeout、crash、heartbeat loss、destroyed sender、abort timeout、ledger exhaustion、self-close、heartbeat rate limit 全部被观测。
- [ ] 每次最终没有 live runtime、record、PID、window、webContents、cleanup pending 残留。
- [ ] 当前修复版本已有独立代码审查，且没有 blocker/high/medium 未解决项。
- [ ] 当前修复版本已有独立验证，且验证者实际复跑关键命令。
- [ ] 新的 Gate 1 quality gate 明确标注为 Slice 2A runtime spike，未声称 G005 完成。

### 20.3 2A 包导入实现前

- [ ] Gate 1 已明确放行。
- [ ] 已为 descriptor、manifest、path、integrity、copy race、promotion、receipt、journal 写入失败测试。
- [ ] 不会执行 source 或 staging 中的任何代码。
- [ ] macOS 之外的第三方导入仍返回 `unsupportedOnPlatform`。
- [ ] manifest capability 白名单和 ABI 上限已锁定。

### 20.4 2A 完成前

- [ ] 两个生成式本地包可经 Plugin Center install review 进入 Noto-owned store。
- [ ] promoted package 完整性、receipt 和 probation 均可验证。
- [ ] probation 结束后 runtime 已关闭，installed receipt 为 disabled，未创建 active runtime。
- [ ] command 与一个布尔设置都只能走声明 ABI，state 有上限且持久化可验证。
- [ ] 所有不确定 durability、拒绝、超时和清理失败对用户可见。
- [ ] 打包 e2e、视觉和无障碍检查均通过。
- [ ] 独立审查和独立 verifier 针对最终工作树完成。

## 21. Next agent start here

按此顺序执行最初五个检查，不先写新功能：

```sh
cd /Users/cdcd/roobli/lr00rl/Noto && git status --short
sed -n '1,260p' .omx/plans/g005-local-third-party-runtime-spike-2a.md
cd /Users/cdcd/roobli/lr00rl/Noto/ElectronApp && /Users/cdcd/.nvm/versions/node/v22.19.0/bin/node --version
cd /Users/cdcd/roobli/lr00rl/Noto/ElectronApp && pnpm typecheck
cd /Users/cdcd/roobli/lr00rl/Noto/ElectronApp && pnpm exec playwright test tests/e2e/g005-runtime-spike-packaged.spec.ts
```

第五步结束后，读取新生成的 `test-results/g005-runtime-spike/run-*/runtime-smoke.json` 与 `logs/main.ndjson`，再开始修复后的独立审查。若任何 Gate 1 条件失败，停在 runtime 层修复，不要进入本地包安装或 2B。
