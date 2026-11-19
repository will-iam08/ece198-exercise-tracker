#pragma once

// Tracks which phase of the workout this device is in and keeps it consistent
// with what the server reports. Arduino-free for host testing.

#include <stdint.h>
#include <stddef.h>
#include <string.h>

enum class Phase : uint8_t { None, BeforeBpm, Counting, AfterBpm, Done };

inline Phase parsePhase(const char* s) {
  if (!s) return Phase::None;
  if (strcmp(s, "before_bpm") == 0) return Phase::BeforeBpm;
  if (strcmp(s, "counting") == 0) return Phase::Counting;
  if (strcmp(s, "after_bpm") == 0) return Phase::AfterBpm;
  if (strcmp(s, "done") == 0) return Phase::Done;
  return Phase::None;
}

struct ServerWorkout {
  bool present;
  char id[37];
  bool reps;
  uint8_t exercise;  // 0..2
  uint16_t target;
  Phase phase;
  uint16_t repetitions;
  uint32_t lastSequence;
};

class ExerciseFlow {
 public:
  enum class Action : uint8_t { None, Reset, Follow, Ended };

  // counterTotal (required) is the rep counter's current running total; it anchors the
  // baseline when the server's repetition count is adopted (resume/follow).
  Action sync(const ServerWorkout& s, uint32_t counterTotal) {
    if (!s.present || s.phase == Phase::Done) {
      active_ = false;
      id_[0] = '\0';
      phase_ = Phase::None;
      return Action::Ended;
    }
    if (!active_ || strncmp(id_, s.id, sizeof(id_)) != 0) {
      strncpy(id_, s.id, sizeof(id_) - 1);
      id_[sizeof(id_) - 1] = '\0';
      active_ = true;
      target_ = s.target;
      phase_ = (s.phase == Phase::None) ? Phase::BeforeBpm : s.phase;
      reps_ = s.repetitions;
      if (target_ > 0 && reps_ > target_) reps_ = target_;
      setBaseline(counterTotal - reps_);
      entered_ = phase_;
      return Action::Reset;
    }
    target_ = s.target;
    if (rank(s.phase) > rank(phase_)) {
      phase_ = s.phase;
      if (s.repetitions > reps_) {
        reps_ = s.repetitions;
        if (target_ > 0 && reps_ > target_) reps_ = target_;
        setBaseline(counterTotal - reps_);
      } else if (phase_ == Phase::Counting) {
        setBaseline(counterTotal - reps_);
      }
      entered_ = phase_;
      return Action::Follow;
    }
    return Action::None;
  }

  // Returns reps this workout; frozen at target. Reaching target enters AfterBpm.
  uint16_t onRep(uint32_t counterTotal) {
    if (phase_ != Phase::Counting) return reps_;
    if ((int32_t)(counterTotal - baseline_) < 0) {
      // Counter total fell behind the baseline (reset/wrap): re-anchor, no rep.
      baseline_ = counterTotal - reps_;
      return reps_;
    }
    uint32_t n = counterTotal - baseline_;
    if (n > 0xFFFFu) n = 0xFFFFu;
    if (target_ > 0 && n >= target_) {
      reps_ = target_;
      phase_ = Phase::AfterBpm;
      entered_ = Phase::AfterBpm;
    } else {
      reps_ = (uint16_t)n;
    }
    return reps_;
  }

  // counterTotal re-baselines so reps detected during the check-in are not counted.
  void onBeforeBpmSaved(uint32_t counterTotal) {
    if (phase_ == Phase::BeforeBpm) {
      setBaseline(counterTotal - reps_);
      phase_ = Phase::Counting;
      entered_ = Phase::Counting;
    }
  }

  void onAfterBpmSaved() {
    if (phase_ == Phase::AfterBpm) phase_ = Phase::Done;
  }

  Phase phase() const { return phase_; }
  uint16_t reps() const { return reps_; }
  bool frozen() const { return target_ > 0 && reps_ >= target_; }
  void setBaseline(uint32_t counterTotal) { baseline_ = counterTotal; }

  // One-shot: the phase most recently entered (via Reset, Follow, a saved
  // before-BPM or reaching the target), or Phase::None if nothing new. The
  // sketch pushes a fresh status event for it.
  Phase takeEntered() {
    Phase p = entered_;
    entered_ = Phase::None;
    return p;
  }

 private:
  static uint8_t rank(Phase p) { return (uint8_t)p; }

  bool active_ = false;
  char id_[37] = {0};
  Phase phase_ = Phase::None;
  Phase entered_ = Phase::None;
  uint16_t target_ = 0;
  uint16_t reps_ = 0;
  uint32_t baseline_ = 0;
};
