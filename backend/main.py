"""Personalized Travel Itinerary Planner - FastAPI backend.
Auth: Supabase JWT. DB: Supabase REST (RLS enforced with the user's token). AI: Groq (free tier).
"""
import os, re, json
from datetime import date
from typing import List
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError, field_validator

load_dotenv()
SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_ANON_KEY"]
GROQ_KEY = os.environ["GROQ_API_KEY"]
MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")]

app = FastAPI(title="Travel Itinerary Planner")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])


# ---------- Schemas ----------
class Activity(BaseModel):
    time: str = ""
    type: str = "attraction"  # attraction | food | stay | transport
    name: str = "Activity"
    description: str = ""
    cost: float = 0

    @field_validator("time", "type", "name", "description", mode="before")
    @classmethod
    def to_str(cls, v):
        return "" if v is None else str(v)

    @field_validator("cost", mode="before")
    @classmethod
    def to_num(cls, v):
        try:
            return float(str(v).replace(",", "")) if v is not None else 0
        except ValueError:
            return 0


class DayPlan(BaseModel):
    title: str = ""
    activities: List[Activity]


class Plan(BaseModel):
    days: List[DayPlan]


class TripIn(BaseModel):
    destination: str = Field(min_length=2)
    start_date: date
    end_date: date
    budget: float = Field(gt=0)
    currency: str = "INR"
    travel_style: str = "balanced"
    group_size: int = Field(1, ge=1, le=50)
    interests: List[str] = []
    pace: str = "moderate"
    stay_type: str = "mid-range"


# ---------- Helpers ----------
async def current_user(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(401, "Missing token")
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{SB_URL}/auth/v1/user", headers={"apikey": SB_KEY, "Authorization": authorization})
    if r.status_code != 200:
        raise HTTPException(401, "Invalid or expired token")
    return {"id": r.json()["id"], "auth": authorization}


async def db(method, path, u, body=None, params=None):
    headers = {"apikey": SB_KEY, "Authorization": u["auth"], "Content-Type": "application/json",
               "Prefer": "return=representation"}
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.request(method, f"{SB_URL}/rest/v1/{path}", headers=headers, json=body, params=params)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text)
    return r.json() if r.text else None


async def get_trip(tid, u):
    rows = await db("GET", "trips", u, params={"id": f"eq.{tid}"})
    if not rows:
        raise HTTPException(404, "Trip not found")
    return rows[0]


def num_days(t):
    n = (date.fromisoformat(t["end_date"]) - date.fromisoformat(t["start_date"])).days + 1
    if n < 1 or n > 14:
        raise HTTPException(400, "Trip must be between 1 and 14 days")
    return n


def brief(t):
    return (f"Destination: {t['destination']}. Dates: {t['start_date']} to {t['end_date']}. "
            f"Total budget: {t['budget']} {t['currency']} for {t['group_size']} traveller(s). "
            f"Style: {t['travel_style']}. Pace: {t['pace']}. Stay: {t['stay_type']}. "
            f"Interests: {', '.join(t['interests']) or 'general sightseeing'}.")


SYSTEM = ("You are an expert travel planner. Reply with ONLY a valid JSON object, no markdown, no commentary. "
          "Use real, well-known places. Costs are plain numbers in the trip currency for the whole group. "
          "Keep the whole plan within the budget.")
SHAPE = ('{"title":"short day theme","activities":[{"time":"09:00","type":"attraction|food|stay|transport",'
         '"name":"place or action","description":"one short sentence","cost":0}]}')


def extract_json(text: str):
    text = re.sub(r"```(?:json)?", "", text).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON found in AI reply")
    return json.loads(text[start:end + 1])


async def ask_llm(prompt, model_cls):
    last = None
    for _ in range(3):  # retry up to 3 times
        body = {"model": MODEL, "temperature": 0.6,
                "messages": [{"role": "system", "content": SYSTEM},
                             {"role": "user", "content": prompt}]}
        if "gpt-oss" in MODEL:
            body["reasoning_effort"] = "low"
            body["max_completion_tokens"] = 8000
        else:
            body["max_tokens"] = 6000
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post("https://api.groq.com/openai/v1/chat/completions",
                             headers={"Authorization": f"Bearer {GROQ_KEY}"}, json=body)
        if r.status_code != 200:
            print("GROQ ERROR:", r.status_code, r.text[:500])
            last = r.text[:200]
            continue
        content = r.json()["choices"][0]["message"].get("content") or ""
        try:
            return model_cls.model_validate(extract_json(content))
        except (ValidationError, ValueError) as e:
            print("BAD JSON:", content[:500], e)
            last = e
    raise HTTPException(502, f"AI could not produce a valid itinerary: {str(last)[:200]}")


def day_row(tid, uid, n, d: DayPlan):
    return {"trip_id": tid, "user_id": uid, "day_number": n, "title": d.title,
            "activities": [a.model_dump() for a in d.activities],
            "estimated_cost": sum(a.cost for a in d.activities)}


# ---------- Routes ----------
@app.get("/")
def health():
    return {"status": "ok"}


@app.get("/api/trips")
async def list_trips(u=Depends(current_user)):
    return await db("GET", "trips", u, params={"order": "created_at.desc"})


@app.post("/api/trips")
async def create_trip(t: TripIn, u=Depends(current_user)):
    if t.end_date < t.start_date:
        raise HTTPException(400, "End date must be after start date")
    rows = await db("POST", "trips", u, body={**json.loads(t.model_dump_json()), "user_id": u["id"]})
    return rows[0]


@app.get("/api/trips/{tid}")
async def trip_detail(tid: str, u=Depends(current_user)):
    trip = await get_trip(tid, u)
    days = await db("GET", "itinerary_days", u, params={"trip_id": f"eq.{tid}", "order": "day_number.asc"})
    return {"trip": trip, "days": days}


@app.delete("/api/trips/{tid}")
async def delete_trip(tid: str, u=Depends(current_user)):
    await db("DELETE", "trips", u, params={"id": f"eq.{tid}"})
    return {"ok": True}


@app.post("/api/trips/{tid}/generate")
async def generate(tid: str, u=Depends(current_user)):
    t = await get_trip(tid, u)
    n = num_days(t)
    prompt = (f"{brief(t)}\nCreate a {n}-day itinerary with 4-6 activities per day (mix of attractions, meals, "
              f"transport, and a stay suggestion on day 1). Order activities by time and minimise travel time. "
f"IMPORTANT: the sum of all activity costs across all days must be at most {int(t['budget'] * 0.9)} {t['currency']} "
f"(about {int(t['budget'] * 0.9 / n)} per day).\n"
              f'Return JSON: {{"days":[{SHAPE}]}} with exactly {n} items in "days".')
    plan = await ask_llm(prompt, Plan)
    rows = [day_row(tid, u["id"], i + 1, d) for i, d in enumerate(plan.days[:n])]
    await db("DELETE", "itinerary_days", u, params={"trip_id": f"eq.{tid}"})
    saved = await db("POST", "itinerary_days", u, body=rows)
    return {"days": sorted(saved, key=lambda d: d["day_number"])}


@app.post("/api/trips/{tid}/days/{n}/regenerate")
async def regenerate_day(tid: str, n: int, u=Depends(current_user)):
    t = await get_trip(tid, u)
    days = await db("GET", "itinerary_days", u, params={"trip_id": f"eq.{tid}"})
    others = [a["name"] for d in days if d["day_number"] != n for a in d["activities"]]
    prompt = (f"{brief(t)}\nRewrite ONLY day {n} of the trip with a fresh plan (4-6 activities). "
              f"Do not repeat these places: {', '.join(others) or 'none'}.\nReturn JSON: {SHAPE}")
    d = await ask_llm(prompt, DayPlan)
    row = day_row(tid, u["id"], n, d)
    res = await db("PATCH", "itinerary_days", u, body=row,
                   params={"trip_id": f"eq.{tid}", "day_number": f"eq.{n}"})
    if not res:
        res = await db("POST", "itinerary_days", u, body=row)
    return res[0]


@app.put("/api/trips/{tid}/days/{n}")
async def edit_day(tid: str, n: int, d: DayPlan, u=Depends(current_user)):
    row = day_row(tid, u["id"], n, d)
    res = await db("PATCH", "itinerary_days", u, body=row,
                   params={"trip_id": f"eq.{tid}", "day_number": f"eq.{n}"})
    if not res:
        raise HTTPException(404, "Day not found")
    return res[0]