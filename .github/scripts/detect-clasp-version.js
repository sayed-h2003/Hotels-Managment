// يحدّد إصدار clasp المطلوب تثبيته بناءً على شكل ~/.clasprc.json الفعلي (بعد تنظيفه):
// - المفتاح الجذري "tokens" (بصيغة {tokens:{default:{...}}}) ⇒ تنسيق clasp 3.x الحديث.
// - المفتاح الجذري "token" (بصيغة {token:{...}, oauth2ClientSettings:{...}}) ⇒ تنسيق clasp 2.x القديم.
// يكتب النتيجة إلى GITHUB_OUTPUT باسم clasp_version (latest أو 2.4.2) ليستخدمها step تثبيت clasp التالي.
const fs = require('fs');
const path = process.env.HOME + '/.clasprc.json';
const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));

let version;
if (Object.prototype.hasOwnProperty.call(parsed, 'tokens')) {
  version = 'latest';
} else if (Object.prototype.hasOwnProperty.call(parsed, 'token')) {
  version = '2.4.2';
} else {
  console.error('❌ شكل clasprc.json غير معروف: لا يحتوي "tokens" ولا "token" كمفتاح جذري.');
  process.exit(1);
}

console.log('ℹ️ شكل بيانات الاعتماد يطابق تنسيق clasp ' + (version === 'latest' ? '3.x — سنُثبِّت أحدث نسخة' : '2.x — سنُثبِّت 2.4.2') + '.');

const outputPath = process.env.GITHUB_OUTPUT;
if (outputPath) {
  fs.appendFileSync(outputPath, `clasp_version=${version}\n`);
}
