# dsh-sidebar-marks

在 DeepSeek Harness 侧栏的会话标题旁加一个小圆点，一眼认出「待回看 / 收藏 / 有标签」的会话。

> **非官方插件**，与 DeepSeek 无隶属关系。测试环境见文末。

> **本版本（0.9.0）是显示层**：标记的增删由 `dsh-session-manager`（或任何往同一个 JSON 里写数据的插件）完成，本插件只负责把它画出来。
> 自带打标记的标题栏 UI 计划在 1.0 提供。

---

## 长什么样

会话行的右侧、官方「固定」图钉的左边，按标记出现 1–3 个直径 6px 的小圆点：

| 标记 | 形状 | 色值 | 语义 |
|---|---|---|---|
| 待回看 | 实心 | `#ec7a70` | 这件事还欠着，需要回来处理 |
| 收藏 | 实心 | `#d9a94e` | 留着，但不急着回看 |
| 有标签 | 空心环 | `#8fb8d9` | 已被归类（环的颜色按标签名哈希，共 8 色） |

位置是刻意选的：会话行最左侧（和文件夹图标同列）是 DSH 官方的状态点（绿点=运行中、转圈=工作中），不能占；所以本插件的点放在行的右侧，并且给「固定」图钉预留了 28px，没有图钉的行也不会挤到边。

### 为什么是这几个颜色

1. **避开 DSH 已占用的语义色**。官方用绿色表示运行中、橙黄表示待批准；第三方再占用会误读，所以全部让开。
2. **暗色侧栏上要够亮**。莫兰迪灰在深色背景上会被压到几乎看不见，因此取莫兰迪色系里偏亮的一档：保留低饱和与灰调，抬高明度。
3. **色相要分得开**。三个维度形状相同，只能靠色相区分，所以落在红 / 金 / 蓝三个方向。
4. **情绪与语义一致**：待回看是压力，用偏暖的红；收藏是偏好，用偏暖的金；标签是分类，用最冷静的蓝。

### 一个会话有多个标记时

默认**全部画出**（最多三个点：态度点 + 标签环）。把 `~/.dsh/dsh-sidebar-marks/style.json` 里的 `displayMode` 改成 `"single"`，则只画优先级最高的那一个，优先级由 `priority` 数组决定，默认：

```
later  >  favorite  >  tag
```

这两个字段目前只认文件，没有界面（界面在 1.0）。

---

## 前置依赖

标记数据读自 `~/.dsh/dsh-session-manager/annotations.v1.json`，由 `dsh-session-manager` 维护。

- 没装它：插件保持静默——找一个不存在的文件、直接返回空，不画点、不报错，不影响 DSH。
- 装了别的、但写同一份 JSON 的其他插件：也能工作，只要字段是 `sessions[id].favorite / reviewLater / tags`。

`GET /health` 会返回 `sessionManager: true/false`，可用于确认依赖是否就位。

---

## 工作原理

插件分两半。

**主控侧 `lib/index.js`**

- 读 `annotations.v1.json`，归一化成 `{ sessions: { <id>: { marks: [...], tags: [...], priority } } }`
- 在 `127.0.0.1` 起一个只监听回环的 HTTP 服务，端口 `49397` 起，被占用则顺延到 `49405`
- 路由：`GET /health`、`GET /marks`、`GET /style`、`GET /stream`
- `fs.watch` 盯住标注文件，变动后 120ms 防抖，通过 SSE 推送 `event: changed`
- 只读，不写回任何文件

**显示侧 `lib/client.js`**

- 由 DSH 作为客户端插件加载，跑在 web 前端里
- 找侧栏里的会话行 → 从 React fiber 反查 sessionId → 在官方图钉前插入圆点
- `MutationObserver` 盯侧栏 DOM（80ms 节流），折叠/展开时立即重画
- 优先用 SSE，断线时 6 秒兜底轮询
- 鼠标悬停在会话行上（官方会显示三个操作按钮）时，把自己的点隐藏，避免和官方图标叠在一起

### 为什么不用固定 class 名定位

DSH 前端的类名是 CSS Modules 哈希（如 `JoiKIa_title`），哈希前缀每次构建都会变，会话行也没有 `data-session-id`。所以：

- 用**语义后缀**匹配（`_sessionRow` / `_title` / `_pinIndicator`），只取后缀不取哈希
- 用 `__reactProps$` / `__reactFiber$` 反查 sessionId

这是「能用但不保证永远」的灰色手段：依赖 React 内部属性名和上游的类名后缀。上游改结构时本插件会**停止绘制**，而不是乱画。

---

## 安装

需要 Node ≥ 20，DSH Desktop（macOS 已实测）。

```bash
# 1. 放到任意位置，例如 ~/plugins/dsh-sidebar-marks
# 2. 在 profile 的 package.json 里加依赖
#    ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": { "dsh-sidebar-marks": "file:/绝对路径/dsh-sidebar-marks" },
  "dsh": { "profile": { "bundles": ["...", "dsh-sidebar-marks"] } }
}

# 3. 安装依赖（DSH 自带的 pnpm）
node "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs" \
  install --dir "$HOME/.dsh/profiles/<profile>"
```

重启 DSH。**不能只热刷新页面**——客户端插件在启动时一次性组装，改文件必须重启。

### 两条必须遵守的硬约束

DSH 的客户端插件加载失败时，会把整个 profile 配置**重置成模板**（bundles 只剩 base + web-app，`cordis.patch.yml` 被砍回出厂版本），用户看到的现象是「所有插件都没了」。

1. **文件名必须是 `lib/client.js`**。换成别的名字会 404，前端加载失败。
2. **`__ModuleLoader__.load` 的 id 必须等于包名**。写错会报
   `loaded without registering "dsh-sidebar-marks"`，同样触发重置。

装之前建议先备份 `~/.dsh/profiles/<profile>/package.json` 和 `cordis.patch.yml`。

---

## 诊断

```bash
curl -s http://127.0.0.1:49397/health
# {"ok":true,"plugin":"dsh-sidebar-marks","version":"0.9.0","ui":"1","sessionManager":true}

curl -s http://127.0.0.1:49397/marks
# {"ok":true,"installed":true,"sessions":{"session-...":{"marks":["later"],"tags":[],"priority":3}}}

curl -s http://127.0.0.1:49397/style
# 当前视觉参数（点大小、颜色、显示模式）
```

日志：`~/.dsh/dsh-sidebar-marks/host.log`。

## 卸载

1. 从 profile 的 `bundles` 里去掉 `dsh-sidebar-marks`
2. 从 `dependencies` 里去掉对应行
3. 重跑一次 `pnpm install`（会移除 `node_modules/dsh-sidebar-marks`）
4. 重启 DSH

可选：删掉 `~/.dsh/dsh-sidebar-marks/`（日志与样式缓存）。标注文件属于 `dsh-session-manager`，不要删。

---

## 已知限制

- **不自带打标记的界面**（0.9）。不装 `dsh-session-manager` 时，除非别的程序往那个 JSON 里写数据，否则看不到任何点。
- 依赖 React 内部属性与类名后缀；DSH 大版本升级后可能需要重新校准，届时会停止绘制而不是画错位置。
- 只处理 DSH Desktop（`dsh-app://`），浏览器版未验证。
- 折叠动画期间点会跟着动画元素移动，不做额外平滑。
- `style.json` 里的视觉参数目前只能手改，没有界面。

## 测试

```bash
node --test test/
```

覆盖：标记归一化（多标记共存、标签哈希）、会话行的类名匹配与图钉锚点、悬停隐藏、SSE 变更推送。

## 实测环境

| 项 | 版本 |
|---|---|
| DeepSeek Harness Desktop | 0.2.1-rc.5 |
| Electron | 44.7.0 |
| Node | 24.21.0 |
| dsh-session-manager | 0.7.2 |
| 系统 | macOS（Apple Silicon） |

Windows / Linux 未测试，不宣称兼容。

## License

MIT
