# 有田有米・有園有果 椪柑訂購網站

純靜態網站（Bootstrap 5 + jQuery），訂單直接寫入原本的 Google 表單回覆。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 前台訂購頁 |
| `config.ini` | **商品、價格、庫存、付款資訊、開關**都在這裡改 |
| `admin.html` | 本機用的設定編輯器（開啟 / 修改 / 儲存 config.ini） |
| `assets/` | CSS / JS |

## 日常操作：改庫存、價格、上下架

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

## 匯款通知表單（選用）

目前「匯款通知」會改用 LINE 傳訊息給農婦。若想讓通知自動進 Google 試算表：

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
