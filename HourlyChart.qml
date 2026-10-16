import QtQuick
import qs.Commons
import "Model.js" as Model

// Twenty-four hours as one line. The curve is monotone — it passes through
// every hour and never invents a peak between them — and is coloured along
// its length by the theme's own thermometer. Night is a faint band behind it,
// the chance of rain a row of bars beneath. Hover, or ← →, to read an hour.
Item {
  id: root

  property var hours: []
  property var palette: null
  property bool imperial: false
  property bool use24: false
  property bool startsNow: true
  property var sunEvents: []          // [{t, rise: bool}]
  property color foreground: "#cccccc"
  property color dim: Qt.darker(foreground, 1.55)
  property color wet: palette ? palette.blue : foreground
  property string fontFamily: Style.font.family
  property real moonPhase: 0.5
  property color surface: "transparent"

  // The hour being read: hovered, or stepped to from the keyboard. -1 is none.
  property int activeIndex: -1
  property int keyboardIndex: -1
  readonly property int shownIndex: hover.hovered && hoverIndex >= 0 ? hoverIndex : keyboardIndex
  property int hoverIndex: -1

  // 0 → 1 on open: the line draws itself in from the left.
  property real reveal: 1
  function drawIn() { revealAnim.restart() }

  NumberAnimation {
    id: revealAnim
    target: root
    property: "reveal"
    from: 0
    to: 1
    duration: 700
    easing.type: Easing.OutCubic
  }

  onShownIndexChanged: activeIndex = shownIndex

  implicitHeight: Style.space(170)

  readonly property int count: hours.length
  // Room at each end for the first and last labels to sit whole.
  readonly property real inset: Style.space(14)
  readonly property real slot: count > 0 ? (width - inset * 2) / count : width
  readonly property real iconTop: 0
  readonly property real iconSize: Style.space(15)
  readonly property real labelTop: iconSize + Style.space(4)
  readonly property real curveTop: labelTop + Style.space(22)
  readonly property real curveBottom: height - Style.space(52)
  readonly property real barsTop: curveBottom + Style.space(8)
  readonly property real barsBottom: height - Style.space(18)

  readonly property var range: {
    var vals = []
    for (var i = 0; i < hours.length; i++) vals.push(Model.temp(hours[i].temp, imperial))
    return Model.niceRange(vals, imperial ? 8 : 5)
  }

  function xAt(i) { return inset + (i + 0.5) * slot }
  function valueAt(i) { return Model.temp(hours[i].temp, imperial) }
  function yAt(i) {
    var r = range
    var v = valueAt(i)
    return curveTop + (1 - (v - r.lo) / (r.hi - r.lo)) * (curveBottom - curveTop)
  }
  // The thermometer reads Celsius whatever the display units are.
  function colorAt(i) { return Model.tempColor(hours[i].temp, palette) }

  function step(delta) {
    if (count === 0) return
    var base = keyboardIndex < 0 ? (delta > 0 ? -1 : count) : keyboardIndex
    keyboardIndex = Math.max(0, Math.min(count - 1, base + delta))
  }

  function clearSelection() { keyboardIndex = -1 }

  onHoursChanged: { keyboardIndex = -1; canvas.requestPaint() }
  onPaletteChanged: canvas.requestPaint()
  onImperialChanged: canvas.requestPaint()
  onRevealChanged: canvas.requestPaint()
  onWidthChanged: canvas.requestPaint()
  onHeightChanged: canvas.requestPaint()
  onForegroundChanged: canvas.requestPaint()

  Canvas {
    id: canvas
    anchors.fill: parent
    antialiasing: true

    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      var n = root.count
      if (n < 2) return
      var fg = root.foreground

      // Night, as a band behind everything.
      ctx.fillStyle = Qt.rgba(fg.r, fg.g, fg.b, 0.045)
      var runStart = -1
      for (var i = 0; i <= n; i++) {
        var dark = i < n && !root.hours[i].isDay
        if (dark && runStart < 0) runStart = i
        if (!dark && runStart >= 0) {
          var x0 = runStart === 0 ? 0 : root.inset + runStart * root.slot
          var x1 = i === n ? root.width : root.inset + i * root.slot
          ctx.fillRect(x0, root.labelTop, x1 - x0, root.barsBottom - root.labelTop)
          runStart = -1
        }
      }

      // Sunrise and sunset, as hairlines at the minute they happen.
      ctx.save()
      ctx.strokeStyle = Qt.rgba(fg.r, fg.g, fg.b, 0.22)
      ctx.lineWidth = 1
      var t0 = root.hours[0].t
      for (var e = 0; e < root.sunEvents.length; e++) {
        var frac = (root.sunEvents[e].t - t0) / Model.HOUR_MS
        if (frac < 0 || frac > n) continue
        var sx = Math.round(root.inset + frac * root.slot) + 0.5
        ctx.beginPath()
        for (var y = root.labelTop; y < root.barsBottom; y += 4) { ctx.moveTo(sx, y); ctx.lineTo(sx, Math.min(y + 2, root.barsBottom)) }
        ctx.stroke()
      }
      ctx.restore()

      // The line draws itself in.
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, root.width * root.reveal, root.height)
      ctx.clip()

      var pts = []
      for (var p = 0; p < n; p++) pts.push([root.xAt(p), root.yAt(p)])
      // Run the line out to both edges so it doesn't stop half a slot short.
      var first = [0, pts[0][1]], last = [root.width, pts[n - 1][1]]
      var segs = Model.monotoneSegments(pts)

      function trace() {
        ctx.moveTo(first[0], first[1])
        ctx.lineTo(pts[0][0], pts[0][1])
        for (var s = 0; s < segs.length; s++) ctx.bezierCurveTo(segs[s][0], segs[s][1], segs[s][2], segs[s][3], segs[s][4], segs[s][5])
        ctx.lineTo(last[0], last[1])
      }

      // A whisper of fill, fading to nothing.
      var fill = ctx.createLinearGradient(0, root.curveTop, 0, root.curveBottom + Style.space(6))
      fill.addColorStop(0, Qt.rgba(fg.r, fg.g, fg.b, 0.10))
      fill.addColorStop(1, Qt.rgba(fg.r, fg.g, fg.b, 0))
      ctx.beginPath()
      trace()
      ctx.lineTo(root.width, root.curveBottom + Style.space(6))
      ctx.lineTo(0, root.curveBottom + Style.space(6))
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()

      var stroke = ctx.createLinearGradient(0, 0, root.width, 0)
      for (var g = 0; g < n; g++) stroke.addColorStop(Math.min(1, root.xAt(g) / root.width), root.colorAt(g))
      ctx.beginPath()
      trace()
      ctx.lineWidth = Math.max(2, Style.spaceReal(2.25))
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.strokeStyle = stroke
      ctx.stroke()
      ctx.restore()

      // Chance of rain, as bars. Below 10% it's noise and is left out.
      var wet = root.wet
      var bw = Math.max(2, root.slot * 0.46)
      var bh = root.barsBottom - root.barsTop
      for (var b = 0; b < n; b++) {
        var pop = Model.num(root.hours[b].pop)
        if (isNaN(pop) || pop < 10) continue
        var h = Math.max(2, bh * pop / 100)
        ctx.fillStyle = Qt.rgba(wet.r, wet.g, wet.b, 0.25 + 0.6 * pop / 100)
        ctx.fillRect(root.xAt(b) - bw / 2, root.barsBottom - h, bw, h)
      }
      // The floor the bars stand on.
      ctx.fillStyle = Qt.rgba(fg.r, fg.g, fg.b, 0.12)
      ctx.fillRect(0, root.barsBottom, root.width, 1)
    }
  }

  // Icons and temperatures every third hour.
  Repeater {
    model: root.count

    Item {
      required property int index
      readonly property var hour: root.hours[index]
      readonly property bool marked: index % 3 === 0
      visible: marked
      x: root.xAt(index) - width / 2
      width: root.slot * 3
      height: root.height

      SkyIcon {
        anchors.horizontalCenter: parent.horizontalCenter
        y: root.iconTop
        iconSize: root.iconSize
        kind: hour ? Model.iconKind(hour.code) : "cloudy"
        night: hour ? !hour.isDay : false
        strength: hour ? Model.condition(hour.code).strength : 1
        moonPhase: root.moonPhase
        iconColor: root.dim
        opacity: root.reveal > (index / root.count) ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 220 } }
      }

      Text {
        anchors.horizontalCenter: parent.horizontalCenter
        y: root.labelTop
        text: hour ? Model.tempText(hour.temp, root.imperial) : ""
        color: hour ? root.colorAt(index) : root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        font.bold: true
        opacity: root.reveal > (index / root.count) ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 220 } }
      }

      Text {
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        text: hour ? (index === 0 && root.startsNow ? "Now" : Model.hourText(hour.t, root.use24)) : ""
        color: index === 0 && root.startsNow ? root.foreground : root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: index === 0 && root.startsNow
      }
    }
  }

  // The hour being read: a hairline, and a bead on the curve.
  Rectangle {
    visible: root.shownIndex >= 0
    x: root.shownIndex >= 0 ? Math.round(root.xAt(root.shownIndex)) : 0
    y: root.labelTop
    width: 1
    height: root.barsBottom - root.labelTop
    color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.35)
  }

  Rectangle {
    visible: root.shownIndex >= 0
    readonly property real size: Style.space(9)
    width: size
    height: size
    radius: size / 2
    x: root.shownIndex >= 0 ? root.xAt(root.shownIndex) - size / 2 : 0
    y: root.shownIndex >= 0 ? root.yAt(root.shownIndex) - size / 2 : 0
    color: root.shownIndex >= 0 ? root.colorAt(root.shownIndex) : root.foreground
    border.width: Math.max(2, Style.space(2))
    border.color: root.surface
    Behavior on x { enabled: !hover.hovered; NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
    Behavior on y { enabled: !hover.hovered; NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
  }

  HoverHandler {
    id: hover
    onPointChanged: {
      if (root.count === 0) return
      root.hoverIndex = Math.max(0, Math.min(root.count - 1, Math.floor((point.position.x - root.inset) / root.slot)))
    }
    onHoveredChanged: if (!hovered) root.hoverIndex = -1
  }
}
