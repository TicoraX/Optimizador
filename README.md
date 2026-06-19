# D1 — Windows System Automations

A local system maintenance toolkit for Windows: automated scripts for software updates, disk cleanup, and startup optimization — controlled from a modern web dashboard.

> Everything runs **locally on your machine**. No cloud, no telemetry, no data leaves your PC.

---

## What it does

| Module | What it automates |
|---|---|
| **Update Checker** | Detects pending updates for winget (apps/drivers), pip, npm global packages and Chocolatey |
| **Disk Cleanup** | Finds recoverable space: Windows temp files, browser cache, old downloads, recycle bin |
| **Startup Optimizer** | Audits startup programs (registry + Startup folder), auto-start services and logon scheduled tasks. Disabling is reversible — re-enable anything from the dashboard |

Each module follows the same pattern:
- **Scan** — reads the system, generates a Markdown report + structured JSON. Never modifies anything.
- **Action** — asks for confirmation by category before doing anything. Logs every action.
- **Notify** — weekly Windows Task Scheduler job shows a popup summary and optionally launches the action script.

---

## Project structure

```
D1/
├── update-checker/          # Update detection and application scripts
├── disk-cleanup/            # Disk space scan and cleanup scripts
├── startup-optimizer/       # Startup audit and optimization scripts
├── server/                  # Node.js REST + SSE backend (Express)
└── frontend/                # React + Vite web dashboard
```

---

## Requirements

### Scripts only (no web UI)
- Windows 10 or 11
- PowerShell 5.1+ (built into Windows) or PowerShell Core (`pwsh`)
- At least one of: `winget`, `pip`, `npm`, `choco` (missing tools are skipped gracefully)

### Web Dashboard (backend + frontend)
- [Node.js 18+](https://nodejs.org/) (LTS recommended)
- `npm` (bundled with Node.js)

---

## Quick start — Web Dashboard

This is the recommended way to use the project. The dashboard gives you a visual interface to scan, review reports, run actions and manage scheduled tasks.

### 1. Clone or download the repository

```powershell
git clone <repo-url>
cd D1
```

### 2. Start the backend API server

```powershell
cd server
npm install
npm start
```

The server starts at `http://127.0.0.1:3001`. It only accepts connections from `localhost` — it is **not accessible from your local network**.

> For development with auto-reload: `npm run dev`

### 3. Start the web frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open your browser at **http://localhost:5173**

The status indicator in the top right corner will turn green once the frontend connects to the backend.

---

## Quick start — Scripts only (no Node.js required)

You can use the PowerShell scripts directly without the web dashboard.

### Run a scan

```powershell
# Check for pending software updates
powershell -ExecutionPolicy Bypass -File update-checker\Check-Updates.ps1

# Scan for recoverable disk space
powershell -ExecutionPolicy Bypass -File disk-cleanup\Scan-Cleanup.ps1

# Audit startup configuration
powershell -ExecutionPolicy Bypass -File startup-optimizer\Scan-Startup.ps1
```

Reports are saved in each module's `reports/` folder.

### Apply actions interactively

```powershell
# Install pending updates (asks per category before doing anything)
powershell -ExecutionPolicy Bypass -File update-checker\Apply-Updates.ps1

# Clean disk (asks per category before deleting anything)
powershell -ExecutionPolicy Bypass -File disk-cleanup\Clean-Disk.ps1

# Disable startup programs / logon tasks (numbered list, you choose)
powershell -ExecutionPolicy Bypass -File startup-optimizer\Optimize-Startup.ps1
```

---

## Setting up weekly automation (optional)

The scripts can run automatically every week using Windows Task Scheduler. Replace `<FULL_PATH>` with the absolute path to the folder where you cloned this repo.

```powershell
# Update Checker — every Monday at 9:00 AM
schtasks /Create /TN "UpdateChecker_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<FULL_PATH>\update-checker\Notify-Updates.ps1`"" /SC WEEKLY /D MON /ST 09:00 /RL LIMITED /F

# Disk Cleanup — every Wednesday at 9:00 AM
schtasks /Create /TN "DiskCleanup_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<FULL_PATH>\disk-cleanup\Notify-Cleanup.ps1`"" /SC WEEKLY /D WED /ST 09:00 /RL LIMITED /F

# Startup Optimizer — every Friday at 9:00 AM
schtasks /Create /TN "StartupOptimizer_Weekly" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"<FULL_PATH>\startup-optimizer\Notify-Startup.ps1`"" /SC WEEKLY /D FRI /ST 09:00 /RL LIMITED /F
```

Each scheduled task shows a popup notification. Accepting the popup launches the interactive action script.

You can also enable, disable, or run tasks on demand:

```powershell
schtasks /Change /TN "UpdateChecker_Weekly" /ENABLE
schtasks /Change /TN "UpdateChecker_Weekly" /DISABLE
schtasks /Run   /TN "UpdateChecker_Weekly"
```

Alternatively, manage all tasks from the **Scheduler** tab in the web dashboard — enable/disable,
or click "Configurar horario" to change the day, time and frequency (weekly on chosen days, or
daily / every N days) without touching `schtasks` directly.

---

## Optional: PowerShell shortcut commands

Add these functions to your PowerShell profile (`notepad $PROFILE`) for quick access from any terminal:

```powershell
function Update-Check    { powershell -ExecutionPolicy Bypass -File "<FULL_PATH>\update-checker\Notify-Updates.ps1" }
function Disk-Cleanup    { powershell -ExecutionPolicy Bypass -File "<FULL_PATH>\disk-cleanup\Notify-Cleanup.ps1" }
function Startup-Optimize{ powershell -ExecutionPolicy Bypass -File "<FULL_PATH>\startup-optimizer\Notify-Startup.ps1" }
```

Reload your profile after editing: `. $PROFILE`

---

## Architecture overview

```
Browser  http://localhost:5173
    │
    ├── GET  /api/status          →  Dashboard: consolidated metrics (polled every 30s)
    ├── GET  /api/reports/:module →  Report viewer: rendered Markdown
    ├── POST /api/scan/:module    →  Live scan output (Server-Sent Events stream)
    ├── POST /api/action/:module  →  Live action output (Server-Sent Events stream)
    ├── GET  /api/scheduler                  →  Scheduled task status
    ├── POST /api/scheduler/:task/toggle     →  Enable / disable a scheduled task
    ├── POST /api/scheduler/:task/reschedule →  Change day/time/frequency (daily or weekly)
    ├── GET  /api/logs/:module    →  Last 100 lines of the action log
    └── DELETE /api/logs/:module  →  Clear or rotate the action log
                │
                ▼
    Express API  http://127.0.0.1:3001   (localhost only)
                │
                ├── Reads JSON / Markdown reports from disk
                ├── Runs scan/action logic natively in Node (fs, reg.exe, schtasks.exe,
                │   winget.exe, pip, npm) — does NOT spawn powershell.exe for any of this
                └── Calls schtasks.exe to query / toggle / reschedule scheduled tasks
```

> **Why native Node instead of spawning the `.ps1` scripts?** Spawning `powershell.exe -File`
> from inside this long-running Express server turned out to be unreliable — it would hang
> indefinitely or exit silently with no output, while the exact same script ran fine from a
> one-off process. The root cause was never pinned down with certainty, so instead of working
> around it, the web dashboard's scan/action logic was rewritten to call the underlying tools
> (`reg`, `schtasks`, `winget`, `pip`, `npm`, plain filesystem operations) directly. The
> `.ps1` scripts in each module folder are still fully functional and are what the weekly
> Windows Task Scheduler jobs and the PowerShell profile shortcuts run — only the web
> dashboard's backend avoids invoking PowerShell.

### Security model

| Risk | Control |
|---|---|
| Command injection | Module whitelist + `spawn()` with `shell: false` + args as array — no user input is ever concatenated into a command (the only exception is `npm`, which needs `shell: true` to resolve its `.cmd` wrapper on Windows — used exclusively with fixed literal arguments, never user input) |
| LAN exposure | Server binds to `127.0.0.1` only — inaccessible from other devices on the network |
| Directory traversal | Date validation with real-calendar check + `normalize()` + boundary assertion on all file paths |
| Stack trace leak | Global error handler returns generic 500 — no OS details reach the client |
| Input validation | Strict type checks on all body params — wrong types return `400 Bad Request` |
| DoS | 16 KB body limit + timeout safety net on every scan/action (2 min scan, 10 min action) |
| Privilege escalation | Registry/task changes that require admin (e.g. `HKLM` entries) are detected up front and skipped with a clear log message instead of failing silently |

### Disabling and re-enabling startup items

The Startup Optimizer module never deletes anything irreversibly:
- Registry `Run` entries are recorded (name + command + key) before being removed, so they
  can be recreated exactly as they were.
- Startup folder shortcuts are moved to a `Startup_Disabled` subfolder instead of being deleted.
- Scheduled tasks are disabled via Task Scheduler, never deleted.

The report and dashboard show a separate "Disabled" section (kept apart from the list of
active items so it doesn't clutter it) with a checklist to re-enable anything you disabled.

---

## How scripts handle confirmations (AUTO_CONFIRM)

`Confirm-Action` (used by the `.ps1` scripts) reads the `AUTO_CONFIRM` environment variable
and auto-approves instead of waiting for `Read-Host` input when it's set to `true`.

This means:
- **Running scripts manually from a terminal** → interactive, asks you before each step.
- **Running the weekly scheduled task / `Notify-*.ps1`** → still interactive unless you accept
  the popup, which then runs the action script normally.
- **Running from the web dashboard** → doesn't go through these `.ps1` scripts at all (see
  the architecture note above), so there's nothing to confirm — actions run immediately for
  whatever you selected in the UI.

---

## Portability

All PowerShell scripts are self-contained. They use `$PSScriptRoot` for their own location and standard environment variables (`$env:TEMP`, `$env:USERPROFILE`, etc.) for everything else. There are no hardcoded paths or usernames. You can clone this repo anywhere and run the scripts without editing them.

The only thing you need to update after cloning is the `<FULL_PATH>` placeholder in the `schtasks` commands and PowerShell profile functions above.

---

## Known limitations

- `winget upgrade` has no official JSON output (verified on v1.28). Output is parsed from the text table by column position. If Microsoft changes the format, winget results may appear empty — check the winget parsing logic in `server/server.js` (or `update-checker/Check-Updates.ps1` for the script-only path) if that happens.
- Boot performance (Windows Performance EventLog ID 100) is **not available from the web dashboard**. The only reliable way to read it without administrator rights is PowerShell's `Get-WinEvent` — `wevtutil` returns "Access is denied" for a non-admin user even though `Get-WinEvent` doesn't. Since the dashboard backend deliberately avoids spawning PowerShell (see the architecture note above), this metric is reported as unavailable rather than reintroduced at the cost of stability. It's still fully visible when running `startup-optimizer/Scan-Startup.ps1` directly.
- Startup folder shortcuts (`.lnk`) are listed by filename only from the web dashboard — resolving their actual target normally requires `WScript.Shell` (COM/PowerShell), which isn't used here for the same reason.
- Auto-start services are listed for information only and are never modified — disabling auto-start services without knowing which are critical can break the system.
- The npm global check may fail with `ENOENT` if the global npm folder (`%APPDATA%\npm`) does not exist — reported as an error, not as "0 updates".

---

## Module READMEs

Each module has its own README with detailed usage and portability notes:

- [`update-checker/README.md`](update-checker/README.md)
- [`disk-cleanup/README.md`](disk-cleanup/README.md)
- [`startup-optimizer/README.md`](startup-optimizer/README.md)

---

## License

[MIT](LICENSE)
