import QtQuick
import qs.Commons
import "Model.js" as Model

// The sun's day: a path from sunrise to sunset with the sun where it is now,
// and how much daylight was gained or lost since yesterday — the quiet fact
// that tells you which way the year is turning. At night the moon takes the
// middle of the sky, in its phase.
Item {
  id: root

  property var day: null
  property var yesterday: null
  property real lms: 0
  property bool use24: false
  property real moonPhase: 0.5
  property color foreground: "#cccccc"
  property color dim: Qt.darker(foreground, 1.55)
  property color sunColor: foreground
  property string fontFamily: Style.font.family

  property real reveal: 1
  function drawIn() { revealAnim.restart() }
  NumberAnimation { id: revealAnim; target: root; property: "reveal"; from: 0; to: 1; duration: 1100; easing.type: Easing.OutCubic }

  // Inside the polar circles: "night" with no sunrise, "day" with no sunset.
  readonly property string polar: Model.polar(day)
  readonly property real progress: Model.sunProgress(day, lms)
  readonly property bool up: progress >= 0 && progress <= 1
  readonly property real arcLeft: Style.space(36)
  readonly property real arcRight: width - Style.space(36)
  readonly property real horizon: Style.space(44)
  readonly property real peak: Style.space(36)

  implicitHeight: horizon + Style.space(26)

  function pointAt(f) {
    var a = Math.PI * (1 - f)
    var cx = (arcLeft + arcRight) / 2, rx = (arcRight - arcLeft) / 2
    return { x: cx + rx * Math.cos(a), y: horizon - peak * Math.sin(a) }
  }

  onProgressChanged: canvas.requestPaint()
  onRevealChanged: canvas.requestPaint()
  onWidthChanged: canvas.requestPaint()
  onSunColorChanged: canvas.requestPaint()
  onForegroundChanged: canvas.requestPaint()

  Canvas {
    id: canvas
    anchors.fill: parent
    antialiasing: true

    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      var fg = root.foreground
      var steps = 64

      // Horizon.
      ctx.fillStyle = Qt.rgba(fg.r, fg.g, fg.b, 0.14)
      ctx.fillRect(root.arcLeft - Style.space(10), root.horizon, root.arcRight - root.arcLeft + Style.space(20), 1)

      // The whole path, dotted.
      ctx.fillStyle = Qt.rgba(fg.r, fg.g, fg.b, 0.28)
      for (var i = 0; i <= 40; i++) {
        var q = root.pointAt(i / 40)
        ctx.beginPath()
        ctx.arc(q.x, q.y, 0.9, 0, Math.PI * 2, false)
        ctx.fill()
      }

      if (!root.up) return
      // The part already travelled, solid.
      var f = Math.max(0, Math.min(1, root.progress)) * root.reveal
      var sc = root.sunColor
      ctx.beginPath()
      var start = root.pointAt(0)
      ctx.moveTo(start.x, start.y)
      for (var s = 1; s <= steps; s++) {
        var pt = root.pointAt(f * s / steps)
        ctx.lineTo(pt.x, pt.y)
      }
      ctx.lineWidth = Math.max(1.5, Style.spaceReal(1.75))
      ctx.lineCap = "round"
      ctx.strokeStyle = Qt.rgba(sc.r, sc.g, sc.b, 0.85)
      ctx.stroke()

      // A soft glow, then the sun itself.
      var p = root.pointAt(f)
      var glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Style.space(14))
      glow.addColorStop(0, Qt.rgba(sc.r, sc.g, sc.b, 0.35))
      glow.addColorStop(1, Qt.rgba(sc.r, sc.g, sc.b, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(p.x, p.y, Style.space(14), 0, Math.PI * 2, false)
      ctx.fill()
      ctx.fillStyle = sc
      ctx.beginPath()
      ctx.arc(p.x, p.y, Style.spaceReal(4.5), 0, Math.PI * 2, false)
      ctx.fill()
    }
  }

  // At night the moon takes the top of the arc.
  SkyIcon {
    visible: !root.up && root.day !== null
    kind: "clear"
    night: true
    moonPhase: root.moonPhase
    iconSize: Style.space(22)
    iconColor: root.foreground
    moonColor: root.foreground
    x: (root.arcLeft + root.arcRight) / 2 - width / 2
    y: root.horizon - root.peak - height / 2 + Style.space(6)
  }

  // Sunrise, the length of the day, sunset — one line under the horizon.
  Text {
    anchors.left: parent.left
    anchors.bottom: parent.bottom
    text: root.day && root.polar === "" ? "↑ " + Model.clockText(root.day.sunrise, root.use24) : ""
    color: root.foreground
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  Text {
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    text: root.day && root.polar === "" ? Model.clockText(root.day.sunset, root.use24) + " ↓" : ""
    color: root.foreground
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  Text {
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.bottom
    readonly property string delta: root.day && root.yesterday ? Model.daylightDeltaText(root.day.daylight, root.yesterday.daylight) : ""
    text: !root.day ? ""
      : root.polar === "night" ? Model.moonName(root.moonPhase) + "  ·  no sunrise today"
      : root.polar === "day" ? "The sun doesn't set today"
      : (root.up ? "" : Model.moonName(root.moonPhase) + "  ·  ") + Model.durationText(root.day.daylight) + " of light" + (delta ? ", " + delta : "")
    color: root.dim
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }
}
