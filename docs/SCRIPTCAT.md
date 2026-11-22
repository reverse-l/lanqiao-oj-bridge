# Lanqiao OJ Bridge

> **非官方声明**
>
> **Lanqiao OJ Bridge 为爱好者独立开发的学习辅助工具，非蓝桥官方产品，未获得蓝桥杯组委会授权，仅用于备赛学习，无商业用途。**
>
> 本项目免费提供，作者不通过本项目收费或售卖题目。

从蓝桥题库或蓝桥云课的 OJ 编程练习导入当前题目，在 VSCode 阅读题面、写 C / C++、运行样例并查看蓝桥官方评测。

**本页提供脚本猫（ScriptCat）用户脚本 0.6.0，配合 VSCode 扩展 0.7.4 使用。** VSCode 扩展管理本地题目和代码，脚本猫中的用户脚本连接当前蓝桥网页。已有 0.6.0 的用户可以直接更新 VSCode 扩展并重载。

- [安装或更新 VSCode 扩展](https://marketplace.visualstudio.com/items?itemName=epsilon-dev.lanqiao-oj-bridge) · [下载 VSIX](https://github.com/reverse-l/lanqiao-oj-bridge/releases)
- [完整使用说明](https://github.com/reverse-l/lanqiao-oj-bridge#readme) · [反馈问题](https://github.com/reverse-l/lanqiao-oj-bridge/issues)

## 首次安装

1. 在桌面版 VSCode 1.95 或以上版本安装 Lanqiao OJ Bridge。使用 VSIX 时，在「扩展 → … → 从 VSIX 安装」选择文件并重载。
2. 安装并启用脚本猫（ScriptCat）浏览器扩展，再点击本页的脚本安装按钮。按浏览器提示允许用户脚本运行。[脚本猫安装指南](https://docs.scriptcat.org/docs/use/use)
3. 在 VSCode 设置中搜索 `Lanqiao`，按需配置题目目录 `lanqiao.root`。新建 C++ 源码时需要一个已存在的 `lanqiao.template`。C 模板留空可使用内置模板。Windows 可以把题目目录设到其他盘，例如 `D:/Code/Algorithm/Lanqiao`。
4. 在 VSCode 运行 `Lanqiao: 配对`。正常登录蓝桥，在题目页展开右侧拱桥浮球，点「配对」并输入一次性配对码。
5. 点「导入 VSCode」。题面、可提取的样例和源码会保存到本地，源码旁可显示带操作按钮的交互题面。旧源码会复用，新建源码默认使用题号，例如 `3263.cpp` 或 `3263.c`。

需要本地样例测试时，请在 VSCode 安装 CPH 并配置对应语言的本机编译器。[安装 CPH](https://marketplace.visualstudio.com/items?itemName=DivyanshuAgrawal.competitive-programming-helper)

## 编写、调试与提交

通过 VSCode 右侧题面按钮或命令面板 `Lanqiao: 题目操作` 操作。点击题面上的 C / C++ 标记可切换语言。描述标题旁可复制题面 Markdown，样例框内可单独复制输入或输出。

| 操作 | 实际行为 |
| --- | --- |
| 本地测试 | 由 VSCode 的 CPH 和本机编译器运行样例。 |
| 调试 | 可选择题面样例输入，也可选择「调试」使用蓝桥网页的原生调试方式。执行输出和错误显示在 VSCode 的 Lanqiao OJ 输出面板。 |
| 提交 | **点击即保存当前代码并发起正式提交，无二次确认。** VSCode 在发送前保存快照，正式评测结果以蓝桥官方回传为准。 |
| 填入网页代码 | 只将代码填入官方编辑器，正式提交由你在网页上点。 |

在线操作时，保持已配对的同一道题打开，课程题应打开对应课程练习。网页编辑器的语言要与本地 C / C++ 源码一致。样例调试用于查看执行结果。提交超时或状态未知时，先查看蓝桥官方提交记录。

## 在 VSCode 接着做

在「资源管理器 → 本地题目」可搜索题号和标题、选择知识点标签、按状态筛选并查看「最近打开」。展开题目可以打开只读提交快照，也可在「错题复盘」中对比失败与通过、写自己的复盘笔记。

点击题目会打开源码和右侧交互题面。默认切题策略会清理同组内由扩展打开、已保存且未固定的上一题标签。要同时保留多道题，可把 `lanqiao.editorSwitchBehavior` 设为 `keep`。旧 `main.cpp` 和 `main.c` 继续使用原路径。

## 常见问题

- **浮球不见了**：检查脚本已启用，刷新页面并等待编辑器加载。浮球可停靠在左侧或右侧，也可从脚本菜单运行「重置浮球位置」。云课仅在有官方 OJ 编辑器的编程练习显示控件。
- **网页未连接**：检查 VSCode 已打开、题目与语言匹配。重新配对时输入 VSCode 生成的一次性配对码。改过端口时，用脚本菜单的「设置本地端口」与 VSCode 保持一致。
- **CPH 没有样例**：打开本题源码，在 VSCode 点「发送至 CPH」。也可从题目目录的 `samples/` 手动补充。

## 数据与使用范围

本工具处理用户主动打开并导入的单道题。题面、样例、解题代码与复盘记录在本机保存。浏览器通过 `127.0.0.1` 与 VSCode 扩展连接，默认端口为 `27124`。浏览器里的蓝桥登录由用户自行完成，插件配对流程只需一次性配对码。

只有在你发起调试、提交或填入网页时，当前代码才会交给对应蓝桥页面。本项目无云端题库或代码收集服务。请按平台和赛事规则使用，尊重题目内容的分发限制。项目源代码采用 MIT 许可证。
