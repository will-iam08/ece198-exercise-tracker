import Foundation
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let expected: [Movement] = [.curl,.shoulderPress,.backRow]
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
