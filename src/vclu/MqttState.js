export function mqttStateFrom(value) {
    return (typeof value === 'boolean' ? value : value !== 0) ? 'ON' : 'OFF';
}
export function mqttBrightnessState(brightness) {
    return { state: brightness > 0 ? 'ON' : 'OFF', color_mode: 'brightness', brightness };
}
export function mqttRgbwState(r, g, b, w) {
    const on = r + g + b + w > 0;
    return {
        state: on ? 'ON' : 'OFF',
        color_mode: 'rgbw',
        brightness: Math.max(r, g, b, w),
        color: { r, g, b, w },
    };
}
export function parseShutterState(s) {
    const u = s.toUpperCase();
    return ['OPEN', 'OPENING', 'CLOSE', 'CLOSING', 'STOP'].includes(u) ? u : null;
}
export const MQTT_PRESS_EVENT = { event_type: 'press' };
