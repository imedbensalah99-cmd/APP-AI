// OMDA AI Company — FreeLLMAPI encrypted-backup bridge.
// Deploy as a Cloudflare module Worker with D1 binding BACKUPS and secret BACKUP_TOKEN.
// D1 schema and setup: see README.md. No provider secrets are embedded in this file.
const CHUNK = 49152;
const MAX = 10485760;
function out(s, c = 200) {
  return new Response(s, { status: c, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
}
function encode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 16384) {
    s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  }
  return btoa(s);
}
function decode(s) {
  const b = atob(s);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/freellmapi.db.backup") return out("Not found", 404);
    if (!env.BACKUP_TOKEN || request.headers.get("Authorization") !== "Bearer " + env.BACKUP_TOKEN) {
      return out("Unauthorized", 401);
    }
    if (request.method === "GET") {
      const meta = await env.BACKUPS.prepare("SELECT current_version,bytes FROM backup_meta WHERE id=1").first();
      if (!meta) return out("No backup", 404);
      const rows = await env.BACKUPS.prepare(
        "SELECT idx,payload FROM backup_chunks WHERE version=? ORDER BY idx ASC"
      ).bind(meta.current_version).all();
      const chunks = rows.results || [];
      let parts = [], total = 0;
      for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].idx !== i) return out("Backup incomplete", 503);
        const b = decode(chunks[i].payload);
        parts.push(b);
        total += b.length;
      }
      if (total !== meta.bytes) return out("Backup size mismatch", 503);
      const body = new Uint8Array(total);
      let p = 0;
      for (const b of parts) { body.set(b, p); p += b.length; }
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Backup-Size": String(total)
        }
      });
    }
    if (request.method !== "PUT") return out("Method not allowed", 405);
    if (Number(request.headers.get("content-length") || 0) > MAX) return out("Backup too large", 413);
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.length < 36 || buf.length > MAX) return out("Invalid backup size", 400);
    const magic = [70, 65, 80, 73, 66, 75, 49, 0]; // FAPIBK1\\0
    if (!magic.every((v, i) => buf[i] === v)) return out("Encrypted backup format required", 400);
    const version = crypto.randomUUID(), stmts = [];
    for (let i = 0, p = 0; p < buf.length; i++, p += CHUNK) {
      stmts.push(env.BACKUPS.prepare(
        "INSERT INTO backup_chunks(version,idx,payload) VALUES(?,?,?)"
      ).bind(version, i, encode(buf.subarray(p, Math.min(p + CHUNK, buf.length)))));
    }
    for (let i = 0; i < stmts.length; i += 40) await env.BACKUPS.batch(stmts.slice(i, i + 40));
    await env.BACKUPS.prepare(
      "INSERT INTO backup_meta(id,current_version,bytes,updated_at) VALUES(1,?,?,datetime('now')) " +
      "ON CONFLICT(id) DO UPDATE SET current_version=excluded.current_version," +
      "bytes=excluded.bytes,updated_at=excluded.updated_at"
    ).bind(version, buf.length).run();
    await env.BACKUPS.prepare("DELETE FROM backup_chunks WHERE version<>?").bind(version).run();
    return out("Backup stored", 200);
  }
};
