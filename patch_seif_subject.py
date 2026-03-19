import sys

target = "D:/biur/studio/src/app/my-guides/page.tsx"

old_block = """                                  {(() => {
                                    const summaryTopic = extractFirstTopic(entry.guide.summaryText ?? '');
                                    if (summaryTopic) {
                                      return (
                                        <span className={cn('w-full truncate text-right text-[10px] leading-tight', isActive ? 'text-white/60' : 'text-gray-400')}>
                                          {summaryTopic}
                                        </span>
                                      );
                                    }
                                    const topics = entry.guide.topics?.length ? entry.guide.topics : (clientTopics[entry.guide.id] ?? []);
                                    if (topics.length === 0) return null;
                                    return (
                                      <span className={cn('w-full truncate text-right text-[10px] leading-tight', isActive ? 'text-white/60' : 'text-gray-400')}>
                                        {topics.join(' · ')}
                                      </span>
                                    );
                                  })()}"""

new_block = """                                  {subject && (
                                    <span className={cn('w-full truncate text-right text-[10px] leading-tight', isActive ? 'text-white/60' : 'text-gray-400')}>
                                      {subject}
                                    </span>
                                  )}"""

with open(target, "r", encoding="utf-8") as f:
    content = f.read()

if old_block in content:
    new_content = content.replace(old_block, new_block, 1)
    with open(target, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("OK")
else:
    print("NOT FOUND")

# Print lines 850-870
with open(target, "r", encoding="utf-8") as f:
    lines = f.readlines()

print("\nLines 850-870:")
for i, line in enumerate(lines[849:870], start=850):
    print(f"{i}: {line}", end="")
