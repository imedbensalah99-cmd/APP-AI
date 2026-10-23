#!/data/data/com.termux/files/usr/bin/bash
# NIMOLOO CONTROL — safe, non-destructive Android/Termux preflight
# Does not publish videos, overwrite tokens, or edit YouTube privacy.
set -u
ROOT="$HOME/Kids_Video_Agent"
SARD="$HOME/SARDERA_Stories"
LOG="$HOME/nimoloo_control_preflight.log"
mkdir -p "$HOME/.termux/boot"
{
  echo "=== SAFE PREFLIGHT ==="
  date '+%Y-%m-%d %H:%M:%S %Z %z'
  echo "Termux: $PREFIX"
  if [ ! -d "$ROOT" ]; then echo "ERROR: Nimoloo project folder not found at $ROOT"; exit 1; fi
  echo "Nimoloo folder: OK"
  if command -v crond >/dev/null 2>&1; then
    if ! pgrep -x crond >/dev/null 2>&1; then
      crond && echo "crond: STARTED" || echo "ERROR: could not start crond"
    else
      echo "crond: ALREADY RUNNING"
    fi
  else
    echo "ERROR: crond is missing. Run: pkg install cronie"
  fi
  # Add the boot hook only if no existing Nimoloo hook is present.
  BOOT="$HOME/.termux/boot/nimoloo-cron"
  if [ ! -f "$BOOT" ]; then
    printf '%s\n' '#!/data/data/com.termux/files/usr/bin/sh'       'sleep 15'       '/data/data/com.termux/files/usr/bin/crond' > "$BOOT"
    chmod 700 "$BOOT"
    echo "Termux:Boot cron hook: INSTALLED"
  else
    echo "Termux:Boot cron hook: PRESERVED"
  fi
  # Respect all existing jobs; do not change hourly/twice-daily cadence.
  current="$(crontab -l 2>/dev/null || true)"
  if printf '%s\n' "$current" | grep -q 'NIMOLOO_AGENT'; then
    echo "Existing Nimoloo schedule: PRESERVED"
  elif [ -f "$ROOT/scripts/android_auto_private.py" ]; then
    {
      printf '%s\n' "$current"
      echo "0 9 * * * cd $ROOT && $PREFIX/bin/python scripts/android_auto_private.py --slot morning >> state/auto.log 2>&1 # NIMOLOO_AGENT"
      echo "0 18 * * * cd $ROOT && $PREFIX/bin/python scripts/android_auto_private.py --slot evening >> state/auto.log 2>&1 # NIMOLOO_AGENT"
    } | crontab -
    echo "Existing schedule missing: RESTORED 09:00 and 18:00 (Asia/Qatar)"
  else
    echo "ERROR: missing script scripts/android_auto_private.py, schedule unchanged"
  fi
  if [ -f "$ROOT/scripts/android_auto_private.py" ]; then
    "$PREFIX/bin/python" -m py_compile "$ROOT/scripts/android_auto_private.py" &&
      echo "Nimoloo Python syntax: OK" || echo "ERROR: Nimoloo script has a syntax error"
  fi
  if [ -d "$SARD" ]; then
    echo "SARDERA folder: PRESENT; narration must be checked separately; uploads not enabled."
  fi
  echo "=== ACTIVE JOBS ==="
  crontab -l 2>/dev/null || true
  echo "=== CROND PROCESS ==="
  pgrep -a crond || echo "ERROR: CRON NOT RUNNING"
  echo "=== NIMOLOO LOG TAIL ==="
  tail -n 25 "$ROOT/state/auto.log" 2>/dev/null || echo "No previous auto.log"
  echo "=== NEXT ACTION ==="
  echo "Leave the phone on with battery optimization disabled for Termux and Termux:Boot."
  echo "An existing YouTube OAuth credential and complete narration/render are required to upload."
  echo "This preflight does NOT verify any YouTube upload. Check your upload receipt in YouTube Studio."
} 2>&1 | tee "$LOG"
echo "Saved local diagnostic: $LOG"
