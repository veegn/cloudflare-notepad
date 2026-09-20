# UI/UX 设计规格：文档树 · 书籍 · 分页

> 模式：**现有代码库**（Existing-codebase）— 以 `static/css/app.css` 的 VS Code workbench 语言为权威，不另起第二套视觉体系。  
> 产品依据：`docs/product-doc-types.md`、`docs/product-home-books-articles.md`。

---

## 0. 设计原则

1. **延续 workbench**：新界面看起来像原团队在状态好的一天做的扩展，而不是外挂产品。
2. **类型一眼可辨**：目录 / 书籍 / 文章用图标 + 徽章双重编码，不单靠颜色。
3. **树是主叙事**：首页主区是一棵可扫描、可展开的文档树；分页永不入树。
4. **动作就地可见**：书籍的「编辑书籍」、分页的 CRUD 出现在语境侧栏，而不是深层菜单。
5. **状态完备**：空、加载、错误、禁用、焦点、hover 与成功路径同等设计。

---

## 1. 设计令牌（Design Tokens）

### 1.1 色板（沿用 CSS 变量，不新增色相）

| Token | Dark（默认） | Light | 用途 |
| --- | --- | --- | --- |
| `--vscode-bg` | `#1e1e1e` | `#f3f3f3` | 应用底 |
| `--vscode-editor` | `#1e1e1e` | `#ffffff` | 面板/列表底 |
| `--vscode-tab` | `#252526` | `#e7e7e7` | Tab、侧栏头 |
| `--vscode-border` | `#313131` | `#d4d4d4` | 分割线、描边 |
| `--vscode-text` | `#cccccc` | `#333333` | 主文本 |
| `--vscode-text-muted` | `#8c8c8c` | `#616161` | 次要文本 |
| `--vscode-text-subtle` | `#6b6b6b` | `#8b8b8b` | path、时间、占位 |
| `--vscode-accent` | `#3794ff` | `#005fb8` | 链接、主强调、选中 |
| `--vscode-accent-soft` | `rgba(55,148,255,.16)` | `rgba(0,95,184,.10)` | 徽章底、软选中 |
| `--vscode-statusbar` | `#007acc` | `#005fb8` | 状态栏 |
| `--vscode-warning-*` | 黄系 | 黄系 | 密码/注意 |
| `--radius-l/m/s` | `14 / 8 / 4` | 同 | 面板/控件/徽章 |
| `--shadow-panel` | 深阴影 | 浅阴影 | 工作台面板 |

**语义衍生（仅组合现有色，不引入品牌新色）**

| 语义 | 实现 |
| --- | --- |
| 目录节点 | 图标用 muted；徽章灰底 `border` + `text-muted` |
| 书籍节点 | 图标 accent；徽章 `accent-soft` + `accent` 文字 |
| 文章节点 | 图标 muted/subtle；徽章中性灰 |
| 危险操作（删除分页） | `--vscode-warning-text` / light 下 `#7a4d00`，不用刺眼红整行 |
| 选中行 | `--vscode-selection` 或 `accent-soft` + 左侧 2px accent 竖条 |

### 1.2 字体

| 角色 | Font stack | 用法 |
| --- | --- | --- |
| UI / 正文 | `'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | 全局（与 base.html 一致） |
| 等宽 | `'IBM Plex Mono', ui-monospace, Consolas, monospace` | path、slug、时间戳可选 |

| 字号 | 值 | 用途 |
| --- | --- | --- |
| Display | 20–22px / 600 | 首页标题（在 workbench 内不必 48px） |
| Section | 14–15px / 600 | 「文档」「分页管理」 |
| Body / 行标题 | 13–14px / 500–600 | 树节点名称 |
| Meta | 12px / 400 | path、时间、计数 |
| Micro | 11px | 徽章、tooltip |

行高：树行 `1.35`；元信息 `1.4`。字距：标题 `-0.01em`；徽章 `0`。

### 1.3 间距与密度

| Token | 值 | 用途 |
| --- | --- | --- |
| 树行高 | 36px（桌面）/ 44px（触控） | 可点热区 |
| 缩进步进 | 16–20px / 层 | 树层级 |
| 侧栏宽 | 240px（编辑书籍）/ 220px（阅读 TOC） | 左栏 |
| 侧栏可折叠 | 至 0 + 抽屉 | 移动/窄屏 |
| 区块间距 | 20–28px | Hero 与树之间 |
| 控件高 | 32–36px | 按钮、搜索框 |

---

## 2. 组件库

### 2.1 类型徽章 Badge

| 变体 | 文案 | 样式 |
| --- | --- | --- |
| `dir` | 目录 | bg transparent / border `border` / text muted |
| `book` | 书籍 | bg `accent-soft` / border accent@25% / text accent |
| `article` | 文章 | bg `tab` / border `border` / text muted |
| `page` | 分页 | 仅在书籍编辑器/阅读 TOC 使用；主页树**不出现** |
| `lock` | 密码 | warning 底 |
| `private` | 私密 | 中性 + 锁图标 |

尺寸：`height 18px`，`padding 0 6px`，`font-size 10–11px`，`radius var(--radius-s)`。

### 2.2 图标（内联 SVG / 字形，单色 currentColor）

| 类型 | 建议 |
| --- | --- |
| 目录 | 文件夹轮廓；展开态可实心或 chevron |
| 书籍 | 书脊/开本线框 |
| 文章 | 文档折角 |
| 分页 | 右折页（仅书内 UI） |
| 展开 | `chevron` 旋转 90°（collapsed → expanded） |

图标准 `16×16`，与文字基线对齐；禁止 emoji 作为唯一标识（可作辅助）。

### 2.3 树行 TreeRow

```
[chevron 16][icon 16][ title flex 1 ][badge][meta muted][actions]
```

| 状态 | 行为 |
| --- | --- |
| default | 透明底，border-bottom 可选 hairline |
| hover | bg `rgba(255,255,255,.04)` / light `rgba(0,0,0,.04)`；显示行内 actions |
| focus-visible | 2px outline accent，offset -2px |
| selected | selection 底 + 左 2px accent |
| disabled / dead-link | text subtle；actions 隐藏或仅「移除」 |

**点击分区**

| 区域 | dir | book | article |
| --- | --- | --- | --- |
| chevron | 切换展开 | — / tooltip 不展开分页 | 仅当 dual 文档 |
| 标题区 | 切换展开 | `/note/{path}` | `/note/{path}` |
| actions | — | 查看 · 编辑书籍 | 查看 · 编辑 |

### 2.4 按钮

| 变体 | 样式 | 用途 |
| --- | --- | --- |
| `primary` | 现有 gradient `#0e639c→#0a4f7c`，白字 | 新建文档、对话框主操作 |
| `secondary` | 透明底 + border | 编辑首页、取消、编辑书籍 |
| `ghost` | 无边框，hover 才显底 | 树行 actions、展开全部 |
| `danger-ghost` | warning 色文字 | 删除分页 |

Focus：所有按钮 `focus-visible` 可见环（accent）。

### 2.5 搜索框 / Chips

- 搜索：`height 32px`，`radius m`，placeholder subtle；左侧放大镜 14px。
- Chips：`height 26px`，选中 primary/accent 实底白字，未选中 border。

### 2.6 对话框 Modal

- 沿用现有 `.modal-overlay` / `.modal-dialog`（`shadow-popup`，radius l）。
- 宽度：创建文档 `400px`；新建分页 `360px`；确认删除 `360px`。
- 结构：标题 15/600 → 说明 12 muted → 字段 → 底部按钮右对齐（取消 secondary + 主操作 primary）。
- Esc / 点遮罩关闭（破坏性确认可仅按钮关闭）。
- 焦点陷阱：打开时聚焦首个字段；关闭还焦触发按钮。

---

## 3. 界面设计

### 3.1 首页 · 文档树 `/`

**布局（workbench 内）**

```
┌ Tab: * 首页 ──────────────────────────────┐
│  Hero                                      │
│    kicker / title / copy                   │
│    [新建文档 primary] [编辑首页]            │
│  _index 钉住卡（可选）                      │
│  ┌ 文档  文章 n · 书籍 m ── [搜索] [展开] ┐ │
│  │ chips: 全部 | 文章 | 书籍               │ │
│  ├────────────────────────────────────────┤ │
│  │ 树…                                    │ │
│  │  ▾ notes                    [目录]     │ │
│  │      📄 会议草稿             [文章]     │ │
│  │      📖 Cloudflare 手册      [书籍]     │ │
│  │  📖 读书笔记                [书籍]     │ │
│  │  📄 独立便笺                [文章]     │ │
│  └────────────────────────────────────────┘ │
└ Statusbar ───────────────────────────────┘
```

**完整线框**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 900" font-family="'IBM Plex Sans',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <rect width="680" height="900" fill="#1e1e1e"/>
  <text x="40" y="28" font-size="13" fill="#8c8c8c">首页 · Dark · 文档树</text>
  <rect x="40" y="44" width="600" height="820" rx="14" fill="#1e1e1e" stroke="#313131"/>
  <rect x="40" y="44" width="600" height="38" fill="#252526"/>
  <rect x="56" y="52" width="78" height="22" rx="4" fill="#1e1e1e" stroke="#313131"/>
  <text x="68" y="67" font-size="12" fill="#cccccc">* 首页</text>

  <rect x="68" y="108" width="88" height="22" rx="11" fill="rgba(55,148,255,0.16)"/>
  <text x="80" y="123" font-size="11" font-weight="600" fill="#3794ff">云端文档库</text>
  <text x="68" y="158" font-size="22" font-weight="600" fill="#cccccc">浏览书籍与文章</text>
  <text x="68" y="182" font-size="12" fill="#8c8c8c">目录可展开；书籍分页不在列表中。</text>
  <rect x="68" y="200" width="108" height="36" rx="8" fill="#0e639c"/>
  <text x="90" y="223" font-size="13" font-weight="600" fill="#fff">新建文档</text>
  <rect x="188" y="200" width="88" height="36" rx="8" fill="transparent" stroke="#313131"/>
  <text x="206" y="223" font-size="13" fill="#cccccc">编辑首页</text>

  <rect x="68" y="260" width="544" height="64" rx="8" fill="#252526" stroke="#313131"/>
  <text x="84" y="286" font-size="12" font-weight="600" fill="#3794ff">首页笔记 · _index</text>
  <text x="84" y="306" font-size="11" fill="#8c8c8c">仪表盘预览 · 不进入下方文档树</text>
  <rect x="500" y="278" width="52" height="28" rx="6" fill="transparent" stroke="#313131"/>
  <text x="514" y="296" font-size="12" fill="#cccccc">编辑</text>

  <text x="68" y="360" font-size="14" font-weight="600" fill="#cccccc">文档</text>
  <text x="112" y="360" font-size="12" fill="#8c8c8c">文章 4 · 书籍 2</text>
  <rect x="340" y="344" width="200" height="30" rx="8" fill="#1e1e1e" stroke="#313131"/>
  <text x="352" y="363" font-size="12" fill="#6b6b6b">搜索标题 / 路径…</text>
  <rect x="548" y="344" width="64" height="30" rx="6" fill="transparent" stroke="#313131"/>
  <text x="560" y="363" font-size="11" fill="#cccccc">展开</text>

  <rect x="68" y="386" width="48" height="26" rx="13" fill="#007acc"/>
  <text x="80" y="403" font-size="12" fill="#fff">全部</text>
  <rect x="124" y="386" width="48" height="26" rx="13" fill="transparent" stroke="#313131"/>
  <text x="136" y="403" font-size="12" fill="#cccccc">文章</text>
  <rect x="180" y="386" width="48" height="26" rx="13" fill="transparent" stroke="#313131"/>
  <text x="192" y="403" font-size="12" fill="#cccccc">书籍</text>

  <!-- tree panel -->
  <rect x="68" y="428" width="544" height="360" rx="8" fill="#1e1e1e" stroke="#313131"/>

  <!-- dir expanded -->
  <rect x="68" y="428" width="544" height="36" fill="transparent"/>
  <text x="88" y="450" font-size="12" fill="#8c8c8c">▾</text>
  <text x="108" y="450" font-size="13" font-weight="600" fill="#cccccc">notes</text>
  <rect x="156" y="438" width="36" height="16" rx="3" fill="#252526" stroke="#313131"/>
  <text x="162" y="450" font-size="10" fill="#8c8c8c">目录</text>
  <text x="210" y="450" font-size="11" fill="#6b6b6b">3 项</text>

  <!-- article child -->
  <text x="108" y="486" font-size="12" fill="#8c8c8c">📄</text>
  <text x="128" y="486" font-size="13" fill="#cccccc">会议草稿</text>
  <rect x="200" y="474" width="36" height="16" rx="3" fill="#252526" stroke="#313131"/>
  <text x="206" y="486" font-size="10" fill="#8c8c8c">文章</text>
  <rect x="244" y="474" width="36" height="16" rx="3" fill="#3c2f00"/>
  <text x="250" y="486" font-size="10" fill="#f6d365">密码</text>
  <text x="300" y="486" font-size="11" fill="#6b6b6b">m2q7p</text>
  <text x="480" y="486" font-size="11" fill="#6b6b6b">昨天</text>

  <!-- book child - no expand -->
  <text x="108" y="522" font-size="12" fill="#3794ff">📖</text>
  <text x="128" y="522" font-size="13" font-weight="600" fill="#cccccc">Cloudflare 笔记手册</text>
  <rect x="280" y="510" width="36" height="16" rx="3" fill="rgba(55,148,255,0.16)"/>
  <text x="286" y="522" font-size="10" fill="#3794ff">书籍</text>
  <text x="330" y="522" font-size="11" fill="#6b6b6b">handbook · 6 分页（不列出）</text>
  <text x="520" y="522" font-size="11" fill="#3794ff">编辑书籍</text>

  <!-- dir collapsed -->
  <text x="88" y="558" font-size="12" fill="#8c8c8c">▸</text>
  <text x="108" y="558" font-size="13" font-weight="600" fill="#cccccc">drafts</text>
  <rect x="156" y="546" width="36" height="16" rx="3" fill="#252526" stroke="#313131"/>
  <text x="162" y="558" font-size="10" fill="#8c8c8c">目录</text>

  <!-- root book -->
  <text x="88" y="594" font-size="12" fill="#3794ff">📖</text>
  <text x="108" y="594" font-size="13" font-weight="600" fill="#cccccc">读书笔记</text>
  <rect x="188" y="582" width="36" height="16" rx="3" fill="rgba(55,148,255,0.16)"/>
  <text x="194" y="594" font-size="10" fill="#3794ff">书籍</text>
  <text x="240" y="594" font-size="11" fill="#6b6b6b">reading-notes · 12 分页</text>

  <!-- root article -->
  <text x="88" y="630" font-size="12" fill="#8c8c8c">📄</text>
  <text x="108" y="630" font-size="13" fill="#cccccc">独立便笺</text>
  <rect x="170" y="618" width="36" height="16" rx="3" fill="#252526" stroke="#313131"/>
  <text x="176" y="630" font-size="10" fill="#8c8c8c">文章</text>
  <text x="220" y="630" font-size="11" fill="#6b6b6b" font-family="ui-monospace,monospace">ab3kx</text>
  <text x="480" y="630" font-size="11" fill="#6b6b6b">2 小时前</text>

  <text x="88" y="680" font-size="11" fill="#6b6b6b">目录点击展开 · 书籍不展示分页 · 悬停显示行操作</text>
  <text x="88" y="704" font-size="11" fill="#6b6b6b">筛选「书籍」时仅保留书籍及祖先目录</text>

  <rect x="40" y="824" width="600" height="36" fill="#007acc"/>
  <text x="56" y="846" font-size="11" fill="#fff">主题 · 主页无编辑工具 · 文档计数</text>
</svg>
```

**树行规格（像素）**

| 项 | 值 |
| --- | --- |
| 行高 | 36px |
| 缩进 | `8 + level*20` px |
| chevron 热区 | 24×36 |
| 标题截断 | ellipsis，max-width 随 meta 弹性 |
| hover actions | 右对齐 ghost 按钮，12px 字 |

**交互状态**

| 状态 | UI |
| --- | --- |
| 加载 | 树区 5–7 行骨架（灰条 + 徽章位） |
| 空库 | 居中：标题「服务里还没有文章或书籍」+ 两个 primary/secondary CTA |
| 搜索空 | 「没有匹配的文档」+「清除搜索」 |
| 错误 | 树区错误条 +「重试」；toast 可选 |
| 目录展开动画 | 高度过渡 200ms，`prefers-reduced-motion: reduce` 时无动画 |

**Light 主题**：同结构，bg `#f3f3f3` / editor `#fff` / border `#d4d4d4`；书籍徽章仍用 accent-soft。

---

### 3.2 创建文档对话框

**仅两类：文章 | 书籍**（无分页）。

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 420" font-family="'IBM Plex Sans',-apple-system,'PingFang SC',sans-serif">
  <rect width="680" height="420" fill="#1e1e1e"/>
  <text x="40" y="28" font-size="13" fill="#8c8c8c">新建文档 · Modal</text>
  <rect x="40" y="44" width="600" height="340" fill="rgba(0,0,0,0.45)"/>
  <rect x="140" y="70" width="400" height="280" rx="14" fill="#252526" stroke="#313131"/>
  <text x="164" y="104" font-size="15" font-weight="600" fill="#cccccc">新建文档</text>
  <text x="164" y="124" font-size="12" fill="#8c8c8c">类型在创建时确定；分页请在编辑书籍时添加。</text>

  <rect x="164" y="140" width="168" height="40" rx="8" fill="#007acc"/>
  <text x="210" y="164" font-size="13" font-weight="600" fill="#fff">文章</text>
  <rect x="348" y="140" width="168" height="40" rx="8" fill="transparent" stroke="#313131"/>
  <text x="400" y="164" font-size="13" font-weight="600" fill="#cccccc">书籍</text>

  <text x="164" y="206" font-size="12" fill="#cccccc">路径 path</text>
  <rect x="164" y="216" width="352" height="32" rx="6" fill="#1e1e1e" stroke="#313131"/>
  <text x="176" y="236" font-size="12" fill="#6b6b6b">文章可空 = 随机路径</text>
  <text x="164" y="270" font-size="12" fill="#cccccc">标题</text>
  <rect x="164" y="280" width="352" height="32" rx="6" fill="#1e1e1e" stroke="#313131"/>

  <rect x="288" y="322" width="88" height="28" rx="6" fill="transparent" stroke="#313131"/>
  <text x="316" y="340" font-size="12" fill="#cccccc">取消</text>
  <rect x="388" y="322" width="88" height="28" rx="6" fill="#0e639c"/>
  <text x="416" y="340" font-size="12" fill="#fff">创建</text>
</svg>
```

| 字段 | 文章 | 书籍 |
| --- | --- | --- |
| 类型分段控件 | 选中「文章」 | 选中「书籍」 |
| path | 可空 → 随机；placeholder「例如：weekend-hike」 | 必填 slug；placeholder「例如：handbook」 |
| 标题 | 可选 | 必填「书名」 |
| 简介 | 隐藏 | 可选多行 2 行 |
| 校验提示 | path 非法/冲突 | 同；书名空禁用主按钮 |

**选中「书籍」时**：path placeholder 变为「书目录 slug」；标题 label 变为「书名」；出现「简介（可选）」。

**反馈**：创建中主按钮 loading；失败 field-level + toast；成功跳转 `editUrl`。

---

### 3.3 书籍编辑器 `/edit/{book}` · 分页 CRUD

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 520" font-family="'IBM Plex Sans',-apple-system,'PingFang SC',sans-serif">
  <rect width="680" height="520" fill="#1e1e1e"/>
  <text x="40" y="28" font-size="13" fill="#8c8c8c">书籍编辑器 · 分页管理</text>
  <rect x="40" y="44" width="600" height="440" rx="14" fill="#1e1e1e" stroke="#313131"/>
  <rect x="40" y="44" width="600" height="36" fill="#252526"/>
  <text x="56" y="66" font-size="12" fill="#cccccc">* handbook</text>
  <rect x="140" y="54" width="36" height="16" rx="3" fill="rgba(55,148,255,0.16)"/>
  <text x="146" y="66" font-size="10" fill="#3794ff">书籍</text>
  <text x="190" y="66" font-size="11" fill="#8c8c8c">编辑中 · 自动保存</text>

  <!-- left page manager -->
  <rect x="40" y="80" width="220" height="404" fill="#252526" stroke="#313131"/>
  <text x="56" y="106" font-size="13" font-weight="600" fill="#cccccc">分页管理</text>
  <text x="56" y="124" font-size="11" fill="#8c8c8c">6 个分页</text>
  <rect x="56" y="136" width="188" height="32" rx="6" fill="#0e639c"/>
  <text x="100" y="156" font-size="12" font-weight="600" fill="#fff">+ 新建分页</text>
  <rect x="56" y="176" width="188" height="28" rx="6" fill="#1e1e1e" stroke="#313131"/>
  <text x="66" y="194" font-size="11" fill="#6b6b6b">搜索分页…</text>

  <text x="66" y="230" font-size="12" fill="#cccccc">01 介绍</text>
  <text x="200" y="230" font-size="10" fill="#3794ff">编辑</text>
  <text x="66" y="258" font-size="12" fill="#3794ff">02 安装</text>
  <text x="180" y="258" font-size="10" fill="#f6d365">删除</text>
  <text x="200" y="258" font-size="10" fill="#3794ff">改名</text>
  <text x="66" y="286" font-size="12" fill="#cccccc">03 配置</text>
  <text x="66" y="314" font-size="12" fill="#cccccc">04 深入原理</text>
  <text x="180" y="314" font-size="10" fill="#6b6b6b">↑↓</text>
  <text x="66" y="360" font-size="11" fill="#6b6b6b">悬停显示：编辑 / 改名 / 删除 / 上下移</text>
  <text x="66" y="380" font-size="11" fill="#6b6b6b">操作会同步右侧目录 Markdown</text>

  <!-- right toc editor -->
  <text x="280" y="108" font-size="12" font-weight="600" fill="#cccccc">书籍正文（目录）</text>
  <rect x="280" y="120" width="340" height="280" rx="8" fill="#1e1e1e" stroke="#313131"/>
  <text x="296" y="148" font-size="13" fill="#cccccc"># Cloudflare 笔记手册</text>
  <text x="296" y="172" font-size="12" fill="#8c8c8c">&gt; 私有部署与运维说明。</text>
  <text x="296" y="200" font-size="12" fill="#8c8c8c">## 目录</text>
  <text x="296" y="228" font-size="12" fill="#3794ff">- [介绍](handbook/intro)</text>
  <text x="296" y="252" font-size="12" fill="#3794ff">- [安装](handbook/install)</text>
  <text x="296" y="276" font-size="12" fill="#3794ff">- [配置](handbook/config)</text>
  <text x="296" y="320" font-size="11" fill="#6b6b6b">也可手动编辑 Markdown（高级）</text>
  <text x="280" y="440" font-size="11" fill="#8c8c8c">删除分页将确认：删除正文 + 从目录移除链接</text>
</svg>
```

**新建分页对话框**

| 字段 | 说明 |
| --- | --- |
| 标题 | 必填 |
| path | 默认 `{book}/{slug}`，可改；冲突 409 |
| 主按钮 | 「创建分页」→ 列表刷新；可选「创建并编辑」 |

**删除确认**

```
删除分页「安装」？
将删除 handbook/install 的正文，并从书籍目录中移除链接。
☑ 同时从目录移除链接（默认勾选）
[取消]  [删除分页 danger]
```

**列表空态**：「还没有分页」+ 主按钮「+ 新建分页」。

---

### 3.4 阅读态 · 书籍 / 分页（左侧只读 TOC）

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 440" font-family="'IBM Plex Sans',-apple-system,'PingFang SC',sans-serif">
  <rect width="680" height="440" fill="#1e1e1e"/>
  <text x="40" y="28" font-size="13" fill="#8c8c8c">阅读 · 分页 /note/handbook/install</text>
  <rect x="40" y="44" width="600" height="360" rx="14" fill="#1e1e1e" stroke="#313131"/>
  <rect x="40" y="44" width="600" height="36" fill="#252526"/>
  <text x="56" y="66" font-size="12" fill="#cccccc">* 安装步骤</text>
  <rect x="148" y="54" width="36" height="16" rx="3" fill="rgba(55,148,255,0.16)"/>
  <text x="154" y="66" font-size="10" fill="#3794ff">分页</text>
  <text x="200" y="66" font-size="11" fill="#8c8c8c">来自 Cloudflare 笔记手册</text>
  <text x="420" y="66" font-size="11" fill="#3794ff">编辑书籍</text>

  <rect x="40" y="80" width="200" height="324" fill="#252526" stroke="#313131"/>
  <text x="56" y="106" font-size="12" font-weight="600" fill="#cccccc">目录</text>
  <text x="56" y="124" font-size="11" fill="#8c8c8c">Cloudflare 笔记手册</text>
  <text x="56" y="152" font-size="12" fill="#8c8c8c">介绍</text>
  <text x="56" y="178" font-size="12" font-weight="600" fill="#3794ff">安装</text>
  <rect x="40" y="164" width="2" height="20" fill="#3794ff"/>
  <text x="56" y="204" font-size="12" fill="#8c8c8c">配置</text>
  <text x="56" y="230" font-size="12" fill="#8c8c8c">深入原理 🔒</text>
  <text x="56" y="280" font-size="11" fill="#6b6b6b">← 上一章　下一章 →</text>

  <text x="268" y="120" font-size="18" font-weight="600" fill="#cccccc">安装步骤</text>
  <text x="268" y="144" font-size="12" fill="#6b6b6b">md · 公开 · 2 小时前</text>
  <text x="268" y="180" font-size="13" fill="#cccccc">正文 Markdown 渲染区…</text>
  <text x="268" y="208" font-size="12" fill="#8c8c8c">相对链接映射到 /note/…（P1）</text>
  <text x="268" y="360" font-size="12" fill="#3794ff">← 上一章</text>
  <text x="340" y="360" font-size="12" fill="#3794ff">下一章 →</text>
</svg>
```

| 模式 | 左栏 | 右栏 |
| --- | --- | --- |
| 查看书籍 | 只读 TOC（书自身可高亮） | 目录 MD 渲染 |
| 查看分页 | 只读 TOC，当前高亮 + 左竖条 | 分页正文 |
| 编辑分页 | 同 TOC +「返回书籍编辑」 | CodeMirror 编辑 |

**锁章节**：TOC 显示锁图标；点击进鉴权页。  
**死链**：subtle 色，不可点或点击提示「分页不存在」。

Statusbar（阅读）：编辑 · 原文 · （分页）返回书籍 · 主题。  
Statusbar（书籍编辑）：密码 · 分享 · 退出 · 保存指示 · 徽章「书籍」。

---

### 3.5 文章 · 查看/编辑（零回归）

与当前实现一致：无左栏 TOC；Tab 图标 `#`/`</>`；statusbar 现有按钮。树中点击文章仅改变入口，不改文档页结构。

---

### 3.6 移动端（&lt;720px）

| 界面 | 调整 |
| --- | --- |
| 首页树 | 行高 44px；path 可隐藏；chevron 热区加大；Hero 按钮纵向可换行 |
| 创建对话框 | 宽度 `calc(100% - 32px)`；类型分段两等分 |
| 书籍编辑器 | 左栏默认抽屉；顶栏「分页」按钮打开管理面板 |
| 阅读 TOC | 抽屉 +「目录」按钮；正文全宽 |
| 筛选 chips | 横向滚动 |

---

## 4. 文案（Copy）

| 场景 | 文案 |
| --- | --- |
| 首页标题 | 云端文档库 |
| 首页副文 | 浏览当前服务下的书籍与文章。目录可展开，分页在书籍内管理。 |
| CTA | 新建文档 / 编辑首页 / + 新建分页 / 编辑书籍 / 查看 |
| 徽章 | 目录 · 书籍 · 文章 · 分页 · 密码 · 私密 |
| 空树 | 服务里还没有文章或书籍 |
| 空树辅助 | 新建一篇快速笔记，或创建一本带分页的书。 |
| 空分页 | 还没有分页。新建一页后会自动写入书籍目录。 |
| 搜索空 | 没有匹配的文档 |
| 创建提示 | 类型在创建时确定。分页请在编辑书籍时添加。 |
| 书籍 tooltip | 分页不在列表中展示，请通过「编辑书籍」管理。 |
| 删除确认 | 删除分页「{title}」？正文将被删除，并可从书籍目录移除链接。 |
| API 拒 page | 请在编辑书籍时新建分页。 |

动词一致：「创建」不与「新建」混用作主 CTA（主 CTA 一律 **新建**）；删除确认主按钮 **删除分页**。

---

## 5. 动效

| 场景 | 时长 / 曲线 |
| --- | --- |
| 树展开/收起 | 200ms `cubic-bezier(0.4,0,0.2,1)` 高度 |
| Modal 进入 | 160ms fade + 轻微 scale 0.98→1 |
| 行 hover | 120ms 背景 |
| Toast | 现有 2.5s 退出 |

全部包在 `@media (prefers-reduced-motion: no-preference)`；reduce 时瞬时切换。

---

## 6. 可访问性

| 项 | 要求 |
| --- | --- |
| 对比度 | 正文 ≥4.5:1；大标题 ≥3:1（沿用现有 token 已满足主路径） |
| 树语义 | `role="tree"` / `treeitem` / `aria-expanded`；或 button+`aria-expanded` |
| 键盘 | Tab 到树；←→ 或 Enter 切换展开；Space 激活；书籍/文章 Enter 进入 |
| 焦点 | `focus-visible` 氎 accent，禁止 `outline:none` 无替代 |
| 触控 | 移动端节点 ≥44px |
| 图标 | `aria-hidden` + 可见文字标题/徽章 |

---

## 7. 组件与代码映射（建议）

| UI | 建议落点 |
| --- | --- |
| 树列表 | `frontend/homeTree.ts` + `templates/home.html` `#doc-tree` |
| 创建对话框 | `frontend/ui.ts` `showCreateDocDialog()` 替换单一 path prompt |
| 书籍编辑器左栏 | `templates/edit.html` 条件块 `docType=book` + `frontend/bookPages.ts` |
| 阅读 TOC | `share.html`/`edit.html` 条件侧栏 + `GET /api/toc` |
| 样式 | `static/css/app.css` 增加 `.doc-tree*` `.badge-*` `.book-sidebar*` `.modal-create-doc` |
| TOKEN | 全部引用现有 CSS 变量，不硬编码第二套 hex |

CSS 类名建议：

```
.doc-tree, .doc-tree-row, .doc-tree-row.is-dir/.is-book/.is-article
.doc-tree-chevron, .doc-tree-actions, .badge-dir/.badge-book/.badge-article
.home-toolbar, .home-chips, .book-pages-panel, .book-toc-sidebar
.modal-create-doc, .type-segment, .field, .field-error
```

---

## 8. 验收清单（UI/UX）

- [ ] 首页树：目录可展开；书籍/文章徽章可辨；**无任何分页行**
- [ ] 书籍行 hover 出现「编辑书籍」；无展开分页箭头
- [ ] 创建对话框仅文章/书籍；选书籍出现书名/简介
- [ ] 书籍编辑器左栏 CRUD 控件完整；删除有确认
- [ ] 查看分页有左 TOC 且当前高亮；文章页无 TOC
- [ ] 空/加载/错误/焦点/hover/disabled 已设计
- [ ] 375px 无横向溢出；触控 ≥44px
- [ ] light/dark 均可读
- [ ] `prefers-reduced-motion` 有分支
- [ ] 文案与产品口径一致（分页不在创建、不在树）

---

## 9. 签名元素（在现有体系内的一处强调）

在 **不改 workbench 语言** 的前提下，本产品最值得强化的一处是：

> **文档树中的「类型色语义」**：书籍节点用 accent 图标 + accent 软徽章，目录/文章保持中性灰——扫一眼树就能定位「书」，同时书籍行用 tooltip 说明「分页不在列表中」，把产品规则做进界面语言，而不是只写在文档里。

这是功能可读性设计，不是装饰性品牌改版；实现上零新色相、零新字体。
