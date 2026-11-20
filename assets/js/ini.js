/*!
 * 簡易 INI 解析 / 寫回工具（前台 main.js 與後台 admin.html 共用）
 *   INI.parse(text)           -> { sectionName: { key: value } }，並保留區塊順序
 *   INI.update(text, data)    -> 把 data 寫回原文字，保留註解與排版；
 *                                新增的 key / 區塊會補在後面，data 裡沒有的區塊會被刪除
 */
(function (global) {
  'use strict';

  var SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;
  var KV_RE = /^\s*([^=;#\s][^=]*?)\s*=\s*(.*?)\s*$/;
  var COMMENT_RE = /^\s*[;#]/;

  function stripBom(t) { return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t; }

  function unquote(v) {
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
      return v.slice(1, -1);
    }
    return v;
  }

  function parse(text) {
    var out = {};
    var current = null;
    stripBom(String(text || '')).split(/\r?\n/).forEach(function (line) {
      if (!line.trim() || COMMENT_RE.test(line)) return;
      var m = line.match(SECTION_RE);
      if (m) {
        current = m[1].trim();
        if (!out[current]) out[current] = {};
        return;
      }
      m = line.match(KV_RE);
      if (m && current) out[current][m[1]] = unquote(m[2]);
    });
    return out;
  }

  function update(text, data) {
    var lines = stripBom(String(text || '')).split(/\r?\n/);
    var result = [];
    var current = null;
    var skip = false;               // 目前區塊已被刪除
    var written = {};               // written[section][key] = true

    function flushMissing(sec) {
      if (!sec || !data[sec]) return;
      var keys = Object.keys(data[sec]);
      // 新 key 插在區塊最後一個非空白行之後
      var insertAt = result.length;
      while (insertAt > 0 && !result[insertAt - 1].trim()) insertAt--;
      var add = [];
      keys.forEach(function (k) {
        if (!(written[sec] && written[sec][k])) add.push(k + ' = ' + data[sec][k]);
      });
      if (add.length) result.splice.apply(result, [insertAt, 0].concat(add));
    }

    lines.forEach(function (line) {
      var m = line.match(SECTION_RE);
      if (m) {
        if (!skip) flushMissing(current);
        current = m[1].trim();
        skip = !Object.prototype.hasOwnProperty.call(data, current);
        if (!skip) { written[current] = written[current] || {}; result.push(line); }
        return;
      }
      if (skip) {                   // 被刪除的區塊：只丟掉 key=value，保留註解與空行
        if (!line.trim() || COMMENT_RE.test(line)) result.push(line);
        return;
      }
      m = line.match(KV_RE);
      if (m && current && !COMMENT_RE.test(line)) {
        var key = m[1];
        if (Object.prototype.hasOwnProperty.call(data[current], key)) {
          result.push(key + ' = ' + data[current][key]);
          written[current][key] = true;
        }
        // data 中已移除的 key -> 不輸出
        return;
      }
      result.push(line);
    });
    if (!skip) flushMissing(current);

    // 全新的區塊
    Object.keys(data).forEach(function (sec) {
      if (written[sec]) return;
      if (result.length && result[result.length - 1].trim()) result.push('');
      result.push('[' + sec + ']');
      Object.keys(data[sec]).forEach(function (k) { result.push(k + ' = ' + data[sec][k]); });
    });

    return result.join('\r\n').replace(/(\r\n){3,}/g, '\r\n\r\n');
  }

  global.INI = { parse: parse, update: update };
})(window);
