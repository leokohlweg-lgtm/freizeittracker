// Datenzugriff: alles läuft lokal auf dem Gerät (kein Server).
// Die Ansichten rufen weiterhin api("/api/...") auf; local.js beantwortet diese Aufrufe.
import { handle, ApiErr } from "./local/local.js";

export { ApiErr };

export async function api(path, { method = "GET", body } = {}) {
  try {
    return await handle(path, method, body);
  } catch (e) {
    if (e instanceof ApiErr) throw e;
    console.error(e);
    throw new ApiErr(500, { error: "intern", message: "Unerwarteter Fehler: " + (e.message || e) });
  }
}
