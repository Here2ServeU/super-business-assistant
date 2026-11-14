import os
import yaml
from dotenv import load_dotenv


def load_config(path="config.yaml"):
    load_dotenv()
    if not os.path.exists(path):
        path = "config.example.yaml"
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    cfg["env"] = {
        "anthropic_key": os.getenv("ANTHROPIC_API_KEY", ""),
        "telegram_token": os.getenv("TELEGRAM_BOT_TOKEN", ""),
        "telegram_chat_id": os.getenv("TELEGRAM_CHAT_ID", ""),
    }
    return cfg
