"""
AI controller for text analysis and detection operations.
"""
import os
import re
import json
import uuid
from typing import Optional, List, Dict, Any
from google import genai
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from dotenv import load_dotenv
from utils.clean_tibetan_text import normalise_tibetan_text
from outliner.models.outliner import OutlinerDocument, OutlinerSegment
from cataloger.prompts.ai_prompts import (
    get_title_author_prompt,
    get_title_from_start_prompt,
    get_author_from_end_prompt,
)

load_dotenv(override=True)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_API_MODEL = "gemini-2.5-flash"
# Structured JSON output (response_mime_type/response_schema) only works on v1beta.
# google-genai 3.0 switched its default to "v1", which rejects it with 400 INVALID_ARGUMENT.
GEMINI_API_VERSION = "v1beta"


def _gemini_client() -> genai.Client:
    return genai.Client(
        api_key=GEMINI_API_KEY,
        http_options=genai.types.HttpOptions(api_version=GEMINI_API_VERSION),
    )


def _normalise_title_author_fields(data: Any) -> Dict[str, Optional[str]]:
    if hasattr(data, "model_dump"):
        d = data.model_dump()
    elif isinstance(data, dict):
        d = data
    else:
        d = {
            "title": getattr(data, "title", None),
            "suggested_title": getattr(data, "suggested_title", None),
            "author": getattr(data, "author", None),
            "suggested_author": getattr(data, "suggested_author", None),
        }
    return {
        "title": normalise_tibetan_text(d.get("title")),
        "suggested_title": normalise_tibetan_text(d.get("suggested_title")),
        "author": normalise_tibetan_text(d.get("author")),
        "suggested_author": normalise_tibetan_text(d.get("suggested_author")),
    }


def _normalise_title_only_fields(data: Any) -> Dict[str, Optional[str]]:
    if hasattr(data, "model_dump"):
        d = data.model_dump()
    elif isinstance(data, dict):
        d = data
    else:
        d = {
            "title": getattr(data, "title", None),
            "suggested_title": getattr(data, "suggested_title", None),
        }
    return {
        "title": normalise_tibetan_text(d.get("title")),
        "suggested_title": normalise_tibetan_text(d.get("suggested_title")),
    }


def _normalise_author_only_fields(data: Any) -> Dict[str, Optional[str]]:
    if hasattr(data, "model_dump"):
        d = data.model_dump()
    elif isinstance(data, dict):
        d = data
    else:
        d = {
            "author": getattr(data, "author", None),
            "suggested_author": getattr(data, "suggested_author", None),
        }
    return {
        "author": normalise_tibetan_text(d.get("author")),
        "suggested_author": normalise_tibetan_text(d.get("suggested_author")),
    }


def generate_title_author(content: str, response_schema: Any) -> Dict[str, Optional[str]]:
    """
    Generate title and author from content using Gemini AI.
    
    Args:
        content: The text content to analyze
        response_schema: Pydantic model schema for structured output
        
    Returns:
        Dictionary with title, suggested_title, author, suggested_author
        
    Raises:
        HTTPException: If API key is missing or generation fails
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY environment variable is not set"
        )
    
    # Clip content to first and last 400 characters
    start_clip = content[:400]
    end_clip = content[-400:] if len(content) > 400 else ""
    clipped_content = f"{start_clip}\n{end_clip}" if end_clip else start_clip
    
    try:
        # Initialize the client
        client = _gemini_client()
        
        # Get prompt from prompts module
        prompt = get_title_author_prompt(clipped_content)
        
        # Generate content with structured output using Pydantic schema
        response = client.models.generate_content(
            model=GEMINI_API_MODEL,
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_schema": response_schema,
            }
        )
        
        # Access the parsed response directly
        if hasattr(response, 'parsed') and response.parsed:
            return _normalise_title_author_fields(response.parsed)
        elif hasattr(response, 'text') and response.text:
            # Fallback: parse JSON manually if parsed attribute not available
            result = json.loads(response.text.strip())
            return _normalise_title_author_fields(result)
        else:
            raise HTTPException(
                status_code=500,
                detail="No response received from the model"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating title and author: {str(e)}"
        )


_TITLE_START_MAX_CHARS = 200
_AUTHOR_END_MAX_CHARS = 200


def generate_title_from_start(content: str, response_schema: Any) -> Any:
    """
    Title only: model sees the opening of the segment (first ~2500 characters).
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY environment variable is not set",
        )
    excerpt = content[:_TITLE_START_MAX_CHARS] if content else ""
    if not excerpt.strip():
        raise HTTPException(status_code=400, detail="Content is empty")

    try:
        client = _gemini_client()
        prompt = get_title_from_start_prompt(excerpt)
        response = client.models.generate_content(
            model=GEMINI_API_MODEL,
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_schema": response_schema,
            },
        )
        if hasattr(response, "parsed") and response.parsed:
            return _normalise_title_only_fields(response.parsed)
        if hasattr(response, "text") and response.text:
            result = json.loads(response.text.strip())
            return _normalise_title_only_fields(result)
        raise HTTPException(status_code=500, detail="No response received from the model")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating title: {str(e)}",
        )


def generate_author_from_end(content: str, response_schema: Any) -> Any:
    """
    Author only: model sees the closing of the segment (last ~2500 characters).
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY environment variable is not set",
        )
    if not content or not content.strip():
        raise HTTPException(status_code=400, detail="Content is empty")
    excerpt = (
        content[-_AUTHOR_END_MAX_CHARS:]
        if len(content) > _AUTHOR_END_MAX_CHARS
        else content
    )

    try:
        client = _gemini_client()
        prompt = get_author_from_end_prompt(excerpt)
        response = client.models.generate_content(
            model=GEMINI_API_MODEL,
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_schema": response_schema,
            },
        )
        if hasattr(response, "parsed") and response.parsed:
            return _normalise_author_only_fields(response.parsed)
        if hasattr(response, "text") and response.text:
            result = json.loads(response.text.strip())
            return _normalise_author_only_fields(result)
        raise HTTPException(status_code=500, detail="No response received from the model")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating author: {str(e)}",
        )


def create_segments_from_positions(
    db: Session,
    content: str,
    document_id: str,
    starting_positions: List[int]
) -> int:
    """
    Create database segments from starting positions.
    
    Args:
        db: Database session
        content: The full text content
        document_id: The document ID to associate segments with
        starting_positions: List of starting character positions
        
    Returns:
        Number of segments created
        
    Raises:
        HTTPException: If document not found or creation fails
    """
    # Verify document exists
    document = db.query(OutlinerDocument).filter(OutlinerDocument.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Extract text segments and create database records
    db_segments = []
    text_length = len(content)
    
    for idx, start_pos in enumerate(starting_positions):
        end_pos = (
            starting_positions[idx + 1]
            if idx + 1 < len(starting_positions)
            else text_length
        )

        db_segments.append({
            "id": str(uuid.uuid4()),
            "document_id": document_id,
            "text": "",
            "segment_index": idx,
            "span_start": start_pos,
            "span_end": end_pos,
            "status": "unchecked",
            "is_annotated": False,
        })
    
    db.bulk_insert_mappings(OutlinerSegment, db_segments)
    
    # Update document statistics
    document.total_segments = len(db_segments)
    document.annotated_segments = db.query(func.count(OutlinerSegment.id)).filter(
        OutlinerSegment.document_id == document_id,
        OutlinerSegment.is_annotated == True
    ).scalar() or 0
    
    # Commit all changes
    db.commit()
    
    return len(db_segments)
