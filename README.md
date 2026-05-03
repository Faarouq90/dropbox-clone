# Dropbox Clone

A simplified Dropbox replica built with FastAPI, MongoDB Atlas, Firebase Authentication, and Azurite (Azure Blob Storage).

## Prerequisites

- Python 3.10+
- [Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) running locally on port 10000
- MongoDB Atlas cluster (or local MongoDB)
- Firebase project with Authentication enabled

## Setup

### 1. Clone and create virtual environment

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:
- `MONGODB_URI` — MongoDB Atlas connection string
- `FIREBASE_CREDENTIALS` — path to your Firebase service account JSON (download from Firebase Console → Project Settings → Service Accounts)
- `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID` — from Firebase Console → Project Settings → General
- `AZURE_STORAGE_CONNECTION_STRING` — set to `UseDevelopmentStorage=true` for Azurite (pre-filled in `.env.example`)

### 4. Start Azurite

```bash
azurite --skipApiVersionCheck
```

### 5. Run the application

```bash
uvicorn main:app --reload --port 8080
```

Open [http://localhost:8080](http://localhost:8080) in your browser. Use `localhost` not `127.0.0.1` — Firebase only authorises the `localhost` origin.

## Features

- **Group 1**: Firebase login/logout, directory create/delete
- **Group 2**: Directory navigation, file upload to Azurite with overwrite confirmation
- **Group 3**: File delete/download, duplicate file detection (current directory)
- **Group 4**: Global duplicate detection, read-only file sharing between accounts
