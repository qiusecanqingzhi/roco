# 自动更新 + 部署指南

这个项目可以做成**全自动**：GitHub 定时跑爬虫 → 重建网页 → 自动发布到公网网址。
你的电脑不用开着，好友随时打开都能看到最新数据。

```
GitHub Actions（定时 或 你点按钮）
        │
        ├─ 1. 比对上游 catalog_version（只读一个 json，几 KB）
        ├─ 2. 有变化才抓取：node tools/sync.mjs（抓取→导出→补图→打包）
        ├─ 3. 自检：富文本标记 + 页面渲染 + 图片齐全
        ├─ 4. git 提交 web/data、web/assets（数据留档，可回溯）
        └─ 5. 发布 dist-share/ 到 GitHub Pages → 得到固定网址
```

关键设计：**上游没变就什么都不做**（`sync.mjs --check` 只请求一次 `manifest.json`），
所以即使每 3 天跑一次，绝大多数运行只花几秒钟，不消耗流量也不占 Actions 额度。

---

## 一次性准备（约 15 分钟）

### 1. 装 Git（你机器上还没有）

```powershell
winget install --id Git.Git -e
# 装完重开一个终端，确认：
git --version
```

### 2. 注册 GitHub，建一个仓库

网页上操作即可：<https://github.com/new>

- 仓库名随意，例如 `roco-dex`
- 建议勾 **Private**（数据和图片来自第三方站点，私有更省心；私有仓库同样能用 Pages）
- 不要勾 "Add a README"

### 3. 把项目推上去

```powershell
cd C:\Users\qiuse\Documents\deepseek-harness\default-workspace\roco-scraper

git init -b main
git add .
git commit -m "chore: 洛克王国图鉴浏览器 + 同步流水线"
git remote add origin https://github.com/<你的用户名>/roco-dex.git
git push -u origin main
```

`.gitignore` 已经把 `out/`、`out-py/`（缓存约 470 MB）和 `dist-share/` 排除，
真正入库的是页面代码 + `web/data`（约 3 MB）+ `web/assets`（2363 张图，42 MB），首次推送约 46 MB。

> 如果首次推送因为文件多而超时，可以多推几次：`git push` 会续传。

### 4. 打开 Pages

仓库 → **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**（不是 Deploy from a branch）。

### 5. 手动触发一次验证

仓库 → **Actions → 同步图鉴数据 → Run workflow**（可选勾 `force` 强制重抓）。

跑完 URL 会显示在这一步的 **deploy** 里，形如：

```
https://<你的用户名>.github.io/roco-dex/
```

之后每周一、四北京时间约 12:17 自动检查更新。

---

## 关于自动更新的几个实情

| 问题 | 实情 |
| --- | --- |
| 多久更新一次？ | 默认周一/四各一次。想改频率就编辑 `.github/workflows/sync.yml` 里的 cron（`分 时 * * 星期`，UTC 时间）。 |
| 上游没更新会怎样？ | 只发一个几 KB 的请求就结束，不抓取、不提交、不发布，几秒跑完。 |
| GitHub 定时任务准吗？ | 高峰期可能延迟几分钟到几十分钟，属正常；要精确就自己点 Run workflow。 |
| 数据会越堆越大吗？ | `web/assets` 只增不减（图片按 catalog 版本命名，新版本会新增文件）。上游大版本更新后想瘦身，可以删掉不再引用的图片再提交。 |
| 会消耗 Actions 额度吗？ | 公开仓库免费无限；私有仓库每月 2000 分钟。本流水线有更新时约 3 分钟一次，无更新时几乎不耗时。 |
| 抓取失败会怎样？ | 该次运行标红并停下，**不会**发布半成品；已有网址保持不变。 |
| 想同步英文/日文？ | Run workflow 时选 `locale`；或在 workflow 里加一个 matrix 一次跑多个语言（注意 `web/data` 只能放一种语言，多语言要先改导出结构）。 |

### ⚠️ 工作流会自己往仓库提交，这会让本地推送被拒

有数据更新时，工作流最后会以 `github-actions[bot]` 身份提交 `web/data`、`web/assets` 并推回仓库。
所以如果你本地也改过东西，`git push` 可能会看到：

```
! [rejected]  main -> main (fetch first)
hint: Updates were rejected because the remote contains work that you do not have locally.
```

这**不是出错**，是远程确实多了东西（bot 的提交）。按提示做即可：

```powershell
git pull --rebase        # 把 bot 的提交拉下来，把你的提交放到它上面
git push
```

如果冲突发生在 `web/data/*.json` 或 `web/data-bundle.js` 这类**生成物**上，不要去手工合并——
直接从源码重新生成，让生成物覆盖掉冲突即可：

```powershell
git checkout --theirs web/data web/data-bundle.js   # 或用 -X ours 合并
node web\export-data.mjs                            # 用源码重新生成
node web\build-share.mjs
git add -A && git commit -m "chore: 重新生成产物"
git push
```

> 想彻底避免这类冲突：本地改完先 `git pull --rebase` 再推；或者干脆不在本地手改数据，
> 只通过 Actions 的 Run workflow 来触发更新。

### 为什么产物里不能放"生成时间"

早期版本在 `web/data/meta.json` 与 `data-bundle.js` 里写了 `generatedAt` 时间戳，
结果是：**每次运行产物都"有变化"，流水线每周都提交一个空改动并重写 2.9 MB 的文件**。
（实测对比过：连续两次运行的差异只有时间戳，591 行数据一个字没变。）

现在产物里只保留上游给的 `catalogVersion` —— 它是"数据是否真的更新"的唯一可靠标志。
往产物里加字段前请想一想：**这个值每次构建都会变吗？会变就不要加。**


---

## 想换成别的托管

流水线本身与托管平台无关，`node tools/sync.mjs` 跑完就有 `dist-share/`：

| 平台 | 做法 |
| --- | --- |
| **Cloudflare Pages**（国内访问通常更快） | 连接同一个 GitHub 仓库，Build command 留空，**Build output directory 填 `dist-share`**。它的定时更新靠自己触发；也可以保留本仓库的 Actions，只把「上传 Pages 产物 + deploy job」删掉，改成在 Actions 里调 Cloudflare 的部署钩子。 |
| **Netlify** | 同上，Publish directory 填 `dist-share`；或用拖拽上传（手动）。 |
| **Vercel** | 同上，Output Directory 填 `dist-share`。 |
| **对象存储（OSS/COS/S3）** | 在 workflow 里加一步 `aws s3 sync dist-share s3://...` 之类的命令。 |
| **只要压缩包** | 不用任何托管：每次同步后从 Actions 的 Artifacts 下载 `dist-share.zip`。 |

> Cloudflare Pages / Netlify 直接在网页上连仓库最省事，缺点是它们的构建环境里跑爬虫要自己配；
> 更稳的组合是「本仓库 Actions 负责抓取并提交数据」+「托管平台监听 main 分支自动重建」。

---

## 本地手动同步（和 CI 完全一样的命令）

```powershell
node .\tools\sync.mjs              # 上游变了就抓，没变就用缓存快速重建
node .\tools\sync.mjs --check      # 只检查版本（退出码 10 = 有更新）
node .\tools\sync.mjs --force      # 强制重抓
node .\tools\sync.mjs --no-share   # 不生成 dist-share/
node .\tools\check-workflow.mjs    # 校验 Actions 工作流有没有写错
```

改过 `.github/workflows/*.yml` 后，本机可以这样校验（避免推到 GitHub 才发现写错）：

```powershell
mkdir .tmp-yamlcheck; cd .tmp-yamlcheck
npm install yaml --cache ./.npmcache     # 只为了解析一次 YAML
cd ..; node .tmp-yamlcheck/decode-workflow.mjs
node .\tools\check-workflow.mjs
```

它会检查：YAML 语法与重复键、cron 格式（并换算成北京时间）、`steps.<id>.outputs` 引用是否存在、
`needs.<job>.outputs` 是否声明、Pages 所需权限是否齐全、action 版本。
