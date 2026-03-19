import re

TARGET = "D:/biur/studio/src/app/my-guides/page.tsx"

with open(TARGET, "r", encoding="utf-8") as f:
    src = f.read()

original = src
results = []

# Change 1
old1 = "  Trash2,
  X,
} from 'lucide-react';"
new1 = "  Trash2,
  X,
  Maximize2,
  Minimize2,
} from 'lucide-react';"
if old1 in src:
    src = src.replace(old1, new1, 1)
    results.append("Change 1 OK")
else:
    results.append("Change 1 NOT FOUND")

# Change 2
old2 = "  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [clientTopics, setClientTopics] = useState<Record<string, string[]>>({});"
new2 = (
    "  const [isSavingSummary, setIsSavingSummary] = useState(false);
"
    "  const [clientTopics, setClientTopics] = useState<Record<string, string[]>>({});
"
    "  const [isSummaryWide, setIsSummaryWide] = useState(false);
"
    "  const summaryTextareaRef = useRef<HTMLTextAreaElement>(null);"
)
if old2 in src:
    src = src.replace(old2, new2, 1)
    results.append("Change 2 OK")
else:
    results.append("Change 2 NOT FOUND")

# Change 3
old3 = "  const saveSummary = useCallback(async () => {"
new3 = (
    "  const insertFormat = useCallback((prefix: string, suffix = '') => {
"
    "    const el = summaryTextareaRef.current;
"
    "    if (\!el) return;
"
    "    const start = el.selectionStart;
"
    "    const end = el.selectionEnd;
"
    "    const selected = editedSummaryText.slice(start, end);
"
    "    const before = editedSummaryText.slice(0, start);
"
    "    const after = editedSummaryText.slice(end);
"
    "    const insertion = prefix + (selected || '') + suffix;
"
    "    const newText = before + insertion + after;
"
    "    setEditedSummaryText(newText);
"
    "    setTimeout(() => {
"
    "      el.focus();
"
    "      const cursor = start + prefix.length + (selected || '').length + suffix.length;
"
    "      el.setSelectionRange(cursor, cursor);
"
    "    }, 0);
"
    "  }, [editedSummaryText, summaryTextareaRef]);
"
    "
"
    "  const saveSummary = useCallback(async () => {"
)
if old3 in src:
    src = src.replace(old3, new3, 1)
    results.append("Change 3 OK")
else:
    results.append("Change 3 NOT FOUND")

for r in results:
    print(r)

with open(TARGET, "w", encoding="utf-8") as f:
    f.write(src)
print("partial save ok")
