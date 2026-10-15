import QtQuick
import "Model.js" as Model

// Everything the panel reads off one forecast, worked out in one place, so
// home and every saved place go through the same code.
QtObject {
  property var forecast: null
  property var air: null
  property bool imperial: false
  property bool use24: false
  property real nowMs: Date.now()

  readonly property real localNow: forecast ? Model.nowLocal(nowMs, forecast.offset) : nowMs
  readonly property var current: forecast ? forecast.current : null
  readonly property var outlook: Model.precipOutlook(forecast, localNow)
  readonly property var todayData: Model.today(forecast, localNow)
  readonly property var yesterdayData: Model.yesterday(forecast, localNow)
  readonly property var weekData: Model.week(forecast, localNow)
  readonly property string sentence: Model.sentence(forecast, localNow, imperial, use24)

  // The forecast's own is_day flag, which knows about polar days.
  readonly property string kind: current ? Model.iconKind(current.code) : "cloudy"
  readonly property bool night: current ? !current.isDay : false
  readonly property int strength: current ? Model.condition(current.code).strength : 1
}
