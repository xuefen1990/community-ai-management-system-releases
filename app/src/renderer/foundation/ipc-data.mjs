// Electron IPC accepts structured-cloneable values, but Vue reactive objects
// are Proxy instances and cannot be passed through ipcRenderer.invoke().
// Convert request data to a plain object first while keeping the JSON-shaped
// data contract used by the foundation business APIs.
export function toIpcData(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const item of value) result.push(toIpcData(item, seen));
    return result;
  }
  const result = {};
  seen.set(value, result);
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (typeof item === 'function' || typeof item === 'symbol') continue;
    result[key] = toIpcData(item, seen);
  }
  return result;
}
