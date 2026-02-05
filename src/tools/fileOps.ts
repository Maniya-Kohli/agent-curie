import * as fs from "fs/promises";
import * as path from "path";

const SANDBOX = path.join(process.cwd(), "sandbox_files");

export const fileOps = {
  async writeFile(name: string, data: string) {
    await fs.mkdir(SANDBOX, { recursive: true });
    await fs.writeFile(path.join(SANDBOX, name), data);
    return `Saved ${name}`;
  },
  async readFile(name: string) {
    return await fs.readFile(path.join(SANDBOX, name), "utf8");
  },
};
