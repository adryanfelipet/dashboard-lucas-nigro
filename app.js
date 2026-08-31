(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  // Estado do filtro de periodo (preenchido em window.renderDashboard).
  var STATE = { from: null, to: null, preset: 'month', compare: false, metric: 'investimento' };
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

  // ---------------------------------------------------------------------
  // Hero: Investimento -> Leads = CPL . % Qualificacao
  // ---------------------------------------------------------------------
  function renderHero(totals, prev) {
    var host = document.getElementById('hero');
    host.innerHTML =
      '<div class="hcard"><div class="hk">💸 Investimento <small>com imposto</small></div>' +
      '<div class="hv">' + fmtCurrency(totals.investimento) + '</div><div class="hd">' + miniDelta(totals.investimento, prev && prev.investimento, null) + '</div></div>' +
      '<div class="op">→</div>' +
      '<div class="hcard"><div class="hk">🧲 Leads <small>planilha</small></div>' +
      '<div class="hv g">' + fmtInt(totals.leads) + '</div><div class="hd">' + miniDelta(totals.leads, prev && prev.leads, true) + '</div></div>' +
      '<div class="op">=</div>' +
      '<div class="hcard accent"><div class="hk">🎯 CPL</div>' +
      '<div class="hv">' + fmtCurrency(totals.cpl) + '</div><div class="hd">' + miniDelta(totals.cpl, prev && prev.cpl, false) + '</div></div>' +
      '<div class="op">·</div>' +
      '<div class="hcard"><div class="hk">✅ Qualificação <small>MQL</small></div>' +
      '<div class="hv">' + fmtPct(totals.pct_qualificacao) + '</div><div class="hd">' + miniDelta(totals.pct_qualificacao, prev && prev.pct_qualificacao, true) + '</div></div>';

    var line = document.getElementById('heroLine');
    line.innerHTML = (totals.investimento > 0)
      ? fmtCurrency(totals.investimento) + ' investidos geraram <b>' + fmtInt(totals.leads) + ' leads</b> (CPL <b>' + fmtCurrency(totals.cpl) + '</b>) · <b>' + fmtInt(totals.qualificados) + '</b> qualificados (<b>' + fmtPct(totals.pct_qualificacao) + '</b>)' + (STATE.compare ? ' · variações vs. período anterior' : '') + '.'
      : 'Sem investimento no período selecionado.';
  }

  // ---------------------------------------------------------------------
  // Saude da midia (gauge + barras) - CTR/CPC/CPM vs referencia de mercado
  // ---------------------------------------------------------------------
  var HEALTH_BANDS = {
    ctr: { label: 'CTR (link)', good: 1, mid: 0.6, dir: 'high', limitStr: 'bom ≥ 1%', fmt: function (v) { return fmtPct(v, 2); } },
    cpc: { label: 'CPC (link)', good: 2, mid: 4, dir: 'low', limitStr: 'bom ≤ R$ 2', fmt: fmtCurrency },
    cpm: { label: 'CPM', good: 35, mid: 60, dir: 'low', limitStr: 'bom ≤ R$ 35', fmt: fmtCurrency }
  };
  function scoreOf(v, b) {
    if (!okNum(v)) return null;
    if (b.dir === 'high') {
      if (v >= b.good) return 100;
      if (v >= b.mid) return 60 + (v - b.mid) / (b.good - b.mid) * 30;
      return Math.max(5, v / b.mid * 55);
    }
    if (v <= b.good) return 100;
    if (v <= b.mid) return 60 + (b.mid - v) / (b.mid - b.good) * 30;
    return Math.max(5, 55 - (v - b.mid) / b.mid * 55);
  }
  function scoreColor(s) { return s == null ? 'var(--ink-3)' : s >= 75 ? 'var(--good)' : s >= 50 ? 'var(--warning)' : 'var(--critical)'; }
  function bandLabel(s) { return s == null ? 'sem dados' : s >= 80 ? 'Saudável' : s >= 60 ? 'Bom' : s >= 40 ? 'Atenção' : 'Crítico'; }

  function mediaHealth(totals) {
    var keys = ['ctr', 'cpc', 'cpm'];
    var valMap = { ctr: totals.ctr_link, cpc: totals.cpc, cpm: totals.cpm };
    var bars = keys.map(function (k) {
      var b = HEALTH_BANDS[k], v = valMap[k], sc = scoreOf(v, b);
      return { label: b.label, valueStr: b.fmt(v), limitStr: b.limitStr, score: sc };
    });
    var valid = bars.filter(function (b) { return b.score != null; });
    var score = valid.length ? Math.round(valid.reduce(function (s, b) { return s + b.score; }, 0) / valid.length) : null;
    return { score: score, band: bandLabel(score), bars: bars };
  }

  function gaugeHTML(score, colorVar) {
    var s = okNum(score) ? score : 0;
    var r = 54, c = 2 * Math.PI * r, off = c * (1 - s / 100);
    var disp = okNum(score) ? Math.round(score) : '—';
    return '<div class="gauge"><svg viewBox="0 0 132 132" width="132" height="132">' +
      '<circle cx="66" cy="66" r="' + r + '" fill="none" stroke="var(--plane)" stroke-width="12"/>' +
      '<circle cx="66" cy="66" r="' + r + '" fill="none" stroke="' + colorVar + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>' +
      '</svg><div class="gv"><b>' + disp + '</b><span>de 100</span></div></div>';
  }

  function renderHealth(totals) {
    var host = document.getElementById('health');
    var h = mediaHealth(totals);
    var sc = scoreColor(h.score);
    host.innerHTML = gaugeHTML(h.score, sc) +
      '<div><p class="health-head">Saúde da mídia' +
      '<span class="tag" style="background:color-mix(in srgb,' + sc + ' 20%,transparent);color:' + sc + '">' + h.band + '</span>' +
      '<span style="font-size:11.5px;font-weight:500;color:var(--ink-3);margin-left:6px">' + (h.score == null ? '—' : h.score + '/100') + ' · CTR/CPC/CPM vs. referência de mercado</span></p>' +
      '<div class="hbars" style="margin-top:12px">' + h.bars.map(function (b) {
        var col = b.score == null ? 'var(--ink-3)' : scoreColor(b.score);
        var w = b.score == null ? 0 : Math.max(0, Math.min(100, b.score));
        return '<div class="hbar"><div class="hb-top"><em>' + b.label + ' <span style="color:var(--ink-3);font-weight:500">· ' + b.limitStr + '</span></em><strong>' + b.valueStr + '</strong></div>' +
          '<div class="hb-track"><div class="hb-fill" style="width:' + w.toFixed(0) + '%;background:' + col + '"></div></div></div>';
      }).join('') + '</div></div>';
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

  // Grafico de linha simples (1 ou 2 series - atual/anterior, eixo unico).
  function lineChart(host, labels, series, fmt) {
    host.innerHTML = '';
    var W = Math.max(320, host.clientWidth || 900), H = 240;
    var P = { t: 16, r: 14, b: 28, l: 64 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img' });

    var allVals = [];
    series.forEach(function (s) { s.values.forEach(function (v) { if (okNum(v)) allVals.push(v); }); });
    var max = niceMax(Math.max.apply(null, allVals.concat([0])));
    var n = labels.length;
    var x = function (i) { return n === 1 ? P.l + iw / 2 : P.l + (iw * i) / (n - 1); };
    var y = function (v) { return P.t + ih - (max > 0 ? (v / max) * ih : 0); };

    ticksFor(max).forEach(function (t) {
      var yy = y(t);
      svg.appendChild(svgEl('line', { x1: P.l, x2: P.l + iw, y1: yy, y2: yy, class: 'gridline' }));
      var tx = svgEl('text', { x: P.l - 8, y: yy + 4, 'text-anchor': 'end', class: 'axis-label' });
      tx.textContent = fmt(t);
      svg.appendChild(tx);
    });
    svg.appendChild(svgEl('line', { x1: P.l, x2: P.l + iw, y1: P.t + ih, y2: P.t + ih, class: 'axis-line' }));

    var step = labelStep(n, iw);
    labels.forEach(function (lb, i) {
      if (i % step === 0 || i === n - 1) {
        var tx = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'axis-label' });
        tx.textContent = lb;
        svg.appendChild(tx);
      }
    });

    series.forEach(function (s) {
      var pts = s.values.map(function (v, i) { return [x(i), y(v || 0)]; });
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var styleStr = 'fill:none;stroke:' + s.color + ';stroke-width:2;stroke-linejoin:round;stroke-linecap:round' + (s.dashed ? ';stroke-dasharray:5 4' : '');
      svg.appendChild(svgEl('path', { d: d, style: styleStr }));
      if (n <= 40) {
        pts.forEach(function (p) {
          svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 4, style: 'fill:' + s.color }));
        });
      }
    });

    var cross = svgEl('line', { class: 'chart-cross', y1: P.t, y2: P.t + ih });
    svg.appendChild(cross);
    var hit = svgEl('rect', { class: 'chart-hit', x: P.l - 4, y: P.t, width: iw + 8, height: ih });
    hit.addEventListener('mousemove', function (ev) {
      var box = svg.getBoundingClientRect();
      var rel = ((ev.clientX - box.left) / box.width) * W;
      var i = Math.max(0, Math.min(n - 1, Math.round(n === 1 ? 0 : ((rel - P.l) / iw) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.opacity = 1;
      var lines = series.map(function (s) { return s.name + ': ' + fmt(s.values[i]); });
      showTooltip(ev.clientX, ev.clientY, series[0].fullLabels ? series[0].fullLabels[i] : labels[i], lines);
    });
    hit.addEventListener('mouseleave', function () { cross.style.opacity = 0; hideTooltip(); });
    svg.appendChild(hit);
    host.appendChild(svg);
  }

  // ---------------------------------------------------------------------
  // Seletor de metrica (grafico "X por dia" com abas)
  // ---------------------------------------------------------------------
  var METRICS = [
    { k: 'investimento', label: 'Investimento', fmt: fmtCurrency },
    { k: 'leads', label: 'Leads', fmt: fmtInt },
    { k: 'qualificados', label: 'Qualificados', fmt: fmtInt },
    { k: 'vendas', label: 'Vendas', fmt: fmtInt },
    { k: 'cpl', label: 'CPL', fmt: fmtCurrency },
    { k: 'cpc', label: 'CPC', fmt: fmtCurrency },
    { k: 'cpm', label: 'CPM', fmt: fmtCurrency },
    { k: 'ctr_link', label: 'CTR', fmt: function (v) { return fmtPct(v, 2); } },
    { k: 'impressoes', label: 'Impressões', fmt: fmtInt },
    { k: 'cliques', label: 'Cliques', fmt: fmtInt }
  ];

  function renderMetricTabs() {
    var host = document.getElementById('metricTabs');
    host.innerHTML = '';
    METRICS.forEach(function (m) {
      var b = el('button', { class: 'btn', text: m.label });
      b.dataset.metric = m.k;
      b.addEventListener('click', function () { STATE.metric = m.k; refresh(); });
      host.appendChild(b);
    });
  }

  function renderMetricChart(daily, prevDaily) {
    var met = METRICS.filter(function (m) { return m.k === STATE.metric; })[0] || METRICS[0];
    document.getElementById('metricTitle').textContent = met.label + ' por dia';
    Array.prototype.forEach.call(document.querySelectorAll('#metricTabs [data-metric]'), function (b) {
      var active = b.dataset.metric === met.k;
      b.classList.toggle('on', active);
      b.setAttribute('aria-pressed', String(active));
    });

    var series = [{
      name: 'Período atual', color: 'var(--brand)',
      values: daily.map(function (r) { return r[met.k]; }),
      fullLabels: daily.map(function (r) { return fmtDateFull(r.data); })
    }];
    if (STATE.compare && prevDaily && prevDaily.length === daily.length) {
      series.push({
        name: 'Período anterior', color: 'var(--series-2)', dashed: true,
        values: prevDaily.map(function (r) { return r[met.k]; })
      });
    }
    document.getElementById('legend').innerHTML = series.length > 1
      ? series.map(function (s) {
        return '<span style="color:' + s.color + '"><i class="' + (s.dashed ? 'dash' : '') + '" style="background:' + (s.dashed ? 'transparent' : s.color) + '"></i><span style="color:var(--ink-2)">' + esc(s.name) + '</span></span>';
      }).join('')
      : '';
    lineChart(document.getElementById('chMetric'), daily.map(function (r) { return fmtDateShort(r.data); }), series, met.fmt);
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
  // Visao diaria (Trafego Pago): 1 linha por dia, heatmap vermelho/verde
  // ---------------------------------------------------------------------
  var DCOLS = [
    { k: 'data', label: 'Dia' },
    { k: 'investimento', label: 'Investimento', fmt: fmtCurrency, scale: 'low' },
    { k: 'cpm', label: 'CPM', fmt: fmtCurrency, scale: 'low' },
    { k: 'cpc', label: 'CPC', fmt: fmtCurrency, scale: 'low' },
    { k: 'ctr_link', label: 'CTR', fmt: function (v) { return fmtPct(v, 2); }, scale: 'high' },
    { k: 'cliques', label: 'Cliques', fmt: fmtInt },
    { k: 'leads', label: 'Leads', fmt: fmtInt, scale: 'high' },
    { k: 'cpl', label: 'CPL', fmt: fmtCurrency, scale: 'low' },
    { k: 'qualificados', label: 'Qualificados', fmt: fmtInt, scale: 'high' },
    { k: 'vendas', label: 'Vendas', fmt: fmtInt, scale: 'high' }
  ];

  function renderDailyTable(daily) {
    var table = document.getElementById('tabela-diaria');
    var rows = daily.slice().reverse();

    var scales = {};
    DCOLS.filter(function (c) { return c.scale; }).forEach(function (c) {
      var vals = rows.filter(function (r) { return r.investimento > 0 && okNum(r[c.k]); }).map(function (r) { return r[c.k]; });
      if (vals.length > 1) scales[c.k] = { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals), dir: c.scale };
    });
    function heat(k, v) {
      var s = scales[k];
      if (!s || !okNum(v) || s.max === s.min) return '';
      var t = (v - s.min) / (s.max - s.min);
      if (s.dir === 'low') t = 1 - t;
      var hue = t >= 0.5 ? 'var(--good)' : 'var(--critical)';
      var strength = Math.round(Math.abs(t - 0.5) * 2 * 32);
      return strength < 6 ? '' : 'background:color-mix(in srgb,' + hue + ' ' + strength + '%,transparent)';
    }

    var thead = el('thead', null, [el('tr', null, DCOLS.map(function (c) {
      return el('th', c.k === 'data' ? { text: c.label } : { class: 'num', text: c.label });
    }))]);

    var tbody = el('tbody');
    if (rows.length === 0) {
      tbody.appendChild(el('tr', null, [el('td', { class: 'empty-state', colspan: String(DCOLS.length), text: 'Sem dados no período.' })]));
    } else {
      rows.forEach(function (r) {
        var tr = el('tr');
        DCOLS.forEach(function (c) {
          if (c.k === 'data') { tr.appendChild(el('td', { text: fmtDateFull(r.data) })); return; }
          var val = r[c.k], text = c.fmt(val);
          var td = el('td', { class: 'num' });
          var style = c.scale ? heat(c.k, val) : '';
          if (style) {
            td.appendChild(el('span', { class: 'cell-scale', style: style, text: text }));
          } else {
            td.textContent = text;
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    table.innerHTML = '';
    table.appendChild(thead);
    table.appendChild(tbody);
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

  function initReload() {
    var btn = document.getElementById('reload-btn');
    btn.addEventListener('click', function () { location.reload(); });
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

    var prevTotals = null, prevDaily = null;
    if (STATE.compare) {
      var pTo = dayAdd(STATE.from, -1);
      var pFrom = dayAdd(pTo, -(len - 1));
      prevDaily = filterDaily(pFrom, pTo);
      prevTotals = computeTotals(prevDaily);
    }

    var cmpNote = document.getElementById('cmpNote');
    if (STATE.compare) {
      var pTo2 = dayAdd(STATE.from, -1), pFrom2 = dayAdd(pTo2, -(len - 1));
      cmpNote.textContent = 'comparando com ' + fmtDateFull(pFrom2) + ' – ' + fmtDateFull(pTo2) + ' (' + len + (len > 1 ? ' dias' : ' dia') + ')';
    } else {
      cmpNote.textContent = len + (len > 1 ? ' dias selecionados' : ' dia selecionado');
    }

    document.getElementById('cards-tiles').innerHTML = '';

    renderHealth(totals);
    renderHero(totals, prevTotals);
    renderFunnel(totals);
    renderComboCharts(daily);
    renderMetricChart(daily, prevDaily);
    renderCards(totals, prevTotals);
    renderDailyTable(daily);
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
      initReload();
      initTabs();
      initPeriodControls();
      renderMetricTabs();
      setPeriod(firstOfMonth(maxDate), maxDate, 'month');
    } catch (err) {
      renderError('Erro ao renderizar o dashboard: ' + err.message);
    }
  };
})();
