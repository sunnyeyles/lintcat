export const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

export const addDays = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
