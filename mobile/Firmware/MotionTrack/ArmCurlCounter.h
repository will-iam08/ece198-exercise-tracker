#pragma once

#include "TiltRepCounter.h"

class ArmCurlCounter : public TiltRepCounter {
 public:
  ArmCurlCounter() : TiltRepCounter(35.0f, 20.0f) {}
};
