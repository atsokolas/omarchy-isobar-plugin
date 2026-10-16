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
  // main | hours | places | settings | place
  property string page: "main"
  // 0 is "the next 24 hours, from now"; 1–6 are the days after today.
  property int dayIndex: 0
  // The place on screen: "" is home, otherwise a saved place's key.
  property string viewKey: ""
  property int placeCursor: 0

  readonly property var barIdentity: hostWidget || root
  readonly property color foreground: bar ? bar.foreground : (service && service.palette ? service.palette.foreground : "#cccccc")
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property var sharedService: bar && bar.shell && typeof bar.shell.serviceFor === "function"
    ? bar.shell.serviceFor(moduleName) : null
  readonly property var service: sharedService || localService

  readonly property var viewPlace: viewKey !== "" ? service.placeFor(viewKey) : null
  readonly property bool away: viewPlace !== null
  readonly property string viewName: away ? viewPlace.name : service.placeName

  // Home and every saved place are read through the same view.
  WeatherView {
    id: view
    forecast: root.away ? (root.service.placeForecasts[root.viewKey] || null) : root.service.forecast
    air: root.away ? null : root.service.air
    alerts: root.service.alertsFor(root.viewKey)
    imperial: root.service.imperial
    use24: root.service.use24
    nowMs: root.service.nowMs
  }

  readonly property var fc: view.forecast
  readonly property var now: view.current
  readonly property bool imperial: service.imperial
  readonly property bool use24: service.use24
  readonly property real lms: view.localNow
  // The hour we're in. Lists of hours follow this rather than the minute, so
  // they're rebuilt (and the chart repainted) once an hour, not every tick.
  readonly property real lmsHour: Math.floor(lms / Model.HOUR_MS) * Model.HOUR_MS
  readonly property bool viewLoading: away ? service.fetchingPlace === viewKey : service.loading
  readonly property var palette: service.palette

  // The sky in the theme's colours: a yellow sun, a blue rain. The bar stays
  // monochrome; the panel doesn't.
  readonly property color sunTint: palette ? palette.yellow : foreground
  readonly property color wetTint: palette ? palette.blue : foreground
  readonly property color boltTint: palette ? palette.yellow : foreground
  // Plugins can't count on the shell's Color singleton, so the accent and
  // the warning colour come from the theme too.
  readonly property color accent: palette ? palette.accent : foreground
  readonly property color urgent: palette ? palette.red : foreground
  // The panel's own background, for the rings around beads on a line.
  readonly property color surface: palette ? palette.background : "#000000"

  readonly property var week: view.weekData
  readonly property var range: Model.weekRange(week)
  readonly property var selectedDay: dayIndex > 0 && dayIndex < week.length ? week[dayIndex] : null
  readonly property var chartHours: selectedDay ? Model.hoursOfDay(fc, selectedDay.date) : Model.upcomingHours(fc, lmsHour, 24)
  readonly property var sunEvents: Model.sunEvents(fc)

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

  function showPage(name, mode) {
    page = name
    if (name === "places") placeCursor = Math.max(0, root.placeKeys.indexOf(root.viewKey))
    if (name === "place") {
      placeSearch.mode = mode || "home"
      placeSearch.reset()
      Qt.callLater(function() { placeField.forceActiveFocus() })
    } else {
      Qt.callLater(function() { keyFront.forceActiveFocus() })
    }
  }

  function selectDay(i) {
    var next = Math.max(0, Math.min(week.length - 1, i))
    if (next === dayIndex) return
    dayIndex = next
    chart.drawIn()
  }

  // Every place in order, home first, for [ and ] to walk through.
  readonly property var placeKeys: [""].concat(service.places.map(function(p) { return p.key }))

  function showPlace(key) {
    viewKey = key || ""
    dayIndex = 0
    chart.clearSelection()
    // Stepping places from hour by hour stays on the hours.
    page = page === "hours" ? "hours" : "main"
    hourView.toNow()
    revealAnim.restart()
    chart.drawIn()
    sunArc.drawIn()
    hero.play()
    Qt.callLater(function() { keyFront.forceActiveFocus() })
    if (viewKey !== "") {
      var have = service.placeForecasts[viewKey]
      if (!have || Date.now() - have.fetchedAt > 10 * 60000) service.fetchPlace(viewKey)
    }
  }

  function stepPlace(delta) {
    var keys = placeKeys
    if (keys.length < 2) return
    var i = Math.max(0, keys.indexOf(viewKey))
    showPlace(keys[(i + delta + keys.length) % keys.length])
  }

  // Row 0 is home, then each place, then "Add a place".
  function activatePlaceRow(i) {
    if (i <= 0) showPlace("")
    else if (i > service.places.length) { if (service.places.length < Model.MAX_PLACES) showPage("place", "add") }
    else showPlace(service.places[i - 1].key)
  }

  function addPlace(p) {
    var list = Model.addPlace(service.places, p)
    persistSettings({ places: list })
    showPlace(Model.placeKey(p))
  }

  function togglePlaceOnBar(key) {
    persistSettings({ places: Model.togglePlaceOnBar(service.places, key) })
  }

  // From the bar: straight to that place's forecast, or shut if it's already up.
  function openPlace(key) {
    if (root.opened && root.page === "main" && root.viewKey === (key || "")) { root.close(); return }
    showPlace(key)
    if (!root.opened) openFromHotkey()
  }

  function removePlace(key) {
    persistSettings({ places: Model.removePlace(service.places, key) })
    if (viewKey === key) viewKey = ""
    placeCursor = Math.max(0, Math.min(placeCursor, service.places.length))
  }

  function handleClose() {
    if (page === "hours" && service.openHours) close()
    else if (page !== "main") showPage("main")
    else close()
  }

  function toggleHours() {
    if (page === "hours") { showPage("main"); return }
    hourView.toNow()
    showPage("hours")
  }

  function handleMove(dx, dy) {
    if (page === "places") {
      if (dy !== 0) placeCursor = Math.max(0, Math.min(service.places.length + 1, placeCursor + dy))
      return
    }
    if (page === "hours") {
      if (dx !== 0) hourView.step(dx)
      else if (dy !== 0) hourView.step(dy * 24)
      return
    }
    if (page !== "main") return
    if (dx !== 0) chart.step(dx)
    else if (dy !== 0) selectDay(dayIndex + dy)
  }

  onOpenedChanged: {
    if (!opened) return
    page = service.openHours ? "hours" : "main"
    dayIndex = 0
    viewKey = ""
    hourView.toNow()
    service.fetchPlaces(false)
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
    // The last search couldn't reach the geocoder, as opposed to finding nothing.
    property bool failed: false
    // "home" sets where you are; "add" keeps another place beside it.
    property string mode: "home"

    // Setting home, row 0 is "use my location"; results follow.
    readonly property int lead: mode === "home" ? 1 : 0
    readonly property int rows: results.length + lead

    function reset() {
      results = []
      cursor = 0
      pending = ""
      placeField.text = ""
      busy = false
      failed = false
    }

    function pick(i) {
      if (mode === "add") {
        var r = results[i]
        if (r) root.addPlace(r)
        return
      }
      if (i <= 0) root.service.useAutomatic()
      else root.service.setLocation(results[i - 1])
      root.showPage("main")
    }

    function query(text) {
      var q = Model.trim(text)
      if (q.length < 2) { pending = ""; results = []; cursor = 0; failed = false; return }
      pending = q
      if (!geocodeProcess.running) start()
    }

    function start() {
      busy = true
      geocodeProcess.out = ""
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
    onExited: function(code) {
      placeSearch.busy = false
      // The field was cleared while this was out: its answer is to nothing.
      if (placeSearch.pending === "") return
      placeSearch.failed = code !== 0
      placeSearch.results = Model.parseGeocodingResults(out)
      placeSearch.cursor = placeSearch.results.length > 0 ? placeSearch.lead : 0
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
    focusTarget: keyFront
    contentWidth: panel.fittedContentWidth(Style.space(500))
    contentHeight: panel.fittedContentHeight(
      root.page === "main" ? mainPage.implicitHeight
        : root.page === "hours" ? hoursPage.implicitHeight
        : root.page === "settings" ? settingsPage.implicitHeight
        : root.page === "places" ? placesPage.implicitHeight
        : placePage.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.page === "place"
      onMoveRequested: function(dx, dy) { root.handleMove(dx, dy) }
      onActivateRequested: {
        if (root.page === "main") root.service.openRadar(root.viewPlace)
        else if (root.page === "places") root.activatePlaceRow(root.placeCursor)
      }
      onDeleteRequested: {
        var c = root.placeCursor
        if (root.page === "places" && c >= 1 && c <= root.service.places.length) root.removePlace(root.service.places[c - 1].key)
      }
      onCloseRequested: root.handleClose()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      // The catcher reads h as "left", vim-style, so it would never reach
      // onTextKey below. Here h means hour by hour: it's caught in front of
      // the catcher, and every other key passes through to it.
      Item {
        id: keyFront
        focus: true
        Keys.onPressed: function(event) {
          var plain = !(event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier))
          if (!keyCatcher.blocked && plain && event.text === "h") {
            root.toggleHours()
            event.accepted = true
          } else {
            event.accepted = false
          }
        }
      }
      onTextKey: function(text) {
        var key = String(text || "")
        if (key === "r") root.refresh()
        else if (key === "s") root.showPage(root.page === "settings" ? "main" : "settings")
        else if (key === "u") root.cycleUnits()
        else if (key === "/" || key === "f") root.showPage("place", root.page === "places" ? "add" : "home")
        else if (key === "p") root.showPage(root.page === "places" ? "main" : "places")
        else if (key === "b" && root.page === "places" && root.placeCursor >= 1 && root.placeCursor <= root.service.places.length) root.togglePlaceOnBar(root.service.places[root.placeCursor - 1].key)
        else if ((key === "a" || key === "+") && root.service.places.length < Model.MAX_PLACES) root.showPage("place", "add")
        else if (key === "[") root.stepPlace(-1)
        else if (key === "]") root.stepPlace(1)
        else if (key === "g") root.showPlace("")
        else if (key === "c") root.service.copySummary(root.viewPlace)
        else if (key === "o") root.service.openRadar(root.viewPlace)
        else if (key === "h") root.toggleHours()
        else if (key === "t" && root.page === "hours") hourView.toNow()
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

              Row {
                width: parent.width
                spacing: Style.space(8)

                Text {
                  id: viewTitle
                  width: Math.min(implicitWidth, parent.width - (viewRegion.visible ? viewRegion.implicitWidth + parent.spacing : 0))
                  text: root.viewName || Model.APP_NAME
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  font.bold: true
                  elide: Text.ElideRight

                  HoverHandler { cursorShape: Qt.PointingHandCursor }
                  TapHandler { onTapped: root.away ? root.showPage("places") : root.showPage("place") }
                }

                // Away from home, say which Springfield this is.
                Text {
                  id: viewRegion
                  visible: root.away && text !== ""
                  anchors.baseline: viewTitle.baseline
                  text: root.away ? root.viewPlace.description : ""
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                }
              }

              Text {
                width: parent.width
                readonly property bool trouble: !root.away && root.service.lastError !== "" && (root.service.stale || !root.fc)
                text: trouble
                  ? root.service.lastError
                  : root.fc
                    ? Model.weekday(root.lms) + " " + Model.clockText(root.lms, root.use24) + "  ·  updated " + Model.ageText(root.fc.fetchedAt, root.service.nowMs)
                    : root.away ? "Looking at the sky over " + root.viewName + "…" : "Looking at the sky…"
                color: trouble ? root.urgent : root.dim
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
                visible: root.away
                iconText: "󰋜"
                tooltipText: "Back home  g"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.showPlace("")
              }
              PanelActionButton {
                iconText: "󰥔"
                tooltipText: "Hour by hour  h"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.toggleHours()
              }
              PanelActionButton {
                iconText: "󰇧"
                tooltipText: "Places  p"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.showPage("places")
              }
              PanelActionButton {
                id: refreshButton
                iconText: "󰑐"
                tooltipText: root.viewLoading ? "Refreshing…" : "Refresh  r"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.refresh()
                RotationAnimator on rotation {
                  running: root.viewLoading
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

          // ---- An alert from the weather service, when there is one -------
          // Red, because it's the one thing on the page that may matter.
          // Click to read what the forecaster wrote.
          Item {
            id: alertBand
            Layout.fillWidth: true
            visible: view.activeAlerts.length > 0
            property bool expanded: false
            readonly property var first: view.activeAlerts.length > 0 ? view.activeAlerts[0] : null
            implicitHeight: alertColumn.implicitHeight + Style.space(20)

            Rectangle {
              anchors.fill: parent
              radius: Style.cornerRadius
              color: Qt.rgba(root.urgent.r, root.urgent.g, root.urgent.b, 0.1)
              border.width: 1
              border.color: Qt.rgba(root.urgent.r, root.urgent.g, root.urgent.b, 0.35)
            }
            Rectangle {
              x: 0
              y: Style.space(8)
              width: Style.space(3)
              height: parent.height - Style.space(16)
              radius: width / 2
              color: root.urgent
            }

            Column {
              id: alertColumn
              x: Style.space(16)
              y: Style.space(10)
              width: parent.width - Style.space(28)
              spacing: Style.space(4)

              Repeater {
                model: alertBand.expanded ? view.activeAlerts : (alertBand.first ? [alertBand.first] : [])
                Column {
                  required property var modelData
                  width: alertColumn.width
                  spacing: Style.space(3)
                  Text {
                    width: parent.width
                    text: modelData.event
                    color: root.urgent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    font.bold: true
                    wrapMode: Text.WordWrap
                  }
                  Text {
                    width: parent.width
                    visible: text !== ""
                    text: modelData.headline
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    wrapMode: Text.WordWrap
                  }
                  Text {
                    width: parent.width
                    visible: alertBand.expanded && text !== ""
                    text: modelData.description + (modelData.instruction ? "\n\n" + modelData.instruction : "")
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    lineHeight: 1.2
                    wrapMode: Text.WordWrap
                    bottomPadding: Style.space(6)
                  }
                }
              }

              Text {
                text: alertBand.expanded ? "Less" : (view.activeAlerts.length > 1 ? "And " + (view.activeAlerts.length - 1) + " more  ·  read" : "Read the details")
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }
            }

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: alertBand.expanded = !alertBand.expanded
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
              kind: view.kind
              night: view.night
              strength: view.strength
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
                visible: !!view.todayData
                Text {
                  text: "H " + (view.todayData ? Model.tempText(view.todayData.max, root.imperial) : "")
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                }
                Text {
                  text: "L " + (view.todayData ? Model.tempText(view.todayData.min, root.imperial) : "")
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
            text: view.sentence
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            lineHeight: 1.25
            wrapMode: Text.WordWrap
          }

          // Away from home: how it compares, and what time it is there.
          Text {
            Layout.fillWidth: true
            Layout.topMargin: -Style.space(4)
            visible: root.away && text !== ""
            text: root.away ? Model.compareLine(root.fc, root.service.forecast, root.imperial, root.service.placeName) : ""
            color: root.accent
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          // What to put on, and on the night of a full moon, its name.
          Text {
            Layout.fillWidth: true
            Layout.topMargin: -Style.space(4)
            visible: text !== ""
            text: {
              var bits = []
              if (view.wear) bits.push(view.wear)
              if (view.fullMoon && view.night) bits.push("The " + view.fullMoon + " is up tonight.")
              return bits.join("  ")
            }
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          // ---- The next two hours, when something is falling -------------
          Item {
            id: nowcast
            Layout.fillWidth: true
            readonly property var slots: view.nowcast.slots
            readonly property real peak: {
              var p = 0.5
              for (var i = 0; i < slots.length; i++) p = Math.max(p, slots[i].precip)
              return p
            }
            visible: slots.length > 0 && (view.nowcast.line !== "" || view.outlook.state === "now" || view.outlook.state === "soon")
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
                color: selected ? Style.selectedFillFor(root.foreground, root.accent)
                  : rowMouse.containsMouse ? Style.hoverFillFor(root.foreground, root.accent) : "transparent"

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
              sub: root.now && !isNaN(root.now.dew) ? Model.dewLine(view.comfort, Model.tempText(root.now.dew, root.imperial)) : ""
            }

            Tile {
              readonly property real uv: root.now ? (root.now.isDay ? root.now.uv : (view.todayData ? view.todayData.uvMax : NaN)) : NaN
              label: root.now && !root.now.isDay ? "UV TODAY" : "UV"
              value: isNaN(uv) ? "—" : String(Math.round(uv))
              sub: Model.uvLabel(uv)
            }

            Tile {
              readonly property var aqi: Model.aqiReading(view.air, root.imperial)
              label: aqi ? "AIR" : "PRESSURE"
              value: aqi ? String(aqi.value) : (root.now ? Model.pressureText(root.now.pressure, root.imperial) : "—")
              sub: aqi ? aqi.label : Model.pressureTrend(root.fc, root.lms)
            }
          }

          SunArc {
            id: sunArc
            Layout.fillWidth: true
            Layout.preferredHeight: implicitHeight
            day: view.todayData
            yesterday: view.yesterdayData
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
              readonly property bool old: root.away ? (root.fc && Date.now() - root.fc.fetchedAt > root.service.refreshMinutes * 60000 * 2) : root.service.stale
              text: old ? "Open-Meteo  ·  an older forecast" : "Open-Meteo"
              color: old ? root.urgent : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
            Text {
              anchors.right: parent.right
              text: root.service.places.length > 0 ? "← → hours   ↑ ↓ days   h hour by hour   [ ] places" : "← → hours   ↑ ↓ days   h hour by hour   p places"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }
        }
      }

      // ==== Hour by hour ===================================================
      // The forecast an hour at a time, for home or whichever place is up.
      ColumnLayout {
        id: hoursPage
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        visible: root.page === "hours"
        spacing: Style.space(12)
        opacity: root.reveal

        Item {
          Layout.fillWidth: true
          implicitHeight: Math.max(hoursTitle.implicitHeight, hoursButtons.height)
          Column {
            id: hoursTitle
            anchors.left: parent.left
            anchors.right: hoursButtons.left
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)
            Text {
              width: parent.width
              text: root.viewName || "Hour by hour"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
            }
            Text {
              width: parent.width
              text: "Hour by hour" + (root.away && root.service.forecast && root.fc ? "  ·  " + Model.offsetText(root.fc.offset, root.service.forecast.offset) : "")
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }
          Row {
            id: hoursButtons
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)
            PanelActionButton {
              visible: root.away
              iconText: "󰋜"
              tooltipText: "Back home  g"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.showPlace("")
            }
            PanelActionButton {
              iconText: "󰁍"
              tooltipText: "The overview  h"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.showPage("main")
            }
          }
        }

        PanelSeparator { Layout.fillWidth: true; foreground: root.foreground }

        HourByHour {
          id: hourView
          Layout.fillWidth: true
          Layout.preferredHeight: implicitHeight
          hours: Model.hourStrip(root.fc, root.lmsHour)
          lms: root.lms
          imperial: root.imperial
          use24: root.use24
          palette: root.palette
          foreground: root.foreground
          dim: root.dim
          accent: root.accent
          surface: root.surface
          sunTint: root.sunTint
          wetTint: root.wetTint
          boltTint: root.boltTint
          fontFamily: root.fontFamily
          moonPhase: root.service.moonPhase
          animate: root.service.animate
          live: root.opened && root.page === "hours"
        }

        PanelSeparator { Layout.fillWidth: true; foreground: root.foreground }

        Text {
          Layout.fillWidth: true
          text: "scroll or ← →  an hour   ·   ↑ ↓  a day   ·   t  now" + (root.service.places.length > 0 ? "   ·   [ ]  places" : "") + "   ·   h  overview"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }
      }

      // ==== Places =========================================================
      // Home and the other places you keep, each with its sky, its clock
      // and its temperature. Open one for the whole forecast there.
      Flickable {
        id: placesFlick
        anchors.fill: parent
        visible: root.page === "places"
        contentWidth: width
        contentHeight: placesPage.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        ColumnLayout {
          id: placesPage
          width: placesFlick.width
          spacing: Style.space(6)

          Item {
            Layout.fillWidth: true
            implicitHeight: Math.max(placesTitle.implicitHeight, placesBack.height)
            Column {
              id: placesTitle
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(2)
              Text {
                text: "Places"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
                font.bold: true
              }
              Text {
                text: root.service.places.length === 0 ? "Keep an eye on somewhere else" : "Home and " + root.service.places.length + " more"
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }
            PanelActionButton {
              id: placesBack
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

          Repeater {
            model: root.service.places.length + 2

            Rectangle {
              id: placeCard
              required property int index
              readonly property bool isHome: index === 0
              readonly property bool isAdd: index === root.service.places.length + 1
              readonly property var place: !isHome && !isAdd ? root.service.places[index - 1] : null
              readonly property var forecast: isHome ? root.service.forecast : (place ? (root.service.placeForecasts[place.key] || null) : null)
              readonly property var cur: forecast ? forecast.current : null
              readonly property real there: forecast ? Model.nowLocal(root.service.nowMs, forecast.offset) : 0
              readonly property var day: forecast ? Model.today(forecast, there) : null
              readonly property bool hot: index === root.placeCursor || cardMouse.containsMouse
              readonly property bool current: !isAdd && (isHome ? root.viewKey === "" : place && root.viewKey === place.key)

              Layout.fillWidth: true
              implicitHeight: isAdd ? Style.space(40) : Style.space(56)
              radius: Style.cornerRadius
              color: hot ? Style.hoverFillFor(root.foreground, root.accent) : "transparent"
              border.width: current ? 1 : 0
              border.color: Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.5)

              // ---- Add a place
              Row {
                visible: placeCard.isAdd
                anchors.left: parent.left
                anchors.leftMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(12)
                Text {
                  text: "󰐕"
                  color: placeCard.hot ? root.accent : root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.iconLarge
                  anchors.verticalCenter: parent.verticalCenter
                }
                Text {
                  text: root.service.places.length >= Model.MAX_PLACES ? "Eight is the most — remove one to add another" : "Add a place"
                  color: placeCard.hot ? root.accent : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  anchors.verticalCenter: parent.verticalCenter
                }
              }

              // ---- A place
              SkyIcon {
                id: cardIcon
                visible: !placeCard.isAdd
                x: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                iconSize: Style.space(30)
                kind: placeCard.cur ? Model.iconKind(placeCard.cur.code) : "cloudy"
                night: placeCard.cur ? !placeCard.cur.isDay : false
                strength: placeCard.cur ? Model.condition(placeCard.cur.code).strength : 1
                moonPhase: root.service.moonPhase
                iconColor: root.foreground
                moonColor: root.foreground
                sunColor: root.sunTint
                wetColor: root.wetTint
                boltColor: root.boltTint
                animated: placeCard.hot && root.service.animate
                opacity: placeCard.cur ? 1 : 0.35
              }

              Column {
                visible: !placeCard.isAdd
                anchors.left: cardIcon.right
                anchors.leftMargin: Style.space(14)
                anchors.right: cardClock.left
                anchors.rightMargin: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)

                Item {
                  width: parent.width
                  implicitHeight: cardName.implicitHeight
                  Text {
                    id: cardName
                    width: Math.min(implicitWidth, parent.width - Style.space(20))
                    text: placeCard.isHome ? (root.service.placeName || "Home") : (placeCard.place ? placeCard.place.name : "")
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    font.bold: true
                    elide: Text.ElideRight
                  }
                  Text {
                    visible: placeCard.isHome
                    anchors.left: cardName.right
                    anchors.leftMargin: Style.space(6)
                    anchors.verticalCenter: cardName.verticalCenter
                    text: "󰋜"
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                  }
                }
                Text {
                  readonly property var note: placeCard.place ? root.service.noteFor(placeCard.place.key) : null
                  width: parent.width
                  text: note ? note.text : placeCard.cur
                    ? Model.conditionLabel(placeCard.cur.code, placeCard.cur.isDay) + (placeCard.day ? "  ·  H " + Model.tempText(placeCard.day.max, root.imperial) + "  L " + Model.tempText(placeCard.day.min, root.imperial) : "")
                    : (root.service.fetchingPlace !== "" && placeCard.place && root.service.fetchingPlace === placeCard.place.key ? "Looking at the sky…" : (placeCard.place ? placeCard.place.description : ""))
                  color: note ? root.accent : root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  elide: Text.ElideRight
                }
              }

              // Their clock, and how far it is from yours.
              Column {
                id: cardClock
                visible: !placeCard.isAdd && !!placeCard.forecast
                anchors.right: cardTemp.left
                anchors.rightMargin: Style.space(14)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)
                Text {
                  anchors.right: parent.right
                  text: placeCard.forecast ? Model.clockText(placeCard.there, root.use24) : ""
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.features: { "tnum": 1 }
                }
                Text {
                  anchors.right: parent.right
                  text: placeCard.isHome ? "here" : (placeCard.forecast && root.service.forecast ? Model.offsetText(placeCard.forecast.offset, root.service.forecast.offset) : "")
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }
              }

              Text {
                id: cardTemp
                visible: !placeCard.isAdd
                anchors.right: cardActions.width > 0 ? cardActions.left : parent.right
                anchors.rightMargin: cardActions.width > 0 ? Style.space(4) : Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(46)
                horizontalAlignment: Text.AlignRight
                text: placeCard.cur ? Model.tempText(placeCard.cur.temp, root.imperial) : "—"
                color: placeCard.cur ? Model.tempColor(placeCard.cur.temp, root.palette) : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.heading
                font.features: { "tnum": 1 }
              }

              MouseArea {
                id: cardMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onPositionChanged: root.placeCursor = placeCard.index
                onClicked: root.activatePlaceRow(placeCard.index)
              }

              // On the bar stays lit, so you can see which ones are up there.
              Row {
                id: cardActions
                anchors.right: parent.right
                anchors.rightMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)

                readonly property bool onBar: !!placeCard.place && placeCard.place.onBar
                readonly property bool barFull: root.service.barPlaces.length >= Model.MAX_BAR_PLACES

                PanelActionButton {
                  id: barButton
                  visible: !!placeCard.place && (placeCard.hot || cardActions.onBar)
                  iconText: cardActions.onBar ? "󰐃" : "󰤱"
                  tooltipText: cardActions.onBar ? "Take off the bar  b"
                    : cardActions.barFull ? "Three on the bar is the most" : "Show on the bar  b"
                  foreground: cardActions.onBar ? root.accent : root.dim
                  hoverColor: root.accent
                  fontFamily: root.fontFamily
                  onClicked: root.togglePlaceOnBar(placeCard.place.key)
                }

                PanelActionButton {
                  id: removeButton
                  visible: !!placeCard.place && placeCard.hot
                  iconText: "󰅖"
                  tooltipText: "Remove  x"
                  foreground: root.dim
                  hoverColor: root.urgent
                  fontFamily: root.fontFamily
                  onClicked: root.removePlace(placeCard.place.key)
                }
              }
            }
          }

          Item { Layout.fillWidth: true; implicitHeight: Style.space(4) }

          Text {
            Layout.fillWidth: true
            text: "↑ ↓ choose   ·   Return open   ·   b bar   ·   a add   ·   x remove   ·   [ ] step through places"
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
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
          title: "Open hour by hour"
          meta: "The panel opens on the hours rather than the overview"
          foreground: root.foreground
          fontFamily: root.fontFamily
          trailingControl: Component {
            ToggleSwitch {
              checked: root.service.openHours
              onToggled: root.persistSettings({ openHours: !root.service.openHours })
            }
          }
        }

        PanelHero {
          Layout.fillWidth: true
          title: "Weather alerts"
          meta: "Warnings from the National Weather Service, in the US"
          foreground: root.foreground
          fontFamily: root.fontFamily
          trailingControl: Component {
            ToggleSwitch {
              checked: root.service.alertsOn
              onToggled: root.persistSettings({ alerts: !root.service.alertsOn })
            }
          }
        }

        PanelHero {
          Layout.fillWidth: true
          title: "Firsts of the season"
          meta: "First frost, first snow, the first warm day in months"
          foreground: root.foreground
          fontFamily: root.fontFamily
          trailingControl: Component {
            ToggleSwitch {
              checked: root.service.firsts
              onToggled: root.persistSettings({ firsts: !root.service.firsts })
            }
          }
        }

        PanelHero {
          Layout.fillWidth: true
          title: "Notes from your places"
          meta: "Snow, storms and real heat or cold where you keep an eye"
          foreground: root.foreground
          fontFamily: root.fontFamily
          trailingControl: Component {
            ToggleSwitch {
              checked: root.service.notes
              onToggled: root.persistSettings({ notes: !root.service.notes })
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
          text: "← →  read the hours   ·   ↑ ↓  or 1–7  pick a day   ·   t  back to now\nh  hour by hour   ·   /  location   ·   u  units   ·   o  radar   ·   c  copy   ·   r  refresh"
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
            text: placeSearch.mode === "add" ? "Add a place" : "Location"
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
            onClicked: root.showPage(placeSearch.mode === "add" ? "places" : "main")
          }
        }

        TextField {
          id: placeField
          Layout.fillWidth: true
          placeholderText: placeSearch.mode === "add" ? "A city to keep an eye on" : "Search for a city"
          foreground: root.foreground
          font.family: root.fontFamily
          onTextChanged: if (root.page === "place") geocodeDebounce.restart()

          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Escape) {
              root.showPage(placeSearch.mode === "add" ? "places" : "main"); event.accepted = true
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
              readonly property bool isAuto: index < placeSearch.lead
              readonly property var result: isAuto ? null : placeSearch.results[index - placeSearch.lead]
              readonly property bool hot: index === placeSearch.cursor
              width: parent.width
              height: Style.space(34)
              radius: Style.cornerRadius
              color: hot ? Style.hoverFillFor(root.foreground, root.accent) : "transparent"

              Text {
                id: placeIcon
                x: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                text: placeRow.isAuto ? "󰆤" : "󰍎"
                color: placeRow.hot ? Style.hoverStateColor(root.foreground, root.accent) : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.icon
              }
              Text {
                id: placeName
                anchors.left: placeIcon.right
                anchors.leftMargin: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                text: placeRow.isAuto ? "Use my location" : (placeRow.result ? placeRow.result.name : "")
                color: placeRow.hot ? Style.hoverStateColor(root.foreground, root.accent) : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: placeRow.isAuto && root.service.automatic
              }
              Text {
                anchors.left: placeName.right
                anchors.leftMargin: Style.space(8)
                anchors.right: parent.right
                anchors.rightMargin: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                text: placeRow.isAuto
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
          text: placeSearch.busy ? "Searching…" : placeSearch.failed ? "Can't reach the place search — check the network" : "Nowhere by that name"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          font.italic: true
        }

        Item { Layout.fillHeight: true; implicitHeight: Style.space(8) }

        Text {
          Layout.fillWidth: true
          text: placeSearch.mode === "add"
            ? "Kept in Isobar's settings, beside home.  ↑ ↓ choose  ·  Return add  ·  Esc back"
            : "Shared with Omarchy's own weather widget.  ↑ ↓ choose  ·  Return pick  ·  Esc back"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }
      }
    }
  }
}
