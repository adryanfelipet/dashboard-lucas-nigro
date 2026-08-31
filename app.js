(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var RAMP = [
    '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec',
    '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab',
    '#184f95', '#104281', '#0d366b'
  ];

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

  function fmtInt(n) {
    if (n === null || n === undefined) return '—';
    return Math.round(n).toLocaleString('pt-BR');
  }

  function fmtCurrency(n) {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtPct(n, digits) {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: digits || 1, maximumFractionDigits: digits || 1 }) + '%';
  }

  function fmtDateShort(isoDay) {
    var parts = isoDay.split('-');
    return parts[2] + '/' + parts[1];
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
  // Stat tiles
  // ---------------------------------------------------------------------
  function statTile(label, value, sub) {
    var children = [
      el('div', { class: 'stat-label', text: label }),
      el('div', { class: 'stat-value', text: value })
    ];
    if (sub) children.push(el('div', { class: 'stat-sub', text: sub }));
    return el('div', { class: 'stat-tile' }, children);
  }

  function renderHeadline(data) {
    var host = document.getElementById('headline-tiles');
    host.appendChild(statTile('Leads (planilha)', fmtInt(data.headline.leads), 'número-verdade do funil'));
    host.appendChild(statTile('CPL', fmtCurrency(data.headline.cpl), 'investimento ÷ leads'));
    host.appendChild(statTile('Leads (pixel Meta)', fmtInt(data.headline.leads_pixel), 'referência — evento Lead'));
  }

  function renderMql(data) {
    var host = document.getElementById('mql-tiles');
    host.appendChild(statTile('Qualificados', fmtInt(data.mql.qualificados)));
    host.appendChild(statTile('% Qualificação', fmtPct(data.mql.pct_qualificacao), 'qualificados ÷ leads'));
  }

  function renderCards(data) {
    var host = document.getElementById('cards-tiles');
    var c = data.cards;
    host.appendChild(statTile('Investimento', fmtCurrency(c.investimento), 'com imposto (×1,1385)'));
    host.appendChild(statTile('CPM', fmtCurrency(c.cpm)));
    host.appendChild(statTile('CTR (link)', fmtPct(c.ctr_link, 2)));
    host.appendChild(statTile('CPC', fmtCurrency(c.cpc)));
    host.appendChild(statTile('Cliques', fmtInt(c.cliques), 'cliques no link'));
    host.appendChild(statTile('Leads', fmtInt(c.leads)));
    host.appendChild(statTile('CPL', fmtCurrency(c.cpl)));
    host.appendChild(statTile('Clique → Lead', fmtPct(c.clique_lead_pct, 2)));
  }

  // ---------------------------------------------------------------------
  // Funil (ordinal, ramp: funnel-1/2/3)
  // ---------------------------------------------------------------------
  function renderFunnel(data) {
    var host = document.getElementById('funnel-chart');
    var stages = data.funil;
    var W = 760, rowH = 56, gap = 14, labelW = 140, top = 6;
    var H = top + stages.length * rowH + (stages.length - 1) * gap + 6;
    var maxVal = Math.max.apply(null, stages.map(function (s) { return s.valor; })) || 1;
    var barMaxW = W - labelW - 70;

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Funil de leads' });

    stages.forEach(function (s, i) {
      var y = top + i * (rowH + gap);
      var w = Math.max(6, (s.valor / maxVal) * barMaxW);
      var cls = 'funnel-bar-' + (i + 1);

      svg.appendChild(svgEl('text', { x: 0, y: y + rowH / 2 + 4, class: 'funnel-label' }))
        .textContent = s.etapa;
      svg.appendChild(svgEl('rect', {
        x: labelW, y: y, width: w, height: rowH, rx: 6, class: cls
      }));
      var valText = svgEl('text', { x: labelW + Math.max(w - 10, 30), y: y + rowH / 2 + 5, class: 'funnel-value', 'text-anchor': 'end' });
      valText.textContent = fmtInt(s.valor);
      svg.appendChild(valText);

      if (i > 0) {
        var prev = stages[i - 1].valor;
        var pct = prev > 0 ? (s.valor / prev) * 100 : 0;
        var dropText = svgEl('text', { x: labelW + w + 14, y: y + rowH / 2 + 4, class: 'funnel-drop' });
        dropText.textContent = pct.toFixed(1).replace('.', ',') + '% do anterior';
        svg.appendChild(dropText);
      }
    });

    host.innerHTML = '';
    host.appendChild(svg);
  }

  // ---------------------------------------------------------------------
  // Bar chart (single series, sequential blue) — investimento diário
  // ---------------------------------------------------------------------
  function renderBarChart(hostId, series, valueKey, formatValue, labelSuffix) {
    var host = document.getElementById(hostId);
    var W = 520, H = 220, padL = 44, padB = 28, padT = 12, padR = 8;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxVal = Math.max.apply(null, series.map(function (d) { return d[valueKey]; })) || 1;
    var n = series.length;
    var slot = plotW / n;
    var barW = Math.max(4, Math.min(28, slot * 0.6));

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });

    [0, 0.5, 1].forEach(function (t) {
      var y = padT + plotH * (1 - t);
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'gridline' }));
    });
    svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: padT + plotH, y2: padT + plotH, class: 'axis-line' }));

    series.forEach(function (d, i) {
      var v = d[valueKey];
      var h = maxVal > 0 ? (v / maxVal) * plotH : 0;
      var x = padL + i * slot + (slot - barW) / 2;
      var y = padT + plotH - h;

      var rect = svgEl('rect', { x: x, y: y, width: barW, height: Math.max(h, 1), rx: 3, class: 'mark-blue' });
      rect.addEventListener('mousemove', function (ev) {
        showTooltip(ev.clientX, ev.clientY, fmtDateShort(d.data), [formatValue(v) + labelSuffix]);
      });
      rect.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(rect);

      if (n <= 8 || i === 0 || i === n - 1 || i === Math.floor(n / 2)) {
        var lbl = svgEl('text', { x: x + barW / 2, y: padT + plotH + 16, class: 'axis-label', 'text-anchor': 'middle' });
        lbl.textContent = fmtDateShort(d.data);
        svg.appendChild(lbl);
      }
    });

    var maxLbl = svgEl('text', { x: 4, y: padT + 4, class: 'axis-label' });
    maxLbl.textContent = formatValue(maxVal);
    svg.appendChild(maxLbl);

    host.innerHTML = '';
    host.appendChild(svg);
  }

  // ---------------------------------------------------------------------
  // Line chart (single series) — leads diário
  // ---------------------------------------------------------------------
  function renderLineChart(hostId, series, valueKey, formatValue, labelSuffix) {
    var host = document.getElementById(hostId);
    var W = 520, H = 220, padL = 34, padB = 28, padT = 16, padR = 12;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxVal = Math.max.apply(null, series.map(function (d) { return d[valueKey]; })) || 1;
    var n = series.length;
    var stepX = n > 1 ? plotW / (n - 1) : 0;

    function xy(i, v) {
      var x = padL + i * stepX;
      var y = padT + plotH - (maxVal > 0 ? (v / maxVal) * plotH : 0);
      return [x, y];
    }

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });

    [0, 0.5, 1].forEach(function (t) {
      var y = padT + plotH * (1 - t);
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'gridline' }));
    });
    svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: padT + plotH, y2: padT + plotH, class: 'axis-line' }));

    var pathD = series.map(function (d, i) {
      var p = xy(i, d[valueKey]);
      return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ');
    svg.appendChild(svgEl('path', { d: pathD, class: 'line-blue' }));

    series.forEach(function (d, i) {
      var p = xy(i, d[valueKey]);
      svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 3, class: 'dot-blue' }));

      var hit = svgEl('circle', { cx: p[0], cy: p[1], r: 10, class: 'dot-hit' });
      hit.addEventListener('mousemove', function (ev) {
        showTooltip(ev.clientX, ev.clientY, fmtDateShort(d.data), [formatValue(d[valueKey]) + labelSuffix]);
      });
      hit.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(hit);

      if (n <= 8 || i === 0 || i === n - 1 || i === Math.floor(n / 2)) {
        var lbl = svgEl('text', { x: p[0], y: padT + plotH + 16, class: 'axis-label', 'text-anchor': 'middle' });
        lbl.textContent = fmtDateShort(d.data);
        svg.appendChild(lbl);
      }
    });

    host.innerHTML = '';
    host.appendChild(svg);
  }

  // ---------------------------------------------------------------------
  // Heatmap table
  // ---------------------------------------------------------------------
  function rampColorForValue(value, min, max) {
    if (value === null || value === undefined || max === min) return RAMP[0];
    var t = (value - min) / (max - min);
    t = Math.max(0, Math.min(1, t));
    var idx = Math.round(t * (RAMP.length - 1));
    return RAMP[idx];
  }

  function textColorForRamp(idx) {
    return idx >= 7 ? '#ffffff' : '#0b0b0b';
  }

  function renderTabelaOtimizacao(data) {
    var table = document.getElementById('tabela-otimizacao');
    var rows = data.tabela_otimizacao || [];

    var thead = el('thead', null, [el('tr', null, [
      el('th', { text: 'Campanha' }),
      el('th', { text: 'Conjunto' }),
      el('th', { text: 'Anúncio' }),
      el('th', { text: 'Investimento' }),
      el('th', { text: 'Impressões' }),
      el('th', { text: 'Cliques' }),
      el('th', { text: 'CPM' }),
      el('th', { text: 'CPC' }),
      el('th', { text: 'CTR' }),
      el('th', { text: 'Leads' }),
      el('th', { text: 'CPL' })
    ])]);

    var tbody = el('tbody');

    if (rows.length === 0) {
      tbody.appendChild(el('tr', null, [el('td', { class: 'empty-state', colspan: '11', text: 'Sem dados no período.' })]));
    } else {
      var cplValues = rows.map(function (r) { return r.cpl; }).filter(function (v) { return v !== null && v !== undefined; });
      var minCpl = cplValues.length ? Math.min.apply(null, cplValues) : 0;
      var maxCpl = cplValues.length ? Math.max.apply(null, cplValues) : 0;

      rows.forEach(function (r) {
        var tr = el('tr', null, [
          el('td', { text: r.campanha }),
          el('td', { text: r.conjunto }),
          el('td', { text: r.anuncio }),
          el('td', { class: 'num', text: fmtCurrency(r.investimento) }),
          el('td', { class: 'num', text: fmtInt(r.impressoes) }),
          el('td', { class: 'num', text: fmtInt(r.cliques) }),
          el('td', { class: 'num', text: fmtCurrency(r.cpm) }),
          el('td', { class: 'num', text: fmtCurrency(r.cpc) }),
          el('td', { class: 'num', text: fmtPct(r.ctr, 2) }),
          el('td', { class: 'num', text: fmtInt(r.leads) })
        ]);
        var cplCell = el('td', { class: 'num', text: r.cpl !== null && r.cpl !== undefined ? fmtCurrency(r.cpl) : 'sem lead' });
        if (r.cpl !== null && r.cpl !== undefined) {
          var t = maxCpl === minCpl ? 0.5 : (r.cpl - minCpl) / (maxCpl - minCpl);
          var idx = Math.round(t * (RAMP.length - 1));
          cplCell.style.background = RAMP[idx];
          cplCell.style.color = textColorForRamp(idx);
        }
        tr.appendChild(cplCell);
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
  // Bootstrap
  // ---------------------------------------------------------------------
  function renderError(message) {
    var page = document.querySelector('.page');
    page.innerHTML = '';
    page.appendChild(el('div', { class: 'panel', html:
      '<h2>Dados indisponíveis</h2><p class="panel-hint">' + message + '</p>' }));
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

  function init() {
    if (typeof window.DASHBOARD_DATA === 'undefined') {
      renderError('data.js não foi carregado. Este arquivo é gerado pelo build automático (Meta Graph API + planilha) e não é versionado no repositório — rode o workflow "Build & Deploy Dashboard RAL" no GitHub Actions.');
      return;
    }

    var data = window.DASHBOARD_DATA;

    try {
      document.getElementById('meta-periodo').textContent = formatPeriodo(data.periodo);
      document.getElementById('meta-atualizado').textContent = formatAtualizado(data.gerado_em);
      document.getElementById('foot-conta').textContent = data.fontes.meta_conta;

      renderHeadline(data);
      renderMql(data);
      renderFunnel(data);
      renderCards(data);
      renderBarChart('chart-investimento', data.serie_diaria, 'investimento', fmtCurrency, '');
      renderLineChart('chart-leads', data.serie_diaria, 'leads', fmtInt, ' leads');
      renderTabelaOtimizacao(data);
      initTabs();
    } catch (err) {
      renderError('Erro ao renderizar o dashboard: ' + err.message);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
