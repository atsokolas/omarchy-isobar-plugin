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
  assert.equal(Model.firstSentence(fc, AT_2PM, false), "Rain starts in about 25 minutes, lasting past 3:00 pm.")
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

test("a few places can sit on the bar beside home", () => {
  let list = []
  for (let i = 0; i < 5; i++) list = Model.addPlace(list, { name: "P" + i, latitude: i, longitude: i })
  assert.ok(!("onBar" in list[0]), "shell.json only says onBar when it's true")
  const key = i => Model.placeKey({ latitude: i, longitude: i })
  list = Model.togglePlaceOnBar(list, key(1))
  assert.equal(list[1].onBar, true)
  assert.deepEqual(Model.barPlaces(list).map(p => p.name), ["P1"])
  list = Model.togglePlaceOnBar(list, key(3))
  list = Model.togglePlaceOnBar(list, key(0))
  assert.equal(Model.barPlaces(list).length, Model.MAX_BAR_PLACES)
  assert.deepEqual(Model.barPlaces(list).map(p => p.name), ["P0", "P1", "P3"], "the bar keeps the order of the list")
  assert.equal(Model.barPlaces(Model.togglePlaceOnBar(list, key(4))).length, Model.MAX_BAR_PLACES, "a full bar refuses")
  list = Model.togglePlaceOnBar(list, key(1))
  assert.deepEqual(Model.barPlaces(list).map(p => p.name), ["P0", "P3"])
  assert.equal(Model.togglePlaceOnBar(list, "nowhere").length, 5)
  assert.ok(Model.removePlace(list, key(0)).every(p => p.name !== "P0"))
})

test("the bar names a place briefly", () => {
  assert.equal(Model.barName("Tokyo"), "Tokyo")
  assert.equal(Model.barName("Paris, Île-de-France"), "Paris")
  assert.equal(Model.barName("Llanfairpwllgwyngyll"), "Llanfairpwl…")
  assert.equal(Model.barName(""), "")
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

test("hour by hour runs from this hour to the end of the forecast", () => {
  const fc = synthetic([3])
  const strip = Model.hourStrip(fc, AT_2PM)
  assert.equal(strip.length, 72 - 14)
  assert.equal(strip[0].now, true)
  assert.equal(strip[1].now, false)
  assert.equal(new Date(strip[0].t).getUTCHours(), 14)
  const starts = strip.filter(h => h.dayStart)
  assert.equal(starts.length, 2, "midnight starts a day, and only midnight")
  assert.equal(new Date(starts[0].t).getUTCHours(), 0)
  assert.equal(starts[0].day, "Tomorrow")
  assert.equal(starts[1].day, "Saturday")
  assert.equal(Model.hourStrip(null, AT_2PM).length, 0)
  const real = Model.hourStrip(FC, NOW)
  assert.ok(real.length > 24 * 6)
  assert.equal(real[0].now, true)
})

test("an hour is named the way you'd say it", () => {
  const strip = Model.hourStrip(synthetic([3]), AT_2PM)
  assert.equal(Model.hourWhen(strip[0], AT_2PM, false), "Now")
  assert.equal(Model.hourWhen(strip[2], AT_2PM, false), "4 pm")
  assert.equal(Model.hourWhen(strip[16], AT_2PM, false), "6 am tomorrow")
  assert.equal(Model.hourWhen(strip[46], AT_2PM, false), "noon Saturday")
  assert.equal(Model.hourWhen(strip[2], AT_2PM, true), "16:00")
})

test("an hour's readings leave out what the forecast doesn't carry", () => {
  const full = { t: 0, feels: 8, pop: 40, precip: 0.4, wind: 20, windDir: 315, gusts: 45, humidity: 81, uv: 3.2, isDay: true }
  const rows = Model.hourDetails(full, false)
  assert.deepEqual(rows.map(r => r.label), ["Feels like", "Rain", "Wind", "Humidity", "UV", "Wear"])
  assert.equal(rows[5].value, "A jacket")
  const muggy = Model.hourDetails({ t: 0, temp: 27, feels: 29, pop: 10, humidity: 60, isDay: true, uv: 7 }, false)
  assert.equal(muggy.find(r => r.label === "Comfort").value, "Muggy")
  assert.equal(muggy.find(r => r.label === "Wear").value, "Sunglasses")
  assert.equal(rows[1].value, "40%  ·  0.4 mm")
  assert.equal(rows[2].value, "20 km/h NW, gusts 45")
  assert.equal(rows[3].value, "81%")
  const calm = Model.hourDetails({ t: 0, feels: NaN, pop: 0, precip: 0, wind: 5, windDir: NaN, gusts: 8, humidity: NaN, uv: 0, isDay: false }, false)
  assert.deepEqual(calm.map(r => r.label), ["Rain", "Wind"])
  assert.equal(calm[0].value, "0%")
  assert.equal(calm[1].value, "5 km/h")
  assert.deepEqual(Model.hourDetails(null, false), [])
})

test("the strip is drawn to each hour and comes to rest on one", () => {
  for (const n of [0, 1, 2, 7]) assert.ok(Math.abs(Model.detent(n, 0.6) - n) < 1e-9, "hours are fixed points")
  assert.ok(Math.abs(Model.detent(0.5, 0.6) - 0.5) < 1e-9, "halfway is balanced")
  assert.ok(Model.detent(0.1, 0.6) < 0.1, "near an hour it lags, as if held")
  assert.ok(Model.detent(0.9, 0.6) > 0.9)
  assert.equal(Model.detent(0.3, 0), 0.3)
  assert.equal(Model.restIndex(3.4, 0, 10), 3)
  assert.equal(Model.restIndex(3.4, 10, 10), 5, "a flick glides on")
  assert.equal(Model.restIndex(-2, 0, 10), 0)
  assert.equal(Model.restIndex(40, 0, 10), 9)
  assert.equal(Model.restIndex(1, 0, 0), 0)
})

// ---- Since yesterday, comfort, nowcast ----------------------------------

function withYesterday(nowTemp, thenTemp) {
  const start = Date.UTC(2026, 9, 14, 0, 0)
  const time = [], temps = []
  for (let i = 0; i < 72; i++) { time.push(new Date(start + i * 3600000).toISOString().slice(0, 16)); temps.push(i === 14 ? thenTemp : 10) }
  return Model.parseForecast(JSON.stringify({
    utc_offset_seconds: 0,
    current: { time: "2026-10-15T14:00", temperature_2m: nowTemp, weather_code: 3, is_day: 1 },
    hourly: { time, temperature_2m: temps, weather_code: time.map(() => 3), is_day: time.map(() => 1) },
    daily: { time: ["2026-10-14", "2026-10-15"], temperature_2m_max: [14, 14], temperature_2m_min: [5, 5], sunrise: ["2026-10-14T07:04", "2026-10-15T07:05"], sunset: ["2026-10-14T18:10", "2026-10-15T18:08"] }
  }), 0)
}

test("this time yesterday, said only when it's noticeable", () => {
  assert.equal(Model.sinceYesterday(withYesterday(8, 13), AT_2PM, false), -5)
  assert.match(Model.secondSentence(withYesterday(8, 12.5), AT_2PM, true), /^8° colder than this time yesterday/)
  assert.match(Model.secondSentence(withYesterday(15, 11), AT_2PM, false), /^4° warmer than this time yesterday/)
  assert.doesNotMatch(Model.secondSentence(withYesterday(12, 11), AT_2PM, false), /yesterday/)
  assert.ok(isNaN(Model.sinceYesterday(synthetic([3]), AT_2PM, false)), "no hours from yesterday: the highs stand in")
})

test("dew point reads as how the air feels", () => {
  assert.ok(Math.abs(Model.dewPoint(20, 50) - 9.3) < 0.2)
  assert.ok(isNaN(Model.dewPoint(20, NaN)))
  assert.equal(Model.comfortWord(5, 18), "Dry")
  assert.equal(Model.comfortWord(13, 22), "Comfortable")
  assert.equal(Model.comfortWord(17, 25), "Sticky")
  assert.equal(Model.comfortWord(19.5, 27), "Muggy")
  assert.equal(Model.comfortWord(23, 31), "Oppressive")
  assert.equal(Model.comfortWord(-4, 3), "Crisp")
  assert.equal(Model.comfortWord(6, 8), "Damp")
  assert.equal(Model.comfortWord(NaN, 8), "")
  // 56°F at 98%: the air is wet, whatever the dew point's band says.
  assert.equal(Model.comfortWord(12.9, 13.3), "Damp")
  assert.equal(Model.comfortWord(21, 22), "Oppressive")
})

test("what to wear, the way a person would say it", () => {
  assert.equal(Model.wearHint(-3, 0, 0, 4, false), "A warm coat and gloves.")
  assert.equal(Model.wearHint(12, 70, 2, 12, true), "A jacket, layers and an umbrella.")
  assert.equal(Model.wearHint(20, 10, 7, 4, true), "Sunglasses.")
  assert.equal(Model.wearHint(20, 10, 7, 4, false), "")
  assert.equal(Model.wearHint(27, 0, 3, 4, true), "T-shirt weather.")
  assert.equal(Model.wearHint(NaN, 0, 0, 0, true), "")
})

test("what to wear is sensible in both °F and °C", () => {
  const f = deg => (deg - 32) * 5 / 9
  // 56°F and drizzly is a light jacket and an umbrella, not a winter coat.
  assert.equal(Model.wearHint(f(56), 70, 0, 4, false), "A light jacket and an umbrella.")
  assert.equal(Model.wearHint(f(48), 0, 0, 4, false), "A jacket.")
  assert.equal(Model.wearHint(f(38), 0, 0, 4, false), "A warm coat.")
  assert.equal(Model.wearHint(f(20), 0, 0, 4, false), "A warm coat and gloves.")
  assert.equal(Model.wearHint(f(68), 0, 0, 4, false), "")
  assert.equal(Model.wearHint(14, 0, 0, 4, false), "A light jacket.")
  assert.equal(Model.wearHint(9, 0, 0, 4, false), "A jacket.")
  assert.equal(Model.wearHint(2, 0, 0, 4, false), "A warm coat.")
  assert.equal(Model.wearHint(-6, 0, 0, 4, false), "A warm coat and gloves.")
})

test("what to wear looks at the hours you'll be out, not the small hours", () => {
  // 13° now, falling to 4° twelve hours later: the night's chill isn't today's coat.
  const time = [], temps = []
  for (let i = 0; i < 48; i++) {
    time.push(new Date(Date.UTC(2026, 9, 15, 14) + i * 3600000).toISOString().slice(0, 16))
    temps.push(13 - Math.min(i, 12) * 0.75)
  }
  const fc = Model.parseForecast(JSON.stringify({
    utc_offset_seconds: 0,
    current: { time: "2026-10-15T14:00", temperature_2m: 13, apparent_temperature: 13, weather_code: 3, is_day: 1 },
    hourly: { time, temperature_2m: temps, apparent_temperature: temps, weather_code: time.map(() => 3), is_day: time.map(() => 1), precipitation_probability: time.map(() => 0) },
    daily: { time: ["2026-10-15", "2026-10-16"] }
  }), 0)
  assert.equal(Model.wearNow(fc, AT_2PM), "A jacket.")
})

function withMinutely(times, precip, current) {
  return synthetic(Array(72).fill(3), { current: current === undefined ? 3 : current, precip: current === 61 ? 0.4 : 0, minutely: { time: times, precipitation: precip } })
}
const Q = ["2026-10-15T14:00", "2026-10-15T14:15", "2026-10-15T14:30", "2026-10-15T14:45", "2026-10-15T15:00", "2026-10-15T15:15", "2026-10-15T15:30", "2026-10-15T15:45"]

test("the nowcast says when rain starts and when it eases", () => {
  const due = withMinutely(Q, [0, 0, 0.3, 0.6, 0.4, 0, 0, 0])
  assert.equal(Model.nowcast(due, AT_2PM, false, "rain").line, "Rain starts in about 25 minutes, easing by 3:15 pm.")
  const falling = withMinutely(Q, [0.5, 0.4, 0.2, 0, 0, 0, 0, 0], 61)
  assert.equal(Model.nowcast(falling, AT_2PM, false, "rain").line, "Rain easing by 2:45 pm.")
  const steady = withMinutely(Q, Q.map(() => 0.5), 61)
  assert.equal(Model.nowcast(steady, AT_2PM, true, "snow").line, "Snow for the next two hours.")
  const late = withMinutely(Q, [0, 0, 0, 0, 0, 0, 0.2, 0.3])
  assert.equal(Model.nowcast(late, AT_2PM, false, "drizzle").line, "Drizzle starts in about 85 minutes, lasting past 4:00 pm.")
  assert.equal(Model.nowcast(withMinutely(Q, Q.map(() => 0)), AT_2PM, false).line, "")
  assert.deepEqual(Model.nowcast(synthetic([3]), AT_2PM, false).slots, [])
})

test("the nowcast sharpens when a spell of rain ends", () => {
  const fc = synthetic(Array(72).fill(61), { current: 61, precip: 0.4, minutely: { time: Q, precipitation: [0.5, 0.4, 0, 0, 0, 0, 0, 0] } })
  const out = Model.precipOutlook(fc, AT_2PM)
  assert.equal(out.state, "now")
  assert.equal(Model.clockText(out.endMs, false), "2:30 pm")
  assert.equal(Model.barHint(out, false), "Rain til 2pm")
})

// ---- Alerts --------------------------------------------------------------

test("the weather service covers the US and nowhere else", () => {
  assert.ok(Model.nwsCovers(46.79, -92.1))   // Duluth
  assert.ok(Model.nwsCovers(61.2, -149.9))   // Anchorage
  assert.ok(Model.nwsCovers(21.3, -157.8))   // Honolulu
  assert.ok(!Model.nwsCovers(35.69, 139.69)) // Tokyo
  assert.ok(!Model.nwsCovers(38.72, -9.14))  // Lisbon
  assert.ok(!Model.nwsCovers(NaN, 0))
  const cmd = Model.alertsCommand(46.78672, -92.10049)
  assert.equal(cmd[cmd.length - 1], "https://api.weather.gov/alerts/active?point=46.7867,-92.1005")
  // The weather service asks for a user agent it can reach someone through.
  assert.ok(cmd.includes(Model.USER_AGENT))
  assert.match(Model.USER_AGENT, /github\.com\/atsokolas\/omarchy-isobar-plugin/)
  assert.ok(Model.curl("https://example.com").includes(Model.USER_AGENT))
})

test("alerts are read, ranked and expired", () => {
  const now = Date.UTC(2026, 9, 15, 14)
  const feature = (p) => ({ properties: Object.assign({ status: "Actual", messageType: "Alert" }, p) })
  const raw = JSON.stringify({ features: [
    feature({ id: "a", event: "Wind Advisory", severity: "Moderate", headline: "Wind Advisory until 7 PM", description: "West winds 25 to 35 mph\nwith gusts to 50.\n\nDowned limbs.", ends: "2026-10-15T19:00:00-05:00" }),
    feature({ id: "b", event: "Tornado Warning", severity: "Extreme", expires: "2026-10-15T15:00:00Z" }),
    feature({ id: "c", event: "Frost Advisory", severity: "Minor", ends: "2026-10-15T13:00:00Z" }),
    feature({ id: "d", event: "Test Message", status: "Test" }),
    feature({ id: "e", event: "Wind Advisory", messageType: "Cancel" })
  ] })
  const alerts = Model.parseAlerts(raw, now)
  assert.deepEqual(alerts.map(a => a.id), ["b", "a"])
  assert.equal(alerts[1].description, "West winds 25 to 35 mph with gusts to 50.\n\nDowned limbs.")
  assert.deepEqual(Model.activeAlerts(alerts, Date.UTC(2026, 9, 15, 16)).map(a => a.id), ["a"])
  assert.equal(Model.parseAlerts("nope", now), null)
  assert.deepEqual(Model.parseAlerts(JSON.stringify({ features: [] }), now), [])
})

test("the humidity tile keeps its line short enough to read whole", () => {
  assert.equal(Model.dewLine("Muggy", "66°"), "Muggy, dew 66°")
  assert.equal(Model.dewLine("Comfortable", "52°"), "Comfortable")
  assert.equal(Model.dewLine("", "52°"), "Dew point 52°")
  for (const w of ["Dry", "Comfortable", "Sticky", "Muggy", "Oppressive", "Crisp", "Damp"])
    assert.ok(Model.dewLine(w, "−12°").length <= 16, w)
})

test("an update to an alert isn't announced as a new one", () => {
  const now = Date.UTC(2026, 9, 15, 14)
  const raw = JSON.stringify({ features: [
    { properties: { id: "urn:2", status: "Actual", messageType: "Update", event: "Wind Advisory", severity: "Moderate", ends: "2026-10-16T07:00:00Z",
      references: [{ "@id": "https://api.weather.gov/alerts/urn:1", identifier: "urn:1" }] } },
    { properties: { id: "urn:9", status: "Actual", messageType: "Alert", event: "Flood Watch", severity: "Severe", ends: "2026-10-16T07:00:00Z" } }
  ] })
  const alerts = Model.parseAlerts(raw, now)
  assert.deepEqual(alerts.find(a => a.id === "urn:2").refs, ["urn:1"])
  assert.deepEqual(Model.freshAlerts(alerts, { "urn:1": now - 3600000 }, now).map(a => a.id), ["urn:9"])
  assert.deepEqual(Model.freshAlerts(alerts, { "urn:2": now, "urn:9": now }, now), [])
  assert.deepEqual(Model.freshAlerts(alerts, {}, now).map(a => a.id).sort(), ["urn:2", "urn:9"])
})

// ---- Delights ------------------------------------------------------------

test("golden hour glows around sunrise and sunset, and only then", () => {
  const fc = synthetic([3])
  const sunset = Date.UTC(2026, 9, 15, 18, 8)
  assert.equal(Model.goldenGlow(fc, sunset), 1)
  assert.equal(Model.goldenGlow(fc, sunset - 8 * 60000), 1)
  const fading = Model.goldenGlow(fc, sunset + 18 * 60000)
  assert.ok(fading > 0 && fading < 1)
  assert.equal(Model.goldenGlow(fc, sunset + 40 * 60000), 0)
  assert.equal(Model.goldenGlow(fc, AT_2PM), 0)
  assert.equal(Model.goldenGlow(null, AT_2PM), 0)
})

test("inside the polar circles there's no golden hour at midnight", () => {
  // Open-Meteo marks polar night and the midnight sun with both ends at 00:00.
  const polar = (rise, set, daylight) => Model.parseForecast(JSON.stringify({
    utc_offset_seconds: 3600,
    current: { time: "2026-10-15T14:00", temperature_2m: -10, weather_code: 3, is_day: 0 },
    hourly: { time: ["2026-10-15T14:00"], temperature_2m: [-10] },
    daily: { time: ["2026-10-15", "2026-10-16"], sunrise: rise, sunset: set, daylight_duration: daylight }
  }), 0)
  const night = polar(["2026-10-15T00:00", "2026-10-16T00:00"], ["2026-10-15T00:00", "2026-10-16T00:00"], [0, 0])
  const day = polar(["2026-10-15T00:00", "2026-10-16T00:00"], ["2026-10-16T00:00", "2026-10-17T00:00"], [86400, 86400])
  const midnight = Date.UTC(2026, 9, 16, 0, 5)
  assert.equal(Model.polar(night.daily[0]), "night")
  assert.equal(Model.polar(day.daily[0]), "day")
  assert.equal(Model.polar(synthetic([3]).daily[1]), "")
  assert.equal(Model.goldenGlow(night, midnight), 0)
  assert.equal(Model.goldenGlow(day, midnight), 0)
  assert.deepEqual(Model.sunEvents(night), [])
  assert.equal(Model.sunEvents(synthetic([3])).length, 6)
  // Without daylight figures, the times alone tell.
  assert.equal(Model.polar({ sunrise: 0, sunset: 0 }), "night")
  assert.equal(Model.polar({ sunrise: 0, sunset: NaN }), "")
})

test("full moons go by their old names", () => {
  assert.equal(Model.fullMoonTonight(Date.UTC(2026, 9, 26, 4)), "Hunter's Moon")
  assert.equal(Model.fullMoonTonight(Date.UTC(2026, 8, 26, 16)), "Harvest Moon")
  assert.equal(Model.fullMoonTonight(Date.UTC(2026, 0, 3, 10)), "Wolf Moon")
  assert.equal(Model.fullMoonTonight(Date.UTC(2026, 4, 31, 8)), "Blue Moon")
  assert.equal(Model.fullMoonTonight(Date.UTC(2026, 9, 15, 12)), "")
  // Every full moon has a name, and a year has twelve or thirteen of them.
  let n = 0
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3600000) {
    const name = Model.fullMoonTonight(t)
    if (name && !Model.fullMoonTonight(t - 3600000)) { n++; assert.match(name, / Moon$/) }
  }
  assert.ok(n === 12 || n === 13, n)
})

function dayOf(max, min, codes, opts) {
  opts = opts || {}
  const start = Date.UTC(2026, 9, 15, 0)
  const time = []
  for (let i = 0; i < 48; i++) time.push(new Date(start + i * 3600000).toISOString().slice(0, 16))
  const temps = time.map((_, i) => i < 24 ? min + (max - min) * Math.sin(Math.PI * Math.max(0, i - 6) / 16) : (opts.night === undefined ? min : opts.night))
  return Model.parseForecast(JSON.stringify({
    utc_offset_seconds: 0,
    current: { time: "2026-10-15T14:00", temperature_2m: max, weather_code: 3, is_day: 1 },
    hourly: { time, temperature_2m: temps, weather_code: time.map((_, i) => codes ? codes(i) : 3), is_day: time.map(() => 1), precipitation_probability: time.map(() => 80) },
    daily: { time: ["2026-10-15", "2026-10-16"], temperature_2m_max: [max, max], temperature_2m_min: [min, min], sunrise: ["2026-10-15T07:05", "2026-10-16T07:06"], sunset: ["2026-10-15T18:08", "2026-10-16T18:06"] }
  }), 0)
}

test("a first of the season is announced once, after a long gap", () => {
  const warm = dayOf(23, 12)
  const fresh = Model.seasonFirsts(warm, AT_2PM, { seen: {} }, true, "Duluth", false)
  assert.deepEqual(fresh.events, [], "no history: remember it, say nothing")
  assert.equal(fresh.seen.warm, "2026-10-15")
  const after = Model.seasonFirsts(warm, AT_2PM, { seen: { warm: "2026-05-20" } }, true, "Duluth", false)
  assert.deepEqual(after.events.map(e => e.title), ["First 70° day since May"])
  assert.equal(after.events[0].body, "Up to 73° in Duluth today.")
  assert.deepEqual(Model.seasonFirsts(warm, AT_2PM, after, true, "Duluth", false).events, [], "once")
  assert.deepEqual(Model.seasonFirsts(warm, AT_2PM, { seen: { warm: "2026-09-30" } }, true, "", false).events, [], "too recent")

  const frost = dayOf(8, 2, null, { night: -2 })
  const f = Model.seasonFirsts(frost, AT_2PM, { seen: { frost: "2026-04-02" } }, false, "", false)
  assert.equal(f.events[0].title, "First frost tonight")
  assert.match(f.events[0].body, /^Down to −2° by midnight\. Bring the plants in\.$/)

  const snow = dayOf(1, -3, i => i >= 20 ? 73 : 3)
  assert.equal(Model.seasonFirsts(snow, AT_2PM, { seen: { snow: "2026-03-01" } }, false, "", false).events.find(e => e.kind === "snow").title, "First snow of the season")
})

test("a place earns a note for snow, storms and extremes, not routine rain", () => {
  const at = (code, temp) => Model.parseForecast(JSON.stringify({
    current: { time: "2026-10-15T14:00", temperature_2m: temp, weather_code: code, is_day: 1 },
    hourly: { time: ["2026-10-15T14:00"], temperature_2m: [temp] }, daily: { time: ["2026-10-15"] }
  }), 0)
  assert.equal(Model.placeNote(at(73, -2), AT_2PM, false, "Tokyo").text, "It's snowing in Tokyo")
  assert.equal(Model.placeNote(at(95, 20), AT_2PM, false, "Lisbon").text, "Thunderstorms over Lisbon")
  assert.equal(Model.placeNote(at(0, 41), AT_2PM, true, "Phoenix").text, "It's 106° in Phoenix")
  assert.equal(Model.placeNote(at(0, -31), AT_2PM, false, "Yakutsk").text, "It's −31° in Yakutsk")
  assert.equal(Model.placeNote(at(63, 12), AT_2PM, false, "Tokyo"), null)
  const alert = [{ id: "x", event: "Heat Advisory", ends: NaN }]
  assert.equal(Model.placeNote(at(0, 30), AT_2PM, false, "Austin", alert, 0).text, "Austin is under a Heat Advisory")
  const note = Model.placeNote(at(73, -2), AT_2PM, false, "Tokyo")
  assert.equal(Model.noteKey("35.690,139.692", note, AT_2PM), "35.690,139.692|snow|2026-10-15")
})

test("the bar never carries more than three places, however shell.json reads", () => {
  const many = [0, 1, 2, 3, 4].map(i => ({ name: "P" + i, latitude: i, longitude: i, onBar: true }))
  assert.equal(Model.barPlaces(many).length, Model.MAX_BAR_PLACES)
})

test("remembered notes and alerts age out", () => {
  const now = Date.UTC(2026, 9, 15)
  const s = Model.pruneState({ seen: { warm: "2026-05-01" }, notes: { a: now - 3600000, b: now - 5 * 86400000 }, alerts: { x: now - 86400000, y: now - 9 * 86400000 } }, now)
  assert.deepEqual(Object.keys(s.notes), ["a"])
  assert.deepEqual(Object.keys(s.alerts), ["x"])
  assert.equal(s.seen.warm, "2026-05-01")
  assert.deepEqual(Model.parseState("garbage"), { seen: {}, notes: {}, alerts: {} })
})
