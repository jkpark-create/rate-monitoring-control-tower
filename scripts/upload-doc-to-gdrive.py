#!/usr/bin/env python
"""Upload a Markdown file to Google Drive, converting it to a native Google Doc.

Reuses the shared OAuth credentials in .gdrive-mcp (same as upload-to-gdrive.py).
Places the doc in the "Rate Monitoring" folder. If a Google Doc with the same
title already exists there, its content is replaced (same Drive file id).

Usage:
    python scripts/upload-doc-to-gdrive.py SRC.md "Doc Title"

Prints `DRIVE_FILE_ID=<id>` and a webViewLink on success.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CREDS_DIR = Path(os.environ.get('GDRIVE_CREDS_DIR', str(Path.home() / '.gdrive-mcp')))
FOLDER_NAME = os.environ.get('GDRIVE_FOLDER_NAME', 'Rate Monitoring').strip()
DOC_MIME = 'application/vnd.google-apps.document'


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


def ensure_folder(at, name):
    q = ("mimeType='application/vnd.google-apps.folder' and trashed=false "
         f"and name='{name}' and 'root' in parents")
    url = 'https://www.googleapis.com/drive/v3/files?' + urllib.parse.urlencode(
        {'q': q, 'fields': 'files(id,name)'})
    resp = _req('GET', url, headers={'Authorization': f'Bearer {at}'}, timeout=30)
    files = resp.get('files', [])
    if files:
        return files[0]['id']
    meta = json.dumps({'name': name, 'mimeType': 'application/vnd.google-apps.folder',
                       'parents': ['root']}).encode()
    resp = _req('POST', 'https://www.googleapis.com/drive/v3/files?fields=id',
                headers={'Authorization': f'Bearer {at}',
                         'Content-Type': 'application/json'}, data=meta)
    print(f"  created folder: {name} ({resp['id']})")
    return resp['id']


def find_doc(at, name, folder_id):
    q = (f"name='{name}' and trashed=false and mimeType='{DOC_MIME}' "
         f"and '{folder_id}' in parents")
    url = 'https://www.googleapis.com/drive/v3/files?' + urllib.parse.urlencode(
        {'q': q, 'fields': 'files(id,name)'})
    resp = _req('GET', url, headers={'Authorization': f'Bearer {at}'}, timeout=30)
    files = resp.get('files', [])
    return files[0] if files else None


def _multipart(meta, data, src_mime):
    boundary = '===rate-monitoring-doc-boundary==='
    body = (f'--{boundary}\r\n'
            'Content-Type: application/json; charset=UTF-8\r\n\r\n'
            f'{json.dumps(meta)}\r\n'
            f'--{boundary}\r\n'
            f'Content-Type: {src_mime}\r\n\r\n').encode()
    body += data + f'\r\n--{boundary}--'.encode()
    return boundary, body


def create_doc(at, name, data, folder_id, src_mime):
    meta = {'name': name, 'parents': [folder_id], 'mimeType': DOC_MIME}
    boundary, body = _multipart(meta, data, src_mime)
    resp = _req('POST',
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
                headers={'Authorization': f'Bearer {at}',
                         'Content-Type': f'multipart/related; boundary={boundary}'},
                data=body)
    return resp


def update_doc(at, fid, data, src_mime):
    meta = {'mimeType': DOC_MIME}
    boundary, body = _multipart(meta, data, src_mime)
    resp = _req('PATCH',
                f'https://www.googleapis.com/upload/drive/v3/files/{fid}?uploadType=multipart&fields=id,webViewLink',
                headers={'Authorization': f'Bearer {at}',
                         'Content-Type': f'multipart/related; boundary={boundary}'},
                data=body)
    return resp


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: upload-doc-to-gdrive.py SRC.md [\"Doc Title\"]")
    src = Path(sys.argv[1])
    title = sys.argv[2] if len(sys.argv) > 2 else src.stem
    if not src.exists():
        raise SystemExit(f"Source not found: {src}")
    data = src.read_bytes()
    src_mime = 'text/markdown' if src.suffix.lower() in ('.md', '.markdown') else 'text/plain'

    at = access_token()
    folder_id = ensure_folder(at, FOLDER_NAME)
    existing = find_doc(at, title, folder_id)
    if existing:
        resp = update_doc(at, existing['id'], data, src_mime)
        print(f"Updated Google Doc '{title}' -> {resp['id']}")
    else:
        resp = create_doc(at, title, data, folder_id, src_mime)
        print(f"Created Google Doc '{title}' -> {resp['id']}")
    print(f"FOLDER_ID={folder_id}")
    print(f"DRIVE_FILE_ID={resp['id']}")
    if resp.get('webViewLink'):
        print(f"LINK={resp['webViewLink']}")


if __name__ == '__main__':
    main()
