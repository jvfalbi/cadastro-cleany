const DAYS_START = 0;
const DAYS_LENGTH = 19;
const SECONDS_START = DAYS_START + DAYS_LENGTH + 1;
const SECONDS_LENGTH = 12;
const NANOS_START = SECONDS_START + SECONDS_LENGTH;
const NANOS_LENGTH = 7;
export function readDateTimeExtended(buffer) {
    const days = parseBigInt(buffer.slice(DAYS_START, DAYS_START + DAYS_LENGTH));
    const seconds = parseBigInt(buffer.slice(SECONDS_START, SECONDS_START + SECONDS_LENGTH));
    const nanos = parseBigInt(buffer.slice(NANOS_START, NANOS_START + NANOS_LENGTH)) * 100n;
    return format(days, seconds, nanos);
}
function parseBigInt(buffer) {
    return BigInt(buffer.toString("ascii"));
}
function format(days, seconds, nanos) {
    // NOTE: replace with Temporal API once its available
    const date = new Date(0);
    date.setUTCFullYear(1);
    date.setUTCDate(date.getUTCDate() + Number(days));
    date.setUTCSeconds(date.getUTCSeconds() + Number(seconds));
    let result = "";
    result += date.getFullYear().toString().padStart(4, "0");
    result += `.${(date.getUTCMonth() + 1).toString().padStart(2, "0")}`;
    result += `.${date.getUTCDate().toString().padStart(2, "0")}`;
    result += ` ${date.getUTCHours().toString().padStart(2, "0")}`;
    result += `:${date.getUTCMinutes().toString().padStart(2, "0")}`;
    result += `:${date.getUTCSeconds().toString().padStart(2, "0")}`;
    result += `.${nanos.toString().padStart(9, "0")}`;
    return result;
}
