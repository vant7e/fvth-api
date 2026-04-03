from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from engine import calculate_full_system

_BAZI_DIR = Path(__file__).resolve().parent
_BEADS_DIR = _BAZI_DIR / "beads"
_BEADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class BaziRequest(BaseModel):
    year: int
    month: int
    day: int
    hour: int


def _compute_stability_index(wuxing: dict) -> int:
    deviation = sum(abs(v - 20) for v in wuxing.values())
    return int(100 - (deviation / 160) * 100)


def _resonance_class(stability: int) -> str:
    if stability >= 80:
        return "Highly Stable"
    if stability >= 65:
        return "Mostly Stable"
    if stability >= 50:
        return "Moderate Imbalance"
    if stability >= 35:
        return "Unstable"
    return "Highly Imbalanced"


def _element_bias(wuxing: dict) -> str:
    items = sorted(wuxing.items(), key=lambda x: x[1], reverse=True)
    return f"{items[0][0]} / {items[-1][0]}"


def _bead_image_urls(image_field: str) -> list[str]:
    """Split CSV `image` on |; each path becomes a URL under /beads/ when relative."""
    parts = [p.strip() for p in (image_field or "").split("|") if p.strip()]
    out: list[str] = []
    for p in parts:
        if p.startswith("http://") or p.startswith("https://"):
            out.append(p)
        elif p.startswith("/"):
            out.append(p)
        else:
            out.append(f"/beads/{p}")
    return out


def _format_beads_for_client(raw_beads: list) -> list:
    """Map CSV-backed engine rows to stable API objects (no fabricated fields)."""
    out: list[dict] = []
    for b in raw_beads:
        sec = (b.get("element_secondary") or "").strip()
        urls = _bead_image_urls(b.get("image") or "")
        first = urls[0] if urls else ""
        fn = (b.get("function") or "").strip()
        model_raw = (b.get("model") or "beads").strip()
        row: dict = {
            "id": b["id"],
            "name": b["name_en"],
            "element": b["element_primary"].capitalize(),
            "elementAlt": sec.capitalize() if sec else None,
            "material": b["material"],
            "color": b["color"],
            "image": first,
            "images": urls,
            "description": b["description"],
            "rarity": b["rarity"],
            "level": int(b["level"]),
            "glowColor": b["glow_color"],
            "model": model_raw,
            "type": model_raw,
        }
        if fn:
            row["function"] = fn
        out.append(row)
    return out


@app.post("/bazi")
def get_bazi(req: BaziRequest):
    result = calculate_full_system(
        req.year,
        req.month,
        req.day,
        req.hour,
    )
    wx = result["wuxing"]
    stability = _compute_stability_index(wx)

    profile = {k: float(v) for k, v in wx.items()}

    return {
        "profile": profile,
        "analysis": {
            "resonance_class": _resonance_class(stability),
            "element_bias": _element_bias(wx),
            "stability_index": stability,
        },
        "beads": _format_beads_for_client(result["beads"]),
        # Extras for clients that need full chart / allocation
        "bazi": result["bazi"],
        "allocation": result["allocation"],
        "yongshen": result["yongshen"],
        "strength": result["strength"],
        "day_master": result["day_master"],
        "day_element": result["day_element"],
        "ten_gods": result["ten_gods"],
    }


# --- Same-origin UI for iframe (Wix etc.): explicit files only — never expose *.py ---
@app.get("/")
def ui_root():
    return RedirectResponse(url="/match.html")


def _file_response(path: Path) -> FileResponse:
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path)


@app.get("/match.html", response_class=FileResponse)
def ui_match_html():
    return _file_response(_BAZI_DIR / "match.html")


@app.get("/bead_3d_runtime.js", response_class=FileResponse)
def ui_bead_3d_runtime():
    return _file_response(_BAZI_DIR / "bead_3d_runtime.js")


@app.get("/match_bead_field_engine.js", response_class=FileResponse)
def ui_match_bead_field_engine():
    return _file_response(_BAZI_DIR / "match_bead_field_engine.js")


@app.get("/beads_master.csv", response_class=FileResponse)
def ui_beads_master_csv():
    return _file_response(_BAZI_DIR / "beads_master.csv")


app.mount("/beads", StaticFiles(directory=str(_BEADS_DIR)), name="beads")

_models_dir = _BAZI_DIR / "models"
if _models_dir.is_dir():
    app.mount("/models", StaticFiles(directory=str(_models_dir)), name="models")

_bg_dir = _BAZI_DIR / "bg"
if _bg_dir.is_dir():
    app.mount("/bg", StaticFiles(directory=str(_bg_dir)), name="bg")

_logo_dir = _BAZI_DIR / "logo"
if _logo_dir.is_dir():
    app.mount("/logo", StaticFiles(directory=str(_logo_dir)), name="logo")
