# >_ Shopping Budget · 双十一购物预算 🛒

双十一想买的东西有点多，于是随手做了个小账本：先比价、再记账，看看钱包还剩多少血条。

一个自用的 **side project**。原生 HTML / CSS / JavaScript，页面收在一个文件里；后来顺手补上了图片上传、GitHub 登录和跨设备同步。🔧

**[🚀 在线打开 → https://jaqenhu.github.io/shopping-budget/#](https://jaqenhu.github.io/shopping-budget/#)**

`single HTML` · `vanilla JS` · `local first` · `GitHub OAuth` · `Supabase`

---

## 🧩 小归小，该有的都有

- **💰 预算血条**：设置总预算，实时看已花费、剩余金额和超支提醒。
- **🔎 展开比价**：一件商品放多个渠道，记录券后价、链接、规格与优惠条件。
- **📸 商品配图**：上传图片、压缩保存，清单里直接预览。
- **↩️ 买了 / 反悔了**：标记购买自动扣预算，撤销购买原路返还。
- **🏷️ 整理清单**：分类标签、搜索、已购 / 待购分组和简单统计。
- **💾 数据带走**：本地保存、JSON 导出与恢复，图片也跟着备份走。
- **☁️ 换个设备接着用**：GitHub 登录后，将自己的清单同步到 Supabase。

> “购买”只是记一笔账，不会在电商平台实际下单。价格和优惠条件需要自己填写。

## ⚡ 打开就用

**在线 + 云同步**

打开上面的在线网址 → GitHub 登录 → 添加商品。换电脑或手机时，打开同一网址、登录同一账号即可。

修改后，等顶部显示 **「已同步至云端」**；另一端刷新页面或切回窗口时，会读取最新记录。不同 GitHub 账号有各自的清单。

**本地 + 离线记账**

下载 `index.html`，直接用浏览器打开。字体、SDK 和页面脚本都已内嵌，日常本地记账无需安装依赖。

本地记录保存在当前浏览器中。首次转到云端时，登录后使用「恢复备份」导入原来的 JSON；其他设备不需要重复导入。

## 💾 关于“存好了”这件事

```text
未登录   → 当前浏览器的 localStorage
已登录   → 当前账号的本地缓存 → Supabase 确认保存
换设备   → 同一网址 + 同一 GitHub 账号 → 读取云端清单
```

- 新账号从空清单开始，示例商品不会自动上传。
- 断网时尽量保留待同步修改，联网后重试；本机缓存失败会明确提示导出备份。
- 多端同时修改时，通过 `revision` 检测冲突，再由你选择保留哪一份。
- 图片随清单存入数据库，并包含在 JSON 备份中。

## 🗂️ 拆开看看

```text
shopping-budget/
├── index.html                    # 📄 可直接打开的完整页面
├── src/
│   ├── sync-engine.js            # 🔄 缓存、重试、版本冲突与账号隔离
│   └── cloud-bridge.js           # 🔌 把页面、GitHub 登录和 Supabase 接起来
├── scripts/embed-runtime.cjs     # 📦 把 SDK 和同步源码嵌回 HTML
├── supabase/schema.sql           # 🔐 按账号隔离的表、权限与更新时间
├── tests/                       # 🧪 保存失败、并发修改等关键场景
├── vendor/                      # 📚 固定版本 SDK 与上游许可证
└── .nojekyll                    # 🚀 GitHub Pages 静态发布
```

页面使用克制的浅色布局、衬线标题和内嵌金额字体；README 负责多放几个符号。`[⌘]`

## 🛠️ 自己部署一份

只想用现成页面，走在线入口就好。想拥有自己的数据库，可以按下面这条路线配置：

1. 创建自己的 Supabase 项目，在 SQL Editor 执行 [`supabase/schema.sql`](supabase/schema.sql)。
2. 修改 [`src/cloud-bridge.js`](src/cloud-bridge.js) 中的 `CLOUD_CONFIG`：填入自己的 Project URL、公开 Publishable Key 和计划发布的网站地址。仓库里现有的是当前在线版的连接配置。
3. 在 GitHub 创建 OAuth App：Homepage URL 填网站地址，回调填 `https://<项目-ref>.supabase.co/auth/v1/callback`。
4. 在 Supabase 的 GitHub Provider 中填入该应用的 Client ID / Client Secret；将 Site URL 和允许跳转的 Redirect URLs 配成网站地址。
5. 执行下面的嵌入命令，把配置和源码更新到 `index.html`。
6. 将文件上传到自己的 GitHub 仓库，Pages 选择 `Deploy from a branch` → `main` → `/(root)`，保存发布。
7. 打开发布后的 HTTPS 网址，登录、导入自己的备份，再换一个浏览器验证。

```sh
node scripts/embed-runtime.cjs
node --test tests/*.test.cjs
```

`src/` 用于维护；发布运行时只需要生成后的 `index.html`。Supabase JS 固定为 **2.118.0**，上游授权文件见 [`vendor/SUPABASE-LICENSE.txt`](vendor/SUPABASE-LICENSE.txt)。

## 🔐 几条底线，留给未来的自己

- 前端使用公开的 **Publishable Key**；访问权限依靠登录认证和数据库 **RLS** 按账号隔离。
- **Client Secret、数据库密码、service_role / secret key** 只留在相应的官方控制台，不进前端、不进仓库。
- 私人预算、导出文件、本地备份和测试截图已在 `.gitignore` 中排除。
- 定期点一下「导出备份」。云同步很方便，自己留一份也很安心。

Supabase 的额度、费用与项目暂停规则以[官方价格页](https://supabase.com/pricing)和[计费文档](https://supabase.com/docs/guides/platform/billing-faq)为准。

---

`/* 随手一做，够用就好。愿清单越来越短，余额撑到最后。 */` 🛒 → 💸 → 🧘
