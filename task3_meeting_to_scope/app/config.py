import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

KB_URL = os.getenv("KB_URL", "http://127.0.0.1:8000")
KB_API_KEY = os.getenv("KB_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
