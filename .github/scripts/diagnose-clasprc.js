// يطبع فقط أسماء المفاتيح (مستويين) داخل ~/.clasprc.json لمعرفة الشكل الحقيقي للبنية
// التي ينتظرها clasp 2.x ({token:{access_token,...}, oauth2ClientSettings:{...}})
// دون طباعة أي قيمة فعلية (لا توكنات ولا أسرار) — فقط للتشخيص.
const fs = require('fs');
const path = process.env.HOME + '/.clasprc.json';
const raw = fs.readFileSync(path, 'utf8');
const parsed = JSON.parse(raw);

function describe(obj, depth) {
  if (depth > 2 || obj === null || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const t = Array.isArray(val) ? 'array' : typeof val;
    console.log('  '.repeat(depth) + '- ' + key + ' : ' + t);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      describe(val, depth + 1);
    }
  }
}

console.log('شكل ~/.clasprc.json (أسماء المفاتيح فقط، بدون قيم):');
describe(parsed, 0);
