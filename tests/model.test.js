const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Model = require("../Model.js")

// A real Open-Meteo answer for Duluth, Minnesota, on a drizzly October
// afternoon, with the clock pinned to the moment it describes.
const RAW = fs.readFileSync(path.join(__dirname, "fixtures", "duluth.json"), "utf8")
const FC = Model.parseForecast(RAW, 1792100488006)
const NOW = FC.current.t + 5 * 60000

// Build a synthetic forecast around a list of hourly codes and pops.
function synthetic(codes, opts) {
  opts = opts || {}
  const start = Date.UTC(2026, 9, 15, 0, 0)
  const hours = []
  for (let i = 0; i < 72; i++) {
    const t = new Date(start + i * 3600000).toISOString().slice(0, 16)
    hours.push(t)
  }
  const code = i => codes[Math.min(i, codes.length - 1)]
  const data = {
    utc_offset_seconds: 0,
    current: { time: "2026-10-15T14:00", temperature_2m: 12, weather_code: opts.current === undefined ? code(14) : opts.current, is_day: 1, precipitation: opts.precip || 0 },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 10 + Math.sin(i / 4) * 4),
      precipitation_probability: hours.map((_, i) => opts.pop ? opts.pop(i) : (Model.condition(code(i)).wet ? 80 : 0)),
      weather_code: hours.map((_, i) => code(i)),
      is_day: hours.map((_, i) => (i % 24 >= 7 && i % 24 < 19) ? 1 : 0)
    },
    daily: {
      time: ["2026-10-14", "2026-10-15", "2026-10-16"],
      temperature_2m_max: [opts.yesterdayMax === undefined ? 14 : opts.yesterdayMax, 14, 15],
      temperature_2m_min: [6, 7, 8],
      weather_code: [3, 3, 3],
      sunrise: ["2026-10-14T07:04", "2026-10-15T07:05", "2026-10-16T07:06"],
      sunset: ["2026-10-14T18:10", "2026-10-15T18:08", "2026-10-16T18:06"],
      daylight_duration: [40000, 39820, 39650]
    },
    minutely_15: opts.minutely || { time: [], precipitation: [] }
  }
  return Model.parseForecast(JSON.stringify(data), 0)
}

const AT_2PM = Date.UTC(2026, 9, 15, 14, 5)

test("a real forecast parses into hours, days and a nowcast", () => {
  assert.ok(FC)
  assert.equal(FC.timezone, "America/Chicago")
  assert.ok(FC.hourly.length >= 24 * 8)
  assert.equal(FC.daily.length, 9) // yesterday, today and seven more
  assert.equal(FC.minutely.length, 8)
  assert.ok(!isNaN(FC.current.temp))
})

test("garbage is refused rather than half-parsed", () => {
  assert.equal(Model.parseForecast("", 0), null)
  assert.equal(Model.parseForecast("{\"error\":true}", 0), null)
  assert.equal(Model.parseForecast("<html>", 0), null)
})

test("the week starts today and runs seven days", () => {
  const week = Model.week(FC, NOW)
  assert.equal(week.length, 7)
  assert.equal(week[0].date, Model.dateKey(NOW))
  assert.ok(Model.yesterday(FC, NOW))
})

test("the next 24 hours start with the hour we are in", () => {
  const hours = Model.upcomingHours(FC, NOW, 24)
  assert.equal(hours.length, 24)
  assert.ok(hours[0].t <= NOW && NOW < hours[0].t + Model.HOUR_MS)
})

test("local times read as wall-clock, independent of the machine's zone", () => {
  const t = Model.localMs("2026-10-15T17:15")
  assert.equal(new Date(t).getUTCHours(), 17)
  assert.equal(Model.dateKey(t), "2026-10-15")
  assert.equal(Model.clockText(t, false), "5:15 pm")
  assert.equal(Model.clockText(t, true), "17:15")
  assert.equal(Model.hourText(Model.localMs("2026-10-15T00:00"), false), "12am")
  assert.equal(Model.hourText(Model.localMs("2026-10-15T12:00"), false), "noon")
  assert.equal(Model.spokenHour(Model.localMs("2026-10-15T21:00"), false), "9 pm")
})

test("units convert, and a rounded zero has no sign", () => {
  assert.equal(Model.tempText(0, true), "32°")
  assert.equal(Model.tempText(-0.3, false), "0°")
  assert.equal(Model.tempText(-4, false), "−4°")
  assert.equal(Model.deltaDegrees(5, true), 9)
  assert.equal(Model.speedText(100, true), "62 mph")
  assert.equal(Model.pressureText(1013.25, true), "29.92 inHg")
  assert.equal(Model.tempText(NaN, false), "—")
})

test("units follow the locale unless told otherwise", () => {
  assert.equal(Model.shouldUseImperial("auto", "en_US", ""), true)
  assert.equal(Model.shouldUseImperial("auto", "en_GB", ""), false)
  assert.equal(Model.shouldUseImperial("auto", "C", "US"), true)
  assert.equal(Model.shouldUseImperial("metric", "en_US", "US"), false)
  assert.equal(Model.shouldUseImperial("imperial", "de_DE", "DE"), true)
})

test("every WMO code maps to a drawing the icon knows", () => {
  const kinds = ["clear", "partly", "cloudy", "fog", "drizzle", "rain", "sleet", "snow", "storm"]
  for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99, 42, null]) {
    assert.ok(kinds.includes(Model.condition(code).kind), `code ${code}`)
  }
  assert.equal(Model.conditionLabel(0, 1), "Sunny")
  assert.equal(Model.conditionLabel(0, 0), "Clear")
})

test("rain already falling says when it stops", () => {
  const fc = synthetic(Array(14).fill(61).concat(Array(5).fill(61), Array(20).fill(3)), { current: 61, precip: 0.4 })
  const out = Model.precipOutlook(fc, AT_2PM)
  assert.equal(out.state, "now")
  assert.equal(new Date(out.endMs).getUTCHours(), 19)
  assert.equal(Model.barHint(out, false), "Rain til 7pm")
  assert.match(Model.sentence(fc, AT_2PM, false, false), /^Rain until about 7 pm\./)
})

test("rain on its way says when it arrives", () => {
  const fc = synthetic(Array(17).fill(3).concat(Array(4).fill(63), Array(40).fill(3)), { current: 3 })
  const out = Model.precipOutlook(fc, AT_2PM)
  assert.equal(out.state, "later")
  assert.equal(new Date(out.startMs).getUTCHours(), 17)
  assert.equal(Model.barHint(out, false), "Rain 5pm")
  assert.match(Model.sentence(fc, AT_2PM, false, false), /^Cloudy now, rain around 5 pm\./)
})

test("the fifteen-minute nowcast beats the hourly forecast", () => {
  const minutely = {
    time: ["2026-10-15T14:00", "2026-10-15T14:15", "2026-10-15T14:30", "2026-10-15T14:45"],
    precipitation: [0, 0, 0.4, 0.6]
  }
  const fc = synthetic(Array(15).fill(3).concat(Array(5).fill(61), Array(40).fill(3)), { current: 3, minutely })
  const out = Model.precipOutlook(fc, AT_2PM)
  assert.equal(out.state, "soon")
  assert.equal(out.minutes, 25)
  assert.equal(Model.barHint(out, false), "Rain in 25m")
  assert.equal(Model.firstSentence(fc, AT_2PM, false), "Rain starting in about 25 minutes.")
})

test("rain in the next few minutes is 'soon', not a made-up count", () => {
  const minutely = { time: ["2026-10-15T14:00", "2026-10-15T14:15"], precipitation: [0.2, 0.3] }
  const fc = synthetic(Array(15).fill(3).concat(Array(5).fill(53), Array(40).fill(3)), { current: 3, minutely })
  const out = Model.precipOutlook(fc, AT_2PM)
  assert.equal(out.state, "soon")
  assert.equal(Model.barHint(out, false), "Drizzle soon")
})

test("a dry day keeps the bar quiet", () => {
  const fc = synthetic(Array(72).fill(0), { current: 0 })
  assert.equal(Model.precipOutlook(fc, AT_2PM).state, "none")
  assert.equal(Model.barHint(Model.precipOutlook(fc, AT_2PM), false), "")
})

test("a low chance of rain isn't announced", () => {
  const fc = synthetic(Array(16).fill(1).concat(Array(5).fill(80), Array(40).fill(1)), { current: 1, pop: () => 20 })
  assert.equal(Model.precipOutlook(fc, AT_2PM).state, "none")
})

test("a dry sky says how long it lasts", () => {
  const fc = synthetic(Array(20).fill(0).concat(Array(52).fill(3)), { current: 0 })
  assert.equal(Model.firstSentence(fc, AT_2PM, false), "Sunny until 8 pm, then cloudy.")
})

test("clear and mostly clear are the same sky", () => {
  const fc = synthetic([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0].concat(Array(48).fill(0)), { current: 0 })
  assert.equal(Model.firstSentence(fc, AT_2PM, false), "Sunny for the rest of the day.")
})

test("today is compared with yesterday", () => {
  assert.match(Model.secondSentence(synthetic([3], { yesterdayMax: 18 }), AT_2PM, false), /^4° cooler than yesterday/)
  assert.match(Model.secondSentence(synthetic([3], { yesterdayMax: 10 }), AT_2PM, true), /^7° warmer than yesterday/)
  assert.match(Model.secondSentence(synthetic([3], { yesterdayMax: 14.5 }), AT_2PM, false), /^About as warm/)
})

test("daylight gained or lost reads like a person would say it", () => {
  assert.equal(Model.daylightDeltaText(39820, 40000), "−3m 00s")
  assert.equal(Model.daylightDeltaText(40030, 40000), "+30s")
  assert.equal(Model.daylightDeltaText(40002, 40000), "same as yesterday")
  assert.equal(Model.durationText(39820), "11h 03m")
})

test("the sun's progress runs 0 at sunrise to 1 at sunset", () => {
  const day = { sunrise: Model.localMs("2026-10-15T07:00"), sunset: Model.localMs("2026-10-15T19:00") }
  assert.equal(Model.sunProgress(day, Model.localMs("2026-10-15T07:00")), 0)
  assert.equal(Model.sunProgress(day, Model.localMs("2026-10-15T13:00")), 0.5)
  assert.ok(Model.sunProgress(day, Model.localMs("2026-10-15T22:00")) > 1)
})

test("the moon is in the right phase", () => {
  // Known full moon: 2024-04-23 23:49 UTC. Known new moon: 2024-05-08 03:22 UTC.
  assert.ok(Math.abs(Model.moonPhase(Date.UTC(2024, 3, 23, 23, 49)) - 0.5) < 0.02)
  const n = Model.moonPhase(Date.UTC(2024, 4, 8, 3, 22))
  assert.ok(n < 0.02 || n > 0.98)
  assert.equal(Model.moonName(0.5), "Full moon")
  assert.equal(Model.moonName(0.25), "First quarter")
  assert.equal(Model.moonName(0.12), "Waxing crescent")
  assert.ok(Math.abs(Model.moonIllumination(0.5) - 1) < 1e-9)
})

test("the moon's lit shape stays inside its disc and lights the right side", () => {
  for (const p of [0.1, 0.25, 0.4, 0.6, 0.9]) {
    const pts = Model.moonPolygon(p, 16)
    for (const [x, y] of pts) assert.ok(x * x + y * y <= 1.0001)
    const mean = pts.reduce((s, [x]) => s + x, 0) / pts.length
    if (p < 0.5) assert.ok(mean > 0, `waxing ${p} should be lit on the right`)
    else assert.ok(mean < 0, `waning ${p} should be lit on the left`)
  }
})

test("a cloud outline joins up with no gaps", () => {
  const c = Model.cloudArcs(0, 0, 1)
  const end = a => [a.x + a.r * Math.cos(a.end), a.y + a.r * Math.sin(a.end)]
  const start = a => [a.x + a.r * Math.cos(a.start), a.y + a.r * Math.sin(a.start)]
  for (let i = 0; i < c.arcs.length - 1; i++) {
    const [x1, y1] = end(c.arcs[i]), [x2, y2] = start(c.arcs[i + 1])
    assert.ok(Math.hypot(x1 - x2, y1 - y2) < 1e-9, `arc ${i} meets arc ${i + 1}`)
    assert.ok(c.arcs[i].end > c.arcs[i].start)
  }
  // Both ends sit on the base line.
  assert.ok(Math.abs(start(c.arcs[0])[1] - c.base) < 1e-9)
  assert.ok(Math.abs(end(c.arcs[2])[1] - c.base) < 0.02)
})

test("the chart curve never overshoots the data", () => {
  const pts = [[0, 10], [1, 14], [2, 14], [3, 9], [4, 9.5], [5, 20]]
  const segs = Model.monotoneSegments(pts)
  assert.equal(segs.length, pts.length - 1)
  for (let i = 0; i < segs.length; i++) {
    const lo = Math.min(pts[i][1], pts[i + 1][1]), hi = Math.max(pts[i][1], pts[i + 1][1])
    for (const y of [segs[i][1], segs[i][3]]) assert.ok(y >= lo - 1e-9 && y <= hi + 1e-9, `segment ${i} control ${y}`)
  }
})

test("week bars sit on a shared scale", () => {
  const days = [{ min: 2, max: 10 }, { min: 6, max: 18 }]
  const r = Model.weekRange(days)
  assert.deepEqual(r, { lo: 2, hi: 18 })
  assert.deepEqual(Model.rangeSpan(days[0], r.lo, r.hi), { from: 0, to: 0.5 })
  assert.deepEqual(Model.rangeSpan(days[1], r.lo, r.hi), { from: 0.25, to: 1 })
})

test("temperatures take their colour from the theme", () => {
  const toml = fs.readFileSync(path.join(__dirname, "fixtures", "colors.toml"), "utf8")
  const pal = Model.parseColors(toml)
  assert.equal(pal.blue, "#7aa2f7")
  assert.equal(Model.tempColor(-30, pal), pal.magenta)
  assert.equal(Model.tempColor(40, pal), pal.red)
  assert.equal(Model.tempColor(15, pal), pal.green)
  assert.match(Model.tempColor(18, pal), /^#[0-9a-f]{6}$/)
  assert.equal(Model.parseColors("nonsense"), null)
})

test("readings are named the way forecasters name them", () => {
  assert.equal(Model.compass(0), "N")
  assert.equal(Model.compass(142), "SE")
  assert.equal(Model.compass(359), "N")
  assert.equal(Model.uvLabel(7), "High")
  assert.deepEqual(Model.aqiReading({ us: 48, eu: 24 }, true).label, "Good")
  assert.deepEqual(Model.aqiReading({ us: 48, eu: 45 }, false).label, "Moderate")
  assert.equal(Model.aqiReading(null, false), null)
})

test("location comes from the shared weather.json, or the network", () => {
  assert.deepEqual(Model.parseLocationFile('{"name":"Malibu","latitude":34.03,"longitude":-118.78}'), { name: "Malibu", latitude: 34.03, longitude: -118.78 })
  const nameOnly = Model.parseLocationFile('{"name":"Malibu"}')
  assert.equal(nameOnly.name, "Malibu")
  assert.ok(!Model.hasCoordinates(nameOnly))
  assert.ok(!Model.hasCoordinates(Model.parseLocationFile("")))
  const ip = Model.parseIpInfo('{"city":"Duluth","region":"Minnesota","country":"US","loc":"46.7867,-92.1005"}')
  assert.equal(ip.name, "Duluth")
  assert.equal(ip.country, "US")
  assert.equal(Model.parseIpInfo("{}"), null)
  assert.deepEqual(Model.saveLocationCommand(null), ["omarchy-weather-location", "--clear"])
  assert.deepEqual(Model.saveLocationCommand({ name: "Lisbon", latitude: 38.7167, longitude: -9.1333 }),
    ["omarchy-weather-location", "--set", "Lisbon", "38.7167,-9.1333"])
})

test("geocoding rows carry a region to tell the Springfields apart", () => {
  const rows = Model.parseGeocodingResults(JSON.stringify({ results: [
    { name: "Springfield", admin1: "Illinois", country: "United States", country_code: "US", latitude: 39.8, longitude: -89.6 },
    { name: "Broken" }
  ] }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].description, "Illinois, United States")
})

test("the rain heads-up fires once per spell", () => {
  const out = { state: "soon", startMs: Model.localMs("2026-10-15T15:20") }
  assert.equal(Model.rainKey(out), "2026-10-15T15")
  assert.equal(Model.rainKey({ state: "now" }), "")
})

test("ages read naturally", () => {
  const now = 1_000_000_000_000
  assert.equal(Model.ageText(now - 20_000, now), "just now")
  assert.equal(Model.ageText(now - 12 * 60000, now), "12 min ago")
  assert.equal(Model.ageText(now - 3 * 3600000, now), "3 h ago")
  assert.equal(Model.ageText(0, now), "")
})

test("the real afternoon reads as a sentence", () => {
  const s = Model.sentence(FC, NOW, true, false)
  assert.match(s, /^[A-Z].*\.$/)
  assert.ok(s.length < 140, s)
})

test("places are kept clean: named, located, unique, eight at most", () => {
  const raw = [
    { name: "Tokyo", latitude: 35.6895, longitude: 139.6917, description: "Japan" },
    { name: "Tokyo again", latitude: 35.68951, longitude: 139.69171 },
    { name: "", latitude: 1, longitude: 2 },
    { name: "Nowhere" },
    null
  ]
  const places = Model.normalizePlaces(raw)
  assert.equal(places.length, 1)
  assert.equal(places[0].key, "35.690,139.692")
  assert.deepEqual(Model.normalizePlaces("nonsense"), [])
})

test("adding and removing places", () => {
  let list = []
  list = Model.addPlace(list, { name: "Lisbon", description: "Portugal", latitude: 38.71667, longitude: -9.13333 })
  assert.deepEqual(list, [{ name: "Lisbon", description: "Portugal", latitude: 38.7167, longitude: -9.1333 }])
  assert.equal(Model.addPlace(list, { name: "Lisboa", latitude: 38.7167, longitude: -9.1333 }).length, 1)
  for (let i = 0; i < 10; i++) list = Model.addPlace(list, { name: "P" + i, latitude: i, longitude: i })
  assert.equal(list.length, Model.MAX_PLACES)
  assert.equal(list[0].name, "Lisbon", "a full list refuses rather than dropping a place you chose")
  list = Model.removePlace(list, Model.placeKey({ latitude: 38.7167, longitude: -9.1333 }))
  assert.equal(list.length, Model.MAX_PLACES - 1)
  assert.ok(!list.some(p => p.name === "Lisbon"))
})

test("the time difference reads the way people say it", () => {
  assert.equal(Model.offsetText(32400, -18000), "14 hours ahead")
  assert.equal(Model.offsetText(19800, 0), "5½ hours ahead")
  assert.equal(Model.offsetText(20700, 0), "5¾ hours ahead")
  assert.equal(Model.offsetText(-21600, -18000), "1 hour behind")
  assert.equal(Model.offsetText(1800, 0), "half an hour ahead")
  assert.equal(Model.offsetText(0, 2700), "three quarters of an hour behind")
  assert.equal(Model.offsetText(-18000, -18000), "same time")
})

test("somewhere else is compared with home", () => {
  const here = { offset: -18000, current: { temp: 13 } }
  const tokyo = { offset: 32400, current: { temp: 22 } }
  assert.equal(Model.compareLine(tokyo, here, false, "Duluth"), "9° warmer than Duluth  ·  14 hours ahead")
  assert.equal(Model.compareLine({ offset: -18000, current: { temp: 12 } }, here, false, "Duluth"), "About as warm as Duluth  ·  same time")
  assert.match(Model.compareLine({ offset: 0, current: { temp: 3 } }, here, true, ""), /^18° colder than home/)
  assert.equal(Model.compareLine(null, here, false, "x"), "")
})
