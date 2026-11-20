#!/usr/bin/env bash
# يحدّث رقم الإصدار في الخادم (APP_VERSION في Code.gs) والواجهة (CLIENT_APP_VERSION في Index.html)
# معاً دفعة واحدة، ويضيف قسماً جديداً فارغاً في DEPLOY_GUIDE.md لهذا الإصدار لتعبئته.
#
# الاستخدام:
#   ./tools/bump_version.sh V3.54
#
# يفشل بوضوح (ولا يُعدّل أي ملف جزئياً) إن لم يجد كل نمط مطلوب مرة واحدة بالضبط في كل ملف —
# حماية من تعديل نسخة خاطئة بصمت لو تغيّر شكل السطر لاحقاً.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "الاستخدام: $0 VX.Y" >&2
  exit 1
fi

NEW_VERSION="$1"
# الإصدار يُكتب دائماً بحرف V كبير (V3.54) — نقبل v صغيرة في الإدخال ونحوّلها
NEW_VERSION="V${NEW_VERSION#[vV]}"
if ! [[ "$NEW_VERSION" =~ ^[vV][0-9]+\.[0-9]+$ ]]; then
  echo "❌ صيغة الإصدار غير صحيحة: '$NEW_VERSION' — يجب أن تكون مثل V3.54" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODE_FILE="$REPO_ROOT/apps-script/Code.gs"
HTML_FILE="$REPO_ROOT/apps-script/Index.html"
GUIDE_FILE="$REPO_ROOT/DEPLOY_GUIDE.md"

for f in "$CODE_FILE" "$HTML_FILE"; do
  if [ ! -f "$f" ]; then
    echo "❌ الملف غير موجود: $f" >&2
    exit 1
  fi
done

CODE_PATTERN='^var APP_VERSION = "[vV][0-9]+\.[0-9]+";$'
HTML_PATTERN="^var CLIENT_APP_VERSION = '[vV][0-9]+\.[0-9]+';\$"

code_matches=$(grep -cE "$CODE_PATTERN" "$CODE_FILE")
html_matches=$(grep -cE "$HTML_PATTERN" "$HTML_FILE")

if [ "$code_matches" -ne 1 ]; then
  echo "❌ توقّعت نمط APP_VERSION مرة واحدة بالضبط في $CODE_FILE، وجدت $code_matches — توقفت دون أي تعديل." >&2
  exit 1
fi
if [ "$html_matches" -ne 1 ]; then
  echo "❌ توقّعت نمط CLIENT_APP_VERSION مرة واحدة بالضبط في $HTML_FILE، وجدت $html_matches — توقفت دون أي تعديل." >&2
  exit 1
fi

OLD_VERSION=$(grep -E "$CODE_PATTERN" "$CODE_FILE" | sed -E 's/^var APP_VERSION = "([vV][0-9]+\.[0-9]+)";$/\1/')

sed -i -E "s/^var APP_VERSION = \"[vV][0-9]+\.[0-9]+\";\$/var APP_VERSION = \"$NEW_VERSION\";/" "$CODE_FILE"
sed -i -E "s/^var CLIENT_APP_VERSION = '[vV][0-9]+\.[0-9]+';\$/var CLIENT_APP_VERSION = '$NEW_VERSION';/" "$HTML_FILE"

TODAY=$(date -u +%Y-%m-%d)
if [ -f "$GUIDE_FILE" ]; then
  STUB=$(cat <<EOF

## ${NEW_VERSION} — ${TODAY}
- (اكتب هنا ما تغيّر في هذا الإصدار قبل الدفع)
EOF
)
  printf '%s\n' "$STUB" >> "$GUIDE_FILE"
  echo "📝 أُضيف قسم جديد فارغ في $GUIDE_FILE لهذا الإصدار — عبّئه قبل الـ commit."
else
  echo "⚠️  $GUIDE_FILE غير موجود — لم يُضَف أي قسم تغيير (أنشئه يدوياً إن أردت تتبّع السجل)." >&2
fi

echo "✅ تم تحديث الإصدار من $OLD_VERSION إلى $NEW_VERSION في Code.gs وIndex.html."
