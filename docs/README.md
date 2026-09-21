# 文档索引

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 代码结构、数据模型、API、构建部署 | **现行** |
| [product-doc-types.md](./product-doc-types.md) | 文章 / 书籍 / 分页类型与创建流 | 现行产品口径 |
| [product-home-books-articles.md](./product-home-books-articles.md) | 首页树形目录列表 | 现行（UI 已再迭代） |
| [ui-ux-design.md](./ui-ux-design.md) | UI/UX 规格与线框 | 参考 |
| [p0-home-notes-list.md](./p0-home-notes-list.md) | 早期主页列表 P0 拆分 | 历史 |
| [product-markdown-book.md](./product-markdown-book.md) | 早期「路径推断成书」方案 | **已废弃**（由 docType 模型取代） |

产品演进摘要：

1. 扁平便笺 → 无列表  
2. 路径前缀成书（废弃）  
3. **显式 docType + 首页树 + 书内分页 CRUD**（现行）  
4. 以正文为基准的 metadata repair + R2 结构缓存  
