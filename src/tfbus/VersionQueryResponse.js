// Parse the payload bytes from a VERSION_QUERY (0xF9) response.
// Observed format: [hwType, hwVer, fwApiVer] or [hwType, 0x00, 0x00, 0x01]
export function parseVersionResponse(payload) {
    if (!payload || payload.length < 3)
        return null;
    return {
        hwType: payload[0],
        hwVer: payload[1],
        fwApiVer: payload[2],
        extra: payload.length > 3 ? payload[3] : null,
        raw: payload,
    };
}
