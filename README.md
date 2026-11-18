# Session Marks｜会话标记

用收藏保留重要会话，用待回看标记稍后处理的会话。只显示一个必要标记，需要整理时再展开列表。

**Jolyon · 1.0 · macOS 自用 · 非官方 DSH 插件 · AI 辅助开发**

[下载 1.0](https://github.com/joesl3epy-cloud/dsh-sidebar-marks/releases/tag/v1.0) · [版本记录](./CHANGELOG.md) · [反馈问题](https://github.com/joesl3epy-cloud/dsh-sidebar-marks/issues)

## 为什么做

会话多了以后，单看标题和时间，很难分清哪些值得保留、哪些还需要处理。我只需要两种状态：收藏与待回看。插件围绕这个目的开发，避免把标签、调色和复杂管理界面一起塞进侧栏。

## 当前功能

- 在官方会话右键菜单中增加待回看、收藏和删除会话。分隔线及“会话标记”后缀区分插件操作；已标记时显示取消操作。
- 每条会话最多一个标记点：待回看优先于收藏。两个状态独立保存，取消待回看后仍可显示收藏点。
- 点击官方工作区放大镜，在其下方显示分隔线与“会话标记”区域。分别浏览跨工作区的收藏或待回看，不重复增加搜索框，不改变官方搜索输入与结果。
- 列表只显示标记点与会话名称，不显示内部编号和目录。标题通过宿主标题接口读取，无名称时显示“未命名会话”。
- 列表左键打开会话；右键二次确认后，只取消当前页签对应标记，另一种状态与会话内容保留。支持连续逐条清理，不提供多选批量提交。
- 不要求安装Session Manager，可只读兼容其旧标记；不反向写入其数据。

## 删除与数据

删除必须二次确认，将会话目录移入 `<DSH_HOME>/sessions/.trash/<时间>/<编号>/`，不永久抹除。运行或已加载的会话、含子任务、状态不明、索引不完整或编号不唯一时拒绝删除。

本版没有恢复按钮。恢复需先停止相关任务，再将目录移回原工作区并刷新宿主索引。不要用重要真实会话测试删除。

标记保存在 `<DSH_HOME>/dsh-sidebar-marks/marks.json`，默认DSH_HOME为~/.dsh。取消记录覆盖共享旧标记，避免取消后复活；降级旧开发版前应保留该文件。历史标签数据和style.json保留，但没有标签入口、空心标签点或颜色设置。

## 安装

需要Node ≥ 24与兼容的DSH Desktop。模块ID保留为dsh-sidebar-marks，安装包未发布到npm。

1. 下载源码并解压到稳定目录，或克隆本仓库。
2. 在实际profile的package.json中，将以下项合并到dependencies，替换为实际绝对路径：

```json
{"dsh-sidebar-marks":"file:/绝对路径/dsh-sidebar-marks"}
```

3. 在同文件dsh.profile.bundles加入"dsh-sidebar-marks"，保留其他配置。
4. 使用DSH自带pnpm在profile安装依赖，然后⌘Q完整退出并重开DSH。只刷新页面不会加载新增的宿主依赖和前端菜单。

```bash
node "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs" install --dir "/实际DSH_HOME/profiles/实际profile"
```

停用沿用宿主插件列表；手工配置也可从bundles移除并重启，再按需移除依赖。不会自动删除标记数据。

## 边界与验证

- 仅在macOS个人环境持续试用。官方搜索区域仍有DOM兼容依赖；匹配不到已知结构时不额外创建顶部入口。
- 官方菜单通过contextMenus扩展，标题通过sessionQuery读取。宿主需提供webServer、sessions、sessionPersistence、workspaceRegistry、sessionQuery、uiWorkspace及contextMenus。
- 作者已反馈标记、列表与标题在实际界面显示正常；最新原生右键接入及异常场景以隔离测试为主，尚无完整实机演示视频，不宣称全部宿主版本兼容。
- 34项隔离测试覆盖单点优先级、共享标记取消、菜单目标身份、列表确认取消、标题、删除保护、请求来源、节点复用及停用清理。HTTP与删除测试只用临时目录和合成会话。

```bash
npm test
```

通信使用DSH自身/sidebar-marks/api，不另开回环端口。自定义请求头及来源校验用于防止网页简单跨站请求，不作为同用户本机进程的独立鉴权。

## AI协作与署名

Jolyon提出真实需求、讨论交互取舍并在Mac上反馈；DeepSeek完成早期实现；ChatGPT/Codex参与审查并完成本轮极简化、搜索区域整合、标题读取及原生菜单接入。

这是Vibe Coding实践，代码并非由我逐行手写。项目展示需求判断、AI协作与验收过程，不编造节省工时或企业部署规模。

## 未来方向

自定义标签、标签筛选与自定义颜色暂不开发，没有确定排期。优先考虑另一个独立的Tag插件，颜色可作为其配套设置，不继续扩大本包。

完整原则与头脑风暴提醒见 [开发 Prompt](./DEVELOPMENT.md)。

## 版本与许可

首个整理后的正式版公开名称为1.0，包内使用1.0.0；早期1.1.x和1.2.x是开发编号，保留Git历史，不覆写旧标签。此项目未发布到npm，旧版用户按本地路径重新安装，不依据开发编号推断成熟度。

之后宿主升级所需的兼容更新用1.1、1.2，明确的重大功能迭代用2.0；开发中的小修不逐次涨号。

MIT，见[LICENSE](./LICENSE)。非官方扩展，与DeepSeek及DSH维护者没有隶属关系。
