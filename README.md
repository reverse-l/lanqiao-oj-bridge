# Lanqiao OJ Bridge

把蓝桥 OJ 题面、CPH 本地样例和官方在线调试连接到 VSCode。使用自己已登录的蓝桥网页，不需要提供 Cookie、JWT 或密码。本项目独立开发，与蓝桥官方无隶属关系。

**需要同时安装 VSCode 扩展和 Tampermonkey 脚本。脚本单独安装不能完成桥接。**

- [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=epsilon-dev.lanqiao-oj-bridge) / [下载 VSIX 安装包](https://github.com/reverse-l/lanqiao-oj-bridge/releases/latest)
- [ScriptCat 安装 / 更新脚本](https://scriptcat.org/zh-CN/script-show-page/9067) / [GitHub 脚本镜像](https://raw.githubusercontent.com/reverse-l/lanqiao-oj-bridge/main/userscript/lanqiao-bridge.user.js)
- [反馈问题](https://github.com/reverse-l/lanqiao-oj-bridge/issues)

安装包版本：VSCode 扩展 **0.4.4**，配套脚本 **0.4.0**。商店和 GitHub 的可下载版本以各页面为准。脚本通过 [ScriptCat](https://scriptcat.org/zh-CN/script-show-page/9067) 和 GitHub 分发，暂未发布 Greasy Fork。

0.4.4 默认关闭诊断日志，发送至 CPH 不再主动打开输出面板。仅排错时可在设置中开启 `Lanqiao Diagnostics`；无需重载，排错后关闭即可。正常错误提示与官方运行 / 评测结果不受影响。

## v0.4.3：简洁界面与语言记忆

点击题目标题旁的 `C` / `C++` 标记即可切换语言，悬停查看编译器和文件。选择会被记住：新题沿用最近选择，已有题目保留各自语言；重新导入及从 README 打开可恢复。明确打开某份源码时，以该文件为准。只保存本扩展的语言设置，不修改 CPH 或 Code Runner 配置。

提交按钮显示“提交”，实际语言与文件仍在提交确认框中核对。连接说明放在悬停提示中，成功反馈短暂显示，错误继续提示。评测仅显示测试点总数与通过汇总，不再打印逐点 JSON；指定输入调试仍只展示执行结果。

## v0.4.0：C / C++

首次安装默认使用 C++。点击已导入题面的语言标记选择 C，或运行 `Lanqiao: 切换解题语言（C / C++）`，会在同一题目目录创建 / 打开独立 `main.c`，保留 `main.cpp`、笔记和已有自定义测试。也可将 `lanqiao.defaultLanguage` 设为 `c`，用于新题导入。

C 模板配置 `lanqiao.cTemplate` 留空使用内置基础模板，指定路径时使用自己的 C 模板；原 `lanqiao.template` 继续只用于 C++。CPH 根据当前源码扩展名使用现有 C 或 C++ 配置，本工具不修改编译器和全局配置。每份源码分别关联 CPH 测试，兼容数据另外保存为 `companion.c.json` / `companion.cpp.json`。

C 在线操作需要同时更新 VSIX 与脚本至 0.4.0，刷新网页；配对和脚本权限保留。网页需手动选择 **C（gcc8.3.0）**，C++ 继续选择 **C++（g++17）**。任务只交给同题同语言页面；语言不一致时停止，避免误提交。题面、确认框、运行历史显示对应文件和语言，既有 C++ 记录继续可读。旧脚本仍可用于 C++，C 在线操作会提示更新。Python 暂不支持。

从 [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=epsilon-dev.lanqiao-oj-bridge) 更新扩展，或使用对应版本的 `.vsix` 离线安装。已安装的 0.4.0 配套脚本可继续使用。

## 安装与首次配对

Windows 可将题目保存到其他盘：`Ctrl+,` 打开设置，搜索 `Lanqiao Root`，例如填写 `D:/Code/Algorithm/Lanqiao`。也可在用户设置 JSON 中设置 `"lanqiao.root": "D:/Code/Algorithm/Lanqiao"`。这只影响后续导入位置，旧题目不会自动搬迁；C++ 模板位置由 `lanqiao.template` 独立设置。无需修改扩展代码或 CPH 配置。

1. 准备 VSCode 1.95+、浏览器中的 Tampermonkey，以及自己的蓝桥账号。需要本地测试时安装 [Competitive Programming Helper（CPH）](https://marketplace.visualstudio.com/items?itemName=DivyanshuAgrawal.competitive-programming-helper)，配置自己的 C++ 编译器。
2. 在 VSCode 扩展市场搜索 `epsilon-dev.lanqiao-oj-bridge` 安装，或从 [Releases](https://github.com/reverse-l/lanqiao-oj-bridge/releases/latest) 下载 `.vsix`，在 VSCode 扩展视图右上角 `…` →「从 VSIX 安装」，重载窗口。Marketplace 扩展标识为 `epsilon-dev.lanqiao-oj-bridge`。此前通过 VSIX 安装的 `epsilon-local.lanqiao-oj-bridge` 属于不同扩展；迁移时先卸载旧版，再安装 Marketplace 版本并重新配对，原有题目目录和代码可继续使用。
3. 安装并启用 Tampermonkey，点击上方脚本安装链接，检查后安装。若浏览器只显示源码，可下载 Release 中的 `lanqiao-bridge.user.js`，在 Tampermonkey 管理面板 →「实用工具」→「从文件导入」。按浏览器和 Tampermonkey 的提示允许用户脚本运行。
4. VSCode 设置搜索 `Lanqiao`，指定自己的题目目录 `lanqiao.root` 和**已存在**的 C++ 模板 `lanqiao.template`。默认分别是 `~/Code/Learning/Algorithm/Lanqiao`、`~/Code/template.cpp`；其他用户可选择自己的路径。模板不存在时先创建或指定模板。
5. 命令面板运行 `Lanqiao: 配对`。正常登录并打开 [蓝桥题目页](https://www.lanqiao.cn/problems/3008/learning/)，在左下角点「配对」，输入 VSCode 显示的一次性配对码（5 分钟有效）。**配对码不是蓝桥登录凭据，每位用户在自己电脑上独立配对。**
6. 网页点击「导入 VSCode」。生成题面、模板代码和样例，打开题面与 C++ 文件。在线操作时保持对应题目的已配对网页打开。

使用打包扩展不需要额外安装 Node.js；Node.js 只用于开发。CPH、编译器、Tampermonkey 和浏览器需要自行安装。

## 日常使用

题面标题下有「发送至 CPH」「本地测试」「OJ 在线调试」「提交」「查看评测」「打开原题」。点击标题旁的 C / C++ 标记切换语言。已有题目可打开 `main.cpp`、`main.c` 或 `README.md`，运行 `Lanqiao: 打开题面（含操作按钮）`。预览按钮绑定当前题目，切换编辑器后不会操作其他题。

题面开始处可「复制题面 Markdown」，复制当前已保存的完整 README（含来源、公式和图片链接），不会附带解题代码。样例、代码块和运行输出的复制图标位于框内，鼠标悬停或键盘聚焦时显示。

| 操作 | 实际含义 |
| --- | --- |
| 本地测试 | 现有 CPH + 用户原有编译配置，不是官方评测 |
| 在线调试 → 样例 / 自定义输入文件 | 把输入原样交给官方调试，展示输出与真实执行错误，不显示 AC/WA、答案错误等判题结论 |
| 在线调试 → 调试 | 不传自定义输入，使用官方原生调试方式，保留平台原始状态 |
| 提交当前代码 | 保存代码，显示题号、文件、语言及 SHA-256；用户确认后通过已登录网页正式提交 |
| 填入网页代码（手动提交） | 只填入官方编辑器，由用户点击网站原生按钮 |
| 查看最近提交 | 查看本扩展记录；全量官方历史请在蓝桥题目页查看 |

官方语言选择器当前标签为 **C++（g++17）** 和 **C（gcc8.3.0）**；界面按官方原始标签展示，不额外推断环境版本。本地继续使用自己的 CPH 编译配置，可设置 GNU C++11。只展示平台实际返回的数据，不把 HTTP 成功、样例通过或标准输出当成正式 AC。

结果区分排队、请求发送、平台接受、评测中和完成。取得实际记录后才展示官方记录 ID。超时、断网或宿主重载导致无法确认时标记结果未知，不自动补发提交；请先检查官方记录。

## 文件与配置

```text
~/Code/Learning/Algorithm/Lanqiao/<题号>-<标题>/
  README.md         题面 Markdown（含原题链接）
  main.cpp          C++ 解法，从原有 C++ 模板创建
  main.c            C 解法，选择 C 时创建
  samples/          输入输出样例
  .lanqiao.json     题目元数据
  companion.json    Competitive Companion 兼容数据
  .cph/             CPH 关联记录（取决于现有 CPH 保存设置）
```

重复导入按题号复用，保留已有代码、笔记与测试。CPH 非空记录不覆盖；空记录补样例前确认并备份。图片保留在线链接，未做离线镜像。

| VSCode 设置 | 默认值 | 用途 |
| --- | --- | --- |
| `lanqiao.root` | `~/Code/Learning/Algorithm/Lanqiao` | 新题保存目录 |
| `lanqiao.template` | `~/Code/template.cpp` | 已存在的 C++ 模板文件 |
| `lanqiao.cTemplate` | 空 | C 模板，留空使用内置基础模板 |
| `lanqiao.defaultLanguage` | `cpp` | 新导入题目的默认语言，可选 `cpp` / `c` |
| `lanqiao.port` | `27124` | 仅监听 `127.0.0.1`，不能占用 CPH 的 `27121` |

修改端口后重载 VSCode，并在 Tampermonkey 菜单「设置本地端口」填写相同值。每个端口仅由一个 VSCode 窗口持有，请在该窗口使用命令。

## 安全与数据

Bridge 只绑定 `127.0.0.1`，采用随机令牌、VSCode SecretStorage、Tampermonkey 隔离存储、一次性配对、Host / Origin 检查及大小限制。没有网页可调用的任意本地文件读取或命令执行接口。

无遥测或本项目云端代码收集。代码仅在你启动在线调试、确认提交或选择填入网页时交给蓝桥官方页面。浏览器负责正常登录，不绕过登录、验证码、Cloudflare 或访问限制。正式提交每次需要确认，任务不会自动补发。

不修改 CPH、洛谷、Code Runner 全局配置。运行 `Lanqiao: 撤销浏览器授权` 可撤销当前扩展的所有配对。脚本 namespace 保留早期标识以兼容旧安装和配对，实际地址以 homepage / support 链接为准。

## 已验证与限制

开发环境为 macOS Apple Silicon、VSCode、Chrome + Tampermonkey、GCC 15 与本地 GNU C++11。CPH 磁盘适配核验版本为 `2026.10.1792170155`。Windows / Linux 和其他 CPH 版本尚未实机验证。

已实测题面 / 公式 / 样例导入、模板创建、CPH 本地运行、重复导入保护、官方自定义输入调试、编译错误回传、确认后真实提交与 AC 报告、网页刷新和扩展宿主重载恢复。v0.4.0 已实测 C / C++ 的 CPH 样例、C 官方在线调试输出、C 编译错误回传及 C 正式提交；自动化测试共 54 项。题型覆盖以 3008《特殊的三角形》、178《全球变暖》与 21711《最大编号【算法赛】》的实际使用为基础，不保证未来所有题面布局。

整台 VSCode 完全退出重启、真实账号到期 / 限流 / 断网、故意向官方触发 TLE / RE / MLE 未逐项实机验收；相关状态解析、超时及错误处理有自动化覆盖。官方网页内部结构变动可能需要更新适配，无法确认时明确报错并保留手动操作入口。

## 常见问题

- 无网页按钮：确认是 `/problems/<题号>/learning/`，脚本已启用且允许运行，刷新页面。
- 无法连接：重载 VSCode，检查「Lanqiao OJ」输出、端口及重复服务窗口。
- 未提取到样例：查看原题，在 CPH 手动补充；Issues 提供题号与脱敏错误，不上传登录凭据。
- CPH 为空：打开对应 `main.cpp` 并聚焦 CPH，检查编译器和保存目录；可用 `samples/` 与 `companion.json` 人工恢复。
- 登录失效 / 验证码：在官方网页正常登录或手动验证，再点重新检测。
- 超时 / 状态异常：先查看官方记录避免重复提交；自测结果不能直接等同正式评测。
- 图片缺失：图片使用在线链接，需网络访问。
- 脚本升级未生效：Tampermonkey 检查更新后刷新题目页；Marketplace 版本通过 VSCode 扩展市场更新，VSIX 安装版本可通过新 VSIX 手动升级。

## 开发

Node.js 20+，已用 Node.js 24 验证：

```sh
npm ci
npm run check
npm test
npm run package
```

构建输出 `dist/`，安装包输出 `artifacts/`。`userscript/lanqiao-bridge.user.js` 为发布脚本镜像，发布更新时使用构建产物同步。测试覆盖题面 / Markdown / 样例解析、CPH 转换、授权协议、任务状态、结果与预览，会临时启动回环 HTTP 服务。

网页适配集中在 `src/browser/platform.ts`，题面解析在 `src/problem.ts`，样例识别在 `src/sample-collector.ts`，CPH 转换在 `src/storage.ts`，本地授权与通信在 `src/bridge.ts`。

参考：[Competitive Companion 格式](https://github.com/jmerle/competitive-companion#the-format)、[蓝桥解析器](https://github.com/jmerle/competitive-companion/blob/master/src/parsers/problem/LanqiaoProblemParser.ts)、[VSCode Webview 文档](https://code.visualstudio.com/api/extension-guides/webview)。第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 卸载

先运行「撤销浏览器授权」（可选），卸载 VSCode 扩展并在 Tampermonkey 删除脚本。题目代码由用户保留或自行删除；不自动清理，不卸载其他插件。无 LaunchAgent 或独立常驻进程。

MIT License，见 [LICENSE](LICENSE)。
