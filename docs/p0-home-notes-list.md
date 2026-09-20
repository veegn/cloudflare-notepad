# P0 任务拆分 + UI/UX 稿：主页日记列表

> 产品目标：主页 `/` 展示**当前服务（R2 桶）下**的日记列表，可浏览、搜索、筛选并进入查看/编辑。

---

## 1. P0 任务拆分

依赖顺序：`P0.1 → P0.2 → (P0.3 ∥ P0.5) → P0.4 → P0.6`。P0.3 与 P0.5 可并行。

| ID | 任务 | 交付物 | 验收标准 | 主要文件 |
| --- | --- | --- | --- | --- |
| **P0.1** | 服务层列表 | `note::list_notes` + DTO | R2 `list()` 分页；返回 path/mode/pw/share/updateAt/isIndex；过滤空 key；`_index` 标记；cursor 透传 | `src/services/note.rs`, `src/models/note.rs`, `src/models/api.rs` |
| **P0.2** | 列表 API | `GET /api/notes` | 支持 `limit`/`cursor`/`q`/`filter`；`filter=all\|public\|protected\|private`；public 且无 pw 时附 `excerpt`（≤120 字，strip md）；受保护项 **不**返回 content/excerpt；统一 `{code,data}` | `src/routes/api.rs`, `src/lib.rs`, `src/routes/mod.rs` |
| **P0.3** | 页面结构 + i18n | `home.html` 列表区 + 文案 | 在 workbench 内新增 `#notes-region`（工具条 + 列表 + 空态/加载）；hero 保留；`_index` 有内容时为钉住卡片；中英文案齐全 | `templates/home.html`, `src/i18n/zh.json`, `src/i18n/en.json`, `src/routes/pages.rs` |
| **P0.4** | 前端列表逻辑 | `frontend/notesList.ts` + 挂载 | 拉取 `/api/notes`；渲染卡片；path/标题/摘要搜索；筛选 chips；「加载更多」；空态/错误态；点击进 `/note/:path` | `frontend/notesList.ts`, `frontend/app.ts`, `frontend/types.ts`, `frontend/config.ts` |
| **P0.5** | UI 样式 | `.notes-*` 样式 | 列表卡、工具条、徽章、空态；light/dark 使用现有 CSS 变量；与 IBM Plex / workbench 密度一致 | `static/css/app.css` |
| **P0.6** | 测试 | Playwright + 可选 Rust 单测 | 列表加载；筛选/搜索；受保护项无摘要且跳转鉴权；空桶空态；分页加载更多 | `tests/routes.spec.js`, `tests/editor-ui.spec.js` 或新 `tests/notes-list.spec.js` |

### P0.1 细分

- [ ] `NoteListItem` / `NoteListPage` 结构体（serde camelCase）
- [ ] `list_notes(bucket, limit, cursor) -> NoteListPage`
- [ ] 解析 R2 list 自定义 metadata（复用 `metadata_from_custom`）
- [ ] `is_index_path` 标记；遗留 `.index` 显示为 `_index`
- [ ] Rust 单测：filter 规则、excerpt 裁剪、path 归一

### P0.2 细分

- [ ] `GET /api/notes` 注册路由
- [ ] Query：`limit` 默认 50、上限 100；`cursor`；`q` 大小写不敏感子串；`filter`
- [ ] 摘要策略：仅 `!needs_view_auth` 的项，取 content 前 120 字符并 strip Markdown 标记
- [ ] 大桶优化：`q`/filter 在内存对当页结果过滤时，响应带 `hasMore`；P0 可先 list 全量再分页（桶约 20 条量级可接受），接口仍返回 cursor 以便扩容
- [ ] 错误码与现有 `ok_json` / `err_json` 一致

### P0.3 细分

- [ ] `home.html`：`welcome-view` 内 hero 下方插入 notes 区
- [ ] 模板仅提供容器与 data 属性，数据由前端注入（`window.CONFIG` 可带 `notesEndpoint`）
- [ ] i18n keys：`notesTitle`, `notesSearchPH`, `notesFilterAll/Public/Protected/Private`, `notesEmpty`, `notesEmptyHint`, `notesLoadMore`, `notesLoading`, `notesError`, `notesCount`, `notesProtected`, `notesPrivate`, `notesPublic`, `notesIndexCard`, `notesNewFromList`

### P0.4 细分

- [ ] `fetchNotesList(params)` 类型化请求
- [ ] `renderNotesList` / `renderNoteCard` / `renderNotesEmpty`
- [ ] 防抖搜索（300ms）；筛选与搜索同时生效
- [ ] 「加载更多」追加，不整页刷新
- [ ] 错误 toast（复用 `showToast`/`errHandle`）
- [ ] 新建按钮沿用现有 path prompt 逻辑

### P0.5 细分

- [ ] `.notes-toolbar` / `.notes-search` / `.notes-filters` / `.notes-list` / `.notes-card` / `.notes-badge` / `.notes-empty`
- [ ] Hover：border → accent；focus-visible 可访问
- [ ] 移动端：卡片单列、工具条纵向堆叠、触控高度 ≥ 44px

### P0.6 细分

- [ ] fixtures：至少 3 条 public + 1 条 password + 1 条 private + `_index`
- [ ] 断言列表项徽章与摘要有/无
- [ ] 搜索过滤后条目变化
- [ ] 点击 public → `/note/:path`；点击 protected → 密码页
- [ ] `npm run lint` / `npm run typecheck` / 相关 e2e 通过

### 明确不在 P0

- 列表内删除/重命名
- `title`/`excerpt` 写入 R2 metadata（P1）
- 站点级列表门禁 `SCN_LIST_VISIBILITY`
- 日历/时间轴分组
- 全文检索服务端索引

### 建议实现顺序（人日粗估）

| 步骤 | 内容 | 估时 |
| --- | --- | --- |
| 1 | P0.1 + P0.2 + Rust 单测 | 0.5–1d |
| 2 | P0.3 + P0.5 静态结构与样式 | 0.5d |
| 3 | P0.4 交互与状态 | 0.5–1d |
| 4 | P0.6 e2e + 联调 | 0.5d |

---

## 2. 设计约束（对齐现有实现）

| 项 | 约定 |
| --- | --- |
| 容器 | 沿用 `base.html` → `.app-shell` → `.workbench` → `.editor-pane` 工作台，列表在 tabbar 下 editor-body 内 |
| 字体 | IBM Plex Sans（UI）/ IBM Plex Mono（路径、时间可选） |
| 色板 | 复用 CSS 变量：`--vscode-bg` `--vscode-editor` `--vscode-border` `--vscode-text` `--vscode-text-muted` `--vscode-accent` `--vscode-accent-soft` |
| 圆角 | `--radius-l` 面板、`--radius-m` 控件、`--radius-s` 徽章 |
| 主操作色 | Accent `#3794ff`（dark）/ `#005fb8`（light）；Primary 按钮沿用 gradient `#0e639c→#0a4f7c` |
| 主题 | `data-theme=light\|dark`，不引入新色相 |
| 密度 | 列表项行高紧凑，信息层级：标题 > 时间/徽章 > 摘要 > path |

---

## 3. 信息架构

```text
/ 主页
├─ Tab bar：* Cloud Notepad（is_home）
├─ Hero
│   ├─ Kicker：云端便笺
│   ├─ Title + Copy（文案可微调为“日记库”导向）
│   └─ Actions：[新建日记 primary] [编辑首页]
├─ 首页笔记卡（可选，_index 有内容时）
│   └─ 标题“首页笔记” + 预览截断 + [编辑] [查看]
├─ 日记列表区
│   ├─ 头：标题 + 总数 + 搜索
│   ├─ 筛选：全部 | 公开 | 密码 | 私密
│   ├─ 列表项 × N
│   └─ 加载更多 / 空态
└─ Statusbar（现有主题切换等，不变）
```

---

## 4. UI/UX 稿

> 以下 SVG 为 P0 线框稿（结构与状态说明），视觉 token 对齐现有 workbench。实现时以 CSS 变量渲染，非像素级切图。

### 4.1 桌面端 · 默认（有数据）

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 920" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6" fill="none" stroke="#6b7280" stroke-width="1"/>
    </marker>
  </defs>
  <rect width="680" height="920" fill="#f3f3f3"/>
  <text x="40" y="36" font-size="14" font-weight="500" fill="#333">主页 · 桌面默认态（有日记）</text>

  <!-- app shell -->
  <rect x="40" y="56" width="600" height="820" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <!-- tabbar -->
  <rect x="40" y="56" width="600" height="38" rx="12" fill="#e7e7e7"/>
  <rect x="40" y="80" width="600" height="14" fill="#e7e7e7"/>
  <rect x="56" y="64" width="92" height="22" rx="4" fill="#fff" stroke="#d4d4d4"/>
  <text x="68" y="79" font-size="12" fill="#333">* 日记库</text>

  <!-- body scroll area -->
  <rect x="40" y="94" width="600" height="720" fill="#ffffff"/>

  <!-- hero -->
  <rect x="68" y="120" width="120" height="22" rx="11" fill="rgba(0,95,184,0.1)" stroke="rgba(0,95,184,0.25)"/>
  <text x="80" y="135" font-size="11" font-weight="600" fill="#005fb8">云端便笺</text>
  <text x="68" y="178" font-size="28" font-weight="600" fill="#333" letter-spacing="-0.5">你的云端日记库</text>
  <text x="68" y="206" font-size="13" fill="#616161">当前服务下的全部日记，最近更新在上。</text>
  <rect x="68" y="226" width="110" height="36" rx="8" fill="#0e639c"/>
  <text x="90" y="249" font-size="13" font-weight="600" fill="#fff">新建日记</text>
  <rect x="188" y="226" width="100" height="36" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="208" y="249" font-size="13" font-weight="600" fill="#333">编辑首页</text>

  <!-- index card -->
  <rect x="68" y="286" width="544" height="88" rx="10" fill="#f8f8f8" stroke="#d4d4d4"/>
  <text x="84" y="310" font-size="12" font-weight="600" fill="#005fb8">首页笔记 · _index</text>
  <text x="84" y="332" font-size="12" fill="#616161">欢迎使用 Cloud Notepad，这里是服务仪表盘预览…</text>
  <rect x="472" y="318" width="52" height="28" rx="6" fill="#fff" stroke="#d4d4d4"/>
  <text x="486" y="336" font-size="12" fill="#333">编辑</text>
  <rect x="532" y="318" width="52" height="28" rx="6" fill="#fff" stroke="#d4d4d4"/>
  <text x="546" y="336" font-size="12" fill="#333">查看</text>

  <!-- list toolbar -->
  <text x="68" y="408" font-size="15" font-weight="600" fill="#333">日记列表</text>
  <text x="140" y="408" font-size="12" fill="#8b8b8b">共 21 条</text>
  <rect x="320" y="390" width="292" height="32" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="336" y="410" font-size="12" fill="#8b8b8b">搜索路径 / 标题 / 摘要…</text>

  <!-- filters -->
  <rect x="68" y="436" width="48" height="26" rx="13" fill="#005fb8"/>
  <text x="80" y="453" font-size="12" fill="#fff">全部</text>
  <rect x="124" y="436" width="48" height="26" rx="13" fill="#fff" stroke="#d4d4d4"/>
  <text x="136" y="453" font-size="12" fill="#333">公开</text>
  <rect x="180" y="436" width="48" height="26" rx="13" fill="#fff" stroke="#d4d4d4"/>
  <text x="192" y="453" font-size="12" fill="#333">密码</text>
  <rect x="236" y="436" width="48" height="26" rx="13" fill="#fff" stroke="#d4d4d4"/>
  <text x="248" y="453" font-size="12" fill="#333">私密</text>

  <!-- cards -->
  <!-- card1 public md -->
  <rect x="68" y="480" width="544" height="96" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="84" y="508" font-size="14" font-weight="600" fill="#333">周末徒步笔记</text>
  <rect x="200" y="494" width="36" height="18" rx="3" fill="rgba(0,95,184,0.1)" stroke="rgba(0,95,184,0.25)"/>
  <text x="208" y="507" font-size="10" fill="#005fb8">md</text>
  <rect x="244" y="494" width="40" height="18" rx="3" fill="#f3f3f3" stroke="#d4d4d4"/>
  <text x="252" y="507" font-size="10" fill="#616161">公开</text>
  <text x="84" y="532" font-size="12" fill="#616161">早上七点出发，山里雾很大，走到半山腰开始放晴…</text>
  <text x="84" y="554" font-size="11" fill="#8b8b8b" font-family="ui-monospace,monospace">ab3kx</text>
  <text x="480" y="554" font-size="11" fill="#8b8b8b">2 小时前</text>

  <!-- card2 password -->
  <rect x="68" y="588" width="544" height="88" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="84" y="616" font-size="14" font-weight="600" fill="#333">会议草稿</text>
  <rect x="168" y="602" width="36" height="18" rx="3" fill="rgba(0,95,184,0.1)"/>
  <text x="176" y="615" font-size="10" fill="#005fb8">plain</text>
  <rect x="212" y="602" width="40" height="18" rx="3" fill="#fff4ce" stroke="#e6c200"/>
  <text x="220" y="615" font-size="10" fill="#7a4d00">密码</text>
  <text x="84" y="642" font-size="12" fill="#8b8b8b">内容受保护，进入后查看</text>
  <text x="84" y="660" font-size="11" fill="#8b8b8b" font-family="ui-monospace,monospace">m2q7p</text>
  <text x="480" y="660" font-size="11" fill="#8b8b8b">昨天</text>

  <!-- card3 private -->
  <rect x="68" y="688" width="544" height="88" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="84" y="716" font-size="14" font-weight="600" fill="#333">私人日记</text>
  <rect x="168" y="702" width="36" height="18" rx="3" fill="rgba(0,95,184,0.1)"/>
  <text x="176" y="715" font-size="10" fill="#005fb8">md</text>
  <rect x="212" y="702" width="40" height="18" rx="3" fill="#f3f3f3" stroke="#d4d4d4"/>
  <text x="220" y="715" font-size="10" fill="#616161">私密</text>
  <text x="84" y="742" font-size="12" fill="#8b8b8b">未公开分享，内容受保护</text>
  <text x="84" y="760" font-size="11" fill="#8b8b8b" font-family="ui-monospace,monospace">x9w2m</text>
  <text x="480" y="760" font-size="11" fill="#8b8b8b">3 天前</text>

  <!-- load more -->
  <rect x="280" y="792" width="120" height="32" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="310" y="812" font-size="12" fill="#333">加载更多</text>

  <!-- statusbar -->
  <rect x="40" y="814" width="600" height="36" fill="#e7e7e7"/>
  <rect x="40" y="814" width="600" height="36" fill="none" stroke="#d4d4d4"/>
  <text x="56" y="837" font-size="11" fill="#616161">☀/🌙 · （主页动作区可空或放主题）</text>
</svg>
```

### 4.2 列表项解剖

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 280" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="680" height="280" fill="#f3f3f3"/>
  <text x="40" y="36" font-size="14" font-weight="500" fill="#333">列表项解剖 · 默认 / 受保护</text>

  <!-- public item -->
  <rect x="40" y="60" width="600" height="96" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="56" y="88" font-size="14" font-weight="600" fill="#333">周末徒步笔记</text>
  <rect x="172" y="74" width="36" height="18" rx="3" fill="rgba(0,95,184,0.1)" stroke="rgba(0,95,184,0.25)"/>
  <text x="180" y="87" font-size="10" fill="#005fb8">md</text>
  <rect x="216" y="74" width="40" height="18" rx="3" fill="#f3f3f3" stroke="#d4d4d4"/>
  <text x="224" y="87" font-size="10" fill="#616161">公开</text>
  <text x="56" y="112" font-size="12" fill="#616161">摘要：正文前 80–120 字纯文本（仅公开无密码）</text>
  <text x="56" y="134" font-size="11" fill="#8b8b8b" font-family="ui-monospace,monospace">path: ab3kx</text>
  <text x="480" y="134" font-size="11" fill="#8b8b8b">updateAt 相对时间</text>

  <!-- labels -->
  <text x="56" y="52" font-size="11" fill="#005fb8">① 标题（path 解码 / MD 首标题）</text>
  <text x="300" y="52" font-size="11" fill="#005fb8">② 模式 + 权限徽章</text>
  <text x="56" y="170" font-size="11" fill="#005fb8">③ 摘要（可选）</text>
  <text x="300" y="170" font-size="11" fill="#005fb8">④ path + 相对时间</text>

  <!-- protected item -->
  <rect x="40" y="186" width="600" height="72" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="56" y="214" font-size="14" font-weight="600" fill="#333">会议草稿</text>
  <rect x="140" y="200" width="40" height="18" rx="3" fill="#fff4ce" stroke="#e6c200"/>
  <text x="148" y="213" font-size="10" fill="#7a4d00">密码</text>
  <text x="56" y="240" font-size="12" fill="#8b8b8b">无摘要 · 点击后进入密码页（不进编辑）</text>
  <text x="420" y="240" font-size="11" fill="#8b8b8b" font-family="ui-monospace,monospace">m2q7p · 昨天</text>
</svg>
```

### 4.3 移动端

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 920" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="680" height="920" fill="#f3f3f3"/>
  <text x="40" y="36" font-size="14" font-weight="500" fill="#333">主页 · 移动端（&lt;720px）</text>

  <rect x="220" y="56" width="240" height="820" rx="16" fill="#fff" stroke="#d4d4d4"/>
  <rect x="220" y="56" width="240" height="32" rx="16" fill="#e7e7e7"/>
  <text x="236" y="76" font-size="11" fill="#333">* 日记库</text>

  <text x="236" y="120" font-size="11" font-weight="600" fill="#005fb8">云端便笺</text>
  <text x="236" y="148" font-size="18" font-weight="600" fill="#333">你的云端日记库</text>
  <text x="236" y="170" font-size="11" fill="#616161">当前服务 · 共 21 条</text>
  <rect x="236" y="186" width="96" height="36" rx="8" fill="#0e639c"/>
  <text x="254" y="209" font-size="12" font-weight="600" fill="#fff">新建日记</text>
  <rect x="340" y="186" width="88" height="36" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="356" y="209" font-size="12" font-weight="600" fill="#333">编辑首页</text>

  <rect x="236" y="240" width="208" height="32" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="248" y="260" font-size="11" fill="#8b8b8b">搜索…</text>

  <rect x="236" y="284" width="44" height="24" rx="12" fill="#005fb8"/>
  <text x="246" y="300" font-size="11" fill="#fff">全部</text>
  <rect x="288" y="284" width="44" height="24" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <text x="298" y="300" font-size="11" fill="#333">公开</text>
  <rect x="340" y="284" width="44" height="24" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <text x="350" y="300" font-size="11" fill="#333">密码</text>
  <rect x="392" y="284" width="44" height="24" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <text x="402" y="300" font-size="11" fill="#333">私密</text>

  <rect x="236" y="328" width="208" height="100" rx="10" fill="#f8f8f8" stroke="#d4d4d4"/>
  <text x="248" y="350" font-size="11" font-weight="600" fill="#005fb8">首页笔记</text>
  <text x="248" y="370" font-size="11" fill="#616161">_index 仪表盘预览…</text>
  <text x="248" y="398" font-size="11" fill="#333">编辑</text>
  <text x="320" y="398" font-size="11" fill="#333">查看</text>

  <rect x="236" y="448" width="208" height="88" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="248" y="474" font-size="13" font-weight="600" fill="#333">周末徒步笔记</text>
  <text x="248" y="496" font-size="11" fill="#616161">md · 公开 · 2 小时前</text>
  <text x="248" y="516" font-size="11" fill="#8b8b8b">早上七点出发，山里雾很大…</text>

  <rect x="236" y="548" width="208" height="80" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="248" y="574" font-size="13" font-weight="600" fill="#333">会议草稿</text>
  <text x="248" y="596" font-size="11" fill="#7a4d00">密码 · 昨天</text>
  <text x="248" y="614" font-size="11" fill="#8b8b8b">内容受保护</text>

  <text x="280" y="680" font-size="12" fill="#333">加载更多</text>

  <text x="40" y="760" font-size="12" fill="#616161">要点：</text>
  <text x="40" y="782" font-size="12" fill="#333">· 工具条纵向：搜索整宽，筛选横滑或换行</text>
  <text x="40" y="804" font-size="12" fill="#333">· 卡片单列，触控高度 ≥ 44px</text>
  <text x="40" y="826" font-size="12" fill="#333">· 摘要最多 2 行截断；path 可隐藏只留时间</text>
  <text x="40" y="848" font-size="12" fill="#333">· Statusbar 保持现有底部固定</text>
</svg>
```

### 4.4 状态稿：空态 / 加载 / 筛选无结果 / 错误

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 720" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="680" height="720" fill="#f3f3f3"/>
  <text x="40" y="36" font-size="14" font-weight="500" fill="#333">状态稿</text>

  <!-- empty -->
  <rect x="40" y="60" width="290" height="200" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="150" y="100" font-size="12" fill="#8b8b8b" text-anchor="middle">日记列表</text>
  <text x="185" y="140" font-size="14" font-weight="600" fill="#333" text-anchor="middle">服务里还没有日记</text>
  <text x="185" y="164" font-size="12" fill="#616161" text-anchor="middle">点击「新建日记」开始记录</text>
  <rect x="130" y="184" width="110" height="32" rx="8" fill="#0e639c"/>
  <text x="152" y="204" font-size="12" fill="#fff">新建日记</text>
  <text x="40" y="248" font-size="11" fill="#005fb8">空态 · 无任何笔记</text>

  <!-- loading -->
  <rect x="350" y="60" width="290" height="200" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <rect x="370" y="90" width="250" height="72" rx="8" fill="#f3f3f3"/>
  <rect x="386" y="108" width="120" height="10" rx="2" fill="#e7e7e7"/>
  <rect x="386" y="128" width="200" height="8" rx="2" fill="#eee"/>
  <rect x="370" y="174" width="250" height="72" rx="8" fill="#f3f3f3"/>
  <rect x="386" y="192" width="100" height="10" rx="2" fill="#e7e7e7"/>
  <rect x="386" y="212" width="180" height="8" rx="2" fill="#eee"/>
  <text x="350" y="248" font-size="11" fill="#005fb8">加载中 · 骨架屏（statusbar loading 可同步）</text>

  <!-- filter empty -->
  <rect x="40" y="280" width="290" height="180" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="185" y="340" font-size="14" font-weight="600" fill="#333" text-anchor="middle">没有匹配的日记</text>
  <text x="185" y="364" font-size="12" fill="#616161" text-anchor="middle">试试其他关键词或筛选</text>
  <rect x="140" y="388" width="90" height="28" rx="6" fill="#fff" stroke="#d4d4d4"/>
  <text x="162" y="406" font-size="12" fill="#333">清除筛选</text>
  <text x="40" y="448" font-size="11" fill="#005fb8">筛选/搜索无结果</text>

  <!-- error -->
  <rect x="350" y="280" width="290" height="180" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="495" y="340" font-size="14" font-weight="600" fill="#333" text-anchor="middle">列表加载失败</text>
  <text x="495" y="364" font-size="12" fill="#616161" text-anchor="middle">网络或服务异常</text>
  <rect x="450" y="388" width="90" height="28" rx="6" fill="#0e639c"/>
  <text x="478" y="406" font-size="12" fill="#fff">重试</text>
  <text x="350" y="448" font-size="11" fill="#005fb8">错误 · 可重试；同时 toast</text>

  <!-- interaction flow -->
  <text x="40" y="500" font-size="14" font-weight="500" fill="#333">交互流</text>
  <rect x="40" y="520" width="120" height="40" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="70" y="544" font-size="12" fill="#333">打开 /</text>
  <rect x="200" y="520" width="140" height="40" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="220" y="544" font-size="12" fill="#333">GET /api/notes</text>
  <rect x="380" y="520" width="120" height="40" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="400" y="544" font-size="12" fill="#333">渲染列表</text>
  <rect x="540" y="520" width="100" height="40" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="560" y="544" font-size="12" fill="#333">点卡片</text>
  <rect x="200" y="600" width="140" height="40" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="220" y="624" font-size="12" fill="#333">/note/:path</text>
  <rect x="380" y="600" width="160" height="40" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="396" y="624" font-size="12" fill="#333">受保护 → 密码页</text>
  <line x1="160" y1="540" x2="200" y2="540" stroke="#6b7280" stroke-width="1" marker-end="url(#arr2)"/>
  <line x1="340" y1="540" x2="380" y2="540" stroke="#6b7280" stroke-width="1" marker-end="url(#arr2)"/>
  <line x1="500" y1="540" x2="540" y2="540" stroke="#6b7280" stroke-width="1" marker-end="url(#arr2)"/>
  <line x1="590" y1="560" x2="590" y2="600" stroke="#6b7280" stroke-width="1"/>
  <line x1="590" y1="620" x2="540" y2="620" stroke="#6b7280" stroke-width="1" marker-end="url(#arr2)"/>
  <line x1="340" y1="620" x2="380" y2="620" stroke="#6b7280" stroke-width="1" marker-end="url(#arr2)"/>
  <defs>
    <marker id="arr2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6" fill="none" stroke="#6b7280" stroke-width="1"/>
    </marker>
  </defs>
</svg>
```

---

## 5. 交互规格

| 操作 | 行为 |
| --- | --- |
| 进入 `/` | SSR 只出壳；前端 `GET /api/notes`；statusbar `#loading` 短暂显示 |
| 单击卡片 | `location = /note/{path}`（先 decodeURIComponent 安全处理） |
| 受保护卡片 | 同上；由 `view_note` 负责密码页，列表不拦截 |
| 搜索输入 | debounce 300ms；对已拉取页 + 追加页在前端过滤；P0 也可带 `q=` 让服务端过滤 |
| 筛选切换 | 单选 chip；重置到第一页 |
| 加载更多 | `cursor` 请求，追加渲染；无更多则隐藏按钮 |
| 新建 | 沿用现有 `showPrompt` 路径逻辑；成功后跳 `/edit/{path}`，返回主页可见新项 |
| 首页笔记卡 | `_index.content` 非空才显示；不影响列表 |
| 键盘 | 搜索框可 Tab 到列表链接（卡片用 `<a>` 或 role=link） |

### 徽章语义

| 条件 | 徽章 | 摘要 |
| --- | --- | --- |
| `!share` | 私密 | 不展示 |
| `pw.is_some()` | 密码 | 不展示 |
| `share && pw.is_none()` | 公开 | 展示（≤120 字） |
| `path` 为 index | 首页笔记 | 独立卡片，可不进主列表（推荐）或置顶并打「首页」标 |

**P0 推荐**：`_index` **不进入**主列表，只显示钉住卡，避免和日记混在一起。

---

## 6. API 契约（与 UX 对齐）

```http
GET /api/notes?limit=50&cursor=&q=&filter=all
```

```json
{
  "code": 0,
  "data": {
    "total": 21,
    "items": [{
      "path": "ab3kx",
      "title": "周末徒步笔记",
      "excerpt": "早上七点出发…",
      "updateAt": 1710000000,
      "mode": "md",
      "protected": false,
      "shared": true,
      "isIndex": false,
      "hasExcerpt": true
    }],
    "nextCursor": null,
    "hasMore": false
  }
}
```

- `filter`: `all` | `public`（shared && !protected）| `protected`（pw）| `private`（!shared）
- `title` P0：优先 Markdown 首个 `# ` 行，否则 path
- 受保护项：`excerpt=""`, `hasExcerpt=false`

---

## 7. 验收清单（P0 Done Definition）

1. 打开部署站点 `/`，能看到当前 R2 桶内非 index 笔记列表  
2. 列表按更新时间倒序，含模式与权限徽章  
3. 公开笔记有摘要；密码/私密无摘要  
4. 搜索与筛选可用，空态文案正确  
5. 点击条目进入查看页；受保护条目出现密码提示  
6. light/dark 主题下列表可读、无布局错乱  
7. 移动宽度下单列布局可用  
8. `npm run lint`、`npm run typecheck`、相关 e2e 通过  

---

## 8. 后续（非 P0，便于对齐）

- P1：保存时写入 `title`/`excerpt` 元数据，列表零额外 GET  
- P1：列表内复制链接/删除  
- P2：按日期分组时间轴、日历、On This Day  
