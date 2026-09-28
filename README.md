# roco.world 数据爬虫 + 图鉴网页

抓取 [roco.world](https://roco.world/zh/)（非官方《洛克王国：世界》图鉴站）的精灵图鉴、技能库、系别克制表、推荐队伍和术语词条，并自带一个**离线可用的网页浏览版**。

- 🕷 **爬虫**：Node / Python 两套等价实现，都只用标准库
- 🖥 **网页**[`web/index.html`](web/index.html)：双击就能用的单页图鉴（搜索 / 筛选 / 排序 / 详情弹窗 / 离线看大图）

| 实现 | 文件 | 运行环境 | 状态 |
| --- | --- | --- | --- |
| Node.js 爬虫 | [`node/scrape.mjs`](node/scrape.mjs) | Node 18+（本机 v24.21.0） | 已实机跑通全量 |
| Python 爬虫 | [`python/scrape.py`](python/scrape.py) | Python 3.9+（本机 3.14.7） | 已实机跑通全量 |
| 网页（纯前端） | [`web/`](web/) | 任意现代浏览器 | 已用 DOM 桩跑通全部视图 |

两套爬虫产出的数据用 [`tools/compare.mjs`](tools/compare.mjs) **逐行逐字段核对过**（9 张表全部一致），可以任选其一。

---

## 先看网页（最省事）

```powershell
# 直接双击打开（离线可用，含图片）
start .\web\index.html

# 数据或页面改动后，重新生成网页数据
node .\web\export-data.mjs      # SQLite -> web/data/*.json + web/data-bundle.js
```

网页功能：

| 页签 | 内容 |
| --- | --- |
| 精灵图鉴 | 466 个默认形态（可勾选显示全部 621 条）· 按系别多选筛选 · 按种族值/速度/技能数排序 · 搜索名称与编号 · 点卡片看六维种族值、被动、形态链、升级/技能石/血脉技能表 |
| 技能库 | 579 个技能 · 按分类（物理/魔法/状态/防御）与系别筛选 · 威力/能耗范围 · 点开看可学精灵（含解锁等级） |
| 系别克制 | 18×18 克制矩阵，绿=克制红=被抵抗，附状态免疫表 |
| 推荐队伍 | 12 支玩家配队，成员可点进详情 |
| 术语 | 54 条状态/机制词条 |

细节：亮/暗色切换、`/` 聚焦搜索、搜索框支持名称模糊匹配（精灵+技能+术语）、图片全部本地化（断网也能看）、手机宽度可用。

部署到静态托管（GitHub Pages / Vercel / 对象存储）时，把 `web/` 整个目录上传即可；页面会优先用 `data-bundle.js`，没有时自动回退到 `data/*.json` 分片加载。

> 注：`data-bundle.js` 是给 `file://` 双击打开用的（浏览器禁止 `file://` 下 fetch 本地 JSON）。托管时若想去掉这 2.8 MB 的单文件包，直接删除它，页面会走 `data/*.json`。

---

## 快速开始（爬虫）

```powershell
# Node 版
node .\node\scrape.mjs                       # 抓全部：精灵+技能+系别+队伍+术语
node .\node\scrape.mjs spirits skills        # 只抓精灵和技能
node .\node\scrape.mjs --all --offline       # 不联网，用缓存重新生成输出
node .\node\scrape.mjs --locale en-US        # 抓英文
node .\node\scrape.mjs --assets -c 8         # 顺便下载图片

# Python 版（命令完全对应）
python .\python\scrape.py --all
python .\python\scrape.py spirits --lang ja-JP

# 查询已抓好的数据（不需要重跑爬虫）
python .\python\query.py                     # 跑一遍内置示例
python .\python\query.py "SELECT * FROM type"
python .\python\query.py --tables            # 看表结构
```

实测耗时（并发 6~8、每请求间隔 120ms，礼貌抓取）：

| 部分 | 数量 | Node 耗时 |
| --- | --- | --- |
| 精灵（列表 + 621 个详情文件） | 621 条 | ~58s |
| 技能（分页 id + 579 个详情） | 579 条 | ~53s |
| 系别 / 克制表 | 18 / 324 | <1s |
| 队伍 / 术语 | 12 / 54 | <1s |
| **全部（冷缓存）** | — | **~2 分钟**、约 1300 个请求、70 MB |
| 全部（`--offline` 重建） | — | ~20s |

全量结果已生成在 [`out/`](out)，可直接查看。

---

## 产出

```
out/
├── roco.sqlite                 # 关系型数据库（9 张表），多语言用 locale 列区分
├── summary-zh-Hans.json        # 本次抓取统计
├── .cache/                     # 原始 JSON 缓存（断点续抓 / --offline）
└── zh-Hans/
    ├── spirits.csv / .jsonl            621 条：编号、名称、双系、六维种族值、被动、进化、获得方式
    ├── spirit_skills.csv / .jsonl    20146 条：精灵 ↔ 技能（含解锁等级、学习途径）
    ├── skills.csv / .jsonl             579 条：能耗、威力、冷却、系别、分类、描述
    ├── skill_learners.csv / .jsonl   12805 条：技能 → 可学精灵（升级 / 技能石 / 血脉）
    ├── types.csv / .jsonl               18 条：系别、颜色、状态免疫
    ├── type_matchups.csv / .jsonl      324 条：18×18 克制表
    ├── teams.csv / team_members.csv     12 支推荐队伍 / 72 个成员
    ├── teams.json                      队伍原始 JSON
    └── glossary.csv / .jsonl            54 条：中毒、灼烧、寄生等词条说明
```

SQLite 里的表与 CSV 一一对应：`spirit`、`skill`、`spirit_skill`、`skill_learner`、`type`、`type_matchup`、`team`、`team_member`、`glossary`。

CSV 带 UTF-8 BOM，Excel 双击直接打开不乱码；JSONL 每行一个对象，适合喂给程序。

> ⚠️ 两点如实说明：
> 1. 站点的队伍数据**只提供成员精灵、血脉和队伍道具，没有每只精灵的技能配置**，所以 `team_member` 里没有技能列——不是漏抓，是源数据没有。
> 2. 文本保留站点原文的全角标点（`，。（）`），没有做任何归一化，避免改动原文语义。

### 字段说明（主要几张表）

**spirits**：`handbook_id` 图鉴编号、`petbase_id` 内部 id、`form_id` 形态（1 为默认形态）、`name`、`form` 形态名、`type_ids`/`types`/`types_short` 系别、`type_count` 系别数、`stat_hp`…`stat_speed` 六维种族值、`base_stat_total` 种族值总和、`passive_skill_name`/`passive_skill_desc` 被动技能、`evolution_stage` 进化阶段、`family` 同族成员、`evolution_routes` 进化路线（JSON）、`egg_groups`/`is_breedable` 蛋组、`skill_count`、`image_url` 等图片直链、`detail_url` 原站地址。

**skills**：`id`、`name`、`category`（物理/魔法/状态/防御）、`damage_type`/`battle_type` 系别、`energy_cost` 能耗、`damage_min`/`damage_max` 威力区间、`cooldown_min`/`cooldown_max` 冷却、`source_types` 学习途径、`learner_count` 可学精灵数、`description` 描述。

**skill_learners**：技能 ↔ 精灵，`source_group` 取 `level_up`（升级）/ `spirit_stone`（技能石）/ `bloodline_elixir`（血脉）。

**team_member**：`team_id`/`team_name`、`seat` 队伍中的位置（1–6）、`name`、`types`、`bloodline` 血脉、`item` 队伍道具。

> 小细节：少数精灵的同一个技能会出现**两条记录、解锁等级不同**（例如 #373 牵线木偶 的「取念」在 Lv1 和 Lv7 各有一条），且 `source_type` 都是 `level`。`spirit_skill` 的主键包含 `source_order`，两条都会保留，不会互相覆盖。

### 用 SQLite 查询示例

```sql
-- 某只精灵的完整技能表（按解锁等级）
SELECT s.name, ss.unlock_level, ss.category, sk.damage_max
FROM spirit_skill ss LEFT JOIN skill sk ON sk.id = ss.skill_id AND sk.locale = ss.locale
JOIN spirit s ON s.handbook_id = ss.handbook_id AND s.form_id = ss.form_id AND s.locale = ss.locale
WHERE ss.locale='zh-Hans' AND ss.handbook_id = 466 ORDER BY ss.unlock_level;

-- 谁会【飞叶】，几级学
SELECT spirit_name, source_group, unlock_level FROM skill_learner
WHERE locale='zh-Hans' AND skill_name='飞叶';

-- 种族值最高的 10 只默认形态
SELECT name, types, base_stat_total FROM spirit
WHERE locale='zh-Hans' AND form_id=1 ORDER BY base_stat_total DESC LIMIT 10;

-- 克制表：打「火系」用什么系
SELECT a.name AS 攻击系, m.effect FROM type_matchup m
JOIN type a ON a.id=m.attacking_type_id AND a.locale=m.locale
JOIN type d ON d.id=m.defending_type_id AND d.locale=m.locale
WHERE m.locale='zh-Hans' AND d.short_name='火' AND m.effect=1;

-- SQLite 里读 JSONL 风格的字段
SELECT name, json_extract(evolution_routes,'$[0].to') FROM spirit WHERE handbook_id=1;
```

`effect` 的取值含义见 `types.csv` 同级的 `effect_values`：`1` 克制、`0` 普通、`-1` 被抵抗。

---

## 抓取原理（为什么这么快）

站点是客户端渲染的 SPA，直接扒 HTML 拿不到结构化数据。实测发现两条可用路径：

1. **静态数据接口**（本爬虫默认走这条，最省流量、最快）
   `/static/manifest.json` 给出目录版本 `catalog_version`，然后：
   - `/static/<ver>/<locale>/spirits.json`、`spirit/<编号>.json`、`spirit/<编号>/form/<形态>.json`
   - `/static/<ver>/<locale>/skill-list/<排序>/all/<页码>.json`（每页 24 个技能 id）+ `skill/<技能id>.json`
   - `/static/<ver>/<locale>/types.json`、`teams.json`、`description_notes.json`
2. **页面内嵌 JSON**：每个 HTML 里都有 `<script id="roco-bootstrap" type="application/json">`，结构与上面一致（可作为兜底，例如接口改路径时）。

数据源是站点自己的前端，**不是官方接口**；`catalog_version` 变化时爬虫会自动发现（缓存以 URL 为键）。

其他实测细节：

- `robots.txt`、`sitemap.xml` 均返回错误/无此路由（不是 200 也不是标准 404 语义），没有爬取限制声明；`?offset=` 这类查询参数会被忽略，翻页是前端切片。
- 站点支持 5 种语言：`zh-Hans`、`en-US`、`vi-VN`、`pt-BR`、`ja-JP`，用 `--locale` 或 `--lang` 切换，数据落在 `out/<locale>/`，SQLite 里靠 `locale` 列区分，互不覆盖。
- 精灵共 466 个图鉴编号，另有 155 个其它形态，共 621 条详情，爬虫会一起抓。

---

## 参数

| Node | Python | 说明 |
| --- | --- | --- |
| `spirits skills types teams glossary` | 同 | 要抓的部分，默认全部 |
| `-l, --locale, --lang <tag>` | `-l/--locale/--lang` | 语言，默认 `zh-Hans` |
| `-o, --out <dir>` | 同 | 输出目录，默认 `out` |
| `-c, --concurrency <n>` | 同 | 并发数，默认 Node 6 / Python 8 |
| `--rate <ms>` | 同 | 同域请求最小间隔，默认 120ms |
| `--timeout <ms>` | `--timeout <秒>` | 单请求超时 |
| `--assets` | 同 | 下载图片（只下数据里引用到的，约数千个 webp） |
| `--offline` | 同 | 只读缓存，不联网 |
| `--fresh` | 同 | 忽略缓存重新下载 |
| `--no-sqlite` | 同 | 不生成 SQLite |
| — | `--insecure-ssl` | 跳过 SSL 校验（公司代理/中间人环境） |

---

## 常见问题

**Q：中途 Ctrl+C 或被杀掉，数据会不会坏？**
输出是"先全抓到内存、再统一写文件"，中断最多丢本次没写完的文件，不会产生半截 JSONL。数据库按表 + `locale` 覆盖写入，所以只跑 `spirits` 不会清空技能表。重跑时缓存命中，`--offline` 秒级重建全部输出。

**Q：断点续抓怎么做？**
直接重跑同一命令即可。所有响应按 URL 缓存在 `out/.cache/`，已下过的不会重复请求。

**Q：Python 版报 SSLCertVerificationError？**
公司代理做了中间人解密时常见。设置环境变量 `ROCO_INSECURE_SSL=1`，或用 `ROCO_CA_BUNDLE` 指定公司根证书，或加 `--insecure-ssl`。（Windows 下 Node 版走系统信任链，一般不会遇到。）

**Q：爬取有什么注意事项？**
这是爱好者站点，别把并发开到几十、别关掉 `--rate`；默认参数全量跑一次约 2 分钟、70 MB，属于温和范围。数据版权属于站点与腾讯，自用研究可以，别二次发布整套数据或图片。

**Q：想抓英文/日文对照？**
```powershell
node .\node\scrape.mjs --all --locale en-US
node .\node\scrape.mjs --all --lang ja-JP
```
SQLite 里就能跨语言对照：
```sql
SELECT z.name AS 中文, e.name AS English FROM spirit z
JOIN spirit e ON e.handbook_id=z.handbook_id AND e.form_id=z.form_id
WHERE z.locale='zh-Hans' AND e.locale='en-US' LIMIT 10;
```

---

## 目录结构

```
roco-scraper/
├── web/                    # 图鉴网页（离线可用，直接双击 index.html）
│   ├── index.html          # 页面骨架
│   ├── app.js              # 全部前端逻辑（零依赖）
│   ├── style.css           # 样式（亮/暗色）
│   ├── data-bundle.js      # 数据单文件包（file:// 用，export-data.mjs 生成）
│   ├── data/*.json         # 同样的数据按需分片（托管用）
│   ├── assets/             # 2363 张本地图片（42 MB，fetch-assets.mjs 下载）
│   ├── export-data.mjs     # SQLite -> 网页 JSON
│   ├── fetch-assets.mjs    # 下载网页图片
│   └── tools/              # 无浏览器环境下的页面测试（DOM 桩）
├── node/scrape.mjs         # Node 版爬虫
├── python/scrape.py        # Python 版爬虫
├── python/query.py         # SQLite 查询小工具（带示例，可执行任意 SQL）
├── tools/verify-db.mjs     # 数据体检：行数、join、克制表抽查
├── tools/compare.mjs       # 两套实现逐行逐字段对比
├── tools/pycheck.mjs       # 没有 Python 时对 scrape.py 做结构检查
└── out/                    # 抓取结果（out-py/ 是 Python 版的对照产物）
```

### 网页相关的常用命令

```powershell
node .\web\export-data.mjs                  # 重新生成网页数据（改了数据库后跑）
node .\web\export-data.mjs --lang en-US     # 导出英文数据到网页
node .\web\fetch-assets.mjs                 # 下载/补齐图片（已有文件会跳过）
node .\web\tools\test-app.mjs               # 页面冒烟测试（视图渲染 + 图片路径）
node .\web\tools\test-app2.mjs              # 筛选/弹窗/富文本/JSON 分片加载测试
node .\tools\chk-markup.mjs                 # 描述富文本标记自检
node .\web\build-share.mjs                  # 打包给好友/上传用的版本
```

### 分享给好友

```powershell
node .\web\build-share.mjs              # 生成 dist-share/ 与 dist-share.zip（可直接上传或发人）
node .\web\build-share.mjs --no-bundle  # 不带 data-bundle.js（体积小 3 MB，但不再支持 file:// 双击）
node .\tools\verify-share.mjs           # 校验分享包：HTTP 可取 + 离线可渲染 + 图片齐全
```

产物 `dist-share/` 只含页面需要的东西（`index.html`/`app.js`/`style.css`/`data/`/`assets/`/`data-bundle.js`），另外附了 `README.txt`（说明 + 版权提示）、`robots.txt` 与 `_headers`（**默认禁止搜索引擎收录**，避免把整份数据与图片扩散成公开镜像）。

三种分享方式：

| 方式 | 好友要做什么 | 适合 |
| --- | --- | --- |
| 发 zip（43 MB） | 解压后双击 `index.html` | 一两个好友，微信/网盘传 |
| 静态托管（推荐） | 打开一个网址 | 多人、手机也能看；Cloudflare Pages / GitHub Pages / Vercel 都可 |
| 同一局域网 | 浏览器打开 `http://<你的IP>:8000/` | 临时给身边人看，但要开防火墙且电脑得开着 |

### 自动更新（GitHub Actions）

仓库里已经带了流水线 [`.github/workflows/sync.yml`](.github/workflows/sync.yml)：每周一、四自动检查上游版本，
**有变化才抓取**，然后自检 → 提交数据 → 发布到 GitHub Pages。上游没变时只发一个几 KB 的请求就结束。

```powershell
node .\tools\sync.mjs              # 本地一键同步（和 CI 跑的是同一个入口）
node .\tools\sync.mjs --check      # 只比对上游版本（退出码 10 = 有更新）
node .\tools\check-workflow.mjs    # 校验 Actions 工作流
```

完整的开通步骤（装 Git、建仓库、开 Pages）、各平台替换方案、以及"多久更新一次/会不会堆大"这些实情，
见 **[DEPLOY.md](DEPLOY.md)**。



站点描述里带标记，直接当字符串打印就会出现"乱码"观感。实测只有两类：

| 原文标记 | 含义 | 网页渲染为 |
| --- | --- | --- |
| `<desc_id=1015>应对状态</>` | 术语链接（1015 → `glossary.note_id`） | 可点小标签，悬停看释义，点击弹词条 |
| `<span fork_road="or">或</>` | 分支选择里的连接词 | 橙色强调的"或" |

处理方式：导出的 `desc` 保留原始富文本给页面渲染（`app.js` 的 `glossaryTag()`），同时导出 `descPlain`（去标记）供搜索与复制使用。被引用的 54 个术语 id 全部能在 `glossary` 表里找到定义；未知标记的兜底是只保留中间文字，不会把 `<...>` 原样露给用户。CSV/JSONL 保持站点原文不改。

## 已修的坑（供参考，避免再踩）

开发过程中实测踩到并修掉的问题，都写在这里备查：

1. **NFKC 归一化会改坏原文**：起初用 `normalize('NFKC')` 清理文本，结果把站点的中文全角标点（`，。：（）`）压成了半角（`,.:()`）。现已改为只处理空白字符。
2. **`CREATE TABLE IF NOT EXISTS` 不改结构**：脚本改过表结构后，旧库里仍是老结构，写入直接报 `table X has no column named Y`；更隐蔽的是**删除旧数据的语句先执行成功、写入才失败**，导致表被清空。现在启动时会做一次结构漂移检查：缺列补列、结构冲突则重建。
3. **SQLite 双引号是标识符**：`DELETE ... WHERE locale="zh-Hans"` 会被当成列名而报错，必须用单引号或参数绑定。
4. **只在部分抓取时不要清空整库**：改为按表 + `locale` 覆盖，跑 `spirits` 不会影响技能表。
5. **Python 控制台是 GBK**：输出 `✓` 会 `UnicodeEncodeError`，脚本启动时会把 stdout/stderr 切到 UTF-8。
6. **站点的队伍数据没有技能配置**：不要凭空造一个空的 `skills` 字段（早期版本就有这个误导性字段，已删除）。
7. **同一图鉴编号有多个形态**：早期用 `handbook_id → form_id` 反查，导致 5 个形态全被标成同一个 `form_id`。现在 `spirit_skill` 直接使用行自带的 `form_id`。
8. **`CREATE TABLE` 的主键也可能变**：只补列不改主键时，重复行会被主键吞掉、`source_order` 还会变成浮点数。结构核对现在连主键一起比，不一致直接重建。
9. **做网页时才发现精灵表少了图片列**：`head_image_url` / `portrait_small_url` 最初没入库，导致卡片图全空（而且我的校验脚本还因为"空值直接跳过"假通过了一轮）。现在两列都入库，校验也改成空值同样报错。
10. **无头浏览器在受限沙箱里起不来**（Edge 报 profile 锁 + mojo 管道拒绝访问），所以页面验证改用 Node + 最小 DOM 桩真正执行 `app.js`，对每个视图断言渲染结果，比截图更可靠。
11. **描述里的标记是"看起来像乱码"的真凶**：`<desc_id=1015>应对状态</>` 这类标记有 1.4 万处，直接打印就成了 `<desc_id=1015>…</>`。第一次统计时我的正则 `/<[^<>\s]{0,60}>/g` 漏掉了**带空格的** `<span fork_road="or">`，差点漏掉第二种标记形态——改成白名单 + 兜底后才覆盖完整（现在有 `tools/chk-markup.mjs` 兜着）。

两套实现的产出用 `node tools/compare.mjs` 逐行逐字段核对，**9 张表当前完全一致**。
