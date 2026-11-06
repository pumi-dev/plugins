// awake's menu bar icon: a status item while this Mac is being held up.
//
// It decides nothing. The plugin writes one JSON line to stdin to show it
// (`{"why": "Keeping mac awake"}`) and `hide` to take it away, or `quit` to end it; a click on the
// menu writes one word to stdout (`settings`) for the plugin to act on. When the plugin goes, its
// end of the pipe closes and this goes with it.
//
// Built by src/bar.ts with `swiftc` into the plugin's cache, once per change of this file.
import AppKit

@main
struct AwakeBar {
  static func main() {
    let app = NSApplication.shared
    // No Dock tile and no menu of its own: a status item in the menu bar, and nothing else.
    app.setActivationPolicy(.accessory)
    let bar = Bar()
    bar.start()
    app.run()
  }
}

final class Bar: NSObject {
  private var item: NSStatusItem?
  private var why = "Keeping mac awake"
  private var buffer = Data()

  /// Reads the plugin's lines: the standard input is the plugin's to write, and its end is the end
  /// of this process.
  func start() {
    FileHandle.standardInput.readabilityHandler = { handle in
      let chunk = handle.availableData
      if chunk.isEmpty { exit(0) }
      DispatchQueue.main.async { self.receive(chunk) }
    }
  }

  private func receive(_ chunk: Data) {
    buffer.append(chunk)
    while let newline = buffer.firstIndex(of: 0x0A) {
      let line = String(decoding: buffer[buffer.startIndex..<newline], as: UTF8.self)
      buffer.removeSubrange(buffer.startIndex...newline)
      apply(line.trimmingCharacters(in: .whitespaces))
    }
  }

  private func apply(_ line: String) {
    if line.isEmpty { return }
    if line == "hide" { return hide() }
    if line == "quit" { exit(0) }
    guard let data = line.data(using: .utf8),
          let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }
    why = state["why"] as? String ?? why
    draw()
  }

  private func draw() {
    let item = self.item ?? make()
    self.item = item
    item.button?.toolTip = why
    let menu = NSMenu()
    menu.autoenablesItems = false
    let header = NSMenuItem(title: why, action: nil, keyEquivalent: "")
    header.isEnabled = false
    menu.addItem(header)
    menu.addItem(.separator())
    add(menu, "Awake settings…", #selector(openSettings))
    item.menu = menu
  }

  private func make() -> NSStatusItem {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    if let button = item.button {
      let image = NSImage(systemSymbolName: "cup.and.saucer.fill", accessibilityDescription: "awake")
      image?.isTemplate = true
      button.image = image
      button.imagePosition = .imageOnly
    }
    return item
  }

  private func add(_ menu: NSMenu, _ title: String, _ action: Selector) {
    let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
    entry.target = self
    menu.addItem(entry)
  }

  @objc private func openSettings() { say("settings") }

  /// A click, as one word for the plugin's standard input to read: `release`, `settings`.
  private func say(_ command: String) {
    FileHandle.standardOutput.write(Data((command + "\n").utf8))
  }

  private func hide() {
    guard let item else { return }
    NSStatusBar.system.removeStatusItem(item)
    self.item = nil
  }
}
