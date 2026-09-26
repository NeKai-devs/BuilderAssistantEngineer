import type { Lang } from "../i18n/index.js";
import type { Backend, Config } from "./schema.js";

export type GlobalFlags = {
  backend?: Backend;
  lang?: Lang;
  dryRun?: boolean;
  yes?: boolean;
};

export type Settings = {
  lang: Lang;
  backend: Backend | undefined;
  dryRun: boolean;
  yes: boolean;
};

export function resolveSettings(flags: GlobalFlags, config: Config | undefined): Settings {
  return {
    lang: flags.lang ?? config?.lang ?? "en",
    backend: flags.backend ?? config?.backend,
    dryRun: flags.dryRun ?? false,
    yes: flags.yes ?? false,
  };
}
