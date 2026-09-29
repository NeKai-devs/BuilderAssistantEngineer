import { describe, expect, it } from "vitest";
import { runCommand } from "../../src/core/process.js";
import { buildDigest } from "../../src/digest/index.js";
import { redact } from "../../src/digest/redact.js";
import { gitCommitAll, tempDir, writeFiles } from "../helpers.js";

const fake = (...parts: string[]) => parts.join("");

const S = {
  aws_akid: fake("AKIA", "LEAK01ABCDEFGHIJ"),
  aws_secret_unquoted: "wJalrXUtnLEAK02K7MDENGbPxRfiCYzzzzzzzzzz",
  gh_pat: fake("ghp", "_LEAK03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
  stripe: fake("sk", "_live_LEAK04bbbbbbbbbbbbbbbbbbbb"),
  jwt: fake(
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    ".eyJzdWIiOiJMRUFLMDUifQ.LEAK05cccccccccccccccccc",
  ),
  db_url_pass: "S3cretLEAK06",
  pw_lower_quoted: "hunter2LEAK07",
  pw_obj_unquoted: "plainLEAK08xyz",
  compose_list_pw: "prodpassLEAK09",
  compose_map_pw: "rootpassLEAK10",
  compose_lower_pw: "supersecretLEAK11",
  docker_env_key: "abcdLEAK12efgh5678",
  docker_arg_token: "argtokLEAK13abcdef",
  make_token: "tok_LEAK14_1234567890",
  make_deploy_key: "deployLEAK15abcdef",
  slack_webhook: fake(
    "https://hooks.slack",
    ".com/services/T0LEAK16/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
  ),
  ci_api_token: "ciTokenLEAK17abcdef",
  azure_account_key:
    "LEAK18azureKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  sendgrid: fake("SG", ".LEAK19ddddddddddddddd.eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"),
  jdbc_pw: "jdbcLEAK20pw",
  mssql_pw: "MsSqlLEAK21!",
  bearer: "LEAK22bearertokenffffffffffffffffffff",
  whsec: fake("whsec", "_LEAK23gggggggggggggggggggggggg"),
  anthropic: fake("sk-ant", "-api03-LEAK24hhhhhhhhhhhhhhhhhhhhhhhhhhhh"),
  twilio: fake("SK", "0LEAK25a1b2c3d4e5f6a7b8c9d0e1f2a3b4"),
  vault: fake("hvs", ".LEAK26iiiiiiiiiiiiiiiiiiiiiiii"),
  pem_in_md: "MIIEvLEAK27jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj",
  openssh_in_md: "b3BlbnNzaLEAK28kkkkkkkkkkkkkkkkkkkkkkkkkk",
  commit_pw: "Hunter2LEAK29",
  commit_ghp: fake("ghp", "_LEAK30llllllllllllllllllllllllllllllll"),
  env_example_real: "realvalueLEAK31",
  pkg_config_apikey: "pkgApiKeyLEAK32xx",
  readme_export: "exportedLEAK33secretvalue",
  gcp_private_key_id: "LEAK34mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm",
  k8s_client_key_data: "LS0tLEAK35nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn",
  yaml_api_key_lower: "yamlKeyLEAK36value",
  py_settings_quoted: "django-insecure-LEAK37oooooooooo",
  xml_password: "xmlpwLEAK38",
  basic_auth_header: "dXNlcjpwYXNzTEVBSzM5",
  firebase_like: fake("AIza", "LEAK40pppppppppppppppppppppppppppp"),
  redis_url: "redisLEAK41pw",
};

const NEVER_READ = {
  ".env": "DB_PASSWORD=dotenvLEAK50\n",
  ".env.local": "DB_PASSWORD=dotenvlocalLEAK51\n",
  ".env.production": "DB_PASSWORD=dotenvprodLEAK52\n",
  "secrets.json": '{"db": "secretsjsonLEAK53"}',
  "appsettings.json": '{"ConnectionStrings": {"Default": "Server=x;Password=appsettingsLEAK54"}}',
  "config.yaml": "db:\n  password: configyamlLEAK55\n",
  "app/settings.py": "DATABASES = {'default': {'PASSWORD': 'settingspyLEAK56'}}\n",
  ".npmrc": `//registry.npmjs.org/:_authToken=${fake("npm", "_LEAK57qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq")}\n`,
  "deploy/id_rsa": "-----BEGIN RSA PRIVATE KEY-----\nidrsaLEAK58\n-----END RSA PRIVATE KEY-----\n",
  "deploy/kubeconfig": "users:\n- name: x\n  user:\n    token: kubeLEAK59\n",
  "infra/terraform.tfvars": 'db_password = "tfvarsLEAK60"\n',
  "infra/gcp-sa.json":
    '{"type": "service_account", "private_key": "-----BEGIN PRIVATE KEY-----\\ngcpsaLEAK61\\n-----END PRIVATE KEY-----\\n"}',
};

function files(): Record<string, string> {
  return {
    "package.json": JSON.stringify(
      {
        name: "shop-api",
        scripts: { test: "vitest run", lint: "eslint ." },
        config: { apiKey: S.pkg_config_apikey },
        dependencies: { express: "^4.19.0" },
      },
      null,
      2,
    ),
    "README.md": [
      "# shop-api",
      "",
      "```sh",
      `export AWS_ACCESS_KEY_ID=${S.aws_akid}`,
      `aws_secret_access_key = ${S.aws_secret_unquoted}`,
      `export STRIPE_KEY="${S.stripe}"`,
      `export MY_SERVICE_SECRET=${S.readme_export}`,
      "```",
      "",
      `Call the API with \`Authorization: Bearer ${S.bearer}\` or \`Authorization: Basic ${S.basic_auth_header}\`.`,
      "",
    ].join("\n"),
    "src/index.ts": [
      'import express from "express";',
      `const gh = "${S.gh_pat}";`,
      `const jwt = "${S.jwt}";`,
      `const dbUrl = "postgres://admin:${S.db_url_pass}@db.prod.example.net:5432/app";`,
      `const redis = "redis://:${S.redis_url}@cache.prod.example.net:6379";`,
      `const password = "${S.pw_lower_quoted}";`,
      `const cfg = { password: '${S.pw_obj_unquoted}' };`,
      `const anthropic = "${S.anthropic}";`,
      `const twilio = "${S.twilio}";`,
      `const vault = "${S.vault}";`,
      `const fb = "${S.firebase_like}";`,
      `const jdbc = "jdbc:postgresql://db.prod.example.net/app?user=app&password=${S.jdbc_pw}";`,
      `const mssql = "Server=tcp:prod.database.windows.net;User Id=sa;Password=${S.mssql_pw};";`,
      `const whsec = "${S.whsec}";`,
      `const sendgrid = "${S.sendgrid}";`,
      `const az = "DefaultEndpointsProtocol=https;AccountName=prodstore;AccountKey=${S.azure_account_key};EndpointSuffix=core.windows.net";`,
      "express().listen(3000);",
      "",
    ].join("\n"),
    "docker-compose.yml": [
      "services:",
      "  db:",
      "    environment:",
      `      - POSTGRES_PASSWORD=${S.compose_list_pw}`,
      "  mysql:",
      "    environment:",
      `      MYSQL_ROOT_PASSWORD: ${S.compose_map_pw}`,
      "  app:",
      "    x-settings:",
      `      password: ${S.compose_lower_pw}`,
      `      api_key: ${S.yaml_api_key_lower}`,
      "",
    ].join("\n"),
    Dockerfile: `FROM node:20\nENV API_KEY=${S.docker_env_key}\nARG NPM_TOKEN=${S.docker_arg_token}\n`,
    Makefile: `TOKEN ?= ${S.make_token}\nDEPLOY_KEY := ${S.make_deploy_key}\ntest:\n\tnpx vitest run\n`,
    ".github/workflows/ci.yml": [
      "name: ci",
      "jobs:",
      "  test:",
      "    env:",
      `      SLACK_WEBHOOK: ${S.slack_webhook}`,
      `      API_TOKEN: ${S.ci_api_token}`,
      "    steps:",
      "      - run: npm test",
      "",
    ].join("\n"),
    ".env.example": `DATABASE_HOST=localhost\nAPI_KEY=${S.env_example_real}\n`,
    "docs/setup.md": [
      "# Setup",
      "-----BEGIN PRIVATE KEY-----",
      S.pem_in_md,
      "-----END PRIVATE KEY-----",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      S.openssh_in_md,
      "-----END OPENSSH PRIVATE KEY-----",
      `GCP: "private_key_id": "${S.gcp_private_key_id}"`,
      `Kube: client-key-data: ${S.k8s_client_key_data}`,
      `<password>${S.xml_password}</password>`,
      `Django: SECRET_KEY = '${S.py_settings_quoted}'`,
      "",
    ].join("\n"),
    ...NEVER_READ,
    ".gitignore": "node_modules/\n.env\n",
  };
}

async function commit(cwd: string, message: string): Promise<void> {
  await runCommand("git", ["add", "-A"], { cwd });
  const identity = ["-c", "user.name=T", "-c", "user.email=t@example.com"];
  await runCommand("git", [...identity, "commit", "-q", "-m", message], { cwd });
}

describe("digest redaction of the 0.3.2 audit's secret formats (A9)", () => {
  it("keeps none of the 41 planted secrets, nor the files it must never read", async () => {
    const cwd = await tempDir();
    await writeFiles(cwd, files());
    await gitCommitAll(cwd, `set db password to ${S.commit_pw}`);
    await writeFiles(cwd, { "CHANGELOG.md": "x\n" });
    await commit(cwd, `rotate token ${S.commit_ghp}`);
    const digest = (await buildDigest(cwd, { maxChars: 100_000 })).text;
    const planted = [...Object.values(S), ...Object.values(NEVER_READ).map(leakIn)];
    expect(planted.filter((value) => digest.includes(value))).toEqual([]);
    expect(digest).toContain("shop-api");
    expect(digest).toContain("express().listen(3000);");
  });

  it("leaves CI cache keys, author associations and ordinary words alone", () => {
    const text = [
      `key: \${{ runner.os }}-pnpm-store-\${{ hashFiles('**/pnpm-lock.yaml') }}`,
      `restore-keys: \${{ runner.os }}-pnpm-store-`,
      'trusted-author-associations: "OWNER,MEMBER,COLLABORATOR"',
      "Basic authentication is off; the Bearer tokens come from the gateway.",
      "Change the password to something strong.",
    ].join("\n");
    expect(redact(text)).toBe(text);
  });
});

function leakIn(content: string): string {
  return /\w*LEAK\d+\w*/.exec(content)?.[0] ?? content;
}
