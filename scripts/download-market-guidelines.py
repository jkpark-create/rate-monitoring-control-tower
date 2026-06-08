#!/usr/bin/env python
"""Download market-rate source workbooks from Google Drive or Sheets.

The sync scripts reuse the parser from the sibling "organizing rate file"
project. This downloader keeps the source workbooks fresh before that parser
reads them.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = ROOT.parent / "organizing rate file"
DEFAULT_CREDS_DIR = ROOT.parent / ".gdrive-mcp"
SEA_FILENAME = "[SEA] Market Rate.xlsx"
CNHK_FILENAME = "[CN_HK] Market Rate.xlsx"


def load_json(path: Path):
    with path.open(encoding="utf-8-sig") as handle:
        return json.load(handle)


def source_dir(value: str | None = None) -> Path:
    return Path(value or os.environ.get("ORGANIZING_RATE_DIR", DEFAULT_SOURCE_DIR)).expanduser().resolve()


def creds_dir() -> Path:
    return Path(
        os.environ.get("MARKET_RATE_GDRIVE_CREDS_DIR")
        or os.environ.get("GDRIVE_CREDS_DIR")
        or DEFAULT_CREDS_DIR
    ).expanduser().resolve()


def load_organizing_defaults(source: Path) -> dict[str, str]:
    updater = source / "update_rates.py"
    if not updater.exists():
        return {}
    spec = importlib.util.spec_from_file_location("organizing_rate_updater", updater)
    if spec is None or spec.loader is None:
        return {}
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {
        "sea": str(getattr(module, "SEA_FILE_ID", "") or ""),
        "cnhk": str(getattr(module, "CNHK_FILE_ID", "") or ""),
    }


def file_id_from_url(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    patterns = [
        r"/spreadsheets/d/([A-Za-z0-9_-]+)",
        r"/file/d/([A-Za-z0-9_-]+)",
        r"[?&]id=([A-Za-z0-9_-]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return text


def configured_file_id(kind: str, args, defaults: dict[str, str]) -> str:
    if kind == "sea":
        candidates = [
            args.sea_file_id,
            args.sea_url,
            os.environ.get("MARKET_RATE_SEA_FILE_ID"),
            os.environ.get("MARKET_RATE_SEA_URL"),
            os.environ.get("SEA_MARKET_RATE_FILE_ID"),
            os.environ.get("SEA_MARKET_RATE_URL"),
            defaults.get("sea"),
        ]
    else:
        candidates = [
            args.cnhk_file_id,
            args.cnhk_url,
            os.environ.get("MARKET_RATE_CNHK_FILE_ID"),
            os.environ.get("MARKET_RATE_CNHK_URL"),
            os.environ.get("CNHK_MARKET_RATE_FILE_ID"),
            os.environ.get("CNHK_MARKET_RATE_URL"),
            defaults.get("cnhk"),
        ]
    for candidate in candidates:
        file_id = file_id_from_url(str(candidate or ""))
        if file_id:
            return file_id
    raise RuntimeError(
        f"Missing {kind.upper()} market-rate Google file id. Set MARKET_RATE_{kind.upper()}_URL "
        "or MARKET_RATE_*_FILE_ID in .env.local."
    )


def request_json(method: str, url: str, headers=None, data=None, timeout=30):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read()
    return json.loads(body) if body else {}


def access_token() -> str:
    directory = creds_dir()
    token_path = directory / "token.json"
    creds_path = directory / "credentials.json"
    token = load_json(token_path)
    creds = load_json(creds_path)["installed"]
    expiry = token.get("expiry_date", 0) / 1000
    if expiry < time.time() + 60:
        data = urllib.parse.urlencode(
            {
                "client_id": creds["client_id"],
                "client_secret": creds["client_secret"],
                "refresh_token": token["refresh_token"],
                "grant_type": "refresh_token",
            }
        ).encode()
        refreshed = request_json(
            "POST",
            creds["token_uri"],
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=data,
            timeout=30,
        )
        token["access_token"] = refreshed["access_token"]
        token["expiry_date"] = int((time.time() + refreshed["expires_in"]) * 1000)
        token_path.write_text(json.dumps(token, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return token["access_token"]


def download_bytes(file_id: str, token: str) -> tuple[bytes, str]:
    headers = {"Authorization": f"Bearer {token}"}
    urls = [
        (
            f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=xlsx",
            "Google Sheets export",
        ),
        (
            f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media",
            "Google Drive media",
        ),
    ]
    last_error = None
    for url, label in urls:
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read(), label
        except urllib.error.HTTPError as exc:
            last_error = f"HTTP {exc.code}: {exc.read().decode(errors='replace')[:300]}"
        except urllib.error.URLError as exc:
            last_error = str(exc)
    raise RuntimeError(f"Could not download Google file {file_id}: {last_error}")


def write_atomic(target: Path, data: bytes):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(target)


def download_one(kind: str, file_id: str, target: Path, token: str):
    data, method = download_bytes(file_id, token)
    if len(data) < 1024:
        raise RuntimeError(f"Downloaded {kind.upper()} file is unexpectedly small: {len(data)} bytes")
    write_atomic(target, data)
    print(f"{kind.upper()}: {method} -> {target} ({len(data) // 1024:,} KB)")


def parse_args():
    parser = argparse.ArgumentParser(description="Download market-rate guideline source workbooks")
    parser.add_argument("--source-dir", help="Directory containing parse_rates.py and source workbooks")
    parser.add_argument("--sea-url", help="SEA/ETC Google Sheet or Drive URL")
    parser.add_argument("--cnhk-url", help="CN/HK Google Sheet or Drive URL")
    parser.add_argument("--sea-file-id", help="SEA/ETC Google file id")
    parser.add_argument("--cnhk-file-id", help="CN/HK Google file id")
    parser.add_argument("--only", choices=("all", "sea", "cnhk"), default="all")
    return parser.parse_args()


def main():
    args = parse_args()
    source = source_dir(args.source_dir)
    defaults = load_organizing_defaults(source)
    token = access_token()
    if args.only in ("all", "sea"):
        download_one("sea", configured_file_id("sea", args, defaults), source / SEA_FILENAME, token)
    if args.only in ("all", "cnhk"):
        download_one("cnhk", configured_file_id("cnhk", args, defaults), source / CNHK_FILENAME, token)


if __name__ == "__main__":
    main()
