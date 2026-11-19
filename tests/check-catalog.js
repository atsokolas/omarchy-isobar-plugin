#!/usr/bin/env node
// Checks translations: node tests/check-catalog.js de fr pt-BR
// (no codes: every catalog in i18n/). Exits non-zero on a problem.
//
// A catalog must be complete (every English key), fill the same %N slots as
// English, give every plural form its language uses, only add per-weather
// variants of keys that exist, and turn out sentences with no catalog keys
// left in them. Strings identical to English are listed as warnings: some
// are right (units, "UV"), most mean a word was missed.

const fs = require("node:fs")
const path = require("node:path")
const Model = require("../Model.js")
const { strings, catalog, categories } = require("./strings.js")

const EN = catalog("en")
const DIR = path.join(__dirname, "..", "i18n")
const LOCALES = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "locales.json"), "utf8"))
const slots = s => [...new Set(String(s).match(/%[1-9]/g) || [])].sort().join(" ")
const forms = v => typeof v === "string" ? [v] : Object.values(v)
const SAME_OK = /^(%\d|[\s·←→↑↓\[\]+−%:,.0-9°\-]|UV|AQI|US|EU|Open-Meteo|Isobar|Omarchy|km\/h|mph|in|mm|hPa|inHg|Return|Esc|[a-z])*$/

// Variant keys a catalog may add: "<key>.<noun or sky id>".
const VARIANT_IDS = new Set(["drizzle", "freezingDrizzle", "rain", "heavyRain", "freezingRain", "snow", "heavySnow",
  "showers", "heavyShowers", "snowShowers", "thunderstorms", "storms", "sunny", "clear", "mostlyClear", "partlyCloudy", "cloudy", "foggy"])
const VARIANT_BASES = /^(hint\.|nowcast\.|first\.|toast\.headsUp$|firsts\.snow\.body$)/

function check(code) {
  const errors = [], warnings = []
  const file = path.join(DIR, code + ".json")
  if (!LOCALES[code]) errors.push(`"${code}" is not an Omarchy language code`)
  let c
  try { c = JSON.parse(fs.readFileSync(file, "utf8")) } catch (e) { return { errors: [`${code}.json: ${e.message}`], warnings } }
  const needed = categories(code)
  for (const key of Object.keys(EN)) if (!(key in c)) errors.push(`missing ${key}`)
  for (const [key, v] of Object.entries(c)) {
    let base = key
    // A label's mid-sentence form, where lowering its first letter is wrong.
    if (/^conditionInline\./.test(key)) {
      if (!(("condition." + key.slice(16)) in EN)) errors.push(`unknown key ${key}`)
      else if (typeof v !== "string" || !v.trim()) errors.push(`${key}: not a string`)
      continue
    }
    if (!(key in EN)) {
      const dot = key.lastIndexOf(".")
      base = key.slice(0, dot)
      if (!(base in EN) || !VARIANT_IDS.has(key.slice(dot + 1)) || !VARIANT_BASES.test(base)) { errors.push(`unknown key ${key}`); continue }
    }
    if (typeof v !== "string" && !(v && typeof v === "object" && typeof v.other === "string")) { errors.push(`${key}: not a string or plural entry`); continue }
    const want = slots(forms(EN[base])[forms(EN[base]).length - 1])
    for (const f of forms(v)) {
      if (!f.trim() && EN[base] !== "") errors.push(`${key}: empty`)
      const got = slots(f)
      // A plural "one" may spell its count out ("an hour") and drop that slot.
      const dropped = want.split(" ").filter(s => s && !got.includes(s))
      if (got.split(" ").some(s => s && !want.includes(s))) errors.push(`${key}: slot ${got} not in English (${want})`)
      else if (dropped.length > (typeof v === "object" ? 1 : 0)) errors.push(`${key}: misses ${dropped.join(" ")}`)
    }
    if (typeof v === "object") {
      for (const f of needed) if (typeof v[f] !== "string") errors.push(`${key}: lacks plural form "${f}" (${code} uses ${needed.join("/")})`)
      for (const f of Object.keys(v)) if (!needed.includes(f) && f !== "other") warnings.push(`${key}: "${f}" is never used in ${code}`)
    }
    if (key in EN && typeof v === "string" && v === EN[key] && !SAME_OK.test(v)) warnings.push(`same as English: ${key} = ${JSON.stringify(v)}`)
  }
  // Every sentence comes out whole: no key or stray slot left in it.
  if (errors.length === 0) {
    const tr = strings(code)
    for (const s of sample(tr)) if (/(^|\s)[a-z]+\.[a-zA-Z.]+\b|%[1-9]/.test(s)) errors.push(`left in a sentence: ${JSON.stringify(s)}`)
  }
  return { errors, warnings }
}

// A sweep of what Isobar says, enough to reach every sentence family.
function sample(tr) {
  const out = []
  const fc = (codes, current, extra) => {
    const t0 = Date.UTC(2026, 9, 15)
    const hours = Array.from({ length: 72 }, (_, i) => new Date(t0 + i * 3600000).toISOString().slice(0, 16))
    const code = i => codes[Math.min(i, codes.length - 1)]
    return Model.parseForecast(JSON.stringify({
      current: { time: "2026-10-15T14:00", temperature_2m: 12, weather_code: current, is_day: 1, precipitation: Model.condition(current).wet ? 1 : 0, wind_gusts_10m: 60 },
      hourly: { time: hours, temperature_2m: hours.map((_, i) => 8 + i % 7), weather_code: hours.map((_, i) => code(i)), precipitation_probability: hours.map((_, i) => Model.condition(code(i)).wet ? 80 : 0), is_day: hours.map((_, i) => i % 24 >= 7 && i % 24 < 19 ? 1 : 0) },
      daily: { time: ["2026-10-14", "2026-10-15", "2026-10-16"], temperature_2m_max: [9, 14, 15], temperature_2m_min: [1, 2, 3], weather_code: [3, 3, 3], uv_index_max: [7, 7, 7] },
      minutely_15: extra || { time: [], precipitation: [] }
    }), 0)
  }
  const at = Date.UTC(2026, 9, 15, 14, 5)
  for (const c of [0, 1, 2, 3, 45, 51, 56, 61, 65, 66, 71, 75, 80, 82, 85, 95]) {
    const f = fc([c], c)
    out.push(Model.sentence(tr, f, at, false, false), Model.sentence(tr, fc([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, c], 1), at, false, false))
    const o = Model.precipOutlook(f, at)
    out.push(Model.barHint(tr, o, false), Model.headsUpTitle(tr, { state: "soon", minutes: 20, noun: Model.condition(c).noun }))
    for (const s of [0, 2]) {
      const m = { time: Array.from({ length: 8 }, (_, i) => new Date(at - 300000 + i * 900000).toISOString().slice(0, 16)), precipitation: Array.from({ length: 8 }, (_, i) => i >= s && i < s + 3 ? 1 : 0) }
      out.push(Model.nowcast(tr, fc([c], c, m), at, true, Model.condition(c).noun).line)
    }
    out.push(Model.copyPayload(tr, f, at, false, true, "Oslo"))
  }
  for (const n of [1, 2, 3, 5, 11, 21, 22, 25, 100]) out.push(Model.ageText(tr, 1, 1 + n * 60000), Model.ageText(tr, 1, 1 + n * 86400000), Model.offsetText(tr, n * 3600, 0), Model.offsetText(tr, 0, n * 3600 + 1800))
  out.push(Model.compareLine(tr, fc([0], 0), fc([0], 0), false, ""))
  return out.filter(Boolean)
}

if (require.main === module) {
  const codes = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(DIR).filter(f => f.endsWith(".json") && f !== "en.json").map(f => f.slice(0, -5))
  let bad = 0
  for (const code of codes) {
    const { errors, warnings } = check(code)
    console.log(`${errors.length ? "✖" : "✔"} ${code}: ${errors.length} errors, ${warnings.length} same-as-English`)
    for (const e of errors.slice(0, 40)) console.log("   error   " + e)
    for (const w of warnings.slice(0, 40)) console.log("   warning " + w)
    if (errors.length) bad++
  }
  process.exit(bad ? 1 : 0)
}

module.exports = { check }
