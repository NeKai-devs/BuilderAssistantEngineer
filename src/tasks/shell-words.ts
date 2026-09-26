export type SimpleCommand = { words: string[]; text: string };
export type ParsedLine = { commands: SimpleCommand[]; substitution: boolean };

const OPERATORS = ["&&", "||", ";", "|", "&"];

export function parseLine(line: string): ParsedLine {
  const commands: SimpleCommand[] = [];
  let words: string[] = [];
  let word = "";
  let text = "";
  let quote: "'" | '"' | undefined;
  let substitution = false;
  let started = false;
  const endWord = () => {
    if (started) words.push(word);
    word = "";
    started = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push({ words, text: text.trim() });
    words = [];
    text = "";
  };
  for (let index = 0; index < line.length; index++) {
    const char = line[index] ?? "";
    const rest = line.slice(index);
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === "\\" && quote === '"') word += line[++index] ?? "";
      else word += char;
      if (quote === '"' && (rest.startsWith("$(") || char === "`")) substitution = true;
      text += char;
      continue;
    }
    if (char === "#" && !started) break;
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      text += char;
      continue;
    }
    if (char === "\\") {
      word += line[++index] ?? "";
      started = true;
      text += char;
      continue;
    }
    if (rest.startsWith("$(") || char === "`") substitution = true;
    const operator = OPERATORS.find((candidate) => rest.startsWith(candidate));
    if (operator) {
      endCommand();
      index += operator.length - 1;
      continue;
    }
    if (/\s/.test(char)) {
      endWord();
      text += char;
      continue;
    }
    word += char;
    started = true;
    text += char;
  }
  endCommand();
  return { commands, substitution };
}

export function program(command: SimpleCommand): { name: string; args: string[] } {
  let index = 0;
  while (/^[A-Za-z_]\w*=/.test(command.words[index] ?? "")) index++;
  const [first = "", ...args] = command.words.slice(index);
  if (first === "env") return program({ words: args, text: command.text });
  return { name: first, args };
}

export function logicalLines(lines: string[]): string[] {
  const joined: string[] = [];
  let pending = "";
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.endsWith("\\")) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    }
    joined.push(`${pending}${line.trim()}`.trim());
    pending = "";
  }
  if (pending.trim()) joined.push(pending.trim());
  return joined.filter((line) => line !== "" && !line.startsWith("#"));
}
