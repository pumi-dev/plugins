// tab-rename's namer: Apple's on-device model (FoundationModels, macOS 26+) turned into a tab
// name. It runs for as long as the package does and speaks JSON lines: one request a line on
// stdin, one answer a line on stdout, in order.
//
//   → {"id": 1, "titles": ["Fixing double-press c key binding bug"], "maxWords": 3}
//   ← {"id": 1, "name": "Key Binding Fix"}
//   ← {"id": 1, "error": "…"}
//
// The first line it writes says whether the model can be used at all:
//   {"ready": true}  or  {"ready": false, "reason": "appleIntelligenceNotEnabled"}
//
// It exits when stdin closes, or after `--idle SECONDS` (default 180) with no request: a package's
// worker that is stopped does not take the processes it started with it, so a namer left behind
// by a reload goes away on its own, and the package starts a new one when it next needs it.
import Foundation
import FoundationModels

struct Request: Decodable {
  let id: Int
  let titles: [String]
  let maxWords: Int?
}

@Generable
struct TabName {
  @Guide(description: "The tab's name: one to a few words separated by spaces, in Title Case, no quotes, no punctuation, no emoji")
  var name: String
}

let instructions = """
  You name terminal tabs. A tab holds coding agents; each agent's title says what it is \
  working on. Answer a short, specific name for the tab, made of the title's own key words: \
  the most specific thing being worked on (keep its nouns), not the tool or the project. Never use the words agent, tab, \
  terminal, session, project, pi or claude.
  """

let out = FileHandle.standardOutput

func say(_ object: [String: Any]) {
  guard var data = try? JSONSerialization.data(withJSONObject: object) else { return }
  data.append(0x0A)
  out.write(data)
}

func reason(_ availability: SystemLanguageModel.Availability) -> String? {
  switch availability {
  case .available: return nil
  case .unavailable(let why): return String(describing: why)
  @unknown default: return "unknown"
  }
}

func prompt(_ r: Request) -> String {
  let words = max(1, min(r.maxWords ?? 3, 6))
  var lines = ["Name this tab in at most \(words) words.", "What its agents are working on:"]
  for (i, title) in r.titles.enumerated() {
    lines.append(i == 0 ? "- \(title) (the one in front)" : "- \(title)")
  }
  return lines.joined(separator: "\n")
}

/** When the last request came, for the idle exit. */
actor Clock {
  private var last = Date()
  func touch() { last = Date() }
  func idle() -> TimeInterval { Date().timeIntervalSince(last) }
}

func idleLimit() -> TimeInterval {
  let args = CommandLine.arguments
  if let i = args.firstIndex(of: "--idle"), i + 1 < args.count, let n = TimeInterval(args[i + 1]), n > 0 { return n }
  return 180
}

@main
struct Namer {
  static func main() async {
    let clock = Clock()
    let limit = idleLimit()
    Task.detached {
      while true {
        try? await Task.sleep(for: .seconds(5))
        if await clock.idle() > limit { exit(0) }
      }
    }
    let model = SystemLanguageModel.default
    if let why = reason(model.availability) {
      say(["ready": false, "reason": why])
      return
    }
    // Loading the model takes a moment: done now, ahead of the first title.
    LanguageModelSession(model: model, instructions: instructions).prewarm()
    say(["ready": true])

    let decoder = JSONDecoder()
    do {
      for try await line in FileHandle.standardInput.bytes.lines {
        guard let data = line.data(using: .utf8), let request = try? decoder.decode(Request.self, from: data) else {
          continue
        }
        await clock.touch()
        // A session of its own for each tab, so one tab's names never lean on another's.
        let session = LanguageModelSession(model: model, instructions: instructions)
        do {
          let answer = try await session.respond(
            to: prompt(request),
            generating: TabName.self,
            options: GenerationOptions(temperature: 0.2)
          )
          say(["id": request.id, "name": answer.content.name])
        } catch {
          say(["id": request.id, "error": String(describing: error)])
        }
        await clock.touch()
      }
    } catch {
      say(["error": String(describing: error)])
    }
  }
}
