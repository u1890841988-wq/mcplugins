let plugins = [];
const savedStoreKey = 'plugin-atlas-saved';
const reviewStoreKey = 'plugin-atlas-reviews';
const knownFreeSpigotResources = new Set(['12056', '15320']);
let nextPage = 0;
let loading = false;
let requestId = 0;

const state = { search: '', sources: new Set(), platforms: new Set(), editions: new Set(), prices: new Set(), version: 'all', quick: 'all', sort: 'downloads', saved: new Set(), view: 'catalog', sourceCounts: { Modrinth: 0, Spigot: 0, CurseForge: 0, Hangar: 0 } };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const bindIfExists = (selector, type, handler) => {
  const element = $(selector);
  if (element) element.addEventListener(type, handler);
};

function init() {
  try {
    state.saved = new Set(JSON.parse(localStorage.getItem(savedStoreKey) || '[]'));
  } catch {
    state.saved = new Set();
  }
  buildFilterOptions();
  bindEvents();
  syncViewFromHash();
  loadPlugins(true);
  if (window.lucide) lucide.createIcons();
}

function buildFilterOptions() {
  const options = {
    sourceFilters: ['Modrinth', 'Spigot', 'CurseForge', 'Hangar'],
    platformFilters: ['Paper', 'Spigot', 'Velocity', 'Folia', 'Bukkit'],
    editionFilters: ['Java Edition', 'Bukkit', 'Spigot', 'Paper', 'Velocity', 'Folia'],
    priceFilters: ['Free', 'Paid']
  };
  Object.entries(options).forEach(([id, values]) => {
    const select = $(`#${id}`);
    select.innerHTML = `<option value="all">Any ${id.replace('Filters', '').replace('edition', 'game edition')}</option>${values.map((value) => `<option value="${value}">${value}</option>`).join('')}`;
    select.dataset.filter = id.replace('Filters', '');
    select.addEventListener('change', (event) => {
      const collection = state[`${event.target.dataset.filter}s`];
      collection.clear();
      if (event.target.value !== 'all') collection.add(event.target.value);
      loadPlugins(true);
    });
  });
}

function bindEvents() {
  let searchTimer;
  const navigateToHash = (nextHash) => {
    if (window.location.hash === nextHash) {
      syncViewFromHash();
      return;
    }
    window.location.hash = nextHash;
  };

  const searchInput = $('#searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => { state.search = event.target.value.trim(); clearTimeout(searchTimer); searchTimer = setTimeout(() => loadPlugins(true), 280); });
  }

  bindIfExists('#filterToggle', 'click', () => {
    const panel = $('#filtersPanel');
    const button = $('#filterToggle');
    if (!panel || !button) return;
    const isOpen = panel.hasAttribute('hidden');
    if (isOpen) {
      panel.removeAttribute('hidden');
      button.setAttribute('aria-expanded', 'true');
    } else {
      panel.setAttribute('hidden', 'hidden');
      button.setAttribute('aria-expanded', 'false');
    }
    button.classList.toggle('active', !panel.hidden);
  });

  bindIfExists('#versionFilter', 'change', (event) => { state.version = event.target.value; loadPlugins(true); });

  const sortSelect = $('#sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (event) => { state.sort = event.target.value; loadPlugins(true); });
  }

  bindIfExists('#clearFilters', 'click', clearFilters);
  bindIfExists('#loadMore', 'click', () => loadPlugins(false));

  const activeFilters = $('#activeFilters');
  if (activeFilters) {
    activeFilters.addEventListener('click', (event) => {
      const filter = event.target.closest('[data-remove-filter]');
      if (!filter) return;
      removeActiveFilter(filter.dataset.removeFilter, filter.dataset.value);
    });
  }

  $$('.source-tab').forEach((tab) => tab.addEventListener('click', () => {
    const source = tab.dataset.source;
    state.sources = source === 'all' ? new Set() : new Set([source]);
    syncSourceTabState();
    syncCheckboxes();
    loadPlugins(true);
  }));

  $$('.chip').forEach((chip) => chip.addEventListener('click', () => {
    state.quick = chip.dataset.quick;
    if (state.quick === 'skript') {
      state.search = 'skript';
      if (searchInput) searchInput.value = 'skript';
    }
    if (state.quick === 'downloads') {
      state.sort = 'downloads';
      if (sortSelect) sortSelect.value = 'downloads';
    }
    $$('.chip').forEach((item) => item.classList.toggle('active', item === chip));
    state.view = 'catalog';
    loadPlugins(true);
  }));

  $$('.topnav a').forEach((link) => link.addEventListener('click', (event) => {
    const href = link.getAttribute('href');
    if (!href || href === '#') return;
    const nextHash = href.startsWith('#') ? href : `#${href}`;
    event.preventDefault();
    navigateToHash(nextHash);
  }));

  const savedButton = $('#savedButton');
  if (savedButton) {
    savedButton.addEventListener('click', (event) => {
      event.preventDefault();
      const drawer = $('#detailsDrawer');
      const drawerContent = $('#drawerContent');
      const isOpen = drawer && drawer.classList.contains('open');
      if (isOpen && drawerContent && drawerContent.textContent.includes('Bookmarks')) {
        closeDrawer();
        return;
      }
      openBookmarksDrawer();
    });
  }

  const scrollTopButton = $('#scrollTopButton');
  const toggleScrollTopButton = () => {
    if (!scrollTopButton) return;
    scrollTopButton.hidden = window.scrollY < 320;
  };
  if (scrollTopButton) {
    scrollTopButton.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  window.addEventListener('scroll', toggleScrollTopButton, { passive: true });
  toggleScrollTopButton();

  const drawerContent = $('#drawerContent');
  if (drawerContent) {
    drawerContent.addEventListener('click', (event) => {
      const savedPlugin = event.target.closest('[data-open-plugin]');
      if (savedPlugin) openDrawer(savedPlugin.dataset.openPlugin);
      const removeSavedPlugin = event.target.closest('[data-remove-saved]');
      if (removeSavedPlugin) {
        state.saved.delete(removeSavedPlugin.dataset.removeSaved);
        persistSaved();
        render();
        openBookmarksDrawer();
      }
      const media = event.target.closest('[data-full-media]');
      if (media) openLightbox(media.dataset.fullMedia, media.querySelector('img,video')?.alt || 'Full-size plugin preview', media.dataset.mediaType || 'image');
      const image = event.target.closest('[data-full-image]');
      if (image) openLightbox(image.dataset.fullImage, image.querySelector('img')?.alt || 'Full-size plugin preview');
    });
  }

  window.addEventListener('hashchange', syncViewFromHash);
  bindIfExists('#drawerClose', 'click', closeDrawer);
  bindIfExists('#drawerBackdrop', 'click', closeDrawer);
  bindIfExists('#lightboxClose', 'click', closeLightbox);
  bindIfExists('#imageLightbox', 'click', (event) => { if (event.target.id === 'imageLightbox') closeLightbox(); });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement && document.activeElement.tagName !== 'INPUT') {
      event.preventDefault();
      const input = $('#searchInput');
      if (input) input.focus();
    }
    if (event.key === 'Escape') closeDrawer();
  });

  const resultsGrid = $('#resultsGrid');
  if (resultsGrid) {
    resultsGrid.addEventListener('click', (event) => {
      const saveButton = event.target.closest('[data-save]');
      if (saveButton) { toggleSaved(saveButton.dataset.save); return; }
      const card = event.target.closest('[data-plugin]');
      if (card) openDrawer(card.dataset.plugin);
    });
  }
}
function syncViewFromHash() {
  const hash = window.location.hash || '#explore';
  const normalizedHash = hash.startsWith('#') ? hash : `#${hash}`;
  if (normalizedHash === '#bookmarks') {
    if (history.replaceState) {
      history.replaceState(null, '', '#explore');
    } else {
      window.location.hash = '#explore';
    }
    openBookmarksDrawer();
    return;
  }
  const page = normalizedHash === '#about' ? 'about' : 'catalog';
  state.view = page;
  state.quick = 'all';
  $$('.topnav a').forEach((link) => {
    const target = link.getAttribute('href');
    const isActive = target === '#explore' ? page === 'catalog' : target === '#about' ? page === 'about' : false;
    link.classList.toggle('active', isActive);
  });
  const catalogVisible = page === 'catalog';
  ['.hero', '.catalog-header', '#indexedSources', '.results-layout', '#loadMoreWrap'].forEach((selector) => { const element = $(selector); if (element) element.hidden = !catalogVisible; });
  $('#catalog').hidden = false;
  $$('.info-page').forEach((element) => { element.hidden = element.id !== page; });
  if (page === 'about') {
    requestAnimationFrame(() => {
      const section = document.getElementById('about');
      if (section && !section.hidden) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
  if ($('#viewTitle')) render();
  if (window.lucide) lucide.createIcons();
}

async function loadPlugins(reset) {
  if (loading) return;
  if (reset) {
    plugins = [];
    nextPage = 0;
    requestId += 1;
    state.sourceCounts = { Modrinth: 0, Spigot: 0, CurseForge: 0, Hangar: 0 };
    renderLoading();
  }
  const currentRequest = requestId;
  loading = true;
  const sourceNames = ['Modrinth', 'Spigot', 'CurseForge', 'Hangar'];
  const selectedSources = state.sources.size ? [...state.sources] : sourceNames;
  const sourceFetchers = {
    Modrinth: fetchModrinth,
    Spigot: fetchSpigot,
    CurseForge: fetchCurseForge,
    Hangar: fetchHangar
  };
  const tasks = selectedSources.map((source) => {
    const fetcher = sourceFetchers[source] || fetchModrinth;
    return Promise.resolve().then(() => fetcher(nextPage)).catch(() => []);
  });
  try {
    const batches = await Promise.all(tasks);
    if (currentRequest !== requestId) return;
    plugins = mergePluginResults([...plugins, ...batches.flat()]);
    nextPage += 1;
    render();
    $('#loadMoreWrap').hidden = batches.every((batch) => batch.length === 0) || plugins.length === 0;
  } catch (error) {
    if (currentRequest === requestId) renderError(error);
  } finally { loading = false; }
}

async function fetchModrinth(page) {
  const query = state.search ? `&query=${encodeURIComponent(state.search)}` : '';
  const facet = encodeURIComponent('[[\"project_type:plugin\"]]');
  const index = state.sort === 'updated' ? 'updated' : state.sort === 'popular' ? 'downloads' : 'relevance';
  const response = await fetch(`https://api.modrinth.com/v2/search?facets=${facet}&limit=50&offset=${page * 50}&index=${index}${query}`);
  if (!response.ok) throw new Error('Modrinth is unavailable right now');
  const data = await response.json();
  state.sourceCounts.Modrinth = Number.isFinite(data.total_hits) ? Number(data.total_hits) : Math.max(state.sourceCounts.Modrinth, data.hits.length);
  return data.hits.map((item) => ({ id: `modrinth-${item.project_id}`, name: item.title, creator: item.author, source: 'Modrinth', sources: ['Modrinth'], platform: platformFromModrinth(item), editions: detectPluginEditions(platformFromModrinth(item), item.categories || []), versions: item.versions?.map((version) => version.split('.').slice(0, 2).join('.')) || ['1.21', '1.20'], price: 'Free', icon: (item.title || 'M')[0].toUpperCase(), iconUrl: item.icon_url, iconClass: 'icon-green', category: item.categories?.[0] || 'Minecraft plugin', downloads: formatNumber(item.downloads), downloadValue: item.downloads || 0, downloadSources: [{ source: 'Modrinth', value: item.downloads || 0 }], updatedAt: item.date_modified, updated: relativeDate(item.date_modified), age: ageInDays(item.date_modified), popularity: item.follows || item.downloads, description: item.description || 'Minecraft plugin from the Modrinth project index.', url: `https://modrinth.com/plugin/${item.slug}`, links: [{ label: 'Modrinth project', url: `https://modrinth.com/plugin/${item.slug}` }, item.source_url && { label: 'Source code', url: item.source_url }, item.issues_url && { label: 'Issues', url: item.issues_url }, item.wiki_url && { label: 'Wiki', url: item.wiki_url }].filter(Boolean) }));
}

async function fetchSpigot(page) {
  const normalRoute = state.search ? `search/resources/${encodeURIComponent(state.search)}` : 'resources';
  const routes = state.prices.has('Paid') && !state.prices.has('Free') ? [{ route: 'resources/premium', size: 50 }] : state.prices.has('Free') ? [{ route: normalRoute, size: 50 }] : [{ route: normalRoute, size: 50 }, { route: 'resources/premium', size: 15 }];
  const responses = await Promise.all(routes.map(({ route, size }) => fetch(`https://api.spiget.org/v2/${route}?size=${size}&page=${page}&sort=-downloads`)));
  if (responses.some((response) => !response.ok)) throw new Error('Spigot is unavailable right now');
  const jsonPayloads = await Promise.all(responses.map((response) => response.json()));
  const totalCount = responses.reduce((highest, response) => {
    const headerValue = response.headers.get('x-total') || response.headers.get('X-Total') || response.headers.get('x-total-count') || response.headers.get('X-Total-Count') || response.headers.get('x-page-count') || response.headers.get('X-Page-Count') || '0';
    return Math.max(highest, Number(headerValue) || 0);
  }, 0) || Math.max(...jsonPayloads.map((batch) => Array.isArray(batch) ? batch.length : 0), 0);
  state.sourceCounts.Spigot = totalCount || Math.max(state.sourceCounts.Spigot, ...jsonPayloads.map((batch) => (Array.isArray(batch) ? batch.length : 0)));
  const data = jsonPayloads.flat();
  const enriched = await Promise.all(data.map(async (item) => {
    if (item.premium !== true) return item;
    const detailResponse = await fetch(`https://api.spiget.org/v2/resources/${item.id}`);
    if (!detailResponse.ok) return item;
    return { ...item, ...(await detailResponse.json()) };
  }));
  return enriched.map((item) => ({ id: `spigot-${item.id}`, name: item.name, creator: item.author?.name || 'Unknown creator', source: 'Spigot', sources: ['Spigot'], platform: ['Spigot', 'Paper'], editions: detectPluginEditions(['Spigot', 'Paper'], [item.tag || 'Minecraft plugin']), versions: (item.testedVersions || []).map((version) => version.split('.').slice(0, 2).join('.')), price: isCurrentSpigotPaid(item) ? 'Paid' : 'Free', priceLabel: isCurrentSpigotPaid(item) ? formatPrice(item.price, item.currency) : 'Free', icon: (item.name || 'S')[0].toUpperCase(), iconUrl: item.icon?.url ? `https://www.spigotmc.org/${item.icon.url}` : '', iconClass: 'icon-blue', category: item.tag || 'Minecraft plugin', downloads: formatNumber(item.downloads || 0), downloadValue: item.downloads || 0, downloadSources: [{ source: 'Spigot', value: item.downloads || 0 }], updatedAt: normalizeTimestamp(item.updateDate), updated: relativeDate(item.updateDate), age: ageInDays(item.updateDate), popularity: item.rating?.average || item.downloads || 0, description: normalizeDescription(item.description) || 'Minecraft plugin from the Spigot resource index.', images: extractImageUrls(item.description), url: `https://www.spigotmc.org/resources/${item.id}/`, links: [{ label: 'Spigot resource', url: `https://www.spigotmc.org/resources/${item.id}/` }, item.links?.R2l0aHVi && { label: 'GitHub', url: item.links.R2l0aHVi }, item.links?.discussion && { label: 'Discussion', url: item.links.discussion }].filter(Boolean) }));
}

function parseCurseForgeDownloads(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return 0;
  const match = cleaned.match(/([0-9]+(?:\.[0-9]+)?)([kKmM]?)/i);
  if (!match) return Number.parseInt(cleaned.replace(/[^0-9]/g, ''), 10) || 0;
  const [, amountText, unit] = match;
  const amount = Number.parseFloat(amountText);
  if (!Number.isFinite(amount)) return 0;
  if (/k/i.test(unit)) return Math.round(amount * 1000);
  if (/m/i.test(unit)) return Math.round(amount * 1000000);
  return Math.round(amount);
}

function parseCurseForgeVersions(value) {
  const versions = [...new Set((value.match(/\d+\.\d+(?:\.\d+)?/g) || []).map((entry) => entry.split('.').slice(0, 2).join('.')))].slice(0, 8);
  return versions.length ? versions : ['1.21', '1.20'];
}

function parseCurseForgeDate(value) {
  const text = String(value || '').trim();
  if (!text) return Date.now();
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
}

async function fetchCurseForge(page = 0) {
  const query = state.search ? encodeURIComponent(state.search) : '';
  const searchParam = query ? `&search=${query}` : '';
  const classParam = query ? '' : '&class=bukkit-plugins';
  const curseSort = state.sort === 'downloads' || state.sort === 'popular' ? 'downloadCount' : state.sort === 'updated' ? 'lastUpdated' : 'downloadCount';
  const response = await fetch(`/api/curseforge?page=${page}&pageSize=50&sort=${encodeURIComponent(curseSort)}${classParam}${searchParam}`);
  if (!response.ok) throw new Error('CurseForge is unavailable right now');
  const data = await response.json();
  state.sourceCounts.CurseForge = Number.isFinite(data.total) ? Number(data.total) : Math.max(state.sourceCounts.CurseForge, Array.isArray(data.items) ? data.items.length : 0);
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchHangar(page = 0) {
  const query = state.search ? `&query=${encodeURIComponent(state.search)}` : '';
  const hangarSort = state.sort === 'updated' ? '-updated' : '-downloads';
  const response = await fetch(`/api/hangar?limit=20&offset=${page * 20}&sort=${encodeURIComponent(hangarSort)}${query}`);
  if (!response.ok) throw new Error('Hangar is unavailable right now');
  const data = await response.json();
  const total = Number.isFinite(data?.pagination?.count) ? Number(data.pagination.count) : Math.max(state.sourceCounts.Hangar, Array.isArray(data.result) ? data.result.length : 0);
  state.sourceCounts.Hangar = total;
  if (!Array.isArray(data.result)) return [];
  return data.result.map((item) => {
    const owner = item.namespace?.owner || 'unknown';
    const slug = item.namespace?.slug || item.name || 'project';
    const versionKeys = Object.keys(item.supportedPlatforms || {});
    const platforms = versionKeys.map((platform) => {
      const label = platform.toLowerCase();
      if (label === 'paper') return 'Paper';
      if (label === 'folia') return 'Folia';
      if (label === 'velocity') return 'Velocity';
      if (label === 'fabric') return 'Fabric';
      if (label === 'quilt') return 'Quilt';
      if (label === 'bukkit') return 'Bukkit';
      if (label === 'spigot') return 'Spigot';
      if (label === 'forge') return 'Forge';
      if (label === 'neoforge') return 'NeoForge';
      return platform;
    });
    const versions = [...new Set(Object.values(item.supportedPlatforms || {}).flatMap((list) => Array.isArray(list) ? list : []))].slice(0, 12);
    const downloads = Number(item.stats?.downloads || 0);
    const projectUrl = `https://hangar.papermc.io/${owner}/${slug}`;
    return {
      id: `hangar-${item.id || `${owner}-${slug}`}`,
      name: item.name,
      creator: owner,
      source: 'Hangar',
      sources: ['Hangar'],
      platform: platforms.length ? platforms : ['Paper'],
      editions: detectPluginEditions(platforms, [item.category || 'Minecraft plugin']),
      versions: versions.length ? versions : ['1.21', '1.20'],
      price: 'Free',
      priceLabel: 'Free',
      icon: (item.name || 'H')[0].toUpperCase(),
      iconUrl: item.avatarUrl || '',
      iconClass: 'icon-orange',
      category: item.category || 'Minecraft plugin',
      downloads: formatNumber(downloads),
      downloadValue: downloads,
      downloadSources: [{ source: 'Hangar', value: downloads }],
      updatedAt: new Date(item.lastUpdated || item.publishedAt || item.createdAt || Date.now()).getTime(),
      updated: relativeDate(item.lastUpdated || item.publishedAt || item.createdAt),
      age: ageInDays(item.lastUpdated || item.publishedAt || item.createdAt),
      popularity: (item.stats?.stars || 0) + (item.stats?.views || 0) + downloads,
      description: item.description || 'Minecraft plugin from Hangar.',
      url: projectUrl,
      links: [{ label: 'Hangar project', url: projectUrl }],
    };
  });
}

function platformFromModrinth(item) { const categories = (item.categories || []).map((category) => category.toLowerCase()); const platforms = ['Paper', 'Spigot', 'Velocity', 'Folia', 'Bukkit'].filter((platform) => categories.includes(platform.toLowerCase())); return platforms.length ? platforms : ['Paper']; }
function detectPluginEditions(platforms = [], categories = []) {
  const editions = new Set(['Java Edition']);
  const labels = [...(platforms || []), ...(categories || [])].join(' ').toLowerCase();
  if (/(bukkit)/.test(labels)) editions.add('Bukkit');
  if (/(spigot)/.test(labels)) editions.add('Spigot');
  if (/(paper)/.test(labels)) editions.add('Paper');
  if (/(velocity)/.test(labels)) editions.add('Velocity');
  if (/(folia)/.test(labels)) editions.add('Folia');
  return [...editions];
}
function stripHtml(value) { return String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim(); }
function decodeBase64(value) { try { const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); return new TextDecoder().decode(bytes); } catch { return value; } }
function normalizeDescription(value) { const plain = stripHtml(value); return stripHtml(decodeBase64(plain)).trim(); }
function isExplicitlyFree(value) { return /\[free\]/i.test(normalizeDescription(value)); }
function isCurrentSpigotPaid(item) { return item.premium === true && !knownFreeSpigotResources.has(String(item.id)) && !isExplicitlyFree(item.description); }
function extractImageUrls(value) {
  const raw = String(value || '');
  const matches = new Set();
  const add = (url) => {
    if (!url) return;
    const normalized = String(url).replace(/^\/\//, 'https://').replace(/&amp;/g, '&').trim();
    if (/^https?:\/\//i.test(normalized) && /\.(png|jpe?g|gif|webp|avif|mp4|webm|ogg|mov)(?:[?#].*)?$/i.test(normalized)) matches.add(normalized);
  };

  const htmlMatches = [...raw.matchAll(/<(?:img|video|source|picture)[^>]+(?:src|poster|data-src)=["']([^"']+)["'][^>]*>/gi)];
  htmlMatches.forEach((match) => add(match[1]));

  const srcsetMatches = [...raw.matchAll(/(?:srcset)=["']([^"']+)["']/gi)];
  srcsetMatches.forEach((match) => {
    match[1].split(',').forEach((entry) => {
      const candidate = entry.trim().split(/\s+/)[0];
      add(candidate);
    });
  });

  const markdownMatches = [...raw.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi)];
  markdownMatches.forEach((match) => add(match[1]));

  const directUrlMatches = [...raw.matchAll(/https?:\/\/[^\s"'<>]+(?:\.(?:png|jpe?g|gif|webp|avif|mp4|webm|ogg|mov))(?:[?#][^\s"'<>]*)?/gi)];
  directUrlMatches.forEach((match) => add(match[0]));

  return [...matches].slice(0, 12);
}
function formatNumber(value) { if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`; if (value >= 1000) return `${(value / 1000).toFixed(0)}K`; return String(value); }
function formatPrice(value, currency = 'USD') { const amount = Number(value); if (!Number.isFinite(amount) || amount <= 0) return 'Paid'; try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount); } catch { return `${currency || 'USD'} ${amount.toFixed(2)}`; } }
function normalizeTimestamp(value) { if (typeof value === 'number' && value > 0 && value < 100000000000) return value * 1000; return value; }
function formatExactDate(value) { const time = new Date(normalizeTimestamp(value)).getTime(); if (!Number.isFinite(time)) return 'Date unavailable'; return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(time)); }
function ageInDays(value) { const time = new Date(normalizeTimestamp(value)).getTime(); return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 86400000)) : 999; }
function relativeDate(value) { const days = ageInDays(value); if (days === 0) return 'today'; if (days === 1) return 'yesterday'; if (days < 30) return `${days} days ago`; if (days < 365) return `${Math.floor(days / 30)} months ago`; return 'over a year ago'; }
function mergePluginResults(items) {
  const merged = new Map();
  items.forEach((plugin) => {
    const name = String(plugin.name || '').trim();
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const normalizedCreator = String(plugin.creator || plugin.source || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const fallbackKey = normalizedName || String(plugin.id || `${plugin.source || 'unknown'}:${name || 'plugin'}`).toLowerCase().replace(/[^a-z0-9]/g, '');
    const creatorKey = normalizedName && normalizedCreator ? `${normalizedName}:${normalizedCreator}` : fallbackKey;
    const keys = [creatorKey, fallbackKey];
    let existing = null;
    for (const key of keys) {
      if (merged.has(key)) {
        existing = merged.get(key);
        break;
      }
    }

    if (existing && existing.id === plugin.id && existing.source === plugin.source) return;
    if (!existing) {
      const base = { ...plugin, sources: [...(plugin.sources || [plugin.source])], downloadSources: [...(plugin.downloadSources || [{ source: plugin.source, value: plugin.downloadValue || 0 }])], links: [...(plugin.links || [])] };
      const key = fallbackKey || String(base.id || `${base.source || 'unknown'}:${base.name || 'plugin'}`).toLowerCase().replace(/[^a-z0-9]/g, '');
      merged.set(key, base);
      return;
    }

    existing.sources = [...new Set([...existing.sources, ...(plugin.sources || [plugin.source])])];
    existing.source = existing.sources.join(' + ');
    existing.platform = [...new Set([...(existing.platform || []), ...(plugin.platform || [])])];
    existing.editions = [...new Set([...(existing.editions || []), ...(plugin.editions || [])])];
    existing.price = existing.price === 'Paid' || plugin.price === 'Paid' ? 'Paid' : 'Free';
    if (plugin.price === 'Paid' && plugin.priceLabel) existing.priceLabel = plugin.priceLabel;
    if (!existing.iconUrl && plugin.iconUrl) existing.iconUrl = plugin.iconUrl;
    if (!existing.description && plugin.description) existing.description = plugin.description;
    if ((!existing.images || !existing.images.length) && plugin.images?.length) existing.images = [...new Set([...(existing.images || []), ...plugin.images])].slice(0, 12);
    if (!existing.url && plugin.url) existing.url = plugin.url;
    if (!existing.creator && plugin.creator) existing.creator = plugin.creator;
    if (!existing.category && plugin.category) existing.category = plugin.category;

    const sourceTotals = new Map(existing.downloadSources.map((entry) => [entry.source, entry.value]));
    const incomingSources = plugin.downloadSources && plugin.downloadSources.length ? plugin.downloadSources : [{ source: plugin.source, value: plugin.downloadValue || 0 }];
    incomingSources.forEach((entry) => sourceTotals.set(entry.source, (sourceTotals.get(entry.source) || 0) + (entry.value || 0)));
    existing.downloadSources = [...sourceTotals].map(([source, value]) => ({ source, value }));
    existing.downloadValue = existing.downloadSources.reduce((total, entry) => total + entry.value, 0);
    existing.downloads = formatNumber(existing.downloadValue);
    existing.popularity = (existing.popularity || 0) + (plugin.popularity || 0);
    existing.links = [...existing.links, ...(plugin.links || [])].filter((link, index, links) => link && links.findIndex((item) => item.url === link.url) === index);
  });

  return [...merged.values()].map((plugin) => ({
    ...plugin,
    id: plugin.id || `${plugin.source || 'merged'}:${String(plugin.name || 'plugin').toLowerCase().replace(/[^a-z0-9]+/g, '')}`,
    downloadValue: Number(plugin.downloadValue || 0),
    downloadSources: [...(plugin.downloadSources || [])],
    sources: [...new Set(plugin.sources || [])],
    platforms: plugin.platform || [],
  }));
}

function getFilteredPlugins() {
  const searchTerms = state.search.toLowerCase().split(/[\s\-_()[\],.]+/).filter(Boolean);
  let list = plugins.filter((plugin) => {
    const haystack = `${plugin.name} ${plugin.creator} ${plugin.category} ${plugin.description} ${plugin.source} ${(plugin.sources || []).join(' ')} ${(plugin.platform || []).join(' ')} ${(plugin.editions || []).join(' ')} ${(plugin.versions || []).join(' ')}`.toLowerCase();
    const matchesSearch = !searchTerms.length || searchTerms.every((term) => haystack.includes(term));
    const matchesSource = !state.sources.size || (plugin.sources || [plugin.source]).some((source) => state.sources.has(source));
    const matchesPlatform = !state.platforms.size || [...state.platforms].some((platform) => plugin.platform.includes(platform));
    const matchesEdition = !state.editions.size || (plugin.editions || ['Java Edition']).some((edition) => state.editions.has(edition));
    const matchesPrice = !state.prices.size || state.prices.has(plugin.price === 'Free' ? 'Free' : 'Paid');
    const matchesVersion = state.version === 'all' || plugin.versions.includes(state.version);
    const matchesQuick = state.quick === 'all' || (state.quick === 'free' && plugin.price === 'Free') || (state.quick === 'updated' && plugin.age <= 7) || (state.quick === 'popular' && plugin.popularity >= 95) || (state.quick === 'downloads' && plugin.downloadValue > 0) || (state.quick === 'skript') || (state.quick === 'saved' && state.saved.has(plugin.id));
    return matchesSearch && matchesSource && matchesPlatform && matchesEdition && matchesPrice && matchesVersion && matchesQuick;
  });
  if (state.sort === 'downloads') list.sort((a, b) => b.downloadValue - a.downloadValue);
  if (state.sort === 'popular') list.sort((a, b) => b.popularity - a.popularity);
  if (state.sort === 'updated') list.sort((a, b) => a.age - b.age);
  if (state.sort === 'price-low') list.sort((a, b) => (a.price === 'Free' ? 0 : Number(a.price.slice(1))) - (b.price === 'Free' ? 0 : Number(b.price.slice(1))));
  return list;
}

function formatCompactCount(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

function syncSourceTabState() {
  const selected = state.sources.size === 1 ? [...state.sources][0] : 'all';
  $$('.source-tab').forEach((tab) => {
    const source = tab.dataset.source;
    const isActive = source === selected;
    tab.classList.toggle('active', isActive);
  });
}

function updateSourceTabCounts() {
  const sourceNames = ['Modrinth', 'Spigot', 'CurseForge', 'Hangar'];
  const totals = sourceNames.reduce((result, source) => {
    result[source] = Number(state.sourceCounts[source]) || plugins.filter((plugin) => (plugin.sources || [plugin.source]).includes(source)).length;
    return result;
  }, {});
  const selected = state.sources.size === 1 ? [...state.sources][0] : 'all';
  const total = selected === 'all'
    ? sourceNames.reduce((sum, source) => sum + (Number(totals[source]) || 0), 0)
    : Number(totals[selected]) || 0;
  const allTab = document.querySelector('.source-tab[data-source="all"]');
  if (allTab) {
    const countNode = allTab.querySelector('small');
    if (countNode) countNode.textContent = formatCompactCount(total);
  }
  sourceNames.forEach((source) => {
    const tab = document.querySelector(`.source-tab[data-source="${source}"]`);
    if (!tab) return;
    const countNode = tab.querySelector('small');
    if (countNode) countNode.textContent = formatCompactCount(totals[source] || 0);
  });
  syncSourceTabState();
}

function render() {
  const list = state.view === 'saved' ? plugins.filter((plugin) => state.saved.has(plugin.id)) : getFilteredPlugins();
  const viewTitle = $('#viewTitle');
  if (viewTitle) viewTitle.textContent = state.view === 'saved' ? 'Saved bookmarks' : 'Plugin directory';
  const summary = $('#searchResultSummary');
  const hasSearchTerm = !!(state.search || '').trim();
  if (summary) {
    if (hasSearchTerm) {
      summary.hidden = false;
      summary.textContent = `${list.length.toLocaleString()} result${list.length === 1 ? '' : 's'}`;
    } else {
      summary.hidden = true;
      summary.textContent = '';
    }
  }
  const filterCount = $('#filterCount');
  if (filterCount) {
    filterCount.textContent = state.sources.size + state.platforms.size + state.editions.size + state.prices.size + (state.version !== 'all' ? 1 : 0);
  }
  const savedCount = $('#savedCount');
  if (savedCount) savedCount.textContent = state.saved.size;
  updateSourceTabCounts();
  renderActiveFilters();
  const resultsGrid = $('#resultsGrid');
  if (resultsGrid) {
    resultsGrid.innerHTML = list.length ? list.map(pluginCard).join('') : `<div class="empty-state"><i data-lucide="${state.view === 'saved' ? 'bookmark' : 'search-x'}"></i><h3>${state.view === 'saved' ? 'No bookmarks yet.' : 'No plugins match that search.'}</h3><p>${state.view === 'saved' ? 'Bookmark plugins from the catalog and manage them here.' : 'Try clearing a filter or searching for a broader feature.'}</p></div>`;
  }
  const loadMoreWrap = $('#loadMoreWrap');
  if (loadMoreWrap) loadMoreWrap.hidden = loading || !plugins.length;
  if (window.lucide) lucide.createIcons();
}

function renderActiveFilters() {
  const active = [
    ...[...state.sources].map((value) => ({ group: 'sources', value, label: `Source: ${value}` })),
    ...[...state.platforms].map((value) => ({ group: 'platforms', value, label: `Platform: ${value}` })),
    ...[...state.editions].map((value) => ({ group: 'editions', value, label: `Edition: ${value}` })),
    ...[...state.prices].map((value) => ({ group: 'prices', value, label: `Price: ${value}` })),
    ...(state.version !== 'all' ? [{ group: 'version', value: state.version, label: `Version: ${state.version}.x` }] : []),
    ...(state.quick !== 'all' && state.quick !== 'skript' ? [{ group: 'quick', value: state.quick, label: state.quick === 'downloads' ? 'Most downloaded' : state.quick }] : []),
    ...(state.quick === 'skript' ? [{ group: 'quick', value: 'skript', label: 'Skript resources' }] : []),
  ];
  const container = $('#activeFilters');
  if (!container) return;
  container.hidden = active.length === 0;
  container.innerHTML = active.map((item) => `<button type="button" class="active-filter" data-remove-filter="${item.group}" data-value="${item.value}">${escapeHtml(item.label)} <span aria-hidden="true">×</span></button>`).join('');
  if (window.lucide) lucide.createIcons();
}

function removeActiveFilter(group, value) {
  if (group === 'all') { clearFilters(); return; }
  if (group === 'version') state.version = 'all';
  else if (group === 'quick') { state.quick = 'all'; if (value === 'skript') { state.search = ''; $('#searchInput').value = ''; } }
  else state[group].delete(value);
  syncCheckboxes();
  loadPlugins(true);
}

function renderLoading() { $('#resultsGrid').innerHTML = `<div class="empty-state loading-state"><i data-lucide="loader-circle"></i><h3>Searching live plugin indexes...</h3><p>Pulling current results from Modrinth and Spigot.</p></div>`; $('#loadMoreWrap').hidden = true; if (window.lucide) lucide.createIcons(); }
function renderError(error) { $('#resultsGrid').innerHTML = `<div class="empty-state"><i data-lucide="wifi-off"></i><h3>Live sources could not be reached.</h3><p>${error.message}. Check your connection and try again.</p><button class="clear-filters" onclick="loadPlugins(true)">Try again</button></div>`; $('#loadMoreWrap').hidden = true; if (window.lucide) lucide.createIcons(); }

function pluginCard(plugin) {
  const icon = plugin.iconUrl ? `<img src="${escapeHtml(plugin.iconUrl)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><span hidden>${plugin.icon}</span>` : `<span>${plugin.icon}</span>`;
  const saved = state.saved.has(plugin.id);
  const totalDownloads = Number(plugin.downloadValue || (plugin.downloadSources || []).reduce((sum, entry) => sum + (Number(entry.value) || 0), 0));
  const downloadText = `Downloads: ${formatNumber(totalDownloads)}`;
  const exactDate = plugin.updatedAt ? formatExactDate(plugin.updatedAt) : 'Date unavailable';
  return `<article class="plugin-card" data-plugin="${plugin.id}"><div class="card-top"><span class="plugin-icon ${plugin.iconClass}">${icon}</span><div class="card-actions"><button type="button" class="${saved ? 'saved' : ''}" data-save="${plugin.id}" title="${saved ? 'Remove bookmark' : 'Bookmark plugin'}" aria-label="${saved ? 'Remove bookmark' : 'Bookmark plugin'}"><i data-lucide="${saved ? 'bookmark-check' : 'bookmark'}"></i></button><button type="button" title="Open plugin details" aria-label="Open plugin details"><i data-lucide="arrow-up-right"></i></button></div></div><h3>${escapeHtml(plugin.name)}</h3><p class="description">${escapeHtml(plugin.description)}</p><div class="meta-row"><span title="${escapeHtml(downloadText)}"><i data-lucide="download"></i>${escapeHtml(downloadText)}</span><span title="Updated ${escapeHtml(exactDate)}"><i data-lucide="clock-3"></i>${plugin.updated}</span></div><div class="card-bottom"><span class="source-name"><i class="source-dot ${(plugin.sources?.[0] || plugin.source).toLowerCase()}"></i>${plugin.source}</span><span class="price-tag ${plugin.price === 'Free' ? 'free' : 'paid'}">${escapeHtml(plugin.priceLabel || plugin.price)}</span></div></article>`;
}
function renderDescriptionMarkup(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const markdown = input.replace(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, '<img src="$1" alt="Plugin preview" loading="lazy" />');
  const html = markdown.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, '<img src="$1" alt="Plugin preview" loading="lazy" />');
  const video = html.replace(/<video\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, '<video src="$1" muted loop playsinline preload="metadata"></video>');
  return video
    .replace(/&lt;img/gi, '<img')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on[a-z]+=\s*['"][^'"]*['"]/gi, '');
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]); }
function persistSaved() {
  localStorage.setItem(savedStoreKey, JSON.stringify([...state.saved]));
}

function toggleSaved(id) {
  if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
  persistSaved();
  render();
}
function clearFilters() { state.sources.clear(); state.platforms.clear(); state.editions.clear(); state.prices.clear(); state.version = 'all'; state.quick = 'all'; const versionFilter = $('#versionFilter'); if (versionFilter) versionFilter.value = 'all'; $$('.chip').forEach((item) => item.classList.toggle('active', item.dataset.quick === 'all')); syncSourceTabState(); syncCheckboxes(); loadPlugins(true); }
function syncCheckboxes() { $$('select[data-filter]').forEach((select) => { const target = state[`${select.dataset.filter}s`]; select.value = target?.values().next().value || 'all'; }); }
function openBookmarksDrawer() {
  const saved = plugins.filter((plugin) => state.saved.has(plugin.id));
  const items = saved.length ? saved.map((plugin) => `<div class="saved-plugin"><button class="saved-plugin-main" data-open-plugin="${escapeHtml(plugin.id)}" type="button"><span class="plugin-icon ${plugin.iconClass}">${plugin.iconUrl ? `<img src="${escapeHtml(plugin.iconUrl)}" alt="" />` : escapeHtml(plugin.icon)}</span><span><strong>${escapeHtml(plugin.name)}</strong><small>${escapeHtml(plugin.source)} · ${escapeHtml(plugin.priceLabel || plugin.price)}</small></span><i data-lucide="arrow-up-right"></i></button><button class="saved-remove" type="button" data-remove-saved="${escapeHtml(plugin.id)}" aria-label="Remove ${escapeHtml(plugin.name)} from bookmarks"><i data-lucide="x"></i></button></div>`).join('') : '<p class="saved-empty">Your bookmarks will appear here. Save plugins from the catalog and remove them here.</p>';
  $('#drawerContent').innerHTML = `<div class="drawer-hero"><span class="section-kicker">PRIVATE COLLECTION</span><h2 id="drawerTitle">Bookmarks</h2><p>Keep your saved plugins here for quick access.</p></div><div class="saved-plugin-list">${items}</div>`;
  $('#drawerBackdrop').hidden = false;
  $('#detailsDrawer').classList.add('open');
  $('#detailsDrawer').setAttribute('aria-hidden', 'false');
  if (window.lucide) lucide.createIcons();
}
async function ensurePluginImages(plugin) {
  const sourceImages = [...(plugin.images || [])];
  const extractedFromDescription = extractImageUrls(plugin.description || '');
  const initialImages = [...new Set([...sourceImages, ...extractedFromDescription])];
  if (initialImages.length) {
    plugin.images = initialImages.slice(0, 12);
    return plugin.images;
  }

  try {
    if (plugin.sources?.includes('Modrinth')) {
      const projectId = plugin.id.replace('modrinth-', '');
      const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`);
      if (response.ok) {
        const project = await response.json();
        plugin.images = (project.gallery || []).map((image) => image.url).filter(Boolean).slice(0, 12);
        return plugin.images || [];
      }
    }

    if (plugin.sources?.includes('CurseForge') || plugin.source === 'CurseForge') {
      const response = await fetch(`/api/curseforge-images?url=${encodeURIComponent(plugin.url || '')}`);
      if (response.ok) {
        const payload = await response.json();
        const urls = Array.isArray(payload.images) ? payload.images : [];
        if (urls.length) {
          plugin.images = urls.slice(0, 12);
          return plugin.images;
        }
      }
    }
  } catch {
    plugin.images = [];
  }

  plugin.images = initialImages.slice(0, 12);
  return plugin.images;
}

async function openDrawer(id) {
  const plugin = plugins.find((item) => item.id === id);
  if (!plugin) return;
  await ensurePluginImages(plugin);
  const saved = state.saved.has(plugin.id);
  const icon = plugin.iconUrl ? `<img src="${escapeHtml(plugin.iconUrl)}" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><span hidden>${plugin.icon}</span>` : plugin.icon;
  const links = (plugin.links || []).map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i>${escapeHtml(link.label)}</a>`).join('');
  const detailsDate = plugin.updatedAt ? formatExactDate(plugin.updatedAt) : 'Date unavailable';
  const descriptionHtml = renderDescriptionMarkup(plugin.description) || escapeHtml(plugin.description || 'No description available.');
  const mediaItems = (plugin.images || []).map((url) => {
    const isVideo = /\.(mp4|webm|ogg|mov|m4v)(?:[?#].*)?$/i.test(url);
    const isGif = /\.gif(?:[?#].*)?$/i.test(url);
    const mediaType = isVideo ? 'video' : 'image';
    const preview = isVideo
      ? `<video src="${escapeHtml(url)}" muted loop playsinline preload="metadata" aria-label="${escapeHtml(plugin.name)} preview" onerror="this.closest('button').remove()"></video>`
      : `<img src="${escapeHtml(url)}" alt="${escapeHtml(plugin.name)} preview" loading="lazy" onerror="this.closest('button').remove()" />`;
    const label = isGif ? 'Animated preview' : isVideo ? 'Video preview' : 'Preview image';
    return `<button class="drawer-media-button" data-full-media="${escapeHtml(url)}" data-media-type="${mediaType}" type="button" aria-label="${escapeHtml(label)}"><span class="media-label">${escapeHtml(label)}</span>${preview}</button>`;
  }).join('');
  $('#drawerContent').innerHTML = `<div class="drawer-hero"><span class="plugin-icon ${plugin.iconClass}">${icon}</span><h2 id="drawerTitle">${escapeHtml(plugin.name)}</h2><div class="drawer-description"><div id="drawerDescription">${descriptionHtml}</div>${descriptionHtml.length > 360 ? '<button class="text-more" id="descriptionMore" type="button">Show more</button>' : ''}</div>${mediaItems ? `<div class="drawer-media">${mediaItems}</div>` : ''}</div><div class="drawer-details"><div class="detail-item"><span>CREATOR</span><strong>${escapeHtml(plugin.creator)}</strong></div><div class="detail-item"><span>SOURCE</span><strong>${plugin.source}</strong></div><div class="detail-item"><span>PLATFORM</span><strong>${plugin.platform.join(', ')}</strong></div><div class="detail-item"><span>EDITION</span><strong>${(plugin.editions || ['Java Edition']).join(', ')}</strong></div><div class="detail-item"><span>VERSION</span>${versionMarkup(plugin.versions)}</div><div class="detail-item"><span>LAST UPDATED</span><strong>${plugin.updated} · ${detailsDate}</strong></div><div class="detail-item"><span>OVERALL DOWNLOADS</span><strong>${plugin.downloads}</strong></div><div class="detail-item"><span>PRICE</span><strong>${escapeHtml(plugin.priceLabel || plugin.price)}</strong></div></div><div class="download-row"><select id="downloadMode"><option value="open">Open official download page</option><option value="copy">Copy download link</option></select><button class="drawer-cta" id="downloadAction"><i data-lucide="download"></i> Download</button><button class="drawer-cta secondary" id="savePluginAction" type="button"><i data-lucide="bookmark"></i> ${saved ? 'Saved' : 'Save'}</button></div><div class="drawer-links"><span>PROJECT LINKS</span>${links || '<small>No additional links listed</small>'}<a href="${escapeHtml(plugin.url)}" target="_blank" rel="noreferrer"><i data-lucide="messages-square"></i>Discuss on source page</a></div>${reviewMarkup(plugin.id)}`;
  $('#drawerBackdrop').hidden = false;
  $('#detailsDrawer').classList.add('open');
  $('#detailsDrawer').setAttribute('aria-hidden', 'false');
  if (window.lucide) lucide.createIcons();

  const downloadAction = $('#downloadAction');
  if (downloadAction) {
    downloadAction.addEventListener('click', () => {
      const downloadMode = $('#downloadMode');
      if (downloadMode && downloadMode.value === 'copy') {
        navigator.clipboard?.writeText(plugin.url);
        return;
      }
      window.open(plugin.url, '_blank', 'noopener');
    });
  }

  const savePluginAction = $('#savePluginAction');
  if (savePluginAction) {
    savePluginAction.addEventListener('click', () => {
      if (state.saved.has(plugin.id)) {
        state.saved.delete(plugin.id);
      } else {
        state.saved.add(plugin.id);
      }
      persistSaved();
      const savedCount = $('#savedCount');
      if (savedCount) savedCount.textContent = state.saved.size;
      render();
      openDrawer(plugin.id);
    });
  }

  const descriptionMore = $('#descriptionMore');
  if (descriptionMore) {
    descriptionMore.addEventListener('click', (event) => {
      const drawerDescription = $('#drawerDescription');
      if (!drawerDescription) return;
      const isExpanded = drawerDescription.classList.toggle('expanded');
      event.currentTarget.textContent = isExpanded ? 'Show less' : 'Show more';
      const currentButton = event.currentTarget;
      if (currentButton) currentButton.setAttribute('aria-expanded', String(isExpanded));
    });
  }

  const versionsMore = $('#versionsMore');
  if (versionsMore) {
    versionsMore.addEventListener('click', (event) => {
      const drawerVersions = $('#drawerVersions');
      if (!drawerVersions) return;
      drawerVersions.classList.toggle('expanded');
      event.currentTarget.textContent = drawerVersions.classList.contains('expanded') ? 'Show less' : 'Show more';
    });
  }

  $$('.edit-review').forEach((button) => {
    button.addEventListener('click', () => {
      const reviewId = button.dataset.reviewId;
      const review = (readReviews()[plugin.id] || []).find((item) => item.id === reviewId);
      if (!review) return;
      const reviewRating = $('#reviewRating');
      const reviewText = $('#reviewText');
      const reviewEditId = $('#reviewEditId');
      const reviewSubmitLabel = $('#reviewSubmitLabel');
      if (reviewRating) reviewRating.value = review.rating;
      if (reviewText) reviewText.value = review.text;
      if (reviewEditId) reviewEditId.value = reviewId;
      if (reviewSubmitLabel) reviewSubmitLabel.textContent = 'Update review';
      if (reviewText) reviewText.focus();
    });
  });

  const reviewForm = $('#reviewForm');
  if (reviewForm) {
    reviewForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const reviewEditId = $('#reviewEditId');
      const reviewRating = $('#reviewRating');
      const reviewText = $('#reviewText');
      const reviewId = reviewEditId ? reviewEditId.value || null : null;
      saveReview(plugin.id, reviewRating ? reviewRating.value : '5', reviewText ? reviewText.value : '', reviewId);
      openDrawer(plugin.id);
    });
  }
}
function openLightbox(url, alt, type = 'image') {
  const image = $('#lightboxImage');
  const video = $('#lightboxVideo');
  const isVideo = type === 'video';
  image.hidden = isVideo;
  video.hidden = !isVideo;
  if (isVideo) {
    video.src = url;
    video.load();
    video.play().catch(() => undefined);
  } else {
    image.src = url;
    image.alt = alt;
    video.removeAttribute('src');
    video.pause();
  }
  $('#imageLightbox').hidden = false;
  if (window.lucide) lucide.createIcons();
}
function closeLightbox() {
  $('#imageLightbox').hidden = true;
  $('#lightboxImage').removeAttribute('src');
  const video = $('#lightboxVideo');
  video.pause();
  video.removeAttribute('src');
  video.hidden = true;
}
function versionMarkup(versions = []) { const values = versions.length ? versions.map((version) => `${version}.x`).join(', ') : 'Not listed'; return `<strong id="drawerVersions" class="version-values">${escapeHtml(values)}</strong>${versions.length > 8 ? '<button class="text-more" id="versionsMore" type="button">Show more</button>' : ''}`; }
function readReviews() {
  try { return JSON.parse(localStorage.getItem(reviewStoreKey) || '{}'); } catch { return {}; }
}
function writeReviews(reviews) {
  localStorage.setItem(reviewStoreKey, JSON.stringify(reviews));
}
function reviewMarkup(pluginId) {
  const reviews = readReviews()[pluginId] || [];
  const entries = reviews.length ? reviews.map((review) => `<article class="review-item"><div><strong>${review.rating}/5</strong><span>${escapeHtml(review.date)}</span><button class="mini-link edit-review" type="button" data-review-id="${review.id}" data-plugin-id="${pluginId}">Edit</button></div><p>${escapeHtml(review.text)}</p></article>`).join('') : '<p class="review-empty">No reviews yet. Be the first to share your experience.</p>';
  return `<section class="reviews"><div class="reviews-heading"><span>COMMUNITY REVIEWS</span><strong>${reviews.length}</strong></div><form id="reviewForm" class="review-form"><div class="review-fields"><select id="reviewRating" aria-label="Rating"><option value="5">5 / 5</option><option value="4">4 / 5</option><option value="3">3 / 5</option><option value="2">2 / 5</option><option value="1">1 / 5</option></select><input id="reviewText" required maxlength="280" placeholder="Share your experience..." /><input id="reviewEditId" type="hidden" value="" /></div><button class="review-submit" type="submit"><i data-lucide="send"></i><span id="reviewSubmitLabel">Post review</span></button></form><div class="review-list">${entries}</div></section>`;
}
function saveReview(pluginId, rating, text, reviewId = null) {
  const reviews = readReviews();
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  const entry = { id: reviewId || `review-${Date.now()}-${Math.random().toString(16).slice(2)}`, rating: Number(rating), text: trimmed, date: new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date()) };
  const current = [...(reviews[pluginId] || [])];
  const list = reviewId ? current.map((item) => item.id === reviewId ? entry : item) : [...current, entry];
  reviews[pluginId] = list.slice(-20);
  writeReviews(reviews);
}
function closeDrawer() {
  const drawer = $('#detailsDrawer');
  if (drawer) {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  }
  const backdrop = $('#drawerBackdrop');
  setTimeout(() => {
    if (backdrop) backdrop.hidden = true;
  }, 250);
}
init();
