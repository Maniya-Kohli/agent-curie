// src/tools/core/fileOps.ts

import * as fs from "fs/promises";
import * as path from "path";
import { registry } from "../registry";

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

registry.register({
  name: "write_file",
  description:
    "Write text to a file in the sandbox directory. " +
    "Input: fileName (e.g. 'notes.txt'), content string. " +
    "Output: 'Saved <fileName>'. Creates the file if it doesn't exist; overwrites if it does.",
  category: "core",
  input_schema: {
    type: "object",
    properties: {
      fileName: { type: "string", description: "Name of the file" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["fileName", "content"],
  },
  function: (args: { fileName: string; content: string }) =>
    fileOps.writeFile(args.fileName, args.content),
});

registry.register({
  name: "read_file",
  description:
    "Read text from a file in the sandbox directory. " +
    "Input: fileName (e.g. 'notes.txt'). " +
    "Output: full file contents as a string.",
  category: "core",
  input_schema: {
    type: "object",
    properties: {
      fileName: { type: "string", description: "Name of the file to read" },
    },
    required: ["fileName"],
  },
  function: (args: { fileName: string }) => fileOps.readFile(args.fileName),
});
