// ============================================================
// BORYILS&CO — Web QR Menü (sadece görüntüleme, sipariş yok)
// Ana ekran: kategori afişleri. Bir kategoriye dokununca üstte
// sekmeler + öne çıkanlar şeridi + ürün listesi olan gezinme
// ekranına geçilir (sol üstteki daire buton ana ekrana döner).
// Admin panelinde yapılan her değişiklik Supabase Realtime ile
// bu sayfaya otomatik yansır.
// ============================================================

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = document.getElementById('app');
const NEW_BADGE_DAYS = 14;

let state = {
  cafe: null,
  categories: [],
  products: [],
  view: 'home', // 'home' | 'browse'
  activeCategoryId: null,
  totalViews: 0,
};

// ---------------- Cafe slug tespiti ----------------
function getCafeSlug() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('cafe')) return params.get('cafe');
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  return path || null;
}

// ---------------- Renk yardımcıları ----------------
function applyTheme(hex) {
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-ink', idealTextColor(hex));
  document.documentElement.style.setProperty('--accent-soft', lightenHex(hex, 0.85));
  document.documentElement.style.setProperty('--accent-bg-top', lightenHex(hex, 0.82));
}
function idealTextColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#211D19' : '#ffffff';
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}
function lightenHex(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ---------------- Veri çekme ----------------
async function loadMenu() {
  const slug = getCafeSlug();
  if (!slug) {
    renderError('Menü bulunamadı', 'Adreste bir cafe belirtilmedi.');
    return;
  }

  const { data: cafe, error: cafeErr } = await db
    .from('cafes')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (cafeErr || !cafe) {
    renderError('Menü bulunamadı', 'Bu adreste aktif bir cafe yok. QR kodu tekrar kontrol edin.');
    return;
  }

  state.cafe = cafe;
  applyTheme(cafe.theme_color || '#4A6741');
  document.title = cafe.name;

  const viewCountPromise = db
    .from('menu_views')
    .select('id', { count: 'exact', head: true })
    .eq('cafe_id', cafe.id)
    .then(({ count }) => {
      state.totalViews = count || 0;
    });

  renderSplash();
  const [, , ] = await Promise.all([
    refreshData({ skipRender: true }),
    viewCountPromise,
    new Promise((resolve) => setTimeout(resolve, 900)), // splash en az ~1sn görünsün
  ]);
  render();
  subscribeToRealtimeUpdates(cafe.id);
}

// Site ilk açıldığında cafe adını ekranın ortasında kısaca gösterir,
// veri yüklenirken beklerken boş bir ekran yerine markalı bir giriş sunar.
function renderSplash() {
  app.innerHTML = `
    <div class="splash-screen">
      <div class="splash-name">${escapeHtml(state.cafe.name)}</div>
      <div class="splash-sub">Dijital Menü</div>
    </div>
  `;
}

function subscribeToRealtimeUpdates(cafeId) {
  db.channel(`public-menu-${cafeId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `cafe_id=eq.${cafeId}` }, () => refreshData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: `cafe_id=eq.${cafeId}` }, () => refreshData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cafes', filter: `id=eq.${cafeId}` }, () => refreshCafe())
    .subscribe();
}

async function refreshData(options = {}) {
  const cafeId = state.cafe.id;
  const [{ data: categories }, { data: products }] = await Promise.all([
    db.from('categories').select('*').eq('cafe_id', cafeId).order('sort_order'),
    db.from('products').select('*').eq('cafe_id', cafeId).order('sort_order'),
  ]);
  state.categories = categories || [];
  state.products = products || [];
  if (!state.categories.find((c) => c.id === state.activeCategoryId)) {
    state.activeCategoryId = state.categories[0]?.id || null;
  }
  if (!options.skipRender) render();
}

async function refreshCafe() {
  const { data: cafe } = await db.from('cafes').select('*').eq('id', state.cafe.id).maybeSingle();
  if (cafe) {
    state.cafe = cafe;
    applyTheme(cafe.theme_color || '#4A6741');
    document.title = cafe.name;
    render();
  }
}

// ---------------- Navigasyon ----------------
function openCategory(categoryId) {
  state.view = 'browse';
  state.activeCategoryId = categoryId;
  render();
  window.scrollTo({ top: 0 });
  logCategoryView(categoryId);
}

// Raporlar ekranındaki "en çok ziyaret edilen kategoriler" verisi buradan gelir.
function logCategoryView(categoryId) {
  db.from('menu_views').insert({ cafe_id: state.cafe.id, category_id: categoryId }).then(() => {});
}
function goHome() {
  state.view = 'home';
  render();
  window.scrollTo({ top: 0 });
}
function selectTab(categoryId) {
  state.activeCategoryId = categoryId;
  render();
}
function scrollToProduct(productId) {
  requestAnimationFrame(() => {
    document.getElementById(`product-${productId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ---------------- Render ----------------
function render() {
  if (!state.cafe) return;

  const hasProducts = state.products.length > 0;

  app.innerHTML = `
    ${renderTopbar()}
    <main>
      ${!hasProducts ? `<div class="empty-menu">Menü şu anda hazırlanıyor.</div>` : ''}
      ${hasProducts && state.view === 'home' ? renderHomeBanners() : ''}
      ${hasProducts && state.view === 'browse' ? renderBrowseView() : ''}
    </main>
  `;
}

function renderTopbar() {
  const logo = state.cafe.logo_url
    ? `<img class="cafe-logo" src="${escapeHtml(state.cafe.logo_url)}" alt="${escapeHtml(state.cafe.name)}" />`
    : `<div><div class="brand">${escapeHtml(state.cafe.name)}</div><div class="sub">Dijital Menü</div></div>`;
  return `
    <div class="topbar">
      ${state.view === 'browse'
        ? `<button class="back-btn" onclick="goHome()" aria-label="Ana menüye dön">←</button>`
        : logo}
      ${state.view === 'browse' ? `<div class="brand" style="font-size:1rem">${escapeHtml(state.cafe.name)}</div>` : `<div style="width:36px"></div>`}
    </div>
  `;
}

function renderHomeBanners() {
  return `
    <div class="banner-list">
      ${state.categories.map((c) => {
        const count = state.products.filter((p) => p.category_id === c.id).length;
        const bg = c.image_url ? `background-image:url('${escapeHtml(c.image_url)}')` : `background-color:var(--accent-soft)`;
        return `
          <div class="category-banner" style="${bg}" onclick="openCategory('${c.id}')">
            <div class="banner-text">
              <div class="banner-title">${escapeHtml(c.name)}</div>
              <div class="banner-count">${count} ürün</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    ${renderFooterInfo()}
  `;
}

function renderFooterInfo() {
  const wifi = state.cafe.wifi_password
    ? `<div class="footer-info-item">📶 Wifi şifresi: <strong>${escapeHtml(state.cafe.wifi_password)}</strong></div>`
    : '';
  // Basit ve şeffaf bir tahmin: her menü görüntülenmesi, basılı bir menü
  // sayfasının yerine geçtiği varsayılıyor.
  const eco = state.totalViews > 0
    ? `<div class="footer-info-item eco-note">🌱 Bu menü şimdiye kadar <strong>${state.totalViews}</strong> kez görüntülendi — tahmini o kadar kağıt sayfası tasarrufu sağladık</div>`
    : '';
  if (!wifi && !eco) return '';
  return `<div class="footer-info">${wifi}${eco}</div>`;
}

function renderBrowseView() {
  const activeCat = state.categories.find((c) => c.id === state.activeCategoryId);
  const catProducts = state.products.filter((p) => p.category_id === state.activeCategoryId);
  const featuredProducts = catProducts.filter((p) => p.is_available && p.is_featured);

  return `
    ${renderTabBar()}
    ${featuredProducts.length ? renderFeaturedStrip(featuredProducts) : ''}
    <div class="product-list">
      ${catProducts.length
        ? catProducts.map(renderProductCard).join('')
        : `<div class="empty-menu">${activeCat ? escapeHtml(activeCat.name) + ' kategorisinde henüz ürün yok.' : ''}</div>`}
    </div>
  `;
}

function renderTabBar() {
  return `
    <nav class="tab-bar">
      ${state.categories.map((c) => `
        <button class="tab-item ${c.id === state.activeCategoryId ? 'active' : ''}"
                onclick="selectTab('${c.id}')">${escapeHtml(c.name)}</button>
      `).join('')}
    </nav>
  `;
}

function renderFeaturedStrip(items) {
  const sizeClass = state.cafe.featured_size === 'large' ? ' large' : '';
  return `
    <div class="featured-strip${sizeClass}">
      ${items.map((p) => `
        <div class="featured-card" onclick="scrollToProduct('${p.id}')">
          ${p.image_url ? `<div class="featured-image" style="background-image:url('${escapeHtml(p.image_url)}')"></div>` : ''}
          <div class="featured-name">${escapeHtml(p.name)}</div>
          <div class="featured-price">${formatPrice(p.price)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function isNew(product) {
  if (!product.created_at) return false;
  const days = (Date.now() - new Date(product.created_at).getTime()) / 86400000;
  return days <= NEW_BADGE_DAYS;
}

// Sipariş sistemi yok — kartlar sadece bilgi amaçlı (isim, açıklama,
// fiyat, fotoğraf). Fotoğrafı olmayan ürünlerde görsel alanı hiç
// gösterilmez (boş/ikonlu bir kutu bırakılmaz).
function renderProductCard(p) {
  return `
    <div class="product-card ${p.is_available ? '' : 'unavailable'}" id="product-${p.id}">
      <div class="product-info">
        <div class="product-name-row">
          <p class="product-name">${escapeHtml(p.name)}</p>
          ${isNew(p) ? `<span class="badge-new">Yeni</span>` : ''}
        </div>
        ${p.description ? `<p class="product-desc">${escapeHtml(p.description)}</p>` : ''}
        <div class="product-bottom-row">
          <span class="product-price">${formatPrice(p.price)}</span>
          ${!p.is_available ? `<span class="unavailable-tag">Tükendi</span>` : ''}
        </div>
      </div>
      ${p.image_url ? `<img class="product-image" src="${escapeHtml(p.image_url)}" alt="">` : ''}
    </div>
  `;
}

function renderError(title, message) {
  app.innerHTML = `
    <div class="error-screen">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

// ---------------- Yardımcılar ----------------
function formatPrice(n) {
  return `${Number(n).toFixed(2).replace('.00', '')} ₺`;
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

window.openCategory = openCategory;
window.goHome = goHome;
window.selectTab = selectTab;
window.scrollToProduct = scrollToProduct;

loadMenu();
