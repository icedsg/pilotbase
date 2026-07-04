"""
Lightweight keyword+recency heuristic for surfacing relevant context from a
user's OTHER chat sessions. Deliberately not embeddings-based — no vector
store, no extra model calls; just token overlap against the new message plus
a recency bonus, gated by a noise threshold so unrelated sessions never get
injected as false context.
"""
import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import chat_history_service

MIN_TOKEN_LEN = 3
MAX_CANDIDATE_SESSIONS = 20
MAX_MESSAGES_PER_CANDIDATE = 40
HALF_LIFE_HOURS = 72.0
KEYWORD_WEIGHT = 0.7
RECENCY_WEIGHT = 0.3
MIN_KEYWORD_SCORE = 0.34
MAX_DIGEST_SESSIONS = 2
MAX_CHARS_PER_DIGEST_SESSION = 500

STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
    "but", "by", "can", "could", "did", "do", "does", "doing", "don't", "down", "during", "each",
    "few", "for", "from", "further", "had", "has", "have", "having", "her", "here", "hers",
    "herself", "him", "himself", "his", "how", "into", "is", "it", "its", "itself", "just", "me",
    "more", "most", "my", "myself", "need", "no", "nor", "not", "now", "of", "off", "on", "once",
    "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "please", "same",
    "she", "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them",
    "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too",
    "under", "until", "up", "very", "was", "we", "were", "what", "when", "where", "which", "while",
    "who", "whom", "why", "will", "with", "would", "you", "your", "yours", "yourself", "yourselves",
    "can", "you", "tell", "show", "give", "want", "like", "get", "one", "way",
}

_TOKEN_RE = re.compile(r"[a-z0-9_]+")


def tokenize(text: str) -> set[str]:
    words = _TOKEN_RE.findall(text.lower())
    return {w for w in words if len(w) >= MIN_TOKEN_LEN and w not in STOPWORDS}


def score_session(
    query_tokens: set[str], session_text: str, updated_at: datetime, now: datetime,
) -> tuple[float, float]:
    """Returns (combined_score, keyword_score); caller applies the noise threshold on keyword_score."""
    doc_tokens = tokenize(session_text)
    if not query_tokens or not doc_tokens:
        return 0.0, 0.0
    overlap = len(query_tokens & doc_tokens)
    keyword_score = overlap / len(query_tokens)
    age_hours = max((now - updated_at).total_seconds() / 3600.0, 0.0)
    recency_score = 0.5 ** (age_hours / HALF_LIFE_HOURS)
    combined = KEYWORD_WEIGHT * keyword_score + RECENCY_WEIGHT * recency_score
    return combined, keyword_score


def _excerpt(messages, query_tokens: set[str], budget: int) -> str:
    matching = [m for m in messages if tokenize(m.content) & query_tokens]
    chosen = matching if matching else messages
    lines = []
    used = 0
    for m in chosen:
        prefix = "User" if m.role == "user" else "Assistant"
        line = f"{prefix}: {m.content}"
        if used + len(line) > budget:
            remaining = budget - used
            if remaining > 20:
                lines.append(line[:remaining] + "…")
            break
        lines.append(line)
        used += len(line)
    return "\n".join(lines)


async def build_context_digest(
    session: AsyncSession, *, user_id: str, current_session_id: str, query_text: str,
) -> Optional[str]:
    query_tokens = tokenize(query_text)
    if not query_tokens:
        return None

    candidates = await chat_history_service.list_other_sessions_for_scoring(
        session,
        user_id=user_id,
        exclude_session_id=current_session_id,
        limit=MAX_CANDIDATE_SESSIONS,
        messages_per_session=MAX_MESSAGES_PER_CANDIDATE,
    )
    if not candidates:
        return None

    now = datetime.now(timezone.utc)
    scored = []
    for chat_session, messages in candidates:
        session_text = "\n".join(m.content for m in messages)
        combined, keyword_score = score_session(query_tokens, session_text, chat_session.updated_at, now)
        if keyword_score >= MIN_KEYWORD_SCORE:
            scored.append((combined, chat_session, messages))

    if not scored:
        return None

    scored.sort(key=lambda t: t[0], reverse=True)
    top = scored[:MAX_DIGEST_SESSIONS]

    blocks = []
    for _, chat_session, messages in top:
        excerpt = _excerpt(messages, query_tokens, MAX_CHARS_PER_DIGEST_SESSION)
        date = chat_session.updated_at.strftime("%Y-%m-%d")
        blocks.append(f"[Past session — {date}]\n{excerpt}")

    return (
        "Relevant context from this user's past conversations (background only — the user "
        "has not repeated this in the current conversation; use it only if it's actually "
        "relevant to their new message, and don't assume they remember mentioning it):\n\n"
        + "\n\n".join(blocks)
    )
