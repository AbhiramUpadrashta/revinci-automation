#!/bin/bash
# Double-click on macOS to launch the Revinci Test Automation control panel.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required: https://nodejs.org" ; read -n 1 ; exit 1
fi
[ -d node_modules ] || npm install
npm start
