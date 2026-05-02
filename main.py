import os
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pymongo import MongoClient
from bson import ObjectId
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
            "owner_uid":  uid,
            "name":       "/",
            "path":       "/",
            "parent_path": None,
            "created_at": datetime.utcnow(),
        }},
        upsert=True,
    )


def parent_path(path: str) -> str:
    parts = path.rstrip("/").rsplit("/", 1)
    return "/" if len(parts) <= 1 or parts[0] == "" else parts[0] + "/"


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
        "request":              request,
        "firebase_api_key":     os.getenv("FIREBASE_API_KEY", ""),
        "firebase_auth_domain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
        "firebase_project_id":  os.getenv("FIREBASE_PROJECT_ID", ""),
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


# ── Directory API ─────────────────────────────────────────────────────────
@app.get("/api/directory/list")
async def list_directory(request: Request, path: str = "/"):
    user = require_auth(request)
    uid  = user["uid"]

    subdirs   = list(dirs_col.find({"owner_uid": uid, "parent_path": path}, {"name": 1, "path": 1}))
    file_list = list(files_col.find(
        {"owner_uid": uid, "directory_path": path},
        {"name": 1, "size": 1, "content_type": 1, "created_at": 1, "file_hash": 1},
    ))

    for d in subdirs:
        d["_id"] = str(d["_id"])
    for f in file_list:
        f["_id"] = str(f["_id"])
        if f.get("created_at"):
            f["created_at"] = f["created_at"].isoformat()

    hash_counts: dict = {}
    for f in file_list:
        h = f.get("file_hash", "")
        if h:
            hash_counts[h] = hash_counts.get(h, 0) + 1
    dup_hashes = {h for h, c in hash_counts.items() if c > 1}
    for f in file_list:
        f["is_duplicate"] = f.get("file_hash", "") in dup_hashes

    return {
        "path":       path,
        "parent_path": parent_path(path) if path != "/" else None,
        "directories": subdirs,
        "files":       file_list,
    }


@app.post("/api/directory/create")
async def create_directory(request: Request):
    user = require_auth(request)
    uid  = user["uid"]
    body = await request.json()
    name = body.get("name", "").strip()
    cur  = body.get("parent_path", "/")

    if not name or "/" in name:
        raise HTTPException(status_code=400, detail="Invalid directory name")

    if not dirs_col.find_one({"owner_uid": uid, "path": cur}):
        raise HTTPException(status_code=404, detail="Parent directory not found")

    new_path = f"{cur.rstrip('/')}/{name}/"

    if dirs_col.find_one({"owner_uid": uid, "path": new_path}):
        raise HTTPException(status_code=409, detail="A directory with that name already exists here")

    result = dirs_col.insert_one({
        "owner_uid":  uid,
        "name":       name,
        "path":       new_path,
        "parent_path": cur,
        "created_at": datetime.utcnow(),
    })
    return {"status": "created", "path": new_path, "id": str(result.inserted_id)}


@app.delete("/api/directory/{dir_id}")
async def delete_directory(request: Request, dir_id: str):
    user = require_auth(request)
    uid  = user["uid"]

    try:
        oid = ObjectId(dir_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")

    directory = dirs_col.find_one({"_id": oid, "owner_uid": uid})
    if not directory:
        raise HTTPException(status_code=404, detail="Directory not found")
    if directory["path"] == "/":
        raise HTTPException(status_code=400, detail="Cannot delete root directory")

    path = directory["path"]
    file_count   = files_col.count_documents({"owner_uid": uid, "directory_path": path})
    subdir_count = dirs_col.count_documents({"owner_uid": uid, "parent_path": path})

    if file_count > 0 or subdir_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: directory contains {file_count} file(s) and {subdir_count} subfolder(s)",
        )

    dirs_col.delete_one({"_id": oid, "owner_uid": uid})
    return {"status": "deleted"}
