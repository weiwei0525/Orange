/**
 * 有田有米・有園有果  訂單後台（Google Apps Script）
 *
 * 這段程式要貼在「Google 試算表 → 擴充功能 → Apps Script」裡，
 * 安裝步驟請看 README.md 的「訂單後台設定」。
 *
 * 功能：
 *  - 網站讀取商品、價格、剩餘庫存、公告（doGet）
 *  - 接收訂單：檢查庫存（同一時間只處理一張，不會超賣）→ 寫入「訂單」→ 寄確認信（doPost）
 *  - 接收匯款通知：寫入「匯款通知」、更新對應訂單的付款狀態、寄信通知農婦
 *  - 訂單「狀態」改成「取消」，庫存會自動加回去
 */

var TZ = 'Asia/Taipei';
var SHEET = { products: '商品', orders: '訂單', notify: '匯款通知', settings: '設定' };

var PROD_HEAD = ['代號', '名稱', '規格', '單價', '總箱數', '單筆上限', '角標', '大小', '照片', '上架', '已訂箱數', '剩餘箱數'];
var ORDER_HEAD = ['下單時間', '訂單編號', '狀態', '姓名', '手機', 'Email', '地址', 'LINE/備註', '收件時間',
                  '訂購內容', '箱數', '金額', '付款', '末五碼', '品項代碼(勿改)'];
var NOTIFY_HEAD = ['通知時間', '訂單編號', '姓名', '手機', '金額', '末五碼', '方式', '匯款日期', '備註'];
var ORDER_STATUS = ['新訂單', '已確認', '已出貨', '取消'];
var PAY_STATUS = ['待匯款', '已匯款待對帳', '已對帳'];

var DEFAULT_SETTINGS = [
  ['open', '1', '1 = 開放訂購，0 = 關閉訂購'],
  ['season_badge', '2026 季節限定・陸續出貨中', '首頁上方的小標籤'],
  ['notice', '出貨節奏會依照採收狀態，需要大家耐心等待一下！', '網站公告列，留空不顯示'],
  ['closed_message', '本季椪柑已全數售完，感謝大家的支持！明年見 🍊', '關閉訂購時顯示的文字'],
  ['low_stock', '5', '剩幾箱以下顯示「即將售完」'],
  ['owner_email', '', '新訂單通知寄到哪裡（可填多個，用逗號分隔）；留空 = 這個試算表的擁有者'],
  ['send_customer_email', '1', '1 = 客人有填 Email 就寄確認信，0 = 不寄'],
  ['shop_name', '有田有米・有園有果', '信件署名'],
  ['site_url', 'https://weiwei0525.github.io/Orange/', '網站網址（放在信裡）'],
  ['bank_name', '中國信託（822）', '匯款銀行'],
  ['bank_account', '7275-4024-6908', '匯款帳號'],
  ['account_holder', '吳佳玲', '戶名'],
  ['phone_transfer', '0987762621', '手機號碼轉帳'],
  ['line_id', 'mavis2731', 'LINE ID'],
  ['line_token', '', 'LINE 推播：Messaging API 的 Channel access token（長期）。留空 = 不推播'],
  ['line_bind_code', '', 'LINE 推播：對官方帳號傳「綁定 這組碼」就能收通知（自動產生，可自行修改）'],
  ['line_to', '', 'LINE 推播：已綁定的接收者（自動填入，要停止某人接收就刪掉那段）']
];

var DEFAULT_PRODUCTS = [
  ['p23', '級數 23', '25 斤裝・約 72 顆上下', 1000, 30, 10, '人氣', 'big', 'assets/img/p23.jpg', true],
  ['mini', '級數 小小橘', '25 斤裝・顆數多、小巧好剝', 750, 20, 10, '', 'small', 'assets/img/mini.jpg', true]
];

/* =================================================================
 *  初始化：第一次安裝時，上方下拉選單選「setup」→ 按 ▶ 執行
 * ================================================================= */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);

  // 商品
  var p = ensureSheet_(ss, SHEET.products, PROD_HEAD);
  if (p.getLastRow() < 2) {
    p.getRange(2, 1, DEFAULT_PRODUCTS.length, DEFAULT_PRODUCTS[0].length).setValues(DEFAULT_PRODUCTS);
  }
  p.getRange(2, 10, Math.max(p.getMaxRows() - 1, 1), 1).insertCheckboxes();
  p.getRange(1, 11, 1, 2).setBackground('#fde2c4');
  p.getRange('K1').setNote('自動計算，請不要手動修改');
  p.getRange('L1').setNote('自動計算，請不要手動修改');
  p.getRange('E1').setNote('這一季總共要賣幾箱。補貨時改這個數字');

  // 訂單
  var o = ensureSheet_(ss, SHEET.orders, ORDER_HEAD);
  o.getRange('E:E').setNumberFormat('@');
  o.getRange('N:N').setNumberFormat('@');
  o.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
  setDropdown_(o, 3, ORDER_STATUS);
  setDropdown_(o, 13, PAY_STATUS);
  o.getRange('C1').setNote('改成「取消」，庫存會自動加回去');
  o.getRange('O1').setNote('系統用來計算庫存，請不要修改');
  o.setColumnWidth(10, 220);
  o.setColumnWidth(7, 260);

  // 匯款通知
  var n = ensureSheet_(ss, SHEET.notify, NOTIFY_HEAD);
  n.getRange('D:D').setNumberFormat('@');
  n.getRange('F:F').setNumberFormat('@');
  n.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');

  // 設定（只補上缺少的項目，不會蓋掉已經改過的值）
  var s = ensureSheet_(ss, SHEET.settings, ['項目', '值', '說明']);
  s.getRange('B:B').setNumberFormat('@');
  var have = {};
  if (s.getLastRow() > 1) {
    s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().forEach(function (r) { have[String(r[0]).trim()] = true; });
  }
  // 值前面加 ' 強制存成文字，電話號碼開頭的 0 才不會被吃掉
  DEFAULT_SETTINGS.forEach(function (row) {
    if (have[row[0]]) return;
    var v = row[0] === 'line_bind_code' ? randomCode_() : row[1];
    s.appendRow([row[0], "'" + v, row[2]]);
  });
  s.setColumnWidth(2, 320);
  s.setColumnWidth(3, 420);

  var def = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  refreshStock();
  MailApp.getRemainingDailyQuota();  // 觸發寄信權限授權
  try { UrlFetchApp.getRequest('https://api.line.me/'); } catch (e) { /* 只是觸發「連線外部服務」授權 */ }
  ss.toast('初始化完成！接著請按「部署 → 新增部署作業」。', '🍊 橘子後台', 8);
}

/* 試算表上方的「🍊 橘子後台」選單（開啟試算表時自動執行，不用手動按） */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('🍊 橘子後台')
      .addItem('重新計算庫存', 'refreshStock')
      .addItem('傳送 LINE 測試訊息', 'testLine')
      .addItem('初始化／修復工作表', 'setup')
      .addToUi();
  } catch (e) {
    console.log('onOpen 只在開啟試算表時有作用；第一次安裝請改執行 setup');
  }
}

// 改了訂單狀態或商品總箱數，就自動重算「已訂／剩餘」
function onEdit(e) {
  var name = e && e.range ? e.range.getSheet().getName() : '';
  if (name === SHEET.orders || name === SHEET.products) refreshStock();
}

function ensureSheet_(ss, name, head) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#fff4e6');
  sh.setFrozenRows(1);
  return sh;
}

function setDropdown_(sh, col, list) {
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
  sh.getRange(2, col, sh.getMaxRows() - 1, 1).setDataValidation(rule);
}

/* =================================================================
 *  讀取資料
 * ================================================================= */
function settings_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.settings);
  var out = {};
  DEFAULT_SETTINGS.forEach(function (r) { out[r[0]] = r[1]; });
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      var k = String(r[0]).trim();
      if (k) out[k] = String(r[1] == null ? '' : r[1]).trim();
    });
  }
  // 手機號碼被試算表當成數字、少了開頭的 0 時補回來
  if (/^9\d{8}$/.test(out.phone_transfer)) out.phone_transfer = '0' + out.phone_transfer;
  return out;
}

function truthy_(v) {
  var s = String(v).trim().toLowerCase();
  return v === true || s === '1' || s === 'true' || s === '是' || s === 'y' || s === 'yes';
}

/** 各商品已被訂走的箱數（狀態為「取消」的訂單不算） */
function soldMap_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.orders);
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var ci = head.indexOf('品項代碼(勿改)'), si = head.indexOf('狀態');
  if (ci < 0) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().forEach(function (r) {
    if (si >= 0 && String(r[si]).trim() === '取消') return;
    String(r[ci] || '').split(',').forEach(function (part) {
      var kv = part.split(':'), id = String(kv[0] || '').trim(), q = parseInt(kv[1], 10);
      if (id && q > 0) map[id] = (map[id] || 0) + q;
    });
  });
  return map;
}

/** 讀「商品」工作表，回傳含剩餘庫存的商品清單 */
function products_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.products);
  if (!sh || sh.getLastRow() < 2) return [];
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = function (name) { return head.indexOf(name); };
  var sold = soldMap_();
  var list = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().forEach(function (r, i) {
    var id = String(r[col('代號')] || '').trim();
    if (!id) return;
    var total = Math.max(0, parseInt(r[col('總箱數')], 10) || 0);
    var s = sold[id] || 0;
    list.push({
      row: i + 2, id: id,
      name: String(r[col('名稱')] || id), spec: String(r[col('規格')] || ''),
      price: parseInt(r[col('單價')], 10) || 0,
      total: total, sold: s, stock: Math.max(0, total - s),
      max: Math.max(1, parseInt(r[col('單筆上限')], 10) || 10),
      badge: String(r[col('角標')] || ''), size: String(r[col('大小')] || 'big'),
      image: String(r[col('照片')] || ''), enabled: truthy_(r[col('上架')])
    });
  });
  return list;
}

function publicProducts_(list) {
  return list.filter(function (p) { return p.enabled; }).map(function (p) {
    return { id: p.id, name: p.name, spec: p.spec, price: p.price, stock: p.stock, max: p.max,
             badge: p.badge, size: p.size, image: p.image };
  });
}

/** 把「已訂箱數／剩餘箱數」寫回商品工作表，方便農婦查看 */
function refreshStock() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.products);
  if (!sh) return;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var cs = head.indexOf('已訂箱數') + 1, cr = head.indexOf('剩餘箱數') + 1;
  if (!cs || !cr) return;
  products_().forEach(function (p) {
    sh.getRange(p.row, cs).setValue(p.sold);
    sh.getRange(p.row, cr).setValue(p.stock);
  });
}

/* =================================================================
 *  網站 API
 * ================================================================= */
function doGet(e) {
  var cb = e && e.parameter && e.parameter.callback;
  return out_(publicConfig_(), cb);
}

function publicConfig_() {
  var s = settings_();
  return {
    ok: true,
    site: { open: s.open, season_badge: s.season_badge, notice: s.notice,
            closed_message: s.closed_message, low_stock: s.low_stock },
    payment: { bank_name: s.bank_name, bank_account: s.bank_account, account_holder: s.account_holder,
               phone_transfer: s.phone_transfer, line_id: s.line_id },
    products: publicProducts_(products_())
  };
}

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, code: 'bad', message: '資料格式錯誤' }); }
  if (d && Array.isArray(d.events)) return out_(lineWebhook_(d.events));   // LINE 官方帳號傳來的訊息
  if (d.website) return out_({ ok: true, orderId: '-' });   // 防機器人（隱藏欄位被填）
  try {
    if (d.type === 'order') return out_(placeOrder_(d));
    if (d.type === 'notify') return out_(notify_(d));
    return out_({ ok: false, code: 'bad', message: '未知的動作' });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, code: 'error', message: '系統忙碌中，請稍後再試，或用 LINE 聯絡農婦' });
  }
}

function out_(obj, cb) {
  var s = JSON.stringify(obj);
  if (cb && /^[\w.$]+$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + s + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 訂單 ---------- */
function clean_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;   // 避免被試算表當成公式
}
function digits_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function money_(n) { return 'NT$ ' + Number(n).toLocaleString('en-US'); }

function placeOrder_(d) {
  var name = clean_(d.name, 50), phone = digits_(d.phone), address = clean_(d.address, 200);
  var email = String(d.email || '').trim().slice(0, 120), contact = clean_(d.contact, 200);
  var time = clean_(d.time, 60), later = !!d.later, last5 = digits_(d.last5);

  if (!name || !address) return { ok: false, code: 'bad', message: '請填寫姓名與地址' };
  if (!/^09\d{8}$/.test(phone)) return { ok: false, code: 'bad', message: '手機號碼格式不正確' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, code: 'bad', message: 'Email 格式不正確' };
  if (!later && !/^\d{5}$/.test(last5)) return { ok: false, code: 'bad', message: '請填寫匯款帳號末五碼' };

  var want = d.items || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, code: 'busy', message: '目前訂購人數較多，請稍等幾秒再送出一次' };
  try {
    var s = settings_();
    if (s.open === '0') return { ok: false, code: 'closed', message: s.closed_message || '目前暫停訂購' };

    var list = products_(), lines = [], codes = [], short = [], total = 0, boxes = 0;
    list.forEach(function (p) {
      var q = parseInt(want[p.id], 10) || 0;
      if (q <= 0) return;
      if (!p.enabled) { short.push(p.name + ' 目前未販售'); return; }
      if (q > p.max) { short.push(p.name + ' 單筆最多 ' + p.max + ' 箱'); return; }
      if (q > p.stock) { short.push(p.stock ? p.name + ' 只剩 ' + p.stock + ' 箱' : p.name + ' 已售完'); return; }
      lines.push({ id: p.id, name: p.name, qty: q, price: p.price });
      codes.push(p.id + ':' + q);
      total += q * p.price; boxes += q;
    });
    if (short.length) return { ok: false, code: 'stock', message: short.join('、'), products: publicProducts_(list) };
    if (!boxes) return { ok: false, code: 'bad', message: '請至少選擇 1 箱' };

    var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(SHEET.orders);
    var now = new Date();
    var orderId = newOrderId_(sh, now);
    sh.appendRow([
      now, orderId, '新訂單', name, "'" + phone, email, address, contact, time,
      lines.map(function (l) { return l.name + ' × ' + l.qty; }).join('、'),
      boxes, total, later ? '待匯款' : '已匯款待對帳', later ? '' : "'" + last5, codes.join(',')
    ]);
    SpreadsheetApp.flush();
    refreshStock();
    var after = products_();
    lock.releaseLock();

    var order = { orderId: orderId, name: name, phone: phone, email: email, address: address, contact: contact,
                  time: time, later: later, last5: last5, items: lines, total: total, boxes: boxes };
    mailOrder_(order, s);
    pushLine_(s, '🍊 新訂單 #' + orderId + (later ? '（待匯款）' : '') + '\n' +
      name + '　' + phone + '\n' +
      lines.map(function (l) { return l.name + ' × ' + l.qty; }).join('、') + '\n' +
      '合計 ' + money_(total) + '（' + boxes + ' 箱）\n' +
      '付款：' + (later ? '稍後匯款' : '已匯款，末五碼 ' + last5) + '\n' +
      '收件時間：' + time + '\n地址：' + address +
      (contact ? '\n備註：' + contact : ''));
    return { ok: true, orderId: orderId, total: total, items: lines, emailed: !!(email && s.send_customer_email !== '0'),
             products: publicProducts_(after) };
  } finally {
    try { lock.releaseLock(); } catch (e) { /* 已釋放 */ }
  }
}

/** 訂單編號：日期 + 當天流水號，例如 1121-003 */
function newOrderId_(sh, now) {
  var day = Utilities.formatDate(now, TZ, 'MMdd');
  var n = 0;
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var m = String(r[0]).match(/^(\d{4})-(\d+)$/);
      if (m && m[1] === day) n = Math.max(n, parseInt(m[2], 10));
    });
  }
  return day + '-' + ('00' + (n + 1)).slice(-3);
}

function paymentText_(s) {
  return '・' + s.bank_name + '　帳號：' + s.bank_account + '　戶名：' + s.account_holder +
    (s.phone_transfer ? '\n・手機號碼轉帳：' + s.phone_transfer : '');
}

function mailOrder_(o, s) {
  var itemText = o.items.map(function (l) { return '・' + l.name + ' × ' + l.qty + ' 箱（' + money_(l.qty * l.price) + '）'; }).join('\n');
  var shop = s.shop_name || '有田有米・有園有果';

  // 給客人
  if (o.email && s.send_customer_email !== '0') {
    var pay = o.later
      ? '【尚未付款】請匯款 ' + money_(o.total) + ' 至：\n' + paymentText_(s) +
        '\n匯款後請到網站按「匯款通知」，或 LINE 告訴農婦末五碼（LINE ID：' + s.line_id + '），確認款項後才會出貨。'
      : '您填寫的匯款末五碼：' + o.last5 + '，農婦對帳後會依採收狀態安排出貨。';
    try {
      MailApp.sendEmail({
        to: o.email, name: shop, replyTo: ownerEmail_(s).split(',')[0],
        subject: '【' + shop + '】訂單確認 #' + o.orderId,
        body: o.name + ' 您好：\n\n感謝您訂購' + shop + '的椪柑！以下是您的訂單內容。\n\n' +
          '訂單編號：' + o.orderId + '\n' + itemText + '\n合計：' + money_(o.total) + '（含運）\n\n' +
          '收件人：' + o.name + '　' + o.phone + '\n地址：' + o.address + '\n收件時間：' + o.time + '\n\n' +
          pay + '\n\n出貨節奏會依照採收狀態，請耐心等候 🍊\n有任何問題歡迎 LINE 我們：' + s.line_id + '\n\n' +
          shop + '\n' + s.site_url
      });
    } catch (e) { console.error('寄給客人失敗', e); }
  }

  // 給農婦
  try {
    var opt = {
      to: ownerEmail_(s), name: '橘子訂單通知',
      subject: '🍊 新訂單 #' + o.orderId + '｜' + o.name + ' ' + o.boxes + ' 箱 ' + money_(o.total) + (o.later ? '（待匯款）' : ''),
      body: '訂單編號：' + o.orderId + '\n' + itemText + '\n合計：' + money_(o.total) + '\n\n' +
        '姓名：' + o.name + '\n手機：' + o.phone + '\nEmail：' + (o.email || '（未填）') + '\n地址：' + o.address +
        '\nLINE/備註：' + (o.contact || '') + '\n收件時間：' + o.time + '\n付款：' + (o.later ? '稍後匯款' : '已匯款，末五碼 ' + o.last5) +
        '\n\n訂單試算表：' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
    };
    if (o.email) opt.replyTo = o.email;
    MailApp.sendEmail(opt);
  } catch (e) { console.error('寄給農婦失敗', e); }
}

function ownerEmail_(s) {
  return s.owner_email || Session.getEffectiveUser().getEmail();
}

/* ---------- 匯款通知 ---------- */
function notify_(d) {
  var name = clean_(d.name, 50), phone = digits_(d.phone), amount = digits_(d.amount), last5 = digits_(d.last5);
  var orderId = clean_(d.orderId, 20), method = clean_(d.method, 20), date = clean_(d.date, 20), note = clean_(d.note, 300);
  if (!name || !/^09\d{8}$/.test(phone) || !amount || !/^\d{5}$/.test(last5)) {
    return { ok: false, code: 'bad', message: '請確認姓名、手機、金額與末五碼' };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock();
  var matched = false;
  if (lock.tryLock(20000)) {
    try {
      ss.getSheetByName(SHEET.notify).appendRow([new Date(), orderId, name, "'" + phone, Number(amount), "'" + last5, method, date, note]);
      // 有填訂單編號、且手機相符 → 更新訂單的付款狀態
      var sh = ss.getSheetByName(SHEET.orders);
      if (orderId && sh.getLastRow() > 1) {
        var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 14).getValues();
        for (var i = rows.length - 1; i >= 0; i--) {
          if (String(rows[i][1]) === orderId && digits_(rows[i][4]) === phone) {
            sh.getRange(i + 2, 13, 1, 2).setValues([['已匯款待對帳', "'" + last5]]);
            matched = true;
            break;
          }
        }
      }
    } finally { lock.releaseLock(); }
  } else {
    return { ok: false, code: 'busy', message: '系統忙碌中，請稍後再試' };
  }

  var s = settings_();
  try {
    MailApp.sendEmail({
      to: ownerEmail_(s), name: '橘子訂單通知',
      subject: '💰 匯款通知' + (orderId ? ' #' + orderId : '') + '｜' + name + ' ' + money_(amount) + ' 末五碼 ' + last5,
      body: '訂單編號：' + (orderId || '（未填）') + (orderId && !matched ? '（找不到相符的訂單，請手動核對）' : '') +
        '\n姓名：' + name + '\n手機：' + phone + '\n金額：' + money_(amount) + '\n末五碼：' + last5 +
        '\n方式：' + method + '\n日期：' + date + '\n備註：' + note + '\n\n試算表：' + ss.getUrl()
    });
  } catch (e) { console.error('寄送匯款通知失敗', e); }
  pushLine_(s, '💰 匯款通知' + (orderId ? ' #' + orderId : '') + '\n' +
    name + '　' + phone + '\n' +
    '金額 ' + money_(amount) + '　末五碼 ' + last5 + '\n' +
    method + (date ? '　' + date : '') + (note ? '\n備註：' + note : '') + '\n' +
    (matched ? '✅ 已對應到訂單，請到銀行 App 核對入帳' : '⚠️ ' + (orderId ? '找不到相符的訂單' : '沒有填訂單編號') + '，請手動核對'));
  return { ok: true, matched: matched };
}

/* =================================================================
 *  LINE 推播（Messaging API）
 * ================================================================= */
function randomCode_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function setSetting_(key, value) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.settings);
  var rows = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) { sh.getRange(i + 2, 2).setValue("'" + value); return; }
  }
  sh.appendRow([key, "'" + value, '']);
}

function lineIds_(s) {
  return String(s.line_to || '').split(/[,\s]+/).filter(function (x) { return /^U[0-9a-f]{32}$/.test(x); });
}

function lineApi_(s, path, body) {
  return UrlFetchApp.fetch('https://api.line.me/v2/bot/message/' + path, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + s.line_token },
    payload: JSON.stringify(body)
  });
}

/** 推播給所有已綁定的人；失敗不影響訂單 */
function pushLine_(s, text) {
  var ids = lineIds_(s);
  if (!s.line_token || !ids.length) return false;
  try {
    var r = lineApi_(s, 'multicast', { to: ids, messages: [{ type: 'text', text: text.slice(0, 4900) }] });
    if (r.getResponseCode() !== 200) console.error('LINE 推播失敗', r.getResponseCode(), r.getContentText());
    return r.getResponseCode() === 200;
  } catch (e) { console.error('LINE 推播失敗', e); return false; }
}

/** 官方帳號收到訊息：處理「綁定 驗證碼」／「解除綁定」 */
function lineWebhook_(events) {
  var s = settings_();
  if (!s.line_token) return { ok: true };
  events.forEach(function (ev) {
    var uid = ev.source && ev.source.userId;
    var reply = function (text) {
      if (ev.replyToken) lineApi_(s, 'reply', { replyToken: ev.replyToken, messages: [{ type: 'text', text: text }] });
    };
    if (!uid) return;
    if (ev.type === 'follow') {
      reply('您好！這是有田有米的訂單通知帳號。\n農婦或管理者請傳送「綁定 驗證碼」開始接收訂單通知（驗證碼在後台試算表「設定」分頁的 line_bind_code）。');
      return;
    }
    if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
    var text = String(ev.message.text).trim();
    var ids = lineIds_(s);
    var m = text.match(/^綁定\s*(\S+)$/);
    if (m) {
      if (!s.line_bind_code || m[1].toUpperCase() !== s.line_bind_code.toUpperCase()) { reply('驗證碼不正確 🙅'); return; }
      if (ids.indexOf(uid) < 0) ids.push(uid);
      setSetting_('line_to', ids.join(','));
      s.line_to = ids.join(',');
      reply('✅ 綁定成功！之後有新訂單或匯款通知，會傳到這裡 🍊\n要停止接收請傳「解除綁定」。');
    } else if (text === '解除綁定') {
      setSetting_('line_to', ids.filter(function (x) { return x !== uid; }).join(','));
      reply('已停止接收訂單通知。');
    }
  });
  return { ok: true };
}

/** 選單「傳送 LINE 測試訊息」 */
function testLine() {
  var s = settings_(), ss = SpreadsheetApp.getActiveSpreadsheet();
  var msg = !s.line_token ? '還沒填 line_token' : !lineIds_(s).length ? '還沒有人綁定（請用 LINE 對官方帳號傳「綁定 ' + s.line_bind_code + '」）'
    : pushLine_(s, '🍊 測試訊息：LINE 推播設定成功！') ? '已傳送給 ' + lineIds_(s).length + ' 人' : '傳送失敗，請檢查 line_token（詳見執行記錄）';
  ss.toast(msg, 'LINE 推播', 8);
  console.log(msg);
}
