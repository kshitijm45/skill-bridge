"""
Parses uploaded resume files (PDF or DOCX) into plain text.
Supports: .pdf, .docx
Falls back gracefully with clear error messages for unsupported or unreadable files.
"""

import io
from fastapi import HTTPException


def parse_resume(file_bytes: bytes, filename: str) -> str:
    """
    Given raw file bytes and the original filename, return extracted plain text.
    Raises HTTPException with a user-friendly message on failure.
    """
    filename_lower = filename.lower()

    if filename_lower.endswith(".pdf"):
        return _parse_pdf(file_bytes, filename)
    elif filename_lower.endswith(".docx"):
        return _parse_docx(file_bytes, filename)
    else:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{filename}'. Please upload a PDF or DOCX file, or paste your resume as text."
        )


def _parse_pdf(file_bytes: bytes, filename: str) -> str:
    try:
        import pdfplumber
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="PDF parsing library not installed. Please paste your resume as text instead."
        )

    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            pages_text = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages_text.append(text)

        full_text = "\n".join(pages_text).strip()

        if not full_text:
            raise HTTPException(
                status_code=422,
                detail="Could not extract text from this PDF. It may be scanned or image-based. Please paste your resume as text instead."
            )

        return full_text

    except HTTPException:
        raise
    except Exception as e:
        # Password-protected PDFs throw a generic error from pdfplumber
        if "password" in str(e).lower() or "encrypted" in str(e).lower():
            raise HTTPException(
                status_code=422,
                detail="This PDF is password-protected. Please remove the password or paste your resume as text instead."
            )
        raise HTTPException(
            status_code=422,
            detail=f"Could not read PDF '{filename}'. Please paste your resume as text instead."
        )


def _parse_docx(file_bytes: bytes, filename: str) -> str:
    try:
        from docx import Document
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="DOCX parsing library not installed. Please paste your resume as text instead."
        )

    try:
        doc = Document(io.BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        full_text = "\n".join(paragraphs).strip()

        if not full_text:
            raise HTTPException(
                status_code=422,
                detail="Could not extract text from this DOCX file. Please paste your resume as text instead."
            )

        return full_text

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=422,
            detail=f"Could not read DOCX file '{filename}'. Please paste your resume as text instead."
        )
