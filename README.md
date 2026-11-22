# Lanqiao OJ Bridge

> **非官方声明**
>
> **Lanqiao OJ Bridge 为爱好者独立开发的学习辅助工具，非蓝桥官方产品，未获得蓝桥杯组委会授权，仅用于备赛学习，无商业用途。**
>
> 本项目免费提供，作者不通过本项目收费或售卖题目。

把当前蓝桥 OJ 题目或蓝桥云课编程练习导入 VSCode。在本地阅读题面、编写 C / C++、用 CPH 跑样例，也可以通过已登录的蓝桥网页调用官方调试和正式评测。

本说明适用于 **VSCode 扩展 0.7.4 + 脚本猫（ScriptCat）用户脚本 0.6.0**。在同一台电脑安装 VSCode 扩展，并通过脚本猫安装 Lanqiao OJ Bridge 用户脚本，即可网页导入、官方调试或提交。打开以前导入的本地题目、搜索和复盘可以离线使用。

- [安装或更新 VSCode 扩展](https://marketplace.visualstudio.com/items?itemName=epsilon-dev.lanqiao-oj-bridge) · [下载 VSIX](https://github.com/reverse-l/lanqiao-oj-bridge/releases)
- [从 ScriptCat 安装浏览器脚本](https://scriptcat.org/zh-CN/script-show-page/9067) · [GitHub 脚本镜像](https://raw.githubusercontent.com/reverse-l/lanqiao-oj-bridge/main/userscript/lanqiao-bridge.user.js)
- [版本记录](https://github.com/reverse-l/lanqiao-oj-bridge/blob/main/CHANGELOG.md) · [反馈问题](https://github.com/reverse-l/lanqiao-oj-bridge/issues)

## 安装与更新

1. 在桌面版 VSCode 1.95 或以上版本安装 `epsilon-dev.lanqiao-oj-bridge`。离线安装时，在「扩展 → … → 从 VSIX 安装」选择安装包，然后按提示重载。
2. 在浏览器安装并启用脚本猫（ScriptCat），再从脚本猫发布页安装 **Lanqiao OJ Bridge** 用户脚本。浏览器提示时允许用户脚本运行，更新后刷新蓝桥网页。[脚本猫安装指南](https://docs.scriptcat.org/docs/use/use) · [Lanqiao OJ Bridge 脚本发布页](https://scriptcat.org/zh-CN/script-show-page/9067)
3. 在 VSCode 设置中搜索 `Lanqiao`。按需设置 `lanqiao.root`（保存题目）和 `lanqiao.template`（已存在的 C++ 模板）。C 的 `lanqiao.cTemplate` 留空时使用内置模板。Windows 可把题目目录设为 `D:/Code/Algorithm/Lanqiao`。
4. 在 VSCode 运行 `Lanqiao: 配对`。正常登录蓝桥并打开题目，展开网页边缘的拱桥浮球，点「配对」输入 VSCode 显示的一次性配对码。配对码有效期为 5 分钟。
5. 在网页浮球菜单点「导入 VSCode」。需要运行本地样例时，在 VSCode 安装 CPH 并配置本机 C 或 C++ 编译器。[安装 CPH](https://marketplace.visualstudio.com/items?itemName=DivyanshuAgrawal.competitive-programming-helper)

已安装相同扩展 ID 时可直接更新。已有配对通常可以继续使用。若以前使用的是测试版 `epsilon-local.lanqiao-oj-bridge`，先禁用旧扩展以释放端口，再在新版配对。可以运行 `Lanqiao: 导入已有题目记录` 登记原有题目文件。旧标签、提交快照和复盘笔记仍位于旧扩展的本地存储。

## 做题与评测

导入后通常左边编辑源码，右边显示带按钮的蓝桥交互题面。题面保留可提取的公式、代码块、样例和图片链接。描述标题旁可复制完整 Markdown，样例框内可复制输入或输出。

- 点击题面标题旁的 **C / C++** 标记切换语言。扩展会记住每道题的选择，新题默认使用最近选定的默认语言。
- 通过右侧题面、状态栏「蓝桥 #题号」或命令面板中的 `Lanqiao: 题目操作` 打开相关功能。在源码或题目的 `README.md` 中也可以运行 `Lanqiao: 打开题面`。
- 网页浮球可移动、贴边和收起，位置会记住。找不到时，可在脚本菜单选择「重置浮球位置」。云课仅在当前单元加载了官方 OJ 编辑器的编程练习中显示导入入口。

| 操作 | 实际行为 |
| --- | --- |
| 发送至 CPH | 将可提取的样例关联到当前源码，并打开 VSCode 的 CPH 面板。已有自定义样例会保留。 |
| 本地测试 | 使用 CPH 和本机编译器运行样例。 |
| 调试 → 样例 | 把选中的题面输入交给蓝桥官方调试，展示平台返回的输出和执行错误。 |
| 调试 → 调试 | 使用蓝桥网页的原生调试方式，按平台实际返回的信息展示结果。 |
| 提交 | **点击即保存当前代码并发起正式提交，无二次确认。** 扩展先保存提交快照，成功后才发送任务。 |
| 填入网页代码 | 将代码填入官方编辑器，由你点击网页上的提交按钮。 |
| 查看评测 | 在 VSCode 中查看扩展记录的本题结果。网页中可查看完整官方记录。 |

在线操作时，保持已配对的同一道题的网页打开。课程题应打开对应课程练习。网页编辑器的 C 或 C++ 选项需与本地源码一致。样例调试只用于观察执行结果，正式评测状态以蓝桥官方结果为准。

官方调试和提交结果集中在「查看 → 输出 → Lanqiao OJ」。扩展显示平台实际返回的状态、输出、错误和可用的测试点通过汇总。遇到超时或结果未知时，先查看官方提交记录，再决定是否重试。

## 本地题目管理

在「资源管理器 → 本地题目」可按标签或评测状态查看已导入题目。运行 `Lanqiao: 搜索本地题目`，可用题号、原标题或标签查找。右键「设置标签」可多选已有标签，也可点 `+` 新建。

- **最近打开**按工作区保存，默认显示最近 5 道题。右键可移除记录，视图菜单可清空访问历史。题目、源码和提交历史各自保存在原有位置。
- **题目状态**随收到的正式评测结果更新。之前通过、之后提交失败的题目仍会标记「曾通过」。
- **提交历史**保存扩展发起正式提交时的源码快照。展开题目即可查看只读快照，或与当前代码、相邻提交及指定历史版本对比。默认每题保留 20 条。通过「填入网页代码」后手动点网页提交的记录可在蓝桥网页查看。
- **错题复盘**会登记明确的官方 WA、TLE、MLE、RE、CE，也支持手动加入题目。可写 Markdown 复盘笔记，标记待复盘、复盘中或已复盘。右键「对比失败与通过」会打开最近一次有效的失败与后续 AC 快照。没有后续 AC 时，可对比当前同语言源码。

切题默认采用 `smart`。新题打开后，在同一编辑器组安全清理由扩展打开、已保存且未固定的上一题标签。未保存、固定、手动打开或归属不明的标签会保留。可设置 `keep` 保留全部标签，或用 `closePrevious` 清理两侧符合条件的上一题标签。右侧自动题面可通过 `lanqiao.openMarkdownBesideSource` 关闭。

## 文件与设置

```text
<题目根目录>/3263-【练习】选题/
  README.md        本地 Markdown 题面
  3263.cpp         C++ 解法（默认文件命名）
  3263.c           C 解法（选择 C 时创建）
  samples/         可提取的样例
  .lanqiao.json    题目元数据
  .cph/            CPH 样例记录（取决于 CPH 的保存设置）
```

重复导入优先复用已登记的同语言源码，也兼容旧 `main.cpp` 和 `main.c`。资源管理器中的题目名称仍来自导入时保存的原标题。图片通过原链接加载。源码或 Markdown 移动后，可以从本地列表的缺失提示重新关联。源码须与本题的 `.lanqiao.json` 位于同一目录。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| `lanqiao.root` | `~/Code/Learning/Algorithm/Lanqiao` | 新题的保存目录 |
| `lanqiao.template` | `~/Code/template.cpp` | 新建 C++ 源码的模板 |
| `lanqiao.cTemplate` | 空 | C 模板路径，留空使用内置模板 |
| `lanqiao.defaultLanguage` | `cpp` | 新题默认语言，可选 `cpp` / `c` |
| `lanqiao.sourceFileNaming` | `problemId` | 设为 `main` 可对新文件使用旧命名 |
| `lanqiao.editorSwitchBehavior` | `smart` | 切题标签策略 |
| `lanqiao.openMarkdownBesideSource` | 开启 | 打开题目时自动显示右侧交互题面 |
| `lanqiao.recentProblems.limit` | `5` | 最近打开显示数量 |
| `lanqiao.snapshotRetention` | `20` | 每题保留的提交快照数量 |
| `lanqiao.port` | `27124` | 本机浏览器桥接端口 |
| `lanqiao.diagnostics` | 关闭 | 在 Lanqiao OJ 输出中记录诊断信息 |

`Lanqiao: 简洁目录显示` 可隐藏工作区题目目录里的内部记录。可用 `Lanqiao: 恢复目录显示设置` 恢复。需要 Companion 格式样例时，运行 `Lanqiao: 导出 Companion JSON`。

题目索引保存在 VSCode 当前配置文件的扩展存储目录，文件名为 `local-problems.json`。快照及笔记位于同一目录的 `submissions/`。最近打开记录通过 VSCode 工作区存储保存。

## 常见问题

- **找不到网页浮球**：检查脚本已启用，刷新对应题目页并等待题面和编辑器加载。云课请切到 OJ 编程练习。
- **等待网页连接**：打开对应的题库题或课程练习并检查语言。使用 `Lanqiao: 配对` 生成新配对码进行配对。改过端口时，在脚本菜单「设置本地端口」填写同一端口，再刷新网页。一个端口由一个 VSCode 窗口占用。
- **CPH 为空**：确认 VSCode 已启用 CPH，打开本题实际使用的源码后点「发送至 CPH」。若仍为空，检查 CPH 保存目录，从 `samples/` 手动补充，或开启 `lanqiao.diagnostics` 查看记录路径。
- **登录失效或权限不足**：回蓝桥网页正常登录并完成平台要求的验证，等待编辑器就绪后点「重新检测」。
- **更新后显示旧界面**：在 VSCode 扩展详情检查版本并重载窗口。脚本管理器里检查脚本版本，刷新蓝桥网页。

## 数据与使用范围

浏览器和 VSCode 只通过本机 `127.0.0.1` 桥接，默认端口 `27124`。使用一次性配对码和本地授权令牌。登录由蓝桥网页处理，插件配对流程只需配对码。

扩展逐题处理用户主动导入的当前页面，题面、样例、源码、快照和笔记保存在本机。代码在你选择调试、提交或填入网页后才交给对应蓝桥页面。本项目无云端题库或代码收集服务。使用时请遵守蓝桥访问要求、赛事规则及题目内容的使用和分发限制。

卸载前可运行 `Lanqiao: 撤销浏览器授权`。之后卸载 VSCode 扩展及浏览器脚本即可。题目目录由你自行保管。

## 开发与验证

```sh
npm ci
npm run check
npm test
npm run package
```

使用 Node.js 20 或以上版本。构建输出为 `dist/`，安装包在 `artifacts/`。脚本镜像位于 `userscript/lanqiao-bridge.user.js`。0.7.4 通过 143 项自动化测试，Mac 独立 VSCode 窗口实测了三种切题策略、未保存与固定标签保护及双栏焦点。测试任务使用本机桥接和测试数据。本版的真实平台提交及 Windows / Linux 实机流程未重新验收。

源代码采用 MIT 许可证。[许可证](https://github.com/reverse-l/lanqiao-oj-bridge/blob/main/LICENSE) · [第三方许可](https://github.com/reverse-l/lanqiao-oj-bridge/blob/main/THIRD_PARTY_NOTICES.md)
