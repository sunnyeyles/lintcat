/** Packages that do the same job, so a repository needs only one of each group. */
const PURPOSES: Readonly<Record<string, readonly string[]>> = {
  dates: ["date-fns", "dayjs", "moment", "luxon", "@js-joda/core"],
  "HTTP requests": ["axios", "got", "node-fetch", "ky", "superagent", "cross-fetch", "isomorphic-fetch", "request", "undici"],
  "schema validation": ["zod", "yup", "joi", "ajv", "valibot", "superstruct", "io-ts", "@sinclair/typebox", "class-validator"],
  "utility helpers": ["lodash", "lodash-es", "underscore", "ramda", "remeda"],
  "unique ids": ["uuid", "nanoid", "cuid", "@paralleldrive/cuid2", "ulid", "shortid"],
  logging: ["winston", "pino", "bunyan", "log4js", "loglevel", "consola", "signale"],
  "command-line parsing": ["yargs", "commander", "meow", "minimist", "cac", "arg", "sade", "clipanion"],
  "test running": ["jest", "vitest", "mocha", "ava", "jasmine", "tap", "uvu"],
  "HTTP mocking": ["nock", "msw"],
  "class names": ["clsx", "classnames"],
  "terminal colours": ["chalk", "picocolors", "kleur", "colorette", "ansi-colors", "colors"],
  "file globbing": ["glob", "fast-glob", "globby", "tinyglobby"],
  "concurrency limits": ["p-limit", "p-queue", "bottleneck"],
  "database access": ["knex", "kysely", "drizzle-orm", "typeorm", "sequelize", "@prisma/client", "objection", "@mikro-orm/core"],
  "Markdown rendering": ["marked", "markdown-it", "remark", "micromark", "showdown"],
  "state management": ["redux", "@reduxjs/toolkit", "zustand", "mobx", "jotai", "recoil", "valtio"],
  "data fetching": ["swr", "@tanstack/react-query", "react-query"],
  "env loading": ["dotenv", "dotenv-flow", "env-cmd"],
  "YAML parsing": ["yaml", "js-yaml"],
  "deep equality": ["fast-deep-equal", "deep-equal", "dequal", "lodash.isequal"],
  "web serving": ["express", "fastify", "koa", "hono", "@hapi/hapi", "restify"],
  icons: ["lucide-react", "react-icons", "@heroicons/react", "iconsax-reactjs", "@tabler/icons-react", "@phosphor-icons/react"],
  "password hashing": ["bcrypt", "bcryptjs", "argon2"],
  "JSON web tokens": ["jsonwebtoken", "jose"],
  "form state": ["react-hook-form", "formik", "react-final-form"],
  "Postgres clients": ["pg", "postgres", "@neondatabase/serverless"],
};

const BY_PACKAGE = new Map(
  Object.entries(PURPOSES).flatMap(([purpose, names]) => names.map((name) => [name, purpose] as const)),
);

/** The job a package does and the others that do it, or undefined for one this table does not know. */
export function purposeOf(name: string): { purpose: string; alternatives: readonly string[] } | undefined {
  const purpose = BY_PACKAGE.get(name);
  return purpose === undefined
    ? undefined
    : { purpose, alternatives: PURPOSES[purpose]!.filter((other) => other !== name) };
}
