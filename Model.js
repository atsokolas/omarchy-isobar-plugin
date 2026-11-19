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

var COMPASS =["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

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
// Words. None are written here: every one comes from `tr`, the plugin's
// Commons.Translations over i18n/*.json (under node, a stand-in reading the
// same files). Each function that says something takes `tr` first.
//
// A sentence is one whole catalog string with %1… slots, never pieces glued
// together, so a language can put the words in its own order. Where a
// sentence is about one kind of weather, a catalog may also carry that
// sentence for that weather alone — "first.wetUntil.snow" is tried before
// "first.wetUntil" — for languages whose words agree with the noun. English
// needs none of those.

// %1…%9 filled in one pass, so a place called "%2" stays "%2".
function fill(s, args) {
  return String(s).replace(/%([1-9])/g, function(m, d) {
    var v = args[+d - 1]
    return v === undefined || v === null ? m : String(v)
  })
}

function has(tr, key) { return !!tr && typeof tr.t === "function" && tr.t(key, "") !== "" }

function lookup(tr, key) { return tr && typeof tr.t === "function" ? tr.t(key) : key }

// say(tr, "first.dryUntil", sky, hour, next)
function say(tr, key) { return fill(lookup(tr, key), Array.prototype.slice.call(arguments, 2)) }

// The sentence about one weather, if the catalog has it, else the general one.
function sayAbout(tr, key, variant) {
  var k = variant && has(tr, key + "." + variant) ? key + "." + variant : key
  return fill(lookup(tr, k), Array.prototype.slice.call(arguments, 3))
}

// A plural entry; `n` picks the form and is also %1's neighbour in args.
function sayN(tr, key, n) {
  var s = tr && typeof tr.tn === "function" ? tr.tn(key, n) : lookup(tr, key)
  return fill(s, Array.prototype.slice.call(arguments, 3))
}

function sayAboutN(tr, key, variant, n) {
  var k = variant && has(tr, key + "." + variant) ? key + "." + variant : key
  var s = tr && typeof tr.tn === "function" ? tr.tn(k, n) : lookup(tr, k)
  return fill(s, Array.prototype.slice.call(arguments, 4))
}

// A decimal in the language's own separator ("13,1" in Danish).
function decimal(tr, value, places) {
  if (tr && typeof tr.number === "function") return String(tr.number(value, places))
  return Number(value).toFixed(places)
}

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
      // No name at all is shown as "Home" in the panel's language.
      name: clip(data.city, 80) || clip(data.region, 80),
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
        // admin1 and country come in the language we ask for (geocodeQuery).
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

function precipText(tr, mm, imperial) {
  var n = num(mm)
  if (isNaN(n)) return "—"
  if (imperial) {
    var inch = n / 25.4
    return decimal(tr, inch, inch < 0.1 ? 2 : 1) + " in"
  }
  return (n < 10 ? decimal(tr, n, 1) : String(Math.round(n))) + " mm"
}

function pressureText(tr, hpa, imperial) {
  var n = num(hpa)
  if (isNaN(n)) return "—"
  return imperial ? decimal(tr, n * 0.0295300, 2) + " inHg" : Math.round(n) + " hPa"
}

// ---------------------------------------------------------------------------
// Conditions, from WMO weather codes.

// `kind` picks the drawing; `wet` is anything falling from the sky;
// `strength` 1–3 sets how much of it the icon draws. `id` names the label
// ("condition.<id>") and `noun` what's falling ("noun.<noun>"), as catalog
// keys rather than words.
var CONDITIONS = {
  0: ["clear", "0", false, 0, ""],
  1: ["partly", "1", false, 0, ""],
  2: ["partly", "2", false, 0, ""],
  3: ["cloudy", "3", false, 0, ""],
  45: ["fog", "45", false, 0, ""],
  48: ["fog", "48", false, 0, ""],
  51: ["drizzle", "51", true, 1, "drizzle"],
  53: ["drizzle", "53", true, 2, "drizzle"],
  55: ["drizzle", "55", true, 3, "drizzle"],
  56: ["sleet", "56", true, 1, "freezingDrizzle"],
  57: ["sleet", "56", true, 1, "freezingDrizzle"],
  61: ["rain", "61", true, 1, "rain"],
  63: ["rain", "63", true, 2, "rain"],
  65: ["rain", "65", true, 3, "heavyRain"],
  66: ["sleet", "66", true, 2, "freezingRain"],
  67: ["sleet", "66", true, 2, "freezingRain"],
  71: ["snow", "71", true, 1, "snow"],
  73: ["snow", "73", true, 2, "snow"],
  75: ["snow", "75", true, 3, "heavySnow"],
  77: ["snow", "77", true, 1, "snow"],
  80: ["rain", "80", true, 1, "showers"],
  81: ["rain", "81", true, 2, "showers"],
  82: ["rain", "82", true, 3, "heavyShowers"],
  85: ["snow", "85", true, 1, "snowShowers"],
  86: ["snow", "86", true, 3, "heavySnow"],
  95: ["storm", "95", true, 2, "thunderstorms"],
  96: ["storm", "96", true, 3, "thunderstorms"],
  99: ["storm", "96", true, 3, "thunderstorms"]
}

function condition(code) {
  var c = parseInt(String(code), 10)
  if (isNaN(c)) return { kind: "cloudy", id: "", wet: false, strength: 1, noun: "" }
  var row = CONDITIONS[c] || ["cloudy", "cloudy", false, 0, ""]
  return { kind: row[0], id: row[1], wet: row[2], strength: row[3], noun: row[4] }
}

// "Clear" in the day is "Sunny"; at night the sky is simply clear.
function conditionId(code, isDay) {
  var cond = condition(code)
  return cond.kind === "clear" && Number(isDay) !== 0 ? "sunny" : cond.id
}

function conditionLabel(tr, code, isDay) {
  var id = conditionId(code, isDay)
  return id ? say(tr, "condition." + id) : "—"
}

// The label in the middle of a sentence: "56°, light rain." Lowering the first
// letter is right for most languages; one where it isn't ("Regen" in German)
// says so with "conditionInline.<id>".
function conditionInline(tr, code, isDay) {
  var id = conditionId(code, isDay)
  if (!id) return "—"
  if (has(tr, "conditionInline." + id)) return say(tr, "conditionInline." + id)
  var label = conditionLabel(tr, code, isDay)
  return label.charAt(0).toLowerCase() + label.slice(1)
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

// A chart's hour: "3pm", "noon", "15".
function hourText(tr, lms, use24) {
  var h = new Date(lms).getUTCHours()
  if (use24) return pad2(h)
  if (h === 0) return say(tr, "time.hour.midnight")
  if (h === 12) return say(tr, "time.hour.noon")
  return say(tr, h < 12 ? "time.hour.am" : "time.hour.pm", h % 12)
}

// A spoken hour for sentences: "3 pm", "noon", "midnight", "15:00".
function spokenHour(tr, lms, use24) {
  var h = new Date(lms).getUTCHours()
  if (use24) return say(tr, "time.spoken.24", pad2(h))
  if (h === 0) return say(tr, "time.spoken.midnight")
  if (h === 12) return say(tr, "time.spoken.noon")
  return say(tr, h < 12 ? "time.spoken.am" : "time.spoken.pm", h % 12)
}

function clockText(tr, lms, use24) {
  var d = new Date(lms)
  var h = d.getUTCHours(), m = d.getUTCMinutes()
  if (use24) return say(tr, "time.clock.24", pad2(h), pad2(m))
  return say(tr, h < 12 ? "time.clock.am" : "time.clock.pm", (h % 12) || 12, pad2(m))
}

function weekday(tr, lms, short) {
  return say(tr, (short ? "weekday.short." : "weekday.") + new Date(lms).getUTCDay())
}

function durationText(tr, seconds) {
  var s = Math.max(0, Math.round(num(seconds) || 0))
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return say(tr, "duration", h, pad2(m))
}

// Daylight gained or lost since yesterday — the small fact that tells you
// which way the year is turning.
function daylightDeltaText(tr, todaySeconds, yesterdaySeconds) {
  var t = num(todaySeconds), y = num(yesterdaySeconds)
  if (isNaN(t) || isNaN(y)) return ""
  var d = Math.round(t - y)
  if (Math.abs(d) < 5) return say(tr, "daylight.same")
  var a = Math.abs(d), m = Math.floor(a / 60), s = a % 60
  var way = d > 0 ? "gained" : "lost"
  return m > 0 ? say(tr, "daylight." + way + "Minutes", m, pad2(s)) : say(tr, "daylight." + way + "Seconds", s)
}

function ageText(tr, fetchedAt, nowMs) {
  var f = num(fetchedAt)
  if (isNaN(f) || f <= 0) return ""
  var mins = Math.floor((nowMs - f) / 60000)
  if (mins < 1) return say(tr, "age.justNow")
  if (mins < 60) return sayN(tr, "age.minutes", mins, mins)
  var hrs = Math.floor(mins / 60)
  if (hrs < 24) return sayN(tr, "age.hours", hrs, hrs)
  var days = Math.floor(hrs / 24)
  return days === 1 ? say(tr, "age.yesterday") : sayN(tr, "age.days", days, days)
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

// Results come back named in the panel's language where Open-Meteo has it:
// "pt-BR" asks for "pt", anything unlike a language code asks for English.
function geocodeQuery(text, language) {
  var lang = String(language || "en").split("-")[0].toLowerCase()
  if (!/^[a-z]{2,3}$/.test(lang)) lang = "en"
  return GEOCODE_URL + "?name=" + encodeURIComponent(trim(text)) + "&count=6&language=" + lang + "&format=json"
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

function hourStrip(tr, fc, lms) {
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
    entry.day = dayLabel(tr, h.t, lms)
    lastKey = key
    out.push(entry)
  }
  return out
}

// Whole days from the day of `lms` to the day of `t`.
function daysAhead(t, lms) {
  return Math.round((localMs(dateKey(t)) - localMs(dateKey(lms))) / DAY_MS)
}

// "Today", "Tomorrow", then the weekday.
function dayLabel(tr, t, lms) {
  var days = daysAhead(t, lms)
  if (days === 0) return say(tr, "day.today")
  if (days === 1) return say(tr, "day.tomorrow")
  return weekday(tr, t)
}

// When an hour is, the way you'd say it: "Now", "4 pm", "6 am tomorrow",
// "noon Saturday".
function hourWhen(tr, h, lms, use24) {
  if (!h) return ""
  if (h.now) return say(tr, "when.now")
  var days = daysAhead(h.t, lms)
  var at = spokenHour(tr, h.t, use24)
  if (days === 0) return say(tr, "when.today", at)
  if (days === 1) return say(tr, "when.tomorrow", at)
  return say(tr, "when.later", at, weekday(tr, h.t))
}

// The readings under the strip for one hour, leaving out what the forecast
// doesn't carry.
function hourDetails(tr, h, imperial) {
  if (!h) return []
  var out = []
  if (!isNaN(num(h.feels))) out.push({ label: say(tr, "detail.feelsLike"), value: tempText(h.feels, imperial) })
  var pop = num(h.pop), mm = num(h.precip)
  if (!isNaN(pop)) out.push({ label: say(tr, "detail.rain"), value: Math.round(pop) + "%" + (mm > 0 ? "  ·  " + precipText(tr, mm, imperial) : "") })
  if (!isNaN(num(h.wind))) {
    var dir = compass(tr, h.windDir)
    var w = speedText(h.wind, imperial) + (dir ? " " + dir : "")
    var gust = num(h.gusts)
    out.push({ label: say(tr, "detail.wind"), value: !isNaN(gust) && gust - num(h.wind) >= 10 ? say(tr, "wind.gusts", w, speed(gust, imperial)) : w })
  }
  if (!isNaN(num(h.humidity))) out.push({ label: say(tr, "detail.humidity"), value: Math.round(num(h.humidity)) + "%" })
  if (!isNaN(num(h.uv)) && h.isDay) out.push({ label: say(tr, "detail.uv"), value: uvLabel(tr, h.uv) + "  " + Math.round(num(h.uv)) })
  var feel = comfortWord(tr, dewPoint(h.temp, h.humidity), h.temp)
  if (feel) out.push({ label: say(tr, "detail.comfort"), value: feel })
  var wear = wearPhrase(tr, h.feels, h.pop, h.uv, 0, h.isDay)
  if (wear) out.push({ label: say(tr, "detail.wear"), value: wear })
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

// The five words the bar and the nowcast use for what's falling.
function shortNoun(noun) {
  var n = String(noun || "rain").toLowerCase()
  if (n.indexOf("snow") >= 0) return "snow"
  if (n.indexOf("thunder") >= 0) return "storms"
  if (n.indexOf("drizzle") >= 0) return "drizzle"
  if (n.indexOf("shower") >= 0) return "showers"
  return "rain"
}

// The short hint the bar can carry beside the temperature, or "".
function barHint(tr, outlook, use24) {
  if (!outlook || outlook.state === "none") return ""
  var id = shortNoun(outlook.noun)
  var what = say(tr, "short." + id)
  if (outlook.state === "now")
    return capital(isNaN(outlook.endMs) ? sayAbout(tr, "hint.now", id, what) : sayAbout(tr, "hint.until", id, what, hourText(tr, outlook.endMs, use24)))
  if (outlook.minutes < 10) return capital(sayAbout(tr, "hint.soon", id, what))
  if (outlook.minutes < 60) {
    var m = Math.max(5, Math.round(outlook.minutes / 5) * 5)
    return capital(sayAboutN(tr, "hint.inMinutes", id, m, what, m))
  }
  return capital(sayAbout(tr, "hint.at", id, what, hourText(tr, outlook.startMs, use24)))
}

// The toast's title half an hour before: "Rain in about 25 minutes".
function headsUpTitle(tr, outlook) {
  if (!outlook || outlook.state === "none") return ""
  var id = shortNoun(outlook.noun)
  var m = Math.max(5, Math.round(outlook.minutes / 5) * 5)
  return capital(sayAboutN(tr, "toast.headsUp", id, m, say(tr, "short." + id), m))
}

// ---------------------------------------------------------------------------
// The sentence — what a person would tell you if you asked them.

// overnight | morning | afternoon | evening | night
function partOfDay(lms) {
  var h = new Date(lms).getUTCHours()
  if (h < 5) return "overnight"
  if (h < 12) return "morning"
  if (h < 17) return "afternoon"
  if (h < 21) return "evening"
  return "night"
}

// What the sky is doing, as a catalog id: the noun when something falls.
function skyId(code, isDay) {
  var cond = condition(code)
  if (cond.kind === "clear") return isDay ? "sunny" : "clear"
  if (cond.kind === "partly") return cond.id === "1" ? "mostlyClear" : "partlyCloudy"
  if (cond.kind === "fog") return "foggy"
  if (cond.wet && cond.noun) return cond.noun
  return "cloudy"
}

// The sky in the middle of a sentence ("then cloudy"); sentences start with
// a capital however their words come.
function skyWord(tr, code, isDay) {
  var cond = condition(code)
  return cond.wet && cond.noun ? say(tr, "noun." + cond.noun) : say(tr, "sky." + skyId(code, isDay))
}

function sameSky(a, b) {
  var ka = condition(a).kind, kb = condition(b).kind
  if (ka === kb) return true
  // Mostly clear and clear are the same sky to anyone looking up.
  return (ka === "clear" && kb === "partly") || (ka === "partly" && kb === "clear")
}

// When rain that's hours off arrives: "around" a time today, otherwise the
// part of tomorrow (or "overnight", which needs no day).
function laterWhen(startMs, lms) {
  if (new Date(startMs).getUTCDate() === new Date(lms).getUTCDate()) return "around"
  var part = partOfDay(startMs)
  return part === "overnight" ? "overnight" : "tomorrow" + capital(part)
}

function firstSentence(tr, fc, lms, use24) {
  var outlook = precipOutlook(fc, lms)
  var noun = outlook.noun

  // The fifteen-minute data knows both ends of a spell close at hand.
  if (outlook.state === "now" || outlook.state === "soon") {
    var close = nowcast(tr, fc, lms, use24, noun).line
    if (close) return close
  }

  var what = noun ? say(tr, "noun." + noun) : ""
  if (outlook.state === "now") {
    if (isNaN(outlook.endMs)) return capital(sayAbout(tr, "first.wetRestOfDay", noun, what))
    return capital(sayAbout(tr, "first.wetUntil", noun, what, spokenHour(tr, outlook.endMs, use24)))
  }
  if (outlook.state === "soon") {
    if (outlook.minutes <= 10) return capital(sayAbout(tr, "first.startingAnyMinute", noun, what))
    var m = Math.round(outlook.minutes / 5) * 5
    return capital(sayAboutN(tr, "first.startingIn", noun, m, what, m))
  }

  var hours = upcomingHours(fc, lms, 12)
  var now = fc.current
  var sky = skyWord(tr, now.code, now.isDay)
  if (outlook.state === "later")
    return capital(sayAbout(tr, "first.later." + laterWhen(outlook.startMs, lms), noun, sky, what, spokenHour(tr, outlook.startMs, use24)))

  // Dry. Say how long this sky lasts, and what comes after.
  var id = skyId(now.code, now.isDay)
  for (var i = 1; i < hours.length; i++) {
    if (!sameSky(now.code, hours[i].code))
      return capital(sayAbout(tr, "first.dryUntil", id, sky, spokenHour(tr, hours[i].t, use24), skyWord(tr, hours[i].code, hours[i].isDay)))
  }
  return capital(sayAbout(tr, now.isDay ? "first.dryRestOfDay" : "first.dryThroughNight", id, sky))
}

function secondSentence(tr, fc, lms, imperial) {
  var td = today(fc, lms), yd = yesterday(fc, lms)
  var bits = []
  // The same hour yesterday is how a change is felt; it's only worth saying
  // when it's noticeable. Without yesterday's hours, the highs stand in.
  var hourAgo = sinceYesterday(fc, lms, imperial)
  if (!isNaN(hourAgo)) {
    if (hourAgo >= 3) bits.push(sayN(tr, "second.warmerThisTime", hourAgo, hourAgo))
    else if (hourAgo <= -3) bits.push(sayN(tr, "second.colderThisTime", -hourAgo, -hourAgo))
  } else if (td && yd && !isNaN(td.max) && !isNaN(yd.max)) {
    var diff = deltaDegrees(td.max - yd.max, imperial)
    if (diff >= 2) bits.push(sayN(tr, "second.warmerThanYesterday", diff, diff))
    else if (diff <= -2) bits.push(sayN(tr, "second.coolerThanYesterday", -diff, -diff))
    else bits.push(say(tr, "second.asWarmAsYesterday"))
  }
  var gusts = fc.current.gusts
  if (!isNaN(gusts) && gusts >= 45) bits.push(say(tr, "second.gusts", speedText(gusts, imperial)))
  else if (td && !isNaN(td.uvMax) && td.uvMax >= 6 && fc.current.isDay) bits.push(say(tr, "second.uv." + uvLevel(td.uvMax)))
  if (bits.length === 0) return ""
  return capital(bits.length === 1 ? say(tr, "second.one", bits[0]) : say(tr, "second.two", bits[0], bits[1]))
}

function sentence(tr, fc, lms, imperial, use24) {
  if (!fc) return ""
  var a = firstSentence(tr, fc, lms, use24)
  var b = secondSentence(tr, fc, lms, imperial)
  return b ? say(tr, "sentence.join", a, b) : a
}

// ---------------------------------------------------------------------------
// Readings

function compass(tr, deg) {
  var n = num(deg)
  if (isNaN(n)) return ""
  return say(tr, "compass." + COMPASS[Math.round(((n % 360) + 360) % 360 / 22.5) % 16])
}

var WIND_WORDS = [[2, "calm"], [12, "lightAir"], [20, "lightBreeze"], [29, "gentleBreeze"], [39, "freshBreeze"],
  [50, "strongBreeze"], [62, "nearGale"], [75, "gale"], [Infinity, "stormForce"]]

function windWord(tr, kmh) {
  var n = num(kmh)
  if (isNaN(n)) return ""
  for (var i = 0; i < WIND_WORDS.length; i++) if (n < WIND_WORDS[i][0]) return say(tr, "windWord." + WIND_WORDS[i][1])
  return ""
}

// low | moderate | high | veryHigh | extreme
function uvLevel(uv) {
  var n = num(uv)
  if (isNaN(n)) return ""
  if (n < 3) return "low"
  if (n < 6) return "moderate"
  if (n < 8) return "high"
  if (n < 11) return "veryHigh"
  return "extreme"
}

function uvLabel(tr, uv) {
  var level = uvLevel(uv)
  return level ? say(tr, "uv." + level) : ""
}

// US AQI for the places that read it, the European index elsewhere.
function aqiReading(tr, air, imperial) {
  if (!air) return null
  var useUs = imperial ? !isNaN(air.us) : isNaN(air.eu)
  var v = Math.round(useUs ? air.us : air.eu)
  if (isNaN(v)) return null
  var level
  if (useUs) {
    level = v <= 50 ? "good" : v <= 100 ? "moderate" : v <= 150 ? "sensitive" : v <= 200 ? "unhealthy" : v <= 300 ? "veryUnhealthy" : "hazardous"
  } else {
    level = v <= 20 ? "good" : v <= 40 ? "fair" : v <= 60 ? "moderate" : v <= 80 ? "poor" : v <= 100 ? "veryPoor" : "extremelyPoor"
  }
  var scale = useUs ? "us" : "eu"
  return { value: v, label: say(tr, "aqi." + scale + "." + level), scale: say(tr, "aqi." + scale), level: useUs ? clamp(v / 300, 0, 1) : clamp(v / 100, 0, 1) }
}

// Rising, falling, or steady over the last three hours.
function pressureTrend(tr, fc, lms) {
  var i = hourIndex(fc, lms)
  if (i < 3) return ""
  var now = fc.hourly[i].pressure, before = fc.hourly[i - 3].pressure
  if (isNaN(now) || isNaN(before)) return ""
  var d = now - before
  return say(tr, d >= 1 ? "pressure.rising" : d <= -1 ? "pressure.falling" : "pressure.steady")
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

function moonName(tr, phase) {
  var p = ((num(phase) % 1) + 1) % 1
  var id = p < 0.033 || p > 0.967 ? "new" : p < 0.216 ? "waxingCrescent" : p < 0.283 ? "firstQuarter"
    : p < 0.466 ? "waxingGibbous" : p < 0.533 ? "full" : p < 0.716 ? "waningGibbous"
    : p < 0.783 ? "lastQuarter" : "waningCrescent"
  return say(tr, "moon." + id)
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

function tooltipText(tr, fc, lms, imperial, placeName) {
  if (!fc) return APP_NAME
  var now = fc.current
  var td = today(fc, lms)
  var line = say(tr, "tooltip.now", conditionLabel(tr, now.code, now.isDay), tempText(now.temp, imperial))
  if (td) line = say(tr, "tooltip.withRange", line, tempText(td.max, imperial), tempText(td.min, imperial))
  return (placeName ? placeName + "\n" : "") + line
}

function copyPayload(tr, fc, lms, imperial, use24, placeName) {
  if (!fc) return ""
  var now = fc.current
  var text = say(tr, "copy.text", tempText(now.temp, imperial), conditionInline(tr, now.code, now.isDay), sentence(tr, fc, lms, imperial, use24))
  return placeName ? say(tr, "copy.place", placeName, text) : text
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
function offsetText(tr, there, here) {
  var d = (num(there) - num(here)) / 3600
  if (isNaN(d)) return ""
  if (Math.abs(d) < 0.01) return say(tr, "offset.same")
  var a = Math.abs(d), whole = Math.floor(a), frac = a - whole
  var way = d > 0 ? "Ahead" : "Behind"
  // Under an hour (Nepal, Newfoundland's neighbours) it's said in words.
  if (whole === 0) return say(tr, "offset." + (frac >= 0.7 ? "threeQuarters" : frac >= 0.45 ? "half" : "quarter") + way)
  var part = frac >= 0.7 ? "¾" : frac >= 0.45 ? "½" : frac >= 0.2 ? "¼" : ""
  // A fraction of an hour has no plural rule to follow; whole hours do.
  if (part) return say(tr, "offset.fractionHours" + way, whole + part)
  return sayN(tr, "offset.hours" + way, whole, whole)
}

// How somewhere else compares with home, in one line.
function compareLine(tr, there, here, imperial, homeName) {
  if (!there || !here) return ""
  var bits = []
  var diff = deltaDegrees(there.current.temp - here.current.temp, imperial)
  var home = homeName || say(tr, "compare.home")
  if (!isNaN(diff)) {
    if (diff >= 2) bits.push(sayN(tr, "compare.warmer", diff, diff, home))
    else if (diff <= -2) bits.push(sayN(tr, "compare.colder", -diff, -diff, home))
    else bits.push(say(tr, "compare.asWarm", home))
  }
  var off = offsetText(tr, there.offset, here.offset)
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

function comfortWord(tr, dewC, tempC) {
  var d = num(dewC), t = num(tempC)
  if (isNaN(d)) return ""
  var id
  if (!isNaN(t) && t <= 10) id = d <= 2 ? "crisp" : "damp"
  // Near saturation the air is wet whatever the dew point says.
  else if (!isNaN(t) && t < 20 && t - d <= 2) id = "damp"
  else id = d < 10 ? "dry" : d < 16 ? "comfortable" : d < 18 ? "sticky" : d < 21 ? "muggy" : "oppressive"
  return say(tr, "comfort." + id)
}

// The humidity tile's second line: how the air feels, with the dew point
// when there's room for it beside the word.
function dewLine(tr, word, dewText) {
  if (!word) return say(tr, "dew.alone", dewText)
  var s = say(tr, "dew.withWord", word, dewText)
  return s.length <= 16 ? s : word
}

// "a, b and c", in the language's own way of listing.
function andList(tr, items) {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  return say(tr, "list.last", items.slice(0, -1).join(say(tr, "list.separator")), items[items.length - 1])
}

// What to wear, said the way a person would: "A jacket and an umbrella".
// `swing` is the day's spread in °C; layers only matter when it's wide.
// Feels-like steps, in °C and roughly °F: gloves below 27°, a warm coat to
// 41°, a jacket to 54°, a light jacket to 63°.
function wearPhrase(tr, feelsC, pop, uv, swing, isDay) {
  var f = num(feelsC)
  if (isNaN(f)) return ""
  var items = []
  if (f <= -3) items.push("warmCoat", "gloves")
  else if (f <= 5) items.push("warmCoat")
  else if (f <= 12) items.push("jacket")
  else if (f <= 17) items.push("lightJacket")
  if (num(swing) >= 10 && f > 0) items.push("layers")
  if (num(pop) >= 50) items.push("umbrella")
  if (isDay && num(uv) >= 6) items.push("sunglasses")
  if (items.length === 0) return f >= 24 ? say(tr, "wear.tshirt") : ""
  return capital(andList(tr, items.map(function(id) { return say(tr, "wear." + id) })))
}

// The same, as a sentence of its own: "A jacket and an umbrella."
function wearHint(tr, feelsC, pop, uv, swing, isDay) {
  var phrase = wearPhrase(tr, feelsC, pop, uv, swing, isDay)
  return phrase ? say(tr, "wear.sentence", phrase) : ""
}

// For the next eight hours — the time you're likely to be out in it — the
// coldest it will feel, the best chance of rain, the strongest sun, and how
// far the day swings.
function wearNow(tr, fc, lms) {
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
  return wearHint(tr, feels, pop, uv, hi > lo ? hi - lo : 0, true)
}

// ---------------------------------------------------------------------------
// The next two hours, in fifteen-minute slots.
//   { slots: [{ t, precip }], line: "Rain starts in about 20 minutes, easing by 8:40 pm." }

var NOWCAST_WET = 0.1

function nowcast(tr, fc, lms, use24, noun) {
  var out = { slots: [], line: "" }
  if (!fc || !fc.minutely) return out
  var slots = fc.minutely.filter(function(m) { return m.t + 15 * 60000 > lms }).slice(0, 8)
  out.slots = slots
  if (slots.length === 0) return out
  var wet = function(i) { return slots[i].precip >= NOWCAST_WET }
  var id = shortNoun(noun || "rain")
  var what = say(tr, "short." + id)
  var firstWet = -1
  for (var i = 0; i < slots.length; i++) if (wet(i)) { firstWet = i; break }
  if (firstWet < 0) return out
  var dryAfter = -1
  for (var j = firstWet + 1; j < slots.length; j++) if (!wet(j)) { dryAfter = j; break }
  // Easing by when it turns dry, or lasting past the end of what we can see.
  var easing = dryAfter >= 0
  var at = easing ? clockText(tr, slots[dryAfter].t, use24) : clockText(tr, slots[slots.length - 1].t + 15 * 60000, use24)
  if (firstWet === 0 && slots[0].t <= lms + 60000) {
    out.line = capital(easing ? sayAbout(tr, "nowcast.easing", id, what, at) : sayAbout(tr, "nowcast.nextTwoHours", id, what))
    return out
  }
  var minutes = Math.max(0, Math.round((Math.max(lms, slots[firstWet].t) - lms) / 60000))
  var tail = easing ? "Easing" : "Lasting"
  if (minutes < 10) {
    out.line = capital(sayAbout(tr, "nowcast.anyMinute" + tail, id, what, at))
  } else {
    var m = Math.round(minutes / 5) * 5
    out.line = capital(sayAboutN(tr, "nowcast.inMinutes" + tail, id, m, what, m, at))
  }
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

function nearestFullMoon(utcMs) {
  var ref = Date.UTC(2000, 0, 6, 18, 14)
  var k = Math.round(((utcMs - ref) / DAY_MS - SYNODIC_DAYS / 2) / SYNODIC_DAYS)
  return ref + (k + 0.5) * SYNODIC_DAYS * DAY_MS
}

// The names by month, January's Wolf Moon to December's Cold Moon, are
// "fullMoon.0" to "fullMoon.11".
function fullMoonName(tr, fullMs) {
  var d = new Date(fullMs)
  var harvest = nearestFullMoon(Date.UTC(d.getUTCFullYear(), 8, 22, 12))
  var cycle = SYNODIC_DAYS * DAY_MS
  if (Math.abs(fullMs - harvest) < DAY_MS) return say(tr, "fullMoon.harvest")
  if (Math.abs(fullMs - harvest - cycle) < DAY_MS) return say(tr, "fullMoon.hunters")
  if (new Date(fullMs - cycle).getUTCMonth() === d.getUTCMonth()) return say(tr, "fullMoon.blue")
  return say(tr, "fullMoon." + d.getUTCMonth())
}

// The full moon's name on the night of it, else "".
function fullMoonTonight(tr, utcMs) {
  var full = nearestFullMoon(utcMs)
  return Math.abs(utcMs - full) <= 20 * HOUR_MS ? fullMoonName(tr, full) : ""
}

// ---------------------------------------------------------------------------
// Firsts of the season. Each kind remembers the last day it happened; when it
// happens again after a long enough gap, that's a first worth a quiet word.
// A kind seen for the first time ever is only remembered — Isobar can't know
// it's a first without a history.

function daysBetween(a, b) { return Math.round((localMs(b) - localMs(a)) / DAY_MS) }

// Months are "since.0" to "since.11": the form a month takes after "since",
// which in many languages isn't the one it has on its own.
function seasonFirsts(tr, fc, lms, state, imperial, placeName, use24) {
  var seen = {}
  var prev = (state && state.seen) || {}
  for (var s in prev) seen[s] = prev[s]
  var events = []
  if (!fc || !fc.current) return { events: events, seen: seen }
  var today = dateKey(lms)
  var td = dayIndex(fc, today) >= 0 ? fc.daily[dayIndex(fc, today)] : null
  var ahead = upcomingHours(fc, lms, 24)
  // Each body comes as two sentences, with the place named and without.
  var at = placeName ? "Place" : ""
  var warmLabel = imperial ? 70 : 20
  var hotLabel = imperial ? 90 : 30
  var warmC = imperial ? (70 - 32) * 5 / 9 : 20
  var hotC = imperial ? (90 - 32) * 5 / 9 : 30

  var frostHour = null
  for (var i = 0; i < Math.min(ahead.length, 18); i++) if (ahead[i].temp <= 0) { frostHour = ahead[i]; break }
  var snowHour = null
  for (var j = 0; j < ahead.length; j++) {
    var k = condition(ahead[j].code).kind
    if (k === "snow" && (isNaN(ahead[j].pop) || ahead[j].pop >= 40)) { snowHour = ahead[j]; break }
  }

  var checks = [
    { kind: "warm", gap: 60, holds: td && td.max >= warmC,
      title: function(last) { return say(tr, "firsts.warm.title", warmLabel, say(tr, "since." + new Date(localMs(last)).getUTCMonth())) },
      body: function() { return say(tr, "firsts.upTo" + at, tempText(td.max, imperial), placeName) } },
    { kind: "hot", gap: 120, holds: td && td.max >= hotC,
      title: function() { return say(tr, "firsts.hot.title", hotLabel) },
      body: function() { return say(tr, "firsts.upTo" + at, tempText(td.max, imperial), placeName) } },
    { kind: "frost", gap: 120, holds: !!frostHour,
      title: function() { return say(tr, "firsts.frost.title") },
      body: function() { return say(tr, "firsts.frost.body", tempText(frostHour.temp, imperial), spokenHour(tr, frostHour.t, use24)) } },
    { kind: "freeze", gap: 120, holds: td && td.max < 0,
      title: function() { return say(tr, "firsts.freeze.title") },
      body: function() { return say(tr, "firsts.freeze.body" + at, tempText(td.max, imperial), placeName) } },
    { kind: "snow", gap: 120, holds: !!snowHour,
      title: function() { return say(tr, "firsts.snow.title") },
      body: function() {
        var noun = condition(snowHour.code).noun || "snow"
        return capital(sayAbout(tr, "firsts.snow.body", noun, say(tr, "noun." + noun), spokenHour(tr, snowHour.t, use24)))
      } }
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

function placeNote(tr, fc, lms, imperial, name, alerts, nowMs) {
  if (!fc || !fc.current) return null
  var where = name || say(tr, "note.there")
  var live = activeAlerts(alerts, num(nowMs) || 0)
  // The event is the Weather Service's own words, in English.
  if (live.length > 0) return { kind: "alert", text: say(tr, "note.alert", where, live[0].event) }
  var k = condition(fc.current.code).kind
  if (k === "snow") return { kind: "snow", text: say(tr, "note.snow", where) }
  if (k === "storm") return { kind: "storm", text: say(tr, "note.storm", where) }
  var t = fc.current.temp
  if (t >= 35) return { kind: "heat", text: say(tr, "note.heat", tempText(t, imperial), where) }
  if (t <= -15) return { kind: "cold", text: say(tr, "note.cold", tempText(t, imperial), where) }
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
    fill: fill, say: say, sayN: sayN, capital: capital,
    condition: condition, conditionId: conditionId, conditionLabel: conditionLabel, conditionInline: conditionInline, iconKind: iconKind,
    localMs: localMs, nowLocal: nowLocal, dateKey: dateKey, hourText: hourText, spokenHour: spokenHour,
    clockText: clockText, weekday: weekday, durationText: durationText,
    daylightDeltaText: daylightDeltaText, ageText: ageText,
    forecastQuery: forecastQuery, airQuery: airQuery, geocodeQuery: geocodeQuery, curl: curl,
    parseForecast: parseForecast, parseAir: parseAir, hourIndex: hourIndex, dayIndex: dayIndex,
    today: today, yesterday: yesterday, upcomingHours: upcomingHours, hoursOfDay: hoursOfDay, week: week,
    isWetHour: isWetHour, precipOutlook: precipOutlook, barHint: barHint, headsUpTitle: headsUpTitle, shortNoun: shortNoun,
    skyId: skyId, skyWord: skyWord, laterWhen: laterWhen, uvLevel: uvLevel, andList: andList, wearPhrase: wearPhrase,
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
