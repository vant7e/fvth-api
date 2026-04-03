print("START TEST")

from engine import calculate_full_system

cases = [
    (1999, 11, 18, 16),   # 你当前这个 case（火缺）
    (2000, 1, 1, 12),
    (1995, 7, 22, 9),
    (1988, 11, 5, 20),
]

for c in cases:
    print("\n====================")
    print("INPUT:", c)

    result = calculate_full_system(*c)

    print("八字:", result["bazi"])
    print("日主:", result["day_master"], "|", result["day_element"])
    print("强弱:", result["strength"])
    print("用神:", result["yongshen"])
    print("五行:", result["wuxing"])

    # 🔥 新增关键检查
    print("分配:", result.get("allocation", "NO ALLOCATION"))

    beads = result["beads"]

    print("珠子数量:", len(beads))

    # 👉 按元素统计（核心验证）
    count = {}
    for b in beads:
        e = b["element"]
        count[e] = count.get(e, 0) + 1

    print("珠子结构:", count)