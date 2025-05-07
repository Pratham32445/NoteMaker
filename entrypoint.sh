#!/bin/bash
set -e

sudo chmod 1777 /tmp/.X11-unix || true

Xvfb $DISPLAY -screen 0 $SCREEN_RES -ac +extension RANDR &
fluxbox &

sleep 2
if ! xdpyinfo -display $DISPLAY >/dev/null 2>&1; then
    echo "Xvfb failed to start"
    exit 1
fi

if [ -f /opt/bin/entry_point.sh ]; then
    /opt/bin/entry_point.sh &
fi

echo "Waiting for Selenium to be ready..."
until curl -s http://localhost:4444/wd/hub/status | jq -e '.value.ready == true' > /dev/null; do
    sleep 1
done

mkdir -p /app/recordings

echo "Selenium Grid is ready."

echo "Starting Bun app..."
bun run index.ts
