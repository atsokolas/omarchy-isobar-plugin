import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

BarWidget {
  id: root
  moduleName: "atsokolas.isobar"

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  function refresh() {
    if (panelLoader.item && panelLoader.item.refresh) panelLoader.item.refresh()
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  function open() {
    if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  readonly property var service: panelLoader.item ? panelLoader.item.service : null
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  readonly property bool ready: !!(service && service.current)
  readonly property string tempLabel: service ? service.tempLabel : ""
  readonly property string hint: service && !root.vertical ? service.hint : ""

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  IpcHandler {
    target: "atsokolas.isobar"
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function refresh(): string { root.refresh(); return "ok" }
    // The service is shared across monitors, so these read the one forecast.
    function now(): string {
      var s = root.service
      if (!s || !s.current) return ""
      return s.tempLabel + " " + Model.conditionLabel(s.current.code, s.current.isDay)
    }
    function summary(): string { return root.service ? root.service.sentence : "" }
    function place(): string { return root.service ? root.service.placeName : "" }
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  Connections {
    target: root.service
    ignoreUnknownSignals: true
    function onSkyChanged() { icon.play() }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: ""
    labelVisible: false
    hasVisualContent: true
    fixedWidth: root.vertical ? -1 : Math.max(12, content.implicitWidth + button.scaledHorizontalMargin * 2)
    fixedHeight: root.vertical ? content.implicitHeight + button.scaledVerticalPadding * 2 : -1
    foreground: root.opened ? Color.accent : (root.bar ? root.bar.barForeground : Color.foreground)
    tooltipText: root.service ? Model.tooltipText(root.service.forecast, root.service.localNow, root.service.imperial, root.service.placeName) : Model.APP_NAME
    horizontalMargin: 8.75
    verticalPadding: 6

    onPressed: function(b) {
      if (b === Qt.RightButton) { if (root.service) root.service.copySummary() }
      else if (b === Qt.MiddleButton) root.refresh()
      else root.togglePanel()
    }

    Item {
      id: content
      anchors.fill: parent

      readonly property real gap: Style.spaceReal(6)
      readonly property bool hintVisible: root.hint !== ""
      readonly property real implicitWidth: root.vertical
        ? icon.width
        : icon.width + (tempText.visible ? gap + tempText.implicitWidth : 0) + (hintVisible ? gap + hintText.implicitWidth : 0)
      readonly property real implicitHeight: root.vertical ? icon.height + (tempText.visible ? Style.spaceReal(2) + tempText.implicitHeight : 0) : icon.height

      SkyIcon {
        id: icon
        kind: root.service ? root.service.kind : "cloudy"
        night: root.service ? root.service.night : false
        strength: root.service ? root.service.strength : 1
        moonPhase: root.service ? root.service.moonPhase : 0.5
        iconSize: Math.round(button.fontSize * 1.18)
        iconColor: button.foreground
        animated: !!(root.service && root.service.animate) && (hover.hovered || root.opened)
        opacity: root.ready ? 1 : 0.45
        x: root.vertical ? (parent.width - width) / 2 : button.scaledHorizontalMargin
        y: root.vertical ? button.scaledVerticalPadding : (parent.height - height) / 2

        Behavior on opacity { NumberAnimation { duration: 400 } }
      }

      Text {
        id: tempText
        visible: text !== ""
        x: root.vertical ? (parent.width - width) / 2 : icon.x + icon.width + content.gap
        y: root.vertical ? icon.y + icon.height + Style.spaceReal(2) : (parent.height - height) / 2
        text: root.tempLabel
        color: button.foreground
        font.family: button.fontFamily
        font.pixelSize: root.vertical ? Style.font.caption : button.fontSize
        font.features: { "tnum": 1 }
        renderType: Text.NativeRendering
      }

      // Only when it's coming. A dry day keeps the bar quiet.
      Text {
        id: hintText
        visible: content.hintVisible
        x: tempText.x + tempText.width + content.gap
        anchors.verticalCenter: parent.verticalCenter
        text: root.hint
        color: Qt.rgba(button.foreground.r, button.foreground.g, button.foreground.b, 0.62)
        font.family: button.fontFamily
        font.pixelSize: button.fontSize
        renderType: Text.NativeRendering
      }

      HoverHandler { id: hover }
    }
  }
}
