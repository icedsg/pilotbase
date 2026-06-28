"""Vector DB chunk management — browse, edit, delete, upload."""
import json
import uuid as _uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.connection import DbConnection
from app.services.db_service import db_service

router = APIRouter()


async def _get_conn(connection_id: str, session: AsyncSession) -> DbConnection:
    result = await session.execute(
        select(DbConnection).where(
            DbConnection.id == connection_id,
            DbConnection.is_active == True,  # noqa: E712
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    return conn


# ── Schema ────────────────────────────────────────────────────────────────────

@router.get("/schema")
async def get_schema(
    connection_id: str,
    collection: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    conn = await _get_conn(connection_id, session)
    props = db_service.get_vector_schema(conn, collection)
    return {"properties": props}


# ── Delete ────────────────────────────────────────────────────────────────────

class ChunkDeleteRequest(BaseModel):
    user_anon_id: str
    connection_id: str
    collection: str
    chunk_id: str


@router.delete("/chunk")
async def delete_chunk(
    body: ChunkDeleteRequest,
    session: AsyncSession = Depends(get_session),
):
    conn = await _get_conn(body.connection_id, session)
    try:
        db_service.delete_vector_chunk(conn, body.collection, body.chunk_id)
    except AttributeError:
        raise HTTPException(400, f"{conn.db_type} does not support chunk deletion.")
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# ── Update ────────────────────────────────────────────────────────────────────

class ChunkUpdateRequest(BaseModel):
    user_anon_id: str
    connection_id: str
    collection: str
    chunk_id: str
    properties: dict


@router.patch("/chunk")
async def update_chunk(
    body: ChunkUpdateRequest,
    session: AsyncSession = Depends(get_session),
):
    conn = await _get_conn(body.connection_id, session)
    try:
        db_service.update_vector_chunk(conn, body.collection, body.chunk_id, body.properties)
    except AttributeError:
        raise HTTPException(400, f"{conn.db_type} does not support chunk updates.")
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# ── Upload files as chunks ────────────────────────────────────────────────────

def _text_chunks(text: str, chunk_size: int = 500) -> List[str]:
    """Split text into ~chunk_size-word chunks by paragraph boundaries."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [text.strip()]

    chunks, current, word_count = [], [], 0
    for para in paragraphs:
        words = len(para.split())
        if word_count + words > chunk_size and current:
            chunks.append("\n\n".join(current))
            current, word_count = [para], words
        else:
            current.append(para)
            word_count += words
    if current:
        chunks.append("\n\n".join(current))
    return chunks or [text]


@router.post("/upload")
async def upload_chunks(
    connection_id: str = Form(...),
    collection: str = Form(...),
    user_anon_id: str = Form(...),
    text_field: str = Form("text"),
    files: List[UploadFile] = File(...),
    session: AsyncSession = Depends(get_session),
):
    conn = await _get_conn(connection_id, session)
    created, errors = [], []

    for file in files:
        raw = await file.read()
        filename = file.filename or "unknown"
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "txt"

        chunk_props: List[dict] = []
        try:
            if ext == "json":
                data = json.loads(raw)
                items = data if isinstance(data, list) else [data]
                for i, item in enumerate(items):
                    text = json.dumps(item, ensure_ascii=False) if not isinstance(item, str) else item
                    chunk_props.append({"source": filename, "chunk_index": i, text_field: text})

            elif ext == "csv":
                import csv, io
                reader = csv.DictReader(io.StringIO(raw.decode("utf-8", errors="replace")))
                for i, row in enumerate(reader):
                    text = " | ".join(f"{k}: {v}" for k, v in row.items())
                    chunk_props.append({"source": filename, "chunk_index": i, text_field: text})

            else:
                text = raw.decode("utf-8", errors="replace")
                for i, chunk_text in enumerate(_text_chunks(text)):
                    chunk_props.append({"source": filename, "chunk_index": i, text_field: chunk_text})

        except Exception as e:
            errors.append({"file": filename, "error": str(e)})
            continue

        for props in chunk_props:
            try:
                chunk_id = db_service.create_vector_chunk(conn, collection, props)
                created.append({"file": filename, "id": chunk_id})
            except Exception as e:
                errors.append({"file": filename, "error": str(e)})

    return {"created": len(created), "errors": errors}
