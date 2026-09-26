import { baseName, languageOf } from "./files.js";
import { type Ecosystem, findDependency, type Manifest } from "./manifests.js";

export const BASELINE_CHECKS = ["tests", "lint", "formatter", "typecheck", "ci"] as const;
export type BaselineCheck = (typeof BASELINE_CHECKS)[number];
export type Baseline = Record<BaselineCheck, string[]>;

type Marker = [Ecosystem, string];

const EVIDENCE_SAMPLE = 3;

const TEST_DEPENDENCIES: Marker[] = [
  ["npm", "vitest"],
  ["npm", "jest"],
  ["npm", "mocha"],
  ["npm", "ava"],
  ["npm", "jasmine"],
  ["npm", "@playwright/test"],
  ["npm", "cypress"],
  ["python", "pytest"],
  ["java", "junit"],
  ["java", "testng"],
  ["php", "phpunit/phpunit"],
  ["php", "pestphp/pest"],
  ["ruby", "rspec"],
  ["ruby", "minitest"],
  ["dotnet", "xunit"],
  ["dotnet", "nunit"],
  ["dotnet", "mstest"],
  ["dart", "flutter_test"],
];

const LINT_DEPENDENCIES: Marker[] = [
  ["npm", "eslint"],
  ["npm", "@biomejs/biome"],
  ["npm", "oxlint"],
  ["npm", "xo"],
  ["npm", "standard"],
  ["python", "ruff"],
  ["python", "flake8"],
  ["python", "pylint"],
  ["php", "phpstan/phpstan"],
  ["php", "squizlabs/php_codesniffer"],
  ["ruby", "rubocop"],
];

const FORMAT_DEPENDENCIES: Marker[] = [
  ["npm", "prettier"],
  ["npm", "@biomejs/biome"],
  ["npm", "dprint"],
  ["python", "black"],
  ["python", "yapf"],
  ["python", "autopep8"],
  ["php", "friendsofphp/php-cs-fixer"],
  ["php", "laravel/pint"],
];

const TYPECHECK_DEPENDENCIES: Marker[] = [
  ["npm", "typescript"],
  ["python", "mypy"],
  ["python", "pyright"],
];

const TEST_SECTIONS: Marker[] = [["python", "[tool.pytest"]];
const LINT_SECTIONS: Marker[] = [
  ["python", "[tool.ruff"],
  ["python", "[tool.pylint"],
  ["python", "[flake8]"],
];
const FORMAT_SECTIONS: Marker[] = [
  ["python", "[tool.black"],
  ["python", "[tool.ruff.format"],
];
const TYPECHECK_SECTIONS: Marker[] = [
  ["python", "[tool.mypy"],
  ["python", "[tool.pyright"],
];

const FORMAT_TOOLCHAINS: Marker[] = [
  ["go", "gofmt (Go toolchain)"],
  ["rust", "rustfmt (Rust toolchain)"],
  ["dart", "dart format (Dart toolchain)"],
];

const TYPECHECK_TOOLCHAINS: Marker[] = [
  ["go", "Go compiler"],
  ["rust", "Rust compiler"],
  ["java", "JVM compiler"],
  ["dotnet", ".NET compiler"],
  ["swift", "Swift compiler"],
  ["dart", "Dart analyzer"],
];

const LINT_FILES = [
  /^eslint\.config\.[cm]?[jt]s$/,
  /^\.eslintrc(\..+)?$/,
  /^biome\.jsonc?$/,
  /^\.oxlintrc\.json$/,
  /^\.golangci\.ya?ml$/,
  /^\.?ruff\.toml$/,
  /^\.flake8$/,
  /^\.pylintrc$/,
  /^\.rubocop\.yml$/,
  /^phpstan\.neon(\.dist)?$/,
  /^clippy\.toml$/,
  /^\.swiftlint\.yml$/,
  /^\.credo\.exs$/,
];

const FORMAT_FILES = [
  /^\.prettierrc(\..+)?$/,
  /^prettier\.config\.[cm]?[jt]s$/,
  /^biome\.jsonc?$/,
  /^dprint\.jsonc?$/,
  /^\.?rustfmt\.toml$/,
  /^\.clang-format$/,
  /^\.php-cs-fixer(\.dist)?\.php$/,
  /^\.swiftformat$/,
  /^\.formatter\.exs$/,
];

const TYPECHECK_FILES = [/^tsconfig(\..+)?\.json$/, /^\.?mypy\.ini$/, /^pyrightconfig\.json$/];

const CI_PATHS = [
  /^\.github\/workflows\/[^/]+\.ya?ml$/,
  /^\.gitlab-ci\.yml$/,
  /^\.circleci\/config\.ya?ml$/,
  /^azure-pipelines\.ya?ml$/,
  /^Jenkinsfile$/,
  /^bitbucket-pipelines\.yml$/,
  /^\.travis\.yml$/,
  /^\.buildkite\/.+\.ya?ml$/,
  /^\.drone\.yml$/,
  /^\.woodpecker(\.yml|\/.+\.ya?ml)$/,
];

const TEST_PATHS = [
  /(^|\/)(__tests__|tests?|spec)\//,
  /\.(test|spec)\.[a-z0-9]+$/i,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(go|py|exs)$/,
  /Tests?\.(cs|java|kt|swift)$/,
];

export function isCiPath(path: string): boolean {
  return CI_PATHS.some((pattern) => pattern.test(path));
}

export function detectBaseline(paths: string[], manifests: Manifest[]): Baseline {
  return {
    tests: [
      ...dependencyEvidence(manifests, TEST_DEPENDENCIES),
      ...sectionEvidence(manifests, TEST_SECTIONS),
      ...testFileEvidence(paths),
    ],
    lint: [
      ...dependencyEvidence(manifests, LINT_DEPENDENCIES),
      ...sectionEvidence(manifests, LINT_SECTIONS),
      ...fileEvidence(paths.filter((path) => matchesName(path, LINT_FILES))),
    ],
    formatter: [
      ...dependencyEvidence(manifests, FORMAT_DEPENDENCIES),
      ...sectionEvidence(manifests, FORMAT_SECTIONS),
      ...fileEvidence(paths.filter((path) => matchesName(path, FORMAT_FILES))),
      ...toolchainEvidence(manifests, FORMAT_TOOLCHAINS),
    ],
    typecheck: [
      ...dependencyEvidence(manifests, TYPECHECK_DEPENDENCIES),
      ...sectionEvidence(manifests, TYPECHECK_SECTIONS),
      ...fileEvidence(paths.filter((path) => matchesName(path, TYPECHECK_FILES))),
      ...toolchainEvidence(manifests, TYPECHECK_TOOLCHAINS),
    ],
    ci: fileEvidence(paths.filter(isCiPath)),
  };
}

function dependencyEvidence(manifests: Manifest[], markers: Marker[]): string[] {
  return markers.flatMap(([ecosystem, name]) => {
    const manifest = findDependency(manifests, ecosystem, name);
    return manifest ? [`${name} (${manifest.path})`] : [];
  });
}

function sectionEvidence(manifests: Manifest[], markers: Marker[]): string[] {
  return markers.flatMap(([ecosystem, section]) => {
    const manifest = manifests.find(
      (candidate) => candidate.ecosystem === ecosystem && candidate.text.includes(section),
    );
    return manifest ? [`${section.replace(/\]?$/, "]")} (${manifest.path})`] : [];
  });
}

function toolchainEvidence(manifests: Manifest[], markers: Marker[]): string[] {
  return markers
    .filter(([ecosystem]) => manifests.some((manifest) => manifest.ecosystem === ecosystem))
    .map(([, label]) => label);
}

function testFileEvidence(paths: string[]): string[] {
  const tests = paths.filter(
    (path) => languageOf(path) !== undefined && TEST_PATHS.some((pattern) => pattern.test(path)),
  );
  if (tests.length === 0) return [];
  const noun = tests.length === 1 ? "test file" : "test files";
  return [`${tests.length} ${noun}, e.g. ${tests.slice(0, EVIDENCE_SAMPLE).join(", ")}`];
}

function fileEvidence(paths: string[]): string[] {
  const extra = paths.length - EVIDENCE_SAMPLE;
  return [...paths.slice(0, EVIDENCE_SAMPLE), ...(extra > 0 ? [`+${extra} more`] : [])];
}

function matchesName(path: string, patterns: RegExp[]): boolean {
  const name = baseName(path);
  return patterns.some((pattern) => pattern.test(name));
}
