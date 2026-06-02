# Install — Darrow Time & Invoicing (Windows)

A one-time setup. After this you'll have a working desktop install you can
start with a single double-click.

## Before you begin

You need **two free programs** installed first. Both are commonly used and
safe — they're industry standard tools.

1. **Docker Desktop** — runs the database in a sandbox so you don't have to
   install Postgres yourself.
   - Download: <https://www.docker.com/products/docker-desktop/>
   - After installing, **open Docker Desktop from the Start menu and wait
     until the whale icon in the system tray (bottom-right) turns solid**.
     This usually takes about a minute.

2. **Node.js (LTS)** — the runtime that powers the app.
   - Download: <https://nodejs.org/> (pick the green "LTS" button)
   - Accept all default options during install.

Optional:

- **LibreOffice** — only needed if you want to export classic DOCX → PDF
  invoices. The newer "Package PDF" works without it.
  - Download: <https://www.libreoffice.org/download/>

## Install

1. Make sure Docker Desktop is running (whale icon solid in the tray).
2. **Double-click `install.bat`** in this folder.
3. Wait. You'll see a series of "OK" lines. The first run takes 5–10 minutes
   because it downloads packages.
4. When it says **"Install complete"**, write down the admin username and
   password it created (also saved to `docs\FIRST_RUN.md`).

## Daily use

- **Start the app** — double-click `start.bat`. Three black windows will
  open (API, Workers, Web). A browser tab opens to <http://localhost:5173>.
- **Stop the app** — double-click `stop.bat`. (Or just close the three
  black windows.)
- **Backup your data** — inside the app, go to **Settings → Backup &
  restore** and click "Create backup now". Download the file to a safe
  place.
- **Restore from backup** — same screen. Upload a previously-saved backup
  and type the confirmation text.

## Troubleshooting

- **"Docker Desktop is not running"** — open it from the Start menu, wait
  for the whale icon to turn solid, then re-run.
- **"Node.js is too old"** — install Node 20 LTS from <https://nodejs.org/>.
- **The browser shows "site can't be reached"** — give it 30 seconds; the
  web server takes a moment to start. If it still fails, look at the three
  black windows for error messages.
- **You forgot the admin password** — open `docs\FIRST_RUN.md` if it still
  exists; otherwise ask whoever set up the system to reset it.

## What's where

| File | Purpose |
| --- | --- |
| `install.bat` | One-click installer (run once). |
| `start.bat` | Start the app. |
| `stop.bat` | Stop everything. |
| `storage\` | All your invoices, attachments, backups, logo, template. |
| `.env` | Configuration; created by the installer with secure random keys. Don't share. |
| `docs\FIRST_RUN.md` | Initial admin credentials. Delete after you change the password. |
