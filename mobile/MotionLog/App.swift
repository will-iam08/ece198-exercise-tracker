import SwiftUI
import CoreBluetooth

@main struct MotionLogApp: App {
    var body: some Scene { WindowGroup { Dashboard() } }
}

private let forest = Color(red: 0.07, green: 0.19, blue: 0.16)
private let lime = Color(red: 0.79, green: 0.96, blue: 0.57)

private extension Movement {
    var title: String {
        switch self {
        case .backRow: return "Back row"
        case .curl: return "Biceps curl"
        case .lateralRaise: return "Lateral raise"
        case .shoulderPress: return "Shoulder press"
        case .detecting: return "Detecting movement…"
        case .unrecognized: return "Movement unrecognized"
        case .unavailable: return "Movement unavailable"
        case .unmapped(let code): return "Unknown exercise (\(code))"
        }
    }
}

// Scripted telemetry for the Demo tab. All live values come from the peripheral.
private func demoReading(seconds: Int, phase: Reading.Phase) -> Reading {
    var value = Reading()
    value.phase = phase
    value.seconds = seconds
    value.reps = seconds / 3
    let movements: [Movement] = [.curl, .shoulderPress, .backRow]
    let offset = seconds % 12
    if offset < 2 {
        value.movement = .detecting
    } else if offset == 11 {
        value.movement = .unrecognized
    } else {
        value.movement = movements[(seconds / 12) % movements.count]
    }
    value.bpm = seconds < 2 ? nil : 80 + min(seconds / 2, 18)
    return value
}

struct Dashboard: View {
    @StateObject private var tracker = Tracker()
    @State private var demo = true
    @State private var exerciseCode: UInt8 = 1
    @State private var target = 10
    @State private var started: Date?
    @State private var finalDemo: Reading?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Picker("Data source", selection: Binding(get: { demo }, set: selectSource)) {
                        Text("Demo").tag(true)
                        Text("My tracker").tag(false)
                    }.pickerStyle(.segmented)

                    if demo, let started {
                        TimelineView(.periodic(from: .now, by: 1)) { tick in
                            WorkoutPanel(reading: demoReading(seconds: elapsed(since: started, at: tick.date), phase: .active))
                        }
                    } else {
                        WorkoutPanel(reading: demo ? finalDemo ?? Reading() : tracker.reading)
                    }
                    if demo {
                        Text("Demo cycles through a biceps curl, shoulder press and back row using simulated readings.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        action(started == nil ? (finalDemo == nil ? "Start demo session" : "New demo session") : "Finish demo session",
                               icon: started == nil ? "play.fill" : "stop.fill") {
                            if let start = started {
                                finalDemo = demoReading(seconds: elapsed(since: start, at: .now), phase: .finished)
                                started = nil
                            } else {
                                finalDemo = nil
                                started = .now
                            }
                        }
                    } else {
                        connection
                    }
                }.padding(.horizontal, 20).padding(.vertical, 12)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Motion Log")
        }
    }

    private func elapsed(since start: Date, at end: Date) -> Int {
        max(0, Int(end.timeIntervalSince(start)))
    }

    private func selectSource(_ usingDemo: Bool) {
        guard usingDemo != demo else { return }
        demo = usingDemo
        started = nil
        finalDemo = nil
        if usingDemo { tracker.disconnect() }
    }

    private var connection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(tracker.status, systemImage: tracker.connected ? "checkmark.circle.fill" : "antenna.radiowaves.left.and.right")
                .font(.headline)
            ForEach(tracker.devices, id: \.identifier) { device in
                Button { tracker.connect(device) } label: {
                    HStack {
                        Text(device.name ?? "Tracker")
                        Spacer()
                        Text(String(device.identifier.uuidString.suffix(4))).monospaced()
                        Image(systemName: "chevron.right")
                    }.padding(.vertical, 8)
                }
            }
            if tracker.connected, let stage = tracker.reading?.stage, tracker.hasControls {
                VStack(alignment: .leading, spacing: 12) {
                    if stage.canStart {
                        Picker("Exercise", selection: $exerciseCode) {
                            Text("Biceps curl").tag(UInt8(1))
                            Text("Shoulder press").tag(UInt8(3))
                            Text("Back row").tag(UInt8(4))
                        }.pickerStyle(.menu)
                        Stepper("Target: \(target) reps", value: $target, in: 1...99)
                        action("Start workout", icon: "play.fill") {
                            tracker.send(1, movement: exerciseCode, target: UInt8(target))
                        }
                    } else if stage.active {
                        if stage == .before || stage == .after {
                            Text(((tracker.reading?.flags ?? 0) & 2) != 0 ? "Pulse sensor offline. You can skip this reading." :
                                "Place a fingertip on the heart sensor and hold still.")
                            Button("Skip heart-rate check") { tracker.send(3) }
                        }
                        action("End workout", icon: "stop.fill") { tracker.send(2) }
                    } else {
                        Text(stage == .fault ? "Check the OLED or USB serial message, fix the wiring, then reset the tracker." :
                            "Keep the sensor still while the tracker calibrates.")
                    }
                }.disabled(tracker.sending)
            } else if tracker.connected && tracker.reading != nil {
                Text("Install the MotionTrack firmware to control workouts from this phone.")
            }
            if tracker.busy || tracker.connected {
                action(tracker.connected ? "Disconnect" : "Cancel", icon: "xmark") { tracker.disconnect() }
            } else {
                action("Scan for tracker", icon: "magnifyingglass") { tracker.scan() }
            }
        }.padding(.top, 4)
    }

    private func action(_ label: String, icon: String, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Label(label, systemImage: icon).font(.headline).frame(maxWidth: .infinity)
                .padding(.vertical, 16).foregroundStyle(forest)
                .background(lime, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

private struct WorkoutPanel: View {
    let reading: Reading?
    @Environment(\.dynamicTypeSize) private var textSize
    @ScaledMetric(relativeTo: .largeTitle) private var countSize = 66.0
    private var sessionLabel: String {
        if let stage = reading?.stage {
            switch stage {
            case .starting: return "Calibrating"
            case .idle: return "Ready to start"
            case .before: return "Before-workout pulse"
            case .counting: return "Counting · target \(reading?.target ?? 0)"
            case .after: return "After-workout pulse"
            case .complete: return "Target complete"
            case .stopped: return "Workout ended"
            case .fault: return "Hardware setup required"
            }
        }
        switch reading?.phase {
        case .active: return "Session in progress"
        case .finished: return "Session complete"
        case .ready: return "Ready to start"
        case nil: return "Awaiting tracker data"
        }
    }
    private var movement: String {
        guard let reading else { return "Waiting for device" }
        if reading.stage == .fault { return "Check tracker wiring" }
        if reading.stage == .starting { return "Keep the sensor still" }
        return reading.phase == .ready ? "Ready for movement" : reading.movement.title
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                Label(sessionLabel, systemImage: reading?.phase == .active ? "waveform" : "circle.dotted")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(lime)
                Text(movement).font(.system(.largeTitle, design: .rounded).weight(.bold))
                Rectangle().fill(Color.white.opacity(0.22)).frame(height: 1).padding(.vertical, 3)
                Text(reading.map { String($0.reps) } ?? "—")
                    .font(.system(size: countSize, weight: .semibold, design: .rounded)).monospacedDigit()
                Text("Session repetitions").font(.headline).foregroundStyle(.white.opacity(0.85))
            }
            .padding(22).frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(.white).background(forest, in: RoundedRectangle(cornerRadius: 24))

            if let r = reading, r.stage == .counting {
                if r.flags & 1 != 0 { Text("Motion sensor disconnected").foregroundStyle(.orange) }
                else if r.flags & 4 != 0 { Text("Complete the full movement to count a rep.") }
            }
            let layout = textSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
            layout {
                metric("Duration", icon: "timer", value: reading.map { String(format: "%02d:%02d", $0.seconds / 60, $0.seconds % 60) } ?? "—")
                if reading?.stage != nil {
                    metric("Before", icon: "heart", value: reading?.beforeBPM.map { "\($0) bpm" } ?? "—")
                } else {
                    metric("Heart rate", icon: "heart", value: reading?.bpm.map { "\($0) bpm" } ?? "—")
                }
            }
            if reading?.stage != nil {
                metric("After workout", icon: "heart", value: reading?.afterBPM.map { "\($0) bpm" } ?? "—")
            }
        }
    }

    private func metric(_ title: String, icon: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon).font(.subheadline).foregroundStyle(.secondary)
            Text(value).font(.system(.title2, design: .rounded).bold()).monospacedDigit()
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .combine)
    }
}
