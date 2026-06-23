#!/usr/bin/env python
"""Upload (create or update) the dashboard data file to Google Drive.

Stores the file inside a dedicated My Drive folder (default "Rate Monitoring") so
all rate-monitoring data stays organised in one place. Reuses the shared OAuth
credentials in .gdrive-mcp (the same ones the -3W booking dashboard uses).

The folder is shared *read-only with the company domain* (ekmtc.com); files inside
inherit that access, so signed-in KMTC users -- and only them -- can read it from
the dashboard. The data file is never made public.

If a data file with the same name already exists (e.g. an earlier upload to My Drive
root), it is reused (same Drive file id) and moved into the folder, so the
VITE_DRIVE_FILE_ID configured for the dashboard stays valid.

Usage:
    python scripts/upload-to-gdrive.py [SRC_PATH] [DRIVE_FILENAME]

Prints `DRIVE_FILE_ID=<id>` on success.
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
FOLDER_NAME = os.environ.get('GDRIVE_FOLDER_NAME', 'Rate Monitoring').strip()
DOMAINS = [d.strip() for d in os.environ.get(
    'GDRIVE_SHARE_DOMAINS', 'ekmtc.com').split(',') if d.strip()]


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
    meta = json.dumps({'name': name,
                       'mimeType': 'application/vnd.google-apps.folder',
                       'parents': ['root']}).encode()
    resp = _req('POST', 'https://www.googleapis.com/drive/v3/files?fields=id',
                headers={'Authorization': f'Bearer {at}',
                         'Content-Type': 'application/json'}, data=meta)
    print(f"  created folder: {name} ({resp['id']})")
    return resp['id']


def find_file(at, name):
    q = (f"name='{name}' and trashed=false "
         "and mimeType!='application/vnd.google-apps.folder'")
    url = 'https://www.googleapis.com/drive/v3/files?' + urllib.parse.urlencode(
        {'q': q, 'fields': 'files(id,name,parents)'})
    resp = _req('GET', url, headers={'Authorization': f'Bearer {at}'}, timeout=30)
    files = resp.get('files', [])
    return files[0] if files else None


def update_content(at, fid, data):
    _req('PATCH',
         f'https://www.googleapis.com/upload/drive/v3/files/{fid}?uploadType=media',
         headers={'Authorization': f'Bearer {at}', 'Content-Type': 'application/json'},
         data=data)


def move_to_folder(at, fid, folder_id, current_parents):
    if folder_id in (current_parents or []):
        return
    params = {'addParents': folder_id, 'fields': 'id,parents'}
    if current_parents:
        params['removeParents'] = ','.join(current_parents)
    url = (f'https://www.googleapis.com/drive/v3/files/{fid}?'
           + urllib.parse.urlencode(params))
    _req('PATCH', url, headers={'Authorization': f'Bearer {at}',
                                'Content-Type': 'application/json'}, data=b'{}')
    print(f"  moved into folder: {FOLDER_NAME}")


def create_file(at, name, data, folder_id):
    boundary = '===rate-monitoring-boundary==='
    meta = {'name': name, 'parents': [folder_id]}
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


def upsert_file(at, folder_id, src, name, data=None):
    if data is None:
        data = src.read_bytes()
    existing = find_file(at, name)
    if existing:
        fid = existing['id']
        update_content(at, fid, data)
        move_to_folder(at, fid, folder_id, existing.get('parents'))
        print(f"Updated {name} ({len(data):,} bytes) -> {fid}")
    else:
        fid = create_file(at, name, data, folder_id)
        print(f"Created {name} ({len(data):,} bytes) -> {fid}")

    # Belt-and-suspenders: also share the file itself, in case folder permission
    # inheritance is restricted by Workspace policy.
    for domain in DOMAINS:
        grant_domain_reader(at, fid, domain, 'file')

    return fid


def grant_domain_reader(at, target_id, domain, label):
    body = json.dumps({'type': 'domain', 'role': 'reader', 'domain': domain,
                       'allowFileDiscovery': False}).encode()
    try:
        _req('POST',
             f'https://www.googleapis.com/drive/v3/files/{target_id}/permissions?fields=id',
             headers={'Authorization': f'Bearer {at}',
                      'Content-Type': 'application/json'},
             data=body, timeout=30)
        print(f"  shared {label} read-only with domain: {domain}")
    except RuntimeError as e:
        print(f"  WARN could not domain-share {label} with {domain}: {e}")


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('public/data/weekly-monitoring.json')
    name = sys.argv[2] if len(sys.argv) > 2 else 'weekly-monitoring.json'
    if not src.exists():
        raise SystemExit(f"Source file not found: {src}")

    at = access_token()

    folder_id = ensure_folder(at, FOLDER_NAME)
    for domain in DOMAINS:
        grant_domain_reader(at, folder_id, domain, 'folder')

    detail_id = ''
    detail_src = src.with_name('weekly-monitoring-details.json')
    if name == 'weekly-monitoring.json' and detail_src.exists():
        detail_id = upsert_file(at, folder_id, detail_src, 'weekly-monitoring-details.json')

    if detail_id:
        payload = json.loads(src.read_text(encoding='utf-8'))
        payload.setdefault('metadata', {})['detailDriveFileId'] = detail_id
        data = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    else:
        data = src.read_bytes()
    fid = upsert_file(at, folder_id, src, name, data)

    print(f"FOLDER_ID={folder_id}")
    if detail_id:
        print(f"DETAIL_DRIVE_FILE_ID={detail_id}")
    print(f"DRIVE_FILE_ID={fid}")


if __name__ == '__main__':
    main()
