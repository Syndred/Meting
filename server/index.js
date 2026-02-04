import http from 'node:http';
import Meting from '../lib/meting.esm.js';

const PORT = Number(process.env.PORT || 3000);

/**
 * Minimal CORS helper (no external deps)
 */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );
}

function sendJsonString(res, payload) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.end(body);
}

function sendError(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/**
 * Query format compatible with meting-api style:
 *   /?server=netease&type=playlist&id=8724039279
 * Also supports:
 *   /api?server=netease&type=search&keyword=xxx&limit=10&page=1
 *
 * Supported type:
 * - search (keyword required; supports page, limit, type(category))
 * - song, album, artist, playlist (id required; artist supports limit)
 * - url (id required; br optional)
 * - lyric (id required)
 * - pic (id required; size optional)
 */
async function asyncMapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const current = idx++;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function truthy(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? '').toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function buildSelfUrl(baseUrl, server, type, id, extra = {}) {
  const sp = new URLSearchParams({
    server: String(server),
    type: String(type),
    id: String(id),
    ...Object.fromEntries(
      Object.entries(extra).filter(([, value]) => value !== undefined && value !== null)
    ),
  });
  return `${baseUrl}/?${sp.toString()}`;
}

function extractUrlField(v) {
  if (v == null) return '';
  if (typeof v === 'string') {
    try {
      const obj = JSON.parse(v);
      return obj?.url ?? v;
    } catch {
      return v;
    }
  }
  if (typeof v === 'object') {
    return v.url ?? '';
  }
  return String(v);
}

async function enrichTracksToDirectLinks(tracks, meting, server, query, baseUrl) {
  // Defaults tuned for player usage
  const br = query.br !== undefined ? Number(query.br) : 320;
  const size = query.size !== undefined ? Number(query.size) : 300;
  const includeLrc = query.lrc === undefined ? true : truthy(query.lrc);

  // concurrency: avoid hammering upstream
  const concurrency = query.concurrency !== undefined ? Math.max(1, Number(query.concurrency)) : 6;

  return await asyncMapLimit(tracks, concurrency, async (t) => {
    const urlId = t.url_id ?? t.id ?? t.urlId;
    const picId = t.pic_id ?? t.picId;
    const lyricId = t.lyric_id ?? t.lyricId ?? t.id;

    const urlRes = urlId ? await meting.url(urlId, br) : t.url;
    const picRes = picId ? await meting.pic(picId, size) : t.pic;

    const out = {
      name: t.name,
      artist: Array.isArray(t.artist) ? t.artist.join(' / ') : t.artist,
      url: extractUrlField(urlRes),
      pic: extractUrlField(picRes),
      lrc: includeLrc && lyricId ? buildSelfUrl(baseUrl, server, 'lyric', lyricId) : undefined,
    };

    // keep some extra fields if present (useful for debugging)
    if (t.id !== undefined) out.id = t.id;
    if (t.album !== undefined) out.album = t.album;
    return out;
  });
}

async function handleMeting(query, baseUrl) {
  const server = query.server || 'netease';
  const type = (query.type || '').toString().toLowerCase();

  const meting = new Meting(server);
  const isFormat = truthy(query.format);
  meting.format(isFormat);

  // Normalize some common aliases
  const t =
    type === 'songs' ? 'song'
    : type === 'artists' ? 'artist'
    : type === 'albums' ? 'album'
    : type;

  if (!t) {
    throw new Error('Missing query param: type');
  }

  let result;

  if (t === 'search') {
    const keyword = query.keyword ?? query.s;
    if (!keyword) throw new Error('Missing query param: keyword');
    const option = {
      ...pick(query, ['type', 'page', 'limit']),
    };
    // cast numeric
    if (option.type !== undefined) option.type = Number(option.type);
    if (option.page !== undefined) option.page = Number(option.page);
    if (option.limit !== undefined) option.limit = Number(option.limit);

    result = await meting.search(String(keyword), option);
  } else if (t === 'song') {
    const id = query.id;
    if (!id) throw new Error('Missing query param: id');
    result = await meting.song(id);
  } else if (t === 'album') {
    const id = query.id;
    if (!id) throw new Error('Missing query param: id');
    result = await meting.album(id);
  } else if (t === 'artist') {
    const id = query.id;
    if (!id) throw new Error('Missing query param: id');
    const limit = query.limit !== undefined ? Number(query.limit) : undefined;
    result = await meting.artist(id, limit);
  } else if (t === 'playlist') {
    const id = query.id;
    if (!id) throw new Error('Missing query param: id');
    result = await meting.playlist(id);
  } else if (t === 'url') {
    const id = query.id;
    if (!id) throw new Error('Missing query param: id');
    const br = query.br !== undefined ? Number(query.br) : undefined;
    result = await meting.url(id, br);
  } else if (t === 'lyric') {
    const id = query.id;
    if (!id) throw new Error('Missing query param: id');
    result = await meting.lyric(id);
  } else if (t === 'pic') {
    const id = query.id;
    if (!id) throw new Error('Missing query param: id');
    const size = query.size !== undefined ? Number(query.size) : undefined;
    result = await meting.pic(id, size);
  } else {
    throw new Error(`Unsupported type: ${t}`);
  }

  // If formatted list returns *_id fields, optionally resolve to direct links.
  // Default: when format=true, resolve unless resolve=false
  const shouldResolve = isFormat && (query.resolve === undefined ? true : truthy(query.resolve));
  if (shouldResolve) {
    let parsed = result;
    let wasString = false;

    if (typeof result === 'string') {
      try {
        parsed = JSON.parse(result);
        wasString = true;
      } catch {
        // ignore: not JSON
      }
    }

    if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'object') {
      // If it already contains url/pic, keep as-is.
      // Note: some providers return empty string "" for url/pic in formatted mode.
      // Treat empty string as missing so we can resolve to direct links.
      const first = parsed[0];
      const urlMissing = first.url === undefined || first.url === null || first.url === '';
      const picMissing = first.pic === undefined || first.pic === null || first.pic === '';
      const hasResolvableId =
        first.id !== undefined || first.url_id !== undefined || first.pic_id !== undefined;
      if ((urlMissing || picMissing) && hasResolvableId) {
        const enriched = await enrichTracksToDirectLinks(parsed, meting, server, query, baseUrl);
        result = wasString ? JSON.stringify(enriched) : enriched;
      }
    }
  }

  return result;
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Only support GET for now
    if (req.method !== 'GET') {
      sendError(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    // Health check
    if (url.pathname === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Accept both "/" and "/api"
    if (url.pathname !== '/' && url.pathname !== '/api') {
      sendError(res, 404, { error: 'Not Found' });
      return;
    }

    const query = Object.fromEntries(url.searchParams.entries());

    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = forwardedProto ? String(forwardedProto).split(',')[0].trim() : 'http';
    const forwardedHost = req.headers['x-forwarded-host'];
    const host = forwardedHost ? String(forwardedHost).split(',')[0].trim() : (req.headers.host || 'localhost');
    const baseUrl = `${proto}://${host}`;

    const result = await handleMeting(query, baseUrl);
    sendJsonString(res, result);
  } catch (e) {
    sendError(res, 500, {
      error: 'Meting API Error',
      message: e?.message || String(e),
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[meting-api] listening on http://0.0.0.0:${PORT}`);
  console.log(`[meting-api] examples:`);
  console.log(`  - http://localhost:${PORT}/?server=netease&type=playlist&id=8724039279`);
  console.log(`  - http://localhost:${PORT}/api?server=netease&type=search&keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6&limit=5`);
});
