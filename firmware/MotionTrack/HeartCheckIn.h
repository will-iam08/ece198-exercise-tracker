#pragma once

// Heart-rate check-in: turns finger-presence + detected beats into a stable BPM.
// Arduino-free so it can be tested on the host.

#include <stdint.h>
#include <stddef.h>
#include <math.h>

struct HeartCheckInConfig {
  long fingerThreshold = 10000;
  uint8_t requiredIntervals = 6;
  float tolerance = 0.15f;
  float minBpm = 30;
  float maxBpm = 220;
  uint32_t retryAfterMs = 15000;  // no progress (no two agreeing intervals in a row) for this long -> TryAgain
  uint32_t fingerLostMs = 750;    // finger off the sensor for this long -> TryAgain; shorter dips are ignored
  uint32_t tryAgainShowMs = 1500;
};

enum class CheckIn : uint8_t { WaitingFinger, Reading, TryAgain, Done };

class HeartCheckIn {
 public:
  static const uint8_t MaxIntervals = 16;

  explicit HeartCheckIn(const HeartCheckInConfig& cfg) : cfg_(cfg) { start(0); }

  void start(uint32_t nowMs) {
    (void)nowMs;
    state_ = CheckIn::WaitingFinger;
    bpm_ = 0;
    clearIntervals();
  }

  CheckIn update(long ir, bool beat, uint32_t nowMs) {
    const bool finger = ir >= cfg_.fingerThreshold;
    switch (state_) {
      case CheckIn::Done:
        return state_;

      case CheckIn::TryAgain:
        if (nowMs - stateSince_ >= cfg_.tryAgainShowMs) {
          clearIntervals();
          state_ = CheckIn::WaitingFinger;
        }
        return state_;

      case CheckIn::WaitingFinger:
        if (!finger) return state_;
        clearIntervals();
        state_ = CheckIn::Reading;
        progressAt_ = nowMs;
        lifted_ = false;
        // fall through to process a beat arriving on the same sample
        break;

      case CheckIn::Reading:
        break;
    }

    // Reading
    if (!finger) {
      if (!lifted_) {
        lifted_ = true;
        liftedAt_ = nowMs;
      }
      if (nowMs - liftedAt_ >= cfg_.fingerLostMs) return enterTryAgain(nowMs);
      return state_;  // brief dip: ignore this sample
    }
    lifted_ = false;
    if (beat) onBeat(nowMs);
    if (state_ == CheckIn::Done) return state_;
    if (nowMs - progressAt_ >= cfg_.retryAfterMs) return enterTryAgain(nowMs);
    return state_;
  }

  int bpm() const { return bpm_; }
  uint8_t intervals() const { return count_; }

 private:
  void clearIntervals() {
    count_ = 0;
    haveLast_ = false;
  }

  CheckIn enterTryAgain(uint32_t nowMs) {
    state_ = CheckIn::TryAgain;
    stateSince_ = nowMs;
    clearIntervals();
    return state_;
  }

  void onBeat(uint32_t nowMs) {
    if (!haveLast_) {
      haveLast_ = true;
      lastBeat_ = nowMs;
      return;
    }
    uint32_t interval = nowMs - lastBeat_;
    lastBeat_ = nowMs;
    const float minMs = 60000.0f / cfg_.maxBpm;
    const float maxMs = 60000.0f / cfg_.minBpm;
    if ((float)interval < minMs || (float)interval > maxMs) {
      count_ = 0;  // out-of-range interval: restart collection from this beat
      return;
    }
    uint8_t need = cfg_.requiredIntervals;
    if (need > MaxIntervals) need = MaxIntervals;
    if (need == 0) need = 1;
    // Progress: this interval agrees with the previous one, so the signal is settling.
    if (count_ > 0) {
      const float prev = (float)intervals_[count_ - 1];
      if (fabsf((float)interval - prev) <= cfg_.tolerance * prev) progressAt_ = nowMs;
    }
    if (count_ == MaxIntervals) {
      for (uint8_t i = 1; i < count_; i++) intervals_[i - 1] = intervals_[i];
      count_--;
    }
    intervals_[count_++] = interval;
    if (count_ < need) return;

    // Median of the last `need` intervals.
    uint32_t w[MaxIntervals];
    uint8_t first = count_ - need;
    for (uint8_t i = 0; i < need; i++) w[i] = intervals_[first + i];
    for (uint8_t i = 1; i < need; i++) {  // insertion sort
      uint32_t v = w[i];
      int8_t j = (int8_t)i - 1;
      while (j >= 0 && w[j] > v) {
        w[j + 1] = w[j];
        j--;
      }
      w[j + 1] = v;
    }
    float median = (need % 2) ? (float)w[need / 2]
                              : ((float)w[need / 2 - 1] + (float)w[need / 2]) * 0.5f;
    for (uint8_t i = 0; i < need; i++) {
      float dev = fabsf((float)intervals_[first + i] - median);
      if (dev > cfg_.tolerance * median) return;
    }
    bpm_ = (int)lroundf(60000.0f / median);
    state_ = CheckIn::Done;
  }

  HeartCheckInConfig cfg_;
  CheckIn state_ = CheckIn::WaitingFinger;
  int bpm_ = 0;
  uint32_t intervals_[MaxIntervals] = {0};
  uint8_t count_ = 0;
  bool haveLast_ = false;
  uint32_t lastBeat_ = 0;
  uint32_t progressAt_ = 0;
  bool lifted_ = false;
  uint32_t liftedAt_ = 0;
  uint32_t stateSince_ = 0;
};
