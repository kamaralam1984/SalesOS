import { randomUUID } from 'node:crypto';

/** Deterministic PRNG so a re-run produces the same story. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!,
    chance: (p: number) => next() < p,
    weighted: <T>(items: ReadonlyArray<readonly [T, number]>): T => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [v, w] of items) { x -= w; if (x <= 0) return v; }
      return items[items.length - 1]![0];
    },
  };
}
export type Rng = ReturnType<typeof rng>;
export const uuid = () => randomUUID();

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
const IST = 330 * MIN;

/** IST calendar date string (YYYY-MM-DD) of an instant. */
export const istDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
/** Instant of IST midnight for a YYYY-MM-DD date. */
export const istMidnight = (s: string) => new Date(new Date(`${s}T00:00:00.000Z`).getTime() - IST);
/** 0 = Sunday .. 6 = Saturday for the IST date of an instant. */
export const istDow = (d: Date) => new Date(d.getTime() + IST).getUTCDay();
export const atIST = (s: string, h: number, m = 0) => new Date(istMidnight(s).getTime() + (h * 60 + m) * MIN);
export const addDaysStr = (s: string, n: number) => new Date(new Date(`${s}T00:00:00.000Z`).getTime() + n * DAY).toISOString().slice(0, 10);
export const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Business hours 10:00-19:00 IST, Mon-Sat. Moves an instant forward into the next working slot. */
export function intoWorkingHours(d: Date): Date {
  let t = d;
  for (let i = 0; i < 8; i++) {
    const day = istDay(t);
    if (istDow(t) === 0) { t = atIST(addDaysStr(day, 1), 10, 5); continue; }
    const mins = Math.round((t.getTime() - istMidnight(day).getTime()) / MIN);
    if (mins < 10 * 60) return atIST(day, 10, 5 + (mins % 25));
    if (mins > 19 * 60) { t = atIST(addDaysStr(day, 1), 10, 5); continue; }
    return t;
  }
  return t;
}

export const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ishita', 'Vikram', 'Ananya', 'Arjun', 'Sana', 'Neel', 'Tara', 'Dev', 'Riya', 'Yash', 'Pooja', 'Kunal', 'Nisha', 'Samir', 'Lata', 'Aditya', 'Kavya', 'Manish', 'Swati', 'Harsh', 'Preeti', 'Nitin', 'Rekha', 'Tarun', 'Divya', 'Sagar', 'Komal', 'Ajay', 'Bhavna', 'Chetan', 'Deepa', 'Faisal', 'Gauri', 'Hemant', 'Isha'];
export const LAST = ['Sharma', 'Patil', 'Khan', 'Iyer', 'Deshmukh', 'Nair', 'Gupta', 'Joshi', 'Kulkarni', 'Mehta', 'Verma', 'Reddy', 'Singh', 'Pawar', 'Jadhav', 'Bhosale', 'Agarwal', 'Chavan', 'Shah', 'Malhotra', 'Yadav', 'Tiwari', 'More', 'Kale'];
