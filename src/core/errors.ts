export class UserError extends Error {
  override name = "UserError";
}

export class FormatError extends Error {
  override name = "FormatError";
}

export class ExitCode extends Error {
  override name = "ExitCode";

  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}
