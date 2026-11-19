#pragma once

#include "TiltRepCounter.h"

class ShoulderPressCounter : public TiltRepCounter {
 public:
  // shortcut: upper-arm tilt targets are provisional until tested with the mounted sensor.
  ShoulderPressCounter() : TiltRepCounter(50.0f, 20.0f) {}
};
