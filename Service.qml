import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// One engine per shell. Every bar — one per monitor — reads this instance, so
// the forecast is fetched once and the rain heads-up fires once.
//
// The last good forecast is kept on disk, so the bar has a temperature the
// moment the shell starts, before the network has even come up.
Item {
  id: root

  property var shell: null
  property var settings: ({})
  property bool active: true

  readonly property string home: Quickshell.env("HOME")
  readonly property string cacheDir: home + "/.cache/omarchy/isobar"
  readonly property string cachePath: cacheDir + "/forecast.json"
  readonly property string locationPath: home + "/.local/state/omarchy/settings/weather.json"
  readonly property string colorsPath: home + "/.local/state/omarchy/current/theme/colors.toml"

  // ---- Settings ------------------------------------------------------------
  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  readonly property string unit: String(setting("unit", "auto"))
  readonly property bool showHint: Model.boolSetting(setting("showHint", true), true)
  readonly property bool notify: Model.boolSetting(setting("notify", false), false)
  readonly property bool animate: Model.boolSetting(setting("animate", true), true)
  readonly property int refreshMinutes: Model.intSetting(setting("refreshMinutes", 15), 15, 5, 180)

  // Qt spells AM/PM as "a" or "AP" depending on version; either means 12h.
  readonly property bool use24: !/a/i.test(Qt.locale().timeFormat(Locale.ShortFormat).replace(/'[^']*'/g, ""))
  readonly property bool imperial: Model.shouldUseImperial(unit, Qt.locale().name, ipLocation ? ipLocation.country : "")

  // ---- Location ------------------------------------------------------------
  // Configured in weather.json (shared with the stock widget), else the IP.
  property var configured: ({ name: "", latitude: NaN, longitude: NaN })
  property var ipLocation: null
  readonly property bool automatic: !Model.hasCoordinates(configured) && Model.trim(configured.name) === ""
  // A hand-written weather.json may carry only a name; it is looked up once.
  property var namedLocation: null
  readonly property var location: Model.hasCoordinates(configured) ? configured
    : (Model.trim(configured.name) !== "" && namedLocation ? namedLocation : (Model.trim(configured.name) !== "" ? null : ipLocation))
  property string cachedPlace: ""
  readonly property string placeName: location ? String(location.name || "") : cachedPlace
  readonly property string locationKey: location ? Number(location.latitude).toFixed(3) + "," + Number(location.longitude).toFixed(3) : ""

  // ---- State ---------------------------------------------------------------
  property var forecast: null
  property var air: null
  property bool loading: false
  property bool stale: false
  property string lastError: ""
  property int failures: 0
  property var palette: null

  // Ticks on the minute, so ages and the sky stay honest.
  property real nowMs: Date.now()
  readonly property real localNow: forecast ? Model.nowLocal(nowMs, forecast.offset) : nowMs

  readonly property var current: forecast ? forecast.current : null
  readonly property var outlook: Model.precipOutlook(forecast, localNow)
  readonly property var todayData: Model.today(forecast, localNow)
  readonly property var yesterdayData: Model.yesterday(forecast, localNow)
  readonly property var weekData: Model.week(forecast, localNow)
  readonly property string sentence: Model.sentence(forecast, localNow, imperial, use24)

  // The live sky, worked out once for the bar and the panel. `night` follows
  // the forecast's own is_day flag, which knows about polar days.
  readonly property string kind: current ? Model.iconKind(current.code) : "cloudy"
  readonly property bool night: current ? !current.isDay : false
  readonly property int strength: current ? Model.condition(current.code).strength : 1
  readonly property real moonPhase: Model.moonPhase(nowMs)

  readonly property string tempLabel: current ? Model.tempText(current.temp, imperial) : ""
  readonly property string hint: showHint ? Model.barHint(outlook, use24) : ""

  // Raised when the sky itself changes, so the icon can make an entrance.
  signal skyChanged()
  property string _lastSky: ""
  onKindChanged: {
    if (_lastSky !== "" && _lastSky !== kind) skyChanged()
    _lastSky = kind
  }

  // ---- Fetching ------------------------------------------------------------
  property string _forecastOut: ""
  property string _airOut: ""
  property string _ipOut: ""
  property string _fetchingKey: ""

  function refresh() {
    if (!active) return
    failures = 0
    fetch()
  }

  function fetch() {
    if (!active) return
    if (!location) {
      if (!ipProcess.running) ipProcess.running = true
      return
    }
    if (forecastProcess.running) return
    loading = true
    _fetchingKey = locationKey
    _forecastOut = ""
    forecastProcess.command = Model.curl(Model.forecastQuery(location.latitude, location.longitude), 10)
    forecastProcess.running = true
    if (!airProcess.running) {
      _airOut = ""
      airProcess.command = Model.curl(Model.airQuery(location.latitude, location.longitude), 8)
      airProcess.running = true
    }
  }

  function applyForecast(raw) {
    loading = false
    var parsed = Model.parseForecast(raw, Date.now())
    if (!parsed) {
      fail("The forecast came back garbled")
      return
    }
    // A location change mid-flight: drop the answer for the old place.
    if (_fetchingKey !== locationKey) {
      Qt.callLater(fetch)
      return
    }
    forecast = parsed
    stale = false
    lastError = ""
    failures = 0
    retryTimer.stop()
    nowMs = Date.now()
    cacheFile.setText(JSON.stringify({ version: 1, key: locationKey, place: placeName, fetchedAt: parsed.fetchedAt, raw: raw }) + "\n")
    maybeAnnounce()
  }

  function fail(message) {
    loading = false
    failures++
    lastError = message
    stale = forecast !== null
    // 30s, 1m, 2m, 4m … capped at ten minutes. The network usually comes
    // back on its own; there is no need to hammer anyone while it does.
    retryTimer.interval = Math.min(600000, 30000 * Math.pow(2, Math.max(0, failures - 1)))
    retryTimer.restart()
  }

  function loadCache(text) {
    try {
      var data = JSON.parse(String(text || ""))
      if (!data || data.version !== 1) return
      // A cached forecast for somewhere else is worse than none at all.
      if (locationKey !== "" && data.key !== locationKey) return
      if (!cachedPlace) cachedPlace = String(data.place || "")
      var parsed = Model.parseForecast(data.raw, data.fetchedAt)
      if (!parsed) return
      if (forecast && forecast.fetchedAt >= parsed.fetchedAt) return
      forecast = parsed
      stale = (Date.now() - parsed.fetchedAt) > refreshMinutes * 60000 * 2
    } catch (e) {}
  }

  // ---- Location editing ----------------------------------------------------
  function setLocation(loc) {
    configured = loc ? { name: loc.name, latitude: Model.num(loc.latitude), longitude: Model.num(loc.longitude) } : { name: "", latitude: NaN, longitude: NaN }
    saveLocationProcess.command = Model.saveLocationCommand(loc)
    saveLocationProcess.running = true
  }

  function useAutomatic() { setLocation(null) }

  onLocationKeyChanged: {
    if (locationKey === "") return
    if (forecast && !Model.sameLocation(forecast, location)) {
      forecast = null
      air = null
    }
    if (!forecast) cacheFile.reload()
    failures = 0
    Qt.callLater(fetch)
  }

  // ---- Outward -------------------------------------------------------------
  property string _announced: ""

  function maybeAnnounce() {
    if (!notify || !outlook || outlook.state !== "soon") return
    if (outlook.minutes > 30) return
    var key = Model.rainKey(outlook)
    if (key === "" || key === _announced) return
    _announced = key
    var mins = Math.max(5, Math.round(outlook.minutes / 5) * 5)
    Quickshell.execDetached(Model.toastCommand(
      Model.shortNoun(outlook.noun).replace(/^./, function(c) { return c.toUpperCase() }) + " in about " + mins + " minutes",
      placeName ? placeName + " · " + Model.tempText(current.temp, imperial) : ""))
  }

  function openRadar() {
    var cmd = location ? Model.radarCommand(location.latitude, location.longitude) : null
    if (cmd) Quickshell.execDetached(cmd)
  }

  function copySummary() {
    var text = Model.copyPayload(forecast, localNow, imperial, use24, placeName)
    if (text) Quickshell.execDetached(Model.copyCommand(text))
  }

  Component.onCompleted: {
    Quickshell.execDetached(["mkdir", "-p", cacheDir])
  }

  // ---- Plumbing ------------------------------------------------------------
  FileView {
    id: locationFile
    path: root.locationPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      root.configured = Model.parseLocationFile(text())
      if (!Model.hasCoordinates(root.configured) && Model.trim(root.configured.name) !== "") {
        nameLookup.command = Model.curl(Model.geocodeQuery(root.configured.name), 6)
        nameLookup.running = true
      } else if (root.automatic && !root.ipLocation && !ipProcess.running) {
        ipProcess.running = true
      }
    }
    onLoadFailed: {
      root.configured = Model.parseLocationFile("")
      if (!root.ipLocation && !ipProcess.running) ipProcess.running = true
    }
  }

  FileView {
    id: cacheFile
    path: root.cachePath
    atomicWrites: true
    printErrors: false
    onLoaded: root.loadCache(text())
  }

  FileView {
    path: root.colorsPath
    watchChanges: true
    printErrors: false
    onLoaded: root.palette = Model.parseColors(text())
    onLoadFailed: root.palette = null
    onFileChanged: reload()
  }

  Process {
    id: forecastProcess
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root._forecastOut = text
    }
    onExited: function(code) {
      if (code !== 0) root.fail("Offline — showing the last forecast")
      else root.applyForecast(root._forecastOut)
    }
  }

  // Air quality is a nicety: it never blocks the forecast and never retries.
  Process {
    id: airProcess
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root._airOut = text
    }
    onExited: function(code) { if (code === 0) root.air = Model.parseAir(root._airOut) }
  }

  Process {
    id: ipProcess
    command: Model.curl("https://ipinfo.io/json", 6)
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root._ipOut = text
    }
    onExited: function(code) {
      var loc = code === 0 ? Model.parseIpInfo(root._ipOut) : null
      if (loc) root.ipLocation = loc
      else if (!root.location) root.fail("Can't tell where you are — set a location")
    }
  }

  Process {
    id: nameLookup
    property string out: ""
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: nameLookup.out = text
    }
    onExited: function(code) {
      var rows = code === 0 ? Model.parseGeocodingResults(nameLookup.out) : []
      if (rows.length > 0) root.namedLocation = { name: root.configured.name, latitude: rows[0].latitude, longitude: rows[0].longitude, country: rows[0].country }
      else root.fail("Couldn't find " + root.configured.name)
    }
  }

  Process {
    id: saveLocationProcess
    onExited: locationFile.reload()
  }

  Timer {
    id: retryTimer
    repeat: false
    onTriggered: root.fetch()
  }

  Timer {
    interval: root.refreshMinutes * 60000
    running: root.active
    repeat: true
    onTriggered: root.fetch()
  }

  // On the minute. A gap of more than a few minutes between ticks means the
  // machine slept, and the forecast it is holding is from before — so fetch.
  Timer {
    running: root.active
    interval: 60000 - Date.now() % 60000
    onTriggered: {
      var now = Date.now()
      var slept = now - root.nowMs > 5 * 60000
      root.nowMs = now
      interval = 60000 - now % 60000
      restart()
      if (slept) root.refresh()
      else if (root.forecast && now - root.forecast.fetchedAt > root.refreshMinutes * 60000 * 2) root.stale = true
      root.maybeAnnounce()
    }
  }
}
