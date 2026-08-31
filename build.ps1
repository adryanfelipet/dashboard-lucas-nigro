#requires -Version 5.1
param(
    [ValidateSet('all', 'daily', 'grain')]
    [string]$Mode = 'all'
)

# Dashboard de trafego RAL (Lucas Nigro) - build.ps1
# Windows PowerShell 5.1. Arquivo 100% ASCII (sem acentos) de proposito -
# PS 5.1 le .ps1 sem BOM como ANSI, entao evitamos qualquer caractere fora
# de ASCII no proprio script (mensagens de log tambem ficam sem acento).
#
# Midia (gasto/impressoes/cliques/CPM/CPC) vem da Meta Graph API (nivel anuncio).
# Funil (leads/qualificados/vendas) vem de planilha via gviz CSV (somente leitura).
# Saida: data-meta.js, data-daily.js, data-grain.js (window.META/DAILY/GRAIN).
# Esses arquivos ficam no .gitignore para uso local, mas o workflow de deploy
# faz "git add -f" neles de proposito - isso NAO viola a regra de privacidade
# porque eles contem apenas agregados (nunca nome/whatsapp/email cru).

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
$MetaAccountId      = 'act_1182118752852701'
$MetaApiVersion     = 'v21.0'
$CampaignContains   = 'RAL |'
$CampaignStartsWith = 'RAL |'
$TaxMultiplier      = 1.1385
$PeriodStart        = Get-Date -Year 2026 -Month 8 -Day 28 -Hour 0 -Minute 0 -Second 0

$SpreadsheetId = '1j3EQE4zbRlUVAKyDPTmlnTDP0Jlvw-enQyMPR2LXjfk'
$LeadsGid      = '296175879'
$VendasGid     = '2140359409'

$ClienteNome = 'Lucas Nigro - Rumo ao Lucro (RAL)'

$MetaAccessToken = $env:META_ACCESS_TOKEN
if ([string]::IsNullOrWhiteSpace($MetaAccessToken)) {
    throw "META_ACCESS_TOKEN nao definido no ambiente. Configure o secret no repositorio."
}

$TodayUtc = (Get-Date).ToUniversalTime().Date
$PeriodEnd = $TodayUtc

Write-Host "== Dashboard RAL build (Mode=$Mode) =="
Write-Host ("Periodo: {0} a {1}" -f $PeriodStart.ToString('yyyy-MM-dd'), $PeriodEnd.ToString('yyyy-MM-dd'))

$wc = New-Object System.Net.WebClient
$wc.Encoding = [System.Text.Encoding]::UTF8

# ---------------------------------------------------------------------------
# HTTP helpers (WebClient - Invoke-WebRequest e ~50x mais lento no PS 5.1
# porque usa o motor de parsing do IE mesmo para JSON/CSV)
# ---------------------------------------------------------------------------
function Get-UrlStringWithRetry {
    param([string]$Url, [int]$MaxAttempts = 4)
    $attempt = 0
    $delay = 2
    while ($true) {
        $attempt++
        try {
            return $wc.DownloadString($Url)
        } catch {
            $isLast = $attempt -ge $MaxAttempts
            Write-Warning ("GET falhou (tentativa {0}/{1}): {2}" -f $attempt, $MaxAttempts, $_.Exception.Message)
            if ($isLast) { throw ("Falha ao baixar '{0}' apos {1} tentativas: {2}" -f $Url, $MaxAttempts, $_.Exception.Message) }
            Start-Sleep -Seconds $delay
            $delay = $delay * 2
        }
    }
}

function Get-UrlFileWithRetry {
    param([string]$Url, [string]$DestPath, [int]$MaxAttempts = 4)
    $attempt = 0
    $delay = 2
    while ($true) {
        $attempt++
        try {
            $wc.DownloadFile($Url, $DestPath)
            return
        } catch {
            $isLast = $attempt -ge $MaxAttempts
            Write-Warning ("Download falhou (tentativa {0}/{1}): {2}" -f $attempt, $MaxAttempts, $_.Exception.Message)
            if ($isLast) { throw ("Falha ao baixar arquivo '{0}' apos {1} tentativas: {2}" -f $Url, $MaxAttempts, $_.Exception.Message) }
            Start-Sleep -Seconds $delay
            $delay = $delay * 2
        }
    }
}

# ---------------------------------------------------------------------------
# Meta Graph API - insights nivel anuncio, diario, campanhas "RAL | ..."
# ---------------------------------------------------------------------------
$fieldsList = 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,actions,date_start,date_stop'
$timeRangeJson = '{"since":"' + $PeriodStart.ToString('yyyy-MM-dd') + '","until":"' + $PeriodEnd.ToString('yyyy-MM-dd') + '"}'
$filteringJson = '[{"field":"campaign.name","operator":"CONTAIN","value":"' + $CampaignContains + '"}]'

$baseUri = 'https://graph.facebook.com/' + $MetaApiVersion + '/' + $MetaAccountId + '/insights' +
    '?level=ad&time_increment=1&limit=500' +
    '&fields=' + [uri]::EscapeDataString($fieldsList) +
    '&time_range=' + [uri]::EscapeDataString($timeRangeJson) +
    '&filtering=' + [uri]::EscapeDataString($filteringJson) +
    '&access_token=' + [uri]::EscapeDataString($MetaAccessToken)

$rawInsights = New-Object System.Collections.Generic.List[object]
$nextUri = $baseUri
$page = 0
while ($nextUri) {
    $page++
    Write-Host "Meta insights: pagina $page"
    $text = Get-UrlStringWithRetry -Url $nextUri
    $resp = $text | ConvertFrom-Json

    if ($resp.PSObject.Properties.Name -contains 'error') {
        throw ("Meta Graph API erro: {0} (type={1}, code={2})" -f $resp.error.message, $resp.error.type, $resp.error.code)
    }

    foreach ($row in $resp.data) { $rawInsights.Add($row) }

    $nextUri = $null
    if ($resp.PSObject.Properties.Name -contains 'paging') {
        if ($resp.paging.PSObject.Properties.Name -contains 'next') { $nextUri = $resp.paging.next }
    }
}
Write-Host "Meta insights: $($rawInsights.Count) linhas brutas"

# CONTAIN da API nao ancora no inicio - garante localmente "comeca com RAL |"
$insights = New-Object System.Collections.Generic.List[object]
foreach ($row in $rawInsights) {
    $nm = [string]$row.campaign_name
    if ($nm.Length -ge $CampaignStartsWith.Length -and $nm.Substring(0, $CampaignStartsWith.Length) -eq $CampaignStartsWith) {
        $insights.Add($row)
    }
}
Write-Host "Meta insights: $($insights.Count) linhas apos filtro de nome"

$totalSpendRaw = 0.0
$totalImpressions = 0L
$totalClicks = 0L
$totalLinkClicks = 0L
$totalLeadsPixel = 0.0

# dia -> totais ; "dia|adid" -> totais ; adid -> metadados fixos do anuncio
$dailyMedia = @{}
$grainMedia = @{}
$adMeta = @{}

foreach ($row in $insights) {
    $spend = 0.0
    if ($row.PSObject.Properties.Name -contains 'spend') { $spend = [double]$row.spend }
    $impr = 0L
    if ($row.PSObject.Properties.Name -contains 'impressions') { $impr = [long]$row.impressions }
    $clk = 0L
    if ($row.PSObject.Properties.Name -contains 'clicks') { $clk = [long]$row.clicks }
    $lclk = 0L
    if ($row.PSObject.Properties.Name -contains 'inline_link_clicks') { $lclk = [long]$row.inline_link_clicks }

    $leadsPixelRow = 0.0
    if ($row.PSObject.Properties.Name -contains 'actions') {
        foreach ($a in $row.actions) {
            if ($a.action_type -match 'lead') { $leadsPixelRow += [double]$a.value }
        }
    }

    $totalSpendRaw += $spend
    $totalImpressions += $impr
    $totalClicks += $clk
    $totalLinkClicks += $lclk
    $totalLeadsPixel += $leadsPixelRow

    $day = [string]$row.date_start
    if (-not $dailyMedia.ContainsKey($day)) {
        $dailyMedia[$day] = [ordered]@{ spend = 0.0; impressions = 0L; clicks = 0L; link_clicks = 0L; leads_pixel = 0.0 }
    }
    $dailyMedia[$day].spend += $spend
    $dailyMedia[$day].impressions += $impr
    $dailyMedia[$day].clicks += $clk
    $dailyMedia[$day].link_clicks += $lclk
    $dailyMedia[$day].leads_pixel += $leadsPixelRow

    $adId = [string]$row.ad_id
    if (-not $adMeta.ContainsKey($adId)) {
        $adMeta[$adId] = [ordered]@{ campanha = [string]$row.campaign_name; conjunto = [string]$row.adset_name; anuncio = [string]$row.ad_name }
    }

    $grainKey = $day + '|' + $adId
    if (-not $grainMedia.ContainsKey($grainKey)) {
        $grainMedia[$grainKey] = [ordered]@{ dia = $day; ad_id = $adId; spend = 0.0; impressions = 0L; clicks = 0L; link_clicks = 0L }
    }
    $grainMedia[$grainKey].spend += $spend
    $grainMedia[$grainKey].impressions += $impr
    $grainMedia[$grainKey].clicks += $clk
    $grainMedia[$grainKey].link_clicks += $lclk
}

$totalSpendTax = [math]::Round($totalSpendRaw * $TaxMultiplier, 2)

# ---------------------------------------------------------------------------
# gviz CSV (planilha - somente leitura). WebClient.DownloadFile + TextFieldParser
# (mais rapido e mais robusto com campos entre aspas do que parsear a mao).
# ---------------------------------------------------------------------------
Add-Type -AssemblyName Microsoft.VisualBasic

function Read-GvizCsv {
    param([string]$Gid)
    $url = 'https://docs.google.com/spreadsheets/d/' + $SpreadsheetId + '/gviz/tq?tqx=out:csv&gid=' + $Gid
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        Get-UrlFileWithRetry -Url $url -DestPath $tmp
        $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($tmp, [System.Text.Encoding]::UTF8)
        $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
        $parser.SetDelimiters(',')
        $parser.HasFieldsEnclosedInQuotes = $true

        if ($parser.EndOfData) { throw "gviz gid=$Gid : CSV vazio" }
        $headerFields = $parser.ReadFields()

        $rows = New-Object System.Collections.Generic.List[string[]]
        while (-not $parser.EndOfData) {
            $rows.Add($parser.ReadFields())
        }
        $parser.Close()
        return , @($headerFields, $rows)
    } finally {
        if (Test-Path $tmp) { Remove-Item $tmp -Force }
    }
}

function Find-ColumnIndex {
    param([string[]]$Headers, [string]$Fragment)
    for ($i = 0; $i -lt $Headers.Length; $i++) {
        if ($Headers[$i].Trim().ToLowerInvariant() -eq $Fragment.ToLowerInvariant()) { return $i }
    }
    for ($i = 0; $i -lt $Headers.Length; $i++) {
        if ($Headers[$i].ToLowerInvariant().IndexOf($Fragment.ToLowerInvariant()) -ge 0) { return $i }
    }
    return -1
}

$leadsCsv = Read-GvizCsv -Gid $LeadsGid
$leadsHeaders = $leadsCsv[0]
$leadsRows = $leadsCsv[1]
Write-Host "gviz Leads: $($leadsRows.Count) linhas"

$vendasCsv = Read-GvizCsv -Gid $VendasGid
$vendasHeaders = $vendasCsv[0]
$vendasRows = $vendasCsv[1]
Write-Host "gviz Vendas: $($vendasRows.Count) linhas"

$idxCriadoEm = Find-ColumnIndex -Headers $leadsHeaders -Fragment 'criado_em'
$idxUtmCampaign = Find-ColumnIndex -Headers $leadsHeaders -Fragment 'utm_campaign'
$idxUtmContent = Find-ColumnIndex -Headers $leadsHeaders -Fragment 'utm_content'
$idxUtmTerm = Find-ColumnIndex -Headers $leadsHeaders -Fragment 'utm_term'
$idxClassificacao = Find-ColumnIndex -Headers $leadsHeaders -Fragment 'classificacao'
$idxLeadEmail = Find-ColumnIndex -Headers $leadsHeaders -Fragment 'email'

if ($idxCriadoEm -lt 0) { throw "Coluna criado_em nao encontrada na aba Leads" }
if ($idxClassificacao -lt 0) { throw "Coluna classificacao nao encontrada na aba Leads" }

$idxPagoEm = Find-ColumnIndex -Headers $vendasHeaders -Fragment 'pago_em'
$idxVendaStatus = Find-ColumnIndex -Headers $vendasHeaders -Fragment 'status'
$idxVendaPago = Find-ColumnIndex -Headers $vendasHeaders -Fragment 'pago'
$idxVendaEmail = Find-ColumnIndex -Headers $vendasHeaders -Fragment 'email'

if ($idxPagoEm -lt 0) { throw "Coluna pago_em nao encontrada na aba Vendas" }

# --- Loop grande sobre leads: tudo inline (Substring/IndexOf), sem chamar
#     funcao por linha, para nao derrubar performance em planilhas grandes.
$leadsPeriodo = New-Object System.Collections.Generic.List[object]
$leadEmails = New-Object 'System.Collections.Generic.HashSet[string]'
$periodStartTicks = $PeriodStart.Date.Ticks
$periodEndTicks = $PeriodEnd.Date.Ticks

foreach ($r in $leadsRows) {
    if ($idxCriadoEm -ge $r.Length) { continue }
    $rawDate = $r[$idxCriadoEm]
    if ([string]::IsNullOrWhiteSpace($rawDate)) { continue }

    $dt = [datetime]::MinValue
    $ok = $false
    if ($rawDate.Length -ge 10 -and $rawDate[4] -eq '-' -and $rawDate[7] -eq '-') {
        # formato ISO yyyy-MM-dd (com ou sem horario) - caminho rapido inline
        $y = [int]$rawDate.Substring(0, 4)
        $mo = [int]$rawDate.Substring(5, 2)
        $da = [int]$rawDate.Substring(8, 2)
        try { $dt = [datetime]::new($y, $mo, $da); $ok = $true } catch { $ok = $false }
    }
    if (-not $ok) {
        $ok = [datetime]::TryParse($rawDate, [System.Globalization.CultureInfo]::GetCultureInfo('pt-BR'), [System.Globalization.DateTimeStyles]::None, [ref]$dt)
    }
    if (-not $ok) { continue }
    if ($dt.Date.Ticks -lt $periodStartTicks -or $dt.Date.Ticks -gt $periodEndTicks) { continue }

    $utmCampaign = ''
    if ($idxUtmCampaign -ge 0 -and $idxUtmCampaign -lt $r.Length) { $utmCampaign = $r[$idxUtmCampaign] }
    $utmContent = ''
    if ($idxUtmContent -ge 0 -and $idxUtmContent -lt $r.Length) { $utmContent = $r[$idxUtmContent] }
    $utmTerm = ''
    if ($idxUtmTerm -ge 0 -and $idxUtmTerm -lt $r.Length) { $utmTerm = $r[$idxUtmTerm] }
    $classif = ''
    if ($idxClassificacao -lt $r.Length) { $classif = $r[$idxClassificacao].Trim().ToUpperInvariant() }
    $email = ''
    if ($idxLeadEmail -ge 0 -and $idxLeadEmail -lt $r.Length) { $email = $r[$idxLeadEmail].Trim().ToLowerInvariant() }

    $leadsPeriodo.Add([pscustomobject]@{
        dia          = $dt.ToString('yyyy-MM-dd')
        utm_campaign = $utmCampaign
        utm_content  = $utmContent
        utm_term     = $utmTerm
        classificacao = $classif
    })
    if ($email.Length -gt 0) { [void]$leadEmails.Add($email) }
}

$totalLeads = $leadsPeriodo.Count
$totalQualificados = 0
foreach ($l in $leadsPeriodo) { if ($l.classificacao -eq 'QUALIFICADO') { $totalQualificados++ } }
$pctQualificacao = 0.0
if ($totalLeads -gt 0) { $pctQualificacao = [math]::Round(($totalQualificados / $totalLeads) * 100, 1) }

# --- Loop grande sobre vendas: inline tambem. Atribuicao venda->lead por email.
$vendasPorDia = @{}
$vendasTotal = 0
foreach ($r in $vendasRows) {
    if ($idxPagoEm -ge $r.Length) { continue }
    $rawDate = $r[$idxPagoEm]
    if ([string]::IsNullOrWhiteSpace($rawDate)) { continue }

    $dt = [datetime]::MinValue
    $ok = $false
    if ($rawDate.Length -ge 10 -and $rawDate[4] -eq '-' -and $rawDate[7] -eq '-') {
        $y = [int]$rawDate.Substring(0, 4)
        $mo = [int]$rawDate.Substring(5, 2)
        $da = [int]$rawDate.Substring(8, 2)
        try { $dt = [datetime]::new($y, $mo, $da); $ok = $true } catch { $ok = $false }
    }
    if (-not $ok) {
        $ok = [datetime]::TryParse($rawDate, [System.Globalization.CultureInfo]::GetCultureInfo('pt-BR'), [System.Globalization.DateTimeStyles]::None, [ref]$dt)
    }
    if (-not $ok) { continue }
    if ($dt.Date.Ticks -lt $periodStartTicks -or $dt.Date.Ticks -gt $periodEndTicks) { continue }

    $statusTxt = ''
    if ($idxVendaStatus -ge 0 -and $idxVendaStatus -lt $r.Length) { $statusTxt = $r[$idxVendaStatus].Trim().ToLowerInvariant() }
    $pagoTxt = ''
    if ($idxVendaPago -ge 0 -and $idxVendaPago -lt $r.Length) { $pagoTxt = $r[$idxVendaPago].Trim().ToLowerInvariant() }
    $isPago = $false
    if ($pagoTxt -eq 'true' -or $pagoTxt -eq 'sim' -or $pagoTxt -eq '1' -or $pagoTxt -eq 'verdadeiro' -or $pagoTxt -eq 'pago') { $isPago = $true }
    if ($statusTxt.IndexOf('pag') -ge 0 -or $statusTxt.IndexOf('aprovad') -ge 0 -or $statusTxt.IndexOf('paid') -ge 0 -or $statusTxt.IndexOf('complet') -ge 0 -or $statusTxt.IndexOf('confirmad') -ge 0) { $isPago = $true }
    if (-not $isPago) { continue }

    $vendaEmail = ''
    if ($idxVendaEmail -ge 0 -and $idxVendaEmail -lt $r.Length) { $vendaEmail = $r[$idxVendaEmail].Trim().ToLowerInvariant() }
    if ($vendaEmail.Length -eq 0 -or -not $leadEmails.Contains($vendaEmail)) { continue }

    $vendasTotal++
    $dKey = $dt.ToString('yyyy-MM-dd')
    if (-not $vendasPorDia.ContainsKey($dKey)) { $vendasPorDia[$dKey] = 0 }
    $vendasPorDia[$dKey]++
}

# ---------------------------------------------------------------------------
# Leads por dia e leads por dia+anuncio (join por utm_campaign/utm_content|term)
# ---------------------------------------------------------------------------
$leadsPorDia = @{}
$qualifPorDia = @{}
$leadsPorDiaAnuncio = @{}

foreach ($l in $leadsPeriodo) {
    if (-not $leadsPorDia.ContainsKey($l.dia)) { $leadsPorDia[$l.dia] = 0 }
    $leadsPorDia[$l.dia]++
    if ($l.classificacao -eq 'QUALIFICADO') {
        if (-not $qualifPorDia.ContainsKey($l.dia)) { $qualifPorDia[$l.dia] = 0 }
        $qualifPorDia[$l.dia]++
    }

    foreach ($adId in $adMeta.Keys) {
        $ad = $adMeta[$adId]
        $campMatch = $l.utm_campaign.Trim().ToLowerInvariant() -eq $ad.campanha.Trim().ToLowerInvariant()
        if (-not $campMatch) { continue }
        $adNameLower = $ad.anuncio.Trim().ToLowerInvariant()
        $adMatch = ($l.utm_content.Trim().ToLowerInvariant() -eq $adNameLower) -or ($l.utm_term.Trim().ToLowerInvariant() -eq $adNameLower)
        if (-not $adMatch) { continue }
        $key = $l.dia + '|' + $adId
        if (-not $leadsPorDiaAnuncio.ContainsKey($key)) { $leadsPorDiaAnuncio[$key] = 0 }
        $leadsPorDiaAnuncio[$key]++
    }
}

# ---------------------------------------------------------------------------
# Monta DAILY[]
# ---------------------------------------------------------------------------
$dailyList = New-Object System.Collections.Generic.List[object]
for ($d = $PeriodStart.Date; $d -le $PeriodEnd.Date; $d = $d.AddDays(1)) {
    $dayKey = $d.ToString('yyyy-MM-dd')

    $mSpend = 0.0; $mImpr = 0L; $mClk = 0L; $mLClk = 0L; $mLeadsPixel = 0.0
    if ($dailyMedia.ContainsKey($dayKey)) {
        $m = $dailyMedia[$dayKey]
        $mSpend = $m.spend; $mImpr = $m.impressions; $mClk = $m.clicks; $mLClk = $m.link_clicks; $mLeadsPixel = $m.leads_pixel
    }
    $investDay = [math]::Round($mSpend * $TaxMultiplier, 2)

    $leadsDay = 0
    if ($leadsPorDia.ContainsKey($dayKey)) { $leadsDay = $leadsPorDia[$dayKey] }
    $qualifDay = 0
    if ($qualifPorDia.ContainsKey($dayKey)) { $qualifDay = $qualifPorDia[$dayKey] }
    $vendasDay = 0
    if ($vendasPorDia.ContainsKey($dayKey)) { $vendasDay = $vendasPorDia[$dayKey] }

    $cpmDay = 0.0
    if ($mImpr -gt 0) { $cpmDay = [math]::Round(($investDay / $mImpr) * 1000, 2) }
    $cpcDay = 0.0
    if ($mLClk -gt 0) { $cpcDay = [math]::Round($investDay / $mLClk, 2) }
    $ctrDay = 0.0
    if ($mImpr -gt 0) { $ctrDay = [math]::Round(($mLClk / $mImpr) * 100, 2) }
    $cplDay = $null
    if ($leadsDay -gt 0) { $cplDay = [math]::Round($investDay / $leadsDay, 2) }
    $cliqueLeadDay = 0.0
    if ($mLClk -gt 0) { $cliqueLeadDay = [math]::Round(($leadsDay / $mLClk) * 100, 2) }

    $dailyList.Add([pscustomobject]@{
        data            = $dayKey
        investimento    = $investDay
        impressoes      = $mImpr
        cliques         = $mLClk
        leads_pixel     = [math]::Round($mLeadsPixel, 0)
        leads           = $leadsDay
        qualificados    = $qualifDay
        vendas          = $vendasDay
        cpm             = $cpmDay
        cpc             = $cpcDay
        ctr_link        = $ctrDay
        cpl             = $cplDay
        clique_lead_pct = $cliqueLeadDay
    })
}
$dailyArray = @($dailyList.ToArray())

# ---------------------------------------------------------------------------
# Monta GRAIN[] (dia x campanha x conjunto x anuncio)
# ---------------------------------------------------------------------------
$grainList = New-Object System.Collections.Generic.List[object]
foreach ($key in $grainMedia.Keys) {
    $g = $grainMedia[$key]
    $ad = $adMeta[$g.ad_id]
    $investGrain = [math]::Round($g.spend * $TaxMultiplier, 2)

    $leadsGrain = 0
    if ($leadsPorDiaAnuncio.ContainsKey($key)) { $leadsGrain = $leadsPorDiaAnuncio[$key] }

    $cpmGrain = 0.0
    if ($g.impressions -gt 0) { $cpmGrain = [math]::Round(($investGrain / $g.impressions) * 1000, 2) }
    $cpcGrain = 0.0
    if ($g.link_clicks -gt 0) { $cpcGrain = [math]::Round($investGrain / $g.link_clicks, 2) }
    $ctrGrain = 0.0
    if ($g.impressions -gt 0) { $ctrGrain = [math]::Round(($g.link_clicks / $g.impressions) * 100, 2) }
    $cplGrain = $null
    if ($leadsGrain -gt 0) { $cplGrain = [math]::Round($investGrain / $leadsGrain, 2) }

    $grainList.Add([pscustomobject]@{
        data         = $g.dia
        campanha     = $ad.campanha
        conjunto     = $ad.conjunto
        anuncio      = $ad.anuncio
        investimento = $investGrain
        impressoes   = $g.impressions
        cliques      = $g.link_clicks
        leads        = $leadsGrain
        cpm          = $cpmGrain
        cpc          = $cpcGrain
        ctr          = $ctrGrain
        cpl          = $cplGrain
    })
}
$grainArray = @($grainList.ToArray())

# ---------------------------------------------------------------------------
# Escreve data-meta.js / data-daily.js / data-grain.js
# ConvertTo-Json do PS 5.1 tem bug com array heterogeneo/1 item (vira escalar).
# Por isso o front usa um helper arr(x) para normalizar - nao dependemos so
# do lado PowerShell.
# ---------------------------------------------------------------------------
$outDir = $PSScriptRoot

if ($Mode -eq 'all' -or $Mode -eq 'daily') {
    $metaObj = [ordered]@{
        gerado_em = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        cliente   = $ClienteNome
        periodo   = [ordered]@{ inicio = $PeriodStart.ToString('yyyy-MM-dd'); fim = $PeriodEnd.ToString('yyyy-MM-dd') }
        imposto   = $TaxMultiplier
        fontes    = [ordered]@{
            meta_conta       = $MetaAccountId
            meta_api_version = $MetaApiVersion
            planilha_id      = $SpreadsheetId
            leads_gid        = $LeadsGid
            vendas_gid       = $VendasGid
        }
    }
    $metaJson = ConvertTo-Json -InputObject $metaObj -Depth 10
    Set-Content -Path (Join-Path $outDir 'data-meta.js') -Value ("window.META = " + $metaJson + ";") -Encoding UTF8

    $dailyJson = ConvertTo-Json -InputObject $dailyArray -Depth 10
    Set-Content -Path (Join-Path $outDir 'data-daily.js') -Value ("window.DAILY = " + $dailyJson + ";") -Encoding UTF8
}

if ($Mode -eq 'all' -or $Mode -eq 'grain') {
    $grainJson = ConvertTo-Json -InputObject $grainArray -Depth 10
    Set-Content -Path (Join-Path $outDir 'data-grain.js') -Value ("window.GRAIN = " + $grainJson + ";") -Encoding UTF8
}

Write-Host "== Resumo =="
Write-Host "Leads (planilha): $totalLeads | Qualificados: $totalQualificados ($pctQualificacao pct)"
Write-Host "Vendas (email casado com lead do periodo): $vendasTotal"
Write-Host "Investimento (com imposto): $totalSpendTax"
Write-Host "Arquivos gravados em $outDir (verificar com Get-Content -Encoding UTF8)"
