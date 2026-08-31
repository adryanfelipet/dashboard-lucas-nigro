(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  // Estado do filtro de periodo (preenchido em window.renderDashboard).
  var STATE = { from: null, to: null, preset: 'month', compare: false };
  var ALL_DAILY = [], ALL_GRAIN = [], minDate = null, maxDate = null;

  // PS 5.1 (ConvertTo-Json) as vezes colapsa array de 1 item em escalar.
  // arr() normaliza qualquer valor de window.DAILY/window.GRAIN para array.
  function arr(x) {
    if (Array.isArray(x)) return x;
    if (x === null || x === undefined) return [];
    return [x];
  }

  function okNum(v) { return v !== null && v !== undefined && isFinite(v); }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') { e.textContent = attrs[k]; }
        else if (k === 'html') { e.innerHTML = attrs[k]; }
        else { e.setAttribute(k, attrs[k]); }
      });
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    }
    return e;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function fmtInt(n) {
    if (!okNum(n)) return '—';
    return Math.round(n).toLocaleString('pt-BR');
  }

  function fmtCurrency(n) {
    if (!okNum(n)) return '—';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtPct(n, digits) {
    if (!okNum(n)) return '—';
    var d = digits || 1;
    return n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  }

  function fmtDateShort(isoDay) {
    var parts = isoDay.split('-');
    return parts[2] + '/' + parts[1];
  }

  function fmtDateFull(isoDay) {
    var parts = isoDay.split('-');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  // ---------------------------------------------------------------------
  // Tooltip
  // ---------------------------------------------------------------------
  var tooltipEl = document.getElementById('tooltip');
  function showTooltip(x, y, titleText, rows) {
    tooltipEl.innerHTML = '';
    tooltipEl.appendChild(el('div', { class: 'tt-title', text: titleText }));
    rows.forEach(function (r) {
      tooltipEl.appendChild(el('div', { class: 'tt-row', text: r }));
    });
    tooltipEl.hidden = false;
    var pad = 12;
    tooltipEl.style.left = (x + pad) + 'px';
    tooltipEl.style.top = (y + pad) + 'px';
  }
  function hideTooltip() { tooltipEl.hidden = true; }

  // ---------------------------------------------------------------------
  // Agregacao client-side a partir de DAILY[] / GRAIN[]
  // ---------------------------------------------------------------------
  function computeTotals(daily) {
    var t = {
      investimento: 0, impressoes: 0, cliques: 0, leads_pixel: 0,
      leads: 0, qualificados: 0, vendas: 0
    };
    daily.forEach(function (d) {
      t.investimento += d.investimento || 0;
      t.impressoes += d.impressoes || 0;
      t.cliques += d.cliques || 0;
      t.leads_pixel += d.leads_pixel || 0;
      t.leads += d.leads || 0;
      t.qualificados += d.qualificados || 0;
      t.vendas += d.vendas || 0;
    });
    t.cpm = t.impressoes > 0 ? (t.investimento / t.impressoes) * 1000 : 0;
    t.cpc = t.cliques > 0 ? t.investimento / t.cliques : 0;
    t.ctr_link = t.impressoes > 0 ? (t.cliques / t.impressoes) * 100 : 0;
    t.cpl = t.leads > 0 ? t.investimento / t.leads : null;
    t.clique_lead_pct = t.cliques > 0 ? (t.leads / t.cliques) * 100 : 0;
    t.pct_qualificacao = t.leads > 0 ? (t.qualificados / t.leads) * 100 : 0;
    return t;
  }

  // ---------------------------------------------------------------------
  // Stat tiles
  // ---------------------------------------------------------------------
  function statTile(label, value, sub, deltaHtml) {
    var children = [
      el('div', { class: 'stat-label', text: label }),
      el('div', { class: 'stat-value', text: value })
    ];
    if (sub || deltaHtml) {
      var subEl = el('div', { class: 'stat-sub' });
      if (deltaHtml) subEl.innerHTML = deltaHtml;
      if (sub) subEl.appendChild(document.createTextNode(sub));
      children.push(subEl);
    }
    return el('div', { class: 'stat-tile' }, children);
  }

  // Indicador de variacao vs periodo anterior (so aparece com STATE.compare ligado).
  // better=true: subir e bom (verde). better=false: subir e ruim (vermelho). null: neutro (cinza).
  function miniDelta(cur, prev, better) {
    if (!STATE.compare || !okNum(prev) || prev === 0 || !okNum(cur)) return '';
    var ch = (cur - prev) / Math.abs(prev);
    var arrow = Math.abs(ch) < 0.0005 ? '→' : (ch > 0 ? '▲' : '▼');
    var cls;
    if (better === null) { cls = 'flat'; }
    else {
      var bad = better === false;
      cls = Math.abs(ch) < 0.0005 ? 'flat' : (((ch > 0) !== bad) ? 'up' : 'down');
    }
    var pctTxt = Math.abs(ch * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return '<span class="delta ' + cls + '">' + arrow + ' ' + pctTxt + '%</span> ';
  }

  function renderHeadline(totals, prev) {
    var host = document.getElementById('headline-tiles');
    host.appendChild(statTile('Leads (planilha)', fmtInt(totals.leads), 'número-verdade do funil, únicos por email', miniDelta(totals.leads, prev && prev.leads, true)));
    host.appendChild(statTile('CPL', fmtCurrency(totals.cpl), 'investimento ÷ leads', miniDelta(totals.cpl, prev && prev.cpl, false)));
    host.appendChild(statTile('Leads (pixel Meta)', fmtInt(totals.leads_pixel), 'referência — evento Lead', miniDelta(totals.leads_pixel, prev && prev.leads_pixel, null)));
  }

  function renderMql(totals, prev) {
    var host = document.getElementById('mql-tiles');
    host.appendChild(statTile('Qualificados', fmtInt(totals.qualificados), null, miniDelta(totals.qualificados, prev && prev.qualificados, true)));
    host.appendChild(statTile('% Qualificação', fmtPct(totals.pct_qualificacao), 'qualificados ÷ leads', miniDelta(totals.pct_qualificacao, prev && prev.pct_qualificacao, true)));
  }

  function renderCards(totals, prev) {
    var host = document.getElementById('cards-tiles');
    host.appendChild(statTile('Investimento', fmtCurrency(totals.investimento), 'com imposto (x1,1385)', miniDelta(totals.investimento, prev && prev.investimento, null)));
    host.appendChild(statTile('CPM', fmtCurrency(totals.cpm), null, miniDelta(totals.cpm, prev && prev.cpm, false)));
    host.appendChild(statTile('CTR (link)', fmtPct(totals.ctr_link, 2), null, miniDelta(totals.ctr_link, prev && prev.ctr_link, true)));
    host.appendChild(statTile('CPC', fmtCurrency(totals.cpc), null, miniDelta(totals.cpc, prev && prev.cpc, false)));
    host.appendChild(statTile('Cliques', fmtInt(totals.cliques), 'cliques no link', miniDelta(totals.cliques, prev && prev.cliques, true)));
    host.appendChild(statTile('Leads', fmtInt(totals.leads), null, miniDelta(totals.leads, prev && prev.leads, true)));
    host.appendChild(statTile('CPL', fmtCurrency(totals.cpl), null, miniDelta(totals.cpl, prev && prev.cpl, false)));
    host.appendChild(statTile('Clique → Lead', fmtPct(totals.clique_lead_pct, 2), null, miniDelta(totals.clique_lead_pct, prev && prev.clique_lead_pct, true)));
  }

  // ---------------------------------------------------------------------
  // Funil completo (5 etapas): Impressoes -> Cliques -> Leads -> MQL -> Vendas
  // ---------------------------------------------------------------------
  var STAGE_COLORS = [
    { bg: 'color-mix(in srgb, var(--brand) 28%, var(--card))', ink: 'var(--ink-1)' },
    { bg: 'color-mix(in srgb, var(--brand) 48%, var(--card))', ink: 'var(--ink-1)' },
    { bg: 'color-mix(in srgb, var(--brand) 68%, var(--card))', ink: 'var(--brand-ink)' },
    { bg: 'color-mix(in srgb, var(--brand) 86%, var(--card))', ink: 'var(--brand-ink)' },
    { bg: 'var(--brand)', ink: 'var(--brand-ink)' }
  ];

  function renderFunnel(totals) {
    var host = document.getElementById('funnel');
    var custoQualificado = totals.qualificados > 0 ? totals.investimento / totals.qualificados : null;
    var custoVenda = totals.vendas > 0 ? totals.investimento / totals.vendas : null;
    var leadVendaPct = totals.leads > 0 ? (totals.vendas / totals.leads) * 100 : 0;
    var qualifVendaPct = totals.qualificados > 0 ? (totals.vendas / totals.qualificados) * 100 : 0;

    var stages = [
      { n: 'Impressões', v: fmtInt(totals.impressoes), cl: 'CPM', cv: fmtCurrency(totals.cpm), sub: 'CTR (link) <b>' + fmtPct(totals.ctr_link, 2) + '</b>' },
      { n: 'Cliques (link)', v: fmtInt(totals.cliques), cl: 'CPC (link)', cv: fmtCurrency(totals.cpc), sub: 'Clique → Lead <b>' + fmtPct(totals.clique_lead_pct, 2) + '</b>' },
      { n: 'Leads', v: fmtInt(totals.leads), cl: 'Custo / Lead', cv: fmtCurrency(totals.cpl), sub: 'Lead → Qualificado <b>' + fmtPct(totals.pct_qualificacao, 1) + '</b>' },
      { n: 'Qualificados (MQL)', v: fmtInt(totals.qualificados), cl: 'Custo / Qualificado', cv: fmtCurrency(custoQualificado), sub: 'Qualificado → Venda <b>' + fmtPct(qualifVendaPct, 1) + '</b>' },
      { n: 'Vendas', v: fmtInt(totals.vendas), cl: 'Custo / Venda (CAC)', cv: fmtCurrency(custoVenda), sub: 'Lead → Venda <b>' + fmtPct(leadVendaPct, 2) + '</b>' }
    ];

    host.innerHTML = stages.map(function (s, i) {
      var c = STAGE_COLORS[i];
      return '<div class="fstage"><div class="fl" style="background:' + c.bg + ';color:' + c.ink + '">' +
        '<div class="fn">' + esc(s.n) + '</div><div class="fv">' + s.v + '</div></div>' +
        '<div class="fr"><div class="cl">' + esc(s.cl) + '</div><div class="cv">' + s.cv + '</div><div class="fsub">' + s.sub + '</div></div></div>';
    }).join('');
  }

  // ---------------------------------------------------------------------
  // Grafico combinado: barra(s) + linha, com eixo duplo (esq/dir) e crosshair
  // ---------------------------------------------------------------------
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }
  function ticksFor(max, n) {
    n = n || 4;
    var out = [];
    for (var i = 0; i <= n; i++) out.push(max * i / n);
    return out;
  }
  function labelStep(count, width) { return Math.max(1, Math.ceil(count / Math.max(2, Math.floor(width / 58)))); }

  function comboChart(host, rows, cfg) {
    host.innerHTML = '';
    var W = Math.max(300, host.clientWidth || 520), H = 240;
    var P = { t: 22, r: 54, b: 28, l: 58 }, iw = W - P.l - P.r, ih = H - P.t - P.b, n = rows.length;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img' });

    var leftVals = [];
    rows.forEach(function (r) { cfg.bars.forEach(function (b) { leftVals.push(r[b.key] || 0); }); });
    var leftMax = niceMax(Math.max.apply(null, leftVals.concat([0])));
    var rightVals = rows.map(function (r) { return r[cfg.line.key]; }).filter(okNum);
    var rightMax = niceMax(Math.max.apply(null, rightVals.concat([0])));
    var yL = function (v) { return P.t + ih - (leftMax > 0 ? (v / leftMax) * ih : 0); };
    var yR = function (v) { return P.t + ih - (rightMax > 0 ? (v / rightMax) * ih : 0); };

    ticksFor(leftMax).forEach(function (t) {
      var y = yL(t);
      svg.appendChild(svgEl('line', { x1: P.l, x2: P.l + iw, y1: y, y2: y, class: 'gridline' }));
      var tx = svgEl('text', { x: P.l - 7, y: y + 4, 'text-anchor': 'end', class: 'axis-label' });
      tx.textContent = cfg.leftFmt(t);
      svg.appendChild(tx);
    });
    ticksFor(rightMax).forEach(function (t) {
      var y = yR(t);
      var tx = svgEl('text', { x: P.l + iw + 7, y: y + 4, 'text-anchor': 'start', class: 'axis-label' });
      tx.textContent = cfg.rightFmt(t);
      svg.appendChild(tx);
    });
    svg.appendChild(svgEl('line', { x1: P.l, x2: P.l + iw, y1: P.t + ih, y2: P.t + ih, class: 'axis-line' }));

    var slot = n > 0 ? iw / n : iw, nb = cfg.bars.length;
    var groupW = Math.min(slot - 3, nb > 1 ? 40 : 30), bw = Math.max(2, groupW / nb - 1), step = labelStep(n, iw);
    rows.forEach(function (r, i) {
      var cx = P.l + slot * i + slot / 2;
      cfg.bars.forEach(function (b, bi) {
        var v = r[b.key] || 0, h = Math.max(v > 0 ? 1.5 : 0, P.t + ih - yL(v));
        var x = cx - groupW / 2 + bi * (groupW / nb) + (groupW / nb - bw) / 2;
        if (h > 0) {
          svg.appendChild(svgEl('rect', {
            x: x, y: P.t + ih - h, width: bw, height: h, rx: Math.min(3, bw / 2),
            style: 'fill:' + b.color
          }));
        }
      });
      if (i % step === 0 || i === n - 1) {
        var tx = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'axis-label' });
        tx.textContent = fmtDateShort(r.data);
        svg.appendChild(tx);
      }
    });

    var pts = rows.map(function (r, i) {
      var v = r[cfg.line.key];
      return okNum(v) ? [P.l + slot * i + slot / 2, yR(v)] : null;
    });
    var seg = [], segs = [];
    pts.forEach(function (p) { if (p) seg.push(p); else if (seg.length) { segs.push(seg); seg = []; } });
    if (seg.length) segs.push(seg);
    segs.forEach(function (s) {
      var d = s.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      svg.appendChild(svgEl('path', {
        d: d, style: 'fill:none;stroke:' + cfg.line.color + ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round'
      }));
    });
    if (n <= 45) {
      pts.forEach(function (p) {
        if (p) svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 3.2, style: 'fill:' + cfg.line.color }));
      });
    }

    var cross = svgEl('line', { class: 'chart-cross', y1: P.t, y2: P.t + ih });
    svg.appendChild(cross);
    var hit = svgEl('rect', { class: 'chart-hit', x: P.l, y: P.t, width: iw, height: ih });
    hit.addEventListener('mousemove', function (ev) {
      var box = svg.getBoundingClientRect();
      var i = Math.max(0, Math.min(n - 1, Math.floor((((ev.clientX - box.left) / box.width) * W - P.l) / slot)));
      var r = rows[i], cx = P.l + slot * i + slot / 2;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.opacity = 1;
      var lines = [];
      cfg.bars.forEach(function (b) { lines.push(b.name + ': ' + cfg.leftFmt(r[b.key] || 0)); });
      lines.push(cfg.line.name + ': ' + cfg.lineFmt(r[cfg.line.key]));
      showTooltip(ev.clientX, ev.clientY, fmtDateFull(r.data), lines);
    });
    hit.addEventListener('mouseleave', function () { cross.style.opacity = 0; hideTooltip(); });
    svg.appendChild(hit);
    host.appendChild(svg);
  }

  function legendHTML(items) {
    return items.map(function (it) {
      return '<span><i style="background:' + it.color + '"></i>' + esc(it.name) + '</span>';
    }).join('');
  }

  function renderComboCharts(daily) {
    document.getElementById('legA').innerHTML = legendHTML([
      { name: 'Investimento c/ imposto', color: 'var(--brand)' },
      { name: 'Leads (eixo dir.)', color: 'var(--series-2)' }
    ]);
    comboChart(document.getElementById('chA'), daily, {
      bars: [{ key: 'investimento', color: 'var(--brand)', name: 'Investimento c/ imposto' }],
      line: { key: 'leads', color: 'var(--series-2)', name: 'Leads' },
      leftFmt: fmtCurrency, rightFmt: fmtInt, lineFmt: fmtInt
    });

    document.getElementById('legB').innerHTML = legendHTML([
      { name: 'Leads', color: 'var(--brand)' },
      { name: 'Custo por lead (eixo dir.)', color: 'var(--series-2)' }
    ]);
    comboChart(document.getElementById('chB'), daily, {
      bars: [{ key: 'leads', color: 'var(--brand)', name: 'Leads' }],
      line: { key: 'cpl', color: 'var(--series-2)', name: 'Custo/lead' },
      leftFmt: fmtInt, rightFmt: fmtCurrency, lineFmt: fmtCurrency
    });
  }

  // ---------------------------------------------------------------------
  // Arvore Campanha > Conjunto > Anuncio (Otimizacao)
  // ---------------------------------------------------------------------
  var TREE_STATE = { expanded: {} };

  var TCOLS = [
    { k: 'label', label: 'Campanha › Conjunto › Anúncio' },
    { k: 'investimento', label: 'Investimento', fmt: fmtCurrency },
    { k: 'cpm', label: 'CPM', fmt: fmtCurrency, scale: 'low' },
    { k: 'ctr', label: 'CTR (link)', fmt: function (v) { return fmtPct(v, 2); }, scale: 'high' },
    { k: 'cpc', label: 'CPC (link)', fmt: fmtCurrency, scale: 'low' },
    { k: 'cliques', label: 'Cliques (link)', fmt: fmtInt },
    { k: 'leads', label: 'Leads', fmt: fmtInt, scale: 'high' },
    { k: 'cpl', label: 'CPL', fmt: fmtCurrency, scale: 'low' }
  ];

  function tblank(label) { return { label: label, investimento: 0, impressoes: 0, cliques: 0, leads: 0, kids: {} }; }
  function tderive(t) {
    var o = {
      label: t.label, investimento: t.investimento, impressoes: t.impressoes, cliques: t.cliques, leads: t.leads
    };
    o.cpm = t.impressoes > 0 ? (t.investimento / t.impressoes) * 1000 : 0;
    o.ctr = t.impressoes > 0 ? (t.cliques / t.impressoes) * 100 : 0;
    o.cpc = t.cliques > 0 ? t.investimento / t.cliques : 0;
    o.cpl = t.leads > 0 ? t.investimento / t.leads : null;
    return o;
  }

  function buildTree(grain) {
    var root = {};
    grain.forEach(function (g) {
      var c = root[g.campanha] || (root[g.campanha] = tblank(g.campanha));
      var s = c.kids[g.conjunto] || (c.kids[g.conjunto] = tblank(g.conjunto));
      var a = s.kids[g.anuncio] || (s.kids[g.anuncio] = tblank(g.anuncio));
      a.investimento += g.investimento || 0;
      a.impressoes += g.impressoes || 0;
      a.cliques += g.cliques || 0;
      a.leads += g.leads || 0;
    });
    var RAW = ['investimento', 'impressoes', 'cliques', 'leads'];
    function roll(node, key, level) {
      var kids = Object.keys(node.kids).map(function (k) { return roll(node.kids[k], key + ' › ' + k, level + 1); });
      var agg = tblank(node.label);
      RAW.forEach(function (k) { agg[k] = node[k]; });
      kids.forEach(function (c) { RAW.forEach(function (k) { agg[k] += c[k]; }); });
      var d = tderive(agg);
      d.key = key; d.level = level; d.kids = kids;
      return d;
    }
    return Object.keys(root).map(function (k) { return roll(root[k], k, 0); });
  }

  function computeScales(camps) {
    var scales = {};
    TCOLS.filter(function (c) { return c.scale; }).forEach(function (c) {
      var vals = camps.filter(function (r) { return r.investimento > 0 && okNum(r[c.k]); }).map(function (r) { return r[c.k]; });
      if (vals.length > 1) scales[c.k] = { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals), dir: c.scale };
    });
    return scales;
  }

  function shade(scales, k, v) {
    var s = scales[k];
    if (!s || !okNum(v) || s.max === s.min) return '';
    var t = (v - s.min) / (s.max - s.min);
    if (s.dir === 'low') t = 1 - t;
    if (t < 0.15) return '';
    var pct = Math.round(t * 32);
    return 'background:color-mix(in srgb, var(--brand) ' + pct + '%, transparent)';
  }

  function sortNodes(list) { return list.slice().sort(function (a, b) { return b.investimento - a.investimento; }); }

  function flattenTree(camps) {
    var out = [];
    sortNodes(camps).forEach(function (c) {
      out.push(c);
      if (TREE_STATE.expanded[c.key]) {
        sortNodes(c.kids).forEach(function (s) {
          out.push(s);
          if (TREE_STATE.expanded[s.key]) sortNodes(s.kids).forEach(function (a) { out.push(a); });
        });
      }
    });
    return out;
  }

  function renderOtimizacao(grain) {
    var table = document.getElementById('tabela-otimizacao');
    var camps = buildTree(grain);
    var scales = computeScales(camps);

    var theadRow = el('tr', null, TCOLS.map(function (c) {
      return el('th', c.k === 'label' ? { text: c.label } : { class: 'num', text: c.label });
    }));
    var thead = el('thead', null, [theadRow]);

    var tbody = el('tbody');
    var rows = flattenTree(camps);

    if (rows.length === 0) {
      tbody.appendChild(el('tr', null, [el('td', { class: 'empty-state', colspan: String(TCOLS.length), text: 'Sem dados no período.' })]));
    } else {
      rows.forEach(function (r) {
        var canExpand = r.level < 2 && r.kids && r.kids.length > 0;
        var isOpen = !!TREE_STATE.expanded[r.key];
        var trClass = 'lv' + r.level + (canExpand ? ' exp' : '') + (isOpen ? ' open' : '');
        var tr = el('tr', { class: trClass });

        var caret = el('span', { class: 'caret', text: canExpand ? '▸' : '' });
        var nmSpan = el('span', { class: 'nm' }, [caret, document.createTextNode(r.label)]);
        var firstTd = el('td', null, [nmSpan]);
        tr.appendChild(firstTd);

        TCOLS.slice(1).forEach(function (c) {
          var val = r[c.k];
          var text = c.fmt(val);
          var td = el('td', { class: 'num' });
          var style = c.scale ? shade(scales, c.k, val) : '';
          if (style) {
            var span = el('span', { class: 'cell-scale', style: style, text: text });
            td.appendChild(span);
          } else {
            td.textContent = text;
          }
          tr.appendChild(td);
        });

        if (canExpand) {
          firstTd.addEventListener('click', function () {
            TREE_STATE.expanded[r.key] = !TREE_STATE.expanded[r.key];
            renderOtimizacao(grain);
          });
        }
        tbody.appendChild(tr);
      });
    }

    var totRaw = camps.reduce(function (t, r) {
      t.investimento += r.investimento; t.impressoes += r.impressoes; t.cliques += r.cliques; t.leads += r.leads;
      return t;
    }, { investimento: 0, impressoes: 0, cliques: 0, leads: 0 });
    var tot = tderive(totRaw);
    var footRow = el('tr', null, [el('td', { text: 'Total — ' + camps.length + ' campanha(s)' })].concat(
      TCOLS.slice(1).map(function (c) { return el('td', { class: 'num', text: c.fmt(tot[c.k]) }); })
    ));
    var tfoot = el('tfoot', null, [footRow]);

    table.innerHTML = '';
    table.appendChild(thead);
    table.appendChild(tbody);
    table.appendChild(tfoot);
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  function initTabs() {
    var btnGeral = document.getElementById('tab-btn-geral');
    var btnTrafego = document.getElementById('tab-btn-trafego');
    var panelGeral = document.getElementById('tab-geral');
    var panelTrafego = document.getElementById('tab-trafego');

    function activate(btn, panel, otherBtn, otherPanel) {
      btn.classList.add('is-active'); btn.setAttribute('aria-selected', 'true');
      otherBtn.classList.remove('is-active'); otherBtn.setAttribute('aria-selected', 'false');
      panel.hidden = false; panel.classList.add('is-active');
      otherPanel.hidden = true; otherPanel.classList.remove('is-active');
    }

    btnGeral.addEventListener('click', function () { activate(btnGeral, panelGeral, btnTrafego, panelTrafego); });
    btnTrafego.addEventListener('click', function () { activate(btnTrafego, panelTrafego, btnGeral, panelGeral); });
  }

  // ---------------------------------------------------------------------
  // Tema claro/escuro (manual, com persistencia)
  // ---------------------------------------------------------------------
  function initTheme() {
    var btn = document.getElementById('theme-btn');
    function current() {
      var attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark' || attr === 'light') return attr;
      return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    function apply(t) {
      document.documentElement.setAttribute('data-theme', t);
      btn.textContent = t === 'dark' ? 'Claro' : 'Escuro';
      try { localStorage.setItem('ral-theme', t); } catch (e) { /* sem storage disponivel */ }
    }
    apply(current());
    btn.addEventListener('click', function () { apply(current() === 'dark' ? 'light' : 'dark'); });
  }

  // ---------------------------------------------------------------------
  // Filtro de periodo (presets, datas, comparar c/ periodo anterior)
  // ---------------------------------------------------------------------
  function dayAdd(ds, n) {
    var p = ds.split('-');
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
  function diffDays(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }
  function firstOfMonth(ds) { return ds.slice(0, 7) + '-01'; }
  function clampD(ds) { return ds < minDate ? minDate : (ds > maxDate ? maxDate : ds); }
  function within(d, from, to) { return d >= from && d <= to; }
  function filterDaily(from, to) { return ALL_DAILY.filter(function (d) { return within(d.data, from, to); }); }
  function filterGrain(from, to) { return ALL_GRAIN.filter(function (g) { return within(g.data, from, to); }); }

  function setPeriod(from, to, preset) {
    STATE.from = clampD(from);
    STATE.to = clampD(to);
    STATE.preset = preset || 'custom';
    document.getElementById('from').value = STATE.from;
    document.getElementById('to').value = STATE.to;
    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.preset === STATE.preset));
    });
    refresh();
  }

  function initPeriodControls() {
    var fromInput = document.getElementById('from'), toInput = document.getElementById('to');
    fromInput.min = toInput.min = minDate;
    fromInput.max = toInput.max = maxDate;

    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.preset;
        if (p === 'all') return setPeriod(minDate, maxDate, 'all');
        if (p === 'today') return setPeriod(maxDate, maxDate, 'today');
        if (p === 'yesterday') { var y = dayAdd(maxDate, -1); return setPeriod(y, y, 'yesterday'); }
        if (p === 'month') return setPeriod(firstOfMonth(maxDate), maxDate, 'month');
        var n = +p;
        return setPeriod(dayAdd(maxDate, -(n - 1)), maxDate, p);
      });
    });

    function clampDates() {
      var f = fromInput.value, t = toInput.value;
      if (!f || !t) return;
      if (f > t) { var tmp = f; f = t; t = tmp; }
      setPeriod(f, t, 'custom');
    }
    fromInput.addEventListener('change', clampDates);
    toInput.addEventListener('change', clampDates);

    var cmpBtn = document.getElementById('cmp');
    cmpBtn.addEventListener('click', function () {
      STATE.compare = !STATE.compare;
      cmpBtn.classList.toggle('on', STATE.compare);
      cmpBtn.setAttribute('aria-pressed', String(STATE.compare));
      refresh();
    });
  }

  function refresh() {
    var len = diffDays(STATE.from, STATE.to) + 1;
    var daily = filterDaily(STATE.from, STATE.to);
    var grain = filterGrain(STATE.from, STATE.to);
    var totals = computeTotals(daily);

    var prevTotals = null;
    if (STATE.compare) {
      var pTo = dayAdd(STATE.from, -1);
      var pFrom = dayAdd(pTo, -(len - 1));
      prevTotals = computeTotals(filterDaily(pFrom, pTo));
    }

    var cmpNote = document.getElementById('cmpNote');
    if (STATE.compare) {
      var pTo2 = dayAdd(STATE.from, -1), pFrom2 = dayAdd(pTo2, -(len - 1));
      cmpNote.textContent = 'comparando com ' + fmtDateFull(pFrom2) + ' – ' + fmtDateFull(pTo2) + ' (' + len + (len > 1 ? ' dias' : ' dia') + ')';
    } else {
      cmpNote.textContent = len + (len > 1 ? ' dias selecionados' : ' dia selecionado');
    }

    document.getElementById('headline-tiles').innerHTML = '';
    document.getElementById('mql-tiles').innerHTML = '';
    document.getElementById('cards-tiles').innerHTML = '';

    renderHeadline(totals, prevTotals);
    renderMql(totals, prevTotals);
    renderFunnel(totals);
    renderComboCharts(daily);
    renderCards(totals, prevTotals);
    renderOtimizacao(grain);
  }

  // ---------------------------------------------------------------------
  // Bootstrap (chamado pelo loader em index.html apos data-*.js carregarem)
  // ---------------------------------------------------------------------
  function renderError(message) {
    var page = document.querySelector('.page');
    page.innerHTML = '';
    page.appendChild(el('div', {
      class: 'panel', html: '<h2>Erro ao montar o dashboard</h2><p class="panel-hint">' + message + '</p>'
    }));
  }

  function formatPeriodo(p) {
    return fmtDateShort(p.inicio) + ' – ' + fmtDateShort(p.fim);
  }

  function formatAtualizado(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  window.renderDashboard = function () {
    if (typeof window.META === 'undefined' || typeof window.DAILY === 'undefined' || typeof window.GRAIN === 'undefined') {
      renderError('data-meta.js / data-daily.js / data-grain.js não carregaram corretamente.');
      return;
    }

    try {
      var meta = window.META;
      ALL_DAILY = arr(window.DAILY).slice().sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
      ALL_GRAIN = arr(window.GRAIN);

      document.getElementById('meta-periodo').textContent = formatPeriodo(meta.periodo);
      document.getElementById('meta-atualizado').textContent = formatAtualizado(meta.gerado_em);
      document.getElementById('meta-imposto').textContent = 'imposto ×' + String(meta.imposto || 1.1385).replace('.', ',');
      document.getElementById('foot-conta').textContent = meta.fontes.meta_conta;

      minDate = ALL_DAILY.length ? ALL_DAILY[0].data : meta.periodo.inicio;
      maxDate = ALL_DAILY.length ? ALL_DAILY[ALL_DAILY.length - 1].data : meta.periodo.fim;

      initTheme();
      initTabs();
      initPeriodControls();
      setPeriod(firstOfMonth(maxDate), maxDate, 'month');
    } catch (err) {
      renderError('Erro ao renderizar o dashboard: ' + err.message);
    }
  };
})();
