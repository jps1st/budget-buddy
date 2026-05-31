import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number with thousands commas. Decimals only shown when non-zero. */
export function fmt(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const hasDecimal = abs % 1 !== 0;
  const fixed = hasDecimal ? abs.toFixed(2) : Math.round(abs).toString();
  const [integer, decimal] = fixed.split(".");
  const withCommas = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + (decimal ? `${withCommas}.${decimal}` : withCommas);
}
