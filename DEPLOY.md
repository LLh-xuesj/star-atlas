# 部署到 GitHub + Cloudflare Pages

## 0. 目录与体积

- **仓库根目录就是本目录**（`识星/`），这样 `index.html` 位于站点根路径；不要把整个 `C:\agent\天文` 工作区推上去。
- 当前体积：代码与数据约 4 MB，`assets/photos` 约 29 MB，合计约 33 MB；没有单个文件接近 Cloudflare Pages 的 25 MB 上限。
- 生成物 `js/data-sky.js`、`js/photos.js` 与 `assets/photos/` 都要提交，Cloudflare 不需要再跑构建。

## 1. 发布前本地检查

```bash
python serve.py 8642
# 打开 http://127.0.0.1:8642/ ，确认四个页签、配图、灯箱、定位都正常
node gen/build.js
```

「关于」页顶部应出现新的 `构建 xxxxxxxx` 版本号。

## 2. 推送到 GitHub

```bash
cd 识星
git init
git add .
git commit -m "识星：星图 + 110 梅西耶 + 15 NGC + 45 张官方配图"
```

在 GitHub 新建一个**空仓库**（不要勾选自动生成 README / .gitignore），然后：

```bash
git branch -M main
git remote add origin git@github.com:<你的用户名>/<仓库名>.git
git push -u origin main
```

> 推送需要你的 GitHub 账号凭证。如果本机 `gh` 已登录，可以先用 `gh repo create <名字> --public --source=. --remote=origin --push`。

## 3. Cloudflare Pages

1. Cloudflare 控制台 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**；
2. 授权并选择刚推送的仓库；
3. 构建配置：
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：**/**
4. **Save and Deploy**。首次部署后会得到 `<项目名>.pages.dev`。
5. 之后每次 `git push` 到 `main` 自动部署；Pull Request 会自动生成预览地址。

## 4. 绑定自定义域名

1. Pages 项目 → **Custom domains** → **Set up a custom domain**；
2. 输入子域名，例如 `stars.example.com`；
3. 如果域名已经托管在 Cloudflare：会自动创建 CNAME 并签发证书；
4. 如果 DNS 在别处：在 DNS 服务商添加 `CNAME stars → <项目名>.pages.dev`；
5. 裸域（`example.com`）不支持直接 CNAME，建议在 Cloudflare 里把 DNS 迁过来，或把裸域 301 到 `www` / 子域名；
6. HTTPS 证书自动签发与续期，无需操作。

## 5. 缓存策略

仓库根目录的 `_headers` 已配置：

- `/`、`/index.html`：`no-cache`（每次拿到最新 HTML）；
- `/assets/*`、`/js/*`、`/style.css`：一年 `immutable`（文件名带内容哈希，脚本带 `?v=` 构建戳）。

Cloudflare Pages 会自动识别 `_headers`，不需要额外配置。

## 6. 日常更新

```bash
node gen/fetch-photos.js     # 只有换图/加图时跑，需要网络；失败会自动停
node gen/build.js            # 更新 data-sky.js 与 index.html 的 ?v=
git add -A
git commit -m "更新配图/数据"
git push
```

## 7. 许可与署名

- **代码**：仓库目前没有附 LICENSE；发布前请自行选择（MIT / Apache-2.0 等），这一步由你决定。
- **图片**：来自 ESA/Hubble 与 NOIRLab，均按 **CC BY 4.0** 使用，必须保留图下 credit 与 `assets/photos/CREDITS.md`；不要删除署名，也不要把图片单独以更严格的条件再授权。
- **数据**：d3-celestial（星表/星座/深空数据），来源与精度见 README。
- 页面内已注明：NASA/ESA/NOIRLab 不对本工具背书。

## 8. 常见问题

| 现象 | 排查 |
| --- | --- |
| 访问 404 | Output directory 必须是 `/`，并且 `index.html` 在仓库根目录 |
| 改了代码页面没变 | HTML 已设 no-cache；仍不生效时在「关于」页核对 `构建 xxxxxxxx`，并强制刷新一次 |
| 图片 404 | 确认 `assets/photos/` 已提交（`.gitignore` 没有把它排除） |
| 图片显示旧版 | 图片文件名含内容哈希，换图会生成新文件；检查 `js/photos.js` 是否一起更新 |
| 部署体积超限 | 当前约 33 MB；Cloudflare Pages 限制为单文件 25 MB、2 万文件，余量充足 |
