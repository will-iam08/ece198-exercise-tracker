import Foundation

let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let expected: [Movement] = [.curl, .shoulderPress, .backRow]
for (index, movement) in expected.enumerated() {
    let offset = index * 17
    let packet = data.subdata(in: offset..<offset+17)
    let value = Reading(packet: packet)!
    precondition(value.stage == .complete && value.movement == movement)
    precondition(value.target == 2 && value.reps == 2 && value.seconds == 7)
    precondition(value.beforeBPM == 76 && value.afterBPM == 98)
    precondition(Reading(packet: packet.dropLast()) == nil)
}
print("All three device workout snapshots decoded by iOS.")

// 1. Exercise mapping accepts only wire codes 1, 3, 4 (code 2 is unused and rejected).
precondition(AppExercise(wireCode: 1) == .armCurl)
precondition(AppExercise(wireCode: 3) == .shoulderPress)
precondition(AppExercise(wireCode: 4) == .backRow)
precondition(AppExercise(wireCode: 2) == nil)
precondition(AppExercise(wireCode: 0) == nil)
precondition(AppExercise(wireCode: 5) == nil)
precondition(AppExercise(movement: .lateralRaise) == nil)
precondition(AppExercise(apiID: "lateral_raise") == nil)
precondition(AppExercise(apiID: "arm_curl") == .armCurl)
precondition(AppExercise(apiID: "shoulder_press") == .shoulderPress)
precondition(AppExercise(apiID: "back_row") == .backRow)

// 2. Payload encoding keeps explicit null for nil/zero BPM and enforces 1...50 target clamp.
let skippedPayload = WorkoutSetPayload(
    clientId: "A1B2C3D4-E5F6-4789-ABCD-0123456789EF",
    exercise: .armCurl,
    targetReps: 99,
    repetitions: 60,
    elapsedSeconds: 45,
    beforeBpm: 0,
    afterBpm: nil,
    beforeSkipped: true,
    afterSkipped: false,
    startedAt: "2026-11-18T12:00:00.000Z",
    endedAt: "2026-11-18T12:00:45.000Z"
)
precondition(skippedPayload.targetReps == 50)
precondition(skippedPayload.repetitions == 50)
precondition(skippedPayload.beforeBpm == nil)
precondition(skippedPayload.afterBpm == nil)
let encoded = try JSONEncoder().encode(skippedPayload)
let decodedJSON = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
precondition(decodedJSON["client_id"] as? String == "a1b2c3d4-e5f6-4789-abcd-0123456789ef")
precondition(decodedJSON["exercise"] as? Int == 1)
precondition(decodedJSON["before_bpm"] is NSNull)
precondition(decodedJSON["after_bpm"] is NSNull)
precondition(decodedJSON["before_skipped"] as? Bool == true)
precondition(decodedJSON["after_skipped"] as? Bool == false)

// 3. Server URL normalization & Care Plan target lookup.
precondition(AppServerURL.normalize("https://motiontrack.onrender.com/")?.absoluteString == "https://motiontrack.onrender.com")
precondition(AppServerURL.normalize("ftp://example.com") == nil)
let plan = CarePlan(
    armCurlReps: 14,
    shoulderPressReps: 12,
    backRowReps: 16,
    targetBpmMin: 80,
    targetBpmMax: 130,
    notes: "Steady pace",
    doctorName: "Dr. Chen",
    updatedAt: "2026-11-18T12:00:00.000Z"
)
precondition(plan.prescribedReps(for: .armCurl) == 14)
precondition(plan.prescribedReps(for: .shoulderPress) == 12)
precondition(plan.prescribedReps(for: .backRow) == 16)

// 4. SetRecorder: cold-connect terminal state is ignored; active->complete records once; skips & stops work.
let recorder = SetRecorder()
var restingComplete = Reading()
restingComplete.stage = .complete
restingComplete.movement = .curl
restingComplete.target = 10
restingComplete.reps = 10
restingComplete.beforeBPM = 75
restingComplete.afterBPM = 102
precondition(recorder.observe(reading: restingComplete).finished == nil)

recorder.markWorkoutStarted(at: Date(timeIntervalSince1970: 1000))
var step1 = Reading()
step1.stage = .before
step1.movement = .shoulderPress
step1.target = 12
step1.seconds = 2
let live1 = recorder.observe(reading: step1, now: Date(timeIntervalSince1970: 1002)).live!
precondition(live1.phase == "before_bpm" && live1.exercise == 3)

recorder.markSkipTapped(for: .before)
var step2 = Reading()
step2.stage = .counting
step2.movement = .shoulderPress
step2.target = 12
step2.reps = 6
step2.seconds = 14
let live2 = recorder.observe(reading: step2, now: Date(timeIntervalSince1970: 1014)).live!
precondition(live2.beforeSkipped && live2.beforeBpm == nil && live2.repetitions == 6)

var stopped = Reading()
stopped.stage = .stopped
stopped.movement = .shoulderPress
stopped.target = 12
stopped.reps = 6
stopped.seconds = 16
let finishedStop = recorder.observe(reading: stopped, now: Date(timeIntervalSince1970: 1016)).finished!
precondition(finishedStop.repetitions == 6)
precondition(finishedStop.beforeSkipped == true && finishedStop.afterSkipped == false)
precondition(finishedStop.beforeBpm == nil && finishedStop.afterBpm == nil)
precondition(recorder.observe(reading: stopped, now: Date(timeIntervalSince1970: 1017)).finished == nil)

// 5. UploadQueueEngine: file persistence, deduplication, backoff retries, 401 session pause, and upload cleanup.
let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("motionlog-queue-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: tempDir) }
let queueFile = tempDir.appendingPathComponent("queue.json")

let engine = UploadQueueEngine(store: FileUploadQueueStore(fileURL: queueFile))
precondition(engine.enqueue(finishedStop, at: Date(timeIntervalSince1970: 2000)) == true)
precondition(engine.enqueue(finishedStop, at: Date(timeIntervalSince1970: 2001)) == false)
precondition(engine.pendingCount() == 1)

// Reload from disk verifies offline durability.
let reloaded = UploadQueueEngine(store: FileUploadQueueStore(fileURL: queueFile))
precondition(reloaded.pendingCount() == 1)

let semaphore = DispatchSemaphore(value: 0)
Task {
    let failSummary = await reloaded.flushReady(now: Date(timeIntervalSince1970: 2002)) { _ in
        .retryableError("Offline")
    }
    precondition(failSummary.deferred && reloaded.pendingCount() == 1)
    precondition(reloaded.items[0].attempts == 1)
    precondition(UploadQueueEngine.retryDelay(forAttempt: 1) == 5)
    precondition(UploadQueueEngine.retryDelay(forAttempt: 5) == 300)

    // Before backoff expires (2004 < 2007), item stays deferred without calling send.
    let early = await reloaded.flushReady(now: Date(timeIntervalSince1970: 2004)) { _ in
        fatalError("Should not retry before backoff expires")
    }
    precondition(early.deferred)

    // After backoff expires, 401 pauses flush without dropping queued sets.
    let unauth = await reloaded.flushReady(now: Date(timeIntervalSince1970: 2010)) { _ in
        .unauthorized
    }
    precondition(unauth.unauthorized && reloaded.pendingCount() == 1)

    // Once re-authenticated, item uploads and is cleared from disk.
    let ok = await reloaded.flushReady(now: Date(timeIntervalSince1970: 2015)) { _ in
        .uploaded
    }
    precondition(ok.uploadedCount == 1 && reloaded.pendingCount() == 0)
    semaphore.signal()
}
semaphore.wait()

let diskCheck = UploadQueueEngine(store: FileUploadQueueStore(fileURL: queueFile))
precondition(diskCheck.pendingCount() == 0)
print("All Motion Log sync, mapping, queue and recorder tests passed.")
