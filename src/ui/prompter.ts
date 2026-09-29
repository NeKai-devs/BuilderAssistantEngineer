export type Choice<T extends string> = { value: T; label: string; hint?: string };

export type Prompter = {
  intro(title: string): void;
  outro(message: string): void;
  note(message: string, title?: string): void;
  info(message: string): void;
  warn(message: string): void;
  success(message: string): void;
  select<T extends string>(message: string, choices: Choice<T>[], initial?: T): Promise<T>;
  multiselect<T extends string>(message: string, choices: Choice<T>[], initial: T[]): Promise<T[]>;
  text(message: string, placeholder?: string): Promise<string>;
  confirm(message: string, initial?: boolean): Promise<boolean>;
  spinner<R>(message: string, task: (update: (message: string) => void) => Promise<R>): Promise<R>;
  canAsk?(): boolean;
};
