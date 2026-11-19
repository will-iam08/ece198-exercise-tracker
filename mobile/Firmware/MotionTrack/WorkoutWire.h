#pragma once
#include <stdint.h>
#include <stddef.h>
#include <array>

namespace workout {
constexpr char service[] = "45583198-0001-4BAD-9000-000000000065";
constexpr char telemetry[] = "45583198-0002-4BAD-9000-000000000065";
constexpr char control[] = "45583198-0003-4BAD-9000-000000000065";
enum Stage : uint8_t { Idle, Before, Counting, After, Complete, Stopped, Fault, Starting };
constexpr uint8_t modes[] = {1, 3, 4}; // curl, shoulder press, back row
struct Command { uint8_t op, movement, target, expected; };
inline bool decode(const uint8_t* bytes, size_t size, Command& out) {
    if (size != 5 || bytes[0] != 1) return false;
    out = {bytes[1],bytes[2],bytes[3],bytes[4]};
    if (out.op == 1) return (out.movement == 1 || out.movement == 3 || out.movement == 4)
                         && out.target >= 1 && out.target <= 99;
    return (out.op == 2 || out.op == 3) && !out.movement && !out.target;
}
using Packet = std::array<uint8_t,17>;
inline Packet packet(Stage stage, uint16_t reps, uint32_t seconds, uint8_t movement, uint8_t target,
                     uint8_t flags, uint8_t before, uint8_t after, uint8_t capture) {
    const uint8_t phase = stage == Before || stage == Counting || stage == After ? 1 :
                          stage == Complete || stage == Stopped ? 2 : 0;
    const uint8_t pulse = after ? after : before;
    return {{3,phase,uint8_t(reps),uint8_t(reps>>8),uint8_t(seconds),uint8_t(seconds>>8),
        uint8_t(seconds>>16),uint8_t(seconds>>24),movement,pulse,0,uint8_t(stage),
        target,flags,before,after,capture}};
}
}
