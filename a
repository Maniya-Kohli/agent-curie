import { google } from "googleapis";
import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

async function authorize() {
  const content = await fs.readFile(CREDENTIALS_PATH, "utf8");
  const credentials = JSON.parse(content);
  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0],
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("\n🔑 AUTHORIZE YOUR GOOGLE ACCOUNT");
  console.log("==================================");
  console.log("\n1. Visit this URL:\n");
  console.log(authUrl);
  console.log("\n2. Copy the code from the URL after authorization");
  console.log("   (the part after 'code=' in http://localhost/?code=...)\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question("3. Paste the authorization code here: ", async (input) => {
      rl.close();
      try {
        // Handle both full URL and just the code
        let code = input.trim();
        if (code.includes("code=")) {
          const url = new URL(code);
          code = url.searchParams.get("code") || code;
        }

        console.log("\n⏳ Exchanging code for tokens...");
        const { tokens } = await oAuth2Client.getToken(code);

        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        console.log("✅ Token saved to token.json");
        console.log(
          "\n🎉 Authorization complete! Your bot can now access Google services.\n",
        );

        resolve(tokens);
      } catch (error) {
        console.error("❌ Error:", error);
        reject(error);
      }
    });
  });
}

authorize().catch(console.error);
