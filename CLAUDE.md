# 說說板 (saysay)

> 本機資料夾名稱 para_talk 只是開發者自己辨識用；對外名稱一律用「說說板 / saysay」，不要在使用者看得到的地方出現 para 字樣。

## 背景
為一位因車禍頸髓 C3–C7 受傷、氣切的長輩做的溝通輔助網頁。他注音不好，所以以「片語＋圖示＋語音」為主，不做打字輸入。
目前用發聲閥說話需要呼吸治療師在場；家裡已有 iPad。目標裝置：iPad Safari（橫向／直向都要能用），可能搭配 iPadOS 內建眼動追蹤或照顧者掃描。

## 設計原則
- 格子越大越好、文字越少越好；不能需要捲動（用分頁）。
- 設定要「按住一秒」才開，避免眼控 dwell 或誤觸進入。
- 所有資料存在裝置本機：localStorage（片語、設定）、IndexedDB（錄音，存 ArrayBuffer + type）。不上傳任何東西。
- 錄音要在啟動時預載成 object URL，播放才會留在點擊手勢內（iOS 限制）。
- 不使用外部 CDN，確保離線可用；service worker 用 network-first + `cache: 'no-cache'`。
- 改了 sw.js 快取清單時要把 `CACHE` 版本號加一。

## 結構
純靜態：index.html / style.css / app.js / data.js / sw.js / manifest.webmanifest / icons/。
本機測試：`python -m http.server 8765`（.claude/launch.json 有設定）。

## 照顧者文件不上網站
床邊小卡、使用說明等「以第三人稱描述病人」的內容（例如「他不能說話」「不要當他不在場」）**不能放在網站或 App 裡**，因為病人本人會用這個 App，看到會難受。
這類文件放在 `handouts/`（父 repo 已 gitignore；它本身是獨立 repo bobe2510/saysay-guide，網址 https://bobe2510.github.io/saysay-guide/，設 noindex）。App 內絕對不要連到它。App 內所有文字都要以病人本人第一人稱或中性語氣為主。

## 已知狀況
- iPad 沒聲音、聲音檢查顯示「電腦語音功能：沒有」＋提示音 NotSupportedError → 裝置開了**鎖定模式**（會關掉 speechSynthesis 並限制媒體播放，所有 iOS 瀏覽器都受影響）。解法：Safari 網站設定對本站關閉鎖定模式。2026-11 實際遇過並確認。
