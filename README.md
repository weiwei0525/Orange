# 有田有米・有園有果 椪柑訂購網站

純靜態網站（Bootstrap 5 + jQuery），放在 GitHub Pages：https://weiwei0525.github.io/Orange/

接單有兩種模式：

| | 訂單後台（建議） | Google 表單（舊做法） |
|---|---|---|
| 怎麼開啟 | `config.ini` 的 `[api] url` 填 Apps Script 網址 | `[api] url` 留空 |
| 商品／庫存在哪改 | Google 試算表「商品」分頁（手機也能改） | `config.ini` |
| 自動扣庫存、防超賣 | ✅ | ❌ |
| 寄確認信給客人、通知農婦 | ✅ | ❌ |

---

## 訂單後台設定（Google 試算表 + Apps Script）

只要做一次，大約 10 分鐘。請用**要收訂單通知的那個 Google 帳號**操作。

### 1. 建立試算表、貼上程式
1. 開 [Google 試算表](https://sheets.new) 新增一份空白試算表，命名「橘子訂單」。
2. 上方選單 **擴充功能 → Apps Script**。
3. 把編輯器裡原本的內容全部刪掉，貼上本專案 [`apps-script/Code.gs`](apps-script/Code.gs) 的全部內容，按 💾 儲存。

### 2. 初始化
1. 上方函式下拉選單選 **`setup`** → 按 **▶ 執行**。
2. 跳出「需要授權」→ 選你的帳號 →「進階」→「前往（不安全）」→「允許」。
   （這是你自己寫的程式，Google 都會這樣提示。需要的權限是：讀寫這份試算表、用你的 Gmail 寄信。）
3. 回到試算表，會多出 **商品、訂單、匯款通知、設定** 四個分頁。

### 3. 部署成網址
1. Apps Script 右上 **部署 → 新增部署作業**。
2. 齒輪 ⚙ 選 **網頁應用程式**。
3. 「執行身分」選 **我**；「誰可以存取」選 **所有人**。
4. 按「部署」，複製 **網頁應用程式網址**（`https://script.google.com/macros/s/……/exec`）。

### 4. 接上網站
把網址填進 `config.ini`：
```ini
[api]
url = https://script.google.com/macros/s/……/exec
```
推上 GitHub 後，網站就改從試算表讀取商品與庫存。

### 之後的日常
| 想做的事 | 在試算表哪裡改 |
|---|---|
| 改總箱數（補貨） | 「商品」分頁的 **總箱數**。剩餘箱數會自動算 |
| 下架商品 | 「商品」分頁取消勾選 **上架** |
| 取消訂單、把庫存加回去 | 「訂單」分頁把 **狀態** 改成「取消」 |
| 對帳 | 「訂單」分頁的 **付款** 改成「已對帳」 |
| 關閉訂購 | 「設定」分頁 `open` 改成 `0` |
| 改公告、匯款帳號 | 「設定」分頁 |
| 換收通知的 Email | 「設定」分頁 `owner_email` |

- 庫存數字如果怪怪的，試算表上方選單 **🍊 橘子後台 → 重新計算庫存**。
- 「商品」分頁的 **已訂箱數／剩餘箱數** 會自動計算，不用手動改。
- 「訂單」分頁的 **品項代碼(勿改)** 是用來算庫存的，請不要改它。
- 試算表裡的變更**立即生效**，不用重新部署。

### 改了 Code.gs 程式時
要 **部署 → 管理部署作業 → ✏ 編輯 → 版本選「新版本」→ 部署**，網址不會變。
（只改試算表內容不需要這一步。）

### LINE 推播（新訂單、匯款通知傳到 LINE）

**A. 建立 LINE 官方帳號**
1. 到 [LINE Official Account Manager](https://manager.line.biz/) 用 LINE 登入 → **建立 LINE 官方帳號**，名稱例如「有田有米訂單通知」，選免費方案。
2. 進入帳號 → 右上 **設定** → 左側 **Messaging API** → **啟用 Messaging API** → 建立一個「服務提供者」（名稱隨意）。
3. 同一頁的 **Webhook 網址** 填 Apps Script 網址（`https://script.google.com/macros/s/……/exec`）→ 儲存。
4. 左側 **回應設定**：**Webhook 開啟**、**自動回應訊息 關閉**、加入好友的歡迎訊息可關閉。

**B. 取得權杖**
1. 到 [LINE Developers](https://developers.line.biz/console/) → 點剛剛的服務提供者 → 點官方帳號的 channel。
2. **Messaging API** 分頁最下面 **Channel access token (long-lived)** → **Issue** → 複製那一長串。
3. 貼到試算表「設定」分頁的 **`line_token`**。

**C. 更新程式**（因為多了「連線到 LINE」的權限）
1. 把新版 `Code.gs` 整份貼上覆蓋 → 儲存 → 執行 **`setup`** → 依提示重新授權。
   「設定」分頁會多出 `line_token`、`line_bind_code`、`line_to` 三列。
2. **部署 → 管理部署作業 → ✏ 編輯 → 版本選「新版本」→ 部署**（網址不變）。

**D. 綁定接收者**（你和農婦各做一次）
1. 用手機 LINE 掃官方帳號的 QR code 加好友（OA Manager 首頁 →「增加好友」）。
2. 傳訊息給官方帳號：`綁定 驗證碼`（驗證碼在「設定」分頁的 `line_bind_code`，例如 `綁定 3WYK6S`）。
3. 收到「✅ 綁定成功」就完成了。試算表選單 **🍊 橘子後台 → 傳送 LINE 測試訊息** 可以再確認一次。

- 要停止接收：對官方帳號傳 `解除綁定`。
- 驗證碼外流了：改掉 `line_bind_code`，再把 `line_to` 裡不認識的人刪掉。
- 免費方案每月可推播 **200 則**，一則訊息傳給 2 個人算 2 則。超過額度時 LINE 不會推送，但訂單和 Email 照常。
- LINE Developers 裡的 Webhook「Verify」按鈕可能顯示錯誤（Google 會轉址），可以忽略，直接用「綁定」訊息測試即可。

### 限制
- 免費 Gmail 帳號每天最多寄約 100 封信。超過時訂單照樣成立，只是當天不會再寄信。
- 改用後台之後，建議把原本的 Google 表單設成「不接受回應」，避免有人繞過網站直接填表單。

---

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 前台訂購頁 |
| `config.ini` | **商品、價格、庫存、付款資訊、開關**都在這裡改 |
| `admin.html` | 本機用的設定編輯器（開啟 / 修改 / 儲存 config.ini） |
| `apps-script/Code.gs` | 訂單後台程式（貼到 Google 試算表的 Apps Script） |
| `assets/` | CSS / JS / 圖片 |

## 日常操作：改庫存、價格、上下架（Google 表單模式）

方法 A：用記事本直接改 `config.ini`（存成 UTF-8），上傳覆蓋。
方法 B：用 Chrome / Edge 開 `admin.html` → 開啟 config.ini → 修改 → 儲存（Ctrl+S）→ 上傳覆蓋。

- `stock = 0` → 顯示「已售完」，無法選購
- `[site] open = 0` → 整個關閉訂購
- `enabled = 0` → 商品下架

> 庫存不會因為有人下單而自動扣除（靜態網站無法寫檔），請對帳後手動調整。

## 本機預覽

直接雙擊 index.html **讀不到 config.ini**（瀏覽器禁止 file:// 網頁讀檔），請：
- **雙擊 `start.bat`**（需要已安裝 Node.js），會自動開啟 http://localhost:8080
- 或 VS Code 安裝「Live Server」→ 右鍵 index.html →「Open with Live Server」

`start.bat` 和 `tools/` 只是本機預覽用，不需要上傳到主機。

## 上線（免費）

GitHub Pages、Netlify、Cloudflare Pages 都可以，把整個資料夾上傳即可。
`admin.html` 不需要上傳（上傳了也無妨，它只能改使用者電腦上的檔案）。

## 匯款通知表單（選用，Google 表單模式）

有訂單後台時不需要這段，匯款通知會直接寫進試算表。
沒有後台、也沒設定這份表單時，「匯款通知」會改用 LINE 傳訊息給農婦。若想讓通知自動進 Google 試算表：

1. 新建一份 Google 表單「匯款通知」，題目（簡答即可）：姓名、手機、匯款金額、末五碼、付款方式、匯款日期、備註
2. 表單右上「⋮」→「取得預先填入的連結」→ 每題隨便填 → 取得連結
3. 連結裡會有 `entry.123456=...`，依序對應填入 `config.ini` 的 `[notify]`：
   ```ini
   [notify]
   action = https://docs.google.com/forms/d/e/表單ID/formResponse
   name = entry.xxxx
   phone = entry.xxxx
   amount = entry.xxxx
   last5 = entry.xxxx
   method = entry.xxxx
   date = entry.xxxx
   note = entry.xxxx
   ```
   （`action` 是表單網址把結尾 `viewform` 改成 `formResponse`）
4. 在回覆分頁開啟「接收新回應的電子郵件通知」，有人通知匯款就會寄信給你。

## 新增商品

1. 在原本的訂購 Google 表單新增一題「【新商品】數量」（下拉選單 1~10）
2. 用上面同樣的「取得預先填入的連結」找到該題 `entry.xxxx`
3. 在 config.ini 新增 `[product.代號]` 區塊（或用 admin.html「新增商品」），填入 `entry`

## 注意

- 修改 Google 表單題目的**文字**沒關係，但**刪掉題目再重建**會換 entry ID，要同步更新 config.ini。
- 收件時間選項 `time_options` 的文字必須和表單選項一字不差。
