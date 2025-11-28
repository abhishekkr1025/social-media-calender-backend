// utils.js (ESM)

export const sleep = (ms) => new Promise(res => setTimeout(res, ms));

export function backoff(attempts, base = 2000, cap = 600000) {
  // exponential backoff with jitter (ms)
  const exp = Math.min(cap, base * 2 ** attempts);
  const jitter = Math.floor(Math.random() * 1000);
  return exp + jitter;
}

export function log(...args) {
  console.log(new Date().toISOString(), ...args);
}
