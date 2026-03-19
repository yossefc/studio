filepath = 'D:/biur/studio/src/app/my-guides/page.tsx'

with open(filepath, 'r', encoding='utf-8', newline='') as f:
    content = f.read()

# Change 1
old1 = '  rating?: number;\r\n}'
new1 = '  rating?: number;\r\n  topics?: string[];\r\n}'
r1 = content.replace(old1, new1, 1)
print('Change 1 applied' if r1 != content else 'WARNING: Change 1 not found')
content = r1

# Change 2
old2 = '  const [isSavingSummary, setIsSavingSummary] = useState(false);\r\n\r\n  // Inject print-override CSS'
new2 = '  const [isSavingSummary, setIsSavingSummary] = useState(false);\r\n  const [clientTopics, setClientTopics] = useState<Record<string, string[]>>({});\r\n\r\n  // Inject print-override CSS'
r2 = content.replace(old2, new2, 1)
print('Change 2 applied' if r2 != content else 'WARNING: Change 2 not found')
content = r2

# Change 3
old3 = '  // eslint-disable-next-line react-hooks/exhaustive-deps\r\n  }, [hierarchy]);\r\n\r\n  const totalSimanim'
new3 = "  // eslint-disable-next-line react-hooks/exhaustive-deps\r\n  }, [hierarchy]);\r\n\r\n  // Backfill topics for old guides that don't have them in Firestore\r\n  useEffect(() => {\r\n    if (!guides || !user || !firestore) return;\r\n    const guidesWithoutTopics = guides.filter(g => !g.topics || g.topics.length === 0);\r\n    if (guidesWithoutTopics.length === 0) return;\r\n\r\n    guidesWithoutTopics.forEach((guide) => {\r\n      const tref = guide.tref;\r\n      if (!tref) return;\r\n      fetch(`https://www.sefaria.org/api/related/${encodeURIComponent(tref)}`)\r\n        .then(res => res.ok ? res.json() : null)\r\n        .then((data: unknown) => {\r\n          if (!data || typeof data !== 'object') return;\r\n          const topicsArr = (data as Record<string, unknown>).topics;\r\n          if (!Array.isArray(topicsArr) || topicsArr.length === 0) return;\r\n          const names: string[] = topicsArr\r\n            .map((t: unknown) => {\r\n              if (!t || typeof t !== 'object') return null;\r\n              const he = (t as Record<string, unknown>).he;\r\n              return typeof he === 'string' && he.trim() ? he.trim() : null;\r\n            })\r\n            .filter((n): n is string => n !== null)\r\n            .slice(0, 3);\r\n          if (names.length === 0) return;\r\n          setClientTopics(prev => ({ ...prev, [guide.id]: names }));\r\n          const guideRef = doc(firestore, 'users', user.uid, 'studyGuides', guide.id);\r\n          updateDoc(guideRef, { topics: names }).catch(() => { /* ignore */ });\r\n        })\r\n        .catch(() => { /* ignore */ });\r\n    });\r\n  // eslint-disable-next-line react-hooks/exhaustive-deps\r\n  }, [guides]);\r\n\r\n  const totalSimanim"
r3 = content.replace(old3, new3, 1)
print('Change 3 applied' if r3 != content else 'WARNING: Change 3 not found')
content = r3

# Change 4
old4 = "                                  {extractFirstTopic(entry.guide.summaryText ?? '') && (\r\n                                    <span className={cn('truncate text-[10px] leading-tight', isActive ? 'text-white/60' : 'text-gray-400')}>\r\n                                      {extractFirstTopic(entry.guide.summaryText ?? '')}\r\n                                    </span>\r\n                                  )}"
new4 = "                                  {(() => {\r\n                                    const topics = entry.guide.topics?.length ? entry.guide.topics : (clientTopics[entry.guide.id] ?? []);\r\n                                    if (topics.length > 0) {\r\n                                      return (\r\n                                        <span className={cn('truncate text-[10px] leading-tight', isActive ? 'text-white/60' : 'text-gray-400')}>\r\n                                          {topics.join(' · ')}\r\n                                        </span>\r\n                                      );\r\n                                    }\r\n                                    const firstTopic = extractFirstTopic(entry.guide.summaryText ?? '');\r\n                                    return firstTopic ? (\r\n                                      <span className={cn('truncate text-[10px] leading-tight', isActive ? 'text-white/60' : 'text-gray-400')}>\r\n                                        {firstTopic}\r\n                                      </span>\r\n                                    ) : null;\r\n                                  })()}"
r4 = content.replace(old4, new4, 1)
print('Change 4 applied' if r4 != content else 'WARNING: Change 4 not found')
content = r4

with open(filepath, 'w', encoding='utf-8', newline='') as f:
    f.write(content)

print('Done')