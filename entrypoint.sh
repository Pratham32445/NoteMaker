#!/bin/bash
set -e

Xvfb $DISPLAY -screen 0 $SCREEN_RES -ac +extension RANDR &
fluxbox &

sleep 2
if ! xdpyinfo -display $DISPLAY >/dev/null 2>&1; then
    echo "Xvfb failed to start"
    exit 1
fi

/opt/bin/entry_point.sh &

echo "Waiting for Selenium to be ready..."
until curl -s http://localhost:4444/wd/hub/status | jq -e '.value.ready == true' > /dev/null; do
    sleep 1
done

echo "Selenium Grid is ready."

echo "Starting Bun app..."
bun run index.ts
