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
  ["closed-position message", /position is no longer available/i],
  ["closed-application message", /not accepting applications at this time/i],
];

for (const [pageName, source] of pages) {
  for (const [fieldName, pattern] of requiredPatterns) {
    if (!pattern.test(source)) {
      throw new Error(`${pageName} is missing the ${fieldName}`);
    }
  }
}

const prohibitedOpenHiringPatterns = [
  ["active Netlify application form", /<form[^>]+name="admin-application"/i],
  ["open application button", />\s*Apply Now\s*</i],
  ["submit application button", />\s*Submit Application\s*</i],
  ["open-hiring label", /Now Hiring:/i],
  ["open-position heading", /The Available Position/i],
  ["open-position statement", /position available/i],
];

for (const [fieldName, pattern] of prohibitedOpenHiringPatterns) {
  for (const [pageName, source] of pages) {
    if (pattern.test(source)) {
      throw new Error(`${pageName} still contains ${fieldName}`);
    }
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

console.log("Administrative assistant application and job description are closed.");
