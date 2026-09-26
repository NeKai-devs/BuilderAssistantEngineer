export function loadConfig(env = process.env) {
  return { apiToken: env.API_TOKEN ?? "", databaseUrl: env.DATABASE_URL ?? "" };
}
