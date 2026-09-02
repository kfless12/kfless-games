/*
 * Deliberately NOT in actions.ts. A `'use server'` file may only export async
 * functions — exporting a plain object from one builds fine and then throws
 * "A 'use server' file can only export async functions, found object" at
 * runtime, which is a 500 on a page that looked healthy in CI. Same reason
 * app/games/state.ts exists.
 */
export type LineupState = { error: string | null; notice: string | null };

export const emptyLineupState: LineupState = { error: null, notice: null };
