# 双十一购物预算

单文件购物预算工具，支持多渠道比价、购买与撤销、商品图片、本地备份，以及 GitHub 账号云同步。

## 打开方式

`index.html` 内嵌了字体、Supabase SDK 和同步代码，无需构建即可发布到 GitHub Pages。直接打开本地文件可继续使用本地模式；云登录请使用发布后的 HTTPS 网址。

不同浏览器的本地存储互不共享。跨设备记录通过同一个 Supabase 项目和同一个登录账号同步。

## 云同步部署

1. 在 Supabase SQL Editor 执行 `supabase/schema.sql`，开启按账号隔离的行级权限。
2. 在 GitHub 注册 OAuth App，将 Supabase 项目的 `/auth/v1/callback` URL 填入回调地址。
3. 在 Supabase 的 GitHub Provider 中填写 OAuth Client ID / Secret。Secret 只保留在 Supabase 控制台。
4. 将 Supabase Site URL 和允许跳转 URL 设置为实际 GitHub Pages 地址。
5. 在 `src/cloud-bridge.js` 配置公开 Project URL、Publishable Key 和实际站点地址。
6. 执行 `node scripts/embed-runtime.cjs`，将源代码重新嵌入 `index.html`。
7. 启用 GitHub Pages，发布 `main` 分支根目录。
8. 在网页登录后导入原有 JSON 备份，确认同步成功，再用第二个浏览器或设备验证。

公开 Publishable Key 是前端连接标识，数据保护依赖认证和数据库行级权限。不要把数据库密码、service_role、secret key、个人预算备份或本地数据加入仓库。

## 保存行为

- 未登录：仅保存到当前浏览器，失败会明确显示“尚未保存”。
- 已登录：按账号保留本地待同步记录，数据库确认后才显示“已同步至云端”。
- 新账号：不会自动上传默认示例。
- 网络故障：保留修改、支持重试；未可靠保存时提示导出。
- 并发修改：使用版本号检测，发生冲突时不会自动覆盖。
- 图片随记录和 JSON 备份保存，沿用页面的容量限制。

## 本地验证

```text
node --test tests/*.test.cjs
node scripts/embed-runtime.cjs
```

`src/sync-engine.js` 和 `src/cloud-bridge.js` 是维护用源文件；运行时只需要生成后的 `index.html`。

Supabase JS 2.118.0 及其授权文件位于 `vendor/`。预算数据、截图、导出文件和部署前备份均已排除出 Git 跟踪。
