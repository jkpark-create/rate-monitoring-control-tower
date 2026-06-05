#!/usr/bin/env python
"""Upload (create or update) the dashboard data file to Google Drive.

Reuses the shared OAuth credentials in .gdrive-mcp (the same ones the -3W booking
dashboard uses): refreshes an access token from credentials.json + token.json, then
creates or updates a file by name via the Drive REST API. The created file stays
restricted (private to the uploader) and is then shared *read-only with the company
domains* so signed-in KMTC users — and only them — can read it from the dashboard.

Usage:
    python scripts/upload-to-gdrive.py [SRC_PATH] [DRIVE_FILENAME]

Prints `DRIVE_FILE_ID=<id>` on success. Set GDRIVE_FOLDER_ID to place the file in a
specific folder; otherwise it is created in My Drive root.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CREDS_DIR = Path(os.environ.get(
    'GDRIVE_CREDS_DIR', r'C:\Users\JKPARK\OneDrive\Documents\Claude\.gdrive-mcp'))
FOLDER_ID = os.environ.get('GDRIVE_FOLDER_ID', '').strip()
DOMAINS = [d.strip() for d in os.environ.get(
    'GDRIVE_SHARE_DOMAINS', 'kmtc.co.kr,kmtc-dom.co.kr').split(',') if d.strip()]


def _req(method, url, headers=None, data=None, timeout=120):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors='replace')
        raise RuntimeError(f"HTTP {e.code} on {method} {url}: {detail}") from None


def access_token():
    with open(CREDS_DIR / 'credentials.json', encoding='utf-8-sig') as f:
        creds = json.load(f)['installed']
    with open(CREDS_DIR / 'token.json', encoding='utf-8-sig') as f:
        token = json.load(f)
    data = urllib.parse.urlencode({
        'client_id': creds['client_id'],
        'client_secret': creds['client_secret'],
        'refresh_token': token['refresh_token'],
        'grant_type': 'refresh_token',
    }).encode()
    resp = _req('POST', 'https://oauth2.googleapis.com/token',
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                data=data, timeout=30)
    return resp['access_token']


def find_file(at, name):
    scope = f" and '{FOLDER_ID}' in parents" if FOLDER_ID else ""
    q = f"name='{name}' and trashed=false{scope}"
    url = 'https://www.googleapis.com/drive/v3/files?' + urllib.parse.urlencode(
        {'q': q, 'fields': 'files(id,name)'})
    resp = _req('GET', url, headers={'Authorization': f'Bearer {at}'}, timeout=30)
    files = resp.get('files', [])
    return files[0]['id'] if files else None


def update_file(at, fid, data):
    _req('PATCH',
         f'https://www.googleapis.com/upload/drive/v3/files/{fid}?uploadType=media',
         headers={'Authorization': f'Bearer {at}', 'Content-Type': 'application/json'},
         data=data)
    return fid


def create_file(at, name, data):
    boundary = '===rate-monitoring-boundary==='
    meta = {'name': name}
    if FOLDER_ID:
        meta['parents'] = [FOLDER_ID]
    body = (f'--{boundary}\r\n'
            'Content-Type: application/json; charset=UTF-8\r\n\r\n'
            f'{json.dumps(meta)}\r\n'
            f'--{boundary}\r\n'
            'Content-Type: application/json\r\n\r\n').encode()
    body += data + f'\r\n--{boundary}--'.encode()
    resp = _req(
        'POST',
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        headers={'Authorization': f'Bearer {at}',
                 'Content-Type': f'multipart/related; boundary={boundary}'},
        data=body)
    return resp['id']


def grant_domain_reader(at, fid, domain):
    body = json.dumps({'type': 'domain', 'role': 'reader', 'domain': domain,
                       'allowFileDiscovery': False}).encode()
    try:
        _req('POST',
             f'https://www.googleapis.com/drive/v3/files/{fid}/permissions?fields=id',
             headers={'Authorization': f'Bearer {at}',
                      'Content-Type': 'application/json'},
             data=body, timeout=30)
        print(f"  shared read-only with domain: {domain}")
    except RuntimeError as e:
        print(f"  WARN could not domain-share with {domain}: {e}")


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('public/data/weekly-monitoring.json')
    name = sys.argv[2] if len(sys.argv) > 2 else 'weekly-monitoring.json'
    if not src.exists():
        raise SystemExit(f"Source file not found: {src}")
    data = src.read_bytes()

    at = access_token()
    fid = find_file(at, name)
    if fid:
        update_file(at, fid, data)
        print(f"Updated {name} ({len(data):,} bytes) -> {fid}")
    else:
        fid = create_file(at, name, data)
        print(f"Created {name} ({len(data):,} bytes) -> {fid}")

    for domain in DOMAINS:
        grant_domain_reader(at, fid, domain)

    print(f"DRIVE_FILE_ID={fid}")


if __name__ == '__main__':
    main()
