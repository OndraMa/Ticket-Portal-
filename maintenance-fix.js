/**
 * OPRAVA: Logika pro sekci Údržba (Roboti mimo provoz)
 * 
 * Problém 1: Údržba zobrazuje i vrácené roboty
 * Řešení: Filtrovat jen aktuálně mimo provoz (poslední stav back === false)
 * 
 * Problém 2: Detail se neotevírá/zavírá korektně
 * Řešení: Accordion s event handling a stopPropagation
 */

// Helper: výpočet posledního relevantního stavu pro robot
function tsKey(rec) {
  return (rec.date || '9999-12-31') + (rec.time || '23:59');
}

function sortNewestFirst(a, b) {
  return tsKey(b).localeCompare(tsKey(a));
}

// Helper: Najít poslední relevantní stav (back === true/false)
function getLastRelevantState(serial) {
  const rows = [...servis]
    .filter(r => r.serial === serial)
    .sort(sortNewestFirst);

  return rows.find(r => r.back === true || r.back === false) || null;
}

// Helper: Získat epizodu údržby (od "Dán do údržby" až po "Vrácen" nebo současnost)
function getMaintenanceEpisode(serial) {
  const rows = [...servis]
    .filter(r => r.serial === serial)
    .sort(sortNewestFirst);

  // Najít poslední "Dán do údržby" (back === false)
  const outIdx = rows.findIndex(r => r.back === false || r.back === 'false');
  if (outIdx === -1) return [];

  const episode = [];
  for (let i = outIdx; i >= 0; i--) {
    const r = rows[i];
    episode.push(r);
    if ((r.back === true || r.back === 'true') && i < outIdx) break;
  }

  return episode.sort((a, b) => tsKey(a).localeCompare(tsKey(b)));
}

// Helper: Spočítat dny od data do dneška
function calcDaysSince(dateStr) {
  if (!dateStr) return 0;
  const start = new Date(dateStr);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - start) / 86400000));
}

// **HLAVNÍ FUNKCE**: Najít všechny roboty aktuálně mimo provoz
function computeOutOfServiceDetail() {
  const rows = [...servis]
    .filter(r => (r.type === 'RS11' || r.type === 'P40') && r.serial)
    .sort(sortNewestFirst);

  const map = new Map();

  for (const r of rows) {
    if (map.has(r.serial)) continue;

    // Získat poslední relevantní stav
    const last = getLastRelevantState(r.serial);
    
    // ⚠️ KLÍČOVÁ OPRAVA: Zahrnout jen roboty s back === false (mimo provoz)
    if (!last || (last.back !== false && last.back !== 'false')) continue;

    // Získat epizodu údržby (všechny záznamy od poslední "Dán do údržby")
    const episode = getMaintenanceEpisode(r.serial);
    const latest = episode[episode.length - 1] || last;

    map.set(r.serial, {
      serial: r.serial,
      type: r.type,
      tech: latest.tech ? (Array.isArray(latest.tech) ? latest.tech.join(', ') : latest.tech) : '',
      days: calcDaysSince(last.date),
      latest,
      episode
    });
  }

  const out = { RS11: [], P40: [] };
  map.forEach(item => out[item.type].push(item));

  // Řazení dle sériového čísla (numericky)
  out.RS11.sort((a, b) => a.serial.localeCompare(b.serial, 'cs', { numeric: true }));
  out.P40.sort((a, b) => a.serial.localeCompare(b.serial, 'cs', { numeric: true }));

  return out;
}

// Helper: Celkový počet robotů mimo provoz
function computeOutOfService() {
  const det = computeOutOfServiceDetail();
  return { total: det.RS11.length + det.P40.length, byType: det };
}

// **HLAVNÍ RENDER FUNKCE**: Vykreslit seznam údržby s accordionem
function renderMaintenance() {
  const container = $('#maintList');
  if (!container) return;

  // Aplikovat filtry
  const typeFilter = $('#maintFilterType')?.value || 'ALL';
  const searchTerm = ($('#maintSearch')?.value || '').toLowerCase();
  const sortType = $('#maintSort')?.value || 'SERIAL';

  const detail = computeOutOfServiceDetail();
  let items = [];

  if (typeFilter === 'ALL') {
    items = [...detail.RS11, ...detail.P40];
  } else {
    items = detail[typeFilter] || [];
  }

  // Filtrování dle hledání
  items = items.filter(item => {
    const searchStr = `${item.serial} ${item.latest?.title || ''} ${item.latest?.ticket || ''} ${item.tech}`.toLowerCase();
    return searchStr.includes(searchTerm);
  });

  // Řazení
  if (sortType === 'DATE') {
    items.sort((a, b) => tsKey(b.latest).localeCompare(tsKey(a.latest)));
  } else {
    // SERIAL (default)
    items.sort((a, b) => a.serial.localeCompare(b.serial, 'cs', { numeric: true }));
  }

  // Vyprázdnit container
  container.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'card center';
    empty.style.padding = '32px';
    empty.innerHTML = `<p class="soft">${LANG === 'cs' ? 'Žádný robot není mimo provoz.' : 'No robots are out of service.'}</p>`;
    container.appendChild(empty);
    return;
  }

  // Vykreslit každý robot
  items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cursor = 'pointer';

    // Badge pro počet dní
    const daysClass = item.days >= 8 ? 'days-bad' : item.days >= 4 ? 'days-warn' : 'days-good';

    // Hlavní řádek (klikací)
    const header = document.createElement('div');
    header.className = 'hist-head';
    header.style.cursor = 'pointer';
    header.innerHTML = `
      <div style="flex:1;">
        <div class="hist-title">${item.type} · ${item.serial}</div>
        <div class="hist-meta" style="margin-top:6px;">
          <span class="soft">${item.tech || '—'}</span>
          <span class="days-badge ${daysClass}">${item.days} ${LANG === 'cs' ? 'dní' : 'days'}</span>
        </div>
      </div>
    `;

    // Event na header – toggle detail
    let isExpanded = false;
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      isExpanded = !isExpanded;
      detailContainer.style.display = isExpanded ? 'block' : 'none';
      arrow.textContent = isExpanded ? '▼' : '▶';
    });

    // Šipka
    const arrow = document.createElement('div');
    arrow.style.fontSize = '12px';
    arrow.textContent = '▶';
    header.appendChild(arrow);

    card.appendChild(header);

    // Detail (skrytý obsah)
    const detailContainer = document.createElement('div');
    detailContainer.style.display = 'none';
    detailContainer.style.marginTop = '12px';
    detailContainer.style.paddingTop = '12px';
    detailContainer.style.borderTop = '1px solid var(--border)';

    // Vykreslit všechny záznamy z epizody
    if (item.episode && item.episode.length) {
      const episodeList = document.createElement('div');
      episodeList.style.display = 'flex';
      episodeList.style.flexDirection = 'column';
      episodeList.style.gap = '8px';

      item.episode.forEach(rec => {
        const recItem = document.createElement('div');
        recItem.style.padding = '8px';
        recItem.style.backgroundColor = 'var(--chip-bg)';
        recItem.style.borderRadius = '8px';
        recItem.style.fontSize = '13px';
        recItem.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <strong>${rec.date} ${rec.time}</strong>
            <span class="pill" style="font-size:11px;${rec.back === false || rec.back === 'false' ? 'background:#2a1517;border-color:#52252a;color:#fecaca;' : 'background:#0e321c;border-color:#28553a;color:#bbf7d0;'}">
              ${rec.back === false || rec.back === 'false' ? (LANG === 'cs' ? '❌ Vyřazen' : '❌ Out') : (LANG === 'cs' ? '✓ Vrácen' : '✓ Back')}
            </span>
          </div>
          <div class="soft" style="font-size:12px;"><strong>${rec.title || '—'}</strong></div>
          ${rec.ticket ? `<div class="soft" style="font-size:11px;">Ticket: ${rec.ticket}</div>` : ''}
          ${Array.isArray(rec.tech) ? `<div class="soft" style="font-size:11px;">Technik: ${rec.tech.join(', ')}</div>` : rec.tech ? `<div class="soft" style="font-size:11px;">Technik: ${rec.tech}</div>` : ''}
        `;
        episodeList.appendChild(recItem);
      });

      detailContainer.appendChild(episodeList);
    }

    card.appendChild(detailContainer);

    // Zabraň propagaci kliknutí na detail
    detailContainer.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    container.appendChild(card);
  });
}

// Attach event listeners pro filtry/vyhledávání
function attachMaintenanceFilters() {
  const search = $('#maintSearch');
  const typeFilter = $('#maintFilterType');
  const sort = $('#maintSort');

  const rerender = () => renderMaintenance();

  if (search) search.addEventListener('input', rerender);
  if (typeFilter) typeFilter.addEventListener('change', rerender);
  if (sort) sort.addEventListener('change', rerender);
}
