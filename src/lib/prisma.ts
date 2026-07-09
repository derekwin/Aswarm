// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaClientType = any;

let _prisma: PrismaClientType = undefined;
function getPrisma(): PrismaClientType {
  if (!_prisma) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require("@prisma/client");
    _prisma = new PrismaClient();
  }
  return _prisma;
}

export const prisma = new Proxy({} as PrismaClientType, {
  get(_target, prop: string) {
    return getPrisma()[prop];
  },
}) as PrismaClientType;
