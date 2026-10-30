# 總表更新工具（excel-tool/update-master.ps1）的自動測試。只用假資料，需要這台電腦有 Excel。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tests\excel_tool_test.ps1
# 假資料放在 tests\fixtures\excel\（不會進 repo）。最後印出「全部通過」。
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$HERE = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT = Split-Path $HERE
$FX = Join-Path $HERE 'fixtures\excel'
if (Test-Path $FX) { Remove-Item -Recurse -Force $FX }
New-Item -ItemType Directory -Force $FX | Out-Null
$TOOL = Join-Path $ROOT 'excel-tool\update-master.ps1'
$INV = [Globalization.CultureInfo]::InvariantCulture
function ok($c, $m) { if ($c) { Write-Host "PASS $m" } else { Write-Host "FAIL $m"; throw "測試失敗：$m" } }
function T([string]$s) { "'" + $s }   # 寫成文字
function Rng($ws, $r1, $c1, $r2, $c2) { , $ws.Range($ws.Cells.Item($r1, $c1), $ws.Cells.Item($r2, $c2)) }   # 前面的逗號：不要讓 PowerShell 把範圍拆成一格一格
function Last-Row($ws, [int]$col) { $f = $ws.Columns.Item($col).Find('*', $ws.Cells.Item(1, $col), -4123, 2, 1, 2); if ($f) { $f.Row } else { 1 } }
function Put($ws, $r, $rows) {
  $n = $rows.Count; $m = $rows[0].Count
  $a = New-Object 'object[,]' $n, $m
  for ($i = 0; $i -lt $n; $i++) { for ($j = 0; $j -lt $m; $j++) { $v = $rows[$i][$j]; $a[$i, $j] = if ($v -is [string]) { T $v } elseif ($null -eq $v) { $null } else { $v.psobject.BaseObject } } }
  (Rng $ws $r 1 ($r + $n - 1) $m).Value2 = $a
}

# ---------- 假資料 ----------
$custs = @(@('1A01', '甲商行'), @('3B02', '乙公司'), @('5C03', '丙店'), @('7D04', '丁行'))
$skus = @('A100-1', 'A100-2', 'B200/3', 'C300')
function SalesRow($ord, $l, $sku, $cat, $color, $price, $qty, $c, $u) {
  # 出貨單號 DELIVORD 商品類別 商品代號 顏色 單位 TRAN_RATE 單價 售價 PRC 數量 單位(數字) 品項總額 RECEIVE CUT TOTBKPAY PAY BUY 客戶代號 客戶名 出貨總額 業務員
  , @($ord, ('{0:00}' -f $l), $cat, $sku, $color, '雙', 1.0, [double]($price * 0.6), [double]$price, 0.0, [double]$qty, 1.0, [double]($price * $qty), 0.0, $false, 0.0, $false, $false, $c[0], $c[1], $u, 12.0)
}
function RetRow($ord, $sku, $cat, $color, $price, $qty, $c) {
  # 退貨單號 SERIES DELIVORD 商品類別 商品代號 顏色 單位 TRAN_RATE 單價 售價 數量 單位(數字) 退貨金額 RECEIVE TOTBKPAY PAY HOLD 客戶代號 客戶名 退貨總金額 業務員
  , @($ord, $null, '01', $cat, $sku, $color, '雙', 1.0, [double]($price * 0.6), [double]$price, [double]$qty, 1.0, [double]($price * $qty), 0.0, 0.0, $false, $false, $c[0], $c[1], [double]($price * $qty), 12.0)
}
# 實際出貨／退貨日期（原始資料最後一欄 DELIVDATE）：一般是單號月份的 15 日；晚到的單故意放在下個月，檢查排序後日期仍跟著那一列
function DateOf([string]$ord) { switch ($ord) { '1140300099' { '1140402' } '1140290099' { '1140303' } default { $ord.Substring(0, 5) + '15' } } }
function OrderRows($ym, $o, $m) {
  $c = $custs[($o + $m) % 4]; $nl = 1 + ($o % 3); $rows = @()
  for ($l = 1; $l -le $nl; $l++) {
    $sku = $skus[($o + $l) % 4]; $price = @(100, 150, 200)[($o + $l) % 3]; $qty = 1 + (($o * $l + $m) % 9)
    $rows += , (SalesRow ('{0}{1:00000}' -f $ym, $o) $l $sku ('{0:00}' -f (($o + $l) % 4 + 1)) ('{0:00}' -f ($l % 2 + 1)) $price $qty $c $null)
  }
  $tot = 0; foreach ($r in $rows) { $tot += $r[12] }; $rows[0][20] = [double]$tot
  , $rows
}
$sales = @(); $rets = @()
for ($m = 1; $m -le 8; $m++) {
  $ym = 11400 + $m
  for ($o = 1; $o -le 6; $o++) { $sales += OrderRows $ym $o $m }
  for ($o = 1; $o -le 2; $o++) { $rets += , (RetRow ('{0}9{1:0000}' -f $ym, $o) $skus[$o] '01' '01' 100 (1 + $o) $custs[$o]) }
}
Write-Host "假總表：進貨 $($sales.Count) 筆、退貨 $($rets.Count) 筆"

$xl = New-Object -ComObject Excel.Application
$xl.DisplayAlerts = $false
try {
  # ---------- 假總表 ----------
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 3) { [void]$wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
  $wb.Worksheets.Item(1).Name = '進貨樞紐'; $ws = $wb.Worksheets.Item(2); $ws.Name = '原始進貨表'; $wr = $wb.Worksheets.Item(3); $wr.Name = '原始退貨表'
  $SH = @('出貨單號', 'DELIVORD', '商品類別', '商品代號', '顏色代號', '單位', 'TRAN_RATE', '單價', '售價', 'PRC', '數量', '單位(數字)', '品項總額', 'RECEIVE', 'CUT', 'TOTBKPAY', 'PAY', 'BUY', '客戶代號', '客戶名', '出貨總額', '業務員',
    '代號+客戶', '賣出數', '毛利', '毛利率', '訂單年月', '訂單年份', '訂單月份', '區域', '商品代碼(簡化)')
  Put $ws 1 (, $SH); Put $ws 2 $sales
  $n = $sales.Count + 1
  $F = [ordered]@{ W = '=S2&""&T2'; X = '=IF(L2=1, K2, IF(L2=2, K2*12, 0))'; Y = '=M2*Z2'; Z = '=1-(H2/I2)'; AA = '=LEFT(A2,5)'; AB = '=LEFT(A2,3)'; AC = '=MID(A2, 4, 2)'
    AD = '=IFS(OR(LEFT(S2,1)="1", LEFT(S2,1)="2"), "大台北地區",LEFT(S2,1)="3", "桃竹苗",OR(LEFT(S2,1)="4", LEFT(S2,1)="5"), "中部",OR(LEFT(S2,1)="6", LEFT(S2,1)="7", LEFT(S2,1)="8"), "南部",TRUE, "其他地區")' }
  foreach ($k in $F.Keys) { $ws.Range("${k}2:$k$n").Formula2 = $F[$k] }
  $tEnd = $n + 300   # 和真的總表一樣：表格下面還有空白列，AE 公式一路到底
  $ws.Range("AE2:AE$tEnd").Formula2 = '=LEFT(D2, MIN(IFERROR(FIND("-", D2), LEN(D2)+1), IFERROR(FIND("/", D2), LEN(D2)+1)) - 1)'
  $lo = $ws.ListObjects.Add(1, $ws.Range("A1:AE$tEnd"), [Type]::Missing, 1); $lo.Name = '表格1'
  $ws.Range('AR2').Value2 = 11409.0
  $spill = @(
    @('AK', '=UNIQUE(W:W)', [ordered]@{ AL = @('最近售出日', '=LOOKUP(2, 1/(W:W=AK2), AA:AA)'); AM = @('110年來第一筆售出日', '=INDEX(AA:AA, MATCH(AK2, W:W, 0))')
        AN = @('110年至今月份', '=(INT(AR$2/100)-INT(AM2/100))*12+((MOD(AR$2,100)-(MOD(AM2,100))+1))'); AO = @('靜止月份', '=(INT(AR$2/100)-INT(AL2/100))*12+((MOD(AR$2,100)-(MOD(AL2,100))))')
        AP = @('購買頻率 (天)', '=(((INT(AL2/100)-INT(AM2/100))*12+((MOD(AL2,100)-(MOD(AM2,100))+1)))/(COUNTA(UNIQUE(FILTER(A:A,W:W=AK2))))*30)') }),
    @('AT', '=UNIQUE(D:D)', [ordered]@{ AU = @('商品最近售出日', '=LOOKUP(2, 1/(D:D=AT2), AA:AA)'); AV = @('110年來第一筆售出日', '=INDEX(AA:AA, MATCH(AT2, D:D, 0))')
        AW = @('110年至今月份', '=(INT(AR$2/100)-INT(AV2/100))*12+((MOD(AR$2,100)-(MOD(AV2,100))+1))'); AX = @('滯銷/停售月份', '=(INT(AR$2/100)-INT(AU2/100))*12+((MOD(AR$2,100)-(MOD(AU2,100))))') }),
    @('AZ', '=UNIQUE(AE:AE)', [ordered]@{}),
    @('BM', '=UNIQUE(AE:AE)', [ordered]@{ BN = @('商品最近售出日', '=LOOKUP(2, 1/(AE:AE=BM2), AA:AA)'); BO = @('110年來第一筆售出日', '=INDEX(AA:AA, MATCH(BM2, AE:AE, 0))')
        BP = @('110年至今月份', '=(INT(AR$2/100)-INT(BO2/100))*12+((MOD(AR$2,100)-(MOD(BO2,100))+1))'); BQ = @('滯銷/停售月份', '=(INT(AR$2/100)-INT(BN2/100))*12+((MOD(AR$2,100)-(MOD(BN2,100))))')
        BR = @('商品類別', '=INDEX(C:C, MATCH(BM2, AE:AE, 0))') })
  )
  $xl.Calculate()
  foreach ($s in $spill) {
    $ws.Range("$($s[0])1").Formula2 = $s[1]; [void]$ws.Range("$($s[0])1").Calculate()
    $sp = $ws.Range("$($s[0])1").SpillingToRange; $e = $sp.Row + $sp.Rows.Count - 1
    foreach ($c in $s[2].Keys) { $ws.Range("${c}1").Value2 = $s[2][$c][0]; $ws.Range("${c}2:$c$e").Formula2 = $s[2][$c][1] }
  }
  # BB～BJ 對照表（固定值，進貨＋退貨）
  $dimDefs = @(@('BB', '代號客戶', '代號+客戶'), @('BC', '商品代號', '商品代號'), @('BD', '表格8', '訂單年份'), @('BE', '表格9', '訂單年月'), @('BF', '表格10', '訂單月份'), @('BG', '表格11', '區域'), @('BH', '表格12', '顏色代號'), @('BI', '表格5', '商品代碼(簡化)'), @('BJ', '表格3', '商品類別'))
  function Region($c) { switch ($c.Substring(0, 1)) { { $_ -in '1', '2' } { '大台北地區' } '3' { '桃竹苗' } { $_ -in '4', '5' } { '中部' } { $_ -in '6', '7', '8' } { '南部' } default { '其他地區' } } }
  $vals = @{}; foreach ($d in $dimDefs) { $vals[$d[2]] = New-Object 'System.Collections.Generic.List[object]' }
  function AddDim($h, $v) { if (-not $vals[$h].Contains($v)) { $vals[$h].Add($v) } }
  foreach ($r in $sales) { AddDim '代號+客戶' ($r[18] + $r[19]); AddDim '商品代號' $r[3]; AddDim '訂單年份' ([double]$r[0].Substring(0, 3)); AddDim '訂單年月' $r[0].Substring(0, 5); AddDim '訂單月份' $r[0].Substring(3, 2); AddDim '區域' (Region $r[18]); AddDim '顏色代號' $r[4]; AddDim '商品代碼(簡化)' ($r[3] -split '[-/]')[0]; AddDim '商品類別' $r[2] }
  AddDim '代號+客戶' 'X999已不存在'
  foreach ($d in $dimDefs) {
    $col = $ws.Range("$($d[0])1").Column; $list = $vals[$d[2]]
    $ws.Cells.Item(1, $col).Value2 = $d[2]
    for ($i = 0; $i -lt $list.Count; $i++) { $v = $list[$i]; $ws.Cells.Item($i + 2, $col).Value2 = if ($v -is [string]) { T $v } else { $v } }
    $t = $ws.ListObjects.Add(1, (Rng $ws 1 $col ($list.Count + 1) $col), [Type]::Missing, 1); $t.Name = $d[1]
  }
  $dimCount = @{}; foreach ($d in $dimDefs) { $dimCount[$d[2]] = $vals[$d[2]].Count }
  # 原始退貨表（一般範圍，不是表格）
  $RH = @('退貨單號', 'SERIES', 'DELIVORD', '商品類別', '商品代號', '顏色代號', '單位', 'TRAN_RATE', '單價', '售價', '數量', '單位(數字)', '退貨金額', 'RECEIVE', 'TOTBKPAY', 'PAY', 'HOLD', '客戶代號', '客戶名', '退貨總金額', '業務員',
    '代號+客戶', '訂單年月', '訂單年份', '訂單月份', '區域', '商品代碼(簡化)', '退貨總數')
  Put $wr 1 (, $RH); Put $wr 2 $rets
  $rn = $rets.Count + 1
  $RF = [ordered]@{ V = '=R2&""&S2'; W = '=LEFT(A2,5)'; X = '=LEFT(A2,3)'; Y = '=MID(A2, 4, 2)'
    Z = '=IFS(OR(LEFT(R2,1)="1", LEFT(R2,1)="2"), "大台北地區",LEFT(R2,1)="3", "桃竹苗",OR(LEFT(R2,1)="4", LEFT(R2,1)="5"), "中部",OR(LEFT(R2,1)="6", LEFT(R2,1)="7", LEFT(R2,1)="8"), "南部",TRUE, "其他地區")'
    AA = '=LEFT(E2, MIN(IFERROR(FIND("-", E2), LEN(E2)+1), IFERROR(FIND("/", E2), LEN(E2)+1)) - 1)'; AB = '=IF(L2=1, K2, IF(L2=2, K2*12, 0))' }
  foreach ($k in $RF.Keys) { $wr.Range("${k}2:$k$rn").Formula2 = $RF[$k] }
  # 樞紐分析（依訂單年月加總品項總額）
  $pc = $wb.PivotCaches().Create(1, '表格1')
  $pt = $pc.CreatePivotTable($wb.Worksheets.Item('進貨樞紐').Range('A3'), 'PT1')
  $pt.PivotFields('訂單年月').Orientation = 1
  [void]$pt.AddDataField($pt.PivotFields('品項總額'))
  $xl.Calculation = -4105
  $xl.Calculate()
  $MASTER = Join-Path $FX 'master.xlsx'; $MASTER_PW = Join-Path $FX 'master_pw.xlsx'
  $wb.SaveAs($MASTER, 51)
  $wb.SaveAs($MASTER_PW, 51, 'pw1234')
  $wb.Close($false)

  # ---------- 假 JMSSAL.xlsx ----------
  $byOrd = @{}; foreach ($r in $sales) { if (-not $byOrd[$r[0]]) { $byOrd[$r[0]] = @() }; $byOrd[$r[0]] += , $r }
  $newSales = @()
  foreach ($r in $byOrd['1140800006']) { $x = $r.Clone(); $x[11] = '1'; $x[21] = '12'; if ($null -eq $x[20]) { $x[20] = 0.0 }; $newSales += , $x }   # 重複（型態不同、空白變 0 也算一樣）
  $i = 0; foreach ($r in $byOrd['1140800005']) { $x = $r.Clone(); if ($i -eq 0) { $x[10] = $x[10] + 1 }; $newSales += , $x; $i++ }     # 數量不同 → 改用新資料
  foreach ($r in $byOrd['1140800004']) { $x = $r.Clone(); $x[21] = 13.0; $newSales += , $x }                                    # 只有業務員不同 → 保留原本的
  $i = 0; foreach ($r in $byOrd['1140800002']) { $x = $r.Clone(); $x[21] = 13.0; if ($i -eq 1) { $x[8] = $x[8] + 10 }; $newSales += , $x; $i++ }   # 售價和業務員都不同 → 用新資料、業務員保留原本的
  foreach ($r in $byOrd['1140700004']) { $newSales += , $r.Clone() }; $newSales += , (SalesRow '1140700004' 3 'C300' '02' '01' 150 4 $custs[3] $null)   # 多一列
  $i = 0; foreach ($r in $byOrd['1140700005']) { if ($i -lt 2) { $newSales += , $r.Clone() }; $i++ }                                # 少一列
  $newCust = @('9Z09', '新客戶')
  foreach ($o in 4, 3, 2, 1) {                                                                                                         # 新的 115/09 單（檔案裡順序倒過來）
    if ($o -eq 3) { $newSales += , (SalesRow '1140900003' 1 'D400-1' '05' '03' 200 2 $newCust 400.0) }
    else { $newSales += OrderRows 11409 $o 9 }
  }
  $newSales += , (SalesRow '1140300099' 1 'A100-1' '01' '01' 100 1 $custs[1] 400.0)                                                 # 晚到的 114/03 單
  $newSales += , (SalesRow '1140300099' 2 'C300' '02' '02' 150 2 $custs[1] $null)
  $wbS = $xl.Workbooks.Add(); $s1 = $wbS.Worksheets.Item(1); $s1.Name = 'JMSSAL'
  $SALH = @('DELIVNO', 'DELIVORD', 'CODE', 'STYLE', 'COLO', 'UNIT_NM', 'TRAN_RATE', 'PRICE', 'OUTPRICE', 'PRC', 'OUTQTY', 'UNIT', 'SALEGET', 'RECEIVE', 'CUT', 'TOTBKPAY', 'PAY', 'BUY', 'ID', 'SNAME', 'AMOUNT', 'EMPNO', 'DELIVDATE')
  Put $s1 1 (, $SALH)
  $tmp = @(); foreach ($r in $newSales) { $x = @($r + @((DateOf $r[0]))); $x[11] = '1'; $x[21] = ([double]$x[21]).ToString($INV); if ($null -eq $x[20]) { $x[20] = 0.0 }; $tmp += , $x }
  Put $s1 2 $tmp
  $SAL = Join-Path $FX 'JMSSAL.xlsx'; $wbS.SaveAs($SAL, 51); $wbS.Close($false)
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($xl); $xl = $null; [GC]::Collect(); [GC]::WaitForPendingFinalizers() }

# ---------- 假 JMSSBK.DBF（dBASE III，中文用 Big5）----------
$big5 = [Text.Encoding]::GetEncoding(950)
$FIELDS = @(@('DELIVNO', 'C', 10, 0), @('SERIES', 'C', 2, 0), @('DELIVORD', 'C', 3, 0), @('CODE', 'C', 3, 0), @('STYLE', 'C', 15, 0), @('COLO', 'C', 3, 0), @('UNIT_NM', 'C', 4, 0), @('TRAN_RATE', 'N', 5, 0),
  @('PRICE', 'N', 10, 2), @('OUTPRICE', 'N', 10, 2), @('OUTQTY', 'N', 8, 0), @('UNIT', 'C', 1, 0), @('SALEGET', 'N', 12, 2), @('RECEIVE', 'N', 12, 2), @('TOTBKPAY', 'N', 12, 2), @('PAY', 'L', 1, 0), @('HOLD', 'L', 1, 0),
  @('ID', 'C', 6, 0), @('SNAME', 'C', 20, 0), @('AMOUNT', 'N', 12, 0), @('EMPNO', 'C', 3, 0), @('DELIVDATE', 'C', 8, 0))
$dbfRows = @()
foreach ($r in $rets) { if ($r[0] -eq '1140890002') { $dbfRows += , $r } }                                                   # 重複
$dbfRows += , (RetRow '1140990001' 'D400-1' '05' '03' 200 1 $newCust) # 新的退貨
$dbfRows += , (RetRow '1140990002' 'A100-2' '01' '01' 100 1 @('2E05', '戊店')) # 只在退貨出現的新客戶
$dbfRows += , (RetRow '1140290099' 'B200/3' '03' '02' 150 1 $custs[2]) # 晚到的 114/02 退貨
$recLen = 1; foreach ($f in $FIELDS) { $recLen += $f[2] }
$ms = New-Object IO.MemoryStream; $bw = New-Object IO.BinaryWriter($ms)
$bw.Write([byte]3); $bw.Write([byte]126); $bw.Write([byte]9); $bw.Write([byte]1); $bw.Write([int]$dbfRows.Count)
$bw.Write([int16](32 + 32 * $FIELDS.Count + 1)); $bw.Write([int16]$recLen); $bw.Write((New-Object byte[] 17)); $bw.Write([byte]0x78); $bw.Write((New-Object byte[] 2))
foreach ($f in $FIELDS) { $nm = New-Object byte[] 11; [Text.Encoding]::ASCII.GetBytes($f[0]).CopyTo($nm, 0); $bw.Write($nm); $bw.Write([byte][char]$f[1]); $bw.Write((New-Object byte[] 4)); $bw.Write([byte]$f[2]); $bw.Write([byte]$f[3]); $bw.Write((New-Object byte[] 14)) }
$bw.Write([byte]0x0D)
foreach ($r in $dbfRows) {
  $bw.Write([byte][char]' ')
  $vals = @($r + @((DateOf $r[0])))
  for ($k = 0; $k -lt $FIELDS.Count; $k++) {
    $f = $FIELDS[$k]; $v = $vals[$k]
    if ($k -eq 11) { $v = '1' }; if ($k -eq 20) { $v = '12' }
    $s = switch ($f[1]) { 'N' { if ($null -eq $v) { '' } else { ([double]$v).ToString('F' + $f[3], $INV) } } 'L' { if ($v) { 'T' } else { 'F' } } default { if ($null -eq $v) { '' } else { [string]$v } } }
    $b = $big5.GetBytes($s)
    $pad = New-Object byte[] $f[2]; for ($q = 0; $q -lt $f[2]; $q++) { $pad[$q] = 32 }
    if ($f[1] -eq 'N') { [Array]::Copy($b, 0, $pad, $f[2] - $b.Length, $b.Length) } else { [Array]::Copy($b, 0, $pad, 0, [math]::Min($b.Length, $f[2])) }
    $bw.Write($pad)
  }
}
$bw.Write([byte]0x1A); $bw.Flush()
$BK = Join-Path $FX 'JMSSBK.DBF'; [IO.File]::WriteAllBytes($BK, $ms.ToArray())
Write-Host "假 JMSSAL：$($newSales.Count) 筆；假 JMSSBK.DBF：$($dbfRows.Count) 筆"

# ---------- 執行工具 ----------
function RunTool($master, $out, $extra = @()) {
  $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', $TOOL, '-NoUI', '-Master', $master, '-Sales', $SAL, '-Returns', $BK, '-Out', $out) + $extra
  & powershell @args2 | ForEach-Object { Write-Host "    | $_" }
  return $LASTEXITCODE
}
$hash0 = (Get-FileHash $MASTER).Hash
$OUT = Join-Path $FX 'out.xlsx'
$code = RunTool $MASTER $OUT
ok ($code -eq 0 -and (Test-Path $OUT)) '工具執行成功，另存新檔'
ok ((Get-FileHash $MASTER).Hash -eq $hash0) '原本的總表沒有被修改'

# ---------- 檢查結果 ----------
$expSalesAdd = 2 + ($newSales | Where-Object { $_[0] -like '114090*' }).Count
$xl = New-Object -ComObject Excel.Application; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($OUT, 0, $true)
  ok ($xl.Calculation -eq -4105) '計算模式維持「自動」'
  $ws = $wb.Worksheets.Item('原始進貨表')
  $last = Last-Row $ws 1
  ok ($last - 1 -eq $sales.Count + $expSalesAdd) "進貨筆數：$($sales.Count) + $expSalesAdd = $($last - 1)（重複的沒加入；多一列、少一列的單照新資料）"
  $v = $ws.Range("A1:AE$last").Value2
  $prev = ''; $allText = $true; $isSorted = $true
  for ($i = 2; $i -le $last; $i++) { $a = $v[$i, 1]; if (-not ($a -is [string])) { $allText = $false }; if ([string]::CompareOrdinal([string]$a, $prev) -lt 0) { $isSorted = $false }; $prev = [string]$a }
  ok $allText '出貨單號全部是文字（沒有變成數字）'
  ok $isSorted '進貨表依出貨單號排序'
  $late = @(); for ($i = 2; $i -le $last; $i++) { if ($v[$i, 1] -eq '1140300099') { $late += $i } }
  ok ($late.Count -eq 2 -and $late[1] -eq $late[0] + 1 -and $v[$late[0], 2] -eq '01' -and $v[$late[1], 2] -eq '02' -and ([string]$v[($late[0] - 1), 1]).StartsWith('11403') -and ([string]$v[($late[1] + 1), 1]).StartsWith('11404')) '晚到的 114/03 單插回 3 月的位置，同一張單的順序不變'
  $nr = 0; for ($i = 2; $i -le $last; $i++) { if ($v[$i, 1] -eq '1140900003') { $nr = $i } }
  ok ($nr -gt 0 -and $v[$nr, 23] -eq '9Z09新客戶' -and $v[$nr, 30] -eq '其他地區' -and $v[$nr, 31] -eq 'D400' -and $v[$nr, 24] -eq 2 -and $v[$nr, 27] -eq '11409') '新資料的 W～AE 公式有補上、算出來正確'
  ok ($v[$nr, 12] -is [double] -and $v[$nr, 22] -is [double]) '單位(數字)、業務員照總表存成數字'
  ok ($ws.Cells.Item($nr, 23).HasFormula -and $ws.Cells.Item($late[0], 31).HasFormula) 'W、AE 欄是公式'
  $lo = $ws.ListObjects.Item('表格1'); ok ($lo.Range.Rows.Count -eq $last) "表格1 剛好到最後一筆資料（第 $last 列），下面的空白列已縮掉"
  ok (-not $ws.Cells.Item($last + 1, 31).HasFormula -and -not $ws.Cells.Item($last + 1, 23).HasFormula -and (Last-Row $ws 31) -eq $last) '資料下面沒有殘留的 AE 公式'
  function OrdRows($k) { $r = @(); for ($i = 2; $i -le $last; $i++) { if ($v[$i, 1] -eq $k) { $r += $i } }; , $r }
  $o5 = OrdRows '1140800005'; ok ($o5.Count -eq 3 -and $v[$o5[0], 11] -eq $byOrd['1140800005'][0][10] + 1) '內容不一樣（數量）→ 改用新資料'
  $o4 = OrdRows '1140800004'; ok ($o4.Count -eq 2 -and @($o4 | Where-Object { $v[$_, 22] -ne 12 }).Count -eq 0) '只有業務員不同 → 保留原本的業務員'
  $o2 = OrdRows '1140800002'; ok ($o2.Count -eq 3 -and $v[$o2[1], 9] -eq $byOrd['1140800002'][1][8] + 10 -and @($o2 | Where-Object { $v[$_, 22] -ne 12 }).Count -eq 0) '售價和業務員都不同 → 售價用新的、業務員保留原本的'
  $o74 = OrdRows '1140700004'; ok ($o74.Count -eq 3 -and $o74[2] -eq $o74[0] + 2 -and $v[$o74[2], 2] -eq '03') '新資料多一列 → 整張照新資料，排在一起'
  $o75 = OrdRows '1140700005'; ok ($o75.Count -eq 2) '新資料少一列 → 多的舊列刪掉'
  # 實際出貨日期（AF 欄）
  ok ([string]$ws.Range('AF1').Value2 -eq '實際出貨日期' -and $lo.Range.Columns.Count -eq 32) '新增 AF 欄「實際出貨日期」，表格1 加寬到 AF'
  $dv = $ws.Range("AF1:AF$last").Value2
  ok ($dv[$late[0], 1] -eq '1140402' -and $dv[$late[1], 1] -eq '1140402') '晚到的 114/03 單重新排序後，實際日期（114/04/02）跟著那一列'
  ok ($dv[$nr, 1] -eq '1140915' -and $dv[$nr, 1] -is [string]) '新加入的單有實際日期，存成文字'
  $o6 = OrdRows '1140800006'; ok ($o6.Count -gt 0 -and @($o6 | Where-Object { $dv[$_, 1] -ne '1140815' }).Count -eq 0) '重複跳過的單（總表原有）也補上實際日期'
  ok (@($o5 + $o2 + $o74 + $o75 | Where-Object { $dv[$_, 1] -notlike '11408*' -and $dv[$_, 1] -notlike '11407*' }).Count -eq 0) '改用新資料、多一列、少一列的單，實際日期都正確'
  $o11 = OrdRows '1140100001'; ok ($o11.Count -gt 0 -and @($o11 | Where-Object { $null -ne $dv[$_, 1] }).Count -eq 0) '新資料裡沒有的單，實際日期留空'
  ok ($null -eq $ws.Range("AF$($last + 1)").Value2) '資料下面沒有殘留的日期'
  # UNIQUE 清單與旁邊的公式
  foreach ($chk in @(@('AK', 'AL', 'AP', '9Z09新客戶', 'AN'), @('AT', 'AU', 'AX', 'D400-1', 'AW'), @('BM', 'BN', 'BR', 'D400', 'BP'))) {
    $c0 = $ws.Range("$($chk[0])1"); $sp = $c0.SpillingToRange; $e = $sp.Row + $sp.Rows.Count - 1
    $list = $sp.Value2; $row = 0; for ($i = 1; $i -le $sp.Rows.Count; $i++) { if ($list[$i, 1] -eq $chk[3]) { $row = $sp.Row + $i - 1 } }
    ok ($row -gt 0) "$($chk[0]) 清單有新的「$($chk[3])」"
    ok ($ws.Range("$($chk[1])$e").HasFormula -and $ws.Range("$($chk[2])$e").HasFormula) "$($chk[1])～$($chk[2]) 公式補到清單最後一列（第 $e 列）"
    ok ($ws.Range("$($chk[4])$row").Value2 -is [double]) "$($chk[4]) 對新項目算得出月份"
  }
  ok ($ws.Range('AR2').Value2 -eq 11410) "AR2 自動填成 11410（資料到 114/09）"
  $dims = @{}; foreach ($t in $ws.ListObjects) { if ($t.Name -ne '表格1') { $dims[[string]$t.Range.Cells.Item(1, 1).Value2] = @($t.DataBodyRange.Value2) } }
  function SpillVals($addr) { $sp = $ws.Range($addr).SpillingToRange; $x = @($sp.Value2); , @($x[1..($x.Count - 1)] | Where-Object { $null -ne $_ }) }
  foreach ($pair in @(@('代號+客戶', 'AK1'), @('商品代號', 'AT1'), @('商品代碼(簡化)', 'BM1'))) {
    $want = SpillVals $pair[1]; $got = $dims[$pair[0]]
    ok ($want.Count -eq $got.Count -and ($want -join '|') -ceq ($got -join '|') -and $got[$got.Count - 1] -eq 0) "對照表「$($pair[0])」和 $($pair[1]) 的清單一模一樣，包含最後的空白／0（$($got.Count) 個）"
  }
  ok ($dims['代號+客戶'] -contains '9Z09新客戶' -and $dims['代號+客戶'] -notcontains '2E05戊店' -and $dims['代號+客戶'] -notcontains 'X999已不存在') '對照表 BB：有新客戶；只在退貨的客戶、AK 沒有的舊值都不在'
  ok ($dims['商品類別'] -contains '05' -and $dims['區域'] -contains '其他地區' -and $dims['顏色代號'] -contains '03') '對照表 BJ、BG、BH 加入進貨新的值'
  ok ($dims['訂單年月'] -contains '11409' -and $dims['訂單年月'].Count -eq $dimCount['訂單年月'] + 1) '對照表 BE 加入 11409，沒有重複'
  ok ($dims['訂單年份'].Count -eq $dimCount['訂單年份'] -and $dims['訂單年份'][0] -is [double]) '對照表 BD（數字）沒有多出重複的年份'
  # 退貨
  $wr = $wb.Worksheets.Item('原始退貨表')
  $rl = Last-Row $wr 1
  ok ($rl - 1 -eq $rets.Count + 3) "退貨筆數：$($rets.Count) + 3 = $($rl - 1)（重複的沒有加入）"
  $rv = $wr.Range("A1:AB$rl").Value2; $prev = ''; $isSorted = $true; $lr = 0
  for ($i = 2; $i -le $rl; $i++) { $a = [string]$rv[$i, 1]; if ([string]::CompareOrdinal($a, $prev) -lt 0) { $isSorted = $false }; $prev = $a; if ($rv[$i, 1] -eq '1140290099') { $lr = $i } }
  ok $isSorted '退貨表依退貨單號排序'
  ok ($lr -gt 0 -and ([string]$rv[($lr - 1), 1]).StartsWith('11402') -and ([string]$rv[($lr + 1), 1]).StartsWith('11403') -and $rv[$lr, 23] -eq '11402' -and $wr.Cells.Item($lr, 22).HasFormula) '晚到的 114/02 退貨插回 2 月，V～AB 公式正確'
  $dr = 0; for ($i = 2; $i -le $rl; $i++) { if ($rv[$i, 1] -eq '1140990001') { $dr = $i } }
  ok ($dr -gt 0 -and $rv[$dr, 19] -eq '新客戶' -and $rv[$dr, 5] -eq 'D400-1') 'DBF 的中文（Big5）和文字欄位讀取正確，沒有多餘空白'
  # 實際退貨日期（AC 欄，退貨表是一般範圍）
  ok ([string]$wr.Range('AC1').Value2 -eq '實際退貨日期') '新增 AC 欄「實際退貨日期」'
  $rd = $wr.Range("AC1:AC$rl").Value2
  ok ($rd[$lr, 1] -eq '1140303' -and $rd[$dr, 1] -eq '1140915') '晚到的 114/02 退貨排序後實際日期（114/03/03）正確；新的退貨有日期'
  $dup = 0; for ($i = 2; $i -le $rl; $i++) { if ($rv[$i, 1] -eq '1140890002') { $dup = $i } }
  ok ($dup -gt 0 -and $rd[$dup, 1] -eq '1140815') '重複的退貨單也補上實際日期'
  # 樞紐
  $pt = $wb.Worksheets.Item('進貨樞紐').PivotTables('PT1')
  $items = @(); foreach ($it in $pt.PivotFields('訂單年月').PivotItems()) { $items += [string]$it.Name }
  ok ($items -contains '11409') '樞紐分析已重新整理，看得到 114/09'
  $wb.Close($false)
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($xl); $xl = $null; [GC]::Collect(); [GC]::WaitForPendingFinalizers() }

$rep = Get-ChildItem $FX -Filter '更新報告_*.txt' | Sort-Object LastWriteTime | Select-Object -Last 1
$rt = [IO.File]::ReadAllText($rep.FullName)
ok ($rt.Contains('只有業務員不同、保留總表原本的：1 張單') -and $rt.Contains('改用新資料（業務員保留原本的）：4 張單')) "報告：只有業務員不同 1 張、改用新資料 4 張：$($rep.Name)"
ok ($rt.Contains('單號 1140800005：不同的欄位：數量') -and $rt.Contains('單號 1140800002：不同的欄位：售價') -and $rt.Contains('單號 1140700004：筆數不同')) '報告寫出每張單哪些欄位不同'
ok ($rt.Contains('空白列和公式已清掉') -and $rt.Contains('和 AK 欄的清單一樣')) '報告寫出清掉空白列、對照表改成和 AK 一樣'
ok ($rt.Contains('新增 AF 欄「實際出貨日期」') -and $rt.Contains('新增 AC 欄「實際退貨日期」') -and $rt.Contains('實際日期（AF 欄）')) '報告寫出新增的實際日期欄與筆數'

# 同樣的檔案再跑一次 → 什麼都不會加
Start-Sleep -Seconds 61   # 報告檔名到分鐘，等一分鐘避免同名
$OUT2 = Join-Path $FX 'out2.xlsx'
ok ((RunTool $OUT $OUT2) -eq 0) '用新總表再跑一次同樣的檔案'
$rep2 = Get-ChildItem $FX -Filter '更新報告_*.txt' | Sort-Object LastWriteTime | Select-Object -Last 1
$rt2 = [IO.File]::ReadAllText($rep2.FullName)
ok (([regex]::Matches($rt2, '新增 0 張單、0 筆')).Count -eq 2 -and ([regex]::Matches($rt2, '改用新資料（業務員保留原本的）：0 張單')).Count -eq 2) '再跑一次：進貨、退貨都是新增 0 筆、改用新資料 0 張（不會重複）'
ok (([regex]::Matches($rt2, '總表原有的單補上 0 筆')).Count -eq 2 -and -not $rt2.Contains('新增 AF 欄')) '再跑一次：實際日期欄沿用、不會重複新增，也沒有要補的日期'

# 有開啟密碼的總表：另存後仍有密碼
$OUTPW = Join-Path $FX 'out_pw.xlsx'
ok ((RunTool $MASTER_PW $OUTPW @('-MasterPassword', 'pw1234', '-NoRefresh')) -eq 0) '有開啟密碼的總表也能更新'
$h = [IO.File]::ReadAllBytes($OUTPW)[0..3]
ok ($h[0] -eq 0xD0 -and $h[1] -eq 0xCF -and $h[2] -eq 0x11 -and $h[3] -eq 0xE0) '另存的新總表仍然有開啟密碼'

# 自動找檔案：檔名日期最新的總表優先（不要挑到 cd 副本、Excel 暫存檔、其他 Excel）、最新的 JMSSAL／JMSSBK
$FD = Join-Path $FX 'find'; New-Item -ItemType Directory -Force $FD | Out-Null
$files = [ordered]@{ '00_總表_2026-08-31.xlsx' = '2026-09-03'; '00_總表_2026-08-31cd.xlsx' = '2026-10-21'; '00_總表_2026-10-22.xlsx' = '2026-10-22 09:00'; '~$00_總表_2026-11-01.xlsx' = '2026-11-01'
  'JMSSAL.xlsx' = '2026-10-21'; 'JMSSAL.DBF' = '2026-10-23'; 'JMSSBK.DBF' = '2026-10-20'; '114年退貨率.xlsx' = '2026-10-30' }
foreach ($k in $files.Keys) { $f = Join-Path $FD $k; [IO.File]::WriteAllBytes($f, [byte[]]@()); (Get-Item -LiteralPath $f).LastWriteTime = [datetime]$files[$k] }
function FindOut($shot) { $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', $TOOL, '-FindIn', $FD); if ($shot) { $a += @('-SmokeShot', $shot) }; [string](& powershell @a | Select-String 'FOUND') }
$shot = Join-Path $FD 'confirm.png'
$r = FindOut $shot
ok ($r -match 'master=00_總表_2026-10-22\.xlsx sales=JMSSAL\.DBF returns=JMSSBK\.DBF') "自動找檔案：$r"
ok (Test-Path $shot) "確認視窗可以正常顯示（截圖：$shot）"
Remove-Item -LiteralPath (Join-Path $FD '00_總表_2026-10-22.xlsx')
$r = FindOut $null
ok ($r -match 'master=00_總表_2026-08-31\.xlsx ') "同一天的總表，挑「總表_日期」那份、不挑 cd 副本：$r"

Write-Host '全部通過'
