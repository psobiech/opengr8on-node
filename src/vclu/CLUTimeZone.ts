/** IANA timezone IDs indexed by CLU TIME_ZONE feature value (0-22). */
export const CLU_TIMEZONE_IDS = [
  'Europe/Warsaw',                   // 0
  'Europe/London',                   // 1
  'Europe/Moscow',                   // 2
  'Europe/Istanbul',                 // 3
  'Europe/Athens',                   // 4
  'Asia/Dubai',                      // 5
  'Asia/Jakarta',                    // 6
  'Asia/Hong_Kong',                  // 7
  'Australia/Sydney',                // 8
  'Australia/Perth',                 // 9
  'Australia/Brisbane',              // 10
  'Pacific/Auckland',                // 11
  'Pacific/Honolulu',                // 12
  'America/Anchorage',               // 13
  'America/Chicago',                 // 14
  'America/New_York',                // 15
  'America/Barbados',                // 16
  'America/Sao_Paulo',               // 17
  'America/Bogota',                  // 18
  'America/Argentina/Buenos_Aires',  // 19
  'America/Chicago',                 // 20
  'America/Los_Angeles',             // 21
  'UTC',                             // 22
] as const;

export function cluTimeZoneId(index: number): string {
  return CLU_TIMEZONE_IDS[Math.max(0, Math.min(index, CLU_TIMEZONE_IDS.length - 1))] ?? 'UTC';
}
