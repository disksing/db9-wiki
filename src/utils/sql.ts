export function escapeSqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

export function escapeSqlLiteral(s: string): string {
  return `E'${escapeSqlString(s).replace(/\t/g, "\\t")}'`;
}
