/**
 * Free-tier rules for TalmudAI.
 *
 * The free preview covers Orach Chayim, Siman 1, Seifim 1-3.
 * These seifim are served directly from the canonical cache without
 * requiring authentication or a paid subscription.
 */

export const FREE_TIER_SECTION = 'Orach Chayim';
export const FREE_TIER_SIMAN = 1;
export const FREE_TIER_MAX_SEIF = 3;

/**
 * Returns true if the given section/siman/seif combination belongs to the
 * publicly accessible free tier.
 */
export function isFreeTierContent(
  section: string,
  siman: string | number,
  seif?: string | number,
): boolean {
  return (
    section === FREE_TIER_SECTION &&
    parseInt(String(siman), 10) === FREE_TIER_SIMAN &&
    parseInt(String(seif ?? '1'), 10) <= FREE_TIER_MAX_SEIF
  );
}
