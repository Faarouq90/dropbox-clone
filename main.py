import os
from typing import Optional

from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Dropbox Clone")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

_cred_path = os.getenv("FIREBASE_CREDENTIALS", "firebase-credentials.json")
firebase_admin.initialize_app(credentials.Certificate(_cred_path))


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


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return RedirectResponse(url="/dashboard" if get_current_user(request) else "/login")


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {
        "request": request,
        "firebase_api_key": os.getenv("FIREBASE_API_KEY", ""),
        "firebase_auth_domain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
        "firebase_project_id": os.getenv("FIREBASE_PROJECT_ID", ""),
    })


@app.post("/auth/verify")
async def verify_token(request: Request, response: Response):
    body = await request.json()
    token = body.get("token", "")
    if not token:
        raise HTTPException(status_code=400, detail="Token required")
    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))
    response.set_cookie(key="session_token", value=token, httponly=True, samesite="lax", max_age=3600)
    return {"status": "ok", "uid": decoded["uid"]}


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
        "request": request,
        "user_email": user.get("email", ""),
        "user_name": user.get("name", user.get("email", "")),
        "firebase_api_key": os.getenv("FIREBASE_API_KEY", ""),
        "firebase_auth_domain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
        "firebase_project_id": os.getenv("FIREBASE_PROJECT_ID", ""),
    })
