const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.join(__dirname, "..")
const read = name => fs.readFileSync(path.join(root, name), "utf8")
const qml = fs.readdirSync(root).filter(f => f.endsWith(".qml"))

test("panel uses the scoped bar API when changing hover reveal state", () => {
  const panel = read("Panel.qml")
  assert.match(panel, /typeof root\.bar\.setCenterHoverRevealSuppressed === "function"/)
  assert.doesNotMatch(panel, /root\.bar\.centerHoverRevealSuppressed\s*=/)
})

test("the manifest's entry points exist and agree on the id", () => {
  const manifest = JSON.parse(read("manifest.json"))
  assert.equal(manifest.schemaVersion, 1)
  for (const file of Object.values(manifest.entryPoints)) assert.ok(fs.existsSync(path.join(root, file)), file)
  for (const file of ["BarWidget.qml", "Panel.qml"]) assert.match(read(file), new RegExp(`"${manifest.id.replace(".", "\\.")}"`))
  const keys = manifest.barWidget.schema.map(s => s.key)
  for (const key of Object.keys(manifest.barWidget.defaults)) assert.ok(keys.includes(key), `default ${key} has a schema row`)
})

test("colours come from the theme, not from surfaces plugins can't see", () => {
  // The shell's Color singleton isn't reliably there for third-party
  // plugins; reading it logs a TypeError and paints nothing.
  for (const file of qml) assert.doesNotMatch(read(file), /\bColor\./, file)
})

test("no development hooks ship", () => {
  for (const file of qml) assert.doesNotMatch(read(file), /DEV-SNAPSHOT|grabToImage/, file)
})

test("the icon is throttled rather than repainting every frame", () => {
  const icon = read("SkyIcon.qml")
  assert.doesNotMatch(icon, /NumberAnimation on t/)
  assert.match(icon, /interval: 40/)
})

test("h reaches hour by hour, though the key catcher reads it as left", () => {
  // PanelKeyCatcher turns h/j/k/l into moves before onTextKey sees them.
  const panel = read("Panel.qml")
  assert.match(panel, /id: keyFront[\s\S]*?event\.text === "h"[\s\S]*?root\.toggleHours\(\)/)
  assert.match(panel, /focusTarget: keyFront/)
  assert.doesNotMatch(panel, /keyCatcher\.forceActiveFocus/)
})
