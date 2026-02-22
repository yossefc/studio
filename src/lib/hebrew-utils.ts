const HEBREW_CHAR_VALUES: Record<string, number> = {
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5,
  'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
  'י': 10, 'כ': 20, 'ך': 20, 'ל': 30, 'מ': 40,
  'ם': 40, 'נ': 50, 'ן': 50, 'ס': 60, 'ע': 70,
  'פ': 80, 'ף': 80, 'צ': 90, 'ץ': 90,
  'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400,
};

/**
 * Converts a Hebrew numeral string to an Arabic number.
 * Handles geresh/gershayim marks, final letters, and special cases (טו/טז).
 * If the input is already a valid Arabic number string, returns it as-is.
 */
export function hebrewToNumber(hebrew: string): number {
  const trimmed = hebrew.trim();

  // If already numeric, return directly
  const asNum = Number(trimmed);
  if (!isNaN(asNum) && trimmed.length > 0) {
    return asNum;
  }

  // Strip geresh (׳ or '), gershayim (״ or "), and dashes
  const clean = trimmed.replace(/['"״׳\-–]/g, '');

  if (clean.length === 0) return 0;

  // Special cases for 15 and 16
  if (clean === 'טו') return 15;
  if (clean === 'טז') return 16;

  let sum = 0;
  for (const char of clean) {
    sum += HEBREW_CHAR_VALUES[char] || 0;
  }
  return sum;
}

export function numberToHebrew(num: number): string {
  if (num <= 0 || num > 1000) return num.toString();

  const units = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const hundreds = ['', 'ק', 'ר', 'ש', 'ת'];
  
  // Special cases for 15 and 16
  if (num % 100 === 15) {
    return numberToHebrew(num - 15) + 'טו';
  }
  if (num % 100 === 16) {
    return numberToHebrew(num - 16) + 'טז';
  }

  let result = '';
  let n = num;

  if (n >= 400) {
    const th = Math.floor(n / 400);
    for (let i = 0; i < th; i++) result += 'ת';
    n -= th * 400;
  }
  
  if (n >= 100) {
    result += hundreds[Math.floor(n / 100)];
    n %= 100;
  }
  
  if (n >= 10) {
    result += tens[Math.floor(n / 10)];
    n %= 10;
  }
  
  if (n > 0) {
    result += units[n];
  }

  // Adding quotes formatting
  if (result.length === 1) {
    return result + "'";
  } else if (result.length > 1) {
    return result.slice(0, -1) + '"' + result.slice(-1);
  }

  return result;
}
