from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from engine import calculate_bazi


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
    gender: str = "male"


@app.post("/bazi")
def get_bazi(req: BaziRequest):
    result = calculate_bazi(
        req.year,
        req.month,
        req.day,
        req.hour,
        req.gender,
    )
    return result
