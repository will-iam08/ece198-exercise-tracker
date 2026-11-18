#pragma once

// Wi-Fi + HTTP link to the MotionTrack backend. All network calls run in a
// FreeRTOS task pinned to core 0; loop() on core 1 only reads the last polled
// workout and queues events, both behind one mutex.

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include "EventOutbox.h"
#include "ExerciseFlow.h"

// exercise index reported for an exercise_id this firmware does not know.
const uint8_t EXERCISE_UNKNOWN = 0xFF;

class DeviceLink {
 public:
  void begin();

  // Last workout from the server. False until the first poll answered (or 401).
  bool snapshot(ServerWorkout& out, uint32_t& ageMs);

  // Queue an event for the workout set by startWorkout(). False if no workout or queue full.
  bool push(EventType type, int value, uint8_t status = 0, bool force = false);

  // New workout id: clear the queue and continue numbering after lastSequence.
  void startWorkout(const char* id, uint32_t lastSequence);

  // Resend the last acknowledged upload byte-identical; the result is printed to Serial.
  void requestRetryLast();

  bool wifiUp();
  bool serverOk();       // last poll got a valid reply
  bool notRegistered();  // server answered 401 to the device token

 private:
  static void taskEntry(void* arg);
  void run();
  void ensureWifi(uint32_t now);
  void poll();
  void sendFront(uint32_t now);
  void retryLast();
  int post(const char* workoutId, const char* body, size_t len, String& reply, String& error);

  SemaphoreHandle_t lock_ = nullptr;
  TaskHandle_t task_ = nullptr;

  // Shared with loop(); guarded by lock_.
  ServerWorkout snapshot_ = {};
  bool haveSnapshot_ = false;
  uint32_t snapshotAt_ = 0;
  EventOutbox outbox_;
  char outboxId_[sizeof(ServerWorkout::id)] = {0};
  uint32_t generation_ = 0;  // bumped by startWorkout so an in-flight upload result is ignored
  bool wifiUp_ = false;
  bool serverOk_ = false;
  bool notRegistered_ = false;
  bool retryRequested_ = false;
  bool pollNow_ = false;

  // Network task only.
  uint32_t lastPoll_ = 0;
  bool polledOnce_ = false;
  uint32_t lastWifiAttempt_ = 0;
  bool wifiBegun_ = false;
  bool wasConnected_ = false;
  uint32_t nextSendAt_ = 0;
  bool sendWaiting_ = false;
  uint32_t backoffMs_ = 0;
  uint32_t seenGeneration_ = 0;
  bool stackReported_ = false;
  char lastAckedBody_[128] = {0};
  size_t lastAckedLen_ = 0;
  char lastAckedId_[sizeof(ServerWorkout::id)] = {0};
  uint32_t lastAckedSeq_ = 0;
};
