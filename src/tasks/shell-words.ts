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

const KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "while",
  "until",
  "do",
  "done",
  "fi",
  "esac",
  "!",
  "{",
  "}",
  "(",
  ")",
  ";;",
  "time",
]);
const CASE_PATTERN = /^[^()=\s]*\)$/;
const HEREDOC = /(?<!<)<<-?(?!<)\s*(['"]?)([A-Za-z_]\w*)\1/;

export function program(command: SimpleCommand): { name: string; args: string[] } {
  let index = 0;
  const words = command.words;
  while (
    /^[A-Za-z_]\w*=/.test(words[index] ?? "") ||
    KEYWORDS.has(words[index] ?? "") ||
    (CASE_PATTERN.test(words[index] ?? "") && index < words.length - 1)
  ) {
    index++;
  }
  const [raw = "", ...args] = words.slice(index);
  const first = raw.replace(/^\(+/, "");
  if (first === "env") return program({ words: args, text: command.text });
  return { name: first, args };
}

export function heredocEnd(line: string): string | undefined {
  const masked = line
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (quoted) => "_".repeat(quoted.length))
    .replace(/(^|\s)#.*$/, "$1");
  const operator = /(?<!<)<<-?(?!<)/.exec(masked);
  if (!operator) return undefined;
  return HEREDOC.exec(line.slice(operator.index))?.[2];
}

export function openQuote(text: string, start?: "'" | '"'): "'" | '"' | undefined {
  let quote = start;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? "";
    if (quote === "'") {
      if (char === "'") quote = undefined;
      continue;
    }
    if (char === "\\") {
      index++;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(text[index - 1] ?? ""))) break;
    if (char === "'" || char === '"') quote = char;
  }
  return quote;
}

export function unquoted(line: string): string {
  return line.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''").replace(/(^|\s)#.*$/, "$1");
}

export function logicalLines(lines: string[]): string[] {
  const joined: string[] = [];
  let pending = "";
  let quote: "'" | '"' | undefined;
  let heredoc: string | undefined;
  for (const raw of lines) {
    if (heredoc !== undefined) {
      if (raw.replace(/^\t+/, "").trimEnd() === heredoc) heredoc = undefined;
      continue;
    }
    const line = raw.replace(/\s+$/, "");
    if (quote) {
      pending += `\n${line}`;
      quote = openQuote(line, quote);
      if (quote) continue;
    } else if (line.endsWith("\\") && !openQuote(line)) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    } else {
      pending = `${pending}${line.trim()}`;
      quote = openQuote(line);
      if (quote) continue;
    }
    const done = pending.trim();
    pending = "";
    if (done !== "" && !done.startsWith("#")) {
      joined.push(done);
      heredoc = heredocEnd(done);
    }
  }
  if (pending.trim()) joined.push(pending.trim());
  return joined;
}
