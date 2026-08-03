import { readFile } from "node:fs/promises";

const applicationPath = new URL("../administrative-assistant-application.html", import.meta.url);
const descriptionPath = new URL("../administrative-assistant-job-description.html", import.meta.url);

const [application, description] = await Promise.all([
  readFile(applicationPath, "utf8"),
  readFile(descriptionPath, "utf8"),
]);

const pages = [
  ["application", application],
  ["job description", description],
];

const requiredPatterns = [
  ["location", /Montgomery/],
  ["address", /9865 Montgomery Rd, 45242/],
  ["pay", /\$17\/hour/],
  ["Monday–Thursday", /Monday–Thursday/],
  ["Monday–Thursday start time", /2:00 PM/],
  ["Monday–Thursday end time", /7:30 PM/],
  ["Friday", /Friday/],
  ["Friday start time", /2:00 PM/],
  ["Friday end time", /7:00 PM/],
];

for (const [pageName, source] of pages) {
  for (const [fieldName, pattern] of requiredPatterns) {
    if (!pattern.test(source)) {
      throw new Error(`${pageName} is missing the current ${fieldName}`);
    }
  }
}

const exactSchedulePatterns = [
  [
    "application",
    application,
    /Monday–Thursday 2:00 PM\s*[–-]\s*7:30 PM, Friday 2:00 PM\s*[–-]\s*7:00 PM/,
  ],
  [
    "job description",
    description,
    /Monday–Thursday[\s\S]{0,200}2:00 PM\s*[–-]\s*7:30 PM[\s\S]{0,200}Friday[\s\S]{0,200}2:00 PM\s*[–-]\s*7:00 PM/,
  ],
];

for (const [pageName, source, pattern] of exactSchedulePatterns) {
  if (!pattern.test(source)) {
    throw new Error(`${pageName} does not contain the exact current schedule`);
  }
}

const staleDescriptionPatterns = [
  ["Mason hiring location", /Now Hiring — Mason Location/],
  ["old Mason address", /6682 Tri Way Dr/],
  ["old Friday shift", /5:00 PM\s*[–-]\s*7:00 PM/],
  ["Saturday shift", /<div class="sched-day">Saturdays<\/div>/],
  ["Sunday shift", /<div class="sched-day">Sundays<\/div>/],
  ["old Mason commute requirement", /within 25[–-]30 minutes of (?:the )?Mason/],
];

for (const [fieldName, pattern] of staleDescriptionPatterns) {
  if (pattern.test(description)) {
    throw new Error(`job description still contains ${fieldName}`);
  }
}

for (const [pageName, source] of pages) {
  if (source.includes("—")) {
    throw new Error(`${pageName} contains a prohibited em dash`);
  }
}

const prohibitedAnonymousReviewPatterns = [
  /class="quotes-wrap"/i,
  /class="quote-item"/i,
  /class="quote-text"/i,
  /CSM Administrative Team Member/i,
  /What the Current Admin Team Has to Say/i,
];

for (const pattern of prohibitedAnonymousReviewPatterns) {
  if (pattern.test(description)) {
    throw new Error("job description contains an anonymous employee review");
  }
}

console.log("Administrative assistant application and job description match.");
