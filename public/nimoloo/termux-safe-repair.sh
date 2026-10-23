#!/data/data/com.termux/files/usr/bin/bash
# NIMOLOO CONTROL - safe, local, non-destructive Android recovery
# Installs/restarts cron only, preserves all existing schedules and OAuth.
# NEVER publishes videos, modifies existing upload script, or sends local secrets.
set -Eeuo pipefail
PREFIX="/data/data/com.termux/files/usr"
ROOT="$HOME/Kids_Video_Agent"
BOOTDIR="$HOME/.termux/boot"
LOG="$HOME/.nimoloo-control-health.log"
STATUS="$HOME/.nimoloo-control-summary.txt"
mkdir -p "$BOOTDIR"
umask 077
exec > >(tee "$LOG") 2>&1
say(){ printf '%s\n' "$*"; }
say "===== NIMOLOO PRIVATE HEALTH CHECK ====="
date '+%Y-%m-%d %H:%M:%S %Z %z'
if [ ! -d "$ROOT" ]; then
 say "BLOCKED: project not found: $ROOT"
 say "No cron changes were made. Restore the original project folder."
 exit 1
fi
if [ ! -f "$ROOT/scripts/android_auto_private.py" ]; then
 say "BLOCKED: upload script missing. No schedule was changed."
 exit 1
fi
say "Project folder: PRESENT"
say "Publishing mode: existing private-only script; NOT executed by this repair."
tz="$(date +%z)"
if [ "$tz" != '+0300' ]; then
 say "WARNING: device timezone offset is $tz (expected +0300 Qatar)."
fi
if ! command -v crond >/dev/null 2>&1; then
 say "Cron missing; trying official Termux package installation."
 if command -v pkg >/dev/null 2>&1; then
  pkg install -y cronie || true
 fi
fi
if command -v crond >/dev/null 2>&1; then
 if pgrep -x crond >/dev/null 2>&1; then
  say "Scheduler: already running"
 else
  crond || true
  sleep 1
  if pgrep -x crond >/dev/null 2>&1; then
    say "Scheduler: STARTED"
  else
    say "BLOCKED: crond failed to start"
  fi
 fi
else
 say "BLOCKED: crond still unavailable"
fi
# Termux:Boot runs this executable when phone boots, if the user has opened
# the Termux:Boot app once and Android allows background operation.
BOOT="$BOOTDIR/nimoloo-cron"
if [ ! -f "$BOOT" ]; then
 cat > "$BOOT" <<'BOOTH'
#!/data/data/com.termux/files/usr/bin/sh
sleep 20
if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock; fi
if ! pgrep -x crond >/dev/null 2>&1; then
  /data/data/com.termux/files/usr/bin/crond
fi
BOOTH
 chmod 700 "$BOOT"
 say "Boot hook: INSTALLED (open Termux:Boot once to activate it)"
else
 say "Boot hook: PRESERVED"
fi
# Prevent duplicates: restore only if original Nimoloo marker is absent.
old="$(crontab -l 2>/dev/null || true)"
backup="$HOME/.nimoloo-crontab-backup-$(date +%Y%m%d%H%M%S)"
printf '%s\n' "$old" > "$backup"
chmod 600 "$backup"
if printf '%s\n' "$old" | grep -q 'NIMOLOO_AGENT'; then
 say "Scheduler entries: PRESERVED (already present)"
else
 mkdir -p "$ROOT/state"
 {
   printf '%s\n' "$old"
   echo "0 9 * * * cd $ROOT && $PREFIX/bin/python scripts/android_auto_private.py --slot morning >> state/auto.log 2>&1 # NIMOLOO_AGENT"
   echo "0 18 * * * cd $ROOT && $PREFIX/bin/python scripts/android_auto_private.py --slot evening >> state/auto.log 2>&1 # NIMOLOO_AGENT"
 } | crontab -
 say "Scheduler entries: ADDED 09:00 and 18:00 Qatar time"
fi
if "$PREFIX/bin/python" -m py_compile "$ROOT/scripts/android_auto_private.py"; then
 say "Upload script syntax: VALID"
else
 say "BLOCKED: invalid Python upload script syntax"
fi
for tool in ffmpeg ffprobe python; do
 if command -v "$tool" >/dev/null 2>&1; then
  say "Dependency $tool: PRESENT"
 else
  say "Dependency $tool: MISSING"
 fi
done
if command -v termux-wake-lock >/dev/null 2>&1; then
 termux-wake-lock || true
 say "Wake lock: requested"
else
 say "Wake lock: unavailable"
fi
if pgrep -x crond >/dev/null 2>&1; then status="RUNNING"; else status="NOT RUNNING"; fi
schedule="$(crontab -l 2>/dev/null | grep -c 'NIMOLOO_AGENT' || true)"
say "Scheduler: $status, Nimoloo jobs: $schedule"
if [ -f "$ROOT/state/auto.log" ]; then
 say "Upload log: present ($(wc -l < "$ROOT/state/auto.log") lines); content deliberately hidden to protect tokens"
else
 say "Upload log: not present"
fi
{
 printf '%s\n' "NIMOLOO CONTROL — LOCAL HEALTH REPORT"
 date '+%Y-%m-%d %H:%M:%S %z'
 printf '%s\n' "Cron process: $status"
 printf '%s\n' "Nimoloo schedules: $schedule"
 printf '%s\n' "Video uploads: NOT VERIFIED by this check"
 printf '%s\n' "OAuth tokens: NEVER COPIED"
 printf '%s\n' "Next: inspect YouTube Studio for actual video receipts"
} > "$STATUS"
chmod 600 "$STATUS"
say "Local safe summary: $STATUS"
say "IMPORTANT: manually allow unrestricted battery usage for Termux and Termux:Boot."
say "IMPORTANT: this repair does NOT prove a private YouTube upload happened."
