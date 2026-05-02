import os
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pymongo import MongoClient
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Dropbox Clone")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# ── Firebase ──────────────────────────────────────────────────────────────
_cred_path = os.getenv("FIREBASE_CREDENTIALS", "firebase-credentials.json")
firebase_admin.initialize_app(credentials.Certificate(_cred_path))

# ── MongoDB ───────────────────────────────────────────────────────────────
mongo_client = MongoClient(os.getenv("MONGODB_URI", "mongodb://localhost:27017/"))
db           = mongo_client[os.getenv("DB_NAME", "dropbox_clone")]
users_col    = db["users"]
dirs_col     = db["directories"]
files_col    = db["files"]

users_col.create_index("uid", unique=True)
dirs_col.create_index([("owner_uid", 1), ("path", 1)], unique=True)
files_col.create_index([("owner_uid", 1), ("directory_path", 1), ("name", 1)], unique=True)


def ensure_root_dir(uid: str):
    dirs_col.update_one(
        {"owner_uid": uid, "path": "/"},
        {"$setOnInsert": {
            "owner_uid": uid,
            "name": "/",
            "path": "/",
            "parent_path": None,
            "created_at": datetime.utcnow(),
        }},
        upsert=True,
    )


# ── Auth helpers ──────────────────────────────────────────────────────────
def get_current_user(request: Request) -> Optional[dict]:
    token = request.cookies.get("session_token")
    if not token:
        return None
    try:
        return firebase_auth.verify_id_token(token)
    except Exception:
        return None


def require_auth(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


# ── Pages ─────────────────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return RedirectResponse(url="/dashboard" if get_current_user(request) else "/login")


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {
        "request": request,
        "firebase_api_key":    os.getenv("FIREBASE_API_KEY", ""),
        "firebase_auth_domain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
        "firebase_project_id": os.getenv("FIREBASE_PROJECT_ID", ""),
    })


@app.post("/auth/verify")
async def verify_token(request: Request, response: Response):
    body  = await request.json()
    token = body.get("token", "")
    if not token:
        raise HTTPException(status_code=400, detail="Token required")
    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

    uid = decoded["uid"]

    # Create user document on first login
    users_col.update_one(
        {"uid": uid},
        {"$setOnInsert": {
            "uid":          uid,
            "email":        decoded.get("email", ""),
            "display_name": decoded.get("name", decoded.get("email", "")),
            "created_at":   datetime.utcnow(),
        }},
        upsert=True,
    )
    ensure_root_dir(uid)

    response.set_cookie(key="session_token", value=token, httponly=True, samesite="lax", max_age=3600)
    return {"status": "ok", "uid": uid}


@app.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("session_token")
    return {"status": "ok"}


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request):
    user = get_current_user(request)
    if not user:
        return RedirectResponse(url="/login")
    return templates.TemplateResponse("dashboard.html", {
        "request":              request,
        "user_email":           user.get("email", ""),
        "user_name":            user.get("name", user.get("email", "")),
        "firebase_api_key":     os.getenv("FIREBASE_API_KEY", ""),
        "firebase_auth_domain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
        "firebase_project_id":  os.getenv("FIREBASE_PROJECT_ID", ""),
    })
