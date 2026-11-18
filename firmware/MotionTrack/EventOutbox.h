#pragma once

// Small fixed-size queue of device events with stable sequence numbers so that
// uploads can be retried safely. Arduino-free for host testing.

#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

enum class EventType : uint8_t { Status, BeforeBpm, Progress, AfterBpm };

struct OutEvent {
  EventType type;
  int value;
  uint8_t status;  // 0 waiting_finger, 1 reading, 2 weak_signal, 3 counting
  uint32_t sequence;
};

class EventOutbox {
 public:
  static const size_t Capacity = 16;

  void reset(uint32_t lastSequence) {
    head_ = 0;
    count_ = 0;
    headAssigned_ = false;
    nextSeq_ = lastSequence + 1;
    haveLastStatus_ = false;
    haveAcked_ = false;
  }

  bool push(EventType type, int value, uint8_t status = 0) {
    if (type == EventType::Status) {
      if (haveLastStatus_ && lastStatus_ == status) return true;
    } else if (type == EventType::Progress && count_ > 0) {
      size_t tail = count_ - 1;
      bool tailSent = (tail == 0 && headAssigned_);
      OutEvent& t = at(tail);
      if (!tailSent && t.type == EventType::Progress) {
        t.value = value;
        return true;
      }
    }
    if (count_ == Capacity) {
      size_t victim = findUnsent(EventType::Status);
      if (victim == Capacity) victim = findUnsent(EventType::Progress);
      if (victim == Capacity) return false;
      removeAt(victim);
    }
    OutEvent& e = at(count_);
    e.type = type;
    e.value = value;
    e.status = status;
    e.sequence = 0;
    count_++;
    if (type == EventType::Status) {
      haveLastStatus_ = true;
      lastStatus_ = status;
    }
    return true;
  }

  // Oldest queued event; its sequence is assigned on first call and kept on retries.
  bool front(OutEvent& out) {
    if (count_ == 0) return false;
    if (!headAssigned_) {
      buf_[head_].sequence = nextSeq_++;
      headAssigned_ = true;
    }
    out = buf_[head_];
    return true;
  }

  void ack() {
    if (count_ == 0 || !headAssigned_) return;
    lastAcked_ = buf_[head_];
    haveAcked_ = true;
    pop();
  }

  // Discard the head without recording it as acknowledged.
  void drop() {
    if (count_ == 0) return;
    pop();
  }

  bool lastAcked(OutEvent& out) const {
    if (!haveAcked_) return false;
    out = lastAcked_;
    return true;
  }

  size_t size() const { return count_; }

 private:
  OutEvent& at(size_t i) { return buf_[(head_ + i) % Capacity]; }

  void pop() {
    head_ = (head_ + 1) % Capacity;
    count_--;
    headAssigned_ = false;
  }

  size_t findUnsent(EventType type) {
    for (size_t i = (headAssigned_ ? 1 : 0); i < count_; i++)
      if (at(i).type == type) return i;
    return Capacity;
  }

  void removeAt(size_t i) {
    for (size_t j = i; j + 1 < count_; j++) at(j) = at(j + 1);
    count_--;
  }

  OutEvent buf_[Capacity] = {};
  size_t head_ = 0;
  size_t count_ = 0;
  bool headAssigned_ = false;
  uint32_t nextSeq_ = 1;
  bool haveLastStatus_ = false;
  uint8_t lastStatus_ = 0;
  bool haveAcked_ = false;
  OutEvent lastAcked_ = {};
};

// Returns the JSON length, or 0 if it did not fit in buf.
inline size_t toJson(const OutEvent& e, char* buf, size_t len) {
  static const char* const kStatus[4] = {"waiting_finger", "reading", "weak_signal", "counting"};
  int n = 0;
  switch (e.type) {
    case EventType::Status:
      n = snprintf(buf, len, "{\"sequence\":%lu,\"event\":\"status\",\"capture_status\":\"%s\"}",
                   (unsigned long)e.sequence, kStatus[e.status < 4 ? e.status : 0]);
      break;
    case EventType::BeforeBpm:
      n = snprintf(buf, len, "{\"sequence\":%lu,\"event\":\"before_bpm\",\"bpm\":%d}",
                   (unsigned long)e.sequence, e.value);
      break;
    case EventType::Progress:
      n = snprintf(buf, len, "{\"sequence\":%lu,\"event\":\"progress\",\"repetitions\":%d}",
                   (unsigned long)e.sequence, e.value);
      break;
    case EventType::AfterBpm:
      n = snprintf(buf, len, "{\"sequence\":%lu,\"event\":\"after_bpm\",\"bpm\":%d}",
                   (unsigned long)e.sequence, e.value);
      break;
  }
  if (n < 0 || (size_t)n >= len) return 0;
  return (size_t)n;
}
