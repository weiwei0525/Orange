/* 有田有米・有園有果  前台主程式（jQuery 3 + Bootstrap 5） */
(function ($) {
  'use strict';

  var CFG = {};            // config.ini 內容
  var PRODUCTS = [];       // [{id, name, price, stock, limit, ...}]
  var CART = {};           // { id: qty }
  var LAST_ORDER_KEY = 'ytym_last_order';

  /* ---------- 小工具 ---------- */
  function money(n) { return Number(n || 0).toLocaleString('zh-TW'); }
  function esc(s) { return $('<div>').text(s == null ? '' : String(s)).html(); }
  function cfg(path, def) {
    var p = path.split('.'), sec = CFG[p[0]];
    var v = sec ? sec[p[1]] : undefined;
    return (v === undefined || v === '') ? def : v;
  }
  function toast(msg) {
    $('#toastText').text(msg);
    bootstrap.Toast.getOrCreateInstance($('#appToast')[0], { delay: 1800 }).show();
  }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var $t = $('<textarea>').val(text).css({ position: 'fixed', opacity: 0 }).appendTo('body');
    $t[0].select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    $t.remove();
    return $.Deferred().resolve().promise();
  }

  /* ---------- 訂單後台 API（Google Apps Script） ---------- */
  var API = '';              // config.ini [api] url；空白 = 用 Google 表單
  var API_PRODUCTS = null;   // 後台回傳的商品（含即時庫存）
  var lastSync = 0;

  function apiFetch(opts, query) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
    if (ctrl) opts.signal = ctrl.signal;
    var url = API + (query ? (API.indexOf('?') < 0 ? '?' : '&') + query : '');
    return fetch(url, opts)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(function () { clearTimeout(timer); });
  }
  function apiGet() { return apiFetch({ cache: 'no-store' }, 'action=config&t=' + Date.now()); }
  // 用 text/plain 送出，瀏覽器不會先發 CORS 預檢，Apps Script 才收得到
  function apiPost(data) { return apiFetch({ method: 'POST', body: JSON.stringify(data) }); }

  function mergeApi(res) {
    if (!res || !res.ok) return false;
    CFG.site = $.extend({}, CFG.site);
    $.each(res.site || {}, function (k, v) { if (v != null) CFG.site[k] = String(v); });
    CFG.payment = $.extend({}, CFG.payment);
    $.each(res.payment || {}, function (k, v) { if (v) CFG.payment[k] = String(v); });
    // 試算表把手機號碼存成數字時，開頭的 0 會不見
    if (/^9\d{8}$/.test(CFG.payment.phone_transfer || '')) CFG.payment.phone_transfer = '0' + CFG.payment.phone_transfer;
    API_PRODUCTS = res.products || [];
    lastSync = Date.now();
    return true;
  }

  /* ---------- 讀取設定 ---------- */
  function loadConfig() {
    return $.ajax({ url: 'config.ini', dataType: 'text', cache: false })
      .then(function (text) { CFG = INI.parse(text); },
            function () { $('#cfgError').prop('hidden', false); CFG = {}; return $.Deferred().resolve(); })
      .then(function () {
        API = cfg('api.url', '');
        if (!API) return;
        // 後台連不上時，先用 config.ini 的資料顯示；送單時後台仍會再檢查庫存
        return apiGet().then(mergeApi).catch(function () { /* 用備用值 */ });
      });
  }

  function makeProduct(id, p) {
    var stock = Math.max(0, parseInt(p.stock, 10) || 0);
    var max = Math.max(1, parseInt(p.max, 10) || 10);
    return {
      id: String(id), name: p.name || String(id), spec: p.spec || '',
      price: parseInt(p.price, 10) || 0, stock: stock, max: max,
      limit: Math.min(stock, max), badge: p.badge || '',
      size: p.size === 'small' ? 'small' : 'big', entry: p.entry || '',
      image: p.image || ''
    };
  }

  function iniProducts() {
    return Object.keys(CFG)
      .filter(function (k) { return k.indexOf('product.') === 0 && CFG[k].enabled !== '0'; })
      .map(function (k) { return makeProduct(k.slice(8), CFG[k]); });
  }

  function applyTexts() {
    $('[data-cfg]').each(function () {
      var v = cfg($(this).data('cfg'));
      if (v !== undefined) $(this).text(v);
    });
    $('[data-cfg-href]').each(function () {
      var v = cfg($(this).data('cfg-href'));
      if (v) $(this).attr('href', v);
    });
    $('#noticeBar').prop('hidden', !cfg('site.notice'));
  }

  function applyOpenState() {
    var closed = cfg('site.open', '1') === '0';
    $('#orderFormEl, #calcBar').prop('hidden', closed);
    $('#closedBox').prop('hidden', !closed);
    if (closed) $('.qty-group').addClass('disabled').find('button,input').prop('disabled', true);
  }

  function applyConfig() {
    applyTexts();
    if (API) {
      $('.api-only').prop('hidden', false);
      $('#fContactLabel').text('LINE ID／備註');
      $('#fContactHelp').text('出貨通知、或有特別交代（例：放管理室）都可以寫這裡。');
      $('#formFallback').html('不方便填表或送不出去？也可以直接 LINE 農婦，LINE ID：<strong>' + esc(cfg('payment.line_id', '')) + '</strong>');
    }
    PRODUCTS = API_PRODUCTS
      ? API_PRODUCTS.map(function (p) { return makeProduct(p.id, p); })
      : iniProducts();

    renderHero();
    renderGallery();
    renderProducts();
    renderOrderItems();
    renderTimeOptions();
    applyOpenState();
  }

  /** 庫存有更新時重畫商品，並把已選的箱數夾在新的上限內 */
  function setProducts(list) {
    PRODUCTS = list.map(function (p) { return makeProduct(p.id, p); });
    renderProducts();
    renderOrderItems();
    var keep = {};
    PRODUCTS.forEach(function (p) {
      var q = Math.min(p.limit, CART[p.id] || 0);
      if (q > 0) keep[p.id] = q;
      $('.qty-group[data-id="' + p.id + '"] .qty-input').val(q);
      $('.qty-group[data-id="' + p.id + '"]').closest('.product-card').toggleClass('selected', q > 0);
    });
    CART = keep;
    updateTotals();
    applyOpenState();
  }

  // 客人切回這個分頁時，順便更新庫存（最多一分鐘一次）
  function bindSync() {
    $(document).on('visibilitychange', function () {
      if (!API || document.hidden || Date.now() - lastSync < 60000) return;
      lastSync = Date.now();
      apiGet().then(function (res) {
        if (!mergeApi(res)) return;
        applyTexts();
        setProducts(API_PRODUCTS);
      }).catch(function () { /* 下次再試 */ });
    });
  }

  /* ---------- 商品卡 ---------- */
  function qtyControl(p) {
    var dis = p.limit === 0 ? ' disabled' : '';
    return '<div class="qty-group" data-id="' + esc(p.id) + '">' +
      '<button type="button" class="btn qty-btn" data-step="-1" aria-label="減少"' + dis + '><i class="bi bi-dash"></i></button>' +
      '<input type="number" class="form-control qty-input" value="0" min="0" max="' + p.limit + '" aria-label="' + esc(p.name) + ' 數量"' + dis + '>' +
      '<button type="button" class="btn qty-btn" data-step="1" aria-label="增加"' + dis + '><i class="bi bi-plus"></i></button>' +
      '</div>';
  }

  function stockBadge(p) {
    var low = parseInt(cfg('site.low_stock', '5'), 10);
    if (p.stock === 0) return '<span class="stock-tag out"><i class="bi bi-x-circle"></i> 已售完</span>';
    if (p.stock <= low) return '<span class="stock-tag low"><i class="bi bi-fire"></i> 即將售完・剩 ' + p.stock + ' 箱</span>';
    return '<span class="stock-tag ok"><i class="bi bi-check-circle"></i> 尚有庫存 ' + p.stock + ' 箱</span>';
  }

  /* ---------- 照片 ---------- */
  // 圖片載入失敗時，還原成 CSS 畫的橘子
  function photo(src, alt, cls, fallbackHtml) {
    var $img = $('<img>', { src: src, alt: alt || '', loading: 'lazy', 'class': cls || '' });
    if (fallbackHtml) $img.on('error', function () { $(this).replaceWith(fallbackHtml); });
    else $img.on('error', function () { $(this).closest('.gallery-item').remove(); });
    return $img;
  }

  function renderHero() {
    var src = cfg('site.hero_image');
    if (!src) return;
    var $box = $('#heroVisual'), fallback = $box.html();
    var $img = $('<img>', { src: src, alt: '東勢椪柑' }).on('error', function () { $box.html(fallback); });
    $box.html($('<div class="hero-photo">').append($img));
  }

  var GALLERY = [];
  function renderGallery() {
    var g = CFG.gallery || {};
    GALLERY = Object.keys(g).filter(function (k) { return /^photo\d*$/.test(k) && g[k]; })
      .sort(function (a, b) { return (parseInt(a.slice(5), 10) || 0) - (parseInt(b.slice(5), 10) || 0); })
      .map(function (k) {
        var parts = g[k].split('|');
        return { src: parts[0].trim(), cap: (parts[1] || '').trim() };
      });
    if (!GALLERY.length) return;
    var $grid = $('#galleryGrid').empty();
    GALLERY.forEach(function (it, i) {
      var $a = $('<button type="button" class="gallery-item reveal">').attr('data-i', i).css('--d', (i % 4) * 0.08 + 's');
      $a.append(photo(it.src, it.cap || '果園照片'));
      if (it.cap) $a.append($('<span class="gallery-cap">').text(it.cap));
      $grid.append($a);
    });
    $('#gallery, #navGallery').prop('hidden', false);
    observeReveal($grid.find('.reveal'));
  }

  var lbIndex = 0;
  function showLightbox(i) {
    var n = $('#galleryGrid .gallery-item').length;
    if (!n) return;
    lbIndex = (i + GALLERY.length) % GALLERY.length;
    var it = GALLERY[lbIndex];
    $('#lbImg').stop(true).css('opacity', 0).attr({ src: it.src, alt: it.cap }).animate({ opacity: 1 }, 250);
    $('#lbCap').text(it.cap);
  }
  function bindGallery() {
    $(document).on('click', '.gallery-item', function () {
      showLightbox(Number($(this).attr('data-i')));
      bootstrap.Modal.getOrCreateInstance('#lightbox').show();
    });
    $('.lb-prev').on('click', function () { showLightbox(lbIndex - 1); });
    $('.lb-next').on('click', function () { showLightbox(lbIndex + 1); });
    $(document).on('keydown', function (e) {
      if (!$('#lightbox').hasClass('show')) return;
      if (e.key === 'ArrowLeft') showLightbox(lbIndex - 1);
      if (e.key === 'ArrowRight') showLightbox(lbIndex + 1);
    });
    // 手機左右滑動
    var x0 = null;
    $('#lightbox').on('touchstart', function (e) { x0 = e.originalEvent.touches[0].clientX; })
      .on('touchend', function (e) {
        if (x0 === null) return;
        var dx = e.originalEvent.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 50) showLightbox(lbIndex + (dx < 0 ? 1 : -1));
        x0 = null;
      });
  }

  function renderProducts() {
    var $list = $('#productList').empty();
    if (!PRODUCTS.length) {
      $list.html('<div class="col-12 text-center text-muted py-5">目前沒有上架商品</div>');
      return;
    }
    var col = PRODUCTS.length >= 3 ? 'col-md-6 col-lg-4' : 'col-md-6 col-lg-5';
    PRODUCTS.forEach(function (p, i) {
      var balls = p.size === 'big'
        ? '<div class="mini-orange big"></div>'
        : '<div class="mini-orange small"></div><div class="mini-orange small"></div><div class="mini-orange small"></div>';
      var $card = $(
        '<div class="' + col + ' reveal" style="--d:' + (i * 0.12) + 's">' +
          '<div class="product-card' + (i === 0 ? ' featured' : '') + (p.stock === 0 ? ' soldout' : '') + (p.image ? ' has-photo' : '') + '">' +
            (p.badge ? '<span class="ribbon">' + esc(p.badge) + '</span>' : '') +
            '<div class="product-visual">' + (p.image ? '' : balls) + '</div>' +
            '<h3>' + esc(p.name) + '</h3>' +
            '<p class="spec">' + esc(p.spec) + '</p>' +
            '<p class="price"><small>NT$</small><span class="count" data-to="' + p.price + '">0</span><small class="unit">/ 箱・含運</small></p>' +
            '<div class="mb-3">' + stockBadge(p) + '</div>' +
            qtyControl(p) +
          '</div>' +
        '</div>'
      );
      if (p.image) {
        var $vis = $card.find('.product-visual');
        $vis.append(photo(p.image, p.name, 'product-photo', function () {
          $vis.closest('.product-card').removeClass('has-photo');
          $vis.html(balls);
        }));
      }
      $list.append($card);
    });
    observeReveal($list.find('.reveal'));
  }

  function renderOrderItems() {
    var $box = $('#orderItems').empty();
    PRODUCTS.forEach(function (p) {
      $box.append(
        '<div class="order-item' + (p.stock === 0 ? ' soldout' : '') + '">' +
          '<div class="oi-info"><strong>' + esc(p.name) + '</strong>' +
          '<small>' + esc(p.spec) + '・NT$ ' + money(p.price) + (p.stock === 0 ? '・<span class="text-danger">已售完</span>' : '') + '</small></div>' +
          qtyControl(p) +
        '</div>'
      );
    });
  }

  function renderTimeOptions() {
    var opts = cfg('form.time_options', '平日|週六|平日周六都可以|出貨時間需要參詳(討論)一下').split('|');
    var $box = $('#timeOptions').empty();
    opts.forEach(function (o, i) {
      $box.append(
        '<div class="form-check">' +
          '<input class="form-check-input" type="radio" name="time" id="t' + i + '" value="' + esc(o) + '">' +
          '<label class="form-check-label" for="t' + i + '">' + esc(o) + '</label>' +
        '</div>'
      );
    });
  }

  /* ---------- 購物車 ---------- */
  function findProduct(id) { return PRODUCTS.filter(function (p) { return p.id === id; })[0]; }

  function setQty(id, qty) {
    var p = findProduct(id);
    if (!p) return;
    qty = Math.max(0, Math.min(p.limit, parseInt(qty, 10) || 0));
    if (qty === p.limit && qty > 0 && (CART[id] || 0) === qty) {
      toast(p.stock <= p.limit ? '庫存只剩 ' + p.stock + ' 箱' : '單筆最多 ' + p.limit + ' 箱');
    }
    CART[id] = qty;
    $('.qty-group[data-id="' + id + '"] .qty-input').val(qty);
    $('.qty-group[data-id="' + id + '"]').closest('.product-card').toggleClass('selected', qty > 0);
    updateTotals();
  }

  var shownTotal = 0;
  function updateTotals() {
    var total = 0, boxes = 0, lines = [];
    PRODUCTS.forEach(function (p) {
      var q = CART[p.id] || 0;
      if (q > 0) {
        total += q * p.price; boxes += q;
        lines.push(esc(p.name) + ' × ' + q);
      }
    });
    $('#calcDetail').html(lines.length ? lines.join('、') + '（共 ' + boxes + ' 箱）' : '請在上方選擇箱數');
    $('#fabCount').text(boxes ? '已選 ' + boxes + ' 箱' : '').prop('hidden', boxes === 0);
    $('#fabOrder').attr('aria-label', boxes ? '前往訂購單，已選 ' + boxes + ' 箱' : '前往訂購單');
    if (boxes > 0) { $('#itemsError').prop('hidden', true); $('#orderItems').removeClass('need-pick'); }

    // 金額跳動動畫
    $({ v: shownTotal }).stop(true).animate({ v: total }, {
      duration: 400,
      step: function (now) { $('#calcTotal, #orderTotal').text(money(Math.round(now))); },
      complete: function () { $('#calcTotal, #orderTotal').text(money(total)); }
    });
    if (total !== shownTotal) {
      $('.calc-total, .order-total').removeClass('bump');
      void document.body.offsetWidth;
      $('.calc-total, .order-total').addClass('bump');
    }
    shownTotal = total;
    return { total: total, boxes: boxes };
  }

  function bindCart() {
    $(document).on('click', '.qty-btn', function () {
      var id = $(this).closest('.qty-group').data('id');
      setQty(String(id), (CART[id] || 0) + Number($(this).data('step')));
    });
    $(document).on('change', '.qty-input', function () {
      setQty(String($(this).closest('.qty-group').data('id')), $(this).val());
    });
  }

  /* ---------- 送出訂單 ---------- */
  function postToGoogle(action, params) {
    // Google 表單不支援 CORS，用 no-cors 送出（看不到回應，但資料會寫入）
    return fetch(action, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
  }

  function bindOrder() {
    $('input[name="paystate"]').on('change', function () {
      var later = $('#payLater').is(':checked');
      $('#last5Box').prop('hidden', later);
      $('#laterHint').prop('hidden', !later);
      $('#fLast5').prop('required', !later);
    }).trigger('change');

    $(document).on('change', 'input[name="time"]', function () {
      $('#timeError').prop('hidden', true);
      $('#timeOptions').removeClass('need-pick');
    });

    $('#orderFormEl').on('submit', function (e) {
      e.preventDefault();
      var form = this, ok = form.checkValidity();
      var sums = updateTotals();
      var time = $('input[name="time"]:checked').val();

      $('#itemsError').prop('hidden', sums.boxes > 0);
      $('#orderItems').toggleClass('need-pick', !sums.boxes);
      $('#timeError').prop('hidden', !!time);
      $('#timeOptions').toggleClass('need-pick', !time);
      $(form).addClass('was-validated');
      if (!ok || !sums.boxes || !time) {
        var $first = $(form).find(':invalid').first();
        if (!sums.boxes) $first = $('#orderItems');
        else if (!$first.length && !time) $first = $('#timeOptions');
        $('html,body').animate({ scrollTop: $first.offset().top - 120 }, 400);
        $first.filter('input').trigger('focus');
        return;
      }

      var later = $('#payLater').is(':checked');
      var f = CFG.form || {};
      var params = new URLSearchParams();
      var extra = [];
      var data = {
        name: $('#fName').val().trim(),
        phone: $('#fPhone').val().replace(/\D/g, ''),
        address: $('#fAddress').val().trim(),
        contact: $('#fContact').val().trim(),
        time: time,
        last5: later ? cfg('form.later_text', '待匯款') : $('#fLast5').val().trim(),
        items: [], total: sums.total
      };
      PRODUCTS.forEach(function (p) {
        var q = CART[p.id] || 0;
        if (!q) return;
        data.items.push({ name: p.name, qty: q, price: p.price });
        if (p.entry) params.append(p.entry, String(q));
        else extra.push(p.name + ' x' + q);  // 表單沒有對應題目時，附在聯絡欄位
      });
      data.later = later;
      $('#orderAlert').prop('hidden', true).empty();

      function finish() {
        data.time_sent = new Date().toISOString();
        store(LAST_ORDER_KEY, data);
        showDone(data);
        form.reset();
        $(form).removeClass('was-validated');
        $('input[name="paystate"]').trigger('change');
        PRODUCTS.forEach(function (p) { setQty(p.id, 0); });
      }
      var $btn = $('#submitBtn').prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> 送出中…');
      function resetBtn() { $btn.prop('disabled', false).html('<i class="bi bi-send"></i> 送出訂單'); }

      // ---- 訂單後台：即時檢查庫存 ----
      if (API) {
        var payload = {
          type: 'order', name: data.name, phone: data.phone, email: $('#fEmail').val().trim(),
          address: data.address, contact: $('#fContact').val().trim(), time: time, later: later,
          last5: later ? '' : $('#fLast5').val().trim(), items: {}, website: $('#fWebsite').val()
        };
        PRODUCTS.forEach(function (p) { if (CART[p.id]) payload.items[p.id] = CART[p.id]; });
        apiPost(payload)
          .then(function (res) {
            if (res.products) setProducts(res.products);
            if (!res.ok) { orderAlert(res); return; }
            data.orderId = res.orderId;
            data.total = res.total;
            data.items = res.items;
            data.emailed = res.emailed;
            finish();
          })
          .catch(function () {
            orderAlert({ message: '網路連線不穩，訂單可能沒有送出。請先確認是否收到確認信，或用 LINE 問農婦（' +
              cfg('payment.line_id', '') + '），避免重複下單。' });
          })
          .finally(resetBtn);
        return;
      }

      // ---- Google 表單 ----
      if (extra.length) data.contact = (data.contact ? data.contact + ' / ' : '') + '[其他品項] ' + extra.join('、');
      ['name', 'phone', 'address', 'contact', 'time', 'last5'].forEach(function (k) {
        if (f[k] && data[k]) params.append(f[k], data[k]);
      });
      if (!f.action) { resetBtn(); toast('尚未設定表單，請改用 Google 表單填寫'); return; }

      postToGoogle(f.action, params)
        .then(finish)
        .catch(function () { toast('網路異常，請稍後再試或改用 Google 表單'); })
        .finally(resetBtn);
    });
  }

  function orderAlert(res) {
    if (res.code === 'closed') {
      CFG.site = $.extend({}, CFG.site, { open: '0', closed_message: res.message });
      applyTexts();
      applyOpenState();
      $('html,body').animate({ scrollTop: $('#closedBox').offset().top - 120 }, 400);
      return;
    }
    var title = res.code === 'stock' ? '<strong>庫存不足：</strong>' : '';
    var tail = res.code === 'stock' ? '<br>數量已自動調整成目前可訂的箱數，確認後請再送出一次。' : '';
    $('#orderAlert').prop('hidden', false).html(
      '<div class="alert alert-danger small"><i class="bi bi-exclamation-triangle"></i> ' + title + esc(res.message || '送出失敗，請稍後再試') + tail + '</div>');
    $('html,body').animate({ scrollTop: $('#orderAlert').offset().top - 160 }, 400);
  }

  function showDone(d) {
    var html = (d.orderId ? '<div><span>訂單編號</span><strong>' + esc(d.orderId) + '</strong></div>' : '') +
      '<div><span>收件人</span>' + esc(d.name) + '</div>' +
      d.items.map(function (i) { return '<div><span>' + esc(i.name) + '</span>' + i.qty + ' 箱 × NT$ ' + money(i.price) + '</div>'; }).join('') +
      '<div class="total"><span>合計</span>NT$ ' + money(d.total) + '</div>' +
      '<div><span>末五碼</span>' + esc(d.last5) + '</div>';
    $('#doneSummary').html(html);
    $('#doneAmount').text(money(d.total));
    $('#doneLater').prop('hidden', !d.later);
    $('#doneEmailed').prop('hidden', !d.emailed);
    bootstrap.Modal.getOrCreateInstance('#doneModal').show();
    burst();
  }

  /* ---------- 匯款通知 ---------- */
  function notifyData() {
    return {
      orderId: API ? $('#nOrder').val().trim() : '',
      name: $('#nName').val().trim(), phone: $('#nPhone').val().replace(/\D/g, ''),
      amount: $('#nAmount').val().trim(), last5: $('#nLast5').val().trim(),
      method: $('#nMethod').val(), date: $('#nDate').val(), note: $('#nNote').val().trim()
    };
  }
  function notifyMessage(d) {
    return '【匯款通知】有田有米\n' +
      (d.orderId ? '訂單編號：' + d.orderId + '\n' : '') +
      '姓名：' + d.name + '\n手機：' + d.phone + '\n金額：NT$ ' + d.amount + '\n' +
      '末五碼：' + d.last5 + '\n方式：' + d.method + (d.date ? '\n日期：' + d.date : '') +
      (d.note ? '\n備註：' + d.note : '');
  }
  function sendViaLine(d) {
    var msg = notifyMessage(d);
    copyText(msg);
    // line.me/R/msg/text 會開啟 LINE 分享，選擇農婦即可傳送
    window.open('https://line.me/R/msg/text/?' + encodeURIComponent(msg), '_blank', 'noopener');
    $('#notifyResult').prop('hidden', false).html(
      '<div class="alert alert-success small mb-0"><i class="bi bi-clipboard-check"></i> 訊息已複製，已開啟 LINE。若還沒加農婦好友，請先加 LINE ID：<strong>' +
      esc(cfg('payment.line_id', '')) + '</strong>，再把訊息貼上傳送。</div>');
  }

  function bindNotify() {
    $('#notifyModal').on('show.bs.modal', function () {
      $('#notifyResult').prop('hidden', true);
      $('#notifyForm').removeClass('was-validated');
      var last = store(LAST_ORDER_KEY);
      if (last) {
        if (!$('#nOrder').val() && last.orderId) $('#nOrder').val(last.orderId);
        if (!$('#nName').val()) $('#nName').val(last.name);
        if (!$('#nPhone').val()) $('#nPhone').val(last.phone);
        if (!$('#nAmount').val()) $('#nAmount').val(last.total);
        if (!$('#nNote').val()) $('#nNote').val('訂購 ' + last.items.map(function (i) { return i.name + ' x' + i.qty; }).join('、'));
      }
      if (!$('#nDate').val()) $('#nDate').val(new Date().toISOString().slice(0, 10));
    });

    $('#doneNotifyBtn').on('click', function () {
      bootstrap.Modal.getOrCreateInstance('#doneModal').hide();
      setTimeout(function () { bootstrap.Modal.getOrCreateInstance('#notifyModal').show(); }, 350);
    });

    function validNotify() {
      var f = $('#notifyForm')[0];
      $(f).addClass('was-validated');
      return f.checkValidity();
    }

    $('#notifyLine').on('click', function () { if (validNotify()) sendViaLine(notifyData()); });

    $('#notifyForm').on('submit', function (e) {
      e.preventDefault();
      if (!validNotify()) return;
      var d = notifyData(), n = CFG.notify || {};
      if (!API && !n.action) { sendViaLine(d); return; }  // 沒有後台也沒有通知表單 -> 走 LINE

      var req;
      if (API) {
        req = apiPost($.extend({ type: 'notify' }, d)).then(function (res) {
          if (!res.ok) throw new Error(res.message || '送出失敗');
        });
      } else {
        var params = new URLSearchParams();
        Object.keys(d).forEach(function (k) { if (n[k] && d[k]) params.append(n[k], d[k]); });
        req = postToGoogle(n.action, params);
      }
      var $btn = $('#notifySubmit').prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> 送出中…');
      req
        .then(function () {
          $('#notifyResult').prop('hidden', false).html(
            '<div class="alert alert-success small mb-0"><i class="bi bi-check-circle"></i> 已收到您的匯款通知！農婦對帳後會盡快安排出貨 🍊</div>');
          $('#notifyForm')[0].reset();
          $('#notifyForm').removeClass('was-validated');
          burst();
        })
        .catch(function (err) {
          var msg = err && err.message && !/fetch|network|abort|HTTP/i.test(err.message) ? err.message : '送出失敗';
          toast(msg + '，請改用 LINE 傳送');
        })
        .finally(function () { $btn.prop('disabled', false).html('<i class="bi bi-send"></i> 送出匯款通知'); });
    });

    $(document).on('input', '.last5-input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 5); });
  }

  /* ---------- 特效 ---------- */
  var revealObserver = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var $el = $(en.target).addClass('in');
      $el.find('.count').each(countUp);
      revealObserver.unobserve(en.target);
    });
  }, { threshold: 0.15 }) : null;

  function observeReveal($els) {
    $els.each(function () {
      if (revealObserver) revealObserver.observe(this);
      else $(this).addClass('in').find('.count').each(countUp);
    });
  }

  function countUp() {
    var $c = $(this), to = Number($c.data('to')) || 0;
    $({ v: 0 }).animate({ v: to }, {
      duration: 1100, easing: 'swing',
      step: function (now) { $c.text(money(Math.round(now))); },
      complete: function () { $c.text(money(to)); }
    });
  }

  function fallingFruit() {
    var $box = $('.hero-fall');
    var items = ['🍊', '🍊', '🍃', '🍊', '🌿'];
    var n = window.innerWidth < 768 ? 8 : 16;
    for (var i = 0; i < n; i++) {
      $('<span>').text(items[i % items.length]).css({
        left: Math.random() * 100 + '%',
        fontSize: (14 + Math.random() * 22) + 'px',
        animationDuration: (8 + Math.random() * 10) + 's',
        animationDelay: (-Math.random() * 16) + 's',
        opacity: 0.25 + Math.random() * 0.5
      }).appendTo($box);
    }
  }

  function burst() {
    var $wrap = $('<div class="burst">').appendTo('body');
    for (var i = 0; i < 24; i++) {
      var a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 160;
      $('<span>').text(i % 3 ? '🍊' : '✨').css({ '--x': Math.cos(a) * r + 'px', '--y': Math.sin(a) * r + 'px', animationDelay: Math.random() * 0.15 + 's' }).appendTo($wrap);
    }
    setTimeout(function () { $wrap.remove(); }, 1600);
  }

  function bindEffects() {
    var $nav = $('#mainNav'), $top = $('.to-top'), $fab = $('.fab-order');
    $(window).on('scroll', function () {
      var y = $(this).scrollTop();
      $nav.toggleClass('scrolled', y > 40);
      $top.toggleClass('show', y > 600);
      $fab.toggleClass('show', y > 400 && y < $('#order').offset().top - window.innerHeight + 100);
      $('.orange-ball, .hero-photo').css('transform', 'translateY(' + (y * 0.15) + 'px) rotate(' + (y * 0.05) + 'deg)');
    }).trigger('scroll');

    // 平滑捲動（扣掉 navbar 高度）
    $(document).on('click', 'a[href^="#"]', function (e) {
      var id = $(this).attr('href');
      if (id.length < 2 || !$(id).length) return;
      e.preventDefault();
      $('html,body').stop().animate({ scrollTop: $(id).offset().top - 64 }, 600);
      var nav = bootstrap.Collapse.getInstance('#navMenu');
      if (nav) nav.hide();
    });
    $top.on('click', function () { $('html,body').animate({ scrollTop: 0 }, 600); });

    // 複製
    $(document).on('click', '.copy-btn', function () {
      var $b = $(this), text = cfg($b.data('copy-cfg'), '');
      if ($b.data('digits')) text = text.replace(/\D/g, '');
      copyText(text);
      toast('已複製：' + text);
      $b.addClass('copied');
      setTimeout(function () { $b.removeClass('copied'); }, 1200);
    });

    // 影片：點了才載入 iframe
    function loadVideo(id) {
      $('#videoBox').html('<iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0" title="YouTube 影片" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>');
    }
    $(document).on('click', '.video-lite', function () { loadVideo($(this).data('id')); });
    $('.video-tabs .nav-link').on('click', function () {
      $(this).addClass('active').siblings().removeClass('active');
      var id = $(this).data('video');
      $('#videoBox').html('<button type="button" class="video-lite" data-id="' + id + '" aria-label="播放影片">' +
        '<img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="果園影片"><span class="play"><i class="bi bi-play-fill"></i></span></button>');
    });

    // 卡片滑鼠傾斜效果（桌機）
    if (window.matchMedia('(hover: hover)').matches) {
      $(document).on('mousemove', '.product-card', function (e) {
        var o = $(this).offset(), w = $(this).outerWidth(), h = $(this).outerHeight();
        var rx = ((e.pageY - o.top) / h - 0.5) * -6, ry = ((e.pageX - o.left) / w - 0.5) * 6;
        $(this).css('transform', 'perspective(800px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) translateY(-4px)');
      }).on('mouseleave', '.product-card', function () { $(this).css('transform', ''); });
    }

    $('#year').text(new Date().getFullYear());
    fallingFruit();
    observeReveal($('.reveal'));
  }

  /* ---------- 啟動 ---------- */
  $(function () {
    bindEffects();
    bindCart();
    bindOrder();
    bindNotify();
    bindGallery();
    bindSync();
    loadConfig().always(applyConfig);
  });
})(jQuery);
