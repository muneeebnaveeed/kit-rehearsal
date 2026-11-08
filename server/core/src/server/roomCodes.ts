/** 4-letter room codes. No I or O, so codes can't be misread as 1 or 0. Generated outside the simulation. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;
const MAX_ATTEMPTS = 100;

export function generateRoomCode(
  isTaken: (code: string) => boolean,
  random: () => number = Math.random,
): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
    }
    if (!isTaken(code)) return code;
  }
  throw new Error(`no free room code after ${MAX_ATTEMPTS} attempts`);
}
