// يُحوّل نسخة النشر من Code.gs فقط (وليس ملف المستودع نفسه): يلفّ كل دالة عامة عليا بـ _perfCall_
// لقياس أدائها تلقائياً عند كل نداء من الواجهة، دون أي تعديل يدوي لمئات الدوال في المصدر.
//
// لماذا تحويل بنائي وقت النشر بدل تعديل الكود المصدري مباشرة:
// - لا يمكن الاعتماد على this/globalThis وقت التنفيذ لتعداد الدوال العليا تلقائياً في بيئة
//   Apps Script V8 (على عكس Rhino القديمة) - محاولة ذلك غير موثوقة.
// - تعديل ~150+ دالة عامة يدوياً في ملف إنتاجي مالي حسّاس مساحة خطأ كبيرة لا تستحق فائدة
//   قياس الأداء وحدها، خصوصاً مع تعذّر اختبارها مباشرة على النظام الفعلي من هذه البيئة.
//
// الأسلوب: acorn يُستخدم فقط لتحديد حدود كل دالة (start/end) واسمها، ثم استبدال نصّي مباشر على
// النص الأصلي الحرفي لكل دالة - وليس إعادة توليد كود كاملة (قد تُفسد التنسيق/التعليقات عبر ملف
// بآلاف الأسطر). كل الاستبدالات تُطبَّق بترتيب تنازلي حسب موضع البداية حتى لا تتأثر مواضع
// الدوال الأخرى التي لم تُعالَج بعد.
const fs = require('fs');
const acorn = require('acorn');

const targetPath = process.argv[2];
if (!targetPath) {
  console.error('Usage: node instrument-functions.js <file>');
  process.exit(1);
}

// مستبعدة لأنها إما نقطة دخول خاصة (doGet) أو جزء من آلية القياس/التصدير نفسها - لفّها قد يُسبب
// تكراراً ذاتياً في القياس أو يُغيّر سلوك نقطة دخول حسّاسة (doGet بلا جلسة مستخدم)
const EXCLUDE = new Set(['doGet', 'flushClientPerfMetrics', 'getPerformanceReport', 'getPerfExportJson']);

// دوال بادئتها "_" (مستبعدة بالقاعدة الافتراضية لأنها "داخلية" حسب اصطلاح هذا المشروع) لكنها
// مُشغَّلة فعلياً عبر Trigger زمني، فنريد قياس مدة تنفيذها لحساب حصة وقت تشغيل المشغّلات اليومية.
// يجب أن تطابق تماماً _TRIGGER_HANDLER_NAMES_ المعرَّفة يدوياً في Code.gs.
const EXTRA_INCLUDE = new Set(['_flushTelegramQueue_', '_flushPerfBuckets_']);

const src = fs.readFileSync(targetPath, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 2020, sourceType: 'script' });

const allTopLevelFns = ast.body.filter(function (n) { return n.type === 'FunctionDeclaration' && n.id; });

const targets = allTopLevelFns
  .filter(function (node) {
    const name = node.id.name;
    const startsWithUnderscore = name.charAt(0) === '_';
    return startsWithUnderscore ? EXTRA_INCLUDE.has(name) : !EXCLUDE.has(name);
  })
  .map(function (node) {
    return { name: node.id.name, start: node.start, end: node.end, idStart: node.id.start, idEnd: node.id.end };
  });

// تنازلياً حسب البداية: عند معالجة كل دالة، كل الدوال الأخرى في targets لها start أكبر أو تساويه
// وقد عُولجت بالفعل (إن كانت)، فلا تغيير يطال نطاق [start,end) لهذه الدالة بعد — بما أنها كلها
// دوال عليا متجاورة في ast.body وليست متداخلة (لا overlap بين أي نطاقين)
targets.sort(function (a, b) { return b.start - a.start; });

let out = src;
for (const t of targets) {
  const original = out.slice(t.start, t.end);
  const relIdStart = t.idStart - t.start;
  const relIdEnd = t.idEnd - t.start;
  // استبدال اسم الدالة في موضعه الدقيق فقط ضمن نص الدالة المأخوذ حرفياً - وليس باستبدال كل
  // ظهور للاسم (لتفادي إصابة متغيّر محلي أو نص بنفس الاسم مصادفة داخل جسم الدالة)
  const renamed = original.slice(0, relIdStart) + t.name + '__impl' + original.slice(relIdEnd);
  const wrapper = renamed + '\nfunction ' + t.name + '() { return _perfCall_(' + JSON.stringify(t.name) + ', arguments, ' + t.name + '__impl); }\n';
  out = out.slice(0, t.start) + wrapper + out.slice(t.end);
}

fs.writeFileSync(targetPath, out);
console.log('✅ تحويل القياس: لُفّت ' + targets.length + ' دالة من أصل ' + allTopLevelFns.length + ' دالة عليا.');
