// Console logging with a HH:MM:SS prefix, so send spacing and rate limiting are visible in the logs.
const stamp = () => new Date().toTimeString().slice(0, 8);

export const log = (...args: unknown[]) => console.log(stamp(), ...args);
export const warn = (...args: unknown[]) => console.warn(stamp(), ...args);
export const error = (...args: unknown[]) => console.error(stamp(), ...args);
