#pragma once

#include "TiltRepCounter.h"

class BackRowCounter : public TiltRepCounter {
 public:
  // shortcut: upper-arm tilt targets are provisional until tested with the mounted sensor.
  BackRowCounter() : TiltRepCounter(30.0f, 12.0f) {}
};
