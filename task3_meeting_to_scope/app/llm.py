import json
import time
import hashlib
from pathlib import Path
from typing import Optional

import httpx
from app import config

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / "llm_cache"
LOG_PATH = ROOT / "results" / "llm_log.jsonl"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

DEFAULT_MODEL = "openai/gpt-oss-20b"
MAIN_MODEL = "openai/gpt-oss-120b"
# gpt-oss models think before they answer, so they need room for hidden reasoning tokens
MIN_TOKENS_GPT_OSS = 4000


class DailyLimitReached(Exception):
    """Groq tokens-per-day limit. Do not retry. Stop and resume tomorrow."""


class LLMError(Exception):
    pass


def _log(entry: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _cache_key(model: str, system: str, user: str, json_mode: bool) -> str:
    raw = json.dumps([model, system, user, json_mode], ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def chat(system: str, user: str, model: str = DEFAULT_MODEL, json_mode: bool = False,
         max_tokens: int = 1500, use_cache: bool = True, tag: str = "") -> str:
    if not config.GROQ_API_KEY:
        raise LLMError("GROQ_API_KEY is empty")

    key = _cache_key(model, system, user, json_mode)
    cache_file = CACHE_DIR / (key + ".json")
    if use_cache and cache_file.exists():
        data = json.loads(cache_file.read_text(encoding="utf-8"))
        _log({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": tag, "model": model, "cached": True,
              "prompt_tokens": 0, "completion_tokens": 0, "seconds": 0})
        return data["text"]

    is_oss = "gpt-oss" in model
    if is_oss:
        max_tokens = max(max_tokens, MIN_TOKENS_GPT_OSS)

    use_json_mode = json_mode
    headers = {"Authorization": "Bearer " + config.GROQ_API_KEY}
    last_err = ""
    for attempt in range(4):
        body = {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0,
            "max_tokens": max_tokens,
        }
        if is_oss:
            body["reasoning_effort"] = "low"
        if use_json_mode:
            body["response_format"] = {"type": "json_object"}

        t0 = time.time()
        try:
            r = httpx.post(GROQ_URL, json=body, headers=headers, timeout=90.0)
        except httpx.HTTPError as e:
            last_err = "network: " + type(e).__name__
            time.sleep(2 * (attempt + 1))
            continue

        secs = round(time.time() - t0, 2)
        if r.status_code == 429:
            text = r.text.lower()
            if "per day" in text or "(tpd)" in text:
                _log({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": tag, "model": model,
                      "error": "daily_limit", "seconds": secs})
                raise DailyLimitReached("Groq daily token limit reached for " + model)
            last_err = "429 rate limit (per minute)"
            time.sleep(8 * (attempt + 1))
            continue
        if r.status_code >= 500:
            last_err = "HTTP " + str(r.status_code)
            _log({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": tag, "model": model,
                  "error": last_err, "seconds": secs})
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 400:
            last_err = "HTTP 400: " + r.text[:300]
            _log({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": tag, "model": model,
                  "error": last_err, "json_mode": use_json_mode, "seconds": secs})
            if use_json_mode:
                use_json_mode = False  # retry without JSON mode; parse_json checks the result
                continue
            raise LLMError(last_err)
        if r.status_code != 200:
            _log({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": tag, "model": model,
                  "error": "HTTP " + str(r.status_code), "seconds": secs})
            raise LLMError("HTTP " + str(r.status_code) + ": " + r.text[:200])

        data = r.json()
        try:
            text_out = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError):
            raise LLMError("Unexpected response shape")
        usage = data.get("usage", {}) or {}
        _log({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "tag": tag, "model": model, "cached": False,
              "json_mode": use_json_mode,
              "prompt_tokens": usage.get("prompt_tokens", 0),
              "completion_tokens": usage.get("completion_tokens", 0), "seconds": secs})
        if use_cache:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps({"text": text_out}), encoding="utf-8")
        return text_out

    raise LLMError("Failed after retries: " + last_err)


def parse_json(text: str) -> Optional[dict]:
    """Returns a dict, or None if the text is not valid JSON. Never guesses."""
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.lower().startswith("json"):
            t = t[4:]
    try:
        v = json.loads(t)
    except ValueError:
        return None
    return v if isinstance(v, dict) else None