import sys
import os
from fastapi import FastAPI,Response
from fastapi.responses import JSONResponse
from sqlalchemy import text as sql_text
from core.database import engine
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
import uvicorn
from cataloger.routers import ai, person, text, translation, annotation, bdrc, category, enum, tokenize, aligner_data, admin, segments
from outliner.routers import router as outliner_router
from outliner.routers.image_proxy import router as outliner_image_proxy_router
from dedup.routers import router as dedup_router
from outline_fix.routers import router as outline_fix_router
from author_identification.routers import router as author_identification_router
from settings.routers import (
    tenant_router,
    role_router,
    permission_router,
    tenant_settings_router,
    membership_router
)
from user.routers import user_router
from dotenv import load_dotenv
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from mangum import Mangum

# Add project root to the Python path
# sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

load_dotenv( override=True)

app = FastAPI(
    title="OpenPecha Text API",
    version="1.0.0",
    description="API for managing OpenPecha texts and persons",
    servers=[
        {
            "url": "http://localhost:8000",
            "description": "Development server"
        },
        {
            "url": "https://api.buddhistai.tools",
            "description": "Production server"
        },{
            "url":"https://buddhistai-cataloger.onrender.com",
            "description":"dev"
        }
    ]
)


class PayloadSizeIncrease(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only parse form data if it's multipart/form-data and store it in request.state
        # This way endpoints can still access the raw body through FastAPI's dependency injection
        content_type = request.headers.get("content-type", "")
        if "multipart/form-data" in content_type:
            # Store parsed form in request.state, but don't consume the body
            # FastAPI will handle the parsing through its dependency injection
            pass
        return await call_next(request)

app.add_middleware(PayloadSizeIncrease)
# Add this middleware BEFORE CORS middleware
@app.middleware("http")
async def add_utf8_charset(request, call_next):
    response: Response = await call_next(request)

    content_type = response.headers.get("content-type", "")

    # Only apply to text-like responses
    if (
        content_type.startswith("application/json")
        or content_type.startswith("text/")
        or content_type.startswith("application/xml")
        or content_type.startswith("application/javascript")
    ):
        if "charset=" not in content_type.lower():
            response.headers["content-type"] = f"{content_type}; charset=utf-8"

    return response

class AuthorIdentificationGZip:
    """Gzip for Author Identification's responses only: a text from BDRC can be over 1 MB of
    JSON (about 0.2 MB gzipped). Other tools' responses (images, streams) pass untouched."""

    def __init__(self, app):
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=1024)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/author-identification/"):
            await self.gzip(scope, receive, send)
        else:
            await self.app(scope, receive, send)


app.add_middleware(AuthorIdentificationGZip)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(person.router, prefix="/person", tags=["person"])
app.include_router(text.router, prefix="/text", tags=["text"])
app.include_router(bdrc.router, prefix="/bdrc", tags=["bdrc"])
app.include_router(translation.router, prefix="/instances", tags=["translation"])
app.include_router(annotation.router, prefix="/v2/annotations", tags=["annotation"])
app.include_router(segments.router, prefix="/segments", tags=["segments"])
app.include_router(category.router, prefix="/v2/categories", tags=["category"])
app.include_router(enum.router, prefix="/v2/enum", tags=["enum"])
app.include_router(tokenize.router, prefix="/tokenize", tags=["tokenize"])
app.include_router(aligner_data.router, prefix="/aligner-data", tags=["aligner-data"])
app.include_router(admin.router, prefix="/admin", tags=["admin"])

app.include_router(ai.router, prefix="/ai", tags=["ai"])



app.include_router(outliner_router, prefix="/outliner", tags=["outliner"])
app.include_router(outliner_image_proxy_router, prefix="/outliner", tags=["outliner"])
app.include_router(dedup_router, prefix="/dedup", tags=["dedup"])
app.include_router(outline_fix_router, prefix="/outline-fix", tags=["outline-fix"])
app.include_router(author_identification_router, prefix="/author-identification", tags=["author-identification"])


# Settings routes
app.include_router(tenant_router, prefix="/settings/tenants", tags=["settings"])
app.include_router(user_router, prefix="/settings/users", tags=["settings"])
app.include_router(role_router, prefix="/settings/roles", tags=["settings"])
app.include_router(permission_router, prefix="/settings/permissions", tags=["settings"])
app.include_router(tenant_settings_router, prefix="/settings/tenant-settings", tags=["settings"])
app.include_router(membership_router, prefix="/settings/memberships", tags=["settings"])

@app.on_event("startup")
def _start_bdrc_sync_worker():
    """Drain queued BDRC pushes in the background."""
    from outliner.controller.bdrc_sync_worker import start_worker

    start_worker()


@app.on_event("shutdown")
def _stop_bdrc_sync_worker():
    from outliner.controller.bdrc_sync_worker import stop_worker

    stop_worker()


@app.on_event("startup")
def _start_dedup_sync_worker():
    """Push queued dedup decisions to BDRC in the background."""
    from dedup.sync_worker import start_worker

    start_worker()


@app.on_event("shutdown")
def _stop_dedup_sync_worker():
    from dedup.sync_worker import stop_worker

    stop_worker()


@app.on_event("startup")
def _start_author_identification_sync_worker():
    """Send saved Author Identification answers to BDRC in the background."""
    from author_identification.sync_worker import start_worker

    start_worker()


@app.on_event("shutdown")
def _stop_author_identification_sync_worker():
    from author_identification.sync_worker import stop_worker

    stop_worker()


@app.get("/")
def read_root():
    return {"message": "Welcome to the FastAPI backend"}


@app.get("/health")
def health():
    """Liveness + DB check for the uptime cron: 200 when the DB answers, 503 otherwise."""
    try:
        with engine.connect() as conn:
            conn.execute(sql_text("SET LOCAL statement_timeout = 5000"))
            conn.execute(sql_text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "error", "db": "unreachable"})
    return {"status": "ok", "db": "ok"}

if __name__ == "__main__":
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=int(os.getenv("PORT", 8000)), 
        reload=True,
        limit_max_requests=32*1024*1024,
        timeout_keep_alive=600
    )



handler = Mangum(app)