# Blog 维护说明

## 页面与行为

- `/blog/`：分类、最近文章、GitHub 登录和 Friend 申请。
- `/blog/academic/`、`/blog/daily/`：按当前访问权限显示笔记，两类目前各有一篇公开 Example。
- `/blog/note/?id=UUID`：统一阅读页，每次读取都由数据库检查权限。
- `/blog/admin/`：管理员可切换“笔记管理”和“Friend 审批”。审批模式能读取申请人的 GitHub 资料、邮箱、申请时间并批准或不批准。
- `/blog/auth/callback/`：GitHub OAuth 返回页，使用 PKCE 交换凭据。
- Friend/管理员登录后显示“欢迎我的朋友！”，其他登录用户显示“欢迎您！”。
- 申请在数据库保存成功后显示“已发送申请”，刷新后保留；每个账号一条申请。被拒绝后仍显示已发送，不发拒绝邮件。
- 批准在同一事务内授予权限并创建通知任务，随后立即发信。通知失败会明确显示并提供重试按钮，不会假报发送成功。

页面仍是无需构建的 HTML/CSS/JavaScript。浏览器只保存公开函数地址，所有 OAuth、SMTP 和服务端密钥都在服务端配置，不能提交到仓库。

## 后端

Supabase Free 项目：`coqojtfkateioxsoeugn`（Blog）。

1. 按顺序应用 `supabase/migrations/202611210001_friend_access.sql` 和 `202611210002_note_management.sql`。申请、角色、邮件表启用 RLS，浏览器没有直接读写权限；笔记表允许经过 RLS 筛选的读取。
2. 部署 `supabase/functions/friend-access/index.ts` 及 `_shared/friend-service.mjs`、`_shared/note-service.mjs`。每个带登录凭据的请求都调用 `Auth.getUser` 验证用户；审批和笔记管理额外检查管理员。只有 `notes_list`、`notes_read` 允许匿名访问，提供无效凭据时返回 401，不降级成匿名请求。
3. 按 `supabase/config.toml` 关闭不兼容新版登录凭据的旧版 JWT 网关校验，由函数代码验证。GET 只提供公开的 anon 配置，不能返回 service role key。
4. 所有者 GitHub 数字 ID 固定为 `173534334`（HzmSailor）。第一次真实登录会在服务端自动绑定管理员；不能通过修改昵称或 user_metadata 获得角色。
5. GitHub OAuth App：`Zimu Han Blog`，应用设置 ID `4041260`。Homepage 为 `https://hzmsailor.github.io/blog/`，回调为 `https://coqojtfkateioxsoeugn.supabase.co/auth/v1/callback`。Client Secret 只配置到 Supabase GitHub provider。
6. Supabase Site URL：`https://hzmsailor.github.io/blog/`；Redirect URLs 只加入精确地址 `https://hzmsailor.github.io/blog/auth/callback/`。
7. 通知使用 Gmail SMTP（`smtp.gmail.com:465`，TLS）。在 Edge Functions Secrets 设置 `BLOG_SMTP_USER` 为发件 Gmail 地址、`BLOG_SMTP_PASSWORD` 为 Gmail 应用专用密码。不要使用 Gmail 日常登录密码，不要在聊天或仓库中保存应用密码。Google 要求先开启两步验证；应用密码需要由账号所有者亲自生成和填入。
8. `BLOG_SITE_URL` 默认是 `https://hzmsailor.github.io`。本地验证使用单独测试项目或隔离模拟服务，不扩大生产跨域白名单。

## 邮件可靠性

只有批准会创建邮件记录。数据库中的邮件锁防止并发重复发送，已记录发送成功的通知不会重发。失败保留任务，管理员可以重试。SMTP 在“服务器已接受但客户端断线”等极少数不确定状态下无法保证严格只投递一次，固定 Message-ID 用于关联同一通知。

## 笔记可见性

| 设置 | 访客 / 普通登录用户 | Friend | 管理员 |
| --- | --- | --- | --- |
| 公开 | 可读 | 可读 | 可读写 |
| 需要权限 | 不可见 | 可读 | 可读写 |
| 私密 | 不可见 | 不可见 | 可读写 |

新建笔记默认“私密”，Academic 和 Daily 都支持三种可见性。笔记的标题、摘要、正文保存在 `blog_notes`，不写入公开 Git 仓库。列表和正文使用调用者的 JWT / anon 角色读取，RLS 同时保护元数据和正文；不能用 service role 绕过读取权限。每次请求都检查当前角色和可见性，修改后限制后续读取；已经公开传播的内容无法收回。

第二个迁移在原 `blog_private_posts` 表上改名并扩展，旧笔记默认保留为“需要权限”，没有保留旧表读取入口。两篇原本公开的 Example 作为种子内容迁入数据库；原静态地址只保留通往阅读页的跳转。历史 Git 版本中的公开内容仍然存在。

管理写入仅经服务端验证的管理员调用 RPC。每次保存、移到回收站、恢复都检查 revision，避免旧页面覆盖新版本。回收站为可恢复归档，不提供永久删除。所有编辑器输入都不写入本地存储；切换身份时清除受限正文和编辑内容。

## 检查

- `node --test tests/friend-service.test.mjs tests/note-service.test.mjs`：会话验证、审批权限、通知、匿名读取、管理员写入、输入限制与版本冲突。
- `tests/database.test.mjs`、`tests/notes-database.test.mjs` 用 PGlite 执行真实 PostgreSQL SQL，检查审批事务、邮件锁、三层 RLS、旧笔记迁移、权限变更、撤销和回收站。将 `@electric-sql/pglite` 安装到独立测试目录，设置 `PGLITE_MODULE` 为其 `dist/index.js` 绝对路径，再运行 `node --test tests/*.test.mjs`。
- 前端检查桌面和手机布局。实际 OAuth、SMTP 配置完成后，需要真实测试访客验证一次完整申请、审批和通知。

## 文章维护

管理员登录后进入“管理 Blog → 笔记管理”，选择“新建笔记”或已有笔记的“编辑”。设置标题、分类、摘要、可见性，使用 Markdown 编写正文，展开预览后保存。预览和阅读页使用本地固定版本的 Marked + DOMPurify，原始 HTML 不渲染，并清理危险链接和属性。版本与许可证见 `blog/vendor/`。

误操作可在“回收站”勾选后恢复。不要把私密附件上传到 GitHub Pages 等公开地址；当前编辑器只管理文本和图片链接，不提供受保护附件上传。
