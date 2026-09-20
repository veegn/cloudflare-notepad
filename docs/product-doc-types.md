# 产品重设计：文章 / 书籍 / 书籍分页（修订版）

> **本版变更**
>
> 1. **创建时只提供两种文档选项：文章 / 书籍**（不再在全局新建里选「分页」）。
> 2. **分页的增删改查在「编辑书籍」时完成**：书籍编辑器是分页的管理入口。
> 3. 系统内仍存在第三种运行时类型 `page`，由书籍编辑流程创建，不在全局创建对话框出现。

关联：`docs/p0-home-notes-list.md`（主页列表）。本文覆盖早期路径推断方案与「创建三类」方案。

---

## 1. 设计原则

| # | 原则 | 含义 |
| --- | --- | --- |
| 1 | **创建极简** | 全局「新建」只有 **文章** 与 **书籍**；用户不必在创建时理解「分页」。 |
| 2 | **类型显式** | `docType` 在创建时写入；分页类型仅在书籍管理流中产生。 |
| 3 | **文章零回归** | `article`（及无类型存量）与当前单篇笔记功能一致。 |
| 4 | **书籍 = 目录 + 管理台** | 书籍正文是分页索引；**编辑书籍时**对分页做增删改查。 |
| 5 | **分页从属书籍** | 分页带 `bookRef`；查看书籍/分页时左侧展示该书目录。 |

---

## 2. 文档类型模型

### 2.1 三类角色（创建入口不同）

| 类型 | `docType` | 如何产生 | 正文 | 查看 UI |
| --- | --- | --- | --- | --- |
| **文章** | `article` | **全局创建**可选 | 单篇笔记正文 | 无左侧目录（同现状） |
| **书籍** | `book` | **全局创建**可选 | 分页目录（索引导航） | 左侧 TOC + 右侧目录正文 |
| **书籍分页** | `page` | **仅在编辑书籍时**创建 | 该页具体内容 | 左侧 TOC（高亮当前页）+ 本页正文 |

```text
全局创建 ──► 文章 article
         └─► 书籍 book ──编辑书籍──► 分页 page（增 / 删 / 改 / 查）
                      ▲ bookRef      │
                      └──────────────┘
```

### 2.2 元数据（R2 `custom_metadata`）

| 键 | 值 | 说明 |
| --- | --- | --- |
| `docType` | `article` \| `book` \| `page` | 创建时写入；**缺省 = `article`**（兼容存量） |
| `bookRef` | 书籍 path | `page` 必填；`book`/`article` 不写 |
| `title` | 字符串 | 可选；列表与 TOC 显示名 |

```json
// 书籍示例
{ "mode": "md", "docType": "book", "updateAt": 1710000000, "title": "Cloudflare 笔记手册" }

// 分页示例
{ "mode": "md", "docType": "page", "bookRef": "handbook", "title": "安装步骤", "updateAt": 1710000000 }

// 文章示例（与现状兼容）
{ "mode": "md", "updateAt": 1710000000 }
```

### 2.3 约束

- 书籍 `path` 全局唯一；分页 `path` 全局唯一，推荐 `{book}/{slug}`。
- 分页 `bookRef` 必须指向 `docType=book` 的文档。
- **全局创建 API 不接受 `docType=page`**（400）；分页只能走书籍管理 API。
- 书籍目录 Markdown 中的链接 path 与分页 path 一致；允许死链（标灰）。

---

## 3. 创建流程（仅两类）

### 3.1 现状问题

- 「新建」只有 path prompt（空则随机 5 字符），无类型。
- 若曾把「分页」放进全局创建：用户需先选书、理解三层概念，创建流过重。
- 分页没有稳定的归属与目录回写，散落在库中。

### 3.2 目标流程（本版）

```text
点击「新建文档」
  → 对话框仅两选项：【文章】|【书籍】
      文章：path（可选，空=随机）+ 标题（可选）
      书籍：书 path（必填 slug）+ 书名（必填）+ 简介（可选）
  → POST /api/docs
  → 跳转 /edit/{path}
      文章 → 普通编辑器（无 TOC）
      书籍 → 书籍编辑器（左侧分页管理，见 §4）
```

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 360" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="680" height="360" fill="#f3f3f3"/>
  <text x="40" y="28" font-size="14" font-weight="500" fill="#333">全局创建 · 仅两类</text>
  <rect x="40" y="48" width="600" height="280" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <text x="64" y="84" font-size="16" font-weight="600" fill="#333">新建文档</text>
  <rect x="64" y="104" width="200" height="72" rx="10" fill="#0e639c"/>
  <text x="120" y="136" font-size="14" font-weight="600" fill="#fff">文章</text>
  <text x="100" y="158" font-size="11" fill="#dce9f5">单篇笔记 · 同现状</text>
  <rect x="284" y="104" width="200" height="72" rx="10" fill="#fff" stroke="#d4d4d4"/>
  <text x="348" y="136" font-size="14" font-weight="600" fill="#333">书籍</text>
  <text x="320" y="158" font-size="11" fill="#616161">目录 + 分页管理入口</text>
  <text x="64" y="220" font-size="12" fill="#616161">此处不提供「分页」选项。</text>
  <text x="64" y="244" font-size="12" fill="#333">分页在「编辑书籍」时增删改查（§4）。</text>
  <text x="64" y="280" font-size="12" fill="#8b8b8b">创建书籍 → 进入书籍编辑器 → 「+ 新建分页」等操作在此完成</text>
</svg>
```

### 3.3 对话框字段

| 选项 | 字段 | 创建结果 |
| --- | --- | --- |
| **文章** | path 可选（空 → `gen_random_path`）；标题可选 | `docType=article`，正文空；跳 `/edit/{path}` |
| **书籍** | path 必填（slug，如 `handbook`）；书名必填；简介可选 | `docType=book`，`mode=md`，正文=目录模板；跳 `/edit/{path}`（书籍编辑器） |

### 3.4 创建 API

```http
POST /api/docs
Content-Type: application/json

{ "docType": "article" | "book", "path": "...", "title": "...", "summary": "..." }
```

| 校验 | 规则 |
| --- | --- |
| `docType` | 仅 `article` \| `book`；`page` → **400**，提示「请在编辑书籍时新建分页」 |
| `path` | 合法字符；书籍 path 建议 `[a-z0-9-_]+`；重复 → 409 |
| `title` | 书籍必填；文章可选 |

响应：`{ code, data: { path, docType, editUrl } }`

**`GET /new` 兼容**：重定向主页并打开创建对话框；或 `GET /new?type=article` 直接走旧随机文章逻辑（便于脚本/e2e）。

### 3.5 新建书籍默认正文

```markdown
# {书名}

> {简介或：在这里写一句话简介。}

## 目录

<!-- 在「编辑书籍」中新建分页后，目录链接会自动出现 -->
```

### 3.6 类型变更

| 变更 | 策略 |
| --- | --- |
| 文章 ↔ 书籍 | P0 不提供自动转换（创建时定型） |
| 分页 → 文章 | P1：在书籍管理中「移出本书」清 `bookRef` |
| 分页换书 | P1：更新 `bookRef` + 同步两书目录 |

---

## 4. 编辑书籍：分页增删改查（核心）

> **分页不在全局创建出现；一切分页管理挂在书籍编辑态。**

### 4.1 入口

| 入口 | 行为 |
| --- | --- |
| 主页书籍卡片 →「打开/编辑书籍」 | `/edit/{bookPath}` |
| 书籍查看页 →「编辑」 | 同上 |
| 列表中 `docType=book` 项 | 进入书籍查看/编辑 |

进入 `/edit/{book}` 且 `docType=book` → **书籍编辑器布局**（非文章编辑器）。

### 4.2 布局

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 480" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="680" height="480" fill="#f3f3f3"/>
  <text x="40" y="28" font-size="14" font-weight="500" fill="#333">书籍编辑器 /edit/{book} · 分页 CRUD</text>
  <rect x="40" y="48" width="600" height="400" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <rect x="40" y="48" width="600" height="32" fill="#e7e7e7"/>
  <text x="56" y="68" font-size="11" fill="#333">* handbook · 书籍 · 编辑中</text>

  <!-- left panel: page manager -->
  <rect x="40" y="80" width="200" height="368" fill="#f0f4f8" stroke="#d4d4d4"/>
  <text x="56" y="106" font-size="12" font-weight="600" fill="#333">分页管理</text>
  <rect x="56" y="118" width="168" height="28" rx="6" fill="#005fb8"/>
  <text x="78" y="136" font-size="12" fill="#fff">+ 新建分页</text>
  <rect x="56" y="156" width="168" height="26" rx="6" fill="#fff" stroke="#d4d4d4"/>
  <text x="66" y="173" font-size="11" fill="#8b8b8b">搜索分页…</text>

  <text x="66" y="204" font-size="12" fill="#333">介绍</text>
  <text x="190" y="204" font-size="10" fill="#005fb8">编辑</text>
  <text x="66" y="228" font-size="12" fill="#005fb8">安装 ←</text>
  <text x="190" y="228" font-size="10" fill="#7a4d00">删除</text>
  <text x="66" y="252" font-size="12" fill="#333">配置</text>
  <text x="190" y="252" font-size="10" fill="#005fb8">编辑</text>
  <text x="66" y="280" font-size="11" fill="#8b8b8b">支持重命名 / 上移下移</text>
  <text x="66" y="304" font-size="11" fill="#8b8b8b">列表 = 目录解析结果</text>

  <!-- right: book toc markdown editor -->
  <text x="260" y="108" font-size="12" font-weight="600" fill="#333">书籍正文（目录）</text>
  <rect x="260" y="120" width="360" height="240" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="276" y="148" font-size="12" fill="#333"># Cloudflare 笔记手册</text>
  <text x="276" y="172" font-size="12" fill="#616161">&gt; 私有部署与运维说明。</text>
  <text x="276" y="196" font-size="12" fill="#616161">## 目录</text>
  <text x="276" y="224" font-size="12" fill="#005fb8">- [介绍](handbook/intro)</text>
  <text x="276" y="248" font-size="12" fill="#005fb8">- [安装](handbook/install)</text>
  <text x="276" y="272" font-size="12" fill="#005fb8">- [配置](handbook/config)</text>
  <text x="276" y="320" font-size="11" fill="#8b8b8b">分页操作会同步维护此处链接</text>
  <text x="260" y="392" font-size="12" fill="#616161">也可直接改 Markdown 目录（高级）</text>
</svg>
```

| 区域 | 内容 |
| --- | --- |
| **左：分页管理面板** | 列表（来自 TOC + R2 校验）；搜索；每项操作：打开/编辑、重命名、删除；顶部「+ 新建分页」 |
| **右：书籍正文** | 目录 Markdown 编辑（与现状编辑器一致：mode、格式化、自动保存） |
| **Statusbar** | 现有编辑按钮 + 徽章「书籍」+ 保存指示 |

说明：**编辑书籍时的「左侧」= 分页管理面板**；**查看书籍/分页时的「左侧」= 只读 TOC 导航**。两者数据同源（书籍目录），交互密度不同。

### 4.3 分页操作规格

#### 查（Read）

| 操作 | 交互 |
| --- | --- |
| 列表 | 展示标题、path、是否已创建（死链标灰）、更新时间（有则） |
| 搜索 | 按标题/path 子串过滤（前端） |
| 打开 | 跳转 `/note/{pagePath}` 或 `/edit/{pagePath}`（分页编辑，仍带 TOC） |
| 排序 | 与书籍目录顺序一致；可显示序号 |

#### 增（Create）

```text
书籍编辑器 → 「+ 新建分页」
  → 小对话框：标题（必填）、path（默认 {book}/{slug}，可改）
  → POST /api/books/{book}/pages
      body: { title, path? }
  → 服务端：
      1) 校验 book 存在且 docType=book
      2) 创建 page：docType=page, bookRef=book, mode=md, title
      3) 正文模板：# {title}\n\n
      4) 在书籍正文中「## 目录」下追加 - [title](path)（若无同 path 链接）
  → 返回 { path, editUrl }
  → UI：刷新分页列表；可选「继续编辑该页」→ /edit/{path}
```

- path 冲突 → 409，提示修改。
- 用户也可在书籍正文手写链接再点「识别为分页」→ 若 R2 无对象则补建（P1）；P0 以 API 创建为准，死链只读。

#### 改（Update）

| 操作 | 行为 | API |
| --- | --- | --- |
| **编辑正文** | 跳转分页编辑页（左侧只读 TOC） | 现有 `PUT /api/notes/{page}` |
| **重命名（改标题）** | 对话框改 `title`；同步书籍目录中链接文字 | `PATCH /api/notes/{page}` `{ title }` + 改写书籍正文对应链接 |
| **改 path（P1）** | 迁移 R2 key + 更新 `bookRef` 不变 + 目录链接 path | 新 `POST /api/books/{book}/pages/{path}/move` |
| **改层级/顺序** | 上移/下移或拖拽 → 重写目录列表顺序 | `PATCH /api/books/{book}/toc` `{ items: [{title,path,depth}] }` 或改写书籍 `PUT` |
| **改书籍目录 MD** | 右侧直接编辑书籍正文（高级用户） | 现有 `PUT /api/notes/{book}` |

P0 顺序操作：至少提供 **上移 / 下移**；拖拽与任意 depth 编辑可 P1。

**同步策略（P0 推荐）**

- 以「分页操作」驱动时：服务端原子更新 `page` 元数据 + 重写 `book` 正文中对应链接行。
- 用户手改书籍 Markdown：不强制立刻反写 page；保存书籍时前端可提示「目录与分页不一致」。

#### 删（Delete）

```text
分页列表 → 「删除」
  → 确认框：标题 + path +「将删除分页正文，并从书籍目录移除链接」
  → 选项：☐ 同时从目录移除链接（默认勾选）
  → DELETE /api/notes/{pagePath}   // 现有能力，清空 content 即删
  → 若勾选：PATCH 书籍正文，删除对应 - [..](path) 行
  → 刷新列表
```

- 只删链接不删对象：P1「从目录移除」。
- 只删对象保留死链：提供「不移除链接」选项时可能出现；死链 UI 可「删除死链项」。

### 4.4 书籍管理 API（分页 CRUD）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/books/{book}/pages` | 列出分页：path/title/updateAt/exists + 可选 toc 顺序 |
| `POST` | `/api/books/{book}/pages` | 新建分页 `{ title, path? }`，写 `docType=page`+`bookRef`，并更新书籍目录 |
| `PATCH` | `/api/books/{book}/pages` | 批量更新目录顺序/标题 `{ items: [...] }`（重写 TOC 链接） |
| `DELETE` | `/api/notes/{page}` | 删除分页对象（现有）；query `?syncBook=1` 时同时从书目录摘链接 |
| `GET` | `/api/toc?book={book}` | 查看/编辑共用：解析书籍正文 → TOC（含 exists/docType） |
| `POST` | `/api/docs` | **仅** article/book（全局创建） |

`POST /api/books/{book}/pages` 响应：

```json
{
  "code": 0,
  "data": {
    "path": "handbook/install",
    "title": "安装步骤",
    "docType": "page",
    "bookRef": "handbook",
    "editUrl": "/edit/handbook/install",
    "tocUpdated": true
  }
}
```

### 4.5 分页编辑页（从书籍进入后）

- URL：`/edit/{pagePath}`，`docType=page`
- 左侧：**只读 TOC**（同书，当前高亮）+ 顶部链接「返回书籍编辑」
- 右侧：分页正文编辑（现状能力全开）
- 不在分页编辑页做删除/新建（避免上下文分裂）；删除回书籍编辑器，或 statusbar 提供「书籍管理」返回

### 4.6 查看态（非编辑）

| docType | 左侧 | 右侧 |
| --- | --- | --- |
| `article` | 无 | 同现状 |
| `book` | 只读 TOC（可点） | 书籍目录渲染 |
| `page` | 只读 TOC，当前高亮 | 分页正文 |

查看书籍时可显示次要入口「编辑书籍（管理分页）」→ `/edit/{book}`。

---

## 5. 目录数据源

| 来源 | 用途 |
| --- | --- |
| 书籍 Markdown 正文 | TOC **权威顺序与标题**；查看导航、上下页 |
| R2 `docType=page && bookRef=` | 校验 exists、pageCount、管理列表补充元数据 |

解析规则（不变）：Markdown 链接 → path；列表嵌套 → 层级；`#`/`##` 无链接 → 分组标签。

**P0 同步**：

- 创建/重命名/删除/排序（经管理 API）→ 服务端改写书籍正文目录。
- 手改书籍 MD → 按 MD 为准展示；管理列表刷新后与 R2 对账显示死链。

---

## 6. 主页与列表

> 主页列表最新方案见 **`docs/product-home-books-articles.md`**（**树形目录列表**：目录可展开、区分书籍/文章、分页不展示）。下文仅为早期双区摘要，以树形方案为准。

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 400" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="680" height="400" fill="#f3f3f3"/>
  <text x="40" y="28" font-size="14" font-weight="500" fill="#333">主页 · 创建两类，分页挂在书下</text>
  <rect x="40" y="48" width="600" height="320" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <text x="64" y="84" font-size="16" font-weight="600" fill="#333">云端文档库</text>
  <rect x="64" y="100" width="88" height="32" rx="8" fill="#0e639c"/>
  <text x="82" y="120" font-size="12" fill="#fff">新建文档</text>
  <text x="164" y="120" font-size="12" fill="#616161">对话框：文章 | 书籍（无分页）</text>

  <text x="64" y="164" font-size="13" font-weight="600" fill="#333">书籍</text>
  <rect x="64" y="176" width="280" height="96" rx="10" fill="#f8f8f8" stroke="#d4d4d4"/>
  <text x="80" y="202" font-size="13" font-weight="600" fill="#333">Cloudflare 笔记手册</text>
  <rect x="230" y="188" width="36" height="16" rx="3" fill="rgba(0,95,184,0.1)"/>
  <text x="236" y="200" font-size="10" fill="#005fb8">书籍</text>
  <text x="80" y="226" font-size="12" fill="#616161">6 个分页</text>
  <text x="80" y="252" font-size="11" fill="#005fb8">查看</text>
  <text x="130" y="252" font-size="11" fill="#005fb8">编辑书籍（管理分页）</text>

  <text x="64" y="308" font-size="13" font-weight="600" fill="#333">列表筛选</text>
  <text x="64" y="332" font-size="12" fill="#616161">全部 | 文章 | 书籍 | 分页 · 分页项标注所属书</text>
  <text x="64" y="356" font-size="12" fill="#616161">分页不在「新建」中出现，但会出现在服务文档列表中</text>
</svg>
```

- 书籍卡片操作：**查看** / **编辑书籍（管理分页）**
- 分页仍会出现在服务列表（可搜索、可筛选），方便直达；但**创建入口只在书籍编辑器**
- 徽章：`文章` | `书籍` | `分页`

---

## 7. UI 稿：创建对话框（修订）

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 400" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="680" height="400" fill="#f3f3f3"/>
  <text x="40" y="28" font-size="14" font-weight="500" fill="#333">新建文档 · 文章 / 书籍</text>
  <rect x="140" y="48" width="400" height="320" rx="12" fill="#fff" stroke="#d4d4d4"/>
  <text x="164" y="80" font-size="16" font-weight="600" fill="#333">新建文档</text>
  <rect x="164" y="100" width="160" height="40" rx="8" fill="#005fb8"/>
  <text x="210" y="124" font-size="13" fill="#fff">文章</text>
  <rect x="340" y="100" width="160" height="40" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="392" y="124" font-size="13" fill="#333">书籍</text>

  <text x="164" y="172" font-size="12" fill="#333">路径 path</text>
  <rect x="164" y="182" width="336" height="32" rx="6" fill="#fff" stroke="#d4d4d4"/>
  <text x="176" y="202" font-size="12" fill="#8b8b8b">文章可空 = 随机；书籍建议 slug</text>
  <text x="164" y="240" font-size="12" fill="#333">标题 / 书名</text>
  <rect x="164" y="250" width="336" height="32" rx="6" fill="#fff" stroke="#d4d4d4"/>
  <text x="164" y="308" font-size="11" fill="#616161">选「书籍」时创建后进入分页管理；分页在此不创建</text>
  <rect x="280" y="328" width="90" height="28" rx="8" fill="#fff" stroke="#d4d4d4"/>
  <text x="308" y="346" font-size="12" fill="#333">取消</text>
  <rect x="380" y="328" width="90" height="28" rx="8" fill="#0e639c"/>
  <text x="408" y="346" font-size="12" fill="#fff">创建</text>
</svg>
```

选中「书籍」时动态出现「简介」输入；**无「所属书籍」下拉**（该能力属于书籍编辑器内的新建分页）。

---

## 8. 权限与分享

| 类型 | P0 |
| --- | --- |
| 文章 | 现有 `pw`/`share`/JWT（exact path） |
| 书籍 | 现有能力作用于书籍 path；编辑书籍 = 对书籍 path 的编辑鉴权；**分页 API 校验调用方对书籍有编辑权**（或对目标 page path 有权） |
| 分页 | 现有能力作用于分页 path |

推荐 P0：分页增删改查要求 **对书籍 path 的编辑授权**（书密码或无密码），避免「只能改某页却能改目录结构」的管理漏洞；分页正文自身的 pw/share 仍按分页 path。

分享：文章/分页 `/note/{path}`；书籍 `/note/{book}`。

---

## 9. 功能回归矩阵

| 能力 | 文章 | 书籍（查看） | 书籍（编辑） | 分页（查看/编辑） |
| --- | --- | --- | --- | --- |
| 全局可创建 | ✓ | ✓ | — | ✗（仅书内） |
| 左侧目录/管理 | ✗ | TOC 只读 | **分页 CRUD 面板** | TOC 只读 |
| 正文编辑/mode/格式化 | ✓ | ✓（目录 MD） | ✓ | ✓ |
| 密码/分享/Raw | ✓ | ✓ | ✓（书） | ✓（页） |
| 上一章/下一章 | ✗ | 按目录 | 按目录 | ✓ |

---

## 10. 路线图

### D0 — 模型与创建（两类）

1. `NoteMetadata`: `docType`/`bookRef`/`title`，缺省 article  
2. `POST /api/docs` **仅** article/book；书籍目录模板  
3. 创建对话框：两选项 + 字段动态  
4. `GET /new` 行为调整；e2e：创建文章/书籍；**拒绝** API 创建 page  

### D1 — 书籍编辑器与分页 CRUD

1. `/edit/{book}` 布局：左分页管理 + 右目录编辑  
2. `GET/POST /api/books/{book}/pages`；删除同步目录链接  
3. 重命名 title + 目录链接文字；上移/下移顺序  
4. 分页编辑页：只读 TOC +「返回书籍编辑」  
5. 查看书/页：只读 TOC  
6. e2e：建书 → 书内建分页 → 目录出现链接 → 打开分页 → 删除分页链接消失  

### D2 — 增强

1. 拖拽排序、path 重命名迁移  
2. 死链「一键补建分页 / 移除链接」  
3. 书级密码与分页管理鉴权细化  
4. `title` 优先于 path 展示  
5. 相对链接改写  

### D3 — 远期

导出整书、阅读进度、全文搜索。

---

## 11. 实施任务拆分

| ID | 任务 | 要点 |
| --- | --- | --- |
| D0.1 | 元数据模型 | docType/bookRef/title + 兼容 |
| D0.2 | 创建 API | 仅 article/book；拒绝 page |
| D0.3 | 创建 UI | 两选项对话框；替换 path prompt |
| D0.4 | 列表 | 徽章/筛选；书籍卡「编辑书籍」 |
| D1.1 | 书籍编辑器壳 | 左管理面板 + 右正文 |
| D1.2 | 分页 POST/PATCH/DELETE 同步 | 目录 MD 自动维护 |
| D1.3 | TOC API + 查看态 | book/page 左侧只读 TOC |
| D1.4 | 测试 | 创建拒绝 page；书内 CRUD 全链路；文章回归 |

---

## 12. 验收标准（本版 P0）

1. 全局新建对话框 **仅有「文章」「书籍」** 两个选项。  
2. `POST /api/docs` 传 `docType=page` 被拒绝并有明确文案。  
3. 创建书籍后进入书籍编辑器，左侧可新建分页；目录 Markdown 自动出现链接。  
4. 分页支持：列表查看、搜索、打开编辑、重命名、删除（含目录链接同步）、顺序调整（至少上下移）。  
5. 查读书籍/分页时左侧为目录；文章无左侧栏且功能与现状一致。  
6. 存量无类型文档按文章处理。  
7. lint / typecheck / e2e 通过。

---

## 13. 口径摘要（最终）

| 问题 | 本版结论 |
| --- | --- |
| 创建时几种类型？ | **2 种：文章、书籍** |
| 分页何时创建？ | **编辑书籍时**，分页管理面板 / API |
| 书籍正文是什么？ | 分页目录 Markdown，权威导航源 |
| 何时出左侧栏？ | 查看书籍/分页：只读 TOC；**编辑书籍：分页 CRUD 面板** |
| 文章是否变化？ | 功能保持与当前单篇一致 |
