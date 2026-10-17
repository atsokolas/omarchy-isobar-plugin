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
  readonly property string stateDir: home + "/.local/state/omarchy/isobar"
  readonly property string statePath: stateDir + "/state.json"
  readonly property string alertsCachePath: cacheDir + "/alerts.json"

  // ---- Settings ------------------------------------------------------------
  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  readonly property string unit: String(setting("unit", "auto"))
  readonly property bool showHint: Model.boolSetting(setting("showHint", true), true)
  readonly property bool notify: Model.boolSetting(setting("notify", false), false)
  readonly property bool animate: Model.boolSetting(setting("animate", true), true)
  readonly property bool openHours: Model.boolSetting(setting("openHours", false), false)
  readonly property bool alertsOn: Model.boolSetting(setting("alerts", true), true)
  readonly property bool firsts: Model.boolSetting(setting("firsts", true), true)
  readonly property bool notes: Model.boolSetting(setting("notes", true), true)
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
  // Home, seen through the same lens the panel uses for every place.
  readonly property WeatherView homeView: WeatherView {
    forecast: root.forecast
    air: root.air
    alerts: root.alertsFor("")
    imperial: root.imperial
    use24: root.use24
    nowMs: root.nowMs
  }

  readonly property real localNow: homeView.localNow
  readonly property var current: homeView.current
  readonly property var outlook: homeView.outlook
  readonly property var todayData: homeView.todayData
  readonly property var yesterdayData: homeView.yesterdayData
  readonly property var weekData: homeView.weekData
  readonly property string sentence: homeView.sentence
  readonly property string kind: homeView.kind
  readonly property bool night: homeView.night
  readonly property int strength: homeView.strength
  readonly property var homeAlerts: homeView.activeAlerts
  readonly property real golden: homeView.golden
  readonly property string fullMoon: homeView.fullMoon
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

  // ---- Places --------------------------------------------------------------
  // Other cities, kept in the widget's shell.json entry. Each gets the same
  // full forecast as home, fetched one at a time behind it and cached.
  readonly property var places: Model.normalizePlaces(setting("places", []))
  // The ones you asked to see on the bar, after home.
  readonly property var barPlaces: places.filter(function(p) { return p.onBar }).slice(0, Model.MAX_BAR_PLACES)
  property var placeForecasts: ({})
  property var _placeQueue: []
  readonly property string placesCachePath: cacheDir + "/places.json"
  readonly property string fetchingPlace: placeProcess.running ? placeProcess.key : ""

  function placeFor(key) {
    for (var i = 0; i < places.length; i++) if (places[i].key === key) return places[i]
    return null
  }

  function fetchPlaces(force) {
    var queue = _placeQueue.slice()
    for (var i = 0; i < places.length; i++) {
      var p = places[i]
      var have = placeForecasts[p.key]
      var old = !have || Date.now() - have.fetchedAt > refreshMinutes * 60000
      if ((force || old) && queue.indexOf(p.key) < 0) queue.push(p.key)
    }
    _placeQueue = queue
    pumpPlaces()
  }

  function fetchPlace(key) {
    if (_placeQueue.indexOf(key) < 0) _placeQueue = [key].concat(_placeQueue)
    pumpPlaces()
  }

  function pumpPlaces() {
    if (!active || placeProcess.running) return
    while (_placeQueue.length > 0 && !placeFor(_placeQueue[0])) _placeQueue = _placeQueue.slice(1)
    if (_placeQueue.length === 0) return
    var p = placeFor(_placeQueue[0])
    placeProcess.key = p.key
    placeProcess.out = ""
    placeProcess.command = Model.curl(Model.forecastQuery(p.latitude, p.longitude), 10, Model.MAX_BYTES.forecast)
    placeProcess.running = true
  }

  function applyPlace(key, raw, ok) {
    _placeQueue = _placeQueue.filter(function(k) { return k !== key })
    var parsed = ok ? Model.parseForecast(raw, Date.now()) : null
    if (parsed) {
      var next = {}
      for (var k in placeForecasts) next[k] = placeForecasts[k]
      next[key] = parsed
      placeForecasts = next
      _placeRaw[key] = { fetchedAt: parsed.fetchedAt, raw: raw }
      writePlacesCache()
      fetchAlerts(key)
      checkPlaceNote(key)
    }
    Qt.callLater(pumpPlaces)
  }

  property var _placeRaw: ({})

  function writePlacesCache() {
    var entries = {}
    for (var i = 0; i < places.length; i++) {
      var e = _placeRaw[places[i].key]
      if (e) entries[places[i].key] = e
    }
    placesCache.setText(JSON.stringify({ version: 1, entries: entries }) + "\n")
  }

  function loadPlacesCache(text) {
    try {
      var data = JSON.parse(String(text || ""))
      if (!data || data.version !== 1 || !data.entries) return
      var next = {}
      for (var k in placeForecasts) next[k] = placeForecasts[k]
      for (var key in data.entries) {
        var e = data.entries[key]
        if (next[key] && next[key].fetchedAt >= e.fetchedAt) continue
        var parsed = Model.parseForecast(e.raw, e.fetchedAt)
        if (!parsed) continue
        next[key] = parsed
        _placeRaw[key] = e
      }
      placeForecasts = next
    } catch (err) {}
  }

  onPlacesChanged: Qt.callLater(function() { root.fetchPlaces(false) })

  // ---- Fetching ------------------------------------------------------------
  property string _forecastOut: ""
  property string _airOut: ""
  property string _ipOut: ""
  property string _fetchingKey: ""

  function refresh() {
    if (!active) return
    failures = 0
    fetch()
    fetchPlaces(true)
  }

  function fetch() {
    if (!active) return
    if (!location) {
      // A name with no coordinates is looked up; nothing at all, the network.
      if (Model.trim(configured.name) !== "") lookUpName()
      else if (!ipProcess.running) ipProcess.running = true
      return
    }
    if (forecastProcess.running) return
    loading = true
    _fetchingKey = locationKey
    _forecastOut = ""
    forecastProcess.command = Model.curl(Model.forecastQuery(location.latitude, location.longitude), 10, Model.MAX_BYTES.forecast)
    forecastProcess.running = true
    if (!airProcess.running) {
      _airOut = ""
      airProcess.command = Model.curl(Model.airQuery(location.latitude, location.longitude), 8, Model.MAX_BYTES.air)
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
    fetchAlerts("")
    checkFirsts()
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

  function lookUpName() {
    if (!active || nameLookup.running || Model.trim(configured.name) === "") return
    nameLookup.out = ""
    nameLookup.command = Model.curl(Model.geocodeQuery(configured.name), 6, Model.MAX_BYTES.geocode)
    nameLookup.running = true
  }

  // A panel's fallback engine stays quiet until it is the only one.
  onActiveChanged: if (active) Qt.callLater(fetch)

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

  // ---- Alerts --------------------------------------------------------------
  // NWS alerts by place key ("" is home), each { fetchedAt, alerts }.
  property var alertsByKey: ({})
  property var _alertQueue: []

  // Home's entry remembers where home was, so a move doesn't carry the old
  // place's warnings along with it.
  function alertsFor(key) {
    if (!alertsOn) return []
    var e = alertsByKey[key || ""]
    if (!e) return []
    if (!key && e.at !== locationKey) return []
    return e.alerts
  }

  function coordsFor(key) {
    if (!key) return location
    return placeFor(key)
  }

  function fetchAlerts(key) {
    if (!alertsOn) return
    var where = coordsFor(key)
    if (!where || !Model.nwsCovers(where.latitude, where.longitude)) return
    var have = alertsByKey[key || ""]
    if (have && (key || have.at === locationKey) && Date.now() - have.fetchedAt < 5 * 60000) return
    if (_alertQueue.indexOf(key || "") < 0) _alertQueue = _alertQueue.concat([key || ""])
    pumpAlerts()
  }

  function pumpAlerts() {
    if (!active || alertProcess.running || _alertQueue.length === 0) return
    var key = _alertQueue[0]
    _alertQueue = _alertQueue.slice(1)
    var where = coordsFor(key)
    if (!where) { Qt.callLater(pumpAlerts); return }
    alertProcess.key = key
    alertProcess.at = key ? key : locationKey
    alertProcess.out = ""
    alertProcess.command = Model.alertsCommand(where.latitude, where.longitude)
    alertProcess.running = true
  }

  function applyAlerts(key, at, raw, ok) {
    var list = ok ? Model.parseAlerts(raw, Date.now()) : null
    // Home moved while this was in flight: it answers for somewhere else.
    if (list && !key && at !== locationKey) list = null
    if (list) {
      var next = {}
      for (var k in alertsByKey) next[k] = alertsByKey[k]
      next[key] = { fetchedAt: Date.now(), at: at, alerts: list }
      alertsByKey = next
      alertsCache.setText(JSON.stringify({ version: 1, entries: next }) + "\n")
      if (key === "") announceAlerts(list)
      else checkPlaceNote(key)
    }
    Qt.callLater(pumpAlerts)
  }

  function loadAlertsCache(text) {
    try {
      var data = JSON.parse(String(text || ""))
      if (!data || data.version !== 1 || !data.entries) return
      var next = {}
      for (var k in data.entries) next[k] = alertsByKey[k] || data.entries[k]
      alertsByKey = next
    } catch (e) {}
  }

  // ---- Remembered: firsts seen, notes and alerts already mentioned --------
  property var memory: Model.pruneState(null, 0)
  property bool memoryLoaded: false

  function remember(next) {
    var pruned = Model.pruneState(next, Date.now())
    var text = JSON.stringify(pruned)
    if (text === JSON.stringify(memory)) return
    memory = pruned
    stateFile.setText(text + "\n")
  }

  function announceAlerts(list) {
    if (!memoryLoaded || !alertsOn) return
    var next = { seen: memory.seen, notes: memory.notes, alerts: {} }
    for (var k in memory.alerts) next.alerts[k] = memory.alerts[k]
    // Updates to an alert already mentioned are remembered, not announced.
    var live = Model.activeAlerts(list, Date.now())
    var fresh = Model.freshAlerts(list, next.alerts, Date.now())
    var known = live.filter(function(a) { return fresh.indexOf(a) < 0 && !next.alerts[a.id] })
    for (var j = 0; j < known.length; j++) next.alerts[known[j].id] = Date.now()
    for (var i = 0; i < fresh.length; i++) {
      var a = fresh[i]
      next.alerts[a.id] = Date.now()
      var urgent = a.severity === "Extreme" || a.severity === "Severe"
      Quickshell.execDetached(Model.toastCommand(a.event, a.headline || placeName, urgent ? "critical" : "normal"))
    }
    remember(next)
  }

  function checkFirsts() {
    if (!memoryLoaded || !forecast) return
    var out = Model.seasonFirsts(forecast, localNow, memory, imperial, placeName, use24)
    remember({ seen: out.seen, notes: memory.notes, alerts: memory.alerts })
    if (!firsts) return
    for (var i = 0; i < out.events.length; i++)
      Quickshell.execDetached(Model.toastCommand(out.events[i].title, out.events[i].body))
  }

  // What's notable at a saved place right now, for the Places page.
  function noteFor(key) {
    var p = placeFor(key)
    var fc = placeForecasts[key]
    if (!p || !fc) return null
    return Model.placeNote(fc, Model.nowLocal(nowMs, fc.offset), imperial, p.name, alertsFor(key), nowMs)
  }

  function checkPlaceNote(key) {
    if (!memoryLoaded || !notes) return
    var fc = placeForecasts[key]
    var note = noteFor(key)
    if (!note || !fc) return
    var id = Model.noteKey(key, note, Model.nowLocal(nowMs, fc.offset))
    if (memory.notes[id]) return
    var next = { seen: memory.seen, notes: {}, alerts: memory.alerts }
    for (var k in memory.notes) next.notes[k] = memory.notes[k]
    next.notes[id] = Date.now()
    remember(next)
    var cur = fc.current
    Quickshell.execDetached(Model.toastCommand(note.text, cur ? Model.tempText(cur.temp, imperial) + " · " + Model.conditionLabel(cur.code, cur.isDay) : ""))
  }

  function openRadar(place) {
    var where = place || location
    var cmd = where ? Model.radarCommand(where.latitude, where.longitude) : null
    if (cmd) Quickshell.execDetached(cmd)
  }

  function copySummary(place) {
    var fc = place ? placeForecasts[place.key] : forecast
    var lms = fc ? Model.nowLocal(nowMs, fc.offset) : localNow
    var text = Model.copyPayload(fc, lms, imperial, use24, place ? place.name : placeName)
    if (text) Quickshell.execDetached(Model.copyCommand(text))
  }

  Component.onCompleted: {
    Quickshell.execDetached(["mkdir", "-p", cacheDir, stateDir])
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
        if (!root.namedLocation || root.namedLocation.name !== root.configured.name) root.lookUpName()
      } else if (root.active && root.automatic && !root.ipLocation && !ipProcess.running) {
        ipProcess.running = true
      }
    }
    onLoadFailed: {
      root.configured = Model.parseLocationFile("")
      if (root.active && !root.ipLocation && !ipProcess.running) ipProcess.running = true
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
    command: Model.curl(Model.IP_URL, 6, Model.MAX_BYTES.ip)
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

  FileView {
    id: placesCache
    path: root.placesCachePath
    atomicWrites: true
    printErrors: false
    onLoaded: root.loadPlacesCache(text())
  }

  Process {
    id: placeProcess
    property string key: ""
    property string out: ""
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: placeProcess.out = text
    }
    onExited: function(code) { root.applyPlace(placeProcess.key, placeProcess.out, code === 0) }
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

  Process {
    id: alertProcess
    property string key: ""
    property string at: ""
    property string out: ""
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: alertProcess.out = text
    }
    onExited: function(code) { root.applyAlerts(alertProcess.key, alertProcess.at, alertProcess.out, code === 0) }
  }

  FileView {
    id: alertsCache
    path: root.alertsCachePath
    atomicWrites: true
    printErrors: false
    onLoaded: root.loadAlertsCache(text())
  }

  FileView {
    id: stateFile
    path: root.statePath
    atomicWrites: true
    printErrors: false
    onLoaded: {
      root.memory = Model.parseState(text())
      root.memoryLoaded = true
    }
    onLoadFailed: root.memoryLoaded = true
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
    onTriggered: { root.fetch(); root.fetchPlaces(false) }
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
