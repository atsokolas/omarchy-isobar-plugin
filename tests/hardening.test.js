// What a wrong or hostile server can and can't do: answers have a ceiling,
// only https goes out, and words from the network are drawn as words.

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const Model = require("../Model.js")

const root = path.join(__dirname, "..")

// A stand-in curl that streams $FAKE_BYTES bytes in small pieces, the way a
// chunked answer with no declared length arrives, or fails with $FAKE_EXIT.
function fakeCurl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isobar-fetch-"))
  fs.writeFileSync(path.join(dir, "curl"), [
    "#!/usr/bin/env bash",
    "printf '%s\\n' \"$@\" > \"$FAKE_ARGS\"",
    "[ -n \"$FAKE_EXIT\" ] && exit \"$FAKE_EXIT\"",
    "n=$FAKE_BYTES; while [ \"$n\" -gt 0 ]; do c=$(( n < 4096 ? n : 4096 )); head -c \"$c\" /dev/zero | tr '\\0' 'x' || exit 23; n=$(( n - c )); done"
  ].join("\n"), { mode: 0o755 })
  return dir
}

function fetch(cmd, env) {
  const dir = fakeCurl()
  const args = path.join(dir, "args")
  const r = spawnSync(cmd[0], cmd.slice(1), {
    env: Object.assign({}, process.env, { PATH: dir + ":" + process.env.PATH, FAKE_ARGS: args }, env),
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024
  })
  const passed = fs.existsSync(args) ? fs.readFileSync(args, "utf8").trim().split("\n") : []
  fs.rmSync(dir, { recursive: true, force: true })
  return { code: r.status, out: r.stdout, err: r.stderr, args: passed }
}

test("an answer under the ceiling comes through whole", () => {
  const r = fetch(Model.curl("https://api.open-meteo.com/v1/forecast", 5, 64 * 1024), { FAKE_BYTES: "17409" })
  assert.equal(r.code, 0)
  assert.equal(r.out.length, 17409)
})

test("an answer exactly at the ceiling still counts", () => {
  const r = fetch(Model.curl("https://example.com/", 5, 1000), { FAKE_BYTES: "1000" })
  assert.equal(r.code, 0)
  assert.equal(r.out.length, 1000)
})

test("a streamed answer past the ceiling fails, and nothing reaches the parser", () => {
  const r = fetch(Model.curl("https://example.com/", 5, 1000), { FAKE_BYTES: "5000000" })
  assert.notEqual(r.code, 0)
  assert.equal(r.out, "")
})

test("a failed fetch fails", () => {
  const r = fetch(Model.curl("https://example.com/", 5, 1000), { FAKE_BYTES: "10", FAKE_EXIT: "22" })
  assert.notEqual(r.code, 0)
  assert.equal(r.out, "")
})

test("curl is told the ceiling, the timeout, and https only", () => {
  const r = fetch(Model.curl("https://example.com/x?y=1", 7, 4096, ["Accept: application/geo+json"]), { FAKE_BYTES: "1" })
  const a = r.args
  assert.equal(a[a.indexOf("--max-filesize") + 1], "4096")
  assert.equal(a[a.indexOf("--max-time") + 1], "7")
  assert.equal(a[a.indexOf("--proto") + 1], "=https")
  assert.equal(a[a.indexOf("--proto-redir") + 1], "=https")
  assert.equal(a[a.indexOf("-H") + 1], "Accept: application/geo+json")
  assert.equal(a[a.length - 1], "https://example.com/x?y=1")
})

test("anything but https never leaves", () => {
  for (const url of ["http://example.com", "file:///etc/passwd", "ftp://x", "javascript:alert(1)", "", "https://a b"])
    assert.deepEqual(Model.curl(url, 5, 100), ["false"], url)
})

test("every source has a ceiling well above a real answer", () => {
  // Measured 2026-10-16: forecast 17 KB, geocode 3 KB, air and ip under 400 B,
  // alerts for a busy point 8 KB.
  const real = { forecast: 17409, geocode: 2851, air: 346, ip: 324, alerts: 8087 }
  for (const k in real) assert.ok(Model.MAX_BYTES[k] >= real[k] * 10, k)
  assert.ok(Model.alertsCommand(46.7867, -92.1005).includes(String(Model.MAX_BYTES.alerts)))
})

test("markup in a place name stays literal text", () => {
  const raw = JSON.stringify({ results: [
    { name: "<font color=red>Duluth</font>", admin1: "<img src=https://evil.example/x.png>", country: "United States", country_code: "us", latitude: 46.78, longitude: -92.1 }
  ] })
  const [r] = Model.parseGeocodingResults(raw)
  assert.equal(r.name, "<font color=red>Duluth</font>")
  assert.equal(r.description, "<img src=https://evil.example/x.png>, United States")
})

test("server words lose control characters and stop at a sensible length", () => {
  assert.equal(Model.clip("Lake\u0000side\u001b[31m", 80), "Lake side [31m")
  assert.equal(Model.clip("x".repeat(500), 80).length, 80)
  const raw = JSON.stringify({ features: [{ properties: {
    status: "Actual", messageType: "Alert", id: "a", event: "<b>Gale Warning</b>",
    headline: "h".repeat(10000), description: "d".repeat(100000), severity: "<script>", ends: "2099-01-01T00:00:00Z"
  } }] })
  const [a] = Model.parseAlerts(raw, 0)
  assert.equal(a.event, "<b>Gale Warning</b>")
  assert.ok(a.headline.length <= 400 && a.description.length <= 6000)
  assert.equal(a.severity, "Unknown")
})

test("places off the globe are refused", () => {
  assert.equal(Model.parseIpInfo(JSON.stringify({ loc: "1e9,5", city: "Nowhere" })), null)
  assert.equal(Model.parseIpInfo(JSON.stringify({ loc: "95,5" })), null)
  assert.deepEqual(Model.parseGeocodingResults(JSON.stringify({ results: [{ name: "X", latitude: 10, longitude: 400 }] })), [])
  assert.equal(Model.parseIpInfo(JSON.stringify({ loc: "46.78,-92.10", city: "Duluth" })).name, "Duluth")
})

test("every Text in the QML is plain text", () => {
  for (const file of fs.readdirSync(root).filter(f => f.endsWith(".qml"))) {
    const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n")
    lines.forEach((line, i) => {
      if (!/^\s*(component \w+: )?Text \{\s*$/.test(line)) return
      let depth = 1, plain = false
      for (let j = i + 1; j < lines.length && depth > 0; j++) {
        depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length
        if (depth === 1 && /^\s*textFormat: Text\.PlainText\b/.test(lines[j])) plain = true
      }
      assert.ok(plain, file + ":" + (i + 1))
    })
    assert.doesNotMatch(lines.join("\n"), /Text\.(RichText|StyledText|AutoText)/, file)
  }
})
