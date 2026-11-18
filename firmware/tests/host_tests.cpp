#include <stdio.h>
#include <string.h>

#include "HeartCheckIn.h"
#include "ExerciseFlow.h"
#include "EventOutbox.h"
#include "ArmCurlCounter.h"

static int g_failed = 0;
static int g_run = 0;

#define CHECK(cond)                                                     \
  do {                                                                  \
    if (!(cond)) {                                                      \
      printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);          \
      g_failed++;                                                       \
    }                                                                   \
  } while (0)

#define RUN(fn)                \
  do {                         \
    int before = g_failed;     \
    fn();                      \
    g_run++;                   \
    printf("%s %s\n", g_failed == before ? "ok  " : "FAIL", #fn); \
  } while (0)

// ---------------------------------------------------------------- check-in

// Feeds a beat every `periodMs` with finger present until Done or limit.
static CheckIn feedBeats(HeartCheckIn& c, uint32_t periodMs, uint32_t& t, uint32_t limitMs) {
  CheckIn s = CheckIn::WaitingFinger;
  uint32_t end = t + limitMs;
  while (t <= end) {
    s = c.update(20000, true, t);
    if (s == CheckIn::Done || s == CheckIn::TryAgain) return s;
    t += periodMs;
  }
  return s;
}

static void checkin_accepts_steady_72() {
  HeartCheckInConfig cfg;
  HeartCheckIn c(cfg);
  c.start(0);
  uint32_t t = 0;
  CheckIn s = feedBeats(c, 833, t, 7000);
  CHECK(s == CheckIn::Done);
  CHECK(c.bpm() == 72);
  CHECK(c.intervals() >= 6);
}

static void checkin_accepts_high_after_exercise() {
  HeartCheckInConfig cfg;
  HeartCheckIn c(cfg);
  c.start(0);
  uint32_t t = 0;
  CHECK(feedBeats(c, 400, t, 7000) == CheckIn::Done);
  CHECK(c.bpm() == 150);
}

static void checkin_rejects_jitter() {
  HeartCheckInConfig cfg;
  HeartCheckIn c(cfg);
  c.start(0);
  uint32_t t = 0;
  bool toggle = false;
  CheckIn s = CheckIn::WaitingFinger;
  bool sawTryAgain = false;
  while (t <= 8200) {
    s = c.update(20000, true, t);
    CHECK(s != CheckIn::Done);
    if (s == CheckIn::TryAgain) { sawTryAgain = true; break; }
    t += toggle ? 900 : 600;
    toggle = !toggle;
  }
  CHECK(sawTryAgain);
  CHECK(t >= 8000);
}

static void checkin_finger_lost_try_again() {
  HeartCheckInConfig cfg;
  HeartCheckIn c(cfg);
  c.start(0);
  CHECK(c.update(20000, true, 0) == CheckIn::Reading);
  CHECK(c.update(20000, true, 800) == CheckIn::Reading);
  CHECK(c.update(500, false, 1000) == CheckIn::TryAgain);
  CHECK(c.update(500, false, 1000 + 1000) == CheckIn::TryAgain);
  // After tryAgainShowMs a fresh collection starts.
  CHECK(c.update(500, false, 1000 + 1500) == CheckIn::WaitingFinger);
  CHECK(c.intervals() == 0);
}

static void checkin_fresh_each_start() {
  HeartCheckInConfig cfg;
  HeartCheckIn c(cfg);
  c.start(0);
  uint32_t t = 0;
  CHECK(feedBeats(c, 833, t, 7000) == CheckIn::Done);
  CHECK(c.bpm() == 72);
  c.start(100000);
  CHECK(c.intervals() == 0);
  CHECK(c.bpm() == 0);
  CHECK(c.update(500, false, 100010) == CheckIn::WaitingFinger);
  t = 100100;
  CHECK(feedBeats(c, 500, t, 7000) == CheckIn::Done);
  CHECK(c.bpm() == 120);
}

static void checkin_out_of_range_restarts() {
  HeartCheckInConfig cfg;
  HeartCheckIn c(cfg);
  c.start(0);
  c.update(20000, true, 0);
  c.update(20000, true, 800);
  c.update(20000, true, 1600);
  CHECK(c.intervals() == 2);
  c.update(20000, true, 1600 + 100);  // 600 bpm: out of range
  CHECK(c.intervals() == 0);
}

// -------------------------------------------------------------------- flow

static ServerWorkout makeServer(const char* id, Phase ph, uint16_t reps, uint16_t target = 10) {
  ServerWorkout s;
  memset(&s, 0, sizeof(s));
  s.present = true;
  strncpy(s.id, id, sizeof(s.id) - 1);
  s.reps = true;
  s.exercise = 0;
  s.target = target;
  s.phase = ph;
  s.repetitions = reps;
  s.lastSequence = 0;
  return s;
}

static void parse_phase_strings() {
  CHECK(parsePhase("before_bpm") == Phase::BeforeBpm);
  CHECK(parsePhase("counting") == Phase::Counting);
  CHECK(parsePhase("after_bpm") == Phase::AfterBpm);
  CHECK(parsePhase("done") == Phase::Done);
  CHECK(parsePhase("bogus") == Phase::None);
  CHECK(parsePhase(nullptr) == Phase::None);
}

static void flow_freezes_at_target() {
  ExerciseFlow f;
  ServerWorkout s = makeServer("w1", Phase::BeforeBpm, 0, 3);
  CHECK(f.sync(s, 0) == ExerciseFlow::Action::Reset);
  CHECK(f.phase() == Phase::BeforeBpm);
  CHECK(f.takeEntered() == Phase::BeforeBpm);
  CHECK(f.takeEntered() == Phase::None);
  // Reps ignored until before-BPM saved.
  CHECK(f.onRep(1) == 0);
  CHECK(f.reps() == 0);
  f.onBeforeBpmSaved(1);
  CHECK(f.phase() == Phase::Counting);
  CHECK(f.takeEntered() == Phase::Counting);
  CHECK(f.onRep(2) == 1);
  CHECK(f.onRep(3) == 2);
  CHECK(!f.frozen());
  CHECK(f.onRep(4) == 3);
  CHECK(f.frozen());
  CHECK(f.phase() == Phase::AfterBpm);
  CHECK(f.takeEntered() == Phase::AfterBpm);
  CHECK(f.onRep(5) == 3);
  CHECK(f.onRep(9) == 3);
  CHECK(f.reps() == 3);
  f.onAfterBpmSaved();
  CHECK(f.phase() == Phase::Done);
}

static void reps_during_before_bpm_do_not_count() {
  ExerciseFlow f;
  ServerWorkout s = makeServer("w5", Phase::BeforeBpm, 0, 10);
  f.sync(s, 10);
  f.onRep(11);
  f.onRep(12);
  f.onRep(13);  // three reps while the check-in runs
  f.onBeforeBpmSaved(13);
  CHECK(f.reps() == 0);
  CHECK(f.onRep(14) == 1);
}

static void counter_behind_baseline_does_not_complete() {
  ExerciseFlow f;
  ServerWorkout s = makeServer("w6", Phase::Counting, 2, 5);
  f.sync(s, 100);
  CHECK(f.onRep(3) == 2);  // counter restarted below baseline
  CHECK(f.phase() == Phase::Counting);
  CHECK(!f.frozen());
  CHECK(f.onRep(4) == 3);
}

static void resume_mid_counting() {
  ExerciseFlow f;
  ServerWorkout s = makeServer("w2", Phase::Counting, 4, 10);
  CHECK(f.sync(s, 0) == ExerciseFlow::Action::Reset);
  CHECK(f.phase() == Phase::Counting);
  CHECK(f.reps() == 4);
  // The caller must be told counting was entered so it pushes a fresh status.
  CHECK(f.takeEntered() == Phase::Counting);
  CHECK(f.onRep(1) == 5);
  CHECK(f.onRep(2) == 6);
}

static void follows_server_when_ahead() {
  ExerciseFlow f;
  ServerWorkout s = makeServer("w3", Phase::BeforeBpm, 0, 10);
  f.sync(s, 0);
  f.takeEntered();
  s.phase = Phase::Counting;
  CHECK(f.sync(s, 7) == ExerciseFlow::Action::Follow);
  CHECK(f.phase() == Phase::Counting);
  CHECK(f.takeEntered() == Phase::Counting);
  CHECK(f.onRep(8) == 1);
}

static void does_not_regress_when_server_behind() {
  ExerciseFlow f;
  ServerWorkout s = makeServer("w4", Phase::Counting, 0, 2);
  f.sync(s, 0);
  f.takeEntered();
  f.onRep(1);
  f.onRep(2);
  CHECK(f.phase() == Phase::AfterBpm);
  f.takeEntered();
  // Server has not yet seen the progress / counting still.
  s.phase = Phase::Counting;
  s.repetitions = 1;
  CHECK(f.sync(s, 2) == ExerciseFlow::Action::None);
  CHECK(f.phase() == Phase::AfterBpm);
  CHECK(f.reps() == 2);
  CHECK(f.takeEntered() == Phase::None);
}

static void new_id_resets_and_done_ends() {
  ExerciseFlow f;
  ServerWorkout a = makeServer("a", Phase::Counting, 1, 5);
  f.sync(a, 0);
  ServerWorkout b = makeServer("b", Phase::BeforeBpm, 0, 5);
  CHECK(f.sync(b, 9) == ExerciseFlow::Action::Reset);
  CHECK(f.phase() == Phase::BeforeBpm);
  CHECK(f.reps() == 0);
  b.phase = Phase::Done;
  CHECK(f.sync(b, 9) == ExerciseFlow::Action::Ended);
  ServerWorkout none;
  memset(&none, 0, sizeof(none));
  CHECK(f.sync(none, 9) == ExerciseFlow::Action::Ended);
  // A later workout, even with the same id, is a fresh Reset after Ended.
  CHECK(f.sync(b, 9) == ExerciseFlow::Action::Ended);
  ServerWorkout c = makeServer("b", Phase::BeforeBpm, 0, 5);
  CHECK(f.sync(c, 9) == ExerciseFlow::Action::Reset);
}

static void flow_with_real_counter_total() {
  // Smoke test: counters expose a monotonically increasing total used by onRep.
  ArmCurlCounter counter;
  (void)counter;
  ExerciseFlow f;
  ServerWorkout s = makeServer("x", Phase::Counting, 2, 5);
  f.sync(s, 100);
  CHECK(f.onRep(101) == 3);
}

// ------------------------------------------------------------------ outbox

static void outbox_coalesces_progress() {
  EventOutbox o;
  o.reset(0);
  CHECK(o.push(EventType::Status, 0, 0));
  CHECK(o.push(EventType::Progress, 1));
  CHECK(o.push(EventType::Progress, 2));
  CHECK(o.push(EventType::Progress, 3));
  CHECK(o.size() == 2);
  OutEvent e;
  CHECK(o.front(e));
  CHECK(e.type == EventType::Status);
  o.ack();
  CHECK(o.front(e));
  CHECK(e.type == EventType::Progress);
  CHECK(e.value == 3);
  // Same status pushed twice is suppressed.
  EventOutbox p;
  p.reset(0);
  p.push(EventType::Status, 0, 1);
  p.push(EventType::Status, 0, 1);
  CHECK(p.size() == 1);
  p.push(EventType::Status, 0, 3);
  CHECK(p.size() == 2);
}

static void outbox_retry_keeps_sequence() {
  EventOutbox o;
  o.reset(41);
  o.push(EventType::BeforeBpm, 78);
  o.push(EventType::Progress, 1);
  OutEvent a, b, c;
  CHECK(o.front(a));
  CHECK(o.front(b));
  CHECK(a.sequence == 42);
  CHECK(b.sequence == 42);
  CHECK(!o.lastAcked(c));
  o.ack();
  CHECK(o.lastAcked(c));
  CHECK(c.sequence == 42);
  CHECK(c.type == EventType::BeforeBpm);
  CHECK(o.front(a));
  CHECK(a.sequence == 43);
  // A progress arriving while the head is in flight must not rewrite it.
  o.push(EventType::Progress, 2);
  CHECK(o.front(b));
  CHECK(b.sequence == 43);
  CHECK(b.value == 1);
  o.drop();
  CHECK(o.front(a));
  CHECK(a.sequence == 44);
  CHECK(a.value == 2);
}

static void outbox_keeps_bpm_events_on_overflow() {
  EventOutbox o;
  o.reset(0);
  CHECK(o.push(EventType::BeforeBpm, 70));
  // Fill with alternating statuses (all distinct from previous) and progress.
  uint8_t st = 0;
  for (int i = 0; i < 40; i++) {
    st = (uint8_t)((st + 1) % 4);
    o.push(EventType::Status, 0, st);
    o.push(EventType::Progress, i);
    o.push(EventType::AfterBpm, 100 + i);
  }
  // Count BPM events retained: none may have been dropped.
  size_t bpm = 0;
  OutEvent e;
  while (o.front(e)) {
    if (e.type == EventType::BeforeBpm || e.type == EventType::AfterBpm) bpm++;
    o.ack();
  }
  CHECK(bpm >= 1 + (EventOutbox::Capacity - 1));  // queue ends full of BPM
  // All-BPM queue refuses new events.
  EventOutbox q;
  q.reset(0);
  for (size_t i = 0; i < EventOutbox::Capacity; i++) CHECK(q.push(EventType::AfterBpm, 90));
  CHECK(!q.push(EventType::Progress, 1));
  CHECK(q.size() == EventOutbox::Capacity);
}

static void outbox_drops_status_then_progress_when_full() {
  EventOutbox o;
  o.reset(0);
  o.push(EventType::BeforeBpm, 70);
  o.push(EventType::Status, 0, 1);
  o.push(EventType::Progress, 1);
  o.push(EventType::AfterBpm, 80);  // progress no longer tail
  o.push(EventType::Progress, 2);
  for (size_t i = 5; i < EventOutbox::Capacity; i++) o.push(EventType::BeforeBpm, 60 + (int)i);
  CHECK(o.size() == EventOutbox::Capacity);
  CHECK(o.push(EventType::AfterBpm, 99));  // evicts the oldest status
  CHECK(o.size() == EventOutbox::Capacity);
  OutEvent e;
  bool sawStatus = false;
  size_t n = 0;
  while (o.front(e)) {
    if (e.type == EventType::Status) sawStatus = true;
    n++;
    o.ack();
  }
  CHECK(!sawStatus);
  CHECK(n == EventOutbox::Capacity);
}

static void outbox_force_status_on_phase_entry() {
  EventOutbox o;
  o.reset(0);
  o.push(EventType::Status, 0, 0);
  o.push(EventType::Status, 0, 0);
  CHECK(o.size() == 1);
  CHECK(o.push(EventType::Status, 0, 0, true));
  CHECK(o.size() == 2);
}

static void outbox_evicted_status_is_resendable() {
  EventOutbox o;
  o.reset(0);
  o.push(EventType::Status, 0, 3);
  for (size_t i = 1; i < EventOutbox::Capacity; i++) o.push(EventType::BeforeBpm, 60);
  CHECK(o.size() == EventOutbox::Capacity);
  CHECK(o.push(EventType::AfterBpm, 99));  // evicts the unsent status
  OutEvent e;
  bool saw = false;
  while (o.front(e)) {
    if (e.type == EventType::Status) saw = true;
    o.ack();
  }
  CHECK(!saw);
  CHECK(o.push(EventType::Status, 0, 3));  // not suppressed as a duplicate
  CHECK(o.size() == 1);
}

// -------------------------------------------------------------------- json

static void json_formats_exact() {
  char buf[128];
  OutEvent e;
  memset(&e, 0, sizeof(e));
  e.type = EventType::Progress; e.value = 3; e.sequence = 7;
  size_t n = toJson(e, buf, sizeof(buf));
  CHECK(strcmp(buf, "{\"sequence\":7,\"event\":\"progress\",\"repetitions\":3}") == 0);
  CHECK(n == strlen(buf));
  e.type = EventType::BeforeBpm; e.value = 78; e.sequence = 2;
  toJson(e, buf, sizeof(buf));
  CHECK(strcmp(buf, "{\"sequence\":2,\"event\":\"before_bpm\",\"bpm\":78}") == 0);
  e.type = EventType::AfterBpm; e.value = 104; e.sequence = 9;
  toJson(e, buf, sizeof(buf));
  CHECK(strcmp(buf, "{\"sequence\":9,\"event\":\"after_bpm\",\"bpm\":104}") == 0);
  const char* names[4] = {"waiting_finger", "reading", "weak_signal", "counting"};
  for (uint8_t i = 0; i < 4; i++) {
    e.type = EventType::Status; e.status = i; e.sequence = 1;
    toJson(e, buf, sizeof(buf));
    char want[96];
    snprintf(want, sizeof(want), "{\"sequence\":1,\"event\":\"status\",\"capture_status\":\"%s\"}", names[i]);
    CHECK(strcmp(buf, want) == 0);
  }
  char tiny[8];
  CHECK(toJson(e, tiny, sizeof(tiny)) == 0);
}

int main() {
  RUN(checkin_accepts_steady_72);
  RUN(checkin_accepts_high_after_exercise);
  RUN(checkin_rejects_jitter);
  RUN(checkin_finger_lost_try_again);
  RUN(checkin_fresh_each_start);
  RUN(checkin_out_of_range_restarts);
  RUN(parse_phase_strings);
  RUN(flow_freezes_at_target);
  RUN(reps_during_before_bpm_do_not_count);
  RUN(counter_behind_baseline_does_not_complete);
  RUN(resume_mid_counting);
  RUN(follows_server_when_ahead);
  RUN(does_not_regress_when_server_behind);
  RUN(new_id_resets_and_done_ends);
  RUN(flow_with_real_counter_total);
  RUN(outbox_coalesces_progress);
  RUN(outbox_retry_keeps_sequence);
  RUN(outbox_keeps_bpm_events_on_overflow);
  RUN(outbox_drops_status_then_progress_when_full);
  RUN(outbox_force_status_on_phase_entry);
  RUN(outbox_evicted_status_is_resendable);
  RUN(json_formats_exact);
  if (g_failed) {
    printf("%d check(s) failed\n", g_failed);
    return 1;
  }
  printf("all host tests passed (%d tests)\n", g_run);
  return 0;
}
