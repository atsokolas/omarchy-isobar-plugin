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
  "weather_code", "is_day", "pressure_msl", "wind_speed_10m", "uv_index",
  "relative_humidity_2m", "wind_direction_10m", "wind_gusts_10m"
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

// Words from a server: no control characters, and no longer than the place
// they're shown needs. The QML also draws them as plain text, never markup.
function clip(s, max) {
  var t = trim(String(s === undefined || s === null ? "" : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " "))
  return t.length > max ? t.slice(0, max - 1).replace(/\s+$/, "") + "…" : t
}

function onEarth(lat, lon) {
  return !isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

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
    if (!onEarth(lat, lon)) return null
    return {
      name: clip(data.city, 80) || clip(data.region, 80) || "Here",
      region: clip(data.region, 80),
      country: clip(data.country, 3).toUpperCase(),
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
    for (var i = 0; i < results.length && out.length < 10; i++) {
      var r = results[i]
      if (!r || !clip(r.name, 80) || !onEarth(num(r.latitude), num(r.longitude))) continue
      out.push({
        name: clip(r.name, 80),
        description: [clip(r.admin1, 80), clip(r.country, 80)].filter(function(p) { return !!p }).join(", "),
        country: clip(r.country_code, 3).toUpperCase(),
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

var USER_AGENT = "omarchy-isobar/1.1.1 (github.com/atsokolas/omarchy-isobar-plugin)"

// Every answer has a ceiling, about fifty times the size of a real one, so a
// wrong or hostile server can't fill the shell's memory. --max-filesize stops
// a declared length at the door; head stops a chunked or compressed one that
// grows past it on the way, and anything over the ceiling counts as a failure.
var MAX_BYTES = {
  forecast: 1024 * 1024,      // a week of hours runs about 17 KB
  air: 64 * 1024,             // a few hundred bytes
  geocode: 256 * 1024,        // six places, about 3 KB
  ip: 64 * 1024,              // a few hundred bytes
  alerts: 2 * 1024 * 1024     // a busy point's warnings, tens of KB
}

var FETCH_SCRIPT = 'set -o pipefail; max=$1; shift; t=$(mktemp) || exit 1; trap \'rm -f "$t"\' EXIT; '
  + 'curl --max-filesize "$max" "$@" | head -c "$((max + 1))" > "$t" || exit 1; '
  + '[ "$(wc -c < "$t")" -le "$max" ] || { echo "response over $max bytes" >&2; exit 3; }; cat "$t"'

function curl(url, seconds, maxBytes, headers) {
  url = String(url || "")
  if (!/^https:\/\/[^\s]+$/.test(url)) return ["false"]
  var max = Math.floor(num(maxBytes) > 0 ? num(maxBytes) : MAX_BYTES.forecast)
  var cmd = ["bash", "-c", FETCH_SCRIPT, "isobar-fetch", String(max),
    "-fsS", "--compressed", "--proto", "=https", "--proto-redir", "=https",
    "--max-time", String(seconds || 8), "-A", USER_AGENT]
  for (var i = 0; headers && i < headers.length; i++) cmd.push("-H", String(headers[i]))
  cmd.push("--", url)
  return cmd
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
      uv: num(column(h, "uv_index", i)),
      humidity: num(column(h, "relative_humidity_2m", i)),
      windDir: num(column(h, "wind_direction_10m", i)),
      gusts: num(column(h, "wind_gusts_10m", i))
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

// ---------------------------------------------------------------------------
// Hour by hour: every hour from this one to the end of the forecast, each
// knowing whether it is now and whether a new day starts with it.

function hourStrip(fc, lms) {
  var start = hourIndex(fc, lms)
  if (start < 0) return []
  var out = []
  var lastKey = dateKey(lms)
  for (var i = start; i < fc.hourly.length; i++) {
    var h = fc.hourly[i]
    var key = dateKey(h.t)
    var entry = {}
    for (var k in h) entry[k] = h[k]
    entry.now = i === start
    entry.dayStart = key !== lastKey
    entry.day = dayLabel(h.t, lms)
    lastKey = key
    out.push(entry)
  }
  return out
}

// "Today", "Tomorrow", then the weekday.
function dayLabel(t, lms) {
  var days = Math.round((localMs(dateKey(t)) - localMs(dateKey(lms))) / DAY_MS)
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  return weekday(t)
}

// When an hour is, the way you'd say it: "Now", "4 pm", "6 am tomorrow",
// "noon Saturday".
function hourWhen(h, lms, use24) {
  if (!h) return ""
  if (h.now) return "Now"
  var day = dayLabel(h.t, lms)
  var at = spokenHour(h.t, use24)
  return day === "Today" ? at : at + " " + (day === "Tomorrow" ? "tomorrow" : day)
}

// The readings under the strip for one hour, leaving out what the forecast
// doesn't carry.
function hourDetails(h, imperial) {
  if (!h) return []
  var out = []
  if (!isNaN(num(h.feels))) out.push({ label: "Feels like", value: tempText(h.feels, imperial) })
  var pop = num(h.pop), mm = num(h.precip)
  if (!isNaN(pop)) out.push({ label: "Rain", value: Math.round(pop) + "%" + (mm > 0 ? "  ·  " + precipText(mm, imperial) : "") })
  if (!isNaN(num(h.wind))) {
    var w = speedText(h.wind, imperial)
    var dir = compass(h.windDir)
    var gust = num(h.gusts)
    out.push({ label: "Wind", value: w + (dir ? " " + dir : "") + (!isNaN(gust) && gust - num(h.wind) >= 10 ? ", gusts " + speed(gust, imperial) : "") })
  }
  if (!isNaN(num(h.humidity))) out.push({ label: "Humidity", value: Math.round(num(h.humidity)) + "%" })
  if (!isNaN(num(h.uv)) && h.isDay) out.push({ label: "UV", value: uvLabel(h.uv) + "  " + Math.round(num(h.uv)) })
  var feel = comfortWord(dewPoint(h.temp, h.humidity), h.temp)
  if (feel) out.push({ label: "Comfort", value: feel })
  var wear = wearHint(h.feels, h.pop, h.uv, 0, h.isDay)
  if (wear) out.push({ label: "Wear", value: wear.replace(/\.$/, "") })
  return out
}

// A soft detent: free scrolling slows as it nears an hour and hurries
// between them, so the strip feels drawn to each one.
function detent(raw, strength) {
  var k = clamp(num(strength) || 0, 0, 0.95)
  return raw - k * Math.sin(2 * Math.PI * raw) / (2 * Math.PI)
}

// Where a flick comes to rest: the nearest hour after a short glide.
function restIndex(position, velocity, count) {
  if (!(count > 0)) return 0
  return clamp(Math.round(num(position) + (num(velocity) || 0) * 0.18), 0, count - 1)
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
    var sooner = nowcastEnd(fc, lms)
    if (!isNaN(sooner) && (isNaN(end) || sooner < end)) end = sooner
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

  // The fifteen-minute data knows both ends of a spell close at hand.
  if (outlook.state === "now" || outlook.state === "soon") {
    var close = nowcast(fc, lms, use24, noun).line
    if (close) return close
  }

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
  // The same hour yesterday is how a change is felt; it's only worth saying
  // when it's noticeable. Without yesterday's hours, the highs stand in.
  var hourAgo = sinceYesterday(fc, lms, imperial)
  if (!isNaN(hourAgo)) {
    if (hourAgo >= 3) bits.push(hourAgo + "° warmer than this time yesterday")
    else if (hourAgo <= -3) bits.push(Math.abs(hourAgo) + "° colder than this time yesterday")
  } else if (td && yd && !isNaN(td.max) && !isNaN(yd.max)) {
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

// Inside the polar circles Open-Meteo marks a day without a sunrise or
// sunset with both at midnight: "night" when the sun stays down, "day" when
// it stays up, else "".
function polar(day) {
  if (!day) return ""
  var d = num(day.daylight)
  if (!isNaN(d)) return d <= 60 ? "night" : d >= DAY_MS / 1000 - 60 ? "day" : ""
  if (isNaN(day.sunrise) || isNaN(day.sunset)) return ""
  return day.sunset <= day.sunrise ? "night" : day.sunset - day.sunrise >= DAY_MS ? "day" : ""
}

// Sunrises and sunsets that really happen, for hairlines on the chart.
function sunEvents(fc) {
  var out = []
  if (!fc || !fc.daily) return out
  for (var i = 0; i < fc.daily.length; i++) {
    var d = fc.daily[i]
    if (polar(d) !== "") continue
    if (!isNaN(d.sunrise)) out.push({ t: d.sunrise, rise: true })
    if (!isNaN(d.sunset)) out.push({ t: d.sunset, rise: false })
  }
  return out
}

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

function toastCommand(title, body, urgency) {
  return ["omarchy-notification-send", "--app-name", APP_NAME, "-u", urgency || "low", String(title || APP_NAME), String(body || "")]
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
  return normalizePlaces(list).filter(function(q) { return q.onBar }).slice(0, MAX_BAR_PLACES)
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

// ---------------------------------------------------------------------------
// Since yesterday: the same hour, a day ago. Whole degrees in the units on
// screen, or NaN when yesterday's hour isn't in the forecast.

function sinceYesterday(fc, lms, imperial) {
  if (!fc || !fc.current) return NaN
  var i = hourIndex(fc, lms - DAY_MS)
  if (i < 0) return NaN
  return deltaDegrees(fc.current.temp - fc.hourly[i].temp, imperial)
}

// ---------------------------------------------------------------------------
// Comfort: how the air feels, and what to put on for it.

// Magnus formula; good to a few tenths of a degree in weather that matters.
function dewPoint(tempC, rh) {
  var t = num(tempC), h = num(rh)
  if (isNaN(t) || isNaN(h) || h <= 0) return NaN
  var g = Math.log(h / 100) + 17.62 * t / (243.12 + t)
  return 243.12 * g / (17.62 - g)
}

function comfortWord(dewC, tempC) {
  var d = num(dewC), t = num(tempC)
  if (isNaN(d)) return ""
  if (!isNaN(t) && t <= 10) return d <= 2 ? "Crisp" : "Damp"
  // Near saturation the air is wet whatever the dew point says.
  if (!isNaN(t) && t < 20 && t - d <= 2) return "Damp"
  if (d < 10) return "Dry"
  if (d < 16) return "Comfortable"
  if (d < 18) return "Sticky"
  if (d < 21) return "Muggy"
  return "Oppressive"
}

// The humidity tile's second line: how the air feels, with the dew point
// when there's room for it beside the word.
function dewLine(word, dewText) {
  if (!word) return "Dew point " + dewText
  var s = word + ", dew " + dewText
  return s.length <= 16 ? s : word
}

function andList(items) {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1]
}

// What to wear, said the way a person would: "A jacket and an umbrella."
// `swing` is the day's spread in °C; layers only matter when it's wide.
// Feels-like steps, in °C and roughly °F: gloves below 27°, a warm coat to
// 41°, a jacket to 54°, a light jacket to 63°.
function wearHint(feelsC, pop, uv, swing, isDay) {
  var f = num(feelsC)
  if (isNaN(f)) return ""
  var items = []
  if (f <= -3) items.push("a warm coat", "gloves")
  else if (f <= 5) items.push("a warm coat")
  else if (f <= 12) items.push("a jacket")
  else if (f <= 17) items.push("a light jacket")
  if (num(swing) >= 10 && f > 0) items.push("layers")
  if (num(pop) >= 50) items.push("an umbrella")
  if (isDay && num(uv) >= 6) items.push("sunglasses")
  if (items.length === 0) return f >= 24 ? "T-shirt weather." : ""
  return capital(andList(items)) + "."
}

// For the next eight hours — the time you're likely to be out in it — the
// coldest it will feel, the best chance of rain, the strongest sun, and how
// far the day swings.
function wearNow(fc, lms) {
  if (!fc || !fc.current) return ""
  var hours = upcomingHours(fc, lms, 8)
  var feels = num(fc.current.feels), pop = 0, uv = 0, lo = Infinity, hi = -Infinity
  for (var i = 0; i < hours.length; i++) {
    var h = hours[i]
    if (!isNaN(h.feels) && h.feels < feels) feels = h.feels
    if (!isNaN(h.pop)) pop = Math.max(pop, h.pop)
    if (!isNaN(h.uv) && h.isDay) uv = Math.max(uv, h.uv)
    if (!isNaN(h.temp)) { lo = Math.min(lo, h.temp); hi = Math.max(hi, h.temp) }
  }
  return wearHint(feels, pop, uv, hi > lo ? hi - lo : 0, true)
}

// ---------------------------------------------------------------------------
// The next two hours, in fifteen-minute slots.
//   { slots: [{ t, precip }], line: "Rain starts in about 20 minutes, easing by 8:40 pm." }

var NOWCAST_WET = 0.1

function nowcast(fc, lms, use24, noun) {
  var out = { slots: [], line: "" }
  if (!fc || !fc.minutely) return out
  var slots = fc.minutely.filter(function(m) { return m.t + 15 * 60000 > lms }).slice(0, 8)
  out.slots = slots
  if (slots.length === 0) return out
  var wet = function(i) { return slots[i].precip >= NOWCAST_WET }
  var what = capital(shortNoun(noun || "rain"))
  var firstWet = -1
  for (var i = 0; i < slots.length; i++) if (wet(i)) { firstWet = i; break }
  if (firstWet < 0) return out
  var dryAfter = -1
  for (var j = firstWet + 1; j < slots.length; j++) if (!wet(j)) { dryAfter = j; break }
  var ending = dryAfter >= 0 ? "easing by " + clockText(slots[dryAfter].t, use24) : "lasting past " + clockText(slots[slots.length - 1].t + 15 * 60000, use24)
  if (firstWet === 0 && slots[0].t <= lms + 60000) {
    out.line = dryAfter >= 0 ? what + " " + ending + "." : what + " for the next two hours."
    return out
  }
  var minutes = Math.max(0, Math.round((Math.max(lms, slots[firstWet].t) - lms) / 60000))
  var when = minutes < 10 ? "any minute" : "in about " + Math.round(minutes / 5) * 5 + " minutes"
  out.line = what + " starts " + when + ", " + ending + "."
  return out
}

// When the fifteen-minute data sees the current spell end before the hourly
// forecast does, it knows better.
function nowcastEnd(fc, lms) {
  if (!fc || !fc.minutely) return NaN
  var slots = fc.minutely.filter(function(m) { return m.t + 15 * 60000 > lms }).slice(0, 8)
  var sawWet = false
  for (var i = 0; i < slots.length; i++) {
    if (slots[i].precip >= NOWCAST_WET) sawWet = true
    else if (sawWet) return slots[i].t
  }
  return NaN
}

// ---------------------------------------------------------------------------
// Alerts, from the US National Weather Service. Elsewhere there is no
// equivalent free feed, so Isobar says nothing rather than guessing.

var ALERTS_URL = "https://api.weather.gov/alerts/active"
var SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 }

function nwsCovers(lat, lon) {
  var la = num(lat), lo = num(lon)
  if (isNaN(la) || isNaN(lo)) return false
  var boxes = [
    [24, 50, -125, -66],      // the lower 48
    [51, 72, -180, -129],     // Alaska
    [18, 23, -161, -154],     // Hawaii
    [17.5, 18.6, -67.5, -65]  // Puerto Rico
  ]
  return boxes.some(function(b) { return la >= b[0] && la <= b[1] && lo >= b[2] && lo <= b[3] })
}

function alertsCommand(lat, lon) {
  var url = ALERTS_URL + "?point=" + num(lat).toFixed(4) + "," + num(lon).toFixed(4)
  return curl(url, 8, MAX_BYTES.alerts, ["Accept: application/geo+json"])
}

function parseAlerts(raw, nowMs) {
  var data
  try { data = JSON.parse(String(raw || "")) } catch (e) { return null }
  if (!data || !data.features || typeof data.features.length !== "number") return null
  var out = []
  for (var i = 0; i < data.features.length && out.length < 20; i++) {
    var p = data.features[i] && data.features[i].properties
    if (!p || p.status !== "Actual" || p.messageType === "Cancel") continue
    var ends = Date.parse(p.ends || p.expires || "")
    if (!isNaN(ends) && ends <= nowMs) continue
    out.push({
      id: clip(p.id || p["@id"] || (p.event + p.onset), 200),
      event: clip(p.event, 120),
      headline: clip(p.headline, 400),
      description: clip(String(p.description || "").replace(/([^\n])\n(?!\n)/g, "$1 ").replace(/ +/g, " "), 6000),
      instruction: clip(String(p.instruction || "").replace(/([^\n])\n(?!\n)/g, "$1 ").replace(/ +/g, " "), 3000),
      severity: SEVERITY_RANK[p.severity] ? String(p.severity) : "Unknown",
      // An update to an alert is a new message naming the ones it replaces.
      refs: (Array.isArray(p.references) ? p.references.slice(0, 20) : []).map(function(r) { return r && String(r.identifier || r["@id"] || "") }).filter(function(r) { return !!r }),
      ends: isNaN(ends) ? NaN : ends,
      onset: Date.parse(p.onset || p.effective || "")
    })
  }
  out.sort(function(a, b) {
    var r = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
    return r !== 0 ? r : (a.onset || 0) - (b.onset || 0)
  })
  return out
}

function activeAlerts(list, nowMs) {
  return (list || []).filter(function(a) { return isNaN(a.ends) || a.ends > nowMs })
}

// Live alerts not yet mentioned: neither this message nor any it updates.
function freshAlerts(list, seen, nowMs) {
  var known = seen || {}
  return activeAlerts(list, nowMs).filter(function(a) {
    if (known[a.id]) return false
    return !(a.refs || []).some(function(r) { return !!known[r] })
  })
}

// ---------------------------------------------------------------------------
// Golden hour: 0 most of the day, rising to 1 at sunrise and sunset and
// fading over twenty-odd minutes either side.

function goldenGlow(fc, lms) {
  if (!fc || !fc.daily) return 0
  var best = 0
  for (var i = 0; i < fc.daily.length; i++) {
    var d = fc.daily[i]
    // No sunrise, no golden hour — not a glow at midnight.
    if (polar(d) !== "") continue
    var marks = [d.sunrise, d.sunset]
    for (var k = 0; k < 2; k++) {
      if (isNaN(marks[k])) continue
      var away = Math.abs(lms - marks[k]) / 60000
      if (away >= 25) continue
      var x = clamp((away - 10) / 15, 0, 1)
      best = Math.max(best, 1 - x * x * (3 - 2 * x))
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Full moons, by their old names. The Harvest Moon is the one nearest the
// September equinox, and the Hunter's Moon the one after it; a second full
// moon in a calendar month is a Blue Moon.

var SYNODIC_DAYS = 29.530588853
var MOON_NAMES = ["Wolf", "Snow", "Worm", "Pink", "Flower", "Strawberry", "Buck", "Sturgeon", "Corn", "Hunter's", "Beaver", "Cold"]

function nearestFullMoon(utcMs) {
  var ref = Date.UTC(2000, 0, 6, 18, 14)
  var k = Math.round(((utcMs - ref) / DAY_MS - SYNODIC_DAYS / 2) / SYNODIC_DAYS)
  return ref + (k + 0.5) * SYNODIC_DAYS * DAY_MS
}

function fullMoonName(fullMs) {
  var d = new Date(fullMs)
  var harvest = nearestFullMoon(Date.UTC(d.getUTCFullYear(), 8, 22, 12))
  var cycle = SYNODIC_DAYS * DAY_MS
  if (Math.abs(fullMs - harvest) < DAY_MS) return "Harvest Moon"
  if (Math.abs(fullMs - harvest - cycle) < DAY_MS) return "Hunter's Moon"
  if (new Date(fullMs - cycle).getUTCMonth() === d.getUTCMonth()) return "Blue Moon"
  return MOON_NAMES[d.getUTCMonth()] + " Moon"
}

// The full moon's name on the night of it, else "".
function fullMoonTonight(utcMs) {
  var full = nearestFullMoon(utcMs)
  return Math.abs(utcMs - full) <= 20 * HOUR_MS ? fullMoonName(full) : ""
}

// ---------------------------------------------------------------------------
// Firsts of the season. Each kind remembers the last day it happened; when it
// happens again after a long enough gap, that's a first worth a quiet word.
// A kind seen for the first time ever is only remembered — Isobar can't know
// it's a first without a history.

var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

function daysBetween(a, b) { return Math.round((localMs(b) - localMs(a)) / DAY_MS) }

function seasonFirsts(fc, lms, state, imperial, placeName, use24) {
  var seen = {}
  var prev = (state && state.seen) || {}
  for (var s in prev) seen[s] = prev[s]
  var events = []
  if (!fc || !fc.current) return { events: events, seen: seen }
  var today = dateKey(lms)
  var td = dayIndex(fc, today) >= 0 ? fc.daily[dayIndex(fc, today)] : null
  var ahead = upcomingHours(fc, lms, 24)
  var where = placeName ? " in " + placeName : ""

  var warmC = imperial ? (70 - 32) * 5 / 9 : 20
  var hotC = imperial ? (90 - 32) * 5 / 9 : 30
  var warmLabel = imperial ? "70°" : "20°"
  var hotLabel = imperial ? "90°" : "30°"

  var frostHour = null
  for (var i = 0; i < Math.min(ahead.length, 18); i++) if (ahead[i].temp <= 0) { frostHour = ahead[i]; break }
  var snowHour = null
  for (var j = 0; j < ahead.length; j++) {
    var k = condition(ahead[j].code).kind
    if (k === "snow" && (isNaN(ahead[j].pop) || ahead[j].pop >= 40)) { snowHour = ahead[j]; break }
  }

  var checks = [
    { kind: "warm", gap: 60, holds: td && td.max >= warmC,
      title: function(last) { return "First " + warmLabel + " day since " + MONTHS[new Date(localMs(last)).getUTCMonth()] },
      body: function() { return "Up to " + tempText(td.max, imperial) + where + " today." } },
    { kind: "hot", gap: 120, holds: td && td.max >= hotC,
      title: function() { return "First " + hotLabel + " day of the year" },
      body: function() { return "Up to " + tempText(td.max, imperial) + where + " today." } },
    { kind: "frost", gap: 120, holds: !!frostHour,
      title: function() { return "First frost tonight" },
      body: function() { return "Down to " + tempText(frostHour.temp, imperial) + " by " + spokenHour(frostHour.t, use24) + ". Bring the plants in." } },
    { kind: "freeze", gap: 120, holds: td && td.max < 0,
      title: function() { return "First day below freezing" },
      body: function() { return "It won't get above " + tempText(td.max, imperial) + where + " today." } },
    { kind: "snow", gap: 120, holds: !!snowHour,
      title: function() { return "First snow of the season" },
      body: function() { return capital(condition(snowHour.code).noun || "snow") + " from around " + spokenHour(snowHour.t, use24) + "." } }
  ]

  for (var c = 0; c < checks.length; c++) {
    var ch = checks[c]
    if (!ch.holds) continue
    var last = seen[ch.kind]
    if (last && last !== today && daysBetween(last, today) >= ch.gap)
      events.push({ kind: ch.kind, title: ch.title(last), body: ch.body() })
    seen[ch.kind] = today
  }
  return { events: events, seen: seen }
}

// ---------------------------------------------------------------------------
// Notes from your places: something you'd mention if you were there.
// Routine rain isn't news; snow, storms, real heat and real cold are.

function placeNote(fc, lms, imperial, name, alerts, nowMs) {
  if (!fc || !fc.current) return null
  var where = name || "there"
  var live = activeAlerts(alerts, num(nowMs) || 0)
  if (live.length > 0) return { kind: "alert", text: where + " is under a " + live[0].event }
  var k = condition(fc.current.code).kind
  if (k === "snow") return { kind: "snow", text: "It's snowing in " + where }
  if (k === "storm") return { kind: "storm", text: "Thunderstorms over " + where }
  var t = fc.current.temp
  if (t >= 35) return { kind: "heat", text: "It's " + tempText(t, imperial) + " in " + where }
  if (t <= -15) return { kind: "cold", text: "It's " + tempText(t, imperial) + " in " + where }
  return null
}

function noteKey(placeKey, note, lms) {
  return note ? placeKey + "|" + note.kind + "|" + dateKey(lms) : ""
}

// Drops remembered notes and alerts once they're old news.
function pruneState(state, nowMs) {
  var out = { seen: {}, notes: {}, alerts: {} }
  var s = state || {}
  var k
  for (k in (s.seen || {})) out.seen[k] = s.seen[k]
  for (k in (s.notes || {})) if (nowMs - num(s.notes[k]) < 3 * DAY_MS) out.notes[k] = s.notes[k]
  for (k in (s.alerts || {})) if (nowMs - num(s.alerts[k]) < 7 * DAY_MS) out.alerts[k] = s.alerts[k]
  return out
}

function parseState(raw) {
  try {
    var d = JSON.parse(String(raw || ""))
    return d && typeof d === "object" ? pruneState(d, Date.now()) : pruneState(null, 0)
  } catch (e) {
    return pruneState(null, 0)
  }
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
    polar: polar, sunEvents: sunEvents, sunProgress: sunProgress, moonPhase: moonPhase, moonIllumination: moonIllumination, moonName: moonName,
    moonPolygon: moonPolygon, upperIntersection: upperIntersection, cloudArcs: cloudArcs,
    monotoneSegments: monotoneSegments, niceRange: niceRange, rangeSpan: rangeSpan, weekRange: weekRange,
    parseColors: parseColors,
    hourStrip: hourStrip, dayLabel: dayLabel, hourWhen: hourWhen, hourDetails: hourDetails,
    detent: detent, restIndex: restIndex, mix: mix, tempColor: tempColor,
    tooltipText: tooltipText, copyPayload: copyPayload, copyCommand: copyCommand, radarCommand: radarCommand,
    toastCommand: toastCommand, saveLocationCommand: saveLocationCommand, rainKey: rainKey,
    MAX_PLACES: MAX_PLACES, placeKey: placeKey, normalizePlaces: normalizePlaces, storedPlace: storedPlace,
    addPlace: addPlace, removePlace: removePlace, offsetText: offsetText, compareLine: compareLine,
    sinceYesterday: sinceYesterday, dewPoint: dewPoint, comfortWord: comfortWord, wearHint: wearHint, wearNow: wearNow,
    nowcast: nowcast, nowcastEnd: nowcastEnd, nwsCovers: nwsCovers, alertsCommand: alertsCommand, clip: clip, onEarth: onEarth, MAX_BYTES: MAX_BYTES, IP_URL: IP_URL,
    parseAlerts: parseAlerts, activeAlerts: activeAlerts, freshAlerts: freshAlerts, dewLine: dewLine, USER_AGENT: USER_AGENT, goldenGlow: goldenGlow,
    nearestFullMoon: nearestFullMoon, fullMoonName: fullMoonName, fullMoonTonight: fullMoonTonight,
    seasonFirsts: seasonFirsts, placeNote: placeNote, noteKey: noteKey, pruneState: pruneState, parseState: parseState,
  }
}
