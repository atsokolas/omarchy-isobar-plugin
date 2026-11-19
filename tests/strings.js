// A stand-in for the shell's Commons.Translations, reading the plugin's own
// i18n/*.json the same way: the language, then its base language, then
// English, then the key itself. Model.js only ever calls t(), tn() and
// number(), so that is all this needs to be.

const fs = require("node:fs")
const path = require("node:path")

const DIR = path.join(__dirname, "..", "i18n")

function catalog(code) {
  const file = path.join(DIR, code + ".json")
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
}

// The CLDR categories, by Omarchy's own rules (vendored in plural.js).
const Plural = require("./plural.js")
const category = (code, count) => Plural.category(code, count)

const pick = (entry, code, count) => Plural.pick(entry, code, count)

// strings("uk"), or strings("xx", { ...a catalog... }) for one made up here.
function strings(code, own, options) {
  code = code || "en"
  const base = code.split("-")[0]
  const layers = [
    [own || (code === "en" ? {} : catalog(code)), code],
    [base !== code && base !== "en" ? catalog(base) : {}, base],
    [catalog("en"), "en"]
  ]
  const decimalSign = (options && options.decimal) || "."
  return {
    language: code,
    t(key, fallback) {
      for (const [layer] of layers) {
        let v = layer[key]
        if (v && typeof v === "object") v = v.other
        if (typeof v === "string" && v.length > 0) return v
      }
      return fallback !== undefined ? fallback : key
    },
    tn(key, count, fallback) {
      for (const [layer, lang] of layers) {
        const v = pick(layer[key], lang, count)
        if (typeof v === "string" && v.length > 0) return v
      }
      return fallback !== undefined ? fallback : key
    },
    number(value, decimals) {
      const s = decimals === undefined ? String(value) : Number(value).toFixed(decimals)
      return s.replace(".", decimalSign)
    }
  }
}

module.exports = { strings, catalog, category, categories: Plural.categories, en: strings("en") }
