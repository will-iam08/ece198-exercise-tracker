#!/bin/bash
set -e
cd "$(dirname "$0")"
g++ -std=c++17 -Wall -Wextra -Werror -I../MotionTrack host_tests.cpp -o /tmp/mt_tests
/tmp/mt_tests
