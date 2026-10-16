import QtQuick
import qs.Commons
import "Model.js" as Model

// The sky, drawn rather than set in a font: one clean stroke at the bar's
// 14px and at the panel's 72px, the moon in its actual phase at night, and
// weather that moves — slowly — while you are looking at it.
Item {
  id: root

  // clear | partly | cloudy | fog | drizzle | rain | sleet | snow | storm
  property string kind: "clear"
  property bool night: false
  property int strength: 2
  property real moonPhase: 0.5
  property real iconSize: Style.font.icon
  property color iconColor: "#cccccc"
  // The panel tints the sky in the theme's colours; the bar keeps it mono.
  property color sunColor: iconColor
  property color moonColor: iconColor
  property color wetColor: iconColor
  property color boltColor: iconColor
  // Moving weather: rays turn, rain falls, fog drifts.
  property bool animated: false
  // A soft light behind the sky, 0..1: golden hour, or a full moon.
  property real glow: 0
  property color glowColor: sunColor

  // 0..1, looped while animated. A resting frame is chosen so a still icon
  // still reads as rain rather than as a cloud with a few stray lines.
  property real t: 0.38
  property real pop: 1

  width: iconSize
  height: iconSize

  // A small arrival, for when the sky changes.
  function play() { arrival.restart() }

  readonly property int cycleMs: {
    switch (kind) {
      case "clear": return night ? 5200 : 14000
      case "partly": return 9000
      case "cloudy": return 9000
      case "fog": return 7000
      case "drizzle": return 1500
      case "rain": return 1100
      case "sleet": return 1500
      case "snow": return 3600
      case "storm": return 1300
    }
    return 6000
  }

  // Driven at 25 fps rather than every vsync: a sun that turns once in
  // fourteen seconds looks the same either way, and a Canvas repaint per
  // frame is not free on a busy machine.
  Timer {
    id: loop
    interval: 40
    repeat: true
    running: root.animated && root.visible
    onTriggered: root.t = (root.t + interval / root.cycleMs) % 1
    onRunningChanged: if (!running) root.t = 0.38
  }

  SequentialAnimation {
    id: arrival
    NumberAnimation { target: root; property: "pop"; to: 0.55; duration: 110; easing.type: Easing.InQuad }
    NumberAnimation { target: root; property: "pop"; to: 1; duration: 520; easing.type: Easing.OutBack; easing.overshoot: 2.2 }
  }

  onKindChanged: { canvas.requestPaint(); play() }
  onNightChanged: canvas.requestPaint()
  onStrengthChanged: canvas.requestPaint()
  onMoonPhaseChanged: canvas.requestPaint()
  onTChanged: canvas.requestPaint()
  onIconColorChanged: canvas.requestPaint()
  onSunColorChanged: canvas.requestPaint()
  onMoonColorChanged: canvas.requestPaint()
  onWetColorChanged: canvas.requestPaint()
  onBoltColorChanged: canvas.requestPaint()

  // Behind the sky, on its own: the clouds knock out what's under them, and
  // the light should stay.
  Canvas {
    id: halo
    anchors.centerIn: parent
    width: parent.width * 1.9
    height: width
    visible: root.glow > 0.01
    opacity: root.glow
    antialiasing: true
    renderStrategy: Canvas.Cooperative
    onWidthChanged: requestPaint()
    onVisibleChanged: if (visible) requestPaint()
    Connections {
      target: root
      function onGlowColorChanged() { halo.requestPaint() }
    }
    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      var c = width / 2
      var g = ctx.createRadialGradient(c, c, 0, c, c, c)
      var col = root.glowColor
      g.addColorStop(0, Qt.rgba(col.r, col.g, col.b, 0.55))
      g.addColorStop(0.45, Qt.rgba(col.r, col.g, col.b, 0.22))
      g.addColorStop(1, Qt.rgba(col.r, col.g, col.b, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, width, height)
    }
    Behavior on opacity { NumberAnimation { duration: 1200; easing.type: Easing.InOutSine } }
  }

  Canvas {
    id: canvas
    anchors.centerIn: parent
    width: parent.width
    height: parent.height
    scale: root.pop
    antialiasing: true
    renderStrategy: Canvas.Cooperative
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()

    function tau() { return Math.PI * 2 }

    function cloudPath(ctx, ox, oy, s) {
      var c = Model.cloudArcs(ox, oy, s)
      ctx.beginPath()
      ctx.moveTo(c.arcs[0].x, c.base)
      for (var i = 0; i < c.arcs.length; i++) {
        var a = c.arcs[i]
        ctx.arc(a.x, a.y, a.r, a.start, a.end, false)
      }
      ctx.closePath()
    }

    function cloud(ctx, ox, oy, s, color, alpha) {
      // Knock out whatever is behind the cloud first, so a sun or a second
      // cloud sits behind it without a line showing through.
      ctx.save()
      ctx.globalCompositeOperation = "destination-out"
      cloudPath(ctx, ox, oy, s)
      ctx.fillStyle = "#000000"
      ctx.fill()
      ctx.restore()
      ctx.save()
      ctx.globalAlpha = alpha === undefined ? 1 : alpha
      cloudPath(ctx, ox, oy, s)
      ctx.strokeStyle = color
      ctx.stroke()
      ctx.restore()
    }

    function sun(ctx, cx, cy, r, color, spin) {
      ctx.save()
      ctx.strokeStyle = color
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, tau(), false)
      ctx.stroke()
      var breathe = 1 + 0.06 * Math.sin(root.t * tau() * 3)
      ctx.beginPath()
      for (var i = 0; i < 8; i++) {
        var a = spin + i * Math.PI / 4
        var r0 = r * 1.5, r1 = r * (2.05 * breathe)
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      }
      ctx.stroke()
      ctx.restore()
    }

    function moon(ctx, cx, cy, r, color, withStars) {
      ctx.save()
      // The unlit disc, faintly, so a thin crescent still reads as the moon.
      ctx.globalAlpha = 0.32
      ctx.strokeStyle = color
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, tau(), false)
      ctx.stroke()
      ctx.globalAlpha = 1
      var pts = Model.moonPolygon(root.moonPhase, 20)
      ctx.beginPath()
      ctx.moveTo(cx + pts[0][0] * r, cy + pts[0][1] * r)
      for (var i = 1; i < pts.length; i++) ctx.lineTo(cx + pts[i][0] * r, cy + pts[i][1] * r)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      ctx.restore()

      if (!withStars) return
      var stars = [[0.84, 0.18, 0], [0.16, 0.8, 0.45], [0.86, 0.74, 0.7]]
      for (var s = 0; s < stars.length; s++) {
        var tw = 0.35 + 0.65 * Math.max(0, Math.sin((root.t + stars[s][2]) * tau()))
        var sx = stars[s][0] * width, sy = stars[s][1] * height
        var k = Math.max(1, root.iconSize * 0.035) * (0.6 + 0.6 * tw)
        ctx.save()
        ctx.globalAlpha = root.animated ? tw : 0.75
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(sx, sy - k * 1.8); ctx.lineTo(sx + k * 0.45, sy - k * 0.45)
        ctx.lineTo(sx + k * 1.8, sy); ctx.lineTo(sx + k * 0.45, sy + k * 0.45)
        ctx.lineTo(sx, sy + k * 1.8); ctx.lineTo(sx - k * 0.45, sy + k * 0.45)
        ctx.lineTo(sx - k * 1.8, sy); ctx.lineTo(sx - k * 0.45, sy - k * 0.45)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }
    }

    function body(ctx, cx, cy, r, withStars) {
      if (root.night) moon(ctx, cx, cy, r * 1.25, root.moonColor, withStars)
      else sun(ctx, cx, cy, r, root.sunColor, root.t * Math.PI / 2)
    }

    // Falling things, in the band below a raised cloud. `phase` staggers the
    // columns so they never fall in step.
    function fall(ctx, S, top, bottom, count, draw) {
      var span = bottom - top
      for (var i = 0; i < count; i++) {
        var x = S * (0.3 + 0.4 * (count === 1 ? 0.5 : i / (count - 1)))
        // At rest the drops are placed, not caught mid-fall: staggered
        // about the middle of the band, where they read as rain at 14px.
        var p = root.animated ? (root.t + i * 0.37 + (i % 2) * 0.21) % 1 : 0.32 + (i % 2) * 0.36
        var y = top + p * span
        var fade = Math.sin(p * Math.PI)
        draw(x, y, fade, i, p)
      }
    }

    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      var S = Math.min(width, height)
      var lw = Math.max(1.1, S < 24 ? S / 10.5 : S / 17)
      ctx.lineWidth = lw
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      // Keep the stroke inside the box.
      var inset = lw / 2
      var U = S - lw
      var o = inset
      var drift = root.animated ? Math.sin(root.t * Math.PI * 2) * U * 0.025 : 0
      var k = root.kind

      if (k === "clear") {
        if (root.night) moon(ctx, S / 2, S / 2, U * 0.3, root.moonColor, S >= 18)
        else sun(ctx, S / 2, S / 2, U * 0.2, root.sunColor, root.t * Math.PI / 2)
        return
      }

      if (k === "partly") {
        body(ctx, o + U * 0.36, o + U * 0.34, U * 0.15, false)
        cloud(ctx, o + U * 0.14 + drift, o + U * 0.18, U * 0.86, root.iconColor)
        return
      }

      if (k === "cloudy") {
        // Below ~20px a second cloud is only noise; one says overcast fine.
        if (S < 20) {
          cloud(ctx, o + drift, o + U * 0.02, U, root.iconColor)
          return
        }
        cloud(ctx, o + U * 0.26 - drift, o - U * 0.04, U * 0.7, root.iconColor, 0.5)
        cloud(ctx, o + drift, o + U * 0.1, U * 0.92, root.iconColor)
        return
      }

      if (k === "fog") {
        cloud(ctx, o + U * 0.04, o - U * 0.1, U * 0.92, root.iconColor)
        ctx.save()
        ctx.strokeStyle = root.iconColor
        ctx.globalAlpha = 0.85
        var slide = root.animated ? Math.sin(root.t * Math.PI * 2) * U * 0.06 : 0
        ctx.beginPath()
        ctx.moveTo(o + U * 0.12 + slide, o + U * 0.82); ctx.lineTo(o + U * 0.78 + slide, o + U * 0.82)
        ctx.moveTo(o + U * 0.26 - slide, o + U * 0.97); ctx.lineTo(o + U * 0.9 - slide, o + U * 0.97)
        ctx.stroke()
        ctx.restore()
        return
      }

      // Everything wet hangs from a cloud lifted to the top of the box —
      // a smaller one on the bar, so the rain gets room to be seen.
      var small = S < 22
      var cs = small ? U * 0.86 : U
      var cloudX = o + (U - cs) / 2
      var cloudY = o - cs * 0.2
      var top = cloudY + cs * 0.82, bottom = o + U * 1.0
      var n = Math.max(2, Math.min(4, root.strength + 1))

      if (k === "rain" || k === "drizzle" || k === "sleet") {
        ctx.save()
        ctx.strokeStyle = root.wetColor
        fall(ctx, S, top, bottom, n, function(x, y, fade, i) {
          var asFlake = k === "sleet" && i % 2 === 1
          ctx.globalAlpha = root.animated ? fade : 1
          if (k === "drizzle" || asFlake) {
            ctx.beginPath()
            ctx.arc(x, y, Math.max(0.7, lw * (asFlake ? 0.75 : 0.55)), 0, Math.PI * 2, false)
            ctx.fillStyle = root.wetColor
            ctx.fill()
          } else {
            var len = Math.max(small ? 3.2 : 0, U * (0.1 + 0.03 * root.strength))
            ctx.beginPath()
            ctx.moveTo(x + len * 0.28, y - len / 2)
            ctx.lineTo(x - len * 0.28, y + len / 2)
            ctx.stroke()
          }
        })
        ctx.restore()
      } else if (k === "snow") {
        ctx.save()
        ctx.fillStyle = root.wetColor
        ctx.strokeStyle = root.wetColor
        fall(ctx, S, top, bottom, n, function(x, y, fade, i, p) {
          var sway = Math.sin((p * 2 + i) * Math.PI) * U * 0.04
          ctx.globalAlpha = root.animated ? fade : 1
          var r = Math.max(0.8, lw * 0.7)
          if (S >= 28) {
            // A proper flake once there is room for its arms.
            var arm = U * 0.06
            ctx.beginPath()
            for (var a = 0; a < 3; a++) {
              var ang = a * Math.PI / 3 + p * Math.PI
              ctx.moveTo(x + sway - Math.cos(ang) * arm, y - Math.sin(ang) * arm)
              ctx.lineTo(x + sway + Math.cos(ang) * arm, y + Math.sin(ang) * arm)
            }
            ctx.lineWidth = Math.max(1, lw * 0.55)
            ctx.stroke()
          } else {
            ctx.beginPath()
            ctx.arc(x + sway, y, r, 0, Math.PI * 2, false)
            ctx.fill()
          }
        })
        ctx.restore()
      } else if (k === "storm") {
        // The bolt flickers twice a cycle, the way lightning does — never a
        // steady blink.
        var flash = 1
        if (root.animated) {
          var tt = root.t
          flash = (tt > 0.08 && tt < 0.13) || (tt > 0.18 && tt < 0.22) ? 1 : 0.35
        }
        ctx.save()
        ctx.globalAlpha = flash
        ctx.fillStyle = root.boltColor
        ctx.beginPath()
        ctx.moveTo(o + U * 0.55, o + U * 0.52)
        ctx.lineTo(o + U * 0.34, o + U * 0.8)
        ctx.lineTo(o + U * 0.49, o + U * 0.8)
        ctx.lineTo(o + U * 0.41, o + U * 1.0)
        ctx.lineTo(o + U * 0.68, o + U * 0.7)
        ctx.lineTo(o + U * 0.53, o + U * 0.7)
        ctx.lineTo(o + U * 0.63, o + U * 0.52)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }

      cloud(ctx, cloudX + drift * 0.6, cloudY, cs, root.iconColor)
    }
  }
}
