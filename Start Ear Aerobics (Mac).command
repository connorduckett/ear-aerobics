#!/bin/bash
# Ear Aerobics launcher for macOS. Double-click to start, close the window to stop.
cd "$(dirname "$0")" || exit 1
clear
echo "Starting Ear Aerobics..."
echo "Your browser will open in a moment. Keep this window open while you practice."
echo "Close this window when you are done."
echo

# Use Python's built-in web server if a real Python 3 is available
# (on a fresh Mac, /usr/bin/python3 is only a stub until developer tools are installed).
PY=""
if command -v python3 >/dev/null 2>&1; then
  if [ "$(command -v python3)" != "/usr/bin/python3" ] || xcode-select -p >/dev/null 2>&1; then
    PY="python3"
  fi
fi

if [ -n "$PY" ]; then
  PORT=8642
  while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
  (sleep 1 && open "http://localhost:$PORT") &
  exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
else
  echo "Opening the app directly in your browser."
  echo "(Everything works this way in Chrome. If the Sandbox tab won't play, use the website link in the README.)"
  open "index.html"
fi
