// يحقن قيمة سرّ تقرير الأداء (من أسرار GitHub) داخل نسخة النشر فقط وقت البناء، بدل اشتراط ضبطه
// يدوياً في Script Properties أيضاً. ملف المستودع يحتفظ دائماً بقيمة فارغة؛ ولا تُطبع القيمة أبداً.
const fs = require('fs');

const file = process.argv[2];
const PLACEHOLDER = 'var PERF_REPORT_SECRET_BUILD = "";';
const secret = String(process.env.PERF_REPORT_SECRET || '').trim();

const src = fs.readFileSync(file, 'utf8');
const count = src.split(PLACEHOLDER).length - 1;
if (count !== 1) {
  console.error('❌ لم يُعثر على سطر PERF_REPORT_SECRET_BUILD الفارغ مرة واحدة بالضبط (وُجد ' + count + ').');
  process.exit(1);
}
if (!secret) {
  console.log('ℹ️ السرّ PERF_REPORT_SECRET غير مضبوط في GitHub — سيبقى فارغاً (نقطة التقرير ترفض الطلبات).');
  process.exit(0);
}
fs.writeFileSync(file, src.replace(PLACEHOLDER, 'var PERF_REPORT_SECRET_BUILD = ' + JSON.stringify(secret) + ';'));
console.log('✅ تم حقن سرّ تقرير الأداء في نسخة النشر (طوله ' + secret.length + ' حرفاً).');
