import AppKit
let root = CommandLine.arguments[1]
for (project, symbol) in [("app-update-monitor", "arrow.triangle.2.circlepath"), ("codex-reset-notifier", "timer")] {
    let base = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)!
        .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 16, weight: .regular))!
    for scale in 1...3 {
        let pixels = 18 * scale
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        rep.size = NSSize(width: 18, height: 18)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        let ratio = min(16 / base.size.width, 16 / base.size.height)
        let size = NSSize(width: base.size.width * ratio, height: base.size.height * ratio)
        base.draw(in: NSRect(x: (18-size.width)/2, y: (18-size.height)/2, width: size.width, height: size.height))
        NSColor.black.setFill()
        NSRect(x: 0, y: 0, width: 18, height: 18).fill(using: .sourceIn)
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 1 ? "" : "@\(scale)x"
        try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(root)/\(project)/assets/trayTemplate\(suffix).png"))
    }
}
