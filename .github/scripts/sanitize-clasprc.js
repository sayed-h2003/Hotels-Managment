// يُصلح ملف ~/.clasprc.json قبل استخدامه: بعض أدوات اللصق (خصوصاً من محرر نصوص على ويندوز) تُدخِل
// أحرف تحكّم خام (سطر جديد/تبويب/إلخ) داخل قيمة نصية (مثل access_token) بدل الإبقاء عليها كأحرف
// بين العناصر (المسافات هناك مسموحة في JSON) — فيفشل JSON.parse بخطأ "Bad control character
// in string literal" رغم أن الملف يبدو سليماً بصرياً. هذا السكربت يمرّ حرفاً حرفاً، ويُهرِّب فقط
// أي حرف تحكّم خام يقع داخل علامتي اقتباس (قيمة نصية)، تاركاً أي تنسيق/مسافات خارجها كما هي.
const fs = require('fs');
const path = process.env.HOME + '/.clasprc.json';
const raw = fs.readFileSync(path, 'utf8');

let out = '';
let inStr = false;
let esc = false;

for (const ch of raw) {
  if (inStr) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = false; out += ch; continue; }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    out += ch;
  } else {
    if (ch === '"') { inStr = true; out += ch; continue; }
    out += ch;
  }
}

fs.writeFileSync(path, out);
JSON.parse(out); // يرمي خطأً واضحاً إن بقي الملف غير صالح بعد الإصلاح
console.log('✅ clasprc.json صالح بعد إصلاح أي أحرف تحكّم كانت داخل القيم النصية.');
