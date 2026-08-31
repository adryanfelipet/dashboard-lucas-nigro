#!/usr/bin/env pwsh
# Dashboard de trafego - RAL (Lucas Nigro)
# Gasto/CPM/CPC/CTR/cliques vem da Meta Graph API (nivel anuncio).
# Leads/Qualificados/Vendas vem de planilha (gviz, somente leitura).
# Saida: data.js na raiz do site (nunca comitado - ver .gitignore).

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
$MetaAccountId       = 'act_1182118752852701'
$MetaApiVersion      = 'v21.0'
$CampaignNameFilter  = 'RAL |'                 # Graph API CONTAIN pre-filtro
$CampaignNameRegex   = '^RAL\s*\|'             # aplicado localmente ("comeca com")
$PeriodStart         = [datetime]::ParseExact('2026-08-28', 'yyyy-MM-dd', $null)
$TaxMultiplier       = 1.1385

$SpreadsheetId  = '1j3EQE4zbRlUVAKyDPTmlnTDP0Jlvw-enQyMPR2LXjfk'
$LeadsGid       = '296175879'
$VendasGid      = '2140359409'

$ClienteNome = 'Lucas Nigro - Rumo ao Lucro (RAL)'

$MetaAccessToken = $env:META_ACCESS_TOKEN
if ([string]::IsNullOrWhiteSpace($MetaAccessToken)) {
    throw "META_ACCESS_TOKEN nao esta definido no ambiente. Configure o secret no repositorio."
}

$TodayUtc = (Get-Date).ToUniversalTime().Date
$PeriodEnd = $TodayUtc

Write-Host "== Dashboard RAL build =="
Write-Host "Periodo: $($PeriodStart.ToString('yyyy-MM-dd')) a $($PeriodEnd.ToString('yyyy-MM-dd'))"

# ---------------------------------------------------------------------------
# Helpers - HTTP com retry
# ---------------------------------------------------------------------------
function Invoke-HttpGetWithRetry {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [int]$MaxAttempts = 4
    )
    $attempt = 0
    $delaySeconds = 2
    while ($true) {
        $attempt++
        try {
            return Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 60
        } catch {
            $isLastAttempt = $attempt -ge $MaxAttempts
            $status = $null
            if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
            Write-Warning "GET falhou (tentativa $attempt/$MaxAttempts, status=$status): $($_.Exception.Message)"
            if ($isLastAttempt) {
                throw "Falha ao consultar '$Uri' apos $MaxAttempts tentativas: $($_.Exception.Message)"
            }
            Start-Sleep -Seconds $delaySeconds
            $delaySeconds = $delaySeconds * 2
        }
    }
}

# ---------------------------------------------------------------------------
# Meta Graph API - insights nivel anuncio, diario, campanhas "RAL | ..."
# ---------------------------------------------------------------------------
function Get-MetaAdInsights {
    param(
        [Parameter(Mandatory)][string]$AccountId,
        [Parameter(Mandatory)][string]$AccessToken,
        [Parameter(Mandatory)][datetime]$Since,
        [Parameter(Mandatory)][datetime]$Until,
        [Parameter(Mandatory)][string]$NameContains
    )

    $fields = @(
        'campaign_id', 'campaign_name',
        'adset_id', 'adset_name',
        'ad_id', 'ad_name',
        'spend', 'impressions', 'clicks', 'inline_link_clicks',
        'actions', 'date_start', 'date_stop'
    ) -join ','

    $timeRange = @{ since = $Since.ToString('yyyy-MM-dd'); until = $Until.ToString('yyyy-MM-dd') } | ConvertTo-Json -Compress
    $filtering = @(
        @{ field = 'campaign.name'; operator = 'CONTAIN'; value = $NameContains }
    ) | ConvertTo-Json -Compress -AsArray

    $baseUri = "https://graph.facebook.com/$MetaApiVersion/$AccountId/insights" +
        "?level=ad" +
        "&time_increment=1" +
        "&limit=500" +
        "&fields=$([uri]::EscapeDataString($fields))" +
        "&time_range=$([uri]::EscapeDataString($timeRange))" +
        "&filtering=$([uri]::EscapeDataString($filtering))" +
        "&access_token=$([uri]::EscapeDataString($AccessToken))"

    $allRows = New-Object System.Collections.Generic.List[object]
    $uri = $baseUri
    $pageCount = 0
    while ($uri) {
        $pageCount++
        Write-Host "Meta insights: pagina $pageCount"
        $resp = Invoke-HttpGetWithRetry -Uri $uri

        if ($resp.PSObject.Properties.Name -contains 'error') {
            throw "Meta Graph API retornou erro: $($resp.error.message) (type=$($resp.error.type), code=$($resp.error.code))"
        }

        foreach ($row in $resp.data) { $allRows.Add($row) }

        $uri = $null
        if ($resp.PSObject.Properties.Name -contains 'paging' -and $resp.paging.PSObject.Properties.Name -contains 'next') {
            $uri = $resp.paging.next
        }
    }

    Write-Host "Meta insights: $($allRows.Count) linhas brutas recebidas"
    return $allRows
}

$rawInsights = Get-MetaAdInsights -AccountId $MetaAccountId -AccessToken $MetaAccessToken `
    -Since $PeriodStart -Until $PeriodEnd -NameContains $CampaignNameFilter

# Enforce "comeca com RAL |" localmente (CONTAIN da API nao ancora no inicio)
$insights = @($rawInsights | Where-Object { $_.campaign_name -match $CampaignNameRegex })
Write-Host "Meta insights: $($insights.Count) linhas apos filtro '^RAL \|'"

function Get-LeadActionsCount {
    param($ActionsArray)
    if (-not $ActionsArray) { return 0 }
    $sum = 0.0
    foreach ($a in $ActionsArray) {
        if ($a.action_type -match 'lead') {
            $sum += [double]$a.value
        }
    }
    return $sum
}

# ---------------------------------------------------------------------------
# Agregacoes Meta: total periodo, serie diaria, por anuncio
# ---------------------------------------------------------------------------
$totalSpendRaw = 0.0
$totalImpressions = 0L
$totalClicks = 0L
$totalLinkClicks = 0L
$totalLeadsPixel = 0.0

$dailyMap = @{}   # yyyy-MM-dd -> @{ spend; impressions; clicks; link_clicks }
$adMap = @{}      # ad_id -> @{ campaign_name; adset_name; ad_name; spend; impressions; clicks; link_clicks }

foreach ($row in $insights) {
    $spend = if ($row.PSObject.Properties.Name -contains 'spend') { [double]$row.spend } else { 0.0 }
    $impr  = if ($row.PSObject.Properties.Name -contains 'impressions') { [long]$row.impressions } else { 0L }
    $clk   = if ($row.PSObject.Properties.Name -contains 'clicks') { [long]$row.clicks } else { 0L }
    $lclk  = if ($row.PSObject.Properties.Name -contains 'inline_link_clicks') { [long]$row.inline_link_clicks } else { 0L }
    $leadsPixel = Get-LeadActionsCount -ActionsArray $row.actions

    $totalSpendRaw += $spend
    $totalImpressions += $impr
    $totalClicks += $clk
    $totalLinkClicks += $lclk
    $totalLeadsPixel += $leadsPixel

    $day = $row.date_start
    if (-not $dailyMap.ContainsKey($day)) {
        $dailyMap[$day] = [ordered]@{ spend = 0.0; impressions = 0L; clicks = 0L; link_clicks = 0L; leads_pixel = 0.0 }
    }
    $dailyMap[$day].spend += $spend
    $dailyMap[$day].impressions += $impr
    $dailyMap[$day].clicks += $clk
    $dailyMap[$day].link_clicks += $lclk
    $dailyMap[$day].leads_pixel += $leadsPixel

    $adId = $row.ad_id
    if (-not $adMap.ContainsKey($adId)) {
        $adMap[$adId] = [ordered]@{
            campanha = $row.campaign_name
            conjunto = $row.adset_name
            anuncio  = $row.ad_name
            spend = 0.0; impressions = 0L; clicks = 0L; link_clicks = 0L; leads_pixel = 0.0
        }
    }
    $adMap[$adId].spend += $spend
    $adMap[$adId].impressions += $impr
    $adMap[$adId].clicks += $clk
    $adMap[$adId].link_clicks += $lclk
    $adMap[$adId].leads_pixel += $leadsPixel
}

$totalSpendTax = [math]::Round($totalSpendRaw * $TaxMultiplier, 2)

# ---------------------------------------------------------------------------
# gviz - leitura generica de aba do Google Sheets (somente leitura)
# ---------------------------------------------------------------------------
function ConvertFrom-GvizDate {
    param([Parameter(Mandatory)][AllowNull()]$Value)
    if ($null -eq $Value) { return $null }
    $s = [string]$Value
    if ($s -match '^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$') {
        $y = [int]$Matches[1]; $mo = [int]$Matches[2] + 1; $d = [int]$Matches[3]
        $h = if ($Matches[4]) { [int]$Matches[4] } else { 0 }
        $mi = if ($Matches[5]) { [int]$Matches[5] } else { 0 }
        $se = if ($Matches[6]) { [int]$Matches[6] } else { 0 }
        try { return Get-Date -Year $y -Month $mo -Day $d -Hour $h -Minute $mi -Second $se } catch { return $null }
    }
    $parsed = $null
    if ([datetime]::TryParse($s, [ref]$parsed)) { return $parsed }
    return $null
}

function Get-GvizSheet {
    param(
        [Parameter(Mandatory)][string]$SpreadsheetId,
        [Parameter(Mandatory)][string]$Gid,
        [Parameter(Mandatory)][string[]]$ExpectedHeaders
    )

    $uri = "https://docs.google.com/spreadsheets/d/$SpreadsheetId/gviz/tq?tqx=out:json&gid=$Gid&headers=1"
    $raw = Invoke-HttpGetWithRetry -Uri $uri

    $text = if ($raw -is [string]) { $raw } else { $raw | Out-String }
    $jsonMatch = [regex]::Match($text, 'setResponse\((.*)\);?\s*$', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if (-not $jsonMatch.Success) {
        throw "Nao foi possivel interpretar a resposta gviz da aba gid=$Gid (formato inesperado)."
    }
    $parsed = $jsonMatch.Groups[1].Value | ConvertFrom-Json

    if ($parsed.status -eq 'error') {
        $msg = ($parsed.errors | ForEach-Object { $_.detailed_message }) -join '; '
        throw "gviz retornou erro na aba gid=$Gid : $msg"
    }

    $headerIndex = @{}
    for ($i = 0; $i -lt $parsed.table.cols.Count; $i++) {
        $label = ([string]$parsed.table.cols[$i].label).Trim().ToLowerInvariant()
        if ($label) { $headerIndex[$label] = $i }
    }

    $missing = @($ExpectedHeaders | Where-Object { -not $headerIndex.ContainsKey($_.ToLowerInvariant()) })
    if ($missing.Count -gt 0) {
        Write-Warning "Aba gid=$Gid : colunas esperadas nao encontradas: $($missing -join ', ')"
    }

    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($r in $parsed.table.rows) {
        $obj = [ordered]@{}
        foreach ($h in $ExpectedHeaders) {
            $idx = $headerIndex[$h.ToLowerInvariant()]
            if ($null -eq $idx) { $obj[$h] = $null; continue }
            $cell = $r.c[$idx]
            $obj[$h] = if ($null -eq $cell) { $null } else { $cell.v }
        }
        $rows.Add([pscustomobject]$obj)
    }

    Write-Host "gviz gid=$Gid : $($rows.Count) linhas lidas"
    return $rows
}

$leadsExpected = @(
    'id','criado_em','nome','whatsapp','email','utm_source','utm_medium','utm_campaign',
    'utm_content','utm_term','atende_empresas','clientes_empresariais','objetivo_formacao',
    'lead_score','classificacao','status','cidade','uf'
)
$vendasExpected = @(
    'transaction_id','pago_em','status','pago','comprador','email','whatsapp','valor','moeda',
    'produto','utm_source','utm_campaign','lead_id','casado_por'
)

$leadsRaw = Get-GvizSheet -SpreadsheetId $SpreadsheetId -Gid $LeadsGid -ExpectedHeaders $leadsExpected
$vendasRaw = Get-GvizSheet -SpreadsheetId $SpreadsheetId -Gid $VendasGid -ExpectedHeaders $vendasExpected

# ---------------------------------------------------------------------------
# Funil: leads/qualificados no periodo (planilha = numero-verdade)
# ---------------------------------------------------------------------------
$leadsPeriodo = New-Object System.Collections.Generic.List[object]
$leadsForaPeriodo = 0
foreach ($lead in $leadsRaw) {
    $dt = ConvertFrom-GvizDate -Value $lead.criado_em
    if ($null -eq $dt) {
        Write-Warning "Lead id=$($lead.id) com criado_em invalido/nao interpretavel - ignorado do periodo."
        continue
    }
    if ($dt.Date -ge $PeriodStart.Date -and $dt.Date -le $PeriodEnd.Date) {
        $leadsPeriodo.Add([pscustomobject]@{
            criado_em    = $dt
            utm_campaign = [string]$lead.utm_campaign
            utm_content  = [string]$lead.utm_content
            utm_term     = [string]$lead.utm_term
            classificacao = ([string]$lead.classificacao).Trim().ToUpperInvariant()
        })
    } else {
        $leadsForaPeriodo++
    }
}

$totalLeads = $leadsPeriodo.Count
$totalQualificados = @($leadsPeriodo | Where-Object { $_.classificacao -eq 'QUALIFICADO' }).Count
$pctQualificacao = if ($totalLeads -gt 0) { [math]::Round(($totalQualificados / $totalLeads) * 100, 1) } else { 0 }

function Test-VendaPaga {
    param($Row)
    $pago = ([string]$Row.pago).Trim().ToLowerInvariant()
    $status = ([string]$Row.status).Trim().ToLowerInvariant()
    $pagoTruthy = @('true', 'sim', 's', '1', 'verdadeiro', 'yes', 'pago') -contains $pago
    $statusPago = $status -match 'pag|aprovad|paid|completed|complete|confirmad'
    return ($pagoTruthy -or $statusPago)
}

$vendasPeriodo = 0
foreach ($venda in $vendasRaw) {
    $dt = ConvertFrom-GvizDate -Value $venda.pago_em
    if ($null -eq $dt) { continue }
    if ($dt.Date -lt $PeriodStart.Date -or $dt.Date -gt $PeriodEnd.Date) { continue }
    if (Test-VendaPaga -Row $venda) { $vendasPeriodo++ }
}

# ---------------------------------------------------------------------------
# Leads por dia (para serie diaria) e por anuncio (para tabela de otimizacao)
# ---------------------------------------------------------------------------
$leadsPorDia = @{}
foreach ($l in $leadsPeriodo) {
    $key = $l.criado_em.ToString('yyyy-MM-dd')
    if (-not $leadsPorDia.ContainsKey($key)) { $leadsPorDia[$key] = 0 }
    $leadsPorDia[$key]++
}

function Test-UtmMatch {
    param([string]$UtmValue, [string]$AdName)
    if ([string]::IsNullOrWhiteSpace($UtmValue) -or [string]::IsNullOrWhiteSpace($AdName)) { return $false }
    return ($UtmValue.Trim().ToLowerInvariant() -eq $AdName.Trim().ToLowerInvariant())
}

$leadsPorAnuncio = @{}
foreach ($l in $leadsPeriodo) {
    foreach ($adId in $adMap.Keys) {
        $ad = $adMap[$adId]
        $campaignMatch = ([string]$l.utm_campaign).Trim().ToLowerInvariant() -eq ([string]$ad.campanha).Trim().ToLowerInvariant()
        if (-not $campaignMatch) { continue }
        $adMatch = (Test-UtmMatch -UtmValue $l.utm_content -AdName $ad.anuncio) -or (Test-UtmMatch -UtmValue $l.utm_term -AdName $ad.anuncio)
        if ($adMatch) {
            if (-not $leadsPorAnuncio.ContainsKey($adId)) { $leadsPorAnuncio[$adId] = 0 }
            $leadsPorAnuncio[$adId]++
        }
    }
}

# ---------------------------------------------------------------------------
# Cards / headline
# ---------------------------------------------------------------------------
$cpl = if ($totalLeads -gt 0) { [math]::Round($totalSpendTax / $totalLeads, 2) } else { $null }
$cpm = if ($totalImpressions -gt 0) { [math]::Round(($totalSpendTax / $totalImpressions) * 1000, 2) } else { 0 }
$cpc = if ($totalLinkClicks -gt 0) { [math]::Round($totalSpendTax / $totalLinkClicks, 2) } else { 0 }
$ctrLink = if ($totalImpressions -gt 0) { [math]::Round(($totalLinkClicks / $totalImpressions) * 100, 2) } else { 0 }
$cliqueLead = if ($totalLinkClicks -gt 0) { [math]::Round(($totalLeads / $totalLinkClicks) * 100, 2) } else { 0 }

# ---------------------------------------------------------------------------
# Serie diaria (investimento com imposto e leads)
# ---------------------------------------------------------------------------
$allDays = New-Object System.Collections.Generic.List[string]
for ($d = $PeriodStart.Date; $d -le $PeriodEnd.Date; $d = $d.AddDays(1)) {
    $allDays.Add($d.ToString('yyyy-MM-dd'))
}

$serieDiaria = [array]($allDays | ForEach-Object {
    $day = $_
    $m = if ($dailyMap.ContainsKey($day)) { $dailyMap[$day] } else { [ordered]@{ spend = 0.0; impressions = 0L; clicks = 0L; link_clicks = 0L; leads_pixel = 0.0 } }
    [pscustomobject]@{
        data          = $day
        investimento  = [math]::Round($m.spend * $TaxMultiplier, 2)
        leads         = if ($leadsPorDia.ContainsKey($day)) { $leadsPorDia[$day] } else { 0 }
        leads_pixel   = [math]::Round($m.leads_pixel, 0)
        cliques       = [long]$m.link_clicks
    }
})

# ---------------------------------------------------------------------------
# Tabela de otimizacao: Campanha > Conjunto > Anuncio
# ---------------------------------------------------------------------------
$tabelaOtimizacao = [array]($adMap.Keys | ForEach-Object {
    $adId = $_
    $ad = $adMap[$adId]
    $leadsAd = if ($leadsPorAnuncio.ContainsKey($adId)) { $leadsPorAnuncio[$adId] } else { 0 }
    $spendTaxAd = [math]::Round($ad.spend * $TaxMultiplier, 2)
    [pscustomobject]@{
        campanha     = $ad.campanha
        conjunto     = $ad.conjunto
        anuncio      = $ad.anuncio
        investimento = $spendTaxAd
        impressoes   = [long]$ad.impressions
        cliques      = [long]$ad.link_clicks
        cpm          = if ($ad.impressions -gt 0) { [math]::Round(($spendTaxAd / $ad.impressions) * 1000, 2) } else { 0 }
        cpc          = if ($ad.link_clicks -gt 0) { [math]::Round($spendTaxAd / $ad.link_clicks, 2) } else { 0 }
        ctr          = if ($ad.impressions -gt 0) { [math]::Round(($ad.link_clicks / $ad.impressions) * 100, 2) } else { 0 }
        leads        = $leadsAd
        cpl          = if ($leadsAd -gt 0) { [math]::Round($spendTaxAd / $leadsAd, 2) } else { $null }
    }
} | Sort-Object -Property investimento -Descending)

# ---------------------------------------------------------------------------
# Monta e grava data.js (somente agregados - sem PII)
# ---------------------------------------------------------------------------
$data = [ordered]@{
    gerado_em = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    cliente   = $ClienteNome
    periodo   = [ordered]@{ inicio = $PeriodStart.ToString('yyyy-MM-dd'); fim = $PeriodEnd.ToString('yyyy-MM-dd') }

    headline = [ordered]@{
        leads       = $totalLeads
        leads_pixel = [math]::Round($totalLeadsPixel, 0)
        cpl         = $cpl
    }

    mql = [ordered]@{
        qualificados      = $totalQualificados
        pct_qualificacao  = $pctQualificacao
    }

    funil = [array]@(
        [ordered]@{ etapa = 'Leads';        valor = $totalLeads }
        [ordered]@{ etapa = 'Qualificados'; valor = $totalQualificados }
        [ordered]@{ etapa = 'Vendas';       valor = $vendasPeriodo }
    )

    cards = [ordered]@{
        investimento   = $totalSpendTax
        cpm             = $cpm
        ctr_link        = $ctrLink
        cpc             = $cpc
        cliques         = $totalLinkClicks
        leads           = $totalLeads
        cpl             = $cpl
        clique_lead_pct = $cliqueLead
    }

    serie_diaria = $serieDiaria

    tabela_otimizacao = $tabelaOtimizacao

    fontes = [ordered]@{
        meta_conta       = $MetaAccountId
        meta_api_version = $MetaApiVersion
        planilha_id      = $SpreadsheetId
        leads_gid        = $LeadsGid
        vendas_gid       = $VendasGid
    }
}

$json = $data | ConvertTo-Json -Depth 10
$outPath = Join-Path $PSScriptRoot 'data.js'
Set-Content -Path $outPath -Value "window.DASHBOARD_DATA = $json;" -Encoding utf8NoBOM

Write-Host "== Resumo =="
Write-Host "Leads (planilha): $totalLeads | Leads (pixel API): $([math]::Round($totalLeadsPixel,0))"
Write-Host "Qualificados: $totalQualificados ($pctQualificacao%)"
Write-Host "Vendas: $vendasPeriodo"
Write-Host "Investimento (c/ imposto): R$ $totalSpendTax | CPL: $(if ($cpl) { "R$ $cpl" } else { 'n/d' })"
Write-Host "data.js gravado em $outPath"
