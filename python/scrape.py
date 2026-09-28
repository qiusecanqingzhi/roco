#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
roco.world 爬虫 (Python 3.9+，仅用标准库，无需 pip install)
==================================================================
与 ../node/scrape.mjs 功能一致，抓的是站点 SPA 自己使用的公开静态 JSON：

    /static/manifest.json                                    目录版本 / 文件清单
    /static/<ver>/<locale>/spirits.json                      全部精灵列表
    /static/<ver>/<locale>/spirit/<id>.json                  精灵详情
    /static/<ver>/<locale>/spirit/<id>/form/<f>.json         精灵其它形态
    /static/<ver>/<locale>/skill-list/<sort>/all/<page>.json 技能 id 分页
    /static/<ver>/<locale>/skill/<id>.json                   技能详情 + 可学习精灵
    /static/<ver>/<locale>/types.json                        系别 + 克制表
    /static/<ver>/<locale>/teams.json                        推荐队伍
    /static/<ver>/<locale>/description_notes.json            术语 / 状态词条

用法：
    python scrape.py                        # 抓全部
    python scrape.py spirits skills          # 只抓指定部分
    python scrape.py --locale en-US          # zh-Hans | en-US | vi-VN | pt-BR | ja-JP
    python scrape.py --assets                # 顺便下载图片（约 4500 个 webp）
    python scrape.py --offline               # 只用缓存，不联网
    python scrape.py -o out -c 8 --rate 100  # 输出目录 / 并发 / 请求间隔(ms)

产出 out/<locale>/ 下的 CSV + JSONL，以及 out/roco.sqlite（多语言按 locale 列区分）。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sqlite3
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ORIGIN = "https://roco.world"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
PARTS = ["spirits", "skills", "types", "teams", "glossary"]
STAT_KEYS = [
    ("hp", "生命"),
    ("physical_attack", "物攻"),
    ("special_attack", "魔攻"),
    ("physical_defense", "物防"),
    ("special_defense", "魔防"),
    ("speed", "速度"),
]


def norm(s) -> str:
    """清理文本：去掉 &nbsp; 与首尾空白、压缩连续空白。

    注意：这里**不能**做 NFKC/NFKD 归一化 —— 那会把中文全角标点（，。：（））
    压成半角（,.()），改动站点原文。
    """
    if s is None:
        return ""
    return " ".join(str(s).replace("\u00a0", " ").split())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------- HTTP
class Fetcher:
    def __init__(self, out_dir: Path, *, offline=False, fresh=False, retries=3,
                 timeout=20, rate_ms=120, insecure_ssl=False):
        self.cache_dir = out_dir / ".cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.offline = offline
        self.fresh = fresh
        self.retries = retries
        self.timeout = timeout
        self.rate = rate_ms / 1000.0
        self.stats = {"hit": 0, "net": 0, "miss": 0, "bytes": 0}
        self._lock = threading.Lock()
        self._last = 0.0

        if insecure_ssl or os.environ.get("ROCO_INSECURE_SSL") == "1":
            self.ctx = ssl._create_unverified_context()
        else:
            self.ctx = ssl.create_default_context()
            # Windows 上 python.org 版默认用 certifi 捆绑的根证书，一般无需处理；
            # 若公司代理做了中间人解密，可设 ROCO_INSECURE_SSL=1 或指定 ROCO_CA_BUNDLE。
            bundle = os.environ.get("ROCO_CA_BUNDLE")
            if bundle:
                self.ctx.load_verify_locations(bundle)

    # -- 缓存 -----------------------------------------------------------
    def _cache_path(self, url: str) -> Path:
        parts = urllib.parse.urlsplit(url)
        safe = "".join(c if (c.isalnum() or c in "._-") else "_" for c in parts.path + parts.query)
        return self.cache_dir / safe.lstrip("_")

    # -- 限速 -----------------------------------------------------------
    def _throttle(self):
        with self._lock:
            wait = self.rate - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()

    def _request(self, url: str) -> bytes:
        req = urllib.request.Request(
            url, headers={"User-Agent": UA, "Accept": "application/json,text/html;q=0.9,*/*;q=0.8"}
        )
        with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx) as resp:
            return resp.read()

    def get_bytes(self, url: str) -> bytes:
        cp = self._cache_path(url)
        if not self.fresh and cp.exists() and cp.stat().st_size > 0:
            self.stats["hit"] += 1
            return cp.read_bytes()
        if self.offline:
            raise RuntimeError("离线模式下缓存缺失: " + url)
        last_err = None
        for attempt in range(1, self.retries + 1):
            self._throttle()
            try:
                data = self._request(url)
                self.stats["net"] += 1
                self.stats["bytes"] += len(data)
                cp.write_bytes(data)
                return data
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    self.stats["miss"] += 1
                    raise
                last_err = e
            except Exception as e:  # noqa: BLE001 - 网络类异常统一重试
                last_err = e
            if attempt < self.retries:
                time.sleep(0.4 * attempt + random.random() * 0.2)
        raise last_err

    def get_json(self, url: str):
        return json.loads(self.get_bytes(url).decode("utf-8"))

    def download(self, url: str, dest: Path):
        cp = self._cache_path(url)
        if not self.fresh and cp.exists() and cp.stat().st_size > 0:
            self.stats["hit"] += 1
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(cp.read_bytes())
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.get_bytes(url))


# --------------------------------------------------------------------- 解析
def index_types(types_payload: dict) -> dict:
    return {t["id"]: t for t in (types_payload or {}).get("types", [])}


def type_names(ids, by_id: dict) -> str:
    return " / ".join(by_id.get(i, {}).get("name") or f"#{i}" for i in (ids or []))


def spirit_row(d: dict, by_id: dict) -> dict:
    stats = d.get("stats") or {}
    row = {
        "handbook_id": d.get("handbook_id"),
        "petbase_id": d.get("petbase_id"),
        "form_id": d.get("form_id"),
        "name": norm(d.get("name")),
        "form": d.get("form") or "",
        "is_display_petbase": d.get("is_display_petbase"),
        "evolution_stage": d.get("evolution_stage"),
        "type_ids": d.get("unit_types") or [],
        "types": type_names(d.get("unit_types"), by_id),
        "types_short": " ".join(by_id.get(i, {}).get("short_name") or f"#{i}" for i in (d.get("unit_types") or [])),
        "type_count": len(d.get("unit_types") or []),
        "base_stat_total": sum(stats.get(k) or 0 for k, _ in STAT_KEYS),
        "height_min": ((d.get("physical_profile") or {}).get("height_m") or {}).get("min", ""),
        "height_max": ((d.get("physical_profile") or {}).get("height_m") or {}).get("max", ""),
        "weight_min": ((d.get("physical_profile") or {}).get("weight_kg") or {}).get("min", ""),
        "weight_max": ((d.get("physical_profile") or {}).get("weight_kg") or {}).get("max", ""),
        "passive_skill_id": d.get("passive_skill_id") or "",
        "passive_skill_name": (d.get("passive_skills") or [{}])[0].get("name", "") if d.get("passive_skills") else "",
        "passive_skill_desc": (d.get("passive_skills") or [{}])[0].get("description", "") if d.get("passive_skills") else "",
        "egg_groups": " / ".join(g.get("name", "") for g in d.get("egg_groups") or []),
        "is_breedable": 1 if any(g.get("is_breedable") for g in d.get("egg_groups") or []) else 0,
        "family": " / ".join(f"#{m.get('handbook_id')}{m.get('name')}" for m in d.get("family_members") or []),
        "family_count": len(d.get("family_members") or []),
        "evolution_routes": [
            {
                "from": m.get("name"),
                "method": r.get("method") or r.get("kind"),
                "to": (r.get("to") or r.get("target") or {}).get("name"),
                "level": r.get("level"),
            }
            for m in d.get("family_members") or []
            for r in m.get("evolution_routes") or []
        ],
        "skill_count": len(d.get("skills") or []),
        "bloodline_options": [
            (b.get("bloodline") or {}).get("name") or b.get("name", "") for b in d.get("bloodline_options") or []
        ],
        "source_eggs": len((d.get("sources") or {}).get("spirit_eggs") or []),
        "source_fruits": len((d.get("sources") or {}).get("spirit_fruits") or []),
        "image_url": ORIGIN + d["image_url"] if d.get("image_url") else "",
        "head_image_url": ORIGIN + d["head_image_url"] if d.get("head_image_url") else "",
        "portrait_small_url": ORIGIN + d["portrait_small_url"] if d.get("portrait_small_url") else "",
        "detail_url": f"{ORIGIN}/zh/jini/{d.get('handbook_id')}",
    }
    for k, _ in STAT_KEYS:
        row[f"stat_{k}"] = stats.get(k, "")
    return row


def skill_row(s: dict, by_id: dict) -> dict:
    dmg = s.get("damage") if isinstance(s.get("damage"), list) else []
    cd = s.get("cooldown") if isinstance(s.get("cooldown"), list) else []
    learners = s.get("learn_source_spirits") or {}
    return {
        "id": s.get("id"),
        "name": norm(s.get("name")),
        "category": (s.get("skill_category") or {}).get("label") or (s.get("skill_category") or {}).get("key", ""),
        "damage_type_id": s.get("skill_damage_type"),
        "damage_type": by_id.get(s.get("skill_damage_type"), {}).get("name", "") if s.get("skill_damage_type") else "",
        "battle_type_id": s.get("battle_type_id") or "",
        "battle_type": by_id.get(s.get("battle_type_id"), {}).get("name", "") if s.get("battle_type_id") else "",
        "energy_cost": s.get("energy_cost", ""),
        "damage_min": min(dmg) if dmg else "",
        "damage_max": max(dmg) if dmg else "",
        "damage": dmg,
        "power_is_variable": s.get("power_is_variable"),
        "energy_is_variable": s.get("energy_is_variable"),
        "cooldown_min": cd[0] if len(cd) > 0 else "",
        "cooldown_max": cd[1] if len(cd) > 1 else "",
        "target_type": s.get("target_type", ""),
        "target_count": s.get("target_count", ""),
        "source_types": " / ".join(s.get("source_types") or []),
        "is_passive": 1 if s.get("is_passive") else 0,
        "used_by_petbase_count": s.get("used_by_petbase_count", ""),
        "learner_count": sum(len(learners.get(k) or []) for k in ("level_up", "spirit_stone", "bloodline_elixir")),
        "description": norm(s.get("description")),
        "image_url": ORIGIN + s["image_url"] if s.get("image_url") else "",
        "detail_url": f"{ORIGIN}/zh/skills/{s.get('id')}",
    }


def spirit_skill_rows(d: dict, by_id: dict) -> list:
    rows = []
    for sk in d.get("skills") or []:
        dmg = sk.get("damage") if isinstance(sk.get("damage"), list) else []
        rows.append({
            "handbook_id": d.get("handbook_id"),
            "form_id": d.get("form_id"),
            "petbase_id": d.get("petbase_id"),
            "spirit_name": norm(d.get("name")),
            "skill_id": sk.get("id"),
            "skill_name": norm(sk.get("name")),
            "source_type": sk.get("source_type", ""),
            "source_order": sk.get("source_order", ""),
            "unlock_level": sk.get("unlock_level") if sk.get("unlock_level") is not None else "",
            "blood_type": sk.get("blood_type") or "",
            "energy_cost": sk.get("energy_cost", ""),
            "category": (sk.get("skill_category") or {}).get("label", ""),
            "damage_type": by_id.get(sk.get("skill_damage_type"), {}).get("name", "") if sk.get("skill_damage_type") else "",
            "damage_min": min(dmg) if dmg else "",
            "description": norm(sk.get("description")),
        })
    for pk in d.get("passive_skills") or []:
        rows.append({
            "handbook_id": d.get("handbook_id"),
            "form_id": d.get("form_id"),
            "petbase_id": d.get("petbase_id"),
            "spirit_name": norm(d.get("name")),
            "skill_id": pk.get("id"),
            "skill_name": norm(pk.get("name")),
            "source_type": "passive",
            "source_order": pk.get("source_order", ""),
            "unlock_level": "",
            "blood_type": "",
            "energy_cost": pk.get("energy_cost", ""),
            "category": (pk.get("skill_category") or {}).get("label", ""),
            "damage_type": "",
            "damage_min": "",
            "description": norm(pk.get("description")),
        })
    return rows


def skill_learner_rows(s: dict) -> list:
    rows = []
    groups = {"level_up": "level", "spirit_stone": "machine", "bloodline_elixir": "blood"}
    for key, arr in (s.get("learn_source_spirits") or {}).items():
        for sp in arr or []:
            rows.append({
                "skill_id": s.get("id"),
                "skill_name": norm(s.get("name")),
                "handbook_id": sp.get("handbook_id", ""),
                "petbase_id": sp.get("petbase_id", ""),
                "form_id": sp.get("form_id", ""),
                "spirit_name": norm(sp.get("name")),
                "form": sp.get("form") or "",
                "group": key,
                "source_type": sp.get("source_type") or groups.get(key, ""),
                "unlock_level": sp.get("unlock_level") if sp.get("unlock_level") is not None else "",
            })
    return rows


def team_rows(t: dict, by_id: dict) -> tuple:
    """注意：站点的队伍数据只给「成员精灵 + 血脉 + 队伍道具」，没有每只精灵的技能配置。"""
    members = []
    for m in t.get("members") or []:
        sp = m.get("spirit") or {}
        members.append({
            "handbook_id": sp.get("handbook_id", ""),
            "petbase_id": sp.get("petbase_id", ""),
            "name": norm(sp.get("name")),
            "form": sp.get("form") or "",
            "types": " ".join(by_id.get(i, {}).get("short_name") or f"#{i}" for i in (sp.get("unit_types") or [])),
            "variant": m.get("variant", ""),
            "bloodline": (m.get("bloodline") or {}).get("name", ""),
            "item": (t.get("battle_item") or {}).get("name", ""),
        })
    team = {
        "id": t.get("id"),
        "name": norm(t.get("name")),
        "author": norm(t.get("author_credit")),
        "created_date": t.get("created_date", ""),
        "battle_item": (t.get("battle_item") or {}).get("name", ""),
        "member_count": len(members),
        "members": " / ".join(m["name"] for m in members),
        "url": f"{ORIGIN}/zh/teams",
    }
    return team, members


# --------------------------------------------------------------------- 输出
def write_table(out_dir: Path, name: str, rows: list):
    """写出 <name>.jsonl 与 <name>.csv（UTF-8 BOM，Excel 直接可读）。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / f"{name}.jsonl").open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    cols: list = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    with (out_dir / f"{name}.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([_cell(r.get(c)) for c in cols])
    print(f"  {name}: {len(rows)} 行 -> {out_dir / (name + '.csv')}")


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, (list, dict)):
        # 紧凑 JSON，与 Node 版 JSON.stringify 完全一致（["17,18"] 而不是 ["17, 18"]）
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    return v


def build_sqlite(path: Path, locale: str, data: dict):
    """把抓到的数据写进 sqlite；按 locale 覆盖，部分抓取不会清空其它表。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS spirit(
      locale TEXT, handbook_id INT, petbase_id INT, form_id INT, name TEXT, form TEXT,
      evolution_stage INT, type_ids TEXT, types TEXT, type_count INT, stat_hp INT, stat_physical_attack INT,
      stat_special_attack INT, stat_physical_defense INT, stat_special_defense INT, stat_speed INT,
      base_stat_total INT, passive_skill_name TEXT, passive_skill_desc TEXT, egg_groups TEXT,
      family TEXT, skill_count INT, image_url TEXT, head_image_url TEXT, portrait_small_url TEXT,
      detail_url TEXT,
      PRIMARY KEY(locale, handbook_id, form_id));
    CREATE TABLE IF NOT EXISTS skill(
      locale TEXT, id INT, name TEXT, category TEXT, damage_type TEXT, battle_type TEXT,
      energy_cost INT, damage_min INT, damage_max INT, cooldown_min INT, cooldown_max INT,
      is_passive INT, used_by_petbase_count INT, learner_count INT, description TEXT, image_url TEXT,
      PRIMARY KEY(locale, id));
    CREATE TABLE IF NOT EXISTS spirit_skill(
      locale TEXT, handbook_id INT, form_id INT, spirit_name TEXT, skill_id INT, skill_name TEXT,
      source_type TEXT, source_order INT, unlock_level INT, category TEXT, damage_type TEXT, description TEXT,
      PRIMARY KEY(locale, handbook_id, form_id, skill_id, source_type, source_order));
    CREATE TABLE IF NOT EXISTS skill_learner(
      locale TEXT, skill_id INT, skill_name TEXT, handbook_id INT, form_id INT, spirit_name TEXT,
      form TEXT, source_group TEXT, unlock_level INT);
    CREATE TABLE IF NOT EXISTS type(
      locale TEXT, id INT, name TEXT, short_name TEXT, color TEXT, status_immunities TEXT,
      PRIMARY KEY(locale, id));
    CREATE TABLE IF NOT EXISTS type_matchup(
      locale TEXT, attacking_type_id INT, defending_type_id INT, effect INT,
      PRIMARY KEY(locale, attacking_type_id, defending_type_id));
    CREATE TABLE IF NOT EXISTS team(
      locale TEXT, id TEXT, name TEXT, author TEXT, created_date TEXT, battle_item TEXT,
      member_count INT, members TEXT, url TEXT, PRIMARY KEY(locale, id));
    CREATE TABLE IF NOT EXISTS team_member(
      locale TEXT, team_id TEXT, team_name TEXT, seat INT, handbook_id INT, petbase_id INT,
      name TEXT, form TEXT, types TEXT, variant TEXT, bloodline TEXT, item TEXT);
    CREATE TABLE IF NOT EXISTS glossary(
      locale TEXT, note_id INT, note TEXT, description TEXT, used_by_skill_count INT,
      used_by_skills TEXT, icon_key TEXT, PRIMARY KEY(locale, note_id));
    CREATE TABLE IF NOT EXISTS stat_icons(
      locale TEXT, stat TEXT, label TEXT, display_order INT, image_url TEXT,
      PRIMARY KEY(locale, stat));
    CREATE TABLE IF NOT EXISTS passive_skill(
      locale TEXT, handbook_id INT, form_id INT, skill_id INT, name TEXT, desc TEXT, image_url TEXT,
      PRIMARY KEY(locale, handbook_id, form_id));
    CREATE INDEX IF NOT EXISTS idx_ss ON spirit_skill(locale, handbook_id);
    CREATE INDEX IF NOT EXISTS idx_sl ON skill_learner(locale, skill_id);
    CREATE INDEX IF NOT EXISTS idx_tm ON team_member(locale, team_id);
    """)

    # 表结构漂移处理：CREATE TABLE IF NOT EXISTS 不会改已存在的表。
    # 缺列就补列；两边都有差异就重建（数据能重抓，不值得写迁移），
    # 否则写入时会报 "table X has no column named Y"。
    expected = {
        "spirit": ["handbook_id", "petbase_id", "form_id", "name", "form", "evolution_stage", "type_ids",
                   "types", "type_count", "stat_hp", "stat_physical_attack", "stat_special_attack",
                   "stat_physical_defense", "stat_special_defense", "stat_speed", "base_stat_total",
                   "passive_skill_name", "passive_skill_desc", "egg_groups", "family", "skill_count",
                   "image_url", "head_image_url", "portrait_small_url", "detail_url"],
        "skill": ["id", "name", "category", "damage_type", "battle_type", "energy_cost", "damage_min",
                  "damage_max", "cooldown_min", "cooldown_max", "is_passive", "used_by_petbase_count",
                  "learner_count", "description", "image_url"],
        "spirit_skill": ["handbook_id", "form_id", "spirit_name", "skill_id", "skill_name", "source_type",
                         "source_order", "unlock_level", "category", "damage_type", "description"],
        "skill_learner": ["skill_id", "skill_name", "handbook_id", "form_id", "spirit_name", "form",
                          "source_group", "unlock_level"],
        "team": ["id", "name", "author", "created_date", "battle_item", "member_count", "members", "url"],
        "team_member": ["team_id", "team_name", "seat", "handbook_id", "petbase_id", "name", "form",
                        "types", "variant", "bloodline", "item"],
        "glossary": ["note_id", "note", "description", "used_by_skill_count", "used_by_skills", "icon_key"],
        "stat_icons": ["stat", "label", "display_order", "image_url"],
        "type": ["id", "name", "short_name", "color", "status_immunities"],
        "type_matchup": ["attacking_type_id", "defending_type_id", "effect"],
    }
    create_sql = {name: f"CREATE TABLE IF NOT EXISTS {name}(" + ", ".join(["locale TEXT"] + cols) + ")"
                  for name, cols in expected.items()}
    # 各表期望的主键（PRAGMA table_info 的 pk 列）。老库少了主键列时，
    # 只补列仍然会把重复行吞掉，必须重建。
    pk_of = {
        "spirit": ["locale", "handbook_id", "form_id"],
        "skill": ["locale", "id"],
        "spirit_skill": ["locale", "handbook_id", "form_id", "skill_id", "source_type", "source_order"],
        "team": ["locale", "id"],
        "glossary": ["locale", "note_id"],
        "stat_icons": ["locale", "stat"],
        "type": ["locale", "id"],
        "type_matchup": ["locale", "attacking_type_id", "defending_type_id"],
    }
    for table, want in expected.items():
        info = list(db.execute(f"PRAGMA table_info({table})"))
        cur = [r[1] for r in info]
        want_all = ["locale"] + want
        missing = [c for c in want_all if c not in cur]
        extra = [c for c in cur if c not in want_all]
        pk_now = [r[1] for r in sorted([r for r in info if r[5] > 0], key=lambda r: r[5])]
        pk_want = pk_of.get(table, [])
        pk_changed = pk_now != pk_want
        if not missing and not pk_changed:
            continue
        if extra or pk_changed:
            db.execute(f"DROP TABLE {table}")
            db.execute(create_sql[table])
            print(f"  · {table} 结构变了，已重建{'' if not pk_changed else '（主键 ' + ('+'.join(pk_now) or '无') + ' → ' + '+'.join(pk_want) + '）'}")
        else:
            for c in missing:
                db.execute(f"ALTER TABLE {table} ADD COLUMN {c} INT")
                print(f"  · {table} 补列 {c}")

    def replace(table: str):
        db.execute(f"DELETE FROM {table} WHERE locale=?", (locale,))

    def ins(table: str, cols: list, rows: list, transform=None):
        """写入前先清掉当前 locale 的旧数据，避免部分抓取把整张表清空。

        cols   : 除 locale 之外的列名
        transform: {列名: 函数} —— 对特定列做类型转换（例如空串 -> NULL）
        """
        if not rows:
            return
        replace(table)
        transform = transform or {}

        def value(r, c):
            if c in transform:
                return transform[c](r.get(c))
            return _cell(r.get(c))

        all_cols = ["locale"] + list(cols)
        db.executemany(
            f"INSERT OR REPLACE INTO {table}({','.join(all_cols)}) VALUES ({','.join('?' * len(all_cols))})",
            [[locale] + [value(r, c) for c in cols] for r in rows],
        )

    blank_to_null = lambda v: None if v in ("", None) else v  # noqa: E731

    spirit_cols = ["handbook_id", "petbase_id", "form_id", "name", "form", "evolution_stage", "type_ids",
                   "types", "type_count", "stat_hp", "stat_physical_attack", "stat_special_attack",
                   "stat_physical_defense", "stat_special_defense", "stat_speed", "base_stat_total",
                   "passive_skill_name", "passive_skill_desc", "egg_groups", "family", "skill_count",
                   "image_url", "head_image_url", "portrait_small_url", "detail_url"]
    ins("spirit", spirit_cols, data.get("spirits", []))

    skill_cols = ["id", "name", "category", "damage_type", "battle_type", "energy_cost", "damage_min",
                  "damage_max", "cooldown_min", "cooldown_max", "is_passive", "used_by_petbase_count",
                  "learner_count", "description", "image_url"]
    ins("skill", skill_cols, data.get("skills", []))

    # spirit_skill 带 form_id（行在解析时就带上了），CSV 里也保留这一列
    ss_cols = ["handbook_id", "form_id", "spirit_name", "skill_id", "skill_name", "source_type",
               "source_order", "unlock_level", "category", "damage_type", "description"]
    ins("spirit_skill", ss_cols, data.get("spirit_skills", []),
        transform={"unlock_level": blank_to_null, "source_order": blank_to_null})

    # 技能 -> 可学精灵：source_group 列名是 group
    for r in data.get("skill_learners", []):
        r["source_group"] = r.get("group", "")
    sl_cols = ["skill_id", "skill_name", "handbook_id", "form_id", "spirit_name", "form", "source_group", "unlock_level"]
    ins("skill_learner", sl_cols, data.get("skill_learners", []),
        transform={"unlock_level": blank_to_null})

    # 系别与克制表永远从 types.json 写，保证任何部分抓取后都可用
    type_cols = ["id", "name", "short_name", "color", "status_immunities"]
    ins("type", type_cols, data.get("types", []))
    if data.get("matchups"):
        replace("type_matchup")
        db.executemany(
            "INSERT OR REPLACE INTO type_matchup(locale,attacking_type_id,defending_type_id,effect) VALUES(?,?,?,?)",
            [(locale, m["attacking_type_id"], m["defending_type_id"], m["effect"]) for m in data["matchups"]],
        )

    # 队伍 / 术语
    team_cols = ["id", "name", "author", "created_date", "battle_item", "member_count", "members", "url"]
    ins("team", team_cols, data.get("teams", []))
    tm_cols = ["team_id", "team_name", "seat", "handbook_id", "petbase_id", "name", "form", "types",
               "variant", "bloodline", "item"]
    ins("team_member", tm_cols, data.get("team_members", []))
    g_cols = ["note_id", "note", "description", "used_by_skill_count", "used_by_skills", "icon_key"]
    ins("glossary", g_cols, data.get("glossary", []))
    si_cols = ["stat", "label", "display_order", "image_url"]
    ins("stat_icons", si_cols, data.get("stat_icons", []))
    ps_cols = ["handbook_id", "form_id", "skill_id", "name", "desc", "image_url"]
    ins("passive_skill", ps_cols, data.get("passive_skills", []))

    db.commit()
    db.close()


# --------------------------------------------------------------------- 主流程
def main(argv=None):
    # Windows 控制台默认是 GBK，输出 ✓ / → 这类字符会 UnicodeEncodeError
    for stream in (sys.stdout, sys.stderr):
        try:
            if (getattr(stream, "encoding", "") or "").lower().replace("-", "") != "utf8":
                stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):  # 被重定向/不支持时忽略
            pass

    ap = argparse.ArgumentParser(
        description="roco.world 数据爬虫（标准库实现）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="部分: " + " | ".join(PARTS),
    )
    ap.add_argument("parts", nargs="*", default=None, help="要抓的部分，默认全部")
    ap.add_argument("--all", action="store_true", help="抓全部（与不写部分相同，便于和 Node 版命令保持一致）")
    ap.add_argument("-l", "--locale", "--lang", dest="locale", default="zh-Hans",
                    help="zh-Hans | en-US | vi-VN | pt-BR | ja-JP")
    ap.add_argument("-o", "--out", default="out", help="输出目录")
    ap.add_argument("-c", "--concurrency", type=int, default=8, help="并发请求数")
    ap.add_argument("--rate", type=int, default=120, help="同域请求最小间隔(ms)")
    ap.add_argument("--timeout", type=int, default=20, help="单请求超时(秒)")
    ap.add_argument("--retries", type=int, default=3, help="失败重试次数")
    ap.add_argument("--assets", action="store_true", help="下载图片资源")
    ap.add_argument("--offline", action="store_true", help="只用缓存，不联网")
    ap.add_argument("--fresh", action="store_true", help="忽略缓存重新下载")
    ap.add_argument("--no-sqlite", action="store_true", help="不生成 sqlite")
    ap.add_argument("--insecure-ssl", action="store_true", help="跳过 SSL 校验（代理/中间人环境）")
    args = ap.parse_args(argv)

    parts = args.parts or list(PARTS)
    for p in parts:
        if p not in PARTS:
            ap.error(f"未知部分 {p!r}，可选: {', '.join(PARTS)}")

    t0 = time.time()
    out_root = Path(args.out)
    fetcher = Fetcher(out_root, offline=args.offline, fresh=args.fresh, retries=args.retries,
                      timeout=args.timeout, rate_ms=args.rate, insecure_ssl=args.insecure_ssl)

    print("· 读取 manifest.json")
    manifest = fetcher.get_json(f"{ORIGIN}/static/manifest.json")
    ver = manifest["catalog_version"]
    locale = args.locale
    if locale not in (manifest.get("locales") or []):
        sys.exit(f"站点不支持 locale {locale!r}，可用: {', '.join(manifest.get('locales') or [])}")
    S = f"{ORIGIN}/static/{ver}/{urllib.parse.quote(locale)}"
    print(f"  catalog_version={ver}  locale={locale}  部分={','.join(parts)}")

    out_dir = out_root / locale
    types_payload = fetcher.get_json(f"{S}/types.json")
    by_id = index_types(types_payload)

    data = {"spirits": [], "skills": [], "spirit_skills": [], "skill_learners": [], "types": [], "matchups": [],
            "teams": [], "team_members": [], "glossary": [], "stat_icons": [], "passive_skills": []}
    summary = {"locale": locale, "catalog_version": ver, "parts": {}}

    # ---- 精灵 --------------------------------------------------------
    if "spirits" in parts:
        print("· 精灵列表")
        listing = fetcher.get_json(f"{S}/spirits.json")
        targets = [r for r in listing["results"] if r.get("is_display_petbase") is not False]
        print(f"  {listing.get('total')} 只（另有形态文件）")

        def fetch_detail(r):
            try:
                return fetcher.get_json(f"{S}/spirit/{r['handbook_id']}.json")
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                raise

        print("· 精灵详情")
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            details = [d for d in pool.map(fetch_detail, targets) if d]
        # 其它形态（同编号不同样子）
        extras = [f for f in manifest.get("spirit_forms", []) if not f.get("is_default")]

        def fetch_form(f):
            try:
                return fetcher.get_json(f"{S}/spirit/{f['handbook_id']}/form/{f['form_id']}.json")
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                raise

        if extras:
            print(f"· 精灵形态 {len(extras)} 个")
            with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
                forms = [d for d in pool.map(fetch_form, extras) if d]
            details = details + forms

        data["spirits"] = [spirit_row(d, by_id) for d in details]
        data["spirit_skills"] = [r for d in details for r in spirit_skill_rows(d, by_id)]
        # 六维图标：每只精灵详情里都带同一份，取第一只有的即可
        with_icons = next((d for d in details if d.get("stat_icons")), None)
        data["stat_icons"] = [{
            "stat": x.get("stat"),
            "label": x.get("label"),
            "display_order": i + 1,
            "image_url": ORIGIN + x["image_url"] if x.get("image_url") else "",
        } for i, x in enumerate((with_icons or {}).get("stat_icons") or [])]
        write_table(out_dir, "spirits", data["spirits"])
        write_table(out_dir, "spirit_skills", data["spirit_skills"])
        if data["stat_icons"]:
            write_table(out_dir, "stat_icons", data["stat_icons"])
        # 被动技能（特性）：带上图标地址，详情页要在特性说明旁显示
        data["passive_skills"] = [{
            "handbook_id": d.get("handbook_id"),
            "form_id": d.get("form_id"),
            "skill_id": p.get("id"),
            "name": p.get("name"),
            "desc": p.get("description") or "",
            "image_url": ORIGIN + p["image_url"] if p.get("image_url") else "",
        } for d in details for p in (d.get("passive_skills") or [])]
        if data["passive_skills"]:
            write_table(out_dir, "passive_skills", data["passive_skills"])
        summary["parts"]["spirits"] = {"count": len(data["spirits"]), "with_detail": len(details)}

    # ---- 技能 --------------------------------------------------------
    if "skills" in parts:
        print("· 技能 id 列表")
        ids, total = [], manifest.get("counts", {}).get(locale, {}).get("skills")
        seen = set()
        for sort in ("energy_desc", "damage_desc", "name_asc"):
            page = 0
            while True:
                try:
                    payload = fetcher.get_json(f"{S}/skill-list/{sort}/all/{page}.json")
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        break
                    raise
                page_ids = payload.get("ids") or []
                if not page_ids:
                    break
                before = len(seen)
                seen.update(page_ids)
                page += 1
                if total and len(seen) >= total:
                    break
                if sort != "energy_desc" and len(seen) == before:
                    break
            if total and len(seen) >= total:
                break
        ids = sorted(seen)
        print(f"  {len(ids)} 个技能 id")

        def fetch_skill(sid):
            try:
                return fetcher.get_json(f"{S}/skill/{sid}.json")
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                raise

        print("· 技能详情")
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            skills = [s for s in pool.map(fetch_skill, ids) if s]
        data["skills"] = [skill_row(s, by_id) for s in skills]
        data["skill_learners"] = [r for s in skills for r in skill_learner_rows(s)]
        write_table(out_dir, "skills", data["skills"])
        write_table(out_dir, "skill_learners", data["skill_learners"])
        summary["parts"]["skills"] = {"count": len(data["skills"])}

    # ---- 系别 / 克制表 -----------------------------------------------
    # 即使没要求抓 types 也先解析好：sqlite 的 type 表与 --assets 的图标都依赖它
    effect_values = types_payload.get("effect_values") or {}
    data["types"] = [{
        "id": t["id"],
        "name": norm(t.get("name")),
        "short_name": t.get("short_name"),
        "color": t.get("color"),
        "display_order": t.get("display_order"),
        "status_immunities": " / ".join(s.get("name", "") for s in t.get("status_immunities") or []),
        "icon_url": ORIGIN + t["type_icon_image_url"] if t.get("type_icon_image_url") else "",
    } for t in types_payload.get("types", [])]
    data["matchups"] = [{
        "attacking_type_id": m["attacking_type_id"],
        "attacking_type": by_id.get(m["attacking_type_id"], {}).get("name", ""),
        "defending_type_id": m["defending_type_id"],
        "defending_type": by_id.get(m["defending_type_id"], {}).get("name", ""),
        "effect": m["effect"],
        "effect_label": next((k for k, v in effect_values.items() if v == m["effect"]),
                             "neutral" if m["effect"] == 0 else ("counter" if m["effect"] > 0 else "resisted")),
    } for m in types_payload.get("matchups", [])]

    if "types" in parts:
        print("· 系别 + 克制表")
        write_table(out_dir, "types", data["types"])
        write_table(out_dir, "type_matchups", data["matchups"])
        summary["parts"]["types"] = {"types": len(data["types"]), "matchups": len(data["matchups"])}

    # ---- 队伍 --------------------------------------------------------
    if "teams" in parts:
        print("· 推荐队伍")
        teams_payload = fetcher.get_json(f"{S}/teams.json")
        teams, members = [], []
        for raw in teams_payload.get("results") or []:
            t, ms = team_rows(raw, by_id)
            teams.append(t)
            members += [dict(team_id=t["id"], team_name=t["name"], seat=seat, **m)
                        for seat, m in enumerate(ms, start=1)]
        data["teams"], data["team_members"] = teams, members
        write_table(out_dir, "teams", teams)
        write_table(out_dir, "team_members", members)
        (out_dir / "teams.json").write_text(
            json.dumps(teams_payload.get("results") or [], ensure_ascii=False, indent=1), encoding="utf-8")
        summary["parts"]["teams"] = {"count": len(teams)}

    # ---- 术语 --------------------------------------------------------
    if "glossary" in parts:
        print("· 术语词条")
        g = fetcher.get_json(f"{S}/description_notes.json")
        rows = [{
            "note_id": n.get("note_id") or n.get("id"),
            "note": norm(n.get("note")),
            "description": norm(n.get("description")),
            "used_by_skill_count": len(n.get("used_by_skills") or []),
            "used_by_skills": " / ".join(s.get("name", "") for s in n.get("used_by_skills") or []),
            "icon_key": n.get("icon_key", ""),
        } for n in g.get("results") or []]
        data["glossary"] = rows
        write_table(out_dir, "glossary", rows)
        summary["parts"]["glossary"] = {"count": len(rows)}

    # ---- 图片 --------------------------------------------------------
    if args.assets:
        print("· 图片资源")
        urls = set()

        def add(u):
            if u and u.startswith(ORIGIN + "/assets/"):
                urls.add(u)

        for r in data["spirits"]:
            add(r["image_url"]); add(r["head_image_url"]); add(r["portrait_small_url"])
        for r in data["skills"]:
            add(r["image_url"])
        for t in data["types"]:
            add(t["icon_url"])
        print(f"  {len(urls)} 个文件")

        def dl(u):
            rel = urllib.parse.unquote(urllib.parse.urlsplit(u).path.replace("/assets/", "", 1))
            try:
                fetcher.download(u, out_dir / "assets" / rel)
            except urllib.error.HTTPError as e:
                if e.code != 404:
                    raise

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            list(pool.map(dl, sorted(urls)))
        summary["parts"]["assets"] = {"count": len(urls)}

    # ---- sqlite ------------------------------------------------------
    if not args.no_sqlite:
        try:
            build_sqlite(out_root / "roco.sqlite", locale, data)
            print("· 已写入 out/roco.sqlite")
        except Exception as e:  # noqa: BLE001
            print(f"· 跳过 sqlite（{e}）")

    summary.update(fetched_at=now_iso(), duration_ms=int((time.time() - t0) * 1000), http=fetcher.stats)
    (out_root / f"summary-{locale}.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")

    s = summary["http"]
    print(f"✓ 完成 {summary['duration_ms'] / 1000:.1f}s  网络 {s['net']} 次 / 缓存 {s['hit']} 次 / "
          f"404 {s['miss']} 次 / 下载 {s['bytes'] / 1048576:.1f} MB\n  输出目录: {out_root.resolve()}")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\n已中断")
