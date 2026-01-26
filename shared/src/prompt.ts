export function renderPromptTemplate(template: string, vars: Record<string, string>): string {
  // minimal: {{text}} etc.
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v ?? "";
  });
}
