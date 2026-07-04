"""Lets the agent search Pilotbase's own documentation (docs/*.md and the
root README) for setup/usage questions instead of guessing from general
knowledge — e.g. "how do I configure a Snowflake connection?" """
from pathlib import Path

from langchain_core.tools import tool

DOCS_ROOT = Path(__file__).resolve().parents[4]
MAX_DOC_CHARS = 8000


def _doc_paths() -> dict[str, Path]:
    paths = {}
    for p in (DOCS_ROOT / "docs").rglob("*.md"):
        paths[p.relative_to(DOCS_ROOT).as_posix()] = p
    readme = DOCS_ROOT / "README.md"
    if readme.is_file():
        paths["README.md"] = readme
    return paths


def make_docs_tools():
    @tool
    def list_docs() -> str:
        """List every Pilotbase documentation file available to read (setup
        guides, per-database configuration notes, etc.)."""
        paths = sorted(_doc_paths().keys())
        return "\n".join(paths) if paths else "No documentation files found."

    @tool
    def read_doc(path: str) -> str:
        """Read a documentation file by the exact path returned by list_docs,
        e.g. 'docs/comparisons/snowflake.md' or 'README.md'."""
        paths = _doc_paths()
        if path not in paths:
            return f"ERROR: '{path}' is not a known doc. Call list_docs to see valid paths."
        content = paths[path].read_text(encoding="utf-8", errors="ignore")
        if len(content) > MAX_DOC_CHARS:
            content = content[:MAX_DOC_CHARS] + "\n… (truncated)"
        return content

    return [list_docs, read_doc]
