#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

c++ -std=c++17 -Wall -Wextra -Werror -I../Firmware/MotionTrack ../../firmware/tests/host_tests.cpp -o "$out/sensors"
"$out/sensors"
c++ -std=c++17 -I../Firmware/MotionTrack flow.cpp -o "$out/flow"
"$out/flow" > "$out/snapshots.bin"
swiftc ../MotionLog/Tracker.swift main.swift -o "$out/decode"
"$out/decode" "$out/snapshots.bin"
