// تنقيح تقرير الأداء قبل حفظه في مستودع عام — طبقة حماية ثانية مستقلة عن الخادم: لو أجاب إصدار قديم
// من التطبيق لا يعرف التنقيح (حدث فعلاً أثناء انتشار نشر جديد)، لا يُحفَظ رغم ذلك أي اسم مستخدم أو
// نص خطأ/console أو معرّف طويل. نفس قواعد _perfRedactReport_ في Code.gs.
const fs = require('fs');
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const ID_RE = /[A-Za-z0-9_-]{25,}/g;

function scrubIds(x) {
  if (typeof x === 'string') return x.replace(ID_RE, '[id]');
  if (Array.isArray(x)) return x.map(scrubIds);
  if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x)) o[k] = scrubIds(x[k]); return o; }
  return x;
}
function blankUsers(x) {
  if (Array.isArray(x)) return x.forEach(blankUsers);
  if (x && typeof x === 'object') for (const k of Object.keys(x)) { if (k === 'user') x[k] = ''; else blankUsers(x[k]); }
}

if (data.health) data.health = scrubIds(data.health);
blankUsers(data);
(data.log || []).forEach(r => {
  if (r.kind === 'resource' || r.kind === 'nav') { r.name = scrubIds(String(r.name || '')); r.details = scrubIds(String(r.details || '')); }
  else r.details = '';
});
if (data.logSummary) (data.logSummary.topConsole || []).forEach(c => { c.msg = ''; });
data.detail = 'redacted';

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log('🔒 نُقِّح التقرير (مستودع عام): بلا مستخدمين ولا نصوص أخطاء/console ولا معرّفات طويلة.');
