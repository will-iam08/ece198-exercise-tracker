#pragma once
#include "WorkoutWire.h"
namespace radio {
void begin();
bool next(workout::Command& command);
void publish(const workout::Packet& packet);
}
