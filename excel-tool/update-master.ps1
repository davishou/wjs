# 總表更新工具：把 JMSSAL（進貨）、JMSSBK（退貨）的新資料併進總表。
# 用 Excel 本身來改，樞紐分析、Power Pivot、表格都不會被破壞；原本的總表不會被修改，結果另存新檔。
#
# 一般使用：雙擊「更新總表.cmd」，依序選檔案即可。
# 測試用（不跳視窗）：update-master.ps1 -NoUI -Master 總表.xlsx -Sales JMSSAL.dbf -Returns JMSSBK.dbf -Out 新總表.xlsx
param(
  [string]$Master, [string]$Sales, [string]$Returns, [string]$Out,
  [string]$MasterPassword,   # 只給自動測試用；平常由 Excel 自己跳出密碼視窗
  [switch]$NoUI, [switch]$NoRefresh
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
Add-Type -AssemblyName System.Windows.Forms
$INV = [Globalization.CultureInfo]::InvariantCulture
$xlUp = -4162; $xlManual = -4135

# 原始資料的欄位（依位置對應總表 A 欄起；最後的 DELIVDATE 不放進總表）
$KINDS = [ordered]@{
  sales = @{ Label = '進貨'; Sheet = '原始進貨表'; Key = '出貨單號'; NRaw = 22; Cust = 19; Name = 20; Sku = 4; Color = 5; Cat = 3
    Head = @('DELIVNO', 'DELIVORD', 'CODE', 'STYLE', 'COLO', 'UNIT_NM', 'TRAN_RATE', 'PRICE', 'OUTPRICE', 'PRC', 'OUTQTY', 'UNIT', 'SALEGET', 'RECEIVE', 'CUT', 'TOTBKPAY', 'PAY', 'BUY', 'ID', 'SNAME', 'AMOUNT', 'EMPNO') }
  returns = @{ Label = '退貨'; Sheet = '原始退貨表'; Key = '退貨單號'; NRaw = 21; Cust = 18; Name = 19; Sku = 5; Color = 6; Cat = 4
    Head = @('DELIVNO', 'SERIES', 'DELIVORD', 'CODE', 'STYLE', 'COLO', 'UNIT_NM', 'TRAN_RATE', 'PRICE', 'OUTPRICE', 'OUTQTY', 'UNIT', 'SALEGET', 'RECEIVE', 'TOTBKPAY', 'PAY', 'HOLD', 'ID', 'SNAME', 'AMOUNT', 'EMPNO') }
}

function Say([string]$m) { Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m) }
function Rng($ws, $r1, $c1, $r2, $c2) { , $ws.Range($ws.Cells.Item($r1, $c1), $ws.Cells.Item($r2, $c2)) }   # 前面的逗號：不要讓 PowerShell 把範圍拆成一格一格
# 讀範圍的值，一律回傳 1 起算的二維陣列（單一格時 Excel 會回傳單一值）
function Get-Values($range) {
  $v = $range.Value2
  if ($v -is [Array]) { return , $v }
  $a = [Array]::CreateInstance([object], [int[]]@(1, 1), [int[]]@(1, 1)); $a.SetValue($v, 1, 1)
  return , $a
}
function Txt($v) { if ($null -eq $v) { '' } elseif ($v -is [double]) { $v.ToString($INV) } else { [string]$v } }
# 單號：去掉前後空白；若被存成數字也轉回文字
function Key($v) { if ($null -eq $v) { '' } elseif ($v -is [double]) { $v.ToString('0', $INV) } else { ([string]$v).Trim() } }
# 比對重複用：空白和 0 視為相同、文字的 "1" 和數字 1 視為相同
function Norm($v) {
  if ($null -eq $v) { return '' }
  if ($v -is [bool]) { if ($v) { return 'T' } else { return 'F' } }
  if ($v -is [double]) { $d = $v }
  else {
    $s = ([string]$v).Trim()
    if ($s -eq '') { return '' }
    $d = 0.0
    if (-not ($s -match '^-?\d+(\.\d+)?$' -and [double]::TryParse($s, [Globalization.NumberStyles]::Float, $INV, [ref]$d))) { return $s }
  }
  if ($d -eq 0) { return '' }
  return [math]::Round($d, 6).ToString('R', $INV)
}
function SigRow($row, $n) { $p = New-Object string[] $n; for ($c = 0; $c -lt $n; $c++) { $p[$c] = Norm $row[$c] }; [string]::Join([char]31, $p) }
function Sig2D($v, $i, $n) { $p = New-Object string[] $n; for ($c = 1; $c -le $n; $c++) { $p[$c - 1] = Norm $v[$i, $c] }; [string]::Join([char]31, $p) }
function Ym([string]$k) { $y = 0; if ($k.Length -ge 5 -and [int]::TryParse($k.Substring(0, 5), [ref]$y)) { $y } else { 0 } }
function NextYm([int]$ym) { $y = [math]::Floor($ym / 100); $m = $ym % 100 + 1; if ($m -gt 12) { $y++; $m = 1 }; [int]($y * 100 + $m) }
function Region([string]$cust) {
  $c = if ($cust.Length) { $cust.Substring(0, 1) } else { '' }
  switch ($c) { { $_ -in '1', '2' } { return '大台北地區' } '3' { return '桃竹苗' } { $_ -in '4', '5' } { return '中部' } { $_ -in '6', '7', '8' } { return '南部' } default { return '其他地區' } }
}
function Simplify([string]$s) { $p = $s.Length; foreach ($ch in '-', '/') { $i = $s.IndexOf($ch); if ($i -ge 0 -and $i -lt $p) { $p = $i } }; $s.Substring(0, $p) }
# 傳給 Excel 的值要是原本的數字／文字，不能包著 PowerShell 的外殼（否則 Excel 會出錯）
function Unwrap($v) { if ($null -eq $v) { $null } else { $v.psobject.BaseObject } }
function Get-R1C1($cell) { try { $cell.Formula2R1C1 } catch { $cell.FormulaR1C1 } }
function Set-R1C1($range, $f) { try { $range.Formula2R1C1 = $f } catch { $range.FormulaR1C1 = $f } }

# ---------- 讀新資料（.DBF 或 Excel 都可以，用 Excel 開啟）----------
function Read-Source($xl, [string]$path, $kind) {
  $leaf = Split-Path $path -Leaf
  Say "讀取 $leaf …"
  $wb = $xl.Workbooks.Open($path, 0, $true)
  try {
    $ws = $wb.Worksheets.Item(1); $n = $kind.NRaw
    $head = Get-Values (Rng $ws 1 1 1 $n)
    for ($c = 1; $c -le $n; $c++) {
      $h = (Txt $head[1, $c]).Trim().ToUpper()
      if ($h -ne $kind.Head[$c - 1]) { throw "「$leaf」看起來不是$($kind.Label)資料：第 $c 欄應該是 $($kind.Head[$c - 1])，實際是「$h」。請確認選對檔案（進貨是 JMSSAL、退貨是 JMSSBK）。" }
    }
    $rows = New-Object 'System.Collections.Generic.List[object]'
    $last = Last-Row $ws 1
    if ($last -ge 2) {
      $v = Get-Values (Rng $ws 2 1 $last $n)
      for ($i = 1; $i -le $last - 1; $i++) {
        if ((Key $v[$i, 1]) -eq '') { continue }
        $row = New-Object object[] $n
        for ($c = 1; $c -le $n; $c++) { $row[$c - 1] = $v[$i, $c] }
        $rows.Add($row)
      }
    }
    Say "  $leaf：$($rows.Count) 筆"
    return , $rows
  } finally { $wb.Close($false) }
}

# 總表 A1 開始的主表格（原始進貨表是 Excel 表格；原始退貨表是一般範圍）
# 某一欄最後一個有內容的列。不用 End(xlUp)：表格下面有空白列時，它會停在表格最後一列
function Last-Row($ws, [int]$col) { $f = $ws.Columns.Item($col).Find('*', $ws.Cells.Item(1, $col), -4123, 2, 1, 2); if ($f) { $f.Row } else { 1 } }
function Get-MainTable($ws) { foreach ($lo in $ws.ListObjects) { if ($lo.Range.Row -eq 1 -and $lo.Range.Column -eq 1) { return $lo } }; $null }

# 原始資料右邊的公式欄（例如進貨 W～AE、退貨 V～AB）：表頭有字、第 2 列是公式
function Get-FormulaCols($ws, $n) {
  $out = New-Object 'System.Collections.Generic.List[object]'
  for ($c = $n + 1; $c -le $n + 40; $c++) {
    if ((Txt $ws.Cells.Item(1, $c).Value2) -eq '') { break }
    $cell = $ws.Cells.Item(2, $c)
    if (-not $cell.HasFormula) { break }
    $out.Add([pscustomobject]@{ Col = $c; R1C1 = (Get-R1C1 $cell) })
  }
  return , $out
}

# 每一欄現有資料的型態（數字／文字／是非），新資料照著存，才不會「1」和 1 混在一起
function Get-ColTypes($ws, $last, $n) {
  $from = [math]::Max(2, $last - 300)
  $v = Get-Values (Rng $ws $from 1 $last $n)
  $types = New-Object string[] ($n + 1); $textFmt = New-Object bool[] ($n + 1)
  for ($c = 1; $c -le $n; $c++) {
    $types[$c] = ''
    for ($i = $last - $from + 1; $i -ge 1; $i--) {
      $x = $v[$i, $c]
      if ($null -ne $x) { $types[$c] = if ($x -is [double]) { 'num' } elseif ($x -is [bool]) { 'bool' } else { 'text' }; break }
    }
    $textFmt[$c] = ([string]$ws.Cells.Item($last, $c).NumberFormat) -eq '@'
  }
  return @{ Types = $types; TextFmt = $textFmt }
}
function ToCell($v, [string]$type, [bool]$textFmt) {
  if ($null -eq $v) { return $null }
  if ($v -is [string]) {
    if ($v.Trim() -eq '') { return $null }
    if ($type -eq 'num') { $d = 0.0; if ([double]::TryParse($v.Trim(), [Globalization.NumberStyles]::Float, $INV, [ref]$d)) { return $d } }
    if ($type -eq 'bool') { switch ($v.Trim().ToUpper()) { { $_ -in 'T', 'Y', 'TRUE' } { return $true } { $_ -in 'F', 'N', 'FALSE' } { return $false } } }
    if ($textFmt) { return $v }
    return "'" + $v   # 開頭加 ' 讓 Excel 當成文字存（不會把單號變成數字）
  }
  if ($v -is [double] -and $type -eq 'text') { $s = $v.ToString($INV); if ($textFmt) { return $s } else { return "'" + $s } }
  return $v
}

# ---------- 把一種資料（進貨或退貨）併進總表 ----------
function Merge-Kind($wb, $kind, $src) {
  $ws = $null; foreach ($s in $wb.Worksheets) { if ($s.Name -eq $kind.Sheet) { $ws = $s } }
  if (-not $ws) { throw "總表裡找不到「$($kind.Sheet)」工作表，請確認選的是總表。" }
  if ((Txt $ws.Cells.Item(1, 1).Value2).Trim() -ne $kind.Key) { throw "「$($kind.Sheet)」的 A1 不是「$($kind.Key)」，請確認選的是總表。" }
  $n = $kind.NRaw
  $last = Last-Row $ws 1
  if ($last -lt 2) { throw "「$($kind.Sheet)」裡沒有資料，請確認選的是總表。" }
  Say "[$($kind.Label)] 總表目前有 $($last - 1) 筆，檢查重複…"

  # 新資料依單號分組（同一張單的列保持原本順序）
  $groups = New-Object 'System.Collections.Generic.Dictionary[string,System.Collections.Generic.List[object]]'
  foreach ($row in $src) {
    $k = Key $row[0]
    if (-not $groups.ContainsKey($k)) { $groups[$k] = New-Object 'System.Collections.Generic.List[object]' }
    $groups[$k].Add($row)
  }
  # 找出總表裡已經有的單號
  $a = Get-Values (Rng $ws 2 1 $last 1)
  $hits = New-Object 'System.Collections.Generic.List[int]'
  $exMax = ''
  for ($i = 1; $i -le $last - 1; $i++) {
    $k = Key $a[$i, 1]
    if ([string]::CompareOrdinal($k, $exMax) -gt 0) { $exMax = $k }
    if ($groups.ContainsKey($k)) { $hits.Add($i + 1) }
  }
  $a = $null
  # 讀出這些單號在總表裡的內容（相鄰的列一次讀）
  $exSig = New-Object 'System.Collections.Generic.Dictionary[string,System.Collections.Generic.List[string]]'
  $j = 0
  while ($j -lt $hits.Count) {
    $s = $hits[$j]; $e = $s
    while ($j + 1 -lt $hits.Count -and $hits[$j + 1] - $e -le 50) { $j++; $e = $hits[$j] }
    $j++
    $v = Get-Values (Rng $ws $s 1 $e $n)
    for ($i = 1; $i -le $e - $s + 1; $i++) {
      $k = Key $v[$i, 1]
      if (-not $groups.ContainsKey($k)) { continue }
      if (-not $exSig.ContainsKey($k)) { $exSig[$k] = New-Object 'System.Collections.Generic.List[string]' }
      $exSig[$k].Add((Sig2D $v $i $n))
    }
  }
  # 逐張單比對：總表沒有 → 新增；整張每一列每一格都一樣 → 重複，跳過；不一樣 → 不加入，列在報告裡
  $keys = [string[]]@($groups.Keys); [Array]::Sort($keys, [StringComparer]::Ordinal)
  $add = New-Object 'System.Collections.Generic.List[object]'
  $dup = 0; $dupRows = 0; $addOrders = 0
  $conf = New-Object 'System.Collections.Generic.List[object]'
  foreach ($k in $keys) {
    $rows = $groups[$k]
    if (-not $exSig.ContainsKey($k)) { foreach ($r in $rows) { $add.Add($r) }; $addOrders++; continue }
    $ns = New-Object string[] $rows.Count; for ($i = 0; $i -lt $rows.Count; $i++) { $ns[$i] = SigRow $rows[$i] $n }
    $es = $exSig[$k].ToArray()
    [Array]::Sort($ns, [StringComparer]::Ordinal); [Array]::Sort($es, [StringComparer]::Ordinal)
    if ([string]::Join("`n", $ns) -ceq [string]::Join("`n", $es)) { $dup++; $dupRows += $rows.Count; continue }
    # 列出只在一邊出現的列
    $cnt = @{}; foreach ($x in $es) { $cnt[$x] = 1 + [int]$cnt[$x] }
    $onlyNew = New-Object 'System.Collections.Generic.List[string]'
    foreach ($x in $ns) { if ([int]$cnt[$x] -gt 0) { $cnt[$x]-- } else { $onlyNew.Add($x) } }
    $onlyEx = New-Object 'System.Collections.Generic.List[string]'
    foreach ($x in $cnt.Keys) { for ($q = 0; $q -lt $cnt[$x]; $q++) { $onlyEx.Add($x) } }
    $conf.Add([pscustomobject]@{ Key = $k; ExRows = $es.Count; NewRows = $ns.Count; OnlyEx = $onlyEx; OnlyNew = $onlyNew })
  }
  Say "[$($kind.Label)] 新增 $addOrders 張單（$($add.Count) 筆）、重複跳過 $dup 張單（$dupRows 筆）、內容不一樣 $($conf.Count) 張單"

  $fcols = Get-FormulaCols $ws $n
  $lastCol = if ($fcols.Count) { $fcols[$fcols.Count - 1].Col } else { $n }
  $start = $last + 1; $end = $last + $add.Count; $sorted = $false
  if ($add.Count) {
    $ti = Get-ColTypes $ws $last $n
    $arr = New-Object 'object[,]' $add.Count, $n
    for ($r = 0; $r -lt $add.Count; $r++) { $row = $add[$r]; for ($c = 0; $c -lt $n; $c++) { $arr[$r, $c] = Unwrap (ToCell $row[$c] $ti.Types[$c + 1] $ti.TextFmt[$c + 1]) } }
    $lo = Get-MainTable $ws
    if ($lo) {
      $loEnd = $lo.Range.Row + $lo.Range.Rows.Count - 1
      if ($loEnd -lt $end) { [void]$lo.Resize((Rng $ws 1 1 $end $lo.Range.Columns.Count)) }
    }
    for ($c = 1; $c -le $lastCol; $c++) { try { (Rng $ws $start $c $end $c).NumberFormat = $ws.Cells.Item($last, $c).NumberFormat } catch {} }
    Say "[$($kind.Label)] 寫入第 $start ～ $end 列，補上公式…"
    (Rng $ws $start 1 $end $n).Value2 = $arr
    foreach ($f in $fcols) { Set-R1C1 (Rng $ws $start $f.Col $end $f.Col) $f.R1C1 }
    # 有比目前最後一張還早的單號（例如補來的 3 月退貨）→ 整張表依單號重新排序
    if ([string]::CompareOrdinal((Key $add[0][0]), $exMax) -le 0) {
      Say "[$($kind.Label)] 有比較早的單號，整張表依單號重新排序…"
      if ($lo) {
        $st = $lo.Sort; $st.SortFields.Clear(); [void]$st.SortFields.Add($lo.ListColumns.Item(1).DataBodyRange, 0, 1); $st.Header = 1; $st.MatchCase = $false; [void]$st.Apply()
      } else {
        $st = $ws.Sort; $st.SortFields.Clear(); [void]$st.SortFields.Add((Rng $ws 2 1 $end 1), 0, 1); $st.SetRange((Rng $ws 1 1 $end $lastCol)); $st.Header = 1; $st.MatchCase = $false; [void]$st.Apply()
      }
      $sorted = $true
    }
  }
  $newMax = if ($add.Count) { Key $add[$add.Count - 1][0] } else { '' }
  if ([string]::CompareOrdinal($newMax, $exMax) -lt 0) { $newMax = $exMax }
  return [pscustomobject]@{
    Kind = $kind; Ws = $ws; Before = $last - 1; NewLast = [math]::Max($last, $end); Start = $start; End = $end; Sorted = $sorted
    Added = $add; AddOrders = $addOrders; Dup = $dup; DupRows = $dupRows; Conf = $conf; FCols = $fcols; MaxYm = (Ym $newMax)
  }
}

# ---------- BB～BJ 對照表（給 Power Pivot 用）：把新出現的客戶、商品、年月…加進去 ----------
function Update-Dims($ws, $results) {
  $derive = @{
    '代號+客戶' = { param($r, $k) (Txt $r[$k.Cust - 1]) + (Txt $r[$k.Name - 1]) }
    '商品代號' = { param($r, $k) Txt $r[$k.Sku - 1] }
    '訂單年份' = { param($r, $k) $o = Key $r[0]; if ($o.Length -ge 3) { $o.Substring(0, 3) } else { '' } }
    '訂單年月' = { param($r, $k) $o = Key $r[0]; if ($o.Length -ge 5) { $o.Substring(0, 5) } else { '' } }
    '訂單月份' = { param($r, $k) $o = Key $r[0]; if ($o.Length -ge 5) { $o.Substring(3, 2) } else { '' } }
    '區域' = { param($r, $k) Region (Txt $r[$k.Cust - 1]) }
    '顏色代號' = { param($r, $k) Txt $r[$k.Color - 1] }
    '商品代碼(簡化)' = { param($r, $k) Simplify (Txt $r[$k.Sku - 1]) }
    '商品類別' = { param($r, $k) Txt $r[$k.Cat - 1] }
  }
  $log = New-Object 'System.Collections.Generic.List[string]'
  foreach ($lo in @($ws.ListObjects)) {
    if ($lo.Range.Column -eq 1 -or $lo.Range.Columns.Count -ne 1) { continue }
    $h = (Txt $lo.Range.Cells.Item(1, 1).Value2).Trim()
    if (-not $derive.ContainsKey($h)) { continue }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    $isNum = $false; $found = $false
    if ($lo.DataBodyRange) {
      $v = Get-Values $lo.DataBodyRange
      for ($i = 1; $i -le $v.GetLength(0); $i++) {
        $x = $v[$i, 1]; if ($null -eq $x) { continue }
        if (-not $found) { $isNum = $x -is [double]; $found = $true }
        [void]$seen.Add((Txt $x).Trim())
      }
    }
    $new = New-Object 'System.Collections.Generic.List[string]'
    foreach ($res in $results) {
      foreach ($r in $res.Added) {
        $val = ([string](& $derive[$h] $r $res.Kind)).Trim()
        if ($val -ne '' -and $seen.Add($val)) { $new.Add($val) }
      }
    }
    if (-not $new.Count) { continue }
    $top = $lo.Range.Row; $col = $lo.Range.Column; $r0 = $top + $lo.Range.Rows.Count
    $target = Rng $ws $r0 $col ($r0 + $new.Count - 1) $col
    if ($ws.Application.WorksheetFunction.CountA($target) -gt 0) { $log.Add("對照表「$h」下方的格子有其他內容，沒有自動加入：$([string]::Join('、', $new))"); continue }
    $textFmt = ([string]$ws.Cells.Item($r0 - 1, $col).NumberFormat) -eq '@'
    $arr = New-Object 'object[,]' $new.Count, 1
    for ($i = 0; $i -lt $new.Count; $i++) {
      $d = 0.0
      $arr[$i, 0] = Unwrap $(if ($isNum -and [double]::TryParse($new[$i], [Globalization.NumberStyles]::Float, $INV, [ref]$d)) { $d } elseif ($textFmt) { $new[$i] } else { "'" + $new[$i] })
    }
    [void]$lo.Resize((Rng $ws $top $col ($r0 + $new.Count - 1) $col))
    $target.Value2 = $arr
    $log.Add("對照表「$h」加入 $($new.Count) 個：$([string]::Join('、', ($new | Select-Object -First 20)))$(if ($new.Count -gt 20) { '…' })")
  }
  return , $log
}

# ---------- AK、AT、BM 這類 UNIQUE 清單變長時，右邊的公式（AL～AP 等）跟著往下補 ----------
function Extend-SpillFormulas($ws) {
  $log = New-Object 'System.Collections.Generic.List[string]'
  $maxCol = $ws.UsedRange.Column + $ws.UsedRange.Columns.Count - 1
  for ($c = 1; $c -le $maxCol; $c++) {
    $cell = $ws.Cells.Item(1, $c)
    if (-not $cell.HasFormula) { continue }
    if ((Get-R1C1 $cell) -notmatch 'UNIQUE\(') { continue }
    [void]$cell.Calculate()
    if (-not $cell.HasSpill) { continue }
    $sp = $cell.SpillingToRange
    $spEnd = $sp.Row + $sp.Rows.Count - 1
    $d = $c + 1
    while ($ws.Cells.Item(2, $d).HasFormula) {
      $cur = Last-Row $ws $d
      if ($spEnd -gt $cur) {
        Set-R1C1 (Rng $ws ($cur + 1) $d $spEnd $d) (Get-R1C1 $ws.Cells.Item(2, $d))
        $log.Add("$($ws.Cells.Item(1, $d).Address($false, $false) -replace '\d', '') 欄公式補到第 $spEnd 列（「$((Txt $cell.Value2))」清單變長）")
      }
      $d++
    }
  }
  return , $log
}

function Pick-Open($owner, [string]$title, [string]$filter, [string]$dir) {
  $d = New-Object System.Windows.Forms.OpenFileDialog
  $d.Title = $title; $d.Filter = $filter; if ($dir) { $d.InitialDirectory = $dir }
  if ($d.ShowDialog($owner) -eq 'OK') { $d.FileName } else { '' }
}
function Show-Msg($owner, [string]$text, [string]$icon = 'Information', [string]$buttons = 'OK') {
  [System.Windows.Forms.MessageBox]::Show($owner, $text, '總表更新工具', $buttons, $icon)
}

# =====================================================================
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
$xl = $null; $wb = $null; $exit = 0
try {
  Write-Host '================ 總表更新工具 ================'
  Write-Host '把 JMSSAL（進貨）、JMSSBK（退貨）的新資料接到總表下方：'
  Write-Host '・整張單號的每一列、每一格都一樣 → 視為重複，跳過'
  Write-Host '・單號已經有、但內容不一樣 → 不加入，列在報告裡讓你自己看'
  Write-Host '・公式自動往下補，AR2 自動填成最新資料的下一個月'
  Write-Host '・原本的總表不會被修改，最後會另存成新檔'
  Write-Host ''
  if (-not $NoUI) {
    $Master = Pick-Open $owner '1/3 選擇總表 Excel' 'Excel 檔案|*.xlsx;*.xlsm' ([Environment]::GetFolderPath('Desktop'))
    if (-not $Master) { Say '沒有選總表，結束。'; return }
    $dir = Split-Path $Master
    $Sales = Pick-Open $owner '2/3 選擇進貨資料 JMSSAL（這次沒有就按「取消」）' '進貨資料|*.dbf;*.xlsx;*.xls|所有檔案|*.*' $dir
    $Returns = Pick-Open $owner '3/3 選擇退貨資料 JMSSBK（這次沒有就按「取消」）' '退貨資料|*.dbf;*.xlsx;*.xls|所有檔案|*.*' $dir
  }
  if (-not $Sales -and -not $Returns) { Say '沒有選任何新資料，結束。'; return }
  foreach ($p in @($Master, $Sales, $Returns)) { if ($p -and -not (Test-Path -LiteralPath $p)) { throw "找不到檔案：$p" } }
  $Master = (Resolve-Path -LiteralPath $Master).Path
  Say "總表：$Master"

  $xl = New-Object -ComObject Excel.Application
  $xl.DisplayAlerts = $false; $xl.AskToUpdateLinks = $false
  $xl.Visible = -not $NoUI   # 總表有密碼時，讓 Excel 自己跳出輸入密碼的視窗
  $src = [ordered]@{}
  if ($Sales) { $src.sales = Read-Source $xl (Resolve-Path -LiteralPath $Sales).Path $KINDS.sales }
  if ($Returns) { $src.returns = Read-Source $xl (Resolve-Path -LiteralPath $Returns).Path $KINDS.returns }

  Say '開啟總表（檔案很大時要等 1～2 分鐘）…'
  try {
    $wb = if ($MasterPassword) { $xl.Workbooks.Open($Master, 0, $true, [Type]::Missing, $MasterPassword) } else { $xl.Workbooks.Open($Master, 0, $true) }
  } catch { throw "總表沒有打開（密碼不對或按了取消？）：$($_.Exception.Message)" }
  $xl.Visible = $false
  $origCalc = $xl.Calculation
  $xl.Calculation = $xlManual; $xl.ScreenUpdating = $false; $xl.EnableEvents = $false

  $results = New-Object 'System.Collections.Generic.List[object]'
  foreach ($k in $src.Keys) { $results.Add((Merge-Kind $wb $KINDS[$k] $src[$k])) }
  $wsSales = $null; foreach ($s in $wb.Worksheets) { if ($s.Name -eq '原始進貨表') { $wsSales = $s } }

  $extra = New-Object 'System.Collections.Generic.List[string]'
  $totalAdded = 0; $totalConf = 0
  foreach ($res in $results) { $totalAdded += $res.Added.Count; $totalConf += $res.Conf.Count }
  if ($totalAdded -gt 0) {
    Say '更新 BB～BJ 對照表…'
    foreach ($x in (Update-Dims $wsSales $results)) { $extra.Add($x) }
    # 先算好新資料的公式欄，UNIQUE 清單才會是最新的
    foreach ($res in $results) {
      if (-not $res.Added.Count -or -not $res.FCols.Count) { continue }
      $c1 = $res.FCols[0].Col; $c2 = $res.FCols[$res.FCols.Count - 1].Col
      if ($res.Sorted) { [void](Rng $res.Ws 2 $c1 $res.NewLast $c2).Calculate() } else { [void](Rng $res.Ws $res.Start $c1 $res.End $c2).Calculate() }
    }
    Say '補上 AL～AP、AU～AX、BN～BR 等公式…'
    foreach ($x in (Extend-SpillFormulas $wsSales)) { $extra.Add($x) }
  }
  # AR2：最新資料的下一個月
  $ymMax = 0; foreach ($res in $results) { if ($res.Kind.Label -eq '進貨' -and $res.MaxYm -gt $ymMax) { $ymMax = $res.MaxYm } }
  if (-not $ymMax) { $ymMax = (Ym (Key (Get-Values (Rng $wsSales 2 1 2 1))[1, 1])) }
  if ($ymMax) {
    $ar = $wsSales.Range('AR2'); $old = $ar.Value2; $newYm = NextYm $ymMax
    if ($null -eq $old -or ($old -is [double] -and $old -ge 10000 -and $old -lt 100000)) {
      $ar.Value2 = [double]$newYm
      $extra.Add("AR2：$(Txt $old) → $newYm（資料到 $ymMax，填下一個月）")
    } else { $extra.Add("AR2 目前是「$(Txt $old)」，看起來不是年月，沒有自動修改，請自己確認。") }
  }

  Say '重新計算公式（資料多時要等幾分鐘）…'
  $xl.Calculate()
  if (-not $NoRefresh) {
    Say '更新樞紐分析和 Power Pivot（資料多時要等幾分鐘）…'
    try { [void]$wb.RefreshAll(); $xl.CalculateUntilAsyncQueriesDone(); $xl.Calculate() }
    catch { $extra.Add("樞紐分析沒有自動更新成功（$($_.Exception.Message)），打開新檔後請按「資料」→「全部重新整理」。") }
  }
  $xl.Calculation = $origCalc

  # ---------- 報告 ----------
  $L = New-Object 'System.Collections.Generic.List[string]'
  $L.Add("總表更新報告　$(Get-Date -Format 'yyyy-MM-dd HH:mm')"); $L.Add("總表：$Master")
  foreach ($res in $results) {
    $k = $res.Kind
    $L.Add(''); $L.Add("【$($k.Label)】$(Split-Path ($(if ($k.Label -eq '進貨') { $Sales } else { $Returns })) -Leaf)")
    $L.Add("  原本 $($res.Before) 筆 → 現在 $($res.Before + $res.Added.Count) 筆")
    $L.Add("  新增 $($res.AddOrders) 張單、$($res.Added.Count) 筆")
    $L.Add("  重複跳過 $($res.Dup) 張單、$($res.DupRows) 筆")
    if ($res.Added.Count) { $L.Add($(if ($res.Sorted) { '  有比較早的單號，已整張依單號重新排序' } else { '  新資料都接在最後面，原本的順序沒有動' })) }
    if ($res.Conf.Count) {
      $L.Add("  ※ 單號已經有、但內容不一樣，沒有加入的：$($res.Conf.Count) 張（請自己確認）")
      foreach ($cf in $res.Conf) {
        $L.Add("    單號 $($cf.Key)：總表有 $($cf.ExRows) 筆，新資料有 $($cf.NewRows) 筆")
        foreach ($x in $cf.OnlyEx) { $L.Add('      只在總表：　' + ($x -replace [char]31, ' | ')) }
        foreach ($x in $cf.OnlyNew) { $L.Add('      只在新資料：' + ($x -replace [char]31, ' | ')) }
      }
    }
  }
  if ($extra.Count) { $L.Add(''); $L.Add('【其他】'); foreach ($x in $extra) { $L.Add('  ' + $x) } }
  Write-Host ''; foreach ($x in $L) { Write-Host $x }; Write-Host ''

  if (-not $totalAdded -and -not $NoUI) {
    Show-Msg $owner '沒有需要新增的資料（全部都是重複或內容不一樣的單號），總表不用另存。詳細內容請看黑色視窗。' | Out-Null
    return
  }
  # ---------- 另存新檔 ----------
  if (-not $NoUI) {
    $msg = "新增 $totalAdded 筆。" + $(if ($totalConf) { "`n有 $totalConf 張單號內容不一樣，沒有加入，會寫在報告裡。" } else { '' }) + "`n`n接下來請選擇要存成的新檔名（原本的總表不會被改動）。"
    Show-Msg $owner $msg | Out-Null
    $d = New-Object System.Windows.Forms.SaveFileDialog
    $d.Title = '另存新的總表'; $d.Filter = 'Excel 檔案|*' + [IO.Path]::GetExtension($Master)
    $d.InitialDirectory = Split-Path $Master
    $d.FileName = "00_總表_$(Get-Date -Format 'yyyy-MM-dd')" + [IO.Path]::GetExtension($Master)
    if ($d.ShowDialog($owner) -ne 'OK') { Say '沒有存檔，這次的更新放棄了（原本的總表沒有改動）。'; return }
    $Out = $d.FileName
  }
  if (-not $Out) { throw '沒有指定要存成的新檔名' }
  $Out = [IO.Path]::GetFullPath($Out)
  if ($Out -ieq $Master) { throw '新檔名不能和原本的總表一樣，請換一個名字（保留原檔當備份）。' }
  Say "存檔：$Out …"
  $fmt = if ($Out -match '\.xlsm$') { 52 } else { 51 }
  $xl.ScreenUpdating = $true; $xl.EnableEvents = $true
  $wb.SaveAs($Out, $fmt)
  $rep = Join-Path (Split-Path $Out) ("更新報告_$(Get-Date -Format 'yyyyMMdd_HHmm').txt")
  [IO.File]::WriteAllLines($rep, $L, (New-Object Text.UTF8Encoding($true)))
  Say "完成！報告：$rep"
  if (-not $NoUI) { Show-Msg $owner "完成！`n`n新的總表：$Out`n報告：$rep" | Out-Null }
} catch {
  $exit = 1
  Say ('發生錯誤：' + $_.Exception.Message)
  if (-not $NoUI) { Show-Msg $owner ("發生錯誤，這次的更新沒有存檔（原本的總表沒有改動）：`n`n" + $_.Exception.Message) 'Error' | Out-Null }
} finally {
  if ($wb) { try { $wb.Close($false) } catch {} }
  if ($xl) { try { $xl.Quit() } catch {}; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($xl) }
  $wb = $null; $xl = $null; $wsSales = $null; $results = $null
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
exit $exit
