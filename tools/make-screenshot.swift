import AppKit
import ImageIO
import UniformTypeIdentifiers

// Composes one 1280x800 Chrome Web Store screenshot: a popup capture on a dark
// background, with a headline, a subheading and three bullets. macOS only.
//
//   swift tools/make-screenshot.swift <out.png> <popup.png> <headline> <sub> <b1> <b2> <b3>
//
// Driven by tools/screenshots.sh, which holds the copy. Run it with `npm run screenshots`.
let a = CommandLine.arguments
guard a.count >= 8 else { fputs("bad args\n", stderr); exit(1) }
let outPath = a[1], srcPath = a[2]
let headline = a[3], sub = a[4]
let bullets = [a[5], a[6], a[7]]

let W = 1280, H = 800

let cs = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8,
                          bytesPerRow: 0, space: cs,
                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fputs("no ctx\n", stderr); exit(1)
}

func rgb(_ r: Int, _ g: Int, _ b: Int, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat(r)/255, green: CGFloat(g)/255, blue: CGFloat(b)/255, alpha: alpha)
}
let bg       = rgb(20, 20, 24)
let bgTop    = rgb(32, 32, 40)
let accent   = rgb(204, 0, 0)
let textMain = rgb(255, 255, 255)
let textSub  = rgb(165, 168, 178)
let textDim  = rgb(110, 113, 122)

// Background: vertical gradient.
let grad = CGGradient(colorsSpace: cs,
                      colors: [bgTop.cgColor, bg.cgColor] as CFArray,
                      locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: H), end: CGPoint(x: 0, y: 0), options: [])

// Soft accent glow behind the popup.
let glow = CGGradient(colorsSpace: cs,
                      colors: [rgb(204, 0, 0, 0.22).cgColor, rgb(204, 0, 0, 0).cgColor] as CFArray,
                      locations: [0, 1])!
ctx.drawRadialGradient(glow, startCenter: CGPoint(x: 1000, y: 400), startRadius: 0,
                       endCenter: CGPoint(x: 1000, y: 400), endRadius: 460, options: [])

let nsctx = NSGraphicsContext(cgContext: ctx, flipped: false)
NSGraphicsContext.current = nsctx

func draw(_ s: String, x: CGFloat, top: CGFloat, width: CGFloat,
          size: CGFloat, weight: NSFont.Weight, color: NSColor, lineGap: CGFloat = 1.18) {
    let font = NSFont.systemFont(ofSize: size, weight: weight)
    let para = NSMutableParagraphStyle()
    para.lineHeightMultiple = lineGap
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font, .foregroundColor: color, .paragraphStyle: para,
        .kern: size > 40 ? -0.8 : 0,
    ]
    let str = NSAttributedString(string: s, attributes: attrs)
    let bounds = str.boundingRect(with: NSSize(width: width, height: 600),
                                  options: [.usesLineFragmentOrigin])
    let h = ceil(bounds.height)
    str.draw(with: NSRect(x: x, y: CGFloat(H) - top - h, width: width, height: h),
             options: [.usesLineFragmentOrigin])
}

let colX: CGFloat = 92
let colW: CGFloat = 660

// Accent bar.
ctx.setFillColor(accent.cgColor)
ctx.fill(CGRect(x: colX, y: CGFloat(H) - 196, width: 56, height: 6))

draw(headline, x: colX, top: 226, width: colW, size: 50, weight: .bold, color: textMain, lineGap: 1.1)
draw(sub, x: colX, top: 360, width: colW - 20, size: 23, weight: .regular, color: textSub)

var bulletTop: CGFloat = 468
for b in bullets where !b.isEmpty {
    ctx.setFillColor(accent.cgColor)
    ctx.fillEllipse(in: CGRect(x: colX + 3, y: CGFloat(H) - bulletTop - 17, width: 9, height: 9))
    draw(b, x: colX + 28, top: bulletTop, width: colW - 28, size: 21, weight: .medium, color: textMain)
    bulletTop += 52
}

draw("Runs entirely in your browser · No data collected · Not affiliated with YouTube or Google",
     x: colX, top: 716, width: colW + 40, size: 14, weight: .regular, color: textDim)

// Popup capture, right side, rounded with a drop shadow.
guard let srcData = NSData(contentsOfFile: srcPath),
      let srcImg = CGImageSourceCreateWithData(srcData, nil),
      let popup = CGImageSourceCreateImageAtIndex(srcImg, 0, nil) else {
    fputs("cannot read \(srcPath)\n", stderr); exit(1)
}
let pw = CGFloat(popup.width), ph = CGFloat(popup.height)
let rect = CGRect(x: CGFloat(W) - 112 - pw, y: (CGFloat(H) - ph) / 2, width: pw, height: ph)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 44,
              color: rgb(0, 0, 0, 0.55).cgColor)
let path = CGPath(roundedRect: rect, cornerWidth: 14, cornerHeight: 14, transform: nil)
ctx.addPath(path)
ctx.setFillColor(NSColor.white.cgColor)
ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(path)
ctx.clip()
ctx.draw(popup, in: rect)
ctx.restoreGState()

// Hairline border.
ctx.saveGState()
ctx.addPath(path)
ctx.setStrokeColor(rgb(255, 255, 255, 0.14).cgColor)
ctx.setLineWidth(1)
ctx.strokePath()
ctx.restoreGState()

guard let img = ctx.makeImage() else { fputs("no image\n", stderr); exit(1) }
let url = URL(fileURLWithPath: outPath)
guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fputs("no dest\n", stderr); exit(1)
}
CGImageDestinationAddImage(dest, img, nil)
if !CGImageDestinationFinalize(dest) { fputs("write failed\n", stderr); exit(1) }
print("wrote \(outPath) \(img.width)x\(img.height)")
