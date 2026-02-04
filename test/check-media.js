import Meting from '../lib/meting.esm.js';
import http from 'node:http';
import https from 'node:https';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function requestOnce(url, method, headers = {}) {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method,
        headers: {
          'User-Agent': 'Meting-Media-Check/1.0',
          ...headers,
        },
        timeout: 15000,
      },
      (res) => {
        // we only care headers; avoid downloading body
        res.resume();
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function probeUrl(url) {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const head = await requestOnce(current, 'HEAD');
    const sc = head.statusCode ?? 0;

    // Redirect
    if ([301, 302, 303, 307, 308].includes(sc) && head.headers.location) {
      current = new URL(head.headers.location, current).toString();
      continue;
    }

    // Some CDNs may not support HEAD well; fallback to minimal GET
    if (sc === 405 || sc === 400) {
      const get = await requestOnce(current, 'GET', { Range: 'bytes=0-0' });
      return { finalUrl: current, ...get, via: 'GET(range)' };
    }

    return { finalUrl: current, ...head, via: 'HEAD' };
  }

  throw new Error('Too many redirects');
}

async function main() {
  const meting = new Meting('netease');
  meting.format(true);

  const songs = JSON.parse(await meting.search('烟火里的尘埃', { limit: 1 }));
  if (!songs?.length) throw new Error('No search result');

  const song = songs[0];

  const mp3 = JSON.parse(await meting.url(song.url_id, 320))?.url;
  const pic = JSON.parse(await meting.pic(song.pic_id, 300))?.url;

  console.log('Song:', `${song.name} - ${song.artist?.join(', ')}`);
  console.log('MP3 URL:', mp3);
  console.log('PIC URL:', pic);

  // small delay to reduce rate-limit risk
  await sleep(800);

  const mp3Probe = await probeUrl(mp3);
  console.log('MP3 PROBE:', {
    via: mp3Probe.via,
    statusCode: mp3Probe.statusCode,
    contentType: mp3Probe.headers['content-type'],
    contentLength: mp3Probe.headers['content-length'],
    finalUrl: mp3Probe.finalUrl,
  });

  await sleep(800);

  const picProbe = await probeUrl(pic);
  console.log('PIC PROBE:', {
    via: picProbe.via,
    statusCode: picProbe.statusCode,
    contentType: picProbe.headers['content-type'],
    contentLength: picProbe.headers['content-length'],
    finalUrl: picProbe.finalUrl,
  });
}

main().catch((e) => {
  console.error('CHECK FAILED:', e?.stack || e);
  process.exitCode = 1;
});
