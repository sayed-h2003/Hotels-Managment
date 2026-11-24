/**
 * ======================================================================
 * نظام إدارة تعاقدات وحجوزات الفنادق (HotelApp) - تطبيق Google Apps Script ويب مستقل
 * ======================================================================
 * خريطة الملف (استخدم "بحث" Ctrl+F عن هذه العناوين للقفز مباشرة):
 *   1. تعريف بنية الشيتات (SHEET_SCHEMAS) + إعداد النظام لأول مرة
 *   2. تسجيل الدخول / الخروج / الجلسات النشطة (Heartbeat)
 *   3. الصلاحيات (عرض/حفظ صلاحيات المستخدمين + الفنادق المسموح بها)
 *   4. سجل التعديلات (Audit Log) - تسجيل واسترجاع
 *   5. تفضيلات المستخدم الشخصية (أعمدة ظاهرة، فلاتر محفوظة...)
 *   6. التقويم الهجري (تحويل وتنسيق)
 *   7. التعاقدات (CRUD كامل)
 *   8. الحجوزات (CRUD + فحص توافر السعة + حجوزات "الشراء" بالسالب)
 *   9. شاشة التوافر الشهري (بناء شبكة الأيام والسعة اليومية)
 *  10. إدارة المستخدمين (إضافة/حذف/تفعيل/تعطيل/إعادة تعيين كلمة مرور)
 *  11. التقرير المالي (حساب التكلفة/المبيعات بنظام الليالي الصحيح)
 *
 * كل دالة أدناه مسبوقة بتعليق سطر واحد يشرح وظيفتها لتسهيل الصيانة.
 * الدوال التي تبدأ وتنتهي بشرطة سفلية _مثل_هذه_ هي دوال مساعدة داخلية (Private) وليست مُصمَّمة للاستدعاء من الواجهة مباشرة.
 * ======================================================================
 */

// ===================== 1. تعريف بنية الشيتات =====================
// إضافة عمود جديد مستقبلاً يجب أن تكون بنهاية المصفوفة دائماً حتى لا تنكسر الأعمدة القائمة.
// التعديلات الجديدة في Contracts_Master: أضيفت 4 أعمدة بالنهاية (13–16)، لا تُكسر أي بيانات قديمة.
// أُضيف العمود 17 (Nusuk_Capacity) لدعم شاشة نسك: الطاقة الاستيعابية بالأفراد/السراير للعقد كامل
// 0=Contract_ID  1=Hotel_Name  2=Contracting_Party  3=Start_Date  4=End_Date
// 5=Nights  6=Room_Count  7=Room_Price  8=Total_Value  9=Created_By
// 10=Created_At  11=Last_Edit_Summary  12=Is_Deleted
// 13=City  14=Contract_Type("رئيسي"/"إضافي")  15=Parent_Contract_ID  16=Notes  17=Nusuk_Capacity
const SHEET_SCHEMAS = {
  "Users_Master":        ["Username", "Password", "FullName", "Role", "IsActive", "Salt"],
  "Active_Sessions":     ["FullName", "LastPing", "Username"],
  "Permissions_Master":  ["Username", "Screen", "CanView", "CanAdd", "CanEdit", "CanDelete"],
  "Contracts_Master":    ["Contract_ID", "Hotel_Name", "Contracting_Party", "Start_Date", "End_Date",
                           "Nights", "Room_Count", "Room_Price", "Total_Value",
                           "Created_By", "Created_At", "Last_Edit_Summary", "Is_Deleted",
                           "City", "Contract_Type", "Parent_Contract_ID", "Notes", "Nusuk_Capacity"],
  // التعديلات الجديدة في Bookings_Master: أضيفت 3 أعمدة بالنهاية (16–18)، لا تُكسر أي بيانات قديمة.
  // 15=Notes  16=Over_Capacity(true/false)  17=Over_Capacity_Type("مسجل اوفر"/"معدل اوفر")
  // التعديلات الجديدة: أضيفت 3 أعمدة بالنهاية (19-21) لبيانات تأكيد الحجز - لا تُكسر أي بيانات قديمة
  // 18=Confirmation_Type("Tentative Confirmation"/"Definite Confirmation")  19=Reservation_Manager  20=Client_Option_Date
  "Bookings_Master":     ["Booking_ID", "Contract_ID", "Client_Name", "Collection_Account", "Status",
                           "Room_Count", "Check_In", "Check_Out", "Nights", "Sale_Price", "Booking_Value",
                           "Created_By", "Created_At", "Last_Edit_Summary", "Is_Deleted",
                           "Notes", "Over_Capacity", "Over_Capacity_Type",
                           "Confirmation_Type", "Reservation_Manager", "Client_Option_Date",
                           "Booking_Payment_Date"],
  "Collection_Accounts": ["Account_ID", "Account_Name", "Is_Active"],
  "Global_Audit_Log":    ["Log_ID", "Timestamp", "Screen", "RecordType", "Record_ID",
                           "Field_Changed", "Old_Value", "New_Value", "Change_Summary", "User"],
  "ID_Sequences":        ["Prefix", "Last_Number"],
  "User_Preferences":    ["Username", "PrefKey", "PrefValue"],
  // نظام التنبيهات: كل تنبيه يُنشأ مرة واحدة، ويُقرأ لكل مستخدم على حدة عبر Notification_Reads
  "Notifications_Master":["Notification_ID", "Type", "Booking_ID", "Hotel_Name", "Message", "Details", "Created_At", "Created_By"],
  "Notification_Reads":  ["Notification_ID", "Username", "Read_At"],
  // دفعات سداد التعاقدات: كل صف يمثل قسطاً مستحقاً بتاريخ معيّن (Amount = قيمة القسط)
  // v3.32 — Paid_Amount/Paid_Date أصبحا قيمتين مُحتسَبتين تلقائياً (مجموع/أحدث تاريخ) من شيت Contract_Payment_Receipts
  // أدناه، وتُحدَّثان تلقائياً بعد أي إضافة/تعديل/حذف سداد فعلي — لا تُكتَبان مباشرة بعد الآن
  "Contract_Payments":   ["Payment_ID", "Contract_ID", "Amount", "Due_Date", "Paid_Amount", "Paid_Date",
                           "Notes", "Created_By", "Created_At", "Is_Deleted"],
  // v3.32 — سجل تفصيلي لكل عملية سداد فعلية على قسط تعاقد (يماثل Account_Payments لكن لجانب الفندق):
  // كل صف = دفعة واحدة مسدَّدة فعلياً لفندق، بتاريخها وبيانها وملاحظاتها الخاصة (بدل مجرد رقم إجمالي بلا تفاصيل)
  // Linked_Account_Payment_ID (اختياري): يُملأ فقط عند إنشاء هذه الدفعة تلقائياً عبر ميزة "الدفعة المزدوجة"
  // (عميل سدَّد مباشرة لفندق) — يشير لرقم دفعة العميل المقابلة في Account_Payments لتتبّع الطرفين معاً
  "Contract_Payment_Receipts": ["Receipt_ID", "Payment_ID", "Contract_ID", "Amount", "Pay_Date",
                           "Statement", "Notes", "Created_By", "Created_At", "Is_Deleted", "Linked_Account_Payment_ID"],
  // قائمة الانتظار: طلبات عملاء لفترات لا تتوفر لها سعة حالياً - تُحوَّل لحجز فعلي عند توفر الإمكانية
  // Last_Edit_Summary أُضيف لاحقاً بنهاية البنية (عمود 14) لتتبع آخر تعديل يدوي على الطلب
  "Waitlist_Master":     ["Waitlist_ID", "Contract_ID", "Client_Name", "Collection_Account", "Check_In", "Check_Out",
                           "Room_Count", "Sale_Price", "Notes", "Status", "Created_By", "Created_At", "Is_Deleted",
                           "Last_Edit_Summary"],
  // اتفاقيات نسك: كل اتفاقية ترتبط بحجز (Booking_ID) موجود مسبقاً؛ الحجز الواحد يقبل عدة اتفاقيات
  // Persons_Count = عدد الأفراد/السراير للاتفاقية، Check_In/Out قابلين للتعديل يدوياً دون تأثير على الحجز الأصلي
  // Agreement_Number = رقم يدوي بأي طول (يُخزَّن كنص لتفادي فقدان الأصفار البادئة أو تحويل الأرقام الطويلة لصيغة علمية)
  "Nusuk_Agreements":    ["Agreement_ID", "Hotel_Name", "Booking_ID", "Agreement_Number", "Persons_Count",
                           "Check_In", "Check_Out", "Nights", "Notes", "Created_By", "Created_At",
                           "Last_Edit_Summary", "Is_Deleted"],
  // دفعات الحسابات (شاشة الحسابات): كل صف = دفعة مسدَّدة من جهة تحصيل أو عميل
  // Party_Type: "collection" (جهة تحصيل - يُخزَّن Account_ID في Party_Key) أو "client" (عميل - يُخزَّن اسم العميل في Party_Key)
  // كل المبالغ بالريال السعودي (ر.س)
  // v3.23 — Hotel_Name (اختياري): يُتيح تخصيص الدفعة لفندق بعينه؛ يبقى فارغاً لدفعة عامة غير مخصَّصة لفندق واحد
  // v3.32 — Linked_Hotel_Receipt_ID (اختياري): يُملأ فقط عند إنشاء هذه الدفعة عبر ميزة "الدفعة المزدوجة" —
  // يشير لرقم دفعة السداد المقابلة بجانب الفندق في Contract_Payment_Receipts لتتبّع الطرفين معاً
  "Account_Payments":    ["Payment_ID", "Party_Type", "Party_Key", "Party_Name", "Amount", "Payment_Date",
                           "Method", "Notes", "Created_By", "Created_At", "Is_Deleted", "Hotel_Name",
                           "Linked_Hotel_Receipt_ID"],
  // V3.80 — مرفقات الدفعات (صور/PDF إيصالات السداد): Kind = account (دفعة عميل/جهة) أو receipt (سداد فندق)
  // الملف نفسه خاص على Drive (بلا رابط عام) ويُعرض عبر البرنامج فقط؛ في الدفعة المزدوجة يظهر المرفق عند الطرفين معاً
  "Payment_Attachments": ["Attachment_ID", "Kind", "Ref_ID", "File_ID", "File_Name", "Mime_Type", "Size",
                           "Uploaded_By", "Uploaded_At", "Is_Deleted"],
  // V3.82 — معاينة مصغّرة (JPEG base64 ≈ 10–25KB) لكل صورة مرفقة: تصل مع قائمة المرفقات فلا نداء لكل صورة. شيت منفصل كي لا تثقل
  // قراءة شيت المرفقات الذي يُقرأ مع كل كشف حساب (أعداد المرفقات).
  "Payment_Attachment_Thumbs": ["Attachment_ID", "Thumb_B64"],
  // v3.44 — قياس أداء الخادم (يجمع قياس الخادم نفسه + قياس رحلة المتصفح الكاملة معاً):
  // تجميع كل 10 دقائق (عدد/مجموع المدة/أقصى/فشل) لكل دالة، يُفرَّغ من الكاش عبر مشغّل زمني
  "Perf":     ["Day", "Hour", "Function", "Count", "Sum_Duration_Ms", "Max_Ms", "Fails", "Version"],
  // تفاصيل كل نداء أبطأ من 3 ثوانٍ تحديداً (دالة خادم مقاسة من الخادم نفسه بدون مستخدم معروف،
  // أو دالة بادئتها "client:" مقاسة من المتصفح لرحلة كاملة وفيها اسم المستخدم)
  "PerfSlow": ["Timestamp", "Function", "Duration_Ms", "User", "Success", "Version"],
  // v3.50 — سجل تفصيلي لكل تنفيذ + console + network من الخادم والمتصفح (يُحتفَظ بآخر 7 أيام فقط)
  "PerfLog":  ["Timestamp", "Source", "Kind", "Name", "Duration_Ms", "Status", "User", "Version", "Details"]
};

// المصدر الوحيد والموحّد لقائمة الشاشات/الصلاحيات في كامل النظام (خادم + واجهة)
// الواجهة تجلب هذه القائمة ديناميكياً عبر getAllScreensList() بدل الاحتفاظ بنسخة منفصلة قد تتأخر عن التحديث
// group: main=شاشات رئيسية، sub=صلاحيات فرعية، report=تقارير، audit=سجلات، notif=تنبيهات، admin=إدارة
const ALL_SCREENS = [
  { id: "contracts",                  label: "📄 التعاقدات", group:"main" },
  { id: "bookings",                   label: "🛎 الحجوزات", group:"main" },
  { id: "availability",               label: "📅 شارت التوافر", group:"main" },
  { id: "waitlist",                   label: "📋 قائمة الانتظار", group:"main" },
  { id: "nusuk",                      label: "🌙 نسك (اتفاقيات المعتمرين)", group:"main" },
  { id: "dashboard",                  label: "📊 لوحة المعلومات", group:"main" },
  { id: "accounts",                   label: "💰 الحسابات (جهات التحصيل والعملاء)", group:"main" },
  { id: "availability_finance",       label: "💰 الجانب المالي (التوافر + الحجوزات)", group:"sub" },
  { id: "availability_booking_data",  label: "📋 التوافر — بيانات الحجز", group:"sub" },
  { id: "overcapacity_notifications", label: "⚠️ تنبيهات تجاوز الطاقة (قديم)", group:"sub" },
  { id: "booking_confirmation",       label: "📧 إصدار تأكيد الحجز", group:"sub" },
  { id: "financial_report",           label: "📊 التقرير المالي", group:"report" },
  { id: "daily_statement",            label: "📋 البيان اليومي (مبيعات وتكلفة يومية)", group:"sub" },
  { id: "audit_log",                  label: "🕓 سجل التعديلات العام", group:"audit" },
  { id: "audit_log_contracts",        label: "📄 سجل تعديلات التعاقدات", group:"audit" },
  { id: "audit_log_bookings",         label: "🛎 سجل تعديلات الحجوزات", group:"audit" },
  { id: "notif_overcap_new",          label: "🔔 تنبيه: حجز جديد بالأوفر", group:"notif" },
  { id: "notif_new_booking",          label: "🔔 تنبيه: حجز جديد",         group:"notif" },
  { id: "notif_overcap_edit",         label: "🔔 تنبيه: تعديل حجز بالأوفر", group:"notif" },
  { id: "notif_overcap_resolved",     label: "🔔 تنبيه: توفر إمكانية لحجز أوفر", group:"notif" },
  { id: "notif_booking_cancelled",    label: "🔔 تنبيه: إلغاء حجز", group:"notif" },
  { id: "notif_booking_edit",         label: "🔔 تنبيه: تعديل حجز", group:"notif" },
  { id: "notif_contract_edit",        label: "🔔 تنبيه: تعديل تعاقد", group:"notif" },
  { id: "notif_payment_due",          label: "🔔 تنبيه: استحقاق دفعة سداد", group:"notif" },
  { id: "notif_waitlist_available",   label: "🔔 تنبيه: توفر إمكانية لطلب قائمة انتظار", group:"notif" },
  { id: "notif_confirmation_option_due", label: "🔔 تنبيه: اقتراب تاريخ سداد تأكيد الحجز", group:"notif" },
  { id: "permissions_admin",          label: "🔐 إدارة الصلاحيات", group:"admin" }
];

// تُعيد قائمة كل الشاشات/الصلاحيات المتاحة بالنظام - المصدر الوحيد الذي تعتمد عليه الواجهة لبناء شاشة الصلاحيات ديناميكياً
function getAllScreensList() { _apiGuard_();
  var _fn="[getAllScreensList]"; _logInfo_(_fn, "START | "+"");
  try {
  return ALL_SCREENS;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// تُعيد خريطة (اسم المستخدم → الاسم الكامل) لكل المستخدمين - تُستخدم بالواجهة لعرض الاسم الفعلي بدل اسم الدخول
// في كل مكان يظهر فيه "منشئ الحجز/التعاقد" أو "المستخدم" بسجل التعديلات، بدلاً من تخزين نسخة مكررة من الاسم مع كل سجل
function getUsernameFullNameMap() { _apiGuard_();
  var _fn="[getUsernameFullNameMap]"; _logInfo_(_fn, "START | "+"");
  try {
  var data = _getSheetValues_("Users_Master");
  var map = {};
  for (var i=1; i<data.length; i++) { if (data[i][0]) map[data[i][0]] = data[i][2] || data[i][0]; }
  return map;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ===================== 2. نقطة الدخول =====================
// ===================== طبقة الأداء (Memoization لكل تنفيذ) =====================
// كل نداء google.script.run هو "تنفيذ" مستقل على الخادم؛ هذه الطبقة تمنع إعادة فتح
// الـ Spreadsheet أو إعادة قراءة نفس الشيت أكثر من مرة داخل التنفيذ الواحد.
// ملاحظة مهمة: تُستخدم _getSheetValues_ في مسارات "القراءة فقط". أي دالة تكتب ثم
// تعيد القراءة داخل نفس التنفيذ يجب أن تستدعي _invalidateSheetCache_ بعد الكتابة.
var __SS_HANDLE = null;
function _getSS_() {
  if (!__SS_HANDLE) __SS_HANDLE = SpreadsheetApp.getActiveSpreadsheet();
  return __SS_HANDLE;
}

var __SHEET_VALUES_CACHE = {};
// قراءة كامل بيانات شيت مرة واحدة لكل تنفيذ (تُستخدم للقراءة فقط)
function _getSheetValues_(sheetName) {
  if (!__SHEET_VALUES_CACHE.hasOwnProperty(sheetName)) {
    __SHEET_VALUES_CACHE[sheetName] = _getOrCreateSheet_(sheetName).getDataRange().getValues();
    try { _incrementDailyQuota_("SHEETREAD"); } catch(e) {} // مؤشر تقريبي - فقط قراءات هذه النقطة المحدَّدة
  }
  return __SHEET_VALUES_CACHE[sheetName];
}
// إبطال كاش شيت معيّن (أو الكل) بعد أي عملية كتابة داخل نفس التنفيذ
function _invalidateSheetCache_(sheetName) {
  if (sheetName) delete __SHEET_VALUES_CACHE[sheetName];
  else __SHEET_VALUES_CACHE = {};
  if (!sheetName || sheetName === "Users_Master" || sheetName === "Permissions_Master") { try { _invalidateAuthCache_(); } catch (e) {} }
}


/**
 * ======================================================================
 * نظام تسجيل الأحداث والأخطاء (Logging System)
 * ======================================================================
 * LOG_LEVEL يتحكم في كمية السجلات المُنتجة:
 *   0 = صامت تماماً (الإنتاج عند الحاجة لأقصى أداء)
 *   1 = أخطاء فقط  ← الأنسب للإنتاج العادي
 *   2 = أخطاء + بداية/نهاية كل دالة ← للتشخيص والتطوير
 *
 * لتغيير المستوى: غيّر قيمة LOG_LEVEL فقط ثم انشر نسخة جديدة.
 */
var LOG_LEVEL = 1; // 0=صامت | 1=أخطاء فقط | 2=تشخيص كامل

function _logInfo_(fn, msg) {
  if (LOG_LEVEL >= 2) console.log(fn + " " + msg);
}
function _logError_(fn, e) {
  if (LOG_LEVEL >= 1) console.error(fn + " ERROR | " + (e.message||e) + " | stack: " + (e.stack||""));
}

// يبقى فارغاً في المستودع دائماً؛ تحقن خطوة النشر (inject-perf-secret.js) قيمة السرّ من GitHub في نسخة النشر فقط
var PERF_REPORT_SECRET_BUILD = "";

// v3.50 — doGet خارج تحويل القياس البنائي، فيُسجَّل تنفيذه هنا يدوياً في سجل التنفيذ دون تغيير ناتجه
function doGet(e) {
  var start = Date.now(), ok = true, name = "doGet:index";
  try {
    var p = (e && e.parameter) || {};
    name = p.action === "perfReport" ? "doGet:perfReport" : (p.page === "guide" ? "doGet:guide" : "doGet:index");
    __EXEC_CONSOLE = [];
  } catch (e0) {}
  __PERF_DEPTH++; __TRUSTED_DEPTH++; // V3.63 — نقطة دخول موثوقة
  try {
    return _doGetCore_(e);
  } catch (err) {
    ok = false; throw err;
  } finally {
    __TRUSTED_DEPTH--;
    __PERF_DEPTH = Math.max(0, __PERF_DEPTH - 1);
    try { _perfLogPush_({ t: new Date(start).toISOString(), src: "web", kind: "exec", name: name, ms: Date.now() - start, ok: ok, err: "", v: APP_VERSION, con: __EXEC_CONSOLE.slice(0, 30) }); } catch (e1) {}
  }
}

function _doGetCore_(e) {
  var page = e && e.parameter && e.parameter.page;
  var action = e && e.parameter && e.parameter.action;
  // نقطة سحب تقرير الأداء آلياً (GitHub Actions) - محمية بمفتاح سرّي في Script Properties فقط،
  // وليس بتسجيل دخول مستخدم (لا جلسة متصفح هنا). يفشل مغلقاً دائماً إن لم يُضبط المفتاح بعد.
  if (action === 'perfReport') {
    try {
      // trim للطرفين: لصق القيمة في واجهة GitHub أو Script Properties كثيراً ما يضيف سطراً/مسافة خفية.
      // واسم المفتاح نفسه يُطابَق بعد تجاهل المسافات وحالة الأحرف (خطأ شائع عند إدخاله يدوياً)
      var _allProps = PropertiesService.getScriptProperties().getProperties();
      var _keys = Object.keys(_allProps);
      var _norm = function(s){ return String(s).replace(/\s+/g,'').toUpperCase(); };
      var _matchKey = null;
      for (var _i = 0; _i < _keys.length; _i++) { if (_norm(_keys[_i]) === 'PERF_REPORT_SECRET') { _matchKey = _keys[_i]; break; } }
      // Script Properties إن وُجدت تتقدّم، وإلا القيمة المحقونة من أسرار GitHub وقت النشر
      var expected = String(_matchKey ? _allProps[_matchKey] : PERF_REPORT_SECRET_BUILD).trim();
      var given = String(e.parameter.key || '').trim();
      // تشخيص بلا كشف أي قيمة: عدد الخصائص + أسماء ما يشبه PERF فقط (بين علامتين لإظهار أي مسافة)
      var _similar = _keys.filter(function(k){ return /PERF/i.test(k); }).map(function(k){ return '[' + k + ']'; });
      // رسائل مميَّزة للتشخيص دون كشف أي قيمة
      var authErr = !expected ? ('not_configured: PERF_REPORT_SECRET غير موجود لا في Script Properties ولا محقوناً من أسرار GitHub وقت النشر — عدد الخصائص في هذا المشروع: '
                                  + _keys.length + (_similar.length ? '، أسماء مشابهة: ' + _similar.join(' ') : '، لا توجد أسماء مشابهة'))
                  : !given ? 'missing_key'
                  : given !== expected ? 'key_mismatch: القيمة في GitHub لا تطابق Script Properties'
                  : '';
      if (authErr) {
        return ContentService.createTextOutput(JSON.stringify({ success:false, error:authErr }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // قبل بناء التقرير: تأكد من وجود مشغّل التفريغ، وفرّغ النوافذ المكتملة كي يشمل التقرير أحدث البيانات
      var health = { flushTrigger: _ensurePerfFlushTriggerThrottled_(true) };
      try { health.flush = _flushPerfBucketsCore_(); } catch(fe) { health.flush = { error: String(fe && fe.message || fe) }; }
      health.diag = _perfDiag_();
      var data = _gatherPerfDashboardData_({ hours: e.parameter.hours });
      data.health = health;
      data.exportedAt = new Date().toISOString();
      // التقرير يُحفَظ في مستودع قد يكون عاماً: إخفاء المستخدمين والنصوص والمعرّفات إلا بطلب صريح detail=full
      data.detail = (e.parameter.detail === 'full') ? 'full' : 'redacted';
      if (data.detail !== 'full') data = _perfRedactReport_(data);
      return ContentService.createTextOutput(JSON.stringify({ success:true, data:data }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({ success:false, error:'internal_error' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  if (page === 'guide') {
    return HtmlService.createHtmlOutputFromFile('Setup_Guide')
      .setTitle('دليل الإعداد والتشغيل — HotelApp')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ادارة الفنادق')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// يُرجع رابط صفحة الدليل للواجهة (الرابط الحالي للنشر + ?page=guide)
function getSetupGuideUrl() { _apiGuard_();
  return ScriptApp.getService().getUrl() + '?page=guide';
}

// ===================== 3. تهيئة قاعدة البيانات =====================
function initializeSystem() { _apiGuard_();
  var _fn="[initializeSystem]"; _logInfo_(_fn, "START | "+"");
  try {
  var ss = _getSS_();
  Object.keys(SHEET_SCHEMAS).forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    var headers = SHEET_SCHEMAS[sheetName];
    var existingFirstRow = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
    if (!existingFirstRow[0]) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else if (sheet.getLastColumn() < headers.length) {
      // امتداد رأس الأعمدة تلقائياً عند إضافة أعمدة جديدة بنهاية بنية شيت موجود مسبقاً
      var missing = headers.slice(sheet.getLastColumn());
      sheet.getRange(1, sheet.getLastColumn()+1, 1, missing.length).setValues([missing]);
    }
  });
  _invalidateSheetCache_("Users_Master"); // V3.55 — يمسح لقطة الأدوار أيضاً
  var usersSheet = _getOrCreateSheet_("Users_Master");
  if (usersSheet.getLastRow() < 2) {
    var _adminSalt = _pwGenerateSalt_(); usersSheet.appendRow(["admin", _pwHash_("admin123", _adminSalt), "مدير النظام", "Admin", true, _adminSalt]);
  }
  var collSheet = _getOrCreateSheet_("Collection_Accounts");
  if (collSheet.getLastRow() < 2) {
    collSheet.appendRow(["COL-001", "غير محدد", true]);
  }
  return { success: true, message: "تمت تهيئة النظام بنجاح." };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ===================== 4. تسجيل الدخول والجلسات =====================
// ═══════════════════════════════════════════════════════════════════════════
// V3.63 — جلسة موثّقة من الخادم
// كان الخادم يصدّق اسم المستخدم الذي يرسله المتصفح في كل نداء (بلا أي إثبات) — فمن يملك رابط البرنامج يستطيع
// تنفيذ أي دالة باسم المدير. الآن:
//   1) loginUser يُصدر رمز جلسة عشوائياً (256 بت) يُحفظ في الخادم.
//   2) المتصفح ينادي بوابة واحدة: api(token, fnName, ...args). البوابة تحلّ الرمز إلى مستخدم فعّال، وتكتب اسمه
//      هو في موضع وسيط الهوية بالدالة المطلوبة (مهما أرسل المتصفح)، ثم تنفّذها.
//   3) كل دالة عامة تبدأ بـ _apiGuard_(): النداء المباشر لها من المتصفح (خارج البوابة) مرفوض.
//   4) جدول _apiTable_ قائمة بيضاء صريحة: ما ليس فيه لا يُنادى من المتصفح إطلاقاً.
// نقاط الدخول الموثوقة (تفتح "الثقة" لما تستدعيه داخلياً): api، loginUser، doGet، مشغّلات trigger_*، ومشغّلا القياس/تليجرام.
// ═══════════════════════════════════════════════════════════════════════════
var __TRUSTED_DEPTH = 0, __API_CTX = null;
var _AUTH_ERR_ = "انتهت الجلسة أو تم تحديث البرنامج — حدّث الصفحة وسجّل الدخول من جديد. [SESSION_EXPIRED]";
// V3.64 — ساعة مراحل: تسجّل زمن كل مرحلة داخل دالة ثقيلة كعيّنة "~الدالة:المرحلة" (لمعرفة أين يذهب الزمن فعلاً قبل أي تحسين)
var __LAP = null;
function _lapStart_() { __LAP = Date.now(); }
function _lap_(label) { try { if (__LAP == null) return; var n = Date.now(); _recordPerfSample_("~" + label, n - __LAP, true); __LAP = n; } catch (e) {} }
function _apiGuard_() { if (__TRUSTED_DEPTH > 0) return; throw new Error(_AUTH_ERR_); }
function _trusted_(fn) { __TRUSTED_DEPTH++; try { return fn(); } finally { __TRUSTED_DEPTH--; } }

var _SES_PREFIX = "SES_", _SES_TTL_SEC = 21600, _SES_REFRESH_MS = 30 * 60 * 1000, _SES_MAX_IDLE_MS = 24 * 60 * 60 * 1000;
// الرمز يُحفظ في الكاش (سريع) وفي خصائص السكربت (دائم، يحمي من إخلاء الكاش). لا يُخزَّن في أي شيت.
function _sessionCreate_(username, fullName) {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "").toLowerCase();
  // V3.72 — عند الدخول يُكتب الرمز في الكاش فقط (سريع). النسخة الدائمة في خصائص السكربت تُكتب عند أول نداء بهذا الرمز
  // (النبضة الموازية بعد الدخول بلحظات) — كتابة الخاصية كانت ~0.9 ث من زمن رد الدخول نفسه (قياس V3.71).
  var t0 = Date.now(), rec = JSON.stringify({ u: String(username), f: String(fullName || username), r: t0, c: t0, p: 0 });
  var cached = false;
  try { CacheService.getScriptCache().put(_SES_PREFIX + token, rec, _SES_TTL_SEC); cached = true; } catch (e) {}
  if (!cached) { try { PropertiesService.getScriptProperties().setProperty(_SES_PREFIX + token, rec); } catch (e2) {} } // الكاش تعذّر: نحفظها دائمة فوراً
  return token;
}
function _sessionResolve_(token) {
  token = String(token || "");
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  var key = _SES_PREFIX + token, raw = null, fromProp = false;
  try { raw = CacheService.getScriptCache().get(key); } catch (e) {}
  if (!raw) { try { raw = PropertiesService.getScriptProperties().getProperty(key); fromProp = true; } catch (e2) {} }
  if (!raw) return null;
  var rec; try { rec = JSON.parse(raw); } catch (e3) { return null; }
  if (!rec || !rec.u) return null;
  var now = Date.now();
  if (now - (Number(rec.r) || 0) > _SES_MAX_IDLE_MS) { _sessionKill_(token); return null; }
  // جلسة لم تُكتب نسختها الدائمة بعد لا يراها _killUserSessions_ (يعدّ الخصائص فقط) — فنفحص ختم الإنهاء الخاص بالمستخدم
  if (rec.p === 0 && (Number(rec.c) || 0) <= _sessionKillStamp_(rec.u)) { _sessionKill_(token); return null; }
  if (fromProp || rec.p === 0 || now - rec.r > _SES_REFRESH_MS) { // تمديد دوري مع النشاط + أول نداء بعد الدخول يكتب النسخة الدائمة
    rec.r = now; rec.p = 1; var s = JSON.stringify(rec);
    try { CacheService.getScriptCache().put(key, s, _SES_TTL_SEC); } catch (e4) {}
    try { PropertiesService.getScriptProperties().setProperty(key, s); } catch (e5) {}
  }
  rec.token = token;
  return rec;
}
function _sessionKill_(token) {
  try { CacheService.getScriptCache().remove(_SES_PREFIX + token); } catch (e) {}
  try { PropertiesService.getScriptProperties().deleteProperty(_SES_PREFIX + token); } catch (e2) {}
}
// V3.72 — ختم إنهاء لكل مستخدم: أي جلسة أُنشئت قبله ولم تُكتب نسختها الدائمة بعد (في الكاش فقط) تُرفض عند أول نداء
var _SES_KILL_PREFIX = "SESKILL_";
function _sessionKillKey_(username) { return _SES_KILL_PREFIX + String(username || "").toLowerCase().slice(0, 60); }
function _sessionKillStamp_(username) {
  var k = _sessionKillKey_(username), v = null;
  try { v = CacheService.getScriptCache().get(k); } catch (e) {}
  if (v == null) { try { v = PropertiesService.getScriptProperties().getProperty(k); } catch (e2) {} }
  return Number(v) || 0;
}
// إنهاء كل جلسات مستخدم (تغيير/إعادة تعيين كلمة المرور، تعطيل، حذف، إعادة تسمية) عدا رمز يُستثنى اختيارياً
function _killUserSessions_(username, exceptToken) {
  try { // الختم أولاً: يغطي الجلسات التي ما زالت في الكاش فقط (الرمز المستثنى له نسخة دائمة دائماً لأنه هو صاحب النداء الحالي)
    var stamp = String(Date.now()), kk = _sessionKillKey_(username);
    try { PropertiesService.getScriptProperties().setProperty(kk, stamp); } catch (eS) {}
    try { CacheService.getScriptCache().put(kk, stamp, _SES_TTL_SEC); } catch (eC) {}
  } catch (e0) {}
  try {
    var props = PropertiesService.getScriptProperties(), all = props.getProperties(), ul = String(username || "").toLowerCase();
    Object.keys(all).forEach(function(k) {
      if (k.indexOf(_SES_PREFIX) !== 0) return;
      var tok = k.slice(_SES_PREFIX.length); if (exceptToken && tok === exceptToken) return;
      var rec = null; try { rec = JSON.parse(all[k]); } catch (e) {}
      if (!rec || String(rec.u || "").toLowerCase() === ul) _sessionKill_(tok);
    });
  } catch (e2) {}
}
// تنظيف الجلسات الخاملة أكثر من يوم (يُستدعى من مشغّل القياس، مرة بالساعة على الأكثر)
function _sessionsPrune_() {
  try {
    var props = PropertiesService.getScriptProperties(), now = Date.now();
    if (now - (Number(props.getProperty("SES_LAST_PRUNE")) || 0) < 60 * 60 * 1000) return 0;
    props.setProperty("SES_LAST_PRUNE", String(now));
    var all = props.getProperties(), n = 0;
    Object.keys(all).forEach(function(k) {
      if (k.indexOf(_SES_KILL_PREFIX) === 0) { if (now - (Number(all[k]) || 0) > _SES_MAX_IDLE_MS) { try { props.deleteProperty(k); } catch (eK) {} } return; } // أختام قديمة: لا جلسة كاش تعيش أكثر من 6 ساعات
      if (k.indexOf(_SES_PREFIX) !== 0 || k === "SES_LAST_PRUNE") return;
      var rec = null; try { rec = JSON.parse(all[k]); } catch (e) {}
      if (!rec || now - (Number(rec.r) || 0) > _SES_MAX_IDLE_MS) { _sessionKill_(k.slice(_SES_PREFIX.length)); n++; }
    });
    return n;
  } catch (e2) { return 0; }
}
// قفل محاولات الدخول: 5 محاولات فاشلة لنفس اسم المستخدم خلال 10 دقائق ⇒ رفض حتى تنقضي المهلة
var _LOGIN_MAX_FAILS = 5, _LOGIN_LOCK_SEC = 600;
function _loginFailKey_(username) { return "LOGINFAIL_" + String(username || "").toLowerCase().slice(0, 60); }
function _loginFails_(username) { try { return parseInt(CacheService.getScriptCache().get(_loginFailKey_(username)), 10) || 0; } catch (e) { return 0; } }
function _loginFailNote_(username) { try { CacheService.getScriptCache().put(_loginFailKey_(username), String(_loginFails_(username) + 1), _LOGIN_LOCK_SEC); } catch (e) {} }
function _loginFailClear_(username) { try { CacheService.getScriptCache().remove(_loginFailKey_(username)); } catch (e) {} }

// V3.70 — طابور الإشعارات المؤجَّلة: خاصية واحدة (مصفوفة JSON) تُقرأ وتُكتب داخل قفل الكتابة
var __DEFER_NOTIFS = false, __DEFERRED_NOTIFS = [];
var _NOTIF_QUEUE_PROP = "NOTIF_QUEUE_V1";
function _notifQueuePush_(items) {
  try {
    var props = PropertiesService.getScriptProperties();
    var cur = []; try { cur = JSON.parse(props.getProperty(_NOTIF_QUEUE_PROP) || "[]") || []; } catch (e) { cur = []; }
    var s = JSON.stringify(cur.concat(items));
    if (s.length > 8000) return false; // قريب من حد الخاصية: تُنشأ فوراً بدل المخاطرة بضياعها
    props.setProperty(_NOTIF_QUEUE_PROP, s);
    return true;
  } catch (e2) { return false; }
}
// يفرّغ الطابور: يسحبه داخل القفل (فلا يُنشأ إشعار مرتين من مفرّغين متزامنين) ثم ينشئ الإشعارات خارجه
function _notifQueueDrain_() {
  var items = [];
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty(_NOTIF_QUEUE_PROP)) return 0;
    _withLock_(function() {
      try { items = JSON.parse(props.getProperty(_NOTIF_QUEUE_PROP) || "[]") || []; } catch (e) { items = []; }
      props.deleteProperty(_NOTIF_QUEUE_PROP);
    }, 15000);
  } catch (e2) { return 0; }
  items.forEach(function(a) { try { _createNotification_.apply(null, a); } catch (eN) { _logError_("[_notifQueueDrain_]", eN); } });
  return items.length;
}
// تناديها الواجهة بالخلفية بعد كتابة أعادت العلامة _nq
function flushDeferredNotifications(currentUser) { _apiGuard_();
  return { created: _notifQueueDrain_() };
}
// نداءات لا تحتاج القفل: قراءات، والفحوصات الدورية والتصدير/الإرسال (طويلة وتقفل داخلياً ما يلزم)
var _API_NOLOCK_RE = /^(get|poll|ping|flush|search|list|check|load|is|has|export|count|preview|validate|logout|mark|send|generate|test|globalSearch|upload)/; // V3.82 — upload: رفع الإيصال يقفل عند كتابة الشيت فقط (كان يحجز قفل الكتابة كل مدة رفع الملف لـ Drive)
// البوابة الوحيدة لنداءات المتصفح بعد الدخول
function api(token, fnName) {
  var args = Array.prototype.slice.call(arguments, 2);
  var def = _apiTable_()[String(fnName)];
  if (!def || typeof def.f !== "function") throw new Error("دالة غير متاحة: " + String(fnName).slice(0, 60));
  var ses = _sessionResolve_(token);
  if (!ses) throw new Error(_AUTH_ERR_);
  var ul = String(ses.u).toLowerCase(), snap = _authSnapshot_();
  // مستخدم محذوف أو معطَّل: تُسحب جلسته فوراً (كان التعطيل يُفحص عند الدخول فقط)
  if (!snap.roles[ul] || (snap.inactive && snap.inactive[ul])) { _sessionKill_(ses.token); throw new Error(_AUTH_ERR_); }
  if (def.a && !_isAdmin_(ses.u)) throw new Error("غير مصرح.");
  if (def.u >= 0) { while (args.length <= def.u) args.push(undefined); args[def.u] = ses.u; }
  if (def.n != null) { while (args.length <= def.n) args.push(undefined); args[def.n] = ses.f; }
  var prev = __API_CTX; __API_CTX = ses; __TRUSTED_DEPTH++;
  // V3.65 — كل عملية كتابة تمرّ من هنا داخل قفل السكربت (القفل يُعاد دخوله، فالدوال التي تقفل بنفسها لا تتأثر).
  // كانت ~20 دالة كتابة (حذف دفعات/إيصالات، قائمة الانتظار، إدارة المستخدمين، الأدوار…) تقرأ رقم الصف ثم تكتب
  // بلا قفل، فعمليتان متزامنتان قد تكتبان على الصف الخطأ.
  var run = function() { return def.f.apply(null, args); };
  // V3.70 — الإشعارات المتولّدة عن عملية الكتابة تُؤجَّل لما بعد الرد (كانت ~1.5 ث من زمن حفظ الحجز: فهرس التكرار + إضافة
  // الصف + جدولة مشغّل تليجرام). تُحفظ في طابور، والواجهة تطلب تفريغه بنداء خلفي لا ينتظره المستخدم؛ ومشغّل الـ10 دقائق شبكة أمان.
  var runDeferred = function() {
    __DEFER_NOTIFS = true; __DEFERRED_NOTIFS = [];
    var res;
    try { res = run(); }
    finally {
      __DEFER_NOTIFS = false;
      var q = __DEFERRED_NOTIFS; __DEFERRED_NOTIFS = [];
      if (q.length) {
        var plain = res && typeof res === "object" && !Array.isArray(res);
        if (plain && _notifQueuePush_(q)) res._nq = 1;       // الواجهة تطلب التفريغ
        else q.forEach(function(a) { try { _createNotification_.apply(null, a); } catch (eN) { _logError_("[api→notif]", eN); } }); // لا مكان للعلامة أو تعذّر الحفظ: فوراً كما كان
      }
    }
    return res;
  };
  try { return _API_NOLOCK_RE.test(String(fnName)) ? run() : _withLock_(runDeferred, 30000); }
  finally { __TRUSTED_DEPTH--; __API_CTX = prev; if (String(fnName) === "logoutUser") _sessionKill_(ses.token); }
}
// V3.63 — القائمة البيضاء لبوابة api (مولَّدة من تواقيع الدوال؛ اختبار v363 يطابقها مع الكود والواجهة عند كل تغيير).
// f: الدالة، u: موضع وسيط هوية المستخدم (-1 = لا وسيط هوية؛ يكفي جلسة صالحة)، n: موضع الاسم الكامل، a: للمدير فقط.
function _apiTable_() {
  return {
    getAllScreensList: { f: getAllScreensList, u: -1 },
    getUsernameFullNameMap: { f: getUsernameFullNameMap, u: -1 },
    getSetupGuideUrl: { f: getSetupGuideUrl, u: -1, a: 1 },
    flushDeferredNotifications: { f: flushDeferredNotifications, u: 0 },
    logoutUser: { f: logoutUser, u: 0, n: 1 },
    pingHeartbeatAndGetActiveUsers: { f: pingHeartbeatAndGetActiveUsers, u: 0, n: 1 },
    saveUserPermissions: { f: saveUserPermissions, u: 2 },
    getRecordAuditHistory: { f: getRecordAuditHistory, u: 1 },
    saveUserPreference: { f: saveUserPreference, u: 0 },
    getUserPreference: { f: getUserPreference, u: 0 },
    getContractMonthsByHotel: { f: getContractMonthsByHotel, u: 0 },
    getDistinctHotelNames: { f: getDistinctHotelNames, u: 0 },
    getUserAllowedHotels: { f: getUserAllowedHotels, u: 1 },
    saveUserAllowedHotels: { f: saveUserAllowedHotels, u: 2 },
    changeUserPassword: { f: changeUserPassword, u: 0 },
    getContracts: { f: getContracts, u: 0 },
    getMainContractsForHotel: { f: getMainContractsForHotel, u: -1 },
    saveContract: { f: saveContract, u: 1 },
    getContractPayments: { f: getContractPayments, u: 1 },
    saveContractPayment: { f: saveContractPayment, u: 1 },
    deleteContractPayment: { f: deleteContractPayment, u: 1 },
    recordContractPaymentReceipt: { f: recordContractPaymentReceipt, u: 1 },
    getContractPaymentReceipts: { f: getContractPaymentReceipts, u: 1 },
    editContractPaymentReceipt: { f: editContractPaymentReceipt, u: 1 },
    deleteContractPaymentReceipt: { f: deleteContractPaymentReceipt, u: 1 },
    saveDualPayment: { f: saveDualPayment, u: 1 },
    uploadPaymentAttachment: { f: uploadPaymentAttachment, u: 6 },
    listPaymentAttachments: { f: listPaymentAttachments, u: 2 },
    getPaymentAttachmentData: { f: getPaymentAttachmentData, u: 1 },
    deletePaymentAttachment: { f: deletePaymentAttachment, u: 1 },
    linkAccountPaymentToHotel: { f: linkAccountPaymentToHotel, u: 2 },
    restorePartyDualPayments: { f: restorePartyDualPayments, u: 2 },
    checkDuePaymentsAndNotify: { f: checkDuePaymentsAndNotify, u: 0 },
    getActiveContractsForDropdown: { f: getActiveContractsForDropdown, u: 0 },
    getCollectionAccounts: { f: getCollectionAccounts, u: -1 },
    addCollectionAccount: { f: addCollectionAccount, u: 1 },
    deleteCollectionAccount: { f: deleteCollectionAccount, u: 1, a: 1 },
    getPrefetchBundle: { f: getPrefetchBundle, u: 0 },
    getUsersScreenData: { f: getUsersScreenData, u: 0 },
    getBookingsAll: { f: getBookingsAll, u: 0 },
    getBookingFullDetails: { f: getBookingFullDetails, u: 1 },
    saveBooking: { f: saveBooking, u: 1 },
    deleteBooking: { f: deleteBooking, u: 1 },
    getOverCapacityNotifications: { f: getOverCapacityNotifications, u: 0 },
    getGlobalNotificationSettings: { f: getGlobalNotificationSettings, u: 0 },
    setNotifTypeEnabled: { f: setNotifTypeEnabled, u: 2 },
    setTelegramNotifTypeEnabled: { f: setTelegramNotifTypeEnabled, u: 2 },
    getMyNotifications: { f: getMyNotifications, u: 0 },
    markNotificationRead: { f: markNotificationRead, u: 1 },
    markAllNotificationsRead: { f: markAllNotificationsRead, u: 0 },
    clearOverCapacityFlag: { f: clearOverCapacityFlag, u: 1 },
    manuallyClearOverCapacityFlag: { f: manuallyClearOverCapacityFlag, u: 1 },
    getAvailabilityData: { f: getAvailabilityData, u: 3 },
    getAvailabilityDataMulti: { f: getAvailabilityDataMulti, u: 2 },
    addUser: { f: addUser, u: 4 },
    toggleUserActive: { f: toggleUserActive, u: 1 },
    setUserActiveState: { f: setUserActiveState, u: 2 },
    deleteUser: { f: deleteUser, u: 1 },
    adminResetPassword: { f: adminResetPassword, u: 2 },
    getUserPermissionsForAdmin: { f: getUserPermissionsForAdmin, u: 1 },
    getContractDateRange: { f: getContractDateRange, u: 1 },
    getFullProfitReport: { f: getFullProfitReport, u: 1 },
    getDailyStatementSummary: { f: getDailyStatementSummary, u: 3 },
    getDailyStatementMonthDetail: { f: getDailyStatementMonthDetail, u: 5 },
    getDashboardData: { f: getDashboardData, u: 0 },
    addToWaitlist: { f: addToWaitlist, u: 1 },
    getWaitlist: { f: getWaitlist, u: 0 },
    cancelWaitlistEntry: { f: cancelWaitlistEntry, u: 1 },
    convertWaitlistToBooking: { f: convertWaitlistToBooking, u: 1 },
    checkWaitlistAvailabilityAndNotify: { f: checkWaitlistAvailabilityAndNotify, u: -1 },
    getWaitlistEntryDetails: { f: getWaitlistEntryDetails, u: 1 },
    editWaitlistEntry: { f: editWaitlistEntry, u: 1 },
    saveTelegramSettings: { f: saveTelegramSettings, u: 2 },
    getTelegramSettings: { f: getTelegramSettings, u: 0 },
    testTelegramConnection: { f: testTelegramConnection, u: 0 },
    sendTelegramCheckinReminders: { f: sendTelegramCheckinReminders, u: -1 },
    bulkImportBookings: { f: bulkImportBookings, u: 1 },
    updateUserDetails: { f: updateUserDetails, u: 3 },
    saveCompanyBranding: { f: saveCompanyBranding, u: 3 },
    getCompanyBranding: { f: getCompanyBranding, u: -1 },
    getBookingForConfirmation: { f: getBookingForConfirmation, u: 1 },
    getReservationManagers: { f: getReservationManagers, u: -1 },
    saveBookingConfirmation: { f: saveBookingConfirmation, u: 4 },
    generateReportPdfForShare: { f: generateReportPdfForShare, u: 2 },
    deleteSharedReportFile: { f: deleteSharedReportFile, u: 1 },
    checkConfirmationOptionDatesAndNotify: { f: checkConfirmationOptionDatesAndNotify, u: -1 },
    getHijriMonthStarts: { f: getHijriMonthStarts, u: 1 },
    saveHijriMonthCorrections: { f: saveHijriMonthCorrections, u: 2 },
    getRoles: { f: getRoles, u: -1, a: 1 },
    saveRole: { f: saveRole, u: 2 },
    deleteRole: { f: deleteRole, u: 1 },
    applyRoleToUser: { f: applyRoleToUser, u: 2 },
    clearUserRoleName: { f: clearUserRoleName, u: 1 },
    updateRoleAndPropagate: { f: updateRoleAndPropagate, u: 2 },
    getRolePermissions: { f: getRolePermissions, u: -1, a: 1 },
    getSessionTimeoutMinutes: { f: getSessionTimeoutMinutes, u: -1 },
    saveSessionTimeoutMinutes: { f: saveSessionTimeoutMinutes, u: 1 },
    getBookingsPage: { f: getBookingsPage, u: 3 },
    getGlobalAuditLogPage: { f: getGlobalAuditLogPage, u: 3 },
    globalSearch: { f: globalSearch, u: 1 },
    exportReportToDrivePdf: { f: exportReportToDrivePdf, u: 2 },
    exportReportToDriveExcel: { f: exportReportToDriveExcel, u: 3 },
    getAppBootstrap: { f: getAppBootstrap, u: 0, n: 1 },
    getBookingModalBootstrap: { f: getBookingModalBootstrap, u: 0 },
    getContractModalBootstrap: { f: getContractModalBootstrap, u: 0 },
    repairArabicDigitsInSheets: { f: repairArabicDigitsInSheets, u: 0 },
    purgeHotelsCompletely: { f: purgeHotelsCompletely, u: 1 },
    setupApplicationComplete: { f: setupApplicationComplete, u: 0 },
    getSystemFolders: { f: getSystemFolders, u: 0 },
    renameSystemFolder: { f: renameSystemFolder, u: 2 },
    getSystemTriggers: { f: getSystemTriggers, u: 0 },
    enableSystemTrigger: { f: enableSystemTrigger, u: 1 },
    disableSystemTrigger: { f: disableSystemTrigger, u: 1 },
    runSystemTriggerNow: { f: runSystemTriggerNow, u: 1 },
    pollAppState: { f: pollAppState, u: 0, n: 1 },
    getAvailabilityVersion: { f: getAvailabilityVersion, u: -1 },
    flushClientPerfMetrics: { f: flushClientPerfMetrics, u: 1 },
    getPerfCopyAllJson: { f: getPerfCopyAllJson, u: 0 },
    getPerfLog: { f: getPerfLog, u: 0 },
    getPerformanceReport: { f: getPerformanceReport, u: 0 },
    getPerfExportJson: { f: getPerfExportJson, u: 0 },
    getBookingsForNusukSelector: { f: getBookingsForNusukSelector, u: 1 },
    getNusukAgreementsForBooking: { f: getNusukAgreementsForBooking, u: 1 },
    saveNusukAgreement: { f: saveNusukAgreement, u: 1 },
    deleteNusukAgreement: { f: deleteNusukAgreement, u: 1 },
    getNusukAgreementDetails: { f: getNusukAgreementDetails, u: 1 },
    getNusukGridData: { f: getNusukGridData, u: 4 },
    getAccountsSummary: { f: getAccountsSummary, u: 1 },
    getHotelPaymentSchedule: { f: getHotelPaymentSchedule, u: 1 },
    getAccountStatement: { f: getAccountStatement, u: 2 },
    saveAccountPayment: { f: saveAccountPayment, u: 1 },
    deleteAccountPayment: { f: deleteAccountPayment, u: 1 }
  };
}
// نقطتا تشغيل يدوي من محرر السكربت فقط (الدوال المنتهية بـ "_" لا تُنادى من المتصفح)
function editorInitializeSystem_() { return _trusted_(function() { return initializeSystem(); }); }
function editorSetupDriveFolder_() { return _trusted_(function() { return setupDriveFolderManual(); }); }

// V3.59 — opts.boot: حزمة الإقلاع وبيانات الشاشة الرئيسية تعود مع رد الدخول نفسه (كانت 3 رحلات متتالية:
// دخول ← إقلاع ← بيانات الشاشة ≈ 10 ث حتى ظهور شارت التوافر). فشل أي إضافة لا يُفشل الدخول (الواجهة تطلبها منفصلة).
function loginUser(username, password, opts) {
  var _fn="[loginUser]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", password:[hidden]");
  __TRUSTED_DEPTH++; // V3.63 — نقطة دخول موثوقة (تستدعي دوال عامة محروسة داخلياً)
  try {
  var _prevFails = _loginFails_(username);
  if (_prevFails >= _LOGIN_MAX_FAILS) return { success: false, message: "محاولات دخول فاشلة كثيرة. حاول مرة أخرى بعد 10 دقائق." };
  var ss = _getSS_();
  var sheet = _getOrCreateSheet_("Users_Master");
  var uRows = _getSheetValues_("Users_Master"); // V3.76 — القراءة المشتركة لكل تنفيذ: حزمة الإقلاع كانت تقرأ الشيت نفسه مرة ثانية
  for (var i = 1; i < uRows.length; i++) {
    if (String(uRows[i][0]).toLowerCase() !== String(username).toLowerCase()) continue;
    var stored = uRows[i][1];   // كلمة المرور المخزَّنة (مشفّرة أو نصّية قديمة)
    var salt = uRows[i][5]||""; // الملح (فارغ للحسابات القديمة قبل الترحيل)
    if (!_pwVerify_(password, stored, salt)) { _loginFailNote_(username); return { success: false, message: "اسم المستخدم أو كلمة المرور غير صحيحة!" }; }
    var fullName = uRows[i][2], role = uRows[i][3], isActive = uRows[i][4] !== false;
    var storedUsername = String(uRows[i][0]);
    if (!isActive) return { success: false, message: "هذا الحساب معطّل. تواصل مع مدير النظام." };
    // ترحيل شفاف للحساب القديم لصيغة مشفَّرة بعد أول دخول ناجح
    if (!_pwIsHashed_(stored)) { _pwMigrateIfNeeded_(sheet, i, password); _invalidateSheetCache_("Users_Master"); }
    // V3.64 — سطر "المتصلون" يُكتب من نبضة النداء الدوري الأول (ينطلق بالتوازي فور الدخول) بدل قراءة + حذف + إضافة هنا
    // (ثلاث عمليات شيت كانت تؤخّر رد الدخول الذي يحمل الآن الإقلاع وبيانات الشاشة الرئيسية)
    _lapStart_();
    logAudit("شاشة الدخول", "تسجيل دخول", "N/A", "", "", "", "تسجيل دخول ناجح", fullName);
    _lap_("loginUser:audit");
    var permissions = getUserPermissions(storedUsername, role);
    if (_prevFails > 0) _loginFailClear_(username); // V3.76 — لا عملية كاش بلا داعٍ حين لا محاولات فاشلة سابقة
    var out = { success: true, username: storedUsername, fullName: fullName, role: role,
             permissions: permissions, screens: ALL_SCREENS, systemVersion: APP_VERSION,
             token: _sessionCreate_(storedUsername, fullName) }; // V3.63 — رمز الجلسة (يبقى في ذاكرة الصفحة فقط)
    _lap_("loginUser:permsSession");
    if (opts && opts.boot) {
      try { out.boot = getAppBootstrap(storedUsername, fullName, { brandingVer: opts.brandingVer, lite: true }); } catch (eB) { _logError_(_fn, eB); }
      _lap_("loginUser:bootTail"); // معظم زمن الإقلاع مسجَّل في عيّنات ~boot:* (ساعة المراحل مشتركة)
      if (out.boot) { try { out.home = _loginHomeData_(storedUsername, role, permissions, out.boot, opts); } catch (eH) { _logError_(_fn, eH); } }
      if (out.boot && out.boot.collectionAccounts) out.boot.collectionAccounts = _collMarkUsed_(out.boot.collectionAccounts, true); // V3.73 — بلا قراءة إضافية: فقط إن قُرئت الحجوزات للشاشة الرئيسية
      _lap_("loginUser:home");
    }
    return out;
  }
  _loginFailNote_(username);
  return { success: false, message: "اسم المستخدم أو كلمة المرور غير صحيحة!" };
  } catch(e) { _logError_(_fn, e); throw e; }
  finally { __TRUSTED_DEPTH--; }
}

// تسجيل الخروج: يحذف الجلسة النشطة للمستخدم من شيت Active_Sessions ويسجّل الحدث في سجل التعديلات
function logoutUser(username, fullName) { _apiGuard_();
  var _fn="[logoutUser]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"fullName:"+String(JSON.stringify(fullName)||"").slice(0, 80));
  try {
  removeActiveSessionRow(username);
  logAudit("شاشة الدخول", "تسجيل خروج", "N/A", "", "", "", "تسجيل خروج", fullName || username);
  return { success: true };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// نبضة دورية (Heartbeat) تُحدّث وقت آخر ظهور للمستخدم النشط للحفاظ على حالة الاتصال
function pingUserHeartbeat(username, fullName) { _apiGuard_();
  var _fn="[pingUserHeartbeat]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"fullName:"+String(JSON.stringify(fullName)||"").slice(0, 80));
  try {
  var ss = _getSS_();
  var sheet = _getOrCreateSheet_("Active_Sessions");
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]) === String(username)) {
      sheet.getRange(i+1,1).setValue(fullName || username); // تحديث الاسم الكامل دائماً
      sheet.getRange(i+1,2).setValue(new Date()); return {success:true}; }
  }
  sheet.appendRow([fullName || username, new Date(), username]);
  return { success: true };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// نفس نبضة pingUserHeartbeat، لكنها تُعيد أيضاً قائمة كل المستخدمين المتصلين حالياً (لعرضهم في الشريط العلوي)
function pingHeartbeatAndGetActiveUsers(username, fullName) { _apiGuard_();
  var _fn="[pingHeartbeatAndGetActiveUsers]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"fullName:"+String(JSON.stringify(fullName)||"").slice(0, 80));
  try {
  pingUserHeartbeat(username, fullName);
  return getActiveUsersList();
  } catch(e) { _logError_(_fn, e); throw e; }
}

// دالة مساعدة داخلية: تحذف صف جلسة مستخدم معيّن من شيت الجلسات النشطة
function removeActiveSessionRow(username) { _apiGuard_();
  var _fn="[removeActiveSessionRow]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80));
  try {
  var ss = _getSS_();
  var sheet = _getOrCreateSheet_("Active_Sessions");
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][2]) === String(username)) sheet.deleteRow(i+1);
  }
  } catch(e) { _logError_(_fn, e); throw e; }
}

// تُعيد قائمة المستخدمين المتصلين حالياً (آخر نبضة خلال 30 دقيقة) كمصفوفة كائنات {fullName, username}
function getActiveUsersList() { _apiGuard_();
  var _fn="[getActiveUsersList]"; _logInfo_(_fn, "START | "+"");
  try {
  var rows = _getOrCreateSheet_("Active_Sessions").getDataRange().getValues();
  var seen = {}, out = [], now = new Date().getTime();
  for (var i = 1; i < rows.length; i++) {
    var un = String(rows[i][2]||rows[i][0]||"").trim();
    if (!un || seen[un]) continue;
    var ts = rows[i][1] ? new Date(rows[i][1]).getTime() : 0;
    if (now - ts < 30*60*1000) {
      seen[un] = true;
      out.push({ fullName: String(rows[i][0]||un), username: un });
    }
  }
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ===================== 5. الصلاحيات =====================
function getUserPermissions(username, role) { _apiGuard_();
  var _fn="[getUserPermissions]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"role:"+String(JSON.stringify(role)||"").slice(0, 80));
  try {
  var perms = {};
  ALL_SCREENS.forEach(function(scr) {
    perms[scr.id] = (String(role).toLowerCase() === "admin")
      ? { canView:true, canAdd:true, canEdit:true, canDelete:true }
      : { canView:false, canAdd:false, canEdit:false, canDelete:false };
  });
  if (String(role).toLowerCase() === "admin") return perms;
  var mine = _authSnapshot_().perms[String(username)] || {};
  Object.keys(mine).forEach(function(sid) {
    var r = mine[sid];
    if (perms[sid]) perms[sid] = { canView:r[0]===true, canAdd:r[1]===true, canEdit:r[2]===true, canDelete:r[3]===true };
  });
  return perms;
  } catch(e) { _logError_(_fn, e); throw e; }
}


// V3.55 — استبدال صفوف صلاحيات مستخدم/مستخدمين بكتابة واحدة: كان الحفظ يحذف كل صف بـ deleteRow ثم يضيف كل شاشة
// بـ appendRow (~40 شاشة ⇒ ~80 عملية كتابة منفصلة لكل مستخدم، وتُضرب في عدد المستخدمين عند نشر دور). يُستدعى تحت القفل.
function _replacePermissionRows_(matchUser, newRows) {
  var sheet = _getOrCreateSheet_("Permissions_Master");
  var data = sheet.getDataRange().getValues();
  var width = Math.max(6, (data[0] || []).length);
  var pad = function(r) { r = r.slice(0, width); while (r.length < width) r.push(""); return r; };
  var keep = [pad(data.length ? data[0] : SHEET_SCHEMAS["Permissions_Master"])];
  for (var i = 1; i < data.length; i++) if (!matchUser(String(data[i][0]))) keep.push(pad(data[i]));
  newRows.forEach(function(r) { keep.push(pad(r)); });
  var maxRows = sheet.getMaxRows();
  if (keep.length > maxRows) sheet.insertRowsAfter(maxRows, keep.length - maxRows);
  sheet.getRange(1, 1, keep.length, width).setValues(keep);
  var extra = data.length - keep.length;
  if (extra > 0) sheet.deleteRows(keep.length + 1, extra);
  _invalidateSheetCache_("Permissions_Master");
}

// يحفظ/يُحدّث صلاحيات مستخدم معيّن لكل الشاشات دفعة واحدة (Admin فقط)
function saveUserPermissions(targetUsername, permsArray, actingUsername) { _apiGuard_();
  var _fn="[saveUserPermissions]"; _logInfo_(_fn, "START | "+"targetUsername:"+String(JSON.stringify(targetUsername)||"").slice(0, 80)+", "+"permsArray:[data]"+", "+"actingUsername:"+String(JSON.stringify(actingUsername)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Permissions_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  if (_getUserRole_(actingUsername) !== "Admin") throw new Error("غير مصرح.");
  _replacePermissionRows_(function(u) { return u === String(targetUsername); },
    (permsArray || []).map(function(p) { return [targetUsername, p.screen, !!p.canView, !!p.canAdd, !!p.canEdit, !!p.canDelete]; }));
  _invalidateAuthCache_(); // V3.55 — بعد الكتابة أيضاً (يغلق نافذة إعادة بناء اللقطة بقيم قديمة أثناء الكتابة)
  logAudit("إدارة الصلاحيات","تعديل صلاحيات",targetUsername,"","","","تم تحديث صلاحيات "+targetUsername, actingUsername);
  _bumpNotifVersion_(); // الصلاحيات تحدد أنواع الإشعارات الظاهرة للمستخدم
  return { success: true };

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// دالة مساعدة داخلية: تُعيد دور مستخدم معيّن (Admin/User) من شيت المستخدمين
function _getUserRole_(username) {
  var r = _authSnapshot_().roles[String(username).toLowerCase()];
  return r == null ? "User" : r;
}

// V3.55 — لقطة الأدوار والصلاحيات: كل نداء خادم تقريباً يفحص الصلاحية، وكان يقرأ شيتي المستخدمين والصلاحيات كاملين
// في كل نداء. الآن: نسخة في كاش السكريبت لمدة 60 ثانية + نسخة داخل التنفيذ، وتُمسح فور أي تعديل على الشيتين
// (كل دوال الكتابة عليهما تستدعي _invalidateSheetCache_ للشيت، وهي تمسح اللقطة). لا تحوي كلمات مرور أو أملاح.
// V3.72 — 5 دقائق (كانت 60 ث): كل كتابة على المستخدمين/الصلاحيات من البرنامج تُبطل اللقطة فوراً، فالمدة تخص التعديل اليدوي في الشيت فقط
var _AUTH_CACHE_KEY = "AUTH_SNAPSHOT_V2", _AUTH_CACHE_TTL_SEC = 300;
var __AUTH_SNAPSHOT = null;
function _authSnapshot_() {
  if (__AUTH_SNAPSHOT) return __AUTH_SNAPSHOT;
  try {
    var raw = CacheService.getScriptCache().get(_AUTH_CACHE_KEY);
    if (raw) return (__AUTH_SNAPSHOT = JSON.parse(raw));
  } catch (e) {}
  var snap = { roles: {}, perms: {}, inactive: {} };
  var users = _getSheetValues_("Users_Master");
  // أول تطابق يفوز (نفس سلوك البحث الخطي السابق)
  for (var i = users.length - 1; i >= 1; i--) {
    if (users[i][0] === "" || users[i][0] == null) continue;
    snap.roles[String(users[i][0]).toLowerCase()] = String(users[i][3] || "User");
    if (users[i][4] === false) snap.inactive[String(users[i][0]).toLowerCase()] = true; else delete snap.inactive[String(users[i][0]).toLowerCase()];
  }
  var pd = _getSheetValues_("Permissions_Master");
  for (var j = 1; j < pd.length; j++) {
    var u = String(pd[j][0]); if (!u) continue;
    var m = snap.perms[u] || (snap.perms[u] = {});
    m[pd[j][1]] = [pd[j][2], pd[j][3], pd[j][4], pd[j][5]]; // آخر صف يفوز (نفس سلوك الحلقة السابقة)
  }
  try { var s = JSON.stringify(snap); if (s.length < 95000) CacheService.getScriptCache().put(_AUTH_CACHE_KEY, s, _AUTH_CACHE_TTL_SEC); } catch (e2) {}
  return (__AUTH_SNAPSHOT = snap);
}
function _invalidateAuthCache_() {
  __AUTH_SNAPSHOT = null;
  try { CacheService.getScriptCache().remove(_AUTH_CACHE_KEY); } catch (e) {}
}

// دالة مساعدة: هل هذا المستخدم مدير؟ (مقاومة لاختلاف حالة الأحرف: Admin/admin/ADMIN كلها تُعامَل كمدير)
function _isAdmin_(username) {
  return String(_getUserRole_(username)).toLowerCase() === "admin";
}

// حارس أمني مركزي: يتحقق أن المستخدم يملك صلاحية إجراء معيّن (عرض/إضافة/تعديل/حذف) على شاشة معيّنة، ويرمي خطأ إن لم يملكها
function _requirePermission_(username, screenId, action) {
  if (_isAdmin_(username)) return true;
  var perms = getUserPermissions(username, _getUserRole_(username));
  if (!perms[screenId] || !perms[screenId][action]) throw new Error("ليس لديك صلاحية كافية لتنفيذ هذا الإجراء.");
  return true;
}

// ===================== 6. العداد الدائم =====================
// دالة مساعدة مركزية للتعافي الذاتي: تُعيد الشيت المطلوب، وتُنشئه تلقائياً بالرؤوس الصحيحة إن لم يكن موجوداً بعد
// (تحل مشكلة عدم تشغيل initializeSystem() يدوياً بعد إضافة شيتات جديدة للبنية - تمنع أخطاء "Cannot read properties of null")
// V3.55 — مقبض كل شيت يُحفظ لكل تنفيذ: getSheetByName نداء خدمة كان يتكرر في كل قراءة/كتابة/سجل تدقيق
var __SHEET_HANDLES = {};
function _getOrCreateSheet_(sheetName) {
  if (__SHEET_HANDLES[sheetName]) return __SHEET_HANDLES[sheetName];
  var ss = _getSS_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    var headers = SHEET_SCHEMAS[sheetName];
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  }
  return (__SHEET_HANDLES[sheetName] = sheet);
}

function _getNextSequentialId_(prefix, digits) {
  digits = digits || 3;
  return _withLock_(function() { // V3.55 — عبر القفل القابل لإعادة الدخول (لا يفك قفل عملية الحفظ المحيطة)
    var seqSheet = _getOrCreateSheet_("ID_Sequences");
    var data = seqSheet.getDataRange().getValues(), rowIdx=-1, lastNum=0;
    for (var i=1; i<data.length; i++) {
      if (String(data[i][0]) === prefix) { rowIdx=i+1; lastNum=parseInt(data[i][1])||0; break; }
    }
    var nextNum = lastNum+1;
    if (rowIdx>-1) seqSheet.getRange(rowIdx,2).setValue(nextNum); else seqSheet.appendRow([prefix,nextNum]);
    return prefix + String(nextNum).padStart(digits,"0");
  }, 15000);
}

// يُولّد رقماً تسلسلياً بسيطاً (بدون حرف بادئة) لأغراض أخرى داخل النظام
function _getNextPlainNumber_(seqKey, digits) {
  digits = digits || 3;
  return _withLock_(function() { // V3.55 — عبر القفل القابل لإعادة الدخول (لا يفك قفل عملية الحفظ المحيطة)
    var seqSheet = _getOrCreateSheet_("ID_Sequences");
    var data = seqSheet.getDataRange().getValues(), rowIdx=-1, lastNum=0;
    for (var i=1; i<data.length; i++) {
      if (String(data[i][0]) === seqKey) { rowIdx=i+1; lastNum=parseInt(data[i][1])||0; break; }
    }
    var nextNum = lastNum+1;
    if (rowIdx>-1) seqSheet.getRange(rowIdx,2).setValue(nextNum); else seqSheet.appendRow([seqKey,nextNum]);
    return String(nextNum).padStart(digits,"0");
  }, 15000);
}

// ===================== 7. سجل التدقيق =====================
function logAudit(screen, actionType, recordId, fieldChanged, oldValue, newValue, changeSummary, user) { _apiGuard_();
  var _fn="[logAudit]"; _logInfo_(_fn, "START | "+"screen:"+String(JSON.stringify(screen)||"").slice(0, 80)+", "+"actionType:"+String(JSON.stringify(actionType)||"").slice(0, 80)+", "+"recordId:"+String(JSON.stringify(recordId)||"").slice(0, 80));
  try {
  var sheet = _getOrCreateSheet_("Global_Audit_Log");
  var logId = "LOG-" + _fmtDate_(new Date(), _tz_(), "yyyyMMddHHmmssSSS");
  sheet.appendRow([logId, new Date(), screen, actionType, recordId,
    fieldChanged||"", oldValue||"", newValue||"", changeSummary||"", user||""]);
  } catch(e) { _logError_(_fn, e); throw e; }
}

// سجل تعديلات سجل واحد بعينه (حجز/تعاقد) - يُستدعى من داخل شاشة عرض/تعديل الحجز أو التعاقد
// currentUser اختياري: إن أُرسل، يُشترط أن يملك المستخدم صلاحية عرض سجل التعديلات لهذا النوع (حجوزات/تعاقدات) وإلا يُرفض الطلب من الخادم مباشرة (خط دفاع ثانٍ إضافةً للفحص في الواجهة)
function getRecordAuditHistory(recordId, currentUser, recordType) { _apiGuard_();
  var _fn="[getRecordAuditHistory]"; _logInfo_(_fn, "START | "+"recordId:"+String(JSON.stringify(recordId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80)+", "+"recordType:"+String(JSON.stringify(recordType)||"").slice(0, 80));
  try {
  if (currentUser && recordType) {
    var role=_getUserRole_(currentUser);
    if (role!=="Admin") {
      var perms=getUserPermissions(currentUser, role);
      var screenId = recordType==='bookings' ? 'audit_log_bookings' : recordType==='contracts' ? 'audit_log_contracts' : 'audit_log';
      if (!perms[screenId] || !perms[screenId].canView) throw new Error("ليس لديك صلاحية عرض سجل التعديلات.");
    }
  }
  var data = _getOrCreateSheet_("Global_Audit_Log").getDataRange().getValues();
  var tz = _tz_(), out = [];

  // مجموعة معرّفات ذات صلة بهذا السجل: السجل نفسه + معرّفات اتفاقيات نسك المرتبطة به (إن كان حجزاً)
  // بحيث يظهر في سجل الحجز أيضاً كل ما جرى على اتفاقياته (إنشاء/تعديل/حذف)
  // v3.26 — .trim() إضافية احتياطاً لأي مسافات خفية بالمعرّف عند المقارنة (كانت تمنع التطابق في حالات نادرة)
  var relatedIds = {}; relatedIds[String(recordId).trim()] = true;
  if (recordType === 'bookings') {
    try {
      var nusukData = _getSheetValues_("Nusuk_Agreements");
      for (var n=1; n<nusukData.length; n++) {
        if (String(nusukData[n][2]).trim() === String(recordId).trim()) relatedIds[String(nusukData[n][0]).trim()] = true;
      }
    } catch(nx) { /* لو الشيت غير موجود بعد (قبل التهيئة) نتجاهل ونعرض سجل الحجز فقط */ }
  }

  for (var i=1; i<data.length; i++) {
    if (relatedIds[String(data[i][4]).trim()]) {
      out.push({ timestamp: _fmtDate_(new Date(data[i][1]),tz,"dd/MM/yyyy HH:mm"),
        screen:data[i][2], actionType:data[i][3], fieldChanged:data[i][5],
        oldValue:data[i][6], newValue:data[i][7], summary:data[i][8], user:data[i][9] });
    }
  }
  out.reverse(); return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// سجل التعديلات العام (شاشة "سجل التعديلات") - يُطبَّق عليه فلترة الفنادق المسموح بها لغير المدير،
// بمطابقة recordId مع الفندق التابع له (عبر خرائط الحجوزات/التعاقدات) قبل إرجاع النتيجة
// تجلب سجل التعديلات العام مع دعم الفلاتر (الشاشة/نوع الإجراء/المستخدم/رقم السجل) وتصفية حسب الفنادق المسموح بها لغير المدير
// ⚡ أُعيدت كتابتها بالكامل لتكون فائقة الصلابة: كل صف يُعالَج باستقلال تام (خطأ بصف واحد لا يُوقف الباقي)
function getGlobalAuditLog(filters, currentUser) { _apiGuard_();
  var _fn="[getGlobalAuditLog]"; _logInfo_(_fn, "START | "+"filters:"+String(JSON.stringify(filters)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  filters = filters || {};
  // فحص صلاحية: المدير يمرّ دائماً، غيره يحتاج إذن audit_log.canView
  if (currentUser) {
    if (!_isAdmin_(currentUser)) {
      var perms = getUserPermissions(currentUser, _getUserRole_(currentUser));
      if (!perms || !perms.audit_log || !perms.audit_log.canView) return []; // لا صلاحية: نُعيد مصفوفة فارغة (لا نرمي خطأ) حتى لا تتعطل الواجهة
    }
  }

  // قراءة البيانات الخام من الشيت
  var sheet = _getOrCreateSheet_("Global_Audit_Log");
  var data;
  try { data = sheet.getDataRange().getValues(); } catch(e) { return []; }
  if (!data || data.length <= 1) return []; // فارغ (رأس فقط) أو غير صالح

  var tz;
  try { tz = _tz_(); } catch(e) { tz = "Asia/Riyadh"; }

  // بناء خريطة فلترة الفنادق لغير المدير
  var allowed = null, recordHotelMap = null;
  try {
    allowed = currentUser ? _getUserAllowedHotels_(currentUser) : null;
    if (allowed) {
      recordHotelMap = {};
      var hotelMap = _buildContractHotelMap_();
      var bData = _getOrCreateSheet_("Bookings_Master").getDataRange().getValues();
      for (var bi=1; bi<bData.length; bi++) { if (bData[bi][0]) recordHotelMap[bData[bi][0]] = hotelMap[bData[bi][1]]; }
      var cData = _getOrCreateSheet_("Contracts_Master").getDataRange().getValues();
      for (var ci=1; ci<cData.length; ci++) { if (cData[ci][0]) recordHotelMap[cData[ci][0]] = cData[ci][1]; }
    }
  } catch(e) { allowed = null; recordHotelMap = null; }

  // تصفية الفلاتر: نتجاهل أي فلتر فارغ أو فاسد
  var fScreen = String(filters.screen||"").trim();
  var fAction = String(filters.actionType||"").trim();
  var fUser   = String(filters.user||"").trim().toLowerCase();
  var fRecord = String(filters.recordId||"").trim();
  var showLogin = filters.showLogin ? true : false;
  var fFromDate = filters.fromDate ? _dateOnly_(new Date(filters.fromDate)) : null;
  var fToDate   = filters.toDate   ? _dateOnly_(new Date(filters.toDate))   : null;
  if (fToDate) fToDate = new Date(fToDate.getFullYear(), fToDate.getMonth(), fToDate.getDate(), 23, 59, 59);
  // v3.8 — فلتر المستخدم يطابق جزئياً على اسم الدخول أو الاسم الكامل (كان تطابقاً حرفياً على اسم الدخول فقط)
  var _ufMap = {};
  if (fUser) { try { _ufMap = getUsernameFullNameMap(); } catch(e){} }

  var out = [];
  for (var i = data.length-1; i >= 1; i--) {
    try {
      var row = data[i];
      if (!row) continue;
      var logId = String(row[0]||""); if (!logId) continue;
      var screen = String(row[2]||""), actionType = String(row[3]||"");
      var recordId = String(row[4]||""), user = String(row[9]||"");

      // تطبيق الفلاتر (مقارنة نصية صريحة بعد التحويل لـ String لتفادي مشاكل الأنواع)
      // إخفاء سجلات الدخول/الخروج ما لم يُفعَّل خيار إظهارها صراحةً
      if (!showLogin && (actionType === "تسجيل دخول" || actionType === "تسجيل خروج")) continue;
      if (fScreen && screen !== fScreen) continue;
      if (fAction && actionType !== fAction) continue;
      if (fUser) {
        var _uL = user.toLowerCase(), _fL = String(_ufMap[user]||"").toLowerCase();
        if (_uL.indexOf(fUser)===-1 && _fL.indexOf(fUser)===-1) continue;
      }
      if (fRecord && recordId.indexOf(fRecord) === -1) continue;
      // فلتر نطاق التاريخ (مفتوح البداية ومفتوح النهاية مدعومان)
      if (row[1]) {
        try {
          var rowDate = new Date(row[1]);
          if (fFromDate && rowDate < fFromDate) continue;
          if (fToDate   && rowDate > fToDate)   continue;
        } catch(dateErr) {}
      }
      // تصفية فنادق
      if (recordHotelMap && allowed) {
        var recHotel = recordHotelMap[recordId];
        if (recHotel && !allowed[recHotel]) continue;
      }

      var ts = "";
      try {
        if (row[1]) ts = _fmtDate_(new Date(row[1]), tz, "dd/MM/yyyy HH:mm");
      } catch(e2) { ts = String(row[1]||""); }

      out.push({
        logId: logId, timestamp: ts, screen: screen, actionType: actionType, recordId: recordId,
        fieldChanged: String(row[5]||""), oldValue: String(row[6]||""),
        newValue: String(row[7]||""), summary: String(row[8]||""), user: user
      });
      if (out.length >= 500) break;
    } catch(rowErr) {
      // خطأ بمعالجة صف واحد لا يُوقف بقية الصفوف — يتجاوزه ويكمل
      continue;
    }
  }
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}



// v3.1 — تسجيل عمليات القراءة الحساسة (عرض تفاصيل، كشوف، تقارير) لتتبعها في سجل التدقيق
// نستخدم نوع إجراء "قراءة" لتمكين تصفيتها بسهولة
function _logRead_(screen, recordId, description, user) {
  try { logAudit(screen, "قراءة", recordId, "", "", "", description, user); } catch(e){}
}

// ===================== 8. تفضيلات المستخدم =====================
// V3.60 — الدالة العامة ترفض مفتاح "allowed_hotels" (قيد أمني يُكتب فقط عبر saveUserAllowedHotels بصلاحية المدير؛
// كان أي نداء يستطيع رفع قيد الفنادق عن أي مستخدم بكتابة قيمة فارغة). الكتابة الفعلية في _saveUserPreference_.
function saveUserPreference(username, prefKey, prefValue) { _apiGuard_();
  if (String(prefKey) === "allowed_hotels") throw new Error("غير مصرح.");
  return _saveUserPreference_(username, prefKey, prefValue);
}
function _saveUserPreference_(username, prefKey, prefValue) {
  var _fn="[saveUserPreference]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"prefKey:"+String(JSON.stringify(prefKey)||"").slice(0, 80)+", "+"prefValue:"+String(JSON.stringify(prefValue)||"").slice(0, 80));
  try {
  var sheet = _getOrCreateSheet_("User_Preferences");
  var data = sheet.getDataRange().getValues();
  // V3.75 — صف واحد لكل (مستخدم، مفتاح): يُحدَّث أول صف مطابق وتُحذف أي صفوف مكررة له. كانت المكررات (من كتابات متزامنة قديمة
  // قبل القفل المركزي أو من دمج اسم مستخدم) تجعل الحفظ يعدّل الصف الأول بينما حزمة الإقلاع تقرأ الأخير ⇒ التفضيل "لا يُحفظ".
  var first=-1, dups=[];
  for (var i=1; i<data.length; i++) {
    if (data[i][0]===username && data[i][1]===prefKey) { if (first<0) first=i; else dups.push(i); }
  }
  if (first<0) { sheet.appendRow([username, prefKey, prefValue]); return {success:true}; }
  sheet.getRange(first+1,3).setValue(prefValue);
  for (var d=dups.length-1; d>=0; d--) { try { sheet.deleteRow(dups[d]+1); } catch(eD) {} }
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
  finally { _invalidateSheetCache_("User_Preferences"); } // v3.53 — أي قراءة لاحقة بنفس التنفيذ ترى القيمة الجديدة
}

// يجلب قيمة تفضيل محفوظ مسبقاً لمستخدم معيّن
function getUserPreference(username, prefKey) { _apiGuard_();
  var _fn="[getUserPreference]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"prefKey:"+String(JSON.stringify(prefKey)||"").slice(0, 80));
  try {
  // v3.53 — قراءة الشيت مرة واحدة لكل تنفيذ (كانت تُقرأ كاملة في كل نداء، ومنها فحص الفنادق المسموح بها مراراً)
  var data = _getSheetValues_("User_Preferences");
  for (var i=1; i<data.length; i++) {
    if (data[i][0]===username && data[i][1]===prefKey) return data[i][2];
  }
  return null;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// v3.53 — كل تفضيلات مستخدم واحد كخريطة {مفتاح: قيمة} — تُرسَل مع حزمة الإقلاع ليخزّنها المتصفح
// (allowed_hotels مستبعدة: صلاحية يطبّقها الخادم وليست تفضيل واجهة)
function _getUserPrefsMap_(username) {
  var out = {};
  var data = _getSheetValues_("User_Preferences");
  for (var i=1; i<data.length; i++) {
    if (data[i][0]===username && data[i][1] && data[i][1]!=="allowed_hotels" && !Object.prototype.hasOwnProperty.call(out, data[i][1])) { // V3.75 — أول صف يفوز (مثل getUserPreference والحفظ)
      var v = data[i][2];
      out[data[i][1]] = (v instanceof Date) ? v.toISOString() : v;
    }
  }
  return out;
}

// V3.54 — الشهور (YYYY-MM) التي تغطيها فترات التعاقد الفعلية لكل فندق مسموح — لفلتر الشهر بشاشة الحجوزات
// (كان الفلتر يعرض نطاقاً ثابتاً ±3 سنوات حول اليوم بغض النظر عن العقود)
function getContractMonthsByHotel(currentUser) { _apiGuard_();
  var _fn="[getContractMonthsByHotel]";
  try {
  var data = _getSheetValues_("Contracts_Master");
  var allowed = currentUser ? _getUserAllowedHotels_(currentUser) : null;
  var sets = {}, out = {};
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (!row[0] || row[12]===true || !row[1]) continue;
    if (allowed && !allowed[row[1]]) continue;
    var sd = row[3] instanceof Date ? row[3] : new Date(row[3]);
    var ed = row[4] instanceof Date ? row[4] : new Date(row[4]);
    if (isNaN(sd.getTime()) || isNaN(ed.getTime()) || ed < sd) continue;
    var set = sets[row[1]] || (sets[row[1]] = {});
    var y = sd.getFullYear(), m = sd.getMonth(), guard = 0;
    while ((y < ed.getFullYear() || (y === ed.getFullYear() && m <= ed.getMonth())) && guard++ < 240) {
      set[y + "-" + (m < 9 ? "0" : "") + (m + 1)] = true;
      if (++m > 11) { m = 0; y++; }
    }
  }
  Object.keys(sets).forEach(function(h) { out[h] = Object.keys(sets[h]).sort(); });
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// v3.53 — نطاق أشهر التعاقد لكل فندق مسموح (نفس منطق getContractDateRange) في مرور واحد على الشيت
function _getContractDateRangesMap_(currentUser) {
  var data = _getSheetValues_("Contracts_Master");
  var allowed = currentUser ? _getUserAllowedHotels_(currentUser) : null;
  var acc = {}, out = {};
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (!row[0] || row[12]===true || !row[1]) continue;
    if (allowed && !allowed[row[1]]) continue;
    var sd=_dateOnly_(row[3] instanceof Date?row[3]:new Date(row[3]));
    var ed=_dateOnly_(row[4] instanceof Date?row[4]:new Date(row[4]));
    var a = acc[row[1]] || (acc[row[1]] = { min:null, max:null });
    if (!a.min || sd<a.min) a.min=sd;
    if (!a.max || ed>a.max) a.max=ed;
  }
  Object.keys(acc).forEach(function(h) {
    var a = acc[h];
    out[h] = { minYear:a.min.getFullYear(), minMonth:a.min.getMonth()+1, maxYear:a.max.getFullYear(), maxMonth:a.max.getMonth()+1 };
  });
  return out;
}

/**
 * ======================================================================
 * المرحلة 2: شاشة التعاقدات
 * ======================================================================
 */

// ===================== 9. التحويل الهجري =====================
var HIJRI_MONTH_NAMES = ["محرم","صفر","ربيع الأول","ربيع الآخر","جمادى الأولى","جمادى الآخرة",
                          "رجب","شعبان","رمضان","شوال","ذو القعدة","ذو الحجة"];

// يُحوّل تاريخاً ميلادياً إلى هجري باستخدام خوارزمية حسابية (Umm al-Qura تقريبية)
// خوارزمية تابعة (Fallback) للتقويم الهجري الحسابي التقليدي - تُستخدم فقط إن فشل محرك Apps Script في دعم تقويم أم القرى
function _hijriTabularFallback_(date) {
  var gY=date.getFullYear(), gM=date.getMonth()+1, gD=date.getDate();
  var a=Math.floor((14-gM)/12), y=gY+4800-a, m=gM+12*a-3;
  var jdn=gD+Math.floor((153*m+2)/5)+365*y+Math.floor(y/4)-Math.floor(y/100)+Math.floor(y/400)-32045;
  var l=jdn-1948440+10632, n=Math.floor((l-1)/10631);
  l=l-10631*n+354;
  var j=Math.floor((10985-l)/5316)*Math.floor((50*l)/17719)+Math.floor(l/5670)*Math.floor((43*l)/15238);
  l=l-Math.floor((30-j)/15)*Math.floor((17719*j)/50)-Math.floor(j/16)*Math.floor((15238*j)/43)+29;
  var hMonth=Math.floor((24*l)/709), hDay=l-Math.floor((709*hMonth)/24), hYear=30*n+j-30;
  return {day:hDay, month:hMonth, year:hYear};
}

// يُحوّل تاريخاً ميلادياً إلى هجري باستخدام تقويم أم القرى الرسمي (عبر Intl.DateTimeFormat المدمج)
// مع رجوع تلقائي آمن للخوارزمية الحسابية التقليدية إن لم يدعم محرك التشغيل تقويم أم القرى
// النسخة الأساسية (بدون أي تصحيح يدوي) من التحويل الميلادي→هجري عبر تقويم أم القرى الرسمي
// v3.53 — المُنسِّق يُنشأ مرة واحدة لكل تنفيذ (كان يُنشأ لكل تاريخ: مرتين لكل حجز بشاشة الحجوزات)
var __HIJRI_FMT = null;
function _gregorianToHijriRaw_(date) {
  try {
    var fmt = __HIJRI_FMT || (__HIJRI_FMT = Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {day:'numeric', month:'numeric', year:'numeric'}));
    var parts = fmt.formatToParts(date);
    var day, month, year;
    parts.forEach(function(p){
      if (p.type==='day') day=parseInt(p.value,10);
      if (p.type==='month') month=parseInt(p.value,10);
      if (p.type==='year') year=parseInt(p.value,10);
    });
    // فحص أمان: أي قيمة سنة خارج النطاق الهجري المعقول تعني تجاهل صامت لامتداد التقويم من قِبل المحرك
    if (year && month && day && year > 1300 && year < 1600) {
      return {day:day, month:month, year:year, monthName:HIJRI_MONTH_NAMES[month-1]};
    }
  } catch(e) { /* السقوط للخوارزمية التابعة أدناه */ }
  var h = _hijriTabularFallback_(date);
  return {day:h.day, month:h.month, year:h.year, monthName:HIJRI_MONTH_NAMES[h.month-1]};
}

// يجلب خريطة تصحيحات بدايات الشهور المحفوظة لسنة هجرية معيّنة: {hijriMonth: offsetDays}
// v3.53 — محفوظة لكل تنفيذ: كانت تقرأ خصائص السكريبت عند تحويل كل تاريخ (آلاف القراءات بشاشة الحجوزات وحدها)
var __HIJRI_CORR_MEMO = {};
function _getHijriCorrections_(hijriYear) {
  if (__HIJRI_CORR_MEMO.hasOwnProperty(hijriYear)) return __HIJRI_CORR_MEMO[hijriYear];
  var out = {};
  try {
    var raw = PropertiesService.getScriptProperties().getProperty("HIJRI_CORRECTIONS_" + hijriYear);
    if (raw) out = JSON.parse(raw) || {};
  } catch(e) { out = {}; }
  __HIJRI_CORR_MEMO[hijriYear] = out;
  return out;
}

// التحويل الميلادي→هجري النهائي المُستخدَم بكل أنحاء النظام - يطبّق أي تصحيح يدوي محفوظ لبداية الشهر (من شاشة الصلاحيات)
// فوق النتيجة الأساسية لتقويم أم القرى، لمعالجة فروق رؤية الهلال المحلية عن الحساب الفلكي
// V3.55 — نتيجة كل يوم تُحفظ لكل تنفيذ (رؤوس أيام شارت التوافر/نسك تحوّل نفس الأيام مراراً)؛ تُعاد نسخة كي لا يُفسدها مستدعٍ
var __HIJRI_DAY_MEMO = {};
function _gregorianToHijri_(date) {
  var k = date.getFullYear()*10000 + (date.getMonth()+1)*100 + date.getDate();
  var hit = __HIJRI_DAY_MEMO[k];
  if (!hit) hit = __HIJRI_DAY_MEMO[k] = _gregorianToHijriCore_(date);
  return { day: hit.day, month: hit.month, year: hit.year, monthName: hit.monthName };
}
function _gregorianToHijriCore_(date) {
  var base = _gregorianToHijriRaw_(date);
  var corrections = _getHijriCorrections_(base.year);
  var offset = corrections[base.month] || 0;
  if (!offset) return base;
  // نطبّق التصحيح بإزاحة التاريخ الميلادي نفسه بعدد الأيام ثم إعادة التحويل - يضمن ترحيلاً سليماً بين الشهور تلقائياً
  var shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  return _gregorianToHijriRaw_(shifted);
}

// يُنسّق تاريخاً هجرياً كنص عربي جاهز للعرض (اليوم/الشهر/السنة هـ)
// v3.53 — نتيجة كل يوم تُحفظ لكل تنفيذ (الحجوزات تتشارك نفس تواريخ الدخول/الخروج كثيراً)
var __HIJRI_DISPLAY_MEMO = {};
function formatHijriDisplay(dateVal) { _apiGuard_();
  if (!dateVal) return "";
  var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return "";
  var k = d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
  var hit = __HIJRI_DISPLAY_MEMO[k];
  if (hit !== undefined) return hit;
  var h = _gregorianToHijri_(d);
  return (__HIJRI_DISPLAY_MEMO[k] = String(h.day).padStart(2,"0")+" "+h.monthName+" "+h.year+"هـ");
}
// v3.53/V3.55 — Utilities.formatDate نداء خدمة (~0.3 مللي ثانية)، وكان يُستدعى في 120 موضعاً بعضها داخل حلقات
// على آلاف الصفوف. كل المواضع تمر الآن عبر _fmtDate_ التي تحفظ النتيجة لكل (لحظة، منطقة، نمط) ضمن التنفيذ الواحد.
var __FMT_DATE_MEMO = {};
function _fmtDate_(d, tz, pattern) {
  if (!(d instanceof Date)) return Utilities.formatDate(d, tz, pattern); // نفس سلوك/أخطاء الأصل لأي مدخل غير تاريخ
  var t = d.getTime();
  if (isNaN(t)) return Utilities.formatDate(d, tz, pattern);
  var k = pattern + "|" + tz + "|" + t, hit = __FMT_DATE_MEMO[k];
  if (hit !== undefined) return hit;
  return (__FMT_DATE_MEMO[k] = Utilities.formatDate(d, tz, pattern));
}
var _fmtDateMemo_ = _fmtDate_;
// V3.55 — المنطقة الزمنية للسكريبت ثابتة طوال التنفيذ: قراءة واحدة بدل 57 موضعاً (بعضها داخل حلقات)
var __SCRIPT_TZ = null;
function _tz_() { return __SCRIPT_TZ || (__SCRIPT_TZ = Session.getScriptTimeZone()); }

// ===================== 10. شاشة التعاقدات =====================

function getDistinctHotelNames(currentUser) { _apiGuard_();
  var _fn="[getDistinctHotelNames]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  var data = _getSheetValues_("Contracts_Master");
  var allowed = currentUser ? _getUserAllowedHotels_(currentUser) : null;
  var names = {};
  for (var i=1; i<data.length; i++) {
    if (data[i][1] && data[i][12]!==true) {
      if (!allowed || allowed[data[i][1]]) names[data[i][1]]=true;
    }
  }
  return Object.keys(names);
  } catch(e) { _logError_(_fn, e); throw e; }
}

// V3.63 — فحص نطاق الفنادق في عمليات الكتابة (كان يُطبَّق على العرض فقط: مستخدم مقيَّد بفندق كان يستطيع الحفظ على فندق آخر)
function _requireHotelAccess_(username, hotelName) {
  var allowed = _getUserAllowedHotels_(username);
  if (allowed && hotelName && !allowed[hotelName]) throw new Error("غير مصرح: هذا الفندق خارج الفنادق المسموح لك بها.");
}
// ─── مساعدة: خريطة الفنادق المسموح بها للمستخدم (null = الكل) ───
function _getUserAllowedHotels_(username) {
  if (_isAdmin_(username)) return null; // مدير: كل الفنادق
  var raw = getUserPreference(username, "allowed_hotels");
  if (!raw) return null; // لا قيود = كل الفنادق
  try {
    var arr = JSON.parse(raw);
    if (!arr || !arr.length) return null;
    var map={};
    arr.forEach(function(h){ map[h]=true; });
    return map;
  } catch(e){ return null; }
}

// يُعيد قائمة أسماء الفنادق المسموح بها لمستخدم معيّن (لعرضها في نافذة إدارة الصلاحيات)
function getUserAllowedHotels(username, actingUser) { _apiGuard_();
  var _fn="[getUserAllowedHotels]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"actingUser:"+String(JSON.stringify(actingUser)||"").slice(0, 80));
  try {
  if (_getUserRole_(actingUser)!=="Admin") throw new Error("غير مصرح.");
  var raw = getUserPreference(username, "allowed_hotels");
  if (!raw) return [];
  try { return JSON.parse(raw)||[]; } catch(e){ return []; }
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحفظ قائمة الفنادق المسموح بها لمستخدم معيّن (Admin فقط)
function saveUserAllowedHotels(targetUsername, hotelNames, actingUser) { _apiGuard_();
  var _fn="[saveUserAllowedHotels]"; _logInfo_(_fn, "START | "+"targetUsername:"+String(JSON.stringify(targetUsername)||"").slice(0, 80)+", "+"hotelNames:"+String(JSON.stringify(hotelNames)||"").slice(0, 80)+", "+"actingUser:"+String(JSON.stringify(actingUser)||"").slice(0, 80));
  try {
  if (_getUserRole_(actingUser)!=="Admin") throw new Error("غير مصرح.");
  _saveUserPreference_(targetUsername, "allowed_hotels", hotelNames.length ? JSON.stringify(hotelNames) : "");
  logAudit("إدارة الصلاحيات","تعديل صلاحيات الفنادق",targetUsername,"","","",
    "تعديل الفنادق المسموح بها لـ "+targetUsername+": "+(hotelNames.join("، ")||"الكل"),actingUser);
  _bumpNotifVersion_(); // الفنادق المسموح بها تحدد الإشعارات الظاهرة للمستخدم
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُغيّر كلمة مرور المستخدم الحالي بعد التحقق من كلمة المرور القديمة
function changeUserPassword(username, oldPassword, newPassword) { _apiGuard_();
  var _fn="[changeUserPassword]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", oldPassword:[hidden], newPassword:[hidden]");
  try {
  newPassword = String(newPassword||"").trim();
  if (!newPassword || newPassword.length < 4) throw new Error("كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل.");
  var sheet = _getOrCreateSheet_("Users_Master");
  var data = sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(username).toLowerCase()) {
      // V3.60 — المقارنة عبر _pwVerify_ (كانت مقارنة نصية بالقيمة المخزّنة المشفّرة، فيفشل تغيير كلمة المرور دائماً بعد أول دخول)
      if (!_pwVerify_(oldPassword, data[i][1], data[i][5]||"")) throw new Error("كلمة المرور الحالية غير صحيحة.");
      var _s2 = _pwGenerateSalt_();
      sheet.getRange(i+1, 2).setValue(_pwHash_(newPassword, _s2));
      sheet.getRange(i+1, 6).setValue(_s2);
      _killUserSessions_(username, __API_CTX && __API_CTX.token); // V3.63 — بقية جلسات المستخدم (أجهزة أخرى) تنتهي؛ الحالية تبقى
      logAudit("إدارة المستخدمين","تغيير كلمة المرور",username,"","","","تم تغيير كلمة المرور",username);
      return {success:true};
    }
  }
  throw new Error("المستخدم غير موجود.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── مساعدة: بناء خريطة (contractId → ملصق كامل باسم الفندق والتواريخ الموسَّعة) ───
// يضم نطاق التعاقد الرئيسي + أي تعاقدات إضافية تمتد بعد نهايته.
// تُستخدَم في شاشة الحجوزات وعرض التفاصيل لإظهار المدة الفعلية الكاملة.
// v3.37 — مخزَّنة بكاش عابر للتنفيذات (كانت تُعاد قراءة Contracts_Master وبناؤها بالكامل في كل نداء خادم منفصل)
function _buildContractLabelMap_() {
  if (__REF_MAP_MEMO.contractLabel) return __REF_MAP_MEMO.contractLabel;
  var _cached = _getFromCache_(_REF_CACHE_KEY_CONTRACT_LABEL_MAP);
  if (_cached) { __REF_MAP_MEMO.contractLabel = _cached; return _cached; }
  var ss = _getSS_();
  var data = _getSheetValues_("Contracts_Master");
  var tz = _tz_();

  // جمع كل التعاقدات وبناء خريطة الإضافيات
  var contracts = {}, supplementsByParent = {};
  for (var i=1; i<data.length; i++) {
    var row=data[i]; if (!row[0]) continue;
    var cType=String(row[14]||"رئيسي").trim(), pId=String(row[15]||"").trim();
    var sd=row[3] instanceof Date?row[3]:new Date(row[3]);
    var ed=row[4] instanceof Date?row[4]:new Date(row[4]);
    contracts[row[0]]={hotelName:row[1],startDate:sd,endDate:ed,contractType:cType,parentId:pId,isDeleted:row[12]===true};
    if (cType==="إضافي"&&pId) { if(!supplementsByParent[pId]) supplementsByParent[pId]=[]; supplementsByParent[pId].push(row[0]); }
  }

  var labelMap = {};
  Object.keys(contracts).forEach(function(cid) {
    var c=contracts[cid];
    // لو إضافي → اجلب بيانات الأب لحساب نطاق البداية الصحيح
    var mainId=(c.contractType==="إضافي"&&c.parentId&&contracts[c.parentId])?c.parentId:cid;
    var mainC=contracts[mainId]||c;
    var maxEnd=mainC.endDate;
    var sups=supplementsByParent[mainId]||[];
    sups.forEach(function(sid){ var s=contracts[sid]; if(s&&!s.isDeleted&&s.endDate>maxEnd) maxEnd=s.endDate; });
    labelMap[cid]=c.hotelName+
      " ("+_fmtDate_(mainC.startDate,tz,"dd/MM/yyyy")+
      " — "+_fmtDate_(maxEnd,tz,"dd/MM/yyyy")+")";
  });
  _putInCache_(_REF_CACHE_KEY_CONTRACT_LABEL_MAP, labelMap);
  __REF_MAP_MEMO.contractLabel = labelMap;
  return labelMap;
}

// ─── جلب التعاقدات: الرئيسية أولاً ثم إضافياتها مباشرةً تحتها ───
function getContracts(currentUser) { _apiGuard_();
  var _fn="[getContracts]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser,"contracts","canView");
  var ss=_getSS_();
  var data=_getSheetValues_("Contracts_Master");
  var tz=_tz_();
  var mains=[], supplementsMap={};
  // v3.16 — تصفية حسب الفنادق المسموح بها للمستخدم (كانت مفقودة هنا رغم وجودها في كل الشاشات الأخرى)
  var allowed=_getUserAllowedHotels_(currentUser);

  for (var i=1; i<data.length; i++) {
    var row=data[i]; if (!row[0]||row[12]===true) continue;
    if (allowed && !allowed[row[1]]) continue;
    var sd=row[3] instanceof Date?row[3]:new Date(row[3]);
    var ed=row[4] instanceof Date?row[4]:new Date(row[4]);
    var ca=row[10] instanceof Date?row[10]:new Date(row[10]);
    var cType=String(row[14]||"رئيسي").trim(), pId=String(row[15]||"").trim();
    var nusukCap = parseFloat(row[17])||0;
    // متوسط تسكين نسك = طاقة نسك ÷ عدد الغرف (رقم عشري بخانة واحدة للعرض في القائمة، غير قابل للتحرير — محسوب فقط)
    var nusukAvg = (nusukCap>0 && row[6]>0) ? Math.round((nusukCap/parseFloat(row[6]))*10)/10 : 0;

    var item={
      contractId:row[0], hotelName:row[1], contractingParty:row[2],
      startDate:_fmtDate_(sd,tz,"dd/MM/yyyy"), startDateHijri:formatHijriDisplay(sd),
      endDate:_fmtDate_(ed,tz,"dd/MM/yyyy"),   endDateHijri:formatHijriDisplay(ed),
      nights:row[5], roomCount:row[6], roomPrice:row[7], totalValue:row[8],
      createdBy:row[9], createdAt:_fmtDate_(ca,tz,"dd/MM/yyyy HH:mm"),
      lastEditSummary:row[11]||"",
      city:row[13]||"", contractType:cType, parentContractId:pId, notes:row[16]||"",
      nusukCapacity:nusukCap, nusukAvgOccupancy:nusukAvg
    };
    if (cType==="إضافي"&&pId) {
      if(!supplementsMap[pId]) supplementsMap[pId]=[];
      supplementsMap[pId].push(item);
    } else {
      mains.push(item);
    }
  }

  mains.reverse(); // الأحدث أولاً
  var out=[], includedParents={};
  mains.forEach(function(main) {
    out.push(main); includedParents[main.contractId]=true;
    (supplementsMap[main.contractId]||[]).forEach(function(s){ out.push(s); });
  });
  // إضافيات يتيمة (حُذف أبوها)
  Object.keys(supplementsMap).forEach(function(pId) {
    if (!includedParents[pId]) supplementsMap[pId].forEach(function(s){ out.push(s); });
  });
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يجلب بيانات تعاقد واحد بصيغة مناسبة لتعبئة نموذج التعديل
function getContractForEdit(contractId, currentUser) { _apiGuard_();
  try { if (currentUser) _logRead_("التعاقدات", contractId, "عرض تفاصيل تعاقد "+contractId+" للتحرير", currentUser); } catch(e){}

  var _fn="[getContractForEdit]"; _logInfo_(_fn, "START | "+"contractId:"+String(JSON.stringify(contractId)||"").slice(0, 80));
  try {
  var data=_getSheetValues_("Contracts_Master");
  var tz=_tz_();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(contractId)) {
      var row=data[i];
      var sd=row[3] instanceof Date?row[3]:new Date(row[3]);
      var ed=row[4] instanceof Date?row[4]:new Date(row[4]);
      return {
        contractId:row[0], hotelName:row[1], contractingParty:row[2],
        startDate:_fmtDate_(sd,tz,"yyyy-MM-dd"),
        endDate:_fmtDate_(ed,tz,"yyyy-MM-dd"),
        roomCount:row[6], roomPrice:row[7],
        city:row[13]||"",
        contractType:String(row[14]||"رئيسي").trim(),
        parentContractId:String(row[15]||"").trim(),
        notes:row[16]||"",
        nusukCapacity:parseFloat(row[17])||0
      };
    }
  }
  throw new Error("لم يتم العثور على التعاقد.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── التعاقدات الرئيسية لفندق معيّن (للاختيار كأب عند إضافة تعاقد إضافي) ───
function getMainContractsForHotel(hotelName) { _apiGuard_();
  var _fn="[getMainContractsForHotel]"; _logInfo_(_fn, "START | "+"hotelName:"+String(JSON.stringify(hotelName)||"").slice(0, 80));
  try {
  var data=_getSheetValues_("Contracts_Master");
  var tz=_tz_(), out=[];
  for (var i=1; i<data.length; i++) {
    var row=data[i]; if (!row[0]||row[12]===true) continue;
    if (String(row[1]).trim()!==String(hotelName).trim()) continue;
    if (String(row[14]||"رئيسي").trim()!=="رئيسي") continue;
    var sd=row[3] instanceof Date?row[3]:new Date(row[3]);
    var ed=row[4] instanceof Date?row[4]:new Date(row[4]);
    out.push({ contractId:row[0],
      label:"عقد "+row[0]+" — "+_fmtDate_(sd,tz,"dd/MM/yyyy")+" إلى "+_fmtDate_(ed,tz,"dd/MM/yyyy") });
  }
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحفظ تعاقداً جديداً أو يُحدّث تعاقداً موجوداً، مع تسجيل كل حقل تغيّر في سجل التعديلات
function saveContract(c, currentUser) { _apiGuard_();
  var _fn="[saveContract]"; _logInfo_(_fn, "START | "+"c:"+String(JSON.stringify(c)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Contracts_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  _invalidateReferenceCache_(_REF_CACHE_KEY_HOTELS); _invalidateReferenceCache_(_REF_CACHE_KEY_ACTIVE_CONTRACTS);
  // v3.37 — إبطال كاش خريطتي (contractId→hotelName) و(contractId→تسمية كاملة) أيضاً — كانتا تعتمدان على نفس الشيت
  _invalidateReferenceCache_(_REF_CACHE_KEY_CONTRACT_HOTEL_MAP); _invalidateReferenceCache_(_REF_CACHE_KEY_CONTRACT_LABEL_MAP); // إبطال الكاش المرجعي المؤثر
  _requirePermission_(currentUser,"contracts",c.editId?"canEdit":"canAdd");
  var ss=_getSS_();
  var sheet=_getOrCreateSheet_("Contracts_Master");
  var tz=_tz_();

  var startDate=new Date(c.startDate), endDate=new Date(c.endDate);
  if (isNaN(startDate.getTime())||isNaN(endDate.getTime())) throw new Error("تاريخ بداية/نهاية العقد غير صحيح.");
  if (endDate<=startDate) throw new Error("تاريخ نهاية العقد يجب أن يكون بعد تاريخ البداية.");

  var nights=Math.round((endDate-startDate)/86400000);
  // v3.5 — _toNumber_ يحوّل الأرقام العربية/الفارسية تلقائياً قبل التحليل (حماية من مدخلات لوحة موبايل عربية)
  var roomCount=_toNumber_(c.roomCount), roomPrice=_toNumber_(c.roomPrice);
  if (roomCount<=0) throw new Error("عدد الغرف يجب أن يكون أكبر من صفر.");
  if (roomPrice<=0) throw new Error("سعر الغرفة يجب أن يكون أكبر من صفر.");
  var totalValue=Math.round(nights*roomCount*roomPrice*100)/100;

  var hotelName=String(c.hotelName||"").trim();
  _requireHotelAccess_(currentUser, hotelName); // V3.63 — مستخدم مقيَّد بفنادق لا يسجّل/يعدّل تعاقداً لفندق خارجها
  var contractingParty=String(c.contractingParty||"").trim();
  var city=String(c.city||"").trim();
  var contractType=String(c.contractType||"رئيسي").trim();
  var parentContractId=String(c.parentContractId||"").trim();
  var notes=String(c.notes||"").trim();
  var nusukCapacity=_toNumber_(c.nusukCapacity); // طاقة نسك بالأفراد/السراير للعقد كامل — v3.5 يحوّل الأرقام العربية تلقائياً
  if (nusukCapacity<0) throw new Error("طاقة نسك لا يمكن أن تكون سالبة.");

  if (!hotelName) throw new Error("اسم الفندق مطلوب.");
  if (!contractingParty) throw new Error("جهة التعاقد مطلوبة.");
  if (!city) throw new Error("يرجى تحديد المدينة (مكة / المدينة).");
  if (contractType==="إضافي"&&!parentContractId) throw new Error("يرجى اختيار التعاقد الرئيسي للتعاقد الإضافي.");
  var now=new Date();

  if (c.editId) {
    var data=sheet.getDataRange().getValues();
    for (var i=1; i<data.length; i++) {
      if (String(data[i][0])===String(c.editId)) {
        var oldRow=data[i], rowNum=i+1;
        var comparisons=[
          {label:"المدينة",       old:oldRow[13]||"",                          new:city},
          {label:"نوع التعاقد",   old:String(oldRow[14]||"رئيسي"),             new:contractType},
          {label:"اسم الفندق",    old:oldRow[1],                               new:hotelName},
          {label:"جهة التعاقد",   old:oldRow[2],                               new:contractingParty},
          {label:"تاريخ البداية", old:_fmtDate_(new Date(oldRow[3]),tz,"dd/MM/yyyy"), new:_fmtDate_(startDate,tz,"dd/MM/yyyy")},
          {label:"تاريخ النهاية", old:_fmtDate_(new Date(oldRow[4]),tz,"dd/MM/yyyy"), new:_fmtDate_(endDate,tz,"dd/MM/yyyy")},
          {label:"عدد الغرف",     old:oldRow[6],                               new:roomCount},
          {label:"سعر الغرفة",    old:oldRow[7],                               new:roomPrice},
          {label:"ملاحظات",       old:oldRow[16]||"",                          new:notes},
          {label:"طاقة نسك",      old:parseFloat(oldRow[17])||0,               new:nusukCapacity}
        ];
        var changedParts=[];
        comparisons.forEach(function(cmp){
          if (String(cmp.old)!==String(cmp.new)) {
            logAudit("التعاقدات","تعديل",c.editId,cmp.label,cmp.old,cmp.new,cmp.label+": "+cmp.old+" ← "+cmp.new,currentUser);
            changedParts.push(cmp.label+": "+cmp.old+" ← "+cmp.new);
          }
        });
        var editSummary=changedParts.length
          ?(changedParts.join(" | ")+" — "+_fmtDate_(now,tz,"dd/MM/yyyy HH:mm")+" — "+currentUser)
          :oldRow[11];
        // تحديث الأعمدة الأصلية B–I (1-indexed: 2–9)
        sheet.getRange(rowNum,2,1,8).setValues([[hotelName,contractingParty,startDate,endDate,nights,roomCount,roomPrice,totalValue]]);
        // آخر تعديل (عمود L = 12)
        sheet.getRange(rowNum,12).setValue(editSummary);
        // الأعمدة N–Q (14–17) وطاقة نسك بالعمود R (18)
        sheet.getRange(rowNum,14,1,5).setValues([[city,contractType,parentContractId,notes,nusukCapacity]]);
        // v3.1 — تنبيه عام: تم تعديل التعاقد + إبطال كاش الفترة المتقاطعة مع فترة التعاقد
        try {
          if (changedParts.length) {
            _createNotification_("notif_contract_edit", c.editId, hotelName,
              "📄 تعديل تعاقد "+c.editId+" — "+hotelName,
              "تم تعديل التعاقد "+c.editId+" ("+hotelName+") بواسطة "+currentUser+".\n"+changedParts.slice(0,6).join(" | "),
              currentUser);
          }
        } catch(nfErr){}
        _bumpAvailabilityVersion_(hotelName, startDate, endDate);
        return {success:true, contractId:c.editId};
      }
    }
    throw new Error("لم يتم العثور على التعاقد المطلوب تعديله.");
  } else {
    var contractId=_getNextPlainNumber_("CONTRACT",3);
    sheet.appendRow([contractId,hotelName,contractingParty,startDate,endDate,nights,roomCount,roomPrice,totalValue,
      currentUser,now,"",false, city,contractType,parentContractId,notes,nusukCapacity]);
    logAudit("التعاقدات","إنشاء تعاقد",contractId,"","","",
      "تعاقد جديد ["+city+"]["+contractType+"]: "+hotelName+" — "+roomCount+" غرفة — "+nights+" ليلة"+(nusukCapacity>0?" — طاقة نسك: "+nusukCapacity:""), currentUser);
    _bumpAvailabilityVersion_();
    return {success:true, contractId:c.editId};
  }

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ═══════════════════════════════════════════════════════════════
// دفعات سداد التعاقدات (محمية بصلاحية الجانب المالي availability_finance)
// ═══════════════════════════════════════════════════════════════
function _requireFinancePermission_(currentUser) {
  if (_isAdmin_(currentUser)) return;
  var perms=getUserPermissions(currentUser, _getUserRole_(currentUser));
  if (!perms.availability_finance || !perms.availability_finance.canView) throw new Error("ليس لديك صلاحية الوصول للجانب المالي.");
}

// دالة مساعدة داخلية: تُعيد خريطة (Payment_ID → {totalPaid, lastDate, count}) من كل دفعات السداد الفعلية
// غير المحذوفة بشيت Contract_Payment_Receipts — تُستخدَم لإعادة احتساب Paid_Amount/Paid_Date بدقة بعد أي تغيير
function _buildContractReceiptsSumMap_() {
  var data = _getSheetValues_("Contract_Payment_Receipts");
  var map = {};
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (!row[0] || row[9]===true) continue;
    var pid = String(row[1]);
    if (!map[pid]) map[pid] = { totalPaid: 0, lastDate: null, count: 0 };
    map[pid].totalPaid += parseFloat(row[3]) || 0;
    map[pid].count++;
    var d = row[4] instanceof Date ? row[4] : new Date(row[4]);
    if (!isNaN(d.getTime()) && (!map[pid].lastDate || d > map[pid].lastDate)) map[pid].lastDate = d;
  }
  return map;
}

// دالة مساعدة داخلية: تُعيد احتساب Paid_Amount/Paid_Date لقسط واحد من مجموع دفعات السداد الفعلية المرتبطة به
// وتكتبهما على صف القسط بشيت Contract_Payments — تُستدعى بعد أي إضافة/تعديل/حذف سداد فعلي لضمان بقاء القسط متزامناً
function _recalcContractPaymentPaidAmount_(paymentId) {
  if (!String(paymentId || "").trim()) return; // V3.79 — دفعة بلا قسط: لا قسط يُعاد حسابه (وكان الفراغ قد يطابق صفاً فارغاً)
  _invalidateSheetCache_("Contract_Payment_Receipts");
  var sumMap = _buildContractReceiptsSumMap_();
  var info = sumMap[String(paymentId)] || { totalPaid: 0, lastDate: null };
  var cpSheet = _getOrCreateSheet_("Contract_Payments");
  var cpData = cpSheet.getDataRange().getValues();
  for (var j=1; j<cpData.length; j++) {
    if (String(cpData[j][0]) === String(paymentId)) {
      cpSheet.getRange(j+1,5).setValue(Math.round(info.totalPaid*100)/100);
      cpSheet.getRange(j+1,6).setValue(info.lastDate || "");
      break;
    }
  }
  _invalidateSheetCache_("Contract_Payments");
}

// يُعيد كل دفعات تعاقد معيّن + ملخص إجمالي (إجمالي الأقساط/المسدد/المتبقي) مع تحويل تاريخ الاستحقاق للهجري
// v3.32 — paidAmount/paidDate يُحتسَبان من مجموع دفعات السداد الفعلية (Contract_Payment_Receipts) بدل قيمة واحدة مخزَّنة بلا تفاصيل؛
// receiptsCount يُتيح للواجهة إظهار زر "📜 سجل السداد" فقط للأقساط التي عليها دفعة واحدة فعلية فأكثر
function getContractPayments(contractId, currentUser) { _apiGuard_();
  var _fn="[getContractPayments]"; _logInfo_(_fn, "START | "+"contractId:"+String(JSON.stringify(contractId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requireFinancePermission_(currentUser);
  var ss=_getSS_();
  var sheet=_getOrCreateSheet_("Contract_Payments");
  var data=sheet.getDataRange().getValues();
  var tz=_tz_();
  var receiptsSumMap = _buildContractReceiptsSumMap_();
  var payments=[], totalScheduled=0, totalPaid=0;
  for (var i=1; i<data.length; i++) {
    var row=data[i];
    if (!row[0]||row[9]===true||String(row[1])!==String(contractId)) continue;
    var amount=parseFloat(row[2])||0;
    var rInfo = receiptsSumMap[String(row[0])] || { totalPaid: 0, lastDate: null, count: 0 };
    var paidAmount = Math.round(rInfo.totalPaid*100)/100;
    var dueDate=row[3] instanceof Date?row[3]:new Date(row[3]);
    var status = paidAmount<=0 ? "مستحق" : (paidAmount>=amount ? "تم السداد" : "مسدد جزئي");
    payments.push({
      paymentId:row[0], contractId:row[1], amount:amount,
      dueDate:_fmtDate_(dueDate,tz,"dd/MM/yyyy"), dueDateHijri:formatHijriDisplay(dueDate),
      paidAmount:paidAmount, remaining:Math.round((amount-paidAmount)*100)/100,
      paidDate: rInfo.lastDate ? _fmtDate_(rInfo.lastDate,tz,"dd/MM/yyyy") : "",
      notes:row[6]||"", status:status, receiptsCount: rInfo.count,
      createdBy:row[7], createdAt:_fmtDate_(row[8] instanceof Date?row[8]:new Date(row[8]),tz,"dd/MM/yyyy HH:mm")
    });
    totalScheduled+=amount; totalPaid+=paidAmount;
  }
  payments.sort(function(a,b){ return _dateOnly_(new Date(a.dueDate.split('/').reverse().join('-'))) - _dateOnly_(new Date(b.dueDate.split('/').reverse().join('-'))); });
  var contractsData=_getOrCreateSheet_("Contracts_Master").getDataRange().getValues();
  var contractValue=0;
  for (var j=1; j<contractsData.length; j++) { if (String(contractsData[j][0])===String(contractId)) { contractValue=parseFloat(contractsData[j][8])||0; break; } }
  // V3.77 — كل دفعات السداد الفعلية للتعاقد (عبر كل أقساطه) مرتبة بتاريخ الدفع، مع إجمالي المسدد والمتبقي من قيمة التعاقد بعد كل دفعة
  var receipts=[];
  try {
    var dueOf={}; payments.forEach(function(p){ dueOf[String(p.paymentId)]=p.dueDate; });
    var rData=_getSheetValues_("Contract_Payment_Receipts"), unalloc=0, payerMapC=_accPayerMap_();
    for (var r=1; r<rData.length; r++) {
      var rr=rData[r];
      if (!rr[0]||rr[9]===true) continue;
      var onInst = Object.prototype.hasOwnProperty.call(dueOf, String(rr[1]));
      if (!onInst) { if (String(rr[2])!==String(contractId)) continue; unalloc += parseFloat(rr[3])||0; } // V3.79 — دفعة على حساب التعاقد بلا قسط
      var pd=rr[4] instanceof Date?rr[4]:new Date(rr[4]);
      receipts.push({ receiptId:rr[0], paymentId:rr[1], amount:Math.round((parseFloat(rr[3])||0)*100)/100,
        _t:isNaN(pd.getTime())?0:pd.getTime(), payDate:isNaN(pd.getTime())?"":_fmtDate_(pd,tz,"dd/MM/yyyy"),
        statement:rr[5]||"", notes:rr[6]||"", installmentDue:dueOf[String(rr[1])]||"", linkedAccountPaymentId:rr[10]||"",
        payerName:(payerMapC[String(rr[10]||"")]||{}).name||"", payerType:(payerMapC[String(rr[10]||"")]||{}).type||"" });
    }
    receipts.sort(function(a,b){ return (a._t-b._t) || String(a.receiptId).localeCompare(String(b.receiptId), undefined, {numeric:true}); });
    var base = contractValue>0 ? contractValue : totalScheduled, cum=0;
    receipts.forEach(function(x){ cum+=x.amount; x.cumPaid=Math.round(cum*100)/100; x.remainingAfter=Math.round((base-cum)*100)/100; delete x._t; });
    if (unalloc>0.005) { totalPaid += unalloc; } // تُحسب ضمن المسدد للتعاقد (الحالة لكل قسط تبقى من دفعاته المسجَّلة عليه)
  } catch(eR) { receipts=[]; }
  return {
    payments:payments, receipts:receipts, contractValue:contractValue,
    totalScheduled:Math.round(totalScheduled*100)/100, totalPaid:Math.round(totalPaid*100)/100,
    totalRemaining:Math.round((totalScheduled-totalPaid)*100)/100,
    unscheduledAmount:Math.round((contractValue-totalScheduled)*100)/100
  };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحفظ قسط سداد جديد أو يُحدّث قسطاً موجوداً لتعاقد معيّن
function saveContractPayment(p, currentUser) { _apiGuard_();
  var _fn="[saveContractPayment]"; _logInfo_(_fn, "START | "+"p:"+String(JSON.stringify(p)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _requireFinancePermission_(currentUser);
  var sheet=_getOrCreateSheet_("Contract_Payments");
  var contractId=String(p.contractId||"").trim(), amount=parseFloat(p.amount)||0;
  var dueDate=new Date(p.dueDate), notes=String(p.notes||"").trim();
  if (!contractId) throw new Error("رقم التعاقد مطلوب.");
  if (amount<=0) throw new Error("قيمة القسط يجب أن تكون أكبر من صفر.");
  if (isNaN(dueDate.getTime())) throw new Error("تاريخ الاستحقاق غير صحيح.");
  var now=new Date();
  if (p.editId) {
    var data=sheet.getDataRange().getValues();
    for (var i=1; i<data.length; i++) {
      if (String(data[i][0])===String(p.editId)) {
        sheet.getRange(i+1,3,1,2).setValues([[amount,dueDate]]);
        sheet.getRange(i+1,7).setValue(notes);
        logAudit("التعاقدات","تعديل قسط سداد",contractId,"","","","تم تعديل قسط سداد بقيمة "+amount+" — استحقاق "+_fmtDate_(dueDate,_tz_(),"dd/MM/yyyy"),currentUser);
        return {success:true, paymentId:p.editId};
      }
    }
    throw new Error("لم يتم العثور على القسط.");
  } else {
    var paymentId=_getNextSequentialId_("P",4);
    sheet.appendRow([paymentId,contractId,amount,dueDate,0,"",notes,currentUser,now,false]);
    logAudit("التعاقدات","إضافة قسط سداد",contractId,"","","","تمت إضافة قسط سداد جديد بقيمة "+amount+" — استحقاق "+_fmtDate_(dueDate,_tz_(),"dd/MM/yyyy"),currentUser);
    return {success:true,paymentId:paymentId};
  }

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحذف قسط سداد (حذف منطقي) — مع حذف منطقي لكل دفعات السداد الفعلية المرتبطة به بشيت Contract_Payment_Receipts
function deleteContractPayment(paymentId, currentUser) { _apiGuard_();
  var _fn="[deleteContractPayment]"; _logInfo_(_fn, "START | "+"paymentId:"+String(JSON.stringify(paymentId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requireFinancePermission_(currentUser);
  var sheet=_getOrCreateSheet_("Contract_Payments");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(paymentId)) {
      sheet.getRange(i+1,10).setValue(true);
      // V3.79 — دفعات السداد المسجَّلة على القسط لا تُحذف معه: تبقى دفعات فعلية للفندق "بلا قسط" (تُخصم بالأقدمية).
      // كان الحذف يمسحها معه — فحذف قسط أُنشئ تلقائياً من دفعة مزدوجة كان يُسقط الدفعة من حساب الفندق.
      var rSheet=_getOrCreateSheet_("Contract_Payment_Receipts");
      var rData=rSheet.getDataRange().getValues(), kept=0;
      for (var k=1; k<rData.length; k++) {
        if (String(rData[k][1])===String(paymentId) && rData[k][9]!==true) { rSheet.getRange(k+1,2).setValue(""); kept++; }
      }
      _invalidateSheetCache_("Contract_Payment_Receipts");
      logAudit("التعاقدات","حذف قسط سداد",data[i][1],"","","","تم حذف قسط سداد بقيمة "+data[i][2]+(kept?(" — "+kept+" دفعة مسجَّلة عليه بقيت دفعات للفندق بلا قسط"):""),currentUser);
      return {success:true};
    }
  }
  throw new Error("لم يتم العثور على القسط.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يسجّل دفعة فعلية مُستلَمة على قسط معيّن (يدعم السداد الجزئي المتعدد على نفس القسط)
// v3.32 — أصبحت كل دفعة سجلاً مستقلاً بتاريخه وبيانه وملاحظاته الخاصة بشيت Contract_Payment_Receipts
// (بدل مجرد رفع رقم إجمالي بلا تفاصيل)، تماماً كما تُسجَّل دفعات العملاء/جهات التحصيل بشاشة الحسابات
// v3.34 — إن تُرك paymentId فارغاً، يُشترَط تمرير contractId: يُنشأ قسط جديد تلقائياً بنفس قيمة الدفعة وتاريخها على
// هذا التعاقد (بدل رفض الطلب)، مما يتيح تسجيل دفعة سداد مباشرة لفندق دون الحاجة لجدولة قسط يدوياً أولاً —
// تماماً كبساطة تسجيل دفعة عميل/جهة تحصيل بشاشة الحسابات
// p: {paymentId, contractId(مطلوب فقط إن كان paymentId فارغاً), amount, payDate, statement, notes, linkedAccountPaymentId}
// linkedAccountPaymentId داخلي فقط: يُمرَّر من دالة saveDualPayment عند تسجيل "دفعة مزدوجة" لربط الطرفين
function recordContractPaymentReceipt(p, currentUser) { _apiGuard_();
  var _fn="[recordContractPaymentReceipt]"; _logInfo_(_fn, "START | "+"p:"+String(JSON.stringify(p)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _requireFinancePermission_(currentUser);
  var paymentId = String(p.paymentId||"").trim();
  var contractIdInput = String(p.contractId||"").trim();
  var amount = parseFloat(p.amount)||0;
  var payDate = p.payDate ? new Date(p.payDate) : new Date();
  var statement = String(p.statement||"").trim();
  var notes = String(p.notes||"").trim();
  var linkedAccountPaymentId = String(p.linkedAccountPaymentId||"").trim();
  if (!paymentId && !contractIdInput) throw new Error("لم يتم تحديد القسط أو التعاقد.");
  if (amount<=0) throw new Error("قيمة الدفعة يجب أن تكون أكبر من صفر.");
  if (isNaN(payDate.getTime())) throw new Error("تاريخ الدفعة غير صحيح.");

  // V3.79 — بلا قسط مُختار: تُسجَّل الدفعة على حساب الفندق (التعاقد) بلا قسط، وتُخصم بالأقدمية في جدول الاستحقاقات.
  // كان يُنشأ قسط جديد بقيمة الدفعة نفسها فيُضاف للمستحق مبلغ وهمي (ويُخفي الدفعة كأنها "قسط تعاقد").
  var contractId = "";
  if (paymentId) {
    var sheet=_getOrCreateSheet_("Contract_Payments");
    var data=sheet.getDataRange().getValues();
    for (var i=1; i<data.length; i++) {
      if (String(data[i][0])===paymentId && data[i][9]!==true) { contractId = data[i][1]; break; }
    }
    if (!contractId) throw new Error("لم يتم العثور على القسط.");
  } else {
    if (!_liveContractHotel_(contractIdInput)) throw new Error("لم يتم العثور على التعاقد (أو أنه محذوف).");
    contractId = contractIdInput;
  }
  var rSheet=_getOrCreateSheet_("Contract_Payment_Receipts");
  var receiptId=_getNextSequentialId_("RCT-",4);
  rSheet.appendRow([receiptId, paymentId, contractId, amount, payDate, statement, notes, currentUser, new Date(), false, linkedAccountPaymentId]);
  _recalcContractPaymentPaidAmount_(paymentId);
  logAudit("التعاقدات","تسجيل سداد",contractId,"","","",
    "تم تسجيل سداد بقيمة "+amount.toLocaleString('en-US')+" ر.س "+(paymentId?("على القسط #"+paymentId):("على حساب التعاقد #"+contractId+" (بلا قسط — يُخصم بالأقدمية)"))
    +(statement?" — "+statement:"")+" بتاريخ "+_fmtDate_(payDate,_tz_(),"dd/MM/yyyy")
    +(linkedAccountPaymentId?" (🔗 دفعة مزدوجة — مرتبطة بدفعة عميل #"+linkedAccountPaymentId+")":""),
    currentUser);
  return {success:true, receiptId:receiptId, paymentId:paymentId, contractId:contractId};

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعيد كل دفعات السداد الفعلية المسجَّلة على قسط واحد (سجل تفصيلي بتاريخ/بيان/ملاحظات كل دفعة)
function getContractPaymentReceipts(paymentId, currentUser) { _apiGuard_();
  var _fn="[getContractPaymentReceipts]"; _logInfo_(_fn, "START | "+"paymentId:"+String(JSON.stringify(paymentId)||"").slice(0, 80));
  try {
  _requireFinancePermission_(currentUser);
  paymentId = String(paymentId||"").trim();
  var data=_getSheetValues_("Contract_Payment_Receipts");
  var tz=_tz_();
  var out=[];
  for (var i=1; i<data.length; i++) {
    var row=data[i];
    if (!row[0]||row[9]===true||String(row[1])!==paymentId) continue;
    var pd=row[4] instanceof Date?row[4]:new Date(row[4]);
    out.push({
      receiptId:row[0], paymentId:row[1], contractId:row[2], amount:parseFloat(row[3])||0,
      payDate: isNaN(pd.getTime())?"":_fmtDate_(pd,tz,"dd/MM/yyyy"),
      payDateIso: isNaN(pd.getTime())?"":_fmtDate_(pd,tz,"yyyy-MM-dd"),
      statement:row[5]||"", notes:row[6]||"", createdBy:row[7]||"",
      createdAt:_fmtDate_(row[8] instanceof Date?row[8]:new Date(row[8]),tz,"dd/MM/yyyy HH:mm"),
      linkedAccountPaymentId: row[10]||""
    });
  }
  out.sort(function(a,b){ return new Date(a.payDateIso||0) - new Date(b.payDateIso||0); });
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعدّل دفعة سداد فعلية موجودة (مبلغ/تاريخ/بيان/ملاحظات) — يُعيد احتساب Paid_Amount للقسط بعدها تلقائياً
function editContractPaymentReceipt(p, currentUser) { _apiGuard_();
  var _fn="[editContractPaymentReceipt]"; _logInfo_(_fn, "START | "+"p:"+String(JSON.stringify(p)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _requireFinancePermission_(currentUser);
  var editId=String(p.editId||"").trim();
  var amount=parseFloat(p.amount)||0;
  var payDate=new Date(p.payDate);
  var statement=String(p.statement||"").trim();
  var notes=String(p.notes||"").trim();
  var newPid=String(p.paymentId||"").trim(); // V3.78 — اختياري: نقل الدفعة لقسط آخر (من تعاقدات الفندق نفسه)
  var doMove = !!p.move || !!newPid, newCidIn = String(p.contractId||"").trim(); // V3.79 — move + paymentId فارغ = بلا قسط على التعاقد contractId
  if (!editId) throw new Error("لم يتم تحديد الدفعة.");
  if (amount<=0) throw new Error("قيمة الدفعة يجب أن تكون أكبر من صفر.");
  if (isNaN(payDate.getTime())) throw new Error("تاريخ الدفعة غير صحيح.");
  var sheet=_getOrCreateSheet_("Contract_Payment_Receipts");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===editId && data[i][9]!==true) {
      var paymentId=data[i][1], contractId=data[i][2], movedTo=null;
      var newCid=null;
      if (doMove && newPid) {
        var cpData=_getOrCreateSheet_("Contract_Payments").getDataRange().getValues();
        for (var q=1; q<cpData.length; q++) { if (String(cpData[q][0])===newPid && cpData[q][9]!==true) { newCid=String(cpData[q][1]); break; } }
        if (!newCid) throw new Error("القسط المطلوب النقل إليه غير موجود أو محذوف.");
      } else if (doMove) { newCid = newCidIn || String(contractId); }
      if (doMove && (newPid!==String(paymentId||"") || newCid!==String(contractId))) {
        if (!_liveContractHotel_(newCid)) throw new Error("لم يتم العثور على التعاقد (أو أنه محذوف).");
        var hMap=_buildContractHotelMap_();
        if (String(hMap[newCid]||"")!==String(hMap[contractId]||"")) throw new Error("لا يمكن نقل الدفعة إلى تعاقد فندق آخر.");
        var allowedH=_getUserAllowedHotels_(currentUser);
        if (allowedH && !allowedH[hMap[newCid]]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
        sheet.getRange(i+1,2,1,2).setValues([[newPid,newCid]]);
        movedTo={paymentId:newPid, contractId:newCid};
      }
      sheet.getRange(i+1,4,1,4).setValues([[amount,payDate,statement,notes]]);
      _recalcContractPaymentPaidAmount_(paymentId);
      if (movedTo) {
        _recalcContractPaymentPaidAmount_(movedTo.paymentId);
        logAudit("التعاقدات","نقل سداد",movedTo.contractId,"","","","نُقلت دفعة السداد #"+editId+" من "+(paymentId?("القسط #"+paymentId):"بلا قسط")+" (تعاقد #"+contractId+") إلى "+(movedTo.paymentId?("القسط #"+movedTo.paymentId):"بلا قسط")+" (تعاقد #"+movedTo.contractId+")",currentUser);
      }
      logAudit("التعاقدات","تعديل سداد",(movedTo?movedTo.contractId:contractId),"","","","تم تعديل دفعة سداد #"+editId+" على "+((movedTo?movedTo.paymentId:paymentId)?("القسط #"+(movedTo?movedTo.paymentId:paymentId)):"حساب التعاقد بلا قسط")+" — القيمة الآن: "+amount.toLocaleString('en-US')+" ر.س",currentUser);
      return {success:true};
    }
  }
  throw new Error("لم يتم العثور على الدفعة.");
  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحذف دفعة سداد فعلية (حذف منطقي) — يُعيد احتساب Paid_Amount للقسط بعدها تلقائياً
// v3.34 — إن كانت الدفعة مرتبطة بـ"دفعة مزدوجة" (linkedAccountPaymentId)، يُحذَف الطرف الآخر (دفعة العميل/جهة التحصيل
// المقابلة بشيت Account_Payments) تلقائياً بنفس العملية أيضاً — الواجهة تُنبّه المستخدم بذلك بعد نجاح الحذف
function deleteContractPaymentReceipt(receiptId, currentUser) { _apiGuard_();
  var _fn="[deleteContractPaymentReceipt]"; _logInfo_(_fn, "START | "+"receiptId:"+String(JSON.stringify(receiptId)||"").slice(0, 80));
  try {
  _requireFinancePermission_(currentUser);
  var sheet=_getOrCreateSheet_("Contract_Payment_Receipts");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(receiptId) && data[i][9]!==true) {
      sheet.getRange(i+1,10).setValue(true);
      var paymentId=data[i][1], contractId=data[i][2], linked=String(data[i][10]||"").trim();
      _recalcContractPaymentPaidAmount_(paymentId);
      var cascaded = false;
      if (linked) {
        var apSheet = _getOrCreateSheet_("Account_Payments");
        var apData = apSheet.getDataRange().getValues();
        for (var k=1; k<apData.length; k++) {
          if (String(apData[k][0])===linked && apData[k][10]!==true) {
            apSheet.getRange(k+1,11).setValue(true);
            cascaded = true;
            break;
          }
        }
        _invalidateSheetCache_("Account_Payments");
      }
      logAudit("التعاقدات","حذف سداد",contractId,"","","",
        "تم حذف دفعة سداد #"+receiptId+" بقيمة "+(parseFloat(data[i][3])||0).toLocaleString('en-US')+" ر.س من القسط #"+paymentId
        +(linked?(" — دفعة مزدوجة: "+(cascaded?"تم حذف الطرف الآخر #"+linked+" تلقائياً أيضاً":"⚠️ تعذّر العثور على الطرف الآخر #"+linked+" (محذوف مسبقاً على الأرجح)")):""),
        currentUser);
      return {success:true, linkedAccountPaymentId: linked, cascaded: cascaded};
    }
  }
  throw new Error("لم يتم العثور على الدفعة.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── الدفعة المزدوجة: العميل/جهة التحصيل يسدّد مبلغاً مباشرة لأحد الفنادق (بدلاً من تحويله للشركة) ───
// فيُسجَّل مرة واحدة في الطرفين معاً بعملية ذرية واحدة: (1) سداد من العميل/الجهة بشاشة الحسابات Account_Payments
// (2) سداد فعلي لصالح الفندق بشيت Contract_Payment_Receipts — مربوطان ببعضهما عبر Linked_*_ID للتتبّع من الطرفين
// p: {partyType, partyKey, partyName, contractId, paymentId(اختياري), amount, payDate, statement, notes}
// paymentId فارغ ⇐ يُنشَأ قسط جديد تلقائياً بنفس قيمة الدفعة وتاريخها (لتغطية حالة عدم وجود قسط مجدوَل مسبقاً)
function saveDualPayment(p, currentUser) { _apiGuard_();
  var _fn="[saveDualPayment]"; _logInfo_(_fn, "START | "+"p:"+String(JSON.stringify(p)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _requirePermission_(currentUser, "accounts", "canAdd");
  _requireFinancePermission_(currentUser);
  var partyType = (p.partyType === "client") ? "client" : "collection";
  var partyKey = String(p.partyKey||"").trim();
  var partyName = String(p.partyName||partyKey).trim();
  var contractId = String(p.contractId||"").trim();
  var amount = parseFloat(p.amount)||0;
  var payDate = new Date(p.payDate);
  var statement = String(p.statement||"").trim();
  var notes = String(p.notes||"").trim();
  var paymentId = String(p.paymentId||"").trim();
  if (!partyKey) throw new Error("لم يُحدَّد الطرف (جهة التحصيل / العميل).");
  if (!contractId) throw new Error("يرجى اختيار الفندق المسدَّد له.");
  if (amount<=0) throw new Error("قيمة الدفعة يجب أن تكون أكبر من صفر.");
  if (isNaN(payDate.getTime())) throw new Error("تاريخ الدفعة غير صحيح.");

  var hotelMap=_buildContractHotelMap_();
  var hotelName=hotelMap[contractId]||contractId;
  var allowed=_getUserAllowedHotels_(currentUser);
  if (allowed && !allowed[hotelName]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");

  // 1) تسجيل دفعة الطرف (عميل/جهة تحصيل) أولاً بدون رابط بعد، للحصول على رقمها
  var apSheet=_getOrCreateSheet_("Account_Payments");
  var apId=_getNextSequentialId_("APY-",4);
  var apMethod = "دفعة مزدوجة";
  var apNotes = notes || ("سدَّدها "+(partyType==="collection"?"جهة التحصيل":"العميل")+" مباشرة لفندق "+hotelName+(statement?" — "+statement:""));
  apSheet.appendRow([apId, partyType, partyKey, partyName, amount, payDate, apMethod, apNotes, currentUser, new Date(), false, hotelName, ""]);

  // v3.34 — جانب الفندق: تطبيق السداد على قسط مُختار، أو إنشاء قسط جديد تلقائياً بنفس قيمة الدفعة إن لم يُحدَّد قسط
  // (أصبح هذا المنطق داخل recordContractPaymentReceipt نفسها الآن — لا تكرار للكود بين هذه الدالة والتسجيل المباشر لفندق)
  var receipt = recordContractPaymentReceipt({
    paymentId: paymentId, contractId: contractId, amount: amount, payDate: payDate,
    statement: statement || ("دفعة مزدوجة من "+(partyType==="collection"?"جهة التحصيل":"العميل")+" "+partyName),
    notes: notes, linkedAccountPaymentId: apId
  }, currentUser);

  // 2) الرجوع لربط دفعة الطرف برقم سداد الفندق (تتبّع من الطرفين معاً)
  var apData=apSheet.getDataRange().getValues();
  for (var i=1; i<apData.length; i++) { if (String(apData[i][0])===apId) { apSheet.getRange(i+1,13).setValue(receipt.receiptId); break; } }
  _invalidateSheetCache_("Account_Payments");

  logAudit("الحسابات","دفعة مزدوجة",apId,"","","",
    "تسجيل دفعة مزدوجة بقيمة "+amount.toLocaleString('en-US')+" ر.س — سدَّدها "+(partyType==="collection"?"جهة التحصيل":"العميل")+" "+partyName
    +" مباشرة لفندق "+hotelName+" ("+(receipt.paymentId?("قسط #"+receipt.paymentId+", "):"بلا قسط، ")+"سداد #"+receipt.receiptId+")"+(statement?" — "+statement:""),
    currentUser);

  return {success:true, accountPaymentId:apId, contractPaymentId:receipt.paymentId, receiptId:receipt.receiptId, hotelName:hotelName};
  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// V3.79 — ربط/استعادة دفعة عميل أو جهة تحصيل كسداد لفندق (دفعة مزدوجة)
// • دفعة مزدوجة سُجّلت قديماً فأنشأ النظام لها قسطاً بقيمتها، ثم حُذف القسط فحُذف معه سداد الفندق: تُستعاد كسداد للفندق
//   (بلا قسط — يُخصم بالأقدمية) بنفس مبلغها وتاريخها وبيانها.
// • دفعة عادية سُدّدت فعلاً لفندق: تُربط به (يُنشأ سداد الفندق المقابل بلا قسط ويُربط الطرفان).
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════════════════════
// V3.80 — مرفقات الدفعات (إيصالات السداد)
// ══════════════════════════════════════════════════════════════════════════════════════════════
var _ATT_SHEET = "Payment_Attachments", _ATT_MAX_BYTES = 8 * 1024 * 1024, _ATT_MAX_PER_PAYMENT = 12;
var _ATT_MIME_RE = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;
function _ensureReceiptsFolder_(fast) {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty("RECEIPTS_FOLDER_ID");
  if (id && fast) { try { return DriveApp.getFolderById(id); } catch (eF) {} } // V3.82 — مسار الرفع: نداء Drive واحد
  var root = _ensureAppRootFolder_();
  if (id) { try { var f = DriveApp.getFolderById(id); if (f.getName() !== "إيصالات السداد") f.setName("إيصالات السداد"); return f; } catch (e) {} }
  var nf = root.createFolder("إيصالات السداد");
  props.setProperty("RECEIPTS_FOLDER_ID", nf.getId());
  return nf;
}
// عدد المرفقات لكل (نوع:رقم) — بلا إنشاء الشيت إن لم يوجد بعد
function _attCountMap_() {
  var m = {};
  try {
    if (!_getSS_().getSheetByName(_ATT_SHEET)) return m;
    var d = _getSheetValues_(_ATT_SHEET);
    for (var i = 1; i < d.length; i++) { if (d[i][0] && d[i][9] !== true) { var k = String(d[i][1]) + ":" + String(d[i][2]); m[k] = (m[k] || 0) + 1; } }
  } catch (e) {}
  return m;
}
function _attCount_(m, kind, ref, linkedKind, linkedRef) {
  return (m[kind + ":" + String(ref || "")] || 0) + (linkedRef ? (m[linkedKind + ":" + String(linkedRef)] || 0) : 0);
}
// يحدد الدفعة صاحبة المرفقات وطرفها المرتبط (الدفعة المزدوجة) وفندقها
function _attRef_(kind, refId) {
  kind = (kind === "receipt") ? "receipt" : "account"; refId = String(refId || "").trim();
  if (!refId) throw new Error("لم تُحدَّد الدفعة.");
  if (kind === "account") {
    var a = _getSheetValues_("Account_Payments");
    for (var i = 1; i < a.length; i++) if (String(a[i][0]) === refId && a[i][10] !== true)
      return { kind: kind, refId: refId, linkedKind: "receipt", linkedRef: String(a[i][12] || ""), hotel: String(a[i][11] || ""), amount: parseFloat(a[i][4]) || 0 };
  } else {
    var r = _getSheetValues_("Contract_Payment_Receipts");
    for (var j = 1; j < r.length; j++) if (String(r[j][0]) === refId && r[j][9] !== true)
    {
      // V3.86 — اسم الفندق يُحسب عند أول استخدام فقط (شيت التعاقدات يُقرأ للمقيَّدين بفنادق لا للمدير): كان قراءة كاملة في كل رفع/قائمة
      var _o = { kind: kind, refId: refId, linkedKind: "account", linkedRef: String(r[j][10] || ""), amount: parseFloat(r[j][3]) || 0 }, _cid = r[j][2], _h = null;
      Object.defineProperty(_o, "hotel", { enumerable: true, get: function() { if (_h === null) _h = String(_buildContractHotelMap_()[_cid] || ""); return _h; } });
      return _o;
    }
  }
  throw new Error("لم يتم العثور على الدفعة (أو أنها محذوفة).");
}
function _attPerm_(currentUser, ref, write) {
  if (ref.kind === "account") {
    if (write) { try { _requirePermission_(currentUser, "accounts", "canEdit"); } catch (e) { _requirePermission_(currentUser, "accounts", "canAdd"); } }
    else _requirePermission_(currentUser, "accounts", "canView");
  } else { _requirePermission_(currentUser, "accounts", "canView"); _requireFinancePermission_(currentUser); }
  var allowed = _getUserAllowedHotels_(currentUser);
  if (allowed && ref.hotel && !allowed[ref.hotel]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
}
function _attRowObj_(row, ref) {
  var tz = _tz_(), at = row[8] instanceof Date ? row[8] : new Date(row[8]);
  return { attachmentId: String(row[0]), kind: String(row[1]), refId: String(row[2]), name: String(row[4] || ""), mime: String(row[5] || ""), size: Number(row[6]) || 0,
    uploadedBy: String(row[7] || ""), uploadedAt: isNaN(at.getTime()) ? "" : _fmtDate_(at, tz, "dd/MM/yyyy HH:mm"),
    linked: !!ref && !(String(row[1]) === ref.kind && String(row[2]) === ref.refId) };
}
// V3.86 — قياس مراحل الرفع (يظهر بتقرير الأداء كـ ~uploadPaymentAttachment:<مرحلة>)
function _attPhase_(name, t0) { try { _recordPerfSample_("~uploadPaymentAttachment:" + name, Date.now() - t0); } catch (e) {} }
var _ATT_FAST_MAX_BYTES = 4500 * 1024; // الرفع متعدد الأجزاء لـ Drive مناسب للملفات الصغيرة (≤5MB)؛ الأكبر عبر DriveApp
// يرفع الملف إلى مجلد الإيصالات عبر واجهة Drive REST بنداء واحد (أسرع بكثير من DriveApp.createFile) ويُعيد معرّف الملف
function _driveUploadRest_(folderId, name, mimeType, bytes) {
  if (!Array.isArray(bytes)) bytes = Array.prototype.slice.call(bytes);
  var boundary = "rcpt" + Utilities.getUuid().replace(/-/g, "");
  var head = Utilities.newBlob("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
    + JSON.stringify({ name: name, mimeType: mimeType, parents: [folderId] })
    + "\r\n--" + boundary + "\r\nContent-Type: " + mimeType + "\r\n\r\n").getBytes();
  var tail = Utilities.newBlob("\r\n--" + boundary + "--").getBytes();
  try { _incrementDailyQuota_("URLFETCH"); } catch (e) {}
  var res = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", {
    method: "post", contentType: "multipart/related; boundary=" + boundary,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, payload: [].concat(head, bytes, tail), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code > 299) throw new Error("HTTP " + code + " " + String(res.getContentText() || "").slice(0, 160));
  var id = JSON.parse(res.getContentText()).id;
  if (!id) throw new Error("HTTP 200 بلا معرّف ملف");
  return String(id);
}
// ينشئ ملف المرفق: REST أولاً، وعند أي إخفاق يعود تلقائياً لـ DriveApp (الطريقة القديمة). عدم صلاحية/مجال (401/403 أو استثناء) يعطّل REST ست ساعات
function _attDriveCreate_(bytes, mimeType, blobName) {
  var off = false, fid = "";
  try { off = !!CacheService.getScriptCache().get("ATT_FAST_OFF"); } catch (e) {}
  try { fid = PropertiesService.getScriptProperties().getProperty("RECEIPTS_FOLDER_ID") || ""; } catch (e) {}
  if (!off && fid && bytes.length <= _ATT_FAST_MAX_BYTES && typeof UrlFetchApp !== "undefined" && typeof ScriptApp !== "undefined") {
    var t = Date.now();
    try { var id = _driveUploadRest_(fid, blobName, mimeType, bytes); _attPhase_("drive-rest", t); return id; }
    catch (e2) {
      var msg = String((e2 && e2.message) || e2), m = /^HTTP (\d{3})/.exec(msg), code = m ? parseInt(m[1], 10) : 0;
      if (!m || code === 401 || code === 403) { try { CacheService.getScriptCache().put("ATT_FAST_OFF", "1", 21600); } catch (e3) {} }
      try { console.warn("[uploadPaymentAttachment] رفع REST تعذّر → DriveApp: " + msg.slice(0, 200)); } catch (e4) {}
    }
  }
  var t2 = Date.now();
  var file = _ensureReceiptsFolder_(true).createFile(Utilities.newBlob(bytes, mimeType, blobName)); // خاص: لا مشاركة ولا رابط عام
  _attPhase_("drive-app", t2);
  return file.getId();
}
// تناديها الواجهة: رفع مرفق لدفعة (base64). الصور تُضغط في المتصفح قبل الرفع
function uploadPaymentAttachment(kind, refId, fileName, mimeType, base64Data, thumbB64, currentUser) { _apiGuard_();
  var _fn = "[uploadPaymentAttachment]"; _logInfo_(_fn, "START | " + kind + ":" + String(refId || "").slice(0, 30));
  try {
  var _tA = Date.now();
  var ref = _attRef_(kind, refId);
  _attPerm_(currentUser, ref, true);
  mimeType = String(mimeType || "").toLowerCase().trim();
  if (!_ATT_MIME_RE.test(mimeType)) throw new Error("نوع الملف غير مدعوم — صورة (JPG/PNG/WEBP/HEIC) أو PDF فقط.");
  var bytes = Utilities.base64Decode(String(base64Data || ""));
  if (!bytes || !bytes.length) throw new Error("الملف فارغ.");
  if (bytes.length > _ATT_MAX_BYTES) throw new Error("حجم الملف أكبر من 8 ميجابايت.");
  var counts = _attCountMap_();
  if (_attCount_(counts, ref.kind, ref.refId, ref.linkedKind, ref.linkedRef) >= _ATT_MAX_PER_PAYMENT) throw new Error("الحد الأقصى " + _ATT_MAX_PER_PAYMENT + " مرفقاً للدفعة الواحدة.");
  var clean = String(fileName || "إيصال").replace(/[\\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80) || "إيصال";
  var stamp = _fmtDate_(new Date(), _tz_(), "yyyyMMdd-HHmmss");
  var blobName = ref.kind + "_" + ref.refId + "_" + stamp + "_" + clean;
  _attPhase_("prep", _tA);
  var fileId = _attDriveCreate_(bytes, mimeType, blobName); // خارج قفل الكتابة (أبطأ خطوة)
  var thumb = String(thumbB64 || ""); if (thumb.length < 200 || thumb.length > 45000 || !/^[A-Za-z0-9+\/=]+$/.test(thumb)) thumb = ""; // معاينة اختيارية: غير الصالحة تُهمَل بصمت
  var upAt = new Date(), id = "", _tC = Date.now();
  _withLock_(function() { // القفل لتسلسل الرقم وكتابة الصفوف فقط
    id = _getNextSequentialId_("ATT-", 5);
    _getOrCreateSheet_(_ATT_SHEET).appendRow([id, ref.kind, ref.refId, fileId, clean, mimeType, bytes.length, currentUser, upAt, false]);
    if (thumb) _getOrCreateSheet_("Payment_Attachment_Thumbs").appendRow([id, thumb]);
    _invalidateSheetCache_(_ATT_SHEET); _invalidateSheetCache_("Payment_Attachment_Thumbs");
  }, 20000);
  _attPhase_("sheets", _tC);
  var _tD = Date.now();
  logAudit("الحسابات", "إرفاق إيصال", ref.refId, "", "", "", "إرفاق " + (mimeType === "application/pdf" ? "ملف PDF" : "صورة") + " «" + clean + "» بدفعة " + (ref.kind === "account" ? "عميل/جهة" : "فندق") + " #" + ref.refId + (ref.linkedRef ? " (دفعة مزدوجة — يظهر عند الطرفين)" : ""), currentUser);
  _attPhase_("audit", _tD);
  var item = _attRowObj_([id, ref.kind, ref.refId, fileId, clean, mimeType, bytes.length, currentUser, upAt, false], ref);
  if (thumb) item.thumb = thumb;
  return { success: true, attachmentId: id, name: clean, item: item }; // الصف كاملاً: الواجهة تضيفه دون نداء قائمة ثانٍ
  } catch (e) { _logError_(_fn, e); throw e; }
}
// تناديها الواجهة: مرفقات دفعة (ومرفقات طرفها المرتبط في الدفعة المزدوجة)
function listPaymentAttachments(kind, refId, currentUser) { _apiGuard_();
  var _fn = "[listPaymentAttachments]";
  try {
  var ref = _attRef_(kind, refId);
  _attPerm_(currentUser, ref, false);
  var out = [];
  if (!_getSS_().getSheetByName(_ATT_SHEET)) return { items: out, linkedRef: ref.linkedRef };
  var d = _getSheetValues_(_ATT_SHEET);
  for (var i = 1; i < d.length; i++) {
    var r = d[i]; if (!r[0] || r[9] === true) continue;
    var mine = String(r[1]) === ref.kind && String(r[2]) === ref.refId, other = ref.linkedRef && String(r[1]) === ref.linkedKind && String(r[2]) === ref.linkedRef;
    if (mine || other) out.push(_attRowObj_(r, ref));
  }
  // V3.82 — المعاينات المصغّرة تصل مع القائمة (كانت الواجهة تجلب كل صورة كاملة بنداء مستقل — بطء وتعليق)
  if (out.length && _getSS_().getSheetByName("Payment_Attachment_Thumbs")) {
    var want = {}; out.forEach(function(o) { want[o.attachmentId] = o; });
    var td = _getSheetValues_("Payment_Attachment_Thumbs");
    for (var t = 1; t < td.length; t++) { var o2 = want[String(td[t][0])]; if (o2 && td[t][1]) o2.thumb = String(td[t][1]); }
  }
  return { items: out, linkedRef: ref.linkedRef };
  } catch (e) { _logError_(_fn, e); throw e; }
}
function _attFind_(attachmentId) {
  var d = _getSheetValues_(_ATT_SHEET);
  for (var i = 1; i < d.length; i++) if (String(d[i][0]) === String(attachmentId) && d[i][9] !== true) return { row: i, data: d[i] };
  throw new Error("لم يتم العثور على المرفق.");
}
// صلاحية الوصول لمرفق: عبر دفعته أو طرفها المرتبط (من يرى أحد الطرفين يرى المرفق)
function _attPermFor_(att, currentUser, write) {
  var ref = _attRef_(att[1], att[2]), err = null;
  try { _attPerm_(currentUser, ref, write); return ref; } catch (e) { err = e; }
  if (ref.linkedRef) { try { var lref = _attRef_(ref.linkedKind, ref.linkedRef); _attPerm_(currentUser, lref, write); return lref; } catch (e2) {} }
  throw err;
}
// تناديها الواجهة: محتوى مرفق (base64) لعرضه داخل البرنامج
function getPaymentAttachmentData(attachmentId, currentUser) { _apiGuard_();
  var _fn = "[getPaymentAttachmentData]";
  try {
  var f = _attFind_(attachmentId);
  _attPermFor_(f.data, currentUser, false);
  var blob = DriveApp.getFileById(String(f.data[3])).getBlob();
  return { attachmentId: String(f.data[0]), name: String(f.data[4] || ""), mime: String(f.data[5] || blob.getContentType() || ""), data: Utilities.base64Encode(blob.getBytes()) };
  } catch (e) { _logError_(_fn, e); throw e; }
}
// تناديها الواجهة: حذف مرفق (الملف يُنقل لسلة Drive)
function deletePaymentAttachment(attachmentId, currentUser) { _apiGuard_();
  var _fn = "[deletePaymentAttachment]";
  try {
  _invalidateSheetCache_(_ATT_SHEET);
  var f = _attFind_(attachmentId);
  _attPermFor_(f.data, currentUser, true);
  _getOrCreateSheet_(_ATT_SHEET).getRange(f.row + 1, 10).setValue(true);
  _invalidateSheetCache_(_ATT_SHEET);
  try { // تفريغ المعاينة (تحرير مساحة الشيت)
    if (_getSS_().getSheetByName("Payment_Attachment_Thumbs")) {
      var tds = _getSheetValues_("Payment_Attachment_Thumbs");
      for (var tr = 1; tr < tds.length; tr++) { if (String(tds[tr][0]) === String(f.data[0])) { _getOrCreateSheet_("Payment_Attachment_Thumbs").getRange(tr + 1, 2).setValue(""); break; } }
      _invalidateSheetCache_("Payment_Attachment_Thumbs");
    }
  } catch (eTh) {}
  try { DriveApp.getFileById(String(f.data[3])).setTrashed(true); } catch (eT) {}
  logAudit("الحسابات", "حذف مرفق", String(f.data[2]), "", "", "", "حذف مرفق «" + String(f.data[4] || "") + "» من دفعة #" + String(f.data[2]), currentUser);
  return { success: true };
  } catch (e) { _logError_(_fn, e); throw e; }
}

// V3.81 — رقم بحد أقصى خانتين عشريتين إن وُجدت كسور (100 ⇒ "100"، 100.5 ⇒ "100.5"، 133.3333 ⇒ "133.33") بفواصل الآلاف
function _fmtNum2_(v) {
  var n = Math.round((parseFloat(v) || 0) * 100) / 100, s = String(n), neg = s.charAt(0) === "-"; if (neg) s = s.slice(1);
  var parts = s.split("."); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + parts.join(".");
}
// خريطة (رقم دفعة العميل/الجهة ← {type, name}) لإظهار اسم المسدِّد على الدفعات المزدوجة بجانب الفندق
function _accPayerMap_() {
  var m = {};
  try {
    var d = _getSheetValues_("Account_Payments");
    for (var i = 1; i < d.length; i++) { if (d[i][0]) m[String(d[i][0])] = { type: String(d[i][1]) === "client" ? "client" : "collection", name: String(d[i][3] || d[i][2] || "") }; }
  } catch (e) {}
  return m;
}
function _payerLabel_(info) { return info ? ((info.type === "client" ? "العميل " : "جهة التحصيل ") + info.name) : ""; }
// V3.81 — إجماليات الحجوزات المعروضة: الغرف، الليالي (غرف × ليالي لكل حجز)، القيمة (null لمن لا يرى الجانب المالي)
function _bookingTotals_(rows) {
  var t = { count: rows.length, rooms: 0, roomNights: 0, value: 0 }, fin = false;
  rows.forEach(function(b) {
    var r = Number(b.roomCount) || 0, n = Number(b.nights) || 0;
    t.rooms += r; t.roomNights += r * n;
    if (b.bookingValue !== undefined) { fin = true; t.value += Number(b.bookingValue) || 0; }
  });
  t.value = fin ? Math.round(t.value * 100) / 100 : null;
  return t;
}

// اسم فندق تعاقد قائم (غير محذوف) أو null — خريطة الفنادق المرجعية تشمل التعاقدات المحذوفة أيضاً
function _liveContractHotel_(cid) {
  var cd=_getSheetValues_("Contracts_Master");
  for (var i=1; i<cd.length; i++) { if (String(cd[i][0])===String(cid)) return cd[i][12]===true ? null : String(cd[i][1]||""); }
  return null;
}
function _dualPartyLabel_(ap) { return (String(ap[1])==="client" ? "العميل " : "جهة التحصيل ") + String(ap[3]||ap[2]||""); }
// يستعيد سداد فندق محذوفاً مرتبطاً بدفعة طرف. يعيد {receiptId, contractId, hotel} أو null إن لم يكن ممكناً
function _restoreLinkedHotelReceipt_(apRow, currentUser) {
  var rid = String(apRow[12]||"").trim(); if (!rid) return null;
  var rSheet=_getOrCreateSheet_("Contract_Payment_Receipts"), rData=rSheet.getDataRange().getValues();
  for (var k=1; k<rData.length; k++) {
    if (String(rData[k][0])!==rid) continue;
    if (rData[k][9]!==true) return { receiptId: rid, contractId: String(rData[k][2]), already: true };
    var cid=String(rData[k][2]), hotel=_liveContractHotel_(cid), hMap={}; hMap[cid]=hotel;
    if (!hotel) return null; // تعاقده محذوف: يُربط يدوياً بتعاقد قائم
    var allowed=_getUserAllowedHotels_(currentUser); if (allowed && !allowed[hotel]) return null;
    var pid=String(rData[k][1]||""), alive=false;
    if (pid) { var cp=_getSheetValues_("Contract_Payments"); for (var q=1; q<cp.length; q++) { if (String(cp[q][0])===pid && cp[q][9]!==true) { alive=true; break; } } }
    rSheet.getRange(k+1,10).setValue(false);
    if (!alive) rSheet.getRange(k+1,2).setValue(""); else _recalcContractPaymentPaidAmount_(pid);
    _invalidateSheetCache_("Contract_Payment_Receipts");
    logAudit("التعاقدات","استعادة سداد",cid,"","","","استُعيدت دفعة السداد #"+rid+" للفندق "+hMap[cid]+" ("+(alive?"على القسط #"+pid:"بلا قسط — يُخصم بالأقدمية")+") — دفعة مزدوجة من "+_dualPartyLabel_(apRow)+" #"+apRow[0],currentUser);
    return { receiptId: rid, contractId: cid, hotel: hMap[cid] };
  }
  return null;
}
function linkAccountPaymentToHotel(accountPaymentId, contractId, currentUser) { _apiGuard_();
  var _fn="[linkAccountPaymentToHotel]"; _logInfo_(_fn, "START | ap:"+String(JSON.stringify(accountPaymentId)||"").slice(0,60));
  try {
  return _withLock_(function() {
  _requirePermission_(currentUser, "accounts", "canEdit");
  _requireFinancePermission_(currentUser);
  accountPaymentId=String(accountPaymentId||"").trim(); contractId=String(contractId||"").trim();
  var apSheet=_getOrCreateSheet_("Account_Payments"); _invalidateSheetCache_("Account_Payments");
  var ap=apSheet.getDataRange().getValues(), row=-1;
  for (var i=1; i<ap.length; i++) { if (String(ap[i][0])===accountPaymentId && ap[i][10]!==true) { row=i; break; } }
  if (row<0) throw new Error("لم يتم العثور على الدفعة.");
  var a=ap[row];
  // 1) مرتبطة بسداد فندق: موجود ⇒ لا شيء، محذوف ⇒ استعادة
  if (String(a[12]||"").trim()) {
    var res=_restoreLinkedHotelReceipt_(a, currentUser);
    if (res && res.already) throw new Error("هذه الدفعة مرتبطة بالفعل بسداد الفندق #"+res.receiptId+".");
    if (res) {
      if (!String(a[11]||"").trim()) apSheet.getRange(row+1,12).setValue(res.hotel);
      _invalidateSheetCache_("Account_Payments");
      return { success:true, restored:true, receiptId:res.receiptId, hotelName:res.hotel };
    }
    if (!contractId) throw new Error("تعذّرت استعادة سداد الفندق المرتبط (تعاقده محذوف) — اختر التعاقد لربطها من جديد.");
  }
  // 2) إنشاء سداد الفندق المقابل (بلا قسط) وربط الطرفين
  if (!contractId) throw new Error("اختر تعاقد الفندق المسدَّد له.");
  var hotel=_liveContractHotel_(contractId);
  if (!hotel) throw new Error("لم يتم العثور على التعاقد (أو أنه محذوف).");
  var allowed=_getUserAllowedHotels_(currentUser);
  if (allowed && !allowed[hotel]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
  var amount=parseFloat(a[4])||0; if (!(amount>0)) throw new Error("قيمة الدفعة غير صحيحة.");
  var payDate=a[5] instanceof Date?a[5]:new Date(a[5]); if (isNaN(payDate.getTime())) throw new Error("تاريخ الدفعة غير صحيح.");
  var statement=String(a[7]||"").trim() || ("دفعة مزدوجة من "+_dualPartyLabel_(a));
  var rSheet=_getOrCreateSheet_("Contract_Payment_Receipts"), rid=_getNextSequentialId_("RCT-",4);
  rSheet.appendRow([rid, "", contractId, amount, payDate, statement, "دفعة مزدوجة من "+_dualPartyLabel_(a), currentUser, new Date(), false, accountPaymentId]);
  _invalidateSheetCache_("Contract_Payment_Receipts");
  apSheet.getRange(row+1,7).setValue("دفعة مزدوجة");
  apSheet.getRange(row+1,12).setValue(hotel);
  apSheet.getRange(row+1,13).setValue(rid);
  _invalidateSheetCache_("Account_Payments");
  logAudit("الحسابات","ربط دفعة بفندق",accountPaymentId,"","","","رُبطت دفعة "+_dualPartyLabel_(a)+" #"+accountPaymentId+" بقيمة "+amount.toLocaleString('en-US')+" ر.س كسداد لفندق "+hotel+" (سداد #"+rid+"، تعاقد #"+contractId+"، بلا قسط — يُخصم بالأقدمية)",currentUser);
  return { success:true, linked:true, receiptId:rid, hotelName:hotel };
  });
  } catch(e) { _logError_(_fn, e); throw e; }
}
// استعادة كل دفعات طرف المزدوجة التي حُذف سداد الفندق المقابل لها (بنقرة واحدة من كشف حسابه)
function restorePartyDualPayments(partyType, partyKey, currentUser) { _apiGuard_();
  var _fn="[restorePartyDualPayments]"; _logInfo_(_fn, "START");
  try {
  return _withLock_(function() {
  _requirePermission_(currentUser, "accounts", "canEdit");
  _requireFinancePermission_(currentUser);
  partyType = (partyType==="client") ? "client" : "collection"; partyKey=String(partyKey||"").trim();
  var apSheet=_getOrCreateSheet_("Account_Payments"); _invalidateSheetCache_("Account_Payments");
  var ap=apSheet.getDataRange().getValues(), restored=0, skipped=0, total=0, hotels={};
  for (var i=1; i<ap.length; i++) {
    var a=ap[i]; if (!a[0] || a[10]===true || String(a[1])!==partyType || String(a[2]||"").trim()!==partyKey || !String(a[12]||"").trim()) continue;
    var res=_restoreLinkedHotelReceipt_(a, currentUser);
    if (res && res.already) continue;
    if (res) { restored++; total+=parseFloat(a[4])||0; hotels[res.hotel]=1; if (!String(a[11]||"").trim()) apSheet.getRange(i+1,12).setValue(res.hotel); }
    else skipped++;
  }
  _invalidateSheetCache_("Account_Payments");
  return { success:true, restored:restored, skipped:skipped, total:Math.round(total*100)/100, hotels:Object.keys(hotels) };
  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يفحص كل أقساط السداد غير المكتملة التي يقترب استحقاقها (خلال 7 أيام) أو فات موعدها، وينشئ تنبيهاً لكل منها
// (بفضل الحارس الداخلي في _createNotification_ لن يتكرر نفس التنبيه أكثر من مرة كل 24 ساعة، محققاً "يظهر يومياً حتى السداد")
function checkDuePaymentsAndNotify(currentUser, force) { _apiGuard_();
  var _fn="[checkDuePaymentsAndNotify]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_bgCheckShouldRun_("DUE_PAYMENTS", force)) return { success:true, skipped:"ran recently" };
  var ss=_getSS_();
  var paymentsData=_getOrCreateSheet_("Contract_Payments").getDataRange().getValues();
  var contractsData=_getOrCreateSheet_("Contracts_Master").getDataRange().getValues();
  var contractHotelMap={}, contractPartyMap={};
  for (var c=1; c<contractsData.length; c++) {
    if (contractsData[c][0]) { contractHotelMap[contractsData[c][0]]=contractsData[c][1]; contractPartyMap[contractsData[c][0]]=contractsData[c][2]; }
  }
  var today=_dateOnly_(new Date());
  var weekFromNow=new Date(today.getFullYear(),today.getMonth(),today.getDate()+7);
  var tz=_tz_();
  var count=0;
  var fifoRem=null;
  try { var sAll=_hotelSchedulesFifo_(null, null); fifoRem={}; Object.keys(sAll).forEach(function(h){ sAll[h].items.forEach(function(it){ if (it.paymentId) fifoRem[it.paymentId]=it.remaining; }); }); } catch(eF) { fifoRem=null; }
  for (var i=1; i<paymentsData.length; i++) {
    var row=paymentsData[i];
    if (!row[0]||row[9]===true) continue;
    var amount=parseFloat(row[2])||0, paidAmount=parseFloat(row[4])||0;
    // V3.79 — المسدد حسب الخصم بالأقدمية على مستوى الفندق (كما في جدول الاستحقاقات)؛ يرجع للقيمة المسجَّلة على القسط عند تعذّره
    if (fifoRem && Object.prototype.hasOwnProperty.call(fifoRem, String(row[0]))) paidAmount = amount - fifoRem[String(row[0])];
    if (paidAmount>=amount-0.005) continue; // مسدد بالكامل - لا حاجة لتنبيه
    var dueDate=_dateOnly_(row[3] instanceof Date?row[3]:new Date(row[3]));
    if (dueDate>weekFromNow) continue; // لم يحن وقت التنبيه بعد (أكثر من أسبوع متبقٍ)
    var contractId=row[1], hotelName=contractHotelMap[contractId]||"", party=contractPartyMap[contractId]||"";
    var remaining=Math.round((amount-paidAmount)*100)/100;
    var isOverdue = dueDate<today;
    var msg = (isOverdue?"⚠️ تجاوز موعد سداد قسط تعاقد "+contractId:"⏰ اقتراب موعد سداد قسط تعاقد "+contractId)+" — "+hotelName;
    var details = "قسط سداد بقيمة "+amount.toLocaleString('en-US')+" لتعاقد "+contractId+" ("+hotelName+" — "+party+")"
      +"\nتاريخ الاستحقاق: "+_fmtDate_(dueDate,tz,"dd/MM/yyyy")+(isOverdue?" (متأخر)":"")
      +"\nالمبلغ المتبقي: "+remaining.toLocaleString('en-US');
    _createNotification_("notif_payment_due", contractId, hotelName, msg, details, "النظام");
    count++;
  }
  return {success:true, notificationsCreated:count};
  } catch(e) { _logError_(_fn, e); throw e; }
}

/**
 * ======================================================================
 * المرحلة 3: شاشة الحجوزات
 * ======================================================================
 */
var BOOKING_STATUSES=["مبدئي","انتظار","مؤكد","مؤكد نسك","ملغي"];

// ─── قائمة التعاقدات للاختيار في نموذج الحجز ───
// يظهر التعاقد الرئيسي فقط بنطاق تاريخ يشمل التعاقدات الإضافية الممتدة بعده
function getActiveContractsForDropdown(currentUser) { _apiGuard_();
  var _fn="[getActiveContractsForDropdown]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  var data=_getSheetValues_("Contracts_Master");
  var tz=_tz_();
  var allowed = currentUser ? _getUserAllowedHotels_(currentUser) : null;
  var contracts={}, supplementsByParent={};

  for (var i=1; i<data.length; i++) {
    var row=data[i]; if (!row[0]||row[12]===true) continue;
    if (allowed && !allowed[row[1]]) continue; // تصفية حسب الفنادق المسموح بها
    var cType=String(row[14]||"رئيسي").trim(), pId=String(row[15]||"").trim();
    var sd=row[3] instanceof Date?row[3]:new Date(row[3]);
    var ed=row[4] instanceof Date?row[4]:new Date(row[4]);
    contracts[row[0]]={contractId:row[0],hotelName:row[1],startDate:sd,endDate:ed,
                        contractType:cType,parentId:pId,city:row[13]||""};
    if (cType==="إضافي"&&pId) {
      if(!supplementsByParent[pId]) supplementsByParent[pId]=[];
      supplementsByParent[pId].push(row[0]);
    }
  }

  var out=[];
  Object.keys(contracts).forEach(function(cid){
    var c=contracts[cid];
    if (c.contractType==="إضافي"&&c.parentId&&contracts[c.parentId]) return;
    var maxEnd=c.endDate;
    var sups=supplementsByParent[cid]||[];
    sups.forEach(function(sid){ var s=contracts[sid]; if(s&&s.endDate>maxEnd) maxEnd=s.endDate; });
    // تاريخ النهاية الفعلي = أبعد تاريخ نهاية بين التعاقد الرئيسي وكل ملاحقه الإضافية (مدمجة ضمن نطاق واحد)
    var label=c.hotelName+" — ("+_fmtDate_(c.startDate,tz,"dd/MM/yyyy")+" إلى "+_fmtDate_(maxEnd,tz,"dd/MM/yyyy")+")";
    out.push({contractId:cid,hotelName:c.hotelName,label:label,city:c.city});
  });
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعيد قائمة أسماء العملاء الفريدة من كل الحجوزات السابقة (لخاصية الإكمال التلقائي)
function getDistinctClientNames() { _apiGuard_();
  var _fn="[getDistinctClientNames]"; _logInfo_(_fn, "START | "+"");
  try {
  var data=_getSheetValues_("Bookings_Master");
  var names={};
  for (var i=1; i<data.length; i++) { if(data[i][2]) names[data[i][2]]=true; }
  return Object.keys(names);
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعيد قائمة جهات التحصيل المتاحة
function getCollectionAccounts() { _apiGuard_();
  var _fn="[getCollectionAccounts]"; _logInfo_(_fn, "START | "+"");
  try {
  // V3.73 — used: للجهة حجز واحد على الأقل غير محذوف. قوائم الفلاتر تعرض المستخدَمة فقط (جهة أُضيفت ثم لم يبقَ لها حجز
  // كانت تظهر في الفلاتر بلا أي نتيجة)؛ قائمة نموذج الحجز تبقى كاملة لاختيارها لحجز جديد.
  return _collMarkUsed_(_collectionAccountsRaw_(), false);
  } catch(e) { _logError_(_fn, e); throw e; }
}

function _collectionAccountsRaw_() {
  var data=_getSheetValues_("Collection_Accounts"), out=[];
  for (var i=1; i<data.length; i++) { if(data[i][0]&&data[i][2]!==false) out.push({id:data[i][0],name:data[i][1]}); }
  return out;
}
// يضيف used لكل جهة من شيت الحجوزات. onlyIfLoaded: لا يقرأ الشيت لأجلها (مسار الإقلاع) — تُترك بلا علامة والمتصفح يشتقّها من قائمة الحجوزات عنده
function _collMarkUsed_(list, onlyIfLoaded) {
  try {
    if (onlyIfLoaded && !__SHEET_VALUES_CACHE.hasOwnProperty("Bookings_Master")) return list;
    var bd=_getSheetValues_("Bookings_Master"), used={};
    for (var b=1; b<bd.length; b++) { if (bd[b][0] && bd[b][14]!==true && bd[b][3]) used[String(bd[b][3]).trim()]=true; }
    return (list||[]).map(function(a){ return {id:a.id,name:a.name,used:!!used[String(a.id).trim()]}; });
  } catch(e) { return list; }
}

// يُضيف جهة تحصيل جديدة سريعاً من داخل نموذج الحجز
function addCollectionAccount(accountName, currentUser) { _apiGuard_();
  var _fn="[addCollectionAccount]"; _logInfo_(_fn, "START | "+"accountName:"+String(JSON.stringify(accountName)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _invalidateSheetCache_("Collection_Accounts"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  _invalidateReferenceCache_(_REF_CACHE_KEY_ACCOUNTS);
  _invalidateReferenceCache_(_REF_CACHE_KEY_COLLECTION_MAP); // v3.37 — إبطال كاش خريطة accountId→الاسم أيضاً
  accountName=String(accountName||"").trim();
  if (!accountName) throw new Error("يرجى إدخال اسم حساب التحصيل.");
  var sheet=_getOrCreateSheet_("Collection_Accounts");
  var newId=_getNextSequentialId_("COL-",3);
  sheet.appendRow([newId,accountName,true]);
  logAudit("الحجوزات","إضافة جهة تحصيل",newId,"","","","إضافة جهة تحصيل: "+accountName,currentUser);
  return {id:newId,name:accountName};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// V3.74 — حذف جهة تحصيل (للمدير فقط). الجهات تُضاف يدوياً من زر ➕ بنموذج الحجز (أو تلقائياً عند الاستيراد الجماعي باسم غير موجود)،
// ولم يكن هناك أي طريق لإزالة جهة أُضيفت بالخطأ. الحذف "ناعم": Is_Active=false فلا تظهر في أي قائمة، ويبقى اسمها مقروءاً في السجل.
// مرفوض إن كان للجهة حجز غير محذوف (ولو ملغياً) أو دفعة مسجَّلة — حتى لا يبقى حجز أو مبلغ معلَّقاً على جهة غير موجودة.
function deleteCollectionAccount(accountId, currentUser) { _apiGuard_();
  var _fn="[deleteCollectionAccount]"; _logInfo_(_fn, "START | accountId:"+String(JSON.stringify(accountId)||"").slice(0, 80)+", currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("حذف جهة التحصيل متاح للمدير فقط.");
  accountId=String(accountId||"").trim();
  if (!accountId) throw new Error("لم تُحدَّد جهة التحصيل المطلوب حذفها.");
  _invalidateSheetCache_("Collection_Accounts");
  var data=_getSheetValues_("Collection_Accounts"), rowIdx=-1, name="";
  for (var i=1; i<data.length; i++) { if (String(data[i][0]).trim()===accountId && data[i][2]!==false) { rowIdx=i; name=String(data[i][1]||accountId); break; } }
  if (rowIdx<0) throw new Error("جهة التحصيل غير موجودة أو محذوفة مسبقاً.");
  var bd=_getSheetValues_("Bookings_Master"), nBk=0, nCan=0;
  for (var b=1; b<bd.length; b++) { if (bd[b][0] && bd[b][14]!==true && String(bd[b][3]).trim()===accountId) { nBk++; if (String(bd[b][4])==="ملغي") nCan++; } }
  if (nBk) throw new Error("لا يمكن حذف «"+name+"»: مسجَّل عليها "+nBk+" حجز"+(nCan?" (منها "+nCan+" ملغي)":"")+". انقل هذه الحجوزات لجهة أخرى أو احذفها أولاً.");
  var pd=_getSheetValues_("Account_Payments"), nPay=0;
  for (var p=1; p<pd.length; p++) { if (pd[p][0] && pd[p][10]!==true && String(pd[p][1])==="collection" && String(pd[p][2]).trim()===accountId) nPay++; }
  if (nPay) throw new Error("لا يمكن حذف «"+name+"»: مسجَّل باسمها "+nPay+" دفعة بشاشة الحسابات. احذف الدفعات أولاً إن كانت مسجَّلة بالخطأ.");
  _getOrCreateSheet_("Collection_Accounts").getRange(rowIdx+1, 3).setValue(false);
  _invalidateSheetCache_("Collection_Accounts");
  _invalidateReferenceCache_(_REF_CACHE_KEY_ACCOUNTS);
  _invalidateReferenceCache_(_REF_CACHE_KEY_COLLECTION_MAP);
  logAudit("الحجوزات","حذف جهة تحصيل",accountId,"","","","حذف جهة تحصيل: "+name,currentUser);
  return {success:true,id:accountId,name:name};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// دالة مساعدة: تبني خريطة contractId → اسم الفندق (تُستخدم في عدة دوال لتفادي إعادة قراءة الشيت)
// v3.37 — مخزَّنة بكاش عابر للتنفيذات (راجع تعليق _buildContractLabelMap_ أعلاه لنفس السبب)
function _buildContractHotelMap_() {
  if (__REF_MAP_MEMO.contractHotel) return __REF_MAP_MEMO.contractHotel;
  var _cached = _getFromCache_(_REF_CACHE_KEY_CONTRACT_HOTEL_MAP);
  if (_cached) { __REF_MAP_MEMO.contractHotel = _cached; return _cached; }
  var data=_getSheetValues_("Contracts_Master");
  var map={};
  for (var i=1; i<data.length; i++) { if(data[i][0]) map[data[i][0]]=data[i][1]; }
  _putInCache_(_REF_CACHE_KEY_CONTRACT_HOTEL_MAP, map);
  __REF_MAP_MEMO.contractHotel = map;
  return map;
}

// دالة مساعدة: تبني خريطة accountId → اسم جهة التحصيل — v3.37 مخزَّنة بكاش عابر للتنفيذات أيضاً
function _buildCollectionAccountMap_() {
  if (__REF_MAP_MEMO.collectionAccount) return __REF_MAP_MEMO.collectionAccount;
  var _cached = _getFromCache_(_REF_CACHE_KEY_COLLECTION_MAP);
  if (_cached) { __REF_MAP_MEMO.collectionAccount = _cached; return _cached; }
  var data=_getSheetValues_("Collection_Accounts");
  var map={};
  for (var i=1; i<data.length; i++) { if(data[i][0]) map[data[i][0]]=data[i][1]; }
  _putInCache_(_REF_CACHE_KEY_COLLECTION_MAP, map);
  __REF_MAP_MEMO.collectionAccount = map;
  return map;
}

// يُعيد كل الحجوزات (غير المحذوفة) مع كل بياناتها المُجهّزة للعرض، مُصفّاة حسب صلاحيات الفنادق
function getBookings(currentUser) { _apiGuard_();
  var _fn="[getBookings]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  var _tStart=Date.now();
  _prefetchRefMaps_(); // V3.57 — الخرائط المرجعية الثلاث في getAll واحدة بدل 3 قراءات كاش
  _requirePermission_(currentUser,"bookings","canView");
  var ss=_getSS_();
  var data=_getSheetValues_("Bookings_Master");
  var tz=_tz_();
  var hotelMap=_buildContractHotelMap_();
  var collMap=_buildCollectionAccountMap_();
  var labelMap=_buildContractLabelMap_();
  var allowed=_getUserAllowedHotels_(currentUser);
  // صلاحية الجزء المالي (availability_finance) موحّدة الآن بين شاشتي التوافر والحجوزات معاً
  var role=_getUserRole_(currentUser);
  var canViewFinance = role==="Admin";
  if (!canViewFinance) {
    var perms=getUserPermissions(currentUser, role);
    canViewFinance = !!(perms.availability_finance && perms.availability_finance.canView);
  }
  var _tRows=Date.now(), _tRead=_tRows-_tStart;
  var ctx={ hotelMap:hotelMap, collMap:collMap, labelMap:labelMap, tz:tz, canViewFinance:canViewFinance };
  var out=[];
  for (var i=1; i<data.length; i++) {
    var row=data[i]; if (!row[0]||row[14]===true) continue;
    var hn=hotelMap[row[1]]||"";
    if (allowed && !allowed[hn]) continue; // تصفية حسب الفنادق المسموح بها
    out.push(_bookingObj_(row, ctx));
  }
  // v3.53 — تفصيل زمني يظهر بلوحة الأداء: قراءة الشيت/الخرائط مقابل بناء الصفوف
  try { _recordPerfSample_("~getBookings:read", _tRead, true); _recordPerfSample_("~getBookings:rows", Date.now()-_tRows, true); } catch(eT) {}
  out.reverse(); return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// V3.58 — بناء كائن حجز واحد للعرض (مشترك بين قائمة الحجوزات ونتيجة الحفظ، فيُحدَّث صف المتصفح فوراً بنفس الشكل)
// أُضيفت: تواريخ ISO (لفتح نموذج التعديل من بيانات المتصفح) وتاريخ السداد (كان عمود "تاريخ السداد" بالجدول فارغاً دائماً)
function _bookingObj_(row, ctx) {
  var tz = ctx.tz, hotelMap = ctx.hotelMap, collMap = ctx.collMap, labelMap = ctx.labelMap;
  var ci=row[6] instanceof Date?row[6]:new Date(row[6]);
  var co=row[7] instanceof Date?row[7]:new Date(row[7]);
  var ca=row[12] instanceof Date?row[12]:new Date(row[12]);
  var pd = (row[21] !== "" && row[21] != null) ? (row[21] instanceof Date ? row[21] : new Date(row[21])) : null;
  if (pd && isNaN(pd.getTime())) pd = null;
  var obj={
    bookingId:row[0], contractId:row[1],
    hotelName:hotelMap[row[1]]||"(فندق محذوف)",
    hotelContractLabel:labelMap[row[1]]||hotelMap[row[1]]||"(فندق محذوف)",
    clientName:row[2], collectionAccount:collMap[row[3]]||row[3], collectionAccountId:row[3],
    status:row[4], roomCount:row[5],
    checkIn:_fmtDateMemo_(ci,tz,"dd/MM/yyyy"),  checkInHijri:formatHijriDisplay(ci),
    checkOut:_fmtDateMemo_(co,tz,"dd/MM/yyyy"), checkOutHijri:formatHijriDisplay(co),
    checkInIso:_fmtDateMemo_(ci,tz,"yyyy-MM-dd"), checkOutIso:_fmtDateMemo_(co,tz,"yyyy-MM-dd"),
    paymentDate: pd ? _fmtDateMemo_(pd,tz,"dd/MM/yyyy") : "", paymentDateIso: pd ? _fmtDateMemo_(pd,tz,"yyyy-MM-dd") : "",
    nights:row[8],
    createdBy:row[11], createdAt:_fmtDateMemo_(ca,tz,"dd/MM/yyyy HH:mm"),
    createdTs:(isNaN(ca.getTime()) ? 0 : ca.getTime()), // V3.59 — مفتاح ترتيب "الأحدث تسجيلاً أولاً" (بلا نداء تنسيق)
    lastEditSummary:row[13]||"",
    notes:row[15]||"", overCapacity:_isOverCap_(row[16]), overCapacityType:row[17]||""
  };
  if (ctx.canViewFinance) { obj.salePrice=row[9]; obj.bookingValue=row[10]; }
  return obj;
}
function _canViewFinance_(currentUser) {
  var role=_getUserRole_(currentUser);
  if (role==="Admin") return true;
  var perms=getUserPermissions(currentUser, role);
  return !!(perms.availability_finance && perms.availability_finance.canView);
}

// V3.58 — حزمة تحميل مسبق: كل بيانات الشاشات التي يملك المستخدم صلاحيتها في نداء واحد (رحلة ذهاب وإياب واحدة
// بدل نداء لكل شاشة، وكل الأجزاء تتشارك نفس قراءات الشيتات المحفوظة داخل التنفيذ). كل جزء مستقل: فشل جزء (صلاحية مثلاً)
// لا يُفشل البقية. المتصفح يخزّن كل جزء تحت نفس مفتاح نداء الشاشة الأصلي، ففتح الشاشة يُجاب من الكاش فوراً.
function getPrefetchBundle(currentUser, req) { _apiGuard_();
  var _fn="[getPrefetchBundle]";
  req = req || {};
  var out = {};
  var part = function(name, f) { try { out[name] = f(); } catch (e) { out[name + "_error"] = String(e && e.message || e).slice(0, 200); } };
  if (req.bookingsAll) part("bookingsAll", function() { return getBookingsAll(currentUser); });
  if (req.bookingModal) part("bookingModal", function() { return getBookingModalBootstrap(currentUser, null); });
  if (req.dashboard) part("dashboard", function() { return getDashboardData(currentUser); });
  if (req.contracts) part("contracts", function() { return getContracts(currentUser); });
  if (req.waitlist) part("waitlist", function() { return getWaitlist(currentUser); });
  if (req.accounts) part("accounts", function() { var a = req.accounts; return getAccountsSummary(a.partyType, currentUser, a.hotel || "", a.fromIso || "", a.toIso || ""); });
  if (Array.isArray(req.availability) && req.availability.length) {
    out.availability = [];
    req.availability.slice(0, 12).forEach(function(r) {
      try { out.availability.push({ hotel: r.hotel, year: r.year, month: r.month, data: getAvailabilityData(r.hotel, r.year, r.month, currentUser) }); } catch (e) {}
    });
  }
  if (req.users) part("users", function() { return getUsersScreenData(currentUser); });
  // V3.68 — البيانات المرجعية (أسماء الفنادق، نطاقات وأشهر التعاقد، جهات التحصيل): تُمسح من كاش المتصفح بعد أي كتابة تمسّها
  // (تعاقد/صلاحيات/فنادق مسموحة)، فكان أول فتح لأي شاشة بعدها يدفع نداءً كاملاً (~3.5 ث) لأسماء الفنادق وحدها
  if (req.refs) part("refs", function() {
    return { hotelNames: getDistinctHotelNames(currentUser), contractRanges: _getContractDateRangesMap_(currentUser),
             collectionAccounts: _getCollectionAccountsCached_(), contractMonths: getContractMonthsByHotel(currentUser) };
  });
  // V3.59 — "إعادة تشغيل" نداءات شاشات فتحها المستخدم سابقاً بنفس وسائطها (سجل التعديلات/شبكة نسك/ملخص الحسابات)
  // فيكون فتحها فورياً. قائمة بيضاء صريحة، واسم المستخدم داخل الوسائط يُفرض = صاحب الطلب (لا قراءة باسم غيره).
  if (Array.isArray(req.replay) && req.replay.length) {
    var table = _prefetchReplayTable_();
    out.replay = [];
    req.replay.slice(0, 10).forEach(function(r) {
      var slot = { fn: r && r.fn };
      try {
        var def = r && table[r.fn], args = (r && Array.isArray(r.args)) ? r.args.slice(0, def ? def.n : 0) : null;
        if (!def || !args) throw new Error("غير مسموح");
        args[def.user] = currentUser;
        slot.args = args; slot.data = def.f.apply(null, args);
      } catch (e) { slot.error = String(e && e.message || e).slice(0, 200); }
      out.replay.push(slot);
    });
  }
  return out;
}
// اسم الدالة → { الدالة، موضع وسيط اسم المستخدم، عدد الوسائط }
function _prefetchReplayTable_() {
  return {
    // ⚠️ لا تُضَف هنا دالة تسجّل "قراءة" بسجل التعديلات (_logRead_: التقرير المالي، كشف الحساب، البيان اليومي…):
    // جلبها مسبقاً بالخلفية يكتب بالسجل أن المستخدم اطّلع على بيانات لم يفتحها فعلاً.
    getGlobalAuditLogPage: { f: getGlobalAuditLogPage, user: 3, n: 4 },
    getNusukGridData: { f: getNusukGridData, user: 4, n: 5 },
    getAccountsSummary: { f: getAccountsSummary, user: 1, n: 5 }
  };
}
// V3.59 — شاشة الصلاحيات في نداء واحد (كانت 3 نداءات متتالية ≈ 8 ث: قائمة الشاشات ← المستخدمون ← أسماء الأدوار)
function getUsersScreenData(currentUser) { _apiGuard_();
  var _fn="[getUsersScreenData]";
  try {
  return { users: getAllUsersWithPermissions(currentUser), roleNames: _getUserRoleNamesMap_() };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// V3.58 — الصف المحفوظ بنفس شكل قائمة الحجوزات (يُحدِّث المتصفح قائمته فوراً بلا إعادة تحميل)؛ فشله لا يُفشل الحفظ
function _savedBookingObj_(rowArr, currentUser) {
  try {
    return _bookingObj_(rowArr, { hotelMap:_buildContractHotelMap_(), collMap:_buildCollectionAccountMap_(), labelMap:_buildContractLabelMap_(), tz:_tz_(), canViewFinance:_canViewFinance_(currentUser) });
  } catch (e) { return null; }
}

// V3.58 — كل حجوزات المستخدم (مع شريط الأوفر) دفعة واحدة: الفلترة والترتيب والترقيم تتم في المتصفح فوراً بدل نداء
// خادم (~3 ث) لكل تغيير فلتر/صفحة. فوق الحد يُرجع tooLarge فتعود الواجهة للترقيم من الخادم (getBookingsPage).
var _BOOKINGS_LOCAL_MAX = 4000;
function getBookingsAll(currentUser) { _apiGuard_();
  var _fn="[getBookingsAll]";
  try {
  var full = getBookings(currentUser);
  var out = { total: full.length, tooLarge: full.length > _BOOKINGS_LOCAL_MAX };
  if (!out.tooLarge) out.rows = full;
  try { out.overcap = getOverCapacityNotifications(currentUser); } catch(eO) {}
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يجلب بيانات حجز واحد بصيغة مناسبة لتعبئة نموذج التعديل
function getBookingForEdit(bookingId) { _apiGuard_();
  var _fn="[getBookingForEdit]"; _logInfo_(_fn, "START | "+"bookingId:"+String(JSON.stringify(bookingId)||"").slice(0, 80));
  try {
  var data=_getSheetValues_("Bookings_Master");
  var tz=_tz_();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(bookingId)) {
      var row=data[i];
      var ci=row[6] instanceof Date?row[6]:new Date(row[6]);
      var co=row[7] instanceof Date?row[7]:new Date(row[7]);
      return { bookingId:row[0],contractId:row[1],clientName:row[2],collectionAccountId:row[3],
        status:row[4],roomCount:row[5],
        checkIn:_fmtDate_(ci,tz,"yyyy-MM-dd"),
        checkOut:_fmtDate_(co,tz,"yyyy-MM-dd"),salePrice:row[9], notes:row[15]||"",
        // V3.58 — إصلاح فقد بيانات: النموذج لم يكن يستلم تاريخ السداد، فكان أي تعديل يحفظه فارغاً ويمسح المسجَّل
        paymentDateIso: (row[21] !== "" && row[21] != null && !isNaN(new Date(row[21]).getTime())) ? _fmtDate_(row[21] instanceof Date ? row[21] : new Date(row[21]), tz, "yyyy-MM-dd") : "" };
    }
  }
  throw new Error("لم يتم العثور على الحجز.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يجلب كل تفاصيل حجز واحد بصيغة مناسبة لعرضها في نافذة "عرض الحجز"
// ⚠️ محمية بالكامل: تتطلب صلاحية عرض الحجوزات + تصفية حسب الفنادق المسموح بها + تصفية الجزء المالي حسب صلاحية availability_finance
function getBookingFullDetails(bookingId, currentUser) { _apiGuard_();
  var _fn="[getBookingFullDetails]"; _logInfo_(_fn, "START | "+"bookingId:"+String(JSON.stringify(bookingId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!currentUser) throw new Error("غير مصرح."); // V3.60 — كان غياب اسم المستخدم يُعامَل كمدير ويُرجع البيانات المالية
  _requirePermission_(currentUser,"bookings","canView"); _logRead_("الحجوزات", bookingId, "عرض تفاصيل حجز #"+bookingId, currentUser);
  var data=_getOrCreateSheet_("Bookings_Master").getDataRange().getValues();
  var tz=_tz_();
  var hotelMap=_buildContractHotelMap_(), collMap=_buildCollectionAccountMap_();
  var labelMap=_buildContractLabelMap_();
  var allowed = currentUser ? _getUserAllowedHotels_(currentUser) : null;
  var role = currentUser ? _getUserRole_(currentUser) : "Admin";
  var canViewFinance = role==="Admin";
  if (!canViewFinance && currentUser) {
    var perms=getUserPermissions(currentUser, role);
    canViewFinance = !!(perms.availability_finance && perms.availability_finance.canView);
  }
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(bookingId)) {
      var row=data[i];
      var hn = hotelMap[row[1]]||"(فندق محذوف)";
      if (allowed && !allowed[hn]) throw new Error("ليس لديك صلاحية الوصول لهذا الحجز (خارج نطاق الفنادق المسموح بها).");
      var ci=row[6] instanceof Date?row[6]:new Date(row[6]);
      var co=row[7] instanceof Date?row[7]:new Date(row[7]);
      var ca=row[12] instanceof Date?row[12]:new Date(row[12]);
      var obj={
        bookingId:row[0],
        hotelName:hn,
        hotelContractLabel:labelMap[row[1]]||hn,
        clientName:row[2], collectionAccount:collMap[row[3]]||row[3], status:row[4], roomCount:row[5],
        checkIn:_fmtDate_(ci,tz,"dd/MM/yyyy"),   checkInHijri:formatHijriDisplay(ci),
        checkOut:_fmtDate_(co,tz,"dd/MM/yyyy"),  checkOutHijri:formatHijriDisplay(co),
        nights:row[8],
        createdBy:row[11],createdAt:_fmtDate_(ca,tz,"dd/MM/yyyy HH:mm"),
        lastEditSummary:row[13]||"",
        notes:row[15]||"", overCapacity:_isOverCap_(row[16]), overCapacityType:row[17]||""
      };
      if (canViewFinance) { obj.salePrice=row[9]; obj.bookingValue=row[10]; }
      obj.nusuk = _nusukForBookingIfAllowed_(bookingId, currentUser); // V3.76 — كانت نداءً ثانياً من نافذة العرض
      return obj;
    }
  }
  throw new Error("لم يتم العثور على الحجز.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحفظ حجزاً جديداً أو يُحدّث حجزاً موجوداً - يشمل فحص توافر السعة، دعم الغرف السالبة (شراء)، وتسجيل كل تغيير
function saveBooking(b, currentUser) { _apiGuard_();
  var _fn="[saveBooking]"; _logInfo_(_fn, "START | "+"b:"+String(JSON.stringify(b)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Bookings_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  _invalidateReferenceCache_(_REF_CACHE_KEY_CLIENTS); // إبطال الكاش المرجعي المؤثر
  _lapStart_();
  _requirePermission_(currentUser,"bookings",b.editId?"canEdit":"canAdd");
  var ss=_getSS_();
  var sheet=_getOrCreateSheet_("Bookings_Master");
  var tz=_tz_();
  var contractId=String(b.contractId||"").trim(), clientName=String(b.clientName||"").trim();
  var collectionAccountId=String(b.collectionAccountId||"").trim(), status=String(b.status||"").trim();
  var checkIn=new Date(b.checkIn), checkOut=new Date(b.checkOut);
  // v3.5 — _toNumber_ يعالج الأرقام العربية/الفارسية من لوحات مفاتيح الموبايل قبل التحقق
  var roomCount=_toNumber_(b.roomCount), salePrice=_toNumber_(b.salePrice);
  var notes=String(b.notes||"").trim();
  var paymentDate = b.paymentDate ? new Date(b.paymentDate) : null;
  var forceOverCapacity=!!b.forceOverCapacity;
  if (!contractId) throw new Error("يرجى اختيار الفندق (التعاقد).");
  if (!clientName) throw new Error("اسم العميل مطلوب.");
  if (!collectionAccountId) throw new Error("يرجى اختيار جهة التحصيل.");
  if (BOOKING_STATUSES.indexOf(status)===-1) throw new Error("حالة الحجز غير صحيحة.");
  if (isNaN(checkIn.getTime())||isNaN(checkOut.getTime())) throw new Error("تاريخ الدخول/الخروج غير صحيح.");
  if (checkOut<=checkIn) throw new Error("تاريخ الخروج يجب أن يكون بعد تاريخ الدخول.");
  // يسمح بعدد غرف سالب لتسجيل عملية شراء غرف من مورد/عميل لاستكمال فترة معينة (لا يجوز أن يكون صفراً)
  if (roomCount===0) throw new Error("عدد الغرف يجب ألا يكون صفراً (استخدم رقماً سالباً لتسجيل شراء غرف).");
  // V3.65 — تحقق الخادم من المدخلات (كانت الواجهة وحدها تتحقق)
  if (!isFinite(roomCount) || Math.floor(roomCount)!==roomCount || Math.abs(roomCount)>5000) throw new Error("عدد الغرف يجب أن يكون رقماً صحيحاً معقولاً.");
  if (!isFinite(salePrice) || salePrice<0 || salePrice>10000000) throw new Error("سعر البيع غير صحيح (لا يُقبل السالب).");
  if (clientName.length>200) throw new Error("اسم العميل طويل جداً (الحد 200 حرف).");
  if (notes.length>2000) throw new Error("الملاحظات طويلة جداً (الحد 2000 حرف).");
  if (paymentDate && isNaN(paymentDate.getTime())) throw new Error("تاريخ السداد غير صحيح.");
  var nights=Math.round((checkOut-checkIn)/86400000);
  var bookingValue=Math.round(roomCount*nights*salePrice*100)/100;
  var now=new Date(), hotelMap=_buildContractHotelMap_(), collMap=_buildCollectionAccountMap_();
  _requireHotelAccess_(currentUser, hotelMap[contractId]); // V3.63

  // ─── فحص التوافر مقابل السعة المتاحة (لا يشمل حجوزات الشراء أو الحالات الملغاة) ───
  var overCapacity=false, overCapacityType="";
  // V3.55 — شيت الحجوزات يُقرأ مرة واحدة هنا ويُمرَّر لفحص التوافر (كان الفحص يقرأ الشيتين كاملين ثم نعيد القراءة أدناه)
  var data=sheet.getDataRange().getValues();
  if (status!=="ملغي") {
    var avail=_checkBookingAvailability_(contractId, checkIn, checkOut, roomCount, b.editId||null, false,
      { bookingsData: data, contractsData: _getSheetValues_("Contracts_Master") });
    if (!avail.ok) {
      if (!forceOverCapacity) {
        return { success:false, needsOverCapacityConfirm:true, shortfallDays:avail.shortfallDays };
      }
      overCapacity=true;
      overCapacityType = b.editId ? "معدل اوفر" : "مسجل اوفر";
    }
  }

  _lap_("saveBooking:readAvail");
  // ─── منع التكرار: رفض الحفظ إن وُجد حجز آخر (غير محذوف) مطابق تماماً لكل بياناته الجوهرية ───
  // يحمي من التسجيل المزدوج (ضغط زر الحفظ مرتين بسرعة فينشأ رقما حجز مختلفان بنفس البيانات) ومن إدخال حجز مكرر يدوياً
  for (var _di=1; _di<data.length; _di++) {
    var _dr=data[_di];
    if (!_dr[0]||_dr[14]===true) continue;
    if (b.editId && String(_dr[0])===String(b.editId)) continue; // استثناء السجل الجاري تعديله من مقارنة نفسه بنفسه
    var _drCi=_dr[6] instanceof Date?_dr[6]:new Date(_dr[6]);
    var _drCo=_dr[7] instanceof Date?_dr[7]:new Date(_dr[7]);
    if (String(_dr[1])===String(contractId)
        && String(_dr[2]).trim()===clientName
        && String(_dr[3])===String(collectionAccountId)
        && String(_dr[4])===status
        && Number(_dr[5])===roomCount
        && _drCi.getTime()===checkIn.getTime()
        && _drCo.getTime()===checkOut.getTime()
        && Number(_dr[9])===salePrice
        && String(_dr[15]||"").trim()===notes) {
      throw new Error("يوجد حجز آخر مطابق تماماً لهذه البيانات بالفعل — رقم الحجز #"+_dr[0]+". لن يتم تسجيل حجز مكرر بنفس البيانات.");
    }
  }

  if (b.editId) {
    for (var i=1; i<data.length; i++) {
      if (String(data[i][0])===String(b.editId)) {
        var oldRow=data[i], rowNum=i+1;
        _requireHotelAccess_(currentUser, hotelMap[oldRow[1]]); // V3.63 — فندق الحجز قبل التعديل أيضاً
        var comparisons=[
          {label:"الفندق",      old:hotelMap[oldRow[1]]||oldRow[1], new:hotelMap[contractId]||contractId},
          {label:"اسم العميل",  old:oldRow[2], new:clientName},
          {label:"جهة التحصيل",old:collMap[oldRow[3]]||oldRow[3], new:collMap[collectionAccountId]||collectionAccountId},
          {label:"حالة الحجز", old:oldRow[4], new:status},
          {label:"عدد الغرف",  old:oldRow[5], new:roomCount},
          {label:"تاريخ الدخول",old:_fmtDate_(new Date(oldRow[6]),tz,"dd/MM/yyyy"),new:_fmtDate_(checkIn,tz,"dd/MM/yyyy")},
          {label:"تاريخ الخروج",old:_fmtDate_(new Date(oldRow[7]),tz,"dd/MM/yyyy"),new:_fmtDate_(checkOut,tz,"dd/MM/yyyy")},
          {label:"سعر البيع",  old:oldRow[9], new:salePrice},
          {label:"ملاحظات",    old:oldRow[15]||"", new:notes}
        ];
        var changedParts=[];
        comparisons.forEach(function(cmp){
          if(String(cmp.old)!==String(cmp.new)){
            logAudit("الحجوزات","تعديل",b.editId,cmp.label,cmp.old,cmp.new,cmp.label+": "+cmp.old+" ← "+cmp.new,currentUser);
            changedParts.push(cmp.label+": "+cmp.old+" ← "+cmp.new);
          }
        });
        var oldStatus = oldRow[4];
        var editSummary=changedParts.length?(changedParts.join(" | ")+" — "+_fmtDate_(now,tz,"dd/MM/yyyy HH:mm")+" — "+currentUser):oldRow[13];
        // V3.55 — كتابة واحدة للأعمدة 2..18 (كانت 5 كتابات منفصلة)؛ الأعمدة غير المعدَّلة (المُنشئ، تاريخ الإنشاء،
        // علامة الحذف) تُعاد كما قُرئت للتو داخل نفس القفل
        var newVals = oldRow.slice(1, 18);
        newVals[0]=contractId; newVals[1]=clientName; newVals[2]=collectionAccountId; newVals[3]=status; newVals[4]=roomCount;
        newVals[5]=checkIn; newVals[6]=checkOut; newVals[7]=nights; newVals[8]=salePrice; newVals[9]=bookingValue;
        newVals[12]=editSummary; newVals[14]=notes; newVals[15]=overCapacity; newVals[16]=overCapacityType;
        while (newVals.length < 17) newVals.push("");
        _lap_("saveBooking:auditDiff");
        sheet.getRange(rowNum,2,1,17).setValues([newVals]);
        _lap_("saveBooking:write");
        if (b.paymentDate !== undefined) sheet.getRange(rowNum,22).setValue(paymentDate||"");
        if (overCapacity) {
          logAudit("الحجوزات","تعديل أوفر",b.editId,"","","","تم حفظ التعديل رغم عدم توفر إمكانية كافية (معدل اوفر)",currentUser);
        }
        // v3.29 — تنبيه واحد فقط لكل تعديل حجز: إن أدى التعديل إلى (معدل اوفر) يُرسَل تنبيه الأوفر وحده،
        // وإلا — وفي حال وُجدت حقول متغيّرة فعلاً — يُرسَل تنبيه التعديل العادي. (سابقاً كان يُرسَل التنبيهان معاً بالأوفر).
        // التفاصيل أصبحت كاملة لكل بيانات الحجز بعد التعديل مع قائمة الحقول المتغيّرة.
        try {
          if (overCapacity) {
            _createNotification_("notif_overcap_edit", b.editId, hotelMap[contractId]||contractId,
              "✏️ تعديل حجز بالأوفر #"+b.editId+" — "+clientName,
              _bookingNotifDetails_({
                headline: "تم تعديل الحجز وتمت الموافقة على تسجيله بالأوفر (رغم عدم توفر إمكانية كافية).",
                bookingId: b.editId, hotelName: hotelMap[contractId]||contractId, clientName: clientName,
                collectionName: collMap[collectionAccountId]||collectionAccountId, roomCount: roomCount, nights: nights,
                checkIn: checkIn, checkOut: checkOut, salePrice: salePrice, bookingValue: bookingValue,
                status: status, overCapacityType: overCapacityType,
                notes: notes, changedParts: (changedParts||[]).slice(0,8), createdBy: currentUser
              }), currentUser);
          } else if (changedParts && changedParts.length) {
            _createNotification_("notif_booking_edit", b.editId, hotelMap[contractId]||contractId,
              "✏️ تعديل حجز #"+b.editId+" — "+clientName,
              _bookingNotifDetails_({
                headline: "تم تعديل الحجز.",
                bookingId: b.editId, hotelName: hotelMap[contractId]||contractId, clientName: clientName,
                collectionName: collMap[collectionAccountId]||collectionAccountId, roomCount: roomCount, nights: nights,
                checkIn: checkIn, checkOut: checkOut, salePrice: salePrice, bookingValue: bookingValue,
                status: status, notes: notes, changedParts: changedParts.slice(0,8), createdBy: currentUser
              }), currentUser);
          }
        } catch(nfErr){ _logError_("[saveBooking→editNotif]", nfErr); }
        if (status==="ملغي" && oldStatus!=="ملغي") {
          // تنبيه: تم إلغاء حجز (تغيّرت حالته إلى ملغي)
          _createNotification_("notif_booking_cancelled", b.editId, hotelMap[contractId]||contractId,
            "تم إلغاء الحجز #"+b.editId+" — "+clientName,
            "تم تغيير حالة الحجز #"+b.editId+" للعميل "+clientName+" في "+(hotelMap[contractId]||contractId)+" إلى (ملغي) بواسطة "+currentUser+".",
            currentUser);
        }
        // v3.10 — إصلاح جذري: كانت هذه الدالة تُستدعى بلا معاملات، فتُحدّث رقم النسخة العام فقط
        // دون إبطال كاش شارت التوافر الفعلي لهذا الفندق/الشهر (TTL حتى 15 دقيقة) — لذا كان التعديل
        // لا يظهر بالشارت فوراً ولا حتى بزر "تحديث" حتى تنتهي صلاحية الكاش من تلقاء نفسها.
        // الآن نُمرّر الفندق والتواريخ الجديدة، ونُبطل أيضاً كاش الفندق/التواريخ القديمة (في حال تغيّرت أثناء التعديل)
        _lap_("saveBooking:notify");
        _bumpAvailabilityVersion_(hotelMap[contractId]||contractId, checkIn, checkOut);
        try {
          var _oldHotelName = hotelMap[oldRow[1]] || oldRow[1];
          var _oldCi = oldRow[6] instanceof Date ? oldRow[6] : new Date(oldRow[6]);
          var _oldCo = oldRow[7] instanceof Date ? oldRow[7] : new Date(oldRow[7]);
          _invalidateAvailCacheForRange_(_oldHotelName, _oldCi, _oldCo);
        } catch(cacheErr) {}
        var _savedRow = oldRow.slice(); for (var _k = 0; _k < 17; _k++) _savedRow[_k + 1] = newVals[_k];
        if (b.paymentDate !== undefined) _savedRow[21] = paymentDate || "";
        return {success:true,bookingId:b.editId, overCapacity: overCapacity, overCapacityType: overCapacityType, row: _savedBookingObj_(_savedRow, currentUser)};
      }
    }
    throw new Error("لم يتم العثور على الحجز المطلوب تعديله.");
  } else {
var bookingId=_getNextSequentialId_("D",3);
    _lap_("saveBooking:newId");
    sheet.appendRow([bookingId,contractId,clientName,collectionAccountId,status,roomCount,
      checkIn,checkOut,nights,salePrice,bookingValue,currentUser,now,"",false,
      notes,overCapacity,overCapacityType,"","","",paymentDate||""]); _lap_("saveBooking:write"); // V3.58 — إصلاح: تاريخ السداد في عمود Booking_Payment_Date (22) لا Client_Option_Date (21)
    logAudit("الحجوزات","إنشاء حجز",bookingId,"","","",
      "حجز جديد: "+clientName+" — "+(hotelMap[contractId]||contractId)+" — "+roomCount+" غرفة"+(overCapacity?" (مسجل اوفر)":""),currentUser);
    // v3.29 — تنبيه واحد فقط لكل حجز جديد: إن كان (مسجل اوفر) يُرسَل تنبيه الأوفر وحده، وإلا تنبيه الحجز الجديد العادي.
    // (سابقاً كان يُرسَل التنبيهان معاً للحجز بالأوفر فيصل إشعاران مكرران). التفاصيل أصبحت كاملة لكل بيانات الحجز.
    var _newBaseDetails = {
      bookingId: bookingId, hotelName: hotelMap[contractId]||contractId, clientName: clientName,
      collectionName: collMap[collectionAccountId]||collectionAccountId, roomCount: roomCount, nights: nights,
      checkIn: checkIn, checkOut: checkOut, salePrice: salePrice, bookingValue: bookingValue,
      status: status, overCapacityType: overCapacity?overCapacityType:"", notes: notes, createdBy: currentUser
    };
    if (overCapacity) {
      _newBaseDetails.headline = "تم تسجيل حجز جديد بالأوفر (رغم عدم توفر إمكانية كافية عند التسجيل).";
      _createNotification_("notif_overcap_new", bookingId, hotelMap[contractId]||contractId,
        "🛎️ حجز جديد بالأوفر #"+bookingId+" — "+clientName,
        _bookingNotifDetails_(_newBaseDetails), currentUser);
    } else {
      _newBaseDetails.headline = "تم تسجيل حجز جديد.";
      _createNotification_("notif_new_booking", bookingId, hotelMap[contractId]||contractId,
        "🛎️ حجز جديد #"+bookingId+" — "+clientName,
        _bookingNotifDetails_(_newBaseDetails), currentUser);
    }
    // v3.10 — نفس إصلاح إبطال كاش شارت التوافر (راجع التعليق بمسار التعديل أعلاه)
    _lap_("saveBooking:auditNotify");
    _bumpAvailabilityVersion_(hotelMap[contractId]||contractId, checkIn, checkOut);
    _lap_("saveBooking:bump");
    return {success:true,bookingId:bookingId, overCapacity: overCapacity, overCapacityType: overCapacityType,
      row: _savedBookingObj_([bookingId,contractId,clientName,collectionAccountId,status,roomCount,checkIn,checkOut,nights,salePrice,bookingValue,currentUser,now,"",false,notes,overCapacity,overCapacityType,"","","",paymentDate||""], currentUser)};
  }

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// v3.17 — يحذف حجزاً حذفاً ناعماً (Soft Delete): لا يُحذف الصف فعلياً، فقط يُعلَّم كمحذوف فيختفي فوراً من كل الشاشات
// والتقارير (نفس آلية الحذف المستخدمة لبقية السجلات بالنظام). يتطلب صلاحية "حذف" على شاشة الحجوزات تحديداً،
// ومقيّد بالفنادق المسموح بها للمستخدم إن وُجد قيد عليه
function deleteBooking(bookingId, currentUser) { _apiGuard_();
  var _fn="[deleteBooking]"; _logInfo_(_fn, "START | "+"bookingId:"+String(JSON.stringify(bookingId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Bookings_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  _requirePermission_(currentUser,"bookings","canDelete");
  var sheet=_getOrCreateSheet_("Bookings_Master");
  var data=sheet.getDataRange().getValues();
  var hotelMap=_buildContractHotelMap_();
  var allowed=_getUserAllowedHotels_(currentUser);
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])!==String(bookingId)) continue;
    if (data[i][14]===true) throw new Error("الحجز محذوف مسبقاً.");
    var hn = hotelMap[data[i][1]] || data[i][1];
    if (allowed && !allowed[hn]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
    var clientName = data[i][2], roomCount = data[i][5];
    var checkIn = data[i][6] instanceof Date ? data[i][6] : new Date(data[i][6]);
    var checkOut = data[i][7] instanceof Date ? data[i][7] : new Date(data[i][7]);
    sheet.getRange(i+1,15).setValue(true); // Is_Deleted (العمود 15)
    logAudit("الحجوزات","حذف حجز",bookingId,"","","","تم حذف الحجز رقم "+bookingId+" — "+clientName+" — "+hn+" — "+roomCount+" غرفة",currentUser);
    // إبطال كاش شارت التوافر لفترة هذا الحجز كي يختفي أثره من الشارت فوراً بدل انتظار انتهاء صلاحية الكاش
    _bumpAvailabilityVersion_(hn, checkIn, checkOut);
    return {success:true};
  }
  throw new Error("لم يتم العثور على الحجز.");
  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── فحص توافر السعة اليومية لفندق تعاقد معيّن خلال فترة حجز معينة ───
// حجوزات الشراء (roomCount سالب) لا تحتاج فحصاً لأنها تضيف طاقة استيعابية ولا تستهلكها.
// excludeOtherOverBookings (اختياري) — عند true، تُستبعد أيضاً أي حجوزات أخرى مسجَّلة (أوفر) بالفعل من حساب "المحجوز"
// (تُعامَل كطلبات استثنائية غير مؤكدة السعة بعد، وليست التزاماً صلباً) — تُستخدم فقط في فحص التأكيد اليدوي العادل
// (راجع manuallyClearOverCapacityFlag) للتحقق: هل يتوفر هذا الحجز بمفرده مقابل الحجوزات "الصلبة" فقط؟
// v3.53 — preloaded (اختياري): {contractsData, bookingsData} مقروءة مسبقاً — getOverCapacityNotifications كانت تعيد
// قراءة شيتي التعاقدات والحجوزات كاملين لكل حجز أوفر على حدة
// ═══ V3.62 — قاعدة الليالي الموحّدة (مصدر واحد لكل الشاشات والتقارير) ═══
// • الحجز يشغل الليالي [تاريخ الدخول، تاريخ الخروج): يوم الخروج غرفته فارغة فلا يُخصم ولا يُحتسب له إيراد.
// • التعاقد يغطي الليالي [تاريخ البداية، تاريخ النهاية): تاريخ النهاية يوم خروج وتسليم الغرف للفندق — لا طاقة ولا تكلفة فيه.
//   (تعاقد 1→30 نوفمبر = 29 ليلة مدفوعة؛ ليلة 30 غير متاحة للبيع.)
// • كل ليلة تُنسب لتاريخها هي (اليوم والشهر) في كل التقارير.
// كانت الدوال تختلف: فحص التوافر والشارت والبيان اليومي ونسك تحسب يوم نهاية التعاقد ليلة متاحة ومكلِّفة،
// والتقرير المالي وقيمة العقد لا تحسبانه؛ والتقرير المالي الشهري كان ينسب الليلة لشهر اليوم التالي لها.
// V3.65 — قراءة واحدة لعلامة "أوفر" (كانت تُقرأ بثلاث صيغ؛ إحداها تعدّ النص "FALSE" أوفر، وأخرى تُسقط القيمة 1)
function _isOverCap_(v) { return v === true || v === 1 || v === "TRUE" || v === "true"; }
function _contractCoversNight_(c, day) { return day >= c.startDate && day < c.endDate; }
// أرقام الحجوزات (غير الملغاة/المحذوفة، بغرف موجبة) التي تشغل ليلة هي تاريخ نهاية تعاقد لفندقها ولا يغطيها أي تعاقد آخر
function _bookingsOnHandoverNight_() {
  var cData = _getSheetValues_("Contracts_Master"), bData = _getSheetValues_("Bookings_Master");
  var byHotel = {}, hotelOf = {};
  for (var i = 1; i < cData.length; i++) {
    var r = cData[i]; if (!r[0] || r[12] === true) continue;
    hotelOf[r[0]] = r[1];
    (byHotel[r[1]] = byHotel[r[1]] || []).push({ startDate: _dateOnly_(r[3] instanceof Date ? r[3] : new Date(r[3])), endDate: _dateOnly_(r[4] instanceof Date ? r[4] : new Date(r[4])) });
  }
  var out = [];
  for (var j = 1; j < bData.length; j++) {
    var b = bData[j]; if (!b[0] || b[14] === true || b[4] === "ملغي" || !((parseFloat(b[5]) || 0) > 0)) continue;
    var cs = byHotel[hotelOf[b[1]]]; if (!cs) continue;
    var ci = _dateOnly_(b[6] instanceof Date ? b[6] : new Date(b[6])), co = _dateOnly_(b[7] instanceof Date ? b[7] : new Date(b[7]));
    var hit = false;
    for (var k = 0; k < cs.length && !hit; k++) {
      var e = cs[k].endDate;
      if (e >= ci && e < co) { var covered = false; for (var m = 0; m < cs.length; m++) if (_contractCoversNight_(cs[m], e)) { covered = true; break; } if (!covered) hit = true; }
    }
    if (hit) out.push(String(b[0]));
  }
  return out;
}

function _checkBookingAvailability_(contractId, checkInDate, checkOutDate, roomCount, excludeBookingId, excludeOtherOverBookings, preloaded) {
  if (roomCount<0) return {ok:true, shortfallDays:[]};
  var ss=_getSS_();
  var hotelMap=_buildContractHotelMap_();
  var hotelName=hotelMap[contractId];
  if (!hotelName) return {ok:true, shortfallDays:[]};

  var contractsData=(preloaded && preloaded.contractsData) || _getOrCreateSheet_("Contracts_Master").getDataRange().getValues();
  var hotelContractIds={}, hotelContracts=[];
  for (var i=1; i<contractsData.length; i++) {
    var crow=contractsData[i];
    if (!crow[0]||crow[12]===true||crow[1]!==hotelName) continue;
    hotelContractIds[crow[0]]=true;
    hotelContracts.push({
      startDate:_dateOnly_(crow[3] instanceof Date?crow[3]:new Date(crow[3])),
      endDate:_dateOnly_(crow[4] instanceof Date?crow[4]:new Date(crow[4])),
      roomCount:parseFloat(crow[6])||0
    });
  }

  var bookingsData=(preloaded && preloaded.bookingsData) || _getOrCreateSheet_("Bookings_Master").getDataRange().getValues();
  var otherBookings=[];
  for (var j=1; j<bookingsData.length; j++) {
    var brow=bookingsData[j];
    if (!brow[0]||brow[14]===true) continue;
    if (excludeBookingId && String(brow[0])===String(excludeBookingId)) continue;
    if (!hotelContractIds[brow[1]]) continue;
    if (brow[4]==="ملغي") continue;
    if (excludeOtherOverBookings && _isOverCap_(brow[16])) continue;
    otherBookings.push({
      checkIn:_dateOnly_(brow[6] instanceof Date?brow[6]:new Date(brow[6])),
      checkOut:_dateOnly_(brow[7] instanceof Date?brow[7]:new Date(brow[7])),
      roomCount:parseFloat(brow[5])||0
    });
  }

  var tz=_tz_(), shortfallDays=[];
  var cur=_dateOnly_(checkInDate), end=_dateOnly_(checkOutDate);
  while (cur<end) {
    var cap=0;
    hotelContracts.forEach(function(hc){ if (_contractCoversNight_(hc, cur)) cap+=hc.roomCount; });
    var booked=0;
    otherBookings.forEach(function(ob){ if (cur>=ob.checkIn&&cur<ob.checkOut) booked+=ob.roomCount; });
    var available=cap-booked;
    if (available-roomCount<0) {
      shortfallDays.push({date:_fmtDate_(cur,tz,"dd/MM/yyyy"), available:available, needed:roomCount});
    }
    cur=new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()+1); // زيادة تقويمية آمنة (لا تتأثر بالتوقيت الصيفي)
  }
  return { ok: shortfallDays.length===0, shortfallDays: shortfallDays };
}

// ─── تنبيهات: حجوزات "أوفر" أصبح لها الآن إمكانية كافية ───
function getOverCapacityNotifications(currentUser) { _apiGuard_();
  var _fn="[getOverCapacityNotifications]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser,"bookings","canView");
  // v3.22 — بانر "توفر إمكانية لحجز أوفر" هو نفس نوع notif_overcap_resolved؛ إن عُطِّل هذا النوع نظامياً يختفي البانر أيضاً
  if (_isNotifTypeDisabled_("notif_overcap_resolved")) return [];
  // تحقق من صلاحية عرض تنبيهات تجاوز الطاقة (Admin يراها دائماً)
  var role=_getUserRole_(currentUser);
  if (role!=="Admin") {
    var perms=getUserPermissions(currentUser,role);
    if (!perms.overcapacity_notifications||!perms.overcapacity_notifications.canView) return [];
  }
  var ss=_getSS_();
  var data=_getSheetValues_("Bookings_Master"); // V3.54 — مشتركة مع getBookings عند النداء من getBookingsPage
  var hotelMap=_buildContractHotelMap_(), tz=_tz_();
  var allowed=_getUserAllowedHotels_(currentUser);
  var _pre=null; // v3.53 — تُقرأ مرة واحدة فقط عند وجود أول حجز أوفر (بدل مرتين لكل حجز)
  var out=[];
  for (var i=1; i<data.length; i++) {
    var row=data[i];
    if (!row[0]||row[14]===true) continue;
    if (!_isOverCap_(row[16])) continue; // V3.65 — كانت القيمة النصية "FALSE" تُعدّ أوفر
    if (row[4]==="ملغي") continue;
    var hn=hotelMap[row[1]]||"";
    if (allowed && !allowed[hn]) continue;
    var ci=row[6] instanceof Date?row[6]:new Date(row[6]);
    var co=row[7] instanceof Date?row[7]:new Date(row[7]);
    if (!_pre) _pre={ contractsData:_getSheetValues_("Contracts_Master"), bookingsData:data };
    var avail=_checkBookingAvailability_(row[1], ci, co, parseFloat(row[5])||0, row[0], false, _pre);
    if (avail.ok) {
      out.push({
        bookingId:row[0], clientName:row[2], hotelName:hn,
        roomCount:row[5], checkIn:_fmtDate_(ci,tz,"dd/MM/yyyy"), checkOut:_fmtDate_(co,tz,"dd/MM/yyyy"),
        overCapacityType:row[17]||""
      });
      // إنشاء تنبيه دائم بمجرد اكتشاف توفر الإمكانية (مرة واحدة فقط بفضل الحارس الداخلي لمنع التكرار)
      _createNotification_("notif_overcap_resolved", row[0], hn,
        "توفرت إمكانية للحجز #"+row[0]+" ("+row[2]+")",
        "الحجز #"+row[0]+" للعميل "+row[2]+" في "+hn+" كان مسجلاً كـ'"+ (row[17]||"أوفر") +"' وأصبح له الآن إمكانية كافية خلال الفترة "+_fmtDate_(ci,tz,"dd/MM/yyyy")+" — "+_fmtDate_(co,tz,"dd/MM/yyyy")+".",
        "النظام");
    }
  }
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ═══════════════════════════════════════════════════════════════
// نظام التنبيهات (جرس الإشعارات)
// ═══════════════════════════════════════════════════════════════

// v3.22 — تفعيل/تعطيل كل نوع تنبيه على مستوى النظام بالكامل (Admin فقط)، يُخزَّن بخصائص السكريبت المشتركة
// (وليس تفضيلاً لكل مستخدم)، ويؤثر على كل مستخدم في كل مكان يظهر فيه هذا النوع: زر الجرس أو أي شاشة أخرى
var _notifTypesDisabledCache_ = null; // كاش داخل نفس التنفيذ فقط لتفادي قراءات متكررة من PropertiesService
function _isNotifTypeDisabled_(type) {
  if (_notifTypesDisabledCache_ === null) {
    _notifTypesDisabledCache_ = {};
    try {
      var raw = PropertiesService.getScriptProperties().getProperty("DISABLED_NOTIF_TYPES");
      if (raw) (JSON.parse(raw)||[]).forEach(function(t){ _notifTypesDisabledCache_[t]=true; });
    } catch(e) {}
  }
  return !!_notifTypesDisabledCache_[type];
}
// v3.23 — إرسال أنواع تنبيهات مختارة أيضاً إلى تليجرام (بالإضافة إلى ظهورها بزر الجرس)، بتفعيل مستقل لكل نوع
var _notifTypesTelegramCache_ = null;
function _isNotifTypeTelegramEnabled_(type) {
  if (_notifTypesTelegramCache_ === null) {
    _notifTypesTelegramCache_ = {};
    try {
      var raw = PropertiesService.getScriptProperties().getProperty("TELEGRAM_NOTIF_TYPES");
      if (raw) (JSON.parse(raw)||[]).forEach(function(t){ _notifTypesTelegramCache_[t]=true; });
    } catch(e) {}
  }
  return !!_notifTypesTelegramCache_[type];
}
// يجلب حالتي كل نوع تنبيه حالياً: مُفعَّل عاماً؟ ومُرسَل لتليجرام؟ (Admin فقط) — تُستخدم لرسم مفاتيح التبديل بشاشة الإعدادات
function getGlobalNotificationSettings(currentUser) { _apiGuard_();
  var _fn="[getGlobalNotificationSettings]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var props = PropertiesService.getScriptProperties();
  var disabled = {}, telegram = {};
  try { var raw1 = props.getProperty("DISABLED_NOTIF_TYPES"); if (raw1) (JSON.parse(raw1)||[]).forEach(function(t){ disabled[t]=true; }); } catch(e){}
  try { var raw2 = props.getProperty("TELEGRAM_NOTIF_TYPES");  if (raw2) (JSON.parse(raw2)||[]).forEach(function(t){ telegram[t]=true; }); } catch(e){}
  return { disabledTypes: disabled, telegramTypes: telegram };
  } catch(e) { _logError_(_fn, e); throw e; }
}
// يُبدّل حالة نوع تنبيه واحد (تفعيل/تعطيل) على مستوى النظام بالكامل — يُحفظ فوراً (Admin فقط)
function setNotifTypeEnabled(typeId, isEnabled, currentUser) { _apiGuard_();
  var _fn="[setNotifTypeEnabled]"; _logInfo_(_fn, "START | "+"typeId:"+String(JSON.stringify(typeId)||"").slice(0, 80)+", "+"isEnabled:"+String(JSON.stringify(isEnabled)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  typeId = String(typeId||"").trim();
  if (!typeId) throw new Error("نوع تنبيه غير صحيح.");
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("DISABLED_NOTIF_TYPES");
  var disabled = {};
  if (raw) { try { (JSON.parse(raw)||[]).forEach(function(t){ disabled[t]=true; }); } catch(e){} }
  if (isEnabled) delete disabled[typeId]; else disabled[typeId]=true;
  props.setProperty("DISABLED_NOTIF_TYPES", JSON.stringify(Object.keys(disabled)));
  _bumpNotifVersion_();
  _notifTypesDisabledCache_ = null; // إبطال الكاش الداخلي كي يُعاد قراءته بالقيمة الجديدة فوراً
  logAudit("النظام", isEnabled?"تفعيل نوع تنبيه":"تعطيل نوع تنبيه", "", "", "", "",
    (isEnabled?"تم تفعيل":"تم تعطيل")+" كل التنبيهات من نوع: "+typeId+" على مستوى النظام بالكامل", currentUser);
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}
// v3.23 — يُبدّل إرسال نوع تنبيه واحد إلى تليجرام (بصرف النظر عن تفعيله العام) — يُحفظ فوراً (Admin فقط)
function setTelegramNotifTypeEnabled(typeId, isEnabled, currentUser) { _apiGuard_();
  var _fn="[setTelegramNotifTypeEnabled]"; _logInfo_(_fn, "START | "+"typeId:"+String(JSON.stringify(typeId)||"").slice(0, 80)+", "+"isEnabled:"+String(JSON.stringify(isEnabled)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  typeId = String(typeId||"").trim();
  if (!typeId) throw new Error("نوع تنبيه غير صحيح.");
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("TELEGRAM_NOTIF_TYPES");
  var telegram = {};
  if (raw) { try { (JSON.parse(raw)||[]).forEach(function(t){ telegram[t]=true; }); } catch(e){} }
  if (isEnabled) telegram[typeId]=true; else delete telegram[typeId];
  props.setProperty("TELEGRAM_NOTIF_TYPES", JSON.stringify(Object.keys(telegram)));
  _notifTypesTelegramCache_ = null;
  logAudit("النظام", isEnabled?"تفعيل إرسال تليجرام لنوع تنبيه":"تعطيل إرسال تليجرام لنوع تنبيه", "", "", "", "",
    (isEnabled?"تم تفعيل":"تم تعطيل")+" إرسال التنبيهات من نوع: "+typeId+" إلى تليجرام", currentUser);
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}
// يُعيد التسمية العربية المعروضة لنوع تنبيه معيّن (من نفس مصدر مصفوفة الصلاحيات ALL_SCREENS)
function _notifTypeLabel_(type) {
  for (var i=0; i<ALL_SCREENS.length; i++) { if (ALL_SCREENS[i].id === type) return ALL_SCREENS[i].label; }
  return type;
}
// يُهرب رموز HTML الخاصة قبل إرسال نص لتليجرام بوضع HTML (Telegram Bot API تتطلب هروب & < > فقط)
function _escapeTelegramHtml_(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// v3.24 — سجل تخزين خفيف مستقل تماماً لتتبع "آخر إرسال" لكل (نوع+حجز) إلى تليجرام، منفصل كلياً عن Notifications_Master
// ضروري لأن تفعيل تليجرام لنوع مُعطَّل عاماً (أو العكس) يعني أن صف الجرس قد لا يُكتب إطلاقاً، فلا يصلح الاعتماد على
// وجوده لمنع تكرار إرسال نفس الرسالة على تليجرام في كل مرة يُعاد فيها فحص نفس الحالة (مثل فحوصات "توفر إمكانية" المتكررة)
function _telegramDedupCheckAndMark_(type, bookingId) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("TELEGRAM_SENT_LOG");
  var map = {};
  if (raw) { try { map = JSON.parse(raw) || {}; } catch(e) { map = {}; } }
  var key = type + "|" + bookingId;
  var now = Date.now();
  var DAY_MS = 24*60*60*1000;
  Object.keys(map).forEach(function(k){ if (now - map[k] > DAY_MS) delete map[k]; }); // تنظيف الإدخالات الأقدم من 24 ساعة
  var isDuplicate = map[key] && (now - map[key] < DAY_MS);
  if (isDuplicate) return false; // أُرسلت رسالة مطابقة مؤخراً — لا تُرسل مجدداً
  map[key] = now;
  props.setProperty("TELEGRAM_SENT_LOG", JSON.stringify(map));
  return true;
}

// دالة داخلية: تُنشئ تنبيهاً جديداً بشرط عدم وجود تنبيه مطابق (نفس النوع + نفس الحجز) لم يُقرأ بعد لأي مستخدم -
// هذا الحارس يمنع تكرار نفس التنبيه في كل مرة يُعاد فيها فحص الحالة (مثل فحص "توفر إمكانية" المتكرر عند كل تحميل لشاشة الحجوزات)
// v3.24 — تفعيل/تعطيل "عام" (زر الجرس) وتفعيل/تعطيل "تليجرام" أصبحا مستقلَّين تماماً عن بعضهما: يمكن تفعيل الإرسال
// إلى تليجرام لنوع مُعطَّل بزر الجرس والعكس صحيح، ولكل منهما آلية منع تكرار خاصة به لا تتأثر بحالة الأخرى
// v3.27 — كامل الجسم أصبح داخل try/catch عام: أي خلل غير متوقع (بالجزء العام أو تليجرام) يُسجَّل بوضوح في سجل التنفيذ
// (Executions) بدل أن يتسرّب لأعلى بصمت ويُبتلَع في try/catch فارغ لدى المستدعي (كما كان يحدث بمسار تعديل الحجز)،
// ولا يُسمح لأي فشل هنا بإيقاف العملية الأصلية (حفظ حجز/تعاقد) التي استدعت هذه الدالة مهما حدث
// v3.29 — يبني كتلة تفاصيل كاملة لحجز لاستخدامها في نص التنبيه (زر الجرس + تليجرام) بدل النص المختصر.
// تُعرض كل بيانات الحجز الجوهرية في أسطر مرتبة؛ تُستخدم بموحّد لكل أنواع تنبيهات الحجز (جديد/أوفر/تعديل).
function _bookingNotifDetails_(p) {
  var tz = _tz_();
  function d(x){ try { return _fmtDate_(x instanceof Date ? x : new Date(x), tz, "dd/MM/yyyy"); } catch(e){ return String(x||""); } }
  function m(n){ var v = Number(n); if (isNaN(v)) v = 0; return v.toLocaleString('en-US'); }
  var L = [];
  if (p.headline) L.push(p.headline);
  L.push("🔖 رقم الحجز: #" + (p.bookingId||""));
  L.push("🏨 الفندق: " + (p.hotelName||""));
  L.push("👤 العميل: " + (p.clientName||""));
  if (p.collectionName) L.push("💼 جهة التحصيل: " + p.collectionName);
  L.push("🛏️ عدد الغرف: " + (p.roomCount) + "  —  🌙 عدد الليالي: " + (p.nights));
  L.push("📅 الدخول: " + d(p.checkIn) + "  —  الخروج: " + d(p.checkOut));
  L.push("💵 سعر البيع: " + m(p.salePrice) + " ر.س  —  💰 قيمة الحجز: " + m(p.bookingValue) + " ر.س");
  L.push("📌 الحالة: " + (p.status||""));
  if (p.overCapacityType) L.push("⚠️ حالة الأوفر: " + p.overCapacityType);
  if (p.notes) L.push("📝 ملاحظات: " + p.notes);
  if (p.changedParts && p.changedParts.length) L.push("✏️ التغييرات: " + p.changedParts.join(" | "));
  L.push("👨‍💻 بواسطة: " + (p.createdBy||""));
  return L.join("\n");
}

function _createNotification_(type, bookingId, hotelName, message, details, createdBy) {
  if (__DEFER_NOTIFS) { __DEFERRED_NOTIFS.push([type, bookingId, hotelName, message, details, createdBy]); return; } // V3.70
  try {
  var generalEnabled = !_isNotifTypeDisabled_(type);
  var telegramEnabled = _isNotifTypeTelegramEnabled_(type);
  if (!generalEnabled && !telegramEnabled) return; // مُعطَّل بالكامل من الجهتين — لا داعي لأي عمل

  if (generalEnabled) {
    var sheet = _getOrCreateSheet_("Notifications_Master");
    // تحقق: هل يوجد تنبيه بنفس النوع لنفس الحجز خلال آخر 24 ساعة؟ (لتفادي التكرار عند الفحوصات المتكررة)
    // V3.55 — فهرس واحد لكل تنفيذ بدل قراءة شيت الإشعارات كاملاً (ينمو بلا حد) عند كل تنبيه — كانت الفحوصات
    // وشريط الأوفر تنادي هذه الدالة داخل حلقات فتقرأ الشيت كله مرة لكل عنصر
    var now = new Date();
    var dedup = _notifDedupIndex_(sheet), dkey = type + "\u0001" + String(bookingId);
    var isDup = dedup[dkey] != null && (now.getTime() - dedup[dkey]) < 24*60*60*1000;
    if (!isDup) {
      var notifId = _getNextSequentialId_("N", 5);
      sheet.appendRow([notifId, type, bookingId, hotelName||"", message, details||"", now, createdBy||"النظام"]);
      dedup[dkey] = now.getTime();
      _invalidateSheetCache_("Notifications_Master"); // قراءة لاحقة بنفس التنفيذ (getMyNotifications) ترى الجديد
      _bumpNotifVersion_();
    }
  }

  if (telegramEnabled && _telegramDedupCheckAndMark_(type, bookingId)) {
    try {
      // v3.30 — سطر ثابت في نهاية كل رسالة تليجرام يوضّح مصدر التنبيه: "المصدر: شارت <اسم الفندق>"
      var _tgSourceTail = hotelName ? ("\n\nالمصدر : شارت " + _escapeTelegramHtml_(hotelName)) : "";
      var tgText = "🔔 <b>" + _escapeTelegramHtml_(_notifTypeLabel_(type)) + "</b>\n" + _escapeTelegramHtml_(message)
        + (details ? "\n" + _escapeTelegramHtml_(details) : "") + _tgSourceTail;
      // v3.43 — إرسال غير متزامن: لا ننتظر استجابة تليجرام هنا (قد تتأخر وتُبطئ حفظ الحجز/التعاقد على المستخدم)،
      // بل نُجدولها لتُرسَل فعلياً خلال ثانية عبر مشغّل زمني لمرة واحدة (انظر _sendTelegramMessageAsync_)
      _sendTelegramMessageAsync_(tgText);
    } catch(tgErr) { _logError_("[_createNotification_→Telegram]", tgErr); }
  }
  } catch(genErr) { _logError_("[_createNotification_]", genErr); }
}

// V3.55 — {نوع + رقم الحجز → أحدث وقت إنشاء} من آخر 3000 تنبيه فقط (الشيت يُلحَق زمنياً، ونافذة منع التكرار 24 ساعة)
var __NOTIF_DEDUP = null;
var _NOTIF_DEDUP_TAIL = 3000;
function _notifDedupIndex_(sheet) {
  if (__NOTIF_DEDUP) return __NOTIF_DEDUP;
  var idx = {};
  var last = sheet.getLastRow();
  if (last >= 2) {
    var n = Math.min(last - 1, _NOTIF_DEDUP_TAIL);
    var rows = sheet.getRange(last - n + 1, 1, n, 7).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      var t = new Date(rows[i][6]).getTime();
      if (isNaN(t)) continue;
      var k = rows[i][1] + "\u0001" + String(rows[i][2]);
      if (idx[k] == null || t > idx[k]) idx[k] = t;
    }
  }
  return (__NOTIF_DEDUP = idx);
}

// يجلب كل التنبيهات التي يحق لهذا المستخدم استقبالها (حسب صلاحيات نوع التنبيه + الفنادق المسموح بها) مع حالة القراءة الخاصة به
function getMyNotifications(currentUser) { _apiGuard_();
  var _fn="[getMyNotifications]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!currentUser) return [];
  var role = _getUserRole_(currentUser);
  var perms = getUserPermissions(currentUser, role);
  var allowedHotels = _getUserAllowedHotels_(currentUser);
  var ss = _getSS_();
  var notifData = _getSheetValues_("Notifications_Master");
  var readData = _getSheetValues_("Notification_Reads");
  var tz = _tz_();

  // فهرسة قراءات هذا المستخدم فقط لسرعة البحث
  var readSet = {};
  for (var r=1; r<readData.length; r++) {
    if (String(readData[r][1])===String(currentUser)) readSet[readData[r][0]] = true;
  }

  var out = [];
  for (var i=notifData.length-1; i>=1; i--) {
    var row = notifData[i];
    if (!row[0]) continue;
    var type = row[1];
    // v3.22 — نوع مُعطَّل على مستوى النظام بالكامل يختفي فوراً من الجرس للجميع (حتى المدير)، وليس فقط يتوقف إنشاء الجديد منه
    if (_isNotifTypeDisabled_(type)) continue;
    // Admin يستقبل كل أنواع التنبيهات دائماً؛ غيره يحتاج صلاحية صريحة لهذا النوع
    if (role!=="Admin" && (!perms[type] || !perms[type].canView)) continue;
    // تصفية حسب الفنادق المسموح بها (تنبيه بلا فندق محدد يظهر للجميع ممن يملكون صلاحية النوع)
    if (allowedHotels && row[3] && !allowedHotels[row[3]]) continue;
    out.push({
      notificationId: row[0], type: type, bookingId: row[2], hotelName: row[3],
      message: row[4], details: row[5],
      createdAt: _fmtDate_(new Date(row[6]), tz, "dd/MM/yyyy HH:mm"),
      isRead: !!readSet[row[0]]
    });
    if (out.length >= 100) break; // حد أقصى معقول لعدد التنبيهات المُعادة
  }
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعلّم تنبيهاً واحداً كمقروء لهذا المستخدم تحديداً (لا يؤثر على ظهوره لمستخدمين آخرين)
function markNotificationRead(notificationId, currentUser) { _apiGuard_();
  var _fn="[markNotificationRead]"; _logInfo_(_fn, "START | "+"notificationId:"+String(JSON.stringify(notificationId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _invalidateSheetCache_("Notification_Reads"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  var sheet = _getOrCreateSheet_("Notification_Reads");
  var data = sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(notificationId) && String(data[i][1])===String(currentUser)) return {success:true}; // مقروء بالفعل
  }
  sheet.appendRow([notificationId, currentUser, new Date()]);
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعلّم كل التنبيهات الظاهرة حالياً لهذا المستخدم كمقروءة دفعة واحدة (زر "تعليم الكل كمقروء")
function markAllNotificationsRead(currentUser) { _apiGuard_();
  var _fn="[markAllNotificationsRead]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _invalidateSheetCache_("Notification_Reads"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  var visible = getMyNotifications(currentUser);
  var sheet = _getOrCreateSheet_("Notification_Reads");
  var existing = sheet.getDataRange().getValues();
  var already = {};
  for (var i=1; i<existing.length; i++) {
    if (String(existing[i][1])===String(currentUser)) already[existing[i][0]] = true;
  }
  var now = new Date(), rows = [];
  visible.forEach(function(n) {
    if (!already[n.notificationId]) rows.push([n.notificationId, currentUser, now]);
  });
  if (rows.length) sheet.getRange(sheet.getLastRow()+1, 1, rows.length, 3).setValues(rows);
  return {success:true, count: rows.length};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── إزالة علامة "أوفر" عن حجز بعد التأكد من توفر إمكانية كافية له ───
function clearOverCapacityFlag(bookingId, currentUser) { _apiGuard_();
  var _fn="[clearOverCapacityFlag]"; _logInfo_(_fn, "START | "+"bookingId:"+String(JSON.stringify(bookingId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _invalidateSheetCache_("Bookings_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  _requirePermission_(currentUser,"bookings","canEdit");
  var sheet=_getOrCreateSheet_("Bookings_Master");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(bookingId)) {
      sheet.getRange(i+1,17,1,2).setValues([[false,""]]);
      logAudit("الحجوزات","تأكيد توفر الحجز",bookingId,"","","","تم تأكيد توفر إمكانية للحجز وإزالة علامة (أوفر)",currentUser);
      // v3.10 — إبطال كاش شارت التوافر (كانت علامة "أوفر" تبقى ظاهرة بالشارت لعدم إبطال الكاش هنا إطلاقاً)
      try {
        var _hn = (_buildContractHotelMap_())[data[i][1]] || data[i][1];
        var _ci = data[i][6] instanceof Date ? data[i][6] : new Date(data[i][6]);
        var _co = data[i][7] instanceof Date ? data[i][7] : new Date(data[i][7]);
        _bumpAvailabilityVersion_(_hn, _ci, _co);
      } catch(cacheErr) {}
      return {success:true};
    }
  }
  throw new Error("لم يتم العثور على الحجز.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// v3.21 — يُزيل علامة "أوفر" عن حجز يدوياً، لكن بشرط عادل: يتحقق أولاً هل يتوفر هذا الحجز بمفرده مقابل الحجوزات
// "الصلبة" فقط (أي كل الحجوزات النشطة ما عدا الحجوزات الأخرى المسجَّلة أوفر أيضاً، التي تُعامَل كطلبات استثنائية
// غير مؤكدة السعة بعد). إن كان يتوفر ضمن هذا الشرط، فهو فعلاً "غير مسبِّب" للتجاوز ويُسمح بتأكيده. أما إن كان
// النقص قائماً حتى مع استثناء الحجوزات الأخرى (أي التجاوز مشترك حقاً بين عدة حجوزات ولا يمكن عزو المسؤولية له
// وحده)، يُرفض الطلب — تماماً كما لو كانت كل الحجوزات المتشاركة بحاجة فعلية لإبقاء علامة (أوفر).
// ملاحظة: الترتيب مؤثر — تأكيد حجز يُحرّر له السعة فعلياً (يُستبعد من قائمة "الحجوزات الأخرى أوفر" لاحقاً)، فقد
// يصبح حجز آخر قابلاً للتأكيد بعده ولم يكن كذلك قبله؛ هذا سلوك مقصود (أول من يُراجَع يحظى بالسعة أولاً)
function manuallyClearOverCapacityFlag(bookingId, currentUser) { _apiGuard_();
  var _fn="[manuallyClearOverCapacityFlag]"; _logInfo_(_fn, "START | "+"bookingId:"+String(JSON.stringify(bookingId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _invalidateSheetCache_("Bookings_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  _requirePermission_(currentUser,"bookings","canEdit");
  var sheet=_getOrCreateSheet_("Bookings_Master");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(bookingId)) {
      if (!_isOverCap_(data[i][16])) throw new Error("هذا الحجز غير مسجَّل كـ(أوفر) أصلاً.");
      var _contractId=data[i][1];
      var _ci = data[i][6] instanceof Date ? data[i][6] : new Date(data[i][6]);
      var _co = data[i][7] instanceof Date ? data[i][7] : new Date(data[i][7]);
      var _rc = parseFloat(data[i][5])||0;
      var _avail=_checkBookingAvailability_(_contractId, _ci, _co, _rc, bookingId, true);
      if (!_avail.ok) {
        var _lines=(_avail.shortfallDays||[]).slice(0,3).map(function(s){return s.date+' (المتاح '+s.available+' / المطلوب '+s.needed+')';}).join('، ');
        throw new Error("لا يمكن تأكيد هذا الحجز بدون (أوفر): النقص لا يزال قائماً حتى مع استثناء الحجوزات الأخرى المسجَّلة أوفر — أي أن التجاوز مشترك فعلياً بين عدة حجوزات. مثال: "+_lines);
      }
      sheet.getRange(i+1,17,1,2).setValues([[false,""]]);
      logAudit("الحجوزات","تأكيد يدوي بدون أوفر",bookingId,"","","",
        "تم تأكيد هذا الحجز وإزالة علامة (أوفر) عنه — تحقَّق أنه يتوفر ضمن السعة عند استثناء الحجوزات الأخرى المسجَّلة أوفر أيضاً",currentUser);
      try {
        var _hn = (_buildContractHotelMap_())[_contractId] || _contractId;
        _bumpAvailabilityVersion_(_hn, _ci, _co);
      } catch(cacheErr) {}
      return {success:true};
    }
  }
  throw new Error("لم يتم العثور على الحجز.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

/**
 * ======================================================================
 * المرحلة 4: شاشة التوافر
 * ======================================================================
 */
// دالة مساعدة صغيرة: تُعيد نسخة من تاريخ بدون مكوّن الوقت (للمقارنات الآمنة بين التواريخ)
function _dateOnly_(d){ return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }

// يبني كل بيانات شبكة التوافر الشهرية لفندق معيّن (السعة اليومية، الحجوزات، الأيام الهجرية/الميلادية) - القلب الحسابي لشاشة التوافر
function getAvailabilityData(hotelName, year, month, currentUser) { _apiGuard_();
  var _fn="[getAvailabilityData]"; _logInfo_(_fn, "START | "+"hotelName:"+String(JSON.stringify(hotelName)||"").slice(0, 80)+", "+"year:"+String(JSON.stringify(year)||"").slice(0, 80)+", "+"month:"+String(JSON.stringify(month)||"").slice(0, 80));
  try {
  // V3.55 — إصلاح أمني + أداء: الكاش كان مفتاحه (فندق × شهر) فقط بينما محتواه يعتمد على صلاحيات أول من فتح الشارت
  // (بيانات الحجز/الأسعار)، والمسار المخزَّن كان يتخطى فحص صلاحية الشاشة. الآن: فحص الصلاحيات دائماً أولاً، والكاش
  // يحفظ النسخة الكاملة، وتُحذف منها الحقول غير المسموحة لكل مستخدم عند الإرجاع (_availForUser_).
  _requirePermission_(currentUser,"availability","canView");
  var _allowedAv = currentUser ? _getUserAllowedHotels_(currentUser) : null;
  if (_allowedAv && hotelName && !_allowedAv[hotelName]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
  var role=_getUserRole_(currentUser), perms=getUserPermissions(currentUser,role);
  var canViewBookingData=!!(perms.availability_booking_data&&perms.availability_booking_data.canView);
  var canViewFinance=!!(perms.availability_finance&&perms.availability_finance.canView);
  var full = (hotelName && year && month) ? _getAvailFromCache_(hotelName, year, month) : null;
  if (!full) {
    full = _buildAvailabilityFull_(hotelName, year, month);
    if (hotelName && year && month) _putAvailInCache_(hotelName, year, month, full);
  }
  return _availForUser_(full, canViewBookingData, canViewFinance);
  } catch(e) { _logError_(_fn, e); throw e; }
}

// V3.55 — يحذف من النسخة الكاملة ما لا يحق للمستخدم رؤيته (نفس شكل الناتج القديم تماماً لكل حالة صلاحية)
function _availForUser_(full, canViewBookingData, canViewFinance) {
  var out = {};
  Object.keys(full).forEach(function(k) { out[k] = full[k]; });
  out.dailySales = canViewFinance ? full.dailySales : null;
  out.dailyCost = canViewFinance ? full.dailyCost : null;
  out.bookingDataHidden = !canViewBookingData;
  out.financeHidden = !canViewFinance;
  if (!canViewBookingData) out.bookingRows = [];
  else if (!canViewFinance) out.bookingRows = (full.bookingRows || []).map(function(r) {
    var c = {}; Object.keys(r).forEach(function(k) { if (k !== "salePrice" && k !== "bookingValue") c[k] = r[k]; }); return c;
  });
  return out;
}

// V3.55 — عرض نطاق تاريخ متعدد الأشهر في نداء واحد (كان حتى 14 نداءً متوازياً يقرأ كل منها الشيتين كاملين)
function getAvailabilityDataMulti(hotelName, months, currentUser) { _apiGuard_();
  var _fn="[getAvailabilityDataMulti]";
  try {
  months = (months || []).slice(0, 14);
  return months.map(function(m) { return getAvailabilityData(hotelName, m.year, m.month, currentUser); });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// النسخة الكاملة (كل الحقول) لشارت فندق × شهر — لا فحص صلاحيات هنا (يتم في getAvailabilityData)
function _buildAvailabilityFull_(hotelName, year, month) {
  var canViewBookingData = true, canViewFinance = true;
  var tz=_tz_();
  year=parseInt(year,10); month=parseInt(month,10);
  var daysInMonth=new Date(year,month,0).getDate();
  var monthStart=new Date(year,month-1,1), monthEnd=new Date(year,month-1,daysInMonth);

  // التعاقدات (رئيسية + إضافية) تساهم كلها في السعة اليومية — قراءة للعرض فقط: محفوظة لكل تنفيذ (تشترك فيها الأشهر المتعددة)
  var contractsData=_getSheetValues_("Contracts_Master");
  var hotelContracts=[], hotelContractIds={};
  for (var i=1; i<contractsData.length; i++) {
    var crow=contractsData[i];
    if (!crow[0]||crow[12]===true||crow[1]!==hotelName) continue;
    hotelContracts.push({
      startDate:_dateOnly_(crow[3] instanceof Date?crow[3]:new Date(crow[3])),
      endDate:_dateOnly_(crow[4] instanceof Date?crow[4]:new Date(crow[4])),
      roomCount:parseFloat(crow[6])||0, roomPrice:parseFloat(crow[7])||0
    });
    hotelContractIds[crow[0]]=true;
  }
  // v3.15 — dailyCost: التكلفة اليومية = طاقة التعاقد كاملة لهذا اليوم (عدد الغرف × سعر الغرفة) بصرف النظر عن الحجز الفعلي
  var dailyCapacity=[], dailyCost=[];
  for (var d=1; d<=daysInMonth; d++) {
    var dd=new Date(year,month-1,d), cap=0, costD=0;
    for (var hc=0; hc<hotelContracts.length; hc++) {
      var hcc=hotelContracts[hc];
      if (_contractCoversNight_(hcc, dd)) { cap+=hcc.roomCount; costD+=hcc.roomCount*hcc.roomPrice; }
    }
    dailyCapacity.push(cap);
    dailyCost.push(Math.round(costD*100)/100);
  }
  var bookingsData=_getSheetValues_("Bookings_Master");
  var collMap=_buildCollectionAccountMap_();
  // v3.15 — dailySales: مبيعات اليوم = مجموع (عدد الغرف × سعر البيع لليلة) لكل حجز فعّال ذلك اليوم
  // v3.35 — حجوزات الشراء (عدد سالب) تدخل الآن ضمن المبيعات بإشارتها السالبة فتُخصَم من الإيراد المعروض تلقائياً
  // (بدل استبعادها بالكامل كما كان سابقاً)، بنفس منطق البيان اليومي والتقرير المالي — لتطابق كل التقارير بعضها
  var dailyBooked=new Array(daysInMonth).fill(0), dailySales=new Array(daysInMonth).fill(0), bookingRows=[];
  for (var j=1; j<bookingsData.length; j++) {
    var brow=bookingsData[j];
    if (!brow[0]||brow[14]===true||!hotelContractIds[brow[1]]) continue;
    var ci=_dateOnly_(brow[6] instanceof Date?brow[6]:new Date(brow[6]));
    var co=_dateOnly_(brow[7] instanceof Date?brow[7]:new Date(brow[7]));
    if (co<=monthStart||ci>monthEnd) continue;
    var bStatus=brow[4], bRC=parseFloat(brow[5])||0, bSalePrice=parseFloat(brow[9])||0, dayValues=[];
    for (var d2=1; d2<=daysInMonth; d2++) {
      var dd2=new Date(year,month-1,d2);
      if (bStatus!=="ملغي"&&dd2>=ci&&dd2<co) {
        dailyBooked[d2-1]+=bRC; dayValues.push(String(bRC));
        dailySales[d2-1]+=bRC*bSalePrice;
      }
      else if (dd2.getTime()===co.getTime()) dayValues.push("*");
      else dayValues.push("");
    }
    if (canViewBookingData) {
      var bCreatedAt = brow[12] instanceof Date ? brow[12] : new Date(brow[12]);
      var bObj={bookingId:brow[0],clientName:brow[2],collectionAccount:collMap[brow[3]]||brow[3],
        status:bStatus,roomCount:bRC,
        checkIn:_fmtDate_(ci,tz,"dd/MM/yyyy"),checkOut:_fmtDate_(co,tz,"dd/MM/yyyy"),
        nights:brow[8],createdBy:brow[11],dayValues:dayValues,
        createdAt:_fmtDate_(bCreatedAt,tz,"dd/MM/yyyy HH:mm"), createdAtSort:bCreatedAt.getTime(),
        notes:brow[15]||"",
        paymentDate:brow[21]&&brow[21]!==""?_fmtDate_(brow[21] instanceof Date?brow[21]:new Date(brow[21]),tz,"dd/MM/yyyy"):"",
        paymentDateIso:brow[21]&&brow[21]!==""?_fmtDate_(brow[21] instanceof Date?brow[21]:new Date(brow[21]),tz,"yyyy-MM-dd"):"", overCapacity:_isOverCap_(brow[16])};
      if (canViewFinance) { bObj.salePrice=brow[9]; bObj.bookingValue=brow[10]; }
      bookingRows.push(bObj);
    }
  }
  // v3.15 — تقريب مصفوفة المبيعات اليومية بعد اكتمال تجميعها من كل الحجوزات
  for (var ds=0; ds<dailySales.length; ds++) dailySales[ds]=Math.round(dailySales[ds]*100)/100;
  var EN_DAY_ABBR=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var todayStr=_dateOnly_(new Date()).toDateString(), dayHeaders=[];
  for (var d4=1; d4<=daysInMonth; d4++) {
    var dd4=new Date(year,month-1,d4), h4=_gregorianToHijri_(dd4);
    dayHeaders.push({day:d4,dayNameEn:EN_DAY_ABBR[dd4.getDay()],
      isToday:dd4.toDateString()===todayStr,isFriday:dd4.getDay()===5,
      hijriDay:h4.day,hijriMonth:h4.month,hijriYear:h4.year,hijriMonthName:h4.monthName});
  }
  // v3.15 — dailySales/dailyCost: أساس صفوف "المبيعات/التكلفة/الربح-الخسارة" الجديدة أسفل شارت التوافر
  // مُتاحة فقط لمن يملك صلاحية الجانب المالي (نفس صلاحية availability_finance المستخدمة للأعمدة المالية الأخرى)
  var _outAV = {daysInMonth:daysInMonth,dayHeaders:dayHeaders,dailyCapacity:dailyCapacity,dailyBooked:dailyBooked,
    dailySales:canViewFinance?dailySales:null, dailyCost:canViewFinance?dailyCost:null,
    bookingDataHidden:!canViewBookingData,financeHidden:!canViewFinance,bookingRows:bookingRows};
  return _outAV;
}

/**
 * ======================================================================
 * المرحلة 5: إدارة المستخدمين والصلاحيات
 * ======================================================================
 */
// يُعيد قائمة كل المستخدمين بالنظام (Admin فقط) - تُستخدم في شاشة الصلاحيات
// ⚡ تحسين أداء: تُعيد كل المستخدمين مع صلاحياتهم الكاملة دفعة واحدة (قراءة واحدة لكل شيت بدلاً من طلب منفصل لكل مستخدم)
// (سابقاً كانت هناك دالة getAllUsers مهجورة — حُذفت لأنها لم تعد مستدعاة بعد اعتماد الدالة الأشمل أدناه)
function getAllUsersWithPermissions(currentUser) { _apiGuard_();
  var _fn="[getAllUsersWithPermissions]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var ss = _getSS_();
  var usersData = _getOrCreateSheet_("Users_Master").getDataRange().getValues();
  var permsData = _getOrCreateSheet_("Permissions_Master").getDataRange().getValues();

  // فهرسة صلاحيات كل مستخدم مسبقاً في خريطة واحدة (قراءة واحدة فقط لشيت الصلاحيات لكل المستخدمين معاً)
  var permsByUser = {};
  for (var p=1; p<permsData.length; p++) {
    var uname = permsData[p][0]; if (!uname) continue;
    if (!permsByUser[uname]) permsByUser[uname] = {};
    permsByUser[uname][permsData[p][1]] = { canView:permsData[p][2]===true, canAdd:permsData[p][3]===true,
                                             canEdit:permsData[p][4]===true, canDelete:permsData[p][5]===true };
  }

  var out=[];
  for (var i=1; i<usersData.length; i++) {
    if (!usersData[i][0]) continue;
    var username=usersData[i][0], role=usersData[i][3];
    var perms;
    if (role==="Admin") {
      perms="Admin"; // العلامة الخاصة التي تفهمها الواجهة كـ"كل الصلاحيات دائماً"
    } else {
      perms={};
      ALL_SCREENS.forEach(function(scr){
        perms[scr.id] = (permsByUser[username] && permsByUser[username][scr.id])
          || {canView:false,canAdd:false,canEdit:false,canDelete:false};
      });
    }
    out.push({username:username, fullName:usersData[i][2], role:role, isActive:usersData[i][4]!==false, permissions:perms});
  }
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُضيف مستخدماً جديداً للنظام (Admin فقط)
function addUser(username, password, fullName, role, currentUser) { _apiGuard_();
  var _fn="[addUser]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", password:[hidden]"+", "+"fullName:"+String(JSON.stringify(fullName)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Users_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  username=String(username||"").trim(); password=String(password||"").trim(); fullName=String(fullName||"").trim();
  if (!username||!password||!fullName) throw new Error("يرجى تعبئة جميع الحقول.");
  if (["Admin","User"].indexOf(role)===-1) throw new Error("دور غير صحيح.");
  var sheet=_getOrCreateSheet_("Users_Master");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0]).toLowerCase()===username.toLowerCase()) throw new Error("اسم المستخدم موجود بالفعل.");
  }
  var _s = _pwGenerateSalt_(); sheet.appendRow([username, _pwHash_(password, _s), fullName, role, true, _s]);
  _invalidateAuthCache_(); // V3.55 — بعد الكتابة أيضاً (يغلق نافذة إعادة بناء اللقطة بقيم قديمة أثناء الكتابة)
  logAudit("إدارة المستخدمين","إضافة مستخدم",username,"","","",
    "تمت إضافة مستخدم جديد: "+fullName+" ("+(role==="Admin"?"مدير":"مستخدم عادي")+")",currentUser);
  return {success:true};

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُبدّل حالة تفعيل/تعطيل مستخدم معيّن (الحالة المعاكسة لحالته الراهنة)
function toggleUserActive(username, currentUser) { _apiGuard_();
  var _fn="[toggleUserActive]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var sheet=_getOrCreateSheet_("Users_Master");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(username)) {
      var nv=!(data[i][4]!==false); sheet.getRange(i+1,5).setValue(nv);
      _invalidateSheetCache_("Users_Master"); if (!nv) _killUserSessions_(username); // V3.63
      logAudit("إدارة المستخدمين","تفعيل/تعطيل مستخدم",username,"","","",(nv?"تفعيل":"تعطيل")+" "+username,currentUser);
      return {success:true,isActive:nv};
    }
  }
  throw new Error("المستخدم غير موجود.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يضبط حالة تفعيل مستخدم معيّن إلى قيمة محددة (true/false) مباشرة - يُستخدم من أزرار ⏸️/🔒 في مصفوفة الصلاحيات
function setUserActiveState(username, isActive, currentUser) { _apiGuard_();
  var _fn="[setUserActiveState]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"isActive:"+String(JSON.stringify(isActive)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  if (_getUserRole_(username)==="Admin") throw new Error("لا يمكن تعطيل المدير.");
  var sheet=_getOrCreateSheet_("Users_Master");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(username)) {
      sheet.getRange(i+1,5).setValue(!!isActive);
      _invalidateSheetCache_("Users_Master"); // V3.63 — لقطة الصلاحيات تُبنى من جديد فوراً (التعطيل يسري على الجلسات المفتوحة)
      if (!isActive) _killUserSessions_(username);
      logAudit("إدارة المستخدمين","تفعيل/تعطيل مستخدم",username,"","","",(isActive?"تفعيل":"تعطيل")+" "+username,currentUser);
      return {success:true,isActive:!!isActive};
    }
  }
  throw new Error("المستخدم غير موجود.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحذف مستخدماً نهائياً من النظام مع كل صلاحياته المخصصة (Admin فقط، ولا يمكن حذف مدير أو حذف الحساب الشخصي)
function deleteUser(username, currentUser) { _apiGuard_();
  var _fn="[deleteUser]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _invalidateSheetCache_("Users_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  if (_getUserRole_(username)==="Admin") throw new Error("لا يمكن حذف المدير.");
  if (String(username)===String(currentUser)) throw new Error("لا يمكنك حذف حسابك الخاص.");
  var ss=_getSS_();
  var usersSheet=_getOrCreateSheet_("Users_Master");
  var data=usersSheet.getDataRange().getValues();
  var found=false, fullName="";
  for (var i=data.length-1; i>=1; i--) {
    if (String(data[i][0])===String(username)) { fullName=data[i][2]; usersSheet.deleteRow(i+1); found=true; break; }
  }
  if (!found) throw new Error("المستخدم غير موجود.");
  // حذف صلاحياته المخصصة أيضاً
  // V3.55 — كتابة واحدة تحت القفل بدل حذف صف بصف (~40 صفاً لكل مستخدم)
  _withLock_(function() { _replacePermissionRows_(function(u) { return u === String(username); }, []); });
  _killUserSessions_(username); // V3.63
  _invalidateAuthCache_(); // V3.55 — بعد الكتابة أيضاً (يغلق نافذة إعادة بناء اللقطة بقيم قديمة أثناء الكتابة)
  logAudit("إدارة المستخدمين","حذف مستخدم",username,"","","","تم حذف المستخدم: "+fullName+" ("+username+")",currentUser);
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُتيح للمدير إعادة تعيين كلمة مرور أي مستخدم آخر مباشرة دون معرفة كلمة المرور القديمة
function adminResetPassword(targetUsername, newPassword, currentUser) { _apiGuard_();
  var _fn="[adminResetPassword]"; _logInfo_(_fn, "START | "+"targetUsername:"+String(JSON.stringify(targetUsername)||"").slice(0, 80)+", newPassword:[hidden]"+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  newPassword=String(newPassword||"").trim();
  if (!newPassword||newPassword.length<4) throw new Error("كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل.");
  var sheet=_getOrCreateSheet_("Users_Master");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(targetUsername)) {
      // V3.60 — تُخزَّن مشفّرة بملح جديد (كانت تُكتب نصاً صريحاً حتى أول دخول تالٍ)
      var _sR = _pwGenerateSalt_();
      sheet.getRange(i+1,2).setValue(_pwHash_(newPassword, _sR));
      sheet.getRange(i+1,6).setValue(_sR);
      _killUserSessions_(targetUsername); // V3.63 — كل جلسات المستخدم المفتوحة تنتهي فوراً
      logAudit("إدارة المستخدمين","إعادة تعيين كلمة المرور",targetUsername,"","","","تم إعادة تعيين كلمة مرور "+targetUsername+" بواسطة "+currentUser,currentUser);
      return {success:true};
    }
  }
  throw new Error("المستخدم غير موجود.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يجلب صلاحيات مستخدم معيّن بصيغة مناسبة لعرضها/تعديلها من نافذة إدارة الصلاحيات (Admin فقط)
function getUserPermissionsForAdmin(targetUsername, actingUser) { _apiGuard_();
  var _fn="[getUserPermissionsForAdmin]"; _logInfo_(_fn, "START | "+"targetUsername:"+String(JSON.stringify(targetUsername)||"").slice(0, 80)+", "+"actingUser:"+String(JSON.stringify(actingUser)||"").slice(0, 80));
  try {
  if (_getUserRole_(actingUser)!=="Admin") throw new Error("غير مصرح.");
  return getUserPermissions(targetUsername, _getUserRole_(targetUsername));
  } catch(e) { _logError_(_fn, e); throw e; }
}

/**
 * ======================================================================
 * التقرير المالي الشهري
 * ======================================================================
 */
// (سابقاً كانت هناك دالة getMonthlyProfitReport مهجورة تعمل على سنة واحدة فقط —
// حُذفت لأن الواجهة تعتمد كلياً على getFullProfitReport الأشمل)

/**
 * ======================================================================
 * نطاق شهور التعاقد لفندق معيّن (لملء القوائم المنسدلة ديناميكياً)
 * ======================================================================
 */
// يُعيد أول وآخر شهر تغطيه تعاقدات فندق معيّن (لبناء قائمة الشهور المتاحة ديناميكياً في شاشتي التوافر والتقرير المالي)
function getContractDateRange(hotelName, currentUser) { _apiGuard_();
  var _fn="[getContractDateRange]"; _logInfo_(_fn, "START | "+"hotelName:"+String(JSON.stringify(hotelName)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  var ss=_getSS_();
  var data=_getOrCreateSheet_("Contracts_Master").getDataRange().getValues();
  var allowed=currentUser?_getUserAllowedHotels_(currentUser):null;
  var minDate=null, maxDate=null;
  for (var i=1; i<data.length; i++) {
    var row=data[i];
    if (!row[0]||row[12]===true||row[1]!==hotelName) continue;
    if (allowed && !allowed[row[1]]) continue;
    var sd=_dateOnly_(row[3] instanceof Date?row[3]:new Date(row[3]));
    var ed=_dateOnly_(row[4] instanceof Date?row[4]:new Date(row[4]));
    if (!minDate||sd<minDate) minDate=sd;
    if (!maxDate||ed>maxDate) maxDate=ed;
  }
  if (!minDate) return null;
  return {
    minYear:minDate.getFullYear(), minMonth:minDate.getMonth()+1,
    maxYear:maxDate.getFullYear(), maxMonth:maxDate.getMonth()+1
  };
  } catch(e) { _logError_(_fn, e); throw e; }
}

/**
 * ======================================================================
 * التقرير المالي الكامل (يمتد عبر كل سنوات التعاقد بلا تقطيع سنوي)
 * ======================================================================
 */
// يبني التقرير المالي الكامل لفندق معيّن عبر كل مدة تعاقده (بلا تقطيع سنوي)، باحتساب صحيح لليالي حسب تاريخ الخروج، مع تفصيل حساب كل شهر عند المرور بالماوس
// periodStartMonth/periodStartYear/periodEndMonth/periodEndYear باراميترات اختيارية (أرقام أو null) —
// تُستخدم لتضييق نطاق التقرير لفترة مخصصة داخل مدة التعاقد؛ إن لم تُمرَّر، يُحتسب التقرير لكامل مدة التعاقد كما كان سابقاً
function getFullProfitReport(hotelName, currentUser, periodStartMonth, periodStartYear, periodEndMonth, periodEndYear) { _apiGuard_();
  var _fn="[getFullProfitReport]"; _logRead_("التقرير المالي", hotelName||"الكل", "عرض تقرير مالي: "+(hotelName||"الكل")+" من "+periodStartMonth+"/"+periodStartYear+" إلى "+periodEndMonth+"/"+periodEndYear, currentUser); _logInfo_(_fn, "START | "+"hotelName:"+String(JSON.stringify(hotelName)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser,"financial_report","canView");
  var ss=_getSS_();
  var allowed=_getUserAllowedHotels_(currentUser);
  if (allowed && !allowed[hotelName]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");

  var contractsData=_getOrCreateSheet_("Contracts_Master").getDataRange().getValues();
  var hotelContracts=[], hotelContractIds={};
  var minDate=null, maxDate=null;
  for (var i=1; i<contractsData.length; i++) {
    var crow=contractsData[i];
    if (!crow[0]||crow[12]===true||crow[1]!==hotelName) continue;
    var sd=_dateOnly_(crow[3] instanceof Date?crow[3]:new Date(crow[3]));
    var ed=_dateOnly_(crow[4] instanceof Date?crow[4]:new Date(crow[4]));
    hotelContracts.push({startDate:sd,endDate:ed,roomCount:parseFloat(crow[6])||0,roomPrice:parseFloat(crow[7])||0});
    hotelContractIds[crow[0]]=true;
    if (!minDate||sd<minDate) minDate=sd;
    if (!maxDate||ed>maxDate) maxDate=ed;
  }
  if (!minDate) return {months:[],totalSales:0,totalCost:0,totalDiff:0,totalMarginPct:0};

  var bookingsData=_getOrCreateSheet_("Bookings_Master").getDataRange().getValues();
  var hotelBookings=[];
  for (var j=1; j<bookingsData.length; j++) {
    var brow=bookingsData[j];
    if (!brow[0]||brow[14]===true||brow[4]==="ملغي"||!hotelContractIds[brow[1]]) continue;
    // v3.33 — حجوزات الشراء (عدد الغرف بالسالب) تدخل الآن ضمن المبيعات بإشارتها السالبة (تُخصَم من الإيراد تلقائياً عبر الضرب)،
    // بدل استبعادها بالكامل كما كان سابقاً — هذا يعكس التكلفة الحقيقية لتغطية حجوزات (أوفر) لا تملك إمكانية فعلية،
    // فلا يظهر الربح مُضخَّماً بإيراد بيع لم تُقابله تكلفة فعلية لتوفير الغرفة
    hotelBookings.push({
      checkIn:_dateOnly_(brow[6] instanceof Date?brow[6]:new Date(brow[6])),
      checkOut:_dateOnly_(brow[7] instanceof Date?brow[7]:new Date(brow[7])),
      roomCount:parseFloat(brow[5])||0, salePrice:parseFloat(brow[9])||0
    });
  }

  var MONTH_NAMES_AR=["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  var months=[], totalSales=0, totalCost=0;

  // المرور على كل شهر من بداية التعاقد إلى نهايته
  var curYear=minDate.getFullYear(), curMonth=minDate.getMonth()+1;
  var endYear=maxDate.getFullYear(), endMonth=maxDate.getMonth()+1;

  // تضييق النطاق لفترة مخصصة إن طُلبت (تُقاطَع دوماً مع حدود التعاقد الفعلية فلا يمكن تجاوزها)
  periodStartMonth=parseInt(periodStartMonth,10); periodStartYear=parseInt(periodStartYear,10);
  periodEndMonth=parseInt(periodEndMonth,10); periodEndYear=parseInt(periodEndYear,10);
  if (periodStartYear && periodStartMonth) {
    if (periodStartYear>curYear || (periodStartYear===curYear && periodStartMonth>curMonth)) { curYear=periodStartYear; curMonth=periodStartMonth; }
  }
  if (periodEndYear && periodEndMonth) {
    if (periodEndYear<endYear || (periodEndYear===endYear && periodEndMonth<endMonth)) { endYear=periodEndYear; endMonth=periodEndMonth; }
  }
  // فترة مخصصة غير منطقية (بداية بعد نهاية) — إرجاع تقرير فارغ بدلاً من حلقة لا نهائية أو نتائج خاطئة
  if (curYear>endYear || (curYear===endYear && curMonth>endMonth)) {
    return {months:[],totalSales:0,totalCost:0,totalDiff:0,totalMarginPct:0,
      contractStart:_fmtDate_(minDate,_tz_(),'dd/MM/yyyy'),
      contractEnd:_fmtDate_(maxDate,_tz_(),'dd/MM/yyyy')};
  }

  while (curYear < endYear || (curYear===endYear && curMonth<=endMonth)) {
    // ═══ V3.62 — كل ليلة تُنسب لشهر تاريخها هي (قرار المستخدم 20/11/2026) ═══
    // مثال: حجز دخول 28/11 وخروج 2/12 ⇒ ليالي 28 و29 و30 في نوفمبر، وليلة 1 في ديسمبر، ويوم 2 لا يُحتسب.
    // (كانت الليلة تُنسب لشهر اليوم التالي لها: ليلة 30/11 تُحتسب في ديسمبر — فيختلف التقرير الشهري عن البيان اليومي والشارت.)
    // نافذة الشهر = [أول يوم بالشهر، أول يوم بالشهر التالي)
    var dim = new Date(curYear, curMonth, 0).getDate(); // عدد أيام الشهر الحالي
    var monthStart = new Date(curYear, curMonth-1, 1);
    var nightsWinStart = new Date(curYear, curMonth-1, 1);           // أول ليلة بالشهر
    var nightsWinEnd   = new Date(curYear, curMonth, 1);             // حد نهاية حصري: أول يوم بالشهر التالي
    var sales=0, cost=0, contractedNights=0, bookedNights=0;
    var costLines=[], salesLines=[];

    // احتساب تكلفة التعاقد بالليالي ضمن نافذة الليالي [nightsWinStart, nightsWinEnd)
    var contractNightsMap={}; // contractIdx -> عدد الليالي ضمن هذا الشهر (لتفصيل التلميح)
    var cur2=new Date(nightsWinStart);
    while(cur2<nightsWinEnd) {
      for (var hc=0; hc<hotelContracts.length; hc++) {
        var c=hotelContracts[hc];
        if (_contractCoversNight_(c, cur2)) {
          cost+=c.roomCount*c.roomPrice; contractedNights+=c.roomCount;
          contractNightsMap[hc]=(contractNightsMap[hc]||0)+1;
        }
      }
      cur2=new Date(cur2.getFullYear(), cur2.getMonth(), cur2.getDate()+1); // زيادة تقويمية آمنة (تفادي خلل التوقيت الصيفي)
    }
    Object.keys(contractNightsMap).forEach(function(hc){
      var c=hotelContracts[hc], n=contractNightsMap[hc];
      costLines.push(n+' ليلة × '+c.roomPrice.toLocaleString('en-US')+' × '+c.roomCount+' غرفة = '+(n*c.roomCount*c.roomPrice).toLocaleString('en-US',{minimumFractionDigits:2}));
    });

    // احتساب المبيعات من الحجوزات ضمن نفس نافذة الليالي
    for (var bk=0; bk<hotelBookings.length; bk++) {
      var b=hotelBookings[bk];
      if (b.checkOut<=nightsWinStart || b.checkIn>=nightsWinEnd) continue;
      var os = b.checkIn>nightsWinStart ? b.checkIn : nightsWinStart;
      var oex = b.checkOut<nightsWinEnd ? b.checkOut : nightsWinEnd;
      var on = Math.round((oex-os)/86400000);
      if (on>0) {
        sales+=on*b.roomCount*b.salePrice; bookedNights+=on*b.roomCount;
        // v3.33 — حجز الشراء (roomCount سالب) يُوسَم بوضوح "🔻 شراء" بالتفصيل لتمييزه عن المبيعات الفعلية رغم جمعه ضمن نفس الإجمالي
        var _lineTag = b.roomCount<0 ? '🔻 شراء: ' : '';
        salesLines.push(_lineTag+on+' ليلة × '+b.salePrice.toLocaleString('en-US')+' × '+Math.abs(b.roomCount)+' غرفة = '+(on*b.roomCount*b.salePrice).toLocaleString('en-US',{minimumFractionDigits:2}));
      }
    }

    sales=Math.round(sales*100)/100; cost=Math.round(cost*100)/100;
    var diff=Math.round((sales-cost)*100)/100;
    var marginPct = sales>0 ? Math.round((diff/sales)*1000)/10 : 0; // نسبة الهامش = الربح ÷ الإيرادات × 100، بخانة عشرية واحدة
    totalSales+=sales; totalCost+=cost;

    var MAXLINES=6;
    var costLinesShown = costLines.slice(0,MAXLINES).join('\n');
    if (costLines.length>MAXLINES) costLinesShown += '\n... و'+(costLines.length-MAXLINES)+' تعاقد آخر';
    var salesLinesShown = salesLines.slice(0,MAXLINES).join('\n');
    if (salesLines.length>MAXLINES) salesLinesShown += '\n... و'+(salesLines.length-MAXLINES)+' حجز آخر';

    // فترة احتساب الليالي الفعلية لهذا الشهر (تُعرض بخط صغير أعلى التلميح لتوضيح أساس الحساب)
    var tzR = _tz_();
    var periodLine = "🗓 ليالي الشهر: من "+_fmtDate_(nightsWinStart,tzR,'dd/MM/yyyy')+" إلى "+_fmtDate_(new Date(curYear, curMonth-1, dim),tzR,'dd/MM/yyyy');

    var calcDetail=periodLine
      +"\n──────────────"
      +"\n📋 التكلفة ("+contractedNights+" ليلة-غرفة):\n"+(costLinesShown||'لا يوجد')
      +"\n= "+cost.toLocaleString('en-US',{minimumFractionDigits:2})
      +"\n\n📋 المبيعات ("+bookedNights+" ليلة-غرفة):\n"+(salesLinesShown||'لا يوجد')
      +"\n= "+sales.toLocaleString('en-US',{minimumFractionDigits:2})
      +"\n\n✅ الربح/الخسارة: "+diff.toLocaleString('en-US',{minimumFractionDigits:2});

    months.push({
      monthNum:curMonth, year:curYear,
      monthName:MONTH_NAMES_AR[curMonth-1],
      monthLabel:MONTH_NAMES_AR[curMonth-1]+(endYear>minDate.getFullYear()||endYear<minDate.getFullYear()?" "+curYear:""),
      sales:sales, cost:cost, diff:diff, marginPct:marginPct, calcDetail:calcDetail
    });

    curMonth++;
    if (curMonth>12) { curMonth=1; curYear++; }
  }

  var tz=_tz_();
  var totalDiffFinal = Math.round((totalSales-totalCost)*100)/100;
  return { months:months,
    totalSales:Math.round(totalSales*100)/100,
    totalCost:Math.round(totalCost*100)/100,
    totalDiff:totalDiffFinal,
    totalMarginPct: totalSales>0 ? Math.round((totalDiffFinal/totalSales)*1000)/10 : 0,
    contractStart:_fmtDate_(minDate,tz,'dd/MM/yyyy'),
    contractEnd:_fmtDate_(maxDate,tz,'dd/MM/yyyy') };
  } catch(e) { _logError_(_fn, e); throw e; }
}

/**
 * ======================================================================
 * البيان اليومي (مبيعات وتكلفة يومية) — v3.15
 * ======================================================================
 * نفس منطق احتساب "يوم الدخول" المستخدم في شارت التوافر (getAvailabilityData):
 * التكلفة اليومية = كامل طاقة التعاقد النشطة ذلك اليوم (بصرف النظر عن الحجوزات الفعلية)،
 * والمبيعات اليومية = مجموع قيمة الحجوزات غير الملغاة التي يقع ذلك اليوم ضمن لياليها [checkIn, checkOut)
 */
// يبني قوائم تعاقدات وحجوزات فندق معيّن (بلا فلترة صلاحيات — يُستدعى فقط بعد التحقق من الصلاحية والفندق المسموح)
function _dsBuildHotelData_(hotelName) {
  var contractsData = _getOrCreateSheet_("Contracts_Master").getDataRange().getValues();
  var hotelContracts = [], hotelContractIds = {}, minDate = null, maxDate = null;
  for (var i=1; i<contractsData.length; i++) {
    var crow = contractsData[i];
    if (!crow[0] || crow[12]===true || crow[1]!==hotelName) continue;
    var sd = _dateOnly_(crow[3] instanceof Date?crow[3]:new Date(crow[3]));
    var ed = _dateOnly_(crow[4] instanceof Date?crow[4]:new Date(crow[4]));
    hotelContracts.push({startDate:sd, endDate:ed, roomCount:parseFloat(crow[6])||0, roomPrice:parseFloat(crow[7])||0});
    hotelContractIds[crow[0]] = true;
    if (!minDate||sd<minDate) minDate = sd;
    if (!maxDate||ed>maxDate) maxDate = ed;
  }
  var hotelBookings = [];
  if (minDate) {
    var bookingsData = _getOrCreateSheet_("Bookings_Master").getDataRange().getValues();
    for (var j=1; j<bookingsData.length; j++) {
      var brow = bookingsData[j];
      if (!brow[0] || brow[14]===true || brow[4]==="ملغي" || !hotelContractIds[brow[1]]) continue;
      var rc = parseFloat(brow[5])||0;
      if (rc===0) continue; // صف بيانات غير صالح (لا يحدث عملياً — التحقق عند الحفظ يمنع الصفر)؛ حجوزات الشراء (rc سالب) تُحتسب الآن
      // v3.33 — حجوزات الشراء (roomCount سالب) تدخل الآن ضمن المبيعات بإشارتها السالبة فتُخصَم من الإيراد المعروض تلقائياً
      hotelBookings.push({
        checkIn:_dateOnly_(brow[6] instanceof Date?brow[6]:new Date(brow[6])),
        checkOut:_dateOnly_(brow[7] instanceof Date?brow[7]:new Date(brow[7])),
        roomCount:rc, salePrice:parseFloat(brow[9])||0
      });
    }
  }
  return { hotelContracts:hotelContracts, hotelBookings:hotelBookings, minDate:minDate, maxDate:maxDate };
}
// يحسب تكلفة ومبيعات يوم واحد بعينه، إضافة لعدد الحجوزات النشطة ذلك اليوم بلا سعر بيع (لتنبيه استكمال البيانات)
function _dsDayFigures_(hotelContracts, hotelBookings, day) {
  var cost=0, sales=0, noPriceCount=0;
  for (var i=0; i<hotelContracts.length; i++) {
    var c=hotelContracts[i];
    if (_contractCoversNight_(c, day)) cost += c.roomCount*c.roomPrice;
  }
  for (var j=0; j<hotelBookings.length; j++) {
    var b=hotelBookings[j];
    if (day>=b.checkIn && day<b.checkOut) {
      sales += b.roomCount*b.salePrice;
      if (!(b.salePrice>0)) noPriceCount++;
    }
  }
  return { cost:Math.round(cost*100)/100, sales:Math.round(sales*100)/100, noPriceCount:noPriceCount };
}
// الملخص الرئيسي للبيان اليومي: يبني قائمة أشهر ضمن [fromIso, toIso] (أو من بداية/نهاية التعاقد عند الترك فارغاً) —
// كل الأشهر تظهر كإجمالي فقط (قابلة للتوسعة عبر getDailyStatementMonthDetail) ما عدا آخر شهر في النطاق الذي يظهر بتفاصيله اليومية كاملة مباشرة
function getDailyStatementSummary(hotelName, fromIso, toIso, currentUser) { _apiGuard_();
  var _fn="[getDailyStatementSummary]"; _logRead_("البيان اليومي", hotelName||"", "عرض البيان اليومي: "+(hotelName||"")+" من "+(fromIso||"بداية التعاقد")+" إلى "+(toIso||"نهاية التعاقد"), currentUser); _logInfo_(_fn, "START | "+"hotelName:"+String(JSON.stringify(hotelName)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser, "daily_statement", "canView");
  var allowed = _getUserAllowedHotels_(currentUser);
  if (allowed && !allowed[hotelName]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");

  var hd = _dsBuildHotelData_(hotelName);
  if (!hd.minDate) return {months:[], totalSales:0, totalCost:0, totalDiff:0, totalMarginPct:0, contractStart:'', contractEnd:'', effectiveFrom:'', effectiveTo:''};

  var tz = _tz_();
  var effFrom = fromIso ? _dateOnly_(new Date(fromIso+'T00:00:00')) : hd.minDate;
  var effTo   = toIso   ? _dateOnly_(new Date(toIso+'T00:00:00'))   : hd.maxDate;
  if (effFrom < hd.minDate) effFrom = hd.minDate;
  if (effTo > hd.maxDate) effTo = hd.maxDate;

  if (effFrom > effTo) {
    return {months:[], totalSales:0, totalCost:0, totalDiff:0, totalMarginPct:0,
      contractStart:_fmtDate_(hd.minDate,tz,'dd/MM/yyyy'), contractEnd:_fmtDate_(hd.maxDate,tz,'dd/MM/yyyy'),
      effectiveFrom:_fmtDate_(effFrom,tz,'dd/MM/yyyy'), effectiveTo:_fmtDate_(effTo,tz,'dd/MM/yyyy')};
  }

  var MONTH_NAMES_AR=["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  var months=[], totalSales=0, totalCost=0;
  var curYear=effFrom.getFullYear(), curMonth=effFrom.getMonth()+1;
  var lastYear=effTo.getFullYear(), lastMonth=effTo.getMonth()+1;

  // المرور شهراً بشهر: كل الأشهر تُجمَّع كإجمالي فقط، ما عدا آخر شهر بالنطاق (يحتوي غالباً تاريخ اليوم) يُبنى بتفاصيله اليومية كاملة
  while (curYear<lastYear || (curYear===lastYear && curMonth<=lastMonth)) {
    var isLastMonth = (curYear===lastYear && curMonth===lastMonth);
    var monthStart = new Date(curYear, curMonth-1, 1);
    var monthEnd = new Date(curYear, curMonth, 0);
    var rangeStart = monthStart < effFrom ? effFrom : monthStart;
    var rangeEnd = monthEnd > effTo ? effTo : monthEnd;

    var mSales=0, mCost=0, days=null;
    if (isLastMonth) days=[];
    var dcur = new Date(rangeStart);
    while (dcur <= rangeEnd) {
      var fig = _dsDayFigures_(hd.hotelContracts, hd.hotelBookings, dcur);
      mSales += fig.sales; mCost += fig.cost;
      if (isLastMonth) days.push({day:dcur.getDate(), dateLabel:_fmtDate_(dcur,tz,'dd/MM'), dateIso:_fmtDate_(dcur,tz,'yyyy-MM-dd'), sales:fig.sales, cost:fig.cost, diff:Math.round((fig.sales-fig.cost)*100)/100, noPriceCount:fig.noPriceCount});
      dcur = new Date(dcur.getFullYear(), dcur.getMonth(), dcur.getDate()+1);
    }
    mSales=Math.round(mSales*100)/100; mCost=Math.round(mCost*100)/100;
    var mDiff=Math.round((mSales-mCost)*100)/100;
    totalSales+=mSales; totalCost+=mCost;

    months.push({
      year:curYear, monthNum:curMonth, monthLabel:MONTH_NAMES_AR[curMonth-1]+' '+curYear,
      collapsed: !isLastMonth, sales:mSales, cost:mCost, diff:mDiff,
      marginPct: mSales>0 ? Math.round((mDiff/mSales)*1000)/10 : 0,
      days: days
    });

    curMonth++; if (curMonth>12) { curMonth=1; curYear++; }
  }

  var totalDiff = Math.round((totalSales-totalCost)*100)/100;
  return {
    months: months,
    totalSales: Math.round(totalSales*100)/100, totalCost: Math.round(totalCost*100)/100,
    totalDiff: totalDiff, totalMarginPct: totalSales>0 ? Math.round((totalDiff/totalSales)*1000)/10 : 0,
    contractStart: _fmtDate_(hd.minDate,tz,'dd/MM/yyyy'), contractEnd: _fmtDate_(hd.maxDate,tz,'dd/MM/yyyy'),
    effectiveFrom: _fmtDate_(effFrom,tz,'dd/MM/yyyy'), effectiveTo: _fmtDate_(effTo,tz,'dd/MM/yyyy')
  };
  } catch(e) { _logError_(_fn, e); throw e; }
}
// يبني التفاصيل اليومية الكاملة لشهر واحد مُجمَّع (عند الضغط على زر "عرض التفاصيل") — يُقيَّد بنفس فلتر من/إلى الأصلي
function getDailyStatementMonthDetail(hotelName, year, month, fromIso, toIso, currentUser) { _apiGuard_();
  var _fn="[getDailyStatementMonthDetail]"; _logInfo_(_fn, "START | "+"hotelName:"+String(JSON.stringify(hotelName)||"").slice(0, 80)+", year:"+year+", month:"+month);
  try {
  _requirePermission_(currentUser, "daily_statement", "canView");
  var allowed = _getUserAllowedHotels_(currentUser);
  if (allowed && !allowed[hotelName]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");

  var hd = _dsBuildHotelData_(hotelName);
  var tz = _tz_();
  var monthStart = new Date(year, month-1, 1);
  var monthEnd = new Date(year, month, 0);
  var effFrom = fromIso ? _dateOnly_(new Date(fromIso+'T00:00:00')) : (hd.minDate||monthStart);
  var effTo   = toIso   ? _dateOnly_(new Date(toIso+'T00:00:00'))   : (hd.maxDate||monthEnd);
  var rangeStart = monthStart < effFrom ? effFrom : monthStart;
  var rangeEnd = monthEnd > effTo ? effTo : monthEnd;

  var days=[], mSales=0, mCost=0;
  if (rangeStart <= rangeEnd) {
    var dcur = new Date(rangeStart);
    while (dcur <= rangeEnd) {
      var fig = _dsDayFigures_(hd.hotelContracts, hd.hotelBookings, dcur);
      mSales += fig.sales; mCost += fig.cost;
      days.push({day:dcur.getDate(), dateLabel:_fmtDate_(dcur,tz,'dd/MM'), dateIso:_fmtDate_(dcur,tz,'yyyy-MM-dd'), sales:fig.sales, cost:fig.cost, diff:Math.round((fig.sales-fig.cost)*100)/100, noPriceCount:fig.noPriceCount});
      dcur = new Date(dcur.getFullYear(), dcur.getMonth(), dcur.getDate()+1);
    }
  }
  return { days:days, sales:Math.round(mSales*100)/100, cost:Math.round(mCost*100)/100, diff:Math.round((mSales-mCost)*100)/100 };
  } catch(e) { _logError_(_fn, e); throw e; }
}

/**
 * ======================================================================
 * لوحة المعلومات (Dashboard) - نظرة شاملة سريعة لأداء كل الفنادق
 * ======================================================================
 */
// يبني كل بيانات لوحة المعلومات: مصفوفة مبيعات (جهة تحصيل × فندق)، ملخص ربح/خسارة لكل فندق حتى تاريخه،
// الحجوزات القريبة خلال أسبوع، وفترات الفراغ الكبيرة المرشحة للعروض الترويجية - كل ذلك مُصفّى حسب صلاحيات الفنادق
function getDashboardData(currentUser) { _apiGuard_();
  var _fn="[getDashboardData]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser, "dashboard", "canView");
  var role = _getUserRole_(currentUser);
  var canViewFinance = String(role).toLowerCase() === "admin";
  if (!canViewFinance) {
    var perms = getUserPermissions(currentUser, role);
    canViewFinance = !!(perms.availability_finance && perms.availability_finance.canView);
  }
  var allowed = _getUserAllowedHotels_(currentUser);
  var ss = _getSS_();
  var tz = _tz_();
  var today = _dateOnly_(new Date());

  var contractsData = _getSheetValues_("Contracts_Master");
  var hotels = {};
  for (var i=1; i<contractsData.length; i++) {
    var row = contractsData[i];
    if (!row[0] || row[12]===true) continue;
    var hn = row[1];
    if (allowed && !allowed[hn]) continue;
    if (!hotels[hn]) hotels[hn] = { contracts:[], city: row[13]||"" };
    hotels[hn].contracts.push({
      startDate:_dateOnly_(row[3] instanceof Date?row[3]:new Date(row[3])),
      endDate:_dateOnly_(row[4] instanceof Date?row[4]:new Date(row[4])),
      roomCount:parseFloat(row[6])||0, roomPrice:parseFloat(row[7])||0
    });
  }

  var bookingsData = _getSheetValues_("Bookings_Master");
  var hotelMap = _buildContractHotelMap_();
  var collMap = _buildCollectionAccountMap_();

  var salesMatrix = {}, hotelSalesTotal = {};
  var upcomingBookings = [];
  var _tomorrowD = new Date(today.getFullYear(), today.getMonth(), today.getDate()+1); // V3.62 — حد حصري لـ"حتى ليلة اليوم"
  var weekLater = new Date(today.getFullYear(), today.getMonth(), today.getDate()+7);

  for (var j=1; j<bookingsData.length; j++) {
    var brow = bookingsData[j];
    if (!brow[0] || brow[14]===true) continue;
    var hn2 = hotelMap[brow[1]];
    if (!hn2 || (allowed && !allowed[hn2])) continue;
    if (brow[4]==="ملغي") continue;
    var roomCount = parseFloat(brow[5])||0;
    // v3.36 — حجوزات الشراء (roomCount سالب) تدخل الآن ضمن إجمالي المبيعات بإشارتها السالبة (bookingValue سالبة أصلاً)
    // فتُخصَم تلقائياً من مبيعات الفندق/جهة التحصيل بلوحة المعلومات، بنفس منطق باقي تقارير الإيراد بالنظام
    var ci = _dateOnly_(brow[6] instanceof Date?brow[6]:new Date(brow[6]));
    var co = _dateOnly_(brow[7] instanceof Date?brow[7]:new Date(brow[7]));
    var bookingValue = parseFloat(brow[10])||0;
    var collName = collMap[brow[3]]||brow[3];

    // V3.62 — "حتى تاريخه" = الليالي التي حلّت فعلاً (حتى ليلة اليوم)، بنفس أساس التكلفة أدناه والبيان اليومي والشارت.
    // (كانت قيمة الحجز كاملة تُحتسب بمجرد بدء الدخول، بما فيها ليالٍ مستقبلية، مقابل تكلفة حتى اليوم فقط ⇒ ربح مبالغ فيه)
    if (ci <= today) {
      var _toEx = co < _tomorrowD ? co : _tomorrowD;
      var _nTD = Math.round((_toEx - ci)/86400000);
      var _salesTD = _nTD > 0 ? Math.round(_nTD * roomCount * (parseFloat(brow[9])||0) * 100)/100 : 0;
      if (!salesMatrix[collName]) salesMatrix[collName] = {};
      salesMatrix[collName][hn2] = (salesMatrix[collName][hn2]||0) + _salesTD;
      hotelSalesTotal[hn2] = (hotelSalesTotal[hn2]||0) + _salesTD;
    }

    if (ci >= today && ci <= weekLater) {
      upcomingBookings.push({
        bookingId:brow[0], hotelName:hn2, clientName:brow[2], collectionAccount:collName,
        checkIn:_fmtDate_(ci,tz,"dd/MM/yyyy"), checkOut:_fmtDate_(co,tz,"dd/MM/yyyy"),
        roomCount:roomCount, status:_bkDisplayStatusForRow_(brow),
        _sortKey: ci.getTime()
      });
    }
  }
  upcomingBookings.sort(function(a,b){ return a._sortKey - b._sortKey; });
  upcomingBookings.forEach(function(b){ delete b._sortKey; });

  // التكلفة حتى تاريخه لكل فندق: مجموع ليالي كل تعاقد من بدايته حتى اليوم (أو حتى نهايته إن انتهى فعلاً)
  var hotelCostTotal = {};
  Object.keys(hotels).forEach(function(hn3) {
    var cost = 0;
    hotels[hn3].contracts.forEach(function(ct) {
      var start = ct.startDate;
      var end = ct.endDate < _tomorrowD ? ct.endDate : _tomorrowD; // V3.62 — حتى ليلة اليوم ضمناً (كانت حتى ليلة أمس)؛ نهاية التعاقد حصرية
      if (end <= start) return;
      var nights = Math.round((end-start)/86400000);
      cost += nights * ct.roomCount * ct.roomPrice;
    });
    hotelCostTotal[hn3] = Math.round(cost*100)/100;
  });

  var hotelSummary = Object.keys(hotels).map(function(hn4) {
    var sales = Math.round((hotelSalesTotal[hn4]||0)*100)/100;
    var cost = hotelCostTotal[hn4]||0;
    return { hotelName:hn4, sales:sales, cost:cost, profit:Math.round((sales-cost)*100)/100 };
  });

  // اكتشاف فترات الفراغ الكبيرة (الحد الأدنى للإقامة: 10 ليالٍ لمكة، 3 ليالٍ لغيرها) بإشغال أقل من 40%
  var lowOccPeriods = [];
  var THRESHOLD = 0.4, MAX_SPAN_DAYS = 730;
  Object.keys(hotels).forEach(function(hn5) {
    var minStay = (hotels[hn5].city==="مكة") ? 10 : 3;
    var contracts = hotels[hn5].contracts;
    if (!contracts.length) return;
    var minStart = contracts[0].startDate, maxEnd = contracts[0].endDate;
    contracts.forEach(function(c){ if(c.startDate<minStart) minStart=c.startDate; if(c.endDate>maxEnd) maxEnd=c.endDate; });
    var dayCount = Math.round((maxEnd-minStart)/86400000)+1;
    if (dayCount<=0 || dayCount>MAX_SPAN_DAYS) return;
    var dailyCap=[], dailyBooked=[];
    for (var d=0; d<dayCount; d++){ dailyCap.push(0); dailyBooked.push(0); }
    contracts.forEach(function(ct) {
      for (var d2=0; d2<dayCount; d2++) {
        var dd=new Date(minStart.getFullYear(),minStart.getMonth(),minStart.getDate()+d2);
        if (_contractCoversNight_(ct, dd)) dailyCap[d2]+=ct.roomCount;
      }
    });
    for (var j2=1; j2<bookingsData.length; j2++) {
      var brow2=bookingsData[j2];
      if (!brow2[0]||brow2[14]===true||brow2[4]==="ملغي"||hotelMap[brow2[1]]!==hn5) continue;
      var rc2=parseFloat(brow2[5])||0;
      var ci2=_dateOnly_(brow2[6] instanceof Date?brow2[6]:new Date(brow2[6]));
      var co2=_dateOnly_(brow2[7] instanceof Date?brow2[7]:new Date(brow2[7]));
      for (var d3=0; d3<dayCount; d3++) {
        var dd3=new Date(minStart.getFullYear(),minStart.getMonth(),minStart.getDate()+d3);
        if (dd3>=ci2 && dd3<co2) dailyBooked[d3]+=rc2;
      }
    }
    var runStart=-1;
    for (var d4=0; d4<=dayCount; d4++) {
      var isLow = d4<dayCount && dailyCap[d4]>0 && (dailyBooked[d4]/dailyCap[d4])<THRESHOLD;
      if (isLow && runStart===-1) runStart=d4;
      if ((!isLow||d4===dayCount) && runStart!==-1) {
        var runLen=d4-runStart;
        if (runLen>=minStay) {
          var rs=new Date(minStart.getFullYear(),minStart.getMonth(),minStart.getDate()+runStart);
          var re=new Date(minStart.getFullYear(),minStart.getMonth(),minStart.getDate()+d4-1);
          var avgOcc=0; for(var k=runStart;k<d4;k++){ avgOcc += dailyCap[k]>0?(dailyBooked[k]/dailyCap[k]):0; }
          avgOcc = Math.round((avgOcc/runLen)*100);
          lowOccPeriods.push({hotelName:hn5, startDate:_fmtDate_(rs,tz,"dd/MM/yyyy"), endDate:_fmtDate_(re,tz,"dd/MM/yyyy"), nights:runLen, avgOccupancy:avgOcc});
        }
        runStart=-1;
      }
    }
  });
  lowOccPeriods.sort(function(a,b){ return a.avgOccupancy - b.avgOccupancy; });

  // ═══ مؤشرات الأداء: معدل الإلغاء ونسبة "الأوفر" لكل مستخدم/جهة تحصيل/فندق ═══
  var byUser={}, byColl={}, byHotel={};
  function _kpiBump(map, key, isCancelled, isOverCap) {
    if (!key) return;
    if (!map[key]) map[key]={total:0, cancelled:0, overcap:0};
    map[key].total++;
    if (isCancelled) map[key].cancelled++;
    if (isOverCap) map[key].overcap++;
  }
  for (var kb=1; kb<bookingsData.length; kb++) {
    var krow=bookingsData[kb];
    if (!krow[0]||krow[14]===true) continue;
    var khn=hotelMap[krow[1]];
    if (!khn || (allowed && !allowed[khn])) continue;
    var kIsCancelled = krow[4]==="ملغي";
    var kIsOverCap = _isOverCap_(krow[16]);
    _kpiBump(byUser, krow[11], kIsCancelled, kIsOverCap);
    _kpiBump(byColl, collMap[krow[3]]||krow[3], kIsCancelled, kIsOverCap);
    _kpiBump(byHotel, khn, kIsCancelled, kIsOverCap);
  }
  function _kpiToArray(map) {
    return Object.keys(map).map(function(k) {
      var m=map[k];
      return { name:k, total:m.total, cancelledCount:m.cancelled, overcapCount:m.overcap,
        cancellationRate: m.total>0?Math.round(m.cancelled/m.total*1000)/10:0,
        overcapRate: m.total>0?Math.round(m.overcap/m.total*1000)/10:0 };
    }).sort(function(a,b){ return b.total-a.total; });
  }
  var kpis = { byUser:_kpiToArray(byUser), byCollectionAccount:_kpiToArray(byColl), byHotel:_kpiToArray(byHotel) };

  return {
    canViewFinance: canViewFinance,
    salesMatrix: canViewFinance ? salesMatrix : null,
    hotelSummary: canViewFinance ? hotelSummary : null,
    upcomingBookings: upcomingBookings,
    lowOccPeriods: lowOccPeriods,
    kpis: kpis
  };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// دالة مساعدة داخلية: تُحدّد نص حالة الحجز المعروض لصف حجز خام (شراء/مسجل اوفر/معدل اوفر/الحالة الفعلية) - مطابقة لمنطق _bkStatusDisplay بالواجهة
function _bkDisplayStatusForRow_(brow) {
  var roomCount = parseFloat(brow[5])||0;
  if (roomCount < 0) return "شراء";
  var overCapacity = _isOverCap_(brow[16]);
  if (overCapacity) return brow[17] || "مسجل اوفر";
  return brow[4];
}


/**
 * ======================================================================
 * قائمة الانتظار (Waitlist)
 * ======================================================================
 */
// يُضيف طلباً جديداً لقائمة الانتظار (يُستدعى عندما يرفض المستخدم تسجيل حجز "أوفر" ويفضّل الانتظار بدلاً من ذلك)
function addToWaitlist(w, currentUser) { _apiGuard_();
  var _fn="[addToWaitlist]"; _logInfo_(_fn, "START | "+"w:"+String(JSON.stringify(w)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser, "bookings", "canAdd");
  var contractId=String(w.contractId||"").trim(), clientName=String(w.clientName||"").trim();
  var checkIn=new Date(w.checkIn), checkOut=new Date(w.checkOut);
  var roomCount=parseFloat(w.roomCount)||0, salePrice=parseFloat(w.salePrice)||0;
  if (!contractId) throw new Error("يرجى اختيار الفندق.");
  if (!clientName) throw new Error("اسم العميل مطلوب.");
  if (isNaN(checkIn.getTime())||isNaN(checkOut.getTime())||checkOut<=checkIn) throw new Error("تواريخ غير صحيحة.");
  if (!(roomCount>0) || Math.floor(roomCount)!==roomCount || roomCount>5000) throw new Error("عدد الغرف يجب أن يكون رقماً صحيحاً أكبر من صفر."); // V3.65
  if (salePrice<0) throw new Error("سعر البيع لا يُقبل سالباً.");
  var sheet=_getOrCreateSheet_("Waitlist_Master");
  var waitlistId=_getNextSequentialId_("W",4);
  sheet.appendRow([waitlistId, contractId, clientName, String(w.collectionAccountId||""), checkIn, checkOut,
    roomCount, salePrice, String(w.notes||"").trim(), "نشط", currentUser, new Date(), false]);
  logAudit("قائمة الانتظار","إضافة طلب انتظار",waitlistId,"","","","طلب انتظار جديد: "+clientName+" — "+roomCount+" غرفة",currentUser);
  return {success:true, waitlistId:waitlistId};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعيد كل طلبات قائمة الانتظار النشطة (مُصفّاة حسب صلاحيات الفنادق)
function getWaitlist(currentUser) { _apiGuard_();
  var _fn="[getWaitlist]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser, "waitlist", "canView");
  var data=_getOrCreateSheet_("Waitlist_Master").getDataRange().getValues();
  var tz=_tz_();
  var hotelMap=_buildContractHotelMap_(), collMap=_buildCollectionAccountMap_();
  var allowed=_getUserAllowedHotels_(currentUser);
  // صلاحية الجزء المالي موحّدة (نفس availability_finance المستخدمة بالتوافر والحجوزات)
  var role=_getUserRole_(currentUser);
  var canViewFinance = role==="Admin";
  if (!canViewFinance) {
    var perms=getUserPermissions(currentUser, role);
    canViewFinance = !!(perms.availability_finance && perms.availability_finance.canView);
  }
  var out=[];
  for (var i=1; i<data.length; i++) {
    var row=data[i];
    if (!row[0]||row[12]===true) continue;
    var hn=hotelMap[row[1]]||"(فندق محذوف)";
    if (allowed && !allowed[hn]) continue;
    var ci=row[4] instanceof Date?row[4]:new Date(row[4]);
    var co=row[5] instanceof Date?row[5]:new Date(row[5]);
    var obj={
      waitlistId:row[0], contractId:row[1], hotelName:hn,
      clientName:row[2], collectionAccount:collMap[row[3]]||row[3],
      checkIn:_fmtDate_(ci,tz,"dd/MM/yyyy"), checkOut:_fmtDate_(co,tz,"dd/MM/yyyy"),
      roomCount:row[6], notes:row[8]||"", status:row[9],
      createdBy:row[10], createdAt:_fmtDate_(row[11] instanceof Date?row[11]:new Date(row[11]),tz,"dd/MM/yyyy HH:mm"),
      lastEditSummary:row[13]||""
    };
    if (canViewFinance) obj.salePrice = row[7];
    out.push(obj);
  }
  out.reverse();
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحذف/يُلغي طلب انتظار
function cancelWaitlistEntry(waitlistId, currentUser) { _apiGuard_();
  var _fn="[cancelWaitlistEntry]"; _logInfo_(_fn, "START | "+"waitlistId:"+String(JSON.stringify(waitlistId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser, "waitlist", "canDelete");
  var sheet=_getOrCreateSheet_("Waitlist_Master");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(waitlistId)) {
      sheet.getRange(i+1,10).setValue("ملغى");
      logAudit("قائمة الانتظار","إلغاء طلب انتظار",waitlistId,"","","","تم إلغاء طلب الانتظار",currentUser);
      return {success:true};
    }
  }
  throw new Error("لم يتم العثور على الطلب.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُحوّل طلب انتظار إلى حجز فعلي (بعد التأكد من توفر السعة) - يستدعي نفس مسار حفظ الحجز العادي
function convertWaitlistToBooking(waitlistId, currentUser) { _apiGuard_();
  var _fn="[convertWaitlistToBooking]"; _logInfo_(_fn, "START | "+"waitlistId:"+String(JSON.stringify(waitlistId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Bookings_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  _invalidateReferenceCache_(_REF_CACHE_KEY_CLIENTS); // إبطال الكاش المرجعي المؤثر
  _requirePermission_(currentUser, "bookings", "canAdd");
  var sheet=_getOrCreateSheet_("Waitlist_Master");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(waitlistId)) {
      var row=data[i];
      var bookingObj={
        contractId:row[1], clientName:row[2], collectionAccountId:row[3],
        status:"مبدئي",
        checkIn:_fmtDate_(row[4] instanceof Date?row[4]:new Date(row[4]),_tz_(),"yyyy-MM-dd"),
        checkOut:_fmtDate_(row[5] instanceof Date?row[5]:new Date(row[5]),_tz_(),"yyyy-MM-dd"),
        roomCount:row[6], salePrice:row[7], notes:row[8], forceOverCapacity:false
      };
      var result=saveBooking(bookingObj, currentUser);
      if (result.success) {
        sheet.getRange(i+1,10).setValue("تم التحويل");
        logAudit("قائمة الانتظار","تحويل إلى حجز",waitlistId,"","","","تم تحويل طلب الانتظار إلى الحجز #"+result.bookingId,currentUser);
      }
      return result;
    }
  }
  throw new Error("لم يتم العثور على الطلب.");

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يفحص كل طلبات قائمة الانتظار النشطة، وينشئ تنبيهاً لكل طلب أصبحت له سعة كافية متاحة الآن
// يُعيد تفصيل السعة/الحجز/المتاح لكل ليلة ضمن فترة معيّنة لتعاقد معيّن (نسخة تفصيلية من _checkBookingAvailability_
// تُعيد كل ليلة على حدة بدل مجرد نعم/لا إجمالية - تُستخدم لتصنيف حالة طلبات قائمة الانتظار وشاشة تفاصيلها)
// V3.55 — preloaded (اختياري): {contractsData, bookingsData} مقروءة مسبقاً — فحص قائمة الانتظار كان يقرأ الشيتين كاملين لكل طلب
function _getNightlyAvailability_(contractId, checkInDate, checkOutDate, excludeBookingId, preloaded) {
  var hotelMap = _buildContractHotelMap_();
  var hotelName = hotelMap[contractId];
  if (!hotelName) return [];

  var contractsData = (preloaded && preloaded.contractsData) || _getOrCreateSheet_("Contracts_Master").getDataRange().getValues();
  var hotelContractIds = {}, hotelContracts = [];
  for (var i=1; i<contractsData.length; i++) {
    var crow = contractsData[i];
    if (!crow[0]||crow[12]===true||crow[1]!==hotelName) continue;
    hotelContractIds[crow[0]] = true;
    hotelContracts.push({
      startDate:_dateOnly_(crow[3] instanceof Date?crow[3]:new Date(crow[3])),
      endDate:_dateOnly_(crow[4] instanceof Date?crow[4]:new Date(crow[4])),
      roomCount:parseFloat(crow[6])||0
    });
  }

  var bookingsData = (preloaded && preloaded.bookingsData) || _getOrCreateSheet_("Bookings_Master").getDataRange().getValues();
  var otherBookings = [];
  for (var j=1; j<bookingsData.length; j++) {
    var brow = bookingsData[j];
    if (!brow[0]||brow[14]===true) continue;
    if (excludeBookingId && String(brow[0])===String(excludeBookingId)) continue;
    if (!hotelContractIds[brow[1]]) continue;
    if (brow[4]==="ملغي") continue;
    otherBookings.push({
      checkIn:_dateOnly_(brow[6] instanceof Date?brow[6]:new Date(brow[6])),
      checkOut:_dateOnly_(brow[7] instanceof Date?brow[7]:new Date(brow[7])),
      roomCount:parseFloat(brow[5])||0
    });
  }

  var tz = _tz_(), nights = [];
  var cur = _dateOnly_(checkInDate), end = _dateOnly_(checkOutDate);
  while (cur < end) {
    var cap = 0;
    hotelContracts.forEach(function(hc){ if (_contractCoversNight_(hc, cur)) cap += hc.roomCount; });
    var booked = 0;
    otherBookings.forEach(function(ob){ if (cur>=ob.checkIn && cur<ob.checkOut) booked += ob.roomCount; });
    nights.push({ date: _fmtDate_(cur, tz, "dd/MM/yyyy"), capacity: cap, booked: booked, available: cap-booked });
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()+1);
  }
  return nights;
}

// يُصنّف حالة إمكانية طلب انتظار بناءً على تفصيل الليالي: متاح بالكامل / جزء من الفترة / جزء من العدد / لا يوجد تغيير
// تصنيف حالة إمكانية طلب انتظار بناءً على تفصيل الليالي:
// 1. "متاحة كاملة" = كل ليلة فيها عدد كافٍ (المطلوب بالكامل متاح لكامل الفترة)
// 2. "جزء من العدد" = كل الفترة فيها إمكانية (>0) لكن ليس بالعدد الكامل المطلوب في كل الليالي
// 3. "جزء من الفترة" = العدد الكامل متاح في بعض الليالي فقط (وبعض الليالي ليس فيها إمكانية كافية)
// 4. "غير متاح" = لا العدد الكامل متاح في أي ليلة ولا الفترة كلها فيها أي إمكانية
function _classifyWaitlistAvailability_(nights, roomCount) {
  if (!nights.length) return null;
  var allFull = nights.every(function(n){ return n.available >= roomCount; });
  if (allFull) return "متاح كاملة";

  var someHaveFullCount = nights.some(function(n){ return n.available >= roomCount; }); // بعض الليالي (على الأقل ليلة واحدة) فيها العدد الكامل المطلوب
  var allHaveSome = nights.every(function(n){ return n.available > 0; }); // كل ليالي الفترة فيها إمكانية ما (حتى لو أقل من المطلوب)

  // الأولوية لـ"جزء من الفترة": إن وُجدت ليلة واحدة على الأقل فيها العدد الكامل المطلوب (حتى لو باقي الليالي أقل أو صفر)
  // فهذا يعني أن العميل يمكنه الحجز بعدده الكامل لجزء من فترته - وهذا أهم من توفر عدد جزئي لكل الفترة
  if (someHaveFullCount) return "متاح جزء من الفترة";
  // لا توجد أي ليلة فيها العدد الكامل، لكن كل ليالي الفترة فيها إمكانية جزئية (>0) - يمكن الحجز بعدد أقل لكامل الفترة
  if (allHaveSome) return "متاح جزء من العدد";
  // لا العدد الكامل متاح في أي ليلة ولا كل الفترة فيها إمكانية - نتحقق هل توجد أي إمكانية جزئية في بعض الليالي فقط
  var anyAvail = nights.some(function(n){ return n.available > 0; });
  if (anyAvail) return "غير متاح جزئياً";
  return null; // لا يوجد أي تغيير عن "نشط" — لا توجد إمكانية على الإطلاق بأي ليلة
}

// يفحص كل طلبات قائمة الانتظار النشطة، يُحدّث حالتها (متاح بالكامل/جزئياً) وينشئ تنبيهاً مفصَّلاً (يشمل عدد الغرف) عند أي تغيير
function checkWaitlistAvailabilityAndNotify(force) { _apiGuard_();
  var _fn="[checkWaitlistAvailabilityAndNotify]"; _logInfo_(_fn, "START | "+"");
  try {
  if (!_bgCheckShouldRun_("WAITLIST", force)) return { success:true, skipped:"ran recently" };
  var sheet = _getOrCreateSheet_("Waitlist_Master");
  var data = sheet.getDataRange().getValues();
  var hotelMap = _buildContractHotelMap_();
  var tz = _tz_();
  var count = 0, _wlPre = null; // V3.55 — قراءة واحدة للشيتين لكل الطلبات (تُقرأ فقط إن وُجد طلب نشط)
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (!row[0]||row[12]===true) continue;
    // نتابع فقط الطلبات التي ما زالت "نشط" أو بحالة إمكانية سابقة (لرصد أي تحسّن إضافي) - نستثني المُحوَّل/الملغى فقط
    if (row[9]==="تم التحويل" || row[9]==="ملغى") continue;
    var ci = row[4] instanceof Date?row[4]:new Date(row[4]);
    var co = row[5] instanceof Date?row[5]:new Date(row[5]);
    var roomCount = parseFloat(row[6])||0;
    if (!_wlPre) _wlPre = { contractsData: _getSheetValues_("Contracts_Master"), bookingsData: _getSheetValues_("Bookings_Master") };
    var nights = _getNightlyAvailability_(row[1], ci, co, null, _wlPre);
    var newStatus = _classifyWaitlistAvailability_(nights, roomCount);
    if (newStatus && newStatus !== row[9]) {
      sheet.getRange(i+1, 10).setValue(newStatus); // العمود 10 = Status
      var hn = hotelMap[row[1]]||"";
      _createNotification_("notif_waitlist_available", row[0], hn,
        "✅ "+newStatus+" — طلب انتظار "+row[2]+" ("+hn+") — "+roomCount+" غرفة",
        "طلب الانتظار #"+row[0]+" للعميل "+row[2]+" في "+hn+" — "+roomCount+" غرفة — أصبحت حالته: \""+newStatus+"\" خلال الفترة "
        +_fmtDate_(ci,tz,"dd/MM/yyyy")+" — "+_fmtDate_(co,tz,"dd/MM/yyyy")+". يمكن مراجعته وتحويله لحجز فعلي.",
        "النظام");
      count++;
    }
  }
  return {success:true, notificationsCreated:count};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعيد تفصيل الإمكانية لكل ليلة من ليالي طلب انتظار معيّن - لعرضها في نافذة تفاصيل الطلب
function getWaitlistEntryDetails(waitlistId, currentUser) { _apiGuard_();
  var _fn="[getWaitlistEntryDetails]"; _logInfo_(_fn, "START | "+"waitlistId:"+String(JSON.stringify(waitlistId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser, "waitlist", "canView");
  var data = _getOrCreateSheet_("Waitlist_Master").getDataRange().getValues();
  var hotelMap = _buildContractHotelMap_(), collMap = _buildCollectionAccountMap_();
  var tz = _tz_();
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (String(row[0]) !== String(waitlistId)) continue;
    var ci = row[4] instanceof Date?row[4]:new Date(row[4]);
    var co = row[5] instanceof Date?row[5]:new Date(row[5]);
    var roomCount = parseFloat(row[6])||0;
    var nights = _getNightlyAvailability_(row[1], ci, co, null);
    return {
      waitlistId: row[0], hotelName: hotelMap[row[1]]||"(فندق محذوف)",
      clientName: row[2], collectionAccount: collMap[row[3]]||row[3],
      checkIn: _fmtDate_(ci,tz,"dd/MM/yyyy"), checkOut: _fmtDate_(co,tz,"dd/MM/yyyy"),
      roomCount: roomCount, status: row[9], nights: nights
    };
  }
  throw new Error("لم يتم العثور على الطلب.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعدّل بيانات طلب انتظار بالكامل (كل الحقول) - يُسجّل ملخص التعديل في Last_Edit_Summary
function editWaitlistEntry(obj, currentUser) { _apiGuard_();
  var _fn="[editWaitlistEntry]"; _logInfo_(_fn, "START | "+"obj:"+String(JSON.stringify(obj)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser, "waitlist", "canEdit");
  var sheet = _getOrCreateSheet_("Waitlist_Master");
  var data = sheet.getDataRange().getValues();
  var waitlistId = String(obj.waitlistId||"").trim();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0]) !== waitlistId) continue;
    var changes = [];
    var newClient = String(obj.clientName||"").trim();
    var newCheckIn = new Date(obj.checkIn), newCheckOut = new Date(obj.checkOut);
    var newRoomCount = parseFloat(obj.roomCount)||0, newSalePrice = parseFloat(obj.salePrice)||0;
    var newNotes = String(obj.notes||"").trim();
    // V3.65 — كان التعديل يكتب تواريخ غير صالحة/معكوسة وأعداداً صفرية بلا أي فحص
    if (isNaN(newCheckIn.getTime())||isNaN(newCheckOut.getTime())||newCheckOut<=newCheckIn) throw new Error("تواريخ غير صحيحة: الخروج يجب أن يكون بعد الدخول.");
    if (!(newRoomCount>0) || Math.floor(newRoomCount)!==newRoomCount) throw new Error("عدد الغرف يجب أن يكون رقماً صحيحاً أكبر من صفر.");
    if (newSalePrice<0) throw new Error("سعر البيع لا يُقبل سالباً.");
    if (!newClient) throw new Error("اسم العميل مطلوب.");
    if (newClient !== String(data[i][2]||"")) changes.push("العميل: "+data[i][2]+" ← "+newClient);
    if (newRoomCount !== (parseFloat(data[i][6])||0)) changes.push("الغرف: "+data[i][6]+" ← "+newRoomCount);
    if (newSalePrice !== (parseFloat(data[i][7])||0)) changes.push("السعر: "+data[i][7]+" ← "+newSalePrice);
    if (newNotes !== String(data[i][8]||"")) changes.push("الملاحظات مُحدَّثة");
    // تحديث كل الحقول القابلة للتعديل دفعة واحدة (العمود 3=Client, 5=CheckIn, 6=CheckOut, 7=RoomCount, 8=SalePrice, 9=Notes)
    sheet.getRange(i+1, 3).setValue(newClient);
    sheet.getRange(i+1, 5, 1, 2).setValues([[newCheckIn, newCheckOut]]);
    sheet.getRange(i+1, 7, 1, 3).setValues([[newRoomCount, newSalePrice, newNotes]]);
    // إعادة الحالة إلى "نشط" بعد التعديل (سيُعاد تصنيف الإمكانية تلقائياً في الفحص الدوري التالي)
    sheet.getRange(i+1, 10).setValue("نشط");
    var summary = (changes.length ? changes.join(" | ") : "تعديل بلا تغييرات فعلية") + " — " + _fmtDate_(new Date(),_tz_(),"dd/MM/yyyy HH:mm") + " — " + currentUser;
    sheet.getRange(i+1, 14).setValue(summary); // العمود 14 = Last_Edit_Summary
    logAudit("قائمة الانتظار","تعديل طلب انتظار",waitlistId,"","","",summary,currentUser);
    return {success:true};
  }
  throw new Error("لم يتم العثور على الطلب.");
  } catch(e) { _logError_(_fn, e); throw e; }
}


/**
 * ======================================================================
 * تذكيرات تليجرام (إشعار جروب المستخدمين قبل موعد الدخول بيوم)
 * ======================================================================
 */
// يحفظ إعدادات بوت تليجرام (Token + Chat ID الخاص بالجروب) - Admin فقط
function saveTelegramSettings(botToken, chatId, currentUser) { _apiGuard_();
  var _fn="[saveTelegramSettings]"; _logInfo_(_fn, "START | "+"botToken:"+String(JSON.stringify(botToken)||"").slice(0, 80)+", "+"chatId:"+String(JSON.stringify(chatId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var props = PropertiesService.getScriptProperties();
  var newToken = String(botToken||"").trim();
  // لا نُحدِّث التوكن إلا إذا أدخل المستخدم توكناً جديداً فعلياً (غير فارغ وغير مُقنَّع بالنقاط).
  // بهذا يبقى التوكن المحفوظ سليماً عند إعادة الحفظ (مثلاً لتغيير Chat ID فقط) دون إعادة كتابة التوكن،
  // مما يمنع مسحه بالخطأ — وهو سبب توقّف وصول تنبيهات تليجرام.
  if (newToken && newToken.indexOf("•") === -1) {
    props.setProperty("TELEGRAM_BOT_TOKEN", newToken);
  }
  var newChatId = String(chatId||"").trim();
  if (newChatId) props.setProperty("TELEGRAM_CHAT_ID", newChatId);
  var hasToken = !!(props.getProperty("TELEGRAM_BOT_TOKEN")||"");
  logAudit("النظام","تحديث إعدادات تليجرام","","","","","تم تحديث إعدادات بوت تليجرام",currentUser);
  return {success:true, hasToken:hasToken, tokenUpdated: !!(newToken && newToken.indexOf("•") === -1)};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يجلب إعدادات تليجرام الحالية (Admin فقط، تُخفى قيمة التوكن جزئياً لأسباب أمنية)
function getTelegramSettings(currentUser) { _apiGuard_();
  var _fn="[getTelegramSettings]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TELEGRAM_BOT_TOKEN")||"";
  var chatId = props.getProperty("TELEGRAM_CHAT_ID")||"";
  return { botTokenMasked: token ? (token.slice(0,8)+"••••••"+token.slice(-4)) : "", hasToken: !!token, chatId: chatId };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يرسل رسالة نصية إلى جروب تليجرام المُعرَّف بإعدادات النظام
function _sendTelegramMessage_(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TELEGRAM_BOT_TOKEN");
  var chatId = props.getProperty("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return {success:false, error:"لم يتم إعداد بوت تليجرام بعد."};
  var url = "https://api.telegram.org/bot" + token + "/sendMessage";
  try {
    _incrementDailyQuota_("URLFETCH"); // نقطة العبور الوحيدة لكل نداءات UrlFetch في هذا المشروع
    var resp = UrlFetchApp.fetch(url, {
      method:"post", contentType:"application/json",
      payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" }),
      muteHttpExceptions: true
    });
    var body = JSON.parse(resp.getContentText());
    return { success: !!body.ok, error: body.ok ? "" : (body.description||"خطأ غير معروف") };
  } catch (e) {
    return { success:false, error: e.message };
  }
}

// v3.43 — إرسال غير متزامن: بدل انتظار استجابة تليجرام أثناء حفظ حجز/تعاقد (قد تُبطئ الحفظ على المستخدم
// إن كانت تليجرام بطيئة أو معلّقة)، نُضيف النص لطابور مؤقت ونُجدول مشغّلاً زمنياً لمرة واحدة (يُحذف تلقائياً
// بعد تنفيذه) يُرسل كل ما تراكم في الطابور فعلياً خلال ثانية تقريباً — فيعود المستخدم لحالة "تم الحفظ" فوراً
// V3.55 — (1) كل رسالة بمفتاح خصائص مستقل: الطابور القديم (قراءة-تعديل-كتابة لمفتاح واحد بلا قفل) كان يُضيّع رسالة
// إذا حفظ مستخدمان في نفس اللحظة. (2) مشغّل واحد فقط معلَّق في أي وقت: إنشاء مشغّل (~0.5-1 ث) كان يحدث مع كل رسالة
// داخل عملية الحفظ وتحت القفل، والمشغّلات المتراكمة تقترب من حد Google (20 مشغّلاً). (3) مشغّل التفريغ الدوري
// (كل 10 دقائق) يلتقط أي رسالة عالقة لو فشل إنشاء المشغّل.
var _TGQ_PREFIX = "TGQ_", _TG_FLUSH_FLAG = "TG_FLUSH_SCHEDULED_AT", __TGQ_SEQ = 0;
function _sendTelegramMessageAsync_(text) {
  try {
    var props = PropertiesService.getScriptProperties();
    __TGQ_SEQ++; // ترتيب ثابت للرسائل المتولدة في نفس المللي ثانية (المفاتيح تُفرز نصياً عند التفريغ)
    props.setProperty(_TGQ_PREFIX + Date.now() + "_" + ("0000" + __TGQ_SEQ).slice(-5) + "_" + Math.floor(Math.random() * 1e6), String(text));
    var flag = Number(props.getProperty(_TG_FLUSH_FLAG) || 0);
    if (Date.now() - flag > 120000) {
      ScriptApp.newTrigger("_flushTelegramQueue_").timeBased().after(1000).create();
      props.setProperty(_TG_FLUSH_FLAG, String(Date.now()));
    }
  } catch (e) { _logError_("[_sendTelegramMessageAsync_]", e); }
}
function _tgQueuePending_() {
  try {
    var all = PropertiesService.getScriptProperties().getProperties();
    if (all.TG_ASYNC_QUEUE && all.TG_ASYNC_QUEUE !== "[]") return true;
    return Object.keys(all).some(function(k) { return k.indexOf(_TGQ_PREFIX) === 0; });
  } catch (e) { return false; }
}

// يُنفَّذ تلقائياً عبر المشغّل أعلاه: يُرسل كل الرسائل المتراكمة في الطابور فعلياً ثم يُفرغه. آمن للتكرار
// (لو استُدعي أكثر من مرة متقاربة بسبب عدة حفظات متتالية، كل تنفيذ يُفرغ ما وجده فقط تحت القفل فلا تكرار إرسال)
function _flushTelegramQueue_() { return _trusted_(_flushTelegramQueueWork_); } // V3.63 — مشغّل: نقطة دخول موثوقة
function _flushTelegramQueueWork_() {
  var props = PropertiesService.getScriptProperties();
  // حذف مشغّلات التفريغ المنتهية (المشغّل لمرة واحدة يبقى مسجلاً ويُحتسب ضمن حد الـ20)
  try { ScriptApp.getProjectTriggers().forEach(function(t) { if (t.getHandlerFunction() === "_flushTelegramQueue_") ScriptApp.deleteTrigger(t); }); } catch (eT) {}
  try { props.deleteProperty(_TG_FLUSH_FLAG); } catch (eF) {}
  // السحب فقط تحت القفل (لحظي)، والإرسال الفعلي عبر الإنترنت خارجه — كان الإرسال يحجز قفل الحفظ طوال مدة اتصال تليجرام
  var queue = _withLock_(function() {
    var all = props.getProperties(), out = [];
    var raw = all.TG_ASYNC_QUEUE; // توافق: طابور الصيغة القديمة
    if (raw) { try { (JSON.parse(raw) || []).forEach(function(t) { out.push(t); }); } catch (e) {} props.deleteProperty("TG_ASYNC_QUEUE"); }
    Object.keys(all).filter(function(k) { return k.indexOf(_TGQ_PREFIX) === 0; }).sort().forEach(function(k) {
      out.push(all[k]); props.deleteProperty(k); // يُحذف قبل الإرسال: تفريغان متداخلان لا يرسلان نفس الرسالة مرتين
    });
    return out;
  });
  (queue || []).forEach(function(text) {
    try {
      var res = _sendTelegramMessage_(text);
      if (!res || !res.success) _logError_("[_flushTelegramQueue_]", new Error("فشل إرسال رسالة تليجرام مؤجَّلة: "+((res&&res.error)||"سبب غير معروف")));
    } catch(e) { _logError_("[_flushTelegramQueue_]", e); }
  });
}

// اختبار الاتصال ببوت تليجرام (زر "اختبار الإرسال" في شاشة الإعدادات)
function testTelegramConnection(currentUser) { _apiGuard_();
  var _fn="[testTelegramConnection]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  return _sendTelegramMessage_("✅ رسالة اختبار من نظام حجوزات الفنادق — الاتصال يعمل بنجاح.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يفحص كل الحجوزات التي يبدأ دخولها غداً وغير الملغاة، ويرسل تذكيراً مجمّعاً واحداً لجروب تليجرام
// (يُستدعى مرة واحدة يومياً - يُفضَّل ربطه بمشغّل زمني Time-driven Trigger لضمان الإرسال حتى بدون تسجيل دخول أي مستخدم)
function sendTelegramCheckinReminders(force) { _apiGuard_();
  var _fn="[sendTelegramCheckinReminders]"; _logInfo_(_fn, "START | "+"force:"+String(JSON.stringify(force)||"").slice(0, 80));
  try {
  // حارس يومي: يمنع الإرسال المكرر إن استدعاه أكثر من مستخدم بنفس اليوم (يُسمح فقط بمحاولة واحدة ناجحة يومياً)
  // إلا إذا مرَّر المستخدم force=true (الإرسال اليدوي من شاشة الإعدادات يتجاوز الحارس عمداً)
  var props = PropertiesService.getScriptProperties();
  var todayKey = _fmtDate_(new Date(), _tz_(), "yyyy-MM-dd");
  if (!force && props.getProperty("TELEGRAM_LAST_SENT_DATE") === todayKey) {
    return { success:true, sent:false, count:0, alreadySentToday:true };
  }
  var ss = _getSS_();
  var bookingsData = _getOrCreateSheet_("Bookings_Master").getDataRange().getValues();
  var hotelMap = _buildContractHotelMap_(), collMap = _buildCollectionAccountMap_();
  var tz = _tz_();
  var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  var tomorrowStr = _fmtDate_(tomorrow, tz, "yyyy-MM-dd");

  var lines = [];
  for (var i=1; i<bookingsData.length; i++) {
    var row = bookingsData[i];
    if (!row[0] || row[14]===true || row[4]==="ملغي") continue;
    var roomCount = parseFloat(row[5])||0;
    if (roomCount < 0) continue; // حجوزات الشراء لا تحتاج تذكير دخول
    var ci = row[6] instanceof Date ? row[6] : new Date(row[6]);
    var ciStr = _fmtDate_(ci, tz, "yyyy-MM-dd");
    if (ciStr !== tomorrowStr) continue;
    var hn = hotelMap[row[1]] || "فندق محذوف";
    lines.push("🏨 <b>"+hn+"</b> — "+row[2]+" ("+(collMap[row[3]]||row[3])+") — "+roomCount+" غرفة — حجز #"+row[0]);
  }

  if (!lines.length) return { success:true, sent:false, count:0 };

  var msg = "📅 <b>تذكير: حجوزات تدخل غداً ("+_fmtDate_(tomorrow,tz,"dd/MM/yyyy")+")</b>\n\n" + lines.join("\n"); // V3.60 — أسطر جديدة فعلية (كانت تظهر حرفياً بالرسالة)
  var result = _sendTelegramMessage_(msg);
  if (result.success) props.setProperty("TELEGRAM_LAST_SENT_DATE", todayKey);
  return { success: result.success, sent: result.success, count: lines.length, error: result.error||"" };
  } catch(e) { _logError_(_fn, e); throw e; }
}


/**
 * ======================================================================
 * استيراد جماعي للحجوزات من Excel/CSV (بيانات ملصوقة من الحافظة)
 * ======================================================================
 */
// يستقبل مصفوفة صفوف حجوزات (كل صف: اسم الفندق، العميل، جهة التحصيل، دخول، خروج، غرف، سعر، ملاحظات)
// ويحفظها جميعاً عبر نفس مسار saveBooking المعتاد (بكل فحوصاته وتسجيل تدقيقه وتنبيهاته)، ويُعيد تقريراً بالنجاح/الفشل لكل صف
function bulkImportBookings(rows, currentUser) { _apiGuard_();
  var _fn="[bulkImportBookings]"; _logInfo_(_fn, "START | "+"rows:[data]"+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _invalidateSheetCache_("Bookings_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  _invalidateReferenceCache_(_REF_CACHE_KEY_CLIENTS); // إبطال الكاش المرجعي المؤثر
  _requirePermission_(currentUser, "bookings", "canAdd");
  var contractsData = _getOrCreateSheet_("Contracts_Master").getDataRange().getValues();
  var hotelToContract = {}; // اسم الفندق -> أحدث تعاقد رئيسي نشط لهذا الفندق
  for (var i=1; i<contractsData.length; i++) {
    var row=contractsData[i];
    if (!row[0]||row[12]===true) continue;
    var cType=String(row[14]||"رئيسي").trim();
    if (cType!=="رئيسي") continue;
    if (!hotelToContract[row[1]]) hotelToContract[row[1]]=row[0];
  }
  var collData = _getOrCreateSheet_("Collection_Accounts").getDataRange().getValues();
  var collNameToId = {};
  for (var c=1; c<collData.length; c++) { if (collData[c][0]) collNameToId[collData[c][1]]=collData[c][0]; }

  var results = [];
  rows.forEach(function(r, idx) {
    try {
      var contractId = hotelToContract[r.hotelName];
      if (!contractId) throw new Error("لم يتم العثور على تعاقد نشط لهذا الفندق: "+r.hotelName);
      var collectionAccountId = collNameToId[r.collectionAccount];
      if (!collectionAccountId) {
        // إنشاء جهة تحصيل جديدة تلقائياً إن لم تكن موجودة
        var newAcc = addCollectionAccount(r.collectionAccount, currentUser);
        collectionAccountId = newAcc.id;
      }
      var bookingObj = {
        contractId: contractId, clientName: r.clientName, collectionAccountId: collectionAccountId,
        status: "مبدئي", checkIn: r.checkIn, checkOut: r.checkOut,
        roomCount: r.roomCount, salePrice: r.salePrice, notes: r.notes||"",
        forceOverCapacity: true // الاستيراد الجماعي يتجاوز فحص السعة التفاعلي؛ ستظهر الحجوزات المتجاوزة للسعة بحالة "مسجل اوفر" تلقائياً
      };
      var res = saveBooking(bookingObj, currentUser);
      results.push({ row: idx+1, success:true, bookingId: res.bookingId, overCapacity: res.overCapacity });
    } catch (e) {
      results.push({ row: idx+1, success:false, error: e.message });
    }
  });
  return results;
  } catch(e) { _logError_(_fn, e); throw e; }
}


// يُعدّل بيانات مستخدم (الاسم الكامل و/أو اسم الدخول) - Admin فقط
// عند تغيير اسم الدخول، يُنشر التغيير تلقائياً على كل الشيتات التي تحتفظ باسم المستخدم كمرجع
// (الصلاحيات، منشئ الحجوزات/التعاقدات/الأقساط/طلبات الانتظار، سجل التعديلات، قراءات التنبيهات)
// لضمان بقاء كل البيانات التاريخية مرتبطة بشكل صحيح بالمستخدم الجديد
function updateUserDetails(oldUsername, newUsername, newFullName, currentUser) { _apiGuard_();
  var _fn="[updateUserDetails]"; _logInfo_(_fn, "START | "+"oldUsername:"+String(JSON.stringify(oldUsername)||"").slice(0, 80)+", "+"newUsername:"+String(JSON.stringify(newUsername)||"").slice(0, 80)+", "+"newFullName:"+String(JSON.stringify(newFullName)||"").slice(0, 80));
  try {
  _invalidateSheetCache_("Users_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  oldUsername = String(oldUsername||"").trim();
  newUsername = String(newUsername||"").trim();
  newFullName = String(newFullName||"").trim();
  if (!oldUsername || !newUsername || !newFullName) throw new Error("يرجى تعبئة جميع الحقول.");

  var usersSheet = _getOrCreateSheet_("Users_Master");
  var data = usersSheet.getDataRange().getValues();
  var rowIdx = -1;
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0]) === oldUsername) { rowIdx = i; continue; }
    if (String(data[i][0]).toLowerCase() === newUsername.toLowerCase()) {
      throw new Error("اسم الدخول الجديد مُستخدَم من مستخدم آخر بالفعل.");
    }
  }
  if (rowIdx === -1) throw new Error("المستخدم غير موجود.");

  var usernameChanged = (oldUsername !== newUsername);
  usersSheet.getRange(rowIdx+1, 1).setValue(newUsername);
  usersSheet.getRange(rowIdx+1, 3).setValue(newFullName);

  if (usernameChanged) {
    // خريطة: اسم الشيت -> رقم عمود المرجع (1-indexed) الذي يحتوي على اسم المستخدم
    var refs = [
      {name:"Permissions_Master", col:1},
      {name:"Contracts_Master",   col:10},
      {name:"Bookings_Master",    col:12},
      {name:"Global_Audit_Log",   col:10},
      {name:"Notification_Reads", col:2},
      {name:"Contract_Payments",  col:8},
      {name:"Contract_Payment_Receipts", col:8},
      {name:"Account_Payments",  col:9},
      {name:"Waitlist_Master",    col:11},
      // V3.60 — كانت تُنسى: التفضيلات (ومنها قيد الفنادق المسموحة ⇒ المستخدم المُعاد تسميته يصبح بلا قيد) والجلسات النشطة
      {name:"User_Preferences",   col:1},
      {name:"Active_Sessions",    col:3}
    ];
    // v3.42 — كانت تكتب كل صف مطابق بـ setValue منفصل (قد تصل لمئات نداءات الشيت لمستخدم قديم
    // له سجلات كثيرة) - الآن تقرأ عمود المرجع مرة واحدة وتكتبه مرة واحدة فقط بغض النظر عن عدد المطابقات
    refs.forEach(function(ref) {
      var sh = _getOrCreateSheet_(ref.name);
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return;
      var colRange = sh.getRange(2, ref.col, lastRow-1, 1);
      var colVals = colRange.getValues();
      var changed = false;
      for (var j=0; j<colVals.length; j++) {
        if (String(colVals[j][0]) === oldUsername) { colVals[j][0] = newUsername; changed = true; }
      }
      if (changed) colRange.setValues(colVals);
    });
    // V3.60 — اسم الدور المربوط بالمستخدم (خاصية USER_ROLE_NAMES) ينتقل للاسم الجديد
    try {
      var _rn = _getUserRoleNamesMap_();
      if (Object.prototype.hasOwnProperty.call(_rn, oldUsername)) { _setUserRoleName_(newUsername, _rn[oldUsername]); _setUserRoleName_(oldUsername, ""); }
    } catch (eRN) { _logError_(_fn, eRN); }
    _invalidateSheetCache_("User_Preferences");
  }

  _invalidateAuthCache_(); // V3.55 — بعد الكتابة أيضاً (يغلق نافذة إعادة بناء اللقطة بقيم قديمة أثناء الكتابة)
  logAudit("إدارة المستخدمين","تعديل بيانات مستخدم", newUsername, "", oldUsername, newUsername,
    "تم تعديل بيانات المستخدم: "+(usernameChanged?("اسم الدخول من '"+oldUsername+"' إلى '"+newUsername+"'، "):"")+"الاسم الكامل: "+newFullName, currentUser);
  return {success:true, usernameChanged:usernameChanged};
  } catch(e) { _logError_(_fn, e); throw e; }
}


/**
 * ======================================================================
 * إعدادات هوية الشركة (اسم + شعار) - مؤقتاً ضمن شاشة الصلاحيات لحين إنشاء شاشة إعدادات عامة للبرنامج
 * ======================================================================
 */
// يحفظ اسم الشركة (عربي/إنجليزي) وشعارها (Base64 DataURI) - Admin فقط
function saveCompanyBranding(nameAr, nameEn, logoDataUri, currentUser) { _apiGuard_();
  var _fn="[saveCompanyBranding]"; _logInfo_(_fn, "START | "+"nameAr:"+String(JSON.stringify(nameAr)||"").slice(0, 80)+", "+"nameEn:"+String(JSON.stringify(nameEn)||"").slice(0, 80)+", "+"logoDataUri:[data]");
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var props = PropertiesService.getScriptProperties();
  props.setProperty("COMPANY_NAME_AR", String(nameAr||"").trim());
  props.setProperty("COMPANY_NAME_EN", String(nameEn||"").trim());
  if (logoDataUri) props.setProperty("COMPANY_LOGO_URI", logoDataUri);
  props.setProperty("COMPANY_BRANDING_VER", String(Date.now())); // v3.53 — يُبطل نسخة الهوية المحفوظة بالمتصفحات
  logAudit("النظام","تحديث هوية الشركة","","","","","تم تحديث اسم/شعار الشركة",currentUser);
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يجلب إعدادات هوية الشركة الحالية (متاح لأي مستخدم مسجّل دخول، تُستخدم بقوالب الطباعة/التأكيد)
function getCompanyBranding() { _apiGuard_();
  var _fn="[getCompanyBranding]"; _logInfo_(_fn, "START | "+"");
  try {
  var props = PropertiesService.getScriptProperties();
  return {
    nameAr: props.getProperty("COMPANY_NAME_AR") || "",
    nameEn: props.getProperty("COMPANY_NAME_EN") || "",
    logoUri: props.getProperty("COMPANY_LOGO_URI") || ""
  };
  } catch(e) { _logError_(_fn, e); throw e; }
}


/**
 * ======================================================================
 * تأكيد الحجز (طباعة/PDF/مشاركة واتساب) - يعتمد على أعمدة Bookings_Master الجديدة:
 * Confirmation_Type, Reservation_Manager, Client_Option_Date (أُضيفت بنهاية البنية، تلقائية الإنشاء)
 * ======================================================================
 */

// يجلب بيانات حجز واحد منسّقة خصيصاً لنافذة/قالب تأكيد الحجز (منفصلة عن getBookingFullDetails لتفادي التعارض)
function getBookingForConfirmation(bookingId, currentUser) { _apiGuard_();
  var _fn="[getBookingForConfirmation]"; _logInfo_(_fn, "START | "+"bookingId:"+String(JSON.stringify(bookingId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser, "bookings", "canView");
  _requirePermission_(currentUser, "booking_confirmation", "canView"); // v3.40 — صلاحية مستقلة خاصة بإصدار تأكيد الحجز
  var data = _getOrCreateSheet_("Bookings_Master").getDataRange().getValues();
  var tz = _tz_();
  var hotelMap = _buildContractHotelMap_(), collMap = _buildCollectionAccountMap_();
  var allowed = _getUserAllowedHotels_(currentUser);
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0]) !== String(bookingId)) continue;
    var row = data[i];
    var hn = hotelMap[row[1]] || "(فندق محذوف)";
    if (allowed && !allowed[hn]) throw new Error("ليس لديك صلاحية الوصول لهذا الحجز.");
    var ci = row[6] instanceof Date?row[6]:new Date(row[6]);
    var co = row[7] instanceof Date?row[7]:new Date(row[7]);
    return {
      bookingId: row[0], hotelName: hn, clientName: row[2], collectionAccount: collMap[row[3]]||row[3],
      status: row[4], roomCount: row[5],
      checkIn: _fmtDate_(ci,tz,"dd/MM/yyyy"), checkInHijri: formatHijriDisplay(ci),
      checkOut: _fmtDate_(co,tz,"dd/MM/yyyy"), checkOutHijri: formatHijriDisplay(co),
      checkInFile: _fmtDate_(ci,tz,"yyyy-MM-dd"),
      nights: row[8], salePrice: row[9], bookingValue: row[10], notes: row[15]||"",
      confirmationType: row[18]||"", reservationManager: row[19]||"", clientOptionDateStr: row[20] ? _fmtDate_(row[20] instanceof Date?row[20]:new Date(row[20]),tz,"dd/MM/yyyy") : ""
    };
  }
  throw new Error("لم يتم العثور على الحجز.");
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يجلب قائمة أسماء مديري الحجوزات المحفوظين مسبقاً (تُراكَم تلقائياً عند كل استخدام جديد)
function getReservationManagers() { _apiGuard_();
  var _fn="[getReservationManagers]"; _logInfo_(_fn, "START | "+"");
  try {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("RESERVATION_MANAGERS") || "";
  var list = raw ? raw.split("|").filter(Boolean) : [];
  return list;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// دالة داخلية: تضيف اسم مدير حجوزات جديداً للقائمة المحفوظة عند استخدامه لأول مرة
function _addReservationManagerName_(name) {
  name = String(name||"").trim();
  if (!name) return;
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("RESERVATION_MANAGERS") || "";
  var list = raw ? raw.split("|").filter(Boolean) : [];
  if (list.indexOf(name) === -1) {
    list.push(name);
    if (list.length > 30) list = list.slice(-30);
    props.setProperty("RESERVATION_MANAGERS", list.join("|"));
  }
}

// يحفظ بيانات تأكيد الحجز (نوع التأكيد/المدير/تاريخ السداد) على صف الحجز + يُراكم اسم المدير للقائمة
function saveBookingConfirmation(bookingId, confType, manager, clientOptionDate, currentUser) { _apiGuard_();
  var _fn="[saveBookingConfirmation]"; _logInfo_(_fn, "START | "+"bookingId:"+String(JSON.stringify(bookingId)||"").slice(0, 80)+", "+"confType:"+String(JSON.stringify(confType)||"").slice(0, 80)+", "+"manager:"+String(JSON.stringify(manager)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Bookings_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  // v3.40 — إصدار تأكيد الحجز أصبح صلاحية مستقلة (booking_confirmation) بدل اشتراطه بصلاحية
  // تعديل الحجوزات العامة؛ هكذا يمكن منح مستخدم إصدار التأكيدات فقط دون صلاحية تعديل الحجوزات
  _requirePermission_(currentUser, "bookings", "canView");
  _requirePermission_(currentUser, "booking_confirmation", "canView");
  var sheet = _getOrCreateSheet_("Bookings_Master");
  var data = sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0]) !== String(bookingId)) continue;
    sheet.getRange(i+1, 19).setValue(confType || "Tentative Confirmation");
    sheet.getRange(i+1, 20).setValue(manager || "");
    var optDate = clientOptionDate ? new Date(clientOptionDate) : "";
    sheet.getRange(i+1, 21).setValue(optDate);
    // مزامنة: تاريخ السداد في تأكيد الحجز = نفس تاريخ السداد في بيانات الحجز (عمود 22) — حقل واحد مشترك
    sheet.getRange(i+1, 22).setValue(optDate);
    if (manager) _addReservationManagerName_(manager);
    logAudit("الحجوزات","إصدار تأكيد حجز",bookingId,"","","",
      "تم إصدار تأكيد ("+(confType||"")+") بواسطة "+(manager||"")+(clientOptionDate?(" — تاريخ السداد: "+clientOptionDate):""),currentUser);
    return {success:true};
  }
  throw new Error("لم يتم العثور على الحجز.");

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── إنشاء/جلب مجلد Drive مؤقت لملفات التقارير المُصدَّرة ───
// دالة عامة لتشغيل _ensureTempReportsFolder_ يدوياً من محرر Apps Script (الدوال التي تبدأ بـ _ لا تظهر بالقائمة)
// شغّل هذه الدالة مرة واحدة يدوياً من المحرر لضمان ظهور نافذة الموافقة على صلاحية Drive
function setupDriveFolderManual() { _apiGuard_(); return _ensureTempReportsFolder_().getName(); }

function _ensureTempReportsFolder_() {
  var props = PropertiesService.getScriptProperties();
  var root = _ensureAppRootFolder_(); // المجلد الرئيسي الموحّد باسم ملف الشيت
  var folderId = props.getProperty("TEMP_REPORTS_FOLDER_ID");
  if (folderId) {
    try {
      var folder = DriveApp.getFolderById(folderId);
      // ترحيل تلقائي: إن كان المجلد القديم خارج المجلد الرئيسي، انقله لداخله
      var parents = folder.getParents();
      var insideRoot = false;
      while (parents.hasNext()) { if (parents.next().getId() === root.getId()) { insideRoot = true; break; } }
      if (!insideRoot) folder.moveTo(root);
      if (folder.getName() !== "التقارير المؤقتة") folder.setName("التقارير المؤقتة");
      return folder;
    } catch(e) {}
  }
  var newFolder = root.createFolder("التقارير المؤقتة");
  props.setProperty("TEMP_REPORTS_FOLDER_ID", newFolder.getId());
  return newFolder;
}

// يحوّل محتوى HTML إلى ملف PDF فعلي، يحفظه مؤقتاً في Drive، وينظّف الملفات الأقدم من ساعة تلقائياً
function generateReportPdfForShare(htmlContent, fileName, currentUser) { _apiGuard_();
  var folder = _ensureTempReportsFolder_();
  try {
    var oneHourAgo = new Date(Date.now() - 60*60*1000);
    var oldFiles = folder.getFiles();
    while (oldFiles.hasNext()) {
      var f = oldFiles.next();
      if (f.getDateCreated() < oneHourAgo) f.setTrashed(true);
    }
  } catch(e) {}

  var htmlBlob = Utilities.newBlob(htmlContent, "text/html", fileName + ".html");
  var pdfBlob = htmlBlob.getAs("application/pdf");
  pdfBlob.setName(fileName + ".pdf");

  var file = folder.createFile(pdfBlob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    fileId: file.getId(),
    viewUrl: file.getUrl(),
    downloadUrl: "https://drive.google.com/uc?export=download&id=" + file.getId(),
    pdfBase64: Utilities.base64Encode(pdfBlob.getBytes()) // يُمكّن Web Share API من مشاركة الملف الفعلي (وليس رابطاً فقط)
  };
}

// يحذف ملف PDF مؤقت بعد اكتمال المشاركة/الطباعة
function deleteSharedReportFile(fileId, currentUser) { _apiGuard_();
  if (!fileId) return {success:false};
  try {
    // V3.60 — يُحذف فقط ملف داخل مجلد التقارير المؤقتة (كانت تقبل أي معرّف ملف يصل إليه مالك السكربت، بلا أي تحقق)
    var _tmpId = PropertiesService.getScriptProperties().getProperty("TEMP_REPORTS_FOLDER_ID");
    var _file = DriveApp.getFileById(fileId), _inTmp = false, _parents = _file.getParents();
    while (_tmpId && _parents.hasNext()) { if (_parents.next().getId() === _tmpId) { _inTmp = true; break; } }
    if (!_inTmp) return {success:false, message:"غير مسموح: الملف خارج مجلد التقارير المؤقتة."};
    _file.setTrashed(true);
    return {success:true};
  } catch(e) {
    return {success:false, message:e.message};
  }
}

// يفحص كل الحجوزات التي لها تاريخ سداد تأكيد (Client Option Date) خلال 3 أيام أو فات موعدها، وينشئ تنبيهاً لكل منها
function checkConfirmationOptionDatesAndNotify(force) { _apiGuard_();
  var _fn="[checkConfirmationOptionDatesAndNotify]"; _logInfo_(_fn, "START | "+"");
  try {
  if (!_bgCheckShouldRun_("OPTION_DATES", force)) return { success:true, skipped:"ran recently" };
  var data = _getOrCreateSheet_("Bookings_Master").getDataRange().getValues();
  var hotelMap = _buildContractHotelMap_();
  var tz = _tz_();
  var today = _dateOnly_(new Date());
  var threeDaysOut = new Date(today.getFullYear(), today.getMonth(), today.getDate()+3);
  var count = 0;
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (!row[0]||row[14]===true||row[4]==="ملغي") continue;
    if (!row[20]) continue; // لا يوجد تاريخ سداد محدَّد لهذا الحجز
    var optDate = _dateOnly_(row[20] instanceof Date?row[20]:new Date(row[20]));
    if (optDate > threeDaysOut) continue;
    var hn = hotelMap[row[1]]||"";
    var isOverdue = optDate < today;
    _createNotification_("notif_confirmation_option_due", row[0], hn,
      (isOverdue?"⚠️ فات تاريخ سداد تأكيد الحجز #":"⏰ اقتراب تاريخ سداد تأكيد الحجز #")+row[0]+" — "+row[2],
      "الحجز #"+row[0]+" للعميل "+row[2]+" في "+hn+" — تاريخ السداد المطلوب: "+_fmtDate_(optDate,tz,"dd/MM/yyyy")+(isOverdue?" (متأخر)":"")+".",
      "النظام");
    count++;
  }
  return {success:true, notificationsCreated:count};
  } catch(e) { _logError_(_fn, e); throw e; }
}


/**
 * ======================================================================
 * تصحيح بدايات الشهور الهجرية (لمعالجة فروق رؤية الهلال المحلية عن الحساب الفلكي لتقويم أم القرى)
 * ======================================================================
 */
// يُعيد بداية كل شهر من شهور سنة هجرية معيّنة (بالتاريخ الميلادي المقابل) + أي تصحيح محفوظ مسبقاً لكل شهر
function getHijriMonthStarts(hijriYear, currentUser) { _apiGuard_();
  var _fn="[getHijriMonthStarts]"; _logInfo_(_fn, "START | "+"hijriYear:"+String(JSON.stringify(hijriYear)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  hijriYear = parseInt(hijriYear, 10);
  var tz = _tz_();
  // تقدير تقريبي لبداية نطاق البحث الميلادي المقابل لهذه السنة الهجرية (السنة الهجرية ≈ 354.37 يوماً)
  var approxGregYear = Math.round(hijriYear * 0.970229 + 621.5643);
  var cur = new Date(approxGregYear - 1, 5, 1);
  var endSearch = new Date(approxGregYear + 1, 5, 1);
  var found = {}; // hijriMonth -> أول تاريخ ميلادي وجدناه لهذا الشهر ضمن السنة المطلوبة
  while (cur <= endSearch) {
    var h = _gregorianToHijriRaw_(cur);
    if (h.year === hijriYear && !found[h.month]) {
      found[h.month] = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
    }
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()+1);
  }
  var corrections = _getHijriCorrections_(hijriYear);
  var out = [];
  for (var m=1; m<=12; m++) {
    if (!found[m]) continue;
    out.push({
      hijriMonth: m, monthName: HIJRI_MONTH_NAMES[m-1],
      baseGregDate: _fmtDate_(found[m], tz, "dd/MM/yyyy"),
      correctionDays: corrections[m] || 0
    });
  }
  out.sort(function(a,b){ return a.hijriMonth - b.hijriMonth; });
  return { hijriYear: hijriYear, months: out };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحفظ تصحيحات بدايات الشهور لسنة هجرية معيّنة - Admin فقط
function saveHijriMonthCorrections(hijriYear, correctionsObj, currentUser) { _apiGuard_();
  var _fn="[saveHijriMonthCorrections]"; _logInfo_(_fn, "START | "+"hijriYear:"+String(JSON.stringify(hijriYear)||"").slice(0, 80)+", "+"correctionsObj:[data]"+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  hijriYear = parseInt(hijriYear, 10);
  var props = PropertiesService.getScriptProperties();
  props.setProperty("HIJRI_CORRECTIONS_" + hijriYear, JSON.stringify(correctionsObj || {}));
  __HIJRI_CORR_MEMO = {}; __HIJRI_DISPLAY_MEMO = {}; __HIJRI_DAY_MEMO = {};
  logAudit("النظام","تصحيح تقويم هجري","","","","","تم تحديث تصحيحات بدايات شهور السنة الهجرية "+hijriYear,currentUser);
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}


/**
 * ======================================================================
 * نظام الأدوار (Roles) — مجموعات صلاحيات جاهزة قابلة للتخصيص
 * يتيح تعيين مجموعة صلاحيات كاملة لمستخدم دفعة واحدة بدل ضبطها يدوياً عمود عمود
 * ======================================================================
 */
var DEFAULT_ROLES = {
  "مدير مالي": {
    availability_finance:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    financial_report:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    contracts:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    bookings:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    availability:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    dashboard:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    audit_log:{canView:true,canAdd:false,canEdit:false,canDelete:false}
  },
  "مدير حجوزات": {
    contracts:{canView:true,canAdd:true,canEdit:true,canDelete:false},
    bookings:{canView:true,canAdd:true,canEdit:true,canDelete:false},
    waitlist:{canView:true,canAdd:true,canEdit:true,canDelete:true},
    nusuk:{canView:true,canAdd:true,canEdit:true,canDelete:true},
    availability:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    availability_finance:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    availability_booking_data:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    dashboard:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    notif_booking_cancelled:{canView:true},notif_overcap_new:{canView:true},notif_overcap_edit:{canView:true},
    notif_waitlist_available:{canView:true},notif_payment_due:{canView:true}
  },
  "موظف حجوزات": {
    bookings:{canView:true,canAdd:true,canEdit:true,canDelete:false},
    waitlist:{canView:true,canAdd:true,canEdit:true,canDelete:false},
    nusuk:{canView:true,canAdd:true,canEdit:true,canDelete:false},
    availability:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    availability_booking_data:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    notif_booking_cancelled:{canView:true},notif_overcap_new:{canView:true}
  },
  "محاسب": {
    availability_finance:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    financial_report:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    bookings:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    contracts:{canView:true,canAdd:false,canEdit:false,canDelete:false},
    notif_payment_due:{canView:true}
  }
};

// يُعيد الأدوار المحفوظة + الافتراضية — Admin فقط
function getRoles() { _apiGuard_();
  var _fn="[getRoles]"; _logInfo_(_fn, "START | "+"");
  try {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("SYSTEM_ROLES");
  var custom = raw ? JSON.parse(raw) : {};
  var merged = {};
  Object.keys(DEFAULT_ROLES).forEach(function(r){ merged[r] = DEFAULT_ROLES[r]; });
  Object.keys(custom).forEach(function(r){ merged[r] = custom[r]; });
  return merged;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحفظ الأدوار المخصَّصة (تُضيف إلى الافتراضية أو تُعدّلها) - Admin فقط
function saveRole(roleName, perms, currentUser) { _apiGuard_();
  var _fn="[saveRole]"; _logInfo_(_fn, "START | "+"roleName:"+String(JSON.stringify(roleName)||"").slice(0, 80)+", "+"perms:[data]"+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  roleName = String(roleName||"").trim();
  if (!roleName) throw new Error("اسم الدور مطلوب.");
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("SYSTEM_ROLES");
  var custom = raw ? JSON.parse(raw) : {};
  custom[roleName] = perms;
  props.setProperty("SYSTEM_ROLES", JSON.stringify(custom));
  logAudit("إدارة الصلاحيات","حفظ دور",roleName,"","","","تم حفظ/تعديل الدور: "+roleName,currentUser);
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحذف دوراً مخصَّصاً (لا يمكن حذف الأدوار الافتراضية) - Admin فقط
function deleteRole(roleName, currentUser) { _apiGuard_();
  var _fn="[deleteRole]"; _logInfo_(_fn, "START | "+"roleName:"+String(JSON.stringify(roleName)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  if (DEFAULT_ROLES[roleName]) throw new Error("لا يمكن حذف الدور الافتراضي '"+roleName+"'. يمكن تعديله فقط.");
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("SYSTEM_ROLES");
  var custom = raw ? JSON.parse(raw) : {};
  delete custom[roleName];
  props.setProperty("SYSTEM_ROLES", JSON.stringify(custom));
  logAudit("إدارة الصلاحيات","حذف دور",roleName,"","","","تم حذف الدور: "+roleName,currentUser);
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُطبّق صلاحيات دور كامل على مستخدم - Admin فقط (الصلاحيات تُستبدل بالكامل بصلاحيات الدور)
function applyRoleToUser(targetUsername, roleName, currentUser) { _apiGuard_();
  var _fn="[applyRoleToUser]"; _logInfo_(_fn, "START | "+"targetUsername:"+String(JSON.stringify(targetUsername)||"").slice(0, 80)+", "+"roleName:"+String(JSON.stringify(roleName)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Permissions_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var roles = getRoles();
  if (!roles[roleName]) throw new Error("الدور '"+roleName+"' غير موجود.");
  var perms = roles[roleName];
  // حذف صلاحيات المستخدم الحالية وكتابة صلاحيات الدور الجديد — كتابة واحدة (V3.55)
  var _tl = String(targetUsername).toLowerCase();
  _replacePermissionRows_(function(u) { return u.toLowerCase() === _tl; },
    Object.keys(perms).map(function(screen) { var p = perms[screen]; return [targetUsername, screen, !!p.canView, !!p.canAdd, !!p.canEdit, !!p.canDelete]; }));
  _setUserRoleName_(targetUsername, roleName);
  _invalidateAuthCache_(); // V3.55 — بعد الكتابة أيضاً (يغلق نافذة إعادة بناء اللقطة بقيم قديمة أثناء الكتابة)
  logAudit("إدارة الصلاحيات","تطبيق دور على مستخدم",targetUsername,"","",roleName,"تم تطبيق الدور '"+roleName+"' على المستخدم "+targetUsername,currentUser);
  return {success:true};

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── تتبع اسم الدور المُطبَّق حالياً على كل مستخدم (لعرضه كعمود "الدور" بجدول المستخدمين) ───
function _getUserRoleNamesMap_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("USER_ROLE_NAMES");
  return raw ? JSON.parse(raw) : {};
}
function _setUserRoleName_(username, roleName) {
  var props = PropertiesService.getScriptProperties();
  var map = _getUserRoleNamesMap_();
  if (roleName) map[username] = roleName; else delete map[username];
  props.setProperty("USER_ROLE_NAMES", JSON.stringify(map));
}
// يُعيد خريطة (اسم المستخدم → اسم الدور المُطبَّق) لعرضها بجدول المستخدمين
function getUserRoleNames() { _apiGuard_(); return _getUserRoleNamesMap_(); }
// يُلغي ربط مستخدم بأي دور (يبقي صلاحياته الحالية كما هي، فقط يُزيل التسمية)
function clearUserRoleName(username, currentUser) { _apiGuard_();
  var _fn="[clearUserRoleName]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  _setUserRoleName_(username, "");
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعدّل صلاحيات دور موجود، ثم يُعيد تطبيقها تلقائياً على كل المستخدمين المرتبطين حالياً بهذا الدور
function updateRoleAndPropagate(roleName, perms, currentUser) { _apiGuard_();
  var _fn="[updateRoleAndPropagate]"; _logInfo_(_fn, "START | "+"roleName:"+String(JSON.stringify(roleName)||"").slice(0, 80)+", "+"perms:[data]"+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Permissions_Master"); // ضمان قراءة حديثة بعد أي كتابة ضمن نفس التنفيذ
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  saveRole(roleName, perms, currentUser);
  var roleMap = _getUserRoleNamesMap_();
  var affected = Object.keys(roleMap).filter(function(u){ return roleMap[u] === roleName; });
  // V3.55 — كل المستخدمين المتأثرين في كتابة واحدة (كانت قراءة كاملة + حذف/إضافة صف بصف لكل مستخدم)
  var _affLower = {}; affected.forEach(function(u) { _affLower[String(u).toLowerCase()] = true; });
  var _newRows = [];
  affected.forEach(function(username) {
    Object.keys(perms).forEach(function(screen) { var p = perms[screen]; _newRows.push([username, screen, !!p.canView, !!p.canAdd, !!p.canEdit, !!p.canDelete]); });
  });
  if (affected.length) _replacePermissionRows_(function(u) { return !!_affLower[u.toLowerCase()]; }, _newRows);
  _invalidateAuthCache_(); // V3.55 — بعد الكتابة أيضاً (يغلق نافذة إعادة بناء اللقطة بقيم قديمة أثناء الكتابة)
  logAudit("إدارة الصلاحيات","تعديل دور ونشره",roleName,"","","","تم تعديل الدور '"+roleName+"' ونشر التغيير على "+affected.length+" مستخدم(ين)",currentUser);
  return {success:true, affectedCount: affected.length};

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يجلب صلاحيات دور معيّن (لعرضها بنافذة تعديل الدور)
function getRolePermissions(roleName) { _apiGuard_();
  var _fn="[getRolePermissions]"; _logInfo_(_fn, "START | "+"roleName:"+String(JSON.stringify(roleName)||"").slice(0, 80));
  try {
  var roles = getRoles();
  return roles[roleName] || {};
  } catch(e) { _logError_(_fn, e); throw e; }
}


/**
 * ======================================================================
 * إعدادات مدة الجلسة (قابلة للتعديل من شاشة الصلاحيات - Admin فقط)
 * ======================================================================
 */
// يجلب مدة الجلسة الحالية بالدقائق (15 دقيقة افتراضياً)
function getSessionTimeoutMinutes() { _apiGuard_();
  var _fn="[getSessionTimeoutMinutes]"; _logInfo_(_fn, "START | "+"");
  try {
  var props = PropertiesService.getScriptProperties();
  var val = props.getProperty("SESSION_TIMEOUT_MINUTES");
  return val ? parseInt(val, 10) : 15;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحفظ مدة الجلسة الجديدة بالدقائق - Admin فقط
function saveSessionTimeoutMinutes(minutes, currentUser) { _apiGuard_();
  var _fn="[saveSessionTimeoutMinutes]"; _logInfo_(_fn, "START | "+"minutes:"+String(JSON.stringify(minutes)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  minutes = parseInt(minutes, 10);
  if (isNaN(minutes) || minutes < 3) throw new Error("مدة الجلسة يجب ألا تقل عن 3 دقائق.");
  var props = PropertiesService.getScriptProperties();
  props.setProperty("SESSION_TIMEOUT_MINUTES", String(minutes));
  logAudit("إدارة الصلاحيات","تحديث مدة الجلسة","","","","","تم تحديث مدة الجلسة إلى "+minutes+" دقيقة",currentUser);
  return {success:true};
  } catch(e) { _logError_(_fn, e); throw e; }
}

/**
 * ======================================================================
 * نقاط النهاية المجمّعة (Batched Endpoints) — تحسين الأداء
 * ======================================================================
 * كل نداء google.script.run يستغرق 1-3 ثوانٍ (زمن رحلة الشبكة + بدء التنفيذ).
 * هذه الدوال تجمع عدة استعلامات في نداء واحد، وبفضل طبقة _getSheetValues_
 * فإن كل شيت يُقرأ مرة واحدة فقط داخل التنفيذ الواحد.
 */


// ═══════════════════════════════════════════════════════════════
// v3.0 — رقم نسخة النظام المصدر الوحيد الموحّد (يُحقن للواجهة عبر getAppBootstrap)
// ═══════════════════════════════════════════════════════════════
var APP_VERSION = "V3.86";
// V3.54 — ترتيب أرقام الإصدارات رقمياً وبلا حساسية لحالة الحرف (v3.9 < v3.10 < V3.54)
function _cmpVersion_(a, b) {
  var pa = String(a).replace(/^[vV]/, "").split("."), pb = String(b).replace(/^[vV]/, "").split(".");
  for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
    var x = parseInt(pa[i], 10), y = parseInt(pb[i], 10);
    if (isNaN(x) !== isNaN(y)) return isNaN(x) ? -1 : 1; // غير الرقمي (مثل legacy) أولاً
    if (isNaN(x)) { var c = String(pa[i] || "").localeCompare(String(pb[i] || "")); if (c) return c; continue; }
    if (x !== y) return x - y;
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// طبقة تشفير كلمات المرور (SHA-256 + Salt) — متوافقة مع الحسابات القديمة
// أي كلمة مرور نصية قديمة تُهاجَر تلقائياً عند أول تسجيل دخول ناجح لها
// ═══════════════════════════════════════════════════════════════
// v3.5 — تحويل الأرقام العربية/الفارسية إلى Latin قبل أي تحليل رقمي
// يحمي من: (1) بيانات وردت من واجهة قديمة قبل تفعيل التحويل التلقائي بالمتصفح
//         (2) بيانات محفوظة سابقاً في الشيت بأرقام عربية (تعرض 6 لكن parseFloat=NaN)
//         (3) استيراد Excel/CSV يحوي أرقاماً عربية
function _normalizeArabicDigits_(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "number") return v;
  return String(v)
    .replace(/[٠-٩]/g, function(c){ return String(c.charCodeAt(0) - 0x0660); })
    .replace(/[۰-۹]/g, function(c){ return String(c.charCodeAt(0) - 0x06F0); })
    .replace(/٫/g, ".").replace(/٬/g, ",");
}
// دالة موحّدة لتحويل أي قيمة (بأرقام عربية أو إنجليزية) إلى رقم صالح — تُستخدم بدل parseFloat/parseInt المباشرة
function _toNumber_(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  var n = parseFloat(_normalizeArabicDigits_(v));
  return isNaN(n) ? 0 : n;
}

function _pwGenerateSalt_() {
  // 16 بايت عشوائية تُحوَّل لسلسلة hex قصيرة عبر SHA-1 (16 حرفاً)
  var seed = Utilities.getUuid() + "|" + Date.now() + "|" + Math.random();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, seed);
  var hex = ""; for (var i=0; i<bytes.length; i++) { var b=bytes[i]<0?bytes[i]+256:bytes[i]; hex += (b<16?"0":"") + b.toString(16); }
  return hex.slice(0, 16);
}
function _pwHash_(password, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt||"") + "|hotelapp|" + String(password||""));
  var hex = ""; for (var i=0; i<bytes.length; i++) { var b=bytes[i]<0?bytes[i]+256:bytes[i]; hex += (b<16?"0":"") + b.toString(16); }
  return "sha256$" + hex;
}
function _pwIsHashed_(stored) { return String(stored||"").indexOf("sha256$") === 0; }
function _pwVerify_(inputPassword, storedPassword, salt) {
  if (_pwIsHashed_(storedPassword)) return _pwHash_(inputPassword, salt) === String(storedPassword);
  // توافق خلفي: الحسابات القديمة بلا تشفير — مطابقة نصية بحتة
  return String(inputPassword) === String(storedPassword);
}
// يُهاجر كلمة مرور مستخدم واحد إلى الصيغة المشفَّرة (يُستدعى بعد أول دخول ناجح للحساب القديم)
function _pwMigrateIfNeeded_(sheet, rowIdx, plainPassword) {
  try {
    var salt = _pwGenerateSalt_();
    sheet.getRange(rowIdx+1, 2).setValue(_pwHash_(plainPassword, salt));
    sheet.getRange(rowIdx+1, 6).setValue(salt); // العمود 6 = Salt
  } catch(e) { /* لا نُفشل تسجيل الدخول لو فشلت الهجرة — تُعاد المحاولة بعد */ }
}

// ═══════════════════════════════════════════════════════════════
// كاش شارت التوافر لكل (فندق × شهر) — إبطال ذكي بعد كل تعديل يمسّ الفترة
// ═══════════════════════════════════════════════════════════════
var _AVAIL_CACHE_TTL_SEC = 900; // 15 دقيقة كحد أقصى (يُبطَل يدوياً أيضاً عند أي تعديل مؤثر)
function _availCacheKey_(hotelName, year, month) {
  // مفتاح آمن للكاش: تجزئة اسم الفندق (Base64) لتفادي أي رموز عربية أو خاصة في المفتاح
  // V3.55 — بادئة جديدة: النسخ القديمة المخزَّنة كانت مقصوصة حسب صلاحيات من فتحها أولاً فلا تصلح للنسخة الكاملة
  return "AV3_" + Utilities.base64EncodeWebSafe(Utilities.newBlob(String(hotelName||"")).getBytes()) + "_" + year + "_" + month;
}
function _getAvailFromCache_(hotelName, year, month) {
  try {
    var raw = CacheService.getScriptCache().get(_availCacheKey_(hotelName, year, month));
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}
function _putAvailInCache_(hotelName, year, month, obj) {
  try {
    var s = JSON.stringify(obj);
    // CacheService لا يقبل > 100KB لكل عنصر — نتخطى التخزين لو تجاوزت النتيجة الحد بدل الرمي بخطأ
    if (s.length < 95000) CacheService.getScriptCache().put(_availCacheKey_(hotelName, year, month), s, _AVAIL_CACHE_TTL_SEC);
  } catch(e) {}
}
// إبطال كاش شارت التوافر لكل الشهور المتقاطعة مع فترة تعديل (تعاقد/حجز) — يُستدعى بعد أي حفظ يمسّ التوافر
function _invalidateAvailCacheForRange_(hotelName, startDate, endDate) {
  try {
    if (!hotelName || !startDate) return;
    var sd = startDate instanceof Date ? startDate : new Date(startDate);
    var ed = endDate ? (endDate instanceof Date ? endDate : new Date(endDate)) : sd;
    if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return;
    var cache = CacheService.getScriptCache();
    var keys = [];
    var y = sd.getFullYear(), m = sd.getMonth()+1;
    while (y < ed.getFullYear() || (y === ed.getFullYear() && m <= ed.getMonth()+1)) {
      keys.push(_availCacheKey_(hotelName, y, m));
      m++; if (m > 12) { m = 1; y++; }
      if (keys.length > 60) break; // حد أمان
    }
    if (keys.length) cache.removeAll(keys);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
// v3.0 — Server-side pagination للحجوزات مع بحث مركزي
// ═══════════════════════════════════════════════════════════════
function getBookingsPage(filters, page, pageSize, currentUser) { _apiGuard_();
  var _fn="[getBookingsPage]"; _logInfo_(_fn, "START | page:"+page+", pageSize:"+pageSize);
  try {
  _requirePermission_(currentUser, "bookings", "canView");
  filters = filters || {};
  page = Math.max(1, parseInt(page,10)||1);
  pageSize = Math.max(10, Math.min(500, parseInt(pageSize,10)||100));
  var full = getBookings(currentUser);
  var _tFilter = Date.now();
  var q = String(filters.q||"").trim().toLowerCase();
  var fId = String(filters.bookingId||"").trim().toLowerCase();
  var fClient = String(filters.client||"").trim().toLowerCase();
  var fStatus = String(filters.status||"").trim(); // توافق خلفي: فلتر بقيمة واحدة (نادراً ما يُستخدم بعد v3.10)
  // v3.10 — فلتر الحالة متعدد الاختيار: statusMode = 'all' | 'allExceptCancelled' | 'custom'
  var fStatusMode = String(filters.statusMode||"").trim();
  var fStatusList = Array.isArray(filters.statusList) ? filters.statusList.map(String) : [];
  var fHotel = String(filters.hotel||"").trim();
  var fColl = String(filters.collection||"").trim();
  var fMonth = String(filters.month||"").trim(); // YYYY-MM
  // V3.54 — الواجهة القديمة كانت ترسل "2026-1" بلا صفر فلا يطابق أي حجز في شهور 1-9
  var _fmm = fMonth.match(/^(\d{4})-(\d{1,2})$/); if (_fmm) fMonth = _fmm[1] + "-" + (_fmm[2].length === 1 ? "0" : "") + _fmm[2];
  var fFromIso = String(filters.fromIso||"").trim();
  var fToIso = String(filters.toIso||"").trim();
  var fCheckinIso = String(filters.checkinIso||"").trim();
  var fNoPriceOnly = !!filters.noPriceOnly; // v3.16 — حجوزات بلا سعر بيع (قادم من زر "استكمال البيانات" بالبيان اليومي)
  var fActiveOnIso = String(filters.activeOnIso||"").trim(); // v3.16 — الحجز نشط (ضمن لياليه) بتاريخ محدد
  var dmy2iso = function(s){ if(!s) return ""; var p=String(s).split('/'); return (p.length===3) ? (p[2]+'-'+p[1]+'-'+p[0]) : ""; };
  // v3.10 — يُعيد الحالة المعروضة فعلياً لحجز معيّن (نفس أولوية _bkStatusDisplay بالواجهة):
  // شراء (عدد غرف سالب) > مسجل/معدل اوفر (تجاوز الطاقة) > الحالة الفعلية المخزَّنة
  var _displayStatusOf = function(b) {
    if (Number(b.roomCount) < 0) return "شراء";
    if (b.overCapacity) return b.overCapacityType || "مسجل اوفر";
    return b.status;
  };
  var filtered = full.filter(function(b) {
    if (q) {
      var hay = (b.bookingId+" "+b.clientName+" "+b.hotelName+" "+(b.collectionAccount||"")+" "+(b.notes||"")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (fId && String(b.bookingId).toLowerCase().indexOf(fId)===-1) return false;
    if (fClient && String(b.clientName).toLowerCase().indexOf(fClient)===-1) return false;
    if (fStatusMode === "allExceptCancelled") {
      if (_displayStatusOf(b) === "ملغي") return false;
    } else if (fStatusMode === "custom") {
      if (fStatusList.length && fStatusList.indexOf(_displayStatusOf(b)) === -1) return false;
    } else if (fStatus) {
      if (_displayStatusOf(b) !== fStatus) return false;
    }
    if (fHotel && String(b.hotelName).indexOf(fHotel) === -1) return false;
    if (fColl && String(b.collectionAccount||"").indexOf(fColl)===-1) return false;
    var bIso = dmy2iso(b.checkIn);
    if (fMonth && bIso.substring(0,7)!==fMonth) return false;
    if (fFromIso && bIso && bIso < fFromIso) return false;
    if (fToIso && bIso && bIso > fToIso) return false;
    if (fCheckinIso && bIso !== fCheckinIso) return false;
    if (fNoPriceOnly && Number(b.salePrice)>0) return false;
    if (fActiveOnIso) { // نشط بتاريخ معيّن: يشمل ذلك اليوم ضمن لياليه [checkIn, checkOut)
      var bCoIso = dmy2iso(b.checkOut);
      if (!(bIso && bCoIso && bIso<=fActiveOnIso && bCoIso>fActiveOnIso)) return false;
    }
    return true;
  });
  // v3.7 — الترتيب الافتراضي: تاريخ الدخول تصاعدياً (الأقرب أولاً) — يمكن للواجهة تخصيصه لاحقاً عبر filters.sortBy
  var sortBy = String(filters.sortBy||"checkInAsc").trim();
  // V3.54 — مفتاح الترتيب يُحسب مرة لكل صف بدل مرتين في كل مقارنة (آلاف المقارنات)
  var _isoKey = {}; filtered.forEach(function(b) { _isoKey[b.bookingId] = dmy2iso(b.checkIn); });
  filtered.sort(function(a, b) {
    var aIso = _isoKey[a.bookingId], bIso = _isoKey[b.bookingId];
    if (sortBy === "checkInDesc") return (bIso||"").localeCompare(aIso||"");
    if (sortBy === "bookingIdDesc") return String(b.bookingId).localeCompare(String(a.bookingId), undefined, {numeric:true});
    if (sortBy === "bookingIdAsc")  return String(a.bookingId).localeCompare(String(b.bookingId), undefined, {numeric:true});
    if (sortBy === "createdDesc") return ((Number(b.createdTs)||0) - (Number(a.createdTs)||0)) || String(b.bookingId).localeCompare(String(a.bookingId), undefined, {numeric:true});
    // checkInAsc (الافتراضي) — الأقدم أولاً كي يبدأ المستخدم بالحجوزات المستحقة قريباً
    return (aIso||"").localeCompare(bIso||"");
  });
  var total = filtered.length;
  var start = (page-1)*pageSize;
  var slice = filtered.slice(start, start+pageSize);
  var res = { rows: slice, total: total, page: page, pageSize: pageSize, totalPages: Math.max(1, Math.ceil(total/pageSize)), totals: _bookingTotals_(filtered) }; // V3.81
  try { _recordPerfSample_("~getBookingsPage:filterSort", Date.now()-_tFilter, true); } catch(eT) {}
  // V3.54 — شريط "الأوفر" مع الصفحة عند فتح الشاشة (نفس قراءة شيت الحجوزات المحفوظة بهذا التنفيذ بدل نداء ثانٍ)
  if (filters.includeOvercap) { try { res.overcap = getOverCapacityNotifications(currentUser); } catch(eO) {} }
  return res;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// v3.0 — Server-side pagination لسجل التدقيق العام
function getGlobalAuditLogPage(filters, page, pageSize, currentUser) { _apiGuard_();
  var _fn="[getGlobalAuditLogPage]"; _logInfo_(_fn, "START | page:"+page);
  try {
  filters = filters || {};
  page = Math.max(1, parseInt(page,10)||1);
  pageSize = Math.max(10, Math.min(500, parseInt(pageSize,10)||100));
  // فحص صلاحية (مطابق لـ getGlobalAuditLog)
  if (currentUser && !_isAdmin_(currentUser)) {
    var perms = getUserPermissions(currentUser, _getUserRole_(currentUser));
    if (!perms || !perms.audit_log || !perms.audit_log.canView) return {rows:[], total:0, page:page, pageSize:pageSize, totalPages:0};
  }
  var sheet = _getOrCreateSheet_("Global_Audit_Log");
  var data; try { data = sheet.getDataRange().getValues(); } catch(e) { return {rows:[], total:0, page:page, pageSize:pageSize, totalPages:0}; }
  if (!data || data.length <= 1) return {rows:[], total:0, page:page, pageSize:pageSize, totalPages:0};
  var tz; try { tz = _tz_(); } catch(e) { tz = "Asia/Riyadh"; }
  // خرائط تصفية الفنادق
  // v3.9 — الخريطة تُبنى الآن أيضاً عند تفعيل فلتر الفندق الصريح (وليس فقط لتقييد صلاحيات غير المدير)
  var fHotel = String(filters.hotel||"").trim();
  var allowed = null, recordHotelMap = null;
  try {
    allowed = currentUser ? _getUserAllowedHotels_(currentUser) : null;
    if (allowed || fHotel) {
      recordHotelMap = {};
      var hotelMap = _buildContractHotelMap_();
      var bData = _getOrCreateSheet_("Bookings_Master").getDataRange().getValues();
      for (var bi=1; bi<bData.length; bi++) { if (bData[bi][0]) recordHotelMap[bData[bi][0]] = hotelMap[bData[bi][1]]; }
      var cData = _getOrCreateSheet_("Contracts_Master").getDataRange().getValues();
      for (var ci=1; ci<cData.length; ci++) { if (cData[ci][0]) recordHotelMap[cData[ci][0]] = cData[ci][1]; }
      // خريطة إضافية لسجلات اتفاقيات نسك: تُنسب لفندق الاتفاقية مباشرة
      try {
        var nData = _getOrCreateSheet_("Nusuk_Agreements").getDataRange().getValues();
        for (var ni=1; ni<nData.length; ni++) { if (nData[ni][0]) recordHotelMap[nData[ni][0]] = nData[ni][1]; }
      } catch(nx) {}
    }
  } catch(e) { allowed = null; recordHotelMap = null; }
  var fScreen = String(filters.screen||"").trim();
  var fAction = String(filters.actionType||"").trim();
  var fUser = String(filters.user||"").trim().toLowerCase();
  var fRecord = String(filters.recordId||"").trim();
  var showLogin = filters.showLogin ? true : false;
  var fFromDate = filters.fromDate ? _dateOnly_(new Date(filters.fromDate)) : null;
  var fToDate = filters.toDate ? _dateOnly_(new Date(filters.toDate)) : null;
  if (fToDate) fToDate = new Date(fToDate.getFullYear(), fToDate.getMonth(), fToDate.getDate(), 23, 59, 59);
  // v3.8 — فلتر المستخدم يطابق جزئياً (يحتوي) على اسم الدخول أو الاسم الكامل معاً
  // (كان تطابقاً حرفياً على اسم الدخول فقط بينما الجدول يعرض الاسم الكامل — فما يكتبه المستخدم لا يطابق أبداً)
  var _userFullNameMap = {};
  if (fUser) { try { _userFullNameMap = getUsernameFullNameMap(); } catch(e){} }
  // المرور الكامل على السجل (من الأحدث للأقدم) وتصفية + تجميع مطابقة
  var matched = [];
  for (var i = data.length-1; i >= 1; i--) {
    try {
      var row = data[i]; if (!row) continue;
      var logId = String(row[0]||""); if (!logId) continue;
      var screen = String(row[2]||""), actionType = String(row[3]||"");
      var recordId = String(row[4]||""), user = String(row[9]||"");
      if (!showLogin && (actionType==="تسجيل دخول"||actionType==="تسجيل خروج")) continue;
      if (fScreen && screen!==fScreen) continue;
      if (fAction && actionType!==fAction) continue;
      if (fUser) {
        var _uLow = user.toLowerCase();
        var _fLow = String(_userFullNameMap[user]||"").toLowerCase();
        if (_uLow.indexOf(fUser)===-1 && _fLow.indexOf(fUser)===-1) continue;
      }
      if (fRecord && recordId.indexOf(fRecord)===-1) continue;
      if (row[1]) {
        try { var rd = new Date(row[1]);
          if (fFromDate && rd<fFromDate) continue;
          if (fToDate && rd>fToDate) continue;
        } catch(dErr){}
      }
      if (recordHotelMap && allowed) {
        var rh = recordHotelMap[recordId];
        if (rh && !allowed[rh]) continue;
      }
      // v3.9 — فلتر الفندق الصريح: يُبقي فقط السجلات المنسوبة لهذا الفندق تحديداً
      // (السجلات الإدارية غير المرتبطة بفندق — كإدارة المستخدمين — تُستبعد عند تفعيل هذا الفلتر، وهذا هو المقصود)
      if (fHotel) {
        if (recordHotelMap[recordId] !== fHotel) continue;
      }
      matched.push(row);
    } catch(rowErr) { continue; }
  }
  var total = matched.length;
  var start = (page-1)*pageSize;
  var pageRows = matched.slice(start, start+pageSize);
  var out = pageRows.map(function(row) {
    var ts = "";
    try { if (row[1]) ts = _fmtDate_(new Date(row[1]), tz, "dd/MM/yyyy HH:mm"); } catch(e){ ts=String(row[1]||""); }
    return { logId: String(row[0]||""), timestamp: ts, screen: String(row[2]||""), actionType: String(row[3]||""),
             recordId: String(row[4]||""), fieldChanged: String(row[5]||""), oldValue: String(row[6]||""),
             newValue: String(row[7]||""), summary: String(row[8]||""), user: String(row[9]||"") };
  });
  return { rows: out, total: total, page: page, pageSize: pageSize, totalPages: Math.max(1, Math.ceil(total/pageSize)) };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ═══════════════════════════════════════════════════════════════
// v3.0 — البحث الموحّد (Global Search) — يبحث في: الحجوزات، التعاقدات، العملاء، الفنادق
// ═══════════════════════════════════════════════════════════════
function globalSearch(query, currentUser) { _apiGuard_();
  var _fn="[globalSearch]"; _logInfo_(_fn, "START | q:"+String(query||"").slice(0,40));
  try {
  var q = String(query||"").trim().toLowerCase();
  if (q.length < 2) return [];
  var results = [];
  var allowed = _getUserAllowedHotels_(currentUser);
  var hotelMap = _buildContractHotelMap_();
  // (1) الحجوزات
  try {
    var bData = _getSheetValues_("Bookings_Master");
    for (var i=1; i<bData.length && results.length<40; i++) {
      var b = bData[i]; if (!b[0] || b[14]===true) continue;
      var hn = hotelMap[b[1]] || "";
      if (allowed && !allowed[hn]) continue;
      var hay = String(b[0]+" "+b[2]+" "+hn+" "+(b[15]||"")).toLowerCase();
      if (hay.indexOf(q) > -1) {
        results.push({ type:"booking", icon:"🛎", id:b[0],
          title: "حجز " + b[0] + " — " + (b[2]||""),
          subtitle: hn + " · " + (b[4]||"") });
      }
    }
  } catch(e){}
  // (2) التعاقدات
  try {
    var cData = _getSheetValues_("Contracts_Master");
    for (var j=1; j<cData.length && results.length<70; j++) {
      var c = cData[j]; if (!c[0] || c[12]===true) continue;
      if (allowed && !allowed[c[1]]) continue;
      var hay2 = String(c[0]+" "+c[1]+" "+(c[2]||"")).toLowerCase();
      if (hay2.indexOf(q) > -1) {
        results.push({ type:"contract", icon:"📄", id:c[0],
          title: "تعاقد " + c[0] + " — " + (c[1]||""),
          subtitle: (c[2]||"") + " · " + (c[14]||"رئيسي") });
      }
    }
  } catch(e){}
  return results.slice(0, 30);
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ═══════════════════════════════════════════════════════════════
// v3.0 — تصدير تقرير إلى Drive: PDF (شراكه فوراً) أو Excel (CSV مرن)
// يعتمد على مجلد التقارير المؤقتة الموجود مسبقاً (_ensureTempReportsFolder_)
// ═══════════════════════════════════════════════════════════════
function exportReportToDrivePdf(htmlContent, fileName, currentUser) { _apiGuard_();
  var _fn="[exportReportToDrivePdf]"; _logInfo_(_fn, "START | fileName:"+fileName);
  try {
  fileName = String(fileName||"تقرير").replace(/[\\/:*?"<>|]/g,"_").slice(0,120) + ".pdf";
  var folder = _ensureTempReportsFolder_();
  var htmlBlob = Utilities.newBlob(String(htmlContent||""), "text/html", "temp.html");
  var pdfBlob = htmlBlob.getAs("application/pdf").setName(fileName);
  var file = folder.createFile(pdfBlob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  logAudit("التقارير","تصدير PDF",file.getId(),"","","","تصدير PDF: "+fileName, currentUser);
  return { fileId: file.getId(), url: file.getUrl(), name: fileName };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُصدّر صفوف جدول إلى ملف Excel (بصيغة .xlsx عبر Google Sheets ثم تحويل) أو CSV سريع
// rows: مصفوفة صفوف (كل صف مصفوفة قيم). headers: مصفوفة أسماء الأعمدة.
function exportReportToDriveExcel(headers, rows, fileName, currentUser) { _apiGuard_();
  var _fn="[exportReportToDriveExcel]"; _logInfo_(_fn, "START | fileName:"+fileName);
  try {
  fileName = String(fileName||"تقرير").replace(/[\\/:*?"<>|]/g,"_").slice(0,120);
  var folder = _ensureTempReportsFolder_();
  // نُنشئ Google Spreadsheet مؤقتاً ونُصدّره كملف xlsx
  var tmpSs = SpreadsheetApp.create(fileName);
  var tmpFile = DriveApp.getFileById(tmpSs.getId());
  // نقل الملف لمجلد التقارير المؤقتة
  try { folder.addFile(tmpFile); DriveApp.getRootFolder().removeFile(tmpFile); } catch(mvErr) {}
  var sheet = tmpSs.getSheets()[0];
  sheet.setName("Report");
  var all = [headers].concat(rows||[]);
  if (all.length && all[0].length) sheet.getRange(1,1,all.length, all[0].length).setValues(all);
  sheet.setFrozenRows(1);
  SpreadsheetApp.flush();
  // نجلب رابط xlsx مباشرة عبر Drive Export
  var xlsxUrl = "https://docs.google.com/spreadsheets/d/" + tmpSs.getId() + "/export?format=xlsx";
  tmpFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  logAudit("التقارير","تصدير Excel",tmpSs.getId(),"","","","تصدير Excel: "+fileName, currentUser);
  return { fileId: tmpSs.getId(), url: tmpFile.getUrl(), xlsxUrl: xlsxUrl, name: fileName + ".xlsx" };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// تُجمّع كل بيانات ما بعد تسجيل الدخول في نداء واحد (كانت 5 نداءات منفصلة)
// v3.53 — opts (اختياري): {brandingVer} — إن طابق نسخة الهوية المحفوظة في المتصفح لا يُعاد إرسال الشعار (أغلب حجم الحزمة).
// وتشمل الحزمة الآن ما كانت الشاشات تطلبه منفصلاً عند الإقلاع (التفضيلات، أسماء الفنادق، جهات التحصيل،
// نطاقات التعاقد) + أرقام نسخ الإشعارات/التوافر حتى لا يعيد أول نداء دوري تحميل قائمة الإشعارات كاملة.
// V3.59 — بيانات الشاشة الرئيسية للمستخدم (نفس اختيار الواجهة: المحفوظة إن كانت مسموحة، وإلا أول مسموحة بالترتيب
// الافتراضي) تُرفق برد الدخول: التوافر (أول فندق، الشهر الحالي إن كان ضمن التعاقد وإلا أول شهر) أو الحجوزات أو اللوحة.
function _loginHomeData_(username, role, permissions, boot, opts) {
  var admin = String(role || "").toLowerCase() === "admin";
  var can = function(id) { return admin || !!(permissions && permissions[id] && permissions[id].canView); };
  var permOf = { Dashboard_Screen: "dashboard", Bookings_Screen: "bookings", Availability_Screen: "availability", Contracts_Screen: "contracts",
    FinancialReport_Screen: "financial_report", AuditLog_Screen: "audit_log", Waitlist_Screen: "waitlist", Nusuk_Screen: "nusuk", Accounts_Screen: "accounts" };
  var order = ["Dashboard_Screen", "Bookings_Screen", "Availability_Screen", "Contracts_Screen", "FinancialReport_Screen", "AuditLog_Screen"];
  var saved = String((boot.prefs && boot.prefs.default_home_screen) || "");
  var home = "";
  if (saved === "Permissions_Screen" || saved === "Settings_Screen") { if (admin) home = saved; }
  else if (saved && permOf[saved] && can(permOf[saved])) home = saved;
  if (!home) for (var i = 0; i < order.length; i++) { if (can(permOf[order[i]])) { home = order[i]; break; } }
  var out = { screen: home };
  if (home === "Availability_Screen") {
    var names = boot.hotelNames || [];
    if (names.length) {
      var hotel = names[0], r = boot.contractRanges && boot.contractRanges[hotel];
      var now = new Date(), y = parseInt(opts.nowYear, 10) || now.getFullYear(), m = parseInt(opts.nowMonth, 10) || (now.getMonth() + 1);
      if (m < 1 || m > 12) { y = now.getFullYear(); m = now.getMonth() + 1; }
      if (r && !((y > r.minYear || (y === r.minYear && m >= r.minMonth)) && (y < r.maxYear || (y === r.maxYear && m <= r.maxMonth)))) { y = r.minYear; m = r.minMonth; }
      out.availability = [{ hotel: hotel, year: y, month: m, data: getAvailabilityData(hotel, y, m, username) }];
    }
  } else if (home === "Bookings_Screen") out.bookingsAll = getBookingsAll(username);
  else if (home === "Dashboard_Screen") out.dashboard = getDashboardData(username);
  else if (home === "Contracts_Screen") out.contracts = getContracts(username);
  return out;
}

function getAppBootstrap(username, fullName, opts) { _apiGuard_();
  var _fn="[getAppBootstrap]"; _logInfo_(_fn, "START | "+"username:"+String(JSON.stringify(username)||"").slice(0, 80)+", "+"fullName:"+String(JSON.stringify(fullName)||"").slice(0, 80));
  try {
  opts = opts || {};
  var props = PropertiesService.getScriptProperties();
  var brandingVer = _getBrandingVersion_();
  var branding;
  if (opts.brandingVer && String(opts.brandingVer) === brandingVer) branding = { unchanged: true };
  else branding = getCompanyBranding();
  var out = {
    systemVersion: APP_VERSION,
    userMap: getUsernameFullNameMap(),
    branding: branding,
    brandingVer: brandingVer,
    sessionTimeoutMinutes: getSessionTimeoutMinutes(),
    notifVersion: props.getProperty(_NOTIF_VERSION_PROP) || "0",
    availVersion: props.getProperty(_AVAIL_VERSION_PROP) || "0"
  };
  // V3.58 — opts.lite: الإشعارات والمتصلون يأتون من نداء دوري متوازٍ (pollAppState) فلا تنتظرهما الشاشة الرئيسية
  if (!opts.lite) { out.notifications = getMyNotifications(username); out.activeUsers = pingHeartbeatAndGetActiveUsers(username, fullName); }
  // الإضافات اختيارية: فشل أي منها لا يُفشل الإقلاع (المتصفح يطلبها منفصلة عند غيابها)
  _lap_("boot:usersBrandingProps");
  try { out.prefs = _getUserPrefsMap_(username); } catch(e1) {}
  _lap_("boot:prefs");
  try { out.hotelNames = getDistinctHotelNames(username); } catch(e2) {}
  try { out.contractRanges = _getContractDateRangesMap_(username); } catch(e3) {}
  _lap_("boot:hotelsRanges");
  try { out.collectionAccounts = _getCollectionAccountsCached_(); } catch(e4) {}
  try { out.contractMonths = getContractMonthsByHotel(username); } catch(e5) {}
  _lap_("boot:collMonths");
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}
// نسخة هوية الشركة: تتغيّر مع كل حفظ؛ للنسخ القديمة بلا رقم نشتقها من أطوال القيم (تتغير عملياً مع أي تعديل)
function _getBrandingVersion_() {
  var props = PropertiesService.getScriptProperties();
  var v = props.getProperty("COMPANY_BRANDING_VER");
  if (v) return v;
  // V3.70 — تُحسب مرة واحدة ثم تُحفظ: كانت كل إقلاع تقرأ خاصية الشعار كاملة (~100KB) لمجرد حساب طولها
  v = "L" + (props.getProperty("COMPANY_LOGO_URI") || "").length + "-" + (props.getProperty("COMPANY_NAME_AR") || "").length + "-" + (props.getProperty("COMPANY_NAME_EN") || "").length;
  try { props.setProperty("COMPANY_BRANDING_VER", v); } catch (e) {}
  return v;
}

// تُجمّع بيانات فتح نموذج الحجز (تعاقدات نشطة + جهات تحصيل + أسماء عملاء + بيانات الحجز عند التعديل) — كانت 3-4 نداءات
// تعتمد على CacheService للبيانات شبه الثابتة (تسريع فتح النموذج من ~1-2 ثانية إلى فوري تقريباً بعد أول فتح)
function getBookingModalBootstrap(currentUser, editId) { _apiGuard_();
  var _fn="[getBookingModalBootstrap]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80)+", "+"editId:"+String(JSON.stringify(editId)||"").slice(0, 80));
  try {
  var out = {
    contracts: getActiveContractsForDropdown(currentUser),
    accounts: _getCollectionAccountsCached_(),
    clientNames: _getDistinctClientNamesCached_(),
    booking: editId ? getBookingForEdit(editId) : null
  };
  if (editId) out.nusuk = _nusukForBookingIfAllowed_(editId, currentUser); // V3.76 — كانت نداءً ثانياً من النموذج (~2.6 ث)
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// تُجمّع بيانات فتح نموذج التعاقد (أسماء الفنادق + بيانات التعاقد عند التعديل) — كانت نداءين
function getContractModalBootstrap(currentUser, editId) { _apiGuard_();
  var _fn="[getContractModalBootstrap]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80)+", "+"editId:"+String(JSON.stringify(editId)||"").slice(0, 80));
  try {
  return {
    hotelNames: getDistinctHotelNames(currentUser), // لا يُخزَّن هنا لأنه مُصفّى حسب المستخدم
    contract: editId ? getContractForEdit(editId) : null
  };
  } catch(e) { _logError_(_fn, e); throw e; }
}


/**
 * ======================================================================
 * التهيئة الشاملة الموحّدة للنظام (تُشغَّل من شاشة الصلاحيات — Admin فقط)
 * ======================================================================
 * سجل SETUP_STEPS هو "المصدر الوحيد" لكل خطوات الإعداد اليدوية في النظام.
 * عند استحداث أي دالة إعداد يدوية جديدة مستقبلاً: أضِفها هنا كخطوة جديدة فقط،
 * وستُنفَّذ تلقائياً ضمن التهيئة الشاملة دون تعديل أي كود آخر.
 */
var SETUP_STEPS = [
  {
    id: "sheets",
    label: "تهيئة قاعدة البيانات (الشيتات والأعمدة والمستخدم الافتراضي)",
    run: function() { return initializeSystem().message; }
  },
  {
    id: "drive_root",
    label: "مجلد Drive الرئيسي الموحّد (باسم ملف الشيت، ويُعاد تسميته تلقائياً عند تغييره)",
    run: function() { return "المجلد الرئيسي: " + _ensureAppRootFolder_().getName(); }
  },
  {
    id: "temp_reports",
    label: "مجلد التقارير المؤقتة (داخل المجلد الرئيسي)",
    run: function() { return "مجلد التقارير: " + _ensureTempReportsFolder_().getName(); }
  },
  {
    id: "triggers",
    label: "المشغّلات الزمنية اليومية (الدفعات المستحقة / قائمة الانتظار / تذكيرات تليجرام / تواريخ الأوبشن)",
    run: function() { return _ensureDailyTriggers_(); }
  },
  {
    id: "perf_trigger",
    label: "مشغّل تفريغ إحصاءات أداء الخادم كل 10 دقائق",
    run: function() { return _ensurePerfFlushTrigger_(); }
  },
  {
    id: "roles",
    label: "الأدوار الافتراضية (تأكيد وجودها في إعدادات النظام)",
    run: function() {
      var props = PropertiesService.getScriptProperties();
      if (!props.getProperty("SYSTEM_ROLES")) props.setProperty("SYSTEM_ROLES", JSON.stringify({}));
      return Object.keys(getRoles()).length + " دور متاح";
    }
  },
  {
    id: "session_timeout",
    label: "مدة الجلسة الافتراضية (15 دقيقة إن لم تكن محددة)",
    run: function() {
      var props = PropertiesService.getScriptProperties();
      if (!props.getProperty("SESSION_TIMEOUT_MINUTES")) props.setProperty("SESSION_TIMEOUT_MINUTES", "15");
      return "مدة الجلسة: " + getSessionTimeoutMinutes() + " دقيقة";
    }
  },
  {
    id: "clear_cache",
    label: "تصفير الكاش المرجعي (البيانات شبه الثابتة تُقرأ من جديد عند أول طلب)",
    run: function() { _invalidateReferenceCache_(); return "تم التصفير"; }
  }
];

// تشغيل كل خطوات الإعداد دفعة واحدة — آمنة للتكرار (Idempotent): تشغيلها أكثر من مرة لا يكرر شيئاً ولا يفقد بيانات
// v3.5 — أداة إصلاح بيانات: تحوّل كل الأرقام العربية/الفارسية المخزَّنة في الأعمدة العددية إلى أرقام Latin
// تُشغَّل من شاشة الإعدادات (Admin فقط) لتصحيح السجلات القديمة كحجز D025 الذي كتب عدد الغرف بالعربي
// آمنة تماماً: تعالج فقط الخلايا النصية التي تحتوي أرقاماً عربية، وتترك أي شيء آخر بلا مساس
function repairArabicDigitsInSheets(currentUser) { _apiGuard_();
  var _fn="[repairArabicDigitsInSheets]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
    if (!_isAdmin_(currentUser)) throw new Error("غير مصرح. هذه الأداة لمدير النظام فقط.");
    var ARABIC_RE = /[٠-٩۰-۹]/;
    // (شيت → مصفوفة أعمدة رقمية 1-indexed تحتاج تحويل)
    var TARGETS = {
      "Bookings_Master":  [6, 9, 10, 11],                // Room_Count, Nights, Sale_Price, Booking_Value
      "Contracts_Master": [6, 7, 8, 9, 18],              // Nights, Room_Count, Room_Price, Total_Value, Nusuk_Capacity
      "Waitlist_Master":  [7, 8],                        // Room_Count, Sale_Price
      "Contract_Payments":[3, 5],                        // Amount, Paid_Amount
      "Contract_Payment_Receipts": [4],                  // Amount
      "Account_Payments": [5],                           // Amount
      "Nusuk_Agreements": [5, 8]                         // Persons_Count, Nights
    };
    var totalFixed = 0, sheetsFixed = 0, details = [];
    Object.keys(TARGETS).forEach(function(sheetName) {
      var sheet;
      try { sheet = _getOrCreateSheet_(sheetName); } catch(err) { return; }
      var range = sheet.getDataRange();
      var vals = range.getValues();
      if (vals.length <= 1) return;
      var cols = TARGETS[sheetName];
      var fixedInSheet = 0;
      for (var r = 1; r < vals.length; r++) {
        cols.forEach(function(c) {
          var cell = vals[r][c-1];
          if (typeof cell === "string" && ARABIC_RE.test(cell)) {
            var n = _toNumber_(cell);
            vals[r][c-1] = n;
            fixedInSheet++;
          }
        });
      }
      if (fixedInSheet > 0) {
        range.setValues(vals);
        _invalidateSheetCache_(sheetName);
        totalFixed += fixedInSheet;
        sheetsFixed++;
        details.push(sheetName + ": " + fixedInSheet + " خلية");
      }
    });
    _bumpAvailabilityVersion_(); // تحديث شارت التوافر لعرض الأرقام المُصلَحة فوراً
    logAudit("الإعدادات","إصلاح بيانات","N/A","","","","إصلاح أرقام عربية مخزَّنة في الشيتات: "+totalFixed+" خلية عبر "+sheetsFixed+" شيت — "+details.join("، "), currentUser);
    return { success: true, cellsFixed: totalFixed, sheetsAffected: sheetsFixed, details: details };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ===== أداة إدارية خطيرة: حذف فندق/فنادق نهائياً وكل بياناتهم المرتبطة من كل الشيتات =====
// قبل الحذف الفعلي، تُنسخ كل الصفوف المتأثرة احتياطياً إلى شيتات جديدة باسم "ZZ_Backup_<الشيت>_<الوقت>"
// بنفس رؤوس الأعمدة الأصلية — فهذه نسخة احتياطية يدوية يمكن الرجوع لمحتواها عند الحاجة، لكن الحذف من
// الشيتات الحيّة نفسها نهائي ولا تراجع عنه تلقائياً من داخل النظام. مدير النظام فقط يملك صلاحية التنفيذ.
function purgeHotelsCompletely(hotelNames, currentUser) { _apiGuard_();
  var _fn="[purgeHotelsCompletely]"; _logInfo_(_fn, "START | hotelNames:"+JSON.stringify(hotelNames)+", currentUser:"+String(JSON.stringify(currentUser)||"").slice(0,80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح. حذف فندق بالكامل متاح لمدير النظام فقط.");
  var targets = (hotelNames||[]).map(function(h){ return String(h||"").trim(); }).filter(Boolean);
  if (!targets.length) throw new Error("لم يتم تحديد اسم فندق صالح للحذف.");
  return _withLock_(function() {
    var ss = _getSS_();
    var ts = _fmtDate_(new Date(), _tz_(), "yyyyMMdd_HHmmss");
    var counts = {}, backupSheets = [];

    function isTargetHotel(name) { return targets.indexOf(String(name||"").trim()) !== -1; }

    // ينسخ كل الصفوف المطابقة لشيت احتياطي جديد، ثم يحذفها فعلياً من الشيت الأصلي (تنازلياً لتفادي انزياح الأرقام)
    function backupAndDelete(sheetName, matchFn) {
      var sheet = _getOrCreateSheet_(sheetName);
      var data = sheet.getDataRange().getValues();
      counts[sheetName] = 0;
      if (data.length <= 1) return;
      var headers = data[0];
      var matchedRows = [], matchedRowNums = [];
      for (var i = 1; i < data.length; i++) {
        if (matchFn(data[i])) { matchedRows.push(data[i]); matchedRowNums.push(i+1); }
      }
      counts[sheetName] = matchedRows.length;
      if (!matchedRows.length) return;
      var backupName = "ZZ_Backup_" + sheetName + "_" + ts;
      var bsheet = ss.insertSheet(backupName);
      bsheet.getRange(1,1,1,headers.length).setValues([headers]);
      bsheet.getRange(2,1,matchedRows.length,headers.length).setValues(matchedRows);
      backupSheets.push(backupName);
      for (var k = matchedRowNums.length-1; k >= 0; k--) sheet.deleteRow(matchedRowNums[k]);
      _invalidateSheetCache_(sheetName);
    }

    // 1) التعاقدات المملوكة لهذه الفنادق مباشرةً
    var contractIds = {};
    backupAndDelete("Contracts_Master", function(row) {
      if (!isTargetHotel(row[1])) return false;
      contractIds[String(row[0])] = true; return true;
    });

    // 2) الحجوزات المرتبطة بهذه التعاقدات
    var bookingIds = {};
    backupAndDelete("Bookings_Master", function(row) {
      if (!contractIds[String(row[1])]) return false;
      bookingIds[String(row[0])] = true; return true;
    });

    // 3) قائمة الانتظار المرتبطة بهذه التعاقدات
    backupAndDelete("Waitlist_Master", function(row) { return !!contractIds[String(row[1])]; });

    // 4) اتفاقيات نسك — مطابقة باسم الفندق مباشرة أو برقم حجز تابع لهذه الفنادق
    backupAndDelete("Nusuk_Agreements", function(row) {
      return isTargetHotel(row[1]) || !!bookingIds[String(row[2])];
    });

    // 5) أقساط سداد التعاقدات
    backupAndDelete("Contract_Payments", function(row) { return !!contractIds[String(row[1])]; });

    // 6) سندات السداد الفعلي لهذه التعاقدات (جانب الفندق) — نجمع أيضاً أي Linked_Account_Payment_ID
    //    لحذف دفعة العميل المقابلة لها في Account_Payments (دفعة مزدوجة مرتبطة)
    var linkedAccountPaymentIds = {};
    backupAndDelete("Contract_Payment_Receipts", function(row) {
      if (!contractIds[String(row[2])]) return false;
      if (row[10]) linkedAccountPaymentIds[String(row[10])] = true;
      return true;
    });

    // 7) دفعات الحسابات (عملاء/جهات تحصيل) المخصَّصة لهذه الفنادق مباشرة، أو المرتبطة بسند سداد حُذف أعلاه
    backupAndDelete("Account_Payments", function(row) {
      return isTargetHotel(row[11]) || !!linkedAccountPaymentIds[String(row[0])];
    });

    // 8) التنبيهات المرتبطة بهذه الفنادق + سجلات قراءتها
    var notifIds = {};
    backupAndDelete("Notifications_Master", function(row) {
      if (!isTargetHotel(row[3])) return false;
      notifIds[String(row[0])] = true; return true;
    });
    backupAndDelete("Notification_Reads", function(row) { return !!notifIds[String(row[0])]; });
    if (counts["Notifications_Master"]) _bumpNotifVersion_();

    _invalidateReferenceCache_(); // خرائط الفندق/التعاقد/جهة التحصيل المخزَّنة مؤقتاً أصبحت قديمة
    _bumpAvailabilityVersion_();

    var summary = "تعاقدات:"+counts["Contracts_Master"]+"، حجوزات:"+counts["Bookings_Master"]
      +"، انتظار:"+counts["Waitlist_Master"]+"، نسك:"+counts["Nusuk_Agreements"]
      +"، أقساط:"+counts["Contract_Payments"]+"، سندات سداد:"+counts["Contract_Payment_Receipts"]
      +"، دفعات حسابات:"+counts["Account_Payments"]+"، تنبيهات:"+counts["Notifications_Master"];
    logAudit("الإعدادات","حذف فندق نهائياً","N/A","","","",
      "حذف نهائي لفندق/فنادق ["+targets.join("، ")+"]: "+summary+" — نسخ احتياطية: "+(backupSheets.join("، ")||"لا يوجد"), currentUser);

    return { success:true, targets: targets, counts: counts, backupSheets: backupSheets };
  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

function setupApplicationComplete(currentUser) { _apiGuard_();
  var _fn="[setupApplicationComplete]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (currentUser && !_isAdmin_(currentUser)) throw new Error("غير مصرح. التهيئة الشاملة متاحة لمدير النظام فقط.");
  var results = [];
  SETUP_STEPS.forEach(function(step) {
    try {
      var detail = step.run();
      results.push({ id: step.id, label: step.label, success: true, detail: detail || "تم" });
    } catch(e) {
      results.push({ id: step.id, label: step.label, success: false, detail: e.message });
    }
  });
  var failed = results.filter(function(r){ return !r.success; }).length;
  if (currentUser) {
    logAudit("النظام", "تهيئة شاملة", "", "", "", "",
      "تشغيل التهيئة الشاملة: " + (results.length - failed) + " خطوة ناجحة" + (failed ? "، " + failed + " فشلت" : ""), currentUser);
  }
  return { success: failed === 0, steps: results };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// دوال Wrapper للمشغّلات الزمنية: التريجر يمرّر "كائن الحدث" كأول باراميتر،
// وهذه الأغلفة تمنع وصوله للدوال الأصلية (كان سيفسد force/currentUser)
// V3.63 — نقاط دخول موثوقة للمشغّلات. تبقى قابلة للنداء بالاسم (المشغّلات تتطلب ذلك) فتعمل بلا "إجبار":
// تخضع لكابح 3 ساعات (_bgCheckShouldRun_)، فلا يمكن استخدامها لإغراق الإشعارات؛ المشغّل اليومي يمرّ من الكابح دائماً.
function trigger_checkDuePayments() { _trusted_(function() { checkDuePaymentsAndNotify("النظام (مشغّل يومي)", false); }); }
function trigger_checkWaitlist() { _trusted_(function() { checkWaitlistAvailabilityAndNotify(false); }); }
function trigger_telegramReminders() { _trusted_(function() { sendTelegramCheckinReminders(false); }); }
function trigger_checkOptionDates() { _trusted_(function() { checkConfirmationOptionDatesAndNotify(false); }); }

// V3.55 — الفحوصات الخلفية تعمل يومياً بالمشغّلات الزمنية، وكانت تُشغَّل أيضاً من متصفح كل مستخدم عند أول دخول يومياً
// (4 نداءات ثقيلة تتزاحم مع الإقلاع × عدد المستخدمين). الآن تشغيل المتصفح يُنفَّذ فعلياً مرة كل 3 ساعات على الأكثر
// لكل النظام (يبقى التقاط التغييرات بين المشغّلات اليومية)، والمشغّلات الزمنية تعمل دائماً.
var _BGCHECK_MIN_HOURS = 3;
function _bgCheckShouldRun_(key, force) {
  if (force === true) { try { PropertiesService.getScriptProperties().setProperty("BGCHECK_LAST_" + key, String(Date.now())); } catch (e) {} return true; }
  try {
    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty("BGCHECK_LAST_" + key) || 0);
    if (Date.now() - last < _BGCHECK_MIN_HOURS * 3600000) return false;
    props.setProperty("BGCHECK_LAST_" + key, String(Date.now()));
  } catch (e) {}
  return true;
}

// يُثبّت المشغّلات الزمنية اليومية مرة واحدة فقط (يحذف المكرر ويضيف الناقص)
function _ensureDailyTriggers_() {
  var wanted = {
    "trigger_checkDuePayments": 8,    // 8 صباحاً: فحص الدفعات المستحقة
    "trigger_checkWaitlist": 7,       // 7 صباحاً: فحص توافر قائمة الانتظار
    "trigger_telegramReminders": 9,   // 9 صباحاً: تذكيرات تليجرام بالوصول
    "trigger_checkOptionDates": 8     // 8 صباحاً: فحص تواريخ الأوبشن
  };
  var legacy = ["checkDuePaymentsAndNotify","checkWaitlistAvailabilityAndNotify","sendTelegramCheckinReminders","checkConfirmationOptionDatesAndNotify"];
  var existing = {};
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (legacy.indexOf(fn) >= 0) { ScriptApp.deleteTrigger(t); return; } // حذف مشغّلات قديمة أُنشئت يدوياً بالأسماء المباشرة
    if (wanted.hasOwnProperty(fn)) {
      if (existing[fn]) ScriptApp.deleteTrigger(t); // حذف المكرر
      else existing[fn] = true;
    }
  });
  var added = 0;
  Object.keys(wanted).forEach(function(fn) {
    if (!existing[fn]) {
      ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(wanted[fn]).create();
      added++;
    }
  });
  return added ? ("تمت إضافة " + added + " مشغّل جديد") : "كل المشغّلات مثبتة مسبقاً";
}

/**
 * ======================================================================
 * مجلد Drive الرئيسي الموحّد
 * ======================================================================
 * كل ملفات النظام على Drive تعيش داخل مجلد واحد يحمل نفس اسم ملف الشيت.
 * عند تغيير اسم ملف الشيت: يُعاد تسمية المجلد تلقائياً في أول استخدام تالٍ.
 */
function _ensureAppRootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var ssName = _getSS_().getName();
  var folderId = props.getProperty("APP_ROOT_FOLDER_ID");
  var folder = null;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch(e) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.getRootFolder().createFolder(ssName);
    props.setProperty("APP_ROOT_FOLDER_ID", folder.getId());
  }
  // مزامنة الاسم مع اسم ملف الشيت (تغيير اسم الشركة/الشيت ← يتغير اسم المجلد تلقائياً)
  if (folder.getName() !== ssName) folder.setName(ssName);
  return folder;
}


/**
 * ======================================================================
 * سجل مجلدات النظام (مصدر واحد)
 * ======================================================================
 * أي مجلد جديد يستخدمه النظام مستقبلاً يُضاف هنا كسطر واحد فقط.
 * الواجهة (شاشة الإعدادات → مجلدات النظام) تقرأ من هذا السجل تلقائياً.
 */
var SYSTEM_FOLDERS = [
  {
    key: "root",
    label: "المجلد الرئيسي (باسم ملف الشيت)",
    description: "المجلد الأب لكل ملفات النظام على Drive. يُعاد تسميته تلقائياً عند تغيير اسم الشيت.",
    propKey: "APP_ROOT_FOLDER_ID",
    ensureFn: function() { return _ensureAppRootFolder_(); }
  },
  {
    key: "temp_reports",
    label: "مجلد التقارير المؤقتة",
    description: "يحتوي على ملفات PDF المؤقتة المُنشأة عند مشاركة/طباعة التقارير. تُحذف الملفات الأقدم من ساعة تلقائياً.",
    propKey: "TEMP_REPORTS_FOLDER_ID",
    ensureFn: function() { return _ensureTempReportsFolder_(); }
  },
  {
    key: "receipts",
    label: "مجلد إيصالات السداد",
    description: "صور وملفات PDF لإيصالات الدفعات المرفقة من شاشة الحسابات. الملفات خاصة (بلا رابط عام) وتُعرض عبر البرنامج فقط.",
    propKey: "RECEIPTS_FOLDER_ID",
    ensureFn: function() { return _ensureReceiptsFolder_(); }
  }
];

// يُرجع قائمة كل مجلدات النظام مع حالتها الحالية (للعرض في شاشة الإعدادات)
function getSystemFolders(currentUser) { _apiGuard_();
  var _fn="[getSystemFolders]"; _logInfo_(_fn, "START | "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (currentUser && !_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var props = PropertiesService.getScriptProperties();
  return SYSTEM_FOLDERS.map(function(f) {
    var id = props.getProperty(f.propKey);
    var exists = false, name = "", url = "";
    if (id) {
      try {
        var folder = DriveApp.getFolderById(id);
        name = folder.getName(); url = folder.getUrl(); exists = true;
      } catch(e) { exists = false; }
    }
    return { key:f.key, label:f.label, description:f.description, id:id||"", name:name, url:url, exists:exists };
  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُغيّر اسم مجلد نظام معيّن على Drive (Admin فقط)
function renameSystemFolder(key, newName, currentUser) { _apiGuard_();
  var _fn="[renameSystemFolder]"; _logInfo_(_fn, "START | "+"key:"+String(JSON.stringify(key)||"").slice(0, 80)+", "+"newName:"+String(JSON.stringify(newName)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  newName = String(newName||"").trim();
  if (!newName) throw new Error("اسم المجلد لا يمكن أن يكون فارغاً.");
  var def = null;
  SYSTEM_FOLDERS.forEach(function(f){ if (f.key === key) def = f; });
  if (!def) throw new Error("المجلد غير معروف: "+key);
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(def.propKey);
  if (!id) throw new Error("لم يُنشأ المجلد بعد. شغّل التهيئة الشاملة أولاً.");
  var folder;
  try { folder = DriveApp.getFolderById(id); }
  catch(e) { throw new Error("تعذّر الوصول للمجلد على Drive: "+e.message); }
  var oldName = folder.getName();
  folder.setName(newName);
  // ملاحظة للمجلد الرئيسي: اسمه يُعاد مزامنته مع اسم ملف الشيت في كل استدعاء لاحق لـ _ensureAppRootFolder_
  // لذلك إن أراد المستخدم اسماً مخالفاً لاسم الشيت، عليه تغيير اسم الشيت نفسه لضمان استمرار التسمية الجديدة
  logAudit("النظام","تغيير اسم مجلد",key,"",oldName,newName,"تغيير اسم مجلد '"+def.label+"' من '"+oldName+"' إلى '"+newName+"'",currentUser);
  return { success:true, oldName:oldName, newName:newName };
  } catch(e) { _logError_(_fn, e); throw e; }
}


/**
 * ======================================================================
 * سجل المشغّلات التلقائية (Triggers) — مصدر واحد
 * ======================================================================
 * أي مشغّل يومي جديد مستقبلاً يُضاف هنا كسطر واحد فقط.
 * شاشة الإعدادات → المشغّلات التلقائية تعرضها كلها وتُتيح تفعيل/تعطيل/تشغيل يدوي.
 */
var SYSTEM_TRIGGERS = [
  {
    key: "duePayments",
    handler: "trigger_checkDuePayments",
    hour: 8,
    label: "فحص الدفعات المستحقة",
    description: "ينشئ تنبيهات بالدفعات المتأخرة أو التي تستحق خلال أسبوع.",
    runFn: function() { checkDuePaymentsAndNotify("النظام (تشغيل يدوي)", true); return "تم فحص الدفعات المستحقة."; }
  },
  {
    key: "waitlist",
    handler: "trigger_checkWaitlist",
    hour: 7,
    label: "فحص توافر قائمة الانتظار",
    description: "يفحص طلبات الانتظار وينشئ تنبيهات عند توفر الغرف المطلوبة.",
    runFn: function() { checkWaitlistAvailabilityAndNotify(true); return "تم فحص قائمة الانتظار."; }
  },
  {
    key: "telegram",
    handler: "trigger_telegramReminders",
    hour: 9,
    label: "تذكيرات تليجرام بالوصول",
    description: "يرسل قائمة الحجوزات التي ستصل غداً على قناة تليجرام المحددة.",
    runFn: function() { var r = sendTelegramCheckinReminders(true); return "تم إرسال التذكيرات: "+(r.count||0)+" حجز."; }
  },
  {
    key: "optionDates",
    handler: "trigger_checkOptionDates",
    hour: 8,
    label: "فحص تواريخ الأوبشن",
    description: "ينشئ تنبيهات بتواريخ سداد التأكيدات (Client Option Dates) القريبة أو المتأخرة.",
    runFn: function() { checkConfirmationOptionDatesAndNotify(true); return "تم فحص تواريخ الأوبشن."; }
  }
];

function _findTriggerDef_(key) {
  for (var i=0; i<SYSTEM_TRIGGERS.length; i++) if (SYSTEM_TRIGGERS[i].key === key) return SYSTEM_TRIGGERS[i];
  return null;
}

// يُرجع كل المشغّلات المسجّلة مع حالتها الفعلية على Apps Script (للعرض في شاشة الإعدادات)
function getSystemTriggers(currentUser) { _apiGuard_();
  var _fn="[getSystemTriggers]";
  try {
  _logInfo_(_fn, "START");
  // تحصين إضافي: إن جاء currentUser فارغاً/غير معرَّف، نُوقف بخطأ واضح بدل خطأ سلاسل غامض
  if (!currentUser) throw new Error("جلسة المستخدم غير صالحة. يرجى تسجيل الخروج ثم الدخول من جديد.");
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح — هذه الميزة للمدير فقط.");
  var installed = {};
  ScriptApp.getProjectTriggers().forEach(function(t) { installed[t.getHandlerFunction()] = true; });
  return (SYSTEM_TRIGGERS || []).map(function(t) {
    return { key:t.key, handler:t.handler, hour:t.hour, label:t.label, description:t.description, active: !!installed[t.handler] };
  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُفعّل مشغّلاً معيّناً (إن كان معطّلاً) - Admin فقط
function enableSystemTrigger(key, currentUser) { _apiGuard_();
  var _fn="[enableSystemTrigger]"; _logInfo_(_fn, "START | "+"key:"+String(JSON.stringify(key)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var def = _findTriggerDef_(key); if (!def) throw new Error("مشغّل غير معروف: "+key);
  // تنظيف أي نسخة مكررة أولاً
  ScriptApp.getProjectTriggers().forEach(function(t) { if (t.getHandlerFunction() === def.handler) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(def.handler).timeBased().everyDays(1).atHour(def.hour).create();
  logAudit("النظام","تفعيل مشغّل",key,"","","","تم تفعيل المشغّل: "+def.label,currentUser);
  return { success:true };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعطّل مشغّلاً معيّناً - Admin فقط
function disableSystemTrigger(key, currentUser) { _apiGuard_();
  var _fn="[disableSystemTrigger]"; _logInfo_(_fn, "START | "+"key:"+String(JSON.stringify(key)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var def = _findTriggerDef_(key); if (!def) throw new Error("مشغّل غير معروف: "+key);
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) { if (t.getHandlerFunction() === def.handler) { ScriptApp.deleteTrigger(t); removed++; } });
  logAudit("النظام","تعطيل مشغّل",key,"","","","تم تعطيل المشغّل: "+def.label+" ("+removed+" نسخة)",currentUser);
  return { success:true, removed:removed };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُشغّل مشغّلاً معيّناً يدوياً الآن (للاختبار الفوري) - Admin فقط
function runSystemTriggerNow(key, currentUser) { _apiGuard_();
  var _fn="[runSystemTriggerNow]"; _logInfo_(_fn, "START | "+"key:"+String(JSON.stringify(key)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح.");
  var def = _findTriggerDef_(key); if (!def) throw new Error("مشغّل غير معروف: "+key);
  try {
    var msg = def.runFn();
    logAudit("النظام","تشغيل يدوي لمشغّل",key,"","","",msg||"تم","currentUser");
    return { success:true, message: msg || "تم التشغيل بنجاح." };
  } catch(e) {
    return { success:false, message: "فشل التشغيل: "+(e.message||e) };
  }
  } catch(e) { _logError_(_fn, e); throw e; }
}


/**
 * ======================================================================
 * CacheService — كاش عابر للتنفيذات للبيانات المرجعية شبه الثابتة
 * ======================================================================
 * يخزن نتائج القراءات "شبه الثابتة" (أسماء الفنادق، جهات التحصيل، أسماء العملاء…)
 * لمدة قصيرة عبر أكثر من نداء (على عكس _getSheetValues_ الذي يعيش تنفيذاً واحداً فقط).
 * أي دالة كتابة تغيّر هذه البيانات تستدعي _invalidateReferenceCache_ فوراً.
 */
var _REFERENCE_CACHE_TTL_SEC = 900; // 15 دقيقة
var _REF_CACHE_KEY_HOTELS = "REF_HOTEL_NAMES_ALL";
var _REF_CACHE_KEY_ACCOUNTS = "REF_COLLECTION_ACCOUNTS";
var _REF_CACHE_KEY_CLIENTS = "REF_CLIENT_NAMES";
var _REF_CACHE_KEY_ACTIVE_CONTRACTS = "REF_ACTIVE_CONTRACTS_ALL";
// v3.37 — خرائط صغيرة شبه ثابتة (contractId→hotelName، accountId→name، contractId→تسمية كاملة) كانت تُعاد
// قراءتها وبناؤها بالكامل من الشيت في كل نداء خادم منفصل (كل شاشة/فلتر/تنقّل صفحات) رغم ندرة تغيّرها فعلياً —
// أبرز سبب للبطء العام بالبرنامج. أصبحت الآن مخزَّنة بنفس آلية الكاش المرجعي أعلاه
var _REF_CACHE_KEY_CONTRACT_HOTEL_MAP = "REF_CONTRACT_HOTEL_MAP";
var _REF_CACHE_KEY_COLLECTION_MAP = "REF_COLLECTION_ACCOUNT_MAP";
var _REF_CACHE_KEY_CONTRACT_LABEL_MAP = "REF_CONTRACT_LABEL_MAP";

function _getFromCache_(key) {
  try {
    try { _incrementDailyQuota_("CACHEOP"); } catch(e0) {}
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}
function _putInCache_(key, obj) {
  try {
    try { _incrementDailyQuota_("CACHEOP"); } catch(e0) {}
    CacheService.getScriptCache().put(key, JSON.stringify(obj), _REFERENCE_CACHE_TTL_SEC);
  } catch(e) {}
}
// إبطال الكاش المرجعي عند كل عملية كتابة تؤثر على هذه البيانات
function _invalidateReferenceCache_(which) {
  var keys = which ? [which] : [_REF_CACHE_KEY_HOTELS, _REF_CACHE_KEY_ACCOUNTS, _REF_CACHE_KEY_CLIENTS, _REF_CACHE_KEY_ACTIVE_CONTRACTS,
    _REF_CACHE_KEY_CONTRACT_HOTEL_MAP, _REF_CACHE_KEY_COLLECTION_MAP, _REF_CACHE_KEY_CONTRACT_LABEL_MAP];
  try { CacheService.getScriptCache().removeAll(keys); } catch(e) {}
  __REF_MAP_MEMO = {}; // إبطال النسخة المحفوظة ضمن نفس التنفيذ أيضاً (احتياطاً)
}
// نسخة محفوظة داخل نفس التنفيذ فقط لخرائط Contracts_Master/Collection_Accounts الصغيرة (تتفادى تكرار نداء
// CacheService.get نفسه أكثر من مرة إن استُدعيت دالة البناء عدة مرات ضمن نفس الطلب الواحد)
var __REF_MAP_MEMO = {};

// V3.57 — يملأ الخرائط المرجعية الثلاث من الكاش بنداء getAll واحد (المفقود منها يُبنى لاحقاً كالمعتاد)
function _prefetchRefMaps_() {
  try {
    var want = [];
    if (!__REF_MAP_MEMO.contractHotel) want.push([_REF_CACHE_KEY_CONTRACT_HOTEL_MAP, "contractHotel"]);
    if (!__REF_MAP_MEMO.collectionAccount) want.push([_REF_CACHE_KEY_COLLECTION_MAP, "collectionAccount"]);
    if (!__REF_MAP_MEMO.contractLabel) want.push([_REF_CACHE_KEY_CONTRACT_LABEL_MAP, "contractLabel"]);
    if (!want.length) return;
    var got = CacheService.getScriptCache().getAll(want.map(function(w) { return w[0]; })) || {};
    _incrementDailyQuota_("CACHEOP");
    want.forEach(function(w) { if (got[w[0]]) { try { __REF_MAP_MEMO[w[1]] = JSON.parse(got[w[0]]); } catch (e) {} } });
  } catch (e) {}
}

// نسخ مُغلَّفة بالكاش من الدوال المرجعية شبه الثابتة (تُستخدم داخل النقاط المجمّعة)
function _getDistinctHotelNamesCached_(currentUser) {
  var cached = _getFromCache_(_REF_CACHE_KEY_HOTELS);
  if (cached && !currentUser) return cached; // الكاش للقائمة الكاملة فقط
  var full = getDistinctHotelNames(currentUser);
  if (!currentUser) _putInCache_(_REF_CACHE_KEY_HOTELS, full);
  return full;
}
function _getCollectionAccountsCached_() {
  var cached = _getFromCache_(_REF_CACHE_KEY_ACCOUNTS);
  if (cached) return _collMarkUsed_(cached, true);
  var full = _collectionAccountsRaw_(); // الكاش بلا علامة used (تتغيّر مع كل حجز) وبلا قراءة شيت الحجوزات
  _putInCache_(_REF_CACHE_KEY_ACCOUNTS, full);
  return _collMarkUsed_(full, true);
}
function _getDistinctClientNamesCached_() {
  var cached = _getFromCache_(_REF_CACHE_KEY_CLIENTS);
  if (cached) return cached;
  var full = getDistinctClientNames();
  _putInCache_(_REF_CACHE_KEY_CLIENTS, full);
  return full;
}


/**
 * ======================================================================
 * نظام نسخة بيانات التوافر (Availability Version) - للتحديث التلقائي بين المستخدمين
 * ======================================================================
 * كل عملية تؤثر على شارت التوافر (حجز/تعاقد) تُحدّث رقم النسخة هذا.
 * العملاء المفتوحون على شاشة التوافر يفحصون هذا الرقم دورياً، وأي تغيير
 * يُشغّل إعادة تحميل صامتة للشبكة دون تدخل من المستخدم.
 */
var _AVAIL_VERSION_PROP = "AVAIL_DATA_VERSION";

// يُستدعى داخلياً بعد أي حفظ حجز/تعاقد ناجح لتحديث رقم النسخة (طابع زمني بالمللي ثانية)
function _bumpAvailabilityVersion_(hotelName, startDate, endDate) {
  try {
    PropertiesService.getScriptProperties().setProperty(_AVAIL_VERSION_PROP, String(Date.now()));
  } catch(e) {}
  // إبطال كاش شارت التوافر لكل الشهور المتقاطعة مع فترة التعديل (إن مُرّرت)
  try { if (hotelName) _invalidateAvailCacheForRange_(hotelName, startDate, endDate); } catch(e) {}
}

// v3.52 — رقم نسخة للإشعارات: يتغيّر مع أي تغيير يؤثر على ما يظهر في الجرس (إشعار جديد، حذف،
// صلاحيات، تعطيل نوع)، فيعيد النداء الدوري القائمة الكاملة (~45 كيلوبايت) عند التغيير فقط بدل كل 15 ثانية.
// تعليم "مقروء" لا يغيّره عمداً: المتصفح الذي علّم يحدّث نفسه محلياً، وتغييره يجبر كل المستخدمين على إعادة الجلب.
var _NOTIF_VERSION_PROP = "NOTIF_DATA_VERSION";
function _bumpNotifVersion_() {
  try { PropertiesService.getScriptProperties().setProperty(_NOTIF_VERSION_PROP, String(Date.now())); } catch(e) {}
}

// v3.52 — نداء دوري موحَّد بدل ثلاثة (نبضة + نسخة التوافر + الإشعارات): كل نداء من المتصفح يكلّف ~2 ثانية
// ثابتة مهما صغر، فتقليل عدد النداءات هو المكسب الأكبر. wantNotifs: true=إجباري، false=تخطٍّ، غير ذلك=عند التغيير فقط
function pollAppState(username, fullName, knownNotifVersion, wantHeartbeat, wantNotifs) { _apiGuard_();
  var _fn="[pollAppState]";
  try {
    var props = PropertiesService.getScriptProperties();
    // رقم النسخة يُقرأ قبل جلب القائمة: إشعار يُنشأ بينهما يغيّر الرقم فيُجلب في النداء التالي ولا يضيع
    var nv = props.getProperty(_NOTIF_VERSION_PROP) || "0";
    var out = { availVersion: props.getProperty(_AVAIL_VERSION_PROP) || "0", notifVersion: nv, systemVersion: APP_VERSION }; // V3.70 — لتنبيه التبويبات المفتوحة بنسخة أقدم
    if (wantHeartbeat) out.activeUsers = pingHeartbeatAndGetActiveUsers(username, fullName);
    if (wantNotifs === true || (wantNotifs !== false && String(knownNotifVersion || "") !== nv)) out.notifications = getMyNotifications(username);
    return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يجلب رقم النسخة الحالي - يُستدعى من كل عميل دورياً للمقارنة
function getAvailabilityVersion() { _apiGuard_();
  var _fn="[getAvailabilityVersion]";
  try {
    return PropertiesService.getScriptProperties().getProperty(_AVAIL_VERSION_PROP) || "0";
  } catch(e) { _logError_(_fn, e); return "0"; }
}

/**
 * ======================================================================
 * قياس أداء الخادم + الواجهة معاً، واستهلاك حصص جوجل اليومية
 * ======================================================================
 * دالتا الخادم تُستدعيان تلقائياً حول كل دالة عامة عبر تحويل بنائي وقت النشر فقط
 * (انظر .github/scripts/instrument-functions.js) - لا تُستدعى _perfCall_ يدوياً من هنا.
 * الواجهة تقيس زمن كل نداء google.script.run من المتصفح نفسه (الرحلة كاملة ذهاباً
 * وإياباً شاملة الشبكة)، وتُجمِّعها وترسلها دفعة واحدة كل بضع دقائق عبر
 * flushClientPerfMetrics بدل نداء مستقل لكل عملية - فتُسجَّل بنفس آلية قياس الخادم
 * لكن باسم مسبوق بـ "client:" للتمييز، ومعها اسم المستخدم (الخادم وحده لا يعرفه).
 * التجميع يحدث كل 10 دقائق في CacheService فقط (بدون أي كتابة شيت لكل نداء عادي)،
 * ثم يُفرَّغ لشيتَي Perf/PerfSlow الدائمين عبر مشغّل زمني كل 10 دقائق.
 */
var _PERF_BUCKET_MIN = 10;      // حجم نافذة التجميع بالدقائق
var _PERF_AGG_TTL_SEC = 7200;   // ساعتان: المشغّلات الزمنية تتأخر أحياناً دقائق، فالتفريغ يعوّض النوافذ الفائتة قبل انتهاء صلاحيتها
var _PERF_CATCHUP_WINDOWS = 12; // أقصى عدد نوافذ يعوّضها التفريغ في التشغيل الواحد (= ساعتان)

// قراءة كاش خام بدون المرور بعدّاد CACHEOP - نظام القياس نفسه لا يجب أن يُضخِّم مؤشر استهلاكه هو ذاته
// (لو استخدم _getFromCache_ العادية هنا، كل نداء مُقاس سيُسجِّل أيضاً 2-3 عمليات Properties إضافية
// لعدّاد الكاش، فيُبطئ بالضبط ما يُفترض أن يقيسه بأقل أثر ممكن)
function _perfCacheGet_(key) {
  try { var raw = CacheService.getScriptCache().get(key); return raw ? JSON.parse(raw) : null; } catch(e) { return null; }
}

function _perfBucketKey_(d) {
  var tz = _tz_();
  var ymdH = _fmtDate_(d, tz, "yyyyMMddHH");
  var min = Number(_fmtDate_(d, tz, "mm"));
  var bucketMin = Math.floor(min/_PERF_BUCKET_MIN)*_PERF_BUCKET_MIN;
  return ymdH + (bucketMin<10?"0":"") + bucketMin;
}

// يُسجِّل عينة أداء واحدة في الكاش فقط (بدون أي كتابة شيت) - رخيص وآمن للمسار الحرج تماماً.
// user اختياري: يُمرَّر فقط من القياس المُرسَل من المتصفح (الذي يعرف المستخدم)، فارغ من قياس الخادم مباشرة
function _recordPerfSample_(name, ms, ok, user, ver) {
  // V3.57 — يُجمَّع في الذاكرة ويُكتب مع باقي قياسات التنفيذ في getAll + putAll واحدة (_perfFlushPending_).
  // كان كل قياس = 4-6 عمليات كاش منفصلة، وكان القياس نفسه (مع عدّادات الحصص) يكلّف ~ثانية من زمن كل نداء.
  try {
    name = String(name||"").slice(0,100);
    if (!name) return;
    ms = Math.max(0, Math.round(Number(ms)||0));
    // الإصدار يُثبَّت لحظة التسجيل (لا لحظة التفريغ): وإلا تُنسب قياسات الإصدار القديم للجديد بعد كل نشر
    _perfPending_().samples.push({ name: name, ms: ms, ok: ok !== false, user: String(user||""), ver: String(ver || APP_VERSION).slice(0, 20), t: new Date().toISOString() });
    _perfMaybeFlush_();
  } catch(e) {} // فشل القياس لا يجب أبداً أن يكسر شيئاً
}

// V3.57 — دفعة قياسات التنفيذ الحالي: {samples, logs, quota}. تُفرَّغ عند خروج النداء الخارجي (_perfCall_/doGet)
// أو فوراً إن لم يكن هناك نداء محيط (عمق 0 وبلا تعليق).
var __PERF_PENDING = null, __PERF_HOLD = 0;
function _perfPending_() { return __PERF_PENDING || (__PERF_PENDING = { samples: [], logs: [], quota: {} }); }
function _perfMaybeFlush_() { if (__PERF_HOLD === 0 && __PERF_DEPTH === 0) _perfFlushPending_(); }
function _perfFlushPending_() {
  var p = __PERF_PENDING; __PERF_PENDING = null;
  var res = { logged: 0 };
  if (!p || (!p.samples.length && !p.logs.length && !Object.keys(p.quota).length)) return res;
  try {
    var cache = CacheService.getScriptCache(), bucket = _perfBucketKey_(new Date());
    var parse = function(raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
    var aggKeys = [], aggBy = {}, tags = [];
    p.samples.forEach(function(sm) {
      var k = "PERF_AGG::" + sm.name + "::" + sm.ver + "::" + bucket;
      if (!aggBy[k]) { aggBy[k] = []; aggKeys.push(k); tags.push(sm.name + "@@" + sm.ver); }
      aggBy[k].push(sm);
    });
    var activeKey = "PERF_ACTIVE::" + bucket, slowKey = "PERF_SLOWBUF::" + bucket;
    var slows = p.samples.filter(function(sm) { return sm.ms > 3000; });
    var logKey = p.logs.length ? ("PERF_LOGBUF::" + bucket + "::" + Math.floor(Math.random() * _PERF_LOG_SHARDS)) : null;
    var qNames = Object.keys(p.quota);
    var quotaKey = qNames.length ? ("PERF_QUOTA::" + bucket + "::" + Math.floor(Math.random() * _PERF_LOG_SHARDS)) : null;
    var keys = aggKeys.slice();
    if (tags.length) keys.push(activeKey);
    if (slows.length) keys.push(slowKey);
    if (logKey) keys.push(logKey);
    if (quotaKey) keys.push(quotaKey);
    var got = cache.getAll(keys) || {}, put = {};
    aggKeys.forEach(function(k) {
      var agg = parse(got[k]) || { count:0, sum:0, max:0, fails:0 };
      aggBy[k].forEach(function(sm) { agg.count++; agg.sum += sm.ms; if (sm.ms > agg.max) agg.max = sm.ms; if (!sm.ok) agg.fails++; });
      put[k] = JSON.stringify(agg);
    });
    if (tags.length) {
      var active = parse(got[activeKey]) || [], changed = false;
      tags.forEach(function(t) { if (active.indexOf(t) === -1) { active.push(t); changed = true; } });
      if (changed) put[activeKey] = JSON.stringify(active);
    }
    if (slows.length) {
      var slow = parse(got[slowKey]) || [];
      slows.forEach(function(sm) { if (slow.length < 200) slow.push([sm.t, sm.name, sm.ms, sm.user, sm.ok, sm.ver]); });
      put[slowKey] = JSON.stringify(slow);
    }
    if (logKey) {
      var buf = parse(got[logKey]) || { items: [], dropped: 0 };
      p.logs.forEach(function(it) { if (buf.items.length < _PERF_LOG_SHARD_CAP) { buf.items.push(it); res.logged++; } else buf.dropped++; });
      var str = JSON.stringify(buf), guard = 0;
      while (str.length > 95000 && buf.items.length && guard++ < 400) { buf.items.pop(); buf.dropped++; res.logged--; str = JSON.stringify(buf); } // حد قيمة الكاش 100KB
      put[logKey] = str;
    }
    if (quotaKey) {
      var q = parse(got[quotaKey]) || {};
      qNames.forEach(function(n) { q[n] = (Number(q[n]) || 0) + p.quota[n]; });
      put[quotaKey] = JSON.stringify(q);
    }
    cache.putAll(put, _PERF_AGG_TTL_SEC);
  } catch (e) {}
  res.logged = Math.max(0, res.logged);
  return res;
}
// أسماء دوال مُشغَّلة فعلياً عبر Trigger (بعضها بادئتها "_" فلا يشملها التحويل البنائي تلقائياً،
// فأُضيفت هنا صراحةً) - تُستخدم فقط لتحديد ما يُحتسَب ضمن حصة "وقت تشغيل المشغّلات اليومية"
var _TRIGGER_HANDLER_NAMES_ = {
  trigger_checkDuePayments:1, trigger_checkWaitlist:1, trigger_telegramReminders:1,
  trigger_checkOptionDates:1, _flushTelegramQueue_:1, _flushPerfBuckets_:1
};

// غلاف موحّد لكل دالة خادم عامة: يقيس المدة والنجاح/الفشل دون أي تأثير على القيمة المُعادة
// أو الخطأ المرمي - يُستدعى تلقائياً فقط عبر التحويل البنائي وقت النشر، وليس يدوياً من الكود المصدري
function _perfCall_(name, args, fn) {
  var start = Date.now();
  var ok = true, errMsg = "";
  // سجل التنفيذ يُكتب للنداء الخارجي فقط: دالة عامة تنادي أخرى عامة = تنفيذ واحد لا اثنان
  var outer = (__PERF_DEPTH === 0);
  if (outer) { try { __EXEC_CONSOLE = []; } catch(e0) {} }
  __PERF_DEPTH++;
  try {
    return fn.apply(null, args);
  } catch(e) {
    ok = false;
    try { errMsg = String(e && e.message || e).slice(0, 300); } catch(e1) {}
    throw e; // يُعاد رمي الخطأ الأصلي تماماً كما هو - القياس لا يُغيّر سلوك الدالة الحقيقية إطلاقاً
  } finally {
    __PERF_DEPTH = Math.max(0, __PERF_DEPTH - 1);
    try {
      var dur = Date.now()-start;
      __PERF_HOLD++;
      try {
        _recordPerfSample_(name, dur, ok);
        if (_TRIGGER_HANDLER_NAMES_[name]) _incrementDailyQuota_("TRIGGERMS", dur);
        if (outer) _perfLogPush_({ t: new Date(start).toISOString(), src: _TRIGGER_HANDLER_NAMES_[name] ? "trigger" : "server",
          kind: "exec", name: name, ms: dur, ok: ok, err: errMsg, v: APP_VERSION, con: __EXEC_CONSOLE.slice(0, 30) });
      } finally { __PERF_HOLD--; }
      if (__PERF_DEPTH === 0) _perfFlushPending_(); // V3.57 — كل قياسات هذا التنفيذ في getAll + putAll واحدة
    } catch(e2) {}
  }
}

// تستقبل دفعة {fn,ms,ok} مجمَّعة من المتصفح - لا ترمي خطأ أبداً (قياس الأداء لا يجب أن يكسر شيئاً)
// v3.50 — extra (اختياري، متوافق مع المتصفحات القديمة): {network, console, resources, nav, v} لسجل التنفيذ
function flushClientPerfMetrics(entries, currentUser, extra) { _apiGuard_();
  var _fn="[flushClientPerfMetrics]";
  try {
    _ensurePerfFlushTriggerThrottled_(false); // يثبّت مشغّل التفريغ تلقائياً من أول استخدام فعلي للتطبيق
    __PERF_HOLD++; // V3.57 — كل عيّنات الدفعة + سجلها في كتابة واحدة
    try {
    (entries || []).forEach(function(e) {
      if (!e || !e.fn || typeof e.ms !== "number") return;
      // v3.53 — تبويب بكود قديم لا يرسل رقم إصداره: يُوسَم "legacy" بدل نسبه خطأً للإصدار الحالي،
      // وأي زمن أطول من 10 دقائق هو حتماً جهاز نائم/تبويب معلّق، فيُفصل كـ bg: بعيداً عن المتوسطات
      var fname = String(e.fn).slice(0,90);
      if (e.ms > 600000 && fname.indexOf("bg:") !== 0) fname = "bg:" + fname;
      _recordPerfSample_("client:" + fname, e.ms, e.ok !== false, currentUser, e.v || "legacy");
    });
    try { _perfLogPush_(_perfClientExtraToItems_(extra, currentUser)); } catch(e2) {}
    } finally { __PERF_HOLD--; }
    var logged = 0;
    if (__PERF_DEPTH === 0) logged = _perfFlushPending_().logged;
    return { success:true, recorded: (entries || []).length, logged: logged };
  } catch(e) { _logError_(_fn, e); return { success:false }; }
}

/**
 * ======================================================================
 * v3.50 — سجل التنفيذ الكامل + console + network
 * ======================================================================
 * كل تنفيذ (دالة عامة/مشغّل/doGet) وما طبعه على console، وكل نداء شبكة من المتصفح وأخطاء
 * console فيه، تُجمَّع في كاش مُقسَّم على 20 مفتاحاً لكل نافذة (يقلّل تعارض القراءة-التعديل-الكتابة
 * بين التنفيذات المتزامنة، فالكاش لا يدعم إلحاقاً ذرّياً)، ثم تُفرَّغ دفعة واحدة لشيت PerfLog.
 */
var _PERF_LOG_SHARDS = 20;
var _PERF_LOG_SHARD_CAP = 300;
var __EXEC_CONSOLE = [];
var __PERF_DEPTH = 0;

function _perfSafeStr_(a) {
  try {
    if (typeof a === "string") return a;
    if (a && a.message) return String(a.message);
    var s = JSON.stringify(a);
    return s === undefined ? String(a) : s;
  } catch (e) { try { return String(a); } catch (e2) { return ""; } }
}

// التقاط console على الخادم: يُرفَق بسجل التنفيذ الجاري، والدالة الأصلية تُستدعى دائماً كما هي
(function() {
  try {
    if (typeof console === "undefined" || !console) return;
    ["log", "info", "warn", "error"].forEach(function(level) {
      var orig = console[level];
      if (typeof orig !== "function" || orig.__perfWrapped) return;
      var wrapped = function() {
        try {
          if (__EXEC_CONSOLE.length < 30) {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) parts.push(_perfSafeStr_(arguments[i]));
            __EXEC_CONSOLE.push({ level: level, msg: parts.join(" ").slice(0, 500) });
          }
        } catch (e) {}
        return orig.apply(console, arguments);
      };
      wrapped.__perfWrapped = true;
      console[level] = wrapped;
    });
  } catch (e) {}
})();

// يُلحق عنصراً أو مصفوفة عناصر بالكاش المُقسَّم للنافذة الحالية؛ يُرجع عدد ما حُفظ. لا يرمي أبداً.
function _perfLogPush_(items) {
  try {
    if (!items) return 0;
    if (!Array.isArray(items)) items = [items];
    if (!items.length) return 0;
    var pend = _perfPending_();
    items.forEach(function(it) { pend.logs.push(it); });
    if (__PERF_HOLD === 0 && __PERF_DEPTH === 0) return _perfFlushPending_().logged;
    return items.length;
  } catch (e) { return 0; }
}
function _perfIso_(t) {
  var d = (typeof t === "number") ? new Date(t) : new Date(String(t || ""));
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// يحوّل حمولة المتصفح الإضافية لعناصر سجل بعد التحقق والقص من جهة الخادم (لا ثقة في أي حقل وارد)
function _perfClientExtraToItems_(extra, currentUser) {
  if (!extra || typeof extra !== "object") return [];
  var out = [], u = String(currentUser || "").slice(0, 100), v = String(extra.v || "").slice(0, 20);
  function cap(a) { return Array.isArray(a) ? a.slice(0, 200) : []; }
  function str(x, n) { return String(x == null ? "" : x).slice(0, n); }
  function num(x) { var n = Number(x); return isFinite(n) ? Math.max(0, Math.round(n)) : 0; }
  cap(extra.network).forEach(function(n) {
    if (!n || typeof n !== "object") return;
    out.push({ t: _perfIso_(n.t), src: "client", kind: "network", name: str(n.fn, 100), ms: num(n.ms), ok: n.ok !== false,
               err: str(n.err, 300), req: num(n.reqBytes), resp: num(n.respBytes), user: u, v: v });
  });
  cap(extra.console).forEach(function(c) {
    if (!c || typeof c !== "object") return;
    var lvl = ["log", "info", "warn", "error"].indexOf(c.level) >= 0 ? c.level : "log";
    out.push({ t: _perfIso_(c.t), src: "client", kind: "console", name: str(c.screen, 60) || "-", ms: 0, ok: lvl !== "error",
               lvl: lvl, msg: str(c.msg, 500), count: num(c.count) || 1, user: u, v: v });
  });
  cap(extra.resources).forEach(function(r) {
    if (!r || typeof r !== "object") return;
    out.push({ t: _perfIso_(r.t), src: "client", kind: "resource", name: str(r.name, 300).split("?")[0].split("#")[0], ms: num(r.duration),
               ok: true, init: str(r.initiatorType, 30), size: num(r.transferSize), user: u, v: v });
  });
  if (extra.nav && typeof extra.nav === "object") {
    out.push({ t: _perfIso_(extra.nav.t), src: "client", kind: "nav", name: "page-load", ms: num(extra.nav.load), ok: true,
               dcl: num(extra.nav.domContentLoaded), ttfb: num(extra.nav.ttfb), user: u, v: v });
  }
  return out;
}

function _perfBytes_(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + "B";
  if (n < 1048576) return (n / 1024).toFixed(1) + "KB";
  return (n / 1048576).toFixed(1) + "MB";
}
function _perfParseBytes_(s) {
  var m = /^([\d.]+)(B|KB|MB)$/.exec(String(s || ""));
  if (!m) return 0;
  return Math.round(Number(m[1]) * (m[2] === "MB" ? 1048576 : m[2] === "KB" ? 1024 : 1));
}
// نص يبدأ بـ = + - @ قد يُفسَّر صيغةً عند setValues، فيُسبق بفاصلة عليا تجعله نصاً
function _perfCellText_(s) {
  s = String(s == null ? "" : s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// عنصر سجل → صف PerfLog: Timestamp | Source | Kind | Name | Duration_Ms | Status | User | Version | Details
function _perfLogRow_(it) {
  var details = "", status = it.ok === false ? "fail" : "ok";
  if (it.kind === "exec") {
    details = [it.err ? ("خطأ: " + it.err) : ""].concat((it.con || []).map(function(c) { return c.level + ": " + c.msg; }))
      .filter(Boolean).join(" ⏎ ");
  } else if (it.kind === "network") {
    details = "req=" + _perfBytes_(it.req) + " resp=" + _perfBytes_(it.resp) + (it.err ? (" ⏎ خطأ: " + it.err) : "");
  } else if (it.kind === "console") {
    status = it.lvl || "log";
    details = (it.count > 1 ? ("×" + it.count + " ") : "") + (it.msg || "");
  } else if (it.kind === "resource") {
    details = (it.init || "") + " size=" + _perfBytes_(it.size);
  } else if (it.kind === "nav") {
    details = "dcl=" + (it.dcl || 0) + "ms ttfb=" + (it.ttfb || 0) + "ms";
  } else if (it.kind === "dropped") {
    status = "warn"; details = it.msg || "";
  }
  var ts = new Date(it.t); if (isNaN(ts.getTime())) ts = new Date();
  return [ts, String(it.src || ""), String(it.kind || ""), _perfCellText_(String(it.name || "").slice(0, 200)), Number(it.ms) || 0,
          status, String(it.user || ""), String(it.v || APP_VERSION), _perfCellText_(details.slice(0, 2000))];
}

// يحذف صفوف PerfLog الأقدم من 7 أيام (مرة كل ساعة على الأكثر) — الصفوف مُلحَقة زمنياً فيكفي حذف مقطع واحد من الأعلى
function _perfPruneLog_(props) {
  try {
    var lastP = Number(props.getProperty("PERF_LOG_PRUNED_AT")) || 0;
    if (Date.now() - lastP < 3600 * 1000) return 0;
    props.setProperty("PERF_LOG_PRUNED_AT", String(Date.now()));
    var sh = _getSS_().getSheetByName("PerfLog"); if (!sh) return 0;
    var last = sh.getLastRow(); if (last < 2) return 0;
    var col = sh.getRange(2, 1, last - 1, 1).getValues(), cutoff = Date.now() - 7 * 24 * 3600 * 1000, n = 0;
    for (var i = 0; i < col.length; i++) {
      var d = col[i][0] instanceof Date ? col[i][0] : new Date(col[i][0]);
      if (!isNaN(d.getTime()) && d.getTime() < cutoff) n++; else break;
    }
    if (n <= 0) return 0;
    if (n >= last - 1 && sh.getMaxRows() <= last) sh.insertRowsAfter(last, 1); // لا يُسمح بحذف كل الصفوف غير المجمَّدة
    sh.deleteRows(2, n);
    return n;
  } catch (e) { return -1; }
}

// يقرأ آخر صفوف PerfLog (من الأسفل، بحد أقصى 6000 صف) ويُطبّق الفلاتر — للتقرير ولشاشة السجل
function _perfReadLog_(filters) {
  filters = filters || {};
  var hours = Math.min(168, Math.max(1, Number(filters.hours) || 24));
  var cutoff = Date.now() - hours * 3600 * 1000;
  var rows = [];
  var sh = _getSS_().getSheetByName("PerfLog");
  if (sh) {
    var last = sh.getLastRow();
    if (last >= 2) {
      var first = Math.max(2, last - 5999);
      rows = sh.getRange(first, 1, last - first + 1, 9).getValues();
    }
  }
  var tz = _tz_(), out = [];
  var fKind = filters.kind ? String(filters.kind) : "", fSrc = filters.source ? String(filters.source) : "",
      fStatus = filters.status ? String(filters.status) : "", fName = filters.nameContains ? String(filters.nameContains).toLowerCase() : "";
  for (var i = rows.length - 1; i >= 0 && out.length < 5000; i--) { // الأحدث أولاً
    var r = rows[i], ts = r[0] instanceof Date ? r[0] : new Date(r[0]);
    if (isNaN(ts.getTime()) || ts.getTime() < cutoff) continue;
    if (fKind && r[2] !== fKind) continue;
    if (fSrc && r[1] !== fSrc) continue;
    if (fStatus && r[5] !== fStatus) continue;
    if (fName && String(r[3]).toLowerCase().indexOf(fName) === -1) continue;
    out.push({ time: _fmtDate_(ts, tz, "yyyy-MM-dd HH:mm:ss"), src: r[1], kind: r[2], name: String(r[3]), ms: Number(r[4]) || 0,
               status: r[5], user: String(r[6] || ""), version: String(r[7] || ""), details: String(r[8] || "") });
  }
  return { rows: out, summary: _perfLogSummary_(out), hours: hours };
}

function _perfLogSummary_(rows) {
  var s = { total: rows.length, byKind: {}, bySource: {}, byStatus: {}, topConsole: [], topNetworkByResp: [] };
  var con = {}, net = [];
  rows.forEach(function(r) {
    s.byKind[r.kind] = (s.byKind[r.kind] || 0) + 1;
    s.bySource[r.src] = (s.bySource[r.src] || 0) + 1;
    s.byStatus[r.status] = (s.byStatus[r.status] || 0) + 1;
    if (r.kind === "console") {
      var m = /^×(\d+) /.exec(r.details), cnt = m ? Number(m[1]) : 1, msg = m ? r.details.slice(m[0].length) : r.details;
      var k = r.status + "|" + msg;
      if (!con[k]) con[k] = { level: r.status, msg: msg, count: 0 };
      con[k].count += cnt;
    } else if (r.kind === "network") {
      var mr = /resp=([\d.]+(?:B|KB|MB))/.exec(r.details);
      net.push({ name: r.name, time: r.time, ms: r.ms, respBytes: mr ? _perfParseBytes_(mr[1]) : 0 });
    }
  });
  s.topConsole = Object.keys(con).map(function(k) { return con[k]; }).sort(function(a, b) { return b.count - a.count; }).slice(0, 10);
  s.topNetworkByResp = net.sort(function(a, b) { return b.respBytes - a.respBytes; }).slice(0, 10);
  return s;
}

// إخفاء ما قد يكشف بيانات العمل في تقرير يُحفَظ بمستودع عام: المستخدمون، نصوص الأخطاء/console، والمعرّفات الطويلة
function _perfRedactReport_(data) {
  var ID_RE = /[A-Za-z0-9_-]{25,}/g;
  function scrub(x) {
    if (typeof x === "string") return x.replace(ID_RE, "[id]");
    if (Array.isArray(x)) return x.map(scrub);
    if (x && typeof x === "object") { var o = {}; Object.keys(x).forEach(function(k) { o[k] = scrub(x[k]); }); return o; }
    return x;
  }
  if (data.health) data.health = scrub(data.health);
  (data.slowCalls || []).forEach(function(c) { c.user = ""; });
  (data.log || []).forEach(function(r) {
    r.user = "";
    if (r.kind === "resource" || r.kind === "nav") { r.name = scrub(r.name); r.details = scrub(r.details); }
    else r.details = "";
  });
  if (data.logSummary) {
    (data.logSummary.topConsole || []).forEach(function(c) { c.msg = ""; });
  }
  return data;
}

// زر "نسخ كل البيانات" (Admin فقط): كل أقسام التقرير + الصحة + سجل آخر 24 ساعة بتفاصيل كاملة غير منقّحة،
// لأن الوجهة حافظة المدير نفسه (للصقها في المحادثة) وليست المستودع العام
function getPerfCopyAllJson(currentUser, filters) { _apiGuard_();
  var _fn = "[getPerfCopyAllJson]";
  try {
    if (!_isAdmin_(currentUser)) throw new Error("غير مصرح — نسخ بيانات الأداء لمدير النظام فقط.");
    filters = filters || {};
    var health = { flushTrigger: _ensurePerfFlushTriggerThrottled_(false) };
    try { health.flush = _flushPerfBucketsCore_(); } catch (fe) { health.flush = { error: String(fe && fe.message || fe) }; }
    health.diag = _perfDiag_();
    var data = _gatherPerfDashboardData_({ fromDate: filters.fromDate || null, toDate: filters.toDate || null,
                                            version: filters.version || null, hours: 24 });
    data.health = health;
    data.filters = { fromDate: filters.fromDate || null, toDate: filters.toDate || null, version: filters.version || null, logHours: 24 };
    data.detail = "full";
    data.exportedAt = new Date().toISOString();
    return data;
  } catch (e) { _logError_(_fn, e); throw e; }
}

// سجل التنفيذ لشاشة الإدارة (Admin فقط، تفاصيل كاملة)
function getPerfLog(currentUser, filters) { _apiGuard_();
  var _fn = "[getPerfLog]";
  try {
    if (!_isAdmin_(currentUser)) throw new Error("غير مصرح — سجل التنفيذ لمدير النظام فقط.");
    return _perfReadLog_(filters);
  } catch (e) { _logError_(_fn, e); throw e; }
}

// يُشغَّل كل 10 دقائق عبر مشغّل زمني (يُقاس وقته ضمن حصة المشغّلات) — المنطق الفعلي في _flushPerfBucketsCore_
function _flushPerfBuckets_() {
  __TRUSTED_DEPTH++; // V3.63 — مشغّل زمني: نقطة دخول موثوقة (لا تُنادى من المتصفح لانتهاء اسمها بـ "_")
  try { _flushPerfBucketsWork_(); } finally { __TRUSTED_DEPTH--; }
}
function _flushPerfBucketsWork_() {
  try { _sessionsPrune_(); } catch(e0) {}
  try { _notifQueueDrain_(); } catch(eQ) { _logError_("[_flushPerfBuckets_→notifQueue]", eQ); } // V3.70 — شبكة أمان لإشعارات لم تطلب الواجهة تفريغها
  try { _flushPerfBucketsCore_(); } catch(e) { _logError_("[_flushPerfBuckets_]", e); }
  try { if (_tgQueuePending_()) _flushTelegramQueue_(); } catch(e2) { _logError_("[_flushPerfBuckets_→Telegram]", e2); } // V3.55 — شبكة أمان للرسائل العالقة
}

// يُفرِّغ كل النوافذ المكتملة التي لم تُفرَّغ بعد (منذ آخر نافذة محفوظة في PERF_LAST_FLUSHED_BUCKET) دفعة واحدة:
// المشغّلات الزمنية تتأخر/تتقدّم دقائق، فقراءة "النافذة السابقة" وحدها كانت تُضيِّع نوافذ أو تكررها
function _flushPerfBucketsCore_() {
  // V3.55 — قفل المستند (مستقل عن قفل السكريبت): التفريغ يستغرق ~4 ثوانٍ كل 10 دقائق، وكان يحجز قفل السكريبت
  // نفسه الذي ينتظره كل حفظ حجز/تعاقد/دفعة — فيتأخر حفظ المستخدم بلا سبب ظاهر
  var lock = (function() { try { return LockService.getDocumentLock() || LockService.getScriptLock(); } catch (e) { return LockService.getScriptLock(); } })();
  if (!lock.tryLock(5000)) return { skipped: "busy" }; // تشغيل آخر يفرّغ الآن
  try {
    var props = PropertiesService.getScriptProperties();
    var last = props.getProperty("PERF_LAST_FLUSHED_BUCKET") || "";
    var now = Date.now(), buckets = [];
    // النوافذ المكتملة فقط (تبدأ من k=1)، من الأحدث للأقدم حتى آخر نافذة فُرِّغت
    for (var k = 1; k <= _PERF_CATCHUP_WINDOWS; k++) {
      var key = _perfBucketKey_(new Date(now - k*_PERF_BUCKET_MIN*60*1000));
      if (last && key <= last) break;
      if (buckets.indexOf(key) === -1) buckets.unshift(key);
    }
    if (!buckets.length) return { flushed: 0, rows: 0 };

    // ما كُتب فعلاً لكل نافذة في كل شيت (يمنع تكرار الصفوف حين ينجح شيت ويفشل آخر ثم يُعاد التفريغ)
    var partial = {};
    try { partial = JSON.parse(props.getProperty("PERF_FLUSH_PARTIAL") || "{}") || {}; } catch (pe0) { partial = {}; }
    function isDone(bucket, sheet) { return (partial[bucket] || []).indexOf(sheet) !== -1; }

    var cache = CacheService.getScriptCache();
    var _pj = function(raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
    // V3.57 — قراءتان مجمّعتان لكل نافذة (getAll) بدل قراءة كاش منفصلة لكل دالة مقاسة
    var perBucket = buckets.map(function(bucket) {
      var b = { bucket: bucket, rows: [], slowRows: [], logItems: [], logDropped: 0, quota: {} };
      var activeKey = "PERF_ACTIVE::" + bucket, slowKey = "PERF_SLOWBUF::" + bucket;
      var keys = [activeKey, slowKey], logKeys = [], quotaKeys = [];
      for (var sh = 0; sh < _PERF_LOG_SHARDS; sh++) { logKeys.push("PERF_LOGBUF::" + bucket + "::" + sh); quotaKeys.push("PERF_QUOTA::" + bucket + "::" + sh); }
      var got = {};
      try { got = cache.getAll(keys.concat(logKeys, quotaKeys)) || {}; } catch (ge) {}
      var tags = _pj(got[activeKey]) || [], aggKeys = tags.map(function(tag) {
        // "name@@ver" (منذ v3.51)؛ الاسم المجرّد صيغة ما قبلها ما زال في الكاش خلال نافذة الانتقال
        var sep = String(tag).lastIndexOf("@@");
        var name = sep >= 0 ? tag.slice(0, sep) : tag, ver = sep >= 0 ? tag.slice(sep + 2) : APP_VERSION;
        return { name: name, ver: ver, key: sep >= 0 ? ("PERF_AGG::" + name + "::" + ver + "::" + bucket) : ("PERF_AGG::" + name + "::" + bucket) };
      });
      var aggGot = {};
      try { if (aggKeys.length) aggGot = cache.getAll(aggKeys.map(function(a) { return a.key; })) || {}; } catch (ge2) {}
      aggKeys.forEach(function(a) {
        var agg = _pj(aggGot[a.key]);
        if (!agg || !agg.count) return;
        b.rows.push([bucket.slice(0,8), bucket.slice(8,10), a.name, agg.count, agg.sum, agg.max, agg.fails||0, a.ver]);
      });
      (_pj(got[slowKey]) || []).forEach(function(s) {
        b.slowRows.push([new Date(s[0]), s[1], s[2], s[3], s[4] ? "نجاح" : "فشل", s[5] || APP_VERSION]);
      });
      logKeys.forEach(function(k) {
        var lb = _pj(got[k]); if (!lb) return;
        (lb.items || []).forEach(function(it) { b.logItems.push(it); }); b.logDropped += Number(lb.dropped) || 0;
      });
      quotaKeys.forEach(function(k) {
        var q = _pj(got[k]); if (!q) return;
        Object.keys(q).forEach(function(n) { b.quota[n] = (b.quota[n] || 0) + (Number(q[n]) || 0); });
      });
      return b;
    });

    var attempts = {}, counts = { Perf: 0, PerfSlow: 0, PerfLog: 0 }, logDropped = 0;
    function writeSheet(sheet, width, buildRows) {
      var pending = perBucket.filter(function(b) { return !isDone(b.bucket, sheet); });
      var rowsOut = buildRows(pending);
      if (rowsOut.length) attempts[sheet] = _perfAppendRows_(sheet, rowsOut, width);
      counts[sheet] = rowsOut.length;
      pending.forEach(function(b) { (partial[b.bucket] = partial[b.bucket] || []).push(sheet); });
      props.setProperty("PERF_FLUSH_PARTIAL", JSON.stringify(partial));
    }
    try {
      writeSheet("Perf", 8, function(bs) { return [].concat.apply([], bs.map(function(b) { return b.rows; })); });
      writeSheet("PerfSlow", 6, function(bs) { return [].concat.apply([], bs.map(function(b) { return b.slowRows; })); });
      writeSheet("PerfLog", 9, function(bs) {
        var items = [].concat.apply([], bs.map(function(b) { return b.logItems; }));
        items.sort(function(a, b) { return String(a.t) < String(b.t) ? -1 : (String(a.t) > String(b.t) ? 1 : 0); });
        var out = items.map(_perfLogRow_);
        logDropped = bs.reduce(function(t, b) { return t + b.logDropped; }, 0);
        if (logDropped) out.push(_perfLogRow_({ t: new Date().toISOString(), src: "system", kind: "dropped", name: "log-buffer-overflow",
                                                 ms: 0, ok: false, v: APP_VERSION, msg: "dropped=" + logDropped }));
        return out;
      });
      // V3.57 — عدّادات الحصص المجمّعة في الكاش تُضاف للخصائص هنا مرة واحدة (مرة واحدة لكل نافذة بفضل علامة partial)
      var qPend = perBucket.filter(function(b) { return !isDone(b.bucket, "Quota"); });
      var qTot = {};
      qPend.forEach(function(b) { Object.keys(b.quota).forEach(function(n) { var k = "QUOTA_" + n + "_" + b.bucket.slice(0, 8); qTot[k] = (qTot[k] || 0) + b.quota[n]; }); });
      if (Object.keys(qTot).length) {
        var allP = props.getProperties(), upd = {};
        Object.keys(qTot).forEach(function(k) { upd[k] = String((Number(allP[k]) || 0) + qTot[k]); });
        props.setProperties(upd);
      }
      if (qPend.length) { qPend.forEach(function(b) { (partial[b.bucket] = partial[b.bucket] || []).push("Quota"); }); props.setProperty("PERF_FLUSH_PARTIAL", JSON.stringify(partial)); }
    } catch (we) {
      // لا يتقدّم مؤشر آخر نافذة عند الفشل: البيانات تبقى في الكاش (ساعتان) ويعيد التشغيل التالي المحاولة لما لم يُكتب فقط
      props.setProperty("PERF_LAST_FLUSH_ERROR", new Date().toISOString() + " | " + String(we && we.message || we));
      throw we;
    }
    props.deleteProperty("PERF_FLUSH_PARTIAL");
    props.setProperty("PERF_LAST_FLUSHED_BUCKET", buckets[buckets.length-1]);
    props.deleteProperty("PERF_LAST_FLUSH_ERROR");
    _cleanupStaleQuotaKeys_(); // تنظيف دوري لمفاتيح الحصص الأقدم من 35 يوماً
    var pruned = _perfPruneLog_(props);
    return { flushed: buckets.length, rows: counts.Perf, slowRows: counts.PerfSlow, logRows: counts.PerfLog, logDropped: logDropped,
             pruned: pruned, lastBucket: buckets[buckets.length-1], attempts: attempts };
  } finally { lock.releaseLock(); }
}

// يُلحق صفوفاً بآخر الشيت مع إعادة المحاولة: خطأ "Service Spreadsheets failed" عام وغالباً عابر (الشيت
// مشغول بعمليات متزامنة)، ويوسّع الشيت إن تجاوزت الصفوف حدوده. يرمي خطأً يذكر الخطوة الفاشلة بعد 3 محاولات.
function _perfAppendRows_(sheetName, rows, width) {
  var lastErr, stage = "";
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      stage = "open"; var sh = _getOrCreateSheet_(sheetName);
      stage = "lastRow"; var start = sh.getLastRow() + 1, need = start + rows.length - 1, maxR = sh.getMaxRows();
      if (need > maxR) { stage = "insertRows"; sh.insertRowsAfter(maxR, need - maxR); }
      stage = "setValues"; sh.getRange(start, 1, rows.length, width).setValues(rows);
      return attempt;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) Utilities.sleep(1500 * attempt);
    }
  }
  throw new Error(sheetName + " [" + stage + "] فشل بعد 3 محاولات: " + String(lastErr && lastErr.message || lastErr));
}

// تشخيص بلا بيانات حساسة: حجم الملف وأبعاد شيتي الأداء، وآخر خطأ تفريغ (من أي تشغيل، بما فيه المشغّل)
function _perfDiag_() {
  var d = {};
  try {
    var ss = _getSS_(), sheets = ss.getSheets(), cells = 0;
    // V3.55 — عدد الصفوف الفعلية لكل شيت: حجم القراءات الكاملة هو المحدد الأكبر لزمن كل دالة تقرأ شيتاً
    d.sheetRows = {};
    sheets.forEach(function(s) { cells += s.getMaxRows() * s.getMaxColumns(); try { d.sheetRows[s.getName()] = s.getLastRow(); } catch (eR) {} });
    d.sheetCount = sheets.length; d.totalCells = cells; d.cellLimit = 10000000;
    // V3.58 — حجوزات جديدة سابقة كُتب تاريخ سدادها خطأً في عمود Client_Option_Date (21) بلا نوع تأكيد: عددها للتشخيص فقط
    try {
      var bd = _getSheetValues_("Bookings_Master"), mis = 0;
      for (var bi = 1; bi < bd.length; bi++) { var br = bd[bi]; if (br[0] && br[14] !== true && br[20] !== "" && br[20] != null && !br[18] && (br[21] === "" || br[21] == null)) mis++; }
      d.misplacedPaymentDates = mis;
    } catch (eM) {}
    // V3.62 — حجوزات تشغل ليلة "يوم تسليم" تعاقد (تاريخ نهايته) بلا تعاقد آخر يغطيها: كانت تُعدّ ضمن الطاقة قبل توحيد القاعدة
    try { d.bookingsOnHandoverNight = _bookingsOnHandoverNight_().length; } catch (eH) {}
    // V3.79 — دفعات مزدوجة فقد جانب الفندق فيها (حُذف سدادها مع قسطها)، أقساط أنشأها النظام من دفعات، ودفعات فنادق بلا قسط
    try {
      var apD = _getSheetValues_("Account_Payments"), rcD2 = _getSheetValues_("Contract_Payment_Receipts"), cpD = _getSheetValues_("Contract_Payments"), rdel = {}, nLost = 0, nAuto = 0, nUn = 0;
      for (var rq = 1; rq < rcD2.length; rq++) { if (rcD2[rq][0]) { rdel[String(rcD2[rq][0])] = rcD2[rq][9] === true; if (rcD2[rq][9] !== true && !String(rcD2[rq][1] || "")) nUn++; } }
      for (var aq = 1; aq < apD.length; aq++) { var lk = String(apD[aq][12] || ""); if (apD[aq][0] && apD[aq][10] !== true && lk && rdel[lk] !== false) nLost++; }
      for (var cq = 1; cq < cpD.length; cq++) { if (cpD[cq][0] && cpD[cq][9] !== true && /^(قسط أُنشئ تلقائياً|دفعة مزدوجة من)/.test(String(cpD[cq][6] || ""))) nAuto++; }
      d.dualPaymentsMissingHotelSide = nLost; d.autoCreatedInstallments = nAuto; d.unassignedHotelReceipts = nUn;
      var am = _attCountMap_(), na = 0; Object.keys(am).forEach(function(k) { na += am[k]; }); d.paymentAttachments = na; // V3.80
    } catch (eDL) {}
    // V3.75 — صفوف تفضيلات مكررة لنفس (مستخدم، مفتاح): كانت تجعل التفضيل المحفوظ لا يظهر بعد الدخول
    try { var up = _getSheetValues_("User_Preferences"), seenP = {}, dupP = 0; for (var ui = 1; ui < up.length; ui++) { var kk = up[ui][0] + "\u0001" + up[ui][1]; if (seenP[kk]) dupP++; else seenP[kk] = 1; } d.duplicatePrefRows = dupP; } catch (eU) {}
    // V3.73 — أطراف تظهر بالحسابات بلا حجوزات سارية (أعداد فقط، بلا أسماء): كم منها له دفعات، وكم سبق له حجز أُلغي/حُذف
    try {
      d.partiesWithoutBookings = {};
      ["collection", "client"].forEach(function(pt) {
        var ex = { cancelled: {}, deleted: {} }, due = _buildAccountsDueMap_(pt, null, "", null, null, ex), paid = _buildAccountsPaidMap_(pt, null, "", null, null);
        var r = { n: 0, payments: 0, hadCancelled: 0, hadDeleted: 0, neverBooked: 0 };
        Object.keys(paid).forEach(function(k) { if (due[k]) return; r.n++; r.payments += paid[k].count; if (ex.cancelled[k]) r.hadCancelled++; if (ex.deleted[k]) r.hadDeleted++; if (!ex.cancelled[k] && !ex.deleted[k]) r.neverBooked++; });
        d.partiesWithoutBookings[pt] = r;
      });
      d.unusedCollectionAccounts = getCollectionAccounts().filter(function(a) { return !a.used; }).length;
    } catch (eP) {}
    ["Perf", "PerfSlow", "PerfLog"].forEach(function(n) {
      var s = ss.getSheetByName(n);
      d[n] = s ? { lastRow: s.getLastRow(), maxRows: s.getMaxRows(), maxCols: s.getMaxColumns() } : null;
    });
  } catch (e) { d.error = String(e && e.message || e); }
  try {
    var p = PropertiesService.getScriptProperties();
    d.lastFlushedBucket = p.getProperty("PERF_LAST_FLUSHED_BUCKET") || "";
    d.lastFlushError = p.getProperty("PERF_LAST_FLUSH_ERROR") || "";
  } catch (e2) {}
  return d;
}

// يتأكد من وجود مشغّل التفريغ دون خطوة يدوية — بفحص مخفَّف عبر الكاش (مرة كل 6 ساعات على الأكثر)،
// إلا عند force (نقطة سحب التقرير) فيُفحص فعلياً كل مرة. لا يرمي خطأ أبداً.
function _ensurePerfFlushTriggerThrottled_(force) {
  try {
    var cache = CacheService.getScriptCache();
    if (!force && cache.get("PERF_TRIGGER_OK30")) return "ok (cached)";
    var msg = _ensurePerfFlushTrigger_();
    cache.put("PERF_TRIGGER_OK30", "1", 21600);
    return msg;
  } catch(e) { return "error: " + e.message; }
}

// يُثبّت مشغّل التفريغ مرة واحدة فقط إن لم يكن مثبّتاً.
// V3.76 — كل 30 دقيقة بدل 10: التفريغ كان ~5.3 ث × 139 مرة يومياً (معظم دقائق المشغّلات). نوافذ القياس تبقى 10 دقائق وتُحفظ
// بالكاش ساعتين، والتفريغ يعوّض حتى 12 نافذة — فلا يضيع قياس. سحب التقرير يفرّغ فوراً دائماً. المشغّل القديم (10 دقائق)
// يُستبدل مرة واحدة: الفاصل لا يُقرأ من كائن المشغّل، فنحفظه في خاصية PERF_TRIGGER_MIN.
var _PERF_TRIGGER_MIN = 30;
function _ensurePerfFlushTrigger_() {
  var props = PropertiesService.getScriptProperties();
  var mine = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === "_flushPerfBuckets_"; });
  var upToDate = String(props.getProperty("PERF_TRIGGER_MIN") || "") === String(_PERF_TRIGGER_MIN);
  if (mine.length === 1 && upToDate) return "المشغّل مثبّت مسبقاً";
  var replaced = mine.length > 0;
  mine.forEach(function(t) { try { ScriptApp.deleteTrigger(t); } catch (eD) {} });
  ScriptApp.newTrigger("_flushPerfBuckets_").timeBased().everyMinutes(_PERF_TRIGGER_MIN).create();
  props.setProperty("PERF_TRIGGER_MIN", String(_PERF_TRIGGER_MIN));
  return (replaced ? "تم استبدال" : "تم تثبيت") + " مشغّل تفريغ إحصاءات الأداء كل " + _PERF_TRIGGER_MIN + " دقيقة";
}

/**
 * ======================================================================
 * عدّادات استهلاك حصص جوجل اليومية (Google Apps Script Quotas)
 * ======================================================================
 * UrlFetch ووقت تشغيل المشغّلات حصتان يوميتان حقيقيتان منشورتان من جوجل.
 * أما قراءة الشيتات/عمليات الكاش/القفل فمؤشرات استخدام فقط (لا حصة يومية منشورة
 * لها) - عدّادها تقريبي حسب نقاط العبور الفعلية في الكود (_getSheetValues_ عند
 * القراءة الفعلية من الشيت، _getFromCache_/_putInCache_، _withLock_)، وليس شاملاً
 * لأي استدعاء مباشر لهذه الخدمات يتجاوز هذه الدوال المساعدة - هذا تقدير، وليس دقيقاً 100%.
 * PropertiesService لا يوجد له نقطة عبور واحدة مماثلة حالياً (استدعاءات مباشرة متفرقة
 * بكل الملف)، فلم يُضَف له عدّاد تجنّباً لتعديلات واسعة مقابل مؤشر غير حرج.
 */
function _quotaDateKey_() { return _fmtDate_(new Date(), _tz_(), "yyyyMMdd"); }

function _incrementDailyQuota_(name, amount) {
  // V3.57 — كان كل عدّاد = قراءة + كتابة في خصائص السكريبت (~100-200 مللي ثانية) مع كل قراءة شيت وكل عملية كاش
  // وكل قفل. الآن يُجمَّع في دفعة التنفيذ (كاش)، ويُضاف للخصائص مرة كل 10 دقائق من مشغّل التفريغ.
  try {
    var q = _perfPending_().quota;
    q[name] = (q[name] || 0) + (amount || 1);
    _perfMaybeFlush_();
  } catch(e) {}
}
function _getDailyQuotaCounters_(dateKey) {
  try {
    var all = PropertiesService.getScriptProperties().getProperties();
    var names = ["URLFETCH","TRIGGERMS","SHEETREAD","CACHEOP","LOCK"];
    var out = {};
    names.forEach(function(n) { out[n] = Number(all["QUOTA_"+n+"_"+dateKey] || 0); });
    return out;
  } catch(e) { return {}; }
}

// تخمين نوع الحساب من نطاق بريد المستخدم الفعلي - حساب شخصي (gmail.com) له حصة UrlFetch أقل (20,000)
// من حساب Workspace (100,000). تخمين وليس يقيناً، لذا نُسمّيه بوضوح في الواجهة "تقديري"
function _urlFetchDailyLimit_() {
  try {
    var email = Session.getEffectiveUser().getEmail() || "";
    return /@gmail\.com$/i.test(email) ? 20000 : 100000;
  } catch(e) { return 20000; }
}

// حذف مفاتيح الحصص اليومية الأقدم من 35 يوماً - PropertiesService له سقف تخزين إجمالي، وليس لكل مفتاح فقط
function _cleanupStaleQuotaKeys_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var all = props.getProperties();
    var cutoff = Date.now() - 35*24*60*60*1000;
    Object.keys(all).forEach(function(k) {
      var m = k.match(/^QUOTA_[A-Z]+_(\d{8})$/);
      if (!m) return;
      var d = m[1];
      var keyDate = new Date(Number(d.slice(0,4)), Number(d.slice(4,6))-1, Number(d.slice(6,8))).getTime();
      if (keyDate < cutoff) props.deleteProperty(k);
    });
  } catch(e) {}
}

/**
 * ======================================================================
 * لوحة أداء الإدارة (Admin فقط): تجميع بيانات Perf/PerfSlow + الحصص اليومية
 * ======================================================================
 */
// يُجمِّع كل بيانات لوحة الأداء دفعة واحدة - تستخدمه كل من التقرير المباشر للوحة، وزر التصدير،
// ونقطة doGet المحمية بمفتاح سرّي لسحب التقرير آلياً عبر GitHub Actions (مصدر حقيقة واحد للثلاثة)
function _gatherPerfDashboardData_(filters) {
  filters = filters || {};
  var fromDay = filters.fromDate ? String(filters.fromDate).replace(/-/g,"") : null; // "yyyy-MM-dd" -> "yyyyMMdd"
  var toDay   = filters.toDate   ? String(filters.toDate).replace(/-/g,"")   : null;
  var onlyVersion = filters.version ? String(filters.version) : null;

  var perfData = _getOrCreateSheet_("Perf").getDataRange().getValues();
  var versionsSeen = {};
  var byFnVer = {};
  for (var i=1; i<perfData.length; i++) {
    var row = perfData[i];
    var day = String(row[0]||""), hour=String(row[1]||""), fn=String(row[2]||""),
        count=Number(row[3])||0, sumMs=Number(row[4])||0, maxMs=Number(row[5])||0,
        fails=Number(row[6])||0, ver=String(row[7]||"");
    if (ver) versionsSeen[ver]=true;
    if (fromDay && day < fromDay) continue;
    if (toDay && day > toDay) continue;
    if (onlyVersion && ver !== onlyVersion) continue;
    var key = fn + "::" + ver;
    if (!byFnVer[key]) byFnVer[key] = { fn:fn, version:ver, totalCount:0, totalTimeMs:0, max:0, fails:0 };
    byFnVer[key].totalCount += count;
    byFnVer[key].totalTimeMs += sumMs;
    byFnVer[key].fails += fails;
    if (maxMs > byFnVer[key].max) byFnVer[key].max = maxMs;
  }
  var topByVolume = Object.keys(byFnVer).map(function(k) {
    var e = byFnVer[k];
    return { fn:e.fn, version:e.version, totalCount:e.totalCount,
             avgMs: e.totalCount?Math.round(e.totalTimeMs/e.totalCount):0,
             maxMs:e.max, totalTimeMs: Math.round(e.totalTimeMs), fails:e.fails };
  }).sort(function(a,b){ return b.totalTimeMs - a.totalTimeMs; });

  var slowData = _getOrCreateSheet_("PerfSlow").getDataRange().getValues();
  var slowCalls = [];
  for (var j = Math.max(1, slowData.length-300); j < slowData.length; j++) {
    var r = slowData[j];
    var ver2 = String(r[5]||"");
    if (onlyVersion && ver2 !== onlyVersion) continue;
    var ts = r[0] instanceof Date ? r[0] : new Date(r[0]);
    var dayStr = _fmtDate_(ts, _tz_(), "yyyyMMdd");
    if (fromDay && dayStr < fromDay) continue;
    if (toDay && dayStr > toDay) continue;
    slowCalls.push({ time: _fmtDate_(ts, _tz_(), "dd/MM HH:mm:ss"),
                      fn: r[1], ms: r[2], user: r[3], ok: r[4], version: ver2 });
  }
  slowCalls.sort(function(a,b){ return b.ms - a.ms; });
  slowCalls = slowCalls.slice(0, 30);

  var todayKey = _quotaDateKey_();
  var quota = _getDailyQuotaCounters_(todayKey);
  var todayDay = todayKey;
  var todayTotals = { totalCalls:0, sumMs:0, fails:0 };
  topByVolume.forEach(function(){}); // (الإجمالي اليومي يُحسَب من صفوف اليوم مباشرة أدناه، لا من topByVolume المُجمَّع عبر الفلاتر)
  for (var k=1; k<perfData.length; k++) {
    if (String(perfData[k][0]) !== todayDay) continue;
    todayTotals.totalCalls += Number(perfData[k][3])||0;
    todayTotals.sumMs += Number(perfData[k][4])||0;
    todayTotals.fails += Number(perfData[k][6])||0;
  }

  // سجل التنفيذ (لا يُحمَّل للوحة الرئيسية لأن لها شاشة سجل مستقلة getPerfLog)
  var lg = filters.includeLog === false ? null : _perfReadLog_({ hours: filters.hours });

  return {
    generatedAt: new Date().toISOString(),
    version: APP_VERSION,
    versions: Object.keys(versionsSeen).sort(_cmpVersion_),
    topByVolume: topByVolume.slice(0, 50),
    // V3.68 — عيّنات المراحل الداخلية (~الدالة:المرحلة) للإصدار الحالي كاملةً: كانت تضيع خارج "أعلى 50" فلا يُعرف أين يذهب زمن الحفظ/الدخول
    phases: topByVolume.filter(function(r) { return String(r.fn).charAt(0) === "~" && r.version === APP_VERSION; }).slice(0, 80),
    slowCalls: slowCalls,
    logHours: lg ? lg.hours : 0,
    log: lg ? lg.rows : [],
    logSummary: lg ? lg.summary : null,
    today: {
      totalCalls: todayTotals.totalCalls,
      avgMs: todayTotals.totalCalls ? Math.round(todayTotals.sumMs/todayTotals.totalCalls) : 0,
      failRatePct: todayTotals.totalCalls ? Math.round(todayTotals.fails/todayTotals.totalCalls*1000)/10 : 0
    },
    quotas: {
      urlFetch: { used: quota.URLFETCH||0, limit: _urlFetchDailyLimit_() },
      triggerMinutes: { used: Math.round((quota.TRIGGERMS||0)/60000*10)/10, limit: 90 },
      sheetReadsToday: quota.SHEETREAD||0, cacheOpsToday: quota.CACHEOP||0, lockAcquisitionsToday: quota.LOCK||0
    }
  };
}

// تقرير الأداء للوحة الإدارة (Admin فقط)
function getPerformanceReport(currentUser, filters) { _apiGuard_();
  var _fn="[getPerformanceReport]";
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح — تقرير الأداء لمدير النظام فقط.");
  filters = filters || {}; filters.includeLog = false;
  return _gatherPerfDashboardData_(filters);
  } catch(e) { _logError_(_fn, e); throw e; }
}

// تصدير بيانات لوحة الأداء الحالية كـ JSON (Admin فقط) - لزر "تصدير للتحليل" في الواجهة
function getPerfExportJson(currentUser, filters) { _apiGuard_();
  var _fn="[getPerfExportJson]";
  try {
  if (!_isAdmin_(currentUser)) throw new Error("غير مصرح — تصدير بيانات الأداء لمدير النظام فقط.");
  var data = _gatherPerfDashboardData_(filters);
  data.exportedAt = new Date().toISOString();
  return data;
  } catch(e) { _logError_(_fn, e); throw e; }
}

/**
 * ======================================================================
 * LockService — الحفظ المتزامن الآمن
 * ======================================================================
 * يمنع سيناريو "المستخدمان يحفظان في نفس اللحظة" الذي كان قد يسبب:
 * • تجاوز السعة معاً لأن كلاً منهما فحص التوافر قبل كتابة الآخر
 * • تكرار الأرقام التسلسلية (نفس ID للتعاقد/الحجز/الدفعة/…)
 * • كتابة صلاحيات متضاربة لنفس المستخدم
 *
 * الأسلوب: يقفل الاسكريبت بأكمله (Script Lock) لمدة قصيرة أثناء الكتابة الحرجة،
 * ثم يُفرج فوراً. المهلة 20 ثانية لتفادي انتظار طويل وتفشل بأدب مع رسالة واضحة.
 */
// V3.55 — قفل قابل لإعادة الدخول: دالة مقفولة تنادي أخرى مقفولة (مثل تحويل طلب انتظار → حفظ حجز، أو توليد رقم
// تسلسلي داخل الحفظ) كانت تستدعي waitLock ثم releaseLock داخلياً، فيُفَك قفل العملية الخارجية وهي لم تنتهِ بعد
// ويدخل حفظ متزامن آخر في منتصفها. الآن: العمق يُعدّ، ولا يُفَك القفل إلا عند خروج العملية الخارجية.
var __LOCK_DEPTH = 0, __LOCK_OBJ = null;
function _withLock_(fn, timeoutMs) {
  if (__LOCK_DEPTH > 0) { __LOCK_DEPTH++; try { return fn(); } finally { __LOCK_DEPTH--; } }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(timeoutMs || 20000); // 20 ثانية كحد أقصى
  } catch(e) {
    throw new Error("النظام مشغول بمعالجة حفظ متزامن. يرجى إعادة المحاولة بعد لحظات.");
  }
  __LOCK_DEPTH = 1; __LOCK_OBJ = lock;
  try { _incrementDailyQuota_("LOCK"); } catch(e) {} // نقطة عبور شاملة لكل استخدامات القفل في المشروع
  try { return fn(); }
  finally { __LOCK_DEPTH = 0; __LOCK_OBJ = null; try { lock.releaseLock(); } catch(e) {} }
}


/**
 * ======================================================================
 * شاشة نسك (اتفاقيات المعتمرين) — دوال الخادم
 * ======================================================================
 * كل اتفاقية ترتبط بحجز موجود مسبقاً؛ الحجز الواحد يقبل عدة اتفاقيات
 * السعة اليومية لنسك = مجموع (غرف العقد × متوسط تسكين نسك للعقد) لكل عقد سارٍ في هذا اليوم
 * الحد الأقصى للحجز يوماً بيوم = عدد غرف الحجز × متوسط تسكين نسك للعقد (تلميح فقط لا يعطل التسجيل)
 */

// ─── دالة مساعدة داخلية: تُعيد ملخصاً لعقد بمعرّف معيّن (يُستخدم لحساب متوسط تسكين نسك للحجز) ───
function _nusukGetContractInfo_(contractId) {
  var data=_getSheetValues_("Contracts_Master");
  for (var i=1; i<data.length; i++) {
    var row=data[i];
    if (!row[0]||row[12]===true) continue;
    if (String(row[0])!==String(contractId)) continue;
    var rooms=parseFloat(row[6])||0;
    var nusukCap=parseFloat(row[17])||0;
    var avg = (nusukCap>0 && rooms>0) ? (nusukCap/rooms) : 0;
    return { contractId:row[0], hotelName:row[1], roomCount:rooms, nusukCapacity:nusukCap, nusukAvgOccupancy:avg };
  }
  return null;
}

// ─── قائمة الحجوزات الصالحة كأساس لاتفاقيات نسك في فندق معيّن ───
// تُستخدم في القائمة المنسدلة داخل نموذج إضافة الاتفاقية. تعرض كل حجوزات الفندق (غير الملغاة/المحذوفة) مع ملخص كل حجز
// يمكن للحجز الواحد الظهور في اتفاقيات متعددة، لذا لا نستبعد الحجوزات التي لها اتفاقيات سابقة
function getBookingsForNusukSelector(hotelName, currentUser) { _apiGuard_();
  var _fn="[getBookingsForNusukSelector]"; _logInfo_(_fn, "START | "+"hotelName:"+String(JSON.stringify(hotelName)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser,"nusuk","canView");
  if (!hotelName) return [];
  var allowed=_getUserAllowedHotels_(currentUser);
  if (allowed && !allowed[hotelName]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
  var tz=_tz_();
  var hotelMap=_buildContractHotelMap_();
  var collMap=_buildCollectionAccountMap_();
  // نبني خريطة عقد→معلوماته لحساب متوسط تسكين نسك لكل حجز حسب عقده
  var contractsData=_getSheetValues_("Contracts_Master");
  var contractInfo={};
  for (var i=1; i<contractsData.length; i++) {
    var crow=contractsData[i];
    if (!crow[0]||crow[12]===true) continue;
    var rooms=parseFloat(crow[6])||0;
    var nusukCap=parseFloat(crow[17])||0;
    contractInfo[crow[0]] = { rooms:rooms, nusukCap:nusukCap, avg:(nusukCap>0&&rooms>0)?(nusukCap/rooms):0 };
  }
  var bookingsData=_getSheetValues_("Bookings_Master");
  var out=[];
  for (var j=1; j<bookingsData.length; j++) {
    var brow=bookingsData[j];
    if (!brow[0]||brow[14]===true) continue;
    if (String(brow[4])==="ملغي") continue;
    var hn=hotelMap[brow[1]]||"";
    if (hn!==hotelName) continue;
    var ci=brow[6] instanceof Date?brow[6]:new Date(brow[6]);
    var co=brow[7] instanceof Date?brow[7]:new Date(brow[7]);
    var info=contractInfo[brow[1]]||{avg:0};
    var bRooms=parseFloat(brow[5])||0;
    out.push({
      bookingId:brow[0], contractId:brow[1], hotelName:hn,
      clientName:brow[2], collectionAccount:collMap[brow[3]]||brow[3], collectionAccountId:brow[3],
      status:brow[4], roomCount:bRooms,
      checkIn:_fmtDate_(ci,tz,"dd/MM/yyyy"),
      checkOut:_fmtDate_(co,tz,"dd/MM/yyyy"),
      checkInIso:_fmtDate_(ci,tz,"yyyy-MM-dd"),
      checkOutIso:_fmtDate_(co,tz,"yyyy-MM-dd"),
      nights:brow[8],
      contractNusukAvg: Math.round(info.avg*10)/10,
      // الحد الأقصى النظري للحجز = عدد غرف الحجز × متوسط تسكين نسك للعقد (مقرَّب لأقرب رقم صحيح كتلميح)
      bookingMaxPersonsHint: info.avg>0 ? Math.round(bRooms*info.avg) : 0
    });
  }
  // ترتيب من الأحدث للأقدم بحسب رقم الحجز
  out.sort(function(a,b){ return String(b.bookingId).localeCompare(String(a.bookingId)); });
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── الاتفاقيات السابقة على حجز معيّن (يُعرض كتلميح داخل نموذج الاتفاقية الجديدة) ───
// يستخدم مباشرةً عند اختيار الحجز في dropdown النموذج لعرض ملخص ما سُجِّل عليه سابقاً + إجمالي الأفراد المرصود
function getNusukAgreementsForBooking(bookingId, currentUser) { _apiGuard_();
  var _fn="[getNusukAgreementsForBooking]"; _logInfo_(_fn, "START | "+"bookingId:"+String(JSON.stringify(bookingId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser,"nusuk","canView");
  return _nusukAgreementsForBooking_(bookingId);
  } catch(e) { _logError_(_fn, e); throw e; }
}
// V3.76 — تُرفق مع نداء فتح الحجز نفسه (نموذج التعديل ونافذة العرض) بدل نداء ثانٍ مستقل: null إن لم يملك المستخدم صلاحية نسك
function _nusukForBookingIfAllowed_(bookingId, currentUser) {
  try { _requirePermission_(currentUser,"nusuk","canView"); } catch (e) { return null; }
  try { return _nusukAgreementsForBooking_(bookingId); } catch (e2) { return { agreements: [], totalPersons: 0 }; }
}
function _nusukAgreementsForBooking_(bookingId) {
  var _fn="[_nusukAgreementsForBooking_]";
  try {
  var data=_getSheetValues_("Nusuk_Agreements");
  var tz=_tz_();
  var out=[], totalPersons=0;
  for (var i=1; i<data.length; i++) {
    var row=data[i];
    if (!row[0]||row[12]===true) continue;
    if (String(row[2])!==String(bookingId)) continue;
    var ci=row[5] instanceof Date?row[5]:new Date(row[5]);
    var co=row[6] instanceof Date?row[6]:new Date(row[6]);
    var pc=parseFloat(row[4])||0;
    totalPersons+=pc;
    out.push({
      agreementId:row[0], hotelName:row[1], bookingId:row[2],
      agreementNumber:String(row[3]||""), personsCount:pc,
      checkIn:_fmtDate_(ci,tz,"dd/MM/yyyy"),
      checkOut:_fmtDate_(co,tz,"dd/MM/yyyy"),
      nights:row[7]||0
    });
  }
  return { agreements:out, totalPersons:totalPersons };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── حفظ اتفاقية نسك (جديدة أو تعديل موجودة) + تحويل حالة الحجز الأصلي لـ"مؤكد نسك" تلقائياً ───
// عند تسجيل أول اتفاقية على حجز: تُحدَّث حالة الحجز في Bookings_Master من (مبدئي/مؤكد/…) إلى "مؤكد نسك" مباشرة
// لا يُعطَّل التسجيل إذا تجاوز عدد الأفراد الحد النظري — التحقق يكون كتلميح على الواجهة فقط
function saveNusukAgreement(a, currentUser) { _apiGuard_();
  var _fn="[saveNusukAgreement]"; _logInfo_(_fn, "START | "+"a:"+String(JSON.stringify(a)||"").slice(0, 120)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Nusuk_Agreements");
  _invalidateSheetCache_("Bookings_Master"); // لأن حالة الحجز قد تتغير
  _requirePermission_(currentUser,"nusuk", a.editId?"canEdit":"canAdd");

  // التحقق من الصلاحيات على مستوى الفندق
  var allowed=_getUserAllowedHotels_(currentUser);
  var hotelName=String(a.hotelName||"").trim();
  if (!hotelName) throw new Error("اسم الفندق مطلوب.");
  if (allowed && !allowed[hotelName]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");

  var bookingId=String(a.bookingId||"").trim();
  var agreementNumber=String(a.agreementNumber||"").trim();
  var personsCount=parseInt(a.personsCount,10);

  if (!bookingId) throw new Error("رقم الحجز مطلوب.");
  if (!agreementNumber) throw new Error("رقم الاتفاقية مطلوب.");
  if (!(personsCount>0)) throw new Error("عدد الأفراد يجب أن يكون أكبر من صفر.");

  var checkIn=new Date(a.checkIn), checkOut=new Date(a.checkOut);
  if (isNaN(checkIn.getTime())||isNaN(checkOut.getTime())) throw new Error("تاريخ دخول/خروج الاتفاقية غير صحيح.");
  if (checkOut<=checkIn) throw new Error("تاريخ الخروج يجب أن يكون بعد تاريخ الدخول.");
  var nights=Math.round((checkOut-checkIn)/86400000);

  // التحقق أن الحجز موجود ولنفس الفندق (منع التلاعب من طلب مباشر بلا واجهة)
  var bookingsSheet=_getOrCreateSheet_("Bookings_Master");
  var bookingsData=bookingsSheet.getDataRange().getValues();
  var hotelMap=_buildContractHotelMap_();
  var bookingRowNum=-1, bookingOldStatus="";
  for (var i=1; i<bookingsData.length; i++) {
    var brow=bookingsData[i];
    if (!brow[0]||brow[14]===true) continue;
    if (String(brow[0])!==bookingId) continue;
    var bhn=hotelMap[brow[1]]||"";
    if (bhn!==hotelName) throw new Error("رقم الحجز لا يخص الفندق المحدد.");
    bookingRowNum=i+1;
    bookingOldStatus=String(brow[4]||"");
    break;
  }
  if (bookingRowNum<0) throw new Error("رقم الحجز غير موجود أو محذوف.");

  var sheet=_getOrCreateSheet_("Nusuk_Agreements");
  var tz=_tz_();
  var now=new Date();

  if (a.editId) {
    // تعديل اتفاقية موجودة
    var data=sheet.getDataRange().getValues();
    for (var j=1; j<data.length; j++) {
      if (String(data[j][0])!==String(a.editId)) continue;
      var oldRow=data[j], rowNum=j+1;
      var comparisons=[
        {label:"رقم الحجز",     old:oldRow[2],                                                              new:bookingId},
        {label:"رقم الاتفاقية", old:String(oldRow[3]||""),                                                  new:agreementNumber},
        {label:"عدد الأفراد",   old:parseFloat(oldRow[4])||0,                                                new:personsCount},
        {label:"تاريخ الدخول",  old:_fmtDate_(new Date(oldRow[5]),tz,"dd/MM/yyyy"),              new:_fmtDate_(checkIn,tz,"dd/MM/yyyy")},
        {label:"تاريخ الخروج",  old:_fmtDate_(new Date(oldRow[6]),tz,"dd/MM/yyyy"),              new:_fmtDate_(checkOut,tz,"dd/MM/yyyy")}
      ];
      var changedParts=[];
      comparisons.forEach(function(cmp){
        if (String(cmp.old)!==String(cmp.new)) {
          logAudit("نسك","تعديل اتفاقية",a.editId,cmp.label,cmp.old,cmp.new,cmp.label+": "+cmp.old+" ← "+cmp.new,currentUser);
          changedParts.push(cmp.label+": "+cmp.old+" ← "+cmp.new);
        }
      });
      var editSummary=changedParts.length
        ?(changedParts.join(" | ")+" — "+_fmtDate_(now,tz,"dd/MM/yyyy HH:mm")+" — "+currentUser)
        :oldRow[11];
      sheet.getRange(rowNum,2,1,7).setValues([[hotelName,bookingId,agreementNumber,personsCount,checkIn,checkOut,nights]]);
      sheet.getRange(rowNum,12).setValue(editSummary);
      // سجل موازٍ في سجل الحجز عند تعديل الاتفاقية (يظهر في سجل تعديلات الحجز)
      if (changedParts.length) {
        logAudit("الحجوزات","تعديل اتفاقية نسك",bookingId,"اتفاقية نسك",oldRow[3],agreementNumber,
          "تعديل اتفاقية نسك رقم "+agreementNumber+" — "+changedParts.join(" | "), currentUser);
      }
      return {success:true, agreementId:a.editId, statusChanged:false};
    }
    throw new Error("لم يتم العثور على الاتفاقية المطلوب تعديلها.");
  } else {
    // اتفاقية جديدة
    var agreementId=_getNextPlainNumber_("NUSUK",4);
    sheet.appendRow([agreementId,hotelName,bookingId,agreementNumber,personsCount,checkIn,checkOut,nights,"",currentUser,now,"",false]);
    var summaryText = "اتفاقية جديدة رقم "+agreementNumber+" على الحجز "+bookingId+" — "+personsCount+" فرد — "+nights+" ليلة";
    logAudit("نسك","إنشاء اتفاقية",agreementId,"","","", summaryText, currentUser);
    // سجل موازٍ في سجل الحجز نفسه ليظهر في سجل تعديلات الحجز مباشرة
    logAudit("الحجوزات","تسجيل اتفاقية نسك",bookingId,"اتفاقية نسك","","+ "+agreementNumber,
      "تسجيل اتفاقية نسك رقم "+agreementNumber+" — "+personsCount+" فرد — من "+_fmtDate_(checkIn,tz,"dd/MM/yyyy")+" إلى "+_fmtDate_(checkOut,tz,"dd/MM/yyyy"), currentUser);

    // تحديث حالة الحجز الأصلي لـ"مؤكد نسك" مباشرة إن لم تكن كذلك (السلوك المُقر مع المستخدم)
    var statusChanged=false;
    if (bookingOldStatus!=="مؤكد نسك") {
      bookingsSheet.getRange(bookingRowNum, 5).setValue("مؤكد نسك"); // العمود 5 = Status
      logAudit("الحجوزات","تحديث تلقائي",bookingId,"الحالة",bookingOldStatus,"مؤكد نسك",
        "تم تحديث حالة الحجز تلقائياً إلى \"مؤكد نسك\" بسبب تسجيل اتفاقية "+agreementNumber,currentUser);
      statusChanged=true;
    }
    return {success:true, agreementId:agreementId, statusChanged:statusChanged, newStatus:"مؤكد نسك"};
  }

  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── حذف (منطقي) اتفاقية نسك ───
function deleteNusukAgreement(agreementId, currentUser) { _apiGuard_();
  var _fn="[deleteNusukAgreement]"; _logInfo_(_fn, "START | "+"agreementId:"+String(JSON.stringify(agreementId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  return _withLock_(function() {
  _invalidateSheetCache_("Nusuk_Agreements");
  _requirePermission_(currentUser,"nusuk","canDelete");
  var sheet=_getOrCreateSheet_("Nusuk_Agreements");
  var data=sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])!==String(agreementId)) continue;
    if (data[i][12]===true) throw new Error("الاتفاقية محذوفة مسبقاً.");
    sheet.getRange(i+1, 13).setValue(true); // Is_Deleted (العمود 13)
    logAudit("نسك","حذف اتفاقية",agreementId,"","","",
      "حذف الاتفاقية رقم "+data[i][3]+" على الحجز "+data[i][2], currentUser);
    return {success:true};
  }
  throw new Error("لم يتم العثور على الاتفاقية.");
  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── تفاصيل اتفاقية واحدة (لعرضها في نافذة تفاصيل الاتفاقية) ───
function getNusukAgreementDetails(agreementId, currentUser) { _apiGuard_();
  var _fn="[getNusukAgreementDetails]"; _logInfo_(_fn, "START | "+"agreementId:"+String(JSON.stringify(agreementId)||"").slice(0, 80)+", "+"currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser,"nusuk","canView");
  var data=_getSheetValues_("Nusuk_Agreements");
  var tz=_tz_();
  var found=null;
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0])===String(agreementId) && data[i][12]!==true) {
      var row=data[i];
      var ci=row[5] instanceof Date?row[5]:new Date(row[5]);
      var co=row[6] instanceof Date?row[6]:new Date(row[6]);
      var ca=row[10] instanceof Date?row[10]:new Date(row[10]);
      found = {
        agreementId:row[0], hotelName:row[1], bookingId:row[2],
        agreementNumber:String(row[3]||""), personsCount:parseFloat(row[4])||0,
        checkIn:_fmtDate_(ci,tz,"dd/MM/yyyy"),
        checkOut:_fmtDate_(co,tz,"dd/MM/yyyy"),
        checkInIso:_fmtDate_(ci,tz,"yyyy-MM-dd"),
        checkOutIso:_fmtDate_(co,tz,"yyyy-MM-dd"),
        nights:row[7]||0,
        createdBy:row[9], createdAt:_fmtDate_(ca,tz,"dd/MM/yyyy HH:mm"),
        lastEditSummary:row[11]||""
      };
      break;
    }
  }
  if (!found) throw new Error("لم يتم العثور على الاتفاقية.");

  // نضم بيانات الحجز المرتبط (يفيد نافذة التفاصيل)
  var bookingsData=_getSheetValues_("Bookings_Master");
  var hotelMap=_buildContractHotelMap_();
  var collMap=_buildCollectionAccountMap_();
  for (var b=1; b<bookingsData.length; b++) {
    var brow=bookingsData[b];
    if (!brow[0]||brow[14]===true) continue;
    if (String(brow[0])!==String(found.bookingId)) continue;
    var bci=brow[6] instanceof Date?brow[6]:new Date(brow[6]);
    var bco=brow[7] instanceof Date?brow[7]:new Date(brow[7]);
    found.booking = {
      bookingId:brow[0], contractId:brow[1],
      hotelName:hotelMap[brow[1]]||"",
      clientName:brow[2], collectionAccount:collMap[brow[3]]||brow[3],
      status:brow[4], roomCount:brow[5],
      checkIn:_fmtDate_(bci,tz,"dd/MM/yyyy"),
      checkOut:_fmtDate_(bco,tz,"dd/MM/yyyy"),
      nights:brow[8]
    };
    break;
  }
  return found;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ─── بيانات شبكة الأيام لشاشة نسك ───
// المدخلات: اسم الفندق، تاريخ بداية وتاريخ نهاية العرض (ISO yyyy-MM-dd)، مرشحات اختيارية
// الإخراج: dailyCapacity[] بالأفراد + dailyBooked[] بالأفراد + رؤوس أيام + صفوف الاتفاقيات مع dayValues[]
function getNusukGridData(hotelName, startDateIso, endDateIso, filters, currentUser) { _apiGuard_();
  var _fn="[getNusukGridData]"; _logInfo_(_fn, "START | "+"hotelName:"+String(JSON.stringify(hotelName)||"").slice(0, 80)+", "+"startDate:"+startDateIso+", "+"endDate:"+endDateIso+", currentUser:"+String(JSON.stringify(currentUser)||"").slice(0, 80));
  try {
  _requirePermission_(currentUser,"nusuk","canView");
  if (!hotelName) return null;
  var allowed=_getUserAllowedHotels_(currentUser);
  if (allowed && !allowed[hotelName]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");

  var tz=_tz_();
  // 1) بناء السعة اليومية بالأفراد (لكل عقد سارٍ في اليوم: غرف العقد × متوسط تسكين نسك)
  // نجمع العقود أولاً لأننا نحتاج نطاق تواريخها لحساب الفترة الافتراضية عند ترك أحد التاريخين فارغاً
  var contractsData=_getSheetValues_("Contracts_Master");
  var hotelContracts=[], hotelContractIds={};
  var minContractDate=null, maxContractDate=null;
  for (var i=1; i<contractsData.length; i++) {
    var crow=contractsData[i];
    if (!crow[0]||crow[12]===true||crow[1]!==hotelName) continue;
    var rooms=parseFloat(crow[6])||0;
    var nusukCap=parseFloat(crow[17])||0;
    var avg=(nusukCap>0&&rooms>0)?(nusukCap/rooms):0;
    var cStart=_dateOnly_(crow[3] instanceof Date?crow[3]:new Date(crow[3]));
    var cEnd=_dateOnly_(crow[4] instanceof Date?crow[4]:new Date(crow[4]));
    hotelContracts.push({ startDate:cStart, endDate:cEnd, dailyPersonsCap: rooms*avg });
    hotelContractIds[crow[0]]=true;
    if (!minContractDate || cStart<minContractDate) minContractDate=cStart;
    if (!maxContractDate || cEnd>maxContractDate) maxContractDate=cEnd;
  }

  // دعم الفترة المفتوحة: عند ترك أحد التاريخين فارغاً، نستبدله بأقصى/أقل تاريخ عقد للفندق
  // إذا لم يكن للفندق عقود، نُرجع بيانات فارغة (لا يمكن استنتاج الفترة)
  var startDate = (startDateIso && String(startDateIso).trim()) ? _dateOnly_(new Date(startDateIso)) : minContractDate;
  var endDate   = (endDateIso   && String(endDateIso).trim())   ? _dateOnly_(new Date(endDateIso))   : maxContractDate;
  if (!startDate || !endDate) {
    return { hotelName:hotelName, startDate:"", endDate:"", totalDays:0, dayHeaders:[], dailyCapacity:[], dailyBooked:[], agreementRows:[] };
  }
  if (isNaN(startDate.getTime())||isNaN(endDate.getTime())) throw new Error("تواريخ العرض غير صحيحة.");
  if (endDate<startDate) throw new Error("تاريخ نهاية العرض يجب أن يكون بعد البداية.");
  var totalDays=Math.round((endDate-startDate)/86400000)+1;
  if (totalDays>365) throw new Error("لا يمكن عرض أكثر من 365 يوماً في نافذة واحدة. اختر فترة أقصر.");
  var dailyCapacity=new Array(totalDays).fill(0);
  for (var d=0; d<totalDays; d++) {
    var dd=new Date(startDate.getTime()+d*86400000);
    for (var hc=0; hc<hotelContracts.length; hc++) {
      var hcc=hotelContracts[hc];
      if (_contractCoversNight_(hcc, dd)) dailyCapacity[d]+=hcc.dailyPersonsCap;
    }
    dailyCapacity[d]=Math.round(dailyCapacity[d]); // نعرضها كأعداد صحيحة بالأفراد
  }

  // 2) بناء الحجوزات كخريطة لسرعة الوصول (لكل اتفاقية نحتاج بيانات حجزها)
  var bookingsData=_getSheetValues_("Bookings_Master");
  var collMap=_buildCollectionAccountMap_();
  var bookingsMap={};
  for (var j=1; j<bookingsData.length; j++) {
    var brow=bookingsData[j];
    if (!brow[0]||brow[14]===true) continue;
    if (!hotelContractIds[brow[1]]) continue;
    bookingsMap[String(brow[0])]={
      bookingId:brow[0], contractId:brow[1],
      clientName:brow[2],
      collectionAccount:collMap[brow[3]]||brow[3],
      status:brow[4], roomCount:parseFloat(brow[5])||0,
      checkIn:brow[6] instanceof Date?brow[6]:new Date(brow[6]),
      checkOut:brow[7] instanceof Date?brow[7]:new Date(brow[7]),
      nights:brow[8]
    };
  }

  // 3) قراءة الاتفاقيات وتوليد صف/dayValues لكل واحدة داخل نافذة العرض
  var agreementsData=_getSheetValues_("Nusuk_Agreements");
  var dailyBooked=new Array(totalDays).fill(0);
  var agreementRows=[];

  // تجهيز المرشحات
  filters = filters || {};
  var fStatus = (filters.status||"").trim();
  var fClient = (filters.clientName||"").trim().toLowerCase();
  var fColl   = (filters.collectionAccount||"").trim();
  var fAgree  = (filters.agreementNumber||"").trim();
  var fBooking= (filters.bookingId||"").trim();
  var fFromIso= (filters.fromDate||"").trim();
  var fToIso  = (filters.toDate||"").trim();
  var fFromDt = fFromIso ? _dateOnly_(new Date(fFromIso)) : null;
  var fToDt   = fToIso   ? _dateOnly_(new Date(fToIso))   : null;

  for (var k=1; k<agreementsData.length; k++) {
    var arow=agreementsData[k];
    if (!arow[0]||arow[12]===true) continue;
    if (String(arow[1])!==hotelName) continue;
    var book=bookingsMap[String(arow[2])];
    if (!book) continue; // اتفاقية على حجز محذوف/غير موجود
    var aci=_dateOnly_(arow[5] instanceof Date?arow[5]:new Date(arow[5]));
    var aco=_dateOnly_(arow[6] instanceof Date?arow[6]:new Date(arow[6]));
    if (aco<=startDate||aci>endDate) continue; // خارج النافذة تماماً
    var pc=parseFloat(arow[4])||0;
    var agreementNumber=String(arow[3]||"");

    // تطبيق الفلاتر
    if (fStatus && String(book.status)!==fStatus) continue;
    if (fClient && String(book.clientName||"").toLowerCase().indexOf(fClient)<0) continue;
    if (fColl && String(book.collectionAccount)!==fColl) continue;
    if (fAgree && agreementNumber.indexOf(fAgree)<0) continue;
    if (fBooking && String(book.bookingId)!==fBooking) continue;
    if (fFromDt && aco<fFromDt) continue;
    if (fToDt && aci>fToDt) continue;

    // dayValues للاتفاقية (رقم الأفراد إن كان اليوم داخل [checkIn, checkOut) أو "*" لليوم الأخير)
    var dayValues=[];
    for (var d2=0; d2<totalDays; d2++) {
      var dd2=new Date(startDate.getTime()+d2*86400000);
      if (dd2>=aci && dd2<aco) { dailyBooked[d2]+=pc; dayValues.push(String(pc)); }
      else if (dd2.getTime()===aco.getTime()) dayValues.push("*");
      else dayValues.push("");
    }

    agreementRows.push({
      agreementId:arow[0],
      agreementNumber:agreementNumber,
      bookingId:book.bookingId,
      clientName:book.clientName,
      collectionAccount:book.collectionAccount,
      bookingStatus:book.status,
      bookingRoomCount:book.roomCount,
      bookingCheckIn:_fmtDate_(book.checkIn,tz,"dd/MM/yyyy"),
      bookingCheckOut:_fmtDate_(book.checkOut,tz,"dd/MM/yyyy"),
      personsCount:pc,
      checkIn:_fmtDate_(aci,tz,"dd/MM/yyyy"),
      checkOut:_fmtDate_(aco,tz,"dd/MM/yyyy"),
      // dd/mm لعرض مختصر داخل السطر عند إخفاء الصف
      checkInShort:_fmtDate_(aci,tz,"dd/MM"),
      checkOutShort:_fmtDate_(aco,tz,"dd/MM"),
      nights:arow[7]||0,
      dayValues:dayValues
    });
  }

  // 4) رؤوس الأيام
  var EN_DAY_ABBR=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var todayStr=_dateOnly_(new Date()).toDateString();
  var dayHeaders=[];
  for (var d3=0; d3<totalDays; d3++) {
    var dd3=new Date(startDate.getTime()+d3*86400000);
    var h3=_gregorianToHijri_(dd3);
    dayHeaders.push({
      day:dd3.getDate(),
      month:dd3.getMonth()+1,
      dayNameEn:EN_DAY_ABBR[dd3.getDay()],
      isToday:dd3.toDateString()===todayStr,
      isFriday:dd3.getDay()===5,
      hijriDay:h3.day, hijriMonth:h3.month, hijriYear:h3.year, hijriMonthName:h3.monthName
    });
  }

  return {
    hotelName:hotelName,
    startDate:_fmtDate_(startDate,tz,"dd/MM/yyyy"),
    endDate:_fmtDate_(endDate,tz,"dd/MM/yyyy"),
    totalDays:totalDays,
    dayHeaders:dayHeaders,
    dailyCapacity:dailyCapacity,
    dailyBooked:dailyBooked,
    agreementRows:agreementRows
  };
  } catch(e) { _logError_(_fn, e); throw e; }
}
/**
 * ======================================================================
 * 12. شاشة الحسابات (جهات التحصيل / العملاء) — كل المبالغ بالريال السعودي (ر.س)
 * ======================================================================
 * الفكرة: كل حجز غير ملغي يمثّل مبلغاً مستحقاً (مدين) على جهة التحصيل أو العميل،
 * وكل دفعة مسجَّلة في Account_Payments تمثّل سداداً (دائن).
 * الرصيد = إجمالي المستحق - إجمالي المسدد (موجب = مدين "عليه"، سالب = دائن "له").
 */

// v3.33 — يحوّل تاريخ ISO اختيارياً (من فلتر الفترة بأي كشف حساب) إلى حد Date يومي شامل، أو null لفترة مفتوحة
// isEnd غير مستخدَم حالياً (كلا الحدين date-only) لكنه يُبقي التوقيع واضحاً للقراءة عند الاستدعاء
function _parseStatementDateBound_(iso, isEnd) {
  iso = String(iso||"").trim();
  if (!iso) return null;
  var d = _dateOnly_(new Date(iso+"T00:00:00"));
  return isNaN(d.getTime()) ? null : d;
}

// دالة مساعدة داخلية: تجمع مستحقات الحجوزات (غير المحذوفة وغير الملغية) لكل طرف حسب نوعه
// partyType: "collection" → التجميع على جهة التحصيل (Account_ID)، "client" → التجميع على اسم العميل
// hotelFilter (اختياري) — v3.23: يقصر الاحتساب على فندق واحد بعينه فقط
// fromDate/toDate (اختياريان) — v3.33: يقصران الاحتساب على حجوزات دخولها ضمن فترة معيّنة (فترة مفتوحة الطرفين افتراضياً)
// extra (اختياري) — V3.73: يُملأ بعدد الحجوزات الملغية/المحذوفة لكل طرف (بلا فلتر الفترة) — لشرح سبب ظهور طرف "بلا حجوزات" بالشاشة
function _buildAccountsDueMap_(partyType, allowed, hotelFilter, fromDate, toDate, extra) {
  var data = _getSheetValues_("Bookings_Master");
  var hotelMap = _buildContractHotelMap_();
  var collMap = _buildCollectionAccountMap_();
  var map = {}; // key → {name, totalDue, bookingsCount}
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    var _isDel = row[14]===true, _isCan = String(row[4]) === "ملغي";
    if ((_isDel || _isCan) && !extra) continue;        // المحذوف والملغي لا يدخلان الحسابات
    var hn = hotelMap[row[1]] || "";
    if (allowed && !allowed[hn]) continue;       // تصفية الفنادق المسموح بها لغير المدير
    if (hotelFilter && hn !== hotelFilter) continue;   // فلتر الفندق المُختار بشاشة الحسابات
    if (_isDel || _isCan) {
      var _k = String((partyType === "collection" ? row[3] : row[2]) || "").trim();
      if (_k) { var _b = _isDel ? extra.deleted : extra.cancelled; _b[_k] = (_b[_k] || 0) + 1; }
      continue;
    }
    if (fromDate || toDate) {
      var ciD = row[6] instanceof Date ? row[6] : new Date(row[6]);
      if (fromDate && ciD < fromDate) continue;
      if (toDate && ciD > toDate) continue;
    }
    var key, name;
    if (partyType === "collection") {
      key = String(row[3]||"").trim(); if (!key) continue;
      name = collMap[key] || key;
    } else {
      key = String(row[2]||"").trim(); if (!key) continue;
      name = key;
    }
    if (!map[key]) map[key] = { name: name, totalDue: 0, bookingsCount: 0 };
    map[key].totalDue += parseFloat(row[10]) || 0;     // قيمة الحجز (ر.س)
    map[key].bookingsCount++;
  }
  return map;
}

// دالة مساعدة داخلية: تجمع الدفعات المسدَّدة (غير المحذوفة) لكل طرف حسب نوعه من شيت Account_Payments
// allowed (اختياري) — تُستبعد الدفعات المخصَّصة صراحة لفندق خارج نطاق المستخدم؛ الدفعات العامة (بلا فندق محدَّد)
// تبقى ظاهرة دائماً لكل من يملك صلاحية "الحسابات" بصرف النظر عن قيود الفنادق (لا يمكن الجزم بانتمائها لفندق مقيَّد)
// hotelFilter (اختياري) — v3.23: يقصر الاحتساب على الدفعات المخصَّصة لهذا الفندق تحديداً فقط (يستبعد الدفعات العامة أيضاً)
// fromDate/toDate (اختياريان) — v3.33: يقصران الاحتساب على دفعات بتاريخ ضمن فترة معيّنة (فترة مفتوحة الطرفين افتراضياً)
function _buildAccountsPaidMap_(partyType, allowed, hotelFilter, fromDate, toDate) {
  var data = _getSheetValues_("Account_Payments");
  var map = {}; // key → {name, totalPaid}
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (!row[0] || row[10]===true) continue;
    if (String(row[1]) !== partyType) continue;
    var payHotel = String(row[11]||"").trim();
    if (payHotel && allowed && !allowed[payHotel]) continue;
    if (hotelFilter && payHotel !== hotelFilter) continue;
    if (fromDate || toDate) {
      var pdD = row[5] instanceof Date ? row[5] : new Date(row[5]);
      if (fromDate && pdD < fromDate) continue;
      if (toDate && pdD > toDate) continue;
    }
    var key = String(row[2]||"").trim(); if (!key) continue;
    if (!map[key]) map[key] = { name: String(row[3]||key), totalPaid: 0, count: 0 };
    map[key].totalPaid += parseFloat(row[4]) || 0;
    map[key].count++;
  }
  return map;
}

// v3.33 — نفس فكرة الدالتين أعلاه لكن لكشف حساب الفنادق: التجميع على اسم الفندق نفسه
// المدين = قيمة تعاقدات الفندق (Contracts_Master)، الدائن = دفعات السداد الفعلية المرتبطة بتعاقداته (Contract_Payment_Receipts)
function _buildHotelDueMap_(allowed, fromDate, toDate) {
  var data = _getSheetValues_("Contracts_Master");
  var map = {}; // hotelName → {name, totalDue, bookingsCount(=عدد التعاقدات)}
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (!row[0] || row[12]===true) continue; // محذوف
    var hn = String(row[1]||"").trim(); if (!hn) continue;
    if (allowed && !allowed[hn]) continue;
    var sd = row[3] instanceof Date ? row[3] : new Date(row[3]);
    if (fromDate && sd < fromDate) continue;
    if (toDate && sd > toDate) continue;
    if (!map[hn]) map[hn] = { name: hn, totalDue: 0, bookingsCount: 0 };
    map[hn].totalDue += parseFloat(row[8]) || 0; // Total_Value
    map[hn].bookingsCount++;
  }
  return map;
}
function _buildHotelPaidMap_(allowed, fromDate, toDate) {
  var hotelMap = _buildContractHotelMap_();
  var data = _getSheetValues_("Contract_Payment_Receipts");
  var map = {};
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (!row[0] || row[9]===true) continue;
    var hn = hotelMap[row[2]]; if (!hn) continue;
    if (allowed && !allowed[hn]) continue;
    var pd = row[4] instanceof Date ? row[4] : new Date(row[4]);
    if (fromDate && pd < fromDate) continue;
    if (toDate && pd > toDate) continue;
    if (!map[hn]) map[hn] = { name: hn, totalPaid: 0 };
    map[hn].totalPaid += parseFloat(row[3]) || 0;
  }
  return map;
}

// يُعيد ملخص الحسابات لكل الأطراف (جهات تحصيل أو عملاء أو فنادق): المستحق/المسدد/الرصيد لكل طرف — بالريال السعودي
// hotelFilter (اختياري) — v3.23: يقصر الملخص كاملاً على فندق واحد بعينه (المستحق من حجوزاته + المسدد من الدفعات المخصَّصة له) — غير مستخدَم مع partyType="hotel"
// fromIso/toIso (اختياريان) — v3.33: فلتر فترة (خلال فترة / مفتوحة البداية / مفتوحة النهاية) يُطبَّق على كل الأنواع الثلاثة
// partyType="hotel" — v3.33: كشف حساب كل فندق (مدين = قيمة تعاقداته، دائن = دفعات سداده الفعلية) يتطلب أيضاً صلاحية الجانب المالي
function getAccountsSummary(partyType, currentUser, hotelFilter, fromIso, toIso) { _apiGuard_();
  var _fn="[getAccountsSummary]"; _logInfo_(_fn, "START | partyType:"+partyType+", currentUser:"+String(JSON.stringify(currentUser)||"").slice(0,80)+", hotelFilter:"+String(JSON.stringify(hotelFilter)||"").slice(0,80));
  try {
  _requirePermission_(currentUser, "accounts", "canView");
  var allowed = _getUserAllowedHotels_(currentUser);
  var fromDate = _parseStatementDateBound_(fromIso, false);
  var toDate = _parseStatementDateBound_(toIso, true);

  if (partyType === "hotel") {
    _requireFinancePermission_(currentUser); // بيانات مالية لتعاقدات الفندق — تتطلب صلاحية الجانب المالي أيضاً
    var dueMapH = _buildHotelDueMap_(allowed, fromDate, toDate);
    var paidMapH = _buildHotelPaidMap_(allowed, fromDate, toDate);
    var keysH = {};
    Object.keys(dueMapH).forEach(function(k){ keysH[k]=true; });
    Object.keys(paidMapH).forEach(function(k){ keysH[k]=true; });
    var outH = [];
    Object.keys(keysH).forEach(function(k) {
      var due = dueMapH[k] ? dueMapH[k].totalDue : 0;
      var paid = paidMapH[k] ? paidMapH[k].totalPaid : 0;
      outH.push({
        partyKey: k, partyName: k,
        bookingsCount: dueMapH[k] ? dueMapH[k].bookingsCount : 0,
        totalDue: Math.round(due*100)/100,
        totalPaid: Math.round(paid*100)/100,
        balance: Math.round((due-paid)*100)/100
      });
    });
    // V3.78 — المتأخر حتى اليوم وأقرب استحقاق لكل فندق (خصم بالأقدمية). بلا فلتر فترة فقط: الحساب يحتاج كل التاريخ
    if (!fromDate && !toDate) {
      try {
        var sch = _hotelSchedulesFifo_(allowed, null);
        outH.forEach(function(o) { var s = sch[o.partyKey]; if (s) o.sched = { overdue: s.overdue, overdueCount: s.overdueCount, oldestOverdue: s.oldestOverdue, next30: s.next30, nextDue: s.nextDue }; });
      } catch (eS) { _logError_("[getAccountsSummary→sched]", eS); }
    }
    outH.sort(function(a,b){ return String(a.partyName).localeCompare(String(b.partyName), 'ar'); });
    return outH;
  }

  partyType = (partyType === "client") ? "client" : "collection";
  hotelFilter = String(hotelFilter||"").trim();
  if (hotelFilter && allowed && !allowed[hotelFilter]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
  var extra = { cancelled: {}, deleted: {} };
  var dueMap = _buildAccountsDueMap_(partyType, allowed, hotelFilter, fromDate, toDate, extra);
  var paidMap = _buildAccountsPaidMap_(partyType, allowed, hotelFilter, fromDate, toDate);
  // دمج المفاتيح من الجانبين (طرف له دفعات دون حجوزات يظهر أيضاً)
  var keys = {};
  Object.keys(dueMap).forEach(function(k){ keys[k]=true; });
  Object.keys(paidMap).forEach(function(k){ keys[k]=true; });
  var out = [];
  Object.keys(keys).forEach(function(k) {
    var due = dueMap[k] ? dueMap[k].totalDue : 0;
    var paid = paidMap[k] ? paidMap[k].totalPaid : 0;
    var o = {
      partyKey: k,
      partyName: (dueMap[k] && dueMap[k].name) || (paidMap[k] && paidMap[k].name) || k,
      bookingsCount: dueMap[k] ? dueMap[k].bookingsCount : 0,
      totalDue: Math.round(due*100)/100,
      totalPaid: Math.round(paid*100)/100,
      balance: Math.round((due-paid)*100)/100
    };
    // V3.73 — طرف بلا حجوزات سارية يظهر لأن له دفعات مسجَّلة: نُرفق السبب ليُعرض بجواره (عدد الدفعات + ما أُلغي/حُذف من حجوزاته)
    if (!o.bookingsCount) { o.paymentsCount = paidMap[k] ? paidMap[k].count : 0; o.cancelledCount = extra.cancelled[k] || 0; o.deletedCount = extra.deleted[k] || 0; }
    out.push(o);
  });
  out.sort(function(a,b){ return String(a.partyName).localeCompare(String(b.partyName), 'ar'); });
  return out;
  } catch(e) { _logError_(_fn, e); throw e; }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// V3.78 — جدول استحقاقات الفندق (خصم بالأقدمية — FIFO) على مستوى كل تعاقداته معاً
// كل أقساط تعاقدات الفندق (+ ما لم يُجدوَل من قيمة كل تعاقد كبند بتاريخ بدايته) مرتبة بتاريخ الاستحقاق، ويُخصم إجمالي ما سُدِّد
// فعلاً للفندق منها بالترتيب (الأقدم أولاً) بصرف النظر عن القسط الذي سُجّلت عليه الدفعة. فيظهر لكل قسط: المخصوم منه، المتبقي عليه،
// حالته (مسدد بالكامل/جزئياً/متأخر/قادم)، تاريخ اكتمال سداده، والمتبقي التراكمي حتى استحقاقه.
// لا فلتر فترة: الخصم بالأقدمية يحتاج كل التاريخ. التعاقدات المحذوفة ودفعاتها مستبعدة (كما في كشف الحساب).
// ══════════════════════════════════════════════════════════════════════════════════════════════════
function _hotelSchedulesFifo_(allowed, onlyHotel) {
  var tz = _tz_(), today = _dateOnly_(new Date()), todayT = today.getTime(), in30 = todayT + 30 * 86400000;
  var cData = _getSheetValues_("Contracts_Master"), pData = _getSheetValues_("Contract_Payments"), rData = _getSheetValues_("Contract_Payment_Receipts");
  var toD = function(v) { var d = v instanceof Date ? v : (v ? new Date(v) : null); return (d && !isNaN(d.getTime())) ? _dateOnly_(d) : null; };
  var fmt = function(t) { return t ? _fmtDate_(new Date(t), tz, "dd/MM/yyyy") : ""; };
  var r2 = function(x) { return Math.round(x * 100) / 100; };
  var idCmp = function(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); };
  var contracts = {}, hotels = {};
  for (var i = 1; i < cData.length; i++) {
    var c = cData[i]; if (!c[0] || c[12] === true) continue;
    var hn = String(c[1] || "").trim(); if (!hn) continue;
    if (onlyHotel && hn !== onlyHotel) continue;
    if (allowed && !allowed[hn]) continue;
    var sd = toD(c[3]), ed = toD(c[4]);
    contracts[String(c[0])] = { id: String(c[0]), hotel: hn, startT: sd ? sd.getTime() : 0, endT: ed ? ed.getTime() : 0, value: parseFloat(c[8]) || 0, scheduled: 0, type: String(c[14] || ""), parent: String(c[15] || "").trim() };
    if (!hotels[hn]) hotels[hn] = { items: [], receipts: [], warnings: [] };
  }
  for (var j = 1; j < pData.length; j++) {
    var p = pData[j]; if (!p[0] || p[9] === true) continue;
    var ct = contracts[String(p[1])]; if (!ct) continue;
    var amt = parseFloat(p[2]) || 0; if (!(amt > 0)) continue;
    var dd = toD(p[3]);
    ct.scheduled += amt;
    var pNotes = String(p[6] || "");
    hotels[ct.hotel].items.push({ kind: "installment", paymentId: String(p[0]), contractId: ct.id, amount: r2(amt), dueT: dd ? dd.getTime() : ct.startT, notes: pNotes,
      autoCreated: /^(قسط أُنشئ تلقائياً|دفعة مزدوجة من)/.test(pNotes) }); // V3.79 — أقساط أنشأها النظام قديماً من دفعات (ليست مستحقات فعلية)
  }
  // V3.79 — ما لم يُجدوَل يُحسب على مستوى الفندق لا كل تعاقد وحده: التعاقد الإضافي (أو أي تعاقد) قد تُسجَّل أقساطه ضمن أقساط
  // التعاقد الأساسي (توزيع تكلفة واحدة على فترتين)، فكان يظهر كامل قيمته "غير مجدول" مع أنه مغطّى. الزيادة في أقساط تعاقد تغطي
  // نقص غيره لنفس الفندق (الأقدم بداية أولاً)، ولا يظهر "غير مجدول" إلا ما يزيد به إجمالي قيم التعاقدات عن إجمالي الأقساط.
  Object.keys(hotels).forEach(function(hn) {
    var ids = Object.keys(contracts).filter(function(id) { return contracts[id].hotel === hn; })
      .sort(function(a, b) { return (contracts[a].startT - contracts[b].startT) || idCmp(a, b); });
    var surplus = 0, short = [];
    ids.forEach(function(id) { var ct = contracts[id], rest = r2(ct.value - ct.scheduled); if (rest < -0.005) surplus = r2(surplus - rest); else if (rest > 0.005) short.push({ id: id, rest: rest }); });
    short.forEach(function(x) {
      var cover = Math.min(surplus, x.rest); surplus = r2(surplus - cover); var left = r2(x.rest - cover);
      if (left > 0.005) hotels[hn].items.push({ kind: "unscheduled", paymentId: "", contractId: x.id, amount: left, dueT: contracts[x.id].startT, notes: "" });
    });
    if (surplus > 0.005) hotels[hn].warnings.push("إجمالي الأقساط المسجّلة يزيد عن إجمالي قيم تعاقدات الفندق بـ " + surplus.toLocaleString("en-US") + " ر.س — راجع الأقساط (خاصة ما أُنشئ تلقائياً من دفعات ⚙️).");
  });
  for (var k = 1; k < rData.length; k++) {
    var r = rData[k]; if (!r[0] || r[9] === true) continue;
    var rc = contracts[String(r[2])]; if (!rc) continue;
    var pd = toD(r[4]);
    hotels[rc.hotel].receipts.push({ amount: parseFloat(r[3]) || 0, t: pd ? pd.getTime() : 0, id: String(r[0]), paymentId: String(r[1] || ""), contractId: rc.id,
      statement: String(r[5] || ""), notes: String(r[6] || ""), createdBy: String(r[7] || ""), linked: String(r[10] || "") });
  }
  var out = {}, attMapS = _attCountMap_(), payerMapS = _accPayerMap_();
  Object.keys(hotels).forEach(function(hn) {
    var H = hotels[hn];
    H.items.sort(function(a, b) {
      return (a.dueT - b.dueT) || ((contracts[a.contractId].startT) - (contracts[b.contractId].startT)) || idCmp(a.contractId, b.contractId)
        || ((a.kind === "unscheduled" ? 1 : 0) - (b.kind === "unscheduled" ? 1 : 0)) || idCmp(a.paymentId, b.paymentId);
    });
    H.receipts.sort(function(a, b) { return (a.t - b.t) || idCmp(a.id, b.id); });
    var totalPaid = 0; H.receipts.forEach(function(x) { totalPaid += x.amount; }); totalPaid = r2(totalPaid);
    var pool = totalPaid, cumDue = 0, ri = 0, cumPaid = 0;
    var tot = { totalDue: 0, overdue: 0, next30: 0, paidCount: 0, partialCount: 0, openCount: 0, overdueCount: 0 }, nextDue = null, oldestOverdue = null;
    var items = H.items.map(function(it, idx) {
      var ct = contracts[it.contractId];
      cumDue = r2(cumDue + it.amount); tot.totalDue = r2(tot.totalDue + it.amount);
      var alloc = r2(Math.min(Math.max(pool, 0), it.amount)); pool = r2(pool - alloc);
      var remaining = r2(it.amount - alloc);
      // تاريخ اكتمال سداده = تاريخ الدفعة التي بلغ عندها إجمالي المسدد تراكمياً إجمالي المستحق حتى هذا القسط
      var settledT = 0;
      if (remaining <= 0.005) { while (ri < H.receipts.length && cumPaid < cumDue - 0.005) { cumPaid = r2(cumPaid + H.receipts[ri].amount); ri++; } if (cumPaid >= cumDue - 0.005 && ri > 0) settledT = H.receipts[ri - 1].t; }
      var status = remaining <= 0.005 ? "paid" : (alloc > 0.005 ? "partial" : "unpaid");
      var overdue = remaining > 0.005 && it.dueT && it.dueT < todayT;
      if (status === "paid") tot.paidCount++; else { tot.openCount++; if (status === "partial") tot.partialCount++; }
      if (overdue) { tot.overdue = r2(tot.overdue + remaining); tot.overdueCount++; if (!oldestOverdue) oldestOverdue = it.dueT; }
      if (remaining > 0.005 && it.dueT >= todayT && it.dueT < in30) tot.next30 = r2(tot.next30 + remaining);
      if (remaining > 0.005 && it.dueT >= todayT && !nextDue) nextDue = { date: fmt(it.dueT), amount: remaining };
      var lateDays = (it.kind === "installment" && settledT && it.dueT && settledT > it.dueT) ? Math.round((settledT - it.dueT) / 86400000) : 0; // غير المجدول بلا موعد فعلي: لا "تأخير"
      return {
        n: idx + 1, kind: it.kind, paymentId: it.paymentId, contractId: it.contractId,
        contractLabel: "تعاقد #" + it.contractId + (ct.type && ct.type !== "رئيسي" ? " (" + ct.type + ")" : ""),
        contractPeriod: fmt(ct.startT) + " ← " + fmt(ct.endT),
        dueDate: fmt(it.dueT), dueIso: it.dueT ? _fmtDate_(new Date(it.dueT), tz, "yyyy-MM-dd") : "", future: it.dueT >= todayT,
        amount: it.amount, allocated: alloc, remaining: remaining, status: status, overdue: !!overdue,
        overdueDays: overdue ? Math.round((todayT - it.dueT) / 86400000) : 0,
        settledOn: fmt(settledT), lateDays: lateDays, autoCreated: !!it.autoCreated,
        outstandingThrough: r2(Math.max(0, cumDue - totalPaid)), notes: it.notes
      };
    });
    // V3.78 — كل دفعات الفندق المسددة (للتعديل/النقل/الحذف من مستوى الفندق ككل) + تعاقداته (لقائمة النقل)
    var dueByPid = {}; H.items.forEach(function(it) { if (it.paymentId) dueByPid[it.paymentId] = it; });
    var receiptsOut = H.receipts.map(function(x) {
      var inst = dueByPid[x.paymentId];
      return { receiptId: x.id, amount: r2(x.amount), payDate: fmt(x.t), payDateIso: x.t ? _fmtDate_(new Date(x.t), tz, "yyyy-MM-dd") : "",
        statement: x.statement, notes: x.notes, createdBy: x.createdBy, linkedAccountPaymentId: x.linked,
        contractId: x.contractId, paymentId: x.paymentId, installmentDue: inst ? fmt(inst.dueT) : "", orphan: !!x.paymentId && !inst, unassigned: !x.paymentId,
        attCount: _attCount_(attMapS, "receipt", x.id, "account", x.linked),
        payerName: payerMapS[x.linked] ? payerMapS[x.linked].name : "", payerType: payerMapS[x.linked] ? payerMapS[x.linked].type : "" };
    });
    var contractsOut = Object.keys(contracts).filter(function(id) { return contracts[id].hotel === hn; })
      .sort(function(a, b) { return (contracts[a].startT - contracts[b].startT) || idCmp(a, b); })
      .map(function(id) { var ct = contracts[id]; return { contractId: id, label: "تعاقد #" + id + " (" + fmt(ct.startT) + " ← " + fmt(ct.endT) + ")", value: r2(ct.value), scheduled: r2(ct.scheduled) }; });
    // V3.82 — دفتر واحد مرتب زمنياً: الأقساط بتواريخ استحقاقها والدفعات بتواريخ سدادها، ومعه الرصيد التراكمي بعد كل سطر
    // (الأقساط − الدفعات حتى ذلك السطر). عند تساوي التاريخ تسبق الدفعةُ القسطَ (كما في كشف المستخدم). بنود الخصم بالأقدمية (items) كما هي.
    var ledRaw = [];
    items.forEach(function(o, i) { ledRaw.push({ type: "due", t: H.items[i].dueT || 0, seq: i, o: o }); });
    receiptsOut.forEach(function(o, i) { ledRaw.push({ type: "pay", t: H.receipts[i].t || 0, seq: i, o: o }); });
    ledRaw.sort(function(a, b) { return (a.t - b.t) || ((a.type === "pay" ? 0 : 1) - (b.type === "pay" ? 0 : 1)) || (a.seq - b.seq); });
    var cumDueL = 0, cumPaidL = 0, ledger = ledRaw.map(function(x) {
      var row = { type: x.type, date: fmt(x.t), dateIso: x.t ? _fmtDate_(new Date(x.t), tz, "yyyy-MM-dd") : "", future: x.t >= todayT };
      Object.keys(x.o).forEach(function(k) { row[k] = x.o[k]; });
      if (x.type === "due") cumDueL = r2(cumDueL + x.o.amount); else cumPaidL = r2(cumPaidL + x.o.amount);
      row.cumDue = cumDueL; row.cumPaid = cumPaidL; row.balance = r2(cumDueL - cumPaidL);
      return row;
    });
    out[hn] = {
      hotel: hn, items: items, receipts: receiptsOut, ledger: ledger, contracts: contractsOut, warnings: H.warnings, today: fmt(todayT),
      contractsCount: Object.keys(contracts).filter(function(id) { return contracts[id].hotel === hn; }).length,
      receiptsCount: H.receipts.length,
      totalDue: tot.totalDue, totalPaid: totalPaid, balance: r2(tot.totalDue - totalPaid), credit: r2(Math.max(0, totalPaid - tot.totalDue)),
      overdue: tot.overdue, overdueCount: tot.overdueCount, oldestOverdue: fmt(oldestOverdue), next30: tot.next30, nextDue: nextDue,
      paidCount: tot.paidCount, partialCount: tot.partialCount, openCount: tot.openCount,
      paidPct: tot.totalDue > 0 ? Math.min(100, Math.round(totalPaid / tot.totalDue * 1000) / 10) : 0
    };
  });
  return out;
}

// تناديها الواجهة: جدول استحقاقات فندق واحد (يتطلب صلاحية الحسابات + الجانب المالي + الفندق ضمن المسموح)
function getHotelPaymentSchedule(hotelName, currentUser) { _apiGuard_();
  var _fn="[getHotelPaymentSchedule]"; _logInfo_(_fn, "START | hotelName:"+String(JSON.stringify(hotelName)||"").slice(0, 80));
  try {
  hotelName = String(hotelName || "").trim();
  if (!hotelName) throw new Error("لم يُحدَّد الفندق.");
  _requirePermission_(currentUser, "accounts", "canView");
  _requireFinancePermission_(currentUser);
  var allowed = _getUserAllowedHotels_(currentUser);
  if (allowed && !allowed[hotelName]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
  var m = _hotelSchedulesFifo_(allowed, hotelName);
  return m[hotelName] || { hotel: hotelName, items: [], receipts: [], ledger: [], contracts: [], warnings: [], today: _fmtDate_(new Date(), _tz_(), "dd/MM/yyyy"), contractsCount: 0, receiptsCount: 0,
    totalDue: 0, totalPaid: 0, balance: 0, credit: 0, overdue: 0, overdueCount: 0, oldestOverdue: "", next30: 0, nextDue: null, paidCount: 0, partialCount: 0, openCount: 0, paidPct: 0 };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يُعيد كشف حساب تفصيلي لطرف واحد: كل حجوزاته (مدين) + كل دفعاته (دائن) مرتبة زمنياً + الإجماليات — بالريال السعودي
// hotelFilter (اختياري) — v3.23: يقصر الكشف على حجوزات فندق بعينه + الدفعات المخصَّصة له تحديداً فقط (غير مستخدَم مع partyType="hotel")
// fromIso/toIso (اختياريان) — v3.33: فلتر فترة (خلال فترة / مفتوحة البداية / مفتوحة النهاية)؛ عند التفعيل تُعرض حركات هذه الفترة فقط
// والإجماليات/الرصيد التراكمي تخصّها هي فقط (بلا رصيد افتتاحي مرحَّل من قبلها) — لتُطابق نفس أسلوب البيان اليومي بالنظام
// partyType="hotel" — v3.33: كشف حساب فندق (مدين = تعاقداته من Contracts_Master، دائن = سداداته الفعلية من Contract_Payment_Receipts)
function getAccountStatement(partyType, partyKey, currentUser, hotelFilter, fromIso, toIso) { _apiGuard_();
  var _fn="[getAccountStatement]"; _logInfo_(_fn, "START | partyType:"+partyType+", partyKey:"+String(JSON.stringify(partyKey)||"").slice(0,80)+", hotelFilter:"+String(JSON.stringify(hotelFilter)||"").slice(0,80));
  try {
  partyKey = String(partyKey||"").trim();
  if (!partyKey) throw new Error("لم يُحدَّد الطرف المطلوب كشف حسابه.");
  var fromDate = _parseStatementDateBound_(fromIso, false);
  var toDate = _parseStatementDateBound_(toIso, true);
  var tz = _tz_();

  if (partyType === "hotel") {
    _requirePermission_(currentUser, "accounts", "canView");
    _requireFinancePermission_(currentUser); // بيانات مالية لتعاقدات الفندق — تتطلب صلاحية الجانب المالي أيضاً
    var allowedH = _getUserAllowedHotels_(currentUser);
    if (allowedH && !allowedH[partyKey]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
    _logRead_("الحسابات", partyKey, "عرض كشف حساب فندق: "+partyKey, currentUser);

    var rowsH = [], totalDueH = 0, totalPaidH = 0;
    var cData = _getSheetValues_("Contracts_Master");
    var allHotelContractIds = {};
    for (var ci=1; ci<cData.length; ci++) {
      var crow = cData[ci];
      if (!crow[0] || crow[12]===true || String(crow[1])!==partyKey) continue;
      allHotelContractIds[crow[0]] = true; // كل تعاقدات الفندق (بصرف النظر عن فلتر التاريخ) — لإسناد الدفعات إليها لاحقاً
      var sd = crow[3] instanceof Date ? crow[3] : new Date(crow[3]);
      var ed = crow[4] instanceof Date ? crow[4] : new Date(crow[4]);
      if (fromDate && sd < fromDate) continue;
      if (toDate && sd > toDate) continue;
      var val = parseFloat(crow[8]) || 0;
      totalDueH += val;
      // V3.77 — مفتاح ترتيب التعاقد = الأقدم من (تاريخ تسجيله، بداية فترته)، ويُقدَّم لاحقاً قبل أول دفعة له إن سبقتهما:
      // الالتزام ينشأ بتسجيل التعاقد لا ببداية الإقامة، فكان التعاقد يظهر بعد دفعاته والرصيد التراكمي "دائناً" بلا معنى.
      var cAt = crow[10] instanceof Date ? crow[10] : (crow[10] ? new Date(crow[10]) : null);
      var cKey = isNaN(sd.getTime()) ? 0 : sd.getTime();
      if (cAt && !isNaN(cAt.getTime()) && cAt.getTime() < cKey) cKey = cAt.getTime();
      rowsH.push({
        kind: "contract", refId: crow[0], contractId: crow[0],
        sortKey: cKey,
        date: isNaN(sd.getTime()) ? "" : _fmtDate_(sd, tz, "dd/MM/yyyy"),
        description: "تعاقد #" + crow[0] + " — " + _fmtNum2_(crow[6]) + " غرفة × " + _fmtNum2_((parseFloat(crow[5]) > 0) ? crow[5] : ((isNaN(sd.getTime()) || isNaN(ed.getTime())) ? 0 : Math.round((ed - sd) / 86400000))) + " ليلة × " + _fmtNum2_(crow[7]) + " ر.س/ليلة"
          + " (" + (isNaN(sd.getTime())?"":_fmtDate_(sd,tz,"dd/MM/yyyy")) + " ← " + (isNaN(ed.getTime())?"":_fmtDate_(ed,tz,"dd/MM/yyyy")) + ")",
        debit: Math.round(val*100)/100, credit: 0
      });
    }

    var rData = _getSheetValues_("Contract_Payment_Receipts"), attMapH = _attCountMap_(), payerMapH = _accPayerMap_();
    for (var ri=1; ri<rData.length; ri++) {
      var rrow = rData[ri];
      if (!rrow[0] || rrow[9]===true || !allHotelContractIds[rrow[2]]) continue;
      var pd = rrow[4] instanceof Date ? rrow[4] : new Date(rrow[4]);
      if (fromDate && pd < fromDate) continue;
      if (toDate && pd > toDate) continue;
      var amt = parseFloat(rrow[3]) || 0;
      var linkedAp = String(rrow[10]||"").trim();
      totalPaidH += amt;
      rowsH.push({
        kind: "receipt", refId: rrow[0], contractId: rrow[2], paymentId: String(rrow[1] || ""),
        attCount: _attCount_(attMapH, "receipt", rrow[0], "account", rrow[10]), // V3.80
        sortKey: isNaN(pd.getTime()) ? 0 : pd.getTime(),
        date: isNaN(pd.getTime()) ? "" : _fmtDate_(pd, tz, "dd/MM/yyyy"),
        payDateIso: isNaN(pd.getTime()) ? "" : _fmtDate_(pd, tz, "yyyy-MM-dd"),
        description: (linkedAp ? ("🔗 دفعة مزدوجة" + (payerMapH[linkedAp] ? " من " + _payerLabel_(payerMapH[linkedAp]) : "")) : "سداد") + " — تعاقد #" + rrow[2]
          + (rrow[5] && !(payerMapH[linkedAp] && /^دفعة مزدوجة من/.test(String(rrow[5])) && String(rrow[5]).indexOf(payerMapH[linkedAp].name) > -1) ? " — " + rrow[5] : "") + (rrow[6] && !(payerMapH[linkedAp] && /^دفعة مزدوجة من/.test(String(rrow[6]))) ? " — " + rrow[6] : ""),
        payerName: payerMapH[linkedAp] ? payerMapH[linkedAp].name : "", payerType: payerMapH[linkedAp] ? payerMapH[linkedAp].type : "",
        statement: rrow[5]||"", notes: rrow[6]||"", createdBy: rrow[7]||"",
        linkedAccountPaymentId: linkedAp,
        amount: Math.round(amt*100)/100,
        debit: 0, credit: Math.round(amt*100)/100
      });
    }

    // التعاقد يسبق دائماً أول دفعة له (حتى لو سُجّلت الدفعة بتاريخ أقدم من تسجيل التعاقد)؛ والدفعات بترتيب تواريخها
    var firstPay = {};
    rowsH.forEach(function(r){ if (r.kind==="receipt" && r.sortKey && (!firstPay[r.contractId] || r.sortKey < firstPay[r.contractId])) firstPay[r.contractId] = r.sortKey; });
    rowsH.forEach(function(r){ if (r.kind==="contract" && firstPay[r.contractId] && firstPay[r.contractId] < r.sortKey) r.sortKey = firstPay[r.contractId]; });
    rowsH.sort(function(a,b){ return (a.sortKey - b.sortKey) || ((a.kind==="contract" ? 0 : 1) - (b.kind==="contract" ? 0 : 1)) || String(a.refId).localeCompare(String(b.refId), undefined, {numeric:true}); });
    var runningH = 0;
    rowsH.forEach(function(r){
      runningH += r.debit - r.credit; r.runningBalance = Math.round(runningH*100)/100;
      if (r.kind==="contract" && r.sortKey) r.date = _fmtDate_(new Date(r.sortKey), tz, "dd/MM/yyyy"); // التاريخ المعروض = تاريخ إدراج الالتزام (فترة التعاقد مذكورة في البيان)
    });

    return {
      partyType: "hotel", partyKey: partyKey, partyName: partyKey, hotelFilter: "",
      rows: rowsH,
      totalDue: Math.round(totalDueH*100)/100,
      totalPaid: Math.round(totalPaidH*100)/100,
      balance: Math.round((totalDueH-totalPaidH)*100)/100,
      generatedAt: _fmtDate_(new Date(), tz, "dd/MM/yyyy HH:mm")
    };
  }

  _requirePermission_(currentUser, "accounts", "canView");
  partyType = (partyType === "client") ? "client" : "collection";
  hotelFilter = String(hotelFilter||"").trim();
  _logRead_("الحسابات", partyKey, "عرض كشف حساب: "+((partyType==="collection")?"جهة تحصيل":"عميل")+" — "+partyKey+(hotelFilter?" — فندق: "+hotelFilter:""), currentUser);
  var allowed = _getUserAllowedHotels_(currentUser);
  if (hotelFilter && allowed && !allowed[hotelFilter]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
  var hotelMap = _buildContractHotelMap_();
  var collMap = _buildCollectionAccountMap_();
  var partyName = (partyType==="collection") ? (collMap[partyKey] || partyKey) : partyKey;

  var rows = [], totalDue = 0, totalPaid = 0;

  // 1) الحجوزات (مدين)
  var bData = _getSheetValues_("Bookings_Master");
  for (var i=1; i<bData.length; i++) {
    var b = bData[i];
    if (!b[0] || b[14]===true) continue;
    if (String(b[4]) === "ملغي") continue;
    var matchKey = (partyType==="collection") ? String(b[3]||"").trim() : String(b[2]||"").trim();
    if (matchKey !== partyKey) continue;
    var hn = hotelMap[b[1]] || "";
    if (allowed && !allowed[hn]) continue;
    if (hotelFilter && hn !== hotelFilter) continue;
    var ci2 = b[6] instanceof Date ? b[6] : new Date(b[6]);
    var co = b[7] instanceof Date ? b[7] : new Date(b[7]);
    if (fromDate && ci2 < fromDate) continue;
    if (toDate && ci2 > toDate) continue;
    var val = parseFloat(b[10]) || 0;
    totalDue += val;
    rows.push({
      kind: "booking",
      refId: b[0],
      sortKey: isNaN(ci2.getTime()) ? 0 : ci2.getTime(),
      date: isNaN(ci2.getTime()) ? "" : _fmtDate_(ci2, tz, "dd/MM/yyyy"),
      description: "حجز " + b[0] + " — " + (hn||"")
        + (partyType==="collection" ? " — العميل: " + (b[2]||"") : " — جهة التحصيل: " + (collMap[b[3]]||b[3]||""))
        + " — " + (b[5]||0) + " غرفة × " + (b[8]||0) + " ليلة"
        + " (" + (isNaN(ci2.getTime())?"":_fmtDate_(ci2,tz,"dd/MM/yyyy")) + " ← " + (isNaN(co.getTime())?"":_fmtDate_(co,tz,"dd/MM/yyyy")) + ")"
        + " — الحالة: " + (b[4]||""),
      debit: Math.round(val*100)/100,
      credit: 0
    });
  }

  // 2) الدفعات المسدَّدة (دائن) — تُستبعد عند فلتر فندق محدَّد أي دفعة عامة أو مخصَّصة لفندق آخر
  var pData = _getSheetValues_("Account_Payments");
  var attMap = _attCountMap_(); // V3.80
  var rcState = {}; // V3.79 — حالة سداد الفندق المقابل لكل دفعة مزدوجة: ok / deleted
  try { var rcD = _getSheetValues_("Contract_Payment_Receipts"); for (var rz=1; rz<rcD.length; rz++) { if (rcD[rz][0]) rcState[String(rcD[rz][0])] = rcD[rz][9]===true ? "deleted" : "ok"; } } catch (eRc) {}
  for (var j=1; j<pData.length; j++) {
    var p = pData[j];
    if (!p[0] || p[10]===true) continue;
    if (String(p[1]) !== partyType || String(p[2]||"").trim() !== partyKey) continue;
    var payHotel = String(p[11]||"").trim();
    if (payHotel && allowed && !allowed[payHotel]) continue;
    if (hotelFilter && payHotel !== hotelFilter) continue;
    var pd2 = p[5] instanceof Date ? p[5] : new Date(p[5]);
    if (fromDate && pd2 < fromDate) continue;
    if (toDate && pd2 > toDate) continue;
    var amt = parseFloat(p[4]) || 0;
    var linkedReceiptId = String(p[12]||"").trim(); // v3.32 — دفعة مزدوجة: رقم سداد الفندق المقابل (إن وُجد)
    totalPaid += amt;
    rows.push({
      kind: "payment",
      refId: p[0],
      sortKey: isNaN(pd2.getTime()) ? 0 : pd2.getTime(),
      date: isNaN(pd2.getTime()) ? "" : _fmtDate_(pd2, tz, "dd/MM/yyyy"),
      description: (linkedReceiptId ? "🔗 دفعة مزدوجة" : "دفعة مسدَّدة") + (payHotel ? " — " + payHotel : " — عامة") + (p[6] ? " — " + p[6] : "") + (p[7] ? " — " + p[7] : ""),
      method: p[6]||"", notes: p[7]||"", createdBy: p[8]||"", hotelName: payHotel,
      amount: Math.round(amt*100)/100,
      paymentDateIso: isNaN(pd2.getTime()) ? "" : _fmtDate_(pd2, tz, "yyyy-MM-dd"),
      linkedHotelReceiptId: linkedReceiptId,
      hotelSide: linkedReceiptId ? (rcState[linkedReceiptId] || "missing") : "", // V3.79
      attCount: _attCount_(attMap, "account", p[0], "receipt", (rcState[linkedReceiptId] === "ok") ? linkedReceiptId : ""), // V3.80
      debit: 0,
      credit: Math.round(amt*100)/100
    });
  }

  // ترتيب زمني تصاعدي (الحجوزات قبل الدفعات عند تساوي التاريخ) + رصيد تراكمي
  rows.sort(function(a,b){ return (a.sortKey - b.sortKey) || (a.kind==="booking" ? -1 : 1); });
  var running = 0;
  rows.forEach(function(r){ running += r.debit - r.credit; r.runningBalance = Math.round(running*100)/100; });

  return {
    partyType: partyType, partyKey: partyKey, partyName: partyName, hotelFilter: hotelFilter,
    rows: rows,
    totalDue: Math.round(totalDue*100)/100,
    totalPaid: Math.round(totalPaid*100)/100,
    balance: Math.round((totalDue-totalPaid)*100)/100,
    generatedAt: _fmtDate_(new Date(), tz, "dd/MM/yyyy HH:mm")
  };
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحفظ دفعة سداد جديدة أو يُحدّث دفعة موجودة لطرف معيّن (جهة تحصيل/عميل) — المبلغ بالريال السعودي
function saveAccountPayment(p, currentUser) { _apiGuard_();
  var _fn="[saveAccountPayment]"; _logInfo_(_fn, "START | p:"+String(JSON.stringify(p)||"").slice(0,80)+", currentUser:"+String(JSON.stringify(currentUser)||"").slice(0,80));
  try {
  return _withLock_(function() {
  _requirePermission_(currentUser, "accounts", p.editId ? "canEdit" : "canAdd");
  _invalidateSheetCache_("Account_Payments");
  var partyType = (p.partyType === "client") ? "client" : "collection";
  var partyKey = String(p.partyKey||"").trim();
  var partyName = String(p.partyName||partyKey).trim();
  var amount = parseFloat(p.amount) || 0;
  var payDate = new Date(p.paymentDate);
  var method = String(p.method||"").trim();
  var notes = String(p.notes||"").trim();
  var hotelName = String(p.hotelName||"").trim(); // v3.23 — اختياري: تخصيص الدفعة لفندق بعينه (فارغ = دفعة عامة)
  if (!partyKey) throw new Error("لم يُحدَّد الطرف (جهة التحصيل / العميل).");
  if (amount <= 0) throw new Error("قيمة الدفعة يجب أن تكون أكبر من صفر.");
  if (isNaN(payDate.getTime())) throw new Error("تاريخ الدفعة غير صحيح.");
  if (hotelName) {
    var _allowedPay = _getUserAllowedHotels_(currentUser);
    if (_allowedPay && !_allowedPay[hotelName]) throw new Error("ليس لديك صلاحية الوصول لهذا الفندق.");
  }
  var sheet = _getOrCreateSheet_("Account_Payments");
  var tz = _tz_();
  if (p.editId) {
    var data = sheet.getDataRange().getValues();
    for (var i=1; i<data.length; i++) {
      if (String(data[i][0]) === String(p.editId)) {
        var oldAmt = data[i][4];
        sheet.getRange(i+1, 5, 1, 4).setValues([[amount, payDate, method, notes]]);
        sheet.getRange(i+1, 12).setValue(hotelName);
        logAudit("الحسابات", "تعديل دفعة", String(p.editId), "المبلغ", String(oldAmt), String(amount),
          "تعديل دفعة لـ " + partyName + " — المبلغ: " + amount.toLocaleString('en-US') + " ر.س بتاريخ " + _fmtDate_(payDate, tz, "dd/MM/yyyy") + (hotelName?" — الفندق: "+hotelName:""), currentUser);
        return { success: true };
      }
    }
    throw new Error("لم يتم العثور على الدفعة المطلوب تعديلها.");
  } else {
    var paymentId = _getNextSequentialId_("APY-", 4);
    sheet.appendRow([paymentId, partyType, partyKey, partyName, amount, payDate, method, notes, currentUser, new Date(), false, hotelName]);
    logAudit("الحسابات", "إضافة دفعة", paymentId, "", "", "",
      "تسجيل دفعة مسدَّدة من " + partyName + " (" + (partyType==="collection"?"جهة تحصيل":"عميل") + ") بقيمة " + amount.toLocaleString('en-US') + " ر.س بتاريخ " + _fmtDate_(payDate, tz, "dd/MM/yyyy") + (hotelName?" — الفندق: "+hotelName:""), currentUser);
    return { success: true, paymentId: paymentId };
  }
  });
  } catch(e) { _logError_(_fn, e); throw e; }
}

// يحذف دفعة سداد (حذف منطقي) مع تسجيل الحدث في سجل التعديلات
// v3.34 — إن كانت الدفعة "مزدوجة" (Linked_Hotel_Receipt_ID)، يُحذَف الطرف الآخر (سداد الفندق المقابل بشيت
// Contract_Payment_Receipts) تلقائياً بنفس العملية أيضاً، مع إعادة احتساب Paid_Amount للقسط المتأثر
function deleteAccountPayment(paymentId, currentUser) { _apiGuard_();
  var _fn="[deleteAccountPayment]"; _logInfo_(_fn, "START | paymentId:"+String(JSON.stringify(paymentId)||"").slice(0,80));
  try {
  _requirePermission_(currentUser, "accounts", "canDelete");
  _invalidateSheetCache_("Account_Payments");
  var sheet = _getOrCreateSheet_("Account_Payments");
  var data = sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (String(data[i][0]) === String(paymentId)) {
      sheet.getRange(i+1, 11).setValue(true);
      var linkedReceiptId = String(data[i][12]||"").trim();
      var cascaded = false;
      if (linkedReceiptId) {
        var rSheet = _getOrCreateSheet_("Contract_Payment_Receipts");
        var rData = rSheet.getDataRange().getValues();
        for (var k=1; k<rData.length; k++) {
          if (String(rData[k][0])===linkedReceiptId && rData[k][9]!==true) {
            rSheet.getRange(k+1,10).setValue(true);
            _recalcContractPaymentPaidAmount_(rData[k][1]);
            cascaded = true;
            break;
          }
        }
      }
      logAudit("الحسابات", "حذف دفعة", String(paymentId), "", "", "",
        "حذف دفعة مسدَّدة من " + (data[i][3]||data[i][2]) + " بقيمة " + (parseFloat(data[i][4])||0).toLocaleString('en-US') + " ر.س"
        + (linkedReceiptId?(" — دفعة مزدوجة: "+(cascaded?"تم حذف سداد الفندق المقابل #"+linkedReceiptId+" تلقائياً أيضاً":"⚠️ تعذّر العثور على سداد الفندق المقابل #"+linkedReceiptId+" (محذوف مسبقاً على الأرجح)")):""),
        currentUser);
      return { success: true, linkedHotelReceiptId: linkedReceiptId, cascaded: cascaded };
    }
  }
  throw new Error("لم يتم العثور على الدفعة.");
  } catch(e) { _logError_(_fn, e); throw e; }
}
