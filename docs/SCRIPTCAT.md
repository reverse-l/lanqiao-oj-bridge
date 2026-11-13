# Lanqiao OJ Bridge

> **非官方声明**
>
> **Lanqiao OJ Bridge 为爱好者独立开发的学习辅助工具，非蓝桥官方产品，未获得蓝桥杯组委会授权，仅用于备赛学习，无商业用途。**
>
> 本项目当前免费提供，作者不通过本项目收费或售卖题目。

把蓝桥 OJ 题面、样例和官方在线调试连接到 VSCode，支持 **C / C++**。

**本页提供浏览器端脚本，必须配合 Lanqiao OJ Bridge 的 VSCode 扩展使用。需要本地样例测试时，再在 VSCode 安装 CPH。**

- [安装 VSCode 扩展](https://marketplace.visualstudio.com/items?itemName=epsilon-dev.lanqiao-oj-bridge)
- [下载 VSIX 安装包与源码](https://github.com/reverse-l/lanqiao-oj-bridge/releases/latest)
- [完整使用说明](https://github.com/reverse-l/lanqiao-oj-bridge#readme) · [反馈问题](https://github.com/reverse-l/lanqiao-oj-bridge/issues)

浏览器脚本与 VSCode 扩展分别维护版本号，不要求两者数字相同。脚本版本以本页“版本”为准，扩展版本以商店或 GitHub Release 为准。

## 配套使用后可以做什么

- 在蓝桥题目页导入题面、公式、图片和样例，生成 Markdown 与 C / C++ 解法文件。
- 将可提取的样例关联到现有 CPH，使用自己的本地编译配置测试。
- 在 VSCode 调用已登录蓝桥网页的官方在线调试，查看真实输出和编译错误。
- 确认后正式提交，显示官方评测状态及平台实际返回的测试点通过汇总。
- 复制题面 Markdown、样例及运行输出；记住语言选择，方便后续复习。

## 首次安装

1. 安装 VSCode 扩展。也可下载 Release 中的 `.vsix`，在 VSCode 扩展页右上角 `…` →“从 VSIX 安装”，然后重载窗口。
2. 浏览器安装 Tampermonkey 或兼容的用户脚本管理器，再安装本页脚本，并允许它在蓝桥题目页运行。
3. VSCode 设置搜索 `Lanqiao`，指定题目目录 `Lanqiao Root`。使用 C++ 时还需设置一个已存在的 `Lanqiao Template`；C 模板留空可使用内置基础模板。
4. VSCode 命令面板运行 `Lanqiao: 配对`，在蓝桥题目页点击“配对”，输入一次性配对码。每台电脑独立配置和配对，不要输入账号密码或 Cookie。
5. 点击网页的“导入 VSCode”。题面中的 C / C++ 标记可切换语言，已有解法和非空自定义测试保留。

本地测试需在 VSCode 安装 [CPH](https://marketplace.visualstudio.com/items?itemName=DivyanshuAgrawal.competitive-programming-helper)，并准备对应语言的编译器。**无需另外安装浏览器版 CPH 或 Competitive Companion。**

## 三种运行方式

| 操作 | 含义 |
| --- | --- |
| 本地测试 | 使用 CPH 和自己的编译器运行样例 |
| OJ 在线调试 | 通过已登录网页使用蓝桥官方服务器调试；指定输入时只展示执行结果，不据此判断整题 AC / WA |
| 提交 | 显示确认后创建真实官方评测记录；结果以官方返回为准 |

在线调试与提交时，保持对应题目的网页打开，并选择与解法一致的官方语言。提交不是后台自动执行的。

## Windows 保存到其他盘

在 VSCode 设置中搜索 `Lanqiao Root`，例如填写 `D:/Code/Algorithm/Lanqiao`。只影响后续导入位置，已有文件不会自动搬迁，无需修改脚本代码。

## 使用提示

- **一题一导入**：用户自行登录并打开题目，主动导入当前这一题；不提供批量抓取或批量导出题库功能，不建立、收集或上传云端题库。
- **数据在本地**：题面、样例和解法会保存在用户自己的电脑上，用于个人备赛学习和复习；本项目不设云端题库或代码收集服务。
- **请尊重内容权利**：请勿公开二次分发受版权保护的题面、批量导出题库、收费售题或规避平台限制；使用时须遵守平台及适用的赛事规则。
- **免费提供**：本项目当前不收费、不售卖题库，也不提供付费评测服务。
- **开源许可不变**：软件源代码继续采用 MIT 许可证。项目定位和使用提醒不改变软件许可证，也不代表取得题目内容的再分发授权。

## 使用范围与隐私

- 使用自己正常登录的蓝桥会话，不要求复制 Cookie、JWT 或密码，不绕过登录、验证码或访问限制。
- 浏览器与扩展通过 `127.0.0.1` 通信；默认桥接端口为 `27124`，与 CPH 的 `27121` 独立。
- 解法仅在你启动在线调试、确认提交或选择填入网页时交给对应蓝桥页面。本项目不设云端代码收集服务。
- 不修改现有 CPH、Code Runner 或其他 OJ 插件的编译配置。默认关闭诊断日志，排错时可临时开启 `Lanqiao Diagnostics`。
- 已在 Chrome + Tampermonkey 环境验证核心流程；其他环境及未来网页改版的兼容性以实际情况为准。无法提取的样例可在 CPH 手动补充。

本项目独立开发，与蓝桥官方无隶属关系。遇到问题请在 GitHub Issues 提供题号、扩展 / 脚本版本和脱敏错误信息，不要上传登录凭据或私有解法。
