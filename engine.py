from lunar_python import Solar
import csv
import os

# -----------------------------
# 五行映射
# -----------------------------
GAN_WUXING = {
    "甲": "wood", "乙": "wood",
    "丙": "fire", "丁": "fire",
    "戊": "earth", "己": "earth",
    "庚": "metal", "辛": "metal",
    "壬": "water", "癸": "water"
}

ZHI_WUXING = {
    "子": "water", "丑": "earth",
    "寅": "wood", "卯": "wood",
    "辰": "earth", "巳": "fire",
    "午": "fire", "未": "earth",
    "申": "metal", "酉": "metal",
    "戌": "earth", "亥": "water"
}

ZHI_HIDDEN = {
    "子": ["癸"],
    "丑": ["己", "癸", "辛"],
    "寅": ["甲", "丙", "戊"],
    "卯": ["乙"],
    "辰": ["戊", "乙", "癸"],
    "巳": ["丙", "戊", "庚"],
    "午": ["丁", "己"],
    "未": ["己", "丁", "乙"],
    "申": ["庚", "壬", "戊"],
    "酉": ["辛"],
    "戌": ["戊", "辛", "丁"],
    "亥": ["壬", "甲"]
}

WEIGHTS = {
    "gan": 1.5,
    "zhi": 1.0,
    "hidden": 0.5
}

# -----------------------------
# 十神（相对日主）
# -----------------------------
TEN_GOD_MAP = {
    "wood": {"wood": "比劫", "fire": "食伤", "earth": "财", "metal": "官杀", "water": "印"},
    "fire": {"fire": "比劫", "earth": "食伤", "metal": "财", "water": "官杀", "wood": "印"},
    "earth": {"earth": "比劫", "metal": "食伤", "water": "财", "wood": "官杀", "fire": "印"},
    "metal": {"metal": "比劫", "water": "食伤", "wood": "财", "fire": "官杀", "earth": "印"},
    "water": {"water": "比劫", "wood": "食伤", "fire": "财", "earth": "官杀", "metal": "印"},
}

TEN_GOD_TO_ELEMENT = {
    "比劫": "wood",
    "食伤": "fire",
    "财": "earth",
    "官杀": "metal",
    "印": "water",
}

# -----------------------------
# 读取珠子库（路径安全版）
# -----------------------------
def load_beads():
    base_dir = os.path.dirname(__file__)
    path = os.path.join(base_dir, "beads_master.csv")

    beads = []
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if int(row.get("allowed", 1)) == 1:
                beads.append(row)
    return beads

# -----------------------------
# 五行计算
# -----------------------------
def compute_wuxing(gans, zhis):
    wuxing = {"wood":0,"fire":0,"earth":0,"metal":0,"water":0}

    for g in gans:
        wuxing[GAN_WUXING[g]] += WEIGHTS["gan"]

    for z in zhis:
        wuxing[ZHI_WUXING[z]] += WEIGHTS["zhi"]

        for hidden in ZHI_HIDDEN[z]:
            wuxing[GAN_WUXING[hidden]] += WEIGHTS["hidden"]

    return wuxing

# -----------------------------
def normalize(wuxing):
    total = sum(wuxing.values())
    return {k: round(v/total*100,2) for k,v in wuxing.items()}

# -----------------------------
def compute_ten_gods(day_master, gans, zhis):
    day_element = GAN_WUXING[day_master]
    counts = {"比劫": 0, "食伤": 0, "财": 0, "官杀": 0, "印": 0}

    for g in gans:
        e = GAN_WUXING[g]
        counts[TEN_GOD_MAP[day_element][e]] += 10

    for z in zhis:
        e = ZHI_WUXING[z]
        counts[TEN_GOD_MAP[day_element][e]] += 6

        for hidden in ZHI_HIDDEN[z]:
            e = GAN_WUXING[hidden]
            counts[TEN_GOD_MAP[day_element][e]] += 3

    return counts

# -----------------------------
def judge_strength(day_element, wuxing):
    support_map = {
        "wood": ["wood", "water"],
        "fire": ["fire", "wood"],
        "earth": ["earth", "fire"],
        "metal": ["metal", "earth"],
        "water": ["water", "metal"]
    }

    support = sum(wuxing[e] for e in support_map[day_element])
    total = sum(wuxing.values())
    ratio = support / total

    # NEW: detect extreme imbalance
    min_element_value = min(wuxing.values())

    if min_element_value < total * 0.08:
        return "imbalanced"

    if ratio > 0.6:
        return "strong"
    elif ratio < 0.4:
        return "weak"
    else:
        return "balanced"

# -----------------------------
def get_yongshen(day_element, strength, wuxing, ten_gods):

    generate = {
        "wood": "fire",
        "fire": "earth",
        "earth": "metal",
        "metal": "water",
        "water": "wood"
    }

    control = {
        "wood": "metal",
        "fire": "water",
        "earth": "wood",
        "metal": "fire",
        "water": "earth"
    }

    produce_me = {
        "wood": "water",
        "fire": "wood",
        "earth": "fire",
        "metal": "earth",
        "water": "metal"
    }

    if strength == "imbalanced":
        weakest_god = min(ten_gods, key=ten_gods.get)
        return {
            "primary": [TEN_GOD_TO_ELEMENT[weakest_god]],
            "secondary": []
        }

    if strength == "weak":
        return {
            "primary": [day_element, produce_me[day_element]],
            "secondary": [generate[day_element]]
        }

    elif strength == "strong":
        return {
            "primary": [control[day_element], generate[day_element]],
            "secondary": [produce_me[day_element]]
        }

    else:
        return {
            "primary": [],
            "secondary": []
        }

# -----------------------------
# 五行分配（NEW）
# -----------------------------
def allocate_elements(yongshen, normalized, total=24):

    allocation = {e: 0 for e in normalized.keys()}

    primary = yongshen["primary"]

    # Main element gets 50%
    if primary:
        main = primary[0]
        allocation[main] = int(total * 0.5)

    remaining = total - sum(allocation.values())

    others = [e for e in normalized.keys() if e not in primary]

    total_weight = sum(normalized[e] for e in others)

    for e in others:
        allocation[e] = round(
            normalized[e] / total_weight * remaining
        )

    diff = total - sum(allocation.values())
    if diff != 0 and primary:
        allocation[primary[0]] += diff

    return allocation


# -----------------------------
# 按元素选珠（NEW）
# -----------------------------
def pick_beads_by_allocation(beads, allocation):

    result = []

    for element, count in allocation.items():
        candidates = [b for b in beads if b["element_primary"] == element]

        while len(candidates) < count and candidates:
            candidates.extend(candidates)

        # Full CSV rows as loaded (single source of truth)
        result.extend(candidates[:count])

    return result


# -----------------------------
def recommend_beads(beads, yongshen, normalized, total=24):

    scored = []

    for b in beads:
        score = 1

        if b["element_primary"] in yongshen["primary"]:
            score += 3
        elif b.get("element_secondary") and b["element_secondary"] in yongshen["primary"]:
            score += 2
        elif b["element_primary"] in yongshen["secondary"]:
            score += 1

        deficit = 100 - normalized[b["element_primary"]]
        score += deficit / 50

        scored.append((b, score))

    scored.sort(key=lambda x: x[1], reverse=True)

    return [row for row, _ in scored[:total]]

# -----------------------------
# 主函数
# -----------------------------
def calculate_full_system(year, month, day, hour):

    solar = Solar.fromYmdHms(year, month, day, hour, 0, 0)
    lunar = solar.getLunar()

    year_gz = lunar.getYearInGanZhi()
    month_gz = lunar.getMonthInGanZhi()
    day_gz = lunar.getDayInGanZhi()
    time_gz = lunar.getTimeInGanZhi()

    gans = [year_gz[0], month_gz[0], day_gz[0], time_gz[0]]
    zhis = [year_gz[1], month_gz[1], day_gz[1], time_gz[1]]

    wuxing = compute_wuxing(gans, zhis)
    normalized = normalize(wuxing)

    day_master = gans[2]
    day_element = GAN_WUXING[day_master]

    strength = judge_strength(day_element, wuxing)
    ten_gods = compute_ten_gods(day_master, gans, zhis)
    yongshen = get_yongshen(day_element, strength, wuxing, ten_gods)

    beads_db = load_beads()

    allocation = allocate_elements(yongshen, normalized)

    beads = pick_beads_by_allocation(beads_db, allocation)

    return {
        "bazi": [year_gz, month_gz, day_gz, time_gz],
        "day_master": day_master,
        "day_element": day_element,
        "strength": strength,
        "wuxing": normalized,
        "normalized": normalized,
        "ten_gods": ten_gods,
        "yongshen": yongshen,
        "allocation": allocation,
        "beads": beads,
    }

# -----------------------------
# CLI（防炸版本）
# -----------------------------
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("year", type=int)
    parser.add_argument("month", type=int)
    parser.add_argument("day", type=int)
    parser.add_argument("hour", type=int)

    args = parser.parse_args()

    result = calculate_full_system(
        args.year,
        args.month,
        args.day,
        args.hour
    )

    print(result)