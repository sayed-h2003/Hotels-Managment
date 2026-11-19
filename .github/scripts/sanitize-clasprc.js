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

// حتى الآن أصبح الملف JSON صالحاً للقراءة، لكن أي حرف تحكّم كان مضمَّناً داخل قيمة فعلية
// (مثل \n زائدة في access_token أو refresh_token بسبب لصق/حفظ الملف بنهاية سطر) ما زال
// جزءاً من محتوى تلك القيمة بعد إرجاعها لحرفها الحقيقي — وهذا يكسر clasp عند استخدامها كقيمة
// رأس HTTP (Authorization: Bearer ...) بخطأ "Headers.append: ... is an invalid header value".
// بيانات اعتماد OAuth (client_id/client_secret/refresh_token/access_token/type) لا يجب أبداً
// أن تحتوي أحرف تحكّم أو مسافات زائدة في بدايتها/نهايتها، فنُزيلها نهائياً هنا بعد التحليل.
const parsed = JSON.parse(out); // يرمي خطأً واضحاً إن بقي الملف غير صالح بعد الإصلاح

function stripControlChars(value) {
  if (typeof value === 'string') {
    return value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  }
  if (Array.isArray(value)) {
    return value.map(stripControlChars);
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = stripControlChars(value[key]);
    }
    return result;
  }
  return value;
}

const cleaned = stripControlChars(parsed);
fs.writeFileSync(path, JSON.stringify(cleaned));
console.log('✅ clasprc.json صالح الآن وبدون أي أحرف تحكّم داخل القيم النصية (بعد الإزالة الكاملة لا الإبقاء عليها مُهرَّبة).');
