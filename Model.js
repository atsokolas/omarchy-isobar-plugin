// Isobar — the pure half. Everything here is plain functions over plain data,
// so the QML stays thin and `node --test` can hold the logic to account.
//
// Times: Open-Meteo answers in the location's own wall-clock time (we ask for
// timezone=auto), as strings with no offset. They are read as if they were
// UTC — `localMs` — and compared against `nowLocal(offset)`, the present moment
// shifted the same way. Hours of the day then come straight off getUTCHours(),
// and nothing depends on the timezone of the machine looking at the forecast.

var APP_NAME = "Isobar"

var FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
var AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
var GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
var IP_URL = "https://ipinfo.io/json"

var CURRENT_FIELDS = [
  "temperature_2m", "apparent_temperature", "relative_humidity_2m", "dew_point_2m",
  "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "weather_code", "is_day",
  "precipitation", "cloud_cover", "pressure_msl", "uv_index"
]
var HOURLY_FIELDS = [
  "temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation",
  "weather_code", "is_day", "pressure_msl", "wind_speed_10m", "uv_index"
]
var DAILY_FIELDS = [
  "weather_code", "temperature_2m_max", "temperature_2m_min", "sunrise", "sunset",
  "daylight_duration", "precipitation_probability_max", "precipitation_sum", "uv_index_max"
]

var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
var WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

var HOUR_MS = 3600000
var DAY_MS = 86400000

// ---------------------------------------------------------------------------
// Small things

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function num(v) {
  if (v === undefined || v === null || v === "") return NaN
  var n = typeof v === "number" ? v : parseFloat(String(v))
  return isFinite(n) ? n : NaN
}

function trim(s) { return String(s === undefined || s === null ? "" : s).replace(/^\s+|\s+$/g, "") }

function boolSetting(value, fallback) {
  if (value === true || value === false) return value
  var s = trim(value).toLowerCase()
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true
  if (s === "false" || s === "0" || s === "no" || s === "off") return false
  return fallback
}

function intSetting(value, fallback, lo, hi) {
  var n = parseInt(String(value), 10)
  if (isNaN(n)) return fallback
  return clamp(n, lo, hi)
}

function pad2(n) { return (n < 10 ? "0" : "") + n }

// ---------------------------------------------------------------------------
// Location

// ~/.local/state/omarchy/settings/weather.json, owned by
// omarchy-weather-location and shared with the stock weather widget, so a
// location set in either one is honoured by both.
function parseLocationFile(raw) {
  var unset = { name: "", latitude: NaN, longitude: NaN }
  try {
    var data = JSON.parse(String(raw || ""))
    if (!data || typeof data !== "object") return unset
    return {
      name: typeof data.name === "string" ? trim(data.name) : "",
      latitude: num(data.latitude),
      longitude: num(data.longitude)
    }
  } catch (e) {
    return unset
  }
}

function hasCoordinates(loc) {
  return !!loc && !isNaN(num(loc.latitude)) && !isNaN(num(loc.longitude))
}

function sameLocation(a, b) {
  if (!hasCoordinates(a) || !hasCoordinates(b)) return false
  return Math.abs(num(a.latitude) - num(b.latitude)) < 0.05 && Math.abs(num(a.longitude) - num(b.longitude)) < 0.05
}

function parseIpInfo(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    var parts = String(data.loc || "").split(",")
    var lat = num(parts[0]), lon = num(parts[1])
    if (isNaN(lat) || isNaN(lon)) return null
    return {
      name: trim(data.city) || trim(data.region) || "Here",
      region: trim(data.region),
      country: trim(data.country).toUpperCase(),
      latitude: lat,
      longitude: lon
    }
  } catch (e) {
    return null
  }
}

function parseGeocodingResults(raw) {
  try {
    var data = JSON.parse(String(raw || "{}"))
    var results = data.results || []
    var out = []
    for (var i = 0; i < results.length; i++) {
      var r = results[i]
      if (!r || !r.name || isNaN(num(r.latitude)) || isNaN(num(r.longitude))) continue
      out.push({
        name: String(r.name),
        description: [r.admin1, r.country].filter(function(p) { return !!p }).join(", "),
        country: trim(r.country_code).toUpperCase(),
        latitude: num(r.latitude),
        longitude: num(r.longitude)
      })
    }
    return out
  } catch (e) {
    return []
  }
}

// ---------------------------------------------------------------------------
// Units. Fetched metric, converted here, so flipping units is instant.

function shouldUseImperial(unit, localeName, country) {
  var u = trim(unit).toLowerCase()
  if (u === "imperial" || u === "f" || u === "fahrenheit") return true
  if (u === "metric" || u === "c" || u === "celsius") return false
  var loc = String(localeName || "").replace(".", "_")
  if (/^en[_-](US|LR)($|[_.-])/.test(loc) || /^my($|[_.-])/.test(loc)) return true
  var c = trim(country).toUpperCase()
  return c === "US" || c === "LR" || c === "MM"
}

function temp(c, imperial) {
  var n = num(c)
  if (isNaN(n)) return NaN
  return Math.round(imperial ? n * 9 / 5 + 32 : n)
}

// A rounded −0 reads as a typo. Minus is U+2212, which sits on the same
// baseline as the digits in every Nerd Font.
function signed(n) {
  if (isNaN(n)) return "—"
  if (n === 0) return "0"
  return n < 0 ? "−" + Math.abs(n) : String(n)
}

function tempText(c, imperial) {
  var t = temp(c, imperial)
  return isNaN(t) ? "—" : signed(t) + "°"
}

// A temperature difference: no +32 offset for Fahrenheit.
function deltaDegrees(dc, imperial) {
  var n = num(dc)
  if (isNaN(n)) return NaN
  return Math.round(imperial ? n * 9 / 5 : n)
}

function speed(kmh, imperial) {
  var n = num(kmh)
  if (isNaN(n)) return NaN
  return Math.round(imperial ? n * 0.621371 : n)
}

function speedUnit(imperial) { return imperial ? "mph" : "km/h" }

function speedText(kmh, imperial) {
  var s = speed(kmh, imperial)
  return isNaN(s) ? "—" : s + " " + speedUnit(imperial)
}

function precipText(mm, imperial) {
  var n = num(mm)
  if (isNaN(n)) return "—"
  if (imperial) {
    var inch = n / 25.4
    return (inch < 0.1 ? inch.toFixed(2) : inch.toFixed(1)) + " in"
  }
  return (n < 10 ? n.toFixed(1) : String(Math.round(n))) + " mm"
}

function pressureText(hpa, imperial) {
  var n = num(hpa)
  if (isNaN(n)) return "—"
  return imperial ? (n * 0.0295300).toFixed(2) + " inHg" : Math.round(n) + " hPa"
}

// ---------------------------------------------------------------------------
// Conditions, from WMO weather codes.

// `kind` picks the drawing; `wet` is anything falling from the sky;
// `strength` 1–3 sets how much of it the icon draws.
function condition(code) {
  var c = parseInt(String(code), 10)
  if (isNaN(c)) return { kind: "cloudy", label: "—", wet: false, strength: 1, noun: "" }
  switch (c) {
    case 0: return { kind: "clear", label: "Clear", wet: false, strength: 0, noun: "" }
    case 1: return { kind: "partly", label: "Mostly clear", wet: false, strength: 0, noun: "" }
    case 2: return { kind: "partly", label: "Partly cloudy", wet: false, strength: 0, noun: "" }
    case 3: return { kind: "cloudy", label: "Overcast", wet: false, strength: 0, noun: "" }
    case 45: return { kind: "fog", label: "Fog", wet: false, strength: 0, noun: "fog" }
    case 48: return { kind: "fog", label: "Freezing fog", wet: false, strength: 0, noun: "fog" }
    case 51: return { kind: "drizzle", label: "Light drizzle", wet: true, strength: 1, noun: "drizzle" }
    case 53: return { kind: "drizzle", label: "Drizzle", wet: true, strength: 2, noun: "drizzle" }
    case 55: return { kind: "drizzle", label: "Heavy drizzle", wet: true, strength: 3, noun: "drizzle" }
    case 56: case 57: return { kind: "sleet", label: "Freezing drizzle", wet: true, strength: 1, noun: "freezing drizzle" }
    case 61: return { kind: "rain", label: "Light rain", wet: true, strength: 1, noun: "rain" }
    case 63: return { kind: "rain", label: "Rain", wet: true, strength: 2, noun: "rain" }
    case 65: return { kind: "rain", label: "Heavy rain", wet: true, strength: 3, noun: "heavy rain" }
    case 66: case 67: return { kind: "sleet", label: "Freezing rain", wet: true, strength: 2, noun: "freezing rain" }
    case 71: return { kind: "snow", label: "Light snow", wet: true, strength: 1, noun: "snow" }
    case 73: return { kind: "snow", label: "Snow", wet: true, strength: 2, noun: "snow" }
    case 75: return { kind: "snow", label: "Heavy snow", wet: true, strength: 3, noun: "heavy snow" }
    case 77: return { kind: "snow", label: "Snow grains", wet: true, strength: 1, noun: "snow" }
    case 80: return { kind: "rain", label: "Light showers", wet: true, strength: 1, noun: "showers" }
    case 81: return { kind: "rain", label: "Showers", wet: true, strength: 2, noun: "showers" }
    case 82: return { kind: "rain", label: "Violent showers", wet: true, strength: 3, noun: "heavy showers" }
    case 85: return { kind: "snow", label: "Snow showers", wet: true, strength: 1, noun: "snow showers" }
    case 86: return { kind: "snow", label: "Heavy snow showers", wet: true, strength: 3, noun: "heavy snow" }
    case 95: return { kind: "storm", label: "Thunderstorm", wet: true, strength: 2, noun: "thunderstorms" }
    case 96: case 99: return { kind: "storm", label: "Thunderstorm, hail", wet: true, strength: 3, noun: "thunderstorms" }
  }
  return { kind: "cloudy", label: "Cloudy", wet: false, strength: 0, noun: "" }
}

// "Clear" in the day is "Sunny"; at night the sky is simply clear.
function conditionLabel(code, isDay) {
  var cond = condition(code)
  if (cond.kind === "clear" && Number(isDay) !== 0) return "Sunny"
  return cond.label
}

// The drawing for the bar and the panel: kind plus day/night.
function iconKind(code) { return condition(code).kind }

// ---------------------------------------------------------------------------
// Time

// "2026-10-15T17:15" → ms, read as UTC (see the note at the top).
function localMs(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || ""))
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0)
}

function nowLocal(nowMs, offsetSeconds) { return nowMs + (num(offsetSeconds) || 0) * 1000 }

function dateKey(lms) {
  var d = new Date(lms)
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate())
}

function hourText(lms, use24) {
  var h = new Date(lms).getUTCHours()
  if (use24) return pad2(h)
  if (h === 0) return "12am"
  if (h === 12) return "noon"
  return (h % 12) + (h < 12 ? "am" : "pm")
}

// A spoken hour for sentences: "3 pm", "noon", "midnight", "15:00".
function spokenHour(lms, use24) {
  var h = new Date(lms).getUTCHours()
  if (use24) return pad2(h) + ":00"
  if (h === 0) return "midnight"
  if (h === 12) return "noon"
  return (h % 12) + " " + (h < 12 ? "am" : "pm")
}

function clockText(lms, use24) {
  var d = new Date(lms)
  var h = d.getUTCHours(), m = d.getUTCMinutes()
  if (use24) return pad2(h) + ":" + pad2(m)
  return ((h % 12) || 12) + ":" + pad2(m) + " " + (h < 12 ? "am" : "pm")
}

function weekday(lms, short) {
  var d = new Date(lms).getUTCDay()
  return short ? WEEKDAYS_SHORT[d] : WEEKDAYS[d]
}

function durationText(seconds) {
  var s = Math.max(0, Math.round(num(seconds) || 0))
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h + "h " + pad2(m) + "m"
}

// Daylight gained or lost since yesterday — the small fact that tells you
// which way the year is turning.
function daylightDeltaText(todaySeconds, yesterdaySeconds) {
  var t = num(todaySeconds), y = num(yesterdaySeconds)
  if (isNaN(t) || isNaN(y)) return ""
  var d = Math.round(t - y)
  if (Math.abs(d) < 5) return "same as yesterday"
  var a = Math.abs(d), m = Math.floor(a / 60), s = a % 60
  return (d > 0 ? "+" : "−") + (m > 0 ? m + "m " + pad2(s) + "s" : s + "s")
}

function ageText(fetchedAt, nowMs) {
  var f = num(fetchedAt)
  if (isNaN(f) || f <= 0) return ""
  var mins = Math.floor((nowMs - f) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return mins + " min ago"
  var hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs + " h ago"
  var days = Math.floor(hrs / 24)
  return days === 1 ? "yesterday" : days + " days ago"
}

// ---------------------------------------------------------------------------
// The forecast, normalised.

function forecastQuery(lat, lon) {
  return FORECAST_URL
    + "?latitude=" + encodeURIComponent(String(lat))
    + "&longitude=" + encodeURIComponent(String(lon))
    + "&current=" + CURRENT_FIELDS.join(",")
    + "&hourly=" + HOURLY_FIELDS.join(",")
    + "&daily=" + DAILY_FIELDS.join(",")
    + "&minutely_15=precipitation"
    + "&forecast_minutely_15=8"
    + "&past_days=1&forecast_days=8"
    + "&timezone=auto"
}

function airQuery(lat, lon) {
  return AIR_URL
    + "?latitude=" + encodeURIComponent(String(lat))
    + "&longitude=" + encodeURIComponent(String(lon))
    + "&current=us_aqi,european_aqi"
}

function geocodeQuery(text) {
  return GEOCODE_URL + "?name=" + encodeURIComponent(trim(text)) + "&count=6&language=en&format=json"
}

function curl(url, seconds) {
  return ["curl", "-fsS", "--compressed", "--max-time", String(seconds || 8), "-A", "omarchy-isobar/1.0", url]
}

function column(block, key, i) {
  var arr = block && block[key]
  return arr && i < arr.length ? arr[i] : null
}

function parseForecast(raw, fetchedAt) {
  var data
  try { data = JSON.parse(String(raw || "")) } catch (e) { return null }
  if (!data || !data.current || !data.hourly || !data.daily || !data.hourly.time) return null

  var c = data.current
  var current = {
    t: localMs(c.time),
    temp: num(c.temperature_2m),
    feels: num(c.apparent_temperature),
    humidity: num(c.relative_humidity_2m),
    dew: num(c.dew_point_2m),
    wind: num(c.wind_speed_10m),
    windDir: num(c.wind_direction_10m),
    gusts: num(c.wind_gusts_10m),
    code: c.weather_code,
    isDay: Number(c.is_day) !== 0,
    precip: num(c.precipitation),
    cloud: num(c.cloud_cover),
    pressure: num(c.pressure_msl),
    uv: num(c.uv_index)
  }
  if (isNaN(current.temp)) return null

  var h = data.hourly
  var hourly = []
  for (var i = 0; i < h.time.length; i++) {
    hourly.push({
      t: localMs(h.time[i]),
      temp: num(column(h, "temperature_2m", i)),
      feels: num(column(h, "apparent_temperature", i)),
      pop: num(column(h, "precipitation_probability", i)),
      precip: num(column(h, "precipitation", i)),
      code: column(h, "weather_code", i),
      isDay: Number(column(h, "is_day", i)) !== 0,
      pressure: num(column(h, "pressure_msl", i)),
      wind: num(column(h, "wind_speed_10m", i)),
      uv: num(column(h, "uv_index", i))
    })
  }

  var d = data.daily
  var daily = []
  for (var j = 0; d.time && j < d.time.length; j++) {
    daily.push({
      date: String(d.time[j]),
      t: localMs(d.time[j]),
      code: column(d, "weather_code", j),
      max: num(column(d, "temperature_2m_max", j)),
      min: num(column(d, "temperature_2m_min", j)),
      sunrise: localMs(column(d, "sunrise", j)),
      sunset: localMs(column(d, "sunset", j)),
      daylight: num(column(d, "daylight_duration", j)),
      popMax: num(column(d, "precipitation_probability_max", j)),
      precipSum: num(column(d, "precipitation_sum", j)),
      uvMax: num(column(d, "uv_index_max", j))
    })
  }

  var minutely = []
  var m = data.minutely_15
  for (var k = 0; m && m.time && k < m.time.length; k++)
    minutely.push({ t: localMs(m.time[k]), precip: num(column(m, "precipitation", k)) })

  return {
    fetchedAt: num(fetchedAt) || 0,
    latitude: num(data.latitude),
    longitude: num(data.longitude),
    offset: num(data.utc_offset_seconds) || 0,
    timezone: String(data.timezone || ""),
    tzAbbr: String(data.timezone_abbreviation || ""),
    current: current,
    hourly: hourly,
    daily: daily,
    minutely: minutely
  }
}

function parseAir(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    var c = data && data.current
    if (!c) return null
    var us = num(c.us_aqi), eu = num(c.european_aqi)
    if (isNaN(us) && isNaN(eu)) return null
    return { us: us, eu: eu }
  } catch (e) {
    return null
  }
}

// Index of the hour containing `lms`, or -1.
function hourIndex(fc, lms) {
  if (!fc) return -1
  var hours = fc.hourly
  for (var i = 0; i < hours.length; i++)
    if (lms >= hours[i].t && lms < hours[i].t + HOUR_MS) return i
  return -1
}

function dayIndex(fc, key) {
  if (!fc) return -1
  for (var i = 0; i < fc.daily.length; i++) if (fc.daily[i].date === key) return i
  return -1
}

function today(fc, lms) { var i = dayIndex(fc, dateKey(lms)); return i >= 0 ? fc.daily[i] : null }

function yesterday(fc, lms) { var i = dayIndex(fc, dateKey(lms - DAY_MS)); return i >= 0 ? fc.daily[i] : null }

// The next `count` hours, starting with the one we are in.
function upcomingHours(fc, lms, count) {
  var start = hourIndex(fc, lms)
  if (start < 0) return []
  return fc.hourly.slice(start, start + (count || 24))
}

// All 24 hours of the day with date `key`.
function hoursOfDay(fc, key) {
  if (!fc) return []
  return fc.hourly.filter(function(h) { return dateKey(h.t) === key })
}

// Today and the six days after — yesterday is fetched only to compare with.
function week(fc, lms) {
  if (!fc) return []
  var start = dayIndex(fc, dateKey(lms))
  if (start < 0) return []
  return fc.daily.slice(start, start + 7)
}

// ---------------------------------------------------------------------------
// Precipitation: the one thing worth interrupting someone for.

function isWetHour(h) {
  if (!h) return false
  var cond = condition(h.code)
  return cond.wet && (isNaN(h.pop) || h.pop >= 40)
}

// When the next rain (or snow) arrives, or how long the current spell lasts.
// Fifteen-minute data for the next two hours, hourly after that.
//   { state: "now"|"soon"|"later"|"none", startMs, endMs, minutes, noun, kind }
function precipOutlook(fc, lms) {
  var none = { state: "none", startMs: NaN, endMs: NaN, minutes: NaN, noun: "", kind: "" }
  if (!fc) return none
  var cur = condition(fc.current.code)
  var raining = cur.wet && (isNaN(fc.current.precip) || fc.current.precip > 0 || cur.kind === "drizzle")
  var hours = upcomingHours(fc, lms, 18)

  if (raining) {
    var end = NaN
    for (var i = 1; i < hours.length; i++) {
      if (!isWetHour(hours[i])) { end = hours[i].t; break }
    }
    return { state: "now", startMs: lms, endMs: end, minutes: 0, noun: cur.noun, kind: cur.kind }
  }

  var mins = fc.minutely || []
  for (var k = 0; k < mins.length; k++) {
    if (mins[k].t + 15 * 60000 <= lms) continue
    if (mins[k].precip >= 0.1) {
      var nextWet = null
      for (var n = 0; n < hours.length; n++) if (condition(hours[n].code).wet) { nextWet = hours[n]; break }
      var c2 = condition(nextWet ? nextWet.code : 61)
      var start = Math.max(lms, mins[k].t)
      return { state: "soon", startMs: start, endMs: NaN, minutes: Math.max(0, Math.round((start - lms) / 60000)), noun: c2.noun || "rain", kind: c2.kind }
    }
  }

  for (var j = 1; j < hours.length; j++) {
    if (isWetHour(hours[j])) {
      var c3 = condition(hours[j].code)
      var minsAway = Math.round((hours[j].t - lms) / 60000)
      return { state: minsAway <= 90 ? "soon" : "later", startMs: hours[j].t, endMs: NaN, minutes: minsAway, noun: c3.noun, kind: c3.kind }
    }
  }
  return none
}

function capital(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1) }

// The short hint the bar can carry beside the temperature, or "".
function barHint(outlook, use24) {
  if (!outlook || outlook.state === "none") return ""
  var noun = capital(shortNoun(outlook.noun))
  if (outlook.state === "now") return isNaN(outlook.endMs) ? noun : noun + " til " + hourText(outlook.endMs, use24)
  if (outlook.minutes < 10) return noun + " soon"
  if (outlook.minutes < 60) return noun + " in " + Math.max(5, Math.round(outlook.minutes / 5) * 5) + "m"
  return noun + " " + hourText(outlook.startMs, use24)
}

function shortNoun(noun) {
  var n = String(noun || "rain")
  if (n.indexOf("snow") >= 0) return "snow"
  if (n.indexOf("thunder") >= 0) return "storms"
  if (n.indexOf("drizzle") >= 0) return "drizzle"
  if (n.indexOf("shower") >= 0) return "showers"
  return "rain"
}

// ---------------------------------------------------------------------------
// The sentence — what a person would tell you if you asked them.

function partOfDay(lms) {
  var h = new Date(lms).getUTCHours()
  if (h < 5) return "overnight"
  if (h < 12) return "this morning"
  if (h < 17) return "this afternoon"
  if (h < 21) return "this evening"
  return "tonight"
}

function skyPhrase(code, isDay) {
  var k = condition(code).kind
  if (k === "clear") return isDay ? "Sunny" : "Clear"
  if (k === "partly") return condition(code).label
  if (k === "cloudy") return "Cloudy"
  if (k === "fog") return "Foggy"
  return capital(condition(code).noun || "Cloudy")
}

function sameSky(a, b) {
  var ka = condition(a).kind, kb = condition(b).kind
  if (ka === kb) return true
  // Mostly clear and clear are the same sky to anyone looking up.
  return (ka === "clear" && kb === "partly") || (ka === "partly" && kb === "clear")
}

function firstSentence(fc, lms, use24) {
  var outlook = precipOutlook(fc, lms)
  var noun = outlook.noun

  if (outlook.state === "now") {
    if (isNaN(outlook.endMs)) return capital(noun) + " for the rest of the day."
    return capital(noun) + " until about " + spokenHour(outlook.endMs, use24) + "."
  }
  if (outlook.state === "soon") {
    if (outlook.minutes <= 10) return capital(noun) + " starting any minute."
    return capital(noun) + " starting in about " + (Math.round(outlook.minutes / 5) * 5) + " minutes."
  }

  var hours = upcomingHours(fc, lms, 12)
  var now = fc.current
  var sky = skyPhrase(now.code, now.isDay)
  if (outlook.state === "later") {
    var wording = new Date(outlook.startMs).getUTCDate() !== new Date(lms).getUTCDate()
      ? partOfDay(outlook.startMs) === "overnight" ? "overnight" : "tomorrow " + partOfDay(outlook.startMs).replace("this ", "")
      : "around " + spokenHour(outlook.startMs, use24)
    if (wording === "tomorrow tonight") wording = "tomorrow night"
    return sky + " now, " + noun + " " + wording + "."
  }

  // Dry. Say how long this sky lasts, and what comes after.
  for (var i = 1; i < hours.length; i++) {
    if (!sameSky(now.code, hours[i].code)) {
      var next = skyPhrase(hours[i].code, hours[i].isDay).toLowerCase()
      return sky + " until " + spokenHour(hours[i].t, use24) + ", then " + next + "."
    }
  }
  return sky + " " + (now.isDay ? "for the rest of the day" : "through the night") + "."
}

function secondSentence(fc, lms, imperial) {
  var td = today(fc, lms), yd = yesterday(fc, lms)
  var bits = []
  if (td && yd && !isNaN(td.max) && !isNaN(yd.max)) {
    var diff = deltaDegrees(td.max - yd.max, imperial)
    if (diff >= 2) bits.push(diff + "° warmer than yesterday")
    else if (diff <= -2) bits.push(Math.abs(diff) + "° cooler than yesterday")
    else bits.push("About as warm as yesterday")
  }
  var gusts = fc.current.gusts
  if (!isNaN(gusts) && gusts >= 45) bits.push("gusts to " + speedText(gusts, imperial))
  else if (td && !isNaN(td.uvMax) && td.uvMax >= 6 && fc.current.isDay) bits.push("UV " + uvLabel(td.uvMax).toLowerCase() + " at midday")
  if (bits.length === 0) return ""
  var s = bits.join(", ")
  return capital(s) + "."
}

function sentence(fc, lms, imperial, use24) {
  if (!fc) return ""
  var a = firstSentence(fc, lms, use24)
  var b = secondSentence(fc, lms, imperial)
  return b ? a + " " + b : a
}

// ---------------------------------------------------------------------------
// Readings

function compass(deg) {
  var n = num(deg)
  if (isNaN(n)) return ""
  return COMPASS[Math.round(((n % 360) + 360) % 360 / 22.5) % 16]
}

function windWord(kmh) {
  var n = num(kmh)
  if (isNaN(n)) return ""
  if (n < 2) return "Calm"
  if (n < 12) return "Light air"
  if (n < 20) return "Light breeze"
  if (n < 29) return "Gentle breeze"
  if (n < 39) return "Fresh breeze"
  if (n < 50) return "Strong breeze"
  if (n < 62) return "Near gale"
  if (n < 75) return "Gale"
  return "Storm force"
}

function uvLabel(uv) {
  var n = num(uv)
  if (isNaN(n)) return ""
  if (n < 3) return "Low"
  if (n < 6) return "Moderate"
  if (n < 8) return "High"
  if (n < 11) return "Very high"
  return "Extreme"
}

// US AQI for the places that read it, the European index elsewhere.
function aqiReading(air, imperial) {
  if (!air) return null
  var useUs = imperial ? !isNaN(air.us) : isNaN(air.eu)
  var v = Math.round(useUs ? air.us : air.eu)
  if (isNaN(v)) return null
  var label
  if (useUs) {
    label = v <= 50 ? "Good" : v <= 100 ? "Moderate" : v <= 150 ? "Sensitive groups" : v <= 200 ? "Unhealthy" : v <= 300 ? "Very unhealthy" : "Hazardous"
  } else {
    label = v <= 20 ? "Good" : v <= 40 ? "Fair" : v <= 60 ? "Moderate" : v <= 80 ? "Poor" : v <= 100 ? "Very poor" : "Extremely poor"
  }
  return { value: v, label: label, scale: useUs ? "US AQI" : "EU AQI", level: useUs ? clamp(v / 300, 0, 1) : clamp(v / 100, 0, 1) }
}

// Rising, falling, or steady over the last three hours.
function pressureTrend(fc, lms) {
  var i = hourIndex(fc, lms)
  if (i < 3) return ""
  var now = fc.hourly[i].pressure, before = fc.hourly[i - 3].pressure
  if (isNaN(now) || isNaN(before)) return ""
  var d = now - before
  if (d >= 1) return "Rising"
  if (d <= -1) return "Falling"
  return "Steady"
}

// ---------------------------------------------------------------------------
// Sky: sun and moon

// Fraction of the way from sunrise to sunset; <0 before dawn, >1 after dusk.
function sunProgress(day, lms) {
  if (!day || isNaN(day.sunrise) || isNaN(day.sunset) || day.sunset <= day.sunrise) return NaN
  return (lms - day.sunrise) / (day.sunset - day.sunrise)
}

// Moon age as a fraction of the synodic month: 0 new, 0.5 full.
// Reference new moon 2000-01-06 18:14 UTC; good to well under a day.
function moonPhase(utcMs) {
  var synodic = 29.530588853
  var ref = Date.UTC(2000, 0, 6, 18, 14)
  var days = (utcMs - ref) / DAY_MS
  var p = (days % synodic) / synodic
  return p < 0 ? p + 1 : p
}

function moonIllumination(phase) { return (1 - Math.cos(2 * Math.PI * phase)) / 2 }

function moonName(phase) {
  var p = ((num(phase) % 1) + 1) % 1
  if (p < 0.033 || p > 0.967) return "New moon"
  if (p < 0.216) return "Waxing crescent"
  if (p < 0.283) return "First quarter"
  if (p < 0.466) return "Waxing gibbous"
  if (p < 0.533) return "Full moon"
  if (p < 0.716) return "Waning gibbous"
  if (p < 0.783) return "Last quarter"
  return "Waning crescent"
}

// The lit part of the moon as a closed polyline in a unit circle centred on
// the origin, y down. Waxing moons are lit on the right (northern sky).
function moonPolygon(phase, samples) {
  var n = samples || 24
  var p = ((num(phase) % 1) + 1) % 1
  var waxing = p <= 0.5
  var side = waxing ? 1 : -1
  var k = Math.cos(2 * Math.PI * p)
  var pts = []
  for (var i = 0; i <= n; i++) {
    var a = -Math.PI / 2 + Math.PI * i / n
    pts.push([side * Math.cos(a), Math.sin(a)])
  }
  for (var j = n; j >= 0; j--) {
    var b = -Math.PI / 2 + Math.PI * j / n
    pts.push([side * k * Math.cos(b), Math.sin(b)])
  }
  return pts
}

// ---------------------------------------------------------------------------
// Drawing helpers shared by the icon and the charts.

// The upper intersection of two circles {x, y, r}.
function upperIntersection(a, b) {
  var dx = b.x - a.x, dy = b.y - a.y
  var d = Math.sqrt(dx * dx + dy * dy)
  var l = (a.r * a.r - b.r * b.r + d * d) / (2 * d)
  var h = Math.sqrt(Math.max(0, a.r * a.r - l * l))
  var mx = a.x + l * dx / d, my = a.y + l * dy / d
  var p1 = { x: mx + h * dy / d, y: my - h * dx / d }
  var p2 = { x: mx - h * dy / d, y: my + h * dx / d }
  return p1.y < p2.y ? p1 : p2
}

function normAngle(a, from) {
  while (a < from) a += 2 * Math.PI
  return a
}

// A cloud as three bumps over a flat base, as arcs a Canvas can trace in one
// pass: [{x, y, r, start, end}] in a unit box, plus the base line. Computing
// the joins keeps the outline a single clean stroke at any size.
function cloudArcs(ox, oy, s) {
  var L = { x: ox + 0.27 * s, y: oy + 0.60 * s, r: 0.17 * s }
  var M = { x: ox + 0.52 * s, y: oy + 0.47 * s, r: 0.22 * s }
  var R = { x: ox + 0.77 * s, y: oy + 0.61 * s, r: 0.16 * s }
  var base = oy + 0.77 * s
  var lm = upperIntersection(L, M), mr = upperIntersection(M, R)
  var a0 = Math.PI / 2
  var a1 = normAngle(Math.atan2(lm.y - L.y, lm.x - L.x), a0)
  var b0 = Math.atan2(lm.y - M.y, lm.x - M.x)
  var b1 = normAngle(Math.atan2(mr.y - M.y, mr.x - M.x), b0)
  var c0 = Math.atan2(mr.y - R.y, mr.x - R.x)
  var c1 = normAngle(Math.PI / 2, c0)
  return {
    base: base,
    left: L.x,
    right: R.x,
    arcs: [
      { x: L.x, y: L.y, r: L.r, start: a0, end: a1 },
      { x: M.x, y: M.y, r: M.r, start: b0, end: b1 },
      { x: R.x, y: R.y, r: R.r, start: c0, end: c1 }
    ]
  }
}

// Monotone cubic interpolation (Fritsch–Carlson): a smooth curve through
// every point that never overshoots — the chart can't invent a high that
// isn't in the data. Returns bezier segments [c1x, c1y, c2x, c2y, x, y].
function monotoneSegments(pts) {
  var n = pts.length
  if (n < 2) return []
  var dx = [], slope = [], m = []
  for (var i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0])
    slope.push(dx[i] === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / dx[i])
  }
  m.push(slope[0])
  for (var j = 1; j < n - 1; j++) m.push(slope[j - 1] * slope[j] <= 0 ? 0 : (slope[j - 1] + slope[j]) / 2)
  m.push(slope[n - 2])
  for (var k = 0; k < n - 1; k++) {
    if (slope[k] === 0) { m[k] = 0; m[k + 1] = 0; continue }
    var a = m[k] / slope[k], b = m[k + 1] / slope[k]
    var t = a * a + b * b
    if (t > 9) {
      var tau = 3 / Math.sqrt(t)
      m[k] = tau * a * slope[k]
      m[k + 1] = tau * b * slope[k]
    }
  }
  var segs = []
  for (var s = 0; s < n - 1; s++) {
    var h = dx[s] / 3
    segs.push([pts[s][0] + h, pts[s][1] + m[s] * h, pts[s + 1][0] - h, pts[s + 1][1] - m[s + 1] * h, pts[s + 1][0], pts[s + 1][1]])
  }
  return segs
}

// Rounded range for a chart axis, with a little air above and below.
function niceRange(values, minSpan) {
  var lo = Infinity, hi = -Infinity
  for (var i = 0; i < values.length; i++) {
    var v = num(values[i])
    if (isNaN(v)) continue
    lo = Math.min(lo, v); hi = Math.max(hi, v)
  }
  if (!isFinite(lo)) return { lo: 0, hi: 1 }
  var span = Math.max(hi - lo, minSpan || 4)
  var mid = (hi + lo) / 2
  return { lo: mid - span / 2, hi: mid + span / 2 }
}

// Where a day's low and high sit on the week's shared scale, 0..1.
function rangeSpan(day, lo, hi) {
  var span = hi - lo
  if (!day || !(span > 0)) return { from: 0, to: 1 }
  return { from: clamp((day.min - lo) / span, 0, 1), to: clamp((day.max - lo) / span, 0, 1) }
}

function weekRange(days) {
  var lo = Infinity, hi = -Infinity
  for (var i = 0; i < days.length; i++) {
    if (!isNaN(days[i].min)) lo = Math.min(lo, days[i].min)
    if (!isNaN(days[i].max)) hi = Math.max(hi, days[i].max)
  }
  if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1 }
  if (hi - lo < 4) { var mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2 }
  return { lo: lo, hi: hi }
}

// ---------------------------------------------------------------------------
// Colour, borrowed from the theme.

function parseColors(toml) {
  var out = {}
  var lines = String(toml || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^\s*([a-z_]+)\s*=\s*"([^"]*)"/)
    if (m) out[m[1]] = m[2]
  }
  var hex = /^#[0-9a-fA-F]{6}$/
  if (!hex.test(out.foreground || "") || !hex.test(out.background || "")) return null
  var pick = function(key, fallback) { return hex.test(out[key] || "") ? out[key].toLowerCase() : fallback }
  var fg = out.foreground.toLowerCase()
  var accent = pick("accent", fg)
  return {
    mode: out.mode === "light" ? "light" : "dark",
    foreground: fg,
    background: out.background.toLowerCase(),
    accent: accent,
    blue: pick("blue", accent),
    cyan: pick("cyan", pick("blue", accent)),
    green: pick("green", accent),
    yellow: pick("yellow", accent),
    orange: pick("orange", pick("bright_yellow", pick("yellow", accent))),
    red: pick("red", accent),
    magenta: pick("magenta", pick("bright_magenta", accent))
  }
}

function hexToRgb(hex) {
  var n = parseInt(String(hex).replace("#", ""), 16)
  return [n >> 16 & 255, n >> 8 & 255, n & 255]
}

function rgbToHex(rgb) {
  var s = "#"
  for (var i = 0; i < 3; i++) {
    var v = clamp(Math.round(rgb[i]), 0, 255)
    s += (v < 16 ? "0" : "") + v.toString(16)
  }
  return s
}

function mix(a, b, t) {
  var x = hexToRgb(a), y = hexToRgb(b)
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

// Temperature, in °C, mapped across the theme's own palette: magenta for
// bitter cold, through blue and green, to red for heat. Every theme gets a
// thermometer that looks like it belongs to it.
function tempColor(c, palette) {
  var n = num(c)
  if (!palette || isNaN(n)) return palette ? palette.foreground : "#c0caf5"
  var stops = [
    [-18, palette.magenta], [-4, palette.blue], [6, palette.cyan], [15, palette.green],
    [22, palette.yellow], [28, palette.orange], [34, palette.red]
  ]
  if (n <= stops[0][0]) return stops[0][1]
  for (var i = 1; i < stops.length; i++) {
    if (n <= stops[i][0]) {
      var t = (n - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0])
      return mix(stops[i - 1][1], stops[i][1], t)
    }
  }
  return stops[stops.length - 1][1]
}

// ---------------------------------------------------------------------------
// Outward

function tooltipText(fc, lms, imperial, placeName) {
  if (!fc) return APP_NAME
  var now = fc.current
  var td = today(fc, lms)
  var line = conditionLabel(now.code, now.isDay) + ", " + tempText(now.temp, imperial)
  if (td) line += "  ·  H " + tempText(td.max, imperial) + "  L " + tempText(td.min, imperial)
  return (placeName ? placeName + "\n" : "") + line
}

function copyPayload(fc, lms, imperial, use24, placeName) {
  if (!fc) return ""
  var now = fc.current
  return (placeName ? placeName + ": " : "") + tempText(now.temp, imperial) + ", "
    + conditionLabel(now.code, now.isDay).toLowerCase() + ". " + sentence(fc, lms, imperial, use24)
}

function copyCommand(text) {
  return ["sh", "-c", 'printf %s "$1" | wl-copy', "sh", String(text || "")]
}

function radarCommand(lat, lon) {
  if (isNaN(num(lat)) || isNaN(num(lon))) return null
  var la = num(lat).toFixed(3), lo = num(lon).toFixed(3)
  return ["xdg-open", "https://www.windy.com/?radar," + la + "," + lo + ",8"]
}

function toastCommand(title, body) {
  return ["omarchy-notification-send", "--app-name", APP_NAME, "-u", "low", String(title || APP_NAME), String(body || "")]
}

function saveLocationCommand(loc) {
  if (!loc || !trim(loc.name)) return ["omarchy-weather-location", "--clear"]
  if (hasCoordinates(loc))
    return ["omarchy-weather-location", "--set", trim(loc.name), num(loc.latitude).toFixed(4) + "," + num(loc.longitude).toFixed(4)]
  return ["omarchy-weather-location", "--set", trim(loc.name)]
}

// A key for "this particular spell of rain", so the heads-up fires once.
function rainKey(outlook) {
  if (!outlook || outlook.state === "none" || outlook.state === "now") return ""
  return dateKey(outlook.startMs) + "T" + new Date(outlook.startMs).getUTCHours()
}


// ---------------------------------------------------------------------------
// Places: other cities kept beside home.

var MAX_PLACES = 8
// The bar has room for a few; the rest stay in the panel.
var MAX_BAR_PLACES = 3

function placeKey(p) {
  if (!hasCoordinates(p)) return ""
  return num(p.latitude).toFixed(3) + "," + num(p.longitude).toFixed(3)
}

// The `places` setting, cleaned: named, located, no duplicates, at most eight.
function normalizePlaces(list) {
  var out = [], seen = {}
  if (!list || typeof list.length !== "number") return out
  for (var i = 0; i < list.length && out.length < MAX_PLACES; i++) {
    var p = list[i]
    if (!p || !trim(p.name) || !hasCoordinates(p)) continue
    var key = placeKey(p)
    if (seen[key]) continue
    seen[key] = true
    out.push({ name: trim(p.name), description: trim(p.description), latitude: num(p.latitude), longitude: num(p.longitude), onBar: p.onBar === true, key: key })
  }
  return out
}

// A place as it is stored in shell.json — no derived fields.
function storedPlace(p) {
  var out = { name: trim(p.name), description: trim(p.description), latitude: Math.round(num(p.latitude) * 10000) / 10000, longitude: Math.round(num(p.longitude) * 10000) / 10000 }
  if (p.onBar === true) out.onBar = true
  return out
}

function barPlaces(list) {
  return normalizePlaces(list).filter(function(q) { return q.onBar })
}

// Puts a place on the bar or takes it off. A full bar refuses rather than
// bumping a place you put there.
function togglePlaceOnBar(list, key) {
  var places = normalizePlaces(list)
  var target = places.filter(function(q) { return q.key === key })[0]
  if (!target) return places.map(storedPlace)
  if (!target.onBar && barPlaces(places).length >= MAX_BAR_PLACES) return places.map(storedPlace)
  target.onBar = !target.onBar
  return places.map(storedPlace)
}

// The name as the bar shows it: the city, not the region, and never long.
function barName(name) {
  var n = trim(String(name || "").split(",")[0])
  return n.length > 12 ? trim(n.slice(0, 11)) + "…" : n
}

function addPlace(list, p) {
  var places = normalizePlaces(list)
  var key = placeKey(p)
  if (!key) return places.map(storedPlace)
  // Already kept: leave the list as it is. Full: refuse rather than quietly
  // dropping somewhere you chose.
  if (places.some(function(q) { return q.key === key }) || places.length >= MAX_PLACES) return places.map(storedPlace)
  places.push(p)
  return normalizePlaces(places).map(storedPlace)
}

function removePlace(list, key) {
  return normalizePlaces(list).filter(function(q) { return q.key !== key }).map(storedPlace)
}

// "14 hours ahead", "5½ hours behind", "same time".
function offsetText(there, here) {
  var d = (num(there) - num(here)) / 3600
  if (isNaN(d)) return ""
  if (Math.abs(d) < 0.01) return "same time"
  var a = Math.abs(d), whole = Math.floor(a), frac = a - whole
  var way = d > 0 ? "ahead" : "behind"
  // Under an hour (Nepal, Newfoundland's neighbours) it's said in words.
  if (whole === 0) return (frac >= 0.7 ? "three quarters of an hour " : frac >= 0.45 ? "half an hour " : "a quarter of an hour ") + way
  var n = String(whole) + (frac >= 0.7 ? "¾" : frac >= 0.45 ? "½" : frac >= 0.2 ? "¼" : "")
  return n + (n === "1" ? " hour " : " hours ") + way
}

// How somewhere else compares with home, in one line.
function compareLine(there, here, imperial, homeName) {
  if (!there || !here) return ""
  var bits = []
  var diff = deltaDegrees(there.current.temp - here.current.temp, imperial)
  var home = homeName || "home"
  if (!isNaN(diff)) {
    if (diff >= 2) bits.push(diff + "° warmer than " + home)
    else if (diff <= -2) bits.push(Math.abs(diff) + "° colder than " + home)
    else bits.push("About as warm as " + home)
  }
  var off = offsetText(there.offset, here.offset)
  if (off) bits.push(off)
  return bits.join("  ·  ")
}

if (typeof module !== "undefined") {
  module.exports = {
    APP_NAME: APP_NAME, HOUR_MS: HOUR_MS, DAY_MS: DAY_MS, MAX_BAR_PLACES: MAX_BAR_PLACES,
    barPlaces: barPlaces, togglePlaceOnBar: togglePlaceOnBar, barName: barName,
    clamp: clamp, num: num, trim: trim, boolSetting: boolSetting, intSetting: intSetting,
    parseLocationFile: parseLocationFile, hasCoordinates: hasCoordinates, sameLocation: sameLocation,
    parseIpInfo: parseIpInfo, parseGeocodingResults: parseGeocodingResults,
    shouldUseImperial: shouldUseImperial, temp: temp, signed: signed, tempText: tempText,
    deltaDegrees: deltaDegrees, speed: speed, speedUnit: speedUnit, speedText: speedText,
    precipText: precipText, pressureText: pressureText,
    condition: condition, conditionLabel: conditionLabel, iconKind: iconKind,
    localMs: localMs, nowLocal: nowLocal, dateKey: dateKey, hourText: hourText, spokenHour: spokenHour,
    clockText: clockText, weekday: weekday, durationText: durationText,
    daylightDeltaText: daylightDeltaText, ageText: ageText,
    forecastQuery: forecastQuery, airQuery: airQuery, geocodeQuery: geocodeQuery, curl: curl,
    parseForecast: parseForecast, parseAir: parseAir, hourIndex: hourIndex, dayIndex: dayIndex,
    today: today, yesterday: yesterday, upcomingHours: upcomingHours, hoursOfDay: hoursOfDay, week: week,
    isWetHour: isWetHour, precipOutlook: precipOutlook, barHint: barHint, shortNoun: shortNoun,
    partOfDay: partOfDay, sentence: sentence, firstSentence: firstSentence, secondSentence: secondSentence,
    compass: compass, windWord: windWord, uvLabel: uvLabel, aqiReading: aqiReading, pressureTrend: pressureTrend,
    sunProgress: sunProgress, moonPhase: moonPhase, moonIllumination: moonIllumination, moonName: moonName,
    moonPolygon: moonPolygon, upperIntersection: upperIntersection, cloudArcs: cloudArcs,
    monotoneSegments: monotoneSegments, niceRange: niceRange, rangeSpan: rangeSpan, weekRange: weekRange,
    parseColors: parseColors, mix: mix, tempColor: tempColor,
    tooltipText: tooltipText, copyPayload: copyPayload, copyCommand: copyCommand, radarCommand: radarCommand,
    toastCommand: toastCommand, saveLocationCommand: saveLocationCommand, rainKey: rainKey,
    MAX_PLACES: MAX_PLACES, placeKey: placeKey, normalizePlaces: normalizePlaces, storedPlace: storedPlace,
    addPlace: addPlace, removePlace: removePlace, offsetText: offsetText, compareLine: compareLine
  }
}
