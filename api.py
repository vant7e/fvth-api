import base64
import json
import re
from pathlib import Path
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from engine import calculate_full_system

_BAZI_DIR = Path(__file__).resolve().parent
_BEADS_DIR = _BAZI_DIR / "beads"
_BEADS_DIR.mkdir(parents=True, exist_ok=True)

_SAVED_CONFIG_DIR = _BAZI_DIR / "saved_configs"
_SAVED_IMAGES_DIR = _SAVED_CONFIG_DIR / "images"
_SAVED_VIDEOS_DIR = _SAVED_CONFIG_DIR / "videos"
_SAVED_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
_SAVED_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
_SAVED_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

_CONFIG_ID_RE = re.compile(r"^FVTH-[0-9A-F]{5}$")

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


class ConfigRequest(BaseModel):
    """Bracelet save payload from match.html (extra keys e.g. dob / share_code are kept in JSON)."""

    model_config = ConfigDict(extra="allow")

    config_id: str
    birth: Optional[str] = None
    birth_time: Optional[str] = None
    beads: Optional[list[Any]] = Field(default=None)
    index: Optional[str] = None
    price: float = 350.0
    image_base64: Optional[str] = None
    video_base64: Optional[str] = None
    video_mime: Optional[str] = None
    video_url: Optional[str] = None
    image_url: Optional[str] = None


def _merge_config_post_body(body: Any) -> dict[str, Any]:
    """Merge { config_id, data: {...}, ... } into a flat dict for ConfigRequest."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    inner = body.get("data")
    out: dict[str, Any] = {}
    if isinstance(inner, dict):
        out.update(inner)
    for k, v in body.items():
        if k == "data":
            continue
        out[k] = v
    return out


def _validate_config_id(config_id: str) -> str:
    cid = (config_id or "").strip()
    if not _CONFIG_ID_RE.match(cid):
        raise HTTPException(status_code=400, detail="Invalid config_id")
    return cid


def _decode_base64_binary(data: Optional[str]) -> Optional[bytes]:
    if not data or not str(data).strip():
        return None
    s = str(data).strip()
    if "," in s and s.lower().startswith("data:"):
        s = s.split(",", 1)[1]
    try:
        return base64.b64decode(s)
    except Exception:
        return None


def _video_ext_and_media_type(mime: Optional[str]) -> tuple[str, str]:
    m = (mime or "").lower()
    if "mp4" in m:
        return ".mp4", "video/mp4"
    return ".webm", "video/webm"


def _write_preview_video(cid: str, raw: bytes, mime: Optional[str]) -> None:
    ext, _ = _video_ext_and_media_type(mime)
    for other in (".mp4", ".webm"):
        alt = _SAVED_VIDEOS_DIR / f"{cid}{other}"
        if alt.is_file():
            alt.unlink()
    (_SAVED_VIDEOS_DIR / f"{cid}{ext}").write_bytes(raw)


def _find_preview_video(cid: str) -> tuple[Optional[Path], str]:
    for ext, media in ((".mp4", "video/mp4"), (".webm", "video/webm")):
        p = _SAVED_VIDEOS_DIR / f"{cid}{ext}"
        if p.is_file():
            return p, media
    return None, ""


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


def _save_config_core(req: ConfigRequest) -> dict[str, Any]:
    cid = _validate_config_id(req.config_id)
    payload = req.model_dump(mode="json", exclude_none=False)
    payload.pop("image_base64", None)
    payload.pop("video_base64", None)
    payload.pop("video_mime", None)

    vid_bytes = _decode_base64_binary(req.video_base64)
    if vid_bytes:
        _write_preview_video(cid, vid_bytes, req.video_mime)

    img_bytes = _decode_base64_binary(req.image_base64)
    if img_bytes and not vid_bytes:
        (_SAVED_IMAGES_DIR / f"{cid}.png").write_bytes(img_bytes)
    elif vid_bytes and (_SAVED_IMAGES_DIR / f"{cid}.png").is_file():
        try:
            (_SAVED_IMAGES_DIR / f"{cid}.png").unlink()
        except OSError:
            pass

    json_path = _SAVED_CONFIG_DIR / f"{cid}.json"
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"status": "ok", "config_id": cid}


@app.post("/api/config")
def save_config(req: ConfigRequest):
    return _save_config_core(req)


@app.post("/config")
def save_config_post_alias(body: dict[str, Any] = Body(...)):
    """POST { config_id, data: { beads, birth, image_base64?, video_base64?, … } }."""
    merged = _merge_config_post_body(body)
    req = ConfigRequest(**merged)
    return _save_config_core(req)


@app.get("/config")
def config_api_help():
    """Browser GET on /config is not a load — use GET /config/{FVTH-xxxxx} after saving."""
    return {
        "service": "FVTH config API",
        "save": "POST /config — JSON { config_id, data: { …, video_base64? } } (deploy preview video)",
        "load": "GET /config/{config_id} — JSON + video_url / image_url when files exist",
        "why_method_not_allowed": "Opening /config in the address bar sends GET; saving requires POST from your app.",
    }


@app.get("/config/{config_id}/video")
def get_config_video(config_id: str):
    """Stream stored preview video (video/mp4 or video/webm); not JSON."""
    cid = _validate_config_id(config_id)
    path, media = _find_preview_video(cid)
    if not path:
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(path, media_type=media, filename=path.name)


@app.get("/config/{config_id}/image")
def get_config_image(config_id: str):
    cid = _validate_config_id(config_id)
    png_path = _SAVED_IMAGES_DIR / f"{cid}.png"
    if not png_path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(png_path, media_type="image/png")


@app.get("/config/{config_id}")
def get_config(config_id: str, request: Request):
    cid = _validate_config_id(config_id)
    json_path = _SAVED_CONFIG_DIR / f"{cid}.json"
    if not json_path.is_file():
        raise HTTPException(status_code=404, detail="Config not found")
    data = json.loads(json_path.read_text(encoding="utf-8"))
    base = str(request.base_url).rstrip("/")
    if base.startswith("http://"):
        base = base.replace("http://", "https://", 1)

    # Unwrap older nested { config_id, image_url, data } files into flat response
    if isinstance(data.get("data"), dict):
        outer = dict(data)
        inner = dict(outer.pop("data", {}))
        inner["config_id"] = outer.get("config_id", cid)
        if outer.get("image_url") is not None:
            inner["image_url"] = outer.get("image_url")
        data = inner

    data.pop("preview_url", None)

    vpath, _ = _find_preview_video(cid)
    if vpath:
        data["video_url"] = f"{base}/config/{cid}/video"
        data["preview_url"] = data["video_url"]
    elif data.get("video_url"):
        data["preview_url"] = data["video_url"]

    png_path = _SAVED_IMAGES_DIR / f"{cid}.png"
    if png_path.is_file():
        data["image_url"] = f"{base}/config/{cid}/image"
        if "preview_url" not in data:
            data["preview_url"] = data["image_url"]
    elif data.get("image_url") and "preview_url" not in data:
        data["preview_url"] = data["image_url"]

    return data

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
