const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const port = Number(process.env.PORT || 8000);
const rootDir = __dirname;

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripHtml(value = '') {
  return decodeHtml(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        resolve(fetchText(new URL(response.headers.location, url).toString()));
        return;
      }
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
    });
    request.on('error', reject);
  });
}

function extractCurseForgeImages(html) {
  const urls = new Set();
  const add = (value) => {
    if (!value) return;
    const normalized = String(value).replace(/&amp;/g, '&').trim();
    if (/^https?:\/\//i.test(normalized) && /\.(png|jpe?g|gif|webp|avif|mp4|webm|ogg|mov)(?:[?#].*)?$/i.test(normalized)) {
      urls.add(normalized);
    }
  };

  [...html.matchAll(/(?:src|data-src|srcset|poster)=["']([^"']+)["']/gi)].forEach((match) => {
    const rawValue = match[1];
    if (/^https?:\/\//i.test(rawValue)) {
      add(rawValue);
      return;
    }
    if (rawValue.includes(',')) {
      rawValue.split(',').forEach((chunk) => {
        const candidate = chunk.trim().split(/\s+/)[0];
        add(candidate);
      });
    }
  });

  [...html.matchAll(/https?:\/\/[^\s"'<>]+(?:\.(?:png|jpe?g|gif|webp|avif|mp4|webm|ogg|mov))(?:[?#][^\s"'<>]*)?/gi)].forEach((match) => add(match[0]));

  return [...urls].slice(0, 12);
}

function parseCurseForge(html) {
  const totalTextMatch = html.match(/results-count[^>]*>\s*([^<]+?)\s*Projects?/i) || html.match(/>(\d[\d,]+(?:\+)?)[^\d]*Projects?/i) || html.match(/(\d[\d,]+(?:\+)?)[^<]*Projects?/i);
  const totalRaw = totalTextMatch ? String(totalTextMatch[1] || totalTextMatch[0]).trim() : '';
  const total = totalRaw ? Number.parseInt(totalRaw.replace(/[^0-9]/g, ''), 10) || 0 : 0;
  const cardPattern = /<div\s+class="[^"]*\bproject-card\b[^"]*">([\s\S]*?)(?=<div\s+class="[^"]*\bproject-card\b[^"]*"|$)/g;
  const cards = [...html.matchAll(cardPattern)];
  const items = cards.map((match) => {
    const chunk = match[1];
    const title = stripHtml((chunk.match(/<a class="name"[^>]*>\s*<span class="ellipsis">([^<]+)<\/span>/i) || [])[1] || 'CurseForge project');
    const href = (chunk.match(/<a class="name"[^>]*href="([^"]+)"/i) || [])[1] || '/minecraft/search';
    const fullUrl = href.startsWith('http') ? href : `https://www.curseforge.com${href}`;
    if (/\/mc-mods\/|\/modpacks\/|\/resource-packs\/|\/data-packs\//i.test(href)) return null;
    const creator = stripHtml((chunk.match(/<a class="author-name is-link"[^>]*>\s*<span class="ellipsis">([^<]+)<\/span>/i) || [])[1] || 'Unknown creator');
    const description = stripHtml((chunk.match(/<p class="description">([^<]+)<\/p>/i) || [])[1] || 'Minecraft plugin from CurseForge.');
    const downloads = (chunk.match(/<li class="detail-downloads">([^<]+)<\/li>/i) || [])[1] || '0';
    const updated = (chunk.match(/<span class="date-full">([^<]+)<\/span>/i) || [])[1] || 'Unknown date';
    const image = (chunk.match(/<img[^>]+src="([^"]+)"/i) || [])[1];
    const iconUrl = image ? (image.startsWith('http') ? image : `https://www.curseforge.com${image}`) : '';
    const images = [iconUrl].filter(Boolean);
    const numericDownloads = Number.parseFloat(String(downloads).replace(/[^0-9.]/g, '').replace(/,/g, '')) || 0;
    let value = numericDownloads;
    if (/k/i.test(String(downloads))) value *= 1000;
    if (/m/i.test(String(downloads))) value *= 1000000;
    return {
      id: `curseforge-${encodeURIComponent(fullUrl)}`,
      name: title,
      creator,
      source: 'CurseForge',
      sources: ['CurseForge'],
      platform: ['Paper', 'Spigot'],
      editions: ['Java Edition', 'Bukkit', 'Spigot', 'Paper'],
      versions: ['1.21', '1.20', '1.19'],
      price: 'Free',
      priceLabel: 'Free',
      icon: title.charAt(0).toUpperCase() || 'C',
      iconUrl,
      iconClass: 'icon-orange',
      category: 'Minecraft plugin',
      downloads: String(Math.round(value)),
      downloadValue: Math.round(value),
      downloadSources: [{ source: 'CurseForge', value: Math.round(value) }],
      updatedAt: new Date(updated).getTime() || Date.now(),
      updated: 'recent',
      age: 0,
      popularity: Math.round(value),
      description,
      images,
      url: fullUrl,
      links: [{ label: 'CurseForge project', url: fullUrl }],
    };
  });

  return { total, items: items.filter(Boolean) };
}

async function handleApiRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/curseforge') {
    const page = Number(url.searchParams.get('page') || 0);
    const pageSize = Number(url.searchParams.get('pageSize') || 50);
    const search = url.searchParams.get('search') || '';
    const requestedClass = url.searchParams.get('class') || 'bukkit-plugins';
    const requestedSort = url.searchParams.get('sort') || 'downloadCount';
    const validSorts = new Set(['relevancy', 'downloadCount', 'lastUpdated', 'featured']);
    const sort = validSorts.has(requestedSort) ? requestedSort : 'downloadCount';
    const classPart = requestedClass ? `&class=${encodeURIComponent(requestedClass)}` : '';
    const searchPart = search ? `&search=${encodeURIComponent(search)}` : '';
    const target = `https://www.curseforge.com/minecraft/search?page=${page + 1}&pageSize=${Math.min(Math.max(pageSize, 20), 50)}&sortBy=${encodeURIComponent(sort)}${classPart}${searchPart}`;
    const html = await fetchText(target);
    const payload = parseCurseForge(html);
    sendJson(response, 200, payload);
    return;
  }

  if (pathname === '/api/hangar') {
    const limit = Number(url.searchParams.get('limit') || 20);
    const offset = Number(url.searchParams.get('offset') || 0);
    const query = url.searchParams.get('query') || '';
    const requestedSort = url.searchParams.get('sort') || '-downloads';
    const validSorts = new Set(['-downloads', 'downloads', 'views', '-views', '-updated', 'updated']);
    const sort = validSorts.has(requestedSort) ? requestedSort : '-downloads';
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sort: String(sort) });
    if (query) params.set('query', query);
    const target = `https://hangar.papermc.io/api/v1/projects?${params.toString()}`;
    const text = await fetchText(target);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { result: [], pagination: { count: 0, limit, offset } };
    }
    sendJson(response, 200, payload);
    return;
  }

  if (pathname === '/api/curseforge-images') {
    const projectUrl = url.searchParams.get('url');
    if (!projectUrl) {
      sendJson(response, 400, { error: 'Missing project URL' });
      return;
    }
    try {
      const html = await fetchText(projectUrl);
      sendJson(response, 200, { images: extractCurseForgeImages(html) });
    } catch (error) {
      sendJson(response, 502, { error: error.message || 'Unable to fetch images' });
    }
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function serveStaticFile(request, response) {
  const pathname = request.url === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname;
  const filePath = path.join(rootDir, pathname);
  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.json': 'application/json; charset=utf-8',
      '.ico': 'image/x-icon'
    };

    response.writeHead(200, {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    response.end();
    return;
  }

  if (request.url.startsWith('/api/')) {
    handleApiRequest(request, response);
    return;
  }

  serveStaticFile(request, response);
});

server.listen(port, () => {
  console.log(`Plugin list server running at http://localhost:${port}`);
});
