# 产品方案：支持子目录的 Markdown 书

> 在 `cloudflare-notepad`（Cloudflare Workers + R2）上，把「扁平便笺」扩展为「可分子目录的 Markdown 书」，同时兼容现有单篇笔记与主页日记列表（见 `docs/p0-home-notes-list.md`）。

---

## 一、市面方案调研

针对「带子目录结构的 Markdown 书 / 文档站」，主流形态如下：

| 范式 | 代表 | 目录来源 | 阅读 UX | 对本项目的启示 |
| --- | --- | --- | --- | --- |
| **文件系统树 + SUMMARY** | GitBook、docsify、HonKit | 仓库目录 + `SUMMARY.md` / `_sidebar.md` / `mkdocs.yml` | 左侧 TOC、面包屑、上一页/下一页、页内大纲 | 书 = 路径前缀；导航元数据可显式声明 |
| **配置驱动导航** | MkDocs、Quarto、VitePress | `nav:` / `_quarto.yml` / 侧边栏配置 | 章节可排序、可隐藏、可嵌套 | 支持「目录顺序 ≠ 字母序」 |
| **知识库 Book/Chapter/Page** | BookStack、Outline、Notion 数据库 | 数据库实体层级 | 书架 → 书 → 章 → 页 | 主页可先按「书」聚合，再进目录 |
| **本地 Vault** | Obsidian、Logseq | 文件夹 + 双链 | 文件夹树 + 关系图 | 子目录即组织单位；链接可跨章 |
| **单文件长文** | 部分 blog/pastebin | 无目录 | 只有滚动 | 本项目现状更接近此，需升级 |

**共性结论（书场景必须具备）**：

1. **树形目录**：至少两级（书 → 章/文件夹 → 页），侧栏或抽屉 TOC。
2. **书入口**：书名、简介、章节数、最近更新；主页从「扁平列表」升级为「书架 + 散篇」。
3. **导航连贯**：面包屑、上一章/下一章、点击 TOC 定位。
4. **索引页约定**：每层目录可有 `README` / `_index` 作为该层首页。
5. **相对链接**：Markdown 内 `./ch2.md`、`../intro` 能解析到系统路径。
6. **权限边界**：整书或章节可锁；进入书后鉴权状态要连续。

---

## 二、当前项目能力与缺口

### 已具备（可直接利用）

| 能力 | 现状 | 对「书」的意义 |
| --- | --- | --- |
| 路由通配 | `/note/*path`、`/edit/*path`、`/api/notes/*path` | **天然可承载** `book/ch01/page` 形式 key |
| 路径清洗 | `clean_path` 去掉前导 `/` | R2 key 可用多段 path |
| Markdown 模式 | `mode=md` + 分栏预览 | 章节正文渲染已有基础 |
| 元数据 | `pw` / `mode` / `updateAt` / `share` | 可挂在任意 path 对象上 |
| 鉴权 | 按 **精确 path** 的 JWT Cookie | 子路径需扩展「继承策略」 |
| 主页计划 | P0 日记列表（扁平） | 书场景要在此之上做聚合 |

### 缺口

1. **无树/前缀列表**：`list()` 只能平铺；没有 `GET /api/tree?prefix=` 或书级聚合。
2. **无「书」实体**：无书名、封面、导航序、是否成书的判定规则。
3. **无目录索引约定**：未定义 `SUMMARY` / `_book` / 目录级 `_index` 的优先级。
4. **链接不改写**：Markdown 相对链接目前按普通 URL，不会映射到 `/note/...`。
5. **列表 UI 扁平**：主页 P0 稿未区分「书 / 章 / 散篇」。
6. **JWT 不继承**：解锁 `book` 不等于解锁 `book/ch01/x`，反之亦然。
7. **新建流仅随机 5 字符或单段自定义 path**，不鼓励 `书/章/页` 结构化创建。

---

## 三、产品定位

**一句话**：在同一 R2 服务内，既可写散篇日记/便笺，也可组织**带子目录的 Markdown 书**；主页像书架，点进书有目录阅读视图。

**目标用户**：私有部署用户——技术笔记、教程、项目手册、读书笔记、个人 Wiki。

**非目标（本期）**：

- 多作者协作与评审流
- 全文搜索引擎（可后续）
- PDF/EPUB 导出（P2 可选）
- 复杂权限矩阵（仅保留「笔记级 + 可选书级」）
- Git 双向同步（可借鉴 GitBook Sync 作远期）

---

## 四、核心信息架构

### 4.1 概念模型

```text
服务（R2 桶）
├── 散篇笔记（无 `/` 或单段 path，且不在书规则内）
│     如：ab3kx、meeting-notes
├── Markdown 书 Book
│     根前缀：my-handbook/
│     ├── _index          ← 书首页（简介、目录摘要）
│     ├── _book           ← 可选：导航元数据（排序、标题、隐藏）
│     ├── intro           ← 第 1 章（同层扁平命名）
│     ├── getting-started/
│     │     ├── _index    ← 该章目录页
│     │     ├── install
│     │     └── config
│     └── advanced/
│           └── deep-dive
└── 首页笔记 _index（站点仪表盘，独立于书）
```

### 4.2 「成书」判定（产品规则）

满足任一条件，前缀 `P` 视为**书根**：

1. 存在对象 `P/_index`（或遗留 `P/_index` 变体），**或**
2. 存在 `P/_book` 元数据对象，**或**
3. 在主页手动将含子路径的笔记「提升为书」（写入 `P/_book`）。

未提升为书的多段 path：主页仍按**扁平列表**展示，只是标题/面包屑显示完整 path。

> 推荐默认：只要出现 `前缀/` 下 ≥2 个对象，主页在「书架」区给出「识别为书 / 忽略」的轻提示（P1）；P0 可仅靠 `_index` / `_book`。

### 4.3 导航元数据 `_book`（可选，JSON 或 YAML 放 body）

```yaml
title: Cloudflare 笔记手册
summary: 私有部署与运维说明
nav:
  - path: intro
    title: 介绍
  - path: getting-started
    title: 快速开始
    children:
      - path: getting-started/install
        title: 安装
      - path: getting-started/config
        title: 配置
  - path: advanced/deep-dive
    title: 深入原理
hidden:
  - path: drafts/scratch
```

无 `_book` 时：**按 path 字母序 + 目录优先**自动建树；标题 = MD 首个 `#` 或 path 末段。

---

## 五、功能方案

### 5.1 主页：书架 + 散篇日记列表

在 P0 日记列表之上扩展：

```text
/ 主页
├─ Hero（新建日记 / 新建书章 / 编辑首页）
├─ 首页笔记卡（_index 钉住，可选）
├─ 书架区 Books
│    卡片：书名 · 章节数 · 最近更新 · 摘要 · [打开目录]
└─ 日记/散篇列表 Notes（沿用 P0）
     搜索 / 筛选 / 加载更多
     默认「折叠」已归入书的子 path，或显示为「来自书：xxx」小标
```

**列表聚合规则（推荐）**：

| path 形态 | 主页展示 |
| --- | --- |
| `ab3kx`、`todo` | 散篇列表 |
| `_index` | 钉住卡 |
| `my-handbook/_index` | **书**卡片入口 |
| `my-handbook/intro` | 归入书，不进散篇（书架数字 +1） |
| `random/a/b`（未成书） | 散篇列表，标题显示 `random / a / b`，可一键「生成 _book 成书」 |

### 5.2 书目录页 `/book/*prefix`

专用阅读入口（比 `/note/my-handbook/_index` 更完整的壳）：

| 区域 | 内容 |
| --- | --- |
| 顶栏 Tab | `* my-handbook` 书名 |
| 左栏 TOC | 树形目录，当前章高亮，可折叠；受保护节点锁图标 |
| 主区 | 书 `_index` 渲染，或选中章内容 |
| 底栏 | 上一章 / 下一章 / 编辑本页 / 分享书链接 |
| 面包屑 | `书名 / 章 / 节` |

也可兼容：直接访问 `/note/my-handbook/intro` 时，若检测到书根，**自动注入侧栏 TOC**（同一阅读壳，减少路由分裂）。

**推荐路由策略（P0）**：

- 不新增必选路由；`/note/*path` 检测书根后渲染「书阅读布局」。
- `/book/*prefix` 作为别名 → 重定向到 `/note/{prefix}/_index` 或书阅读壳（P1 可选）。

### 5.3 阅读与编辑

| 场景 | 行为 |
| --- | --- |
| 阅读章节 | 现有 share 视图 + 书 TOC + prev/next |
| 编辑章节 | 现有 edit；statusbar 显示完整 path `my-handbook/intro` |
| 从 TOC 新建 | 在当前目录下「新建章节」：默认 `{prefix}/{slug}`，mode 建议 `md` |
| 新建子目录章 | prompt 支持 `getting-started/install` |
| 相对链接 | 渲染 MD 时把 `./x`、`../y`、`x/z` 解析为 `/note/{当前目录拼接}` |
| 图片 | P0 仅外链；P1 可用 R2 前缀 `my-handbook/_assets/`（另议） |

### 5.4 目录树 API

```http
GET /api/tree?prefix=my-handbook
GET /api/books
```

`GET /api/tree` 响应示例：

```json
{
  "code": 0,
  "data": {
    "prefix": "my-handbook",
    "book": {
      "title": "Cloudflare 笔记手册",
      "summary": "...",
      "updatedAt": 1710000000,
      "protected": false,
      "chapterCount": 7
    },
    "nodes": [{
      "name": "intro",
      "path": "my-handbook/intro",
      "type": "page",
      "title": "介绍",
      "mode": "md",
      "protected": false,
      "shared": true,
      "updatedAt": 1710000000,
      "children": []
    }, {
      "name": "getting-started",
      "path": "my-handbook/getting-started",
      "type": "dir",
      "title": "快速开始",
      "children": [ ... ]
    }],
    "order": "meta"
  }
}
```

`GET /api/books`：仅返回成书列表（书名、前缀、计数、时间），供主页书架。

**实现要点**：

- R2 `list(prefix=my-handbook/)` 一次拉书内对象。
- 前缀过滤；组装树；应用 `_book` 排序与 title。
- 受保护节点：`type/title/path/protected` 保留，**不返回** content/excerpt。

### 5.5 权限与继承（书场景关键）

现有 JWT 是 `path` 精确匹配。书需要策略：

| 策略 | 行为 | 建议 |
| --- | --- | --- |
| **A. 精确 path（现状）** | 每章单独密码 | 不改后端，体验碎 |
| **B. 前缀继承（推荐）** | Cookie JWT claims 增加 `scope`：`exact` 或 `prefix`；书首页鉴权成功则签发 `prefix=my-handbook/` 的 token，可读该前缀下未单独设密的章节 | P0 书体验采用 |
| **C. 单独设密覆盖** | 章节 `pw` 仍优先，需再鉴权该章 | 与 B 叠加 |

**推荐规则**：

1. 书根 `_book`/`_index` 无密码 → 全书按章节自身 `pw`/`share`。
2. 书根设有密码 → 访问书内任意页：无 prefix token 则先跳书首页密码；成功后发 prefix token（Max-Age 与现网一致 7 天）。
3. 章节再设密码 → 覆盖，仍需该章 token（exact）。
4. `share=false` 的章节：与现网一致，未授权不进列表摘要。

JWT 扩展（兼容）：

```json
{ "path": "my-handbook", "scope": "prefix", "exp": 1710600000 }
```

旧 token（无 scope）继续当 exact 使用。

### 5.6 创建与迁移

| 动作 | 交互 |
| --- | --- |
| 新建散篇 | 现状 `/new` / prompt 路径 |
| 新建书 | prompt：书目录名（slug）→ 创建 `{slug}/_index` + 可选 `_book` 模板 → 跳编辑 |
| 新建章节 | 书 TOC「+」→ `{book}/{path}`，默认 mode=md |
| 提升为书 | 对含 `/` 的笔记：「以所在目录成书」写 `_book` |
| 导入文件夹（P1） | 支持一次 PUT 多 key（脚本或拖拽 zip），映射目录树 |
| 导出（P2） | 按前缀打包 Markdown zip（Worker 限流下可后台/客户端拼） |

### 5.7 搜索

| 阶段 | 行为 |
| --- | --- |
| P0 | 主页搜索仍覆盖 path/标题/摘要；结果项带「书名」 |
| P1 | 书内搜索：`GET /api/tree` 后前端过滤 title；或 `GET /api/notes?q=&prefix=` |
| P2 | 全文索引（D1 / Vectorize / 构建期索引），超出当前轻量定位 |

---

## 六、UI/UX 稿（书场景）

### 6.1 主页：书架 + 散篇

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 920" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="680" height="920" fill="#f3f3f3"/>
  <text x="40" y="32" font-size="14" font-weight="500" fill="#333">主页 · 书架 + 散篇日记</text>
  <rect x="40" y="52" width="600" height="820" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <rect x="40" y="52" width="600" height="38" fill="#e7e7e7"/>
  <rect x="56" y="60" width="72" height="22" rx="4" fill="#fff" stroke="#d4d4d4"/>
  <text x="66" y="75" font-size="12" fill="#333">* 首页</text>

  <text x="68" y="120" font-size="22" font-weight="600" fill="#333">云端日记库</text>
  <text x="68" y="144" font-size="12" fill="#616161">书与散篇都在当前服务下</text>
  <rect x="68" y="160" width="100" height="34" rx="8" fill="#0e639c"/>
  <text x="86" y="182" font-size="12" fill="#fff">新建日记</text>
  <rect x="178" y="160" width="100" height="34" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="196" y="182" font-size="12" fill="#333">新建书</text>
  <rect x="288" y="160" width="100" height="34" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="306" y="182" font-size="12" fill="#333">编辑首页</text>

  <!-- books -->
  <text x="68" y="230" font-size="14" font-weight="600" fill="#333">书架</text>
  <text x="112" y="230" font-size="12" fill="#8b8b8b">2 本</text>
  <rect x="68" y="246" width="260" height="120" rx="10" fill="#f8f8f8" stroke="#d4d4d4"/>
  <text x="84" y="274" font-size="14" font-weight="600" fill="#333">Cloudflare 笔记手册</text>
  <text x="84" y="298" font-size="12" fill="#616161">私有部署与运维说明 · 7 章</text>
  <text x="84" y="322" font-size="11" fill="#8b8b8b" font-family="ui-monospace,monospace">my-handbook/</text>
  <rect x="84" y="336" width="72" height="22" rx="6" fill="#005fb8"/>
  <text x="98" y="351" font-size="11" fill="#fff">打开目录</text>
  <text x="250" y="351" font-size="11" fill="#8b8b8b">2 小时前</text>

  <rect x="348" y="246" width="260" height="120" rx="10" fill="#f8f8f8" stroke="#d4d4d4"/>
  <text x="364" y="274" font-size="14" font-weight="600" fill="#333">读书笔记：设计模式</text>
  <text x="364" y="298" font-size="12" fill="#616161">按章节摘录 · 12 章</text>
  <text x="364" y="322" font-size="11" fill="#8b8b8b" font-family="ui-monospace,monospace">design-patterns/</text>
  <rect x="364" y="336" width="72" height="22" rx="6" fill="#005fb8"/>
  <text x="378" y="351" font-size="11" fill="#fff">打开目录</text>
  <text x="530" y="351" font-size="11" fill="#8b8b8b">昨天</text>

  <!-- notes -->
  <text x="68" y="404" font-size="14" font-weight="600" fill="#333">日记 / 散篇</text>
  <text x="160" y="404" font-size="12" fill="#8b8b8b">共 14 条</text>
  <rect x="360" y="388" width="248" height="30" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="372" y="407" font-size="12" fill="#8b8b8b">搜索…</text>
  <rect x="68" y="424" width="44" height="24" rx="12" fill="#005fb8"/>
  <text x="78" y="440" font-size="11" fill="#fff">全部</text>
  <rect x="120" y="424" width="44" height="24" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <text x="130" y="440" font-size="11" fill="#333">公开</text>
  <rect x="172" y="424" width="44" height="24" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <text x="182" y="440" font-size="11" fill="#333">密码</text>
  <rect x="224" y="424" width="44" height="24" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <text x="234" y="440" font-size="11" fill="#333">私密</text>

  <rect x="68" y="464" width="540" height="84" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="84" y="490" font-size="13" font-weight="600" fill="#333">周末徒步笔记</text>
  <rect x="200" y="478" width="36" height="16" rx="3" fill="rgba(0,95,184,0.1)"/>
  <text x="208" y="490" font-size="10" fill="#005fb8">md</text>
  <text x="84" y="514" font-size="12" fill="#616161">早上七点出发…</text>
  <text x="84" y="534" font-size="11" fill="#8b8b8b" font-family="ui-monospace,monospace">ab3kx</text>

  <rect x="68" y="560" width="540" height="76" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="84" y="586" font-size="13" font-weight="600" fill="#333">会议草稿</text>
  <rect x="168" y="574" width="40" height="16" rx="3" fill="#fff4ce"/>
  <text x="176" y="586" font-size="10" fill="#7a4d00">密码</text>
  <text x="84" y="610" font-size="12" fill="#8b8b8b">内容受保护</text>
  <text x="400" y="610" font-size="11" fill="#8b8b8b">m2q7p · 昨天</text>

  <rect x="68" y="648" width="540" height="76" rx="10" fill="#fff" stroke="#d4d4d4" stroke-dasharray="4 3"/>
  <text x="84" y="674" font-size="13" font-weight="600" fill="#616161">drafts/wip-article</text>
  <rect x="220" y="662" width="64" height="16" rx="3" fill="#f3f3f3" stroke="#d4d4d4"/>
  <text x="226" y="674" font-size="10" fill="#616161">未成书路径</text>
  <text x="84" y="698" font-size="12" fill="#8b8b8b">含子目录，可「生成书」纳入书架</text>
  <text x="420" y="698" font-size="11" fill="#005fb8">生成书</text>
</svg>
```

### 6.2 书阅读页（TOC + 章节）

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 860" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="680" height="860" fill="#f3f3f3"/>
  <text x="40" y="32" font-size="14" font-weight="500" fill="#333">书阅读页 /note/my-handbook/intro（自动注入 TOC）</text>
  <rect x="40" y="52" width="600" height="760" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <rect x="40" y="52" width="600" height="36" fill="#e7e7e7"/>
  <rect x="56" y="60" width="160" height="20" rx="4" fill="#fff" stroke="#d4d4d4"/>
  <text x="66" y="74" font-size="11" fill="#333">* Cloudflare 笔记手册</text>
  <text x="240" y="74" font-size="11" fill="#616161">my-handbook / intro</text>

  <!-- sidebar toc -->
  <rect x="40" y="88" width="180" height="724" fill="#f8f8f8" stroke="#d4d4d4"/>
  <text x="56" y="114" font-size="12" font-weight="600" fill="#333">目录</text>
  <text x="56" y="140" font-size="12" fill="#005fb8">▸ 介绍</text>
  <text x="56" y="164" font-size="12" fill="#333">▾ 快速开始</text>
  <text x="72" y="186" font-size="12" fill="#333">· 安装</text>
  <text x="72" y="208" font-size="12" fill="#333">· 配置</text>
  <text x="56" y="232" font-size="12" fill="#333">▸ 深入原理</text>
  <text x="140" y="232" font-size="11" fill="#7a4d00">🔒</text>
  <text x="56" y="256" font-size="12" fill="#333">▸ 附录</text>
  <text x="56" y="290" font-size="11" fill="#8b8b8b">+ 在本目录新建章节</text>

  <!-- main -->
  <text x="248" y="130" font-size="20" font-weight="600" fill="#333">介绍</text>
  <text x="248" y="156" font-size="12" fill="#8b8b8b">md · 公开 · 更新于 2 小时前</text>
  <text x="248" y="190" font-size="13" fill="#333">这本手册记录私有部署 Cloudflare Notepad 的步骤，</text>
  <text x="248" y="212" font-size="13" fill="#333">包含环境变量、R2 迁移与权限模型。</text>
  <text x="248" y="250" font-size="13" fill="#005fb8">参见：快速开始 / 安装（相对链接已映射）</text>
  <rect x="248" y="720" width="80" height="32" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="264" y="740" font-size="12" fill="#333">← 上一章</text>
  <rect x="340" y="720" width="80" height="32" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="356" y="740" font-size="12" fill="#333">下一章 →</text>
  <rect x="432" y="720" width="64" height="32" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="448" y="740" font-size="12" fill="#333">编辑</text>
</svg>
```

### 6.3 目录树数据流

```mermaid
flowchart LR
  Home["主页书架"] -->|"打开目录"| Note["/note/{book}/_index 或章节"]
  Note --> Tree["GET /api/tree?prefix=book"]
  Tree --> Side["侧栏 TOC 渲染"]
  Side -->|点击节点| Page["/note/{path}"]
  Page --> Auth{"该 path/prefix 鉴权?"}
  Auth -->|否| Pw["密码页"]
  Auth -->|是| Read["阅读/编辑"]
  Read -->|"prev/next"| Page
```

---

## 七、API 契约汇总

| 接口 | 用途 |
| --- | --- |
| `GET /api/books` | 主页书架列表 |
| `GET /api/tree?prefix=` | 某书目录树（含 `_book` 排序） |
| `GET /api/notes?prefix=&type=book\|note` | 列表过滤（P0 列表扩展） |
| `POST /api/auth` body `{path, password}` | 成功时若 path 为书根且书有密码 → 额外 `Set-Cookie` prefix scope |
| 现有 CRUD | 不变；key 仍为完整 path |

列表项增加字段（兼容）：

```json
{
  "path": "my-handbook/intro",
  "bookPrefix": "my-handbook",
  "bookTitle": "Cloudflare 笔记手册",
  "depth": 1,
  "inBook": true
}
```

---

## 八、鉴权与隐私（书）

```text
访问 my-handbook/getting-started/install
  → 若 install.pw 存在：需要 exact token（该页）
  → 否则若书根有 pw：需要 prefix token（书）
  → 否则按 share/pw 常规
  → 列表/TOC：可显示标题；无授权不显示摘要
```

站点级 `SCN_INDEX_PASSWD` 仍只管 `_index` 首页笔记，**不**自动成为书密码（避免误伤）；书密码通过书根笔记的密码按钮设置。

---

## 九、与主页日记列表（P0）的关系

| P0 列表 | 书扩展 |
| --- | --- |
| 扁平 `items[]` | 增加 `inBook`/`bookPrefix`；书内页默认不淹没散篇区 |
| 搜索 | 命中书章节时展示「书名 / 章节」 |
| 筛选 | 保持 public/protected/private；可增 filter=`books` |
| 新建 | 增加「新建书」「书内新建章节」 |
| 技术依赖 | 树/书架依赖同一 `list_notes` 能力 + `prefix` 参数 |

**实施顺序建议**：先落地 P0 扁平列表 API（list + `/api/notes`），再在同一服务层加 `prefix` 与树构建，避免两套 list。

---

## 十、路线图

### Book-P0（最小可用书）

1. path 规范：创建支持 `a/b/c`；校验禁止 `..`、空段、保留字冲突  
2. `_index` 约定：存在即书根  
3. `GET /api/tree?prefix=` 自动树（字母序，目录优先）  
4. `/note/*path` 检测书根 → 注入 TOC 布局（模板 + 前端）  
5. prev/next（按树 DFS 序）  
6. 主页书架区：有书则显示卡片，散篇列表折叠书内 path  
7. JWT `scope=prefix` 继承（书根设密时）  
8. e2e：多级 path 读写、TOC 导航、书密码一次解锁多章（无单独 pw 时）

### Book-P1

1. `_book` 元数据：title/nav/hidden  
2. 相对链接改写  
3. TOC 内新建/重命名/删除章节（删除确认）  
4. 「未成书」提示与一键生成 `_book`  
5. 主页搜索 `prefix`  
6. 目录级空 `dir` 占位对象（若需要显式空文件夹）

### Book-P2

1. 页内大纲（H2/H3）  
2. 导入文件夹 / 导出 zip  
3. 阅读进度、上次读到  
4. 全书统一主题/封面  
5. 只读公开书分享链接（book-level share）

---

## 十一、风险与边界

| 风险 | 应对 |
| --- | --- |
| R2 无真文件夹，仅 key 前缀 | 产品层用 `_index`/`_book` 定义书；树由 list 组装 |
| 大书 list 成本 | prefix list；P1 可缓存 `_book` 与树 JSON 对象 |
| JWT 前缀过宽 | prefix 仅授予书根成功鉴权；章节独立 pw 仍 exact；exp 相同 7 天 |
| path 冲突（`foo` 笔记与 `foo/` 书） | 约定：若存在 `foo/` 下任意 key，则 `foo` 仅能作为书根/保留；UI 提示改名 |
| 相对链接安全 | 只映射到 `/note/` 与站内；禁止 `javascript:` |
| 与无登录分享定位张力 | 书默认仍可公开；密码书不暴露章节正文 |
| Worker CPU/时长 | 树构建纯内存字符串操作；避免对每章 GET body（P0） |

---

## 十二、建议结论

1. **存储**：继续用 R2 key 天然层级 `book/chapter/page`，不引入独立数据库表。  
2. **成书信号**：`前缀/_index`（必）+ 可选 `_book` 导航元数据。  
3. **主页**：书架卡片 + 散篇日记列表双区，与已定 P0 列表方案兼容。  
4. **阅读**：`/note/*path` 注入 TOC，避免再维护一套并行路由。  
5. **鉴权**：书根密码 → prefix JWT；章节密码仍 exact。  
6. **实施**：在 P0 扁平列表之上加 `prefix`/tree，Book-P0 即可读完整本子目录 Markdown 书。

---

## 十三、待你确认的产品口径

1. 未成书的多段 path：进散篇列表，还是强制显示为「文件夹」？  
2. 书内章节是否默认出现在主页散篇搜索结果里？  
3. 书根设密是否默认解锁全书（推荐是，章节可再锁）？  
4. 目录排序：P0 字母序是否够用，还是必须上 `_book.nav`？
