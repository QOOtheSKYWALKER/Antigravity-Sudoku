/**
 * solver-difficulty.js
 * Single Source of Truth for difficulty names and rank values.
 * No dependencies — import freely from any module.
 */

export const DIFFICULTY_RANK = {
    'basic':  1,
    'easy':   2,
    'medium': 3,
    'hard':   4,
};

/**
 * Convert a numeric rank to its difficulty name.
 * @param {number} rank
 * @returns {string}
 */
export function rankToName(rank) {
    return Object.keys(DIFFICULTY_RANK).find(k => DIFFICULTY_RANK[k] === rank) ?? 'basic';
}

/**
 * Convert a difficulty name to its numeric rank.
 * Returns 0 for unknown names.
 * @param {string} name
 * @returns {number}
 */
export function nameToRank(name) {
    return DIFFICULTY_RANK[name] ?? 0;
}
