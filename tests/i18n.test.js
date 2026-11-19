// Isobar in other languages: every word comes from i18n/*.json, sentences
// are whole catalog strings a language can reorder, and nothing English is
// glued in from the code.

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Model = require("../Model.js")
const { strings, catalog, category, en } = require("./strings.js")

const root = path.join(__dirname, "..")
const read = name => fs.readFileSync(path.join(root, name), "utf8")
const EN = catalog("en")
const languages = fs.readdirSync(path.join(root, "i18n")).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, ""))

const RAW = read("tests/fixtures/duluth.json")
const FC = Model.parseForecast(RAW, 1792100488006)
const NOW = FC.current.t + 5 * 60000

// A forecast built hour by hour, for the sentences the fixture doesn't reach.
function synthetic(codes, opts) {
  opts = opts || {}
  const start = Date.UTC(2026, 9, 15, 0, 0)
  const hours = []
  for (let i = 0; i < 72; i++) hours.push(new Date(start + i * 3600000).toISOString().slice(0, 16))
  const code = i => codes[Math.min(i, codes.length - 1)]
  return Model.parseForecast(JSON.stringify({
    utc_offset_seconds: 0,
    current: { time: "2026-10-15T14:00", temperature_2m: opts.temp === undefined ? 12 : opts.temp, weather_code: opts.current === undefined ? code(14) : opts.current, is_day: 1, precipitation: opts.precip || 0, wind_gusts_10m: opts.gusts },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 10 + Math.sin(i / 4) * 4 + (opts.shift && i >= 24 ? opts.shift : 0)),
      precipitation_probability: hours.map((_, i) => Model.condition(code(i)).wet ? 80 : 0),
      weather_code: hours.map((_, i) => code(i)),
      is_day: hours.map((_, i) => (i % 24 >= 7 && i % 24 < 19) ? 1 : 0)
    },
    daily: {
      time: ["2026-10-14", "2026-10-15", "2026-10-16"],
      temperature_2m_max: [14, 14, 15], temperature_2m_min: [6, 7, 8], weather_code: [3, 3, 3],
      sunrise: ["2026-10-14T07:04", "2026-10-15T07:05", "2026-10-16T07:06"],
      sunset: ["2026-10-14T18:10", "2026-10-15T18:08", "2026-10-16T18:06"],
      daylight_duration: [40000, 39820, 39650], uv_index_max: [7, 7, 7]
    },
    minutely_15: opts.minutely || { time: [], precipitation: [] }
  }), 0)
}
const AT_2PM = Date.UTC(2026, 9, 15, 14, 5)

// Every sentence the model can say, near enough: each branch of the two
// sentences, the nowcast, hints, notes and firsts, over many skies.
function everything(tr) {
  const out = []
  const push = (...xs) => xs.forEach(x => { if (x) out.push(x) })
  const skies = [[0], [1], [2], [3], [45], [61], [65], [71], [95], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]]
  for (const codes of skies) {
    for (const current of [undefined, 0, 63, 75]) {
      const fc = synthetic(codes, { current, precip: current ? 1 : 0, gusts: 50, shift: 4 })
      push(Model.sentence(tr, fc, AT_2PM, false, false), Model.sentence(tr, fc, AT_2PM, true, true))
      const o = Model.precipOutlook(fc, AT_2PM)
      push(Model.barHint(tr, o, false), Model.headsUpTitle(tr, Object.assign({}, o, { minutes: 25 })))
      push(Model.copyPayload(tr, fc, AT_2PM, false, false, "Duluth"), Model.tooltipText(tr, fc, AT_2PM, false, "Duluth"))
      push(Model.placeNote(tr, fc, AT_2PM, false, "Tokyo", [], 0) && Model.placeNote(tr, fc, AT_2PM, false, "Tokyo", [], 0).text)
    }
  }
  // Later today and tomorrow, at every part of the day.
  for (let h = 0; h < 24; h += 3) {
    const codes = Array(72).fill(1)
    for (let i = 16 + h; i < 72; i++) codes[i] = 61
    push(Model.firstSentence(tr, synthetic(codes, { current: 1 }), AT_2PM, false))
  }
  // The nowcast, raining now and starting soon.
  const mins = start => ({ time: Array.from({ length: 8 }, (_, i) => new Date(AT_2PM - 5 * 60000 + i * 900000).toISOString().slice(0, 16)), precipitation: Array.from({ length: 8 }, (_, i) => i >= start && i < start + 3 ? 1 : 0) })
  for (const s of [0, 2, 5]) push(Model.nowcast(tr, synthetic([61], { minutely: mins(s) }), AT_2PM, false, "rain").line)
  push(Model.sentence(tr, FC, NOW, false, false), Model.sentence(tr, FC, NOW, true, true))
  // Readings, words, times.
  for (let n = 0; n < 24; n++) push(Model.hourText(tr, Date.UTC(2026, 0, 1, n), false), Model.spokenHour(tr, Date.UTC(2026, 0, 1, n), false), Model.clockText(tr, Date.UTC(2026, 0, 1, n, 5), false))
  for (const uv of [1, 4, 7, 9, 12]) push(Model.uvLabel(tr, uv))
  for (const d of [-5, 3, 12, 17, 19, 23]) push(Model.comfortWord(tr, d, 22))
  for (const f of [-10, 0, 8, 15, 26]) push(Model.wearHint(tr, f, 60, 7, 12, true))
  for (const p of [0, 0.25, 0.5, 0.75]) push(Model.moonName(tr, p))
  for (const off of [0, 900, 1800, 2700, 3600, 5400, 50400, -19800]) push(Model.offsetText(tr, off, 0))
  push(Model.ageText(tr, 1, 1), Model.ageText(tr, 1, 600001), Model.ageText(tr, 1, 7200001), Model.ageText(tr, 1, 86400001), Model.ageText(tr, 1, 1 + 86400000 * 3))
  push(Model.daylightDeltaText(tr, 100, 0), Model.daylightDeltaText(tr, 0, 30), Model.durationText(tr, 40000))
  push(Model.aqiReading(tr, { us: 120, eu: 70 }, true).label, Model.aqiReading(tr, { us: 120, eu: 70 }, false).label)
  push(Model.fullMoonTonight(tr, Date.UTC(2026, 9, 26, 4)))
  for (const h of Model.hourDetails(tr, Object.assign({}, FC.hourly[30], { isDay: true, uv: 7, gusts: 80 }), false)) push(h.label, h.value)
  return out
}

// ---------------------------------------------------------------------------
// The catalogs

test("each catalog is flat JSON of strings and plural entries", () => {
  for (const lang of languages) {
    const c = catalog(lang)
    for (const [key, v] of Object.entries(c)) {
      if (typeof v === "string") continue
      assert.ok(v && typeof v === "object" && typeof v.other === "string", `${lang} ${key}`)
      for (const form of Object.keys(v)) assert.ok(["zero", "one", "two", "few", "many", "other"].includes(form), `${lang} ${key} ${form}`)
    }
  }
})

// The keys Model.js and the QML ask for by name, and the families they build
// from ids ("condition." + id), which must each be whole in English.
function keysAskedFor() {
  const named = new Set()
  const sources = [read("Model.js")].concat(fs.readdirSync(root).filter(f => f.endsWith(".qml")).map(read))
  for (const src of sources)
    for (const m of src.matchAll(/(?:\b(?:say|sayN|sayAbout|sayAboutN|has)\((?:tr|root\.strings|strings), |root\.(?:t|say|sayN)\(|\bfail\(|root\.fail\()"([a-zA-Z0-9.]+)"(?=[,)])/g))
      named.add(m[1])
  return named
}

const FAMILIES = {
  "condition.": ["sunny", "0", "1", "2", "3", "45", "48", "51", "53", "55", "56", "61", "63", "65", "66", "71", "73", "75", "77", "80", "81", "82", "85", "86", "95", "96", "cloudy"],
  "noun.": ["drizzle", "freezingDrizzle", "rain", "heavyRain", "freezingRain", "snow", "heavySnow", "showers", "heavyShowers", "snowShowers", "thunderstorms"],
  "short.": ["rain", "snow", "storms", "drizzle", "showers"],
  "sky.": ["sunny", "clear", "mostlyClear", "partlyCloudy", "cloudy", "foggy"],
  "weekday.": ["0", "1", "2", "3", "4", "5", "6"],
  "weekday.short.": ["0", "1", "2", "3", "4", "5", "6"],
  "since.": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
  "fullMoon.": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
  "compass.": ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
  "windWord.": ["calm", "lightAir", "lightBreeze", "gentleBreeze", "freshBreeze", "strongBreeze", "nearGale", "gale", "stormForce"],
  "uv.": ["low", "moderate", "high", "veryHigh", "extreme"],
  "second.uv.": ["high", "veryHigh", "extreme"],
  "aqi.us.": ["good", "moderate", "sensitive", "unhealthy", "veryUnhealthy", "hazardous"],
  "aqi.eu.": ["good", "fair", "moderate", "poor", "veryPoor", "extremelyPoor"],
  "aqi.": ["us", "eu"],
  "moon.": ["new", "waxingCrescent", "firstQuarter", "waxingGibbous", "full", "waningGibbous", "lastQuarter", "waningCrescent"],
  "comfort.": ["crisp", "damp", "dry", "comfortable", "sticky", "muggy", "oppressive"],
  "wear.": ["warmCoat", "gloves", "jacket", "lightJacket", "layers", "umbrella", "sunglasses"],
  "pressure.": ["rising", "falling", "steady"],
  "first.": ["dryRestOfDay", "dryThroughNight"],
  "first.later.": ["around", "overnight", "tomorrowMorning", "tomorrowAfternoon", "tomorrowEvening", "tomorrowNight"],
  "daylight.": ["gainedMinutes", "lostMinutes", "gainedSeconds", "lostSeconds"],
  "offset.": ["quarterAhead", "halfAhead", "threeQuartersAhead", "quarterBehind", "halfBehind", "threeQuartersBehind", "hoursAhead", "hoursBehind", "fractionHoursAhead", "fractionHoursBehind"],
  "nowcast.": ["anyMinuteEasing", "anyMinuteLasting", "inMinutesEasing", "inMinutesLasting"],
  "time.hour.": ["am", "pm"], "time.spoken.": ["am", "pm"], "time.clock.": ["am", "pm"],
  "firsts.": ["upTo", "upToPlace", "freeze.body", "freeze.bodyPlace"],
  "sun.": ["light", "lightDelta", "moonLight", "moonLightDelta"],
  "error.": ["offline", "garbled", "noLocation", "notFound"],
  "settings.": ["showHint", "notify", "openHours", "alerts", "firsts", "notes", "animate"].flatMap(k => [k, k + "Meta"])
}

test("every word the code asks for is in English, and English has nothing extra", () => {
  const expected = keysAskedFor()
  for (const [prefix, ids] of Object.entries(FAMILIES)) for (const id of ids) expected.add(prefix + id)
  for (const key of expected) assert.ok(key in EN, `en.json lacks ${key}`)
  for (const key of Object.keys(EN)) assert.ok(expected.has(key), `en.json has ${key}, which nothing asks for`)
})

test("a translation provides every plural form its language uses", () => {
  for (const lang of languages.filter(l => l !== "en")) {
    const needed = [...new Set(Array.from({ length: 200 }, (_, n) => category(lang, n)))]
    for (const [key, v] of Object.entries(catalog(lang)))
      if (v && typeof v === "object") for (const form of needed) assert.ok(typeof v[form] === "string", `${lang} ${key} lacks "${form}"`)
  }
})

test("the QML asks the catalog rather than writing words of its own", () => {
  for (const file of fs.readdirSync(root).filter(f => f.endsWith(".qml"))) {
    const src = read(file)
    for (const m of src.matchAll(/^\s*(?:text|tooltipText|title|meta|label|sub|placeholderText):\s*(.*)$/gm)) {
      const literals = (m[1].replace(/\b(?:t|say|sayN)\((?:root\.strings, |s\.strings, )?"[^"]*"|[!=]== "[^"]*"/g, "").match(/"[^"]*"/g) || []).filter(l => /[A-Za-z]{3,}/.test(l) && !/^"(auto|metric|imperial)"$/.test(l))
      // Brand names stay as they are.
      assert.deepEqual(literals.filter(l => l !== '"Open-Meteo"'), [], `${file}: ${m[0].trim()}`)
    }
  }
})

// ---------------------------------------------------------------------------
// The sentences

// Every catalog letter replaced with x: whatever English survives was glued
// in by code rather than coming from a catalog.
function pseudo() {
  const c = {}
  const blank = s => s.replace(/%[1-9]/g, m => "\u0000" + m[1]).replace(/[A-Za-z]/g, ch => ch === ch.toUpperCase() ? "X" : "x").replace(/\u0000(\d)/g, "%$1")
  for (const [k, v] of Object.entries(EN)) c[k] = typeof v === "string" ? blank(v) : Object.fromEntries(Object.entries(v).map(([f, s]) => [f, blank(s)]))
  return strings("xx", c)
}

test("no English is glued into a sentence from the code", () => {
  const said = everything(pseudo())
  assert.ok(said.length > 150, `only ${said.length} things said`)
  for (const s of said) {
    // Units, place names and the moon's ½ stay as they are.
    const rest = s.replace(/\b(km\/h|mph|mm|in|inHg|hPa|Duluth|Tokyo)\b/g, "")
    assert.doesNotMatch(rest, /[A-WYZa-wyz]/, JSON.stringify(s))
  }
})

test("in English, every sentence is still what it was", () => {
  // A few the older tests don't pin, said in full.
  const later = Array(72).fill(1)
  for (let i = 30; i < 72; i++) later[i] = 61
  assert.equal(Model.firstSentence(en, synthetic(later, { current: 1 }), AT_2PM, false), "Mostly clear now, rain tomorrow morning.")
  assert.equal(Model.copyPayload(en, FC, NOW, false, false, "Duluth").split(". ")[0].replace(/^Duluth: [^,]+, /, ""), Model.conditionLabel(en, FC.current.code, FC.current.isDay).toLowerCase())
  assert.equal(Model.headsUpTitle(en, { state: "soon", minutes: 23, noun: "heavySnow" }), "Snow in about 25 minutes")
  assert.equal(Model.offsetText(en, 3600, 0), "1 hour ahead")
  assert.equal(Model.offsetText(en, 5400, 0), "1½ hours ahead")
  assert.equal(Model.ageText(en, 1, 1 + 86400000 * 3), "3 days ago")
})

test("a language can put the words in its own order", () => {
  const tr = strings("xx", {
    "first.wetUntil": "Until %2: %1.",
    "second.two": "%2; %1.",
    "sentence.join": "%2 / %1",
    "list.last": "%2 after %1"
  })
  const fc = synthetic([63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 3], { current: 63, precip: 1, gusts: 60 })
  // The noun stays small in the middle; the sentence still starts with a capital.
  assert.equal(Model.sentence(tr, fc, AT_2PM, false, false), "Gusts to 60 km/h; about as warm as yesterday. / Until 5 pm: rain.")
  assert.equal(Model.wearPhrase(tr, 10, 80, 0, 0, false), "An umbrella after a jacket")
})

test("a language can say one weather's sentence its own way", () => {
  const tr = strings("xx", { "noun.snow": "snow", "first.wetUntil": "%1 until %2.", "first.wetUntil.snow": "Snowing until %2." })
  const snow = synthetic([73, 73, 73, 73, 73, 73, 73, 73, 73, 73, 73, 73, 73, 73, 73, 73, 3], { current: 73, precip: 1 })
  const rain = synthetic([63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 3], { current: 63, precip: 1 })
  assert.equal(Model.firstSentence(tr, snow, AT_2PM, false), "Snowing until 4 pm.")
  assert.equal(Model.firstSentence(tr, rain, AT_2PM, false), "Rain until 4 pm.")
})

test("counts take the language's plural forms", () => {
  const tr = strings("uk", { "age.minutes": { one: "%1 хвилину тому", few: "%1 хвилини тому", many: "%1 хвилин тому", other: "%1 хвилини тому" } })
  assert.equal(Model.ageText(tr, 1, 1 + 21 * 60000), "21 хвилину тому")
  assert.equal(Model.ageText(tr, 1, 1 + 23 * 60000), "23 хвилини тому")
  assert.equal(Model.ageText(tr, 1, 1 + 25 * 60000), "25 хвилин тому")
})

test("a missing word falls back to English, then to its key", () => {
  const tr = strings("xx", { "day.today": "Heute" })
  assert.equal(Model.dayLabel(tr, AT_2PM, AT_2PM), "Heute")
  assert.equal(Model.dayLabel(tr, AT_2PM + 86400000, AT_2PM), "Tomorrow")
  assert.equal(Model.say(tr, "no.such.key"), "no.such.key")
  // Without a catalog at all, keys rather than a crash.
  assert.equal(Model.dayLabel(null, AT_2PM, AT_2PM), "day.today")
})

test("a place's name is put in whole, never read as a slot", () => {
  const tr = strings("xx", { "note.heat": "%2: %1" })
  const hot = synthetic([0], { current: 0, temp: 38 })
  assert.equal(Model.placeNote(tr, hot, AT_2PM, false, "%1 and %2", [], 0).text, "%1 and %2: 38°")
  assert.equal(Model.fill("%1 %2", ["%2", "x"]), "%2 x")
})

test("decimals take the language's separator", () => {
  const tr = strings("xx", {}, { decimal: "," })
  assert.equal(Model.precipText(tr, 1.24, false), "1,2 mm")
  assert.equal(Model.pressureText(tr, 1013, true), "29,91 inHg")
  assert.equal(Model.precipText(en, 1.24, false), "1.2 mm")
})

test("the place search asks for names in the panel's language", () => {
  assert.match(Model.geocodeQuery("Lviv", "uk"), /&language=uk&/)
  assert.match(Model.geocodeQuery("Lviv", "pt-BR"), /&language=pt&/)
  assert.match(Model.geocodeQuery("Lviv", "x\"; rm"), /&language=en&/)
  assert.match(Model.geocodeQuery("Lviv"), /&language=en&/)
})

test("the catalogs are found when the shell loads the plugin from a qs:/// URL", () => {
  // Translations reads file:// or a bare path; Qt.resolvedUrl in a plugin is qs:///.
  const src = read("Service.qml")
  assert.match(src, /directory: String\(Qt\.resolvedUrl\("i18n"\)\)\.replace\(\/\^\[a-z\]\+:\\\/\\\/\/, ""\)/)
  assert.equal("qs:///home/me/.config/omarchy/plugins/x/i18n".replace(/^[a-z]+:\/\//, ""), "/home/me/.config/omarchy/plugins/x/i18n")
})

test("every shipped translation is complete and well formed", () => {
  const { check } = require("./check-catalog.js")
  for (const lang of languages.filter(l => l !== "en")) {
    const { errors } = check(lang)
    assert.deepEqual(errors, [], lang)
  }
})
