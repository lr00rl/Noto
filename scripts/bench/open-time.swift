// Measures how long an editor works before a document is ready.
//
// The same method is applied to every app under test, which is the point: it
// reads no app internals, so neither gets a measurement advantage.
//
// What it measures is time to idle. From launching the app with a file, it
// samples the process's consumed CPU time and stops once the app has gone
// quiet, meaning it has finished parsing, laying out and painting. Screen
// capture would measure first paint more directly, but on current macOS it
// needs a permission prompt that cannot be granted unattended, and window
// geometry alone would time the window server rather than the editor.
//
// Time to idle slightly overstates both apps, since neither is strictly done
// when the first glyph appears. It overstates them the same way.
//
// usage: open-time <bundle-id-or-app-path> <file> <timeout-seconds>
// prints: milliseconds to idle, or "timeout"

import AppKit
import Darwin
import Foundation

let arguments = CommandLine.arguments
guard arguments.count >= 4, let timeout = Double(arguments[3]) else {
    FileHandle.standardError.write("usage: open-time <bundle-id> <file> <timeout-seconds>\n".data(using: .utf8)!)
    exit(2)
}
let bundleId = arguments[1]
let file = URL(fileURLWithPath: arguments[2])

/// CPU time one process has consumed, in seconds.
func cpuSeconds(pid: pid_t) -> Double? {
    var usage = rusage_info_v4()
    let result = withUnsafeMutablePointer(to: &usage) { pointer -> Int32 in
        pointer.withMemoryRebound(to: (rusage_info_t?).self, capacity: 1) { rebound in
            proc_pid_rusage(pid, RUSAGE_INFO_V4, rebound)
        }
    }
    guard result == 0 else { return nil }
    return Double(usage.ri_user_time + usage.ri_system_time) / 1_000_000_000
}

/// Every process currently running.
func allPids() -> Set<pid_t> {
    let count = proc_listallpids(nil, 0)
    guard count > 0 else { return [] }
    var buffer = [pid_t](repeating: 0, count: Int(count) * 2)
    let written = proc_listallpids(&buffer, Int32(buffer.count) * Int32(MemoryLayout<pid_t>.size))
    guard written > 0 else { return [] }
    return Set(buffer.prefix(Int(written)))
}

/// CPU consumed right now by every process on the machine.
///
/// Deliberately everything, not just the app and its children. Neither editor
/// does its work in the process that gets launched: Electron splits across
/// helpers, and WebKit runs the page in an XPC service that macOS parents to
/// launchd. Worse, that service is often prewarmed, so it existed before the
/// launch and counting only new processes misses all of its work. That is what
/// made an earlier version of this report Typora using the same CPU for an
/// eight megabyte file as for a sixty five kilobyte one.
///
/// Summing the whole machine and taking the increase captures work wherever it
/// happens. It also captures unrelated background activity, which is why the
/// caller measures an idle baseline and subtracts it.
func systemCpuSeconds() -> Double {
    var total = 0.0
    for pid in allPids() {
        total += cpuSeconds(pid: pid) ?? 0
    }
    return total
}

// Accept either a bundle identifier or a path, so an app that has been built
// but never installed can be measured alongside one that is.
let appUrl: URL
if bundleId.hasPrefix("/") {
    appUrl = URL(fileURLWithPath: bundleId)
} else if let resolved = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) {
    appUrl = resolved
} else {
    FileHandle.standardError.write("no app for \(bundleId)\n".data(using: .utf8)!)
    exit(3)
}

let configuration = NSWorkspace.OpenConfiguration()
configuration.activates = true
// A fresh instance every time, so this is a cold open rather than a warm app
// being handed another document.
configuration.createsNewApplicationInstance = true

// Everything the machine had consumed before the launch, so what is reported
// afterwards is the increase rather than the machine's whole history.
let baselineCpu = systemCpuSeconds()

let started = DispatchTime.now()
var launched: NSRunningApplication?
let semaphore = DispatchSemaphore(value: 0)
NSWorkspace.shared.open([file], withApplicationAt: appUrl, configuration: configuration) { app, _ in
    launched = app
    semaphore.signal()
}
_ = semaphore.wait(timeout: .now() + timeout)

guard let app = launched else {
    print("timeout")
    exit(1)
}
let pid = app.processIdentifier

func elapsedMs() -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000
}

let sampleInterval: UInt32 = 50_000            // 50 ms

// Sample the whole window rather than stopping at a threshold.
//
// Deciding "the app is idle now" needs a cutoff, and any cutoff that suits one
// app's CPU profile flatters or punishes the other. Emitting the curve moves
// that judgement out of the measurement and into the analysis, where the same
// rule is applied to both apps and can be inspected.
//
// Each line is: elapsed milliseconds, cumulative CPU seconds.
var samples: [(Double, Double)] = []
while elapsedMs() < timeout * 1000 {
    usleep(sampleInterval)
    samples.append((elapsedMs(), systemCpuSeconds() - baselineCpu))
}

app.forceTerminate()
for (at, cpu) in samples {
    print(String(format: "%.0f,%.4f", at, cpu))
}
