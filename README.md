# Isobar

The weather, drawn in your theme.

![Isobar](preview.png)

A small sky on the bar beside the temperature. When rain is on its way, the bar says when ("Rain in 20m"), and on a dry day it says nothing. Click it for the day ahead: one sentence a person would say, the next 24 hours as one line, and the week as a row of thermometers.

## Features

- **A drawn sky.** The icons are drawn on a Canvas, not set in a font: sun, cloud, fog, drizzle, rain, sleet, snow and storms. Each is a single clean stroke at the bar's 14px and the panel's 72px. At night it draws the moon in its actual phase, with a few stars.
- **Weather that moves, briefly.** Rays turn, rain falls, snow sways, fog drifts and lightning flickers twice, but only while you hover or the panel is open. When the sky changes, the icon pops in. A still bar stays still.
- **A forecast in a sentence.** "Drizzle until about 8 pm. 5° colder than this time yesterday." It says how long the current sky lasts and what comes after, compares the hour with the same hour yesterday when the change is one you'd feel (3° or more), and mentions gusts or a high UV index when they matter. Underneath, what to wear for the next few hours: "A light jacket and an umbrella", or on a good day, "T-shirt weather."
- **The next two hours.** When rain is falling or due, the sentence reads from the fifteen-minute forecast — "Rain starts in about 20 minutes, easing by 8:40 pm" — and a strip of bars shows how hard. The bar's hint uses the same data, so "Rain til 8pm" ends when the rain does.
- **Alerts.** In the US, warnings and advisories from the National Weather Service: a red band at the top of the panel with the event and headline (click for what the forecaster wrote), a small red mark on the bar's sky, and one toast per alert. Outside the US there's no free equivalent, so Isobar shows nothing rather than guessing.
- **Twenty-four hours as one line.** A smooth curve that passes through every hour and never invents a peak between them. It's coloured along its length by temperature, with night as a faint band behind it, sunrise and sunset as dotted hairlines, and the chance of rain as bars beneath. Hover over it, or use `←` `→`, to read any hour.
- **Hour by hour.** Press `h` (or the clock) for the forecast an hour at a time, for home or whichever place is open. Scroll, drag or use `←` `→` and the hours glide under a fixed lens. Free scrolling lingers at each hour, and when you let go the strip springs onto the nearest one, a touch past and back. The hour in the lens is read out large above, with its feels-like, rain, wind, humidity, how the air feels ("Muggy", "Crisp") and what to wear below. Midnight is marked where it falls, and a thin track shows where you are in the week. `↑` `↓` move a day at a time.
- **The week as thermometers.** Each day's low and high sit on the week's shared scale, so a cold snap looks like one. Today's bar shows where the temperature is right now. Pick a day (`↑` `↓`, `1`–`7`, or a click) to put its hours on the chart.
- **The small facts.** A wind compass that points where the wind is going, humidity with how the air feels ("Muggy, dew 66°", "Crisp", "Damp"), UV, air quality (or the pressure trend), and the sun's arc across today. It also shows how much daylight you gained or lost since yesterday, which tells you which way the year is turning.
- **In your theme.** Every colour comes from the current Omarchy theme's `colors.toml`: a yellow sun, blue rain, and a thermometer that runs from the theme's magenta through blue, cyan and green to its red. Change the theme and the panel changes with it.
- **Never blank.** The last good forecast is cached on disk, so the bar has a temperature the moment the shell starts. If the network drops, the panel keeps the last forecast, says how old it is, and retries with backoff (30s, 1m, 2m … up to 10m). After the machine wakes from sleep it fetches a fresh forecast within a minute.
- **Places.** Keep up to eight other cities beside home. The Places page shows each one's sky, temperature and local time, and how far ahead or behind you it is ("14 hours ahead"). Open one to see the full forecast there: its sentence, its hours, its week, its sun. A line underneath compares it with home ("6° warmer than Duluth · 14 hours ahead"). From the forecast, `[` and `]` step from place to place.
- **A heads-up, if you want one.** An optional quiet toast about half an hour before rain or snow, once per spell.
- **Golden hour.** For twenty-odd minutes around sunrise and sunset (not in a polar night or under the midnight sun, where there's neither) the bar's sky warms and glows in the theme's orange — and a place pinned to the bar does the same at its own sunset, which is a nice way to notice it's evening in Tokyo.
- **Full moons, by name.** On the night of a full moon the panel names it — the Hunter's Moon, the Harvest Moon nearest the equinox, a Blue Moon when a month has two — and the moon on the bar gets a little light of its own.
- **Firsts of the season.** "First frost tonight." "First 70° day since May." A quiet toast the first time each happens after a long gap — a few times a year at most. Isobar remembers the last time it saw each, so the first year it's installed it is only learning.
- **Notes from your places.** When something worth mentioning happens somewhere you keep an eye on — snow, a thunderstorm, real heat or cold, an alert — the Places page says so ("It's snowing in Tokyo") and a toast tells you, once per place per day. Routine rain isn't news.

## Install

```bash
omarchy plugin add https://github.com/atsokolas/omarchy-isobar-plugin
```

That clones it into `~/.config/omarchy/plugins/atsokolas.isobar`, checks it against the shell's manifest schema, and offers to put it on the bar (add `--enable` to skip the question). Move it if it didn't land where you want it:

```bash
omarchy bar move atsokolas.isobar --section center --after omarchy.clock
```

Isobar replaces the stock weather widget. To take that one off the bar, delete the `{ "id": "omarchy.weather" }` entry from `bar.layout` in `~/.config/omarchy/shell.json`. The bar reloads on save.

## Location

Isobar reads and writes `~/.local/state/omarchy/settings/weather.json`, the same file Omarchy's own weather widget and `omarchy-weather-location` use, so a location set in any of them applies to all three. Without one, it finds you from your network address.

In the panel, press `/` or click the place name, then search for a city. "Use my location" goes back to automatic.

## Places

Press `p` (or click the globe) for Places, then `a` to add a city. Places are stored in the widget's `shell.json` entry, so they move with the rest of your config.

To keep one in view, press `b` on its row (or click the pin). It joins the bar after home, as its name, its sky and its temperature, and clicking it opens straight to that place's forecast. Three fit on the bar; vertical bars keep to home.

```json
{
  "id": "atsokolas.isobar",
  "places": [
    { "name": "Tokyo", "description": "Tokyo, Japan", "latitude": 35.6895, "longitude": 139.6917, "onBar": true }
  ]
}
```

## Keys

| Key | Action |
| --- | --- |
| `←` `→` | Read the hours on the chart |
| `↑` `↓`, `1`–`7` | Pick a day |
| `t` | Back to now |
| `h` | Hour by hour, and back |
| `p` | Places |
| `[` `]` | Previous / next place |
| `g` | Back home |
| `/` | Change your location |
| `u` | Switch between °C and °F |
| `o` / `Return` | Open the radar at windy.com |
| `c` | Copy the forecast |
| `r` | Refresh |
| `s` | Settings |

On the hour-by-hour page: scroll, drag or `←` `→` an hour, `↑` `↓` a day, `t` now. Click an hour or a spot on the week's track to go there.

On the Places page: `↑` `↓` choose, `Return` opens, `b` puts it on the bar or takes it off, `a` adds, `x` removes.

On the bar: left click opens the panel, middle click refreshes, and right click copies the forecast. A place on the bar opens to its own forecast.

## Settings

Change these on the widget's `shell.json` entry or on the panel's settings page.

| Key | Default | What it does |
|---|---|---|
| `unit` | `auto` | `auto` follows your locale (°F and mph in the US), or set `metric` or `imperial` |
| `showHint` | `true` | "Rain in 20m" beside the temperature, only when it's coming |
| `notify` | `false` | A quiet toast about half an hour before rain or snow |
| `openHours` | `false` | Open the panel on hour by hour rather than the overview |
| `alerts` | `true` | US weather alerts: the band, the bar mark and a toast per alert |
| `firsts` | `true` | A toast for firsts of the season |
| `notes` | `true` | A toast when something notable happens at a saved place |
| `animate` | `true` | The moving sky on hover and in the panel |
| `refreshMinutes` | `15` | How often to fetch, 5–180 |
| `places` | `[]` | Other cities to keep an eye on, up to eight |

## IPC

```bash
omarchy-shell atsokolas.isobar toggle
omarchy-shell atsokolas.isobar now        # 56° Light rain
omarchy-shell atsokolas.isobar summary    # Rain until about 8 pm. 3° cooler than yesterday.
omarchy-shell atsokolas.isobar place
omarchy-shell atsokolas.isobar places     # Tokyo  62°  Mostly clear  7:25 am
omarchy-shell atsokolas.isobar alerts     # Wind Advisory — Wind Advisory until 7 AM
omarchy-shell atsokolas.isobar refresh
```

## Data and privacy

Isobar has no account, no key and no telemetry. To fetch a forecast it has to say where, so these leave the machine:

- **Open-Meteo** ([forecast](https://open-meteo.com/en/docs) and [air quality](https://open-meteo.com/en/docs/air-quality-api)) gets the coordinates of home and of each saved place, every refresh. Weather data by [Open-Meteo.com](https://open-meteo.com/), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Open-Meteo's geocoder** gets what you type into the location and add-a-place searches, and a location name that has no coordinates.
- **The National Weather Service** ([api.weather.gov](https://www.weather.gov/documentation/services-web-api)) gets the coordinates of home and of each saved place inside the US, when alerts are on. Points elsewhere are never sent.
- **ipinfo.io** sees your IP address, and only when you haven't set a location; it answers with roughly where that is.
- **windy.com** opens in your browser with the coordinates, when you ask for the radar (`o`).

Every request is a plain `curl` with an `omarchy-isobar` user agent. Nothing else leaves the machine. Isobar writes its cache under `~/.cache/omarchy/isobar/`, a small memory of firsts and notes it has already mentioned in `~/.local/state/omarchy/isobar/state.json`, the shared location file when you change location, and its own `shell.json` entry when you change a setting.

## Requirements

- Omarchy Quattro (Quickshell plugin support)
- `curl`
- `wl-copy` to copy the forecast

## Tests

The logic lives in `Model.js` as plain functions, so the QML stays thin. The tests run against a real Open-Meteo response, plus synthetic forecasts for the edge cases.

```bash
./tests/run
```

## Remove

```bash
omarchy plugin disable atsokolas.isobar
omarchy plugin remove atsokolas.isobar --yes
```

## License

MIT.
