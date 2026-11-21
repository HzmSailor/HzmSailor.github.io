# Blog 维护说明

## 页面与行为

- `/blog/`：分类、最近文章、GitHub 登录和 Friend 申请。
- `/blog/academic/`、`/blog/daily/`：公开文章，目前各有一篇 Example。
- `/blog/admin/`：只有管理员能读取申请人的 GitHub 资料、邮箱、申请时间并批准或不批准。
- `/blog/auth/callback/`：GitHub OAuth 返回页，使用 PKCE 交换凭据。
- Friend/管理员登录后显示“欢迎我的朋友！”，其他登录用户显示“欢迎您！”。
- 申请在数据库保存成功后显示“已发送申请”，刷新后保留；每个账号一条申请。被拒绝后仍显示已发送，不发拒绝邮件。
- 批准在同一事务内授予权限并创建通知任务，随后立即发信。通知失败会明确显示并提供重试按钮，不会假报发送成功。

页面仍是无需构建的 HTML/CSS/JavaScript。浏览器只保存公开函数地址，所有 OAuth、SMTP 和服务端密钥都在服务端配置，不能提交到仓库。

## 后端

Supabase Free 项目：`coqojtfkateioxsoeugn`（Blog）。

1. 应用 `supabase/migrations/202611210001_friend_access.sql`。申请、角色、邮件表都启用 RLS，浏览器没有直接读写权限；只有经验证的 Edge Function 能操作。
2. 部署 `supabase/functions/friend-access/index.ts` 及 `_shared/friend-service.mjs`。每个受保护请求都调用 `Auth.getUser` 验证用户；审批额外检查管理员。
3. 按 `supabase/config.toml` 关闭不兼容新版登录凭据的旧版 JWT 网关校验，由函数代码验证。GET 只提供公开的 anon 配置，不能返回 service role key。
4. 所有者 GitHub 数字 ID 固定为 `173534334`（HzmSailor）。第一次真实登录会在服务端自动绑定管理员；不能通过修改昵称或 user_metadata 获得角色。
5. GitHub OAuth App：`Zimu Han Blog`，应用设置 ID `4041260`。Homepage 为 `https://hzmsailor.github.io/blog/`，回调为 `https://coqojtfkateioxsoeugn.supabase.co/auth/v1/callback`。Client Secret 只配置到 Supabase GitHub provider。
6. Supabase Site URL：`https://hzmsailor.github.io/blog/`；Redirect URLs 只加入精确地址 `https://hzmsailor.github.io/blog/auth/callback/`。
7. 通知使用 Gmail SMTP（`smtp.gmail.com:465`，TLS）。在 Edge Functions Secrets 设置 `BLOG_SMTP_USER` 为发件 Gmail 地址、`BLOG_SMTP_PASSWORD` 为 Gmail 应用专用密码。不要使用 Gmail 日常登录密码，不要在聊天或仓库中保存应用密码。Google 要求先开启两步验证；应用密码需要由账号所有者亲自生成和填入。
8. `BLOG_SITE_URL` 默认是 `https://hzmsailor.github.io`。本地验证使用单独测试项目或隔离模拟服务，不扩大生产跨域白名单。

## 邮件可靠性

只有批准会创建邮件记录。数据库中的邮件锁防止并发重复发送，已记录发送成功的通知不会重发。失败保留任务，管理员可以重试。SMTP 在“服务器已接受但客户端断线”等极少数不确定状态下无法保证严格只投递一次，固定 Message-ID 用于关联同一通知。

## 私密文章

迁移包含 `blog_private_posts` 表，每次读取都会查询当前 Friend 权限，撤销后阻止后续读取。目前没有写入私密正文，也没有加入私密文章阅读界面。后续正文、目录和附件必须由受保护服务提供；不能把明文放进公开仓库，或只在前端隐藏链接。

## 检查

- `node --test tests/friend-service.test.mjs`：会话验证、审批权限、拒绝不发信、批准通知和错误反馈。
- `tests/database.test.mjs` 用 PGlite 执行真实 PostgreSQL SQL，检查 RLS、重复申请、审批事务、邮件锁与撤销。将 `@electric-sql/pglite` 安装到独立测试目录，设置 `PGLITE_MODULE` 为其 `dist/index.js` 绝对路径，再运行 Node 测试。
- 前端检查桌面和手机布局。实际 OAuth、SMTP 配置完成后，需要真实测试访客验证一次完整申请、审批和通知。

## 文章维护

在分类下新建文章目录和 `index.html`，参考现有 Example。保留账户栏、导航、CSS 和 auth.js，调整好相对路径；更新分类列表和 Blog 首页的标题、日期与摘要。正式内容移除 Example 标签。
