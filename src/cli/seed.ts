import { loadConfig, loadDotEnv } from "../config.js";
import { openDb } from "../db.js";
import { createRelay } from "../service.js";

/* Creates a sample form and prints its links. Usage: npm run seed */

loadDotEnv();
const config = loadConfig();
const relay = createRelay(openDb(config.dbUrl, config.dbAuthToken), config.baseUrl);

const created = await relay.createForm(
  {
    title: "Workshop feedback",
    description: "Thanks for coming to the Saturday workshop. Five quick questions — about two minutes.",
    fields: [
      { id: "q1", type: "single_choice", label: "How was the workshop?", required: true, options: ["Great", "Okay", "Poor"] },
      {
        id: "q2",
        type: "multi_choice",
        label: "Which sessions did you find useful?",
        options: ["Intro talk", "Hands-on lab", "Q&A panel", "Networking"],
      },
      { id: "q3", type: "number", label: "How likely are you to recommend it, from 0 to 10?", required: true },
      { id: "q4", type: "long_text", label: "What should we improve?" },
      { id: "q5", type: "email", label: "Email, if you'd like the slides" },
    ],
  },
  { intro: "Hi! Please share your feedback on the workshop." },
);

console.log(`Created form ${created.id}\n`);
console.log(`Fill:   ${created.links.fill}`);
console.log(`Claude: ${created.links.claude}`);
console.log(`Clean:  ${config.baseUrl}/f/${created.id}/clean\n`);
console.log("Share message:\n");
console.log(created.share_message);
