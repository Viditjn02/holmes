// Tiny dependency-free className combiner (clsx-lite). Filters falsy values and
// joins the rest with a single space. Sufficient for our Tailwind composition —
// we never rely on conflict-resolution (tailwind-merge), so this stays zero-dep.
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (Array.isArray(input)) {
      const inner = cn(...input);
      if (inner) out.push(inner);
    } else {
      out.push(String(input));
    }
  }
  return out.join(" ");
}
