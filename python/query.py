#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""roco.sqlite 查询小工具 —— 演示怎么用抓下来的数据。

用法:
    python query.py                      # 跑一遍自带示例
    python query.py "SELECT * FROM type" # 执行任意 SQL
    python query.py --tables             # 看表结构

只用标准库。数据库路径默认 ../out/roco.sqlite，可用 ROCO_DB 环境变量覆盖。
"""
import os
import sqlite3
import sys
from pathlib import Path

DB = Path(os.environ.get("ROCO_DB", Path(__file__).resolve().parent.parent / "out" / "roco.sqlite"))

EXAMPLES = [
    ("表行数", """
        SELECT 'spirit' AS 表, count(*) AS 行数 FROM spirit
        UNION ALL SELECT 'skill', count(*) FROM skill
        UNION ALL SELECT 'spirit_skill', count(*) FROM spirit_skill
        UNION ALL SELECT 'skill_learner', count(*) FROM skill_learner
        UNION ALL SELECT 'type', count(*) FROM type
        UNION ALL SELECT 'type_matchup', count(*) FROM type_matchup
    """),
    ("果实立方人(#466) 的等级技能", """
        SELECT ss.skill_name AS 技能, ss.unlock_level AS 解锁等级,
               ss.category AS 分类, sk.damage_max AS 威力, sk.energy_cost AS 能耗
        FROM spirit_skill ss
        LEFT JOIN skill sk ON sk.id = ss.skill_id AND sk.locale = ss.locale
        WHERE ss.locale = 'zh-Hans' AND ss.handbook_id = 466 AND ss.source_type = 'level'
        ORDER BY ss.unlock_level
    """),
    ("谁会【飞叶】，分别在几级 / 什么途径学", """
        SELECT spirit_name AS 精灵, source_group AS 途径, unlock_level AS 等级
        FROM skill_learner WHERE locale = 'zh-Hans' AND skill_name = '飞叶'
    """),
    ("种族值最高的 10 只默认形态", """
        SELECT name AS 名称, types AS 系别, base_stat_total AS 种族值总和
        FROM spirit WHERE locale = 'zh-Hans' AND form_id = 1
        ORDER BY base_stat_total DESC LIMIT 10
    """),
    ("克制表：打「火系」效果拔群的系别 (effect=1)", """
        SELECT a.name AS 攻击系, d.name AS 防御系, m.effect AS 效果
        FROM type_matchup m
        JOIN type a ON a.id = m.attacking_type_id AND a.locale = m.locale
        JOIN type d ON d.id = m.defending_type_id AND d.locale = m.locale
        WHERE m.locale = 'zh-Hans' AND d.short_name = '火' AND m.effect = 1
    """),
    ("机械+草 双系精灵（用 json 字段过滤）", """
        SELECT name AS 名称, types AS 系别, base_stat_total AS 种族值总和
        FROM spirit
        WHERE locale = 'zh-Hans' AND form_id = 1
          AND type_ids LIKE '%19%' AND type_ids LIKE '%3%'
        ORDER BY base_stat_total DESC LIMIT 8
    """),
    ("推荐队伍成员速览", """
        SELECT team_name AS 队伍, group_concat(name, ' / ') AS 成员
        FROM team_members GROUP BY team_id, team_name LIMIT 5
    """),
]


def print_table(cur):
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    print("  " + " | ".join(cols))
    print("  " + "-" * max(20, sum(len(str(c)) + 3 for c in cols)))
    for r in rows[:30]:
        print("  " + " | ".join("" if v is None else str(v) for v in r))
    if len(rows) > 30:
        print(f"  … 共 {len(rows)} 行，只显示前 30 行")
    print(f"  （{len(rows)} 行）")


def main():
    # Windows 控制台默认 GBK，中文/符号可能报 UnicodeEncodeError
    for stream in (sys.stdout, sys.stderr):
        try:
            if (getattr(stream, "encoding", "") or "").lower().replace("-", "") != "utf8":
                stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    if not DB.exists():
        sys.exit(f"找不到数据库 {DB}\n先跑 node scrape.mjs 或 python scrape.py 生成它。")
    db = sqlite3.connect(DB)
    db.row_factory = None

    if len(sys.argv) > 1 and sys.argv[1] == "--tables":
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
            print(f"\n[{name}]")
            for c in db.execute(f"PRAGMA table_info({name})"):
                print(f"   {c[1]:<24} {c[2]}")
        return

    if len(sys.argv) > 1:
        print_table(db.execute(" ".join(sys.argv[1:])))
        return

    print(f"数据库: {DB}\n")
    for title, sql in EXAMPLES:
        print(f"── {title}")
        print_table(db.execute(sql))
        print()
    db.close()


if __name__ == "__main__":
    main()
