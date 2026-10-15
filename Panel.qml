import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

Panel {
  id: root
  moduleName: "atsokolas.isobar"
  ipcTarget: "atsokolas.isobar"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property bool openedFromHotkey: false
  // main | settings | place
  property string page: "main"
  // 0 is "the next 24 hours, from now"; 1–6 are the days after today.
  property int dayIndex: 0

  readonly property var barIdentity: hostWidget || root
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property var sharedService: bar && bar.shell && typeof bar.shell.serviceFor === "function"
    ? bar.shell.serviceFor(moduleName) : null
  readonly property var service: sharedService || localService

  readonly property var fc: service.forecast
  readonly property var now: service.current
  readonly property bool imperial: service.imperial
  readonly property bool use24: service.use24
  readonly property real lms: service.localNow
  readonly property var palette: service.palette

  // The sky in the theme's colours: a yellow sun, a blue rain. The bar stays
  // monochrome; the panel doesn't.
  readonly property color sunTint: palette ? palette.yellow : foreground
  readonly property color wetTint: palette ? palette.blue : foreground
  readonly property color boltTint: palette ? palette.yellow : foreground
  // The panel's own background, for the rings around beads on a line.
  readonly property color surface: palette ? palette.background : "#000000"

  readonly property var week: service.weekData
  readonly property var range: Model.weekRange(week)
  readonly property var selectedDay: dayIndex > 0 && dayIndex < week.length ? week[dayIndex] : null
  readonly property var chartHours: selectedDay ? Model.hoursOfDay(fc, selectedDay.date) : Model.upcomingHours(fc, lms, 24)
  readonly property var sunEvents: {
    var out = []
    if (!fc) return out
    for (var i = 0; i < fc.daily.length; i++) {
      out.push({ t: fc.daily[i].sunrise, rise: true })
      out.push({ t: fc.daily[i].sunset, rise: false })
    }
    return out
  }

  // Content settles in on open, the way a page turns rather than repaints.
  property real reveal: 1
  NumberAnimation { id: revealAnim; target: root; property: "reveal"; from: 0; to: 1; duration: 320; easing.type: Easing.OutCubic }

  function pushSettings() { if (service) service.settings = settings }
  onSettingsChanged: pushSettings()
  onServiceChanged: pushSettings()
  Component.onCompleted: pushSettings()

  function persistSettings(values) {
    var entryData = { id: root.moduleName }
    for (var existing in root.settings) if (existing !== "id") entryData[existing] = root.settings[existing]
    for (var key in values) {
      if (values[key] === undefined) delete entryData[key]
      else entryData[key] = values[key]
    }
    root.settings = entryData
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entryData)
    pushSettings()
  }

  function open() {
    openedFromHotkey = false
    setCenterHoverRevealSuppressed(false)
    root.controller.show()
  }

  function openFromHotkey() {
    openedFromHotkey = true
    root.controller.show()
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.openFromHotkey()
  }

  function refresh() { service.refresh() }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && typeof root.bar.setCenterHoverRevealSuppressed === "function")
      root.bar.setCenterHoverRevealSuppressed(value)
  }

  // u flips between the two systems; from "auto" it goes to whichever one
  // isn't already on screen.
  function cycleUnits() {
    var next = service.unit === "auto" ? (service.imperial ? "metric" : "imperial") : (service.unit === "metric" ? "imperial" : "metric")
    persistSettings({ unit: next })
  }

  function showPage(name) {
    page = name
    if (name === "place") {
      placeSearch.reset()
      Qt.callLater(function() { placeField.forceActiveFocus() })
    } else {
      Qt.callLater(function() { keyCatcher.forceActiveFocus() })
    }
  }

  function selectDay(i) {
    var next = Math.max(0, Math.min(week.length - 1, i))
    if (next === dayIndex) return
    dayIndex = next
    chart.drawIn()
  }

  function handleClose() {
    if (page !== "main") showPage("main")
    else close()
  }

  function handleMove(dx, dy) {
    if (page !== "main") return
    if (dx !== 0) chart.step(dx)
    else if (dy !== 0) selectDay(dayIndex + dy)
  }

  onOpenedChanged: {
    if (!opened) return
    page = "main"
    dayIndex = 0
    chart.clearSelection()
    revealAnim.restart()
    chart.drawIn()
    sunArc.drawIn()
    hero.play()
    // Coming back to a forecast more than a few minutes old: refresh quietly
    // behind what is already on screen.
    if (!fc || Date.now() - fc.fetchedAt > 10 * 60000) service.fetch()
  }

  // What a hovered (or stepped-to) hour says, above the chart.
  function hourReadout(i) {
    var h = chartHours[i]
    if (!h) return ""
    var bits = [Model.hourText(h.t, use24), Model.tempText(h.temp, imperial), Model.conditionLabel(h.code, h.isDay)]
    if (!isNaN(h.pop) && h.pop >= 10) bits.push(h.pop + "%")
    return bits.join("  ·  ")
  }

  Service {
    id: localService
    active: root.sharedService === null
  }

  // ---- Place search ----------------------------------------------------------
  QtObject {
    id: placeSearch
    property var results: []
    property int cursor: 0
    property string pending: ""
    property bool busy: false

    // Row 0 is always "use my location"; results follow.
    readonly property int rows: results.length + 1

    function reset() {
      results = []
      cursor = 0
      placeField.text = ""
    }

    function pick(i) {
      if (i <= 0) root.service.useAutomatic()
      else root.service.setLocation(results[i - 1])
      root.showPage("main")
    }

    function query(text) {
      var q = Model.trim(text)
      if (q.length < 2) { results = []; cursor = 0; return }
      pending = q
      if (!geocodeProcess.running) start()
    }

    function start() {
      busy = true
      geocodeProcess.asked = pending
      geocodeProcess.command = Model.curl(Model.geocodeQuery(pending), 6)
      geocodeProcess.running = true
    }
  }

  Timer { id: geocodeDebounce; interval: 260; onTriggered: placeSearch.query(placeField.text) }

  Process {
    id: geocodeProcess
    property string asked: ""
    property string out: ""
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: geocodeProcess.out = text }
    onExited: {
      placeSearch.busy = false
      placeSearch.results = Model.parseGeocodingResults(out)
      placeSearch.cursor = placeSearch.results.length > 0 ? 1 : 0
      if (placeSearch.pending !== asked) Qt.callLater(placeSearch.start)
    }
  }

  // ---- Pieces ----------------------------------------------------------------
  component Caps: Text {
    color: root.dim
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.bold: true
    font.letterSpacing: 1.1
  }

  component Tile: Item {
    id: tile
    property string label: ""
    property string value: ""
    property string sub: ""
    property Component art: null
    implicitHeight: Style.space(54)
    Layout.fillWidth: true
    Layout.preferredWidth: 1

    Column {
      anchors.left: parent.left
      anchors.right: artLoader.left
      anchors.rightMargin: Style.space(4)
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(3)
      Caps { text: tile.label }
      Text {
        width: parent.width
        text: tile.value
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.heading
        elide: Text.ElideRight
      }
      Text {
        width: parent.width
        text: tile.sub
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
      }
    }

    Loader {
      id: artLoader
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      sourceComponent: tile.art
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(500))
    contentHeight: panel.fittedContentHeight(
      root.page === "main" ? mainPage.implicitHeight : (root.page === "settings" ? settingsPage.implicitHeight : placePage.implicitHeight))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.page === "place"
      onMoveRequested: function(dx, dy) { root.handleMove(dx, dy) }
      onActivateRequested: if (root.page === "main") root.service.openRadar()
      onCloseRequested: root.handleClose()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) {
        var key = String(text || "")
        if (key === "r") root.refresh()
        else if (key === "s") root.showPage(root.page === "settings" ? "main" : "settings")
        else if (key === "u") root.cycleUnits()
        else if (key === "/" || key === "f") root.showPage("place")
        else if (key === "c") root.service.copySummary()
        else if (key === "o") root.service.openRadar()
        else if (key === "t") { root.selectDay(0); chart.clearSelection() }
        else if (key >= "1" && key <= "7") root.selectDay(parseInt(key, 10) - 1)
      }

      // ==== Main ===========================================================
      Flickable {
        id: mainFlick
        anchors.fill: parent
        visible: root.page === "main"
        contentWidth: width
        contentHeight: mainPage.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        ColumnLayout {
          id: mainPage
          width: mainFlick.width
          spacing: Style.space(12)
          opacity: root.reveal
          transform: Translate { y: (1 - root.reveal) * Style.space(8) }

          // ---- Where, when ------------------------------------------------
          Item {
            Layout.fillWidth: true
            implicitHeight: Math.max(placeColumn.implicitHeight, headerButtons.height)

            Column {
              id: placeColumn
              anchors.left: parent.left
              anchors.right: headerButtons.left
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(2)

              Text {
                width: parent.width
                text: root.service.placeName || Model.APP_NAME
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
                font.bold: true
                elide: Text.ElideRight

                HoverHandler { cursorShape: Qt.PointingHandCursor }
                TapHandler { onTapped: root.showPage("place") }
              }

              Text {
                width: parent.width
                readonly property bool trouble: root.service.lastError !== "" && (root.service.stale || !root.fc)
                text: trouble
                  ? root.service.lastError
                  : root.fc
                    ? Model.weekday(root.lms) + " " + Model.clockText(root.lms, root.use24) + "  ·  updated " + Model.ageText(root.fc.fetchedAt, root.service.nowMs)
                    : "Looking at the sky…"
                color: trouble ? Color.urgent : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }
            }

            Row {
              id: headerButtons
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(2)

              PanelActionButton {
                iconText: "󰍎"
                tooltipText: "Change location  /"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.showPage("place")
              }
              PanelActionButton {
                id: refreshButton
                iconText: "󰑐"
                tooltipText: root.service.loading ? "Refreshing…" : "Refresh  r"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.refresh()
                RotationAnimator on rotation {
                  running: root.service.loading
                  from: 0; to: 360; duration: 900; loops: Animation.Infinite
                  onRunningChanged: if (!running) refreshButton.rotation = 0
                }
              }
              PanelActionButton {
                iconText: "󰒓"
                tooltipText: "Settings  s"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.showPage("settings")
              }
            }
          }

          // ---- The sky right now ----------------------------------------
          Item {
            Layout.fillWidth: true
            implicitHeight: Style.space(84)

            SkyIcon {
              id: hero
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              iconSize: Style.space(72)
              kind: root.service.kind
              night: root.service.night
              strength: root.service.strength
              moonPhase: root.service.moonPhase
              iconColor: root.foreground
              sunColor: root.sunTint
              moonColor: root.foreground
              wetColor: root.wetTint
              boltColor: root.boltTint
              animated: root.opened && root.service.animate
              opacity: root.now ? 1 : 0.35
            }

            Row {
              id: tempRow
              anchors.left: hero.right
              anchors.leftMargin: Style.space(16)
              anchors.verticalCenter: parent.verticalCenter
              spacing: 0

              Text {
                id: bigTemp
                text: root.now ? Model.signed(Model.temp(root.now.temp, root.imperial)) : "—"
                color: root.foreground
                font.family: root.fontFamily
                // The read-out; deliberately outside the type scale.
                font.pixelSize: Style.space(58)
                font.weight: Font.Light
                font.features: { "tnum": 1 }
              }
              // The degree sign carries the temperature's colour — the one
              // spot of the thermometer in the hero.
              Text {
                text: "°"
                color: root.now ? Model.tempColor(root.now.temp, root.palette) : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.space(40)
                font.weight: Font.Light
                anchors.top: bigTemp.top
              }
            }

            Column {
              anchors.right: parent.right
              anchors.left: tempRow.right
              anchors.leftMargin: Style.space(16)
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(4)

              Text {
                anchors.right: parent.right
                text: root.now ? Model.conditionLabel(root.now.code, root.now.isDay) : ""
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.heading
                font.bold: true
              }
              Text {
                anchors.right: parent.right
                text: root.now ? "Feels like " + Model.tempText(root.now.feels, root.imperial) : ""
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }
              Row {
                anchors.right: parent.right
                spacing: Style.space(10)
                visible: !!root.service.todayData
                Text {
                  text: "H " + (root.service.todayData ? Model.tempText(root.service.todayData.max, root.imperial) : "")
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                }
                Text {
                  text: "L " + (root.service.todayData ? Model.tempText(root.service.todayData.min, root.imperial) : "")
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                }
              }
            }
          }

          // ---- What a person would tell you -----------------------------
          Text {
            Layout.fillWidth: true
            visible: text !== ""
            text: root.service.sentence
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            lineHeight: 1.25
            wrapMode: Text.WordWrap
          }

          // ---- The next two hours, when something is falling -------------
          Item {
            id: nowcast
            Layout.fillWidth: true
            readonly property var slots: root.fc ? root.fc.minutely.filter(function(m) { return m.t + 15 * 60000 > root.lms }) : []
            readonly property real peak: {
              var p = 0.5
              for (var i = 0; i < slots.length; i++) p = Math.max(p, slots[i].precip)
              return p
            }
            visible: slots.length > 0 && (root.service.outlook.state === "now" || root.service.outlook.state === "soon")
            implicitHeight: Style.space(44)

            Rectangle {
              anchors.fill: parent
              radius: Style.cornerRadius
              color: Qt.rgba(root.wetTint.r, root.wetTint.g, root.wetTint.b, 0.08)
            }

            Caps {
              id: nowcastLabel
              anchors.left: parent.left
              anchors.leftMargin: Style.space(12)
              anchors.verticalCenter: parent.verticalCenter
              text: "NEXT 2 HOURS"
              color: root.wetTint
            }

            Row {
              id: nowcastBars
              anchors.left: nowcastLabel.right
              anchors.leftMargin: Style.space(14)
              anchors.right: parent.right
              anchors.rightMargin: Style.space(12)
              anchors.verticalCenter: parent.verticalCenter
              height: Style.space(24)
              spacing: Style.space(3)

              Repeater {
                model: nowcast.slots
                Item {
                  required property var modelData
                  width: (nowcastBars.width - nowcastBars.spacing * (nowcast.slots.length - 1)) / Math.max(1, nowcast.slots.length)
                  height: nowcastBars.height
                  Rectangle {
                    anchors.bottom: parent.bottom
                    width: parent.width
                    height: Math.max(2, parent.height * Math.min(1, modelData.precip / nowcast.peak) * root.reveal)
                    radius: Math.min(2, Style.cornerRadius)
                    color: Qt.rgba(root.wetTint.r, root.wetTint.g, root.wetTint.b, modelData.precip > 0 ? 0.35 + 0.55 * Math.min(1, modelData.precip / nowcast.peak) : 0.15)
                  }
                }
              }
            }
          }

          PanelSeparator { Layout.fillWidth: true; foreground: root.foreground }

          // ---- The day ahead ---------------------------------------------
          Item {
            Layout.fillWidth: true
            implicitHeight: chartTitle.implicitHeight

            Caps {
              id: chartTitle
              anchors.left: parent.left
              text: root.selectedDay ? Model.weekday(root.selectedDay.t).toUpperCase() : "NEXT 24 HOURS"
            }
            Text {
              anchors.right: parent.right
              anchors.verticalCenter: chartTitle.verticalCenter
              text: chart.activeIndex >= 0 ? root.hourReadout(chart.activeIndex)
                : root.selectedDay ? Model.conditionLabel(root.selectedDay.code, 1) + "  ·  " + Model.precipText(root.selectedDay.precipSum, root.imperial)
                : ""
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }

          HourlyChart {
            id: chart
            Layout.fillWidth: true
            Layout.preferredHeight: implicitHeight
            hours: root.chartHours
            palette: root.palette
            imperial: root.imperial
            use24: root.use24
            startsNow: root.dayIndex === 0
            sunEvents: root.sunEvents
            foreground: root.foreground
            dim: root.dim
            wet: root.wetTint
            fontFamily: root.fontFamily
            moonPhase: root.service.moonPhase
            surface: root.surface
          }

          PanelSeparator { Layout.fillWidth: true; foreground: root.foreground }

          // ---- The week ---------------------------------------------------
          // Each day's low-to-high as a bar on the week's shared scale, the
          // way a glance at a thermometer works. ↑ ↓ (or a click) puts that
          // day on the chart above.
          Column {
            Layout.fillWidth: true
            spacing: Style.space(1)

            Repeater {
              model: root.week

              Rectangle {
                id: dayRow
                required property var modelData
                required property int index
                readonly property bool selected: index === root.dayIndex
                readonly property var span: Model.rangeSpan(modelData, root.range.lo, root.range.hi)
                width: parent.width
                height: Style.space(28)
                radius: Style.cornerRadius
                color: selected ? Style.selectedFillFor(root.foreground, Color.accent)
                  : rowMouse.containsMouse ? Style.hoverFillFor(root.foreground, Color.accent) : "transparent"

                Text {
                  id: dayName
                  x: Style.space(8)
                  width: Style.space(52)
                  anchors.verticalCenter: parent.verticalCenter
                  text: dayRow.index === 0 ? "Today" : Model.weekday(dayRow.modelData.t, true)
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.bold: dayRow.selected
                }

                SkyIcon {
                  id: dayIcon
                  anchors.left: dayName.right
                  anchors.verticalCenter: parent.verticalCenter
                  iconSize: Style.space(17)
                  kind: Model.iconKind(dayRow.modelData.code)
                  strength: Model.condition(dayRow.modelData.code).strength
                  iconColor: root.foreground
                  sunColor: root.sunTint
                  wetColor: root.wetTint
                  boltColor: root.boltTint
                }

                Text {
                  id: dayPop
                  anchors.left: dayIcon.right
                  anchors.leftMargin: Style.space(8)
                  width: Style.space(36)
                  anchors.verticalCenter: parent.verticalCenter
                  text: !isNaN(dayRow.modelData.popMax) && dayRow.modelData.popMax >= 20 ? dayRow.modelData.popMax + "%" : ""
                  color: root.wetTint
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: true
                }

                Text {
                  id: dayLow
                  anchors.left: dayPop.right
                  width: Style.space(38)
                  horizontalAlignment: Text.AlignRight
                  anchors.verticalCenter: parent.verticalCenter
                  text: Model.tempText(dayRow.modelData.min, root.imperial)
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.features: { "tnum": 1 }
                }

                Item {
                  id: track
                  anchors.left: dayLow.right
                  anchors.leftMargin: Style.space(12)
                  anchors.right: dayHigh.left
                  anchors.rightMargin: Style.space(12)
                  anchors.verticalCenter: parent.verticalCenter
                  height: Style.space(5)

                  Rectangle {
                    anchors.fill: parent
                    radius: height / 2
                    color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08)
                  }

                  Rectangle {
                    x: track.width * dayRow.span.from
                    width: Math.max(height, track.width * (dayRow.span.to - dayRow.span.from) * root.reveal)
                    height: parent.height
                    radius: height / 2
                    gradient: Gradient {
                      orientation: Gradient.Horizontal
                      GradientStop { position: 0; color: Model.tempColor(dayRow.modelData.min, root.palette) }
                      GradientStop { position: 1; color: Model.tempColor(dayRow.modelData.max, root.palette) }
                    }
                  }

                  // Where today is now, on today's bar.
                  Rectangle {
                    visible: dayRow.index === 0 && !!root.now
                    readonly property real f: root.now ? Model.clamp((root.now.temp - root.range.lo) / (root.range.hi - root.range.lo), 0, 1) : 0
                    width: Style.space(9)
                    height: width
                    radius: width / 2
                    x: track.width * f - width / 2
                    anchors.verticalCenter: parent.verticalCenter
                    color: root.foreground
                    border.width: Math.max(2, Style.space(2))
                    border.color: root.surface
                  }
                }

                Text {
                  id: dayHigh
                  anchors.right: parent.right
                  anchors.rightMargin: Style.space(8)
                  width: Style.space(34)
                  anchors.verticalCenter: parent.verticalCenter
                  text: Model.tempText(dayRow.modelData.max, root.imperial)
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.features: { "tnum": 1 }
                }

                MouseArea {
                  id: rowMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.selectDay(dayRow.index)
                }
              }
            }
          }

          PanelSeparator { Layout.fillWidth: true; foreground: root.foreground }

          // ---- Readings ---------------------------------------------------
          RowLayout {
            Layout.fillWidth: true
            spacing: Style.space(12)

            Tile {
              label: "WIND"
              value: root.now ? Model.speedText(root.now.wind, root.imperial) : "—"
              sub: root.now ? Model.compass(root.now.windDir) + (isNaN(root.now.gusts) ? "" : ", gusts " + Model.speed(root.now.gusts, root.imperial)) : ""
              art: Component {
                // A compass with the wind's heading: where it is blowing to.
                Canvas {
                  width: Style.space(22)
                  height: width
                  antialiasing: true
                  readonly property real dir: root.now ? root.now.windDir : 0
                  onDirChanged: requestPaint()
                  onPaint: {
                    var ctx = getContext("2d")
                    ctx.reset()
                    var c = width / 2, r = c - 1.5
                    var fg = root.foreground
                    ctx.strokeStyle = Qt.rgba(fg.r, fg.g, fg.b, 0.25)
                    ctx.lineWidth = 1
                    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2, false); ctx.stroke()
                    ctx.fillStyle = Qt.rgba(fg.r, fg.g, fg.b, 0.5)
                    ctx.fillRect(c - 0.5, 1, 1, 3)
                    ctx.save()
                    ctx.translate(c, c)
                    ctx.rotate((dir + 180) * Math.PI / 180)
                    ctx.fillStyle = root.foreground
                    ctx.beginPath()
                    ctx.moveTo(0, -r + 3)
                    ctx.lineTo(r * 0.36, r * 0.5)
                    ctx.lineTo(0, r * 0.24)
                    ctx.lineTo(-r * 0.36, r * 0.5)
                    ctx.closePath()
                    ctx.fill()
                    ctx.restore()
                  }
                }
              }
            }

            Tile {
              label: "HUMIDITY"
              value: root.now && !isNaN(root.now.humidity) ? Math.round(root.now.humidity) + "%" : "—"
              sub: root.now && !isNaN(root.now.dew) ? "Dew point " + Model.tempText(root.now.dew, root.imperial) : ""
            }

            Tile {
              readonly property real uv: root.now ? (root.now.isDay ? root.now.uv : (root.service.todayData ? root.service.todayData.uvMax : NaN)) : NaN
              label: root.now && !root.now.isDay ? "UV TODAY" : "UV"
              value: isNaN(uv) ? "—" : String(Math.round(uv))
              sub: Model.uvLabel(uv)
            }

            Tile {
              readonly property var aqi: Model.aqiReading(root.service.air, root.imperial)
              label: aqi ? "AIR" : "PRESSURE"
              value: aqi ? String(aqi.value) : (root.now ? Model.pressureText(root.now.pressure, root.imperial) : "—")
              sub: aqi ? aqi.label : Model.pressureTrend(root.fc, root.lms)
            }
          }

          SunArc {
            id: sunArc
            Layout.fillWidth: true
            Layout.preferredHeight: implicitHeight
            day: root.service.todayData
            yesterday: root.service.yesterdayData
            lms: root.lms
            use24: root.use24
            moonPhase: root.service.moonPhase
            foreground: root.foreground
            dim: root.dim
            sunColor: root.sunTint
            fontFamily: root.fontFamily
          }

          PanelSeparator { Layout.fillWidth: true; foreground: root.foreground }

          Item {
            Layout.fillWidth: true
            implicitHeight: footLeft.implicitHeight
            Text {
              id: footLeft
              anchors.left: parent.left
              text: root.service.stale ? "Open-Meteo  ·  an older forecast" : "Open-Meteo"
              color: root.service.stale ? Color.urgent : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
            Text {
              anchors.right: parent.right
              text: "← → hours   ↑ ↓ days   u units   o radar   s settings"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }
        }
      }

      // ==== Settings =======================================================
      ColumnLayout {
        id: settingsPage
        anchors.fill: parent
        visible: root.page === "settings"
        spacing: Style.space(4)

        Item {
          Layout.fillWidth: true
          implicitHeight: Math.max(settingsTitle.implicitHeight, backButton.height)
          Text {
            id: settingsTitle
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: "Settings"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.title
            font.bold: true
          }
          PanelActionButton {
            id: backButton
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            iconText: "󰁍"
            tooltipText: "Back"
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.showPage("main")
          }
        }

        PanelSeparator { Layout.fillWidth: true; foreground: root.foreground }

        PanelHero {
          Layout.fillWidth: true
          title: "Location"
          meta: (root.service.placeName || "Unknown") + (root.service.automatic ? "  ·  from your network" : "")
          foreground: root.foreground
          fontFamily: root.fontFamily
          trailingControl: Component {
            Button {
              text: "Change"
              foreground: root.foreground
              fontFamily: root.fontFamily
              bordered: true
              onClicked: root.showPage("place")
            }
          }
        }

        PanelHero {
          Layout.fillWidth: true
          title: "Units"
          meta: root.service.unit === "auto" ? "Following your locale" : (root.imperial ? "°F, mph, inches" : "°C, km/h, millimetres")
          foreground: root.foreground
          fontFamily: root.fontFamily
          trailingControl: Component {
            ButtonGroup {
              options: [{ value: "auto", label: "Auto" }, { value: "metric", label: "°C" }, { value: "imperial", label: "°F" }]
              value: root.service.unit
              foreground: root.foreground
              fontFamily: root.fontFamily
              focusable: false
              onChanged: function(v) { root.persistSettings({ unit: v }) }
            }
          }
        }

        PanelHero {
          Layout.fillWidth: true
          title: "Rain hint on the bar"
          meta: "\"Rain in 20m\" beside the temperature, only when it's coming"
          foreground: root.foreground
          fontFamily: root.fontFamily
          trailingControl: Component {
            ToggleSwitch {
              checked: root.service.showHint
              onToggled: root.persistSettings({ showHint: !root.service.showHint })
            }
          }
        }

        PanelHero {
          Layout.fillWidth: true
          title: "Heads-up before rain"
          meta: "A quiet toast half an hour before it starts"
          foreground: root.foreground
          fontFamily: root.fontFamily
          trailingControl: Component {
            ToggleSwitch {
              checked: root.service.notify
              onToggled: root.persistSettings({ notify: !root.service.notify })
            }
          }
        }

        PanelHero {
          Layout.fillWidth: true
          title: "Moving sky"
          meta: "Rays turn and rain falls while you're looking"
          foreground: root.foreground
          fontFamily: root.fontFamily
          trailingControl: Component {
            ToggleSwitch {
              checked: root.service.animate
              onToggled: root.persistSettings({ animate: !root.service.animate })
            }
          }
        }

        Item { Layout.fillHeight: true; implicitHeight: Style.space(12) }

        Text {
          Layout.fillWidth: true
          text: "← →  read the hours   ·   ↑ ↓  or 1–7  pick a day   ·   t  back to now\n/  location   ·   u  units   ·   o  radar   ·   c  copy   ·   r  refresh"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          lineHeight: 1.4
          wrapMode: Text.WordWrap
        }
      }

      // ==== Place ==========================================================
      ColumnLayout {
        id: placePage
        anchors.fill: parent
        visible: root.page === "place"
        spacing: Style.space(8)

        Item {
          Layout.fillWidth: true
          implicitHeight: Math.max(placeTitle.implicitHeight, placeBack.height)
          Text {
            id: placeTitle
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: "Location"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.title
            font.bold: true
          }
          PanelActionButton {
            id: placeBack
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            iconText: "󰁍"
            tooltipText: "Back"
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.showPage("main")
          }
        }

        TextField {
          id: placeField
          Layout.fillWidth: true
          placeholderText: "Search for a city"
          foreground: root.foreground
          font.family: root.fontFamily
          onTextChanged: if (root.page === "place") geocodeDebounce.restart()

          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Escape) {
              root.showPage("main"); event.accepted = true
            } else if (event.key === Qt.Key_Down) {
              placeSearch.cursor = Math.min(placeSearch.rows - 1, placeSearch.cursor + 1); event.accepted = true
            } else if (event.key === Qt.Key_Up) {
              placeSearch.cursor = Math.max(0, placeSearch.cursor - 1); event.accepted = true
            } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
              placeSearch.pick(placeSearch.cursor); event.accepted = true
            }
          }
        }

        Column {
          Layout.fillWidth: true
          spacing: 0

          Repeater {
            model: placeSearch.rows

            Rectangle {
              id: placeRow
              required property int index
              readonly property var result: index > 0 ? placeSearch.results[index - 1] : null
              readonly property bool hot: index === placeSearch.cursor
              width: parent.width
              height: Style.space(34)
              radius: Style.cornerRadius
              color: hot ? Style.hoverFillFor(root.foreground, Color.accent) : "transparent"

              Text {
                id: placeIcon
                x: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                text: placeRow.index === 0 ? "󰆤" : "󰍎"
                color: placeRow.hot ? Style.hoverStateColor(root.foreground, Color.accent) : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.icon
              }
              Text {
                id: placeName
                anchors.left: placeIcon.right
                anchors.leftMargin: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                text: placeRow.index === 0 ? "Use my location" : (placeRow.result ? placeRow.result.name : "")
                color: placeRow.hot ? Style.hoverStateColor(root.foreground, Color.accent) : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: placeRow.index === 0 && root.service.automatic
              }
              Text {
                anchors.left: placeName.right
                anchors.leftMargin: Style.space(8)
                anchors.right: parent.right
                anchors.rightMargin: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                text: placeRow.index === 0
                  ? (root.service.automatic ? "current  ·  from your network" : "from your network")
                  : (placeRow.result ? placeRow.result.description : "")
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }
              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onPositionChanged: placeSearch.cursor = placeRow.index
                onClicked: placeSearch.pick(placeRow.index)
              }
            }
          }
        }

        Text {
          Layout.fillWidth: true
          visible: placeSearch.busy || (Model.trim(placeField.text).length >= 2 && placeSearch.results.length === 0)
          text: placeSearch.busy ? "Searching…" : "Nowhere by that name"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          font.italic: true
        }

        Item { Layout.fillHeight: true; implicitHeight: Style.space(8) }

        Text {
          Layout.fillWidth: true
          text: "Shared with Omarchy's own weather widget.  ↑ ↓ choose  ·  Return pick  ·  Esc back"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }
      }
    }
  }
}
