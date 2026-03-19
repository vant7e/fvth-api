from engine import calculate_bazi

result = calculate_bazi(1998, 3, 18, 14)

print("\n==== RESULT ====")
for k, v in result.items():
    print(k, ":", v)