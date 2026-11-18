#!/bin/bash
set -e
cd "$(dirname "$0")"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
g++ -std=c++17 -Wall -Wextra -Werror -I../MotionTrack host_tests.cpp -o "$out/mt_tests"
"$out/mt_tests"
