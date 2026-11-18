#include "DeviceLink.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <string.h>

#include "config.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy secrets.example.h to secrets.h and fill in your Wi-Fi and device token"
#endif

namespace {

const uint32_t TASK_STACK = 8192;
const UBaseType_t TASK_PRIORITY = 1;
const BaseType_t TASK_CORE = 0;

class Guard {
 public:
  explicit Guard(SemaphoreHandle_t lock) : lock_(lock) { xSemaphoreTake(lock_, portMAX_DELAY); }
  ~Guard() { xSemaphoreGive(lock_); }
  Guard(const Guard&) = delete;
  Guard& operator=(const Guard&) = delete;

 private:
  SemaphoreHandle_t lock_;
};

uint8_t exerciseIndex(const char* id) {
  if (strcmp(id, "arm_curl") == 0) return 0;
  if (strcmp(id, "shoulder_press") == 0) return 1;
  if (strcmp(id, "back_row") == 0) return 2;
  return EXERCISE_UNKNOWN;
}

void prepare(HTTPClient& http) {
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
}

// Parses {"workout": {...} | null}. Missing or null fields fall back to safe defaults.
bool parseWorkout(const String& body, ServerWorkout& w) {
  JsonDocument filter;
  JsonObject f = filter["workout"].to<JsonObject>();
  f["id"] = true;
  f["kind"] = true;
  f["exercise_id"] = true;
  f["target_reps"] = true;
  f["phase"] = true;
  f["repetitions"] = true;
  f["last_sequence"] = true;

  JsonDocument doc;
  if (deserializeJson(doc, body, DeserializationOption::Filter(filter))) return false;
  if (!doc.is<JsonObject>()) return false;

  memset(&w, 0, sizeof(w));
  JsonVariantConst v = doc["workout"];
  if (v.isNull()) {
    w.present = false;
    return true;
  }
  if (!v.is<JsonObjectConst>()) return false;

  const char* id = v["id"] | "";
  size_t idLen = strlen(id);
  if (idLen == 0 || idLen >= sizeof(w.id)) return false;
  memcpy(w.id, id, idLen + 1);

  w.present = true;
  w.reps = strcmp(v["kind"] | "timed", "reps") == 0;
  w.exercise = exerciseIndex(v["exercise_id"] | "");
  long target = v["target_reps"] | 0L;
  w.target = (uint16_t)constrain(target, 0L, 65535L);
  w.phase = parsePhase(v["phase"] | "");
  long reps = v["repetitions"] | 0L;
  w.repetitions = (uint16_t)constrain(reps, 0L, 65535L);
  w.lastSequence = v["last_sequence"] | (uint32_t)0;
  return true;
}

// Short human-readable summary of an upload reply: "duplicate:true" or the error message.
String replySummary(const String& reply) {
  JsonDocument filter;
  filter["duplicate"] = true;
  filter["error"]["message"] = true;
  JsonDocument doc;
  if (reply.length() == 0 || deserializeJson(doc, reply, DeserializationOption::Filter(filter))) {
    return reply.length() ? String("(unreadable reply)") : String("(empty reply)");
  }
  if (doc["duplicate"].is<bool>()) return String("duplicate:") + (doc["duplicate"].as<bool>() ? "true" : "false");
  const char* message = doc["error"]["message"] | "";
  return message[0] ? String(message) : String("(no message)");
}

}  // namespace

void DeviceLink::begin() {
  lock_ = xSemaphoreCreateMutex();
  outbox_.reset(0);
  xTaskCreatePinnedToCore(taskEntry, "DeviceLink", TASK_STACK, this, TASK_PRIORITY, &task_, TASK_CORE);
}

bool DeviceLink::snapshot(ServerWorkout& out, uint32_t& ageMs) {
  Guard g(lock_);
  if (!haveSnapshot_) return false;
  out = snapshot_;
  ageMs = millis() - snapshotAt_;
  return true;
}

bool DeviceLink::push(EventType type, int value, uint8_t status, bool force) {
  Guard g(lock_);
  if (!outboxId_[0]) return false;
  return outbox_.push(type, value, status, force);
}

void DeviceLink::startWorkout(const char* id, uint32_t lastSequence) {
  Guard g(lock_);
  strncpy(outboxId_, id, sizeof(outboxId_) - 1);
  outboxId_[sizeof(outboxId_) - 1] = '\0';
  outbox_.reset(lastSequence);
  generation_++;
}

void DeviceLink::requestRetryLast() {
  Guard g(lock_);
  retryRequested_ = true;
}

bool DeviceLink::wifiUp() {
  Guard g(lock_);
  return wifiUp_;
}

bool DeviceLink::serverOk() {
  Guard g(lock_);
  return serverOk_;
}

bool DeviceLink::notRegistered() {
  Guard g(lock_);
  return notRegistered_;
}

void DeviceLink::taskEntry(void* arg) {
  static_cast<DeviceLink*>(arg)->run();
}

void DeviceLink::run() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);  // lower request latency; the device is on USB/battery for short sessions
  for (;;) {
    uint32_t now = millis();
    ensureWifi(now);
    bool up, retry, pollNow, haveFront;
    uint32_t generation;
    {
      Guard g(lock_);
      generation = generation_;
      up = wifiUp_;
      retry = retryRequested_;
      retryRequested_ = false;
      pollNow = pollNow_;
      haveFront = outbox_.size() > 0 && outboxId_[0] != '\0';
    }
    if (generation != seenGeneration_) {  // new workout: do not inherit the old upload backoff
      seenGeneration_ = generation;
      backoffMs_ = 0;
      sendWaiting_ = false;
    }
    if (!up) {
      if (retry) Serial.println("Retry: Wi-Fi is not connected");
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    if (retry) {
      retryLast();
      continue;
    }
    const bool pollDue = !polledOnce_ || now - lastPoll_ >= POLL_MS;
    const bool sendReady = haveFront && (!sendWaiting_ || (int32_t)(now - nextSendAt_) >= 0);
    if (pollDue) {
      poll();
    } else if (sendReady) {
      sendFront(now);
    } else if (pollNow) {
      poll();
    } else {
      vTaskDelay(pdMS_TO_TICKS(20));
    }
  }
}

void DeviceLink::ensureWifi(uint32_t now) {
  const wl_status_t status = WiFi.status();
  const bool up = status == WL_CONNECTED;
  if ((int)status != lastWifiStatus_) {  // a join moving forward (or failing) changes the status
    lastWifiStatus_ = (int)status;
    wifiStatusSince_ = now;
  }
  if (up && !wasConnected_) {
    Serial.printf("Wi-Fi connected to \"%s\", IP %s. Server: %s\n", WIFI_SSID,
                  WiFi.localIP().toString().c_str(), API_BASE_URL);
  } else if (!up && wasConnected_) {
    Serial.println("Wi-Fi lost. Reconnecting.");
  }
  wasConnected_ = up;
  // The core's auto-reconnect retries most failures by itself. Restarting the join is only a fallback for a
  // link that has shown no change for WIFI_RETRY_MS, so a slow join (scan, handshake, DHCP) is never cut short.
  if (!up && !wifiBegun_) {
    Serial.printf("Wi-Fi: connecting to \"%s\"\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    wifiBegun_ = true;
    lastWifiAttempt_ = now;
  } else if (!up && now - lastWifiAttempt_ >= WIFI_RETRY_MS && now - wifiStatusSince_ >= WIFI_RETRY_MS) {
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWifiAttempt_ = now;
  }
  Guard g(lock_);
  wifiUp_ = up;
  if (!up) serverOk_ = false;
}

void DeviceLink::poll() {
  {
    Guard g(lock_);
    pollNow_ = false;
  }
  polledOnce_ = true;
  fetchWorkout();
  // Stamp the end of the round trip, so a slow poll (up to the 3 s timeout) cannot make the next one due
  // at once and starve queued uploads.
  lastPoll_ = millis();
}

void DeviceLink::fetchWorkout() {
  static int lastLogged = 0;  // log only changes, not every second
  WiFiClient client;
  HTTPClient http;
  prepare(http);
  int code = -1;
  String body;
  if (http.begin(client, String(API_BASE_URL) + "/api/device/workout")) {
    http.addHeader("Authorization", "Bearer " DEVICE_TOKEN);
    http.addHeader("Accept", "application/json");
    code = http.GET();
    if (code > 0) body = http.getString();
    http.end();
  }

  if (code == 401) {
    if (lastLogged != code) Serial.println("Server: HTTP 401 - device not registered (check DEVICE_TOKEN in secrets.h)");
    lastLogged = code;
    Guard g(lock_);
    memset(&snapshot_, 0, sizeof(snapshot_));
    haveSnapshot_ = true;
    snapshotAt_ = millis();
    serverOk_ = true;
    notRegistered_ = true;
    return;
  }

  ServerWorkout w;
  if (code >= 200 && code < 300 && parseWorkout(body, w)) {
    if (lastLogged != 200) Serial.println("Server: connected");
    lastLogged = 200;
    if (!stackReported_) {
      stackReported_ = true;
      Serial.printf("DeviceLink task: %u bytes of stack never used\n", (unsigned)uxTaskGetStackHighWaterMark(nullptr));
    }
    Guard g(lock_);
    snapshot_ = w;
    haveSnapshot_ = true;
    snapshotAt_ = millis();
    serverOk_ = true;
    notRegistered_ = false;
    return;
  }

  int logCode = code >= 200 && code < 300 ? 1 : code;  // 1 = unreadable 2xx reply
  if (lastLogged != logCode) {
    if (code < 0) Serial.printf("Server: no reply (%s)\n", HTTPClient::errorToString(code).c_str());
    else if (logCode == 1) Serial.println("Server: unexpected reply to workout poll");
    else Serial.printf("Server: HTTP %d on workout poll\n", code);
  }
  lastLogged = logCode;
  Guard g(lock_);
  serverOk_ = false;  // keep the last good snapshot; the device carries on offline
}

int DeviceLink::post(const char* workoutId, const char* body, size_t len, String& reply, String& error) {
  WiFiClient client;
  HTTPClient http;
  prepare(http);
  String url = String(API_BASE_URL) + "/api/device/workouts/" + workoutId + "/updates";
  if (!http.begin(client, url)) {
    error = "bad API_BASE_URL";
    return -1;
  }
  http.addHeader("Authorization", "Bearer " DEVICE_TOKEN);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(reinterpret_cast<uint8_t*>(const_cast<char*>(body)), len);
  if (code > 0) reply = http.getString();
  else error = HTTPClient::errorToString(code);
  http.end();
  return code;
}

void DeviceLink::sendFront(uint32_t now) {
  (void)now;
  OutEvent e;
  char id[sizeof(outboxId_)];
  uint32_t gen;
  {
    Guard g(lock_);
    if (!outboxId_[0] || !outbox_.front(e)) return;
    memcpy(id, outboxId_, sizeof(id));
    gen = generation_;
  }
  char body[sizeof(lastAckedBody_)];
  size_t len = toJson(e, body, sizeof(body));
  if (len == 0) {  // cannot happen with the fixed event formats; never block the queue
    Guard g(lock_);
    if (gen == generation_) outbox_.drop();
    return;
  }

  String reply, error;
  const int code = post(id, body, len, reply, error);
  const uint32_t done = millis();

  if (code >= 200 && code < 300) {
    memcpy(lastAckedBody_, body, len + 1);
    lastAckedLen_ = len;
    memcpy(lastAckedId_, id, sizeof(lastAckedId_));
    lastAckedSeq_ = e.sequence;
    backoffMs_ = 0;
    sendWaiting_ = false;
    Guard g(lock_);
    if (gen == generation_) outbox_.ack();
    pollNow_ = true;
    serverOk_ = true;
    notRegistered_ = false;
    return;
  }

  if (code == 401) {
    Serial.printf("Upload seq %lu -> HTTP 401: device not registered\n", (unsigned long)e.sequence);
    Guard g(lock_);
    memset(&snapshot_, 0, sizeof(snapshot_));
    haveSnapshot_ = true;
    snapshotAt_ = done;
    notRegistered_ = true;
  } else if (code >= 400 && code < 500 && code != 408 && code != 429) {
    // 409 (phase moved on, e.g. skipped on the website) and other refusals: a resend cannot succeed.
    Serial.printf("Upload seq %lu refused -> HTTP %d %s\n", (unsigned long)e.sequence, code,
                  replySummary(reply).c_str());
    backoffMs_ = 0;
    sendWaiting_ = false;
    Guard g(lock_);
    if (gen == generation_) outbox_.drop();
    pollNow_ = true;
    return;
  }

  // Network error, 5xx, 401, 408, 429: resend the same bytes later.
  backoffMs_ = backoffMs_ == 0 ? UPLOAD_BACKOFF_MIN_MS : min(backoffMs_ * 2, UPLOAD_BACKOFF_MAX_MS);
  nextSendAt_ = done + backoffMs_;
  sendWaiting_ = true;
  if (code < 0) {
    Serial.printf("Upload seq %lu failed (%s); retry in %lu s\n", (unsigned long)e.sequence, error.c_str(),
                  (unsigned long)(backoffMs_ / 1000));
  } else if (code != 401) {
    Serial.printf("Upload seq %lu -> HTTP %d; retry in %lu s\n", (unsigned long)e.sequence, code,
                  (unsigned long)(backoffMs_ / 1000));
  }
}

void DeviceLink::retryLast() {
  if (lastAckedLen_ == 0) {
    Serial.println("Retry: no acknowledged upload yet");
    return;
  }
  Serial.printf("Retry seq %lu: resending %s\n", (unsigned long)lastAckedSeq_, lastAckedBody_);
  String reply, error;
  const int code = post(lastAckedId_, lastAckedBody_, lastAckedLen_, reply, error);
  if (code > 0) {
    Serial.printf("Retry seq %lu -> HTTP %d %s\n", (unsigned long)lastAckedSeq_, code, replySummary(reply).c_str());
  } else {
    Serial.printf("Retry seq %lu -> no reply (%s)\n", (unsigned long)lastAckedSeq_, error.c_str());
  }
}
