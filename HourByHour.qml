import QtQuick
import qs.Commons
import "Model.js" as Model

// Hour by hour: a strip of hours that glides under a fixed lens. Scrolling
// moves it freely but with a pull toward each hour; let go and it springs
// onto the nearest one, a touch past and back. The hour in the lens is the
// one read out above and below.
Item {
  id: root

  property var hours: []
  property real lms: 0
  property bool imperial: false
  property bool use24: false
  property var palette: null
  property color foreground: "#cccccc"
  property color dim: "#888888"
  property color accent: foreground
  property color surface: "#000000"
  property color sunTint: foreground
  property color wetTint: foreground
  property color boltTint: foreground
  property string fontFamily: Style.font.family
  property real moonPhase: 0.5
  property bool animate: true
  property bool live: true

  readonly property real itemWidth: Style.space(64)
  readonly property int count: hours ? hours.length : 0

  // Where the strip is, in hours from now. `raw` is where scrolling has
  // taken it; `position` is what is drawn, which chases it on a spring.
  property real raw: 0
  property real position: 0
  property bool tracking: false
  readonly property int index: count > 0 ? Model.clamp(Math.round(position), 0, count - 1) : 0
  readonly property var hour: count > 0 ? hours[index] : null

  Behavior on position {
    enabled: !root.tracking
    SpringAnimation { spring: 3.4; damping: 0.27; mass: 1; epsilon: 0.0015 }
  }

  function settleTo(i) {
    if (count === 0) return
    raw = Model.clamp(i, 0, count - 1)
    position = raw
  }

  // Keys and wheel notches walk from where the strip is headed, not from
  // where it happens to be mid-spring, so quick presses add up.
  function step(delta) { settleTo(Math.round(raw) + delta) }

  function toNow() {
    tracking = true
    raw = 0
    position = 0
    tracking = false
  }

  // Free movement from a touchpad: the detent makes it linger at each hour.
  function glide(delta) {
    if (count === 0) return
    raw = Model.clamp(raw + delta, -0.35, count - 1 + 0.35)
    position = Model.detent(raw, 0.55)
    restTimer.restart()
  }

  Timer { id: restTimer; interval: 140; onTriggered: root.settleTo(Math.round(root.raw)) }

  // The forecast rolls over on the hour, dropping the first entry; keep the
  // same hour in the lens rather than letting it slide on by one.
  property real _firstT: 0
  onHoursChanged: {
    var first = count > 0 ? hours[0].t : 0
    var shift = _firstT && first ? Math.round((first - _firstT) / Model.HOUR_MS) : 0
    _firstT = first
    if (shift > 0 && shift <= 2) {
      tracking = true
      raw = Math.max(0, raw - shift)
      position = Math.max(0, position - shift)
      tracking = false
    }
    if (raw > count - 1) settleTo(count - 1)
  }

  // The readings underneath settle in each time the lens takes a new hour.
  property real settle: 1
  NumberAnimation { id: settleAnim; target: root; property: "settle"; from: 0; to: 1; duration: 260; easing.type: Easing.OutCubic }
  property string _lastKind: ""
  onIndexChanged: {
    settleAnim.restart()
    var kind = hour ? Model.iconKind(hour.code) : ""
    if (_lastKind !== "" && kind !== _lastKind) heroIcon.play()
    _lastKind = kind
  }

  implicitHeight: column.implicitHeight

  Column {
    id: column
    width: parent.width
    spacing: Style.space(14)

    // ---- The hour in the lens, large ---------------------------------
    Item {
      width: parent.width
      height: Style.space(84)

      SkyIcon {
        id: heroIcon
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        iconSize: Style.space(72)
        kind: root.hour ? Model.iconKind(root.hour.code) : "cloudy"
        night: root.hour ? !root.hour.isDay : false
        strength: root.hour ? Model.condition(root.hour.code).strength : 1
        moonPhase: root.moonPhase
        iconColor: root.foreground
        sunColor: root.sunTint
        moonColor: root.foreground
        wetColor: root.wetTint
        boltColor: root.boltTint
        animated: root.live && root.animate
        opacity: root.hour ? 1 : 0.35
      }

      Row {
        id: heroTemp
        anchors.left: heroIcon.right
        anchors.leftMargin: Style.space(16)
        anchors.verticalCenter: parent.verticalCenter
        Text {
          id: heroDegrees
          text: root.hour ? Model.signed(Model.temp(root.hour.temp, root.imperial)) : "—"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.space(58)
          font.weight: Font.Light
          font.features: { "tnum": 1 }
        }
        Text {
          text: "°"
          color: root.hour ? Model.tempColor(root.hour.temp, root.palette) : root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.space(40)
          font.weight: Font.Light
          anchors.top: heroDegrees.top
        }
      }

      Column {
        anchors.left: heroTemp.right
        anchors.leftMargin: Style.space(16)
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(4)

        Text {
          anchors.right: parent.right
          text: Model.capital(Model.hourWhen(root.hour, root.lms, root.use24))
          color: root.hour && root.hour.now ? root.accent : root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.heading
          font.bold: true
        }
        Text {
          anchors.right: parent.right
          text: root.hour ? Model.conditionLabel(root.hour.code, root.hour.isDay) : ""
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }
      }
    }

    // ---- The strip ----------------------------------------------------
    Item {
      id: strip
      width: parent.width
      height: Style.space(132)
      clip: true

      readonly property real dayRow: Style.space(18)

      // The lens: fixed in the middle, the hours pass beneath it.
      Rectangle {
        id: lens
        x: (strip.width - width) / 2
        y: strip.dayRow
        width: root.itemWidth - Style.space(4)
        height: strip.height - strip.dayRow
        radius: Style.space(10)
        color: Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.07)
        border.width: 1
        border.color: Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.38)
      }
      Canvas {
        id: notch
        width: Style.space(10)
        height: Style.space(5)
        x: (strip.width - width) / 2
        y: strip.dayRow - height - Style.space(1)
        onPaint: {
          var ctx = getContext("2d")
          ctx.reset()
          ctx.fillStyle = root.accent
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.lineTo(width, 0)
          ctx.lineTo(width / 2, height)
          ctx.closePath()
          ctx.fill()
        }
        Connections { target: root; function onAccentChanged() { notch.requestPaint() } }
      }

      // Thirteen slots, recycled: each shows the hour nearest the lens that
      // falls in its residue, so only the slot leaving one edge changes hour.
      Repeater {
        model: 13

        Item {
          id: slot
          required property int index
          readonly property int n: 13
          readonly property int idx: index + n * Math.round((root.position - index) / n)
          readonly property bool valid: idx >= 0 && idx < root.count
          readonly property var h: valid ? root.hours[idx] : null
          readonly property real d: idx - root.position
          readonly property real ad: Math.abs(d)
          readonly property bool focused: ad < 0.5

          visible: valid && ad < 6.5
          width: root.itemWidth
          height: strip.height
          x: strip.width / 2 + d * root.itemWidth - width / 2

          // A new day starts on this hour: a hairline and its name.
          Rectangle {
            visible: !!slot.h && slot.h.dayStart
            x: 0
            y: Style.space(2)
            width: 1
            height: parent.height - Style.space(4)
            color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.22)
          }
          Text {
            visible: !!slot.h && slot.h.dayStart
            x: Style.space(5)
            y: 0
            text: slot.h ? slot.h.day.toUpperCase() : ""
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            font.letterSpacing: 1.1
            opacity: Math.max(0.35, 1 - slot.ad * 0.12)
          }

          Item {
            id: face
            y: strip.dayRow
            width: parent.width
            height: parent.height - strip.dayRow
            scale: 1 - 0.11 * Math.min(slot.ad, 3)
            opacity: Math.max(0, 1 - 0.24 * slot.ad)
            transformOrigin: Item.Center

            Column {
              anchors.centerIn: parent
              spacing: Style.space(5)

              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: slot.h ? (slot.h.now ? "Now" : Model.hourText(slot.h.t, root.use24)) : ""
                color: slot.focused ? root.accent : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                font.bold: slot.focused
              }
              SkyIcon {
                anchors.horizontalCenter: parent.horizontalCenter
                iconSize: Style.space(26)
                kind: slot.h ? Model.iconKind(slot.h.code) : "cloudy"
                night: slot.h ? !slot.h.isDay : false
                strength: slot.h ? Model.condition(slot.h.code).strength : 1
                moonPhase: root.moonPhase
                iconColor: root.foreground
                sunColor: root.sunTint
                moonColor: root.foreground
                wetColor: root.wetTint
                boltColor: root.boltTint
                animated: false
              }
              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: slot.h ? Model.tempText(slot.h.temp, root.imperial) : ""
                color: slot.h ? Model.tempColor(slot.h.temp, root.palette) : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
                font.features: { "tnum": 1 }
              }
              // Rain chance, only when it's worth saying; stronger as it rises.
              Item {
                anchors.horizontalCenter: parent.horizontalCenter
                width: Style.space(34)
                height: popLabel.implicitHeight
                readonly property real pop: slot.h && !isNaN(slot.h.pop) ? slot.h.pop : 0
                Text {
                  id: popLabel
                  visible: parent.pop >= 10
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: Math.round(parent.pop) + "%"
                  color: root.wetTint
                  opacity: 0.45 + 0.55 * parent.pop / 100
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.features: { "tnum": 1 }
                }
              }
              // The wind: an arrow that points the way it blows.
              Row {
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: Style.space(2)
                Text {
                  visible: !!slot.h && !isNaN(slot.h.windDir)
                  text: "↑"
                  rotation: slot.h && !isNaN(slot.h.windDir) ? slot.h.windDir + 180 : 0
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }
                Text {
                  text: slot.h ? String(Model.speed(slot.h.wind, root.imperial)) : ""
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.features: { "tnum": 1 }
                }
              }
            }
          }

          TapHandler { onTapped: root.settleTo(slot.idx) }
        }
      }

      // Mouse wheel: a notch is an hour. Touchpad: free, with the detent.
      property real notches: 0
      WheelHandler {
        target: null
        onWheel: function(event) {
          var px = event.pixelDelta, ad = event.angleDelta
          if (px.x !== 0 || px.y !== 0) {
            var dp = Math.abs(px.x) > Math.abs(px.y) ? px.x : px.y
            root.glide(-dp / root.itemWidth)
            return
          }
          strip.notches += Math.abs(ad.x) > Math.abs(ad.y) ? ad.x : ad.y
          while (strip.notches <= -120) { root.step(1); strip.notches += 120 }
          while (strip.notches >= 120) { root.step(-1); strip.notches -= 120 }
        }
      }

      // Dragging: the strip follows the hand, and a flick glides on.
      DragHandler {
        id: drag
        target: null
        yAxis.enabled: false
        property real startRaw: 0
        onActiveChanged: {
          if (active) {
            restTimer.stop()
            startRaw = Math.round(root.raw)
            root.tracking = true
          } else {
            root.tracking = false
            root.settleTo(Model.restIndex(root.raw, -centroid.velocity.x / root.itemWidth, root.count))
          }
        }
        onTranslationChanged: {
          if (!active) return
          root.raw = Model.clamp(startRaw - translation.x / root.itemWidth, -0.35, root.count - 1 + 0.35)
          root.position = Model.detent(root.raw, 0.55)
        }
      }
    }

    // ---- Where you are in the week -------------------------------------
    Item {
      id: track
      width: parent.width
      height: Style.space(26)

      readonly property real span: Math.max(1, root.count - 1)
      readonly property real lineY: Style.space(6)

      Rectangle {
        y: track.lineY - 1
        width: parent.width
        height: 2
        radius: 1
        color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.14)
      }
      Repeater {
        model: root.hours ? root.hours.map(function(h, i) { return { i: i, h: h } }).filter(function(e) { return e.h.dayStart }) : []
        Item {
          required property var modelData
          x: modelData.i / track.span * track.width
          Rectangle { x: -0.5; y: track.lineY - Style.space(3); width: 1; height: Style.space(6); color: root.dim }
          Text {
            x: -width / 2
            y: track.lineY + Style.space(5)
            visible: x + parent.x > 0 && parent.x + width / 2 < track.width
            text: Model.weekday(modelData.h.t, true)
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
      Rectangle {
        width: Style.space(9)
        height: width
        radius: width / 2
        x: Model.clamp(root.position, 0, track.span) / track.span * track.width - width / 2
        y: track.lineY - height / 2
        color: root.accent
        border.width: Style.space(2)
        border.color: root.surface
      }
      TapHandler {
        onTapped: function(point) { root.settleTo(Math.round(point.position.x / track.width * track.span)) }
      }
    }

    // ---- What the hour holds ------------------------------------------
    Flow {
      width: parent.width
      spacing: Style.space(18)
      opacity: 0.25 + 0.75 * root.settle
      transform: Translate { y: (1 - root.settle) * Style.space(4) }

      Repeater {
        model: Model.hourDetails(root.hour, root.imperial)
        Column {
          required property var modelData
          spacing: Style.space(2)
          Text {
            text: modelData.label.toUpperCase()
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            font.letterSpacing: 1.1
          }
          Text {
            text: modelData.value
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            font.features: { "tnum": 1 }
          }
        }
      }
    }
  }
}
