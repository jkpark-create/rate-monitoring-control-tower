#!/usr/bin/env python
"""Background pipeline: refresh the Oracle data cache, then publish to Google Drive.

Designed to run head-less from Windows Task Scheduler via pythonw.exe (no console
window). Each step's output is appended to logs/refresh-and-publish.log so the
unattended runs stay debuggable even though nothing is shown on screen.

Any extra CLI args (e.g. --env-file .env.local) are forwarded to the refresh step.
"""
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = ROOT / 'logs'
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / 'refresh-and-publish.log'


def _write(text):
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(text)


def log(msg):
    _write(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}\n")


def run(label, args):
    log(f"START {label}: {' '.join(args)}")
    # CREATE_NO_WINDOW keeps any child process from flashing a console window when
    # the pipeline is launched headless (pythonw) from Task Scheduler.
    no_window = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    proc = subprocess.run(args, cwd=str(ROOT), capture_output=True, text=True,
                          creationflags=no_window)
    if proc.stdout:
        _write(proc.stdout)
    if proc.stderr:
        _write(proc.stderr)
    log(f"END {label}: exit {proc.returncode}")
    if proc.returncode != 0:
        raise SystemExit(f"{label} failed with exit {proc.returncode}")


def main():
    py = sys.executable  # the python/pythonw that launched this wrapper
    extra = sys.argv[1:]
    run('refresh', [py, str(ROOT / 'scripts' / 'refresh-dashboard-data.py'),
                    '--oracle', *extra])
    run('publish', [py, str(ROOT / 'scripts' / 'upload-to-gdrive.py')])
    log("pipeline complete")


if __name__ == '__main__':
    main()
