from lunar_python import Solar

# -----------------------------
# 五行映射（天干）
# -----------------------------
GAN_WUXING = {
    "甲": "wood", "乙": "wood",
    "丙": "fire", "丁": "fire",
    "戊": "earth", "己": "earth",
    "庚": "metal", "辛": "metal",
    "壬": "water", "癸": "water"
}

# -----------------------------
# 地支五行（表层）
# -----------------------------
ZHI_WUXING = {
    "子": "water", "丑": "earth",
    "寅": "wood", "卯": "wood",
    "辰": "earth", "巳": "fire",
    "午": "fire", "未": "earth",
    "申": "metal", "酉": "metal",
    "戌": "earth", "亥": "water"
}

# -----------------------------
# 藏干（关键升级）
# -----------------------------
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

# -----------------------------
# 权重系统（关键）
# -----------------------------
WEIGHTS = {
    "year_gan": 1,
    "month_gan": 1.2,
    "day_gan": 2,      # 日主最重要
    "time_gan": 1,

    "year_zhi": 1,
    "month_zhi": 2,    # 月令最重要
    "day_zhi": 1.5,
    "time_zhi": 1,

    "hidden": 0.5      # 藏干权重
}


def split_ganzhi(gz):
    return gz[0], gz[1]


def normalize_wuxing(wuxing):
    total = sum(wuxing.values())
    if total <= 0:
        return {"wood": 20, "fire": 20, "earth": 20, "metal": 20, "water": 20}
    return {
        "wood": round(wuxing["wood"] / total * 100, 2),
        "fire": round(wuxing["fire"] / total * 100, 2),
        "earth": round(wuxing["earth"] / total * 100, 2),
        "metal": round(wuxing["metal"] / total * 100, 2),
        "water": round(wuxing["water"] / total * 100, 2),
    }


def calculate_bazi(year, month, day, hour, gender="male"):

    # -----------------------------
    # 1️⃣ 时间 → 四柱
    # -----------------------------
    solar = Solar.fromYmdHms(year, month, day, hour, 0, 0)
    lunar = solar.getLunar()

    year_gz = lunar.getYearInGanZhi()
    month_gz = lunar.getMonthInGanZhi()
    day_gz = lunar.getDayInGanZhi()
    time_gz = lunar.getTimeInGanZhi()

    print("四柱:", year_gz, month_gz, day_gz, time_gz)

    # -----------------------------
    # 2️⃣ 拆干支
    # -----------------------------
    year_g, year_z = split_ganzhi(year_gz)
    month_g, month_z = split_ganzhi(month_gz)
    day_g, day_z = split_ganzhi(day_gz)
    time_g, time_z = split_ganzhi(time_gz)

    gans = [year_g, month_g, day_g, time_g]
    zhis = [year_z, month_z, day_z, time_z]

    # -----------------------------
    # 3️⃣ 五行评分（核心升级）
    # -----------------------------
    wuxing = {
        "wood": 0,
        "fire": 0,
        "earth": 0,
        "metal": 0,
        "water": 0
    }

    # 👉 天干（带权重）
    wuxing[GAN_WUXING[year_g]] += WEIGHTS["year_gan"]
    wuxing[GAN_WUXING[month_g]] += WEIGHTS["month_gan"]
    wuxing[GAN_WUXING[day_g]] += WEIGHTS["day_gan"]
    wuxing[GAN_WUXING[time_g]] += WEIGHTS["time_gan"]

    # 👉 地支（带权重）
    wuxing[ZHI_WUXING[year_z]] += WEIGHTS["year_zhi"]
    wuxing[ZHI_WUXING[month_z]] += WEIGHTS["month_zhi"]
    wuxing[ZHI_WUXING[day_z]] += WEIGHTS["day_zhi"]
    wuxing[ZHI_WUXING[time_z]] += WEIGHTS["time_zhi"]

    # 👉 藏干（关键）
    for z in zhis:
        for hidden_g in ZHI_HIDDEN[z]:
            wuxing[GAN_WUXING[hidden_g]] += WEIGHTS["hidden"]

    # -----------------------------
    # 4️⃣ 日主
    # -----------------------------
    day_master = day_g

    return {
        "year": year_gz,
        "month": month_gz,
        "day": day_gz,
        "time": time_gz,
        "gans": gans,
        "zhis": zhis,
        "wuxing": wuxing,
        "normalized": normalize_wuxing(wuxing),
        "day_master": day_master
    }